/**
 * 上游团队卡：把**抄来的**上游两页（收件箱页 / Thread 页）接进索菲亚的面板。
 *
 * ## 这个文件为什么存在
 *
 * 主人对这件事的要求是原话级别的：
 *
 * > 「不是长得像，你把它代码，UI代码**直接抄过来**不就行了吗？然后再自己改改，
 * >   把成员头像换成我们的。把命名规则换成我们的。就它上面没有的那个UI，我们改一改，
 * >   添加一下。至于核心的实现代码，那就是我们按照我们自己的那个来实现的。
 * >   我们只需要把它的那个**前后端打通**。然后把前端的UI再改改就行了。」
 *
 * 所以：`vendor/team/` 里那 34 个文件是**整份复制**过来的上游 UI（只改了头像素材、
 * 命名规则、以及数据入口），而**本文件就是那个「前后端打通」的接缝** ——
 * 它负责把索菲亚自己的 `PanelStore` 接到上游两页期望的 props 上。
 *
 * ## 为什么不是直接改 `TeamPanel`
 *
 * `components.tsx` 的 `TeamPanel` 是索菲亚自研的团队卡，它的分区是
 * 「卡头 / 活动面板 / 侧栏 + 成员名册 + 消息流」。这次要换掉的是**消息流那一层**
 * （换成上游的收件箱 + Thread 页），而要**保留**的是：
 *
 * - **卡头**（团名 + 消息数，带 `data-sophia-*` 属性，历史 OCR 修复依赖它们）；
 * - **成员名册 `MemberRoster`** —— 它承载「换模 / 暂停 / 恢复 / 加成员」这四个
 *   **上游没有的**索菲亚能力。把这四个按钮弄丢，等于拿 UI 换掉了功能，主人不干。
 *
 * ⚠ 那条路（改 `TeamPanel` 内部）会动 `components.tsx` —— 那文件被大量
 * `data-sophia-*` 断言钉着，改它等于把所有既有断言一起推翻。**新建一个卡组件、
 * 在 `panel.tsx` 里替换渲染点**，则 `components.tsx` 一行不动、既有断言全部继续有效。
 *
 * ## 一个必须写下来的坑：导航态读不到
 *
 * `createTeamDataSource()` 内部**自己**造了一个 `TeamNavigation` 实例，并把它的
 * `actions()` 混进 `conversationProps()`。但 `TeamDataSource` **没有暴露**那个实例
 * （接口只有 `subscribe` / `getSnapshot` / `load` / `conversationProps` / `teamId` /
 * `canOpenRefs` / `dispose`），而 `subscribe` / `getSnapshot` 是**面板 store 的**
 * 订阅（快照里**不含**导航态）。
 *
 * ⇒ 于是「现在选中了哪条线程」这件事**读不出来**，而它正是「渲染收件箱还是 Thread」
 * 的唯一依据。上游页面调 `selectThread()` 写进去，我们却在外面读不到。
 *
 * **解法**：本组件**自己持有**一个 `TeamNavigation` 实例，把 `conversationProps()`
 * 返回对象里的 `...actions` **覆盖**成本实例的 actions。这样写入方与读取方是
 * **同一个实例**，不需要改 `vendor/team/` 一个字节（那个目录同时还有别人在写）。
 * 代价：`createTeamDataSource` 内部那个实例成了**空转的孤儿**（它的 actions 不再被
 * 任何 UI 调用），但仍监听着 `localStorage`。它由 `source.dispose()` 清理 ——
 * 所以下面对 `source` 与 `nav` **都**装了卸载清理，两个都不能漏。
 *
 * ## `getServerSnapshot` 不能省
 *
 * `useSyncExternalStore` 传两参时，服务端渲染（本仓的用例走
 * `renderToStaticMarkup`）会抛 `Missing getServerSnapshot`。这是历史上真踩过的
 * 一条（`react-runtime.ts` 里 `ReactFace.useSyncExternalStore` 的三参签名就是
 * 为它保留的），所以这里**显式给第三个参数**。
 *
 * @module @sophia/core/client/team-card
 */

import type { ReactElement } from 'react'

