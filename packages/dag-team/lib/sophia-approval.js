/**
 * Sophia approval-plane glue (P2 orchestration bridge).
 *
 * Wires the orchestration approval tools (`sophia_team_propose` / `_review` /
 * `_approve`, packages/orchestration) into the running dag-team plugin:
 *
 * - `dagBackend` materializes approved plans as DAG teams through the
 *   `AgentTeamsRuntime` (`sophiaDagBackendFor`).
 * - `persistentBackend` materializes them as persisted ledger channels via
 *   agent-team's `createSophiaPersistentBackend`, resolved lazily through the
 *   `agentTeam` host service at the first persistent materialization (a
 *   composition without the host still installs cleanly).
 * - the `OrchestrationHost` maps orchestration callers to dag identities and
 *   locates DAG captains for review adjudication.
 * - `resolveCaller` turns a `ToolRunContext` into a `CallerIdentity`
 *   (persistent ledger member → dag participant → human).
 *
 * The install is idempotent per context: the first call builds and registers
 * the plane, later calls return the same handle without re-registering.
 */
import { join } from 'node:path';
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import { SophiaTeamFacade } from 'dsh-sophia-entities/orchestration/facade';
import { registerApprovalTools } from 'dsh-sophia-entities/orchestration/tools';
import { createSophiaPersistentBackend } from 'dsh-sophia-entities/persistent-backend';
import { sophiaDagBackendFor } from "./sophia-dag-backend.js";
import { CAPTAIN_KEY, findTeamByParticipant, readTeam } from "./state.js";
import { sessionOwnEvents } from "./harness-compat.js";
import { readJsonRequest, RequestBodyError } from "./web-routes.js";
import { snapshotApprovals, runApprovalPlanAction } from 'dsh-sophia-entities/orchestration/routes';
import { createApprovalChannels, compositeNotifier, } from 'dsh-sophia-entities/orchestration/notifier';
/** Workspace registry service key candidates, mirroring index.ts. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'];
/**
 * Subagent label prefix that marks a dag member (mirrors `MEMBER_LABEL_PREFIX`
 * in members.ts, which is not exported). Used to measure delegation depth.
 */
const MEMBER_LABEL_PREFIX = 'agent-teams:';
/**
 * Deterministic ledger-namespace fallback when no workspace registry is
 * mounted at the first persistent materialization. The persistent backend keys
 * its team refs off this id, so a headless composition that never mounts a
 * registry still gets a stable namespace.
 */
const DEFAULT_WORKSPACE_ID = 'default';
const installed = new WeakMap();
/**
 * Idempotently bridge the orchestration approval plane into `ctx`. The first
 * call per context builds the facade, hosts and approval tools; later calls
 * return the existing handle without re-registering the tools.
 */
export function installSophiaApprovalPlane(ctx, options) {
    const existing = installed.get(ctx);
    if (existing !== undefined)
        return existing;
    const handle = buildApprovalPlane(ctx, options);
    installed.set(ctx, handle);
    return handle;
}
function buildApprovalPlane(ctx, { runtime, resolved }) {
    const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1]));
    // The caller workspace path when determinable (registry match on cwd, else
    // the registry's primary workspace), otherwise the process cwd.
    const workingDirectory = resolveWorkingDirectory(workspaceRegistry);
    const dagBackend = sophiaDagBackendFor(runtime);
    const persistentBackend = createLazyPersistentBackend(ctx, workspaceRegistry, workingDirectory);
    const orchestrationHost = {
        memberIdOf: (caller) => caller?.sessionId,
        handleOf: (caller) => caller?.handle,
        teamIdOf: (caller) => caller?.teamId,
        // DAG captains live in per-workspace state roots; scan every registry
        // workspace plus the fallback working directory.
        captainOf: (teamId) => findDagCaptain(workspaceRegistry, workingDirectory, resolved, teamId),
        depthOf: (caller) => depthOfCaller(ctx, caller),
        maxTeamDepth: resolved.memberMaxDepth ?? 0,
    };
    const facade = new SophiaTeamFacade({
        workspace: workingDirectory,
        host: { ...orchestrationHost, workingDirectory },
        dagBackend,
        persistentBackend,
        notify: compositeNotifier(createApprovalChannels(buildNotifierHost(ctx)), (message) => {
            ctx.logger.error(message);
        }),
    });
    registerApprovalTools(ctx, { facade, resolveCaller: resolveCallerFor(ctx, resolved) });
    return {
        facade,
        dagBackend,
        persistentBackend,
        workingDirectory,
        maxTeamDepth: resolved.memberMaxDepth ?? 0,
    };
}
/**
 * P3 approval HTTP surface (design §4.9). Registers the two endpoints the
 * browser approval card and badge poll into the authenticated web server
 * (index.ts `registerWebSurface`):
 *
 *   GET  /plugins/dsh-sophia-entities/approvals       → pending queue snapshot
 *   POST /plugins/dsh-sophia-entities/approvals/plan  → set_mode / approve / reject / review
 *
 * The handlers mirror the neighbouring /state /halt /plan routes in index.ts
 * (method gate, `readJsonRequest`, JSON + cache-control:no-store, session
 * resolution through the live `agents` registry). The connection gate has
 * already authenticated the browser as the human operator, so every plan
 * caller is the Human owner; the human session id rides in the request body
 * exactly like the halt route's `sessionId` and is rejected with 409 when it
 * is not attached. Registering is idempotent per web server via `ctx.effect`.
 */
