import { describe, expect, it, vi } from 'vitest'
import {
  aggregateApprovalSnapshot,
  startApprovalBadgePolling,
  APPROVAL_BADGE_STATES,
  type SophiaApprovalAggregate,
} from '../src/client/dag/sophia-approval-badge.ts'

function thread(): { schedule: (callback: () => void, intervalMs?: number) => unknown; cancel: (timer: unknown) => void; tasks: Array<() => void> } {
  const tasks: Array<() => void> = []
  const schedule = vi.fn((callback: () => void) => { tasks.push(callback); return tasks.length - 1 })
  const cancel = vi.fn()
  return { schedule, cancel, tasks }
}

describe('aggregateApprovalSnapshot', () => {
  const row = (state: string): object => ({
    id: 'req-1', goal: 'Ship', requester: 'member', mode: 'persistent', state, createdAt: 1, expiresAt: undefined,
  })

  it('counts only pending_owner and pending_captain requests', () => {
    expect(aggregateApprovalSnapshot({ requests: [row('pending_owner'), row('pending_captain'), row('draft'), row('approved')] }))
      .toEqual({ count: 2, states: ['pending_captain', 'pending_owner'] })
  })

  it('treats a missing or malformed body as an empty queue', () => {
    expect(aggregateApprovalSnapshot(null)).toEqual({ count: 0, states: [] })
    expect(aggregateApprovalSnapshot(undefined)).toEqual({ count: 0, states: [] })
    expect(aggregateApprovalSnapshot({})).toEqual({ count: 0, states: [] })
    expect(aggregateApprovalSnapshot({ requests: 'nope' })).toEqual({ count: 0, states: [] })
    expect(aggregateApprovalSnapshot({ requests: [42] })).toEqual({ count: 0, states: [] })
  })

  it('is empty for a fully settled queue', () => {
    expect(aggregateApprovalSnapshot({ requests: [row('approved'), row('rejected')] }))
      .toEqual({ count: 0, states: [] })
  })

  it('exposes the states that drive the copy', () => {
    expect(APPROVAL_BADGE_STATES.has('pending_owner')).toBe(true)
    expect(APPROVAL_BADGE_STATES.has('pending_captain')).toBe(true)
    expect(APPROVAL_BADGE_STATES.has('draft')).toBe(false)
  })
})

describe('startApprovalBadgePolling', () => {

  it('publishes the aggregate on the first tick and keeps the last on failure', async () => {
    const seen: SophiaApprovalAggregate[] = []
    let fail = false
    const fetchState = async () => {
      if (fail) return { ok: false, json: async () => ({}) } as Response
      return { ok: true, json: async () => ({ requests: [{ id: 'a', state: 'pending_owner', goal: 'x', requester: 'm', createdAt: 1 }] }) } as Response
    }
    const controller = startApprovalBadgePolling((next) => { seen.push(next) }, {
      fetchState,
      schedule: () => 1,
      cancel: () => {},
    })
    await controller.firstTick
    expect(seen).toEqual([{ count: 1, states: ['pending_owner'] }])
    // A failed fetch must NOT clear the previously published aggregate.
    fail = true
    await controller.firstTick
    expect(seen.length).toBe(1)
    expect(seen[seen.length - 1]).toEqual({ count: 1, states: ['pending_owner'] })
    await controller.stop()
  })

  it('stops scheduling and aborts in-flight after stop', async () => {
    const { schedule, cancel, tasks } = thread()
    const controller = startApprovalBadgePolling(() => {}, {
      fetchState: async () => ({ ok: true, json: async () => ({ requests: [] }) }) as Response,
      schedule, cancel,
    })
    expect(schedule).toHaveBeenCalled()
    await controller.stop()
    expect(controller.isCancelled()).toBe(true)
    expect(cancel).toHaveBeenCalled()
    // The registered timer callback becomes inert after cancellation.
    tasks.forEach((task) => task())
    expect(controller.isCancelled()).toBe(true)
  })

  it('is inert when the schedule is never allowed to tick and stop is idempotent', async () => {
    const controller = startApprovalBadgePolling(() => {}, {
      fetchState: async () => ({ ok: true, json: async () => ({ requests: [] }) }) as Response,
      schedule: () => 0,
      cancel: () => {},
    })
    await controller.firstTick
    await controller.stop()
    await controller.stop()
    expect(controller.isCancelled()).toBe(true)
  })
})