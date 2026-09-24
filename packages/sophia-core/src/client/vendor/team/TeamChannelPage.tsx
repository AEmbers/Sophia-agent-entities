/**
 * 上游 `TeamChannelPage.tsx`（31.5KB / 574 行）的索菲亚版 —— **频道页**。
 *
 * ## 与上游的关系（先读这一段）
 *
 * 主人的验收口径是「UI 整份复制（不是参考着重写）」。本文件在**能照抄的每一处都照抄了**：
 *
 * - `mergeChannelView` / `followUpAt` / `printedActivityAt` / `unreadCounts` 四个纯函数
 *   **逐字照抄**（只把类型名换成索菲亚的）；
 * - 顶层结构 `main.surface` / `surfaceHeader` / `backRow` / `headerRow` / `headerCopy`
 *   / `headerMeta` / `timeline` / `timelineContent` / `messageRun` / `emptySurface` /
 *   `emptyState` / `errorState` / `loadingState` / `entryLine` / `entryRow` /
 *   `entryArrow` / `stateCluster` / `statusWord` 的**类名、层级、`data-team-channel`
 *   与 `data-thread-entry` 属性**全部与上游逐字一致（类名来自上游那份
 *   `channel.module.css` / `conversation.module.css` / `thread.module.css`，按字节复制）；
 * - `ThreadEntryRow` / `ThreadStateCluster` 两个子组件的**props、分支、文案键、
 *   `aria-label` 的四种组合**逐字保留；
 * - `refresh` / `refreshMembers` / `loadOlder` 的**并发世代号（`sequence` /
 *   `refreshSequenceRef`）与「首次加载才显示骨架、之后原地刷新」**逐字保留；
 * - composer 的 `key={draftKey}`、`pendingFiles`、`asTask` 三处接线逐字保留。
 *
 * **剥掉的功能**（每一块都在原位留了说明，不是静默删）：
 *
 * | 剥掉的上游功能 | 上游行号 | 理由 |
 * |---|---|---|
 * | 频道成员管理弹窗（`useChannelMembership` + `joinChannel` / `removeChannelMember` + `Modal`） | 310-314、385-414 | 索菲亚**没有频道成员关系**（成员属团不属频道，见 `slots.ts`）⇒ 没有可增删的事实 |
 * | 附件上传（`putAttachment` / `uploadComposerFiles`） | 339-345 | 索菲亚**没有附件路由**（见 `requests.ts`） |
 * | ref 跳转的宿主解析（`jumpToTaskThread` / `jumpToThread` / `hostTaskRefLookup` / `hostThreadRefLookup`） | 147-163 | 索菲亚**没有按 ref 解析的宿主路由**（`CAN_OPEN_REFS = false`）⇒ 未命中已加载时间线的 ref 不跳转 |
 * | `channelNameOf` / `memberOf`（ref 渲染成名字的两个查找） | 170-182 | 索菲亚的 `TeamMessage` **不收**这两个 prop（它只按字面渲染 ref） |
 * | `openMemberSession` | 461 | 索菲亚没有「把成员会话嵌进会话座」这条路（见 `slots.ts` 的剥除清单） |
 * | 分页（`loadOlder` + `hasMore` + `cursor`） | 290-303 | 索菲亚线格式一次给全量、`hasMore` 恒 `false` ⇒ 按钮不出现（代码保留但**永不进入**该分支是另一种「死代码」，故整块剥掉） |
 *
 * ## 索菲亚移植点：数据源换了，渲染一行没动
 *
 * | 上游 | 索菲亚 |
 * |---|---|
 * | `loadChannels({workspaceId, channelRef, direction, topLevelOnly, includeActivities, limit})` | `loadChannelTimeline({channelRef})`（见 `slots.ts` 的说明） |
 * | `loadMembers({workspaceId})` | `loadMembers()` |
 * | `loadInbox({workspaceId, limit})` | `loadInbox()` |
 * | `subscribeChanges(scope, listener)` | 同签名，`scope` 被索菲亚**忽略**（一条无作用域订阅） |
 * | `sendMessage(request)` | `sendChannelMessage(request)`；**索菲亚宿主没有这条路由** ⇒ 未提供时如实报错（见下） |
 *
 * ## ⚠ composer 的发送在索菲亚是**降级路径**（必须说清）
 *
 * 上游的 `send` 走 `sendMessage`（在频道里开一个新线程 + 发一条消息）。
 * 索菲亚宿主唯一的发送路由 `POST /api/sophia/team/message` **要求 `threadRef`**
 * （`src/host-data.ts` 的 `parseSendTeamMessageRequest` 判它非空）⇒ 它只能往
 * **已有线程**里发，无法开新线程。
 *
 * 处置（与 `bridge.ts` 里 `HALT_URL` / `TEAM_HALT_AVAILABLE` 同一手法）：
 * **composer 照常渲染**（不删控件 —— 删了等于把「为什么没有」一起藏起来），
 * 提交时若 `sendChannelMessage` 未提供，就把**具体原因**放进 composer 的 error 行：
 * 「索菲亚宿主还没有『在频道里开新帖』的路由（现有的
 * `POST /api/sophia/team/message` 要求 threadRef）」。
 * 不静默失败、不假装成功、也不假装能重试。
 */

