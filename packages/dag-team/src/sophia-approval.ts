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

import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { SophiaTeamFacade, type CallerIdentity } from 'dsh-sophia-entities/orchestration/facade'
import { registerApprovalTools } from 'dsh-sophia-entities/orchestration/tools'
import type { OrchestrationHost, TeamBackend } from 'dsh-sophia-entities/orchestration/types'
import { createSophiaPersistentBackend } from 'dsh-sophia-entities/persistent-backend'
import type { AgentTeamsRuntime, ToolsConfig } from './tools.ts'
import { sophiaDagBackendFor } from './sophia-dag-backend.ts'
import { CAPTAIN_KEY, findTeamByParticipant, readTeam } from './state.ts'
import { sessionOwnEvents } from './harness-compat.ts'
import { readJsonRequest, RequestBodyError, type WebRouteHost } from './web-routes.ts'
import { snapshotApprovals, runApprovalPlanAction, type ApprovalPlanAction } from 'dsh-sophia-entities/orchestration/routes'

/** Workspace registry service key candidates, mirroring index.ts. */
const WORKSPACE_KEYS = ['workspaceRegistry', 'workspace'] as const

/**
 * Structural view of the agent-team host as the approval glue needs it
 * (`memberForAgent` at agent-team/src/index.ts:764). The host service is read
 * from `ctx.get('agentTeam')` at runtime; typing it structurally — instead of
 * importing the full host surface ('dsh-sophia-entities/host', which drags the
 * whole agent-team source graph into this package's typecheck program) — keeps
 * the dag-team and agent-team typecheck programs independent, in the same
 * spirit as the orchestration contract seam.
 */
interface AgentTeamHostLike {
  memberForAgent(agent: Agent): { readonly handle: string } | undefined
}

/**
 * Subagent label prefix that marks a dag member (mirrors `MEMBER_LABEL_PREFIX`
 * in members.ts, which is not exported). Used to measure delegation depth.
 */
const MEMBER_LABEL_PREFIX = 'agent-teams:'

/**
 * Deterministic ledger-namespace fallback when no workspace registry is
 * mounted at the first persistent materialization. The persistent backend keys
 * its team refs off this id, so a headless composition that never mounts a
 * registry still gets a stable namespace.
 */
const DEFAULT_WORKSPACE_ID = 'default'

/** Inputs shared by the glue and its host (index.ts `apply`). */
export interface SophiaApprovalPlaneOptions {
  /** The dag runtime returned by `registerAgentTeamsTools`. */
  readonly runtime: AgentTeamsRuntime
  /** The resolved dag-team config (stateDir / memberMaxDepth / ...). */
  readonly resolved: ToolsConfig
}

/**
 * Handle for later P3 route wiring. The facade is the approval engine: its
 * router and store expose the request list / activity / approvalsRoot
 * (`<workspace>/.sophia-entities/approvals/`).
 */
export interface ApprovalPlaneHandle {
  readonly facade: SophiaTeamFacade
  readonly dagBackend: TeamBackend
  readonly persistentBackend: TeamBackend
  readonly workingDirectory: string
  readonly maxTeamDepth: number
}

const installed = new WeakMap<object, ApprovalPlaneHandle>()

/**
 * Idempotently bridge the orchestration approval plane into `ctx`. The first
 * call per context builds the facade, hosts and approval tools; later calls
 * return the existing handle without re-registering the tools.
 */
export function installSophiaApprovalPlane(
  ctx: Context,
  options: SophiaApprovalPlaneOptions,
): ApprovalPlaneHandle {
  const existing = installed.get(ctx)
  if (existing !== undefined) return existing
  const handle = buildApprovalPlane(ctx, options)
  installed.set(ctx, handle)
  return handle
}

