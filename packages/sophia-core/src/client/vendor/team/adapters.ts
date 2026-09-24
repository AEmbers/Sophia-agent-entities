/**
 * 索菲亚线格式 → 移植 UI 所需的**界面形状**。
 *
 * ## 为什么需要这一层（而不是让 UI 直接吃 `WireView`）
 *
 * 上游 UI 吃的是它自己的 Remote 投影（`AgentTeamView` / `AgentTeamInbox` /
 * `AgentTeamThreadHistory`）：一个「已按界面需要算好」的形状。索菲亚的线格式
 * （`../../wire.ts` 的 `WireView`）是**账本投影**：一个团一张表，字段是账本事实。
 *
 * 两者之间必然有一层换算。把它集中在这一个文件里，理由与 `../bridge.ts` 相同：
 * 上游 UI 文件几乎保持原样，将来换数据源只改这里。
 *
 * ## 换算纪律（最重要的一条）
 *
 * **只用索菲亚真的有的字段算，缺的事实显式落空 —— 不发明。**
 * 每一处「索菲亚没有」都在下面标了出来，并对应 `agent-team-types.ts` 里
 * 那条字段的说明。特别地：
 *
 * - 已读水位 / 结构化 @提到 / claim / attention / 任务序号 —— 索菲亚账本里**都没有**
 *   ⇒ 一律给 `0` / `[]` / `undefined`，**不猜**。
 * - 收件箱的「需要我」队列因为 `unreadCount` 恒 0 而**结构上恒为空**；
 *   真实有内容的是「最近活跃」（按最近消息时间排序的线程）。
 *
 * ## 一个刻意的取舍：`newestOccurredAt` 是 ISO 串
 *
 * 索菲亚线格式的 `occurredAt` 是 **epoch 毫秒**（`WireMessage.occurredAt: number`），
 * 而上游 UI 全线把它当**字符串**用（`new Date(occurredAt)`、`dateTime={…}`、
 * `Date.parse(...)`）。换算在**本层**做一次（`isoFromMs`），
 * 而不是去改上游 UI 的每一处 `new Date` —— 那是 20+ 个调用点，
 * 每改一处就多一个与上游漂移的机会。
 *
 * @module @sophia/core/client/vendor/team/adapters
 */

import type { WireChannel, WireMember, WireMessage, WirePresence, WireTask, WireTeam, WireView } from '../../../wire.ts'
import { canSwitchModel } from '../../components.tsx'
import type { TeamChannelTimeline, TeamChannelTimelineItem, TeamChannelView, TeamMemberGroup } from './slots.ts'
import type { TeamWorkspaceChoice } from './TeamWorkspaceSelector.tsx'
import type {
  AgentTeamActivity,
  AgentTeamChannel,
  AgentTeamClientMemberStatus,
  AgentTeamInbox,
  AgentTeamInboxActor,
  AgentTeamInboxItem,
  AgentTeamMemberId,
  AgentTeamMemberState,
  AgentTeamPresence,
  AgentTeamTask,
  AgentTeamThreadFact,
  AgentTeamThreadHistory,
  AgentTeamThreadObservations,
} from './agent-team-types.ts'

/** epoch 毫秒 → ISO 串。NaN / 非有限值 → `''`（调用点的 `new Date('')` 得到 Invalid，界面显示空而不是「1970」）。 */
function isoFromMs(at: number): string {
  return Number.isFinite(at) ? new Date(at).toISOString() : ''
}

