/**
 * 文案表（中 / 英），跟随 DSH 官方 locale 服务。
 *
 * 与上游 `client-agent-team/src/client/locales.ts` 同形：
 * `zh` 是**键集真源**，`en` 的类型写成 `Record<LocaleKey, string>` —— 于是
 * **少一个键就是编译错误**（`LocaleKey` 由 `zh` 推导）。
 *
 * ⚠ 这条约束**来自类型、不是来自测试**（OCR 复核 LOW：本注释曾写成
 * 「由 `locales.spec.ts` 钉住」，而那个文件并不存在）。
 * 这里如实写成类型约束：`en: Record<LocaleKey, string>` 让漏键在
 * `tsc --noEmit -p tsconfig.client.json` 当场报 TS2739。
 * 真实命中的例子：`emptyChannels` 最初只加进 `zh`，client 半立刻报
 * 「Argument of type '"emptyChannels"' is not assignable to ...」——
 * 反向证明了这条约束**真的会红**，而不是恒真断言。
 *
 * `zh` 用 `as const`，`LocaleKey` 由它推导 —— 于是 `t('拼错的键')` 也是编译错误。
 *
 * ## 与 DSH locale 服务的接线
 *
 * 真实服务面（实测读自 `dsh-client-locale/lib/client.js`）：
 * - `register(ns, { zh, en })` 注册一组字典，返回 disposer；
 * - `bind(ns)` 返回 `(key, params?) => string`，模板里的 `{name}` 会被 `params` 替换；
 * - 键查不到时**回落**：先本 ns，再 `common` ns，最后**原样返回键名**。
 *
 * 本文件**不**依赖那个服务：`translate()` 是一个纯函数，自己就能把 `{n}` 填好。
 * 服务在场时优先用服务（这样界面跟随用户语言切换），不在场时用本文件的
 * `detectLocale()` + `translate()` 降级 —— 与本仓「服务没到齐也先降级加载」一致。
 *
 * @module @sophia/core/client/locales
 */

