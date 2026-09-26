/**
 * Approval notifications (design §4.6).
 *
 * P2 ships the contract and a no-op composite; P4 wires the three channels
 * (AgentMail, Thread, badge). The composite runs every available channel in
 * parallel and never swallows a total failure silently — the caller surfaces
 * it to the est log and the card shows a red alert.
 */
import type { NotifyEvent } from './router.ts'
import type { ApprovalRequest } from './types.ts'

/** One out-of-band notification channel. */
export interface ApprovalNotifier {
  readonly id: string
  /** Whether this channel can fire right now (its service is present). */
  isAvailable(ctx: unknown): boolean
  /** Deliver one notification; throwing is allowed and treated as channel failure. */
  notify(ctx: unknown, request: ApprovalRequest): Promise<NotifyResult>
}

export interface NotifyResult {
  channel: string
  ok: boolean
  detail?: string
}

export interface NotifySummary {
  results: NotifyResult[]
  /** True when EVERY eligible channel failed. */
  totalFailure: boolean
}

/** Run all eligible channels in parallel; each failure is isolated. */
export async function dispatchApprovalNotifications(
  ctx: unknown,
  request: ApprovalRequest,
  channels: readonly ApprovalNotifier[],
): Promise<NotifySummary> {
  const results = await Promise.all(
    channels
      .filter((channel) => channel.isAvailable(ctx))
      .map(async (channel): Promise<NotifyResult> => {
        try {
          await channel.notify(ctx, request)
          return { channel: channel.id, ok: true }
        } catch (error) {
          return { channel: channel.id, ok: false, detail: (error as Error).message }
        }
      }),
  )
  return {
    results,
    totalFailure: results.length > 0 && results.every((result) => !result.ok),
  }
}

/**
 * Host adapters the three concrete channels need. The orchestration package is
 * dependency-free (no cordis / agent-team / tools imports), so the HOST glue
 * (packages/dag-team/src/sophia-approval.ts) supplies these closures from the
 * live application `Context`. Channels just call them.
 */
export interface NotifierHost {
  /** Send a human-targeted out-of-band email via the agent-mail tool, if present. */
  agentMail?: (subject: string, body: string) => Promise<void>
  /** Post a Thread (with @human) on a ledger channel. */
  threadToHuman?: (channelId: string, body: string) => Promise<void>
  /** Existing ledger channel to notify into (resolved by the glue). */
  channelId?: () => string
  /** Surface the pending-owner count (badge channel). */
  badgeCount?: (count: number) => Promise<void>
}

/** Shared mail/thread body builder (R8 template, dev-plan §4.6). */
export function approvalNoticeBody(request: ApprovalRequest): string {
  const lines = [
    `目标：${request.goal}`,
    `成员：${request.plan.members.length}（${request.plan.members.map((m) => m.name).slice(0, 3).join(', ')}）`,
    `任务：${request.plan.tasks.length}（含 ${request.plan.tasks.reduce((sum, t) => sum + t.dependencies.length, 0)} 条依赖）`,
  ]
  if (request.captainVerdict?.reason) lines.push(`队长意见：${request.captainVerdict.reason}`)
  if (request.requester.kind === 'member' && request.requester.handle) {
    lines.push(`发起者：@${request.requester.handle}`)
  }
  if (request.expiresAt !== undefined) {
    lines.push(`有效期至：${new Date(request.expiresAt).toLocaleString()}`)
  }
  lines.push('批准 / 退回：在审批卡片或计划面板中操作。')
  return lines.join('\n')
}

/** Primary channel: human email via the host agent-mail tool (§9 O1). */
export class AgentMailNotifier implements ApprovalNotifier {
  readonly id = 'agent-mail'
  constructor(private readonly host: NotifierHost) {}
  isAvailable(): boolean {
    return typeof this.host.agentMail === 'function'
  }
  async notify(ctx: unknown, request: ApprovalRequest): Promise<NotifyResult> {
    if (!this.host.agentMail) throw new Error('agent-mail host adapter unavailable')
    const subject = `[dsh-sophia-entities] 待批准：持久化团队请求 #${request.id}`
    await this.host.agentMail(subject, approvalNoticeBody(request))
    return { channel: this.id, ok: true }
  }
}

/** Fallback 1: ledger Thread + @human on a channel. */
export class ThreadNotifier implements ApprovalNotifier {
  readonly id = 'thread'
  constructor(private readonly host: NotifierHost) {}
  isAvailable(): boolean {
    return typeof this.host.threadToHuman === 'function' && typeof this.host.channelId === 'function'
  }
  async notify(ctx: unknown, request: ApprovalRequest): Promise<NotifyResult> {
    if (!this.host.threadToHuman || !this.host.channelId) {
      throw new Error('thread host adapter unavailable')
    }
    await this.host.threadToHuman(this.host.channelId(), approvalNoticeBody(request))
    return { channel: this.id, ok: true }
  }
}

/** Fallback 2: pure-client badge; host just surfaces the pending count. */
export class BadgeNotifier implements ApprovalNotifier {
  readonly id = 'badge'
  constructor(private readonly host: NotifierHost) {}
  isAvailable(): boolean {
    return true
  }
  async notify(_ctx: unknown, request: ApprovalRequest): Promise<NotifyResult> {
    const count = request.state === 'pending_owner' ? 1 : 0
    await this.host.badgeCount?.(count)
    return { channel: this.id, ok: true }
  }
}

/** Build the standard three-channel set in priority order. */
export function createApprovalChannels(host: NotifierHost): readonly ApprovalNotifier[] {
  return [
    new AgentMailNotifier(host),
    new ThreadNotifier(host),
    new BadgeNotifier(host),
  ]
}

/**
 * Composite backer for `FacadeOptions.notify`. Runs every eligible channel in
 * parallel for a NotifyEvent; a total failure is logged through the injected
 * logger (never silent §4.6).
 */
export function compositeNotifier(
  channels: readonly ApprovalNotifier[],
  log?: (message: string) => void,
): (event: NotifyEvent) => Promise<void> {
  return async (event) => {
    const summary = await dispatchApprovalNotifications(undefined, event.request, channels)
    if (summary.totalFailure) {
      const detail = summary.results.map((r) => `${r.channel}: ${r.detail ?? 'failed'}`).join('; ')
      log?.(`[dsh-sophia-entities] approval notice failed for ${event.request.id} (${event.kind}): ${detail}`)
    }
  }
}