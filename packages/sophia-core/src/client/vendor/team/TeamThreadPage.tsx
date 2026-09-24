/**
 * 上游 `TeamThreadPage.tsx`（889 行 / 47.8KB）的索菲亚版 —— **Task / Thread 详情页**。
 *
 * ## ⚠ 先读这一段：本文件与上游的关系
 *
 * 主人的验收口径是「UI 整份复制（不是参考着重写）」。本文件在**能照抄的每一处都照抄了**：
 * 顶层的 `surface` / `surfaceHeader` / `backRow` / `headerRow` / `headerCopy` /
 * `headerActions` / `titleLine` / `taskTitle` / `riskSection` / `riskRow` /
 * `workSection` / `claimList` / `claimRow` / `claimRowDone` / `claimOwner` /
 * `claimDirection` / `claimState` / `emptyClaims` / `timeline` / `timelineContent` /
 * `timelineAction` / `emptySurface` / `loadingState` / `loadingMark` / `errorState` /
 * `error` / `confirmBody` / `confirmList` / `messageRun` / `historySection` /
 * `publicSection` / `unreadBoundary` / `newUpdates` / `newUpdatesJump` / `daySeparator` /
 * `activityRow` / `activityMark` / `activityText` / `closedBar` / `closedNotice` 的
 * **结构、类名、层级、`data-team-thread` / `data-team-closed` 属性全部与上游逐字一致**；
 * `renderFact` / `renderFactBlocks` 的 **run 分组、日分隔、unread boundary、
 * `TeamRunDivider`、`Fragment` 分组**逻辑逐字保留；`useTimelineScroll` 的调用点、
 * `TeamMessage` / `TeamComposer` / `TeamStateDot` / `TeamRunDivider` /
 * `TeamPresenceDot` 的 **props 形状**也逐字保留。
 *
 * ## 三块被剥离功能的**处置**（任务书点名：promote / changeTask / claim）
 *
 * 先查宿主有没有对应事实面 —— **都没有**。可核依据：
 *
 * | 上游功能 | 判定 | 依据（`文件:行号`） |
 * |---|---|---|
 * | `promoteThread`（把线程提升成任务） | 宿主**无**路由 | `src/host.ts:93` 的 `ROUTE_PREFIX` 下只注册了 `status`(:589,:606) / `view`(:623) / `avatar`(:666) / `member/model`(:724) / `spawn/decision`(:785) / `channel`(:871) / `member`(:910) / `member/lifecycle`(:957) / `dag/ownership`(:1003) / `team/message`(:1057) —— **没有** promote |
 * | `changeTask`（accept / close / reopen） | 宿主**无**路由 | 同上清单；**没有**任务状态变更端点。索菲亚的任务状态由 `sophia-engine-dag` 拥有（`src/client/vendor/team/slots.ts:148-150` 的剥离说明） |
 * | claims（认领模型） | 宿主**无**该模型 | `src/client/vendor/team/agent-team-types.ts:305-320` 的 `AgentTeamClaim` 说明：「索菲亚整个 claim 模型都不存在」；索菲亚对应物是 `WireTask.assigneeMemberId`（弱于 claim：无方向、无生命周期、无多所有者）⇒ 适配层恒给空数组，**不**把 assignee 伪装成 claim |
 *
 * ⇒ 处置（**不静默删、也不画点了没反应的按钮**）：
 * - **promote**：按钮**照渲染**（`headerActions` 里，与上游同一位置同一类名），
 *   但 `disabled` + `title` 写明原因（`PROMOTE_UNAVAILABLE_HINT`）。
 * - **changeTask**（验收 / 关闭任务 / 重新打开）：三个按钮**照渲染**，
 *   同样 `disabled` + `title`（`CHANGE_TASK_UNAVAILABLE_HINT`）。
 *   提前验收的那个 `Modal` 确认弹窗**照渲染**（结构不删）。
 * - **claims**：`DisclosureRow` 工作区**照渲染**，标题为 `Claims · 0`
 *   （`taskClaims` 恒空数组 —— 如实反映「索菲亚没有认领模型」），
 *   展开后是上游的 `emptyClaims` 空态文案（`noClaims`）。
 *
 * 用户目标截图里的 `验收` / `关闭任务` / `Claims · 4` 因此**都在**，
 * 只是前两个是明确不可用的（鼠标悬停能看到原因），第三个显示 0（索菲亚真没有认领）。
 *
 * ## 索菲亚移植点（**只允许这几类差异**）
 *
 * | 上游 | 索菲亚 | 依据 |
 * |---|---|---|
 * | `import { Fragment, useCallback, … } from 'react'` | `hooks()` / `react()` 惰性取 | 顶层值导入会多一条顶层模块加载调用，撞红「模块加载调用 ≤ 2」的既有断言（`../../react-runtime.ts` 文件头对照表）。⚠ 本行刻意**不写出那个字面量**（`require` + 左括号）：那条断言是**文本级**的，注释里写了也会被计入。 |
 * | `import { Button, DisclosureRow, IconChevronLeftOutline14, IconChecklistOutline14, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives'` | `primitives.Button` 等（`../bridge.ts` 惰性代理） | 同上 |
 * | `workspaceId`（每个请求必填） | **整个字段去掉** | 索菲亚**没有 Workspace 这一维**（一个团一个视图）；`slots.ts` 的每个 remote 都只收它真有的键 |
 * | `requestId`（幂等键）/ `baseRevision`（乐观并发围栏） | **去掉** | 索菲亚的 `reply` / `readThread` / `loadThreadHistory` 签名里都没有（`slots.ts`）；宿主没有幂等面与 revision 围栏 |
 * | 三条按作用域分片的订阅（`thread` / `workspace` / `presence`） | **三条照抄，但底层塌缩成一条无作用域唤醒** | 索菲亚只有 `PanelStore.subscribe`（`slots.ts` 的 `SubscribeTeamChanges` 说明：忽略 scope 参数）。三条各自做的事（重读事实 / 重读名册 / 重读名册）在索菲亚合并成「一次全读」 |
 * | `humanName` / `humanAvatarUrl` / `channelView.humanMemberId` | **恒无人类成员维** | 主人不是名册里的成员（AGENTS.md 的「唯一主人」模型） |
 * | `readFacts` / `remainingUnreadCount` / `drainUnread` / `metadata` / `unreadIndex` | **结构全保留，数据恒空** | 索菲亚没有已读水位（`TeamThreadReadResult` 只给 `facts` + `task`）⇒ 未读边界恒不出现 |
 * | `historyCursor` / `historyHasMore` / `loadOlder` | **结构全保留**，`hasMore` 用索菲亚返回值（恒 `false`） | 索菲亚线格式一次给出全量消息（`slots.ts`）⇒ 那个按钮不需要出现 |
 * | `putAttachment` / `getAttachment` / `uploadComposerFiles` / `pendingFiles` | **结构保留，恒无数据** | 索菲亚没有附件路由（同上清单）；composer 只保留「选文件 → chip」的本地 UI |
 * | `selectChannel` / `selectThread` / `resolveTaskRefs` / `resolveThreadRefs` / `openMemberSession` | **可选 prop，缺席时留空动作** | 索菲亚没有 ref 跳转/成员会话路由（`refs.ts` 的 `hostTaskRefLookup` 说明） |
 *
 * @module @sophia/core/client/vendor/team/TeamThreadPage
 */

import type { ReactElement, ReactNode } from 'react'
import { hooks, react } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type {
  AgentTeamActivity, AgentTeamChannelRef, AgentTeamClaim, AgentTeamClientMemberStatus,
  AgentTeamMemberId, AgentTeamTask, AgentTeamTaskRef, AgentTeamThread, AgentTeamThreadFact,
  AgentTeamThreadReadFact, AgentTeamThreadRef,
} from './agent-team-types.ts'
import type { TeamChannelView, TeamConversationProps, TeamRemoteResult, TeamThreadReadResult } from './slots.ts'
import type { TeamDraftKey, TeamDraftStore } from './drafts.ts'
import { TeamComposer } from './TeamComposer.tsx'
import { diagnosticText, TeamPresenceDot } from './TeamPresenceDot.tsx'
import { TeamMessage } from './TeamMessage.tsx'
import { TeamRunDivider } from './TeamRunDivider.tsx'
import { firstSentence, formatActivity, formatClaimState, formatRiskClass, formatTaskStatus, formatTaskTitle, mentionNameOf, mentionNamesOf, mentionedMemberIds, taskStatusDot, type MentionHandle } from './team-formatters.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { daySeparatorLabel, isRunGap, timelineDayKey } from './team-separators.ts'
import { useTimelineScroll } from './timeline-scroll.ts'
import { hostTaskRefLookup, hostThreadRefLookup, jumpToTaskThread, jumpToThread, rosterChannelName, rosterMember } from './refs.ts'
import css from './conversation.module.css'
import threadCss from './thread.module.css'