/** 中文文案（**键集真源**）。 */
export const zh = {
  // ── 面板与侧边栏 ──────────────────────────────────────────────────────
  panelLabel: '索菲亚',
  panelTitle: '索菲亚 · 团队',
  panelEntryTitle: '打开索菲亚团队面板',
  backToConversation: '返回对话',

  // ── 加载 / 不可用状态（如实回报，不假装成功）──────────────────────────
  loading: '正在读取团队视图…',
  unavailableTitle: '团队视图不可用',
  unavailableHint: '视图由账本事实投影而来，需要宿主侧的读取路由。',
  retry: '重试',
  // ⚠ 「已生效但审计异常」的专用文案（captain 派修的 HIGH）：
  //   措辞必须同时做到三件事 —— ①说清**已经生效**（不是失败）；
  //   ②说清**不要重试**（重试会写第二条事件）；③给出发生了什么（序号不符）。
  //   写成「失败，请重试」是**有害的**：用户会重试，而重试会真的写第二条。
  appliedWithAnomalyTitle: '已生效，但审计序号异常',
  // ⚠ 不带 Markdown 标记（本仓纪律：这些串被当**纯文本**渲染，写 `**…**`
  //   会让用户真的看到星号 —— 我这次差点又写进去，OCR 那条门禁会拦）。
  appliedWithAnomalyHint: '这次操作已经写入账本（不可撤销）。序号与预期不符通常意味着另一个进程同时提交过。请勿重试 —— 重试会再写一条记录。',

  // ── 概览 ──────────────────────────────────────────────────────────────
  teams: '团队',
  noTeam: '还没有团队',
  noTeamHint: '持久团队由团长发起派生、经人类批准后成立；成立后即使窗口关闭也继续存在。',
  // 建团引导（空态的操作出口 —— 对标上游：空态也要告诉用户下一步做什么）。
  createTeamHint: '在对话里说一句「建一个团」即可开始：临时团立即成立，持久团经人类批准后成立。',

  // ── 空态侧栏骨架（零团也渲染三分区，对标上游 dsh-agent-team）───────────
  inboxTitle: '收件箱',
  inboxEmpty: '收件箱是空的',
  channels: '频道',
  agents: 'Agents',
  emptyAgents: '还没有 Agent',

  // ── 频道页 ────────────────────────────────────────────────────────────
  channelMembers: '频道成员',
  emptyChannels: '还没有频道',
  memberCount: '{count} 位成员',
  onlineCount: '{count} 位在线',
  messageStream: '消息流',
  emptyMessages: '还没有消息',
  emptyMessagesHint: '这条线程上还没有任何发言。',
  senderUnknown: '未知成员',
  messageCount: '{count} 条消息',

  // ── 成员卡与生命周期 ──────────────────────────────────────────────────
  lifecycleActive: '在册',
  lifecycleSuspended: '已挂起',
  lifecycleArchived: '已归档',
  lifecycleDestroyed: '已销毁',
  lifecycleUnknown: '状态未知',
  presenceIdle: '空闲',
  presenceRunning: '工作中',
  tombstoneBadge: '历史成员',
  // ⚠ 用户可见文案里**不得**出现 Markdown 强调标记（OCR 复核 LOW）：
  //   这些字符串被渲染成纯文本 / `title` 属性，没有任何 Markdown 处理，
  //   写 `**…**` 会让用户**真的看到星号**。强调靠组件结构（加粗 span）表达。
  tombstoneHint: '归档/销毁成员的历史事件仍可读，因此这里不隐藏、只灰显。',
  memberModel: '模型',
  modelFollowDefault: '跟随全局默认',
  switchModel: '切换模型',
  switchingModel: '正在切换…',
  switchModelHint: '换模需经成员运行时在最近的步骤边界生效。',
  switchModelUnavailable: '宿主侧的换模接口尚未挂载。',
  modelOf: '{provider} / {model}',

  // ── 活动面板 ──────────────────────────────────────────────────────────
  activityPanel: '活动面板',
  expand: '展开',
  collapse: '折叠',
  progressTitle: '进度',
  progressSummary: '共 {total} 项，已完成 {done} 项',
  progressEmpty: '暂无任务',
  taskStatusTodo: '待处理',
  taskStatusInProgress: '进行中',
  taskStatusInReview: '待验收',
  taskStatusDone: '已完成',
  taskStatusClosed: '已关闭',
  taskStatusBlocked: '已阻塞',
  blockersTitle: '阻塞提示',
  blockersNone: '当前没有阻塞',
  blockerCount: '{count} 处阻塞',
  recentActivity: '最近活动',
  activityEmpty: '还没有活动',

  // ── 增量盲区（如实声明，不静默少显示）─────────────────────────────────
  coverageTitle: '增量读取盲区',
  // 同 `tombstoneHint`：不带 Markdown 标记（它被当纯文本渲染）。
  coverageNotice:
    '本次是按 scope 的增量读取：{count} 类事件在此路径上结构不可见（{kinds}）。' +
    '线程列表尤其落在其中 —— 需要完整线程时须走不带 scope 的全量重建。',
  diagnosticsNotice: '投影诊断：{malformed} 条载荷不合法被拒、{unresolved} 条引用不在本次视野。',

  // ── 审批区（两级审批的人类出口 · 文档 3.6）──────────────────────────────
  approvalTitle: '待审批的建团申请',
  approvalKindPersistent: '持久团',
  approvalKindTemporary: '临时团',
  approvalRosterLabel: '名册',
  approvalTasksLabel: '计划任务',
  approve: '批准',
  reject: '否决',
  decisionWorking: '处理中…',
  decisionFailed: '审批提交失败，详情见控制台。',

  // ── 运营入口（文档 4：lifecycle / 频道 / 加成员）────────────────────────
  suspendMember: '挂起',
  resumeMember: '恢复',
  createChannel: '新建频道',
  addMember: '添加成员',
  channelTitlePlaceholder: '频道名',
  memberPositionPlaceholder: '职位名（如灵台郎）',
  opFailed: '操作失败，详情见控制台。',

  // ── DAG 画布（文档 5 · 阶段 3）──────────────────────────────────────────
  dagTitle: 'DAG 依赖视图',
  dagOwnerLabel: '归属',
  dagTaskEmpty: '还没有任务状态事件',
  dagDependenciesNote: '任务依赖关系：阶段 3 提供（一期任务无依赖边，故不绘制）',

  // ── 建团模式单选（文档 2.4 StagingDualPlan）─────────────────────────────
  modeLabel: '建团模式',
  modePersistent: '持久团（当前可用）',
  modeDag: 'DAG 调度模式（阶段 3 开放）',

  // ── 通用 ──────────────────────────────────────────────────────────────
  close: '关闭',
} as const

