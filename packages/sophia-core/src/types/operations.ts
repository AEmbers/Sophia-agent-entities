/**
 * 账本事件类型（SPEC §6.1 / FR-10.1）。
 *
 * 所有协作事实（频道、成员、任务、消息、核准、换模、归属移交、生命周期）只追加写入账本，
 * 前端视图一律是账本事实的投影、不得持有独立真相（FR-10.2）。
 *
 * ## 本文件的两条设计纪律
 *
 * 1. **事件是「已发生的事实」，不是「意图」** —— 因此 kind 全用过去式
 *    （`member-added` / `human-approved` / `ownership-reattached`）。
 * 2. **`data` 的形状按 kind 收窄**，由 `LedgerEventMap` 提供映射；
 *    `LedgerEventOf<K>` 让 `switch (event.kind)` 之后载荷自动是正确类型，
 *    无需手写类型断言（这也是「判别联合」在本包的主要收益）。
 */

import type {
  ChannelId,
  DagTeamId,
  EventId,
  HostSessionId,
  MemberId,
  PlanId,
  RequestId,
  TeamId,
  ThreadId,
} from './ids.ts'
// ⚠ 这里**刻意不 import `SpawnTicketId`**（OCR 曾把它报为「未引用的死 import」，
// 复核结论是：它对本文件确实**无契约职责**，故删除；但删之前已确认它**不是悬空类型**）。
//
// 判定依据（实测，供后人复核，勿凭直觉加回）：
// 1. `SpawnTicketId` 在包内是**活的**，只是活在别的层 —— 实测出现次数
//    delegation.ts 22 / delegation.spec.ts 7 / approval.ts 3 / ledger.ts 3 / ids.ts 2（定义）；
//    仅在 operations.ts 里出现 1 次（就是那行 import）。故它不构成「类型层悬空」。
// 2. SPEC §6.1 的「kind → 必须含的载荷字段」表（`docs/SPEC-sophia-core.md` 行 886–898）
//    对 `ticketId` 的命中数为 **0** —— 契约**从不**要求任何账本载荷携带票号，
//    所有 `spawn/*` 载荷一律用 `requestId`。
// 3. SPEC 里 `SpawnTicketId` 的 8 处出现全在**审批/派生/scope 层**（§2.1 定义、§4.2 `SpawnOutcome`、
//    §5.1 `SpawnTicket` / `HumanInboxItem`、§5.2 `decideSpawnTicket` 入参、§6.3 `ChangeScope`），
//    **没有一处在 §6 的载荷定义里**。
// ⇒ 若为「消灭死 import」而在此给它造一个字段，等于**发明契约**（改动 LedgerEventMap 的形状
//    并要求账本真的记录它），反向破坏了「operations.ts 逐字落地 §6.1 表」的纪律。
//    票号由 `delegation.ts` 的 `spawnTicketIdOf(requestId)` 确定性派生，不需要被记录。
import type { MemberIdentity } from './member.ts'
import type { RunMode, StagingDualPlan } from './staging.ts'
import type { DagTaskState, MemberLifecycle, TeamKind, TeamSpec } from './team.ts'

/** 1 起的连续序号，无空洞（AC-10-8 校验其连续性）。 */
export type LedgerSequence = number

/**
 * 事件的操作者。注意是**三类**而非四类：
 * 没有 `principal` / `member` 的区分 —— 团长的操作在账本里就是一个成员的操作，
 * 「他是团长」由其所处的团与角色推导，不是事件自带的属性。
 */
export type LedgerActor =
  | { readonly kind: 'human'; readonly humanId: string }
  | { readonly kind: 'host'; readonly hostSessionId: HostSessionId }
  | { readonly kind: 'member'; readonly memberId: MemberId }

/** 所有事件的公共基座。 */
export interface LedgerEventBase {
  readonly eventId: EventId
  readonly sequence: LedgerSequence
  readonly occurredAt: number
  readonly actor: LedgerActor
  /** 链式完整性：首条为 `null`，其后等于前一条的 `eventId`（AC-10-9）。 */
  readonly previousEventId: EventId | null
  /** 幂等键（可选）。FR-5.3.4 的「不得绕开」正是按 `requestId` 绑定。 */
  readonly requestId?: RequestId | undefined
}

