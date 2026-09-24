/**
 * `vendor/team/` 的**接线入口** —— 索菲亚面板如何把这个目录挂到自己的数据上。
 *
 * ## 谁调用这里
 *
 * 父 agent 在 `panel.tsx` 里接线（本目录**不改** `panel.tsx`）。
 * 调用形状：
 *
 * ```tsx
 * import { createTeamDataSource, TeamInboxPage, TeamThreadPage } from './vendor/team/index.ts'
 * const source = createTeamDataSource(store)   // store: PanelStore
 * // 然后按导航态渲染 <TeamInboxPage {...source.conversationProps(t)} /> 等
 * ```
 *
 * ## 数据流（一句话）
 *
 * `PanelStore.subscribe/getSnapshot/load` → `view: WireView` →
 * `sophiaTeam(store)` 取出**当前团** → `adapters.ts` 换算成界面形状 →
 * 喂给移植页面的 props。
 *
 * ## 「当前团」怎么定（索菲亚与上游最大的一处结构差异）
 *
 * 上游的页面按 **Workspace** 分片（一个 Workspace 一个团，`workspaceId` 是
 * 每个请求的必填参数）。索菲亚是**一个团一个视图**：
 * `WireView.teams` 是一个数组，面板 `panel.tsx` 用
 * `teams.map(one => <TeamPanel key={one.teamId} …>)` 逐团渲染（该写法由
 * `tests/client-sources.spec.ts` 与 `scripts/check-t5-structure.mjs` 双向钉住）。
 *
 * ⇒ 本模块把「Workspace」这一维**收敛成「选哪个团」**：
 * `createTeamDataSource(store, teamId?)` 里的 `teamId` 省略时取**第一个**团。
 * `workspaceId` 这个上游概念在索菲亚没有对应事实，故移植页面的 props 里
 * **不再有** `workspaceId`（见 `slots.ts` 的剥除清单）。
 *
 * @module @sophia/core/client/vendor/team
 */

import type { PanelStore, PanelSnapshot } from '../../panel-store.ts'
import type { WireTeam, WireView, WireMember } from '../../../wire.ts'
import {
  CAN_OPEN_REFS,
  handleIndex,
  memberGroupsOf,
  memberStatusIndex,
  rosterOf,
  toChannelTimeline,
  toChannelView,
  toInbox,
  toThreadHistory,
  toThreadObservations,
  workspacesOf,
} from './adapters.ts'
import type { TeamWorkspaceChoice } from './TeamWorkspaceSelector.tsx'
import { requestSidebarAddMember, requestSidebarCreateChannel, requestSidebarMemberLifecycle, requestTeamMessage } from './requests.ts'
import type { TeamChangeListener, TeamConversationProps, TeamRemoteResult, TeamSettingsProps, TeamSidebarProps } from './slots.ts'
import { TeamDraftStore } from './drafts.ts'
import { TeamNavigation } from './navigation.ts'
import { zh as teamZh } from './locales.ts'

/** 收件箱「最近活跃」段的行数上限（上游 `RECENT_ROWS_LIMIT`，逐字沿用同一个数字）。 */
export const RECENT_ROWS_LIMIT = 5

/** 从一次快照里取到要渲染的那个团。`teamId` 省略时取第一个（见文件头）。 */
export function currentTeam(view: WireView | null, teamId?: string): WireTeam | undefined {
  if (view === null) return undefined
  if (teamId === undefined) return view.teams[0]
  return view.teams.find(team => team.teamId === teamId)
}

/**
 * 索菲亚面板 → 移植 UI 需要的 props。
 *
 * ⚠ **每一个方法都必须返回 `TeamRemoteResult`**（上游的 `{ok,value}|{ok,error}`），
 * 因为移植进来的页面就是这么写的（`result.ok ? … : result.error.message`）。
 * 索菲亚的 `PanelStore` 用的是 `{status,view,error,notice}` 形状 ⇒
 * 换算在下面每个方法里各做一次，**不**改上游 UI 的分支写法。
 */
