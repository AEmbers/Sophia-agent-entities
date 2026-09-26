/**
 * Approval notifications (design §4.6).
 *
 * P2 ships the contract and a no-op composite; P4 wires the three channels
 * (AgentMail, Thread, badge). The composite runs every available channel in
 * parallel and never swallows a total failure silently — the caller surfaces
 * it to the est log and the card shows a red alert.
 */
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