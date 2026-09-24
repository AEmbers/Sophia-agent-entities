/**
 * 上游 `slots.ts` 的索菲亚版 —— 移植页面的 **props 契约**。
 *
 * ## 为什么这份不是逐字照抄（必须说清）
 *
 * 上游 `slots.ts` 是**整个上游客户端**的 props 总表：它的 import 块一口气拉进
 * 44 个 `@wowyuarm/dsh-agent-team/types` 里的请求/结果类型
 * （`AgentTeamAddMemberRequest`、`AgentTeamArchiveChannelRequest`、
 * `AgentTeamJoinChannelRequest`、`AgentTeamPutAttachmentRequest` …）。
 *
 * 那些类型描述的是**索菲亚根本没有的宿主路由**。若照抄，
 * 本文件会变成一份 44 项的**假契约**：类型上存在、宿主永远不会实现，
 * 而每个读者都会以为「索菲亚能做这些」。本仓的纪律（`view-model.ts` 文件头、
 * `bridge.ts` 的模型目录桩）都是同一条：**没有的事实不要声明成有**。
 *
 * ⇒ 本文件只声明**本次两页真的会用到的**那一部分，并逐项注明索菲亚的对应物。
 * 被剥掉的上游 prop 见 `TeamConversationProps` 下方的清单。
 *
 * ## 上游 `PropsRuntime` / `PropsLocale` 去哪了
 *
 * 它们来自 `@deepseek-ai/dsh-client-ui-slots`。索菲亚**没有**这个包的类型
 * （`upstream-modules.d.ts` 只声明了 `ui-primitives` 与 `ui-model-selection`），
 * 而且该说明符不在 `tsdown.config.ts` 的 `PLATFORM_MODULES` 里 ⇒
 * 值导入会被构建期 `sophia-client-bundle-purity` 拒绝。
 * 上游用它拿到的其实只有两样东西：`t`（翻译函数）与槽位运行期注入的其余字段。
 * 索菲亚两样都由**自己的**层提供：`t` 走 `../bridge.ts`（中文字典），
 * 其余字段由调用方（父 agent 在 `panel.tsx` 里接线）显式传入。
 *
 * @module @sophia/core/client/vendor/team/slots
 */

import type { AgentTeamChannelRef, AgentTeamClientMemberStatus, AgentTeamInbox, AgentTeamInboxActor, AgentTeamMessage, AgentTeamTask, AgentTeamThread, AgentTeamThreadHistory, AgentTeamThreadObservations, AgentTeamTaskRef, AgentTeamThreadRef, AgentTeamMemberId } from './agent-team-types.ts'
import type { TeamDraftStore } from './drafts.ts'
import type { WireMember } from '../../../wire.ts'
import type { TeamNavigationActions, TeamNavigationSnapshot } from './navigation.ts'

/** 上游从宿主槽位运行期拿到的通用结果形状（`RemoteResult<T>`）。 */
export type TeamRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } }

/**
 * 「变了」的通知来源。
 *
 * 上游这里是 `dsh-typert-protocol` 的 `RemoteResult` + 一套按作用域分片的
 * 变更订阅（`{kind:'thread'|'workspace'|'presence', …}`）。
 * 索菲亚的对应物是 `PanelStore.subscribe`：它**只有一个**无作用域的订阅
 * （`panel-store.ts:100`，文件头说明了「只用 React 的 hook 订阅我们自己知道
 * 何时变化的那一个值」）。⇒ 上游的三条按作用域分片的订阅在索菲亚**塌缩成一条**，
 * 而「作用域粒度」这个上游优化（避免 presence epoch 吞掉 ledger sequence，
 * 见 `scope-coverage.ts`）在索菲亚没有对应事实。
 */
export type TeamChangeListener = (update: TeamChangeUpdate) => void

/** 一次「变了」的载荷。上游区分 `version` / `failed` / 具体 kind，索菲亚只有版本与失败。 */
export interface TeamChangeUpdate {
  readonly type: 'changed' | 'failed'
  /** `type === 'changed'` 时的唤醒版本号（单调递增）。 */
  readonly version?: number | undefined
  /** `type === 'failed'` 时的可读原因。 */
  readonly message?: string | undefined
}

/**
 * 订阅「变了」。返回值是取消订阅的 disposer。
 *
 * ⚠ 上游签名是 `(scope: TeamChangeScope, listener) => disposer`。索菲亚收了
 * **一个 `scope` 参数**（见 `TeamChangeListener` 的说明）。为了让移植后的调用点
 * 尽量少改，`scope` 仍然收下 —— 但它是**被忽略的**：
 * 索菲亚面板一次只显示一个团，没有按作用域分片的唤醒流。
 * 忽略而不是删参数，是为了让调用点的三处 `subscribeChanges({kind:…}, …)`
 * 保持原样，一看就知道对应上游哪一行。
 */
export type SubscribeTeamChanges = (scope: unknown, listener: TeamChangeListener) => () => void