export interface TeamDataSource {
  /** 取当前快照（父 agent 可直接 `useSyncExternalStore` 订阅它）。 */
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => PanelSnapshot
  /** 主动拉一次（面板的 `load()`；并发合并与世代校验都在 `PanelStore` 里）。 */
  readonly load: () => Promise<void>
  /** 构造会话座两页的 props。 */
  readonly conversationProps: (t: (key: string, params?: Record<string, unknown>) => string) => TeamConversationProps
  /** 当前团的 id（没有团时为 `undefined`）。 */
  readonly teamId: () => string | undefined
  /**
   * **模式真源**：本数据源持有的那一个 `TeamNavigation` 实例。
   *
   * ⚠ 为什么必须转出来（而不是让调用方自己 `new` 一个）：模式（`TeamMode`）是
   * 上游 `TeamNavigation` 的**根作用域状态** —— 上游注释原文「Root-scoped Team
   * mode state. Slot lifetimes subscribe to this source.」。调用方（`panel.tsx`）
   * 要用它做两件事：① 读 `mode` 决定主区渲染「团队会话座」还是索菲亚原本的面板；
   * ② 调 `actions().enterTeam() / leaveTeam()` 切换。
   * 若调用方自己再造一个实例，两边各持一份 localStorage 快照 ——
   * 按钮切了、页面不跟着变（而且两份都以为自己是对的）。
   */
  readonly navigation: TeamNavigation
  /** 索菲亚**不能**做「点 ref 跳转」（没有按 ref 解析的宿主路由）⇒ 恒 `false`。 */
  readonly canOpenRefs: typeof CAN_OPEN_REFS
  /** 释放（清掉草稿订阅与导航监听）。 */
  readonly dispose: () => void
}

/**
 * 建一个数据源。
 *
 * @param store - 索菲亚的面板 store（`panel-store.ts` 的 `PanelStore`）。
 * @param options.teamId - 要渲染哪个团；省略 = 第一个（见文件头）。
 */
