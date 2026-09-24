/**
 * 索菲亚线格式 → 上游 UI 期望的活动模型（**adapter**）。
 *
 * ## 为什么要有这一层
 *
 * `vendor/` 里那份上游 UI 是照它自己的 `ActivityTeam / ActivityMember / ActivityTask`
 * 写的，而索菲亚的真相在 `WireTeam / WireMember / WireTask`（`src/wire.ts`）。
 * 把两者的接缝**集中在这一个文件**，而不是改散在 829 行 UI 里，理由：
 * 上游 UI 改得越少，将来跟上游版本越省力；映射一旦不对，只需要看这里。
 *
 * ## 缺失字段的处理纪律（重要）
 *
 * 索菲亚一期没有的投影（任务进度、未读数、当前任务、任务依赖边、workspace、
 * captainSessionId）一律**如实填中性值**并在下方写明"一期没有这个投影"。
 * **不伪造**：本仓纪律是「不发明数据」，视图层尤其不许编造从未发生过的事
 * （`docs/REQUIREMENTS.md` 的非目标与视图层契约都建立在这一点上）。
 *
 * @module sophia-core/client/adapters/activity
 */

import type { WireMember, WirePendingPlan, WireTask, WireTeam } from '../../wire.ts'
import type { ActivityMember, ActivityTask, ActivityTeam } from '../vendor/activity-types.ts'

/**
 * 成员存在态 → 上游的活动语义。
 *
 * `presence` 在索菲亚线格式里是**可选**的（它不是账本事实，FR-3.2 明确不得持久化，
 * 只在运行时给出）。没给出时返回 `'unknown'` —— UI 就不画存在态，而不是猜一个。
 */
function activityOf(member: WireMember): ActivityMember['activity'] {
  // ⚠ **墓碑优先**：`archived` / `destroyed` 成员的运行期存在态可能是**残留值**，
  // 界面不该把已销毁的成员画成「工作中」。这与 `components.tsx` 的 `dotVisualOf`
  // 同一条纪律（那里的注释原文：「`archived`/`destroyed` 的成员即使运行时有残留
  // 存在态，界面也不该显示成「工作中」」）。OCR 复核指出本函数初版漏了这一步。
  if (member.tombstone) return 'unknown'
  if (member.presence === 'running') return 'working'
  if (member.presence === 'idle') return 'idle'
  return 'unknown'
}

/** 索菲亚成员 → 上游成员。 */
export function toActivityMember(member: WireMember): ActivityMember {
  return {
    id: member.memberId,
    name: member.displayName,
    role: member.position,
    // ⚠ 索菲亚移植点（改动之二 · 头像素材）：把宿主给的**头像相对路径**透传到渲染点。
    // 上游的 `ActivityMember` 没有这个字段 —— 它的头像靠 `artwork.ts` 的正则表
    // （name + role → 打包的鲸鱼插画）算出来，不需要「路径」这个概念。
    // 索菲亚的素材是 20 张按规范职位名命名的立绘，而「职位 → 路径」只有**宿主**知道
    // （`wire.ts:90-99`：客户端不自己按职位名拼路径，那份映射只是第二个真相）
    // ⇒ 不在这里透传，面板就只能画首字降级，等于「素材没换成索菲亚的」。
    // 条件展开而不是 `avatarPath: member.avatarPath`：本包开了
    // `exactOptionalPropertyTypes`，显式传 `undefined` 不满足 `?: T`（与下面 model 同一条理由）。
    ...(member.avatarPath === undefined ? {} : { avatarPath: member.avatarPath }),
    // 条件展开而不是 `provider: member.model?.provider`：本包开了
    // `exactOptionalPropertyTypes`，显式传 `undefined` 不满足 `?: T`。
    ...(member.model !== null
      ? { provider: member.model.provider, model: member.model.model }
      : {}),
    activity: activityOf(member),
    // ⚠ 一期没有「进度 / 已完成 / 总数 / 当前任务 / 未读」这五个投影 ⇒ 填中性值。
    progress: 0,
    done: 0,
    total: 0,
    currentTask: '',
    unread: 0,
  }
}