/**
 * 生命周期的渲染取值 → 上游的成员存在态。
 *
 * ⚠ 这是**语义映射**，不是编造：两边都在说「这个成员现在能不能干活」。
 * `unknown`（线格式的显式未知哨兵，见 `wire.ts` 的 `UNKNOWN_LIFECYCLE`）
 * 映射成 `'archived'` 是**过分**的 —— 它会把「宿主没给」显示成「已归档」。
 * ⇒ 未知态映射成 `'inactive'`：不谎报一个确定的墓碑状态。
 *
 * ⚠ **每个取值的界面后果（改这里前先读这一段；上一版注释与事实相反，是独立评审
 * 抓到的 high）**：`TeamAgentsPanel` **只滤 `'archived'`**（因为索菲亚只有可逆的
 * 挂起/恢复，滤掉 `'inactive'` 会让停用变成单向门），所以 ——
 *
 * | 返回 | 在 Agents 名册里 | 行菜单 |
 * |---|---|---|
 * | `'active'` | 有 | 「停用」 |
 * | `'inactive'`（`suspended`） | **有** | 「恢复」 |
 * | `'inactive'`（未知哨兵） | **有** | 「恢复」 |
 * | `'archived'`（`archived`/`destroyed`） | 无 | —— |
 *
 * ⇒ 未知哨兵的真实后果是「**一行可以点『恢复』的成员**」，**不是**上一版注释写的
 * 「界面上表现为不能接活」（那句暗示它仍以某种不可用形态留在名册里，而实际是
 * 被名册过滤掉、整行消失）。恢复成不成功由宿主裁决，失败时宿主原文如实进
 * `rowAlert`，不吞。
 */
function memberStateOf(lifecycle: string): AgentTeamMemberState {
  if (lifecycle === 'active') return 'active'
  if (lifecycle === 'suspended') return 'inactive'
  if (lifecycle === 'archived' || lifecycle === 'destroyed') return 'archived'
  // UNKNOWN_LIFECYCLE（'unknown'）与任何将来新增的取值都落这里。
  return 'inactive'
}

/**
 * 索菲亚的运行时存在态 → 上游的四态。
 *
 * ⚠ 索菲亚只有 `'idle' | 'running'`，**没有 `'error'`**：成员运行期失败不落账本、
 * 也不进线格式 ⇒ 这里永远不会返回 `'error'`。上游 UI 里所有 `presence === 'error'`
 * 的分支因此在索菲亚是**类型上可达、数据上不可达**的。如实保留（不删），
 * 因为删掉会让将来接上诊断能力时无处落脚；但**不假装**它能发生。
 *
 * `undefined`（宿主没给存在态）→ `'unavailable'`：如实显示「未知」，
 * 与 `wire.ts` 对 `UNKNOWN_LIFECYCLE` 的处理同一条纪律（不猜「在岗」）。
 */
function presenceOf(presence: WirePresence | undefined): AgentTeamPresence {
  if (presence === 'running') return 'working'
  if (presence === 'idle') return 'available'
  return 'unavailable'
}

/**
 * 一个成员 → 界面需要的状态。
 *
 * `handle` = `@<displayName>`：索菲亚的命名规则给的是 `displayName`
 * （见 `src/naming.ts` 的 `displayNameOf`），`@` 是**显示约定**，不是新事实。
 * 空 displayName 时退回 `name`，再退回 `memberId`（不让界面上出现一个孤零零的 `@`）。
 */
export function toMemberStatus(member: WireMember): AgentTeamClientMemberStatus {
  const handle = member.displayName !== '' ? member.displayName : member.name
  return {
    member: {
      memberId: member.memberId,
      handle: `@${handle !== '' ? handle : member.memberId}`,
      // 上游这里是自由描述，索菲亚对应的是职位名（宿主给出的事实）。
      description: member.position,
      state: memberStateOf(member.lifecycle),
      // 索菲亚线格式不含成员会话 id ⇒ 如实缺席（调用点已剥掉「进成员会话」入口）。
      ...(member.avatarPath === undefined ? {} : { avatarPath: member.avatarPath }),
    },
    presence: presenceOf(member.presence),
    // 「换模」需要该成员的**真实 WireMember**（含 model / tombstone）⇒ 由适配层
    // 顺手把原对象带出来（同一个实例、不复制、不伪造）。左栏 Agents 行菜单用它
    // 判 `canSwitchModel` 并把 `memberId` 交回给宿主的换模路由。
    // ⚠ 这是索菲亚对上游形状的**加字段**（上游没有）：加在 `Status` 而不是
    //   `Member` 上，为的是不污染上游 `AgentTeamClientMember` 的契约面。
    //   不给（墓碑/跟随默认等）时如实缺席。
    ...(canSwitchModel(member) ? { sophiaMember: member } : {}),
    // 诊断：索菲亚没有任何生产者 ⇒ 恒缺席。见 `agent-team-types.ts` 的说明。
  }
}

