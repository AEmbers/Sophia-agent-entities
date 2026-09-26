/**
 * SophiaTeamFacade (design §4.2).
 *
 * The orchestration plane's public API: propose / setMode / review / approve /
 * materialize / list / activity. Materialize is the ONLY crossing point into a
 * backend — the facade resolves the request's mode and dispatches to the
 * matching TeamBackend (dag → DAG subagent teams, persistent → ledger-backed
 * Human/agent teams).
 *
 * Permissions (§4.3.2): `review` only for the team's captain; `approve` only
 * for the Human owner; `propose` open to everyone. Depth guard (§4.8):
 * members past `maxTeamDepth` levels may not propose new teams.
 */
import { ApprovalRouter } from "./router.js";
import { approvalsRootOf } from "./store.js";
export class SophiaTeamFacade {
    options;
    router;
    dagBackend;
    persistentBackend;
    constructor(options) {
        this.options = options;
        const { workspace, host, notify, now } = options;
        this.dagBackend = options.dagBackend;
        this.persistentBackend = options.persistentBackend;
        this.router = new ApprovalRouter(workspace, host, { now, notify });
        this.router.setMaterializeHook((request, mode) => this.materialize(request, mode));
    }
    get host() {
        return this.options.host;
    }
    workspace() {
        return this.options.workspace;
    }
    requesterOf(caller) {
        if (caller.isHuman)
            return { kind: 'human' };
        return {
            kind: 'member',
            memberId: caller.sessionId,
            handle: caller.handle,
            teamId: caller.teamId,
        };
    }
    // -- public API -----------------------------------------------------------
    /** File a proposal (any caller). */
    async propose(caller, input) {
        if (!caller.isHuman) {
            const depth = await this.host.depthOf?.(caller) ?? 0;
            if (depth >= this.host.maxTeamDepth) {
                throw new Error(`team depth limit reached (${depth} >= ${this.host.maxTeamDepth}): deeper teams are not allowed`);
            }
        }
        return this.router.propose(this.requesterOf(caller), input);
    }
    /** Owner/Human picks the final backend mode before/while pending. */
    async setMode(caller, requestId, mode) {
        if (!caller.isHuman) {
            // A member may set the mode on their own draft; anything pending the
            // owner is owner-only.
            const request = await this.router.get(requestId);
            const ownDraft = request && request.state === 'draft'
                && request.requester.kind === 'member'
                && request.requester.memberId === caller.sessionId;
            if (!ownDraft) {
                throw new Error('only the Human owner may set the mode of a pending request');
            }
        }
        return this.router.setMode(requestId, mode);
    }
    /** Captain verdict (captain-only, §4.3.2). */
    async review(caller, requestId, verdict) {
        if (caller.isHuman) {
            throw new Error('the Human owner cannot review member proposals — use approve');
        }
        const request = await this.requireRequest(requestId);
        const captain = request.requester.teamId
            ? await this.host.captainOf?.(request.requester.teamId)
            : undefined;
        if (!captain || captain !== caller.sessionId) {
            throw new Error('only the team captain may review this proposal');
        }
        return this.router.review(requestId, {
            ...verdict,
            decidedBy: caller.sessionId,
            decidedAt: Date.now(),
        });
    }
    /** Owner approval (Human-only, §4.3.2). */
    async approve(caller, requestId, verdict) {
        if (!caller.isHuman) {
            throw new Error('only the Human owner may approve a request');
        }
        return this.router.approve(requestId, {
            ...verdict,
            decidedAt: Date.now(),
        });
    }
    /**
     * THE single materialization dispatch point (§4.2). Publishes to the
     * backend matching the request's mode. Fails loudly when the backend is not
     * wired (host integration not yet attached).
     */
    async materialize(request, mode) {
        const backend = mode === 'dag' ? this.dagBackend : this.persistentBackend;
        if (!backend) {
            throw new Error(`materialization backend for '${mode}' is not wired — attach it in the host integration`);
        }
        return backend.create(this, request);
    }
    /** Cross-backend team listing for the workspace. */
    async list(filter = {}) {
        const results = [];
        if (!filter.mode || filter.mode === 'dag') {
            results.push(...(await this.dagBackend?.list(this) ?? []));
        }
        if (!filter.mode || filter.mode === 'persistent') {
            results.push(...(await this.persistentBackend?.list(this) ?? []));
        }
        return results;
    }
    /** Pending approval queue, newest first. */
    async pendingApprovals() {
        const all = await this.router.listAll();
        return all.filter((r) => r.state === 'pending_captain' || r.state === 'pending_owner' || r.state === 'draft');
    }
    /** Resolve one approval request. */
    get(requestId) {
        return this.router.get(requestId);
    }
    /** Activity snapshots for a team ref (P4 expands). */
    async activity(ref) {
        const backend = ref.mode === 'dag' ? this.dagBackend : this.persistentBackend;
        const summary = await backend?.describe(this, ref.teamRef);
        return {
            mode: ref.mode,
            teamRef: ref.teamRef,
            payload: summary ?? null,
        };
    }
    /**
     * Run the timeout sweep. Hosts call this from a timer; tests call it with a
     * fake clock. Returns the transitions that fired.
     */
    sweepExpired() {
        return this.router.sweepExpired();
    }
    approvalsRoot() {
        return approvalsRootOf(this.workspace());
    }
    async requireRequest(requestId) {
        const request = await this.router.get(requestId);
        if (!request)
            throw new Error(`no approval request ${requestId}`);
        return request;
    }
}