export function createTeamDataSource(store: PanelStore, options?: { readonly teamId?: string | undefined }): TeamDataSource {
  const drafts = new TeamDraftStore()
  // 导航态：索菲亚单团单页，但仍然用**移植过来的** `TeamNavigation`
  // （它自己管 localStorage 持久化与会话内选择）。这样上游页面对
  // `selectThread` / `backToWorkspace` 的调用**一行都不用改**。
  const navigation = new TeamNavigation()
  const actions = navigation.actions()
  const teamId = (): string | undefined => {
    const team = currentTeam(store.getSnapshot().view, options?.teamId)
    return team?.teamId
  }

  /** 快照 → 当前团，并**同时**带回失败原因（供每个方法统一降级）。 */
  const readTeam = (): { readonly team: WireTeam | undefined; readonly error: string | undefined } => {
    const snapshot = store.getSnapshot()
    return { team: currentTeam(snapshot.view, options?.teamId), error: snapshot.error ?? undefined }
  }

  /** 统一的「读一次」包装：拿到团就 `ok`，拿不到就 `error`（**原因取宿主的原文**）。 */
  const read = <T>(project: (team: WireTeam) => T | undefined): Promise<TeamRemoteResult<T>> => {
    const { team, error } = readTeam()
    if (team === undefined) {
      return Promise.resolve({ ok: false, error: { message: error ?? '索菲亚没有可显示的团' } })
    }
    const value = project(team)
    return value === undefined
      ? Promise.resolve({ ok: false, error: { message: '索菲亚的视图里找不到这条数据' } })
      : Promise.resolve({ ok: true, value })
  }

  const conversationProps = (t: (key: string, params?: Record<string, unknown>) => string): TeamConversationProps => ({
    t,
    drafts,
    // 上游按作用域分片订阅（thread / workspace / presence）；
    // 索菲亚塌缩成一条无作用域订阅（见 slots.ts 的 `SubscribeTeamChanges`）。
    // ⚠ **scope 参数被忽略**，但保留在签名里让调用点与上游逐行对应。
    subscribeChanges: (_scope: unknown, listener: TeamChangeListener) => store.subscribe(() => { listener({ type: 'changed' }) }),
    loadThreadHistory: ({ threadRef }) => read(team => toThreadHistory(team, threadRef)),
    // 索菲亚没有「有界读 + 已读水位」⇒ 与 loadThreadHistory 同源（同一份事实，
    // 只是上游把它们分成两次调用）。**不额外造一个 receipt / remainingUnreadCount**。
    readThread: ({ threadRef }) => read(team => {
      const history = toThreadHistory(team, threadRef)
      return history === undefined ? undefined : { facts: history.facts, task: history.task }
    }),
    loadMembers: () => read(team => rosterOf(team)),
    loadChannels: ({ channelRef, threadRef }) => read(team => ({
      channels: team.channels.map(channel => ({
        channelRef: channel.channelId,
        name: channel.title,
        threads: channel.threads.map(thread => thread.threadId),
      })),
      // 上游这里是「频道 × 成员」的**成员关系事实**（谁在这个频道里）。
      // ⚠ 索菲亚**没有频道成员关系**（成员属团，不属频道）⇒
      // 这里给出的是「这个团的所有成员都可达」这一**团级**事实的频道视图，
      // 而不是虚构一份频道成员表。调用点（按频道过滤名册）因此得到全团名册。
      members: team.members.flatMap(member => team.channels.map(channel => ({ channelRef: channel.channelId, memberId: member.memberId }))),
      ...(threadRef === undefined ? {} : {}),
    })),
    loadInbox: () => read(team => toInbox(team, RECENT_ROWS_LIMIT)),
    // 频道页的时间线（上游 `loadChannels({workspaceId, channelRef, …})` 的对应物；
    // 索菲亚把它一分为二，理由见 `slots.ts` 里 `loadChannelTimeline` 的说明）。
    loadChannelTimeline: ({ channelRef }) => read(team => toChannelTimeline(team, channelRef)),
    reply: ({ threadRef, body, recipients }) => requestTeamMessage({ threadRef, body, recipients }),
    threadObservations: ({ threadRef }) => read(team => toThreadObservations(team, threadRef)),
    // 附件：索菲亚没有上传路由 ⇒ 显式 `false`，composer 据此走「不假装能上传」的分支。
    attachmentEnabled: false,
    // 导航动作来自移植过来的 `TeamNavigation`（见上）。
    ...actions,
    // 「选区失效回退」：索菲亚的当前团由 `options.teamId` 决定，
    // 没有上游那种「Workspace 列表里旧 id 不在新集合里」的情形。
    // 导航态里万一存着一个已消失的 threadRef，调用点会走「读不到 → 显示空态」，
    // 而不是显示错的线程（`read()` 返回 error 而不是别人的数据）。
  })

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    load: () => store.load(),
    conversationProps,
    teamId,
    // 模式真源：与 `conversationProps` 里那些 `selectThread` / `backToWorkspace`
    // 来自**同一个**导航实例（见接口说明）。
    navigation,
    canOpenRefs: CAN_OPEN_REFS,
    dispose: () => {
      drafts.dispose()
      navigation.dispose()
    },
  }
}

/** 团长表索引的转出（父 agent 若要在别处解析成员名时用）。 */
export { handleIndex, memberStatusIndex }