/** 团长表：id → 界面成员状态。<u>索引一遍</u>，供各处 O(1) 查。 */
export function memberStatusIndex(team: WireTeam): ReadonlyMap<string, AgentTeamClientMemberStatus> {
  const index = new Map<string, AgentTeamClientMemberStatus>()
  for (const member of team.members) index.set(member.memberId, toMemberStatus(member))
  return index
}

/**
 * actor 解析：成员 id → 收件箱行要的 `{ memberId, name }`。
 *
 * 成员不在团长里时（墓碑 / 线格式缺失）退回**成员 id 原件**当名字 ——
 * 与上游 `TeamAvatarStack` 的注释同一口径（「the raw Member id when the roster
 * no longer names them」），不编一个「未知成员」。
 */
export function actorOf(memberId: string, members: ReadonlyMap<string, AgentTeamClientMemberStatus>): AgentTeamInboxActor {
  // ⚠ **空串 = 人类（主人）发的**，不是「查不到的成员」。
  //
  // 宿主侧 `sendTeamMessage` 把人类消息的 `WireMessage.senderMemberId` 写成 `''`
  // ——账本基座里的 `actor = { kind: 'human', humanId: 'sophia-ui' }` 才是「谁干的」
  // 的唯一真相，但**线格式不含它**（`wire.ts` 的 `senderMemberId` 是 `string`；
  // 往线格式写 `null` 会让 `ReadonlySet<string>` 编译不过）。
  //
  // 不特判的后果是实测过的：主人自己发的消息渲染成**没有名字的气泡**。
  // 那不是「未知成员」，是「说话的人是主人」——两件完全不同的事实。
  //
  // 「主人」这个称呼在此**写死**是有据的：索菲亚的模型是**唯一主人**
  // （成员全是 AI 员工，人类只有一个；见身份锚点 A2）。若将来支持多人类，
  // 这里必须换成从线格式取名字 —— 那时 `''` 不再能定位到具体的人。
  if (memberId === '') return { memberId, name: '主人' }
  const status = members.get(memberId)
  return { memberId, name: status === undefined ? memberId : status.member.handle }
}

/** 频道名解析：频道 id → 标题。 */
export function channelTitleOf(team: WireTeam, channelId: string): string | undefined {
  return team.channels.find(channel => channel.channelId === channelId)?.title
}

/** 一个线程的全部消息，按序号/时间升序。**只读，不排序原数组**。 */
function messagesOf(team: WireTeam, threadId: string): readonly WireMessage[] {
  return team.messages
    .filter(message => message.threadId === threadId)
    .slice()
    .sort((left, right) => left.occurredAt - right.occurredAt)
}

/** 一个线程对应的任务（索菲亚的 `WireTask` 没有 threadId ⇒ 用 assignee + 频道内唯一任务近似）。 */
function taskOf(team: WireTeam, thread: WireChannel['threads'][number]): WireTask | undefined {
  // ⚠ 索菲亚线格式里 `WireTask` 与 `WireThread` **没有外键**（见 `../../wire.ts`：
  //   `WireThread` 只有 `threadId` / `channelId` / `title` / `assigneeMemberId`，
  //   `WireTask` 只有 `taskId` / `title` / `status` / `assigneeMemberId` / `blockedBy`）。
  //   ⇒ 唯一可用的连接键是 `title`（宿主为任务线程把标题写成任务标题）。
  //   用 title 匹配是**推断**，故只在**同一频道内**、且**恰好一处**匹配时才认，
  //   否则返回 `undefined`（宁可不显示，也不显示一个错的任务状态）。
  const sameTitle = team.tasks.filter(task => task.title === thread.title)
  return sameTitle.length === 1 ? sameTitle[0] : undefined
}