import type { ReactElement } from 'react'
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type {
  AgentTeamChannelRef,
  AgentTeamClientMemberStatus,
  AgentTeamInbox,
  AgentTeamMemberId,
  AgentTeamThreadRef,
} from './agent-team-types.ts'
import type { TeamChannelTimeline, TeamChannelTimelineItem, TeamConversationProps } from './slots.ts'
import type { TeamDraftKey } from './drafts.ts'
import { TeamComposer } from './TeamComposer.tsx'
import { TeamMessage } from './TeamMessage.tsx'
import { TeamAvatarStack, type TeamAvatarOwner } from './TeamAvatarStack.tsx'
import { TeamCountBadge } from './TeamCountBadge.tsx'
import { TeamRunDivider } from './TeamRunDivider.tsx'
import { formatAbsoluteTime, formatInboxTime, formatTaskStatus, mentionNamesOf, taskStatusDot } from './team-formatters.ts'
import { TeamStateDot } from './TeamStateDot.tsx'
import { useTimelineScroll } from './timeline-scroll.ts'
import { hostTaskRefLookup } from './task-refs.ts'
import { chunkRunsWithDays, isRunGap } from './team-separators.ts'
import channelCss from './channel.module.css'
import css from './conversation.module.css'
import threadCss from './thread.module.css'

/** 频道页的 props。**逐项对照上游**见每条的说明。 */
interface TeamChannelPageProps {
  /**
   * ⚠ 上游这里是 `workspaceId: WorkspaceId`（每个请求必填）。
   * 索菲亚**没有 Workspace 这一维**（一个团一个视图）⇒ 整个字段剥掉。
   */
  readonly channelRef: AgentTeamChannelRef
  /** 主人（人类）自己的显示名。上游从 `humanIdentity` 投影取，索菲亚由调用方给（见 `TeamConversation.tsx`）。 */
  readonly humanName: string
  readonly humanAvatarUrl?: string | undefined
  readonly loadChannelTimeline: TeamConversationProps['loadChannelTimeline']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly loadMembers: TeamConversationProps['loadMembers']
  /** 主人自己的未读：上游是宿主的三分类判定，索菲亚恒 0（没有已读水位）。 */
  readonly loadInbox: TeamConversationProps['loadInbox']
  readonly drafts: TeamConversationProps['drafts']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly selectChannel: TeamConversationProps['selectChannel']
  readonly backToChannels: TeamConversationProps['backToChannels']
  /**
   * 「在频道里发新帖」。⚠ 索菲亚宿主没有该路由 ⇒ 可选；未提供时 composer
   * 提交走**如实报错**分支（见文件头）。
   */
  readonly sendChannelMessage?: TeamConversationProps['sendChannelMessage']
  readonly t: TeamConversationProps['t']
}

