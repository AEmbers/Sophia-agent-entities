/**
 * 上游 `@wowyuarm/dsh-agent-team/types` 的**索菲亚替身**（类型门面）。
 *
 * ## 这个文件为什么存在
 *
 * 移植进来的上游 UI 文件（`TeamInboxPage.tsx` / `TeamThreadPage.tsx` 及其同目录依赖）
 * 全都 `import type { … } from '@wowyuarm/dsh-agent-team/types'`。索菲亚没有那个包，
 * 而且**也不能有**：`tsdown.config.ts` 的 `sophia-client-bundle-purity` 插件会
 * 在构建期对任何不在 `PLATFORM_MODULES` 里的 `@deepseek-ai/*` 说明符抛错，
 * 而 `@wowyuarm/dsh-agent-team` 更是完全不存在的包。
 *
 * 于是这里提供**同一批名字**的类型声明，让移植文件只需要把 import 来源从
 * `'@wowyuarm/dsh-agent-team/types'` 改成 `'./agent-team-types.ts'`，
 * **一个标识符都不用改**。这是「整份复制、只改 import 路径」得以成立的前提。
 *
 * ## 两条纪律（这个文件里每一个别名都要能归到其中一条）
 *
 * 1. **索菲亚有线格式的** → 直接别名到 `../../wire.ts` 的 `Wire*`。
 *    这样宿主把投影 `JSON.stringify` 出来就能对上，不存在第二个真相。
 * 2. **上游有、索菲亚账本里没有对应事实的** → 在本文件**显式声明**
 *    并逐条注明「索菲亚没有这个事实」，绝不悄悄用别的字段顶上。
 *
 * ⚠ 第二类是本次移植**最危险**的部分：它们的字段名与上游一致，但类型是放宽的
 * （`string` 而不是字面量联合、`| undefined` 而不是必填）。放宽是**刻意的** ——
 * 索菲亚的账本不产出这些值，写死一个字面量联合会让我在界面里**发明**一个
 * 索菲亚没有的状态机。放宽之后，界面必须**显式处理认不出的取值**
 * （见 `team-formatters.ts` 的兜底分支），而不是靠类型系统假装知道。
 *
 * @module @sophia/core/client/vendor/team/agent-team-types
 */

import type {
  WireActivity,
  WireChannel,
  WireMember,
  WireMessage,
  WirePresence,
  WireTask,
  WireThread,
} from '../../../wire.ts'

// ────────────────────────────────────────────────────────────────────────────
// 一、索菲亚线格式的直接别名（第 1 条纪律）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 成员 id。
 *
 * ⚠ **上游是 branded 字符串，索菲亚是裸 `string`，这个落差是承重的。**
 * 上游用 `Branded<'AgentTeamMemberId'>` 让「成员 id」与「频道 ref」在类型上不可互换；
 * 索菲亚的线格式本来就是从 JSON 解析出来的裸字符串（`parseWireView` 逐字段自证），
 * 运行时**没有**任何东西能把一个字符串变成那个 phantom 品牌。
 * 硬造一个 branded 类型只会得到一个「编译期像有品牌、运行期没有」的假象 ——
 * 那比裸 `string` 更糟，因为它会让阅读者以为这里有保护。
 *
 * ⇒ 保留上游**名字**（移植文件改不动），类型落到 `string`。
 * 代价：`threadRef` 与 `channelId` 在类型上可互换。本次移植范围（收件箱 + Thread 两页）
 * 内两者的使用点相隔很远，未观察到混淆；如实记录为已知弱化。
 */
export type AgentTeamMemberId = string

/** 频道 ref。见 `AgentTeamMemberId` 的说明（branded → 裸 string 的真实落差）。 */
export type AgentTeamChannelRef = string

/** 线程 ref。见 `AgentTeamMemberId` 的说明。 */
export type AgentTeamThreadRef = string

/** 任务 ref。见 `AgentTeamMemberId` 的说明。 */
export type AgentTeamTaskRef = string

/**
 * 消息 ref。
 *
 * ⚠ 上游有、索菲亚**线格式里没有**独立的消息 ref：`WireMessage` 的主键是
 * `messageId`（`../../wire.ts`）。这里给出 `WireMessage['messageId']` 的别名而不是
 * 重新声明 `string`：让「消息身份」只有一个定义，将来线格式改名时这里会跟着报错，
 * 而不是静默漂移。
 */
