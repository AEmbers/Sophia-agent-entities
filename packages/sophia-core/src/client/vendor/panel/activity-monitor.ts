/**
 * Shared, demand-driven state for the AgentTeams browser monitor.
 *
 * ⚠ **索菲亚移植点（改动之二 · 数据入口）** —— 本文件是整份副本里唯一动了
 * **运行时数据通路**的地方，逐条列清（其余结构、导出名、节拍策略与上游一致）：
 *
 * | 上游 | 索菲亚 | 为什么 |
 * |---|---|---|
 * | `fetchState(ACTIVITY_STATE_URL)` 打 `/plugins/dsh-agent-teams/state` | 读 `runtime.source`（`PanelStore`）的快照 | 索菲亚**没有那条路由**；数据在 `panel-store.ts` 的 store 里（`GET /api/sophia/view`），映射写在 `adapters/activity.ts` |
 * | 第二次 `fetchState('…?archived=1')` 取归档 + `settleTargets` 退役失踪目标 | **删除**（见下方 `tick` 内的说明） | 索菲亚的一次读取就把账本里的团（含墓碑）全给出来，没有 live/archive 两分；卡片目标已随 `AgentTeamsCard` 剥离 ⇒ 没有可退役的目标 |
 * | `discoverySessionId`（captain 会话 id） | `scope`（作用域，`''` 是合法值） | 索菲亚的团不绑会话（`adapters/activity.ts` 写明这是与上游的根本分歧） |
 *
 * ⚠ 本文件**不再自己发 HTTP**：父面板（`src/client/panel.tsx` 的 `PANEL_POLL_MS` 轮询）
 * 已经在打 `/api/sophia/view`。本控制器只在**本地**读 store 快照并投影 ——
 * 若这里也发请求，同一份数据会有两个节拍、两个「此刻的真相」。
 *
 * ⚠ 类型不再是本文件定义的：上游把类型与运行时写在同一份文件里，索菲亚先前的
 * 裁剪把它们搬到了 `../activity-types.ts`（见该文件头）。这里只**再导出**同样的名字，
 * 让 `./activity-monitor.ts` 仍像上游那样充当类型入口（`ActivityPanel.tsx` 就是这么 import 的），
 * 同时保证形状只有一份真相。
 */

import { planToActivityTeam, toActivityTeam } from '../../adapters/activity.ts'
import { VIEW_ROUTE } from '../../panel-store.ts'
import { HALT_URL } from '../bridge.ts'
import type { WireView } from '../../../wire.ts'
import type {
  ActivityMonitorTarget,
  ActivityPollingController,
  ActivityPollingRuntime,
  ActivitySnapshots,
  ActivitySource,
  ActivityTeam,
} from '../activity-types.ts'

export type {
  ActivityMember,
  ActivityMessage,
  ActivityMonitorTarget,
  ActivityPollingController,
  ActivityPollingRuntime,
  ActivitySnapshots,
  ActivitySource,
  ActivityTask,
  ActivityTeam,
} from '../activity-types.ts'

/** A successfully-created conversation card that currently needs updates. */
interface RegisteredTarget extends ActivityMonitorTarget {
  refs: number
  active: boolean
}

const targets = new Map<string, RegisteredTarget>()
const targetListeners = new Set<() => void>()
const snapshotListeners = new Set<() => void>()
let targetSnapshot: readonly ActivityMonitorTarget[] = []
let activitySnapshots: ActivitySnapshots = { teams: [], archivedTeams: [] }

function targetKey(sessionId: string, teamId: string): string {
  return `${sessionId}\u0000${teamId}`
}

function publishTargets(): void {
  targetSnapshot = [...targets.values()]
    .filter((target) => target.active)
    .map(({ key, sessionId, teamId }) => ({ key, sessionId, teamId }))
  for (const listener of targetListeners) listener()
}

/** Subscribe to the active monitor-target list (React external-store shape). */
export function subscribeActivityMonitorTargets(listener: () => void): () => void {
  targetListeners.add(listener)
  return () => { targetListeners.delete(listener) }
}

/** Read the stable active-target snapshot. */
export function getActivityMonitorTargetsSnapshot(): readonly ActivityMonitorTarget[] {
  return targetSnapshot
}