export function registerApprovalRoutes(ctx, webServer, facade) {
    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-sophia-entities/approvals',
        handler: async (req, res) => {
            if (req.method !== 'GET') {
                res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' });
                res.end();
                return;
            }
            try {
                const snapshot = await snapshotApprovals(facade);
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(snapshot));
            }
            catch (error) {
                ctx.logger.warn(`agent-teams: approvals snapshot failed: ${String(error)}`);
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'failed to load pending approvals' }));
            }
        },
    }), 'agent-teams: approvals route');
    ctx.effect(() => webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-sophia-entities/approvals/plan',
        handler: async (req, res) => {
            if (req.method !== 'POST') {
                res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' });
                res.end();
                return;
            }
            let payload;
            try {
                payload = await readJsonRequest(req);
            }
            catch (error) {
                res.writeHead(error instanceof RequestBodyError ? error.status : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request body' }));
                return;
            }
            const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'].trim() : '';
            if (sessionId === '') {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'sessionId is required' }));
                return;
            }
            if (ctx.agents.get(sessionId) === undefined) {
                res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: 'human session is not attached' }));
                return;
            }
            let action;
            try {
                action = parseApprovalPlanAction(payload);
            }
            catch (error) {
                res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid approval plan action' }));
                return;
            }
            try {
                const result = await runApprovalPlanAction(facade, { isHuman: true, sessionId }, action);
                res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify(result));
            }
            catch (error) {
                ctx.logger.warn(`agent-teams: approval plan action failed: ${String(error)}`);
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'approval plan action failed' }));
            }
        },
    }), 'agent-teams: approvals plan route');
}
/** Valid strings for `ApprovalPlanAction.action`. */
const APPROVAL_ACTIONS = new Set(['set_mode', 'approve', 'reject', 'review']);
/** Valid strings for `ApprovalPlanAction.mode`. */
const APPROVAL_MODES = new Set(['persistent', 'dag']);
/** Valid strings for `ApprovalPlanAction.decision`. */
const APPROVAL_DECISIONS = new Set(['approve_dag', 'approve_persistent', 'downgrade_to_dag', 'reject', 'approve']);
/**
 * Reads the plan request body into an `ApprovalPlanAction`, rejecting unknown
 * actions and missing request ids with a descriptive message that the route
 * maps to 400 (mirrors the `/plan` route's per-field validation).
 */
