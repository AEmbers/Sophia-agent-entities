import type { ReactElement } from 'react'
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { AgentTeamInboxItem } from './agent-team-types.ts'
import type { TeamConversationProps } from './slots.ts'
import { formatAbsoluteTime, formatInboxTime } from './team-formatters.ts'
import { TeamAvatarStack } from './TeamAvatarStack.tsx'
import { TeamCountBadge } from './TeamCountBadge.tsx'
import css from './conversation.module.css'
import inboxCss from './inbox.module.css'

/**
 * 上游 `TeamInboxPage.tsx` 的索菲亚版 —— **人工收件箱**。
 *
 * ⚠ 索菲亚移植点（`react` 的取用方式）：上游顶层写的是
 * `import { useCallback, useEffect, useRef, useState } from 'react'`
 * —— 那是一条**顶层值导入**，会在插件注册期产生一条顶层模块加载调用，
 * 撞红索菲亚两条既有断言（详见 `../../react-runtime.ts` 的文件头对照表）。
 * 索菲亚的既有手法是**惰性取**：`hooks()` 在组件渲染期调用。
 */

/**
 * 一件收件箱行。
 *
 * ⚠ 相对上游的三处**实质差异**（改动②C：数据源换成索菲亚的）：
 *
 * 1. **`workspaceId` / `workspaceTitle` 没了。** 上游的行按 Workspace 分片
 *    （收件箱是「跨 Workspace 合并的队列」）。索菲亚是**一个团一个视图**
 *    （`PanelStore` 一次给一个 `WireTeam`），没有 Workspace 这一维 ⇒
 *    行只带 `channelName`（上游本来也有这个字段）。
 * 2. **`item.newestActor` 从「actor 对象」换成「头像所需的三个字段」。**
 *    上游的 actor 是它自己的 `AgentTeamInboxActor`（含它自己算好的 name）。
 *    索菲亚的 `adapters.ts` 也会给出 `{memberId, name}`，但**头像路径**
 *    （`avatarPath`）只有团长的 `WireMember` 上才有 —— 而本页拿不到团长表
 *    （它的 props 只有 `loadInbox`）。⇒ 行只带 `memberId` + `name`，
 *    头像退回首字圆（`TeamAvatarStack` 的降级路径）。
 *    主人的「头像换成我们的」在**有团长表的页面**（Thread 页）完整生效；
 *    本页的行头像如实降级，**不伪造路径**。
 * 3. **`claimOwners` 直接来自 `item`**，不再另起一个 state ——
 *    索菲亚没有 claim 模型 ⇒ 它恒为空数组（见 `agent-team-types.ts`），
 *    分一个 state 去装一个恒空的数组没有意义。
 */
interface TeamInboxRow {
  readonly item: AgentTeamInboxItem
}

/**
 * How many 「最近活跃」 rows the merged page may show.
 *
 * ⚠ **索菲亚的上限在数据层**（`adapters.toInbox(team, limit)` 已经切过一刀，
 * 见 `index.ts` 的 `RECENT_ROWS_LIMIT`）—— 与上游「页面自己 trim 合并后的列表」
 * 不同，因为索菲亚没有跨 Workspace 合并这一步（只有一个团）。
 * 本常量因此**不在本页使用**（`loadInbox` 给的已经是切好的）。
 */
const RECENT_ROWS_LIMIT = 5

/**
 * Queue order: newest unread first, one total order.
 *
 * ⚠ 索菲亚的`items`恒为空（没有已读水位）⇒ 本比较函数在索菲亚只对 `recent`
 * 起作用。逻辑**逐字保留上游**（含 `newestSequence` 的并列打破），
 * 因为一旦宿主补上已读水位，这里不需要改。
 */
function compareInboxRows(left: TeamInboxRow, right: TeamInboxRow): number {
  const leftAt = Date.parse(left.item.newestOccurredAt)
  const rightAt = Date.parse(right.item.newestOccurredAt)
  const byTime = (Number.isNaN(rightAt) ? 0 : rightAt) - (Number.isNaN(leftAt) ? 0 : leftAt)
  return byTime !== 0 ? byTime : right.item.newestSequence - left.item.newestSequence
}

