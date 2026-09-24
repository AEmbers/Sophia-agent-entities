/**
 * 视图数据面：**宿主路由载荷 → 界面渲染数据**（纯函数，无 React、无 DOM、无副作用）。
 *
 * ## 这里为什么是「纯函数」而不是「客户端状态」
 *
 * FR-10.2 要求「前端所有视图须为账本事实的投影，**不得持有独立真相**」。
 * 本模块因此**没有**任何缓存、订阅或可变字段：它把一次读取的载荷**映射**成
 * 界面需要的形状，函数调完就结束。真相在账本里，投影在宿主侧（`t3`），
 * 本模块只是投影的**渲染前整理**。
 *
 * ## ⚠ 为什么这里的载荷类型是**重新声明**的，而不是 import `t3` 的投影类型
 *
 * 实测（本任务，`tsc --noEmit -p tsconfig.client.json`，exit 2）：
 *
 * ```
 * src/ledger.ts(37,28): error TS2307: Cannot find module 'node:crypto'
 * src/ledger.ts(38,30): error TS2307: Cannot find module 'node:sqlite'
 * src/naming.ts(30,29): error TS2307: Cannot find module 'node:crypto'
 * ```
 *
 * 只要 client 侧**碰一下** `../projection/index.ts`（哪怕只 `import type`），
 * tsc 就会顺着 `projection → ledger/naming` 把 node 内建模块拉进
 * `types: []` + `lib: [DOM]` 的配置里，当场报错 —— 因为类型解析不看
 * 「这个 import 会不会被擦除」，它要**解析整个模块图**。
 * `t3` 的文件头也已明确警告过这条（`src/projection/index.ts:63-68`）。
 *
 * ⇒ 因此这些类型是**宿主路由的线格式（wire format）声明**，由宿主侧拥有；
 * 客户端只声明自己**渲染时真正读到的**那些字段。刻意**不**逐字段照抄
 * `RosterSnapshot` / `ChannelSnapshot` —— 照抄会造出「第二个真相」，
 * 而线格式本就只需要一个子集。字段名与投影输出**逐字一致**（`memberId` /
 * `displayName` / `lifecycle` / `tombstone` / `assigneeMemberId` …），
 * 这样宿主把投影结果直接 `JSON.stringify` 出来就能对上。
 *
 * @module @sophia/core/client/view-model
 */

import type { LocaleKey } from './locales.ts'
// 线格式的**本地引用**（本文件的纯函数要用它们做类型标注）。
// re-export 那一块只把符号**转出去**，不会把它们引进本文件的作用域，
// 所以这里必须另有一条 import —— 两条各司其职，别合并掉。
//
// ⚠ 只列**本文件正文真正用到**的符号（OCR 复核 LOW [28] 抓到 `WireLifecycle`
//   只出现在 import 与 re-export 两处、正文零引用 ⇒ 它是死绑定）。
//   漏一个会 tsc 报错；多一个没人会发现 —— 所以多一个也算缺陷。
import {
  UNKNOWN_LIFECYCLE,
  type WireActivity,
  type WireChannel,
  type WireLifecycleState,
  type WireMember,
  type WireMessage,
  type WirePresence,
  type WirePendingPlan,
  type WireDagTeam,
  type WireTask,
  type WireTaskStatus,
  type WireTeam,
  type WireThread,
  type WireView,
} from '../wire.ts'