/**
 * `vendor/team/` 自己的**翻译函数**（中文字典 + `{name}` 插值）。
 *
 * ## 为什么必须有它（这是一个真实的接线缺陷的修法）
 *
 * `vendor/team/` 里的页面读的键是**上游 client-agent-team 的键**
 * （`inboxTitle` / `backToChannels` / `teamMode` / `timelineLabel` /
 * `memberCount` …），它们只在 `./locales.ts` 的 `zh` 里。
 *
 * ⚠ `../bridge.ts` 的 `t` 用的是**另一个字典**（`../locales.ts`，键形如
 * `card.memberCount` / `activity.panelButton` —— 那是 agent-teams 活动面板与
 * 计划编辑器的字典）。把那个 `t` 传给本目录的页面，键会**查不到**，
 * 界面上的文案直接变成 `undefined`（实测：`grep` 过两个字典，
 * `inboxTitle` 等 7 个键在 `../locales.ts` 里一个都不存在）。
 *
 * 上游不面对这个问题 —— 它的两个包各自注册自己的 locale 命名空间
 * （`ctx.locale.register('team', { zh, en })`，`index.ts:190`），由宿主的 locale
 * 服务按键查表。索菲亚没有那条注册链（面板不在宿主 locale 服务里），
 * 所以这里给出**本目录自己的**那一份，键与 `./locales.ts` 同源。
 *
 * ## 认不出的键怎么办（与 `../bridge.ts` 的 t 不同，这里必须兜住）
 *
 * 返回**键名本身**（不抛、不返回 `undefined`）。理由：这个函数会被
 * `TeamFooterAction` / `TeamConversation` / 频道页共用，任何一次字典漂移
 * 都不该把整个面板打炸 —— 一个看不懂的键名是可诊断的，一个抛出的异常不是。
 */
export function teamTranslate(key: string, params?: Record<string, unknown>): string {
  const template = (teamZh as Readonly<Record<string, string>>)[key]
  if (typeof template !== 'string') return key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    return value === undefined ? whole : String(value)
  })
}
// ────────────────────────────────────────────────────────────────────────────
// 两页的组件转出 —— 父 agent 从本模块接线（不必知道内部文件名）
// ────────────────────────────────────────────────────────────────────────────

export { TeamInboxPage } from './TeamInboxPage.tsx'
export { TeamThreadPage } from './TeamThreadPage.tsx'
export { TeamChannelPage } from './TeamChannelPage.tsx'
/**
 * 团队模式的**会话座**（按导航态在收件箱 / Thread / 频道三页之间选页）。
 *
 * ⚠ 调用方要**额外**传 `navigation`（交叉类型，见该文件的说明）：
 * `conversationProps` 返回的那一包里没有它，因为它不属于上游的
 * `TeamConversationProps` 契约 —— 索菲亚把它从 props 里剥掉了（见 `slots.ts`），
 * 但会话座本身必须读导航态才能选页。用法：
 *
 * ```tsx
 * <TeamConversation {...source.conversationProps(t)} navigation={source.navigation} />
 * ```
 */
export { TeamConversation } from './TeamConversation.tsx'
/**
 * **模式切换控件**（对话 ⇄ 团队）。
 *
 * ⚠ 这就是主人点名的那枚「选模式」按钮：上游注册在 `sidebar.footer.action`
 * （`index.ts:276-293`），索菲亚由 `panel.tsx` 渲染在面板底部。
 * 用法见该文件的 `TeamFooterProps` 说明（`wide` / `navigation` / `enterTeam` /
 * `leaveTeam` / `t` 五项）。
 */
export { TeamFooterAction } from './TeamFooterAction.tsx'
export { TeamComposer } from './TeamComposer.tsx'
export { TeamMessage } from './TeamMessage.tsx'
export { TeamAvatarStack } from './TeamAvatarStack.tsx'
export { TeamCountBadge } from './TeamCountBadge.tsx'
export { TeamRunDivider } from './TeamRunDivider.tsx'
export { TeamPresenceDot } from './TeamPresenceDot.tsx'
export { TeamStateDot } from './TeamStateDot.tsx'
export { TeamMemberAvatarImage } from './TeamMemberAvatarImage.tsx'
export { TeamMemberRow } from './TeamMemberRow.tsx'

export type { TeamConversationProps, TeamRemoteResult, TeamReplyRequest, TeamReplyResult, TeamThreadReadResult } from './slots.ts'

// ════════════════════════════════════════════════════════════════════════════
// 左栏（侧边栏）的接线 —— 用户截图里那块「我完全漏掉」的
//
// 与上面的会话座两页**共用同一个** `TeamNavigation` 实例
// （`createTeamDataSource` 转出的 `source.navigation`）：
// 左栏点一个频道 = `selectChannel(ref)`，会话座读到同一个快照 ⇒ 页面跟着变。
// 调用方若自己 `new TeamNavigation()`，两边各持一份 localStorage 快照 ——
// 「按钮点了、页面不动」，见 `TeamDataSource.navigation` 的说明。
// ════════════════════════════════════════════════════════════════════════════