// ────────────────────────────────────────────────────────────────────────────
// 索菲亚宿主缺失事实的**可读文案**（唯一真相）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 三块禁用按钮的悬停原因。**这是本文件里唯一一处面向用户的降级文案**，
 * 改宿主缺口时只改这里（`grep TEAM.*UNAVAILABLE` 能全找到）。
 *
 * 为什么不写「服务器暂时不可用」那类话：那句话在**误导** —— 它不是"暂时不行"，
 * 而是"这个功能在这个构建里根本没有"，反复重试永远不会好
 * （与 `../bridge.ts` 的 `TEAM_HALT_AVAILABLE` 同一条口径）。
 */
export const PROMOTE_UNAVAILABLE_HINT = '索菲亚的任务由 sophia-engine-dag 拥有：宿主没有「把线程提升成任务」的路由，故本按钮不可用' as const
export const CHANGE_TASK_UNAVAILABLE_HINT = '索菲亚的任务状态由 sophia-engine-dag 拥有：宿主没有「改任务状态」的路由，故本按钮不可用' as const

/** 三块被剥离能力的机器可读清单（供结构门禁/父 agent 核对；仓里既有取值，语义不变）。 */
export const THREAD_PAGE_STRIPPED = ['promoteThread', 'changeTask', 'claims'] as const

/** 三块 UI **照渲染但不可用**的锚点（与 `THREAD_PAGE_STRIPPED` 配对：上面是"缺什么"，这里是"画成什么样"）。 */
export const THREAD_PAGE_DISABLED_ACTIONS = ['promote', 'accept', 'close', 'reopen'] as const

// ────────────────────────────────────────────────────────────────────────────
// 上游写操作的类型形状（**一对一映射**；索菲亚宿主没有路由，故这些 prop 恒不传）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 上游 `changeTask` / `promoteThread` 的**提交结果**判别联合。
 *
 * ⚠ 索菲亚宿主**没有**这两条路由（见文件头表格的 `src/host.ts` 行号），
 * 所以这两个函数的 prop 在索菲亚恒为 `undefined` ⇒ 本类型只为
 * 「上游那两段处理 `committed` / `unread_required` / `stale_revision` 分支的代码
 * 能原样留着」而存在，**不是**索菲亚能产出的结果。
 */
type TeamTaskMutation =
  | {
      readonly kind: 'committed'
      readonly task: AgentTeamTask
      readonly thread: AgentTeamThread
      readonly claims: readonly AgentTeamClaim[]
      readonly activity: AgentTeamActivity
      readonly receipt: { readonly occurredAt: string }
    }
  | { readonly kind: 'unread_required'; readonly unreadCount: number }
  | { readonly kind: 'stale_revision' }

/** 上游 `TeamConversationProps['changeTask']` 的形状。 */
type ChangeTask = (request: {
  readonly requestId: string
  readonly workspaceId: string
  readonly taskRef: AgentTeamTaskRef
  readonly action: 'accept' | 'close' | 'reopen'
  readonly baseRevision: number
}) => Promise<TeamRemoteResult<TeamTaskMutation>>

/** 上游 `TeamConversationProps['promoteThread']` 的形状。 */
type PromoteThread = (request: {
  readonly requestId: string
  readonly workspaceId: string
  readonly threadRef: AgentTeamThreadRef
  readonly baseRevision: number
}) => Promise<TeamRemoteResult<TeamTaskMutation>>

/** 上游 `TeamConversationProps['putAttachment']` 的形状（附件面上传）。 */
type PutAttachment = (request: { readonly workspaceId: string; readonly file: File }) => Promise<TeamRemoteResult<{ readonly attachmentId: string }>>