function buildApprovalPlane(
  ctx: Context,
  { runtime, resolved }: SophiaApprovalPlaneOptions,
): ApprovalPlaneHandle {
  const workspaceRegistry = (ctx.get(WORKSPACE_KEYS[0]) ?? ctx.get(WORKSPACE_KEYS[1])) as WorkspaceRegistry | undefined
  // The caller workspace path when determinable (registry match on cwd, else
  // the registry's primary workspace), otherwise the process cwd.
  const workingDirectory = resolveWorkingDirectory(workspaceRegistry)

  const dagBackend = sophiaDagBackendFor(runtime)
  const persistentBackend = createLazyPersistentBackend(ctx, workspaceRegistry, workingDirectory)

  const orchestrationHost: OrchestrationHost = {
    memberIdOf: (caller) => (caller as CallerIdentity | undefined)?.sessionId,
    handleOf: (caller) => (caller as CallerIdentity | undefined)?.handle,
    teamIdOf: (caller) => (caller as CallerIdentity | undefined)?.teamId,
    // DAG captains live in per-workspace state roots; scan every registry
    // workspace plus the fallback working directory.
    captainOf: (teamId) => findDagCaptain(workspaceRegistry, workingDirectory, resolved, teamId),
    depthOf: (caller) => depthOfCaller(ctx, caller as CallerIdentity),
    maxTeamDepth: resolved.memberMaxDepth ?? 0,
  }

  const facade = new SophiaTeamFacade({
    workspace: workingDirectory,
    host: { ...orchestrationHost, workingDirectory },
    dagBackend,
    persistentBackend,
    notify: undefined,
  })

  registerApprovalTools(ctx, { facade, resolveCaller: resolveCallerFor(ctx, resolved) })

  return {
    facade,
    dagBackend,
    persistentBackend,
    workingDirectory,
    maxTeamDepth: resolved.memberMaxDepth ?? 0,
  }
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
export function registerApprovalRoutes(
  ctx: Context,
  webServer: WebRouteHost,
  facade: SophiaTeamFacade,
): void {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-sophia-entities/approvals',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET', 'cache-control': 'no-store' })
        res.end()
        return
      }
      try {
        const snapshot = await snapshotApprovals(facade)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(snapshot))
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: approvals snapshot failed: ${String(error)}`)
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'failed to load pending approvals' }))
      }
    },
  }), 'agent-teams: approvals route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/plugins/dsh-sophia-entities/approvals/plan',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'cache-control': 'no-store' })
        res.end()
        return
      }
      let payload: Record<string, unknown>
      try {
        payload = await readJsonRequest(req)
      } catch (error: unknown) {
        res.writeHead(error instanceof RequestBodyError ? error.status : 400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid request body' }))
        return
      }
      const sessionId = typeof payload['sessionId'] === 'string' ? payload['sessionId'].trim() : ''
      if (sessionId === '') {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'sessionId is required' }))
        return
      }
      if (ctx.agents.get(sessionId as SessionId) === undefined) {
        res.writeHead(409, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: 'human session is not attached' }))
        return
      }
      let action: ApprovalPlanAction
      try {
        action = parseApprovalPlanAction(payload)
      } catch (error: unknown) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'invalid approval plan action' }))
        return
      }
      try {
        const result = await runApprovalPlanAction(facade, { isHuman: true, sessionId }, action)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(result))
      } catch (error: unknown) {
        ctx.logger.warn(`agent-teams: approval plan action failed: ${String(error)}`)
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'approval plan action failed' }))
      }
    },
  }), 'agent-teams: approvals plan route')
}

/** Valid strings for `ApprovalPlanAction.action`. */
const APPROVAL_ACTIONS = new Set(['set_mode', 'approve', 'reject', 'review'])

/** Valid strings for `ApprovalPlanAction.mode`. */
const APPROVAL_MODES = new Set(['persistent', 'dag'])

/** Valid strings for `ApprovalPlanAction.decision`. */
const APPROVAL_DECISIONS = new Set(['approve_dag', 'approve_persistent', 'downgrade_to_dag', 'reject', 'approve'])

/**
 * Reads the plan request body into an `ApprovalPlanAction`, rejecting unknown
 * actions and missing request ids with a descriptive message that the route
 * maps to 400 (mirrors the `/plan` route's per-field validation).
 */
export function parseApprovalPlanAction(payload: Record<string, unknown>): ApprovalPlanAction {
  const action = payload['action']
  const requestId = payload['requestId']
  if (typeof action !== 'string' || !APPROVAL_ACTIONS.has(action)) {
    throw new Error('action must be one of set_mode, approve, reject, review')
  }
  if (typeof requestId !== 'string' || requestId.trim() === '') {
    throw new Error('requestId is required')
  }
  const mode = payload['mode']
  if (mode !== undefined && (typeof mode !== 'string' || !APPROVAL_MODES.has(mode))) {
    throw new Error('mode must be persistent or dag')
  }
  const decision = payload['decision']
  if (decision !== undefined && (typeof decision !== 'string' || !APPROVAL_DECISIONS.has(decision))) {
    throw new Error('decision must be one of approve_dag, approve_persistent, downgrade_to_dag, reject, approve')
  }
  const reason = payload['reason']
  if (reason !== undefined && typeof reason !== 'string') {
    throw new Error('reason must be a string')
  }
  return {
    action: action as ApprovalPlanAction['action'],
    requestId: requestId.trim(),
    ...(mode !== undefined ? { mode: mode as ApprovalPlanAction['mode'] } : {}),
    ...(decision !== undefined ? { decision: decision as ApprovalPlanAction['decision'] } : {}),
    ...(reason !== undefined ? { reason } : {}),
  }
}

function resolveWorkingDirectory(registry: WorkspaceRegistry | undefined): string {
  if (registry !== undefined) {
    const cwd = process.cwd()
    const workspaces = registry.list()
    const byPath = workspaces.find(workspace => workspace.path === cwd)
    const primary = byPath ?? workspaces[0]
    if (primary !== undefined) return primary.path
  }
  return process.cwd()
}

function dagStateRoots(
  registry: WorkspaceRegistry | undefined,
  workingDirectory: string,
  resolved: ToolsConfig,
): string[] {
  const roots = new Set<string>()
  if (registry !== undefined) {
    for (const workspace of registry.list()) roots.add(join(workspace.path, resolved.stateDir))
  }
  roots.add(join(workingDirectory, resolved.stateDir))
  return [...roots]
}

async function findDagCaptain(
  registry: WorkspaceRegistry | undefined,
  workingDirectory: string,
  resolved: ToolsConfig,
  teamId: string,
): Promise<string | undefined> {
  for (const stateRoot of dagStateRoots(registry, workingDirectory, resolved)) {
    const team = await readTeam(stateRoot, teamId).catch(() => undefined)
    if (team !== undefined) return team.captainSessionId
  }
  return undefined
}

/**
 * Delegation depth of a non-human caller: hops from the caller up to its
 * nearest member-labeled ancestor (1 for a member itself, 0 when no member
 * ancestor exists) — the same hop semantic `installMemberDelegationGuard`
 * applies to subagent spawning, so the facade's `depth >= maxTeamDepth` guard
 * lands one fencepost stricter than the spawn budget (conservative).
 */
async function depthOfCaller(ctx: Context, caller: CallerIdentity): Promise<number> {
  if (caller.isHuman || caller.sessionId === undefined) return 0
  let agent: Agent | undefined = ctx.agents.get(caller.sessionId as SessionId)
  let depth = 0
  while (agent !== undefined) {
    depth += 1
    let isMember = false
    try {
      const descriptor = foldSubagentDescriptor(sessionOwnEvents(agent.session))
      isMember = descriptor?.label?.startsWith(MEMBER_LABEL_PREFIX) ?? false
    } catch {
      // Best-effort: unreadable session events count as non-member.
      isMember = false
    }
    if (isMember) return depth
    const parentId = agent.session.header.parentSession
    agent = parentId === undefined ? undefined : ctx.agents.get(parentId as SessionId)
  }
  return 0
}

/**
 * Builds the facade's caller resolver: persistent ledger member → dag
 * participant (captain or member) → human. The dag branch scans the caller's
 * own workspace state root (`agent.session.header.cwd ?? process.cwd()`),
 * mirroring the agent_teams_* tools' `workspaceOf` semantics, so a dag team is
 * found exactly when the tools' participant lookup would find it.
 */
function resolveCallerFor(
  ctx: Context,
  resolved: ToolsConfig,
): (exec: ToolRunContext) => Promise<CallerIdentity> {
  return async (exec: ToolRunContext): Promise<CallerIdentity> => {
    const agent = exec.agent
    if (agent === undefined) {
      throw new Error('sophia approval tools require a calling agent')
    }

    // Persistent ledger member: the agent-team host maps the live agent to its
    // durable member. Ledger teams have no dag teamId — the facade routes them
    // by member identity instead.
    const host = agent.ctx.get('agentTeam') as AgentTeamHostLike | undefined
    const member = host?.memberForAgent(agent)
    if (member !== undefined) {
      return { isHuman: false, sessionId: agent.id, handle: member.handle, teamId: undefined }
    }

    // DAG participant: captain or an active member of the caller's team.
    const stateRoot = join(agent.session.header.cwd ?? process.cwd(), resolved.stateDir)
    const team = await findTeamByParticipant(stateRoot, agent.id)
    if (team !== undefined) {
      let handle: string
      if (team.captainSessionId === agent.id) {
        handle = CAPTAIN_KEY
      } else {
        const memberEntry = team.members.find(entry => entry.id === agent.id && entry.status !== 'removed')
        // findTeamByParticipant already matched an active participant, so this
        // only misses on a concurrent removal; fall back to the session id as
        // a degenerate handle.
        handle = memberEntry?.name ?? agent.id
      }
      return { isHuman: false, sessionId: agent.id, handle, teamId: team.id }
    }

    return { isHuman: true, sessionId: agent.id }
  }
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
function createLazyPersistentBackend(
  ctx: Context,
  registry: WorkspaceRegistry | undefined,
  workingDirectory: string,
): TeamBackend {
  let backend: TeamBackend | undefined
  const resolveBackend = (): TeamBackend => {
    if (backend === undefined) {
      const host = ctx.get('agentTeam') as AgentTeamHostLike | undefined
      if (host === undefined) {
        throw new Error('sophia approval: persistent materialization requires the agent-team host service (ctx "agentTeam")')
      }
      // Bridge through the target deps shape; the parameter-type cast keeps
      // this compile-stable while the persistent-backend rework lands.
      const deps = createSophiaPersistentBackend as unknown as (input: { host: AgentTeamHostLike; workspaceId: string }) => TeamBackend
      backend = deps({ host, workspaceId: resolveWorkspaceId(registry, workingDirectory) })
    }
    return backend
  }
  return {
    mode: 'persistent',
    create: (facadeCtx, request) => resolveBackend().create(facadeCtx, request),
    describe: (facadeCtx, teamRef) => resolveBackend().describe(facadeCtx, teamRef),
    list: (facadeCtx) => resolveBackend().list(facadeCtx),
  }
}

function resolveWorkspaceId(registry: WorkspaceRegistry | undefined, workingDirectory: string): string {
  if (registry !== undefined) {
    const workspaces = registry.list()
    const byPath = workspaces.find(workspace => workspace.path === workingDirectory)
    const primary = byPath ?? workspaces[0]
    if (primary !== undefined) return primary.id
  }
  // No registry reachable; the host itself exposes no single stable workspace
  // id without a caller agent (memberForAgent needs one, and the backend's
  // create() receives the facade, not the caller) — fall back to a
  // deterministic namespace id.
  return DEFAULT_WORKSPACE_ID
}