/**
 * 左栏数据源。
 *
 * 与会话座那份（`TeamDataSource`）的关系：**同一个 `PanelStore`、同一个
 * `TeamNavigation`**，只是构造的 props 包不同（一个给主区两页，一个给侧栏）。
 * 故这里**不**再持有一份快照来源，`subscribe` / `getSnapshot` 直接转出 store 的。
 */
export interface TeamSidebarSource {
  /** 取当前快照（调用方 `useSyncExternalStore` 订阅它就能跟着数据重渲染）。 */
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => PanelSnapshot
  /** 主动拉一次（与会话座同一个 `PanelStore.load`）。 */
  readonly load: () => Promise<void>
  /**
   * 构造左栏总装（`TeamWorkspaceBrowser`）的 props。
   *
   * ⚠ **每次调用都会即时求值** `workspaces`（一个新数组，来自
   * `adapters.workspacesOf(store.getSnapshot().view)`）—— 与本对象其余成员
   * （`subscribe` / `getSnapshot` / 各 `load*` 都是**惰性**读 store）**不一样**。
   *
   * ⇒ 调用方必须做到：**快照一变就重建这个 props 包**（跟着 store 的订阅走），
   * 而**不要**照 `conversationProps` 的既有写法缓存成 `useMemo(..., [source])`
   * ——`source` 是个稳定引用，依赖它等于依赖一个常量。症状是**团列表冻结在首帧**：
   * 新建的团永远不出现在选择器里、也永远进不了名册，而**没有任何报错**
   * （独立评审标为 low，并注明当时的接线点 `team-mode.tsx` 已经自己加了一条
   * 订阅来规避 —— 但那条规避是接线点的私有知识，写在这里才能被后来者看见）。
   */
  readonly sidebarProps: (t: (key: string, params?: Record<string, unknown>) => string) => TeamSidebarProps
  /** 构造底部「成员」入口（`TeamMembersAction`）的 props。 */
  readonly settingsProps: (t: (key: string, params?: Record<string, unknown>) => string) => TeamSettingsProps
  /**
   * 当前的工作区（= 团）列表。
   *
   * 与 `sidebarProps(t).workspaces` 同一个值；单独转出是为了让调用方在
   * **不构造整个 props 包**时也能读它（例如侧栏标题、空态判断）。
   */
  readonly workspaces: () => readonly TeamWorkspaceChoice[]
  /**
   * 释放。⚠ **不**释放导航实例 —— 它与会话座两页共用，归
   * `TeamDataSource.dispose` 管（两处各释一次会让另一处当场失去订阅）。
   * 本数据源自己不持有任何需要回收的资源，故这是空实现（保留是为了让
   * 「两半的 dispose 形状一致」，调用方不必记哪份该调、哪份不该调）。
   */
  readonly dispose: () => void
}

/**
 * 建左栏数据源。
 *
 * @param store - 索菲亚的面板 store（与会话座同一个实例）。
 * @param navigation - **必须**传 `TeamDataSource.navigation`（见文件头）。
 * @param options.wide - 渲染成宽版卡片还是窄版图标轨。
 *   索菲亚的面板**不是宿主侧栏的 rail**（`panel.tsx` 把面板主体画成一张卡片），
 *   没有「折叠成 36px 图标轨」这个宿主状态 ⇒ 默认 `true`。
 *   传 `false` 会走 `TeamWorkspaceBrowser` 的 `.railWorkspace` 分支 ——
 *   该分支的结构与样式**都在**（照抄上游），只是本构建里没有触发它的宿主条件。
 */