/**
 * 导航态来源：上游 `navigation: TeamNavigationSource` 的同款形状。
 *
 * ⚠ 索菲亚这里把 `getSnapshot` 的返回类型**收窄成 `TeamNavigationSnapshot`**：
 * 上游那一份写的就是具体快照类型，而索菲亚初版移植时写成了 `unknown` ——
 * 那是**结构性不可用**的声明（`useSyncExternalStore` 会把 `unknown` 交给消费者，
 * `state.mode` 当场 TS18046）。现在它由真的消费者钉住：
 * `TeamFooterAction.tsx` 读 `mode` 决定「进入 / 离开团队模式」，
 * `TeamConversation.tsx` 按 `inbox` / `channelRef` / `threadRef` 选页。
 */
export interface TeamNavigationSource {
  getSnapshot: () => TeamNavigationSnapshot
  subscribe: (listener: () => void) => () => void
}

/**
 * 会话座（Thread / 收件箱两页）的 props。
 *
 * 与上游 `TeamConversationProps` 的**逐项对照**在下表；表外的上游成员即「被剥掉的」。
 *
 * | 本文件成员 | 索菲亚的实现 |
 * |---|---|
 * | `loadThreadHistory` | `PanelStore` 快照 → `adapters.toThreadHistory` |
 * | `readThread` | 同上（并额外做一次 `store.load()` 拉新） |
 * | `loadMembers` | 快照 → `adapters.rosterOf` |
 * | `loadChannels` | 快照（频道/线程视图；索菲亚没有 `includeActivities`/`limit` 语义） |
 * | `loadInbox` | 快照 → `adapters.toInbox`（**恒空队列 + 真实「最近活跃」**） |
 * | `reply` | `POST /api/sophia/team/message`（索菲亚路由；见 `requests.ts`） |
 * | `subscribeChanges` | `PanelStore.subscribe` |
 * | `threadObservations` | 快照派生（索菲亚没有 attention 模型，见 `adapters.ts`） |
 */