/**
 * The Human Inbox.
 *
 * ## 索菲亚移植点（数据源，改动②C）
 *
 * 上游对**每个可见 Workspace** 各发一次 `loadInbox({ workspaceId, limit: 100 })`，
 * 再用 `Promise.all` 合并。索菲亚的 `loadInbox` **不收参数**
 * （一个团一次，见 `slots.ts`），因为它本来就只有一份视图。
 * ⇒ `refresh()` 从「N 个 Promise 合并」塌缩成「一次调用」，
 *   但**保留了上游那套结果形状判断**（`ok` / `error.message`）与
 *   「首次加载独占 loading 面、后续唤醒原地刷新」的行为（`loadedRef`）。
 *
 * ## 索菲亚的诚实降级（**这是本页最重要的一句**）
 *
 * 「需要我」队列（`items`）在索菲亚**结构上恒为空**：索菲亚账本不记已读水位，
 * 也没有结构化 @提到 ⇒ `unreadCount` / `directCount` 恒 0。
 * 真实有内容的是「最近活跃」那一段。本页因此会**几乎总是**只显示「最近活跃」——
 * 这是**如实降级**，不是缺陷。两个区段的标题与空态都由上游的分支接管，
 * 所以界面不会出现「一个空标题下面什么都没有」的怪样子。
 */