/**
 * 线程 → 收件箱一行。
 *
 * ⚠ `unread` 与 `mentions` 是**入参**而不是在这里算的：索菲亚没有已读水位，
 * 调用方（`inbox.ts`）明确传 `0` 进来，本函数**不**去猜。
 * 这样「索菲亚没有这个事实」在调用链上是**可见**的，而不是藏在一个默认值里。
 */
export function toInboxItem(
  team: WireTeam,
  channel: WireChannel,
  thread: WireChannel['threads'][number],
  members: ReadonlyMap<string, AgentTeamClientMemberStatus>,
  unread: { readonly unreadCount: number; readonly directCount: number },
): AgentTeamInboxItem | undefined {
  const messages = messagesOf(team, thread.threadId)
  const newest = messages[messages.length - 1]
  // 一条消息都没有的线程：没有「最新事实」可以指向 ⇒ 整行不产出。
  // 这比造一个 `newestActor: { memberId: '', name: '' }` 诚实（后者会让界面
  // 画出一个无名头像，读者会以为真有这么个人）。
  if (newest === undefined) return undefined
  const task = taskOf(team, thread)
  const preview = newest.body.split('\n', 1)[0]?.trim() ?? ''
  return {
    channelRef: channel.channelId,
    channelName: channel.title,
    ...(task === undefined ? {} : { task }),
    // 索菲亚没有任务序号 ⇒ 如实缺席（见 `agent-team-types.ts` 的说明）。
    thread,
    unreadCount: unread.unreadCount,
    directCount: unread.directCount,
    // 上游把 previewText 截到 120 字符；这里用**同一个界面上限**，
    // 不另立一个数字（见上游 `AgentTeamInboxItem.previewText` 的注释）。
    previewText: preview.length > 120 ? `${preview.slice(0, 119)}…` : preview,
    // ⚠ 索菲亚的线格式**没有**序号（`wire.ts` 的 `WireMessage` 只有 messageId /
    // channelId / threadId / senderMemberId / body / occurredAt）⇒ 这里给的是
    // **该线程的消息条数**，只当「时间相同时的并列打破」用（`TeamInboxPage` 的
    // 排序就是先比时间、再比它）。**它不是水位、也不是单调序号** ——
    // `agent-team-types.ts` 对它的出处声明已同步改成这个口径（独立评审抓到的 medium：
    // 初版注释声称它来自「索菲亚 ledger 的 sequence」，那是**不成立的出处**）。
    newestSequence: messages.length,
    newestOccurredAt: isoFromMs(newest.occurredAt),
    newestActor: actorOf(newest.senderMemberId, members),
    // 索菲亚没有 claim 模型 ⇒ 恒空数组（见 `agent-team-types.ts` 的 `AgentTeamClaim`）。
    claimOwners: [],
  }
}

/**
 * 一个团 → 收件箱载荷。
 *
 * 「需要我」队列（`items`）**恒为空**：索菲亚没有已读水位 ⇒ 没有任何线程是「未读」。
 * 「最近活跃」（`recent`）是真正有内容的那一段：每个**有消息**的线程一行，
 * 按最新消息时间倒序。
 *
 * @param limit - 上游那句「至多十条」的上限；调用方传给本函数（见 `TeamInboxPage` 的 `RECENT_ROWS_LIMIT`）。
 */
export function toInbox(team: WireTeam, limit: number): AgentTeamInbox {
  const members = memberStatusIndex(team)
  const rows: AgentTeamInboxItem[] = []
  for (const channel of team.channels) {
    for (const thread of channel.threads) {
      const item = toInboxItem(team, channel, thread, members, { unreadCount: 0, directCount: 0 })
      if (item !== undefined) rows.push(item)
    }
  }
  const recent = rows
    .slice()
    .sort((left, right) => Date.parse(right.newestOccurredAt) - Date.parse(left.newestOccurredAt))
    .slice(0, limit)
  return { items: [], recent, totalUnreadCount: 0, totalDirectCount: 0 }
}

/**
 * 一个线程 → Thread 页的历史。
 *
 * `facts` 只含 `kind: 'message'`（索菲亚没有可折叠的「活动」事实，
 * 见 `agent-team-types.ts` 的 `AgentTeamThreadFact` 说明）。
 * `mentions` 恒空：索菲亚的 `WireMessage` 只有 `body` 文本，没有结构化提列表。
 */
