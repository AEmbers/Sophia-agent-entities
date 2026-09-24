/**
 * `sophia_team_message` —— 成员间 / 向团长（监正）发消息（FR-3.3 / FR-10.1）。
 *
 * ## 它做什么（三步，顺序不可换）
 *
 * 1. **收窄入参**（模型输入一律不可信，见 `internal.ts`）；
 * 2. **把可落账的那部分事实落账**：`team/thread-started`（**仅**起线程路径）+
 *    `team/message-sent`（**两条路径都写** —— 起线程时带的正文就是该线程的第一条消息）；
 * 3. **经成员运行时把正文送达接收方**并**如实回报送达结果**。
 *
 * 顺序是「事实优先、通知尽力而为」：通知失败（接收方没被激活 / 已挂起 / 投递抛错）
 * **不撤销**已落账的事实，也不把整体判成失败 —— 但它必须出现在结果的 `delivery` 里，
 * 而不是被吞掉。
 *
 * ## 两条契约缺口**已关闭**（曾经如实回报过，现在有了承载处）
 *
 * 历史（对应 `SOPHIA_TOOL_CONTRACT_GAPS` 里**已删除**的那两条常量）：
 *
 * - **消息正文无处可落**：当时 `LedgerEventMap` 的 19 个 kind 里**没有任何一个承载正文**，
 *   `team/thread-started` 的载荷只有 `{threadId, channelId, title, assigneeMemberId}`
 *   ⇒ 正文只能经运行时通知送达、**不落账本**；
 * - **回复已有线程没有可写的事实**：上游有 `team/message-sent`（起线程）与
 *   `team/thread-replied`（回复）**两个** kind，而本契约把它们合并成了
 *   `team/thread-started` 一个 ⇒ 回复时再写一条 `thread-started` 会把该线程的
 *   `appearedAtSequence` 与 `title` **覆盖**成新值（`foldLedgerEvents` 对同 `threadId`
 *   是覆盖写），即用「启动」事件伪造一次「重新启动」。故当时选择**不写**。
 *
 * 现在 `LedgerEventMap` 有了 `team/message-sent`
 * （`src/types/operations.ts` 的 `MessageSentData`：`{messageId, channelId, threadId,
 * senderMemberId, body}`），且投影层对 `messages` 表是**追加**语义（按 `messageId`
 * 各自成行，`src/projection/index.ts` 的 `MessageFact`）⇒ 三件事同时成立：
 * 正文落了账、回复有了落点、**覆盖写线程事实的风险也消失了**（消息事件不带
 * `title`/`assigneeMemberId`，根本没有能覆盖它们的字段）。
 *
 * 因此**本文件不再带任何 `gaps`**（两条路径都返回空数组），这同时让界面消息流
 * 第一次有了真实内容 —— 此前 `buildWireTeam` 的 `messages` 只能如实留空。
 *
 * ## ⚠ 两条路径的 `ref` 为什么仍然取法不同
 *
 * 运行时的去重签名是 `(ref, revision, unreadCount, newestSequence)`
 * （`src/runtime/member-runtime.ts` 的 `noticeSignatureOf`）。`ref` 唯一是
 * 「连发两条回复都被送达」的**全部依据**：
 *
 * - 起线程路径用 `ref = <threadId>@<账本序号>` —— 序号天然唯一；
 * - 回复路径用 `ref = <threadId>@msg-<uuid>`（`SOPHIA_REPLY_REF_MARKER`）。
 *
 * ⚠ 这里有一条**如实记录的历史修正**：上一版给出的理由是「回复路径不落账本 ⇒
 * 序号给不出唯一性」。**该理由现在已经不成立**（回复路径同样落账、序号同样唯一）。
 * 保留 uuid 形态的理由换成了下面两条，并且**如实标注哪条是偏好、哪条有据**：
 *
 * ① **偏好（无实测支撑，按设计倾向）**：uuid 形态**不依赖账本**就能唯一。
 *    去重是运行时行为、账本序号是另一套机制，让前者依赖后者会把两类失败耦合成
 *    一种表现（「账本写成功但序号复用」会直接变成静默丢消息）。
 * ② **有据**：`tests/tools.spec.ts:1501` 的「回复 ref 的熵足够」用例**逐字读发出去的
 *    ref**（要求前缀恰为 `<threadId>@msg-`、随机段 ≥32 字符 = 128 bits）。
 *    改成序号形态会让那条回归断言**变成恒真**（不同回复的序号必然不同 ⇒ 熵断言再也测不到
 *    任何东西），那是把一条有效护栏换成装饰。
 *
 * 代价仍然是有意的：`ref` 唯一意味着「同一份正文被重复投递一次也不会被去重拦下」
 * （代价是偶尔多烧一次 turn）；若反过来让 `ref` 只有 `threadId`，代价是**静默丢消息**。
 * 两者的代价不对称（钱 vs 协作断裂），故选前者。
 *
 * @module @sophia/core/tools/message
 */

import { randomUUID } from 'node:crypto'

import type {
  MemberLogger,
  MemberNotice,
  MemberPendingItem,
  MemberRuntime,
  MemberWakeOutcome,
} from '../runtime/member-runtime.ts'
import type { Ledger } from '../ledger.ts'
import type { LedgerActor } from '../types/operations.ts'
import type { ChannelId, MemberId, MessageId, ThreadId } from '../types/ids.ts'
import {
  SOPHIA_TOOL_CONTRACT_GAPS,
  sophiaToolDescriptor,
  type SophiaToolDefinition,
  type SophiaToolDescriptor,
  type SophiaToolsDeps,
} from './types.ts'
import {
  asUncheckedRecord,
  guarded,
  describeError,
  isNonEmptyString,
  missingFieldReason,
  unreachableOutcome,
  narrowTrimmedString,
  renderValueForMessage,
} from './internal.ts'

/** `sophia_team_message` 的入参（类型层的期望形状；运行期由 `execute` 自行收窄）。 */
export interface TeamMessageInput {
  /** 消息正文（非空）。 */
  readonly content: string
  /** 收件人：成员名、成员 ID，或宿主约定的团长别名（如 `captain`）。 */
  readonly to: string
  /** 要提交到的线程；省略则新建一条（此时必须给 `channelId` 与 `threadTitle`）。 */
  readonly threadId?: ThreadId
  /** 线程所属频道；`threadId` 指向的线程尚不存在时必填。 */
  readonly channelId?: ChannelId
  /** 新建线程的标题。 */
  readonly threadTitle?: string
}