export interface TeamConversationProps extends TeamNavigationActions {
  /** 翻译函数（索菲亚中文字典，见 `../bridge.ts`）。 */
  readonly t: (key: string, params?: Record<string, unknown>) => string
  /** 草稿缓存（本地 UI 便利状态，见 `drafts.ts`）。 */
  readonly drafts: TeamDraftStore
  /** 变更唤醒。 */
  readonly subscribeChanges: SubscribeTeamChanges
  /** 读线程历史（索菲亚从面板快照派生）。 */
  readonly loadThreadHistory: (request: { readonly threadRef: AgentTeamThreadRef }) => Promise<TeamRemoteResult<AgentTeamThreadHistory>>
  /** 读线程的当前投影。索菲亚没有「有界读 + 已读水位」⇒ 返回全量事实。 */
  readonly readThread: (request: { readonly threadRef: AgentTeamThreadRef }) => Promise<TeamRemoteResult<TeamThreadReadResult>>
  /** 读成员名册。 */
  readonly loadMembers: () => Promise<TeamRemoteResult<readonly AgentTeamClientMemberStatus[]>>
  /** 读频道/线程视图。 */
  readonly loadChannels: (request: { readonly channelRef?: AgentTeamChannelRef | undefined; readonly threadRef?: AgentTeamThreadRef | undefined }) => Promise<TeamRemoteResult<TeamChannelView>>
  /**
   * 读**频道页的时间线**（上游 `loadChannels({workspaceId, channelRef, direction,
   * topLevelOnly, includeActivities, limit})` 的对应物）。
   *
   * ⚠ 索菲亚把上游那一个方法**一分为二**（这是本文件里唯一一处刻意的双方法设计）：
   *
   * - `loadChannels`（上面那条）只给**频道名与线程 ref 列表** —— 它的消费者是
   *   Thread 页（面包屑与频道名），已经存在且形状已定；
   * - `loadChannelTimeline`（本条）给**频道页要的整条时间线**（消息 + 线程 + 任务）。
   *
   * 为什么不分给 `loadChannels` 加一个 `items` 字段：那会改动 Thread 页已在吃的
   * 契约（`TeamChannelView`），把一个**与它无关**的字段塞进它的返回形状里。
   * 索菲亚的纪律是「一个事实一个真相」，但**两个不同的消费面**本来就该有两条
   * 各自的读法 —— 上游把它们塞进同一个 `AgentTeamView` 是因为上游的
   * `Workspace` 分片让这两件事天然同源，而索菲亚没有那一维。
   */
  readonly loadChannelTimeline: (request: { readonly channelRef: AgentTeamChannelRef }) => Promise<TeamRemoteResult<TeamChannelTimeline>>
  /** 读收件箱。**索菲亚没有 Workspace 分片** ⇒ 一次调用给整个团的收件箱。 */
  readonly loadInbox: () => Promise<TeamRemoteResult<AgentTeamInbox>>
  /**
   * 发一条消息。
   *
   * ⚠ 上游的 `reply` 返回一个**判别联合**（`committed` / `confirmation_required` /
   * `unread_required` / `stale_revision` / `member_not_following`）。
   * 索菲亚只有两种结果：**落盘**或**失败**（见 `requests.ts` 的说明）。
   * ⇒ `TeamReplyResult` 相应收窄，调用点的 `kind` 分支整批剥掉。
   */
  readonly reply: (request: TeamReplyRequest) => Promise<TeamRemoteResult<TeamReplyResult>>
  /** 「关注者」排序提示（索菲亚由消息发送者派生，非账本事实；见 `adapters.ts`）。 */
  readonly threadObservations: (request: { readonly threadRef: AgentTeamThreadRef }) => Promise<TeamRemoteResult<AgentTeamThreadObservations>>
  /**
   * 待发文件的字节数选项。
   *
   * ⚠ 上游这里是一整条**附件上传链**（`putAttachment` / `getAttachment` /
   * `uploadComposerFiles`，55KB 的 `TeamThreadPage` 里有 7 处）。
   * 索菲亚**没有附件路由**（见 `requests.ts`）⇒ 附件能力整体剥掉，
   * composer 只保留「选文件 → 显示 chip」的本地 UI（不假装能上传）。
   */
  readonly attachmentEnabled?: boolean | undefined
  /**
   * 附件**读取**面（上游 `TeamConversationProps['getAttachment']`）。
   *
   * ⚠ **索菲亚宿主没有这条路由**（`src/host.ts` 的 `ROUTE_PREFIX` 注册清单：
   * `status` / `view` / `avatar` / `member/model` / `spawn/decision` / `channel` /
   * `member` / `member/lifecycle` / `dag/ownership` / `team/message` —— 没有
   * `putAttachment` / `getAttachment`）⇒ 本成员**声明为可选且恒不传**。
   *
   * 声明形状（而不是继续删掉）是为了让移植进来的上游 UI
   * （`TeamMessage.tsx` 的附件 strip、`TeamThreadPage.tsx` 的 `loadAttachment`）
   * **整份保留**：缺席时它们走「无数据」分支（chip / 不渲染），
   * 宿主补上附件面后接线即可用。与 `attachmentEnabled` 的分工：
   * 那一项管「composer 能不能选文件」，本项管「已有附件能不能读回」。
   */
  readonly getAttachment?: ((request: { readonly attachmentId: string }) => Promise<TeamRemoteResult<{ readonly bytesBase64: string; readonly mediaType: string }>>) | undefined
  /**
   * ref 解析面（上游 `TeamConversationProps['resolveTaskRefs'] / ['resolveThreadRefs']`）。
   *
   * ⚠ 索菲亚**没有**这条路由（同上清单，没有任何 resolve 端点）⇒ 可选且恒不传；
   * `refs.ts` 的 `hostTaskRefLookup` / `hostThreadRefLookup` 因此收成 no-op
   * （见那个文件的说明）。形状按上游一对一映射保留。
   */
  readonly resolveTaskRefs?: ((request: import('./agent-team-types.ts').AgentTeamResolveTaskRefsRequest) => Promise<TeamRemoteResult<import('./agent-team-types.ts').AgentTeamResolveTaskRefsResult>>) | undefined
  readonly resolveThreadRefs?: ((request: import('./agent-team-types.ts').AgentTeamResolveThreadRefsRequest) => Promise<TeamRemoteResult<import('./agent-team-types.ts').AgentTeamResolveThreadRefsResult>>) | undefined
  /**
   * 把成员会话嵌进会话座（上游 `TeamConversationProps['openMemberSession']`）。
   *
   * ⚠ 索菲亚**没有**这条路：`WireMember` 没有 `sessionId`（见 `../../wire.ts`），
   * `refs.ts` 的 `ResolvedMemberRef.openable` 因此恒 `false`
   * ⇒ 成员 chip 永远渲染成「有标签但不可点的 span」（上游自带的那一支）。
   * 形状保留，宿主接上成员会话后即可用。
   */
  readonly openMemberSession?: ((sessionId: import('@deepseek-ai/dsh-session/types').SessionId) => void) | undefined
  /**
   * 在**频道里发一条新帖**（= 开一个新线程）。
   *
   * ⚠ 上游对应物是 `sendMessage(AgentTeamSendMessageRequest)`，它是
   * 频道页 composer 的提交路径（`TeamChannelPage.tsx:352`）。
   *
   * ⚠⚠ **索菲亚宿主没有这条路由**（如实说明，不是占位符）：
   * 唯一的发送路由 `POST /api/sophia/team/message` 的请求体是
   * `{threadRef, body, recipients}` 且 `threadRef` **必填**
   * （`src/host-data.ts:746` 的 `parseSendTeamMessageRequest` 判它非空，
   * 空值当场 400）⇒ 它只能**往已有线程**里发，而「频道顶楼发帖」的语义是
   * **开一个新线程**，索菲亚没有对应的写入面（`team/thread-started` 只有
   * 建队时那一条）。
   *
   * ⇒ 索菲亚的 `createTeamDataSource` **不提供**这个 prop，频道页 composer 因此
   * 走「如实报错」分支（与 `bridge.ts` 的 `HALT_URL` / `TEAM_HALT_AVAILABLE`
   * 同一处置手法：不假装能发，也不把按钮删掉让人猜为什么没有）。
   * 宿主补上该路由后，只需在 `index.ts` 里实现这一个方法，界面一行不用动。
   */
  readonly sendChannelMessage?: ((request: TeamSendChannelMessageRequest) => Promise<TeamRemoteResult<TeamSendChannelMessageResult>>) | undefined
}