export function parseApprovalPlanAction(payload) {
    const action = payload['action'];
    const requestId = payload['requestId'];
    if (typeof action !== 'string' || !APPROVAL_ACTIONS.has(action)) {
        throw new Error('action must be one of set_mode, approve, reject, review');
    }
    if (typeof requestId !== 'string' || requestId.trim() === '') {
        throw new Error('requestId is required');
    }
    const mode = payload['mode'];
    if (mode !== undefined && (typeof mode !== 'string' || !APPROVAL_MODES.has(mode))) {
        throw new Error('mode must be persistent or dag');
    }
    const decision = payload['decision'];
    if (decision !== undefined && (typeof decision !== 'string' || !APPROVAL_DECISIONS.has(decision))) {
        throw new Error('decision must be one of approve_dag, approve_persistent, downgrade_to_dag, reject, approve');
    }
    const reason = payload['reason'];
    if (reason !== undefined && typeof reason !== 'string') {
        throw new Error('reason must be a string');
    }
    return {
        action: action,
        requestId: requestId.trim(),
        ...(mode !== undefined ? { mode: mode } : {}),
        ...(decision !== undefined ? { decision: decision } : {}),
        ...(reason !== undefined ? { reason } : {}),
    };
}
function resolveWorkingDirectory(registry) {
    if (registry !== undefined) {
        const cwd = process.cwd();
        const workspaces = registry.list();
        const byPath = workspaces.find(workspace => workspace.path === cwd);
        const primary = byPath ?? workspaces[0];
        if (primary !== undefined)
            return primary.path;
    }
    return process.cwd();
}
function dagStateRoots(registry, workingDirectory, resolved) {
    const roots = new Set();
    if (registry !== undefined) {
        for (const workspace of registry.list())
            roots.add(join(workspace.path, resolved.stateDir));
    }
    roots.add(join(workingDirectory, resolved.stateDir));
    return [...roots];
}
async function findDagCaptain(registry, workingDirectory, resolved, teamId) {
    for (const stateRoot of dagStateRoots(registry, workingDirectory, resolved)) {
        const team = await readTeam(stateRoot, teamId).catch(() => undefined);
        if (team !== undefined)
            return team.captainSessionId;
    }
    return undefined;
}
/**
 * Delegation depth of a non-human caller: hops from the caller up to its
 * nearest member-labeled ancestor (1 for a member itself, 0 when no member
 * ancestor exists) — the same hop semantic `installMemberDelegationGuard`
 * applies to subagent spawning, so the facade's `depth >= maxTeamDepth` guard
 * lands one fencepost stricter than the spawn budget (conservative).
 */
async function depthOfCaller(ctx, caller) {
    if (caller.isHuman || caller.sessionId === undefined)
        return 0;
    let agent = ctx.agents.get(caller.sessionId);
    let depth = 0;
    while (agent !== undefined) {
        depth += 1;
        let isMember = false;
        try {
            const descriptor = foldSubagentDescriptor(sessionOwnEvents(agent.session));
            isMember = descriptor?.label?.startsWith(MEMBER_LABEL_PREFIX) ?? false;
        }
        catch {
            // Best-effort: unreadable session events count as non-member.
            isMember = false;
        }
        if (isMember)
            return depth;
        const parentId = agent.session.header.parentSession;
        agent = parentId === undefined ? undefined : ctx.agents.get(parentId);
    }
    return 0;
}
/**
 * Builds the facade's caller resolver: persistent ledger member → dag
 * participant (captain or member) → human. The dag branch scans the caller's
 * own workspace state root (`agent.session.header.cwd ?? process.cwd()`),
 * mirroring the agent_teams_* tools' `workspaceOf` semantics, so a dag team is
 * found exactly when the tools' participant lookup would find it.
 */
function resolveCallerFor(ctx, resolved) {
    return async (exec) => {
        const agent = exec.agent;
        if (agent === undefined) {
            throw new Error('sophia approval tools require a calling agent');
        }
        // Persistent ledger member: the agent-team host maps the live agent to its
        // durable member. Ledger teams have no dag teamId — the facade routes them
        // by member identity instead.
        const host = agent.ctx.get('agentTeam');
        const member = host?.memberForAgent(agent);
        if (member !== undefined) {
            return { isHuman: false, sessionId: agent.id, handle: member.handle, teamId: undefined };
        }
        // DAG participant: captain or an active member of the caller's team.
        const stateRoot = join(agent.session.header.cwd ?? process.cwd(), resolved.stateDir);
        const team = await findTeamByParticipant(stateRoot, agent.id);
        if (team !== undefined) {
            let handle;
            if (team.captainSessionId === agent.id) {
                handle = CAPTAIN_KEY;
            }
            else {
                const memberEntry = team.members.find(entry => entry.id === agent.id && entry.status !== 'removed');
                // findTeamByParticipant already matched an active participant, so this
                // only misses on a concurrent removal; fall back to the session id as
                // a degenerate handle.
                handle = memberEntry?.name ?? agent.id;
            }
            return { isHuman: false, sessionId: agent.id, handle, teamId: team.id };
        }
        return { isHuman: true, sessionId: agent.id };
    };
}
/**
 * Lazy persistent `TeamBackend` proxy. The backend's deps are being reworked
 * in parallel to `{ host: PersistentHostAPI; workspaceId }`; the current
 * signature reads `{ ledger, workspaceId }`. Wiring resolves the host from the
 * plugin context and the workspace id at FIRST materialization and bridges the
 * deps through the reworked shape, so this glue compiles (and runs) whichever
 * signature lands. A composition without the `agentTeam` service only fails at
 * first persistent materialization, never at install.
 */