export type AgentTeamMessageRef = WireMessage['messageId']

/** 任务身份。同 `AgentTeamMessageRef`：别名到 `WireTask` 的主键，不另起一个真相。 */
export type AgentTeamTaskId = WireTask['taskId']

/**
 * 频道。
 *
 * ⚠ 字段名与上游**不一致**，这是线格式决定的，不是笔误：
 * - 上游 `channelRef` ←→ 索菲亚 `WireChannel.channelId`
 * - 上游 `name` ←→ 索菲亚 `WireChannel.title`
 * - 上游 `description` / `createdAtSequence` / `state`（`active|archived`）
 *   **索菲亚没有**：索菲亚的频道没有归档态，也没有创建序号。
 *   界面用到它们的位置一律走「没有事实就不显示」的分支（见调用点注释）。
 *
 * 之所以**不**把上游字段名搬到索菲亚类型上（例如造一个 `name` 别名），
 * 是因为那会让同一份数据在类型层有两个名字 —— 正是 `view-model.ts` 文件头
 * 反复警告的「第二个真相」。
 */
export type AgentTeamChannel = WireChannel

/** 线程。上游 `threadRef` ←→ 索菲亚 `WireThread.threadId`；上游 `revision` / `taskRef` 索菲亚没有。 */
export type AgentTeamThread = WireThread

/** 一条消息。上游 `sender` ←→ 索菲亚 `WireMessage.senderMemberId`；见 `AgentTeamChannel` 的说明。 */
export type AgentTeamMessage = WireMessage

/** 一个任务。上游 `taskRef` ←→ 索菲亚 `WireTask.taskId`。 */
export type AgentTeamTask = WireTask

/** 一个团。上游按 Workspace 分片，索菲亚是「一个团 + 它的频道」。 */
export type AgentTeamTeam = {

  readonly teamId: string
  readonly name: string
  readonly kind: 'persistent' | 'temporary'
  readonly members: readonly WireMember[]
  readonly channels: readonly AgentTeamChannel[]
  readonly messages: readonly AgentTeamMessage[]
  readonly tasks: readonly AgentTeamTask[]
  readonly activity: readonly WireActivity[]
}

// ────────────────────────────────────────────────────────────────────────────
// 二、索菲亚账本里**没有**对应事实的上游类型（第 2 条纪律）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 成员在界面上需要的全部状态。
 *
 * ⚠ **上游 `AgentTeamClientMemberStatus` 的主体（`member.state` / `handle` /
 * `description` / `sessionId` / `presence: available|working|error|unavailable` /
 * `diagnostic`）在索菲亚账本里**没有对应事实**。** 索菲亚的 `WireMember`
 * （`../../wire.ts`）只有 `memberId` / `position` / `name` / `displayName` /
 * `lifecycle` / `tombstone` / `model` / `avatarPath?` / `presence?: 'idle'|'running'`。
 *
 * 这里的取舍逐条写清（**不发明数据**）：
 *
 * - `member.handle` —— 索菲亚的成员有 `name` 与 `displayName`（宿主的命名规则，
 *   见 `src/naming.ts`）。`handle` 由适配层拼成 `@<name>`（**显示约定**，
 *   不是硬造一个成员名）。
 * - `member.description` —— 映射到索菲亚的 `position`（职位名）。两者语义相近
 *   （都是「这个成员是干什么的」），且都是宿主给出的事实。
 * - `member.state`（`AgentTeamMemberState`）—— 由索菲亚的 `lifecycle` 映射
 *   （`active`→`active`、`archived`/`destroyed`→`archived`、`suspended`→`inactive`）。
 * - `member.sessionId` —— 索菲亚**没有**把成员会话 id 放进线格式 ⇒
 *   可选且适配层一律给 `undefined`。用到它的界面位置（点成员头像进会话）
 *   在索菲亚没有路由可开，故调用点已剥掉（见 `TeamMemberRow` 的说明）。
 * - `presence` —— 索菲亚有 `WirePresence = 'idle' | 'running'`；上游的四态
 *   （`available|working|error|unavailable`）里 `error` **索菲亚没有**。
 *   适配层映射 `running`→`working`、`idle`→`available`、
 *   `undefined`（运行时没给出）→`unavailable`（**如实显示「未知」而不是猜「在岗」**，
 *   与 `wire.ts` 的 `UNKNOWN_LIFECYCLE` 同一条纪律）。
 * - `diagnostic`（失败诊断：`class` / `remediable` / 被拒产物路径）——
 *   **索菲亚完全没有这一整套**（成员运行期失败不落账本、也不进线格式）。
 *   ⇒ 可选，适配层给 `undefined`；`TeamPresenceDot` 里所有 diagnostic 分支
 *   因此走「没有诊断」的分支，而不是被删掉 —— 保留结构、如实落空。
 */