import { hooks } from './react-runtime.ts'
import { CLASS } from './styles.ts'
import css from './vendor/ActivityPanel.module.css'
import { MemberRoster, TeamSidebar, type Translate } from './components.tsx'
import type { PanelStore } from './panel-store.ts'
import type { WireMember, WireTeam } from '../wire.ts'
import { createTeamDataSource, TeamInboxPage, TeamThreadPage } from './vendor/team/index.ts'
import { TeamNavigation } from './vendor/team/navigation.ts'
import { t as agentTeamsT } from './vendor/bridge.ts'

/**
 * 一张团队卡：索菲亚的卡头与成员名册 + **上游的**收件箱/Thread 两页。
 *
 * `onCreateChannel` / `onAddMember`：props 仍声明（可选），但**调用方自 2026-09-24 起
 * 不再传** —— 团队工作区（`TeamModeSurface` 左栏 + Agents 面板）owns 建频道与加成员，
 * 这张卡再渲染一遍就是重复入口（主人实测截图否掉）。回调缺省时 `TeamSidebar` /
 * `MemberRoster` 按设计**不画**对应输入框。本文件头最初写「有意不收」、后来一度改成
 * 「会收并转发」，两次都与当时的代码不同步 —— 这次把演变过程记下来，防止第三次。
 */
