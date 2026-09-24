/**
 * 上游 AgentTeams 活动模型 —— **只保留类型**。
 *
 * 来源：`dsh-agent-teams/src/client/activity-monitor.ts`（本仓 git subtree 收录的上游仓库）。
 * 裁剪理由：上游那份文件同时含运行时（轮询/订阅 + `/plugins/dsh-agent-teams/state`
 * 路由常量），那些都依赖上游 host 半；我们只借用它的**数据形状**，运行时由索菲亚自己的
 * wire（`GET /api/sophia/view`）提供，映射写在 `src/client/adapters/`。
 *
 * ⚠ 索菲亚加了两个字段/两处改名（都是「数据源换成索菲亚的」与「头像换成索菲亚的」
 * 这两类改动的必要落点，逐条标注在下面各自的说明里）：
 * - `ActivityMember.avatarPath`（新增）
 * - `ActivityPollingRuntime.source`（替代上游的 `fetchState`）
 * - `ActivityPollingRuntime.scope`（上游叫 `discoverySessionId`）
 */
import type { PanelSnapshot } from '../panel-store.ts'

export interface ActivityMember {
  readonly id: string
  readonly name: string
  readonly role: string
  /**
   * 头像在**仓库根**下的相对路径（如
   * `assets/members/out-512/03_第三梯队_架构与研发组/历算主事.png`）。
   *
   * ⚠ **索菲亚新增字段**，上游没有它：上游的成员头像靠 `artwork.ts` 的正则表
   * （name+role → 打包的鲸鱼图）算出来，因此它的成员行不需要「路径」这个概念。
   * 索菲亚的路径是**宿主事实**（`src/wire.ts:90-99`：客户端不自己拼路径），
   * 所以它必须从 `WireMember.avatarPath` 一路透传到渲染点。
   *
   * 可选，且缺失是**正常情形**而非错误：待批计划（`planToActivityTeam`）里的
   * 成员**尚未创建**，线格式的名册条目没有这个字段 ⇒ 界面走首字降级
   * （`ActivityPanel` 的 `memberInitial` 分支），这与上游「认不出的角色走首字」
   * 是同一条降级路径。也不给 `null`：线格式用「键缺失」表达没有（`wire.ts:99` 的
   * `?: string | undefined`），这里保持同一种表达。
   */
  readonly avatarPath?: string | undefined
  readonly provider?: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly executionPrompt?: string
  readonly status?: 'idle' | 'working' | 'removed'
  readonly activity: 'working' | 'idle' | 'unknown'
  readonly progress: number
  readonly done: number
  readonly total: number
  readonly currentTask: string
  readonly unread: number
}
export interface ActivityTask {
  readonly id: string
  readonly subject: string
  readonly description?: string
  readonly status: string
  readonly state: 'blocked' | 'open' | 'running' | 'completed' | 'failed' | 'cancelled'
  readonly assignee: string
  readonly model?: string
  readonly dependencies: readonly string[]
  readonly depth: number
  readonly kind?: string
  readonly round?: number
  readonly verdict?: string
}
export interface ActivityMessage {
  readonly from: string
  readonly content: string
}
export interface ActivityTeam {
  readonly workspace: string
  readonly teamId: string
  readonly name: string
  readonly description?: string
  readonly captainSessionId: string
  readonly phase: 'staged' | 'running'
  readonly planReviewState?: 'awaiting_review' | 'awaiting_feedback'
  readonly halted?: boolean
  readonly members: readonly ActivityMember[]
  readonly tasks: readonly ActivityTask[]
  readonly messageCount: number
  readonly captainInbox: readonly ActivityMessage[]
}
export interface ActivityMonitorTarget {
  readonly key: string
  readonly sessionId: string
  readonly teamId: string
}
export interface ActivitySnapshots {
  readonly teams: readonly ActivityTeam[]
  readonly archivedTeams: readonly ActivityTeam[]
}

