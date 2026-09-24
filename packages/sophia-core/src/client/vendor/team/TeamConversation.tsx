/**
 * 上游 `TeamConversation.tsx`（4.5KB / 41 行）的索菲亚版 —— **团队模式的会话座**。
 *
 * ## 它是什么（上游原设计）
 *
 * 上游把它注册成 `main` 槽（keyed seat，key = `'conversation'`）的 shadow：
 * 「团队模式」打开时它接管主区，并按**导航态**在三页之间选一页渲染 ——
 * 收件箱 / Thread 详情 / 频道页；三者都没选时给一张欢迎面
 * （`data-team-conversation`）。上游 `index.ts:296` 的注册行就是它：
 *
 * ```ts
 * registerModeShadow(ctx, navigation, changes, reads, drafts, humanIdentity, 'main', TeamConversation as never, undefined, 'conversation')
 * ```
 *
 * ## 索菲亚移植点（四处，其余逐字）
 *
 * | 上游 | 索菲亚 | 理由 |
 * |---|---|---|
 * | `useWorkspaces(state => state.items)` + `workspaces.find(…)` | 剥掉，改成「按 ref 判定」 | 索菲亚**没有 Workspace 这一维**（一个团一个视图，见 `index.ts` 文件头）⇒ 「选中的 workspace 存不存在」这个判据没有对应物 |
 * | `useHumanIdentity(humanIdentity)` | `t('human')` | 索菲亚**没有**人类 profile 投影（没有 `humanProfile` remote）⇒ 人类名走本地化兜底 —— 这正是上游 `identity.name ?? t('human')` 那一支 |
 * | `import { useSyncExternalStore } from 'react'` | `hooks()` 惰性取 | 顶层值导入会多撞一次 `require(` ≤ 2 的断言 |
 * | `TeamConversationProps`（上游 20+ 个 remote） | 同名的索菲亚版（`slots.ts`） | 上游那些 remote 描述的是索菲亚没有的宿主路由（逐个剥掉的清单见 `slots.ts`） |
 *
 * ⚠ **`navigation` 这一项本文件额外要**（上游从 `TeamConversationProps` 里拿）：
 * 索菲亚的 `slots.ts` 把它从 props 里剥掉了（理由：调用方直接调 `navigation.actions()`），
 * 但**本组件必须读导航态才能选页** —— 所以它由调用方（`panel.tsx`）
 * 以交叉类型的形式显式传入，不改变 `TeamConversationProps` 那份契约。
 */

import type { ReactElement } from 'react'
import { hooks } from '../../react-runtime.ts'
import type { TeamConversationProps, TeamNavigationSource } from './slots.ts'
import { TeamChannelPage } from './TeamChannelPage.tsx'
import { TeamInboxPage } from './TeamInboxPage.tsx'
import { TeamThreadPage } from './TeamThreadPage.tsx'
import css from './conversation.module.css'

export function TeamConversation(props: TeamConversationProps & {
  /** 导航态来源（`TeamNavigation` 实例）。本组件按它决定渲染哪一页。 */
  readonly navigation: TeamNavigationSource
}): ReactElement {
  const { navigation, t, drafts, subscribeChanges, loadMembers, loadInbox, loadChannels, loadChannelTimeline, readThread, loadThreadHistory, threadObservations, reply, selectThread, selectChannel, selectWorkspace, backToWorkspace, backToChannels, sendChannelMessage } = props
  const { useSyncExternalStore } = hooks()
  const navigationState = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot, navigation.getSnapshot)
  // Every seat names and draws the Human from this one projection; the
  // localized fallback stands only until the first profile read lands.
  //
  // ⚠ 索菲亚**只有**这个兜底：没有人类 profile 投影（见文件头）⇒ 名字恒为
  //   `t('human')`。上游那一行读作 `identity.name ?? t('human')`，索菲亚取右支。
  const humanName = t('human')
  if (navigationState.inbox === true) {
    // The Inbox page is global: it merges every visible Workspace and needs no
    // selected Workspace. Selecting Inbox clears the Channel/Thread faces, so
    // this face owns the seat while the flag stands.
    // ⚠ 索菲亚没有 Workspace 维 ⇒ 「合并每个可见 Workspace」塌缩成「一个团的收件箱」
    //   （`adapters.toInbox` 的说明），页面本身一行未改。
    return <TeamInboxPage key="inbox" loadInbox={loadInbox} subscribeChanges={subscribeChanges} selectThread={selectThread} selectChannel={selectChannel} t={t} />
  }
  if (navigationState.threadRef !== undefined) {
    // ⚠ 上游还传 `workspaceId={current.workspaceId}` / `humanName` / `humanAvatarUrl` /
    //   `putAttachment` / `getAttachment` / `resolveTaskRefs` / `resolveThreadRefs` /
    //   `openMemberSession`。索菲亚的 Thread 页 props 里**没有**这些
    //   （逐项剥除清单见 `slots.ts`）⇒ 这里只传它真的收下的那些。
    return <TeamThreadPage
      key={navigationState.threadRef}
      threadRef={navigationState.threadRef}
      backToWorkspace={backToWorkspace}
      selectChannel={selectChannel}
      selectThread={selectThread}
      drafts={drafts}
      readThread={readThread}
      loadChannels={loadChannels}
      loadThreadHistory={loadThreadHistory}
      threadObservations={threadObservations}
      subscribeChanges={subscribeChanges}
      loadMembers={loadMembers}
      reply={reply}
      {...(navigationState.channelRef === undefined ? {} : { channelRef: navigationState.channelRef })}
      {...(navigationState.taskRef === undefined ? {} : { taskRef: navigationState.taskRef })}
      {...(navigationState.taskNumber === undefined ? {} : { taskNumber: navigationState.taskNumber })}
      t={t}
    />
  }
  if (navigationState.channelRef !== undefined) {
    return <TeamChannelPage
      key={navigationState.channelRef}
      channelRef={navigationState.channelRef}
      humanName={humanName}
      loadChannelTimeline={loadChannelTimeline}
      drafts={drafts}
      subscribeChanges={subscribeChanges}
      loadMembers={loadMembers}
      loadInbox={loadInbox}
      selectThread={selectThread}
      selectChannel={selectChannel}
      backToChannels={backToChannels}
      {...(sendChannelMessage === undefined ? {} : { sendChannelMessage })}
      t={t}
    />
  }
  // ⚠ 上游这里分两支：没有选中 Workspace ⇒ 团队模式的欢迎面；选中了 Workspace
  //   但没选频道 ⇒ 「# 频道列表」提示。索菲亚**没有 Workspace 维** ⇒
  //   第二支没有对应物（永远不会「选中工作区却没选频道」这个中间态），
  //   恒走第一支。两支的文案键都保留在字典里（`teamMode` / `team` / `empty`），
  //   将来若补上 Workspace 维，只需在这里加回一个判据。
  //
  // ⚠ `selectWorkspace` 本页用不到（那是 Workspace 维的入口），但它是
  //   `TeamConversationProps` 的必需成员（`TeamNavigationActions`）⇒ 保留在解构里。
  void selectWorkspace
  const welcome = { eyebrow: t('teamMode'), title: t('team'), body: t('empty') }
  return <main className={css.welcomeSurface} data-team-conversation>
    <div className={css.welcome}>
      <span className={css.welcomeEyebrow}>{welcome.eyebrow}</span>
      <h1>{welcome.title}</h1>
      <p>{welcome.body}</p>
    </div>
  </main>
}