/**
 * 索菲亚任务状态 → 上游 UI 要的闭集 `state`。
 *
 * 索菲亚的 `WireTaskStatus` 是**开放的 string**（`wire.ts` 明确"不发明闭集"，
 * DAG 状态机属 `sophia-engine-dag`），而上游 UI 要一个闭集才能上色/排序。
 * ⇒ 只映射**明确认得**的取值，其余一律 `'open'`：保守方向是"不把未知说成已完成"，
 * 那个方向的错会让人以为活干完了。
 */
function stateOf(task: WireTask): ActivityTask['state'] {
  if (task.blockedBy !== null) return 'blocked'
  switch (task.status.toLowerCase()) {
    case 'completed':
    case 'done':
      return 'completed'
    case 'failed':
      return 'failed'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'running':
    case 'in_progress':
      return 'running'
    default:
      return 'open'
  }
}

/**
 * 索菲亚任务 → 上游任务。
 *
 * ## ⚠ 索菲亚移植点（命名规则 / 承接人）—— 这处修的是一个**静默错**，不是风格问题
 *
 * 上游 UI 的 `ActivityTask.assignee` 语义是**给人看的承接人标签**，不是 id：
 * 它拿这个字段与 `ActivityMember.name` **按名比对**，共 5 处
 * （`vendor/panel/ActivityPanel.tsx` 的 `:367` `:382` `:778` 是成员↔任务归属，
 * `:653` `:654` 是「已分配条数」与团长哨兵 `'captain'`；另有 `:397` `:598` 直接显示）。
 *
 * 索菲亚线格式给的是 `assigneeMemberId`（**id**，见 `wire.ts:109`）——
 * 初版把 id 直接填进 `assignee`，于是那 5 处**全部落空**：每个成员都显示
 * 「未指派」（`task.assignee.unclaimed`），成员行里的当前任务永远为空，
 * 「已分配 N 条」少算。**编译期抓不到**（两边都是 `string`），
 * 静默地只是让界面说错话 —— 这也是它一直没被发现的原因：在本次移植之前，
 * `toActivityTeam` 根本没有真实消费者（`panel.tsx` 只用 `planToActivityTeam`）。
 *
 * ⇒ 在这一层把 id 解析成**成员显示名**（与 `ActivityMember.name` 同一来源：
 * `WireMember.displayName`）。名称在索菲亚是**团队内唯一**的
 * （`naming.ts:157-158` 的 `RULE_NAME_UNIQUE`；且 `displayNameOf`（`naming.ts:593-597`）
 * 只在 `职位名` / `职位名-<序号>` 两种形状间取值 ⇒ 不会因脱钩而撞名），
 * 所以按名比对在索菲亚不会歧义。
 *
 * 解析不到时**保留原 id**，不填 `''`：填 `''` 等于让界面断言「未指派」——
 * 而事实是「指派给了本团名册外的人」，那是把未知说成已知的反向错误；
 * 且 `assignedCount`（`ActivityPanel.tsx:653`）会把 `''` 排除，条数会少算。
 * 代价是极端情况下界面会显示一个 id 串（难看好，但为真）。
 *
 * `members` 是**必填**参数（不给默认值）：调用方漏传时应当编译报错，
 * 而不是悄悄退回"显示 id"这种退化行为。
 */
export function toActivityTask(task: WireTask, members: readonly WireMember[]): ActivityTask {
  const assignee = task.assigneeMemberId === null
    ? ''
    : members.find((member) => member.memberId === task.assigneeMemberId)?.displayName
      ?? task.assigneeMemberId
  return {
    id: task.taskId,
    subject: task.title,
    status: task.status,
    state: stateOf(task),
    assignee,
    // ⚠ 一期没有依赖边投影（SPEC 的 phase-1 边界）⇒ 空数组，不编造依赖关系。
    dependencies: [],
    depth: 0,
    ...(task.blockedBy !== null ? { description: task.blockedBy } : {}),
  }
}