// ────────────────────────────────────────────────────────────────────────────
// 线格式（宿主路由的响应）—— **定义在 `src/wire.ts`**，此处只做 re-export
// ────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ 这些类型**曾经定义在本文件里**，现已移到 `../wire.ts`（**不是**搬家洁癖，
 * 是修一个真实缺陷）。原因与实测证据见 `../wire.ts` 的文件头：
 *
 * 宿主半 `tsconfig.json`（`lib: ["es2024"]`，无 DOM）的 `exclude: ["src/client"]`
 * **只决定根文件扫描范围，拦不住被 import 拉进来的文件**。宿主侧一 `import type`
 * 本文件，tsc 就顺着 `view-model.ts → locales.ts → document` 把浏览器代码
 * 拉进无 DOM 的 program，契约命令
 * `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` 直接 **exit 2**：
 *
 * ```
 * src/client/locales.ts(245,22): error TS2584: Cannot find name 'document'.
 * ```
 *
 * 而线格式本来就说好了「由宿主侧拥有」（见本文件头），放在宿主侧是**归位**。
 * 这里保留 re-export 是为了不动既有调用点（`panel-store.ts`、各测试文件）
 * 与既有对外契约 —— 迁移对它们**零可见**。
 */
export {
  UNKNOWN_LIFECYCLE,
  type WireActivity,
  type WireChannel,
  type WireLifecycle,
  type WireLifecycleState,
  type WireMember,
  type WireMessage,
  type WirePresence,
  type WirePendingPlan,
  type WireDagTeam,
  type WireTask,
  type WireTaskStatus,
  type WireTeam,
  type WireThread,
  type WireView,
} from '../wire.ts'

// ────────────────────────────────────────────────────────────────────────────
// 收窄（线格式是外部输入，**不可信**：逐字段自证，不 `as`）
// ────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function arr(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 把生命周期收窄成 4 个真实值之一；认不出（或缺失）**保留**成 `UNKNOWN_LIFECYCLE`。
 *
 * 见 `UNKNOWN_LIFECYCLE` 的说明：**不要**在这里把未知值改写成某个近义词。
 */
function lifecycleOrUnknown(value: unknown): WireLifecycleState {
  switch (value) {
    case 'active':
    case 'suspended':
    case 'archived':
    case 'destroyed':
      return value
    default:
      return UNKNOWN_LIFECYCLE
  }
}

function asModel(value: unknown): WireMember['model'] {
  if (!isRecord(value)) return null
  const provider = str(value['provider'])
  const model = str(value['model'])
  if (provider === '' || model === '') return null
  return { provider, model }
}