export type AgentTeamMemberState = 'active' | 'inactive' | 'archived'

/** 上游的成员存在态四态。见 `AgentTeamClientMemberStatus` 的说明（`error` 索菲亚没有）。 */
export type AgentTeamPresence = 'available' | 'working' | 'error' | 'unavailable'

/** 成员诊断类别。索菲亚不产出这些值，故放宽成 `string`；见 `AgentTeamClientMemberStatus`。 */
export type AgentTeamMemberDiagnosticClass = string

/** 一条成员诊断。索菲亚没有任何生产者 ⇒ 全字段可选。 */
export interface AgentTeamMemberDiagnostic {
  readonly class: AgentTeamMemberDiagnosticClass
  readonly detail: string
  readonly location?: { readonly kind: string; readonly path: string } | undefined
  /** 上游是 SessionId（需要 `@deepseek-ai/dsh-session`）；索菲亚线上只有字符串。 */
  readonly sessionId?: string | undefined
  readonly remediable?: boolean | undefined
}

/** 浏览器可用的成员身份。字段名保持上游形状，语义映射见 `AgentTeamClientMemberStatus`。 */
export interface AgentTeamClientMember {
  readonly memberId: AgentTeamMemberId
  /** 上游是公开 handle（`@name` 形式）；适配层按索菲亚命名规则拼出。 */
  readonly handle: string
  /** 上游是自由描述；索菲亚给的是职位名（`WireMember.position`）。 */
  readonly description: string
  readonly state: AgentTeamMemberState
  /** 索菲亚线格式不含成员会话 id ⇒ 适配层给 `undefined`。 */
  readonly sessionId?: string | undefined
  /** 头像的仓库相对路径（索菲亚 `WireMember.avatarPath`，见 `src/avatar-paths.ts`）。 */
  readonly avatarPath?: string | undefined
}

/** 成员状态。见 `AgentTeamClientMemberStatus` 的说明。 */
export interface AgentTeamClientMemberStatus {
  readonly member: AgentTeamClientMember
  readonly presence: AgentTeamPresence
  readonly diagnostic?: AgentTeamMemberDiagnostic | undefined
  /**
   * 索菲亚对上游形状的**加字段**（上游没有该字段，见本文件头的取舍表）：
   * 该成员的**真实 WireMember**（`src/view-model.ts`），仅当
   * `canSwitchModel(member)` 为真（非墓碑且有明确模型目标）时带出。
   * 左栏 Agents 行菜单的「换模」用它把 `memberId` 交回宿主路由；
   * 墓碑 / 跟随全局默认的成员**不带** ⇒ 那些行不画换模入口（不展示做不到的操作）。
   */
  readonly sophiaMember?: WireMember | undefined
}

/**
 * 收件箱一行的「谁」。
 *
 * 上游是 `AgentTeamInboxActor`（三态：成员 / 人类 / 未知）。索菲亚的账本里
 * **没有人类 actor 这一维**（主人不是成员，见 `AGENTS.md` 的「唯一主人」模型），
 * 故这里只有成员一种形态，`name` 由适配层从团长表里解析。
 */
export interface AgentTeamInboxActor {
  readonly memberId: AgentTeamMemberId
  /** 公开 handle（`@name`），或成员不在团长里时的成员 id 原件。 */
  readonly name: string
}