export function toThreadHistory(team: WireTeam, threadId: string): AgentTeamThreadHistory | undefined {
  const channel = team.channels.find(one => one.threads.some(thread => thread.threadId === threadId))
  const thread = channel?.threads.find(one => one.threadId === threadId)
  if (channel === undefined || thread === undefined) return undefined
  const messages = messagesOf(team, threadId)
  const facts: AgentTeamThreadFact[] = messages.map(message => ({
    kind: 'message',
    sequence: 0,
    message,
    mentions: [],
    occurredAt: isoFromMs(message.occurredAt),
  }))
  const task = taskOf(team, thread)
  return {
    ...(task === undefined ? {} : { task }),
    thread,
    // 无锚点概念 ⇒ 如实缺席，调用点已改用「最后一条消息后自动滚到底」。
    anchorMentions: [],
    // 无 claim 模型 ⇒ 空。
    claims: [],
    facts,
    cursor: messages.length,
    // 索菲亚的线格式一次性给出全量消息，没有分页 ⇒ 恒 false。
    hasMore: false,
  }
}

/**
 * 一个频道 → 频道页的时间线（上游 `AgentTeamView` 的索菲亚版）。
 *
 * ## 顶楼 / 回复：索菲亚没有这个分类，故不假装有
 *
 * 上游的 `AgentTeamViewItem.message.topLevel` 是**账本事实**（宿主的
 * `team/message-sent` 记了这条消息是开线程还是回线程）。索菲亚的 `WireMessage`
 * **没有这个字段**（见 `../../wire.ts`），而 `WireThread` 也没有「根消息」指针
 * ⇒ 「哪条是顶楼」在索菲亚**结构上不可知**。
 *
 * 两条候选处置，我选了后者：
 *
 * - ① 按「线程内第一条消息」猜 —— 那是**推断**，且会在「线程被追加了更早的消息」
 *   时静默改变渲染（同一条消息时而是顶楼、时而只是回复）；
 * - ② **恒 `true`** —— 界面把每条消息都当「顶楼」渲染：于是每条都带上线程入口行
 *   （「回复 / 任务 #N / 最近活动」那一行）。后果是：**线程的入口永远不会丢**，
 *   代价是回复行上多一行入口。
 *
 * 选 ② 的理由与 `adapters.ts` 文件头的纪律同源：**宁多显示一个可用的入口，
 * 不发明一个可能错的分类**。而且索菲亚的心智模型里「频道 = 一串线程」本来就更强
 * （每个线程都是频道里的一张贴），顶楼/回复的区分在索菲亚没有承载事实。
 *
 * ## 其余字段的对应
 *
 * | 上游 | 索菲亚 |
 * |---|---|
 * | `items` 按 `message.sequence` 排序 | 按 `occurredAt` 升序（索菲亚唯一的时序事实） |
 * | `humanMemberId` | `''`（人类哨兵，见 `actorOf`） |
 * | `channels[].state` | **没有**频道状态 ⇒ 不给该字段（`TeamChannelTimeline` 已剥） |
 * | `members[]` | 团级事实的频道视图（同 `index.ts` 的 `loadChannels`，不虚构频道成员表） |
 * | `hasMore` / `cursor` | 恒 `false` / `items.length`（线格式一次给全量） |
 */