/**
 * Merge the freshest top-level window over what the reader already has. The
 * fresh window is authoritative for every Message it covers — a change wake
 * must move that row's live Task state, newest instant, and unread with it —
 * while older Messages loaded earlier are retained instead of discarded.
 *
 * **逻辑逐字照抄上游**（只把 `AgentTeamView` 换成 `TeamChannelTimeline`）。
 */
function mergeChannelView(current: TeamChannelTimeline, fresh: TeamChannelTimeline): TeamChannelTimeline {
  const freshKeys = new Set(fresh.items.map(item => item.message.messageId))
  const items = [...current.items.filter(item => !freshKeys.has(item.message.messageId)), ...fresh.items]
    .sort((left, right) => left.message.occurredAt - right.message.occurredAt)
  return {
    ...fresh,
    items,
    cursor: Math.min(fresh.cursor, current.cursor),
    // Older retained items may precede even a saturated fresh window.
    hasMore: fresh.hasMore || current.cursor < fresh.cursor,
  }
}

/**
 * The newest fact instant, or nothing when the entry's own Message is still the
 * newest fact on its Thread. **逐字照抄上游。**
 */
function followUpAt(item: TeamChannelTimelineItem): string | undefined {
  const lastActivityAt: string | undefined = item.lastActivityAt
  return lastActivityAt === undefined || lastActivityAt === item.messageOccurredAt ? undefined : lastActivityAt
}

/**
 * What the door prints about follow-up activity, or nothing. A resolved Task
 * stops printing it. **逐字照抄上游。**
 */
function printedActivityAt(item: TeamChannelTimelineItem): string | undefined {
  const status = item.task?.status
  return status === 'done' || status === 'closed' ? undefined : followUpAt(item)
}

/**
 * Host unread per Thread, keyed for the feed's rows: zero unread is the absence
 * of a badge, not a row. **逐字照抄上游**（索菲亚的 `unreadCount` 恒 0 ⇒ 恒空 Map）。
 */
function unreadCounts(inbox: AgentTeamInbox): ReadonlyMap<AgentTeamThreadRef, number> {
  // ⚠ 上游读 `item.thread.threadRef`；索菲亚的 `AgentTeamThread` 是
  // `WireThread` 的别名，主键叫 `threadId`（`agent-team-types.ts` 的
  // `AgentTeamThreadRef` 说明：branded ref → 裸 string，字段名随线格式）。
  return new Map(inbox.items.filter(item => item.unreadCount > 0).map(item => [item.thread.threadId, item.unreadCount]))
}

/**
 * 「这个构建里频道发帖能不能用」。`true` = 可用。
 *
 * ⚠ 与 `bridge.ts` 的 `TEAM_HALT_AVAILABLE` 同一纪律：**不可用要明说**，
 * 而不是留一个点了报 404 的按钮。判据只有一条 —— 调用方有没有提供
 * `sendChannelMessage`（`index.ts` 现在**不提供**，因为宿主没有那条路由）。
 */
export function channelSendUnavailableReason(route = '/api/sophia/team/message'): string {
  return `索菲亚宿主还没有「在频道里开新帖」的路由：现有的 ${route} 要求 threadRef（只能往已有线程里发），`
    + '而频道顶楼发帖要开一个新线程。这条消息没有发出去。'
}