/**
 * Register one successful AgentTeams card as a monitoring demand.
 *
 * ⚠ 索菲亚当前**没有生产者**：注册方是对话内嵌卡片（`AgentTeamsCard`），
 * 而那一整块已按「索菲亚没有对应物」剥离（见 `ActivityPanel.tsx` 的剥除说明）。
 * 保留这套引用计数注册表的原因是它与 ActivityPanel 的 props 通路相连
 * （`monitorTargets` → `startActivityPolling`），删掉会让面板的这份结构多出一条
 * 无解释的减法；将来若出现卡片的等效物（例如会话里的一条「本团活动」入口），
 * 直接调它就能把那条通路接活。
 *
 * The returned cleanup is reference-counted so multiple cards and React
 * StrictMode remounts cannot stop another card's monitor.
 */
export function monitorAgentTeam(sessionId: string, teamId: string): () => void {
  const owner = sessionId.trim()
  const id = teamId.trim()
  if (owner === '' || id === '') return () => {}
  const key = targetKey(owner, id)
  const existing = targets.get(key)
  if (existing === undefined) {
    targets.set(key, { key, sessionId: owner, teamId: id, refs: 1, active: true })
    publishTargets()
  } else {
    existing.refs += 1
    if (!existing.active) {
      existing.active = true
      publishTargets()
    }
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const current = targets.get(key)
    if (current === undefined) return
    current.refs -= 1
    if (current.refs <= 0) {
      targets.delete(key)
      if (current.active) publishTargets()
    }
  }
}

/** Stop polling targets whose final archived snapshot has been captured. */
export function settleActivityMonitorTargets(keys: ReadonlySet<string>): void {
  let changed = false
  for (const key of keys) {
    const target = targets.get(key)
    if (target?.active !== true) continue
    target.active = false
    changed = true
  }
  if (changed) publishTargets()
}

/** Subscribe to the shared live/archive snapshot. */
export function subscribeActivitySnapshots(listener: () => void): () => void {
  snapshotListeners.add(listener)
  return () => { snapshotListeners.delete(listener) }
}

/** Read the stable shared live/archive snapshot. */
export function getActivitySnapshotsSnapshot(): ActivitySnapshots {
  return activitySnapshots
}

/** Publish one or both successful state-route responses. */
export function updateActivitySnapshots(update: Partial<ActivitySnapshots>): void {
  const next = {
    teams: update.teams ?? activitySnapshots.teams,
    archivedTeams: update.archivedTeams ?? activitySnapshots.archivedTeams,
  }
  if (next.teams === activitySnapshots.teams && next.archivedTeams === activitySnapshots.archivedTeams) return
  activitySnapshots = next
  for (const listener of snapshotListeners) listener()
}

/** Poll cadence for the live host snapshot route. */
export const ACTIVITY_POLL_MS = 1000
/**
 * Low-frequency probe cadence while a cardless discovery session still owns
 * no team. The probe keeps the panel able to pick up a team created later in
 * that session (e.g. a run_code-wrapped agent_teams_create) without turning
 * every ordinary session into a one-second filesystem scan.
 */
export const ACTIVITY_PROBE_MS = 5000
/**
 * ⚠ 索菲亚移植点：上游是 `/plugins/dsh-agent-teams/state`（它自己宿主的路由，
 * 索菲亚**没有**这条路由 —— 照抄它只会 404）。
 *
 * 索菲亚的等效物是 `panel-store.ts` 的 `VIEW_ROUTE`（`/api/sophia/view`）。
 * 保留这个导出名是为让「面板的 live 状态来自哪个地址」这件事仍有单一出处；
 * 值本身不是新常量，就是 `VIEW_ROUTE`。
 *
 * 上游还有它的 `?archived=1` 变体，索菲亚**不存在**这个查询参数
 * （一次读取即含全部团），见 `tick` 里的说明。
 */
export const ACTIVITY_STATE_URL: string = VIEW_ROUTE
/**
 * 「停止本团」按钮的路由（`ActivityPanel` 的 `TeamSection.stopTeam` 用它 POST）。
 *
 * ⚠ 上游是 `/plugins/dsh-agent-teams/halt`。地址的唯一真相在 `bridge.ts` 的 `HALT_URL`
 * （那里写清了它的实现状态：宿主半**尚未**实现索菲亚的团队中止路由 ⇒ 现在点击会拿到
 * 非 2xx，并把原因显示在确认弹窗里 —— 如实报错，不是静默失败）。
 */
export const ACTIVITY_HALT_URL: string = HALT_URL