// ────────────────────────────────────────────────────────────────────────────
// 被剥掉的上游 props（逐项 + 理由；**不静默删**）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 上游 `TeamConversationProps` 里**本次不接**的成员，与理由：
 *
 * - `navigation: TeamNavigationSource` —— 上游用 `useSyncExternalStore` 订阅一个
 *   全局导航快照。索菲亚的导航态由 `TeamNavigation`（`navigation.ts`，**本文件的
 *   兄弟文件，已移植**）拥有，调用方直接调它的 actions，不需要再传一个 source。
 * - `sendMessage` / `joinChannel` / `removeChannelMember` —— 频道成员任意进出
 *   在索菲亚的「成员属团 + 两阶段审批」模型下没有对应事实（成员加入要建团审批，
 *   不是加入频道）⇒ 剥掉。
 * - `changeTask` / `promoteThread` —— 索菲亚的任务由 `sophia-engine-dag` 拥有，
 *   宿主**没有**「把线程提升成任务」/「改任务状态」的路由 ⇒ 剥掉。
 *   界面上对应的两个动作区（Thread 页的 promote 与 accept/close/reopen）随之剥掉。
 * - `putAttachment` / `getAttachment` —— 见 `attachmentEnabled` 的说明。
 * - `resolveTaskRefs` —— 索菲亚没有按 ref 解析并跳转的宿主路由 ⇒ 剥掉；
 *   `task-refs.ts` 相应收窄成「只读缓存」。
 * - `openMemberSession` —— 索菲亚没有「把成员会话嵌进会话座」这条路 ⇒ 剥掉。
 * - 所有 `PropsRuntime` / `PropsLocale` 的宿主注入字段 —— 见文件头。
 */

// ────────────────────────────────────────────────────────────────────────────
// 本次两页需要的请求/结果形状（**索菲亚版**，不是上游那 44 个）
// ────────────────────────────────────────────────────────────────────────────

/** 发消息请求。`recipients` 是结构化提及的成员 id 集合。 */
export interface TeamReplyRequest {
  readonly threadRef: AgentTeamThreadRef
  readonly body: string
  readonly recipients: readonly AgentTeamMemberId[]
}

/**
 * 「在频道里发新帖」请求。
 *
 * ⚠ 上游的对应物是 `AgentTeamSendMessageRequest`，它比这里多
 * `workspaceId` / `requestId` / `asTask` / `attachments` 四个字段 ——
 * 索菲亚一个都没有对应事实（没有 Workspace 维、没有幂等键、没有服务端开工单、
 * 没有附件路由，见 `requests.ts` 的逐项说明）⇒ 整批剥掉。
 */
export interface TeamSendChannelMessageRequest {
  readonly channelRef: AgentTeamChannelRef
  readonly body: string
  readonly recipients: readonly AgentTeamMemberId[]
}

/** 「在频道里发新帖」结果。索菲亚只有「落盘」一种成功形态（同 `TeamReplyResult`）。 */
export interface TeamSendChannelMessageResult {
  readonly kind: 'committed'
  /** 新开的那个线程（上游由 Host 回，索菲亚若补了路由也应由 Host 回）。 */
  readonly threadRef: AgentTeamThreadRef
}

/** 发消息结果。索菲亚只有「落盘」一种成功形态（无确认挑战、无 revision 围栏）。 */
export interface TeamReplyResult {
  readonly kind: 'committed'
  /** 落盘后的新事实（调用方据此推进时间线，而不是等下一次轮询）。 */
  readonly messageSequence: number
  readonly occurredAt: string
}

/**
 * 线程的当前投影。
 *
 * ⚠ 上游 `AgentTeamThreadReadResult` 有 `anchor` / `anchorMentions` /
 * `claims` / `receipt` / `readThroughSequence` / `earlierFactCount` /
 * `attention` / `consumedDirectMarkers` / `contextAdvice` / `remainingUnreadCount`
 * —— **索菲亚一个都没有**（没有锚点、没有 claim、没有已读水位、没有上下文建议）。
 * ⇒ 这里只留索菲亚真有的两项，其余调用点分支剥掉。
 */
export interface TeamThreadReadResult {
  /** 时间线事实（**只有 message 一种 kind**，见 `agent-team-types.ts`）。 */
  readonly facts: readonly import('./agent-team-types.ts').AgentTeamThreadFact[]
  /** 该线程对应的任务（索菲亚按同频道同标题唯一匹配得出，见 `adapters.ts`）。 */
  readonly task?: import('./agent-team-types.ts').AgentTeamTask | undefined
}