/**
 * 收件箱一行。
 *
 * ⚠ **这一整块索菲亚账本里都没有**，逐条如实说明：
 *
 * | 字段 | 索菲亚的事实 |
 * |---|---|
 * | `unreadCount` | **没有**已读水位（`ledger` 不记「谁读到哪」）⇒ 恒 `0` |
 * | `directCount` | **没有**结构化 @提到（`WireMessage` 只有 `body` 文本）⇒ 恒 `0` |
 * | `previewText` | 有——从消息正文首行派生（纯函数，不是新事实） |
 * | `newestSequence` | **没有**序号——索菲亚的 `WireMessage` 无该字段；适配层给的是**该线程的消息条数**，只用作「时间相同时的并列打破」，**不是水位**（见 `adapters.ts` 的 `toInboxItem`） |
 * | `newestOccurredAt` | 有——`WireMessage.occurredAt`（epoch ms → ISO 串） |
 * | `newestActor` | 有——最新一条消息的 `senderMemberId` |
 * | `claimOwners` | **没有** claim 模型 ⇒ 空数组 |
 * | `attention` | **没有** attention 模型 ⇒ `undefined` |
 * | `task` / `taskNumber` | `task` 有（`WireTask`）；`taskNumber` 索菲亚**没有**序号 ⇒ `undefined` |
 *
 * ⇒ 因为 `unreadCount` 恒 0、`directCount` 恒 0，收件箱的「需要我」队列在索菲亚
 * **结构上恒为空**，「最近活跃」那一段才是真实有内容的那一段。
 * 这是**如实降级**，不是缺陷掩盖；要让它有内容，需要宿主补一条已读水位事实。
 */
export interface AgentTeamInboxItem {
  readonly channelRef: AgentTeamChannelRef
  readonly channelName?: string | undefined
  readonly task?: AgentTeamTask | undefined
  /** 索菲亚没有任务序号 ⇒ 适配层给 `undefined`。 */
  readonly taskNumber?: number | undefined
  readonly thread: AgentTeamThread
  /** 见本接口说明：索菲亚没有已读水位 ⇒ 恒 `0`。 */
  readonly unreadCount: number
  /** 见本接口说明：索菲亚没有结构化 @提到 ⇒ 恒 `0`。 */
  readonly directCount: number
  readonly previewText?: string | undefined
  readonly newestSequence: number
  readonly newestOccurredAt: string
  readonly newestActor: AgentTeamInboxActor
  /** 见本接口说明：索菲亚没有 claim 模型 ⇒ 恒空数组。 */
  readonly claimOwners: readonly AgentTeamInboxActor[]
}

/** 收件箱载荷。`recent` = 「最近活跃」那一段（索菲亚唯一有内容的那一段）。 */
export interface AgentTeamInbox {
  readonly items: readonly AgentTeamInboxItem[]
  readonly recent: readonly AgentTeamInboxItem[]
  readonly totalUnreadCount: number
  readonly totalDirectCount: number
}

/**
 * Thread 页的一条时间线事实。
 *
 * ⚠ 上游是**判别联合**（`message` + `activity` 两种 kind）。索菲亚的线格式里
 * **没有「活动」这一类可折叠事实**：`WireActivity` 只有
 * `activityId` / `actorMemberId` / `summary` / `occurredAt`，且**不属于任何线程**
 * （没有 `threadId`）。把上游那种带 `claimRef` / `completedClaimRefs`
 * 的结构化活动硬映射到 `WireActivity` 上就是发明事实。
 *
 * ⇒ 本类型**只保留 `message` 一种 kind**，`activity` 分支整条剥掉
 * （理由见 `TeamThreadPage.tsx` 的移植点注释）。所有 `fact.kind === 'activity'`
 * 的分支因此变成**类型上不可达**，编译器会替我盯住每一处 ——
 * 这正是「剥掉」应当留下的痕迹：不是静默少画一条，而是编译期就少一种可能。
 */
export interface AgentTeamThreadMessageFact {
  readonly kind: 'message'
  readonly sequence: number
  readonly message: AgentTeamMessage
  /** 结构化 @提到。索菲亚没有 ⇒ 适配层恒给空数组。 */
  readonly mentions: readonly AgentTeamMemberId[]
  readonly occurredAt: string
}

/** Thread 页看到的一条事实。 */
export type AgentTeamThreadFact = AgentTeamThreadMessageFact