export function UpstreamTeamCard(props: {
  readonly store: PanelStore
  readonly team: WireTeam
  readonly t: Translate
  readonly onSwitchModel?: ((member: WireMember) => void) | undefined
  readonly onLifecycle?: ((memberId: string, action: 'suspend' | 'resume') => Promise<void>) | undefined
  readonly onCreateChannel?: ((title: string) => Promise<void>) | undefined
  readonly onAddMember?: ((position: string) => Promise<void>) | undefined
}): ReactElement {
  const { team, t } = props
  const { useMemo, useEffect, useSyncExternalStore } = hooks()

  // 数据源：一个团一个（`teamId` 显式传，不靠「省略就取第一个」的默认值 ——
  // 面板现在是**多团并列**渲染，靠默认值会让每张卡都去读同一个团）。
  const source = useMemo(
    () => createTeamDataSource(props.store, { teamId: team.teamId }),
    [props.store, team.teamId],
  )

  // 导航态（收件箱 ↔ Thread）。见文件头「导航态读不到」那一段。
  const nav = useMemo(() => new TeamNavigation(), [])
  const navSnapshot = useSyncExternalStore(
    nav.subscribe,
    nav.getSnapshot,
    // ⚠ 第三个参数不能省：SSG（`renderToStaticMarkup`）缺它会抛 Missing getServerSnapshot。
    nav.getSnapshot,
  )

  // 卸载清理：两个实例各清各的，漏一个就会留下 localStorage 监听。
  useEffect(
    () => () => {
      source.dispose()
      nav.dispose()
    },
    [source, nav],
  )

  /**
   * 宽签名的翻译函数。
   *
   * ⚠ `vendor/team/` 的 props 要求 `(key: string, params?: Record<string, unknown>) => string`
   * （**宽**键），而 `bridge.ts` 的 `t` 是 `AgentTeamsTranslate`（键被收窄成 180 个
   * locale 字面量）。两者不兼容 —— 实测 `tsc` 报三条
   * `TS2345: Argument of type 'AgentTeamsTranslate' is not assignable to parameter of type '(key: string, …) => string'`。
   *
   * 这里包一层，把宽度差异**只在这一处**消掉。**不**去放宽上游那份声明：那个窄键是
   * 「键必须是已知键」的保护，放宽掉就再没有编译期检查了。传进来的键确实来自上游代码
   * （都在那份字面量联合里），所以这里的强转是**有据的**，而不是绕过类型检查的权宜。
   */
  const wideT = useMemo(
    () =>
      (key: string, params?: Record<string, unknown>): string =>
        agentTeamsT(
          key as Parameters<typeof agentTeamsT>[0],
          params as Parameters<typeof agentTeamsT>[1],
        ),
    [],
  )

  const actions = useMemo(() => nav.actions(), [nav])

  // 上游两页要的 props：`conversationProps()` 已经含 `...actions`（来自 source 内部
  // 那个实例），这里**覆盖**为本组件的 `nav` 实例 —— 写入方与读取方必须是同一个。
  const conversation = useMemo(
    () => ({ ...source.conversationProps(wideT), ...actions }),
    [source, wideT, actions],
  )

  /** 当前选中的线程；没有 ⇒ 显示收件箱。这就是「渲染哪一页」的唯一判据。 */
  const threadRef = navSnapshot.threadRef

  return (
    <>
      {/* 卡头：与 `components.tsx` 的 `TeamPanel` 同源（同一组类名与属性），
          保证既有断言与历史 OCR 修复继续成立。 */}
      <header className={`${CLASS.header} ${css.panelHead} ${css.teamHead}`}>
        <span className={`${CLASS.headerTitle} ${css.teamName}`}>{team.name}</span>
        <span className={`${CLASS.headerMeta} ${css.teamStats} ${css.badgeCount}`}>
          {t('messageCount', { count: team.messages.length })}
        </span>
      </header>

      {/* ── ⚠ 2026-09-24 布局改造：**上游活动面板已从本卡移出** ──────────────
          这里原先挂着一个 `<ActivityPanel>` —— 而本卡是**每团一张**，
          于是多团时叠出多个浮窗（截图里 4 个团叠在一起，主人点名）。
          它现在是**面板级单实例**，挂在 `panel.tsx` 的**收件箱主区**里
          （主人：「把这个UI放进收件箱」）。⇒ 本卡从此只管「索菲亚自己的」那几块。 */}

      {/* 索菲亚自己的侧栏（频道列表 + **新建频道**输入框 + 线程列表）。
          ⚠ 「新建频道」是**上游没有的**索菲亚能力，入口必须在（`panel.spec.tsx` 的
          「侧栏『新建频道』+ 名册『添加成员』常驻入口」那条断言盯着它，而且它还有
          一条反向断言：回调没接时两个属性**都不许出现**，不许谎报能力）。
          ⚠ 侧栏的选中项与上游两页**共用同一个 `nav`** —— 不共用的话，侧栏说选着 A、
          上游页却在渲染 B，两套选中项互相打架。 */}
      <TeamSidebar
        team={team}
        t={t}
        activeChannelId={navSnapshot.channelRef ?? null}
        onSelectChannel={(channelId) => { actions.selectChannel(channelId) }}
        activeThreadId={navSnapshot.threadRef ?? null}
        onSelectThread={(threadId) => {
          if (threadId === null) actions.backToWorkspace()
          else actions.selectThread(threadId)
        }}
        {...(props.onCreateChannel === undefined ? {} : { onCreateChannel: props.onCreateChannel })}
      />

      {/* 索菲亚自己的成员名册：换模 / 暂停 / 恢复 / 加成员 —— **上游没有这四样**，
          所以它必须留在这里（见文件头）。 */}
      <MemberRoster
        members={team.members}
        t={t}
        {...(props.onSwitchModel === undefined ? {} : { onSwitchModel: props.onSwitchModel })}
        {...(props.onLifecycle === undefined ? {} : { onLifecycle: props.onLifecycle })}
        {...(props.onAddMember === undefined ? {} : { onAddMember: props.onAddMember })}
      />

      {threadRef === undefined ? (
        <TeamInboxPage
          loadInbox={conversation.loadInbox}
          subscribeChanges={conversation.subscribeChanges}
          selectThread={conversation.selectThread}
          selectChannel={conversation.selectChannel}
          t={wideT}
        />
      ) : (
        <TeamThreadPage
          threadRef={threadRef}
          {...(navSnapshot.channelRef === undefined ? {} : { channelRef: navSnapshot.channelRef })}
          backToWorkspace={conversation.backToWorkspace}
          readThread={conversation.readThread}
          loadThreadHistory={conversation.loadThreadHistory}
          threadObservations={conversation.threadObservations}
          subscribeChanges={conversation.subscribeChanges}
          loadMembers={conversation.loadMembers}
          // ⚠ 2026-09-24：`TeamThreadPage` 那条施工线把它提成了**必填** prop
          // （上游 Thread 页要读频道视图），连带本调用点报 TS2741 ⇒ 补上。
          // 数据源侧本来就有这个方法（`vendor/team/slots.ts:495` / `index.ts:151`），
          // 不是新造能力，只是此前没人消费。
          loadChannels={conversation.loadChannels}
          drafts={conversation.drafts}
          reply={conversation.reply}
          t={wideT}
        />
      )}
    </>
  )
}