/**
 * 人类对派生票据的结论（FR-5.3.3）。
 *
 * 它是**结论的词汇表**（`decideSpawnTicket` 的入参即取这两个值，见 SPEC §5.2），
 * 但**不作为账本载荷的字段类型** —— 载荷各自的 `decision` 被钉成单一个字面量，
 * 理由见 `SpawnDecisionSubject`。
 */
export type SpawnDecision = 'approve' | 'reject'

/**
 * `spawn/human-approved` 与 `spawn/human-rejected` 的**公共字段**（不含结论）。
 *
 * 关于「为什么把结论从公共基座里拿出去」（这是本文件最容易改错的一处，勿再合并回去）：
 *
 * OCR 评审曾指出「拒绝分支把 `decision` 收窄成 `'reject'`，而基类型仍是宽 `SpawnDecision`，
 * 所以批准事件可以合法携带 `decision: 'reject'`」—— 该发现成立。但**修法不能是把基座的
 * `decision` 直接收窄为 `'approve'`**：那样 `SpawnHumanRejectionData extends` 它会立刻
 * 因 `'reject'` 与 `'approve'` 不兼容而报 TS2430（接口不能把父接口的字段改成不相容类型）。
 *
 * ⇒ 正确结构是把「结论」从公共基座中**彻底移除**，让两个子接口各自钉死自己的字面量。
 * 这样「approved 只能带 approve、rejected 只能带 reject」成为**结构性保证**，
 * 而不是靠一处手工收窄去堵另一处的漏洞。
 *
 * 注意 `humanOperatorId` / `targetKind` / `spec` 等**共享字段仍在此处**：
 * 它们对两种结论都成立，抽出来是为了避免两个子接口各写一份而漂移。
 */
export interface SpawnDecisionSubject {
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  readonly principalMemberId: MemberId
  /** 人类操作者的**已解析标识**（非空，AC-5-9）。 */
  readonly humanOperatorId: string
  readonly targetKind: TeamKind
  readonly spec: TeamSpec
}

/**
 * `spawn/human-approved` 的载荷（FR-5.3.3）。
 *
 * FR-5.3.3 明列必须落账的六项：申请成员、目标团规格、两级审批人、时间、结论。
 * 其中「时间」由基座的 `occurredAt` 承载（不重复进 `data`），其余五项在此。
 *
 * `decision` 是字面量 `'approve'`：本事件 kind 自身已表明结论，载荷不得反驳判别键
 * （AC 断言见 `tests/types.spec.ts` 的「kind 是判别键」用例）。
 */
export interface SpawnDecisionData extends SpawnDecisionSubject {
  /** 结论。**恒为 `'approve'`** —— 见 `SpawnDecisionSubject` 的说明。 */
  readonly decision: 'approve'
}

/**
 * `spawn/human-rejected` 的载荷（FR-5.3.3：同 approved，另加 `reason`）。
 *
 * `decision` 是字面量 `'reject'`，与 `SpawnDecisionData` 对称 ——
 * 两个载荷各自钉死结论，任一方向都无法构造出自相矛盾的事件。
 */
export interface SpawnHumanRejectionData extends SpawnDecisionSubject {
  /** 结论。**恒为 `'reject'`**。 */
  readonly decision: 'reject'
  readonly reason: string
}

/**
 * `spawn/principal-rejected` 的载荷（FR-5.3.1）。
 *
 * **载荷与第二级对称**（captain 裁定 Q-E，SPEC §11）：两级审批在流程上是对称的 ——
 * 同一次申请、同一份规格，只是审核人不同。因此本载荷必须携带 `targetKind` 与 `spec`；
 * 早期版本缺这两个字段是**漏写**（第二级的 `human-approved` / `human-rejected` 两者都带），
 * 后果是「只被第一级否决的申请」投影不出 §5.1 要求的 `SpawnTicket`（其 `spec` 为必填）。
 *
 * 用 `Pick` 从 `SpawnAwaitingHumanData` 派生而不是重写一份：三者的前五个字段
 * **逐字相同**（REQUEST-IDENTITY + targetKind + spec），各写一份迟早会漂移。
 * 注意**不**继承 `SpawnDecisionSubject` —— 那个基底带 `humanOperatorId`，
 * 而第一级否决时**根本没有人类参与**（FR-5.3.1 的否决发生在推送收件箱之前）。
 */