export function TeamInboxPage({ loadInbox, subscribeChanges, selectThread, selectChannel, t }: {
  readonly loadInbox: TeamConversationProps['loadInbox']
  readonly subscribeChanges: TeamConversationProps['subscribeChanges']
  readonly selectThread: TeamConversationProps['selectThread']
  readonly selectChannel: TeamConversationProps['selectChannel']
  readonly t: TeamConversationProps['t']
}): ReactElement {
  const { useCallback, useEffect, useRef, useState } = hooks()
  const [rows, setRows] = useState<readonly TeamInboxRow[]>()
  const [recentRows, setRecentRows] = useState<readonly TeamInboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  // 只有**首次**刷新独占 loading 面；后续唤醒原地刷新已渲染的行，
  // 不把它闪回骨架（上游逐字保留的行为）。
  const loadedRef = useRef(false)
  // ⚠ 索菲亚这里**不再有** `useWorkspaces(...)`：上游那个 hook 订阅宿主
  //   的 Workspace 列表，索菲亚没有这个服务（见 slots.ts 的剥除清单）。
  //   换来的是「一次 loadInbox 就是全部」——少一个订阅、少一个失败面。

  const refresh = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    const result = await loadInbox()
    if (result.ok) {
      setRows(result.value.items.map(item => ({ item })).sort(compareInboxRows))
      // ⚠ 上限**由数据层施加**（`adapters.toInbox` 的 `limit`），
      //   不再像上游那样在这里 `.slice(0, RECENT_ROWS_LIMIT)`：
      //   索菲亚没有跨 Workspace 合并 ⇒ 没有「合并后要再切一刀」这一步。
      setRecentRows(result.value.recent.map(item => ({ item })))
      setError(undefined)
    } else {
      setError(result.error.message)
    }
    loadedRef.current = true
    setLoading(false)
  }, [loadInbox])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => subscribeChanges(undefined, update => {
    if (update.type === 'failed') {
      setError(update.message)
      return
    }
    void refresh()
  }), [subscribeChanges, refresh])

  /**
   * 打开一行。
   *
   * ⚠ 索菲亚的三处差异（都是「上游有、索菲亚没有」）：
   * - **没有 `selectWorkspace`**：索菲亚没有 Workspace 这一维。
   * - **没有 `taskRef` / `taskNumber` 参数**：索菲亚的线程与任务之间没有外键，
   *   也没有任务序号（见 `adapters.ts` 的 `taskOf` 说明）⇒
   *   只把 `threadRef` 与 `channelRef` 交出去（`selectThread` 的后两个参数可选）。
   *   这是**诚实**的：拿不到的外键不编一个（编出来会跳到错的线程）。
   */
  const open = (row: TeamInboxRow): void => {
    // 先定位频道再定位线程：索菲亚的频道选择带「选区失效回退」
    // （`components.tsx` 的 `selectedChannelId` 那条 OCR 修复），
    // 不先设频道会让线程页的频道名解析为空。
    selectChannel(row.item.channelRef)
    selectThread(row.item.thread.threadId)
  }

  // 页体骑共享的会话座：同一个 header 带、880px 阅读列、响应式边距与
  // 滚动条留白，与 Channel / Thread 一致 —— 切换界面时内容列不跳。
  // ⚠ 索菲亚的 `transcript.tsx`/`panel.tsx` 用的是**同类名**（本目录的
  //   `conversation.module.css`），所以这三页的观感与索菲亚既有面板一致。
  const totalUnread = rows?.reduce((sum, row) => sum + row.item.unreadCount, 0) ?? 0
  const totalMentions = rows?.reduce((sum, row) => sum + row.item.directCount, 0) ?? 0
  // ⚠ 上游这里算「屏幕上是否跨了多个 Workspace」，决定行首要不要印 Workspace 名。
  //   索菲亚单团 ⇒ 恒为 `false`。**保留 `showWorkspace` 这个变量与它的分支**
  //   （而不是把 JSX 里那两处删掉）：删了就要改 JSX 结构，
  //   而本页的 JSX 结构是「整份复制」要求保住的。取值恒假，分支恒不渲染。
  const showWorkspace = false
  return <main className={css.surface} data-team-inbox>
    <div className={css.surfaceHeader}>
      <header className={css.headerRow}>
        <div className={css.headerCopy}>
          <h1>{t('inboxTitle')}</h1>
          {rows !== undefined && rows.length > 0 && <p className={inboxCss.headerMeta}>
            <span>{t('inboxHeaderThreads', { count: rows.length })}</span>
            {/* 页面主要问的那个数字领这一行；提及只在队列真的有时才加入。 */}
            <span className={inboxCss.headerUnread}>{t('inboxHeaderUnread', { count: totalUnread })}</span>
            {totalMentions > 0 && <span>{t('inboxHeaderMentions', { count: totalMentions })}</span>}
          </p>}
        </div>
      </header>
    </div>
    <div className={css.timeline}>
      <div className={css.timelineContent}>
        {loading && rows === undefined && error === undefined && <div className={css.emptySurface}><p className={css.loadingState}><span className={css.loadingMark} aria-hidden="true" />{t('loadingInbox')}</p></div>}
        {!loading && rows === undefined && error !== undefined && <div className={css.errorState} role="alert"><span>{error}</span><primitives.Button size="sm" variant="outline" onClick={() => { void refresh() }}>{t('retry')}</primitives.Button></div>}
        {rows !== undefined && (rows.length === 0 && recentRows.length === 0
          ? <div className={css.emptySurface}>
              <div className={css.emptyState}>
                <strong>{t('inboxEmptyTitle')}</strong>
                <span>{t('inboxEmptyHint')}</span>
              </div>
            </div>
          : <>
              {rows.length > 0 && <section className={inboxCss.section}>
                <h2 className={inboxCss.sectionTitle}>{t('inboxSectionNeedsMe')}<span className={inboxCss.sectionCount}>{rows.length}</span></h2>
                <div className={inboxCss.list}>
                  {rows.map(row => <InboxQueueRow key={`${row.item.channelRef} ${row.item.thread.threadId}`} row={row} t={t} showWorkspace={showWorkspace} onOpen={() => { open(row) }} />)}
                </div>
              </section>}
              {recentRows.length > 0 && <section className={inboxCss.section}>
                <h2 className={inboxCss.sectionTitle}>{t('inboxSectionRecent')}<span className={inboxCss.sectionCount}>{recentRows.length}</span></h2>
                <div className={inboxCss.list}>
                  {recentRows.map(row => <InboxQueueRow key={`${row.item.channelRef} ${row.item.thread.threadId}`} row={row} t={t} showWorkspace={showWorkspace} onOpen={() => { open(row) }} />)}
                </div>
              </section>}
            </>)}
        {rows !== undefined && error !== undefined && <p className={css.error} role="alert">{error}</p>}
      </div>
    </div>
  </main>
}