/** 频道/线程视图。索菲亚的对应物是 `WireTeam` 的一个子集。 */
export interface TeamChannelView {
  readonly channels: readonly { readonly channelRef: AgentTeamChannelRef; readonly name: string; readonly threads: readonly AgentTeamThreadRef[] }[]
  readonly members: readonly { readonly channelRef: AgentTeamChannelRef; readonly memberId: AgentTeamMemberId }[]
}

// ────────────────────────────────────────────────────────────────────────────
// 频道页的时间线（上游 `AgentTeamView` / `AgentTeamViewItem` 的索菲亚版）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 频道时间线的一条 —— 上游 `AgentTeamViewItem` 的索菲亚版。
 *
 * 字段名**与上游逐字对齐**，这样 `TeamChannelPage.tsx` 的渲染层几乎不用改；
 * 与上游的差异逐条列在这里（每条都是「索菲亚没有那个事实」）：
 *
 * | 上游字段 | 索菲亚 |
 * |---|---|
 * | `message.messageRef` | `message.messageId`（`agent-team-types.ts` 的 `AgentTeamMessageRef`） |
 * | `message.sequence` | 索菲亚 `WireMessage` **没有**序号 ⇒ 适配层用「本条在其线程里的位次」 |
 * | `message.topLevel` | 索菲亚**没有**「顶楼 / 回复」这个分类 ⇒ 适配层恒 `true`（见 `toChannelTimeline` 的说明） |
 * | `message.attachments` | **没有**附件路由 ⇒ 适配层给空数组 |
 * | `message.sender` | `message.senderMemberId`（`''` = 人类，见 `adapters.actorOf`） |
 * | `taskRef` / `taskNumber` | 索菲亚的 `WireTask` **没有** ref、也**没有**序号 ⇒ 用 `taskId`、`taskNumber` 恒 `undefined` |
 * | `claimOwners` | **没有** claim 模型 ⇒ 恒空数组 |
 * | `lastActivityAt` | 派生（该线程最后一条消息的时间），不是新事实 |
 */
export interface TeamChannelTimelineItem {
  readonly message: AgentTeamMessage
  /**
   * 本条消息时间的 **ISO 串**。
   *
   * ⚠ 上游这里直接读 `message.occurredAt`（上游是 ISO 串）。索菲亚的
   * `WireMessage.occurredAt` 是 **epoch 毫秒** ⇒ 换算在适配层做一次
   * （`adapters.isoFromMs`，与 `AgentTeamInboxItem.newestOccurredAt` 同一手法），
   * 而不是让界面在每个 `new Date(...)` / `isRunGap(...)` 处各自换算 ——
   * 那会把「时间是什么形状」变成 20 个调用点各自的判断。
   */
  readonly messageOccurredAt: string
  readonly thread: AgentTeamThread
  readonly task?: AgentTeamTask | undefined
  /** 索菲亚没有任务序号 ⇒ 恒 `undefined`（界面据此不画「任务 #N」）。 */
  readonly taskNumber?: number | undefined
  /** 索菲亚没有 claim 模型 ⇒ 恒空数组。 */
  readonly claimOwners: readonly AgentTeamInboxActor[]
  /** 该线程最后一条消息的 ISO 时间；与 `message.occurredAt` 相同表示「没有后续活动」。 */
  readonly lastActivityAt?: string | undefined
  /** 索菲亚没有「顶楼 / 回复」分类 ⇒ 恒 `true`（见 `toChannelTimeline`）。 */
  readonly topLevel: boolean
  /** 结构化 @提到：索菲亚没有 ⇒ 恒空数组。 */
  readonly mentions: readonly AgentTeamMemberId[]
}

/**
 * 频道页的时间线载荷 —— 上游 `AgentTeamView` 的索菲亚版。
 *
 * ⚠ 上游这个形状**按 Workspace 分片**（`workspaceId` 是每个请求的必填参数），
 * 索菲亚**没有 Workspace 这一维**（一个团一个视图，见 `index.ts` 文件头）⇒
 * `workspaceId` 整个字段剥掉。
 *
 * ⚠ 上游的 `channels` / `members` 是「这个 Workspace 的频道表 + 频道成员关系」。
 * 索菲亚的对应物见 `TeamChannelView`：`channels` 有（`WireChannel`），
 * **频道 × 成员关系没有**（成员属团，不属频道）⇒ 这里给的是
 * 「这个团的所有成员都可达」的**团级事实**的频道视图（与 `index.ts` 的
 * `loadChannels` 同一个口径，不虚构一份频道成员表）。
 */
export interface TeamChannelTimeline {
  readonly channelRef: AgentTeamChannelRef
  /** 频道名（上游 `AgentTeamChannel.name` ←→ 索菲亚 `WireChannel.title`）。 */
  readonly name: string
  readonly channels: readonly { readonly channelRef: AgentTeamChannelRef; readonly name: string }[]
  readonly members: readonly { readonly channelRef: AgentTeamChannelRef; readonly memberId: AgentTeamMemberId }[]
  /**
   * 人类（主人）在这个团里的成员 id。
   *
   * ⚠ 索菲亚的值是**空串**：宿主把人类消息的 `senderMemberId` 写成 `''`
   * （唯一真相在账本基座的 `actor = { kind: 'human' }`，见 `adapters.actorOf` 的说明）。
   * ⇒ 这里给 `''` 是**与那条既有约定同源**，不是另立一个哨兵。
   */
  readonly humanMemberId?: AgentTeamMemberId | undefined
  readonly items: readonly TeamChannelTimelineItem[]
  /** 上游的翻页游标。索菲亚的线格式一次给全量 ⇒ 适配层给 `items.length`。 */
  readonly cursor: number
  /** 恒 `false`：索菲亚没有分页（同 `AgentTeamThreadHistory.hasMore`）。 */
  readonly hasMore: boolean
}

