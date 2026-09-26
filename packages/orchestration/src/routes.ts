/**
 * Approval HTTP surface (design §4.9, web-routes.ts:71 authenticated routes).
 *
 * P2/S3 expose the two read/write endpoints the cards and badge poll:
 *   GET  /plugins/dsh-sophia-entities/approvals          → queue snapshot
 *   POST /plugins/dsh-sophia-entities/approvals/plan     → set_mode / approve / reject / review
 *
 * Registration is a plain function so the host decides the exact raw server
 * wiring (mirroring the dag-team registerWebSurface pattern); P2 keeps the
 * handler shapes but the host attaches them with the cards in P3.
 */
import type { SophiaTeamFacade, CallerIdentity } from './facade.ts'

/** Approvals queue snapshot for the badge/cards. */
export interface ApprovalsSnapshot {
  requests: Array<{
    id: string
    goal: string
    requester: string
    mode?: string
    state: string
    createdAt: number
    expiresAt?: number
  }>
}

export interface ApprovalPlanAction {
  action: 'set_mode' | 'approve' | 'reject' | 'review'
  requestId: string
  /** set_mode / approve. */
  mode?: 'persistent' | 'dag'
  /** approve / reject / review. */
  decision?: 'approve_dag' | 'approve_persistent' | 'downgrade_to_dag' | 'reject' | 'approve' | 'reject'
  /** review. */
  reason?: string
}

/** Read the approval queue. */
export async function snapshotApprovals(facade: SophiaTeamFacade): Promise<ApprovalsSnapshot> {
  const requests = await facade.pendingApprovals()
  return {
    requests: requests.map((request) => ({
      id: request.id,
      goal: request.goal,
      requester: request.requester.kind === 'human'
        ? 'human'
        : (request.requester.handle ?? request.requester.memberId ?? 'member'),
      mode: request.mode,
      state: request.state,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    })),
  }
}

/** Dispatch one plan action with the caller identity resolved by the host. */
export async function runApprovalPlanAction(
  facade: SophiaTeamFacade,
  caller: CallerIdentity,
  action: ApprovalPlanAction,
): Promise<unknown> {
  switch (action.action) {
    case 'set_mode': {
      if (!action.mode) throw new Error('set_mode requires mode')
      const result = await facade.setMode(caller, action.requestId, action.mode)
      return { request_id: result.request.id, state: result.request.state, mode: result.request.mode }
    }
    case 'approve': {
      if (action.decision !== 'approve' && action.decision !== 'reject') {
        throw new Error('approve action requires decision approve|reject')
      }
      const result = await facade.approve(caller, action.requestId, {
        decision: action.decision,
        mode: action.mode,
      })
      return {
        request_id: result.request.id,
        state: result.request.state,
        mode: result.request.mode,
        materialized: result.materialized ? true : undefined,
        team_ref: result.materialized?.teamRef,
      }
    }
    case 'reject': {
      const result = await facade.approve(caller, action.requestId, { decision: 'reject' })
      return { request_id: result.request.id, state: result.request.state }
    }
    case 'review': {
      const verdicts = ['approve_dag', 'approve_persistent', 'downgrade_to_dag', 'reject'] as const
      if (action.decision === undefined || !verdicts.includes(action.decision as (typeof verdicts)[number])) {
        throw new Error('review action requires decision approve_dag|approve_persistent|downgrade_to_dag|reject')
      }
      const result = await facade.review(caller, action.requestId, {
        decision: action.decision as (typeof verdicts)[number],
        reason: action.reason ?? '',
      })
      return {
        request_id: result.request.id,
        state: result.request.state,
        materialized: result.materialized ? true : undefined,
        team_ref: result.materialized?.teamRef,
      }
    }
    default: {
      throw new Error(`unknown approval plan action: ${(action as { action: string }).action}`)
    }
  }
}