/**
 * 索菲亚线格式视图 → 上游 UI 期望的团队行。
 *
 * 复用 `adapters/activity.ts` 的映射（**不在这里另写一份**）：那份文件是
 * 「wire ⇄ 上游 UI」唯一的接缝，它的注释里逐条写了缺失字段为什么填中性值。
 *
 * 两条来路合成同一份 `teams`：
 * - `view.teams`：账本里已成立的团（`toActivityTeam`）；
 * - `view.pendingPlans` 里 `status === 'awaiting'` 的票：还没成立的**拟建态**团
 *   （`planToActivityTeam`，`phase: 'staged'` ⇒ 面板会渲染计划编辑器）。
 *
 * ⚠ 只取 `awaiting`：`approved` / `rejectedBy*` 是**已落结论的历史票**，
 * 把它们也画成 `staged` 会让界面给已否决的申请再发一遍「批准 / 否决」按钮。
 * 上游没有这一层区分（它的 staged 团队来自宿主自己的暂停态），所以这条判据是
 * 索菲亚加上的，写在渲染入口而不是散在 UI 里。
 */
function teamsOfView(view: WireView): readonly ActivityTeam[] {
  return [
    ...view.teams.map((team) => toActivityTeam(team, undefined)),
    ...view.pendingPlans.filter((plan) => plan.status === 'awaiting').map(planToActivityTeam),
  ]
}

/**
 * Start the single polling loop for the current session's requested targets.
 *
 * ⚠ 索菲亚版的行为（与上游的异同，逐条）：
 * - **同**：两级节拍（`ACTIVITY_PROBE_MS` 探测 → 发现作用域内的第一个团后升级到
 *   `ACTIVITY_POLL_MS`）、`firstTick` 的「第一趟可等待」契约、`stop()` 幂等。
 * - **异**：读的是**本地 store 快照**（不是它自己宿主的 HTTP 路由），
 *   而且**不发归档请求**（索菲亚没有归档半边，见 `tick` 内的注释）。
 * - **惰性**：没有 `source` 时返回空控制器 —— 与上游「既没有卡片目标、也没有发现作用域」
 *   时同样惰性；差别是索菲亚只认 `scope === undefined` 表示「没有作用域」，
 *   空串 `''` 是**合法作用域**（`adapters/activity.ts` 写出的 `captainSessionId` 恒为 `''`，
 *   上游那种「trim 后空串即没有」的判据在索菲亚会把面板变成静默空面板）。
 */