export type SpawnPrincipalRejectionData = Pick<
  SpawnAwaitingHumanData,
  'requestId' | 'requesterMemberId' | 'principalMemberId' | 'targetKind' | 'spec'
> & {
  readonly reason: string
}

/** `spawn/awaiting-human-approval` 的载荷（FR-5.3.2）。 */
export interface SpawnAwaitingHumanData {
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  readonly principalMemberId: MemberId
  readonly targetKind: TeamKind
  readonly spec: TeamSpec
}

/** `team/ownership-reattached` 的载荷（FR-5.6.3）。 */
export interface TeamOwnershipReattachedData {
  readonly teamId: TeamId
  readonly from: MemberId
  readonly to: MemberId
  readonly reason: string
}

/** `dag/ownership-transferred` 的载荷（FR-7.4）。 */
export interface DagOwnershipTransferredData {
  readonly dagTeamId: DagTeamId
  readonly from: MemberId
  readonly to: MemberId
}

/** `team/member-added` 的载荷（FR-5A）。 */
export interface MemberAddedData {
  readonly teamId: TeamId
  /** 三层标识整体携带（`position` / `name` / `memberId`）。 */
  readonly member: MemberIdentity
  /** 初始生命周期状态。 */
  readonly lifecycle: MemberLifecycle
}

/** `plan/approved` 的载荷（FR-2.3：操作者、时间、planId、选中模式）。 */
export interface PlanApprovedData {
  readonly planId: PlanId
  readonly mode: RunMode
  /**
   * 核准动作的操作者（FR-2.3 明列的字段，由 SPEC §6.1 的表格钉死）。
   *
   * ⚠ 它与基座的 `actor` **不是**重复字段，两者回答不同问题：
   * - `actor`（基座）＝「谁提交了这条账本事件」，是账本的通用审计维度（人 / 宿主 / 成员）；
   * - `operator`（此处）＝「谁做的核准决定」，是 FR-2.3 要求的业务语义。
   * 正常情况下两者指向同一主体，但**不强制相等**：事件可能由一个宿主会话代呈
   * （`actor = host`），而核准决定的人类身份记在 `operator`。故保留双字段。
   */
  readonly operator: string
  /** 草案全文（可选，便于从账本重建核准时的现场）。 */
  readonly plan?: StagingDualPlan | undefined
}

/** `team/initialized` 的载荷：窗口代孕创建团壳（FR-5.0.4）。 */
export interface TeamInitializedData {
  readonly teamId: TeamId
  readonly kind: TeamKind
  /** 创建团壳的窗口；创建后即与团解耦，**不是**锚点。 */
  readonly createdByHostSessionId: HostSessionId | null
}

/** `team/created` 的载荷：团正式成立（免审直建或审批通过后）。 */
export interface TeamCreatedData {
  readonly teamId: TeamId
  readonly kind: TeamKind
  readonly ownerMemberId: MemberId | null
  readonly parentTeamId: TeamId | null
  readonly name: string
}

/** `team/member-renamed` 的载荷（FR-8.2）。 */
export interface MemberRenamedData {
  readonly teamId: TeamId
  readonly memberId: MemberId
  readonly from: string
  readonly to: string
}

/** 成员生命周期变更（suspend / resume / destroy）的载荷。 */
export interface MemberLifecycleChangedData {
  readonly teamId: TeamId
  readonly memberId: MemberId
  readonly from: MemberLifecycle
  readonly to: MemberLifecycle
  readonly reason?: string | undefined
}