/** 一条事实 + 它在这批读取里的已读/提到标记。索菲亚恒 `false`（没有水位）。 */
export interface AgentTeamThreadReadFact {
  readonly fact: AgentTeamThreadFact
  readonly unread: boolean
  readonly direct: boolean
}

/**
 * Thread 历史载荷。
 *
 * ⚠ `anchor`（锚点消息）、`anchorMentions`、`claims`、`cursor`、`hasMore`
 * 在索菲亚里分别对应：无锚点概念（索菲亚一次读整条线程的投影）/
 * 无结构化提到 / 无 claim / `cursor` 可有（消息序号）/ `hasMore` 恒 `false`
 * （索菲亚的线格式一次性给出全量消息，没有分页）。
 */
export interface AgentTeamThreadHistory {
  readonly task?: AgentTeamTask | undefined
  readonly thread: AgentTeamThread
  readonly anchor?: AgentTeamMessage | undefined
  readonly anchorMentions: readonly AgentTeamMemberId[]
  readonly claims: readonly AgentTeamClaim[]
  readonly facts: readonly AgentTeamThreadFact[]
  readonly cursor: number
  readonly hasMore: boolean
}

/**
 * 一条 claim（认领）。
 *
 * ⚠ **索菲亚整个 claim 模型都不存在**（那是上游的「谁在做这个任务」事实）。
 * 索菲亚对应的是 `WireTask.assigneeMemberId`（一个任务一个负责成员），
 * 语义**弱于** claim（没有方向、没有 active/done/released 生命周期、没有多所有者）。
 *
 * ⇒ 声明为空数组型：适配层**不**把 assignee 伪装成一条 claim
 * （那会凭空发明一个 `state` 与 `direction`），而是让所有 claim 相关界面
 * 走空分支。这样「索菲亚没有认领模型」在界面上是**可见的**（不画），
 * 而不是画出一条看着像真的的假 claim。
 */
export interface AgentTeamClaim {
  readonly claimRef: string
  readonly taskRef: AgentTeamTaskRef
  readonly threadRef: AgentTeamThreadRef
  readonly owner: AgentTeamMemberId
  readonly direction: string
  readonly normalizedDirection: string
  readonly state: 'active' | 'done' | 'released'
}

/**
 * 上游的结构化活动。**索菲亚不产出**：`WireActivity` 是自由文本 `summary`，
 * 没有任何 kind / claimRef 结构（见 `AgentTeamThreadFact` 的说明）。
 *
 * 之所以仍声明一个最小形状而不是 `never`：`formatActivity` 这个纯函数的**签名**
 * 需要它。函数体已被剥成「索菲亚只用 summary」，故这里只留 `actor`（`WireActivity`
 * 真有这个字段）与一个放宽的 `kind`。**保留名字、剥掉语义**。
 */
export interface AgentTeamActivity {
  readonly activityRef: string
  readonly actor: AgentTeamMemberId
  readonly sequence: number
  /** 上游是闭集字面量；索菲亚没有结构化活动 ⇒ 放宽，调用点必须兜底。 */
  readonly kind: string
}

/**
 * 成员存在态的渲染取值（上游 `TeamStateDot` 的输入）。
 *
 * ⚠ `StateDotState` 来自宿主 `ui-primitives`（索菲亚没有它的类型），
 * 故这里把上游那套四色语义**显式列出**。索菲亚的 `.sp-avatar` 状态点用的是
 * **同一组取值**（见 `components.tsx` 的 `data-sophia-visual`），
 * 因此这个联合是两套体系之间**真实**的交集，不是我猜的形状。
 */
export type TeamStateDotState = 'todo' | 'ongoing' | 'warning' | 'done' | 'error' | 'quiet'

/** 上游的 `presence → 点状态` 结果类型。 */
export type AgentTeamPresenceDotState = TeamStateDotState

