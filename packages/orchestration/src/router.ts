/**
 * Approval state machine (design §4.5).
 *
 * Pure transition + expiry logic over the approval store. Materialization is
 * delegated to an injected callback so the router stays backend-agnostic (the
 * facade supplies the real dispatch point). Timeouts use an injectable clock
 * (`now`) so tests can advance fake time without real timers.
 *
 * Timeout table (§4.5):
 *   pending_captain → (default 10min) escalated to pending_owner, timer reset
 *   pending_owner   → (default 24h) expired, archived, requester notified
 *   draft           → (default 30min) expired
 *
 * Transparency guards (§4.8, RK6): a captain cannot review their own proposal
 * (requester.memberId !== verdict.decidedBy); a downgrade verdict must carry a
 * reason; duplicate proposals are rejected by goal/plan hash.
 */
import { randomUUID } from 'node:crypto'
import {
  approvalsRootOf,
  goalDigest,
  listApprovals,
  readApproval,
  withLock,
  writeApproval,
} from './store.ts'
import type {
  ApprovalPlan,
  ApprovalRequest,
  ApprovalState,
  CaptainVerdict,
  MaterializeResult,
  OwnerVerdict,
  Requester,
  TeamMode,
} from './types.ts'

export const DEFAULT_TIMEOUTS = {
  pendingCaptainMs: 10 * 60 * 1000,
  pendingOwnerMs: 24 * 60 * 60 * 1000,
  draftMs: 30 * 60 * 1000,
} as const

export interface RouterTimeouts {
  pendingCaptainMs?: number
  pendingOwnerMs?: number
  draftMs?: number
}

/** Terminal states that stay on disk as the audit trail. */
export function isTerminalState(state: ApprovalState): boolean {
  return state === 'materialized'
    || state === 'rejected'
    || state === 'expired'
    || state === 'downgraded'
    || state === 'approved'
}

export interface NotifyEvent {
  /** Why this notification fired. */
  kind: 'owner_needed' | 'expired' | 'escalated'
  request: ApprovalRequest
}

export interface RouterOptions {
  now?: () => number
  timeouts?: RouterTimeouts
  /** Called after a decision that must reach the owner through out-of-band channels (P4 wires the real notifiers). */
  notify?: (event: NotifyEvent) => Promise<void>
}

export type MaterializeHook = (
  request: ApprovalRequest,
  mode: TeamMode,
) => Promise<MaterializeResult>

export interface ProposeInput {
  goal: string
  plan?: ApprovalPlan
  mode?: TeamMode
}

export interface TransitionResult {
  request: ApprovalRequest
  /** Present when this transition materialized a team (or encountered a materialize error holding the state). */
  materialized?: MaterializeResult
  /** True when duplicated an existing non-terminal proposal instead of creating a new one. */
  duplicate?: boolean
}

/** Stores a transition outcome that failed AFTER the record changed. */
export class MaterializeError extends Error {
  constructor(message: string, readonly request: ApprovalRequest) {
    super(message)
    this.name = 'MaterializeError'
  }
}

/** Narrow store surface used by the router (keeps the facade's store swappable in tests). */
interface ApprovalStore {
  approvalsRootOf(workspace: string): string
  listApprovals(root: string): Promise<ApprovalRequest[]>
  readApproval(root: string, requestId: string): Promise<ApprovalRequest | undefined>
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>
  writeApproval(root: string, request: ApprovalRequest): Promise<void>
}

export class ApprovalRouter {
  private readonly store: ApprovalStore
  private readonly getNow: () => number
  private readonly timeouts: Required<RouterTimeouts>
  private readonly notify: (event: NotifyEvent) => Promise<void>
  /** Dispatches to the correct backend; assigned by the facade. */
  private materializeHook: MaterializeHook | undefined

  constructor(
    private readonly workspace: string,
    private readonly host: { workingDirectory: string },
    options: RouterOptions = {},
  ) {
    this.store = { approvalsRootOf, listApprovals, readApproval, withLock, writeApproval }
    this.getNow = options.now ?? (() => Date.now())
    this.timeouts = {
      pendingCaptainMs: options.timeouts?.pendingCaptainMs ?? DEFAULT_TIMEOUTS.pendingCaptainMs,
      pendingOwnerMs: options.timeouts?.pendingOwnerMs ?? DEFAULT_TIMEOUTS.pendingOwnerMs,
      draftMs: options.timeouts?.draftMs ?? DEFAULT_TIMEOUTS.draftMs,
    }
    this.notify = options.notify ?? (async () => undefined)
  }

  /** Set the materialize hook (called once by the facade). */
  setMaterializeHook(hook: MaterializeHook): void {
    this.materializeHook = hook
  }

  private root(): string {
    return approvalsRootOf(this.workspace)
  }

