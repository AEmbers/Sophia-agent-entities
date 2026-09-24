/**
 * 上游 `team-membership.ts`（70 行）的索菲亚版 —— **频道成员关系的一次变更**。
 *
 * ## ⚠ 先说清楚：索菲亚当前**没有调用点**（这是有意的，不是漏接线）
 *
 * 上游这个 hook 服务的是**频道页的成员管理弹窗**（「加入频道 / 移出频道」）。
 * 索菲亚**没有「频道成员关系」这个事实**：`agent-team-types.ts` 的
 * `AgentTeamClientMember` 说明写着成员属于**团**、不属于频道，而
 * `slots.ts` 的 `TeamChannelView` 里那份 `members` 是「团级事实的频道视图」
 * （见 `adapters.toChannelTimeline` 的说明）。
 *
 * ⇒ 频道页的成员管理弹窗**整块剥掉**（`TeamChannelPage.tsx` 原位留了说明），
 * 因此本文件在当前构建里**没有消费者**。
 *
 * 仍然抄进来的理由（两个，都不是「顺手」）：
 * 1. 主人点名了这份依赖清单，而它是频道页的依赖之一 —— 一份**完整**的上游依赖
 *    比一份「我觉得用不上就删掉」的清单更可核对；
 * 2. 宿主一旦补上「频道成员关系」这条事实（`POST /api/sophia/channel/member`
 *    之类），接回它只需要在 `index.ts` 里提供一个 transport ——
 *    本文件与上游逐字同构，届时一行不用改。
 *
 * ## 索菲亚移植点（四处）
 *
 * | 上游 | 索菲亚 | 理由 |
 * |---|---|---|
 * | `mintRequestId()`（`./requests.ts`） | **剥掉** | 索菲亚宿主没有任何幂等键面（逐条理由见 `requests.ts` 文件头）⇒ 生成一个只会石沉大海的 id，还会让人以为「重试是幂等的」 |
 * | `workspaceId: WorkspaceId` | **剥掉** | 索菲亚没有 Workspace 维 |
 * | `AgentTeamJoinChannelRequest` 等 4 个上游类型 | `ChannelMembershipRequest`（本地最小形状） | 那 4 个类型描述的是索菲亚没有的请求/结果面（`agent-team-types.ts` 里不存在） |
 * | `RemoteResult<T>` | `TeamRemoteResult<T>` | 同 `team-dialog-save.ts` |
 *
 * 「一次一个稳定 requestId、失败后复用」这套**上游逻辑**在索菲亚失去了它的载体
 * （没有 requestId）⇒ 相应地剥掉 `requestIds` 那本账；`pending` / `errors`
 * 两张表与 `change()` 的并发判断**逐字保留**。
 *
 * @module @sophia/core/client/vendor/team/team-membership
 */

import { hooks } from '../../react-runtime.ts'
import type { AgentTeamChannelRef, AgentTeamMemberId } from './agent-team-types.ts'
import type { TeamRemoteResult } from './slots.ts'

/** One idempotent membership intent: `joined` rows leave, others join. */
export interface ChannelMembershipChange {
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
  readonly joined: boolean
}

/**
 * 一次成员关系变更的请求载荷。
 *
 * ⚠ 上游这里是 `AgentTeamJoinChannelRequest` / `AgentTeamRemoveChannelMemberRequest`
 * （各带 `requestId` + `workspaceId`）。索菲亚两个都没有 ⇒ 只剩真正描述
 * 「改谁的、在哪个频道、加还是删」的三个字段。
 */
export interface ChannelMembershipRequest {
  readonly channelRef: AgentTeamChannelRef
  readonly memberId: AgentTeamMemberId
}

export interface ChannelMembershipTransport {
  readonly joinChannel: (request: ChannelMembershipRequest) => Promise<TeamRemoteResult<unknown>>
  readonly removeChannelMember: (request: ChannelMembershipRequest) => Promise<TeamRemoteResult<unknown>>
}

/**
 * Shared Channel membership mutation. Rows observe pending flags and error text
 * keyed by `rowKeyOf`. **上游逻辑逐字保留**（`requestId` 那条已另行剥掉，见文件头）。
 */
export function useChannelMembership(
  transport: ChannelMembershipTransport,
  rowKeyOf: (change: ChannelMembershipChange) => string,
  onCommitted: (change: ChannelMembershipChange) => void | Promise<void>,
): {
  readonly pending: ReadonlySet<string>
  readonly errors: ReadonlyMap<string, string>
  readonly change: (change: ChannelMembershipChange) => Promise<void>
} {
  const { useState } = hooks()
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map())

  const change = async (membership: ChannelMembershipChange): Promise<void> => {
    const rowKey = rowKeyOf(membership)
    if (pending.has(rowKey)) return
    setPending(current => new Set(current).add(rowKey))
    setErrors(current => { const next = new Map(current); next.delete(rowKey); return next })
    const request: ChannelMembershipRequest = { channelRef: membership.channelRef, memberId: membership.memberId }
    try {
      const result = membership.joined ? await transport.removeChannelMember(request) : await transport.joinChannel(request)
      if (result.ok) {
        await onCommitted(membership)
      } else {
        setErrors(current => new Map(current).set(rowKey, result.error.message))
      }
    } catch (cause) {
      setErrors(current => new Map(current).set(rowKey, cause instanceof Error ? cause.message : String(cause)))
    } finally {
      setPending(current => { const next = new Set(current); next.delete(rowKey); return next })
    }
  }
  return { pending, errors, change }
}