/** 索菲亚交付这个 props 包的深拷贝安全说明（父 agent 接线时读这一段）。 */
export const TEAM_PROPS_SOURCE = 'PanelStore.getSnapshot().view → adapters.ts' as const

// ════════════════════════════════════════════════════════════════════════════
// 左栏（侧边栏）的 props —— 上游 `TeamSidebarProps` / `TeamSettingsProps` /
// `TeamFooterProps` 的索菲亚版
//
// 上游这三个类型是「整个上游客户端侧栏」的 props 总表：`TeamSidebarProps` 一项
// 就带 20 个 Remote 方法（`addMember` / `updateChannel` / `archiveChannel` /
// `joinWorkspace` / `leaveWorkspace` / `loadModels` / `openMemberSession` …），
// 全部来自 `@wowyuarm/dsh-agent-team/types` 的 44 个请求/结果类型。
//
// 那一整套**索菲亚宿主没有**（`src/host.ts` 只注册 10 条路由，逐条见
// `bridge.ts` 的清单）。照抄就会得到一份 20 项的**假契约**：类型上存在、
// 宿主永远不会实现，而每个读者都会以为索菲亚能做这些。
// ⇒ 同 `TeamConversationProps` 的处置：**只声明索菲亚真有的那一部分**，
// 被剥掉的逐项列在下面「被剥掉的左栏 props」里（**不静默删**）。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 「工作区」在索菲亚 = **一个团**（`WireTeam`）。
 *
 * 上游的 Workspace 是「一个仓库目录」，Channel / Agent 都属于它。索菲亚
 * `WireView.teams` 是一个**团数组**，每个团自带 channels / members
 * ⇒ 左栏那个「工作区」选择器在索菲亚语义上是**选哪个团**
 * （与 `index.ts` 文件头「把 Workspace 这一维收敛成选哪个团」同一句话）。
 *
 * ⚠ 类型本体是 `TeamWorkspaceChoice`，**定义在它的消费者旁边**
 * （`TeamWorkspaceSelector.tsx`，与上游同一位置）。这里**不另立一个同形类型**：
 * 两个名字装同一件事就是「第二个真相」，而它们之间一旦漂移，
 * `TeamWorkspaceBrowser` 传给选择器时才会在调用点报错 —— 那时已经太晚。
 *
 * `workspaceId` 因此装的是 `WireTeam.teamId`；`path` 索菲亚没有
 * （见 `TeamWorkspaceChoice.path`），适配层给 `''`。
 */

/** 读成员名册。`workspaceId` = 读哪个团。 */
export interface TeamMembersRequest {
  readonly workspaceId: string
}

/**
 * 读频道/线程视图。
 *
 * 上游还有 `limit` / `includeActivities` / `direction` 等分页与筛选参数；
 * 索菲亚的线格式**一次给全量**（`WireTeam.channels` 就是全表）⇒
 * `limit` 收下但被忽略（保留是为了让 `TeamChannelsPanel` 的调用点与上游逐字对应：
 * 它写的是 `loadChannels({ workspaceId, limit: 1 })`）。
 */
export interface TeamViewRequest {
  readonly workspaceId: string
  readonly limit?: number | undefined
}

/** 读收件箱。`limit` 同理被忽略（索菲亚没有分片读）。 */
export interface TeamInboxRequest {
  readonly workspaceId: string
  readonly limit?: number | undefined
}

/**
 * 建频道请求。
 *
 * ⚠ 上游这个请求有 `requestId`（幂等键）+ `name` + `description` + `memberIds`。
 * 索菲亚的路由 `POST /api/sophia/channel` 只接受 `{teamId, title}`
 * （`src/host.ts` 的 `channelRoute`，客户端侧 `panel-store.ts:549`
 * 的 `requestCreateChannel(teamId, title)`）⇒
 * `requestId` 剥掉（宿主不接受或不认识，**理由见 `requests.ts` 的幂等键说明**）、
 * `description` 与 `memberIds` 剥掉（索菲亚的频道没有描述，也没有频道成员关系）。
 * 留下 `title` —— 上游那个字段叫 `name`，**改名不是笔误**：索菲亚线格式与路由
 * 都用 `title`（见 `agent-team-types.ts` 的 `AgentTeamChannel` 说明）。
 */
export interface TeamCreateChannelRequest {
  readonly workspaceId: string
  readonly title: string
}