  /**
   * File the goal/plan hashes from the plan so the same proposal is not filed
   * twice while a non-terminal request exists (§4.8 point 4).
   */
  private async findDuplicate(goal: string, plan: ApprovalPlan | undefined): Promise<ApprovalRequest | undefined> {
    if (!plan) return undefined
    const key = `${goal}\u0000${plan.members.length}:${plan.tasks.length}`
    const existing = await this.store.listApprovals(this.root())
    const digest = await goalDigest(goal)
    return existing.find(
      (r) => !isTerminalState(r.state) && r.goal === goal
        && goalDigest(r.goal) === digest
        && `${r.goal}\u0000${r.plan.members.length}:${r.plan.tasks.length}` === key,
    )
  }

  /**
   * Receive a proposal.
   *
   * - human requester → `pending_owner` (mode may still be picked on the card)
   * - member requester with explicit mode → `pending_captain`
   * - member requester without mode → `draft` until the mode is set
   */
  async propose(requester: Requester, input: ProposeInput): Promise<TransitionResult> {
    return this.store.withLock(`propose:${goalDigest(input.goal)}`, async () => {
      const duplicate = await this.findDuplicate(input.goal, input.plan)
      if (duplicate) return { request: duplicate, duplicate: true }

      const now = this.getNow()
      const plan = input.plan ?? { members: [], tasks: [] }
      const id = `${goalDigest(input.goal)}-${randomUUID().slice(0, 8)}`

      let state: ApprovalState
      let expiresAt: number | undefined
      if (requester.kind === 'human') {
        state = 'pending_owner'
        expiresAt = now + this.timeouts.pendingOwnerMs
      } else if (input.mode) {
        state = 'pending_captain'
        expiresAt = now + this.timeouts.pendingCaptainMs
      } else {
        state = 'draft'
        expiresAt = now + this.timeouts.draftMs
      }

      const request: ApprovalRequest = {
        id,
        requester,
        goal: input.goal,
        plan,
        mode: input.mode,
        state,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      }
      await this.store.writeApproval(this.root(), request)
      return { request }
    })
  }

  /** Switch the intended backend of a request whose mode is still open (draft or pending_owner). */
  async setMode(requestId: string, mode: TeamMode): Promise<TransitionResult> {
    return this.store.withLock(`request:${requestId}`, async () => {
      const request = await this.requireRequest(requestId)
      if (request.state !== 'draft' && request.state !== 'pending_owner') {
        throw new Error(`cannot change mode while ${request.state}`)
      }
      const updated: ApprovalRequest = { ...request, mode, updatedAt: this.getNow() }
      await this.store.writeApproval(this.root(), updated)
      return { request: updated }
    })
  }

  /** Captain review of a member proposal (approve_dag / approve_persistent / downgrade_to_dag / reject). */
  async review(requestId: string, verdict: CaptainVerdict): Promise<TransitionResult> {
    return this.store.withLock(`request:${requestId}`, async () => {
      const request = await this.requireRequest(requestId)
      if (request.state !== 'pending_captain') {
        throw new Error(`request ${requestId} is not awaiting captain review (${request.state})`)
      }
      if (request.requester.kind !== 'member') {
        throw new Error('only member proposals pass through captain review')
      }
      // Anti self-review (design §4.8 point 1 + RK6).
      if (verdict.decidedBy === request.requester.memberId) {
        throw new Error('a member cannot review their own proposal')
      }
      if (verdict.decision === 'downgrade_to_dag' && !verdict.reason.trim()) {
        throw new Error('a downgrade verdict requires a reason (design §4.8 point 2)')
      }

      const now = this.getNow()
      const base: ApprovalRequest = {
        ...request,
        captainVerdict: verdict,
        updatedAt: now,
      }

      switch (verdict.decision) {
        case 'approve_dag':
        case 'downgrade_to_dag': {
          // The verdict record carries the decision (incl. downgrade reason);
          // the materialized team is the terminal proof — state lands on
          // 'materialized' once the backend accepted it (§4.5).
          const target: ApprovalRequest = {
            ...base,
            mode: 'dag',
            state: 'pending_captain',
            expiresAt: undefined,
          }
          const result = await this.materializeOrHalt(target, 'dag', 'materialized')
          await this.store.writeApproval(this.root(), result.request)
          return { request: result.request, materialized: result.materialized }
        }
        case 'approve_persistent': {
          const escalated: ApprovalRequest = {
            ...base,
            mode: 'persistent',
            state: 'pending_owner',
            expiresAt: now + this.timeouts.pendingOwnerMs,
          }
          await this.store.writeApproval(this.root(), escalated)
          await this.notify({ kind: 'owner_needed', request: escalated })
          return { request: escalated }
        }
        case 'reject': {
          const rejected: ApprovalRequest = { ...base, state: 'rejected', expiresAt: undefined }
          await this.store.writeApproval(this.root(), rejected)
          return { request: rejected }
        }
      }
    })
  }