/**
 * 送达结果的**摘录**（只带可判定的那一半）。
 *
 * 为什么不直接把 `MemberWakeOutcome` 整个塞进结果：那个联合有 9 个 `kind`，
 * 其中 `invalid-notice` / `lifecycle-read-failed` 之类带 `reason` 的字段形状各异，
 * 让工具结果跟着它变会造出两处耦合的类型面。
 * 这里只取「哪个 kind / 走了哪条通道」两个信息位 —— 它们正是判据所需。
 */
export interface TeamMessageDelivery {
  readonly kind: MemberWakeOutcome['kind']
  readonly channel: 'followup' | 'steer' | null
  /**
   * 失败原因的原文（成功或该分支不带 `reason` 时为 `null`）。
   *
   * ⚠ 初版只保留 `kind`（OCR 复核 MEDIUM [19]），于是 `delivery-failed` /
   * `lifecycle-read-failed` / `invalid-notice` 三个分支携带的 `reason` 被**丢掉**，
   * render 只能输出 `送达 <id>：delivery-failed。` —— 一个字都没说**为什么**没送到。
   * 那恰好违背本文件自己的承诺（「通知失败必须出现在结果的 delivery 里，而不是被吞掉」）。
   */
  readonly reason: string | null
  /**
   * 本次**是否真的送达**（`delivered` 才为 true）。
   *
   * 存在的理由（OCR 复核 MEDIUM [20]）：`duplicate` 表示运行时**主动抑制**了这次投递
   *（同签名的待办已经送达过），**消息并没有再送一次**。而 render 初版把 `kind` 原样拼出，
   * 读起来像「已成功送达，只是重复」。本字段让「送到」与「没送到」在结果里**结构上**可分，
   * 而不是靠调用方去记哪些 kind 算成功。
   */
  readonly delivered: boolean
}

export type TeamMessageOutcome =
  | {
      readonly kind: 'sent'
      readonly threadId: ThreadId
      /**
       * 本次是否**新建**了线程（false ⇒ 走的是回复路径，线程是既有的）。
       *
       * ⚠ 它**不再**能由 `newestSequence === null` 推导出来 —— 两条路径现在
       * **都会**落一条 `team/message-sent`，因此序号都非 null。判定依据改成了
       * 「本次先写了 `team/thread-started` 没有」，见 `deliver` 的说明。
       */
      readonly threadCreated: boolean
      /**
       * 本次**最新一条**已落账事件的序号。
       *
       * 两条路径都会落账（起线程路径另有一条 `team/thread-started` 在前），
       * 故实参恒为真实序号；保留 `null` 只是为了「未落账」在类型上仍可表达
       * （宿主换成不写账本的实现时用得上），而不是当前的正常取值。
       */
      readonly newestSequence: number | null
      readonly recipientMemberId: MemberId
      readonly delivery: TeamMessageDelivery
      /** 本次踩到的契约缺口（见 `SOPHIA_TOOL_CONTRACT_GAPS`）。两条路径当前恒为 `[]`。 */
      readonly gaps: readonly string[]
    }
  /** 入参缺字段 / 形状不对。 */
  | { readonly kind: 'invalid-input'; readonly reason: string }
  /** 收件人解析不出来（成员名写错、或该名不在本团）。 */
  | { readonly kind: 'unknown-recipient'; readonly reason: string }
  /** 频道不存在（账本里没有它）。 */
  | { readonly kind: 'unknown-channel'; readonly reason: string }
  /**
   * 给了 `threadId`，但账本里查不到这条线程。
   *
   * 与 `unknown-channel` 分开：两者的**修法不同** —— 前者是频道 id 写错，
   * 后者是「想回复一条不存在的线程」，或者「想自造一个新线程 id」（本工具不接受，
   * 见 `execute` 里的说明）。混成一个 `kind` 会让调用方照错的提示去改。
   */
  | { readonly kind: 'unknown-thread'; readonly reason: string }
  /** 频道属于**另一个团**（越权：不许把消息投进别人的团）。 */
  | { readonly kind: 'cross-team'; readonly reason: string }
  /** 落账时抛错（原因原样带出，不静默）。 */
  | { readonly kind: 'failed'; readonly reason: string }

/** 新建线程 id 的前缀（与测试的断言共用同一处字面量）。 */
export const SOPHIA_THREAD_ID_PREFIX = 'thread-'

/**
 * 消息 id 的前缀（`team/message-sent` 的 `messageId`）。
 *
 * ⚠ **两条写入路径共用它、且共用一个生成器**（本文件下方的 `newMessageId()`）：
 * 起线程路径与回复路径各造一种前缀的话，任何「按 id 前缀筛消息」的下游
 * （宿主的诊断、未来的清理工具）都会**静默漏掉一半**，而漏掉的东西在界面上
 * 表现为「消息少了几条」—— 看不出是谁的错。
 */
export const SOPHIA_MESSAGE_ID_PREFIX = 'msg-'

/** 未落账的回复消息用的 `ref` 标记（理由见文件头）。 */
export const SOPHIA_REPLY_REF_MARKER = '@msg-'

/**
 * 收件人别名 → 团长（监正）。
 *
 * 宿主应把该别名解析成**该团监正的 `MemberId`**（`resolveMemberRef` 的接线约定）。
 * 它只是一个别名，不是身份 —— 本模块不接受模型自报的「我是谁」（见 `SophiaToolCaller`）。
 */
export const SOPHIA_CAPTAIN_ALIAS = 'captain'

function invalid(reason: string): TeamMessageOutcome {
  return { kind: 'invalid-input', reason }
}

/**
 * 生成一条消息的 `messageId`（`team/message-sent` 的载荷字段）。
 *
 * **单一生成器**，两条写入路径（起线程 / 回复）都调它 —— 理由见
 * `SOPHIA_MESSAGE_ID_PREFIX`。形态与 `threadId` 的生成方式**同风格**
 * （`${前缀}${randomUUID()}`，见下方两处调用点）：前缀表明实体种类，
 * 后半段是整个 UUID（128 bits）而不是截断的 8 位 —— 消息与线程不同，
 * 一次会话里可能有上千条，截断会按生日问题出现碰撞，而
 * `foldLedgerEvents` 对 `messages` 表是按 `messageId` **覆盖写**，
 * 撞了就是**静默丢掉一条消息**（与 `ref` 那处「熵不足」的实测缺陷同源）。
 */
function newMessageId(): MessageId {
  return `${SOPHIA_MESSAGE_ID_PREFIX}${randomUUID()}` as MessageId
}