export function toChannelTimeline(team: WireTeam, channelId: string): TeamChannelTimeline | undefined {
  const channel = team.channels.find(one => one.channelId === channelId)
  if (channel === undefined) return undefined
  const members = memberStatusIndex(team)
  const items: TeamChannelTimelineItem[] = []
  for (const thread of channel.threads) {
    const messages = messagesOf(team, thread.threadId)
    const newest = messages[messages.length - 1]
    const task = taskOf(team, thread)
    for (const message of messages) {
      items.push({
        message,
        messageOccurredAt: isoFromMs(message.occurredAt),
        thread,
        ...(task === undefined ? {} : { task }),
        // 索菲亚没有任务序号 ⇒ 如实缺席（见 `agent-team-types.ts`）。
        claimOwners: [],
        ...(newest === undefined ? {} : { lastActivityAt: isoFromMs(newest.occurredAt) }),
        topLevel: true,
        mentions: [],
      })
    }
  }
  items.sort((left, right) => left.message.occurredAt - right.message.occurredAt)
  return {
    channelRef: channel.channelId,
    name: channel.title,
    // 上游的频道表带 `state`；索菲亚没有那个事实 ⇒ 只给界面真的会读的两项。
    channels: team.channels.map(one => ({ channelRef: one.channelId, name: one.title })),
    // 见本函数说明：团级事实的频道视图，不是一份虚构的频道成员表。
    members: team.members.map(member => ({ channelRef: channel.channelId, memberId: member.memberId })),
    // 人类哨兵（见 `actorOf`）。
    humanMemberId: '',
    items,
    cursor: items.length,
    hasMore: false,
  }
}

/**
 * 一个线程的 canOpenRefs 判据：索菲亚能不能「跳到某个 task/channel/thread 引用」。
 *
 * 索菲亚的路由是单团单页（`PanelStore` 一次读一个团的视图），
 * **没有**按 ref 解析并跳转的宿主路由 ⇒ 恒 `false`。
 * 调用点据此走「全部按字面渲染 + 保留尾部 chip 行」的那一支，
 * 而不是画一批点了没反应的链接。
 */
export const CAN_OPEN_REFS = false

/**
 * 一个团的成员（供 `loadMembers` 用）。
 *
 * ⚠ 只含**非墓碑**成员：索菲亚的 `WireMember.tombstone` 为真表示已归档/销毁，
 * 上游的 roster 语义（可 @ 的人）不含他们。这是**过滤**而不是发明。
 */
export function rosterOf(team: WireTeam): readonly AgentTeamClientMemberStatus[] {
  return team.members.filter(member => member.tombstone === false).map(toMemberStatus)
}

/**
 * 派生的任务列表：索菲亚 `WireTask` → 上游 `AgentTeamTask`。
 *
 * ⚠ 上游 `AgentTeamTask` 有 `channelRef` / `threadRef` / `taskRef` / `resolution`，
 * 索菲亚的 `WireTask` **一个都没有**（只有 `taskId` / `title` / `status` /
 * `assigneeMemberId` / `blockedBy`）。见 `agent-team-types.ts` 的 `AgentTeamTask` 说明：
 * 它是 `WireTask` 的直接别名 ⇒ 界面读 `task.status` 是**索菲亚的裸字符串状态**
 * （DAG 状态机由 `sophia-engine-dag` 拥有，不发明闭集）。
 */
export function tasksOf(team: WireTeam): readonly AgentTeamTask[] {
  return team.tasks
}

/** 团的活动（**只读转出**，索菲亚没有结构化活动，见 `agent-team-types.ts`）。 */
export function activitiesOf(team: WireTeam): readonly AgentTeamActivity[] {
  return team.activity.map(entry => ({
    activityRef: entry.activityId,
    actor: entry.actorMemberId,
    sequence: 0,
    // 索菲亚只有自由文本 summary，没有 kind ⇒ 显式给一个「非结构化」标记，
    // 让 `formatActivity` 走文本兜底分支（而不是被当成某个已知 kind）。
    kind: 'summary',
  }))
}

/** 团里每个成员 id → 该成员在**本团**里的 handle（供 `mentionNamesOf` 用）。 */
export function handleIndex(team: WireTeam): ReadonlyMap<AgentTeamMemberId, string> {
  const index = new Map<AgentTeamMemberId, string>()
  for (const member of team.members) {
    const status = toMemberStatus(member)
    index.set(member.memberId, status.member.handle.replace(/^@/, ''))
  }
  return index
}

/** 频道 → 界面频道。索菲亚 `title` ←→ 上游 `name`；见 `agent-team-types.ts`。 */
export function toChannel(channel: WireChannel): AgentTeamChannel {
  return channel
}