export function startActivityPolling(
  monitorTargets: readonly ActivityMonitorTarget[],
  runtime: ActivityPollingRuntime = {},
): ActivityPollingController {
  const source: ActivitySource | undefined = runtime.source
  const scope = runtime.scope
  if (source === undefined) {
    return { firstTick: Promise.resolve(), stop: () => {} }
  }
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  const publishSnapshots = runtime.publishSnapshots ?? updateActivitySnapshots
  let cancelled = false
  // Explicit card targets are demanded work: start at the live cadence. A
  // scope-only caller starts probing low-frequency and upgrades on detection.
  let hot = monitorTargets.length > 0
  let discoveredLiveKeys = new Set<string>()
  let timer: unknown
  /**
   * 上一次**已经投影过**的 `view` 引用。
   *
   * 为什么必须有它：`teamsOfView` 每次都产出**新数组**，而 `updateActivitySnapshots`
   * 按引用判「变没变」⇒ 没有这一层缓存，每秒的 tick 都会通知订阅者、
   * 让面板以 1Hz 空转重渲染（数据一个字都没变）。
   * `panel-store.ts` 用同一个手法（`view` 引用不变即不写状态，见它的 `emit`）。
   * 作用域在控制器内部（不是模块级）：注入的 `publishSnapshots` 各不相同，
   * 用模块级缓存会让第二个控制器**静默地一次都不发布**。
   */
  let publishedView: WireView | null = null
  const intervalMs = (): number => (hot ? ACTIVITY_POLL_MS : ACTIVITY_PROBE_MS)
  const reschedule = (): void => {
    cancel(timer)
    timer = schedule(() => { tick() }, intervalMs())
  }
  const tick = (): void => {
    if (cancelled) return
    // ⚠ ⚠ 索菲亚移植点：上游这里 `await fetchState(ACTIVITY_STATE_URL, …)`。
    // 索菲亚改成**读本地 store 快照**：
    // - 它不产生 HTTP —— `/api/sophia/view` 的轮询归 `panel.tsx`（`PANEL_POLL_MS`），
    //   本控制器只消费那次读取的结果（单源读取 ⇒ 不会出现「面板与活动面板各说一个真相」）；
    // - 后端没给（`loading`）或给坏了（`error`/`view === null`）时**直接 return**：
    //   保留上一份快照。上游在同名位置留了完全同样的策略
    //   （它的注释原文：「Host restarting; keep the last snapshot and retry on the next tick.」）
    //   —— 把读失败画成「0 个团」会让面板在宿主重启时**静默清空**，看起来像团没了。
    const snapshot = source.getSnapshot()
    if (snapshot.status !== 'ready' || snapshot.view === null) return
    const view = snapshot.view
    if (view === publishedView) return
    publishedView = view
    // ⚠ 只映射**一次**、两条用途共用同一份行：
    // ① 发布给 UI（`publishSnapshots`）；② 判「本作用域内有没有团」（下面的升级判据）。
    // 不能拿 `view.teams`（`WireTeam`）去做 ②：`captainSessionId` 是**UI 侧的**
    // `ActivityTeam` 字段，线格式的团根本没有它（`wire.ts` 的 `WireTeam` 不绑会话）
    // —— 这处初版就写错过，症状是 `TS2339`，而它同时也是个真错误：
    // 就算用 `as` 压过去，运行时读到的也是 `undefined`，升级判据永远不成立。
    const teams = teamsOfView(view)
    publishSnapshots({ teams })
    // ⚠ 索菲亚移植点：上游在这里还有第二段 —— 若显式卡片目标从 live 里消失了，
    // 就发一次 `?archived=1` 取归档快照，并 `settleTargets` 退役那些目标。
    // 那一段在索菲亚**两个前提都不成立**，故整段删除（不是漏抄）：
    //   ① 没有归档路由/参数 —— `/api/sophia/view` 一次读取就把账本里的团全给出来
    //     （墓碑成员在成员级表达，团级没有 live/archive 两分）；
    //   ② 没有卡片目标 —— 注册方是 `AgentTeamsCard`，已剥离 ⇒ `monitorTargets` 恒为空。
    // 因此 `archivedTeams` 始终是 `[]`，界面据此不渲染「已归档」分组
    // （`ActivityPanel` 的 `visibleArchived`），这与「索菲亚没有这个投影」一致。
    // 将来宿主若把归档团单独投影出来：在这里补一次投影（`publishSnapshots({ archivedTeams })`）
    // 即可，UI 那半不用动。
    const liveTeams = teams
    discoveredLiveKeys = new Set(scope === undefined
      ? []
      : liveTeams
        .filter((team) => team.captainSessionId === scope)
        .map((team) => team.teamId))
    // A scope that found its first team upgrades from the low-frequency probe
    // to the live cadence for the rest of the controller lifetime.
    if (!hot && discoveredLiveKeys.size > 0) {
      hot = true
      reschedule()
    }
  }
  // 首帧：先让 store 真读一次，再投影。
  // `{ background: true }` 与父面板的轮询共用在途请求（`panel-store.ts` 的 `load`
  // 会把并发调用**合并**成一次，见它的说明）⇒ 不会多打一条路由，
  // 也不会把界面切成 loading 态（那会让面板闪一下、并重置用户的选择）。
  // `catch` 兜住的是 store 自己都不吞的意外；读取失败由 store 置 `error` 态表达，
  // 这里保留上一份快照（与 tick 同策略）。
  const firstTick: Promise<void> = Promise.resolve()
    .then(() => source.load(undefined, { background: true }))
    .then(() => { tick() })
    .catch(() => {})
  // ⚠ `timer === undefined` 这个守卫在本移植里**恒真**，保留只为与上游同形：
  // 唯一的 `reschedule()` 在 `tick()` 内部（`:300-303`），而首帧 `tick()` 被推到了
  // `Promise.resolve().then(...)` 里（`:311-313`）⇒ 走到这一行时计时器一定还没起过。
  // （上游那份是**同步**跑第一趟，那时守卫确实有作用；这里改成异步，是为了先让 store
  //   真读一次再投影。）
  // 留着的唯一价值：将来谁把首帧改回同步执行时，不会因为两处各起一个计时器而双节拍。
  //   （上一版这里的理由写成「上游同步跑第一趟时就会起过」，方向正好说反了
  //    —— 同步跑第一趟时本行还没执行，第三方复核指出后已改正。）
  if (timer === undefined) timer = schedule(() => { tick() }, intervalMs())
  return {
    firstTick,
    stop: () => {
      if (cancelled) return
      cancelled = true
      cancel(timer)
    },
  }
}
