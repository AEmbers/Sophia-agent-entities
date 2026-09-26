/**
 * P4.1 notification-channel tests (design §4.6):
 *   - parallel dispatch with per-channel isolation (one failure doesn't sink others)
 *   - three channels' availability gating (agentMail / thread / badge)
 *   - R8 notice body template (goal / members / tasks / dependency / expires / owner entry)
 *   - composite notifier runs all eligible channels and logs total failure
 */
import { describe, expect, it, vi } from 'vitest'
import type { NotifyEvent } from '../src/router.ts'
import type { ApprovalRequest, ApprovalPlan } from '../src/types.ts'
import {
  AgentMailNotifier,
  BadgeNotifier,
  ThreadNotifier,
  approvalNoticeBody,
  compositeNotifier,
  createApprovalChannels,
  dispatchApprovalNotifications,
  type NotifierHost,
} from '../src/notifier.ts'

const plan: ApprovalPlan = {
  members: [
    { name: 'alice' },
    { name: 'bob' },
    { name: 'carol' },
    { name: 'dave' },
    { name: 'eve' },
  ],
  tasks: [
    { id: 't1', subject: 'plan', assignee: 'alice', dependencies: [] },
    { id: 't2', subject: 'implement', assignee: 'bob', dependencies: ['t1', 't2b'] },
    { id: 't3', subject: 'review', assignee: 'carol', dependencies: [] },
  ],
}

const request: ApprovalRequest = {
  id: 'req-1',
  requester: { kind: 'member', memberId: 'm-1', handle: 'eve', teamId: 'team-1' },
  goal: 'Ship the approval plane',
  plan,
  mode: 'persistent',
  state: 'pending_owner',
  captainVerdict: { decision: 'approve_persistent', reason: 'solid', decidedAt: 1, decidedBy: 'c-1' },
  createdAt: 1,
  updatedAt: 1,
  expiresAt: 2_000_000_000_000,
}

// -- R8 template ------------------------------------------------------------

describe('approvalNoticeBody', () => {
  it('includes goal, member names (cap 3), dependency total, verdict reason, handle, expiry and owner entry', () => {
    const body = approvalNoticeBody(request)
    expect(body).toContain('Ship the approval plane')
    expect(body).toContain('alice, bob, carol')
    expect(body).toContain('3（含 2 条依赖）')
    expect(body).toContain('solid')
    expect(body).toContain('eve')
    expect(body).toContain('有效期至')
    expect(body).toContain('批准')
  })

  it('omits verdict/handle sections when absent', () => {
    const lean: ApprovalRequest = {
      ...request,
      requester: { kind: 'human' },
      captainVerdict: undefined,
      expiresAt: undefined,
    }
    const body = approvalNoticeBody(lean)
    expect(body).not.toContain('队长意见')
    expect(body).not.toContain('eve')
    expect(body).not.toContain('有效期至')
  })
})

// -- channel availability ---------------------------------------------------

describe('channel availability gating', () => {
  it('AgentMailNotifier is available only when the host mail adapter exists', () => {
    expect(new AgentMailNotifier({}).isAvailable()).toBe(false)
    expect(new AgentMailNotifier({ agentMail: async () => {} }).isAvailable()).toBe(true)
  })

  it('ThreadNotifier requires both the thread-to-human adapter and a channel id', () => {
    expect(new ThreadNotifier({}).isAvailable()).toBe(false)
    expect(new ThreadNotifier({ threadToHuman: async () => {}, channelId: () => 'c' }).isAvailable()).toBe(true)
    // threadToHuman without channelId → unavailable
    expect(new ThreadNotifier({ threadToHuman: async () => {} } as NotifierHost).isAvailable()).toBe(false)
  })

  it('BadgeNotifier is always available', () => {
    expect(new BadgeNotifier({}).isAvailable()).toBe(true)
  })
})

// -- dispatch isolation -----------------------------------------------------

describe('dispatchApprovalNotifications', () => {
  it('runs eligible channels in parallel and isolates failures', async () => {
    const ok = vi.fn(async () => {})
    const boom = vi.fn(async () => { throw new Error('mail down') })
    const channels = [
      new AgentMailNotifier({ agentMail: boom }),
      new BadgeNotifier({ badgeCount: ok }),
    ]
    const summary = await dispatchApprovalNotifications(undefined, request, channels)
    expect(ok).toHaveBeenCalledTimes(1)
    expect(boom).toHaveBeenCalledTimes(1)
    expect(summary.results).toHaveLength(2)
    expect(summary.totalFailure).toBe(false) // badge succeeded
  })

  it('filters ineligible channels before running', async () => {
    const mail = new AgentMailNotifier({}) // no mail adapter → ineligible
    const notify = vi.fn(async () => {})
    const channels = [mail, new BadgeNotifier({ badgeCount: notify })]
    const summary = await dispatchApprovalNotifications(undefined, request, channels)
    expect(notify).toHaveBeenCalledTimes(1)
    expect(summary.results).toHaveLength(1)
  })

  it('reports totalFailure only when every eligible channel fails', async () => {
    const boom = async () => { throw new Error('down') }
    const channels = [
      new AgentMailNotifier({ agentMail: boom as unknown as () => Promise<void> }),
    ]
    const summary = await dispatchApprovalNotifications(undefined, request, channels)
    expect(summary.totalFailure).toBe(true)
    expect(summary.results[0]?.ok).toBe(false)
    expect(summary.results[0]?.detail).toContain('down')
  })
})

// -- composite + badge count ------------------------------------------------

describe('compositeNotifier', () => {
  it('wires all three channels through createApprovalChannels and fires badge for pending_owner', async () => {
    const badgeCount = vi.fn(async () => {})
    const threadToHuman = vi.fn(async () => {})
    const host: NotifierHost = { threadToHuman, channelId: () => 'ch', badgeCount }
    const composite = compositeNotifier(createApprovalChannels(host), vi.fn())
    const event: NotifyEvent = { kind: 'owner_needed', request }
    await composite(event)
    // badge surfaced the pending-owner count; thread also ran (host provides the adapter)
    expect(badgeCount).toHaveBeenCalledWith(1)
    expect(threadToHuman).toHaveBeenCalled()
  })

  it('badge reports 0 for non-pending-owner states', async () => {
    const badgeCount = vi.fn(async () => {})
    const composite = compositeNotifier(createApprovalChannels({ badgeCount }), vi.fn())
    const draft = { kind: 'owner_needed' as const, request: { ...request, state: 'draft' } }
    await composite(draft)
    expect(badgeCount).toHaveBeenCalledWith(0)
  })

  it('logs a total failure instead of staying silent', async () => {
    const log = vi.fn()
    const composite = compositeNotifier(
      [new AgentMailNotifier({ agentMail: async () => { throw new Error('down') } })],
      log,
    )
    const event: NotifyEvent = { kind: 'expired', request }
    await composite(event)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('approval notice failed for req-1'))
  })
})