export function TeamChannelPage({
  channelRef, humanName, humanAvatarUrl, loadChannelTimeline, subscribeChanges, loadMembers, loadInbox,
  drafts, selectThread, selectChannel, backToChannels, sendChannelMessage, t,
}: TeamChannelPageProps): ReactElement {
  const { useCallback, useEffect, useMemo, useRef, useState } = hooks()
  const [view, setView] = useState<TeamChannelTimeline>()
  const [members, setMembers] = useState<readonly AgentTeamClientMemberStatus[]>([])
  const [unreadByThread, setUnreadByThread] = useState<ReadonlyMap<AgentTeamThreadRef, number>>(new Map())
  const [actionError, setError] = useState<string>()
  const [loadError, setLoadError] = useState<string>()
  const error = actionError ?? loadError
  const [pendingFiles, setPendingFiles] = useState<readonly File[]>([])
  const [statusMessage, setStatusMessage] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [asTask, setAsTask] = useState(false)
  // The composer draft lives in the keyed draft cache: view switches unmount
  // this page, and a refresh must not cost the half-written message either.
  // The composer owns the subscription — this page only reads a snapshot when
  // it sends, so typing never re-renders the timeline.
  const draftKey: TeamDraftKey = `channel:${channelRef}`
  const mountedRef = useRef(false)
  // Flips after the first successful timeline load; later change wakes
  // refresh in place instead of showing the loading surface again.
  const loadedRef = useRef(false)
  const refreshSequenceRef = useRef(0)
  const channelLastItem = view?.items[view.items.length - 1]
  // Branded-ref navigation for message bodies: channel refs hop directly, and
  // task/thread refs resolve against this Channel's loaded timeline.
  //
  // ⚠ 索菲亚剥掉了后两句里的「退回宿主解析」（上游 147-158）：索菲亚**没有**
  //   按 ref 解析的宿主路由（`CAN_OPEN_REFS = false`，见 `adapters.ts`），
  //   故未命中已加载时间线的 ref 就**不跳转** —— 与「那些 ref 本来也不渲染成
  //   链接」一致（`TeamMessage` 只在 `canOpenRefs` 为真时才画链接）。
  const openRef = (ref: string): void => {
    if (ref.startsWith('channel:')) {
      if (ref !== channelRef) selectChannel(ref as AgentTeamChannelRef)
      return
    }
    if (ref.startsWith('thread:')) {
      const match = view?.items.find(item => item.thread.threadId === ref)
      if (match !== undefined) {
        selectThread(match.thread.threadId, channelRef, match.task?.taskId, match.taskNumber)
      }
      return
    }
    if (ref.startsWith('task:')) {
      const match = view?.items.find(item => item.task?.taskId === ref)
      if (match !== undefined) {
        selectThread(match.thread.threadId, channelRef, match.task?.taskId, match.taskNumber)
      }
    }
  }

  // 上游这里有 `hostTaskRefLookup(resolveTaskRefs, workspaceId)`；索菲亚的
  // `task-refs.ts` 把它收成**恒返回空数组**的 no-op（见那个文件的说明：
  // 没有 ref 解析路由）。保留调用点的形状，好让 `TeamMessage` 的
  // `onResolveTaskRefs` 仍然收到一个可调用函数。
  const lookupTaskRefs = hostTaskRefLookup(undefined, undefined)

  // The Thread entry row's owner stack speaks the same grammar as the Inbox
  // row's, Human included: the Host names which actor is the reader, the
  // Client's identity projection says what that actor looks like.
  const humanMemberId = view?.humanMemberId
  const humanIdentity: TeamAvatarHuman | undefined = humanMemberId === undefined
    ? undefined
    : { memberId: humanMemberId, name: humanName }

  const timeline = useTimelineScroll(`${view?.items.length ?? 0}:${channelLastItem?.message.messageId ?? ''}`)
  const channel = view === undefined ? undefined : { name: view.name }
  const channelMemberIds = new Set(view?.members.filter(item => item.channelRef === channelRef).map(item => item.memberId) ?? [])
  const channelMembers = members.filter(status => channelMemberIds.has(status.member.memberId) && status.member.state !== 'inactive' && status.member.state !== 'archived')
  // Presence counts ride the header meta line; error and unavailable do not count as online.
  const onlineCount = channelMembers.filter(status => status.presence === 'available' || status.presence === 'working').length
  const messageSender = (item: TeamChannelTimelineItem): AgentTeamMemberId => item.message.senderMemberId
  const handleByMember = new Map(members.map(status => [status.member.memberId, status.member.handle.replace(/^@/, '')]))

  const refresh = async (clearError = false) => {
    if (!mountedRef.current) return false
    const sequence = refreshSequenceRef.current + 1
    refreshSequenceRef.current = sequence
    // Only the first refresh owns the loading surface; change wakes refresh
    // the rendered timeline in place instead of flashing it back to skeleton.
    if (!loadedRef.current) setLoading(true)
    if (clearError) {
      setLoadError(undefined)
      setStatusMessage(undefined)
    }
    try {
      const [loaded, loadedMembers, loadedInbox] = await Promise.all([
        loadChannelTimeline({ channelRef }),
        loadMembers(),
        // The non-direct slice of the Host's own Inbox is the authority for
        // "what needs me on this Thread". 索菲亚没有已读水位 ⇒ 恒空，
        // 但调用点保留（上游的接线形状不变）。
        loadInbox(),
      ])
      if (!mountedRef.current || sequence !== refreshSequenceRef.current) return false
      if (loaded.ok) { setView(current => current === undefined ? loaded.value : mergeChannelView(current, loaded.value)); loadedRef.current = true } else setLoadError(loaded.error.message)
      if (loadedMembers.ok) setMembers(loadedMembers.value); else setLoadError(loadedMembers.error.message)
      // A failed unread read drops the badges instead of leaving counts the
      // reader can no longer trust; the failure surfaces like any other read.
      if (loadedInbox.ok) setUnreadByThread(unreadCounts(loadedInbox.value))
      else { setUnreadByThread(new Map()); setLoadError(loadedInbox.error.message) }
      if (loaded.ok && loadedMembers.ok && loadedInbox.ok) setLoadError(undefined)
      return loaded.ok && loadedMembers.ok && loadedInbox.ok
    } catch (cause) {
      if (mountedRef.current && sequence === refreshSequenceRef.current) setLoadError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally {
      if (mountedRef.current && sequence === refreshSequenceRef.current) setLoading(false)
    }
  }

  // Presence and membership live in the workspace projection; they never need
  // the Channel timeline refetch that a full refresh performs.
  const refreshMembers = async () => {
    if (!mountedRef.current) return
    try {
      const loaded = await loadMembers()
      if (!mountedRef.current) return
      if (loaded.ok) setMembers(loaded.value); else setLoadError(loaded.error.message)
    } catch (cause) {
      if (mountedRef.current) setLoadError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    mountedRef.current = true
    loadedRef.current = false
    setView(undefined)
    setLoadError(undefined)
    setLoading(true)
    void refresh()
    const disposers = [
      subscribeChanges({ kind: 'channel', channelRef }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setLoadError(update.message); return }
        void refresh()
      }),
      subscribeChanges({ kind: 'workspace' }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setLoadError(update.message); return }
        void refreshMembers()
      }),
      // Presence transitions commit nothing: only the member rows move, so
      // the header presence counts refresh without a timeline refetch.
      subscribeChanges({ kind: 'presence' }, update => {
        if (!mountedRef.current) return
        if (update.type === 'failed') { setLoadError(update.message); return }
        void refreshMembers()
      }),
    ]
    return () => {
      mountedRef.current = false
      refreshSequenceRef.current += 1
      for (const dispose of disposers) dispose()
    }
  }, [channelRef])

  // Editing the draft invalidates the one-shot status line. The setter returns
  // the same state when there is nothing to clear, so a keystroke does not
  // re-render the timeline now that the composer owns the draft.
  const clearSendState = useCallback((): void => {
    setStatusMessage(current => current === undefined ? current : undefined)
  }, [])

  const send = async () => {
    // Read the draft at send time: this page no longer subscribes to it, so a
    // captured render value would be stale after the composer's own edits.
    const { draft, recipients } = drafts.getSnapshot(draftKey)
    if (pending || draft.trim() === '') return
    const recipientIds = [...recipients].sort()
    setPending(true); setError(undefined); setStatusMessage(undefined)
    try {
      // ⚠ 索菲亚降级路径（见文件头）：没有这条路由就**明说**，不发一个必然 404 的请求，
      //   也不假装成功。`pendingFiles` 一并留在 chip 上，用户看到的是「这条没发出去」。
      if (sendChannelMessage === undefined) {
        setError(channelSendUnavailableReason())
        return
      }
      const result = await sendChannelMessage({ channelRef, body: draft.trim(), recipients: recipientIds })
      if (!result.ok) {
        setError(result.error.message)
      } else {
        setAsTask(false)
        await refresh()
        drafts.clear(draftKey)
        setPendingFiles([])
        setStatusMessage(undefined)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setPending(false) }
  }

  return <main className={css.surface} data-team-channel={channelRef}>
    <div className={css.surfaceHeader}>
      <div className={css.backRow}><primitives.Button size="sm" icon={<primitives.IconChevronLeftOutline14 />} onClick={backToChannels}>{t('backToChannels')}</primitives.Button></div>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{channel === undefined ? '# …' : `# ${channel.name}`}</h1>
          {channel !== undefined && <div className={channelCss.headerMeta}>
            <span>{t('memberCount', { count: channelMembers.length })}</span>
            <span>{t('onlineCount', { count: onlineCount })}</span>
          </div>}
        </div>
        {/* ⚠ 上游这里是一个「管理成员」按钮 + 成员管理弹窗（`Modal` +
            `TeamMemberRow` 的 add/remove 动作 + `useChannelMembership`）。
            索菲亚**整块剥掉**：索菲亚没有「频道成员关系」这个事实
            （成员属团、不属频道，见 `slots.ts` 的剥除清单），
            没有可增删的东西 ⇒ 画一个按钮只会得到「点了没反应」。
            剥掉的是**动作**，不是人数显示 —— 上面 `memberCount` / `onlineCount`
            已经在头部如实报出这个频道的可达成员数（团级事实的频道视图）。 */}
      </header>
    </div>

    <section ref={timeline.ref} onScroll={timeline.onScroll} className={css.timeline} aria-label={t('timelineLabel')}>
      <div className={css.timelineContent}>
        {loading && channel === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingChannels')}</p></div>}
        {!loading && channel === undefined && error === undefined && <div className={css.emptySurface}><p className={css.emptyState}>{t('emptyChannels')}</p></div>}
        {!loading && channel === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><primitives.Button size="sm" variant="outline" onClick={() => { void refresh(true) }}>{t('retry')}</primitives.Button></div>}
        {/* ⚠ 上游这里有一个「加载更早」（`loadOlder`）按钮，条件 `view?.hasMore`。
            索菲亚的线格式**一次给全量**、`hasMore` 恒 `false`（见 `slots.ts` 的
            `TeamChannelTimeline.hasMore`）⇒ 该按钮在索菲亚**结构上永不出现**。
            整块剥掉（而不是留一段永不进入的代码：那是另一种谎报——
            让读者以为这里支持分页）。 */}
        {channel !== undefined && view?.items.length === 0 && <div className={css.emptySurface}>
          <div className={css.emptyState}>
            <strong>{t('emptyMessages')}</strong>
            <span>{t('emptyMessagesHint')}</span>
          </div>
        </div>}
        {(view?.items.length ?? 0) > 0 && chunkRunsWithDays(view!.items, messageSender, item => item.messageOccurredAt).map((block, blockIndex) => block.kind === 'day'
          ? <p className={threadCss.daySeparator} key={`day-${blockIndex}-${block.label}`}><span>{block.label}</span></p>
          : <div className={css.messageRun} key={`run-${block.items[0]!.message.messageId}`}>
          {block.items.map((item, index) => {
            const senderStatus = members.find(member => member.member.memberId === item.message.senderMemberId)
            const human = item.message.senderMemberId === view!.humanMemberId
            const sender = human ? humanName : senderStatus?.member.handle ?? item.message.senderMemberId
            const turnGap = isRunGap(index > 0 ? block.items[index - 1]!.messageOccurredAt : undefined, item.messageOccurredAt)
            const task = item.task
            // The entry's own line is the gate under the body, and its state
            // leads that line: ownership, status, and unread answer the reader
            // where they are already reading.
            const unread = unreadByThread.get(item.thread.threadId) ?? 0
            // A turn divider already labels the gapped entry; its row stays chrome-free.
            // ⚠ 上游这里用 `<Fragment key={item.message.messageRef}>` 把
            // 「turn 分隔线 + 消息」两兄弟绑成一个 keyed 单元。索菲亚的 `hooks()`
            // 面里**没有** `Fragment`（`react-runtime.ts` 只在 `ReactFace` 上提供它，
            // 而 `hooks()` 只转出 hook），`<>…</>` 语法又**不支持 `key`** ⇒
            // 这里用**数组**表达同一件事：渲染结果与 Fragment 等价（不产生额外 DOM
            // 节点），两个兄弟各自带 key。这是移植点，不是行为改变。
            return [
              turnGap ? <TeamRunDivider key={`gap-${item.message.messageId}`} occurredAt={item.messageOccurredAt} /> : null,
              <TeamMessage
                key={item.message.messageId}
                senderName={sender}
                memberId={item.message.senderMemberId}
                human={human}
                {...(human ? (humanAvatarUrl === undefined ? {} : { avatarUrl: humanAvatarUrl }) : {})}
                body={item.message.body}
                t={t}
                occurredAt={item.messageOccurredAt}
                mentionNames={mentionNamesOf(item.mentions, handleByMember)}
                onOpenRef={openRef}
                onResolveTaskRefs={lookupTaskRefs}
                grouped={index > 0}
                showGroupedTime={item.topLevel && !turnGap}
                {...(senderStatus === undefined ? {} : { senderTitle: senderStatus.member.description })}
              >
                {item.topLevel && <ThreadEntryRow
                  item={item}
                  owners={item.claimOwners}
                  unread={unread}
                  human={humanIdentity}
                  t={t}
                  onOpen={() => { selectThread(item.thread.threadId, channelRef, task?.taskId, item.taskNumber) }}
                />}
              </TeamMessage>,
            ]
          })}
        </div>)}
      </div>
    </section>

    {channel !== undefined ? <TeamComposer
      key={draftKey}
      members={channelMembers}
      drafts={drafts}
      draftKey={draftKey}
      pending={pending}
      {...(statusMessage === undefined ? {} : { confirmation: statusMessage })}
      {...(error === undefined ? {} : { error })}
      onEdit={clearSendState}
      onSubmit={() => { void send() }}
      pendingFiles={pendingFiles}
      onFilesChange={setPendingFiles}
      asTask={asTask}
      onAsTaskChange={setAsTask}
      t={t}
    /> : <div />}
  </main>
}

/**
 * One entry's state: who is on the work, where it stands, and how much of it
 * needs the reader. **结构与上游逐字一致**（含「state 是标签不是控件」那条注释的理由）。
 */
function ThreadStateCluster({ task, owners, unread, human, t }: {
  readonly task: TeamChannelTimelineItem['task']
  readonly owners: readonly TeamAvatarOwner[]
  readonly unread: number
  readonly human: TeamAvatarHuman | undefined
  readonly t: TeamConversationProps['t']
}) {
  if (task === undefined && unread === 0) return null
  const namedOwners = namedAvatarOwners(owners, human)
  return <span className={css.stateCluster}>
    {/* ⚠ 上游是 `<TeamAvatarStack owners={namedOwners} label={claimersLabel(...)} human={human} />`。
        索菲亚的 `TeamAvatarStack` 已经把 human 融进 owner 的渲染（见该文件的说明），
        且没有 `claimersLabel`（索菲亚的 `team-formatters.ts` 里没有它）⇒
        label 沿用索菲亚既有的同义键（`TeamInboxPage` 用的是同一个键与同一段拼法）。 */}
    {task !== undefined && <TeamAvatarStack owners={namedOwners} label={t('claimers', { names: namedOwners.map(owner => `@${owner.name}`).join(', ') })} />}
    {task !== undefined && <TeamStateDot size={8} state={taskStatusDot(task.status)} />}
    {task !== undefined && <span className={css.statusWord}>{formatTaskStatus(task.status, t)}</span>}
    {/* The capsule is decoration inside the control whose label already carries
        the count, so the number is never pixels-only. */}
    <TeamCountBadge count={unread} />
  </span>
}

/**
 * The gate under one top-level Message. **结构与上游逐字一致**：
 * 状态在前、然后是「这条是什么」（任务号 / 后续活动 / 回复）、
 * 时间用 Inbox 的今天/昨天格式、精确时间挂在 `title` 上、未读写进 `aria-label`。
 */
function ThreadEntryRow({ item, owners, unread, human, t, onOpen }: {
  readonly item: TeamChannelTimelineItem
  readonly owners: readonly TeamAvatarOwner[]
  readonly unread: number
  readonly human: TeamAvatarHuman | undefined
  readonly t: TeamConversationProps['t']
  readonly onOpen: () => void
}) {
  const taskNumber = item.taskNumber
  const followUp = followUpAt(item)
  const printedActivity = printedActivityAt(item)
  const label = taskNumber !== undefined
    ? t('taskLabel', { number: taskNumber })
    : followUp === undefined ? t('replyAction') : t('threadLabel')
  const text = printedActivity === undefined ? label : `${label} · ${t('recentActivity', { time: formatInboxTime(printedActivity, t) })}`
  const openLabel = taskNumber === undefined
    ? unread > 0 ? t('openThreadUnread', { count: unread }) : t('openThread')
    : unread > 0 ? t('openTaskUnread', { number: taskNumber, count: unread }) : t('openTask', { number: taskNumber })
  // The state is a label, not a control: it stays outside the button so the
  // owner stack keeps its own accessible name — a labeled button prunes its
  // descendants from the accessibility tree — and so the control's name says
  // exactly what clicking it does.
  return <span className={css.entryLine} data-thread-entry="">
    <ThreadStateCluster task={item.task} owners={owners} unread={unread} human={human} t={t} />
    <button
      type="button"
      className={css.entryRow}
      aria-label={openLabel}
      {...(followUp === undefined ? {} : { title: formatAbsoluteTime(followUp) })}
      onClick={onOpen}
    >
      {/* ⚠ 上游这里还会在任务行前显示 `#${taskNumber}`（索菲亚没有任务序号 ⇒
          `taskNumber` 恒 `undefined`，那一支结构上不可达，故剥掉：
          留一段永不渲染的代码只会让读者以为索菲亚有任务序号）。 */}
      <span>{text}</span>
      <span className={css.entryArrow} aria-hidden="true"><primitives.IconChevronRightOutline14 size={12} /></span>
    </button>
  </span>
}

/**
 * 上游 `namedAvatarOwners`（`TeamAvatarStack.tsx:36`）的索菲亚版。
 *
 * 上游那个函数在 `TeamAvatarStack.tsx` 里，而索菲亚的 `TeamAvatarStack.tsx`
 * 已经把「human 覆盖 owner 的名字」这件事**内建**（它吃 `owner.avatarPath`，
 * 名字直接来自 owner）—— 这一点由**另一位 agent 的移植**定下，本文件不动它的契约。
 * 但频道页的 `ThreadEntryRow` 仍需要一个「把 human 的名字盖到 owner 上」的步骤
 * （上游的 `ThreadStateCluster` 就是这么做的），故这里保留**同一个函数体**，
 * 名字与语义与上游同源。
 */
function namedAvatarOwners(owners: readonly TeamAvatarOwner[], human: TeamAvatarHuman | undefined): readonly TeamAvatarOwner[] {
  if (human === undefined) return owners
  return owners.map(owner => owner.memberId === human.memberId ? { memberId: owner.memberId, name: human.name } : owner)
}

/** 读者自己的身份（上游 `TeamAvatarStack.tsx` 的同名接口；索菲亚这里只用名字）。 */
interface TeamAvatarHuman {
  readonly memberId: AgentTeamMemberId
  readonly name: string
}
