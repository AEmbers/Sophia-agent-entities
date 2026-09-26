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
import { ApprovalRouter, type NotifyEvent } from './router.ts'
import { approvalsRootOf } from './store.ts'
import type {
  ActivitySnapshot,
  ApprovalPlan,
  ApprovalRequest,
  CaptainVerdict,
  MaterializeResult,
  OrchestrationHost,
  OwnerVerdict,
  Requester,
  TeamBackend,
  TeamFilter,
  TeamMode,
  TeamSummary,
} from './types.ts'

export interface FacadeOptions {
  workspace: string
  host: OrchestrationHost & { workingDirectory: string }
  dagBackend?: TeamBackend
  persistentBackend?: TeamBackend
  notify?: (event: NotifyEvent) => Promise<void>
  now?: () => number
}

/** Who is calling, resolved from the execution context by the tools layer. */
export interface CallerIdentity {
  /** True for the Human host session. */
  isHuman: boolean
  /** Session id of the caller (member or captain). */
  sessionId?: string
  /** Durable member handle when the caller is a member. */
  handle?: string
  /** Current team id when the caller is a member of a team. */
  teamId?: string
}

export class SophiaTeamFacade {
  readonly router: ApprovalRouter
  private readonly dagBackend: TeamBackend | undefined
  private readonly persistentBackend: TeamBackend | undefined

  constructor(private readonly options: FacadeOptions) {
    const { workspace, host, notify, now } = options
    this.dagBackend = options.dagBackend
    this.persistentBackend = options.persistentBackend
    this.router = new ApprovalRouter(workspace, host as { workingDirectory: string }, { now, notify })
    this.router.setMaterializeHook((request, mode) => this.materialize(request, mode))
  }

  private get host(): OrchestrationHost {
    return this.options.host
  }

  private workspace(): string {
    return this.options.workspace
  }

  private requesterOf(caller: CallerIdentity): Requester {
    if (caller.isHuman) return { kind: 'human' }
    return {
      kind: 'member',
      memberId: caller.sessionId,
      handle: caller.handle,
      teamId: caller.teamId,
    }
  }

  // -- public API -----------------------------------------------------------

  /** File a proposal (any caller). */
  async propose(
    caller: CallerIdentity,
    input: { goal: string; plan?: ApprovalPlan; mode?: TeamMode },
  ): Promise<ReturnType<ApprovalRouter['propose']>> {
    if (!caller.isHuman) {
      const depth = await this.host.depthOf?.(caller) ?? 0
      if (depth >= this.host.maxTeamDepth) {
        throw new Error(
          `team depth limit reached (${depth} >= ${this.host.maxTeamDepth}): deeper teams are not allowed`,
        )
      }
    }
    return this.router.propose(this.requesterOf(caller), input)
  }

  /** Owner/Human picks the final backend mode before/while pending. */
  async setMode(
    caller: CallerIdentity,
    requestId: string,
    mode: TeamMode,
  ): Promise<ReturnType<ApprovalRouter['setMode']>> {
    if (!caller.isHuman) {
      // A member may set the mode on their own draft; anything pending the
      // owner is owner-only.
      const request = await this.router.get(requestId)
      const ownDraft = request && request.state === 'draft'
        && request.requester.kind === 'member'
        && request.requester.memberId === caller.sessionId
      if (!ownDraft) {
        throw new Error('only the Human owner may set the mode of a pending request')
      }
    }
    return this.router.setMode(requestId, mode)
  }

  /** Captain verdict (captain-only, §4.3.2). */
  async review(
    caller: CallerIdentity,
    requestId: string,
    verdict: Omit<CaptainVerdict, 'decidedBy' | 'decidedAt'>,
  ): Promise<ReturnType<ApprovalRouter['review']>> {
    if (caller.isHuman) {
      throw new Error('the Human owner cannot review member proposals — use approve')
    }
    const request = await this.requireRequest(requestId)
    const captain = request.requester.teamId
      ? await this.host.captainOf?.(request.requester.teamId)
      : undefined
    if (!captain || captain !== caller.sessionId) {
      throw new Error('only the team captain may review this proposal')
    }
    return this.router.review(requestId, {
      ...verdict,
      decidedBy: caller.sessionId as string,
      decidedAt: Date.now(),
    })
  }

  /** Owner approval (Human-only, §4.3.2). */
  async approve(
    caller: CallerIdentity,
    requestId: string,
    verdict: Omit<OwnerVerdict, 'decidedAt'>,
  ): Promise<ReturnType<ApprovalRouter['approve']>> {
    if (!caller.isHuman) {
      throw new Error('only the Human owner may approve a request')
    }
    return this.router.approve(requestId, {
      ...verdict,
      decidedAt: Date.now(),
    })
  }

  /**
   * THE single materialization dispatch point (§4.2). Publishes to the
   * backend matching the request's mode. Fails loudly when the backend is not
   * wired (host integration not yet attached).
   */
  async materialize(request: ApprovalRequest, mode: TeamMode): Promise<MaterializeResult> {
    const backend = mode === 'dag' ? this.dagBackend : this.persistentBackend
    if (!backend) {
      throw new Error(
        `materialization backend for '${mode}' is not wired — attach it in the host integration`,
      )
    }
    return backend.create(this, request)
  }

  /** Cross-backend team listing for the workspace. */
  async list(filter: TeamFilter = {}): Promise<TeamSummary[]> {
    const results: TeamSummary[] = []
    if (!filter.mode || filter.mode === 'dag') {
      results.push(...(await this.dagBackend?.list(this) ?? []))
    }
    if (!filter.mode || filter.mode === 'persistent') {
      results.push(...(await this.persistentBackend?.list(this) ?? []))
    }
    return results
  }

  /** Pending approval queue, newest first. */
  async pendingApprovals(): Promise<ApprovalRequest[]> {
    const all = await this.router.listAll()
    return all.filter((r) => r.state === 'pending_captain' || r.state === 'pending_owner' || r.state === 'draft')
  }

  /** Resolve one approval request. */
  get(requestId: string): Promise<ApprovalRequest | undefined> {
    return this.router.get(requestId)
  }

  /** Activity snapshots for a team ref (P4 expands). */
  async activity(ref: { mode: TeamMode; teamRef: string }): Promise<ActivitySnapshot> {
    const backend = ref.mode === 'dag' ? this.dagBackend : this.persistentBackend
    const summary = await backend?.describe(this, ref.teamRef)
    return {
      mode: ref.mode,
      teamRef: ref.teamRef,
      payload: summary ?? null,
    }
  }

  /**
   * Run the timeout sweep. Hosts call this from a timer; tests call it with a
   * fake clock. Returns the transitions that fired.
   */
  sweepExpired(): Promise<Awaited<ReturnType<ApprovalRouter['sweepExpired']>>> {
    return this.router.sweepExpired()
  }

  approvalsRoot(): string {
    return approvalsRootOf(this.workspace())
  }

  private async requireRequest(requestId: string): Promise<ApprovalRequest> {
    const request = await this.router.get(requestId)
    if (!request) throw new Error(`no approval request ${requestId}`)
    return request
  }
}