interface TeamThreadPageProps {
  /**
   * ⚠ 上游这里是 `workspaceId: WorkspaceId`（每个请求必填）。
   * 索菲亚**没有 Workspace 这一维**（一个团一个视图）⇒ 整个字段去掉。
   */
  readonly threadRef: AgentTeamThreadRef
  /** 上游的 `channelRef`（可选）：索菲亚的频道归属可由线程反查，但上游用它做名册过滤 ⇒ 保留。 */
  readonly channelRef?: AgentTeamChannelRef | undefined
  /** 上游的 `taskRef`（可选）：用于「正文里引用了本任务自己」时不做跳转。 */
  readonly taskRef?: AgentTeamTaskRef | undefined
  /** 任务序号（渲染 `Task #2`）。索菲亚从线程/任务派生，缺席时按上游口径回落 `…`。 */
  readonly taskNumber?: number | undefined
  readonly backToWorkspace: TeamConversationProps['backToWorkspace']
  readonly loadChannels: TeamConversationProps['loadChannels']
  readonly readThread: TeamConversationProps['readThread']
  readonly loadThreadHistory: TeamConversationProps['loadThreadHistory']
  readonly threadObservations: TeamConversationProps['threadObservations']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  readonly drafts: TeamDraftStore
  readonly reply: TeamConversationProps['reply']
  readonly t: TeamConversationProps['t']
  /**
   * The Human's own display name and avatar, from the shared identity projection.
   *
   * ⚠ 索菲亚**没有人类成员这一维** ⇒ 恒不传（且 `humanAvatarUrl` 直接不声明，
   * 因为索菲亚连"主人的脸"都不是名册事实）。保留 `humanName` 是因为上游
   * `mentionNamesOf` / `rosterMember` 的第三个参数要它，索菲亚声明为可选。
   */
  readonly humanName?: string | undefined
  /**
   * 附件上传/读取面（上游必填，索菲亚恒不传 ⇒ composer 的文件 chip 仍可用，
   * 但不会真的上传）。见文件头的附件行。
   */
  readonly getAttachment?: TeamConversationProps['getAttachment'] | undefined
  readonly putAttachment?: PutAttachment | undefined
  /** 见 `ChangeTask` 的说明：索菲亚恒不传 ⇒ 验收/关闭/重开恒 disabled。 */
  readonly changeTask?: ChangeTask | undefined
  /** 见 `PromoteThread` 的说明：索菲亚恒不传 ⇒ promote 恒 disabled。 */
  readonly promoteThread?: PromoteThread | undefined
  /** ref 跳转 / 成员会话跳转（索菲亚没有这两条路由 ⇒ 恒不传）。 */
  readonly selectChannel?: ((channelRef: AgentTeamChannelRef) => void) | undefined
  readonly selectThread?: ((threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void) | undefined
  readonly resolveTaskRefs?: TeamConversationProps['resolveTaskRefs'] | undefined
  readonly resolveThreadRefs?: TeamConversationProps['resolveThreadRefs'] | undefined
  readonly openMemberSession?: TeamConversationProps['openMemberSession'] | undefined
}

type ReadProjection = TeamThreadReadResult

type ThreadFactKey = string

/**
 * 一条事实的身份键。
 *
 * ⚠ 上游是 `fact.kind === 'message' ? 'message:' + message.messageRef : 'activity:' + activity.activityRef`。
 * 索菲亚的 `AgentTeamThreadFact` **只有 `message` 一支**（`agent-team-types.ts`：
 * 索菲亚的活动是自由文本 `summary`，没有结构化 kind）⇒ 键取自
 * `message.messageId`（索菲亚线格式的消息主键）。
 * `fact.kind === 'message'` 这个判别**保留在调用点**（上游形状），
 * 让将来加 activity 支时编译器当场报错、而不是悄悄走错分支。
 */
function factKey(fact: AgentTeamThreadFact): ThreadFactKey {
  return `message:${fact.message.messageId}`
}

/**
 * ⚠ 索菲亚移植点：上游的 `messageFact(message, mentions)` 是给
 * `readThread` 返回的 `anchor` 用的（把锚点消息包成一条事实）。索菲亚的
 * `TeamThreadReadResult` **没有 anchor**（无锚点概念）⇒ 本函数只在
 * `loadThreadHistory` 的 `anchor` 存在时被调用（`AgentTeamThreadHistory.anchor` 可选），
 * 且调用点自己判空。
 */
function messageFact(message: AgentTeamThreadFact['message'], mentions: readonly AgentTeamMemberId[] = []): AgentTeamThreadFact {
  return { kind: 'message', sequence: 0, message, mentions, occurredAt: String(message.occurredAt) }
}

/**
 * A fact owns its mention array, so the rendered name list is cached against
 * that array. Every roster refresh replaces the handles map with a fresh Map of
 * identical content, so the cache compares the resolved names rather than the
 * map identity: identity stays stable while the names are unchanged, which is
 * what keeps a memoized row from re-rendering on every refresh.
 */
const mentionNamesCache = new WeakMap<readonly AgentTeamMemberId[], readonly MentionHandle[]>()

function stableMentionNames(mentions: readonly AgentTeamMemberId[], handles: ReadonlyMap<AgentTeamMemberId, string>, humanName: string): readonly MentionHandle[] {
  const names = mentionNamesOf(mentions, handles, humanName)
  const cached = mentionNamesCache.get(mentions)
  if (cached !== undefined && cached.length === names.length && cached.every((name, index) => mentionNameOf(name) === mentionNameOf(names[index]!))) return cached
  mentionNamesCache.set(mentions, names)
  return names
}

function mergeFacts(...groups: readonly (readonly AgentTeamThreadFact[])[]): readonly AgentTeamThreadFact[] {
  const byKey = new Map<ThreadFactKey, AgentTeamThreadFact>()
  for (const group of groups) for (const fact of group) byKey.set(factKey(fact), fact)
  return [...byKey.values()].sort((left, right) => left.sequence - right.sequence)
}

function minSequence(facts: readonly AgentTeamThreadFact[]): number | undefined {
  return facts.reduce<number | undefined>((minimum, fact) => minimum === undefined ? fact.sequence : Math.min(minimum, fact.sequence), undefined)
}

function readMeta(facts: readonly AgentTeamThreadReadFact[]): ReadonlyMap<ThreadFactKey, AgentTeamThreadReadFact> {
  return new Map(facts.map(fact => [factKey(fact.fact), fact]))
}

/** 上游 `mintRequestId`（`./requests.ts`）：索菲亚没有幂等面，但写操作的分支结构要它。 */
function mintRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Task / Thread 详情页。
 *
 * 数据入口全部来自 `props`（索菲亚侧由 `index.ts` 的 `createTeamDataSource` 供给）。
 */
export function TeamThreadPage(props: TeamThreadPageProps): ReactElement {
  const {
    threadRef, channelRef, taskRef, taskNumber, backToWorkspace, selectChannel, selectThread, resolveTaskRefs, resolveThreadRefs, openMemberSession, putAttachment,
    humanName, loadChannels, readThread, loadThreadHistory, threadObservations,
    subscribeChanges, loadMembers, drafts, getAttachment, reply, changeTask, promoteThread, t,
  } = props
  const { Fragment } = react()
  const { useCallback, useEffect, useMemo, useRef, useState } = hooks()
  const [projection, setProjection] = useState<ReadProjection>()
  const [channelView, setChannelView] = useState<TeamChannelView>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  // Current Thread followers; the composer ranks them first because a mention
  // to a follower delivers directly instead of entering the invite detour.
  const [followerIds, setFollowerIds] = useState<ReadonlySet<AgentTeamMemberId>>(() => new Set())
  const [currentFacts, setCurrentFacts] = useState<readonly AgentTeamThreadFact[]>([])
  const [olderFacts, setOlderFacts] = useState<readonly AgentTeamThreadFact[]>([])
  /**
   * ⚠ 索菲亚移植点：上游这两项由 `readThread` 的**有界读**返回
   * （`readFacts` 带 unread/direct 标记、`anchor` 是本次读的锚点）。
   * 索菲亚的 `readThread` 返回全量事实、没有锚点、没有水位 ⇒ `readFacts` 恒空、
   * `anchor` 从 `loadThreadHistory` 取。**状态与派生逻辑全保留**，
   * 因为未读边界（`unreadBoundary`）是上游时间线结构的一部分。
   */
  const [readFacts, setReadFacts] = useState<readonly AgentTeamThreadReadFact[]>([])
  const [anchor, setAnchor] = useState<AgentTeamThreadFact['message']>()
  const [thread, setThread] = useState<AgentTeamThread>()
  const [historyCursor, setHistoryCursor] = useState<number>()
  const [historyHasMore, setHistoryHasMore] = useState(false)
  // A bounded read acknowledges at most 20 unread facts; larger backlogs need
  // continuation reads. Reads also never self-wake a change scope, so a
  // backlog beyond a handful of batches would otherwise linger forever. The
  // cap stops a pathological feed (facts arriving faster than they are read)
  // from looping without bound; the error surface keeps the remainder visible.
  const MAX_AUTO_READ_ROUNDS = 50
  const [autoReadExhausted, setAutoReadExhausted] = useState(false)
  const [newFactsCount, setNewFactsCount] = useState(0)
  // The reply draft lives in the keyed draft cache: view switches unmount
  // this page, and a refresh must not cost the half-written message either.
  // The composer owns the subscription — this page only reads a snapshot when
  // it sends, so typing never re-renders the timeline.
  const draftKey: TeamDraftKey = `thread:${threadRef}`
  const [claimsOpen, setClaimsOpen] = useState(false)
  // Early acceptance: the Human may accept while Claims are still open; the
  // confirm dialog lists exactly what will be completed with the Task.
  const [confirmingAccept, setConfirmingAccept] = useState(false)
  useEffect(() => {
    if (confirmingAccept && projection?.task?.status === 'done') setConfirmingAccept(false)
  }, [confirmingAccept, projection?.task?.status])
  const [replyRequestId, setReplyRequestId] = useState<string>()
  const [statusMessage, setStatusMessage] = useState<string>()
  const [pending, setPending] = useState(false)
  // Label source for the promote/accept buttons only: a reply send also raises
  // the shared `pending` gate, and must not retitle those buttons.
  const [mutating, setMutating] = useState<'promote' | 'accept' | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const mountedRef = useRef(false)
  const currentFactsRef = useRef<readonly AgentTeamThreadFact[]>([])
  const sequenceRef = useRef(0)
  const readRequestIdRef = useRef<string>(mintRequestId())
  // ⚠ 索菲亚移植点：上游写 `useRef<ReadProjection>()`（无参，React 允许，语义是
  //   `current === undefined`）。索菲亚 `react-runtime.ts` 的 `useRef` 声明要求
  //   显式初值 ⇒ 写成 `useRef<ReadProjection | undefined>(undefined)`，语义等价。
  const projectionRef = useRef<ReadProjection | undefined>(undefined)
  const mutationRequests = useRef(new Map<string, string>())
  const threadLastFact = currentFacts[currentFacts.length - 1]
  const timeline = useTimelineScroll(`${currentFacts.length}:${olderFacts.length}:${threadLastFact === undefined ? '' : factKey(threadLastFact)}`)

  const updateProjection = (next: ReadProjection): void => {
    projectionRef.current = next
    setProjection(next)
    // ⚠ 索菲亚移植点：上游是 `setReadFacts(next.facts)`（有界读带 unread/direct 标记）；
    //   索菲亚的读不带标记、也没有锚点 ⇒ 恒空。见 `readFacts` / `anchor` 的声明说明。
    setReadFacts([])
    setCurrentFacts(current => {
      const merged = mergeFacts(current, next.facts)
      currentFactsRef.current = merged
      return merged
    })
  }

  // Continue a bounded read while unread facts remain. Each round must mint a
  // fresh requestId: the Host replays a repeated id from its idempotency
  // cache, which would return the same batch forever. The loop terminates on
  // a zero remainder, a failed read (the existing error surface offers
  // retry), a superseding sequence, or the round cap.
  //
  // ⚠ 索菲亚移植点：上游的循环条件是 `snapshot.remainingUnreadCount <= 0`，
  // 而索菲亚的 `TeamThreadReadResult` **没有 remainingUnreadCount**（没有已读水位）
  // ⇒ 第一轮就返回。**函数体与轮次上限照抄保留**：宿主接上水位后
  // 只要把 `remainingUnreadCount` 接回读取结果，这里一行都不用改。
  const drainUnread = async (): Promise<void> => {
    for (let round = 1; round <= MAX_AUTO_READ_ROUNDS; round += 1) {
      const snapshot = projectionRef.current
      if (snapshot === undefined || remainingUnreadCount(snapshot) <= 0) return
      const beforeSequence = sequenceRef.current
      if (!await readCurrent(true)) return
      // A newer read or remount owns the tail now; it drains the remainder.
      if (!mountedRef.current || sequenceRef.current !== beforeSequence + 1) return
      // A stalled remainder (Host fault) must not spin the loop.
      //
      // ⚠ 索菲亚移植点：上游是 `projectionRef.current?.remainingUnreadCount === snapshot.remainingUnreadCount`。
      // 索菲亚**没有**这个字段（无已读水位）⇒ `remainingUnreadCount()` 恒 `0`，
      // 且 `undefined` 与 `0` 不相等（保留上游 `?.` 的语义）—— 但因为上一行的
      // `remainingUnreadCount(snapshot) <= 0` 已经成立，本函数实际上在第一轮就返回，
      // 循环不会空转。宿主接上水位后只要让 `remainingUnreadCount` 读真实字段即可。
      if (projectionRef.current !== undefined && remainingUnreadCount(projectionRef.current) === remainingUnreadCount(snapshot)) return
    }
    setAutoReadExhausted(true)
  }

  const readCurrent = async (newRequest = false): Promise<boolean> => {
    if (!mountedRef.current) return false
    if (newRequest) readRequestIdRef.current = mintRequestId()
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    try {
      // ⚠ 索菲亚移植点：上游是
      //   `readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest })`。
      //   索菲亚的 `readThread` 只收 `{ threadRef }`（没有幂等键、没有 Workspace、
      //   没有 taskRef 外键）⇒ `readRequestIdRef` 只为上游那段「每轮换一个 id」
      //   的注释与结构活着。
      const result = await readThread({ threadRef })
      if (!mountedRef.current || sequence !== sequenceRef.current) return false
      if (!result.ok) { setError(result.error.message); return false }
      updateProjection(result.value)
      setError(undefined)
      return true
    } catch (cause) {
      if (mountedRef.current && sequence === sequenceRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) setLoading(false)
    }
  }

  /** One roster + view read. Answers false once the page is gone. */
  const applySupplemental = async (): Promise<boolean> => {
    try {
      // ⚠ 索菲亚移植点：上游是 `loadMembers({ workspaceId })` 与
      //   `loadChannels({ workspaceId, channelRef, threadRef, includeActivities: false, limit: 1 })`。
      //   索菲亚的对应签名只收它真有的键（没有 Workspace、没有 includeActivities/limit
      //   语义，见 `slots.ts`）。
      const [loadedMembers, loadedView] = await Promise.all([
        loadMembers(),
        loadChannels({ ...(channelRef === undefined ? {} : { channelRef }), threadRef }),
      ])
      if (!mountedRef.current) return false
      if (loadedMembers.ok) setMembers(loadedMembers.value)
      if (loadedView.ok) setChannelView(loadedView.value)
      const failure = [loadedMembers, loadedView].find(result => !result.ok)
      if (failure !== undefined && !failure.ok) setError(failure.error.message)
      return true
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
      return mountedRef.current
    }
  }

  const supplementalRef = useRef<Promise<void> | undefined>(undefined)
  const supplementalPendingRef = useRef(false)
  const refreshSupplemental = (): Promise<void> => {
    supplementalPendingRef.current = true
    if (supplementalRef.current !== undefined) return supplementalRef.current
    const round = (async () => {
      // Collect synchronous scope notifications before issuing the shared read.
      await Promise.resolve()
      while (mountedRef.current && supplementalPendingRef.current) {
        supplementalPendingRef.current = false
        if (!await applySupplemental()) return
      }
    })().finally(() => {
      if (supplementalRef.current === round) supplementalRef.current = undefined
    })
    supplementalRef.current = round
    return round
  }

  const refreshPassiveFacts = async (): Promise<void> => {
    try {
      const result = await loadThreadHistory({ threadRef })
      if (!mountedRef.current || !result.ok) return
      const incoming = result.value.facts
      const shown = currentFactsRef.current
      if (shown.length === 0) return
      const known = new Set(shown.map(fact => factKey(fact)))
      // Facts older than everything already rendered are backfill of the
      // wider history window this fetch uses, not new updates; counting
      // them would re-flag already-read messages after every change wake.
      const newestShown = shown.reduce((maximum, fact) => Math.max(maximum, fact.sequence), 0)
      const additions = incoming.filter(fact => !known.has(factKey(fact)) && fact.sequence > newestShown)
      setCurrentFacts(current => {
        const merged = mergeFacts(current, incoming)
        currentFactsRef.current = merged
        return merged
      })
      // ⚠ 索菲亚移植点：上游在这里把 `task` / `thread` / `claims` 并回投影。
      //   索菲亚的 history 载荷有 `task` / `thread`（见 `agent-team-types.ts` 的
      //   `AgentTeamThreadHistory`）但**没有 claims** ⇒ 三项照并、claims 不入投影。
      setThread(result.value.thread)
      if (result.value.anchor !== undefined) setAnchor(result.value.anchor)
      setProjection(current => {
        const next = current === undefined ? current : { ...current, ...(result.value.task === undefined ? {} : { task: result.value.task }) }
        if (next !== undefined) projectionRef.current = next
        return next
      })
      if (additions.length === 0) return
      // Every arrival while the Thread is open is acknowledged durably: the
      // timeline renders it either way, and the Human has no manual read
      // action anymore. The count only feeds the pure jump hint for a reader
      // away from the tail; a bottom-pinned reader already sees the arrivals.
      if (!timeline.isPinned()) setNewFactsCount(current => current + additions.length)
      // The acknowledgment outcome does not change what is on screen: a
      // failed read surfaces through the error surface, not through the count.
      await readCurrent(true)
    } catch {
      // A passive refresh is an invalidation convenience; the next explicit action rereads Host state.
    }
  }

  // Follower ranking is an enhancement, not a page fact: a failed observation
  // read leaves the roster order in place instead of surfacing an error.
  const refreshFollowers = async (): Promise<void> => {
    try {
      const result = await threadObservations({ threadRef })
      if (!mountedRef.current || !result.ok) return
      setFollowerIds(new Set(result.value.followers))
    } catch {
      // The next thread-scope wake retries; ranking falls back to roster order.
    }
  }

  useEffect(() => {
    mountedRef.current = true
    // The previous mount's supplemental round must not answer for this one.
    supplementalRef.current = undefined
    supplementalPendingRef.current = false
    projectionRef.current = undefined
    setProjection(undefined)
    setChannelView(undefined)
    setMembers([])
    setFollowerIds(new Set())
    setCurrentFacts([])
    currentFactsRef.current = []
    setOlderFacts([])
    setReadFacts([])
    setAnchor(undefined)
    setThread(undefined)
    setHistoryCursor(undefined)
    setHistoryHasMore(false)
    setAutoReadExhausted(false)
    setNewFactsCount(0)
    setError(undefined)
    setStatusMessage(undefined)
    const sequence = sequenceRef.current + 1
    sequenceRef.current = sequence
    setLoading(true)
    void (async () => {
      // One parallel round covers the whole first paint. The durable read no
      // longer wakes any change scope; only the subscription baseline can
      // request a catch-up while this first paint is loading.
      //
      // ⚠ 索菲亚移植点：上游这三个请求各带 `workspaceId` / `requestId` / `limit`；
      //   索菲亚的三个签名都只收 `{ threadRef }`（`slots.ts`）。
      const [read, history, observations] = await Promise.all([
        readThread({ threadRef }),
        loadThreadHistory({ threadRef }).catch(() => undefined),
        threadObservations({ threadRef }).catch(() => undefined),
      ])
      if (!mountedRef.current || sequence !== sequenceRef.current) return
      if (!read.ok) {
        setError(read.error.message)
        setLoading(false)
        return
      }
      updateProjection(read.value)
      // The Thread opens at the latest fact; the unread boundary stays
      // rendered as information, but reading is automatic from here on.
      timeline.scrollToBottom()
      if (history !== undefined && history.ok) {
        setCurrentFacts(current => {
          const merged = mergeFacts(current, history.value.facts)
          currentFactsRef.current = merged
          return merged
        })
        setThread(history.value.thread)
        if (history.value.anchor !== undefined) setAnchor(history.value.anchor)
        setHistoryCursor(history.value.cursor)
        setHistoryHasMore(history.value.hasMore)
      }
      if (observations !== undefined && observations.ok) setFollowerIds(new Set(observations.value.followers))
      setError(undefined)
      setLoading(false)
      await drainUnread()
    })()
    void refreshSupplemental()
    // ⚠ 索菲亚移植点：上游这里挂**三条按作用域分片**的订阅
    //   （`{kind:'thread'}` / `{kind:'workspace'}` / `{kind:'presence'}`）。
    //   索菲亚只有一条无作用域唤醒（`PanelStore.subscribe`，见 `slots.ts` 的
    //   `SubscribeTeamChanges`）⇒ 三条塌缩成一条。**三条各自的语义照抄保留**：
    //   thread 唤醒重读事实 + 重读关注者，workspace/presence 唤醒重读名册，
    //   在这里合并为「一次全读」—— 成本略高、但不会有任何一个 scope 被漏掉。
    const disposers = [
      subscribeChanges({ kind: 'thread', threadRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message ?? ''); return }
        void refreshPassiveFacts()
        // Attention changes wake this scope too; keep the mention ranking current.
        void refreshFollowers()
      }),
      subscribeChanges({ kind: 'workspace', threadRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message ?? ''); return }
        void refreshSupplemental()
      }),
      // Presence transitions commit nothing: only the member rows move, so
      // the roster refresh rides the same supplemental fetch as workspace
      // membership changes, leaving the timeline untouched.
      subscribeChanges({ kind: 'presence', threadRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setError(update.message ?? ''); return }
        void refreshSupplemental()
      }),
    ]
    return () => {
      mountedRef.current = false
      sequenceRef.current += 1
      for (const dispose of disposers) dispose()
    }
  }, [taskRef, threadRef])

  // Returning to the bottom is the reader's answer to the jump hint: the
  // arrivals are on screen, their durable read already happened (or will be
  // retried by the next change wake), and the hint has nothing left to say.
  useEffect(() => {
    if (newFactsCount > 0 && timeline.isPinned()) setNewFactsCount(0)
  }, [newFactsCount, currentFacts, olderFacts, timeline])

  // The hint answers "where is the tail?"; the moment the reader is back
  // within the follow margin — by the jump click or their own scroll — it
  // must go away even when no render follows that position change.
  const handleTimelineScroll = (): void => {
    timeline.onScroll()
    if (timeline.isPinned()) setNewFactsCount(0)
  }

  /**
   * 加载更早的事实。
   *
   * ⚠ 索菲亚移植点：上游给 `loadThreadHistory` 传 `{ workspaceId, beforeSequence, limit: 20 }`，
   * 索菲亚的签名只收 `{ threadRef }`（线格式一次给全量、没有游标分页）
   * ⇒ 上面那个 `if (historyHasMore === false && historyCursor === undefined) return`
   * 在第一帧之后**恒成立**（`adapters.ts` 的 `toThreadHistory` 把 `hasMore` 定成 `false`），
   * 这个按钮因此永远不出现。函数与它的错误分支照抄保留。
   */
  const loadOlder = async (): Promise<void> => {
    if (historyHasMore === false && historyCursor === undefined) return
    const beforeSequence = historyCursor ?? minSequence(currentFactsRef.current)
    if (beforeSequence === undefined) return
    setLoading(true)
    try {
      const result = await loadThreadHistory({ threadRef })
      if (!mountedRef.current) return
      if (!result.ok) { setError(result.error.message); return }
      setOlderFacts(current => mergeFacts(current, result.value.facts))
      setHistoryCursor(result.value.cursor)
      setHistoryHasMore(result.value.hasMore)
      setError(undefined)
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  const activeProjection = projection
  const task = activeProjection?.task
  /**
   * ⚠ 索菲亚移植点：上游 `resolvedTaskNumber` 是
   * `taskNumber ?? channelView?.taskNumbers.find(…)?.taskNumber`。
   * 索菲亚的 `TeamChannelView` **没有 taskNumbers**（频道视图不带任务序号映射）
   * ⇒ 只保留 `taskNumber` 这一支，缺席时按上游口径回落 `…`。
   */
  const resolvedTaskNumber = taskNumber
  const taskTitle = task === undefined ? undefined : formatTaskTitle(task.title)
  /**
   * ⚠ 索菲亚移植点：上游是 `activeProjection?.claims ?? []`。
   * 索菲亚**没有 claim 模型**（`agent-team-types.ts` 的 `AgentTeamClaim` 说明），
   * 适配层据此恒给空数组 —— **不**把 `WireTask.assigneeMemberId` 伪装成一条 claim。
   * 这个变量因此恒空，但它喂给三处（risks / 提前验收弹窗 / claims 工作区），
   * 全部结构与空态分支都按上游照抄。
   */
  const taskClaims: readonly AgentTeamClaim[] = []
  const effectiveChannelRef = channelRef
  const channelMemberIds = useMemo(() => new Set(channelView?.members.filter(item => item.channelRef === effectiveChannelRef).map(item => item.memberId) ?? []), [channelView, effectiveChannelRef])
  const channelMembers = members.filter(status => channelMemberIds.size === 0 || channelMemberIds.has(status.member.memberId))
  const mentionHandlesMap = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle.replace(/^@/, '')])), [members])
  const metadata = useMemo(() => readMeta(readFacts), [readFacts])
  const unreadIndex = useMemo(() => {
    const all = mergeFacts(
      ...(anchor === undefined ? [] : [[messageFact(anchor)]]),
      readFacts.map(fact => fact.fact),
      currentFacts,
    )
    return all.findIndex(fact => metadata.get(factKey(fact))?.unread === true)
  }, [anchor, readFacts, currentFacts, metadata])

  /**
   * 成员显示名。
   *
   * ⚠ 索菲亚移植点：上游第一行是 `if (memberId === channelView?.humanMemberId) return humanName`
   * —— 把「人类」这个非投影身份映射成主人的名字。索菲亚**没有人类成员这一维**
   * ⇒ 该分支不可达，条件保留但 `humanMemberId` 恒 `undefined`。
   */
  const memberName = (memberId: AgentTeamMemberId): string => {
    if (humanName !== undefined && memberId === 'member:human') return humanName
    const status = members.find(candidate => candidate.member.memberId === memberId)
    return status === undefined ? t('memberUnknown') : `@${status.member.handle}`
  }

  const messageSender = (fact: AgentTeamThreadFact): AgentTeamMemberId | undefined =>
    fact.kind === 'message' ? fact.message.senderMemberId : undefined

  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([])

  // Branded-ref navigation for message bodies: channel refs hop to the
  // Channel; thread and task refs cited here resolve through the Host and
  // jump to their home Channel. Unresolvable refs never become links (see
  // TeamMessage), so this path only fires for refs the Host already confirmed.
  // Identity-stable: a fresh closure per render would defeat TeamMessage's memo.
  const openRef = useCallback((ref: string): void => {
    if (ref.startsWith('channel:') && ref !== channelRef) {
      selectChannel?.(ref as AgentTeamChannelRef)
      return
    }
    if (ref.startsWith('thread:') && ref !== threadRef) {
      // Another Thread cited here: resolve its home Channel and jump.
      jumpToThread(resolveThreadRefs, undefined, ref as AgentTeamThreadRef, selectThread ?? ((): void => {}))
      return
    }
    if (ref.startsWith('task:') && ref !== taskRef) {
      // Another Task cited here: resolve its home Channel and jump.
      jumpToTaskThread(resolveTaskRefs, undefined, ref as AgentTeamTaskRef, selectThread ?? ((): void => {}))
    }
  }, [channelRef, threadRef, taskRef, selectChannel, selectThread, resolveTaskRefs, resolveThreadRefs])

  const lookupTaskRefs = useMemo(() => hostTaskRefLookup(resolveTaskRefs, undefined), [resolveTaskRefs])
  const lookupThreadRefs = useMemo(() => hostThreadRefLookup(resolveThreadRefs, undefined), [resolveThreadRefs])
  // Roster chips resolve synchronously from loaded data: channel names from
  // the Channel view, member facts from the member list. Anything outside the
  // loaded window stays plain text — the same rule unresolvable Task/Thread
  // refs follow. The lookups key on roster content, not array identity: every
  // refresh hands over fresh arrays, and the memoized rows must survive
  // change bursts that leave the roster itself untouched.
  const rosterKey = useMemo(() => [
    (channelView?.channels ?? []).map(channel => `${channel.channelRef}=${channel.name}`).join(','),
    members.map(status => `${status.member.memberId}=${status.member.handle}=${status.member.state}=${status.presence}`).join(','),
  ].join(';'), [channelView, members])
  const channelNameOf = useMemo(() => {
    const channels = channelView?.channels ?? []
    return (ref: AgentTeamChannelRef): string | undefined => rosterChannelName(channels, ref)
  }, [rosterKey])
  const memberOf = useMemo(() => {
    return (ref: AgentTeamMemberId) => rosterMember(members, undefined, humanName ?? '', ref)
  }, [rosterKey, humanName])

  const renderFact = (fact: AgentTeamThreadFact, grouped = false): ReactNode => {
    if (fact.kind === 'message') {
      const sender = fact.message.senderMemberId
      const senderStatus = members.find(candidate => candidate.member.memberId === sender)
      const senderName = memberName(sender)
      /**
       * ⚠ 索菲亚移植点：上游 `human` 的判据是
       * `fact.message.sender === channelView?.humanMemberId`。
       * 索菲亚**没有人类成员这一维**（主人不是名册成员）⇒ 恒 `false`。
       *
       * ⚠ **但主人自己发的消息不能渲染成无名气泡**：索菲亚的适配层
       * （`adapters.ts` 的 `actorOf()`）在「人发消息」时给出 `senderMemberId === ''`。
       * 这里**不**把它改回去（任务硬约束），而是让 `senderName` 走
       * `memberName('')` ⇒ 名册里找不到 ⇒ 上游的 `memberUnknown` 兜底文案。
       * 真正的修法在适配层（把主人映射成一个稳定 handle），不在本文件。
       */
      const human = false
      return <TeamMessage
        key={factKey(fact)}
        senderName={senderName}
        memberId={sender}
        human={human}
        body={fact.message.body}
        {...(fact.message.senderMemberId === '' ? {} : (senderStatus?.member.avatarPath === undefined ? {} : { avatarPath: senderStatus.member.avatarPath }))}
        attachments={undefined}
        {...(getAttachment === undefined ? {} : { loadAttachment: getAttachment })}
        t={t}
        occurredAt={fact.occurredAt}
        mentionNames={stableMentionNames(fact.mentions, mentionHandlesMap, humanName ?? '')}
        onOpenRef={openRef}
        onResolveTaskRefs={lookupTaskRefs}
        onResolveThreadRefs={lookupThreadRefs}
        channelNameOf={channelNameOf}
        memberOf={memberOf}
        {...(openMemberSession === undefined ? {} : { onOpenMemberSession: openMemberSession })}
        grouped={grouped}
        {...(senderStatus === undefined ? {} : { senderTitle: senderStatus.member.description })}
      />
    }
    // ⚠ 索菲亚的 `AgentTeamThreadFact` 只有 `message` 一支 ⇒ 上游的 activity 分支
    //   （`<p className={threadCss.activityRow}>`）在索菲亚**结构上不可达**
    //   （上面的 `if` 会吃掉所有事实）。这行**照抄保留**，让将来加 activity 支时
    //   编译器与这里的分支同时就位，而不是悄悄走错。
    return <p className={threadCss.activityRow} key={factKey(fact)}><span className={threadCss.activityMark} aria-hidden="true" /><span className={threadCss.activityText}>{formatActivity((fact as unknown as { activity: AgentTeamActivity }).activity, { t, actorName: memberName, claims: taskClaims })}</span></p>
  }

  /** One run = one same-sender reply turn; activities, the unread boundary, and day changes break runs. */
  const renderFactBlocks = (facts: readonly AgentTeamThreadFact[], boundaryIndex: number | undefined): ReactNode[] => {
    const nodes: ReactNode[] = []
    let run: AgentTeamThreadFact[] = []
    let lastDay: string | undefined
    const flushRun = () => {
      if (run.length > 0) {
        nodes.push(
          <div className={css.messageRun} key={`run-${factKey(run[0]!)}`}>
            {run.map((entry, entryIndex) => {
              const previous = entryIndex > 0 ? run[entryIndex - 1] : undefined
              // ⚠ 索菲亚移植点：上游这里取 `previous.message.occurredAt`，而索菲亚的
              //   `WireMessage.occurredAt` 是 **number**（`../../wire.ts`）、
              //   `isRunGap` 收 `string | undefined` ⇒ 用事实层的 `fact.occurredAt`
              //   （`agent-team-types.ts` 里是 ISO 串，与 `message.occurredAt` 同源）。
              const turnGap = entry.kind === 'message' && isRunGap(previous?.occurredAt, entry.occurredAt)
              return <Fragment key={factKey(entry)}>
                {turnGap && <TeamRunDivider occurredAt={entry.occurredAt} />}
                {renderFact(entry, entryIndex > 0)}
              </Fragment>
            })}
          </div>,
        )
      }
      run = []
    }
    facts.forEach((fact, index) => {
      const occurredAt = fact.occurredAt
      if (occurredAt !== undefined) {
        const day = timelineDayKey(occurredAt)
        if (lastDay !== undefined && day !== lastDay) {
          flushRun()
          nodes.push(<p className={threadCss.daySeparator} key={`day-${index}`}><span>{daySeparatorLabel(occurredAt)}</span></p>)
        }
        lastDay = day
      }
      const sender = messageSender(fact)
      if (sender !== undefined && run.length > 0 && sender === messageSender(run[run.length - 1]!)) {
        run.push(fact)
        return
      }
      flushRun()
      if (boundaryIndex === index) nodes.push(<p key={`boundary-${index}`} className={threadCss.unreadBoundary} role="separator"><span>{t('unreadBoundary')}</span></p>)
      if (sender !== undefined) run.push(fact)
      else nodes.push(<Fragment key={factKey(fact)}>{renderFact(fact)}</Fragment>)
    })
    flushRun()
    return nodes
  }

  const refreshAfterFence = async (): Promise<void> => {
    timeline.scrollToBottom()
    await readCurrent(true)
    await refreshSupplemental()
    await drainUnread()
  }

  /**
   * 把线程提升成任务。
   *
   * ⚠ **索菲亚宿主没有这条事实面** ⇒ 本函数在任何情况下都不会真正执行：
   * 入口按钮恒 `disabled`（见渲染区的 `promoteToTask` 分支）。
   * 函数体（含 `committed` / `unread_required` / `stale_revision` 三个分支与
   * 幂等键管理）**逐字照抄上游**，保留它是为了让宿主补上
   * `promoteThread` 路由后**只改入口的 `disabled` 条件**即可用。
   */
  const convertToTask = async (): Promise<void> => {
    if (pending || thread === undefined || task !== undefined) return
    if (promoteThread === undefined) { setError(PROMOTE_UNAVAILABLE_HINT); return }
    setPending(true)
    setMutating('promote')
    setError(undefined)
    const key = 'promote'
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
    mutationRequests.current.set(key, requestId)
    try {
      const result = await promoteThread({ requestId, workspaceId: '', threadRef, baseRevision: threadRevision(thread) })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value
        setProjection(current => current === undefined ? current
          : { ...current, task: committed.task })
        setThread(committed.thread)
        // ⚠ 索菲亚移植点：上游在这里把宿主返回的 `activity` 包成一条
        //   `{ kind: 'activity', sequence, activity, occurredAt }` 事实并注入时间线。
        //   索菲亚的 `AgentTeamThreadFact` **只有 message 一支**（没有 activity 型，
        //   见 `agent-team-types.ts`）⇒ 不注入乐观事实，改为让紧跟其后的
        //   `readCurrent(true)` 重读：宿主把这条活动写成了什么，就由那一次重读
        //   如实带回来，而不是客户端猜一行文案。
        await readCurrent(true)
        await refreshSupplemental()
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        mutationRequests.current.delete(key)
        await refreshAfterFence()
      } else {
        setError(t('staleRevision'))
        mutationRequests.current.delete(key)
        await refreshPassiveFacts()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
      setMutating(undefined)
    }
  }

  /**
   * 改任务状态（验收 / 关闭 / 重新打开）。
   *
   * ⚠ **索菲亚宿主没有这条事实面** ⇒ 三个入口按钮恒 `disabled`。函数体照抄上游，
   * 理由同 `convertToTask`。
   */
  const mutateTask = async (action: 'accept' | 'close' | 'reopen'): Promise<void> => {
    if (pending || task === undefined || thread === undefined) return
    if (changeTask === undefined) { setError(CHANGE_TASK_UNAVAILABLE_HINT); return }
    setPending(true)
    if (action === 'accept') setMutating('accept')
    setError(undefined)
    const key = `task:${action}`
    const requestId = mutationRequests.current.get(key) ?? mintRequestId()
    mutationRequests.current.set(key, requestId)
    try {
      const result = await changeTask({ requestId, workspaceId: '', taskRef: task.taskId, action, baseRevision: threadRevision(thread) })
      if (!result.ok) { setError(result.error.message); return }
      if (result.value.kind === 'committed') {
        mutationRequests.current.delete(key)
        const committed = result.value
        setProjection(current => current === undefined ? current : { ...current, task: committed.task })
        setThread(committed.thread)
        // ⚠ 索菲亚移植点：上游在这里把宿主返回的 `activity` 包成一条
        //   `{ kind: 'activity', sequence, activity, occurredAt }` 事实并注入时间线。
        //   索菲亚的 `AgentTeamThreadFact` **只有 message 一支**（没有 activity 型，
        //   见 `agent-team-types.ts`）⇒ 不注入乐观事实，改为让紧跟其后的
        //   `readCurrent(true)` 重读：宿主把这条活动写成了什么，就由那一次重读
        //   如实带回来，而不是客户端猜一行文案。
        await readCurrent(true)
        await refreshSupplemental()
      } else if (result.value.kind === 'unread_required') {
        setError(t('unreadRequired', { count: result.value.unreadCount }))
        mutationRequests.current.delete(key)
        await refreshAfterFence()
      } else {
        setError(t('staleRevision'))
        mutationRequests.current.delete(key)
        await refreshPassiveFacts()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
      setMutating(undefined)
    }
  }

  // Editing the draft invalidates one-shot send state: a confirmation token,
  // the retained requestId, and the status line. Every setter returns the same
  // state when there is nothing to clear, so a keystroke does not re-render the
  // timeline now that the composer owns the draft.
  const clearSendState = useCallback((): void => {
    setReplyRequestId(current => current === undefined ? current : undefined)
    setStatusMessage(current => current === undefined ? current : undefined)
  }, [])

  const sendReply = async (): Promise<void> => {
    // Read the draft at send time: this page no longer subscribes to it, so a
    // captured render value would be stale after the composer's own edits.
    const { draft, recipients } = drafts.getSnapshot(draftKey)
    if (pending || draft.trim() === '') return
    const id = replyRequestId ?? mintRequestId()
    setReplyRequestId(id)
    setPending(true)
    setError(undefined)
    try {
      // Upload chosen files first; any failure aborts the reply with the
      // existing error surface and keeps the chips for a retry.
      //
      // ⚠ 索菲亚移植点：上游这里是 `uploadComposerFiles(putAttachment, workspaceId, pendingFiles)`
      // —— 索菲亚**没有附件路由**（`src/host.ts` 的路由清单），`putAttachment` 恒不传
      // ⇒ 有选中文件时**如实报错**（不是静默丢弃，也不是假装上传成功）。
      const upload = await uploadComposerFiles(putAttachment, pendingFiles)
      if (!upload.ok) {
        setError(upload.error)
        return
      }
      const attachmentIds = upload.attachmentIds
      // ⚠ 索菲亚移植点：上游这里带 `requestId` / `workspaceId` / `taskRef` /
      //   `baseRevision` / `attachments` / `confirmationToken` 六项；索菲亚的
      //   `TeamReplyRequest` 只有 `{ threadRef, body, recipients }`（`slots.ts`）。
      const result = await reply({ threadRef, body: draft.trim(), recipients: [...recipients].sort() })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      // 索菲亚的 `TeamReplyResult` 只有一种形态（`committed`，见 `slots.ts`）
      // ⇒ 上游那四条 `confirmation_required` / `unread_required` / `stale_revision` /
      // `member_not_following` 分支在索菲亚**结构上不可达**，故不在本处保留
      // （保留会让每一条都成为死代码，且没有宿主事实支撑）。
      // 乐观行仍按上游口径 chip：主人手打的 `@Handle` 与点选的收件人送达方式相同。
      const optimisticMentions = [...new Set([...recipients, ...mentionedMemberIds(draft, channelMembers)])].sort()
      const optimisticFact: AgentTeamThreadFact = {
        kind: 'message',
        sequence: result.value.messageSequence,
        message: {
          messageId: `optimistic:${id}`,
          channelId: thread?.channelId ?? '',
          threadId: threadRef,
          senderMemberId: '',
          body: draft.trim(),
          occurredAt: result.value.messageSequence,
        },
        mentions: optimisticMentions,
        occurredAt: result.value.occurredAt,
      }
      setCurrentFacts(current => {
        const merged = mergeFacts(current, [optimisticFact])
        currentFactsRef.current = merged
        return merged
      })
      drafts.clear(draftKey)
      setPendingFiles([])
      setReplyRequestId(undefined)
      setStatusMessage(undefined)
      await refreshSupplemental()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setPending(false) }
  }

  const currentFactsWithAnchor = mergeFacts(anchor === undefined ? [] : [messageFact(anchor)], currentFacts)
  const unreadBoundary = unreadIndex >= 0 ? unreadIndex : undefined
  // One row per erroring Member holding a live Claim. The row shows the
  // diagnostic's structured class — the localizable axis — beside the first
  // sentence of the Host's own reason; the full English text moves to the
  // row's title.
  //
  // ⚠ 索菲亚数据上恒空：`taskClaims` 恒 `[]`（没有 claim 模型），
  // 且 `status.presence !== 'error'` 这一关索菲亚也过不去
  // （`adapters.ts` 的 `presenceOf` 永不返回 `'error'`）。
  const risks = taskClaims.filter(claim => claim.state === 'active').flatMap(claim => {
    const status = members.find(candidate => candidate.member.memberId === claim.owner)
    if (status?.presence !== 'error') return []
    const risk = formatRiskClass(status, t)
    const detail = diagnosticText(status)
    return [{
      claim, status, ...risk,
      reason: detail === '' ? t('statusError') : firstSentence(detail),
      full: detail === '' ? t('statusError') : detail,
    }]
  })
  // Threads are always entered through a Channel page, so a Channel origin
  // returns to its timeline; a Thread restored without one returns further.
  const backLabel = channelRef === undefined ? t('backToWorkspace') : t('backToChannel')

  /**
   * 三块禁用按钮的**公共条件**。
   *
   * 上游的条件是「宿主有这条路由」（写成对函数存在性的隐式假设）；
   * 索菲亚把它**显式化**：函数缺席 ⇒ `disabled`，并把原因挂到 `title`。
   * 这样「点了没反应」在结构上不可能发生 —— 按钮要么可用、要么明确不可用。
   */
  const promotionDisabled = pending || promoteThread === undefined
  const promotionHint = promoteThread === undefined ? PROMOTE_UNAVAILABLE_HINT : undefined
  const changeTaskDisabled = pending || changeTask === undefined
  const changeTaskHint = changeTask === undefined ? CHANGE_TASK_UNAVAILABLE_HINT : undefined

  return <main className={css.surface} data-team-thread={threadRef}>
    <div className={css.surfaceHeader}>
      <div className={css.backRow}><primitives.Button size="sm" icon={<primitives.IconChevronLeftOutline14 />} onClick={backToWorkspace}>{backLabel}</primitives.Button></div>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <div className={threadCss.titleLine}>
            <h1>{task === undefined ? t('threadLabel') : t('taskLabel', { number: resolvedTaskNumber ?? '…' })}</h1>
            {task !== undefined && <primitives.Pill><TeamStateDot size={8} state={taskStatusDot(task.status)} />{formatTaskStatus(task.status, t)}</primitives.Pill>}
          </div>
          {taskTitle !== undefined && taskTitle !== '' && <p className={threadCss.taskTitle} title={taskTitle}>{taskTitle}</p>}
        </div>
        {/* ① promote：宿主无路由 ⇒ 照渲染 + disabled + title（见 `promotionDisabled`）。 */}
        {task === undefined && thread !== undefined && <div className={css.headerActions}>
          <primitives.Button size="sm" variant="primary" disabled={promotionDisabled} {...(promotionHint === undefined ? {} : { title: promotionHint })} onClick={() => { void convertToTask() }}>{mutating === 'promote' ? t('promotingTask') : t('promoteToTask')}</primitives.Button>
        </div>}
        {/* Open tasks act here; an accepted Thread keeps its header reopen. Reopen for a
            closed Thread lives only in the composer-slot closed notice. */}
        {/* ②③ changeTask：验收 / 关闭任务 / 重新打开 —— 宿主无路由 ⇒ 照渲染 + disabled + title。 */}
        {task !== undefined && thread !== undefined && taskResolutionOf(task) !== 'closed' && <div className={css.headerActions}>
          {(() => {
            // ⚠ 索菲亚移植点：上游是 `claim.taskRef === task.taskRef`；索菲亚的
        //   任务主键是 `WireTask.taskId`（`../../wire.ts`），而 `AgentTeamClaim`
        //   的字段名保持上游的 `taskRef` ⇒ 这里比较 `taskRef === taskId`。
        const activeClaims = taskClaims.filter(claim => claim.taskRef === task.taskId && claim.state === 'active')
            const earlyAccept = taskResolutionOf(task) === 'open' && task.status === 'in_progress' && activeClaims.length > 0
            // todo Tasks accept directly: the work finished outside the
            // ledger, so there is nothing to confirm and no Claims to list.
            if (!(task.status === 'in_review' || task.status === 'todo' || earlyAccept) || taskResolutionOf(task) !== 'open') return null
            return <primitives.Button size="sm" variant="primary" disabled={changeTaskDisabled} {...(changeTaskHint === undefined ? {} : { title: changeTaskHint })}
              onClick={() => { if (earlyAccept) { setConfirmingAccept(true) } else { void mutateTask('accept') } }}>{t('acceptTask')}</primitives.Button>
          })()}
          {taskResolutionOf(task) === 'open'
            ? <primitives.Button size="sm" variant="outline" disabled={changeTaskDisabled} {...(changeTaskHint === undefined ? {} : { title: changeTaskHint })} onClick={() => { void mutateTask('close') }}>{t('closeTask')}</primitives.Button>
            : <primitives.Button size="sm" variant="primary" disabled={changeTaskDisabled} {...(changeTaskHint === undefined ? {} : { title: changeTaskHint })} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</primitives.Button>}
        </div>}
      </header>
      {risks.length > 0 && <section className={threadCss.riskSection} aria-label={t('runtimeRisk')}>
        <h2>{t('runtimeRisk')}</h2>
        {risks.map(({ claim, status, label, sentenceKey, reason, full }) => <p className={threadCss.riskRow} key={claim.claimRef}>
          <TeamPresenceDot status={status} t={t} />
          <span title={full}><strong className={threadCss.riskClass}>{label}</strong> · {t(sentenceKey, { member: status.member.handle })} — {reason}</span>
        </p>)}
      </section>}
      {task !== undefined && thread !== undefined && (() => {
        // Recomputed here so the confirm list never shows stale rows.
        // ⚠ 索菲亚移植点：上游是 `claim.taskRef === task.taskRef`；索菲亚的
        //   任务主键是 `WireTask.taskId`（`../../wire.ts`），而 `AgentTeamClaim`
        //   的字段名保持上游的 `taskRef` ⇒ 这里比较 `taskRef === taskId`。
        const activeClaims = taskClaims.filter(claim => claim.taskRef === task.taskId && claim.state === 'active')
        return <primitives.Modal
          open={confirmingAccept}
          onClose={() => { if (!pending) setConfirmingAccept(false) }}
          title={t('acceptEarlyTitle')}
          closeLabel={t('cancel')}
          footer={<>
            <primitives.Button variant="outline" disabled={pending} onClick={() => { setConfirmingAccept(false) }}>{t('cancel')}</primitives.Button>
            <primitives.Button variant="primary" disabled={changeTaskDisabled} {...(changeTaskHint === undefined ? {} : { title: changeTaskHint })} onClick={() => { void mutateTask('accept') }}>{mutating === 'accept' ? t('acceptingTask') : t('acceptTask')}</primitives.Button>
          </>}
        >
          <p className={css.confirmBody}>{t('acceptEarlyBody', { count: activeClaims.length })}</p>
          <ul className={css.confirmList}>
            {activeClaims.map(claim => (
              <li key={claim.claimRef}>{memberName(claim.owner)} · {claim.direction}</li>
            ))}
          </ul>
        </primitives.Modal>
      })()}
      {/* ④ claims 工作区：宿主**没有认领模型** ⇒ 照渲染，`taskClaims` 恒空
          ⇒ 标题为 `Claims · 0`、展开后是上游的 `emptyClaims` 空态。 */}
      {task !== undefined && thread !== undefined && <section className={threadCss.workSection} aria-label={t('claims')}>
        <primitives.DisclosureRow
          expandOnRowClick
          expandable
          open={claimsOpen}
          onToggle={() => { setClaimsOpen(current => !current) }}
          icon={<primitives.IconChecklistOutline14 size={14} />}
          title={`${t('claims')} · ${taskClaims.length}`}
        >
          <div className={threadCss.claimList}>
            {taskClaims.length === 0 && <p className={threadCss.emptyClaims}>{t('noClaims')}</p>}
            {taskClaims.map(claim => {
              const ownerStatus = members.find(status => status.member.memberId === claim.owner)
              return <article className={`${threadCss.claimRow}${claim.state === 'done' ? ` ${threadCss.claimRowDone}` : ''}`} key={claim.claimRef}>
                {ownerStatus === undefined ? <span /> : <TeamPresenceDot status={ownerStatus} t={t} />}
                <strong className={threadCss.claimOwner} title={memberName(claim.owner)}>{memberName(claim.owner)}</strong>
                <span className={threadCss.claimDirection}>{claim.direction}</span>
                <small className={threadCss.claimState}>{formatClaimState(claim.state, t)}</small>
              </article>
            })}
          </div>
        </primitives.DisclosureRow>
      </section>}
    </div>

    <section ref={timeline.ref} onScroll={handleTimelineScroll} className={css.timeline} aria-label={t('timelineLabel')}>
      <div className={css.timelineContent}>
        {loading && projection === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingThread')}</p></div>}
        {projection === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><primitives.Button size="sm" variant="outline" onClick={() => { void readCurrent() }}>{t('retry')}</primitives.Button></div>}
        {olderFacts.length > 0 && <section className={threadCss.historySection} aria-label={t('olderHistory')}><h2>{t('olderHistory')}</h2>{renderFactBlocks(olderFacts, undefined)}</section>}
        {historyHasMore && <div className={css.timelineAction}><primitives.Button size="sm" onClick={() => { void loadOlder() }}>{t('loadOlder')}</primitives.Button></div>}
        {currentFactsWithAnchor.length > 0 && <section className={threadCss.publicSection}>
          {renderFactBlocks(currentFactsWithAnchor, unreadBoundary)}
        </section>}
        {autoReadExhausted && <div className={css.timelineAction} role="alert">
          <span>{t('autoReadIncomplete')}</span>
          <primitives.Button size="sm" onClick={() => { setAutoReadExhausted(false); void drainUnread() }} disabled={loading}>{t('retry')}</primitives.Button>
        </div>}
        {newFactsCount > 0 && <div className={threadCss.newUpdates} role="status">
          <button type="button" className={threadCss.newUpdatesJump} onClick={() => { setNewFactsCount(0); timeline.scrollToBottom() }}>{t('newUpdatesJump', { count: newFactsCount })}</button>
        </div>}
      </div>
    </section>

    {projection !== undefined && thread !== undefined ? (
      task !== undefined && taskResolutionOf(task) === 'closed'
        ? <div className={threadCss.closedBar} data-team-closed>
            {error !== undefined && <p className={css.error} role="alert">{error}</p>}
            <div className={threadCss.closedNotice}>
              <span>{t('taskClosedNotice')}</span>
              <primitives.Button size="sm" variant="outline" disabled={changeTaskDisabled} {...(changeTaskHint === undefined ? {} : { title: changeTaskHint })} onClick={() => { void mutateTask('reopen') }}>{t('reopenTask')}</primitives.Button>
            </div>
          </div>
        : <TeamComposer
      key={draftKey}
      members={channelMembers}
      followerMemberIds={followerIds}
      drafts={drafts}
      draftKey={draftKey}
      pending={pending}
      {...(statusMessage === undefined ? {} : { confirmation: statusMessage })}
      {...(error === undefined ? {} : { error })}
      onEdit={clearSendState}
      onSubmit={() => { void sendReply() }}
      placeholder={t('replyPlaceholder')}
      pendingFiles={pendingFiles}
      onFilesChange={setPendingFiles}
      t={t}
    />
    ) : <div />}
  </main>
}

// ────────────────────────────────────────────────────────────────────────────
// 索菲亚适配用的两个纯函数（**上游没有**，因为上游的这两件事由宿主字段给）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 任务状态 → 上游那套 `resolution` 三分（`open` / `accepted` / `closed`）。
 *
 * ## 为什么需要它
 *
 * 上游 `WireTask` 有**两个**正交字段：`status`（todo / in_progress / in_review /
 * done / closed）与 `resolution`（open / accepted / closed）。渲染区的判断分别用它们：
 * 按钮区看 `resolution !== 'closed'`、`resolution === 'open'`，
 * 徽章看 `status`。
 *
 * 索菲亚的 `WireTask`（`../../wire.ts`）**只有一个** `status` 字符串字段
 * （`status: WireTaskStatus = string`，注释明说「不发明闭集」）⇒
 * 这里从 `status` **派生** `resolution`：
 * `closed` ⇒ `closed`、`done` ⇒ `accepted`、其余 ⇒ `open`。
 *
 * ## 为什么是派生而不是新造一个字段
 *
 * 派生**没有发明数据**：`closed` 与 `done` 是索菲亚状态机里的终态
 * （`team-formatters.ts` 的 `formatTaskStatus` 把 `closed` 映射成「已关闭」、
 * `done` 映射成「已完成」），而上游的 `resolution` 恰好就是「这个任务还没收尾 /
 * 已验收 / 已关闭」这三分。二者的语义边界一致，所以这是**翻译**而不是创作。
 *
 * ## 边界（如实说明）
 *
 * 一个未知的 `status` 字符串 ⇒ 落到 `open`（保守：不谎称任务已收尾）。
 */
function taskResolutionOf(task: AgentTeamTask): 'open' | 'accepted' | 'closed' {
  if (task.status === 'closed') return 'closed'
  if (task.status === 'done') return 'accepted'
  return 'open'
}

/**
 * 乐观并发围栏用的 revision。
 *
 * ⚠ 索菲亚的写操作 `changeTask` / `promoteThread` **恒不传**（宿主没有路由），
 * 这个取值只为那两段照抄的调用点存在。索菲亚的 `WireThread` 没有 `revision`
 * 字段（`../../wire.ts`）⇒ 给一个稳定常量 `0`，并在这里写明：
 * **它不是并发版本号**，宿主若接上这两条路由，必须自己把 revision 面补到线格式里。
 */
function threadRevision(_thread: AgentTeamThread): number {
  return 0
}

/** 见 `drainUnread` 的说明：索菲亚没有已读水位 ⇒ 恒 `0`（循环第一轮即返回）。 */
function remainingUnreadCount(_projection: ReadProjection): number {
  return 0
}

/**
 * 「待发文件 → 附件 id」。
 *
 * ⚠ 索菲亚移植点：上游是 `requests.ts` 的 `uploadComposerFiles(putAttachment, workspaceId, files)`。
 * 索菲亚**没有附件路由**（`src/host.ts` 的路由清单里没有 `putAttachment`）
 * ⇒ 没有选中文件时**空结果**（正常路径）；有选中文件时**如实报错**，
 * 而不是假装上传成功、也不是静默丢掉用户的文件。
 */
async function uploadComposerFiles(
  putAttachment: PutAttachment | undefined,
  files: readonly File[],
): Promise<{ readonly ok: true; readonly attachmentIds: readonly string[] } | { readonly ok: false; readonly error: string }> {
  if (files.length === 0) return { ok: true, attachmentIds: [] }
  if (putAttachment === undefined) {
    return { ok: false, error: '索菲亚宿主没有附件上传路由：消息只能以纯文本发送' }
  }
  const ids: string[] = []
  for (const file of files) {
    const result = await putAttachment({ workspaceId: '', file })
    if (!result.ok) return { ok: false, error: result.error.message }
    ids.push(result.value.attachmentId)
  }
  return { ok: true, attachmentIds: ids }
}
