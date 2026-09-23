/**
 * 审批票据与人类收件箱（SPEC §5.1 / FR-5.3）。
 *
 * 本文件是**纯类型文件**：只有 `interface` / `type`，没有任何运行期取值。
 * 票据的**状态**不存在这里 —— 它只能由账本事件推导（见 `delegation.ts` 的 `readSpawnTicket`），
 * 这正是 FR-10.2「所有视图须为账本事实的投影，不得持有独立真相」在审批链上的落实。
 *
 * ## 与 SPEC §5.1 的一处必要修订（`PrincipalReviewer.memberId`）
 *
 * SPEC §5.1 声明的 `PrincipalReviewer` 只有 `reviewSpawn` 一个成员，**拿不到团长的 memberId**；
 * 而同一份 SPEC 的 AC-5-8 / AC-5-9 要求 `spawn/human-approved` 等事件的载荷里
 * `principalMemberId` **非空**。两者不可能同时成立（无限循环地需要另一个来源去解析团长身份）。
 * `DEVELOPMENT.md:219` 的草稿写的正是 `principal.memberId`，SPEC §2.2 的 `Principal`
 * 本身也带 `memberId`（`TeamBoundEntity`）。故这里补上 `readonly memberId: MemberId`，
 * 方向与既有文档一致，属于补全而非改口径。
 */

import type { MemberId, RequestId, SpawnTicketId } from './types/ids.ts'
import type { TeamKind, TeamSpec } from './types/team.ts'
import type { SpawnRequest } from './delegation.ts'

/**
 * 票据状态（SPEC §5.1）。
 *
 * ⚠ **`pending-principal` 在本实现里不可达**，且这是有意的：
 * 本包的票据是**账本事实**的投影，而第一级预审尚未出结论时**没有任何事实**
 * （`reviewSpawn` 的 promise 还在飞）。把「已提交、待预审」也记成事件，就得先发明一个
 * SPEC §6.1 事件表里不存在的 kind；不发明，就没有可投影的状态。
 * ⇒ 票据的存在自「第一级结论」那一刻开始（`readSpawnTicket` 亦然）。
 * 保留该取值是因为它是契约词汇，且将来若真为「申请已受理」补一条事件，它立刻可用。
 *
 * ⚠ **`rejected-principal` 曾一度也不可达**（因 §6.1 的 `spawn/principal-rejected` 载荷缺 `spec`，
 * 而本接口的 `spec` 是必填 —— 两者不可能同时成立）。captain 裁定 Q-E（SPEC §11）确认那是
 * **契约漏写**并扩展了载荷（补 `targetKind` + `spec`），本状态因此**已可达**。
 * 这条历史值得留在这里：它说明「某个状态没人实现」有两种可能 ——
 * 一是设计上不需要，二是**契约自身矛盾**；只有查清是哪一种才能决定该不该补实现。
 */
export type SpawnTicketStatus =
  /** 等待第一级（本实现的票据尚无对应账本事件，见上方说明）。 */
  | 'pending-principal'
  /** 第一级已过，等待第二级（人类收件箱中）。 */
  | 'pending-human'
  /** 第一级被团长否决（Q-E 扩载荷后本状态可达）。 */
  | 'rejected-principal'
  /** 第二级人类批准。 */
  | 'approved'
  /** 第二级人类否决。 */
  | 'rejected-human'

/**
 * 一张派生审批票据（SPEC §5.1）。
 *
 * **不是可变对象**：它由 `readSpawnTicket()` 从账本事件推导而来，每次调用得到的是
 * 「此刻的事实投影」。因此没有 `setStatus()` 之类的方法 —— 状态变迁的唯一入口是
 * 「落一条新事件」。
 */
export interface SpawnTicket {
  readonly ticketId: SpawnTicketId
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  /** 发起方所属团的团长（监正）。 */
  readonly principalMemberId: MemberId
  readonly targetKind: TeamKind
  readonly spec: TeamSpec
  readonly status: SpawnTicketStatus
  /**
   * 票据**出现的第一条账本事件的序号**。
   *
   * 本实现里它等于第一级结论事件的序号（原因见 `SpawnTicketStatus` 的说明）——
   * 与 SPEC §5.1 中「raised（提交）」在语义上略有收紧，但它是**可从账本重建**的唯一定义；
   * 若照「提交时刻」定义，本字段就只能来自账本之外的某处，那与 FR-10.2 冲突。
   */
  readonly raisedAtSequence: number
  /** 第一级结论事件的序号。 */
  readonly principalDecidedAtSequence?: number | undefined
  /** 第二级结论事件的序号；未决时缺省。 */
  readonly humanDecidedAtSequence?: number | undefined
  /** 否决理由（第一级或第二级）；未否决或缺省时无。 */
  readonly reason?: string | undefined
}

/** 第一级结论（SPEC §5.1）。 */
export interface PrincipalVerdict {
  readonly approved: boolean
  /** 否决时必填；批准时可为空。 */
  readonly reason?: string | undefined
}

/**
 * 第一级：团长预审（FR-5.3.1）。
 *
 * 目的：避免人类被大量申请淹没，同时让「架构老大」对技术决策负责。
 */
export interface PrincipalReviewer {
  /**
   * 该团长的成员 ID（SPEC §5.1 的必要修订，见本文件头）。
   *
   * 它必须落进 `spawn/*` 事件的 `principalMemberId`（AC-5-8 / AC-5-9 要求非空）——
   * 团长是**团内成员**（FR-5.0.2），所以这个身份本身就是 `MemberId`，不需要另造一套标识。
   */
  readonly memberId: MemberId
  reviewSpawn(request: SpawnRequest): Promise<PrincipalVerdict>
}

/**
 * 第二级通道：人类收件箱（FR-5.3.2）。
 *
 * 沿 `dsh-agent-team` 已有的 Human Inbox 机制，使「任意窗口都能看到待办」（FR-5.0.3）。
 */
export interface HumanInbox {
  push(item: HumanInboxItem): Promise<void>
  list(): Promise<readonly HumanInboxItem[]>
}

/** 收件箱里的一条待办（FR-5.3.2）。 */
export interface HumanInboxItem {
  readonly ticketId: SpawnTicketId
  readonly title: string
  /** 待办动作：批准 / 否决，闭集（AC-5-7 逐字断言）。 */
  readonly actions: readonly ['approve', 'reject']
}