/**
 * 收窄入参（**绝不抛错**：模型生成的 JSON 什么都可能是）。
 *
 * 源码里的 `as ThreadId` / `as ChannelId` 是「已由 `isNonEmptyString` 证明过形状」的
 * 直接后果 —— 品牌类型在运行期只是 `string`（`src/types/ids.ts`），
 * 没有任何运行期手段能验证「这个字符串确实是某个真实的 ThreadId」；
 * 那由后面的账本投影（线程 / 频道是否存在）负责。
 */
function narrowInput(input: unknown): TeamMessageInput | TeamMessageOutcome {
  const raw = asUncheckedRecord(input)

  // 字符串字段一律「先校验、再裁剪」（见 internal.ts 的 narrowTrimmedString）。
  const content = narrowTrimmedString(raw, 'content')
  if (!content.ok) return invalid(content.reason)
  if (content.value === undefined) return invalid(missingFieldReason('content'))
  const to = narrowTrimmedString(raw, 'to')
  if (!to.ok) return invalid(to.reason)
  if (to.value === undefined) return invalid(missingFieldReason('to'))
  const threadId = narrowTrimmedString(raw, 'threadId')
  if (!threadId.ok) return invalid(threadId.reason)
  const channelId = narrowTrimmedString(raw, 'channelId')
  if (!channelId.ok) return invalid(channelId.reason)
  const threadTitle = narrowTrimmedString(raw, 'threadTitle')
  if (!threadTitle.ok) return invalid(threadTitle.reason)

  return {
    content: content.value,
    to: to.value,
    ...(threadId.value === undefined ? {} : { threadId: threadId.value as ThreadId }),
    ...(channelId.value === undefined ? {} : { channelId: channelId.value as ChannelId }),
    ...(threadTitle.value === undefined ? {} : { threadTitle: threadTitle.value }),
  }
}

/** 待办项（`unreadCount` 恒为 1：这条通知恰好对应一条新消息）。 */
function pendingItem(ref: string, sequence: number): MemberPendingItem {
  return { ref, revision: sequence, unreadCount: 1, newestSequence: sequence }
}

/** 带 `reason` 的分支（只有这几个带 —— 类型层面收窄，避免读到不存在的字段）。 */
const REASONED_KINDS = ['delivery-failed', 'lifecycle-read-failed', 'invalid-notice'] as const

function deliveryOf(outcome: MemberWakeOutcome): TeamMessageDelivery {
  // ⚠ 只有 `delivered` 算送到（见 `TeamMessageDelivery.delivered` 的说明）。
  const delivered = outcome.kind === 'delivered'
  const channel = outcome.kind === 'delivered' || outcome.kind === 'delivery-failed'
    ? outcome.channel
    : null
  const reason =
    (REASONED_KINDS as readonly string[]).includes(outcome.kind)
      // 三个带 reason 的分支形状同构（都只有 reason 一个字符串字段）。
      ? (outcome as { readonly reason: string }).reason
      : null
  return { kind: outcome.kind, channel, reason, delivered }
}

/**
 * `unreachableOutcome` 的唯一实现在 `src/tools/internal.ts`（见那里的说明：
 * 它与 `assertNever` 是**两个**函数，各回答不同的问题 —— 一个该抛、一个不该抛；
 * OCR 复核 LOW [10] 把它们合并到 `assertNever` 的建议**只对了一半**：
 * 该合并的是「四份重复实现」，不是「两个语义不同的函数」）。
 */

/**
 * 写一条 `team/message-sent` —— **本仓唯一的写入实现**。
 *
 * 三个调用点共用它：工具的起线程路径、工具的回复路径、以及宿主 UI 路由
 * `POST /api/sophia/team/message`（主人从面板手打的消息）。
 *
 * 抽成模块级导出函数（而不是让宿主路由去调工具）是**刻意的**，理由两条：
 *
 * 1. **工具面进不去。** `createTeamMessageTool` 的入参是 `SophiaToolsDeps`，
 *    其中 `caller: SophiaToolCaller` 要求一个**成员身份**（`memberId` + `teamId`），
 *    而主人不是任何团的成员。给人类硬编一个成员身份，会让主人发的消息
 *    **记成某个成员发的**（`senderMemberId` 与基座 `actor` 双错）——
 *    那是**伪造审计线索**，比多一层函数调用糟得多。
 * 2. **同一份逻辑只有一个出处。** id 生成、载荷字段集、`occurredAt` 取自基座 ——
 *    三处各写一份必然漂移（例如某天只在一处补了字段校验，另一处静默写出不合契约的载荷）。
 *    本函数与 `deps` 无关：actor / sender / 时间由调用方**显式传进来**。
 *
 * 返回 `{ok:false}` 而**不抛**：账本写入失败（库只读、已关闭）是要如实报给调用方的
 * 事实，不是异常（工具面照旧折成 `kind: 'failed'`，路由折成 500）。
 *
 * @param input.senderMemberId - 发送者成员 id；**`null` = 不是团内成员发的**
 *   （主人经面板发送）—— 含义与代价见 `MessageSentData`。
 */
/**
 * `writeMessageSent` 的结果。
 *
 * 成功时连 `messageId` 一起给出：宿主 UI 路由要把它回给界面
 * （`requestTeamMessage` 读响应体的 `messageId`），而重新去账本里翻「刚写的那条是哪条」
 * 既慢又脆（时间戳并列时无法唯一定位）。
 */
export type MessageSentWriteResult =
  | { readonly ok: true; readonly sequence: number; readonly messageId: MessageId }
  | { readonly ok: false; readonly reason: string }

export function writeMessageSent(input: {
  readonly ledger: Ledger
  readonly actor: LedgerActor
  readonly occurredAt: number
  readonly channelId: ChannelId
  readonly threadId: ThreadId
  readonly senderMemberId: MemberId | null
  readonly body: string
}): MessageSentWriteResult {
  const messageId = newMessageId()
  try {
    const receipt = input.ledger.commit({
      kind: 'team/message-sent',
      actor: input.actor,
      // 时间由账本基座承载（`MessageSentData` 里**没有**它，见该接口的说明）。
      occurredAt: input.occurredAt,
      data: {
        messageId,
        channelId: input.channelId,
        threadId: input.threadId,
        senderMemberId: input.senderMemberId,
        body: input.body,
      },
    })
    return { ok: true, sequence: receipt.sequence, messageId }
  } catch (error) {
    return { ok: false, reason: `写 team/message-sent 失败：${describeError(error)}` }
  }
}