  /** Owner decision on a request awaiting the owner (approve with chosen mode, or reject). */
  async approve(requestId: string, verdict: OwnerVerdict): Promise<TransitionResult> {
    return this.store.withLock(`request:${requestId}`, async () => {
      const request = await this.requireRequest(requestId)
      if (request.state !== 'pending_owner' && request.state !== 'draft') {
        throw new Error(`request ${requestId} is not awaiting owner decision (${request.state})`)
      }

      if (verdict.decision === 'reject') {
        const rejected: ApprovalRequest = {
          ...request,
          ownerVerdict: verdict,
          state: 'rejected',
          expiresAt: undefined,
          updatedAt: this.getNow(),
        }
        await this.store.writeApproval(this.root(), rejected)
        return { request: rejected }
      }

      const mode = verdict.mode ?? request.mode
      if (!mode) {
        throw new Error('approving requires a mode — pick one on the request card first')
      }
      const approved: ApprovalRequest = {
        ...request,
        ownerVerdict: verdict,
        mode,
        state: 'approved',
        expiresAt: undefined,
        updatedAt: this.getNow(),
      }
      const result = await this.materializeOrHalt(approved, mode, 'materialized')
      await this.store.writeApproval(this.root(), result.request)
      return { request: result.request, materialized: result.materialized }
    })
  }

  /**
   * Apply the timeout table to every stored request. Returns the transitions
   * that happened. Safe to call repeatedly (idempotent per state).
   */
  async sweepExpired(): Promise<TransitionResult[]> {
    const now = this.getNow()
    const transitions: TransitionResult[] = []
    for (const request of await this.store.listApprovals(this.root())) {
      if (isTerminalState(request.state)) continue
      if (!request.expiresAt || request.expiresAt > now) continue

      const lockKey = `request:${request.id}`
      const outcome = await this.store.withLock(lockKey, async () => {
        const latest = await this.store.readApproval(this.root(), request.id)
        if (!latest || isTerminalState(latest.state)) return undefined
        if (latest.expiresAt && latest.expiresAt > this.getNow()) return undefined

        const next = this.expireTransition(latest, this.getNow())
        if (next) {
          await this.store.writeApproval(this.root(), next.request)
          if (next.kind === 'escalated') {
            await this.notify({ kind: 'escalated', request: next.request })
          } else if (next.kind === 'expired') {
            await this.notify({ kind: 'expired', request: next.request })
          }
        }
        return next
      })
      if (outcome) transitions.push(outcome)
    }
    return transitions
  }

  /** Pure expiry transition for one request (exposed for tests). */
  expireTransition(
    request: ApprovalRequest,
    now: number,
  ): { request: ApprovalRequest; kind: 'escalated' | 'expired' } | undefined {
    if (request.state === 'pending_captain') {
      return {
        kind: 'escalated',
        request: {
          ...request,
          state: 'pending_owner',
          expiresAt: now + this.timeouts.pendingOwnerMs,
          updatedAt: now,
        },
      }
    }
    if (request.state === 'pending_owner' || request.state === 'draft') {
      return {
        kind: 'expired',
        request: { ...request, state: 'expired', expiresAt: undefined, updatedAt: now },
      }
    }
    return undefined
  }

  async listAll(): Promise<ApprovalRequest[]> {
    return this.store.listApprovals(this.root())
  }

  async get(requestId: string): Promise<ApprovalRequest | undefined> {
    return this.store.readApproval(this.root(), requestId)
  }

  private async requireRequest(requestId: string): Promise<ApprovalRequest> {
    const request = await this.store.readApproval(this.root(), requestId)
    if (!request) throw new Error(`no approval request ${requestId}`)
    return request
  }

  /**
   * Attempt materialization; on backend failure the request stays in its
   * pre-materialization state so the decision is not burned by a transient
   * backend error (§4.2 "materialize 唯一分派点").
   */
  private async materializeOrHalt(
    request: ApprovalRequest,
    mode: TeamMode,
    successState: ApprovalState,
  ): Promise<{ request: ApprovalRequest; materialized?: MaterializeResult }> {
    if (!this.materializeHook) {
      throw new Error('orchestration facade not initialized — setMaterializeHook was not called')
    }
    try {
      const materialized = await this.materializeHook(request, mode)
      return { request: { ...request, state: successState }, materialized }
    } catch (error) {
      // Leave state untouched; surface the failure to the caller.
      throw new MaterializeError(
        `materialization failed: ${(error as Error).message}`,
        { ...request, updatedAt: this.getNow() },
      )
    }
  }
}