/** 英文文案。键集必须与 `zh` **完全一致** —— 由 `Record<LocaleKey, string>` 类型钉住。 */
export const en: Record<LocaleKey, string> = {
  panelLabel: 'Sophia',
  panelTitle: 'Sophia · Team',
  panelEntryTitle: 'Open the Sophia team panel',
  backToConversation: 'Back to conversation',

  loading: 'Reading the team view…',
  unavailableTitle: 'Team view unavailable',
  unavailableHint: 'The view is a projection of ledger facts and needs the host read route.',
  retry: 'Retry',
  appliedWithAnomalyTitle: 'Applied, but the audit sequence is anomalous',
  appliedWithAnomalyHint: 'This change was written to the ledger and cannot be undone. A mismatched sequence usually means another process committed at the same time. Do not retry — retrying writes a second record.',

  teams: 'Teams',
  noTeam: 'No team yet',
  noTeamHint: 'A persistent team is spawned by a principal and needs human approval; once created it outlives any window.',
  // Create-team guidance (the empty state's action exit — every empty state tells the user what to do next).
  createTeamHint: 'Say "create a team" in a conversation to start: a temporary team starts immediately; a persistent team awaits human approval.',

  // Empty-state sidebar skeleton (all three sections render even with zero teams, matching dsh-agent-team).
  inboxTitle: 'Inbox',
  inboxEmpty: 'The inbox is empty',
  channels: 'Channels',
  agents: 'Agents',
  emptyAgents: 'No agents yet',

  channelMembers: 'Channel members',
  emptyChannels: 'No channels yet',
  memberCount: '{count} member(s)',
  onlineCount: '{count} online',
  messageStream: 'Messages',
  emptyMessages: 'No messages yet',
  emptyMessagesHint: 'Nothing has been said on this thread yet.',
  senderUnknown: 'Unknown member',
  messageCount: '{count} message(s)',

  lifecycleActive: 'Active',
  lifecycleSuspended: 'Suspended',
  lifecycleArchived: 'Archived',
  lifecycleDestroyed: 'Destroyed',
  lifecycleUnknown: 'Unknown state',
  presenceIdle: 'Idle',
  presenceRunning: 'Working',
  tombstoneBadge: 'Historical',
  tombstoneHint: 'An archived or destroyed member\u2019s history stays readable, so it is greyed out rather than hidden.',
  memberModel: 'Model',
  modelFollowDefault: 'Follow global default',
  switchModel: 'Switch model',
  switchingModel: 'Switching…',
  switchModelHint: 'A switch takes effect at the member\u2019s nearest step boundary.',
  switchModelUnavailable: 'The host switch-model route is not mounted yet.',
  modelOf: '{provider} / {model}',

  activityPanel: 'Activity',
  expand: 'Expand',
  collapse: 'Collapse',
  progressTitle: 'Progress',
  progressSummary: '{total} item(s), {done} done',
  progressEmpty: 'No tasks',
  taskStatusTodo: 'To do',
  taskStatusInProgress: 'In progress',
  taskStatusInReview: 'In review',
  taskStatusDone: 'Done',
  taskStatusClosed: 'Closed',
  taskStatusBlocked: 'Blocked',
  blockersTitle: 'Blockers',
  blockersNone: 'Nothing is blocked',
  blockerCount: '{count} blocker(s)',
  recentActivity: 'Recent activity',
  activityEmpty: 'No activity yet',

  coverageTitle: 'Incremental blind spot',
  coverageNotice:
    'This was a scoped incremental read: {count} event kind(s) are structurally invisible on that path ({kinds}). ' +
    'Threads fall in there \u2014 a complete thread list needs the unscoped full rebuild.',
  diagnosticsNotice: 'Projection diagnostics: {malformed} malformed event(s) rejected, {unresolved} reference(s) outside this view.',

  approvalTitle: 'Pending team requests',
  approvalKindPersistent: 'Persistent team',
  approvalKindTemporary: 'Temporary team',
  approvalRosterLabel: 'Roster',
  approvalTasksLabel: 'Planned tasks',
  approve: 'Approve',
  reject: 'Reject',
  decisionWorking: 'Working…',
  decisionFailed: 'Failed to submit the decision; see console for details.',

  suspendMember: 'Suspend',
  resumeMember: 'Resume',
  createChannel: 'New channel',
  addMember: 'Add member',
  channelTitlePlaceholder: 'Channel title',
  memberPositionPlaceholder: 'Position (e.g. LingTaiLang)',
  opFailed: 'Operation failed; see console for details.',

  dagTitle: 'DAG view',
  dagOwnerLabel: 'Owner',
  dagTaskEmpty: 'No task-state events yet',
  dagDependenciesNote: 'Task dependencies: provided in phase 3 (phase-1 tasks have no dependency edges, so none are drawn)',

  modeLabel: 'Team mode',
  modePersistent: 'Persistent team (available now)',
  modeDag: 'DAG scheduler mode (opens in phase 3)',

  close: 'Close',
}

/** 文案键（由 `zh` 的键集推导）。 */
export type LocaleKey = keyof typeof zh

/** 支持的界面语言。与 DSH 官方 locale 的取值一致（`LOCALE_IDS = ['zh','en']`）。 */
export type LocaleId = 'zh' | 'en'

/** 字典表。 */
export const DICTIONARIES: Readonly<Record<LocaleId, Record<LocaleKey, string>>> = { zh, en }