/**
 * 唤醒面需要的**最小**结构类型。
 *
 * 为什么不用整个 `MemberRuntime`：唤醒只用得到 `notify` 一个方法
 *（去重、通道选择、生命周期门、句柄门**都在运行时实现里**，本仓不重写）。
 * 取整个接口会让测试为了一个通知桩去实现另外六个方法，而多出来的那些
 * 实现是**假的**（`presenceOf` 恒 `'idle'` 之类）—— 假的桩比没有桩更危险。
 */
export type MessageNotifier = Pick<MemberRuntime, 'notify'>

/**
 * 唤醒一个成员：告诉他「某条线程里多了一条消息」—— **本仓唯一的通知构造处**。
 *
 * 工具面（`sophia_team_message` 的两条路径）与宿主 UI 路由
 * （`POST /api/sophia/team/message`，主人手打）**共用**它。
 *
 * ## 为什么把「发信人」参数化，而不是在路由里另写一套通知
 *
 * 两处的**投递动作**完全相同（`runtime.notify` + 一个待办项 + 一段正文），
 * 差别只有**正文里怎么称呼发信人**：工具面是「成员 X」，面板那条是**主人**。
 * 另写一套的代价不是多几行，而是**去重签名 / 待办项 ref / 通道选择**这些
 * 真正有语义的东西会出现第二个真相 —— 那两套必然漂移，而漂移的表现是
 * 「同一条待办被推两次」或「该唤醒的没唤醒」，都不好查。
 *
 * ⇒ 只把那个**称呼**参数化：`senderMemberId` 为 `null` 就是「不是成员发的」（主人）。
 * 这个参数形状与 `MessageSentData.senderMemberId` **同一个约定**（同一个字段、同一个含义），
 * 不另造一个枚举 —— 否则「谁发的」在同一条链上会有两种表示法。
 *
 * ## 为什么正文里必须出现「你收到了」
 *
 * 见下方 `text` 的注释（OCR 复核 MEDIUM [1] 的真实缺陷）：这段文本是**投递给收件人**的。
 *
 * @returns `MemberWakeOutcome` 的**摘录**（`TeamMessageDelivery`）。**不抛错** ——
 *   注入的运行时可能返回怪值或抛错，两者都如实折成 `delivery-failed`，
 *   绝不让异常冲进调用方（宿主的通知常在事件派发路径上）。
 */
export function wakeMemberForMessage(input: {
  readonly notifier: MessageNotifier
  readonly logger?: MemberLogger | undefined
  /** 发信人：成员 id，或 `null` = 不是成员（人类操作者）。与 `MessageSentData` 同约定。 */
  readonly senderMemberId: MemberId | null
  readonly threadId: ThreadId
  readonly recipientMemberId: MemberId
  readonly content: string
  /** 待办项的唯一 `ref`（取法见各调用点的文件头；**不由本函数决定**）。 */
  readonly refKey: string
  readonly newestSequence: number
}): TeamMessageDelivery {
  const notice: MemberNotice = {
    items: [pendingItem(input.refKey, input.newestSequence)],
    // ⚠ 文案必须**自带立场**（OCR 复核 MEDIUM [1] 的真实缺陷）。
    // 初版是 `来自 ${deps.caller.memberId} 的消息…` —— 那段文本是**投递给收件人**的，
    // 于是当收件人恰好就是调用者自己的团内别名场景下，读起来成了
    // 「来自 <你自己> 的消息」，收件人无从判断自己在这条消息里的角色。
    // 注意发信人与收件人取值不同是**常态**（消息就是发给别人的），
    // 所以这里加「你收到了」把收件人视角写实，两个名字都出现、各自标注角色。
    //
    // ⚠ 人类那条写「主人」：**界面上唯一的操作者就是主人**（面板是主人的面板）。
    // 只写「某个人类」会让成员收到一条不知谁发的话 —— 那比不唤醒更糟。
    text:
      `你收到了来自${input.senderMemberId === null ? '主人' : `成员 ${input.senderMemberId}`}`
      + `的一条消息（线程 ${input.threadId}）：${input.content}`,
  }
  try {
    const raw = input.notifier.notify(input.recipientMemberId, notice)
    // ⚠ 注入实现可能返回 `null`/`undefined` 或一个缺 `kind` 的对象（OCR 复核 MEDIUM [15]）。
    // 初版直接 `deliveryOf(raw)`，而 `deliveryOf` 里读 `outcome.kind` ⇒ 那一下会在
    // **catch 块内部**抛，把一次本可上报的 `delivery-failed` 变成穿透 `execute` 的异常 ——
    // 恰好违背「只返回错误、绝不抛」。运行时自己就为 `notice === null` 设过守卫，
    // 说明这个形状问题在该层是**真实发生过**的。
    return raw === null || raw === undefined || typeof (raw as { kind?: unknown }).kind !== 'string'
      ? {
          kind: 'delivery-failed',
          channel: null,
          reason: `运行时 notify 返回了非 MemberWakeOutcome 的值（收到 ${renderValueForMessage(raw)}）—— 接线不符契约。`,
          delivered: false,
        }
      : deliveryOf(raw)
  } catch (error) {
    // 运行时的契约是「从不抛错」（t2 的 `MemberRuntime` 文档），故走到这里说明接线被改坏了。
    // 不吞：如实回报，让「通知没送到」可被发现。**不回滚**已落账的事实 ——
    // 账本是事实，通知是尽力而为（与 `delegation.ts` 对 inbox.push 失败的处置同一取舍）。
    input.logger?.warn(`[sophia] 消息通知投递抛错：${describeError(error)}`)
    // ⚠ 这里也带上 `reason`：接线的异常原文是排查这类问题唯一的线索，
    // 初版只记日志不回报，调用方拿到的是一句没有原因的 delivery-failed。
    return {
      kind: 'delivery-failed',
      channel: null,
      reason: `运行时 notify 抛错（接线被改坏）：${describeError(error)}`,
      delivered: false,
    }
  }
}

/**
 * 构造 `sophia_team_message`。
 *
 * @param deps - 工具集依赖（宿主唯一接线点，见 `SophiaToolsDeps`）。
 */