/**
 * 面板的数据源（**索菲亚新增**，替代上游的 `fetchState`）。
 *
 * 上游的 runtime 注入的是一个 `fetch` 形状的东西，因为它要按 URL 去问
 * **它自己宿主**的路由（`/plugins/dsh-agent-teams/state`）。索菲亚没有那条路由，
 * 数据在 `PanelStore` 里（`src/client/panel-store.ts`：`subscribe` / `getSnapshot` / `load`），
 * ⇒ 这里注入的是那个 store 的**结构面**。
 *
 * 为什么写成结构接口而不是 `import { PanelStore }`：`PanelStore` 有 `private` 字段
 * （`panel-store.ts:82-96`），TS 的私有字段让它成为**名义类型** —— 只有真的
 * `new PanelStore()` 才满足，测试或别的消费者连一个轻量替身都塞不进来。
 * 结构面同时让「这个面板到底需要 store 的哪三个方法」写在类型上。
 *
 * ⚠ `load` 的两个参数与 `PanelStore.load` 逐字同形（含 `background` 的语义：
 * `true` = 后台轮询，**不切** loading 态，见 `panel-store.ts:224-236`）。
 */
export interface ActivitySource {
  readonly subscribe: (listener: () => void) => () => void
  readonly getSnapshot: () => PanelSnapshot
  readonly load: (
    fetcher?: typeof fetch,
    options?: { readonly force?: boolean; readonly background?: boolean },
  ) => Promise<void>
}

/** 轮询请求的最小响应面（上游同名的**非 export** interface，裁剪时一并带过来）。 */
interface ActivityFetchResponse {
  readonly ok: boolean
  json(): Promise<unknown>
}

export interface ActivityPollingRuntime {
  /**
   * 面板的**当前作用域**。
   *
   * ⚠ **索菲亚改名**（上游叫 `discoverySessionId`）：上游用它表达「当前 captain
   * 会话」，并在冷启动时用它做一趟「发现该会话拥有的团」的补救读取。
   * 索菲亚的团**不绑会话**（`adapters/activity.ts:108-114` 写明这是本项目与上游的
   * 根本分歧，线格式里也没有会话维度）⇒ 这个值在索菲亚就是「本账本视图」这一个
   * 作用域，名字跟着改成不含会话含义的 `scope`。
   *
   * `undefined` = **没有作用域**（上游语义：还没有选中会话 ⇒ 什么都不显示、也不轮询）。
   * `''` 是**合法值**（`adapters/activity.ts` 写出的 `captainSessionId` 恒为 `''`），
   * 这一点与上游不同：上游用 `trim()` 后的空串表示「没有」，索菲亚只认 `undefined`
   * —— 否则面板拿到 `''` 会直接变成惰性的，什么都不显示（那是静默失效）。
   */
  readonly scope?: string | undefined
  /**
   * 数据源（见 `ActivitySource`）。
   *
   * 缺省 = 没有数据源 ⇒ 控制器是**惰性**的（`startActivityPolling` 直接返回空控制器）：
   * 面板显示空态，而不是拿一份假快照糊上去。
   */
  readonly source?: ActivitySource | undefined
  /**
   * 上游遗留的注入点（`fetch` 形状的数据读取）。
   *
   * ⚠ 索菲亚的运行时**不再使用它**（它要的是 `source`），保留声明的原因只有一个：
   * 上游这份接口在 `vendor/` 里是公开面，删掉它会让「本文件与上游的差异」
   * 多出一条无解释的减法；留着则所有差异都能在注释里逐条对上。
   * 它**不是**一条可用的旁路 —— 索菲亚没有 `/plugins/dsh-agent-teams/state` 路由，
   * 照它注入的 fetch 只会 404。
   */
  readonly fetchState?: (
    url: string,
    init: { readonly cache: 'no-store'; readonly signal: AbortSignal },
  ) => Promise<ActivityFetchResponse>
  readonly schedule?: (callback: () => void, intervalMs: number) => unknown
  readonly cancel?: (timer: unknown) => void
  readonly publishSnapshots?: (update: Partial<ActivitySnapshots>) => void
  readonly settleTargets?: (keys: ReadonlySet<string>) => void
}
export interface ActivityPollingController {
  /** The immediate first pass, exposed so offline verification can await it. */
  readonly firstTick: Promise<void>
  /** Idempotently stop the timer and abort the current request. */
  stop(): void
}
