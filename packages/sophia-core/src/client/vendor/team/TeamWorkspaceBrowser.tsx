/**
 * 左栏的**总装**（上游 `TeamWorkspaceBrowser.tsx` 的索菲亚版）。
 *
 * 用户截图里左栏从上到下的五块，全部由本文件排布：
 * ① 收件箱入口（`inboxCard` + `InboxMark`）→ ② 工作区选择器
 * （`TeamWorkspaceSelector`）→ ③ 频道分组（`TeamChannelsPanel`）→
 * ④ Agents 分组（`TeamAgentsPanel`）→ ⑤ 底部两个入口
 * （`TeamFooterAction` / `TeamMembersAction`，由调用方与本节并排挂在槽位上）。
 *
 * ## 与上游的差异（每条都是「索菲亚没有那个事实」，**不静默删**）
 *
 * | 上游 | 索菲亚 | 原因 |
 * |---|---|---|
 * | `useWorkspaces(selector)`（宿主 Workspace 目录服务的 hook） | **显式 prop** `workspaces` | 索菲亚没有 `@deepseek-ai/dsh-api-workspace-controller/client`；「工作区」在索菲亚是团（见 `slots.ts` 的 `TeamSidebarWorkspace` 说明） |
 * | `subscribeReads`（刚读完一条 Thread 的通知） | **剥掉** | 索菲亚没有已读水位 ⇒ 没有这个事件；徽章未读数恒 0 |
 * | `wide` / `expandSidebar`（`PropsRuntime<'sidebar.workspaces'>` 注入） | **显式 props** | 索菲亚的面板不是宿主侧栏的 rail，见 `slots.ts` 的 `TeamSidebarProps.wide` 说明 |
 * | `navigationState.memberSessionId` 的几处分支 | **保留表达式** | `TeamNavigationSnapshot` 里该字段存在（runtime-only），但索菲亚没有「把成员会话嵌进会话座」的路由 ⇒ 它**永远不会被赋值**：分支结构在、数据不可达（与 `presence === 'error'` 同一条如实记录纪律） |
 * | `readonly AgentTeamAddMemberRequest[] creatingAgents`（本地「正在创建」跟踪） | **剥掉** | 它靠 `addMember` 的返回值带回中间态；索菲亚的路由只回 `{ok:true}`，没有可跟踪的中间态 |
 *
 * @module @sophia/core/client/vendor/team/TeamWorkspaceBrowser
 */

