/**
 * **团队工作区**在索菲亚面板里的唯一接线点。
 *
 * ## 设计（2026-09-24 主人定稿：**没有模式切换**）
 *
 * 上游的「对话 / 团队」是一个**双态开关**：宿主侧栏里那枚按钮表示
 * 「当前你在**对话**（宿主自己的会话页）；点一下切到**团队**」。
 * 它的存在前提是 —— **宿主侧栏同时承载着两个世界**，用户需要在那儿选一个。
 *
 * 索菲亚没有这个前提：
 *
 * | | 上游 | 索菲亚 |
 * |---|---|---|
 * | 入口 | 宿主侧栏（会话与团队共用一个侧栏） | 宿主侧栏里的**「索菲亚」按钮** |
 * | 「索菲亚」按钮点了意味着什么 | —— | **就是"进团队"**（它不承载宿主的会话页） |
 * | 所以还需要「对话 / 团队」开关吗 | 需要 | **不需要** |
 *
 * > 主人原话：「我们这个索菲亚这个按钮本身就相当于是团队这个按钮。点了就直接进入团队 ui，
 * > 因此就没必要再搞一个对话和团队切换了。就图一就是我们的团队模式 ui 了」
 *
 * ⇒ 本组件**恒**渲染团队工作区（左栏 + 会话座），**不再画** `TeamFooterAction`
 * （那枚按钮已从本项目的界面上撤掉；上游组件文件仍在 `vendor/team/TeamFooterAction.tsx`
 * 里保留，因为它是照抄来的上游资产，删掉会让"移植"这件事失去可核对性）。
 *
 * ## 索菲亚自己的面板内容去哪了
 *
 * `props.children`（活动面板 / 拟建团审批卡 / DAG 画布）**没有删**，而是移到
 * **会话座之上、收件箱页的头部**（`data-sophia-team-inbox-header`）。
 * 两个理由：
 *
 * 1. 主人早先明确要求过「把这个 UI **放进收件箱**」；
 * 2. 取消会话模式之后，**审批卡（批准 / 驳回）就没地方去了** —— 而那是有真实路由、
 *    能工作的唯一决策入口（见 `panel.tsx` 里那张卡的分工说明）。
 *    把它留在界面里，比"取消模式"顺手取消掉一个能用的功能更重要。
 *
 * ⚠ 2026-09-24 二次定稿（主人实测反馈）：这一块**只在收件箱页渲染**
 *    （导航快照里没有 `channelRef` / `threadRef` = 停在收件箱/工作区根页）。
 *    之前"恒在所有页面之上"的实现被主人否了：点进频道它还钉在那里，收不回去。
 *    判据用的是**导航快照字段**（`navigation.ts:6-11` 的 `TeamNavigationSnapshot`），
 *    不是猜测的内部状态；选中频道 / Thread ⇒ `channelRef`/`threadRef` 非空 ⇒ 收起。
 *
 * ## ⚠ 与 `panel.tsx` 里那个自研 `PlanMode` 的关系（**没有合并，也不要合并**）
 *
 * `panel.tsx` 里另有一个自研的 **`PlanMode`**（「建团模式：持久团 / DAG 调度模式」，
 * `planModeControl`，属性 `data-sophia-mode` / `data-sophia-mode-option` 那一族）。
 * 两者**不是一回事**，本文件一个字节都没有碰它：
 *
 * | | 上游 `TeamMode`（本文件已撤销） | 索菲亚 `PlanMode`（`panel.tsx`） |
 * |---|---|---|
 * | 问的问题 | 「这个面板现在显示**对话**还是**团队**」 | 「这张待批票要建成**持久团**还是 **DAG 调度团**」 |
 * | 值的来源 | 上游 `navigation.ts:5`（持久化在 `localStorage`） | 索菲亚自己的 `useState`（不持久化） |
 * | 消费者 | 主区的页面选择（**已取消**） | 建团审批载荷（`requestId` + `mode`） |
 * | 时序 | 任意时刻 | 只在审批那一刻 |
 *
 * ⇒ **不建议合并**：一个是「看哪一页」（现在恒为团队页），一个是「建哪种团」。
 * 撤销前者不改变后者的任何语义。
 *
 * ## 降级与可验性（如实说明）
 *
 * `localStorage` 不存在时（SSR / node 测试）上游的 `navigation.ts:29` 已有
 * `typeof localStorage === 'undefined'` 判断并回落 `'conversation'` —— 那个做法被逐字沿用。
 * **但本组件不再用它选渲染面**（已无分支），所以测试环境里能渲染到的不再是"面板原有内容"，
 * 而是**同一棵团队工作区**。⇒ `TeamWorkspaceBrowser` / `TeamConversation` 在测试环境里
 * 会真的被渲染，这比之前"恒走 conversation 分支、团队面结构性测不到"**覆盖更好**。
 *
 * @module @sophia/core/client/team-mode
 */