/**
 * One queue row, shaped like the shipped two-line result row.
 *
 * ⚠ 索菲亚的一处**实质简化**（改动②A + 数据源）：
 *
 * 上游这里区分两种徽标口径 —— `named`（这行**点了我的名**，实心胶囊）与
 * 「只是动了」（发丝线胶囊），依据是 `item.directCount > 0`。
 * 索菲亚**没有结构化 @提到** ⇒ `directCount` 恒 0 ⇒ `named` 恒 `false`
 * ⇒ 胶囊恒为发丝线口径。
 *
 * **保留 `named` 这个变量与它的两个分支**（而不是把实心那一支删掉）：
 * ① 它是上游语义，删掉就多一处与上游的差异；② 宿主一旦补上结构化提到，
 * 这里不需要动。取值在索菲亚恒 `false` —— 如实记录，且**可核实**
 * （`adapters.ts` 里 `directCount` 的来源只有一处，就是那个常量 `0`）。
 */
function InboxQueueRow({ row, t, showWorkspace, onOpen }: {
  readonly row: TeamInboxRow
  readonly t: TeamConversationProps['t']
  readonly showWorkspace: boolean
  readonly onOpen: () => void
}): ReactElement {
  const { item } = row
  const actor = item.newestActor
  const owners = item.claimOwners
  const named = item.directCount > 0
  const countLabel = named
    ? t('inboxRowUnreadMentions', { count: item.unreadCount, mentions: item.directCount })
    : t('inboxRowUnread', { count: item.unreadCount })
  // ⚠ 头像 owner 的形状：上游的 `TeamAvatarOwner` 是
  //   `{ memberId, name }`；索菲亚那边多一个**可选** `avatarPath`
  //   （见 `TeamAvatarStack.tsx`）。本页拿不到团长表 ⇒ 不传 `avatarPath`
  //   ⇒ `TeamAvatarStack` 走首字圆降级路径（**不伪造一个路径**）。
  const toOwner = (one: { readonly memberId: string; readonly name: string }): { readonly memberId: string; readonly name: string } => ({ memberId: one.memberId, name: one.name })
  return <button type="button" className={inboxCss.row} data-named={named || undefined} onClick={onOpen}>
    {/* 谁在这个线程上，领每一行 —— 「最近活跃」那一段没有 live owner ⇒ 回退到
        最新事实来自谁（索菲亚没有 claim 模型 ⇒ `owners` 恒空 ⇒ **总是**走回退分支）。
        这一列的语义因此是「最后说话的人」，与上游在 claimless 线程上的表现一致。 */}
    <span className={inboxCss.rowActor}>
      {owners.length > 0
        ? <TeamAvatarStack owners={owners.map(toOwner)} label={t('claimers', { names: owners.map(owner => `@${owner.name}`).join(', ') })} />
        : <TeamAvatarStack owners={[toOwner(actor)]} label={t('inboxRowActor', { name: `@${actor.name}` })} />}
    </span>
    <span className={inboxCss.rowLine}>
      <span className={inboxCss.rowCrumb}>
        {showWorkspace && <span className={inboxCss.rowWorkspace}>{t('workspaces')}</span>}
        {showWorkspace && ' / '}
        <span className={inboxCss.rowChannel}>#{item.channelName}</span>
        {' '}
        {/* ⚠ 索菲亚没有任务序号（`adapters.ts` 的 `taskNumber` 恒 `undefined`）
            ⇒ 这个任务标签**不渲染**。上游的 `undefined` 判据原样保留。 */}
        {item.taskNumber !== undefined && <span className={inboxCss.rowTask}>{t('taskLabel', { number: item.taskNumber })}</span>}
      </span>
      <TeamCountBadge count={item.unreadCount} tone={named ? 'solid' : 'hairline'} label={countLabel} />
      <time className={inboxCss.rowTime} dateTime={item.newestOccurredAt} title={formatAbsoluteTime(item.newestOccurredAt)}>{formatInboxTime(item.newestOccurredAt, t)}</time>
    </span>
    <span className={inboxCss.rowPreview}>{item.previewText}</span>
  </button>
}

/**
 * 供父 agent 核对的常量：本页的「最近活跃」上限**由数据层施加**
 * （`adapters.toInbox(team, limit)`），页面不再 trim。
 * 导出它而不是让它变成死角 —— 结构门禁与父 agent 都能核到一个取值。
 */
export { RECENT_ROWS_LIMIT }