/**
 * 加成员请求。
 *
 * ⚠ 上游是 `{requestId, workspaceId, handle, description, presetId, channelRefs, model}`。
 * 索菲亚的路由 `POST /api/sophia/member` 只接受 `{teamId, position}`
 * （`panel-store.ts:553` 的 `requestAddMember(teamId, position)`），
 * 而 `position` 是**职位名**：宿主用它跑命名门禁并派生命名
 * （见 `src/naming.ts` 的 `POSITIONS`）⇒ 界面上那个「名称」输入框在索菲亚
 * 对应**职位名**。`presetId` / `channelRefs` / `model` 索菲亚都没有
 * （成员与频道无成员关系；成员模型跟随全局默认，见 `bridge.ts` 的模型目录桩）。
 */
export interface TeamAddMemberRequest {
  readonly workspaceId: string
  readonly position: string
}

/**
 * 改成员生命周期。
 *
 * ⚠ 上游把这件事拆成三个 Remote（`recoverMember` 重启、`archiveMember` 归档、
 * `leaveWorkspace` 退出工作区）。索菲亚只有**一条**路由
 * `POST /api/sophia/member/lifecycle`，接受 `{memberId, action}`，
 * `action ∈ {'suspend'|'resume'}`（`panel-store.ts:557` 的 `requestLifecycle`）。
 *
 * ⇒ 三个上游动作**收敛成这一个**：`resume` 覆盖「恢复」（上游 restart/resume
 * 在索菲亚是同一条 `resume`），`suspend` 覆盖「停用」。
 * **不提供** `archive` —— 索菲亚的归档是墓碑（不可逆），而 `suspend` 是可逆的，
 * 把它们做成同一个按钮会让「归档」这个名字承诺一件做不到的事。
 */
export interface TeamMemberLifecycleRequest {
  readonly memberId: AgentTeamMemberId
  readonly action: 'suspend' | 'resume'
}

/**
 * 左栏 props。
 *
 * | 本文件成员 | 索菲亚的实现 |
 * |---|---|
 * | `navigation` | `TeamNavigation`（`navigation.ts`）实例本身 |
 * | `workspaces` | 快照 → `adapters.workspacesOf`（全部团） |
 * | `loadMembers` / `loadChannels` / `loadInbox` | 快照 → `adapters`（按 `workspaceId` 选团） |
 * | `subscribeChanges` | `PanelStore.subscribe` |
 * | `createChannel` | `POST /api/sophia/channel`（**真实路由**） |
 * | `addMember` | `POST /api/sophia/member`（**真实路由**） |
 * | `setMemberLifecycle` | `POST /api/sophia/member/lifecycle`（**真实路由**） |
 * | `wide` / `expandSidebar` | 见下面各自的说明（宿主侧栏运行期注入的替代物） |
 */
export type TeamSidebarProps = TeamNavigationActions & {
  /** 翻译函数（与 `TeamConversationProps['t']` **同一个形状**，不另立一个）。 */
  readonly t: TeamConversationProps['t']
  /** 导航态来源（`TeamFooterAction` 读 `mode`，`TeamWorkspaceBrowser` 读其余面）。 */
  readonly navigation: TeamNavigationSource
  /**
   * 是否宽版（卡片形态）。
   *
   * ⚠ 上游这个 prop 来自宿主槽位的运行期注入（`PropsRuntime<'sidebar.workspaces'>`），
   * 由宿主根据侧栏是「展开的卡片」还是「36px 图标轨」给出。
   * 索菲亚的面板**不是宿主侧栏的 rail**（它是面板主体，见 `panel.tsx`），
   * 面板里没有「折叠成图标轨」这个宿主状态 ⇒ 由调用方显式给值，
   * `createTeamSidebarSource` 给 `true`（宽版）。窄版分支（`!wide` 的
   * `.railWorkspace`）因此在本构建里**结构保留、数据上不可达** —— 如实记录，
   * 不删代码：删了将来接上 rail 就要重写一遍。
   */
  readonly wide: boolean
  /** 请求把侧栏展开（窄版图标点击时调）。索菲亚恒宽版 ⇒ 数据源给空实现。 */
  readonly expandSidebar: () => void
  /** 可选的工作区（= 团）列表，顺序即渲染顺序。类型本体见 `TeamWorkspaceChoice`。 */
  readonly workspaces: readonly import('./TeamWorkspaceSelector.tsx').TeamWorkspaceChoice[]
  readonly loadMembers: (request: TeamMembersRequest) => Promise<TeamRemoteResult<readonly AgentTeamClientMemberStatus[]>>
  readonly loadChannels: (request: TeamViewRequest) => Promise<TeamRemoteResult<TeamChannelView>>
  readonly loadInbox: (request: TeamInboxRequest) => Promise<TeamRemoteResult<AgentTeamInbox>>
  readonly subscribeChanges: SubscribeTeamChanges
  readonly createChannel: (request: TeamCreateChannelRequest) => Promise<TeamRemoteResult<void>>
  readonly addMember: (request: TeamAddMemberRequest) => Promise<TeamRemoteResult<void>>
  readonly setMemberLifecycle: (request: TeamMemberLifecycleRequest) => Promise<TeamRemoteResult<void>>
  /**
   * 「换模」（索菲亚独有能力，2026-09-24 从旧团队卡搬进左栏）。
   *
   * 语义与 `seats.tsx` 的 `onSwitchModel` 一致：交回**整个 WireMember**
   * （调用方要读 `member.model` 当提交目标），不在中间层折断语义。
   * 不是选型器 —— 索菲亚没接模型目录（见 locales 的 `sidebarModelCatalogUnavailable`）。
   * 可选：调用方不给 ⇒ 行菜单不画这一项（与「回调缺省 ⇒ 不画入口」同一纪律）。
   */
  readonly switchModel?: ((member: WireMember) => void) | undefined
}