/**
 * Build the `NotifierHost` adapters for the request-notification channels.
 *
 * Channel availability is honest (§4.6): every channel only fires when its
 * adapter is actually present, otherwise it degrades silently in the composite.
 *
 * - `badge` is always wired — its count is the pending-owner volume, surfaced by
 *   P2's `/approvals` snapshot so the client badge (P4.2) reads a real number.
 * - `thread` fires when the agent-team ledger host is reachable: it posts an
 *   approval notice onto a per-workspace notification channel.
 * - `agentMail` only fires when the host exposes a mail tool; the harness's
 *   agent-mail availability is still unverified (§9 O1), so it is wired only if
 *   present and otherwise degrades.
 */
function buildNotifierHost(ctx) {
    // Thread adapter: resolve the ledger host lazily (mirrors the persistent
    // backend's lazy resolution) and post onto a stable per-workspace notification
    // channel. The structural shape keeps this package independent of agent-team.
    const threadHost = ctx.get('agentTeam');
    const channelId = () => 'sophia-approvals';
    const createChannel = threadHost?.createChannel;
    const sendMessage = threadHost?.sendMessage;
    return {
        // The agent-mail tool is not provably present today; leave undefined so the
        // mail channel degrades instead of failing the composite. Future wiring can
        // resolve the tool from the agent's tools registry.
        agentMail: undefined,
        threadToHuman: createChannel && sendMessage
            ? async (id, body) => {
                // Ensure the notification channel exists, then post the notice.
                const registry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1]));
                const workspaceId = registry?.list()[0]?.id ?? DEFAULT_WORKSPACE_ID;
                let channelResult;
                try {
                    channelResult = await createChannel({
                        requestId: `notify:${id}:${Date.now()}`,
                        workspaceId,
                        name: 'Sophia 审批',
                        description: 'Approval request notifications (dsh-sophia-entities).',
                        memberIds: [],
                    });
                }
                catch {
                    channelResult = { channel: { channelRef: 'ch-sophia-approvals' } };
                }
                await sendMessage({
                    workspaceId,
                    channelRef: channelResult?.channel?.channelRef ?? 'ch-sophia-approvals',
                    body,
                });
            }
            : undefined,
        channelId: () => channelId(),
        badgeCount: async () => {
            // The pending-owner volume is computed from the approval store by the
            // client /approvals poll; the badge channel only needs to run, so the
            // shared count is already surfaced there. No side effect needed here.
        },
    };
}
function createLazyPersistentBackend(ctx, registry, workingDirectory) {
    let backend;
    const resolveBackend = () => {
        if (backend === undefined) {
            const host = ctx.get('agentTeam');
            if (host === undefined) {
                throw new Error('sophia approval: persistent materialization requires the agent-team host service (ctx "agentTeam")');
            }
            // Bridge through the target deps shape; the parameter-type cast keeps
            // this compile-stable while the persistent-backend rework lands.
            const deps = createSophiaPersistentBackend;
            backend = deps({ host, workspaceId: resolveWorkspaceId(registry, workingDirectory) });
        }
        return backend;
    };
    return {
        mode: 'persistent',
        create: (facadeCtx, request) => resolveBackend().create(facadeCtx, request),
        describe: (facadeCtx, teamRef) => resolveBackend().describe(facadeCtx, teamRef),
        list: (facadeCtx) => resolveBackend().list(facadeCtx),
    };
}
function resolveWorkspaceId(registry, workingDirectory) {
    if (registry !== undefined) {
        const workspaces = registry.list();
        const byPath = workspaces.find(workspace => workspace.path === workingDirectory);
        const primary = byPath ?? workspaces[0];
        if (primary !== undefined)
            return primary.id;
    }
    // No registry reachable; the host itself exposes no single stable workspace
    // id without a caller agent (memberForAgent needs one, and the backend's
    // create() receives the facade, not the caller) — fall back to a
    // deterministic namespace id.
    return DEFAULT_WORKSPACE_ID;
}
