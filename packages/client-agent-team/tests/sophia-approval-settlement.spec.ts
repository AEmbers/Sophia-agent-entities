import { describe, expect, it } from 'vitest'
import {
  settlementLabelOf,
  settlementOf,
  type ApprovalSettlement,
} from '../src/client/dag/sophia-approval-settlement.ts'
import type { ApprovalLiveState } from '../src/client/dag/sophia-approval-requests.ts'

/** A live-queue answer that still carries the request. */
function queued(state: string, mode?: string): ApprovalLiveState {
  return mode === undefined ? { kind: 'state', state } : { kind: 'state', state, mode }
}

describe('settlementOf', () => {
  // Regression: [批准][退回] kept rendering after a decision because the card
  // only ever knew the state baked into the transcript, which stays pending_*
  // forever. The host's verdict for the click that just happened is what tells
  // the card to stand down.
  it('settles on the verdict the host returned', () => {
    expect(settlementOf('rejected', undefined)).toEqual({ state: 'rejected' })
    expect(settlementOf('approved', undefined)).toEqual({ state: 'approved' })
    expect(settlementOf('materialized', undefined)).toEqual({ state: 'materialized' })
    expect(settlementOf('expired', undefined)).toEqual({ state: 'expired' })
  })

  // Switching the team mode answers `pending_owner`: the request is still
  // awaiting a decision, so the controls must NOT step aside.
  it('does not settle on a state that is still pending', () => {
    expect(settlementOf('pending_owner', undefined)).toBeUndefined()
    expect(settlementOf('pending_captain', undefined)).toBeUndefined()
    expect(settlementOf('draft', undefined)).toBeUndefined()
  })

  it('settles on the live queue when no action was fired', () => {
    expect(settlementOf(undefined, 'absent')).toBe('gone')
    expect(settlementOf(undefined, queued('rejected'))).toEqual({ state: 'rejected' })
    expect(settlementOf(undefined, queued('pending_owner'))).toBeUndefined()
    expect(settlementOf(undefined, undefined)).toBeUndefined()
  })

  // The verdict answers the click that just happened, so it outranks a queue
  // read that may have been taken before it landed.
  it('lets the verdict outrank a stale queue read', () => {
    expect(settlementOf('pending_owner', 'absent')).toBeUndefined()
    expect(settlementOf('rejected', queued('pending_owner'))).toEqual({ state: 'rejected' })
  })
})

describe('settlementLabelOf', () => {
  it('names the states the host actually reports', () => {
    expect(settlementLabelOf('gone')).toEqual({ key: 'approval.settled.gone' })
    expect(settlementLabelOf({ state: 'approved' })).toEqual({ key: 'approval.settled.approved' })
    expect(settlementLabelOf({ state: 'rejected' })).toEqual({ key: 'approval.settled.rejected' })
    expect(settlementLabelOf({ state: 'materialized' })).toEqual({ key: 'approval.settled.materialized' })
  })

  it('falls back to the raw state for a state it has no wording for', () => {
    const settlement: ApprovalSettlement = { state: 'expired' }
    expect(settlementLabelOf(settlement)).toEqual({ key: 'approval.settled.other', state: 'expired' })
  })
})