/**
 * Thread 的「谁在跟」观察（attention）。
 *
 * ⚠ **索菲亚没有 attention 模型** —— 账本里没有「某成员从第 N 条开始跟这个线程」
 * 这类事实（上游有 `AgentTeamThreadAttention`，含 `startSequence` /
 * `readThroughSequence`）。⇒ `items` 恒空数组。
 *
 * `followers` 在索菲亚由**派生**得出（该线程消息的发送者集合，见 `adapters.ts`
 * 的 `toThreadObservations`），用于「composer 里把谁排前面」这种**排序提示**。
 * 它不是账本事实 ⇒ 任何把 `followers` 当授权/权限判据的用法在索菲亚都**不成立**。
 * 本目录内唯一的消费点是 `TeamThreadPage` 的 follower 排序（上游 846 行），
 * 不存在授权用法。
 */
export interface AgentTeamThreadObservations {
  readonly items: readonly unknown[]
  readonly followers: readonly AgentTeamMemberId[]
}

/**
 * Task ref 解析请求。
 *
 * ⚠ **索菲亚没有这条宿主路由** —— `host.ts` 注册的 9 条路由里没有任何
 * ref 解析端点（见 `task-refs.ts` 的详细说明）。本类型的两个成员因此是
 * 「上游形状的保留」，索菲亚侧不会有人真的发这个请求。
 * 保留的理由：`task-refs.ts` 的函数签名要它们，删掉签名就会与上游分叉，
 * 而那几个函数**已经**被收成空结果（`return []`），不存在「假实现」风险。
 */
export interface AgentTeamResolveTaskRefsRequest {
  /** 上游按 Workspace 分片；索菲亚没有这一维，故可选且恒 `undefined`。 */
  readonly workspaceId?: string | undefined
  readonly taskRefs: readonly AgentTeamTaskRef[]
}

/** Task ref 解析结果。见 `AgentTeamResolveTaskRefsRequest`：索菲亚不产出它。 */
export interface AgentTeamResolveTaskRefsResult {
  readonly resolved: readonly {
    readonly taskRef: AgentTeamTaskRef
    readonly channelRef: AgentTeamChannelRef
    readonly threadRef: AgentTeamThreadRef
    readonly taskNumber: number
  }[]
}

/**
 * Thread ref 解析请求（上游形状的一对一映射）。
 *
 * ⚠ 与 `AgentTeamResolveTaskRefsRequest` 同一条事实：索菲亚宿主**没有**
 * ref 解析路由（`src/host.ts` 的 `ROUTE_PREFIX` 注册清单里没有 resolve 端点），
 * `refs.ts` 的 `hostThreadRefLookup` / `jumpToThread` 因此收成 no-op。
 * 声明形状是为了让上游 `refs.ts` 的签名（它同时服务 Task 与 Thread 两种 ref）
 * **能整份移植**，而不是把 Thread 那一半删掉。
 */
export interface AgentTeamResolveThreadRefsRequest {
  /** 上游按 Workspace 分片；索菲亚没有这一维，故可选且恒 `undefined`。 */
  readonly workspaceId?: string | undefined
  readonly threadRefs: readonly AgentTeamThreadRef[]
}

/** Thread ref 解析结果。见 `AgentTeamResolveThreadRefsRequest`：索菲亚不产出它。 */
export interface AgentTeamResolveThreadRefsResult {
  readonly resolved: readonly {
    readonly threadRef: AgentTeamThreadRef
    readonly channelRef: AgentTeamChannelRef
    readonly taskRef?: AgentTeamTaskRef | undefined
    readonly taskNumber?: number | undefined
    readonly title: string
  }[]
}

/**
 * 消息附件（上游形状）。
 *
 * ⚠ 索菲亚的线格式 `WireMessage`（`../../wire.ts`）**只有 `body`**，
 * 没有附件字段，`src/host.ts` 也没有 `putAttachment` / `getAttachment` 路由
 * ⇒ 适配层**恒不产出**附件 ⇒ `TeamMessage` 的附件 strip 永不渲染
 * （见那个文件的「附件」段）。
 *
 * 声明它是为了让上游那整套附件渲染（缩略图 / 大图 `Modal` / 过期 chip）
 * **整份移植**：宿主补上附件面后接线即可用，不用回上游再抄一遍。
 */
export interface AgentTeamMessageAttachment {
  readonly attachmentId: string
  readonly name: string
  readonly mediaType: string
  readonly byteSize: number
}

/** 索菲亚的 `WirePresence` 以别名转出：适配层要按它分支。 */
export type { WirePresence }