export function createTeamSidebarSource(
  store: PanelStore,
  navigation: TeamNavigation,
  options?: {
    readonly wide?: boolean | undefined
    /**
     * 「换模」回调（索菲亚独有能力，可选）。给了 ⇒ 左栏 Agents 行菜单多一项
     * 「换模」；不给 ⇒ 不画（「回调缺省 ⇒ 不画入口」同一纪律）。
     * 语义与 `seats.tsx` 的 `onSwitchModel` 一致：交回**整个 WireMember**
     * （它要读 member.model 当提交目标），不在中间层折断语义。
     */
    readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  },
): TeamSidebarSource {
  const actions = navigation.actions()
  const wide = options?.wide ?? true

  /** 按 `workspaceId`（= 团 id）取团；拿不到时带回**宿主的原文**原因。 */
  const readTeam = (workspaceId: string): { readonly team: WireTeam | undefined; readonly error: string | undefined } => {
    const snapshot = store.getSnapshot()
    const team = currentTeam(snapshot.view, workspaceId)
    // ⚠ 「这个团不在快照里」与「宿主这一次读失败了」是**两件事**，报错文案必须分开
    // （独立评审的 low，已修）：初版无条件优先 `snapshot.error`，而它可能是**上一次
    // 无关**的读失败残留 ⇒ 会让「请求的团不存在」显示成「读失败了」，把根因指错地方。
    // 现在：团**真的取到了**才谈宿主的读错误；取不到就直说取不到，并把
    // `snapshot.error` 作为补充（有才附），措辞上不把它当地主因。
    const error = team === undefined
      ? (snapshot.error === null ? `索菲亚的视图里没有团「${workspaceId}」` : `索菲亚的视图里没有团「${workspaceId}」（另：宿主的读错误为 ${snapshot.error}）`)
      : (snapshot.error ?? undefined)
    return { team, error }
  }

  /**
   * 统一的「读一次」包装（与会话座那份 `read()` **同一手法**）：
   * 拿到团就 `ok`，拿不到就把宿主的失败原因原样带出去。
   */
  const read = <T>(workspaceId: string, project: (team: WireTeam) => T | undefined): Promise<TeamRemoteResult<T>> => {
    const { team, error } = readTeam(workspaceId)
    if (team === undefined) {
      return Promise.resolve({ ok: false, error: { message: error ?? '索菲亚没有可显示的团' } })
    }
    const value = project(team)
    return value === undefined
      ? Promise.resolve({ ok: false, error: { message: '索菲亚的视图里找不到这条数据' } })
      : Promise.resolve({ ok: true, value })
  }

  /**
   * 变更唤醒。
   *
   * ⚠ 上游的 `subscribeChanges(scope, listener)` 按作用域分片；索菲亚只有
   * `PanelStore.subscribe` **一条无作用域订阅**（见 `slots.ts` 的
   * `SubscribeTeamChanges`）⇒ `scope` 收下但**被忽略**。与会话座那份
   * `conversationProps.subscribeChanges` **逐字同一实现**（不另写一个包装，
   * 否则两半对「什么算一次变化」会有两种判断）。
   */
  const subscribeChanges: TeamSidebarProps['subscribeChanges'] =
    (_scope, listener) => store.subscribe(() => { listener({ type: 'changed' }) })

  const workspaces = (): readonly TeamWorkspaceChoice[] => workspacesOf(store.getSnapshot().view)

  const sidebarProps = (t: (key: string, params?: Record<string, unknown>) => string): TeamSidebarProps => ({
    t,
    navigation,
    wide,
    // ⚠ 索菲亚没有「把侧栏从图标轨展开」这个宿主动作（本面板恒为卡片形态）
    // ⇒ 空实现。**留这个 prop 而不是删掉**：窄版分支（`!wide`）的图标点击
    // 会调它，删了 `TeamWorkspaceBrowser` 就要分叉两版（见该文件）。
    expandSidebar: () => {},
    workspaces: workspaces(),
    // 上游按作用域分片订阅；索菲亚塌缩成一条（见上面的说明）。
    subscribeChanges,
    // 三个读法都按 `workspaceId`（= 团 id）取团 —— 左栏的「工作区选择器」
    // 因此是**真的能切**：选另一个团，下面两组读到的是那个团的数据。
    loadMembers: ({ workspaceId }) => read(workspaceId, team => rosterOf(team)),
    loadChannels: ({ workspaceId }) => read(workspaceId, team => toChannelView(team)),
    // ⚠ 这里的 `1` 是**写死的「最近行」上限**，不是「`limit` 被忽略」——初版注释
    // 是那么写的，而它描述的行为与代码**相反**（独立评审的 low：注释说不截断，
    // 代码真截断 `recent`）。为什么写死 1：左栏调 `loadInbox` 只为了把各团的
    // `totalUnreadCount` 加起来（`TeamWorkspaceBrowser` 的收件箱徽章），
    // `recent` 一行都不看 ⇒ 取最小值，别把每个团的最近活动整段拖进内存。
    // （调用方传的 `limit` 确实不参与 —— 但原因是「左栏不需要它」，
    // 不是「索菲亚没有截断语义」；后者会把下一步的人引到错的结论上。）
    loadInbox: ({ workspaceId }) => read(workspaceId, team => toInbox(team, 1)),
    // 三条写操作全部**转向真实路由**（见 `requests.ts` 那一节的逐条说明）。
    createChannel: request => requestSidebarCreateChannel(request),
    addMember: request => requestSidebarAddMember(request),
    setMemberLifecycle: request => requestSidebarMemberLifecycle(request),
    // 「换模」（2026-09-24 从旧团队卡搬进左栏）：回调由 `TeamModeSurface` 的调用方
    // （panel.tsx → seats.tsx 的真实现）提供；没给 ⇒ `TeamAgentsPanel` 不画这一项。
    ...(options?.onSwitchModel === undefined ? {} : { switchModel: options.onSwitchModel }),
    // 导航动作来自**共用**的那个 `TeamNavigation`（见文件头）。
    ...actions,
  })

  const settingsProps = (t: (key: string, params?: Record<string, unknown>) => string): TeamSettingsProps => ({
    wide,
    t,
    // 上游这个对话框是**跨工作区分组**的；索菲亚的对应物就是全部团
    // （见 `adapters.ts` 的 `memberGroupsOf`）。故这里一次调用给所有组 ——
    // 不需要 `workspaceId`，与会话座那份 `loadInbox()` 无参同一手法。
    loadMemberGroups: () => Promise.resolve(memberGroupsOf(store.getSnapshot().view)),
  })

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    load: () => store.load(),
    sidebarProps,
    settingsProps,
    workspaces,
    dispose: () => {},
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 左栏的组件转出 —— 调用方从本模块接线（不必知道内部文件名）
// ────────────────────────────────────────────────────────────────────────────

export { TeamWorkspaceBrowser } from './TeamWorkspaceBrowser.tsx'
export { TeamWorkspaceSelector } from './TeamWorkspaceSelector.tsx'
export { TeamChannelsPanel } from './TeamChannelsPanel.tsx'
export { TeamAgentsPanel } from './TeamAgentsPanel.tsx'
export { TeamMembersAction } from './TeamMembersAction.tsx'
export { TeamSidebarSection } from './TeamSidebarSection.tsx'
export { TeamRowMenu } from './TeamRowMenu.tsx'
export { MultiMenuField } from './multi-menu-field.tsx'
export { SortableRow, useSidebarRowDrag } from './sidebar-drag.tsx'
export { moveSidebarItem, reconcileSidebarOrder, useSidebarOrder } from './sidebar-order.ts'
export { setSidebarSectionOpen, useSidebarSectionOpen } from './sidebar-sections.ts'

export type {
  TeamAddMemberRequest,
  TeamCreateChannelRequest,
  TeamFooterProps,
  TeamMemberGroup,
  TeamMemberLifecycleRequest,
  TeamMembersRequest,
  TeamSettingsProps,
  TeamSidebarProps,
  TeamViewRequest,
} from './slots.ts'
export type { TeamWorkspaceChoice } from './TeamWorkspaceSelector.tsx'