function optionalId(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asMember(raw: unknown): WireMember | null {
  if (!isRecord(raw)) return null
  const memberId = str(raw['memberId'])
  if (memberId === '') return null
  const position = str(raw['position'])
  const name = str(raw['name'])
  const lifecycle = lifecycleOrUnknown(raw['lifecycle'])
  const presence = raw['presence']
  const avatarPath = raw['avatarPath']
  return {
    memberId,
    position,
    name,
    // 显示名：宿主给就用宿主的，没给就用 position（FR-5A.4 的裁决在宿主侧，
    // 客户端**不重新实现** `displayNameOf` —— 那会是第二个真相）。
    displayName: str(raw['displayName']) || position || name || memberId,
    // ⚠ 墓碑**按条目的 `tombstone` 与生命周期值渲染，绝不按事件 kind 反推**：
    //   账本里根本没有 `member-archived` 这个 kind，`archived` 只能作为某次
    //   生命周期转换的 `to` 抵达（t3 实测，`tests/ledger.spec.ts:1183`）。
    //   按 kind 硬编码会让 `archived` 在界面上**结构上不可达**。
    //
    // ⚠ 未知态**原样保留**（不写成 `'active'`）—— 见 `UNKNOWN_LIFECYCLE`。
    lifecycle,
    tombstone: raw['tombstone'] === true
      || lifecycle === 'archived'
      || lifecycle === 'destroyed',
    model: asModel(raw['model']),
    ...(typeof avatarPath === 'string' && avatarPath !== '' ? { avatarPath } : {}),
    ...(presence === 'idle' || presence === 'running' ? { presence } : {}),
  }
}

function asThread(raw: unknown): WireThread | null {
  if (!isRecord(raw)) return null
  const threadId = str(raw['threadId'])
  const channelId = str(raw['channelId'])
  if (threadId === '' || channelId === '') return null
  return {
    threadId,
    channelId,
    title: str(raw['title']) || threadId,
    assigneeMemberId: optionalId(raw['assigneeMemberId']),
  }
}

function asChannel(raw: unknown): WireChannel | null {
  if (!isRecord(raw)) return null
  const channelId = str(raw['channelId'])
  if (channelId === '') return null
  return {
    channelId,
    title: str(raw['title']) || channelId,
    threads: arr(raw['threads']).flatMap((entry) => {
      const thread = asThread(entry)
      return thread === null ? [] : [thread]
    }),
  }
}

function asMessage(raw: unknown): WireMessage | null {
  if (!isRecord(raw)) return null
  const messageId = str(raw['messageId'])
  if (messageId === '') return null
  return {
    messageId,
    channelId: str(raw['channelId']),
    threadId: str(raw['threadId']),
    senderMemberId: str(raw['senderMemberId']),
    body: str(raw['body']),
    occurredAt: num(raw['occurredAt']),
  }
}

function asTask(raw: unknown): WireTask | null {
  if (!isRecord(raw)) return null
  const taskId = str(raw['taskId'])
  if (taskId === '') return null
  return {
    taskId,
    title: str(raw['title']) || taskId,
    // ⚠ 缺失的 `status` 用**空串**，不塞 `'todo'`（OCR 复核 LOW 抓到的真实缺陷）：
    //   塞 `'todo'` 是**凭空发明一个事实** —— 界面会把「宿主没给状态」显示成
    //   「待处理」。空串下 `taskStatusKeyOf` 返回 `null`，界面照原样显示（空），
    //   与「未知就是未知」的纪律一致。
    status: str(raw['status']),
    assigneeMemberId: optionalId(raw['assigneeMemberId']),
    blockedBy: optionalId(raw['blockedBy']),
  }
}

function asActivity(raw: unknown): WireActivity | null {
  if (!isRecord(raw)) return null
  const activityId = str(raw['activityId'])
  if (activityId === '') return null
  return {
    activityId,
    actorMemberId: str(raw['actorMemberId']),
    summary: str(raw['summary']) || activityId,
    occurredAt: num(raw['occurredAt']),
  }
}

function asTeam(raw: unknown): WireTeam | null {
  if (!isRecord(raw)) return null
  const teamId = str(raw['teamId'])
  if (teamId === '') return null
  return {
    teamId,
    name: str(raw['name']) || teamId,
    kind: raw['kind'] === 'temporary' ? 'temporary' : 'persistent',
    members: arr(raw['members']).flatMap((entry) => {
      const member = asMember(entry)
      return member === null ? [] : [member]
    }),
    channels: arr(raw['channels']).flatMap((entry) => {
      const channel = asChannel(entry)
      return channel === null ? [] : [channel]
    }),
    messages: arr(raw['messages']).flatMap((entry) => {
      const message = asMessage(entry)
      return message === null ? [] : [message]
    }),
    tasks: arr(raw['tasks']).flatMap((entry) => {
      const task = asTask(entry)
      return task === null ? [] : [task]
    }),
    activity: arr(raw['activity']).flatMap((entry) => {
      const event = asActivity(entry)
      return event === null ? [] : [event]
    }),
  }
}

/**
 * 把宿主路由的**任意** JSON 收窄成 `WirePendingPlan`（逐字段自证，同 asTeam 口径）。
 *
 * `requestId` 是票的主键：缺失/空 ⇒ 整票丢弃（没有键的票没法批、也没法展示）。
 * `targetKind` / `status` 是闭集：认不出 ⇒ 丢弃（界面的按钮分支全押在这两个字段上，
 * 一个未知 status 会被渲染成「可批准」之类的错误动作）。
 */
// OCR MEDIUM：闭集判定不写嵌套三元（style 检查单明禁）—— Set 查表一次成型。
const TARGET_KIND_SET: ReadonlySet<string> = new Set(['persistent', 'temporary'])
const PLAN_STATUS_SET: ReadonlySet<string> = new Set([
  'awaiting',
  'approved',
  'rejectedByPrincipal',
  'rejectedByHuman',
])

function asPendingPlan(raw: unknown): WirePendingPlan | null {
  if (!isRecord(raw)) return null
  const requestId = str(raw['requestId'])
  if (requestId === '') return null
  const targetKindRaw = raw['targetKind']
  const targetKind = typeof targetKindRaw === 'string' && TARGET_KIND_SET.has(targetKindRaw)
    ? (targetKindRaw as WirePendingPlan['targetKind'])
    : null
  const statusRaw = raw['status']
  const status = typeof statusRaw === 'string' && PLAN_STATUS_SET.has(statusRaw)
    ? (statusRaw as WirePendingPlan['status'])
    : null
  const name = str(raw['name'])
  if (targetKind === null || status === null || name === '') return null
  const roster = arr(raw['roster']).flatMap((entry) => {
    if (!isRecord(entry)) return []
    const position = str(entry['position'])
    if (position === '') return []
    const count = isFiniteNumber(entry['count']) ? entry['count'] : 0
    const modelRaw = entry['model']
    const model = isRecord(modelRaw)
      ? (() => {
          const provider = str(modelRaw['provider'])
          const model = str(modelRaw['model'])
          return provider !== '' && model !== '' ? { provider, model } : null
        })()
      : null
    return [{ position, count, model }]
  })
  return {
    requestId,
    targetKind,
    status,
    name,
    requesterMemberId: str(raw['requesterMemberId']),
    roster,
    tasks: arr(raw['tasks']).map((task) => str(task)).filter((task) => task !== ''),
    reason: typeof raw['reason'] === 'string' ? raw['reason'] : null,
    humanOperatorId: typeof raw['humanOperatorId'] === 'string' ? raw['humanOperatorId'] : null,
    raisedAtSequence: isFiniteNumber(raw['raisedAtSequence']) ? raw['raisedAtSequence'] : 0,
  }
}

/** DAG 团的形状校验（同 asPendingPlan 口径：主键缺失/非对象 ⇒ 丢弃）。 */
function asDagTeam(raw: unknown): WireDagTeam | null {
  if (!isRecord(raw)) return null
  const dagTeamId = str(raw['dagTeamId'])
  if (dagTeamId === '') return null
  return {
    dagTeamId,
    ownerMemberId: str(raw['ownerMemberId']),
    parentTeamId: typeof raw['parentTeamId'] === 'string' ? raw['parentTeamId'] : null,
    tasks: arr(raw['tasks']).flatMap((entry) => {
      if (!isRecord(entry)) return []
      const taskId = str(entry['taskId'])
      if (taskId === '') return []
      const state = str(entry['state'])
      if (state === '') return []
      return [{ taskId, state, reason: typeof entry['reason'] === 'string' ? entry['reason'] : null }]
    }),
  }
}

/**
 * 把宿主路由的**任意** JSON 收窄成 `WireView`。
 *
 * 为什么逐字段自证而不是 `as WireView`：线格式是**外部输入**（可能来自
 * 别的版本、可能被中间层改写）。一处 `as` 会让下面所有渲染代码
 * 在一个 `undefined` 上崩，而崩在 React 渲染里会被错误边界吞成**空白面板**
 * —— 那种失败比「显示不可用」难查得多。
 *
 * ⚠ **认不出的条目被丢弃，但客户端*不*统计丢弃数**（OCR 复核 LOW：
 * 本注释曾写成「丢弃并计数」，与实现不符 —— 已按实际改写）。
 * 原因：客户端只收到**已收窄的载荷**，它无从区分「这一条本来就不该有」
 * 与「这一条被丢了」；真正能回答这件事的是**宿主**（它有原始账本与投影）。
 * 因此 `WireView` 上的 `malformedEvents` / `unresolvedReferences` 是
 * **宿主给的口径**（数的是账本级的不合法事件与视野外引用，是**另一个**概念），
 * 客户端只**透传显示**、不假装自己能算出来。
 */
export function parseWireView(payload: unknown): WireView {
  if (!isRecord(payload)) {
    return { ok: false, error: 'malformed payload (not an object)', teams: [], pendingPlans: [], dagTeams: [] }
  }
  const coverage = payload['coverage']
  return {
    ok: payload['ok'] === true,
    ...(typeof payload['error'] === 'string' && payload['error'] !== ''
      ? { error: payload['error'] }
      : {}),
    teams: arr(payload['teams']).flatMap((entry) => {
      const team = asTeam(entry)
      return team === null ? [] : [team]
    }),
    // 审批票（文档 3.6 审批区）：坏条目逐个丢弃（同 teams 的 flatMap 口径）。
    pendingPlans: arr(payload['pendingPlans']).flatMap((entry) => {
      const plan = asPendingPlan(entry)
      return plan === null ? [] : [plan]
    }),
    // DAG 团（文档 5 · DagCanvas）：同口径逐个收窄。
    dagTeams: arr(payload['dagTeams']).flatMap((entry) => {
      const dag = asDagTeam(entry)
      return dag === null ? [] : [dag]
    }),
    ...(isRecord(coverage)
      ? {
          coverage: {
            scoped: coverage['scoped'] === true,
            unscopedKindsOmitted: arr(coverage['unscopedKindsOmitted']).map((kind) => str(kind))
              .filter((kind) => kind !== ''),
          },
        }
      : {}),
    // ⚠ 只接受**有限数**（OCR 复核 LOW）：`num()` 会把 `NaN`/`Infinity` 归成 0，
    //   于是宿主发来 `{"malformedEvents": Infinity}` 时界面会显示
    //   「0 个畸形事件」—— 把「这个字段是垃圾」谎报成「一切正常」，
    //   正是本模块反复要避免的「凭空发明一个事实」。
    //   非有限值 ⇒ **整项省略**（界面就没有这条诊断，而不是显示一个假的 0）。
    ...(isFiniteNumber(payload['malformedEvents'])
      ? { malformedEvents: payload['malformedEvents'] }
      : {}),
    ...(isFiniteNumber(payload['unresolvedReferences'])
      ? { unresolvedReferences: payload['unresolvedReferences'] }
      : {}),
  }
}

/**
 * 是不是一个**有限**的 number。
 *
 * 与 `num()` 的区别：`num()` 是「要一个数，垃圾就给 0」；
 * 这里是「判断能不能信这个值」，垃圾要能被识别出来并**省略**，
 * 而不是被归一化成一个看起来正常的值。
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// ────────────────────────────────────────────────────────────────────────────
// 渲染前派生（纯函数）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 把生命周期映射成文案键。
 *
 * `UNKNOWN_LIFECYCLE` ⇒ `lifecycleUnknown`（「状态未知」）。这条分支
 * **必须可达**：成员缺失 `lifecycle` 时如实说「未知」，
 * 而不是显示成「在册」（那样是凭空发明事实，见 `UNKNOWN_LIFECYCLE`）。
 */
export function lifecycleKeyOf(lifecycle: WireLifecycleState): LocaleKey {
  switch (lifecycle) {
    case 'active':
      return 'lifecycleActive'
    case 'suspended':
      return 'lifecycleSuspended'
    case 'archived':
      return 'lifecycleArchived'
    case 'destroyed':
      return 'lifecycleDestroyed'
    case UNKNOWN_LIFECYCLE:
      return 'lifecycleUnknown'
  }
}

/** 把存在态映射成文案键；`undefined`（账本没有这一项）时返回 `null`。 */
export function presenceKeyOf(presence: WirePresence | undefined): LocaleKey | null {
  switch (presence) {
    case 'idle':
      return 'presenceIdle'
    case 'running':
      return 'presenceRunning'
    default:
      return null
  }
}

/** 把任务状态映射成文案键。认不出的状态**原样显示**（不猜近义词）。 */
export function taskStatusKeyOf(status: WireTaskStatus): LocaleKey | null {
  switch (status.toLowerCase()) {
    case 'todo':
      return 'taskStatusTodo'
    case 'in_progress':
    case 'in-progress':
      return 'taskStatusInProgress'
    case 'in_review':
    case 'in-review':
      return 'taskStatusInReview'
    case 'done':
      return 'taskStatusDone'
    case 'closed':
      return 'taskStatusClosed'
    case 'blocked':
      return 'taskStatusBlocked'
    default:
      return null
  }
}

/** 进度分段条的一段。 */
export interface ProgressSegment {
  readonly taskId: string
  /** 该段属于哪一类状态（文案键；`null` = 认不出的状态）。 */
  readonly statusKey: LocaleKey | null
  /** 原始状态串（认不出时界面照原样显示）。 */
  readonly rawStatus: WireTaskStatus
  /** 已完成/已关闭 ⇒ 计入进度分子。 */
  readonly done: boolean
  readonly blocked: boolean
}

/** 进度汇总。 */
export interface ProgressSummary {
  readonly segments: readonly ProgressSegment[]
  readonly total: number
  readonly done: number
  /** `0`..`100`；`total` 为 0 时是 `0`（而不是 NaN）。 */
  readonly percent: number
}

/** 是否算「已完成」：`done` 与 `closed` 都计入（两者都是终态）。 */
function isDoneStatus(status: WireTaskStatus): boolean {
  const lower = status.toLowerCase()
  return lower === 'done' || lower === 'closed'
}

/**
 * 是否算「被阻塞」。
 *
 * ⚠ **单一判据，全模块共用**（OCR 复核 MEDIUM 抓到的真实矛盾）：
 * `taskStatusKeyOf` 会把 `status === 'blocked'` 渲染成「已阻塞」文案，
 * 而初版的「阻塞」判据只看 `blockedBy !== null`。于是一条
 * `status: 'blocked'` 且 `blockedBy: null` 的任务会出现：
 * 进度条上**标着「已阻塞」**，而阻塞面板说「当前没有阻塞」——
 * 同一屏两处互相打脸。
 *
 * ⇒ 两者的定义在这里合一：**状态说是阻塞，或者有阻塞来源，都算阻塞**。
 * 这是本模块作为「线格式唯一收窄点」该负责的事：把「什么叫阻塞」定死在一处，
 * 而不是让两个函数各自解释。
 */
export function isBlockedTask(task: WireTask): boolean {
  return task.blockedBy !== null || task.status.toLowerCase() === 'blocked'
}

/**
 * 把任务列表折成进度分段条（FR-4.4 的「进度分段条」）。
 *
 * ⚠ `percent` 在 `total === 0` 时返回 `0` 而不是 `NaN`：`NaN` 一旦进入
 * CSS 宽度就是**静默无效**（浏览器忽略该声明），进度条会显示成 0 宽 ——
 * 看起来像「进度确实是 0」，而真相是「根本没有任务」。显式给 0 并让界面
 * 走 `progressEmpty` 文案，两者才区分得开。
 */
export function summarizeProgress(tasks: readonly WireTask[]): ProgressSummary {
  const segments: ProgressSegment[] = tasks.map((task) => ({
    taskId: task.taskId,
    statusKey: taskStatusKeyOf(task.status),
    rawStatus: task.status,
    done: isDoneStatus(task.status),
    // 与阻塞面板**同一个判据**（见 `isBlockedTask`），不能各写一份。
    blocked: isBlockedTask(task),
  }))
  const done = segments.reduce((sum, segment) => (segment.done ? sum + 1 : sum), 0)
  const total = segments.length
  return { segments, total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/**
 * 阻塞项（见 `isBlockedTask` 的判据），按原顺序。
 *
 * 与 `summarizeProgress` 的 `segment.blocked` 同源 —— 界面上的
 * 「进度条标了阻塞」与「阻塞列表列出来了」不可能再对不上。
 */
export function blockersOf(tasks: readonly WireTask[]): readonly WireTask[] {
  return tasks.filter(isBlockedTask)
}

/** 展示名首字（头像加载不出来时的降级显示）。 */
export function initialOf(member: WireMember): string {
  const source = member.displayName.trim()
  // 用 `Array.from` 而不是 `[0]`：中文/emoji 都是多码元，`[0]` 会切出半个字符。
  const chars = Array.from(source)
  return chars.length === 0 ? '?' : (chars[0] as string)
}

/** 成员在线（`presence === 'running'`）。 */
export function isOnline(member: WireMember): boolean {
  return member.presence === 'running'
}

/** 在线人数。 */
export function onlineCount(members: readonly WireMember[]): number {
  return members.reduce((sum, member) => (isOnline(member) ? sum + 1 : sum), 0)
}

/** 墓碑排在后面、其余按原顺序（稳定排序，不按名字 —— 名字会重名）。 */
export function sortMembers(members: readonly WireMember[]): readonly WireMember[] {
  return [...members].sort((left, right) => Number(left.tombstone) - Number(right.tombstone))
}

/**
 * 一个频道/线程下的消息（按发生时间升序）。
 *
 * ⚠ **必须同时按 `channelId` 与 `threadId` 过滤**（OCR 复核 HIGH 抓到的真实缺陷）：
 * 初版**只**按 `threadId` 过滤，且在 `threadId === null`（未选线程）时直接
 * `return team.messages` ⇒ 返回**整个团**的消息。后果是硬的：侧边栏切到另一个
 * 频道时，消息流仍显示**上一个频道**的消息，却挂在新频道名下 ——
 * 一个看起来完全正常、内容却串了台的界面。
 *
 * 因此两个维度都要收窄，且**未选线程 ≠ 不过滤**：
 * - `threadId === null` ⇒ 该频道**全部**线程的消息（仍限本频道）；
 * - `threadId !== null` ⇒ 该线程的消息。
 *
 * `channelId === null`（没选任何频道）时返回**空数组**而不是全部消息：
 * 「没选频道」与「看这个团所有消息」是两件事，把前者显示成后者正是串台的成因。
 */
export function messagesOfTeam(
  team: WireTeam,
  channelId: string | null,
  threadId: string | null,
): readonly WireMessage[] {
  if (channelId === null) return []
  const scoped = team.messages.filter((message) =>
    message.channelId === channelId
    && (threadId === null || message.threadId === threadId),
  )
  return [...scoped].sort((left, right) => left.occurredAt - right.occurredAt)
}

/** `memberId → 成员` 索引（**按 ID 而不是按名字**：归档会释放名字，同团可有两个同名成员）。 */
export function memberIndex(team: WireTeam): ReadonlyMap<string, WireMember> {
  const index = new Map<string, WireMember>()
  for (const member of team.members) index.set(member.memberId, member)
  return index
}

/** 取显示名的兜底（找不到成员时如实说「未知成员」，而不是显示一个 `undefined`）。 */
export function displayNameIn(team: WireTeam, memberId: string | null): string | null {
  if (memberId === null) return null
  return memberIndex(team).get(memberId)?.displayName ?? null
}

/** 格式化时间戳（`HH:MM`，本地时区）。时间戳不合法时返回空串。 */
export function formatClock(occurredAt: number): string {
  if (!Number.isFinite(occurredAt) || occurredAt <= 0) return ''
  const date = new Date(occurredAt)
  if (Number.isNaN(date.getTime())) return ''
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