/**
 * Thread 关注者（attention）。
 *
 * ⚠ 索菲亚**没有 attention 模型**（谁在跟这个线程）。⇒ 返回空 items、
 * 关注者回退成「该线程消息涉及过的发送者」——那是**派生**的，不是账本事实，
 * 故只用于「composer 里把谁排前面」这种排序提示，且调用点已注明。
 */
export function toThreadObservations(team: WireTeam, threadId: string): AgentTeamThreadObservations {
  const senders = new Set<string>()
  for (const message of team.messages) {
    if (message.threadId === threadId) senders.add(message.senderMemberId)
  }
  return { items: [], followers: [...senders] }
}

// ────────────────────────────────────────────────────────────────────────────
// 左栏（侧边栏）需要的三个换算
// ────────────────────────────────────────────────────────────────────────────

/**
 * 全部团 → 左栏那个「工作区」列表。
 *
 * ⚠ 上游的 Workspace 是「一个仓库目录」，索菲亚的对应物是**团**
 * （见 `slots.ts` 的 `TeamSidebarWorkspace` 说明）。字段映射：
 *
 * | 上游 | 索菲亚 |
 * |---|---|
 * | `workspaceId` | `WireTeam.teamId` |
 * | `title` | `WireTeam.name` |
 * | `path` | **没有** ⇒ `''`（`WireTeam` 里没有仓库路径这一字段）。**不编造**： |
 * | | 编一个仓库目录名之类的路径会出现在选择器的悬停提示里， |
 * | | 而那是一个**不存在的目录**。空串的渲染后果由 `TeamWorkspaceSelector` 兜住。 |
 *
 * `view === null`（还没读到视图）⇒ 空数组：调用方（`TeamWorkspaceBrowser`）
 * 因此走「没有工作区」的分支，而不是画一行假条目。
 */
export function workspacesOf(view: WireView | null): readonly TeamWorkspaceChoice[] {
  return (view?.teams ?? []).map(team => ({
    workspaceId: team.teamId,
    title: team.name,
    path: '',
  }))
}

/**
 * 一个团 → 左栏「频道」分组要的视图。
 *
 * ⚠ 与 `index.ts` 的 `conversationProps.loadChannels` **同口径**
 * （同一份 `TeamChannelView` 形状、同一条「成员属团不属频道」的说明）：
 * 那里是一段**先于本函数存在的内联写法**，本次授权范围**不允许改别人的行**
 * （见任务约束：index.ts 只追加）⇒ 这里如实记录这处**已知重复**。
 * 两者一旦分叉，收件箱/Thread 页与左栏会看到不同的频道视图 ——
 * 后续合并时应当让 `conversationProps.loadChannels` 改调本函数，只留一处。
 *
 * `members` 给的是「这个团的所有成员都可达」这一**团级事实**的频道视图，
 * 而不是虚构一份频道成员表（理由与 `index.ts` 那处逐字相同）。
 */
export function toChannelView(team: WireTeam): TeamChannelView {
  return {
    channels: team.channels.map(channel => ({
      channelRef: channel.channelId,
      name: channel.title,
      threads: channel.threads.map(thread => thread.threadId),
    })),
    members: team.members.flatMap(member => team.channels.map(channel => ({
      channelRef: channel.channelId,
      memberId: member.memberId,
    }))),
  }
}

/**
 * 一个视图 → 底部「成员」对话框要的分组名册。
 *
 * ⚠ 上游这个对话框是**跨工作区分组**的（一个 Workspace 一组）。
 * 索菲亚的对应物就是 `WireView.teams` 本身 —— 每个团一组，
 * 组标题用团名。这不是「补一个上位概念」：它就是索菲亚真有的那一维。
 *
 * `rosterOf` 已过滤墓碑成员（见该函数的说明），故对话框里不会出现已归档的人。
 */
export function memberGroupsOf(view: WireView | null): readonly TeamMemberGroup[] {
  return (view?.teams ?? []).map(team => ({
    workspaceId: team.teamId,
    workspaceTitle: team.name,
    members: rosterOf(team),
  }))
}