/** 索菲亚团队 → 上游团队。 */
export function toActivityTeam(team: WireTeam, plan: WirePendingPlan | undefined): ActivityTeam {
  const awaiting = plan !== undefined && plan.status === 'awaiting'
  return {
    // ⚠ `workspace` 与 `captainSessionId` 是上游「把团绑在会话上」的字段；
    // 索菲亚的团**不绑会话**（这正是本项目与上游的根本分歧，见
    // `docs/REQUIREMENTS.md` 关于「僵尸团」的那一节）⇒ 空串，不是漏填。
    workspace: '',
    teamId: team.teamId,
    name: team.name,
    captainSessionId: '',
    phase: awaiting ? 'staged' : 'running',
    ...(awaiting ? { planReviewState: 'awaiting_review' as const } : {}),
    members: team.members.map(toActivityMember),
    // ⚠ 任务要拿到**本团名册**才能把 `assigneeMemberId` 解析成显示名（见 `toActivityTask`）。
    tasks: team.tasks.map((task) => toActivityTask(task, team.members)),
    messageCount: team.messages.length,
    // ⚠ 一期没有「团长收件箱」投影（人类收件箱是宿主侧通道）⇒ 空数组。
    captainInbox: [],
  }
}

/**
 * 名册条目展开的上限 —— 与宿主侧的名册长度门禁同量级。
 *
 * 超上限的名册本来就是**非法申请**（真正的门禁在宿主半的 `sophia_spawn_team`），
 * 这里只负责不让渲染线程被敌意/损坏的线格式拖死。
 */
const ROSTER_COUNT_CAP = 64

/**
 * 一张**待批计划** → 上游团队（拟建态）。
 *
 * 为什么必须有单独的入口：`WirePendingPlan` 描述的是**还没成立的团** ——
 * 它连 `teamId` 都没有（团队要等人类批准才创建），所以不能走 `toActivityTeam`
 * （那个从已存在的 `WireTeam` 映射）。而上游 UI 要的正是这种「拟建态」团队：
 * `phase: 'staged'` 才渲染计划编辑器。
 *
 * ⚠ 这里的 `teamId` / 成员 id / 任务 id 都是**合成标识**（用 `requestId` 派生），
 * 只用于 React key 与列表渲染 —— 它们**不是账本事实**，团队成立后真实 id 才产生。
 * 注释在此写明，是为了避免以后有人把这些合成 id 当成可回传主机的稳定引用。
 */
export function planToActivityTeam(plan: WirePendingPlan): ActivityTeam {
  const members: ActivityMember[] = []
  for (const entry of plan.roster) {
    // ⚠ `count` 来自**不可信的线格式**：`asPendingPlan` 只保证它是**有限数**，
    // 既不保证是整数、也没有上界。直接拿它当循环上界时，一个 `count: 1e9`（或 `2.5`）
    // 的载荷就会让渲染线程做十亿次迭代 / 生成奇数个成员（OCR 复核指出）。
    // 这里钳成「非负整数 + 上限」：超过上限的名册本来就是**非法申请**，
    // 画出来也没有意义（真正的门禁在宿主侧）。
    const count = Math.min(
      ROSTER_COUNT_CAP,
      Math.max(0, Math.trunc(Number.isFinite(entry.count) ? entry.count : 0)),
    )
    for (let index = 0; index < count; index += 1) {
      const ordinal = count > 1 ? `-${String(index + 1)}` : ''
      members.push({
        id: `${plan.requestId}:${entry.position}:${String(index)}`,
        name: `${entry.position}${ordinal}`,
        role: entry.position,
        // ⚠ 拟建态成员**没有** `avatarPath`（线格式的名册条目只有职位/数量/模型）⇒
        // 面板对它们走首字降级。这是**如实**的：这些成员还没被创建，宿主也还
        // 没有为它们解析过素材路径。要在这里也出真头像，得让宿主把
        // 「职位 → 头像路径」一并放进待批票的名册条目（线格式改动，不在本期）。
        ...(entry.model !== null
          ? { provider: entry.model.provider, model: entry.model.model }
          : {}),
        activity: 'unknown',
        progress: 0,
        done: 0,
        total: 0,
        currentTask: '',
        unread: 0,
      })
    }
  }
  return {
    workspace: '',
    teamId: plan.requestId,
    name: plan.name,
    captainSessionId: '',
    phase: 'staged',
    planReviewState: 'awaiting_review',
    members,
    tasks: plan.tasks.map((subject, index) => ({
      id: `${plan.requestId}:task:${String(index)}`,
      subject,
      status: 'planned',
      state: 'open' as const,
      assignee: '',
      dependencies: [],
      depth: 0,
    })),
    messageCount: 0,
    captainInbox: [],
  }
}