import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { TeamSidebarProps } from './slots.ts'
import { TeamWorkspaceSelector } from './TeamWorkspaceSelector.tsx'
import { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
import { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
import css from './sidebar.module.css'

type SidebarSection = 'channels' | 'agents'

/**
 * The Inbox entry's icon with its unread mark. The quantity left this surface
 * and lives in the control's accessible name: the sidebar answers whether
 * anything is waiting at a glance, and the number — which moves on every fact —
 * is what a reader asks for on purpose. The mark hangs off the icon rather than
 * off the control, so the wide card and the 36px rail button put the same dot
 * on the same corner of the same glyph.
 *
 * ⚠ 索菲亚的数据后果（如实记录，**不是缺陷掩盖**）：未读数来自
 * `AgentTeamInbox.totalUnreadCount`，而索菲亚**没有已读水位** ⇒ 它恒为 0
 * （见 `adapters.ts` 的 `toInbox`）⇒ **圆点恒不出现**。
 * 有内容的是「最近活跃」那一段（收件箱页里）。
 */
function InboxMark({ unread }: { readonly unread: number }) {
  const { IconQueueOutline14 } = primitives
  return <span className={css.inboxMark}>
    <IconQueueOutline14 size={16} />
    {unread > 0 && <span className={css.inboxDot} data-team-inbox-dot aria-hidden="true" />}
  </span>
}

export function TeamWorkspaceBrowser({ wide, expandSidebar, navigation, workspaces, selectWorkspace, selectChannel, selectInbox, t, loadMembers, loadInbox, subscribeChanges, addMember, setMemberLifecycle, loadChannels, createChannel, switchModel }: TeamSidebarProps) {
  const { useEffect, useRef, useState, useSyncExternalStore } = hooks()
  const { IconAgentPresetOutline16, IconListPenOutline16, Tooltip } = primitives
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  const selected = navigationState.workspaceId
  const selectedExists = selected !== undefined && workspaces.some(workspace => workspace.workspaceId === selected)
  const selectedId = selectedExists ? selected : workspaces[0]?.workspaceId
  // Exactly one sidebar row carries aria-current='page': the open Channel while
  // one is set, the selected Agent card while a Member Session view is open,
  // otherwise the browsed Workspace's overview. The selected row keeps its
  // quiet folder tint (data-selected) in every case. The mention-Inbox card
  // takes the marker while the Inbox page stands, and stands down while the
  // embedded Member Session covers that page: the Inbox stays the remembered
  // face underneath — closing the overlay returns to it, marker included —
  // but the card is not a second current page while an Agent holds the seat.
  const overviewIsCurrent = navigationState.channelRef === undefined && navigationState.memberSessionId === undefined && navigationState.inbox !== true
  const inboxIsCurrent = navigationState.inbox === true && navigationState.memberSessionId === undefined
  // Rail icons request expansion and name the section to reveal once wide.
  const [pendingSection, setPendingSection] = useState<SidebarSection>()
  const channelsRef = useRef<HTMLDivElement>(null)
  const agentsRef = useRef<HTMLDivElement>(null)
  // The cross-Workspace Inbox badge: one scope-less subscription while the
  // Team sidebar stands; every wake re-pulls each Workspace's unread total
  // (limit 1 — totals cover every row, never the list). Same-burst wakes
  // coalesce behind a short debounce; the number is whatever the Host's whole
  // unread slice returns, mentions included rather than alone.
  const [inboxTotal, setInboxTotal] = useState(0)
  // One name for both entries: what the control is, and how much waits behind
  // it. The rail repeats it as its hover hint, which is the only place a reader
  // still meets the quantity without opening the page.
  const inboxLabel = inboxTotal > 0 ? t('inboxTitleWithCount', { count: inboxTotal }) : t('inboxTitle')
  useEffect(() => {
    let disposed = false
    let scheduled: ReturnType<typeof setTimeout> | undefined
    const refresh = async (): Promise<void> => {
      const results = await Promise.all(workspaces.map(workspace => loadInbox({ workspaceId: workspace.workspaceId, limit: 1 })))
      if (disposed) return
      setInboxTotal(results.reduce((sum, result) => result.ok ? sum + result.value.totalUnreadCount : sum, 0))
    }
    const schedule = (): void => {
      if (scheduled !== undefined) return
      scheduled = setTimeout(() => { scheduled = undefined; void refresh() }, 200)
    }
    void refresh()
    const unsubscribe = subscribeChanges(undefined, update => {
      if (update.type === 'changed') schedule()
    })
    // ⚠ 索菲亚移植点：上游这里还挂了一次 `subscribeReads(schedule)`
    // （「刚完成一次 Thread 读」也要刷徽章）。索菲亚没有已读水位、也没有这个
    // 事件 ⇒ 该订阅剥掉（见文件头的表）。
    return () => {
      disposed = true
      if (scheduled !== undefined) clearTimeout(scheduled)
      unsubscribe()
    }
  }, [loadInbox, subscribeChanges, workspaces])

  useEffect(() => {
    // The Inbox page is global and needs no selected Workspace, so the
    // auto-select must not yank the seat back to a Workspace overview.
    if (navigationState.inbox === true) return
    if (navigationState.mode === 'team' && selectedId !== undefined && selectedId !== selected) {
      selectWorkspace(selectedId)
    }
  }, [navigationState.inbox, navigationState.mode, selected, selectedId, selectWorkspace])

  useEffect(() => {
    if (!wide || pendingSection === undefined) return
    const node = pendingSection === 'agents' ? agentsRef.current : channelsRef.current
    setPendingSection(undefined)
    queueMicrotask(() => { node?.querySelector<HTMLButtonElement>('button')?.focus() })
  }, [wide, pendingSection])

  if (!wide) {
    return <nav className={css.railWorkspace} aria-label={t('workspaceSections')}>
      <Tooltip label={inboxLabel} side="right">
        <button type="button" className={css.railButton} aria-label={inboxLabel} aria-current={inboxIsCurrent ? 'page' : undefined} onClick={() => { selectInbox(); expandSidebar() }}>
          <InboxMark unread={inboxTotal} />
        </button>
      </Tooltip>
      <Tooltip label={t('channels')} side="right">
        <button type="button" className={css.railButton} aria-label={t('channels')} onClick={() => { setPendingSection('channels'); expandSidebar() }}>
          <IconListPenOutline16 size={16} />
        </button>
      </Tooltip>
      <Tooltip label={t('agents')} side="right">
        <button type="button" className={css.railButton} aria-label={t('agents')} onClick={() => { setPendingSection('agents'); expandSidebar() }}>
          <IconAgentPresetOutline16 size={16} />
        </button>
      </Tooltip>
    </nav>
  }

  return <section className={css.workspaceBrowser} aria-label={t('workspaces')}>
    {/* The Inbox is the one destination that crosses Workspaces — its total sums
        every one of them — so it stands above the selector rather than inside
        the scope that selector names. */}
    <button type="button" className={css.inboxCard} aria-label={inboxLabel} aria-current={inboxIsCurrent ? 'page' : undefined} onClick={selectInbox}>
      <InboxMark unread={inboxTotal} />
      <span className={css.inboxCardLabel}>{t('inboxTitle')}</span>
    </button>
    <TeamWorkspaceSelector workspaces={workspaces} selectedId={selectedId} current={overviewIsCurrent} onSelect={selectWorkspace} t={t} />
    {selectedId !== undefined && <div className={css.workspaceSection}>
      <div ref={channelsRef}>
        <TeamChannelsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} loadChannels={loadChannels} subscribeChanges={subscribeChanges} createChannel={createChannel} {...(navigationState.memberSessionId !== undefined || navigationState.channelRef === undefined ? {} : { selectedChannelRef: navigationState.channelRef })} selectChannel={selectChannel} t={t} />
      </div>
      <div ref={agentsRef}>
        <TeamAgentsPanel key={selectedId} workspaceId={selectedId} loadMembers={loadMembers} subscribeChanges={subscribeChanges} addMember={addMember} setMemberLifecycle={setMemberLifecycle} {...(switchModel === undefined ? {} : { switchModel })} t={t} />
      </div>
    </div>}
  </section>
}