/** `team/member-model-switched` 的载荷（FR-6.4：成员、旧模型、新模型、触发原因、触发者）。 */
export interface MemberModelSwitchedData {
  readonly teamId: TeamId
  readonly memberId: MemberId
  readonly from: { readonly provider: string; readonly model: string }
  readonly to: { readonly provider: string; readonly model: string }
  readonly reason: string
  /** 触发者（FR-6.2 的三种触发源，闭集）。 */
  readonly trigger: ModelSwitchTrigger
  /** FR-6.5：成员正忙时在最近的步骤边界生效，此处记录实际生效序号。 */
  readonly effectiveAtSequence: LedgerSequence
}

/**
 * 换模触发源（FR-6.1 / FR-6.2 的闭集）。
 * 收窄为字面量联合，免得下游穷尽处理时被迫写 `default`。
 */
export type ModelSwitchTrigger = 'human' | 'member-self' | 'policy'

/** `team/channel-created` 的载荷。 */
export interface ChannelCreatedData {
  readonly channelId: ChannelId
  readonly teamId: TeamId
  readonly title: string
}

/** `team/thread-started` 的载荷（FR-3.3）。 */
export interface ThreadStartedData {
  readonly threadId: ThreadId
  readonly channelId: ChannelId
  readonly title: string
  /** 认领者；未认领为 `null`。 */
  readonly assigneeMemberId: MemberId | null
}

/** `dag/team-created` 的载荷（FR-7.1：含 owner）。 */
export interface DagTeamCreatedData {
  readonly dagTeamId: DagTeamId
  readonly ownerMemberId: MemberId
  readonly parentTeamId: TeamId | null
  /** 是否由显式移交申请创建（FR-7.3）。 */
  readonly requestedByTransfer: boolean
}

/** `dag/task-state-changed` 的载荷（FR-4.1）。 */
export interface DagTaskStateChangedData {
  readonly dagTeamId: DagTeamId
  readonly taskId: string
  readonly from: DagTaskState
  readonly to: DagTaskState
  readonly reason?: string | undefined
}

/**
 * kind → 载荷 的映射（SPEC §6.1 的表格逐行落地）。
 *
 * 这是一张**必须覆盖全部 kind 的映射**，`LedgerEventKind` 由它的键推导而来 ——
 * 因此「新增一个 kind 却忘了定义载荷」在类型层就不成立。
 */
export interface LedgerEventMap {
  'team/initialized': TeamInitializedData
  'team/created': TeamCreatedData
  'team/member-added': MemberAddedData
  'team/member-renamed': MemberRenamedData
  'team/member-suspended': MemberLifecycleChangedData
  'team/member-resumed': MemberLifecycleChangedData
  'team/member-destroyed': MemberLifecycleChangedData
  'team/member-model-switched': MemberModelSwitchedData
  'team/channel-created': ChannelCreatedData
  'team/thread-started': ThreadStartedData
  'plan/approved': PlanApprovedData
  'spawn/awaiting-human-approval': SpawnAwaitingHumanData
  'spawn/principal-rejected': SpawnPrincipalRejectionData
  'spawn/human-approved': SpawnDecisionData
  'spawn/human-rejected': SpawnHumanRejectionData
  'team/ownership-reattached': TeamOwnershipReattachedData
  'dag/team-created': DagTeamCreatedData
  'dag/ownership-transferred': DagOwnershipTransferredData
  'dag/task-state-changed': DagTaskStateChangedData
}

/** 全部事件 kind（由 `LedgerEventMap` 的键推导）。 */
export type LedgerEventKind = keyof LedgerEventMap

/** 单个 kind 的事件类型。 */
export type LedgerEventOf<K extends LedgerEventKind> = LedgerEventBase & {
  readonly kind: K
  readonly data: LedgerEventMap[K]
}

/**
 * 全部事件的判别联合（SPEC §7.2 的穷尽性基础）。
 *
 * `switch (event.kind)` 之后若加了新分支而漏处理，`tsc` 的穷尽性检查会报错
 * （AC-5-4 用同一手法约束 `SpawnOutcome`）。
 */
export type LedgerEvent = { [K in LedgerEventKind]: LedgerEventOf<K> }[LedgerEventKind]