import type { ReactElement, ReactNode } from 'react'
import { hooks } from './react-runtime.ts'
import type { PanelStore } from './panel-store.ts'
import type { WireMember } from './view-model.ts'
import {
  createTeamDataSource,
  createTeamSidebarSource,
  TeamConversation,
  TeamMembersAction,
  TeamWorkspaceBrowser,
  teamTranslate,
} from './vendor/team/index.ts'

/**
 * 索菲亚面板的主区：**恒**渲染上游的团队工作区（左栏 + 会话座），
 * 并把索菲亚自己的面板内容（`props.children`）放在收件箱页头部。
 *
 * @param props.store - 面板 store（数据源与它同源）。
 * @param props.children - 索菲亚自己的面板内容（活动面板 / 审批卡 / DAG 画布）。
 */
export function TeamModeSurface(props: {
  readonly store: PanelStore
  /**
   * 「换模」回调（索菲亚独有，可选）。给了 ⇒ 左栏 Agents 行菜单多一项「换模」；
   * 不给 ⇒ 不画。语义与 `seats.tsx` 的 `onSwitchModel` 一致（交回整个 WireMember）。
   */
  readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  readonly children: ReactNode
}): ReactElement {
  const { useEffect, useMemo, useSyncExternalStore } = hooks()
  // 数据源是**一个实例**（`useMemo` 按 store 缓存）：它的 `navigation` 就是
  // 左栏与会话座共用的那**同一个** `TeamNavigation`（两半各 new 一个会让
  // 「点左栏、主区不动」）。
  const source = useMemo(() => createTeamDataSource(props.store), [props.store])
  // 导航态仍然订阅：左栏与会话座都靠它选页/选团，且它决定下面那个**信息性**属性
  // `data-sophia-nav-mode`（现在不再用来选渲染面）。
  const navigationState = useSyncExternalStore(
    source.navigation.subscribe,
    source.navigation.getSnapshot,
    // ⚠ 第三个参数不能省：SSG（本仓用例走 `renderToStaticMarkup`）缺它会抛
    // Missing getServerSnapshot（与 `team-card.tsx` 里那条同源）。
    source.navigation.getSnapshot,
  )
  // ⚠ `conversationProps()` **必须** memo：它返回的 `subscribeChanges` /
  //   `loadInbox` / `loadMembers` 都是新箭头函数，而上游页面把它们放进
  //   `useEffect` / `useCallback` 的依赖里（`TeamInboxPage` 的
  //   `useEffect(() => { void refresh() }, [refresh])`）⇒ 每次渲染换引用
  //   就是**无限重读风暴**。memo 后引用与 `source` 同寿命。
  const conversation = useMemo(() => source.conversationProps(teamTranslate), [source])

  // ── 左栏 ───────────────────────────────────────────────────────────────
  // ⚠ 传 `source.navigation`：与会话座**共用同一个实例**。
  const sidebar = useMemo(
    () => createTeamSidebarSource(props.store, source.navigation, { onSwitchModel: props.onSwitchModel }),
    [props.store, source.navigation, props.onSwitchModel],
  )
  // 左栏的团列表是**构造 props 那一刻**从 store 读的快照 ⇒ 必须随 store 变化重建，
  // 否则「新加的团不出现」。这一条订阅就是为了拿这个依赖（不是重复订阅）。
  const sidebarSnapshot = useSyncExternalStore(sidebar.subscribe, sidebar.getSnapshot, sidebar.getSnapshot)
  // ⚠ 破无限重读风暴：两包 props 里全是新箭头函数（见上面 `conversation` 那条）。
  const sidebarProps = useMemo(() => sidebar.sidebarProps(teamTranslate), [sidebar, sidebarSnapshot])
  const settingsProps = useMemo(() => sidebar.settingsProps(teamTranslate), [sidebar, sidebarSnapshot])

  // 卸载清理：数据源持有草稿订阅与导航监听，漏掉就会留下 localStorage 监听。
  // ⚠ 左栏那份**不**在这里 dispose：它的 `dispose` 是空实现，且**不**释放导航实例
  //    （导航归 `source` 管；两处各释一次会让另一处当场失去订阅，见 index.ts:315-321）。
  useEffect(() => () => { source.dispose() }, [source])

  return (
    <div
      // 新增的能力必须有**能红的断言抓手**（本仓纪律）：这一层渲染的是不是团队工作区，
      // 必须落在 DOM 上，而不是只能靠人眼看。
      // ⚠ `surface` 现在是**常量**（设计上已无分支）—— 它证明"这一层就是团队工作区"，
      //   而 `nav-mode` 只作信息用（上游导航态仍然持久化在 localStorage，但不再选渲染面）。
      data-sophia-team-surface="workspace"
      data-sophia-nav-mode={navigationState.mode}
      // ⚠⚠ 这个 `style` **不是装饰，是它在链上活着的前提**（2026-09-24 实测踩出来的）：
      //   `panel.tsx` 原本的结构是 `CLASS.body` 直接包 `CLASS.main`，而 `.main` 的
      //   `flex:1 1 auto` 靠**父级是 flex 容器**才生效。本组件一旦在两者之间插一个
      //   **普通 div**，`.main` 就当场失效 ⇒ 内容不再内部滚动、整块溢出。
      //   所以这一层**自己承担**原 `.body` 的 flex 角色：列方向 + `flex:1 1 auto`
      //   + `min-height:0`，于是 `props.children` 仍是**直接** flex 子项。
      style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}
    >
      {/* 左栏 + 主区两列。上游的两列关系由宿主侧栏的 flex 父级提供，索菲亚没有那个
          宿主 ⇒ 这里自己给一层 flex（内联样式只做**布局**，不碰上游那些逐字节照抄的
          CSS Module；`TeamWorkspaceBrowser` 的宽度/底色由它自己的 sidebar.module.css 决定）。 */}
      <div
        data-sophia-team-layout
        style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minHeight: 0 }}
      >
        <div
          data-sophia-team-sidebar
          style={{ flex: '0 0 auto', minWidth: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
        >
          <TeamWorkspaceBrowser {...sidebarProps} />
          {/* 上游把「成员」入口注册在 `sidebar.footer.action`（与那枚已撤掉的模式切换同一个槽）⇒
              这里同样放在左栏最下面，不另造位置。 */}
          <TeamMembersAction {...settingsProps} />
        </div>
        <div
          data-sophia-team-main
          // ⚠ **滚动收口在主区**（2026-09-24 主人实测：上一版把 overflow-y 给了
          //   收件箱头部，滚轮被那一小块吞掉、页面滚不动）。现在主区是**唯一**的
          //   滚动容器：头部按自然高度排，滚主区就能从头看到尾；
          //   点进频道 / Thread 后头部不渲染，上游页面自己的滚动接管。
          style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}
        >
          {/* 索菲亚自己的面板内容 = **收件箱页的内容**（见文件头「索菲亚自己的面板内容去哪了」）。
              ⚠ 只在收件箱页（导航无 channelRef/threadRef）渲染：点进频道 / Thread 它就收起，
              不再"钉在所有页面上方"（2026-09-24 主人实测否掉的第一版）。
              ⚠ `flex:'none'`：按自然高度排，**不给它自己的滚动条**（滚轮统一交给主区，
                见上面的滚动收口注释 —— 上一版给头部内部滚动，实测页面滚不动）。
              审批卡也住在这里 ⇒ 看审批请回收件箱页，这与"收件箱是'需要我'的家"同构。 */}
          {navigationState.channelRef === undefined && navigationState.threadRef === undefined ? (
            <div data-sophia-team-inbox-header style={{ flex: 'none' }}>
              {props.children}
            </div>
          ) : null}
          {/* 上游会话座：按导航态在 收件箱 / Thread / 频道 三页之间选页。 */}
          <div
            data-sophia-team-conversation
            style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <TeamConversation {...conversation} navigation={source.navigation} />
          </div>
        </div>
      </div>
    </div>
  )
}