/**
 * 底部「成员」入口的对话框要的一组名册。
 *
 * ⚠ 上游这个类型带 `workspaceId` 是因为上游的成员对话框**跨工作区**分组
 * （一个 Workspace 一组）。索菲亚一个团一个视图 ⇒ 调用方给**一组**
 * （`workspaceId` 装团 id，见 `TeamSidebarWorkspace`）。
 * 形状保持上游一致，这样 `TeamMembersAction` 的分组渲染一行都不用改。
 */
export interface TeamMemberGroup {
  readonly workspaceId: string
  readonly workspaceTitle: string
  readonly members: readonly AgentTeamClientMemberStatus[]
}

/** 底部「成员」入口（`TeamMembersAction`）的 props。 */
export type TeamSettingsProps = TeamFooterShared & {
  readonly loadMemberGroups: () => Promise<readonly TeamMemberGroup[]>
}

/** 底部两个入口共用的两项（宽窄形态 + 翻译函数）。 */
interface TeamFooterShared {
  readonly wide: boolean
  readonly t: TeamConversationProps['t']
}

/** 底部「对话 / 团队」切换（`TeamFooterAction`）的 props。 */
export type TeamFooterProps = TeamFooterShared & TeamNavigationActions & {
  readonly navigation: TeamNavigationSource
}

// ────────────────────────────────────────────────────────────────────────────
// 被剥掉的左栏 props（逐项 + 理由；**不静默删**）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 上游 `TeamSidebarProps` 里**索菲亚不接**的成员，与理由（宿主路由清单见
 * `bridge.ts` 的「10 条路由」注释，那是地址的唯一真相）：
 *
 * - `updateChannel` —— 索菲亚**没有**改频道名的路由（只有建频道）。
 * - `archiveChannel` —— 索菲亚**没有**归档频道的路由；而且索菲亚的频道
 *   **没有归档态**（见 `agent-team-types.ts` 的 `AgentTeamChannel` 说明），
 *   于是「archived」在索菲亚既是不可写也是不可读的事实。
 * - `joinChannel` / `removeChannelMember` —— 索菲亚**没有频道成员关系**：
 *   成员属团、不属频道（`index.ts` 的 `loadChannels` 也是同一个口径）。
 * - `updateMember` / `recoverMember` / `archiveMember` / `leaveWorkspace`
 *   —— 收敛成 `setMemberLifecycle` 一项，理由见 `TeamMemberLifecycleRequest`。
 * - `joinWorkspace` —— 索菲亚**没有**「把成员加入另一个团」的路由：
 *   成员加入要**建团审批**（`spawn/*` 两阶段），那是 `sophia_spawn_team` 的语义，
 *   不是侧栏能点出来的动作。
 * - `loadModels` —— 索菲亚的 client 半没有接宿主的模型目录服务；
 *   `bridge.ts` 的 `createEmptyModelDirectory()` 是既有的空目录桩
 *   （成员模型跟随全局默认）。上游的创建/编辑表单靠它填下拉框 ⇒
 *   索菲亚的表单不带模型选择器。
 * - `openMemberSession` —— 索菲亚**没有**「把成员会话嵌进会话座」这条路。
 * - `useWorkspaces`（钩子，不是 prop）—— 上游从宿主的 Workspace 目录服务
 *   订阅（`@deepseek-ai/dsh-api-workspace-controller/client`）。索菲亚没有这个包，
 *   而且「工作区」在索菲亚是团（见 `TeamSidebarWorkspace`）⇒ 改成
 *   **显式 prop** `workspaces`（数据由 `adapters.workspacesOf` 给）。
 * - `subscribeReads` —— 上游用它把「刚完成一次 Thread 读」通知给未读徽章。
 *   索菲亚**没有已读水位**（见 `adapters.ts` 的 `toInbox`）⇒ 没有这个事件，
 *   徽章的未读数恒 0。
 * - `selectedChannelRef` —— 上游这里是「外部预设的选中频道」。索菲亚那份由
 *   `navigation.getSnapshot().channelRef` 给定（`TeamWorkspaceBrowser` 就是这么
 *   传给 `TeamChannelsPanel` 的），再传一份 prop 会造出第二个真相。
 * - 所有 `PropsRuntime` / `PropsLocale` 的宿主注入字段 —— 见 `TeamSidebarProps` 的说明。
 */