export function createTeamMessageTool(deps: SophiaToolsDeps): SophiaToolDescriptor {
  /**
   * 把「往某线程投了一条消息」这条事实落账（**工具面**的薄封装）。
   *
   * 真正的写入在模块级 `writeMessageSent()`（唯一出处，宿主 UI 路由也调它）；
   * 这一层只补上「工具面的发送者是调用它的那个成员」这条上下文，并把返回值收窄成
   * 两个调用点需要的那两件事。两条路径（起线程 / 回复）**共用**它：它们要写的是
   * 同一个 kind 的同一种事实，差别只在起线程路径**还要先**写一条 `team/thread-started`。
   *
   * 返回 `{ok:false}` 而**不抛**：与 `execute` 的契约一致（只返回错误、绝不抛），
   * 也让两个调用点能用同一句话回报失败（`kind: 'failed'`）。
   */
  function commitMessageSent(
    channelId: ChannelId,
    threadId: ThreadId,
    body: string,
  ): { readonly ok: true; readonly sequence: number } | { readonly ok: false; readonly reason: string } {
    const written = writeMessageSent({
      ledger: deps.ledger,
      actor: { kind: 'member', memberId: deps.caller.memberId },
      occurredAt: deps.now(),
      channelId,
      threadId,
      senderMemberId: deps.caller.memberId,
      body,
    })
    return written.ok ? { ok: true, sequence: written.sequence } : written
  }

  /**
   * 投递并组装结果（两条路径**共用**这一段，保证对同一种失败说同一种话）。
   *
   * @param refKey - 待办项的唯一 `ref`（取法见文件头；**不由本函数决定**）。
   * @param appended - 本次落账的事实种类：`'new-thread'`（先写了 `team/thread-started`）
   *   或 `'existing-thread'`（只写了 `team/message-sent`）。`threadCreated` 由它推导。
   * @param newestSequence - 本次**最新**一条已落账事件的序号（两条路径都有）。
   */
  function deliver(
    threadId: ThreadId,
    recipientMemberId: MemberId,
    content: string,
    refKey: string,
    appended: 'new-thread' | 'existing-thread',
    newestSequence: number,
    gaps: readonly string[],
  ): TeamMessageOutcome {
    // ⚠ `threadCreated` **由 `appended` 推导**，不作为独立形参传入 —— 这条设计不变，
    // 但**推导依据变过一次**，改的依据记在这里（否则后来者会以为这里的注释写错了）：
    //
    // 改前：`threadCreated = newestSequence !== null`。当时这条等价成立，因为**只有**
    //   起线程路径落账。它的意图是「让不可能表达」—— 传两个可以互相矛盾的实参
    //   （`deliver(…, newestSequence: null, threadCreated: true)`）是构造得出的，
    //   会渲染出「新建线程 … 无（回复路径未写账本）」这种自相矛盾的一句，而类型系统不拦。
    // 现在：两条路径**都**落账（`team/message-sent`）⇒ 序号都非 null ⇒
    //   `newestSequence !== null` **再也区分不了两条路径**，旧的推导成了恒真。
    //   于是改用「本次写了 thread-started 没有」这个**真正的判别键**（`appended`）。
    //   矛盾依然不可表达（`threadCreated` 仍旧不是形参），只是判别键换了。
    const threadCreated = appended === 'new-thread'
    const sequenceForItem = newestSequence
    // ⚠ 通知的构造与投递**全部**在模块级 `wakeMemberForMessage()`（唯一出处，
    // 宿主 UI 路由也调它）。这一层只负责：把工具面的上下文（发信人 = 调用者）喂进去，
    // 再把结果装成 `TeamMessageOutcome`。
    const delivery = wakeMemberForMessage({
      notifier: deps.runtime,
      logger: deps.logger,
      senderMemberId: deps.caller.memberId,
      threadId,
      recipientMemberId,
      content,
      refKey,
      newestSequence: sequenceForItem,
    })
    return { kind: 'sent', threadId, threadCreated, newestSequence, recipientMemberId, delivery, gaps }
  }

  const definition: SophiaToolDefinition<TeamMessageInput, TeamMessageOutcome> = {
    name: 'sophia_team_message',
    description:
      '给同事或团长（监正）发一条消息，并唤醒接收方。'
      + '起一条新线程时必须同时给 channelId 与 threadTitle；回复已有线程时给 threadId 即可。'
      + '两条路径都会把正文落账（起线程写 team/thread-started + team/message-sent，'
      + '回复写 team/message-sent），正文同时经运行时通知送达接收方。',
    parameters: {
      content: { type: 'string', required: true, description: '消息正文（非空）。' },
      to: {
        type: 'string',
        required: true,
        description:
          `收件人：成员名、成员 ID，或团长别名 "${SOPHIA_CAPTAIN_ALIAS}"`
          + '（宿主把它解析成该团监正的成员 ID）。',
      },
      threadId: { type: 'string', description: '要回复的线程 ID（必须是已存在的线程）；新建线程时**省略**。' },
      channelId: { type: 'string', description: '线程所属频道 ID（新建线程时必填）。' },
      threadTitle: { type: 'string', description: '新建线程的标题（新建线程时必填）。' },
    },
    // ── 输出 schema（裸 DSL，与 parameters 同形；见 SophiaToolDefinition.outputSchema）──
    //
    // ⚠ 判别联合在裸 DSL 里**只能用「扁平 + enum 收窄 kind」**表达：
    // 实测 oneOf/anyOf 都被 REJECT。故这里列**全部分支字段的并集**。
    // ⚠ 而 additionalProperties: false 会让 DSH **拒绝未声明字段** ⇒
    // 少列一个字段就等于「该分支的成功结果被拒」，比漏写 schema 更坏。
    // 逐字段对照 TeamMessageOutcome 的每个变体核过。
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          required: true,
          enum: ['sent', 'invalid-input', 'unknown-recipient', 'unknown-channel', 'unknown-thread', 'cross-team', 'failed'],
          description: '结果分支。sent = 已落账并投递；其余为拒绝或失败。',
        },
        threadId: { type: 'string', description: '（sent）消息所属线程 id。' },
        threadCreated: { type: 'boolean', description: '（sent）本次是否**新建**了线程；false = 回复路径（不写账本）。' },
        newestSequence: { type: 'json', description: 'number | null ——（sent）已落账事件的序号；回复路径未落账时为 null。' },
        recipientMemberId: { type: 'string', description: '（sent）收件人成员 id。' },
        delivery: {
          type: 'object',
          additionalProperties: false,
          description: '（sent）唤醒投递结果。delivered 为 false 时**消息没有送达**。',
          properties: {
            kind: { type: 'string', required: true, description: '运行时的唤醒结果（delivered / duplicate / no-handle / …）。' },
            channel: { type: 'json', description: 'string | null —— 投递通道（followup / steer）；不可知时为 null。' },
            reason: { type: 'json', description: 'string | null —— 失败原因的原文；无则 null。' },
            delivered: { type: 'boolean', required: true, description: '**本次是否真的送达**；只有它为 true 才算送到。' },
          },
        },
        gaps: { type: 'array', items: { type: 'string' }, description: '（sent）本次踩到的契约缺口（见 SOPHIA_TOOL_CONTRACT_GAPS）。' },
        reason: { type: 'string', description: '（非 sent 分支）拒绝或失败的可读原因。' },
      },
    },
    render: (outcome) => {
      switch (outcome.kind) {
        case 'sent': {
          const where = outcome.threadCreated ? '新建线程' : '回复线程'
          // ⚠ 这里的 `null` 分支**不再**是「回复路径」的代名词：两条写入路径现在都会落账
          //（回复写 `team/message-sent`），故正常取值恒为非 null。保留该分支是为了让
          // 类型上仍可表达的「未落账」有一句**中性**的措辞 —— 原先写的是
          // 「无（回复路径未写账本）」，那是把一个**已经作废的原因**写进了面向用户的文本。
          const sequenceText =
            outcome.newestSequence === null ? '无（本次未落账）' : String(outcome.newestSequence)
          // ⚠ 措辞必须如实区分「送到」与「没送到」（OCR 复核 MEDIUM [20]）：
          // \`duplicate\` / \`no-handle\` / \`not-active\` 都**没有**把消息再送一次，
          // 而初版一律写成「送达 <id>：<kind>」——读起来像成功。现在按 `delivered` 分流。
          const deliveryText = outcome.delivery.delivered
            ? `已送达 ${outcome.recipientMemberId}（通道 ${String(outcome.delivery.channel)}）`
            // ⚠ 分隔符只有在**真有 reason** 时才加（OCR 复核 MEDIUM [14]）。
            // 初版无条件拼 `：`，于是 `reason === null` 的那些非送达分支渲染成
            // `（no-handle ）` —— 一个悬空的冒号 + 空串。而 `no-handle`/`not-active`
            // 恰恰**没有** reason，也就是**最常见的非送达情形**都撞上这个空尾巴。
            : (() => {
                const why = outcome.delivery.reason
                const detail = typeof why === 'string' && why !== '' ? `：${why}` : ''
                return `**本次未送达** ${outcome.recipientMemberId}（${outcome.delivery.kind}${detail}）`
              })()
          const line =
            `消息已提交到${where} ${outcome.threadId}（账本序号 ${sequenceText}），${deliveryText}。`
          return outcome.gaps.length === 0 ? line : `${line} ${outcome.gaps.join(' ')}`
        }
        case 'invalid-input':
        case 'unknown-recipient':
        case 'unknown-channel':
        case 'unknown-thread':
        case 'cross-team':
        case 'failed':
          return `消息未送出（${outcome.kind}）：${outcome.reason}`
        default:
          return unreachableOutcome(outcome)
      }
    },
    execute(input: unknown): TeamMessageOutcome {
      const narrowed = narrowInput(input)
      // ⚠ OCR HIGH [第七轮]：caller fail-closed 前置（同 task-claim 样板）——
      // deps.caller 是**宿主接线**：null/undefined 解引用会让 TypeError 穿出
      // execute（破坏「只返回错误、绝不抛」契约）；空白 memberId/teamId 会原样
      // 进跨团比对（下面 L469 区）与账本 actor（L591 区，append-only 不可改写）。
      const rawCallerId = deps.caller === null || deps.caller === undefined ? undefined : deps.caller.memberId
      const rawCallerTeam = deps.caller === null || deps.caller === undefined ? undefined : deps.caller.teamId
      if (!isNonEmptyString(rawCallerId) || !isNonEmptyString(rawCallerTeam)) {
        return {
          kind: 'failed',
          reason:
            `调用者身份不可用（memberId=${renderValueForMessage(rawCallerId)}, teamId=${renderValueForMessage(rawCallerTeam)}）—— `
            + '工具集 caller 必须是非空白接线；空身份会写进不可改写的账本 actor，故 fail-closed。',
        }
      }
      // OCR HIGH [第八轮]：**带空白的绑定也拒绝**（不是裁剪后将就用）——
      // 裁剪=容忍接线 bug（padded teamId 会与投影规范值永不相等 ⇒ 误导性的
      // not-same-team）；拒绝=把接线错误暴露在第一时间。
      if (rawCallerId !== rawCallerId.trim() || rawCallerTeam !== rawCallerTeam.trim()) {
        return {
          kind: 'failed',
          reason:
            '调用者身份带首尾空白 —— 宿主接线必须给出裁剪规范值；'
            + '放行会让同团门与账本 actor 在「同一人」上永不相等（fail-closed，先修接线）。',
        }
      }
      if ('kind' in narrowed) return narrowed

      // ── 1. 收件人（成员名 → MemberId 由宿主投影裁决） ──
      // ⚠ 三个投影端口一律走 guarded（OCR 复核 HIGH [14]，第二例）。
      // 理由与 `task-claim.ts` 那次完全相同：它们是宿主注入的、通常读账本，
      // 一次存储错误就会从 `execute` 穿透出去，破掉「只返回错误、绝不抛」。
      // 实测本文件初版把 `resolveMemberRef`/`threadOf`/`channelTeamOf` 全裸调了。
      const recipient = guarded(() => deps.projection.resolveMemberRef(narrowed.to))
      if (!recipient.ok) {
        return { kind: 'failed', reason: `解析收件人时抛错：${recipient.reason}` }
      }
      const recipientMemberId = recipient.value
      if (recipientMemberId === null) {
        return {
          kind: 'unknown-recipient',
          reason:
            `收件人 ${JSON.stringify(narrowed.to)} 解析不出成员。`
            // ⚠ 必须点出「**可能只是不在本团**」（OCR 复核 LOW [2]）。
            // 加了收件人跨团门之后，「这个名字属于别的团」是一条**新的**常见成因 ——
            // 而它的表现就是**解析不出来**（`resolveMemberRef` 只按名字/ID 找，
            // 认不出别人的团成员）。只说「名字写错」会把调用方引去反复核对拼写，
            // 而真正的问题是**它是别的团的人**（那种情况下换个写法也没用）。
            + '三种可能：① 名字/ID 拼错了；② 这位成员**不在你所属的团**里'
            + '（本工具只允许向同团成员发消息，FR-7.2）；③ 它确实不在账本里。'
            + `向团长发消息请用 "${SOPHIA_CAPTAIN_ALIAS}" 或该监正的成员名。`
            + '若对方属于别的团，请由团长发起跨团协调（团长可跨团调度，成员不可）。',
        }
      }

      // ⚠ **收件人必须与本团同团**（OCR 复核 HIGH [2]，真实**越权**缺陷，已实测复现）。
      //
      // ## 缺口是什么
      //
      // 本文件在**线程路径**上有一道 `cross-team` 门（下面 `threadChannelTeam` 那段），
      // 而**收件人路径此前完全没有** —— 两条路径**不对称**。
      // 而 `resolveMemberRef` 的契约只承诺「把名字/ID 解析成 `MemberId`；认不出 ⇒ null」，
      // **没有任何「同团」语义**。宿主完全可能（本仓的测试夹具就是）遍历**全部**成员。
      //
      // ## 实测复现（不是推断）
      //
      // 我造了一个「teamA 成员 + teamB 成员」的两团现场，让 teamA 的成员按名字
      // 发给 teamB 的成员，结果是：
      // ```
      // PROBE-H2-kind     >>> sent
      // PROBE-H2-delivered>>> ["him-b"]      ← 消息真的投进了**别人的团**
      // ```
      //
      // ## 为什么选「补判定」(a) 而不是「写清契约」(b)
      //
      // captain 给了两条路。选 (a)，理由三条：
      // 1. **本文件自己的纪律要求对称**：线程路径已经这么做了，理由（FR-7.2）逐字相同；
      //    为收件人路径写一段「由宿主保证」的契约，等于对同一个不变量用两套标准。
      // 2. **`teamOf` 端口已经存在**（`SophiaProjectionPorts.teamOf`），补这一刀
      //    **不需要任何新端口**，成本是一行。
      // 3. **fail-closed 才是这类边界该有的默认**：契约「宿主保证」是**信任**，
      //    而越权的代价不可逆（消息已投递）。用已有端口自己判，把信任换成验证。
      //
      // 残余风险如实标注：`teamOf` 返回 `null` 时有二义（从未存在 / 存在但已无团），
      // 见 `SOPHIA_TOOL_CONTRACT_GAPS.memberTeamOfAmbiguity` —— 但这里两条都该拒，
      // 故二义**不影响**本判定的正确性（这也是选 (a) 的一个附带好处）。
      const recipientTeam = guarded(() => deps.projection.teamOf(recipientMemberId))
      if (!recipientTeam.ok) {
        return { kind: 'failed', reason: `读收件人所属团时抛错：${recipientTeam.reason}` }
      }
      if (recipientTeam.value === null) {
        return {
          kind: 'cross-team',
          reason:
            `收件人 ${String(recipientMemberId)} 的所属团读不到（\`teamOf\` 返回 null）—— `
            + '无法确认它与你同团，故拒绝投递（fail-closed）。'
            + SOPHIA_TOOL_CONTRACT_GAPS.memberTeamOfAmbiguity,
        }
      }
      if (recipientTeam.value !== deps.caller.teamId) {
        return {
          kind: 'cross-team',
          reason:
            `收件人 ${String(recipientMemberId)} 属于团 ${recipientTeam.value}，而你属于团 ${deps.caller.teamId} —— `
            + 'FR-7.2 的隔离口径：不得向别人的团里投消息。'
            + '若确实需要跨团协作，请由团长发起（团长可跨团调度，成员不可）。',
        }
      }

      // ── 2. 路径分流 ──
      const requestedThread = narrowed.threadId
      if (requestedThread !== undefined) {
        const threadLookup = guarded(() => deps.projection.threadOf(requestedThread))
        if (!threadLookup.ok) {
          return { kind: 'failed', reason: `读线程时抛错：${threadLookup.reason}` }
        }
        const existing = threadLookup.value
        if (existing !== null) {
          // ⚠ **回复路径也必须过归属门**（OCR 复核 HIGH [14]，真实**越权**缺陷）。
          //
          // 初版只在**起线程**路径上对 `channelId` 做了一次 `cross-team` 判定；
          // 当调用方给一个**已存在**的 `threadId` 时直接走 `deliver`，
          // 从未检查该线程所属频道属于哪个团 ⇒ 团 A 的成员只要知道团 B 的线程 id，
          // 就能把正文**投进别人的团**（`notify` 会把正文送达团 B 的成员），
          // 而结果被渲染成成功。这与本文件自己的承诺直接冲突 ——
          // 类型注释把 `cross-team` 定义为「不许把消息投进别人的团（FR-7.2）」，
          // 而那条口径在回复路径上是**空的**。
          // `SophiaThreadFact` 本来就带 `channelId`，补这一刀不需要任何新端口。
          const threadChannelTeam = guarded(() => deps.projection.channelTeamOf(existing.channelId))
          if (!threadChannelTeam.ok) {
            return { kind: 'failed', reason: `读线程所属频道时抛错：${threadChannelTeam.reason}` }
          }
          if (threadChannelTeam.value === null) {
            return {
              kind: 'unknown-channel',
              reason:
                `线程 ${requestedThread} 所属的频道 ${existing.channelId} 不在账本里 —— `
                + '无法确认它属于哪个团，故拒绝投递（fail-closed）。',
            }
          }
          if (threadChannelTeam.value !== deps.caller.teamId) {
            return {
              kind: 'cross-team',
              reason:
                `线程 ${requestedThread} 属于团 ${threadChannelTeam.value}，而你属于团 ${deps.caller.teamId} —— `
                + 'FR-7.2 的隔离口径：不得向别人的团里投消息（回复路径同样受这条约束）。',
            }
          }
          // ── 回复路径：**落一条 `team/message-sent`** ──
          //
          // 这里曾经写着「回复路径：**不写账本**」，理由是当时没有任何事件能承载
          // 「往已有线程里追加一条消息」—— 再写 `team/thread-started` 会把该线程的
          // `channelId`/`title`/`appearedAtSequence` **覆盖**成新值（投影层对同
          // `threadId` 是覆盖写），等于用「启动」事件伪造一次「重新启动」。
          //
          // 现在 `team/message-sent` 存在，且它带的是**自己的** `messageId` 与正文、
          // **不带** 线程的 `title`/`assigneeMemberId` ⇒ 从字段层面就不可能覆盖线程事实。
          // 于是这条缺口关闭（`SOPHIA_TOOL_CONTRACT_GAPS` 里那两条常量已删除）。
          //
          // ⚠ `channelId` 取自**投影里那条线程自己的事实**（`existing.channelId`），
          // 而不是调用方入参：回复路径本来就没要求调用方给 `channelId`（见上面的路径分流），
          // 而 `existing` 正是上面归属门刚验证过的那条事实 —— 用入参反而会引入
          // 一个可被伪造的来源，且与 `thread-started` 里记的频道可能不一致。
          const replied = commitMessageSent(existing.channelId, requestedThread, narrowed.content)
          if (!replied.ok) return { kind: 'failed', reason: replied.reason }
          return deliver(
            requestedThread,
            recipientMemberId,
            narrowed.content,
            `${requestedThread}${SOPHIA_REPLY_REF_MARKER}${randomUUID()}`,
            'existing-thread',
            replied.sequence,
            // 两条缺口都已关闭 ⇒ 不再带任何 gaps（不是漏填）。
            [],
          )
        }
      }

      // ⚠ 顺序：**先判 `threadId` 是否真实存在**，再判新建线程所需的两个必填。
      // 理由是错误信息的相关性：调用方给了 `threadId` 时它的意图是「回复」，
      // 此时「这条线程不存在」才是要解决的问题 —— 先报「缺少 channelId」
      // 会把调用方引向「去补一个新建线程的参数」，而它根本不想新建线程。
      // （这是一条实测纠正：最初的顺序把 `channelId` 缺失排在前面，
      //   于是「回复一条不存在的线程」得到的是 invalid-input 而不是 unknown-thread。）
      if (requestedThread !== undefined) {
        return {
          kind: 'unknown-thread',
          reason:
            `线程 ${requestedThread} 不在账本里（账本里查不到它），因此既不能回复它、`
            + '也不该由调用方指定一个新线程的 id。'
            + '要新建线程请**省略** threadId 并改给 channelId + threadTitle（id 由本工具生成）；'
            + '要回复已有线程请核对 threadId 是否写对。'
            + '（本工具不接受自造 id：账本对同一 threadId 是按覆盖写的，'
            + '一条自造 id 的 thread-started 会静默改写既有线程的频道与标题。）',
        }
      }

      // ── 3. 起线程路径：先把可落账的事实落账 ──
      // 两个必填与频道归属都在**落账之前**判完 —— 免得留下一条「线程已建、但频道不合法」的半截事实。
      const channelId = narrowed.channelId
      if (channelId === undefined) return invalid(missingFieldReason('channelId'))
      const threadTitle = narrowed.threadTitle
      if (threadTitle === undefined) return invalid(missingFieldReason('threadTitle'))

      const channelLookup = guarded(() => deps.projection.channelTeamOf(channelId))
      if (!channelLookup.ok) {
        return { kind: 'failed', reason: `读频道所属团时抛错：${channelLookup.reason}` }
      }
      const channelTeam = channelLookup.value
      if (channelTeam === null) {
        return {
          kind: 'unknown-channel',
          reason: `频道 ${channelId} 不在账本里（线程必须挂在一个真实存在的频道下）。`,
        }
      }
      if (channelTeam !== deps.caller.teamId) {
        return {
          kind: 'cross-team',
          reason:
            `频道 ${channelId} 属于团 ${channelTeam}，而你是团 ${deps.caller.teamId} 的成员`
            + '（FR-7.2 的隔离口径：不得向别人的团里投消息）。',
        }
      }

      // ⚠ 走到这里只有两种情况：**没给** threadId（正常新建），
      // 或**给了** 但投影不认识它 —— 后者已在上面被拒绝（见那段 `unknown-thread`）。
      // 初版在这里写的是 `requestedThread ?? <新生成>`，即「给了但认不出」也照写，
      // 那是一条**真实缺陷**（OCR 复核 MEDIUM [9]）：
      // ① `threadId` 只要求「非空字符串」⇒ 模型可以自造任意 id（连 `thread-` 前缀都不保证），
      //    而本工具是它唯一的写入点，放行等于让整个线程 id 空间失去约束；
      // ② 更硬的一层：`foldLedgerEvents` 对 threads 表是**按 threadId 覆盖写**
      //    （`src/projection/index.ts:500-516`）⇒ 一条自造 id 的 `thread-started`
      //    会把既有线程的 `channelId` / `title` / `assigneeMemberId` **静默改写**，
      //    而账本不可改写、没有任何东西能纠正它。
      const threadId = `${SOPHIA_THREAD_ID_PREFIX}${randomUUID()}` as ThreadId
      let sequence: number
      try {
        const receipt = deps.ledger.commit({
          kind: 'team/thread-started',
          actor: { kind: 'member', memberId: deps.caller.memberId },
          occurredAt: deps.now(),
          data: { threadId, channelId, title: threadTitle, assigneeMemberId: recipientMemberId },
        })
        sequence = receipt.sequence
      } catch (error) {
        return { kind: 'failed', reason: `写 team/thread-started 失败：${describeError(error)}` }
      }

      // ── 起线程路径的第二条事实：这条正文就是**该线程的第一条消息** ──
      //
      // 为什么必须写：不写的话，**只有回复过的线程**才会有消息，而未回复的线程
      // （绝大多数线程只有一条消息）在界面上仍然是一条都没有 ⇒ 消息流照旧是空的，
      // 「补生产者」这件事等于白做。
      //
      // 顺序与失败处置：`thread-started` 已在上面落账且**不回滚**（账本不可改写）。
      // 若这一条失败，只能如实回报 `failed` —— 结果是「线程建了、首条消息没落」，
      // 一个**半截事实**。这里不做「先写消息再写线程」的调换，理由是：
      // ① 消息表里会出现一条指向**不存在线程**的记录（`projectChannelMessages`
      //    只要 `channelId` 匹配就会把它带回界面 ⇒ 界面出现孤儿消息）；
      // ② 线程表才是「这条线程存在」的判据，颠倒会让 `threadOf` 在一次成功调用后
      //    仍查不到线程（回复路径立刻不可用）。
      // 两种半截之间选「线程在、消息缺」，因为它是**可被后续事件纠正**的那一种
      // （再回复一次即可补上），而孤儿消息只会一直挂在界面上。
      const firstMessage = commitMessageSent(channelId, threadId, narrowed.content)
      if (!firstMessage.ok) return { kind: 'failed', reason: firstMessage.reason }
      sequence = firstMessage.sequence

      return deliver(
        threadId,
        recipientMemberId,
        narrowed.content,
        `${threadId}@${String(sequence)}`,
        'new-thread',
        sequence,
        // 正文已落账（`team/message-sent`）⇒ 原 `CONTRACT-GAP[message-body]` 关闭，不再带 gaps。
        [],
      )
    },
  }
  return sophiaToolDescriptor(definition)
}