/**
 * 模板插值（纯函数）。
 *
 * 只替换**已知**的 `{name}`：未知占位符原样保留（而不是替换成 `undefined`）。
 *
 * ⚠ **「已知」的判据必须是自有属性**（OCR 复核 MEDIUM 抓到的真实缺陷）：
 * 初版用 `name in params`。`in` **会往上查原型链** —— 于是 `{toString}`、
 * `{constructor}`、`{hasOwnProperty}` 这类占位符（或任何与
 * `Object.prototype` 成员重名的键）会被解析成**继承来的函数**，
 * 并把 `"function toString() { [native code] }"` 渲染进**用户可见文案**。
 * `params` 常常由账本/宿主数据拼出来，是外部输入，所以这条可达。
 * 改用 `Object.prototype.hasOwnProperty.call` 后，只有**真的传了**这个键才替换。
 *
 * （与 `dsh-client-locale` 的 `translate()` 在**正常键**上行为一致 ——
 *   差别只在原型键这种病态输入上，而那里保留原文才是对的。）
 */
export function translate(
  dict: Readonly<Record<LocaleKey, string>>,
  key: LocaleKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const template: string | undefined = dict[key]
  // ⚠ **键不在字典里也要降级，不能抛**（OCR 复核 MEDIUM 抓到）。
  //   `key` 的静态类型是 `LocaleKey`，但这个模块处在**边界**上：
  //   键可能来自宿主/账本（运行期不受类型约束）。初版直接 `dict[key].replace(...)`
  //   ⇒ 认不出的键会抛 `TypeError: Cannot read properties of undefined (reading 'replace')`，
  //   而这个函数跑在 `apply()` 的挂载路径上 —— 一次文案缺失会把**整个界面挂载**
  //   带进 catch 分支。返回键名本身：既让界面照常渲染，也让缺哪个键一眼可见。
  //   （`dsh-client-locale` 的服务路径就是这个口径，本地路径与之保持一致。）
  if (typeof template !== 'string') return String(key)
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

/**
 * 探测界面语言（不依赖 locale 服务时的降级路径）。
 *
 * ## 逐级容错，不是「document 在就一定能读」
 *
 * 初版写成 `document.documentElement.lang` —— 实测会抛
 * `TypeError: Cannot read properties of undefined (reading 'lang')`：
 * `document` 在场**不等于** `documentElement` / `navigator` 在场
 * （测试用的最小假 DOM、被 CSP/沙箱限制的文档、以及某些内嵌 webview 都可能缺）。
 * 而这个函数在 `apply()` 的路径上 ⇒ 一次抛错会把**整个界面挂载**带进
 * catch 分支。语言探测是**可选优化**，绝不该有这个能级。
 *
 * 故每一级都独立取值、逐级回退，最后落到默认值 `'zh'`
 * （本插件的文案真源是中文，且非浏览器环境根本不会渲染界面）。
 */
export function detectLocale(): LocaleId {
  const doc = typeof document === 'undefined' ? undefined : document
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  // ⚠ **navigator 排在 document 之前**（2026-09-24 主人实测「面板是英文」的根因之一）：
  //   主界面 html 模板是 lang="en"，旧顺序里它排第一 ⇒ 命中 en 直接返回，
  //   系统明明是中文（navigator.languages = zh-CN）也没机会。html 的 lang 属性
  //   是**文档**语言（模板残留、用户从不改），用户语言应看 navigator。
  const candidates = [
    nav?.language,
    ...(Array.isArray(nav?.languages) ? nav.languages : []),
    doc?.documentElement?.lang,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const lower = candidate.toLowerCase()
    if (lower.startsWith('zh')) return 'zh'
    if (lower.startsWith('en')) return 'en'
  }
  return 'zh'
}

/**
 * 造一个绑定到某个语言的 `t()`。
 *
 * ⚠ **认不出的 locale 要回退到 `zh`，不能让字典变成 `undefined`**
 * （OCR 复核 MEDIUM）：`LocaleId` 是静态类型，但 `locale` 可能来自宿主
 * （`index.ts` 的 `asLocale` 就是在边界上收窄外部输入）。若某个值被强转成
 * `LocaleId` 而实际不在字典表里，`DICTIONARIES[locale]` 就是 `undefined`，
 * 之后**每一次** `t()` 都会在 `translate` 里炸 —— 一个语言标识的小问题
 * 会放大成「整个界面没有文案」。回退到默认语言是这里的正确降级。
 */
export function translatorFor(locale: LocaleId) {
  const dict = DICTIONARIES[locale] ?? DICTIONARIES.zh
  return (key: LocaleKey, params?: Readonly<Record<string, string | number>>): string =>
    translate(dict, key, params)
}
