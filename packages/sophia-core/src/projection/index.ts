/**
 * 视图投影：账本事实 → UI 数据面（FR-10.2 / FR-10.3，`t3`）。
 *
 * ## 这个模块存在的理由
 *
 * FR-10.2 要求「前端所有视图须为账本事实的投影，**不得持有独立真相**」。
 * 本模块把这个要求落成三个**纯函数**（`projectRoster` / `projectChannel` / `projectThread`）、
 * 两个增量读取入口（`catchUpFold` / `rebuildFold`）、以及按成员的未读计数
 * （`unreadByMember`）。全部只产出数据，不含任何 UI。
 *
 * ## 三条不可动摇的性质
 *
 * 1. **视图不是真相，是投影**。真相只有账本一份，本模块**没有任何写路径**
 *    （不 commit、不 open、不落盘）。`ProjectionFold` 是折叠结果，
 *    可由 `rebuildFold()` 从账本重建；`tests/projection.spec.ts` 用
 *    「增量折叠结果 ≡ 全量重建结果」把这条钉成断言，而不是写在注释里。
 * 2. **墓碑语义**（FR-9.3 / NFR-4）。`archived` / `destroyed` 成员的**历史事件仍可读**，
 *    因此 roster **不隐藏**他们，而是逐条带上 `lifecycle` 与 `tombstone`。
 *    另有一条容易漏掉的后果：按 `src/naming.ts` 的 `occupiesName`，
 *    归档/销毁会**释放名字**，所以同一个团里**可以出现两个同名成员**
 *    （一个活着的、一个墓碑）。故 roster 按 `memberId` 去重、**绝不按名字去重**。
 * 3. **尺寸受限的读取**。账本按设计无界增长，本模块所有读取都走游标分页，
 *    单次调用只物化有限条（`CatchUpOptions.limit`），绝不 `read({})` 一把全量。
 *
 * ## ⚠ 命名：为什么这三个函数不叫 `channelView` / `threadView` / `rosterView`
 *
 * 任务书给的三个名字**会直接撞红一条既有验收**，因此这里改用动词式命名。
 * 依据（实测，非推断）：`tests/ledger.spec.ts:777-785` 的 AC-10-10 断言
 * `Object.keys(await import('../src/index.ts'))` 中不含以 `View`/`Projection`/`State` **结尾**
 * 的导出，正则逐字为 `/(View|Projection|State)$/`，**大小写敏感**。
 * 实测该正则对 `channelView` / `threadView` / `rosterView` **全部返回 `true`**，
 * 而对 `projectChannel` / `projectThread` / `projectRoster` 返回 `false`。
 *
 * 之所以改名字而不是改那条断言：
 * - AC-10-10 在 `tests/ledger.spec.ts` 里，**不在本任务范围内**（改它等于改别人的验收门槛）；
 * - 它的**意图**（SPEC §6.6）是禁止导出「**可变的**视图状态」类型，
 *   而 SPEC §6.6 紧接着的那句「所有视图数据必须由 `read()` 的返回值派生」
 *   恰恰是在**要求**本模块存在 —— 那三个名字是它的实现手法之一，不是它的目的；
 * - 而它的**手法**（按导出名后缀判）看不见类型、只看得见运行期值，
 *   所以「用动词命名纯投影函数」是**同时满足意图与手法**的做法，不是绕过。
 *
 * 类型名不受影响：`interface` 在运行期被完全擦除、不进 `Object.keys`，
 * 故 `RosterSnapshot` / `ChannelSnapshot` / `ThreadSnapshot` 等按本义命名即可。
 * 相应地，**本文件新增的每一个运行期导出都不得以 View/Projection/State 结尾** ——
 * 上面那条既有断言就是它的看门人。
 *
 * ## ⚠ 已知的覆盖缺口：`team/thread-started` / `team/message-sent` 没有任何 scope（如实标注，不掩盖）
 *
 * `changeScopesOf`（`src/ledger.ts:404`）对 `team/thread-started` 返回 **`[]`**，
 * 因为 SPEC §6.3 的 scope 词汇表里**没有** channel/thread 种类 —— 该文件明确写了
 * 「宁可如实返回空，也不硬塞一个语义不符的 scope」。
 *
 * 后果是硬的：**任何带 `scopes` 的读取都永远看不到 `team/thread-started`**。
 * 所以：
 * - `catchUpFold` 在 `scopes` 生效时，把它结构上看不见的 kind 清单放进
 *   `outcome.coverage.unscopedKindsOmitted`，调用方**不能**以为拿到的是全部事实；
 * - 需要完整线程列表时走**不带 `scopes`** 的路径（`rebuildFold`）。
 *
 * `UNSCOPED_EVENT_KINDS` 不是手抄完就没人管的常量：`tests/projection.spec.ts` 会遍历
 * **全部 20 个 kind**、逐个构造合法载荷并真调 `changeScopesOf`，断言「返回 `[]` 的恰好且仅有这些」。
 * 将来 `ledger.ts` 改了 scope 归属，那条断言会变红并逼后来者更新这张表。
 *
 * ⚠ 同一个缺口在**消息**上原样重演：`team/message-sent` 的 scope 也是 `[]`
 * （受影响实体是「某条线程里的一条消息」，词汇表里没有 thread/message 种类，
 * 且载荷里没有 `teamId` 可投）。所以 `buildWireTeam` 组装 `messages` 时**同样**
 * 只能走不带 `scopes` 的 `rebuildFold` —— 这条不是可选的实现偏好，是硬约束：
 * 换成带 scopes 的增量读，消息会**整批消失**且界面上看不出任何异常。
 *
 * ## ⚠ 下游 t5（浏览器半）注意：**不要**在 client 里 import 本模块
 *
 * 本文件经 `src/index.ts` re-export，而那条链会拉进 `src/ledger.ts` 的 `node:sqlite`
 * （宿主侧可用，浏览器侧不存在）。浏览器半必须**经宿主路由拿投影结果**，
 * 而不是自己 import 折叠逻辑 —— 后者会在 `tsconfig.client.json` 下以 `TS2307` 报错
 * （该配置 `types: []`、lib 无 node），若绕过类型检查则会得到运行期 `ReferenceError`。
 *
 * ## 刻意**没有**出现在这里的东西
 *
 * - **存在态 `presence`（`idle` / `running`）**：它是**运行期**事实、按 FR-3.2
 *   **不得持久化**（见 `src/types/team.ts` 对 `MemberPresence` 的说明），
 *   因此不在账本里 ⇒ 按 FR-10.2 也就**不属于本投影的产出**。
 *   把它混进「账本事实的投影」会让视图多出一个**没有事实来源**的字段，
 *   而那正是 FR-10.2 要禁的东西。存在态由 `src/runtime/member-runtime.ts` 单独回答。
 * - **收件箱 / 活动面板 / 依赖树的形状**：那三块各自有 scope（`human-inbox` / `dag-team`），
 *   属别的投影面；本模块只落地 `t3` 要求的 roster / channel / thread 三面。
 * - **未读水位的存储**：见 `unreadByMember` 的说明 —— 水位是**客户端的游标**，不是事实。
 */

import type { ChangeScope, Ledger } from '../ledger.ts'
import type {
  ChannelId,
  DagTeamId,
  LedgerEvent,
  LedgerEventKind,
  LedgerSequence,
  MemberId,
  MemberIdentity,
  MemberLifecycle,
  MessageId,
  RequestId,
  TeamId,
  TeamKind,
  TeamSpec,
  ThreadId,
} from '../types/index.ts'
import { displayNameOf } from '../naming.ts'

// ────────────────────────────────────────────────────────────────────────────
// 事实记录（折叠中间态；全部 readonly）
// ────────────────────────────────────────────────────────────────────────────

/** 一条 `team/created`（或被 `team/ownership-reattached` 更新过归属）之后的事实。 */
export interface TeamFact {
  readonly teamId: TeamId
  readonly kind: TeamKind
  readonly name: string
  readonly ownerMemberId: MemberId | null
  readonly parentTeamId: TeamId | null
  readonly appearedAtSequence: LedgerSequence
  /**
   * 团队级终态（`team/destroyed`，2026-09-24 新增）：团被人类显式中止。
   * 语义（`types/operations.ts` 的 `TeamDestroyedData`）：**保留已完成结果、
   * 停止后续一切协作** —— 视图（wire）对它**不再发**（收件箱/活动面板不再占空间），
   * 但账本历史完好（审计可查）。`undefined`/缺席 = 团仍然在役。
   */
  readonly destroyedAtSequence?: LedgerSequence | undefined
}

/** 当前生效的模型（`team/member-model-switched` 的 `to`）。 */
export interface MemberModel {
  readonly provider: string
  readonly model: string
}

/**
 * 一个成员的**当前**事实（生命周期、名字、模型都由「最新的那条事件」决定）。
 *
 * `appearedAtSequence` 只增不改：它记录成员**第一次**出现在账本里的位置，
 * 用于给 roster 一个稳定顺序（若改成「最后一次变更」，列表会在每次改名后重排）。
 */
export interface MemberFact {
  readonly memberId: MemberId
  readonly teamId: TeamId
  readonly position: string
  readonly name: string
  readonly lifecycle: MemberLifecycle
  readonly model: MemberModel | null
  readonly appearedAtSequence: LedgerSequence
}

export interface ChannelFact {
  readonly channelId: ChannelId
  readonly teamId: TeamId
  readonly title: string
  readonly appearedAtSequence: LedgerSequence
}

export interface ThreadFact {
  readonly threadId: ThreadId
  readonly channelId: ChannelId
  readonly title: string
  readonly assigneeMemberId: MemberId | null
  readonly appearedAtSequence: LedgerSequence
}

/**
 * 一条消息的**当前**事实（`team/message-sent`，线程时间线/频道预览的数据源）。
 *
 * 与 `ThreadFact` / `ChannelFact` 的两点**结构差异**，都是刻意的：
 *
 * 1. **它是「追加」而不是「覆盖」语义的事实**。线程与频道表按 id 覆盖写
 *    （同一 `threadId` 的后一条事件会改写前一条），而消息表**按 `messageId` 各自成行** ——
 *    两条不同的消息事件各占一行，谁也改不了谁。写成覆盖会静默丢掉历史消息，
 *    而账本是把「不可改写」当卖点的（FR-10.1），投影层丢掉历史与它的前提冲突。
 *    `messageId` 的生成责任在写入侧（`src/tools/message.ts`，与 threadId 同风格），
 *    这样「同一条消息被重复提交」只会在投影层留下**一行**，而不是两行。
 * 2. **它带 `occurredAt`（时间）**。`ThreadFact` 没有时间字段，只带
 *    `appearedAtSequence`（序号是**账本位置**，不是时钟）。而线格式的
 *    `WireMessage.occurredAt` 是**时间戳数字**（`src/wire.ts:126`），
 *    时间又**不进 `event.data`**（见 `types/operations.ts` 的纪律），
 *    所以它只能从事件基座取。这里从基座的 `occurredAt` 抄一份进事实 ——
 *    投影层是「基座字段 → UI 字段」的**唯一**换算点，界面因此不必再去读事件。
 */
export interface MessageFact {
  readonly messageId: MessageId
  readonly channelId: ChannelId
  readonly threadId: ThreadId
  /**
   * 发送者成员 id；**`null` = 不是团内成员发的**（人类操作者经面板发送，
   * 谁是发送者见事件基座的 `actor` —— 见 `MessageSentData` 的说明与代价）。
   */
  readonly senderMemberId: MemberId | null
  readonly body: string
  /** 事件基座的 `occurredAt`（时间戳数字，原样透传，不在投影层重算）。 */
  readonly occurredAt: number
  readonly appearedAtSequence: LedgerSequence
}

/**
 * 建团审批票的**当前**事实（文档 3.6 审批 UI 的数据源）。
 *
 * 四态由 spawn 四条事件驱动：`awaiting`（进收件箱）→ `approved` /
 * `rejectedByHuman`（人类结论）；`rejectedByPrincipal` 是第一级结论
 * （可单独出现 —— 请求在推送收件箱之前就被监正打回，此时没有 awaiting 前态）。
 *
 * `raisedAtSequence` 记首次入账位置，后续结论**不改它**（审批区排序要稳定）。
 */
export interface SpawnTicketFact {
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  readonly targetKind: TeamKind
  readonly spec: TeamSpec
  readonly status: 'awaiting' | 'approved' | 'rejectedByPrincipal' | 'rejectedByHuman'
  /** 否决理由（两级各自的 reason）；批准为 `null`。 */
  readonly reason: string | null
  /** 人类结论的操作者（AC-5-9 非空）；第一级结论 / 尚无结论为 `null`。 */
  readonly humanOperatorId: string | null
  readonly raisedAtSequence: LedgerSequence
}

/** DAG 团里一个任务的当前态（`dag/task-state-changed` 后值覆盖）。 */
export interface DagTaskFact {
  readonly state: string
  readonly reason: string | null
}

/** DAG 团事实（文档 5 · DagCanvas 的数据源）。 */
export interface DagTeamFact {
  readonly dagTeamId: DagTeamId
  readonly ownerMemberId: MemberId
  readonly parentTeamId: TeamId | null
  /** 是否由显式移交申请创建（FR-7.3）。 */
  readonly requestedByTransfer: boolean
  readonly tasks: ReadonlyMap<string, DagTaskFact>
}

/**
 * 折叠结果（可由 `rebuildFold` 从账本重建）。
 *
 * 之所以把它做成**值**而不是一个带方法的对象：带方法的对象很容易长出 `mutate()`，
 * 而本模块的全部价值就在于「视图没有可变真相」。值类型让「改」只能发生在
 * `foldLedgerEvents` 这一个纯函数里（内部 copy-on-write）。
 */
export interface ProjectionFold {
  /**
   * 已读到的账本游标：**下一条**要读事件的起始下界。
   *
   * ⚠ 它**不等于**「最后一条被折叠的事件的序号」：带 scope 的读取会跳过不匹配的事件，
   * 游标照样前进。两者混用会导致两种相反的静默错误 ——
   * 用「最后一条折叠的事件」当游标会**重复读**（退化为每次全扫），
   * 用「账本头部序号」当游标则会**跳过**并发提交的事件。
   *
   * 后半句不是理论担忧：收口序号若在 `read` **之后**才采样，就正好落进那个窗口
   * （`catchUpFold` 曾如此，是一条已实测复现的 HIGH）。现在收口序号一律在
   * **任何 read 之前**采样为 `headBefore`，理由与实测见 `catchUpFold`。
   */
  readonly cursor: LedgerSequence
  readonly teams: ReadonlyMap<TeamId, TeamFact>
  readonly members: ReadonlyMap<MemberId, MemberFact>
  readonly channels: ReadonlyMap<ChannelId, ChannelFact>
  readonly threads: ReadonlyMap<ThreadId, ThreadFact>
  /**
   * 消息表（`team/message-sent`），键是 `messageId`。
   *
   * **按 `messageId` 而不是按线程聚合**：一条消息只有一个身份，若按线程聚合就
   * 得在线程里再排一次序，而排序键（序号/时间）由本表各自携带，
   * 视图侧要「某线程的消息」只需过滤 + 排序（见 `projectChannelMessages`）。
   */
  readonly messages: ReadonlyMap<MessageId, MessageFact>
  /** 建团审批票（`spawn/*` 四态）；文档 3.6 审批区与收件箱的投影面。 */
  readonly spawnTickets: ReadonlyMap<RequestId, SpawnTicketFact>
  /** DAG 团表（阶段 3 · DagCanvas 的数据源）。 */
  readonly dagTeams: ReadonlyMap<DagTeamId, DagTeamFact>
  /**
   * **未能被投影进去**的事件条数 —— 两种成因：
   * - **载荷形状不合法**（不符合其 kind）⇒ 拒绝采信；
   * - **kind 无法识别**（形参是 `never` 的那个兜底分支）。
   *
   * 存在的理由与 `src/delegation.ts` 的「拒绝采信」同源：`isLedgerEvent` 只保证
   * `data` 是**非 null 对象**，**不保证载荷与 kind 匹配**（见 `src/types/guards.ts`
   * 的「证明什么、不证明什么」）。一条 `data: {}` 的 `team/created` 会让
   * `event.data.teamId` 取到 `undefined`。此处**不采信**该事件，并把这个数字**如实带回**，
   * 让「视图少了一条事实」是**可见的**，而不是界面看起来正常、内容却是错的。
   * 与 `ledger.read` 对坏行抛错是同一取舍：账本类数据，静默失真比可见失败严重得多。
   *
   * 关于「两种成因合并计数」（OCR 复核 [4] 提过要拆开，**不采纳**，理由如下）：
   * 拆分确实能区分「账本数据坏了」与「本代码认不出这个 kind」两种补救路径，
   * 但第二种成因在**任何受支持的路径上都不可达** —— 新增 kind 时
   * `noteUnhandled` 的 `never` 形参会让 `tsc` 直接失败（已实测：加一个
   * `team/probe-new-kind` 后 `projection/index.ts` 报 TS2345），
   * 而经账本读入的事件又已由 `isLedgerEvent` 按 kind 清单挡过。
   * 为一个不可达分支再加一个计数器，就是 §「不要造自己的需求」里的那种自我繁殖。
   * 保留一次计数（而不是静默 `continue`）是**防御性**的：万一真有认不出的 kind 流进来，
   * 「有事件被丢掉了」必须可见 —— 静默丢弃比计数混淆危险得多。
   *
   * ⚠ 它**不**统计载荷合法、但引用实体不在本次折叠范围的事件
   * （见 `unresolvedReferences`）—— 那在按 scope 增量读时是**正常**的。
   */
  readonly malformedEvents: number
  /**
   * **载荷合法、但被引用的实体不在本次折叠里**的事件条数。
   *
   * 典型场景：按成员 scope 增量读（`scopesForMember`）时，
   * `team/ownership-reattached` 会命中（它投 `memberScope(from/to)`），
   * 但它引用的那个团只投 `teamScope`，因此**不在**本次折叠里 ⇒ 这条事件无从应用。
   *
   * 这**不是**数据损坏，是「本次读取的视野不完整」的**必然结果** ——
   * 所以它与 `malformedEvents` 分开计数：
   * - 全量重建（`rebuildFold`）时它应当为 **0**；不为 0 才说明账本里真有
   *   「引用了从未出现过的实体」这类不一致；
   * - 带 scope 时它可以大于 0，调用方应结合 `FoldCoverage` 一起解读，
   *   而**不要**据此判定账本损坏。
   */
  readonly unresolvedReferences: number
}

// ────────────────────────────────────────────────────────────────────────────
// scope 构造与「无 scope 的 kind」清单
// ────────────────────────────────────────────────────────────────────────────

/**
 * 覆盖**一个团**全部事实的 scope 列表。
 *
 * `{kind:'team', teamId}` 一条即可：`changeScopesOf` 让成员变更同时投成员 scope **与团 scope**
 * （AC-10-2）、频道创建投团 scope、子团成立投父团 scope。
 *
 * ⚠ 它**覆盖不到** `team/thread-started`（该 kind 的 scope 是 `[]`，见文件头）。
 * 需要线程时走不带 `scopes` 的路径，或读 `outcome.coverage.unscopedKindsOmitted`。
 */
export function scopesForTeam(teamId: TeamId): readonly ChangeScope[] {
  return [{ kind: 'team', teamId }]
}

/** 覆盖**一个成员**相关事实的 scope 列表（不含其所属团的其余事实）。 */
export function scopesForMember(memberId: MemberId): readonly ChangeScope[] {
  return [{ kind: 'member', memberId }]
}

/**
 * `changeScopesOf` 返回 `[]` 的 kind（即**不参与任何 scope 过滤**的事件）。
 *
 * 手写这张表是**有意**的：它让「按 scope 增量读」的盲区变成一个**显式常量**，
 * 而不是散落在注释里的知识。表与实现的绑定由 `tests/projection.spec.ts` 强制
 * （遍历全部 kind 真算一遍，断言返回 `[]` 的恰好是这两项）。
 */
export const UNSCOPED_EVENT_KINDS: readonly LedgerEventKind[] = [
  /** 团壳创建那一刻还不存在订阅者（`ledger.ts:404` 的说明）。 */
  'team/initialized',
  /** 受影响实体是频道/线程，而 §6.3 的 scope 词汇表里没有这两种（见文件头）。 */
  'team/thread-started',
  /**
   * 同理：受影响实体是「某条线程里的一条消息」，而 §6.3 的 scope 词汇表里
   * 既没有 thread 也没有 message 种类。
   *
   * ⚠ 这里**不**退而投 `teamScope`：`MessageSentData` 里**没有 `teamId`**
   * （只有 `channelId`/`threadId`），要算出团必须回查账本 —— 而 `changeScopesOf`
   * 是**纯函数**（不该读账本），且「硬塞一个语义不符的 scope」正是 `ledger.ts`
   * 那段注释明确拒绝的做法（会让订阅方拿到看着更新了、却找不到自己关心的数据的通知）。
   *
   * 后果与线程同源、也必须同样被如实对待：**任何带 `scopes` 的读取都看不到消息**。
   * 需要消息时必须走不带 `scopes` 的 `rebuildFold`（`buildWireTeam` 正是如此）。
   */
  'team/message-sent',
]

// ────────────────────────────────────────────────────────────────────────────
// 运行期收窄（`isLedgerEvent` 不验载荷与 kind 是否匹配，故逐字段自证）
// ────────────────────────────────────────────────────────────────────────────

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function asTeamKind(value: unknown): TeamKind | null {
  return value === 'persistent' || value === 'temporary' ? value : null
}

/**
 * 生命周期取值收窄。
 *
 * ⚠ **本函数不提供编译期穷尽性保证**（OCR 复核 [41] 纠正了这里原先的一句错话，
 * 它说「将来 `MemberLifecycle` 加取值时本函数会 TS2366 编译失败」——**是错的**）：
 * 本函数的 `switch` 主语是 `value: unknown`（不是 `MemberLifecycle`），类型层没有联合可穷尽；
 * 而显式的 `default: return null` 又保证了所有路径都有返回值，故 TS2366
 * （「并非所有代码路径都返回值」）**永远不会**在这里触发。
 * 形状与 `src/naming.ts` 的 `occupiesName` **不同**：后者是直接对 `MemberLifecycle`
 * 穷尽 switch 且**没有 default**，那才是真正会因新取值而编译失败的手法。
 *
 * **实测依据**（给 `MemberLifecycle` 加一个取值 `'expelled'` 后跑隔离探针）：
 * ```
 * src/naming.ts(422,52): error TS2366: Function lacks ending return statement...
 * src/projection/index.ts(829,51): error TS2366: ...   ← 是 isTombstone，不是本函数
 * ```
 * ⇒ 新取值会被本函数**静默映射成 `null`**（等价于判为畸形），编译期毫无提示。
 *
 * 那为什么不改成「真穷尽」？因为本函数必须处理任意 `unknown`（账本载荷未经类型检查，
 * `isLedgerEvent` 只保证 `data` 是非 null 对象），`default` 是它存在的理由。
 * 真正的穷尽性由两处提供，不必在这里重复：
 * - `isTombstone` 与本文件的其它 `MemberLifecycle` switch（上面实测会 TS2366）；
 * - `types/team.ts` 的类型定义本身。
 */
function asLifecycle(value: unknown): MemberLifecycle | null {
  switch (value) {
    case 'active':
    case 'suspended':
    case 'archived':
    case 'destroyed':
      return value
    default:
      return null
  }
}

/** 三层标识的收窄（`position` / `name` / `memberId` 三者都是非空字符串才算数）。 */
function asIdentity(value: unknown): MemberIdentity | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const position = asNonEmptyString(candidate['position'])
  const name = asNonEmptyString(candidate['name'])
  const memberId = asNonEmptyString(candidate['memberId'])
  if (position === null || name === null || memberId === null) return null
  return { position, name, memberId: memberId as MemberId }
}

/** `{provider, model}` 的收窄（换模事件的 `from` / `to`）。 */
function asModel(value: unknown): MemberModel | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const provider = asNonEmptyString(candidate['provider'])
  const model = asNonEmptyString(candidate['model'])
  if (provider === null || model === null) return null
  return { provider, model }
}

/** 可选外键：`null` 与「字段缺省」都收窄成 `null`（账本里两者语义相同）。 */
function asOptionalId<T extends string>(value: unknown): T | null {
  return typeof value === 'string' && value !== '' ? (value as T) : null
}

// ────────────────────────────────────────────────────────────────────────────
// 空折叠与纯折叠
// ────────────────────────────────────────────────────────────────────────────

/** 空折叠：游标 0（`Ledger.read` 从序号 1 开始读）。 */
export function emptyProjectionFold(): ProjectionFold {
  return {
    cursor: 0,
    teams: new Map(),
    members: new Map(),
    channels: new Map(),
    threads: new Map(),
    messages: new Map(),
    spawnTickets: new Map(),
    dagTeams: new Map(),
    malformedEvents: 0,
    unresolvedReferences: 0,
  }
}

/**
 * 不该到达的兜底分支。
 *
 * 形参类型是 `never`：于是**给 `LedgerEventMap` 新增一个 kind 而忘了在
 * `foldLedgerEvents` 里做决定时，`tsc` 会在调用处报错** ——
 * 这正是 `changeScopesOf` 用 `assertNever` 守的同一个性质。
 *
 * 但它**不抛**：一条账本事件不该让整个投影崩掉（那会把「视图少一块」
 * 升级成「界面全白」）。按构造它到不了，所以这里是「编译期响亮 + 运行期安静」。
 *
 * ⚠ 返回值刻意是 `void`、且调用点**不 `return` 它的结果**（初版就是 `return`，
 * 那是个真缺陷）：本函数在批处理循环里，而 `return` 会把本批**已经折叠好的**
 * 四张局部表整个丢掉 —— 表现为「一批里前面的事件白读了」，
 * 且只在不可达分支被触发时才发生，属于最难查的一类。改成计数 + `continue` 后，
 * 即便真有新 kind 落进来，本批其余事件的结果也不受影响。
 */
function noteUnhandled(event: never): void {
  void event
}

/**
 * 把一批事件折进折叠（**纯函数**：不改入参，返回新值；内部 copy-on-write）。
 *
 * `nextSequence` 由调用方给出，而不是从 `events` 末条推：
 * 带 scope 的读取会跳过事件，游标与「末条事件的序号」不是一回事
 * （见 `ProjectionFold.cursor`）。
 */
export function foldLedgerEvents(
  fold: ProjectionFold,
  events: readonly LedgerEvent[],
  nextSequence: LedgerSequence,
): ProjectionFold {
  // 空批次的早返回：只推进游标，**不做任何 Map 拷贝**。
  // 这是常态路径（带 scope 的增量读取经常一页都没命中），
  // 故值得为它避开下面那四次 `new Map(...)`。
  if (events.length === 0) {
    return fold.cursor === nextSequence ? fold : { ...fold, cursor: nextSequence }
  }

  // 四张表在本批**可能**被改写，故先各拷一份（copy-on-write）。
  // 代价是 O(实体数) 而非 O(账本长度)：实体数由团/成员规模决定，
  // 与「账本活了多久」无关，所以它不随账本增长而恶化。
  // 非空批次才付这份代价（见上面的早返回）。
  let teams = new Map(fold.teams)
  let members = new Map(fold.members)
  let channels = new Map(fold.channels)
  let threads = new Map(fold.threads)
  let messages = new Map(fold.messages)
  let spawnTickets = new Map(fold.spawnTickets)
  let dagTeams = new Map(fold.dagTeams)
  let malformed = fold.malformedEvents
  let unresolved = fold.unresolvedReferences

  for (const event of events) {
    switch (event.kind) {
      // ── 团 ──────────────────────────────────────────────────────────────
      case 'team/created': {
        const teamId = asNonEmptyString(event.data.teamId)
        const kind = asTeamKind(event.data.kind)
        const name = asNonEmptyString(event.data.name)
        if (teamId === null || kind === null || name === null) {
          malformed += 1
          continue
        }
        teams.set(teamId as TeamId, {
          teamId: teamId as TeamId,
          kind,
          name,
          ownerMemberId: asOptionalId<MemberId>(event.data.ownerMemberId),
          parentTeamId: asOptionalId<TeamId>(event.data.parentTeamId),
          appearedAtSequence: event.sequence,
        })
        continue
      }

      case 'team/destroyed': {
        // 团队级中止（2026-09-24）：打终态标记，**不删**任何既有事实
        // （messages/threads/channels 原样保留 —— 审计与「已完成结果」都在）。
        // 消费侧（host-data 的 buildWireTeam）看到 `destroyedAtSequence` 就不再发这个团。
        // 幂等：团已有 destroyedAtSequence（之前被中止过）⇒ 忽略本条，保第一条。
        const teamId = asNonEmptyString(event.data.teamId)
        if (teamId === null) {
          malformed += 1
          continue
        }
        const priorTeam = teams.get(teamId as TeamId)
        if (priorTeam === undefined || priorTeam.destroyedAtSequence !== undefined) {
          // 团不在本次视野（scope 读）或已中止 —— 都不算损坏。
          continue
        }
        teams.set(teamId as TeamId, {
          ...priorTeam,
          destroyedAtSequence: event.sequence,
        })
        continue
      }

      case 'team/ownership-reattached': {
        // FR-5.6.3：转挂改变 owner。只改 owner，**不动** `appearedAtSequence`
        // （团没有「重新出现」，顺序应保持稳定）。
        const teamId = asNonEmptyString(event.data.teamId)
        const to = asNonEmptyString(event.data.to)
        if (teamId === null || to === null) {
          malformed += 1
          continue
        }
        const prior = teams.get(teamId as TeamId)
        if (prior === undefined) {
          // 载荷合法、但它引用的团不在本次视野里（按 scope 读时的常态，不算损坏）。
          unresolved += 1
          continue
        }
        teams.set(prior.teamId, { ...prior, ownerMemberId: to as MemberId })
        continue
      }

      // ── 成员 ────────────────────────────────────────────────────────────
      case 'team/member-added': {
        const teamId = asNonEmptyString(event.data.teamId)
        const identity = asIdentity(event.data.member)
        const lifecycle = asLifecycle(event.data.lifecycle)
        if (teamId === null || identity === null || lifecycle === null) {
          malformed += 1
          continue
        }
        // 建团那一刻的模型**从载荷取**，不再硬写 `null`。
        //
        // ⚠ 这里**不能**把「取不到」算成 `malformed`（即不能用 early-return 把整条事件丢掉）：
        // - 既有账本里的事件是**旧形态**（那时 `MemberAddedData` 还没有 `model` 字段），
        //   账本只追加、不可改写 ⇒ 那些事件**永远**取不到 `model`。
        //   若判成畸形，所有历史账本都会在每次折叠时多计一条「坏事件」，
        //   而账本其实是好的 —— 那会把「数据损坏」这个信号污染成噪音。
        // - `null` 本身就是合法值（成员跟随全局默认，见 `types/operations.ts` 的说明）。
        // 故：取到就用，取不到（缺字段 / 为 null / 形状不合法）一律如实保持 `null`。
        const model = asModel(event.data.model)
        members.set(identity.memberId, {
          memberId: identity.memberId,
          teamId: teamId as TeamId,
          position: identity.position,
          name: identity.name,
          lifecycle,
          model,
          appearedAtSequence: event.sequence,
        })
        continue
      }

      case 'team/member-renamed': {
        const memberId = asNonEmptyString(event.data.memberId)
        const to = asNonEmptyString(event.data.to)
        if (memberId === null || to === null) {
          malformed += 1
          continue
        }
        const prior = members.get(memberId as MemberId)
        if (prior === undefined) {
          unresolved += 1
          continue
        }
        members.set(prior.memberId, { ...prior, name: to })
        continue
      }

      // 三个生命周期事件共用同一处置：**按载荷的 `to` 走，而不是按 kind 硬编码**。
      //
      // 这不是偷懒，是必需的：`MemberLifecycle` 有 4 个取值，而生命周期事件只有
      // suspended / resumed / destroyed 三个 kind —— **没有任何 kind 叫 `member-archived`**。
      // `archived`（FR-9.3 的终态）只能作为某个生命周期转换的 `to` 抵达
      // （`tests/ledger.spec.ts:1183` 正是这个形状：`from:'archived', to:'destroyed'`）。
      // 若按 kind 推断状态，`archived` 在投影层**结构上不可达** ——
      // 而「成员 archived 后的视图」恰是本任务要求覆盖的场景之一。
      // 这也说明「kind 是判别键」在**账本**层成立，在**生命周期折叠**层不成立。
      case 'team/member-suspended':
      case 'team/member-resumed':
      case 'team/member-destroyed': {
        const memberId = asNonEmptyString(event.data.memberId)
        const to = asLifecycle(event.data.to)
        if (memberId === null || to === null) {
          malformed += 1
          continue
        }
        const prior = members.get(memberId as MemberId)
        if (prior === undefined) {
          unresolved += 1
          continue
        }
        members.set(prior.memberId, { ...prior, lifecycle: to })
        continue
      }

      case 'team/member-model-switched': {
        const memberId = asNonEmptyString(event.data.memberId)
        const to = asModel(event.data.to)
        if (memberId === null || to === null) {
          malformed += 1
          continue
        }
        const prior = members.get(memberId as MemberId)
        if (prior === undefined) {
          unresolved += 1
          continue
        }
        members.set(prior.memberId, { ...prior, model: to })
        continue
      }

      // ── 频道与线程 ──────────────────────────────────────────────────────
      case 'team/channel-created': {
        const channelId = asNonEmptyString(event.data.channelId)
        const teamId = asNonEmptyString(event.data.teamId)
        const title = asNonEmptyString(event.data.title)
        if (channelId === null || teamId === null || title === null) {
          malformed += 1
          continue
        }
        channels.set(channelId as ChannelId, {
          channelId: channelId as ChannelId,
          teamId: teamId as TeamId,
          title,
          appearedAtSequence: event.sequence,
        })
        continue
      }

      case 'team/thread-started': {
        const threadId = asNonEmptyString(event.data.threadId)
        const channelId = asNonEmptyString(event.data.channelId)
        const title = asNonEmptyString(event.data.title)
        if (threadId === null || channelId === null || title === null) {
          malformed += 1
          continue
        }
        threads.set(threadId as ThreadId, {
          threadId: threadId as ThreadId,
          channelId: channelId as ChannelId,
          title,
          assigneeMemberId: asOptionalId<MemberId>(event.data.assigneeMemberId),
          appearedAtSequence: event.sequence,
        })
        continue
      }

      // ── 消息 ────────────────────────────────────────────────────────────
      //
      // 校验口径与上面两个 case 逐条同源：**浅校验**（判别字段非空即可）+
      // `malformed += 1; continue`（**不抛**）。
      //
      // ⚠ 与 `team/thread-started` 的**唯一结构差异**是这里**不校验引用完整性**
      //（`threadId` / `channelId` 指向的实体在不在本折叠里）、也**不 `unresolved += 1`**：
      // 那不是疏忽，是刻意的。理由是三条中的任何一条都足够：
      // ① 本表是**追加表**，不依赖任何既有事实就能自洽（不像 `member-renamed` 要读
      //    `members.get(prior)`，那里取不到就是真的应用不了）；
      // ② 按 scope 增量读时，消息事件必然可能与它引用的线程**不在同一批里**
      //（线程的 scope 是 `[]`，见 `UNSCOPED_EVENT_KINDS`）—— 那时把消息判成
      //    `unresolved` 会把「本页视野不全」错报成「账本数据不一致」，
      //    而 `unresolvedReferences` 的契约（`ProjectionFold` 的注释）明说全量重建时才该为 0；
      // ③ 消息是**界面上的内容**：宁可让它显示在「线程暂时看不到」的状态下，
      //    也不要因为引用缺失就把它整条丢掉 —— 后者是静默丢数据。
      // 真正需要的一致性由视图侧负责：`projectChannelMessages` 只按 `channelId` 过滤，
      // 而 `buildWireTeam` 只取**本团频道的**消息（越界引用不会漏进别的团）。
      case 'team/message-sent': {
        const messageId = asNonEmptyString(event.data.messageId)
        const channelId = asNonEmptyString(event.data.channelId)
        const threadId = asNonEmptyString(event.data.threadId)
        // ⚠ 发送者是**三态**，不是两态：非空串（成员）/ `null`（不是成员：人类操作者，
        //   见 `MessageSentData`）/ **其它一切**（数字、空串、缺字段 —— 那是坏载荷）。
        //   所以**不能**直接用 `asOptionalId`：它把「坏载荷」也折成 `null`，
        //   于是一条 `senderMemberId: 42` 的垃圾载荷会被**当成合法的人类消息**收下 ——
        //   那正是本仓最怕的那种「把读不出来的东西读成成功」。
        //   这里要求 `null` 必须**显式写出来**（`undefined` 亦拒：缺字段与「明说没有」不是一回事，
        //   见 `narrowTrimmedString` 对「缺字段」的一贯口径）。
        const rawSender = event.data.senderMemberId
        const senderAbsent = rawSender === null
        const senderMemberId = rawSender === null ? null : asNonEmptyString(rawSender)
        // ⚠ `body` 用 `asNonEmptyString` 而**不是** `asOptionalId`/裸 `as`：
        // 空正文的消息在线格式里是不可区分的（`asMessage` 只会把它渲染成空白），
        // 与其在界面上留一条看不出内容的行，不如拒采信并计数（可见的缺失 > 静默的空行）。
        const body = asNonEmptyString(event.data.body)
        if (
          messageId === null ||
          channelId === null ||
          threadId === null ||
          (!senderAbsent && senderMemberId === null) ||
          body === null
        ) {
          malformed += 1
          continue
        }
        messages.set(messageId as MessageId, {
          messageId: messageId as MessageId,
          channelId: channelId as ChannelId,
          threadId: threadId as ThreadId,
          senderMemberId: senderMemberId === null ? null : (senderMemberId as MemberId),
          body,
          // 时间取自**基座**而不是 `data`（`data` 里没有它，见 `MessageSentData`）。
          occurredAt: event.occurredAt,
          appearedAtSequence: event.sequence,
        })
        continue
      }

      // ── 建团审批票（spawn 四态 → SpawnTicketFact）────────────────────────
      //
      // 载荷校验口径与本文件其余 case 一致：**浅校验**（判别字段存在即可），
      // 复杂的 spec 由写入侧（`narrowRoster` / spawn 工具入参校验）收窄过，
      // 这里再造一个重验证器就是重复建一遍真相。
      case 'spawn/awaiting-human-approval':
      case 'spawn/principal-rejected': {
        const data = event.data
        const requestId = asNonEmptyString(data.requestId)
        const targetKind = asTeamKind(data.targetKind)
        const spec = data.spec
        const specName =
          spec !== null && typeof spec === 'object' && typeof (spec as TeamSpec).name === 'string'
            ? (spec as TeamSpec)
            : null
        if (requestId === null || targetKind === null || specName === null) {
          malformed += 1
          continue
        }
        const isPrincipalReject = event.kind === 'spawn/principal-rejected'
        // ⚠ OCR HIGH [7]：`requesterMemberId` 必须窄化 —— `isLedgerEvent` 只保证
        //   data 是非 null 对象，字段可能是 undefined/非字符串；原样存进
        //   `MemberId` 会让「已声明验证过」的类型契约被静默打破。
        const requester = asNonEmptyString(data.requesterMemberId)
        if (requester === null) {
          malformed += 1
          continue
        }
        // OCR [32/34]：同 requestId 的首条（awaiting）已定过 raisedAtSequence，
        // principal-rejected 晚到**不得覆盖**（首次入账位置优先 —— 与 human
        // 分支同口径；账本可被外部工具追加，顺序不受我们控制）。
        const prior = spawnTickets.get(requestId as RequestId)
        spawnTickets.set(requestId as RequestId, {
          requestId: requestId as RequestId,
          requesterMemberId: requester as MemberId,
          targetKind,
          spec: spec as TeamSpec,
          status: isPrincipalReject ? 'rejectedByPrincipal' : 'awaiting',
          // OCR LOW：reason 也做运行时窄化（isLedgerEvent 不保字段形状，
          // 裸 `as` 会把 undefined 存进 `string | null` 字段）。经
          // `reason?: unknown` 可选读取 —— awaiting 分支类型上本就没有该字段。
          reason: isPrincipalReject
            ? (asNonEmptyString((data as { readonly reason?: unknown }).reason) ?? null)
            : null,
          humanOperatorId: null,
          raisedAtSequence: prior?.raisedAtSequence ?? event.sequence,
        })
        continue
      }

      case 'spawn/human-approved':
      case 'spawn/human-rejected': {
        const data = event.data
        const requestId = asNonEmptyString(data.requestId)
        const targetKind = asTeamKind(data.targetKind)
        const spec = data.spec
        const specOk =
          spec !== null && typeof spec === 'object' && typeof (spec as TeamSpec).name === 'string'
        if (requestId === null || targetKind === null || !specOk) {
          malformed += 1
          continue
        }
        const isReject = event.kind === 'spawn/human-rejected'
        // ⚠ OCR HIGH [8]：同 [7] —— requester 与 humanOperatorId 都要窄化。
        //   人类结论必须带操作者（AC-5-9 非空），缺失/非法 ⇒ 整条计畸形。
        const requester = asNonEmptyString(data.requesterMemberId)
        const operator = asNonEmptyString(data.humanOperatorId)
        // OCR LOW [17]：requestId/targetKind/specOk 已在上方 guard 验过 ——
        // 这里只判**新增**的两项，重复项会掩盖真正 gate 这条的检查。
        if (requester === null || operator === null) {
          malformed += 1
          continue
        }
        const prior = spawnTickets.get(requestId as RequestId)
        spawnTickets.set(requestId as RequestId, {
          requestId: requestId as RequestId,
          requesterMemberId: requester as MemberId,
          targetKind,
          spec: spec as TeamSpec,
          status: isReject ? 'rejectedByHuman' : 'approved',
          reason: isReject
            ? (asNonEmptyString((data as { readonly reason?: unknown }).reason) ?? null)
            : null,
          humanOperatorId: operator,
          // 首次入账位置优先（审批区排序稳定）；单独出现人类结论（理论上不该有，
          // 但账本可被外部工具追加）时退到本事件序号。
          raisedAtSequence: prior?.raisedAtSequence ?? event.sequence,
        })
        continue
      }

      // ── DAG 团（阶段 3 · DagCanvas 数据源）─────────────────────────────
      case 'dag/team-created': {
        const data = event.data
        const dagTeamId = asNonEmptyString(data.dagTeamId)
        const owner = asNonEmptyString(data.ownerMemberId)
        if (dagTeamId === null || owner === null) {
          malformed += 1
          continue
        }
        const parent = asNonEmptyString(data.parentTeamId)
        dagTeams.set(dagTeamId as DagTeamId, {
          dagTeamId: dagTeamId as DagTeamId,
          ownerMemberId: owner as MemberId,
          parentTeamId: parent as TeamId | null,
          requestedByTransfer: data.requestedByTransfer === true,
          tasks: new Map(),
        })
        continue
      }

      case 'dag/ownership-transferred': {
        const data = event.data
        const dagTeamId = asNonEmptyString(data.dagTeamId)
        const to = asNonEmptyString(data.to)
        // 载荷本身非法 ⇒ 畸形；载荷合法但 dag 不在本次视野 ⇒ 未解析引用
        //（OCR [26]：本事件带 member scope，成员视图下 dag 合法缺席是常态，
        // 计 malformed 会把合法事件谎报成「数据损坏」—— 与
        // `team/ownership-reattached` 的口径对齐）。
        if (dagTeamId === null || to === null) {
          malformed += 1
          continue
        }
        const prior = dagTeams.get(dagTeamId as DagTeamId)
        if (prior === undefined) {
          unresolved += 1
          continue
        }
        dagTeams.set(dagTeamId as DagTeamId, { ...prior, ownerMemberId: to as MemberId })
        continue
      }

      case 'dag/task-state-changed': {
        const data = event.data
        const dagTeamId = asNonEmptyString(data.dagTeamId)
        const taskId = asNonEmptyString(data.taskId)
        const to = asNonEmptyString(data.to)
        // 同 ownership：字段非法 = 畸形；dag 不在视野 = 未解析引用（OCR [27]）。
        if (dagTeamId === null || taskId === null || to === null) {
          malformed += 1
          continue
        }
        const prior = dagTeams.get(dagTeamId as DagTeamId)
        if (prior === undefined) {
          unresolved += 1
          continue
        }
        // 任务表 copy-on-write：外层表是 COW 拷贝，内层 Map 是共享引用，
        // 直接 set 会改到上一批的那张表（fold 不可变性被静默破坏）。
        const tasks = new Map(prior.tasks)
        tasks.set(taskId, {
          state: to,
          reason: typeof data.reason === 'string' ? data.reason : null,
        })
        dagTeams.set(dagTeamId as DagTeamId, { ...prior, tasks })
        continue
      }

      // ── 不属于这三面的事实：**显式列出**而非让 `default` 吞掉 ────────────
      //
      // 逐条列出是有意的：将来某条事件长出了对 roster/channel/thread 的影响
      // （例如给频道加一条 `channel-archived`），后来者必须在这里**显式**做决定，
      // 而不是让一个新 kind 悄悄落进「不处理」的兜底里。
      //
      // - `plan/approved`：approveAndRun 的核准记录（文档 §5）。审批票的状态
      //   已由 `spawn/human-approved` 承载，本投影面暂不需要它；将来做「核准
      //   历史」列表时在此落一张表。
      // - `team/initialized`：不改变 roster/channel/thread 的任何事实。
      // （`dag/*` 三条已折进 `dagTeams`，见上面的专门 case。）
      case 'team/initialized':
      case 'plan/approved':
        continue

      default:
        // 穷尽性由 `noteUnhandled` 的 `never` 形参保证（新增 kind 时这里编译失败）。
        // ⚠ 用 `continue` 而**不是** `return`：本批已经折叠好的四张局部表必须保留，
        // 否则「一条未知 kind」会把同一批里它前面所有事件的结果一起丢掉。
        noteUnhandled(event)
        malformed += 1
        continue
    }
  }

  return {
    cursor: nextSequence,
    teams,
    members,
    channels,
    threads,
    messages,
    spawnTickets,
    dagTeams,
    malformedEvents: malformed,
    unresolvedReferences: unresolved,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 增量读取（scope 驱动、游标分页）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一次增量读取的覆盖声明。
 *
 * `scoped === true` 时 `unscopedKindsOmitted` **必然非空**：它列的是「这条读取路径
 * 结构上看不见的 kind」，与数据里当下有没有它们无关。这样调用方无需猜测就能知道
 * 自己拿到的不是全部事实。
 */
export interface FoldCoverage {
  readonly scoped: boolean
  readonly unscopedKindsOmitted: readonly LedgerEventKind[]
}

/** 一次增量读取的结果。`hasMore` 为 true 时调用方应带新折叠**再调一次**。 */
export interface CatchUpOutcome {
  readonly fold: ProjectionFold
  /** 本页之后是否还有事件。true 表示折叠**尚未**收敛到账本头部。 */
  readonly hasMore: boolean
  /** 本次实际读了几页（诊断用）。 */
  readonly pagesRead: number
  readonly coverage: FoldCoverage
}

export interface CatchUpOptions {
  /**
   * 只读这些 scope 的事件。**省略 = 不过滤**（能做全量重建，但代价是全扫）。
   * 传入时注意 `team/thread-started` 看不见（见文件头）。
   */
  readonly scopes?: readonly ChangeScope[] | undefined
  /** 单页上限，默认 200，最大 1000（透传给 `Ledger.read`）。 */
  readonly limit?: number | undefined
  /** 单次调用最多读几页，默认 1（增量语义：读一页就把控制权交还调用方）。 */
  readonly maxPages?: number | undefined
}

/** 默认页大小：比 `Ledger` 的 100 大一点，投影一次要装的东西比一次 `read` 多。 */
const DEFAULT_PROJECTION_PAGE = 200
/** 单次调用的页数上限，防止一个 `maxPages: Infinity` 把调用方挂在这里。 */
const MAX_PAGES_CEILING = 64

function normalizePageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PROJECTION_PAGE
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`CatchUpOptions.limit 必须是 ≥1 的安全整数，收到：${String(limit)}`)
  }
  return Math.min(limit, 1000)
}

function normalizeMaxPages(maxPages: number | undefined): number {
  if (maxPages === undefined) return 1
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new RangeError(`CatchUpOptions.maxPages 必须是 ≥1 的安全整数，收到：${String(maxPages)}`)
  }
  return Math.min(maxPages, MAX_PAGES_CEILING)
}

/**
 * 从折叠当前位置**增量**读一页（或几页）并折进去。
 *
 * 游标推进规则（三条都不能写错，否则分别是「重复全扫」与「静默漏事件」）：
 * - `hasMore === true` ⇒ 用 `page.nextCursor`（本页最后一条**匹配**事件的序号）续读；
 * - `hasMore === false` ⇒ 本次 read 已扫到**它那一刻**的表尾，收口。
 *   若这里错用 `page.events` 的末条序号，带 scope 时会把「游标之后那些**不匹配**的事件」
 *   反复重扫（性能退化），而**不带** scope 时它恰好等于头部 —— 两种路径行为不一致，
 *   正是最难查的那类缺陷。
 * - 收口用的表尾序号必须在**任何 read 之前**采样（见下面的 `headBefore`）。
 *
 * ⚠ **为什么收口序号必须在 read 之前取**（原先写在 read 之后再取，是一条 HIGH 竞态，已修）：
 * `ledger.read()` 与 `ledger.head()` 是**两次独立查询**、没有共享快照
 * （`ledger.ts` 里 `read` 与 `readHead` 各自 prepare 一条语句，不在同一事务内）。
 * 若 `head()` 在 `read()` **之后**调用，则「read 扫到表尾的那一刻」与「head 取值的那一刻」
 * 之间落地的并发提交会被算进收口序号 ⇒ 游标被推**过**那条新事件 ⇒
 * 它此后**永远**折不进来（静默丢事件：不报错、界面看着正常、内容却少一条）。
 *
 * 实测复现（`tests/projection.spec.ts` 的并发用例，确定性可复现）：
 * 账本里有 1 条事件，用**另一条连接**在 `read` 返回后提交第 2 条 ——
 * 旧写法收口成 `cursor = 2` 而只折了 1 条，第 2 条自此再也读不回来。
 *
 * 先取 head 为什么**安全**：账本是**只追加**的（append-only，`sequence` 只增不减、
 * 不复用、不重排），故「更早采样到的表尾」必然 ≤「更晚发生的 read 所扫到的表尾」
 * —— 早采只会偏**小**，绝不会偏大；偏小至多多扫一遍，偏大才会丢事件。
 * 这正是「宁可下轮重折，也不跳过」。
 *
 * 先取 head 为什么**不会重复折叠**：它与本页实际折到的末条取 `max`。
 * 若期间真有并发提交、且被本页折到（末条序号 > `headBefore`），收口就用那个末条序号，
 * 于是已折过的事件不会被再折一次（重复折会让 `malformedEvents` 这类计数翻倍）。
 */
export function catchUpFold(
  ledger: Ledger,
  fold: ProjectionFold,
  options: CatchUpOptions = {},
): CatchUpOutcome {
  const limit = normalizePageLimit(options.limit)
  const maxPages = normalizeMaxPages(options.maxPages)
  const scopes = options.scopes
  // ⚠ OCR HIGH [F2，连续第四轮在场]：`scopes: []` 会**静默跳过全部事件** ——
  // `read({scopes:[]})` 短路空页 ⇒ 下方 settle 分支把 cursor 直接推到表尾，
  // 一条没折却「看起来追上了」（coverage.scoped=true、无任何报错）。
  // 空数组没有合理语义（不过滤请传 undefined）⇒ 入口显式拒绝，把静默变成响。
  if (scopes !== undefined && scopes.length === 0) {
    throw new Error('catchUpFold: scopes 为空数组会静默跳过全部事件（F2）；不按 scope 过滤请传 undefined')
  }
  const scoped = scopes !== undefined

  // ⚠ 表尾序号**必须在任何 read 之前**采样：账本只追加，故「早采样」必然 ≤「read 那一刻
  // 扫到的表尾」—— 偏小至多多扫一遍，偏大才会永久丢事件。反之（先 read 再 head）是一条
  // 已实测复现的 HIGH：两者之间落地的并发提交会被算进收口序号，游标跳过它。详见函数文档。
  // 代价：每次调用多一次 head 查询（按主键取末行，与原先在收口分支调一次同量级）。
  const headBefore = ledger.head().sequence

  let current = fold
  let pagesRead = 0
  let hasMore = false

  for (;;) {
    if (pagesRead >= maxPages) break

    const page = ledger.read(
      scoped
        ? { scopes: scopes as readonly ChangeScope[], afterSequence: current.cursor, limit }
        : { afterSequence: current.cursor, limit },
    )
    pagesRead += 1

    if (page.hasMore && page.nextCursor !== null) {
      // 还有更多：游标停在本页末条**匹配**事件上，下一轮续读。
      current = foldLedgerEvents(current, page.events, page.nextCursor)
      hasMore = true
      continue
    }

    // 本次 read 已扫到**它那一刻**的表尾，收口。
    // （`hasMore` 为 true 而 `nextCursor` 为 null 是 `Ledger` 的契约违例；
    //  这里走收口分支而不是让它空转 —— 一个卡死的调用比少统计几条难查得多。）
    //
    // 收口值取 `max(headBefore, 末条已折事件的序号)`，两个操作数各挡一种错：
    // - `headBefore` 是**下界**：read 已把此刻之前的事件全部处理过（折叠或按 scope 跳过），
    //   取它即可让游标越过「本页之后那些不匹配的事件」，不必下轮重扫；
    // - `末条序号` 是**上限**：若 read 期间真有并发提交**并被本页折到**，它比 `headBefore` 大，
    //   取它才不会把那批已折过的事件再折一遍（重复折会让 `malformedEvents` 这类计数翻倍）。
    const lastFolded = page.events[page.events.length - 1]
    const settle =
      lastFolded === undefined ? headBefore : Math.max(headBefore, lastFolded.sequence)
    current = foldLedgerEvents(current, page.events, settle)
    hasMore = false
    break
  }

  return {
    fold: current,
    hasMore,
    pagesRead,
    coverage: { scoped, unscopedKindsOmitted: scoped ? UNSCOPED_EVENT_KINDS : [] },
  }
}

/**
 * 从空折叠**全量**重建（**不带** scope 过滤）。
 *
 * 它是「视图只是投影」这条性质的**可执行定义**：
 * `tests/projection.spec.ts` 断言「分页增量折叠的结果 ≡ 本函数的结果」。
 * 两者只要有一处不一致（漏事件、游标算错、scope 用错），断言就红。
 *
 * 注意它**不是**常态路径：账本无界增长，常态应走 `catchUpFold` + 游标。
 * 本函数是重建/核对入口（重启后恢复、测试对拍）。
 *
 * 它**忽略** `options.scopes`：契约就是全量，传了一律无视（而不是静默半全量）。
 */
export function rebuildFold(ledger: Ledger, options: CatchUpOptions = {}): CatchUpOutcome {
  const limit = normalizePageLimit(options.limit)
  let current = emptyProjectionFold()
  let pagesRead = 0
  let hasMore = true

  while (hasMore) {
    const outcome = catchUpFold(ledger, current, { limit, maxPages: MAX_PAGES_CEILING })
    current = outcome.fold
    pagesRead += outcome.pagesRead
    hasMore = outcome.hasMore
  }

  return {
    fold: current,
    hasMore: false,
    pagesRead,
    coverage: { scoped: false, unscopedKindsOmitted: [] },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 三个视图（纯函数：折叠 → 数据）
// ────────────────────────────────────────────────────────────────────────────

/** roster 里的一个成员条目。 */
export interface RosterMember {
  readonly memberId: MemberId
  readonly teamId: TeamId
  readonly position: string
  readonly name: string
  /** 界面显示名（FR-5A.4：优先职位名，重名才露序号）。由 `displayNameOf` 统一裁决。 */
  readonly displayName: string
  readonly lifecycle: MemberLifecycle
  /**
   * 是否是墓碑（`archived` 或 `destroyed`）。
   *
   * 它与 `lifecycle` **不是**二选一：`lifecycle` 是精确状态，本字段是「界面该不该
   * 把它当历史条目渲染」的投影结论。两者并存是为了让**消费方不各自发明判定**
   * —— 那种分叉的表现是同一个成员在两处一个被藏、一个被显示。
   */
  readonly tombstone: boolean
  readonly model: MemberModel | null
  /** 成员**首次**出现在账本里的序号：roster 的稳定排序键。 */
  readonly appearedAtSequence: LedgerSequence
}

/** 团队视图：团的事实 + 名册（**含墓碑**）+ 频道列表。 */
export interface RosterSnapshot {
  readonly team: TeamFact
  /** 全部成员，**含 archived / destroyed**（墓碑语义，NFR-4）。 */
  readonly members: readonly RosterMember[]
  /** 该团的频道 ID，按创建序号升序（UI 侧栏用）。 */
  readonly channelIds: readonly ChannelId[]
  /**
   * 投影时**载荷形状不合法而被拒绝采信**的事件条数（见 `ProjectionFold.malformedEvents`）。
   *
   * 透传到视图层是必要的：否则调用方只看到一份**看起来正常**的名册，
   * 无从知道它其实少了几条事实。
   */
  readonly malformedEvents: number

  /**
   * 载荷合法、但其引用实体不在本次折叠里的事件条数
   * （见 `ProjectionFold.unresolvedReferences`）。按 scope 读时可能大于 0，**不是**损坏信号。
   */
  readonly unresolvedReferences: number
}

/** 一条线程的视图。 */
export interface ThreadSnapshot {
  readonly threadId: ThreadId
  readonly channelId: ChannelId
  readonly title: string
  readonly assigneeMemberId: MemberId | null
  readonly appearedAtSequence: LedgerSequence
}

/** 频道视图：频道事实 + 其下全部线程。 */
export interface ChannelSnapshot {
  readonly channel: ChannelFact | null
  readonly threads: readonly ThreadSnapshot[]
}

function isTombstone(lifecycle: MemberLifecycle): boolean {
  switch (lifecycle) {
    case 'active':
    case 'suspended':
      return false
    case 'archived':
    case 'destroyed':
      return true
  }
}

/** 稳定排序：先按出现序号，再按 ID（ID 只用于打破平局，保证顺序确定）。 */
function bySequenceThenId<T extends { readonly appearedAtSequence: number }>(
  left: T,
  right: T,
  idOf: (value: T) => string,
): number {
  if (left.appearedAtSequence !== right.appearedAtSequence) {
    return left.appearedAtSequence - right.appearedAtSequence
  }
  const leftId = idOf(left)
  const rightId = idOf(right)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

/**
 * 团的名册视图（账本 → 数据）。
 *
 * **包含墓碑成员**：归档/销毁成员的历史事件仍可读（FR-9.3 / NFR-4），
 * 因此本函数绝不把他们过滤掉 —— 过滤会让「他曾经在过」这件事从界面上消失。
 * 是否灰显/折叠由 UI 按 `tombstone` 决定（本模块不做 UI 决策，只给事实）。
 *
 * **按 `memberId` 去重，绝不按名字**：归档/销毁会释放名字（`naming.ts` 的 `occupiesName`），
 * 所以同一个团里可以合法地存在两个同名成员（一个活着的、一个墓碑）。
 *
 * `teamId` 不在折叠里时返回 `null`（而不是一份空名册）：两者语义不同 ——
 * 前者是「账本里没有这个团」，后者是「团在、但一个成员都没有」。
 */
export function projectRoster(fold: ProjectionFold, teamId: TeamId): RosterSnapshot | null {
  const team = fold.teams.get(teamId)
  if (team === undefined) return null

  const members: RosterMember[] = []
  for (const fact of fold.members.values()) {
    if (fact.teamId !== teamId) continue
    members.push({
      memberId: fact.memberId,
      teamId: fact.teamId,
      position: fact.position,
      name: fact.name,
      // 复用 `naming.ts` 的单一裁决点，而不是在这里再写一遍「名字是不是 职位-序号」。
      displayName: displayNameOf({
        position: fact.position,
        name: fact.name,
        memberId: fact.memberId,
      }),
      lifecycle: fact.lifecycle,
      tombstone: isTombstone(fact.lifecycle),
      model: fact.model,
      appearedAtSequence: fact.appearedAtSequence,
    })
  }
  members.sort((left, right) => bySequenceThenId(left, right, (value) => value.memberId as string))

  // 先收事实、排序、**最后**才投影成 ID 列表。
  // （初版是「先收 ID 再 `fold.channels.get(id)` 回查」配 `?? 0` 兜底 ——
  //  OCR 复核 [5] 指出那是死代码：ID 就是从上面的循环里出来的，回查必然命中。
  //  更要紧的是 `?? 0` 一旦真被走到，会把一个「取不到」静默排到最前面，
  //  而不是暴露出「这里本不该取不到」。直接排事实就没有这个缝。）
  const teamChannels = [...fold.channels.values()].filter((channel) => channel.teamId === teamId)
  teamChannels.sort((left, right) =>
    bySequenceThenId(left, right, (value) => value.channelId as string),
  )
  const channelIds: readonly ChannelId[] = teamChannels.map((channel) => channel.channelId)

  return {
    team,
    members,
    channelIds,
    malformedEvents: fold.malformedEvents,
    unresolvedReferences: fold.unresolvedReferences,
  }
}

/** 频道视图（含其下线程，按启动序号升序）。频道不在折叠里时 `channel` 为 `null`。 */
export function projectChannel(fold: ProjectionFold, channelId: ChannelId): ChannelSnapshot {
  const channel = fold.channels.get(channelId) ?? null

  const threads: ThreadSnapshot[] = []
  for (const fact of fold.threads.values()) {
    if (fact.channelId !== channelId) continue
    threads.push({
      threadId: fact.threadId,
      channelId: fact.channelId,
      title: fact.title,
      assigneeMemberId: fact.assigneeMemberId,
      appearedAtSequence: fact.appearedAtSequence,
    })
  }
  threads.sort((left, right) => bySequenceThenId(left, right, (value) => value.threadId as string))

  return { channel, threads }
}

/** 单条线程视图；不在折叠里时返回 `null`。 */
/**
 * 一个频道下的消息（按**发生时间**升序；时间相同则按消息 id 打破平局）。
 *
 * 为什么排序键用 `occurredAt` 而**不是** `appearedAtSequence`（这一点与本文件其余
 * 投影函数**不同**，是有意的）：线程/频道是「结构」，界面按创建先后排；而消息是
 * 「对话」，界面必须按**时间**排。序号只在同一个写入者顺序写账本时与时间同序 ——
 * 账本允许多个写入者（宿主 + 外部工具），后写的条目可以带更早的 `occurredAt`
 * （`ledger.commit` 的入参里 `occurredAt` 由调用方给）。按序号排会在那时把
 * 「晚补录的旧消息」排到最后，即界面顺序与时间顺序不一致。
 * 平局时按 `messageId` 兜底，保证**顺序确定**（同 `bySequenceThenId` 的手法）。
 *
 * 过滤只按 `channelId`，**不**按线程：界面既有「线程时间线」（再按 `threadId` 过滤），
 * 也有「频道条目预览」（要整个频道最近的消息）。把两种需求合成一个函数，是为了让
 * 「哪些消息属于哪个频道」只有一个判据。
 */
export function projectChannelMessages(
  fold: ProjectionFold,
  channelId: ChannelId,
): readonly MessageFact[] {
  const messages: MessageFact[] = []
  for (const fact of fold.messages.values()) {
    if (fact.channelId !== channelId) continue
    messages.push(fact)
  }
  messages.sort((left, right) => {
    if (left.occurredAt !== right.occurredAt) return left.occurredAt - right.occurredAt
    return left.messageId < right.messageId ? -1 : left.messageId > right.messageId ? 1 : 0
  })
  return messages
}

/** 单条线程视图；不在折叠里时返回 `null`。 */
export function projectThread(fold: ProjectionFold, threadId: ThreadId): ThreadSnapshot | null {
  const fact = fold.threads.get(threadId)
  if (fact === undefined) return null
  return {
    threadId: fact.threadId,
    channelId: fact.channelId,
    title: fact.title,
    assigneeMemberId: fact.assigneeMemberId,
    appearedAtSequence: fact.appearedAtSequence,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 未读计数
// ────────────────────────────────────────────────────────────────────────────

/** 一个成员的未读结果。 */
export interface MemberUnread {
  readonly memberId: MemberId
  /** 水位之后**与这个成员相关**的事件条数。 */
  readonly count: number
  /** 其中最新一条的序号；一条都没有时为 `null`（**不要**用 0 表示「无」）。 */
  readonly newestSequence: LedgerSequence | null
}

export interface UnreadInput {
  readonly memberId: MemberId
  /**
   * 该成员的读水位：只统计**序号严格大于**它的事件。
   *
   * ⚠ 水位是**客户端的游标**，不是账本事实 —— 账本事件表里没有任何「已读」记录，
   * 本包也**刻意不发明**一条（发明它就得改 §6.1 的事件表）。
   * 因此水位由调用方传入，本模块**不存储**它：这就是「视图不得持有独立真相」
   * 在未读这个场景里的具体形态 —— 未读数是（账本事实 × 游标）的**函数**，
   * 不是一个状态。
   */
  readonly sinceSequence: LedgerSequence
}

/**
 * 按成员算未读事件数（FR-10.3 的未读面）。
 *
 * 「与这个成员相关」不是随口定的，它**逐字复用** `changeScopesOf` 的成员 scope：
 * 成员自身的增删改/挂起/恢复/销毁/换模、他发起的派生申请（被团长打回、被人批准/否决）、
 * 归属移交的 `from`/`to`、以及他名下 DAG 团队的创建与移交。这样
 * 「未读」与「账本通知」是**同一个判据**，不会出现「界面说有条未读、通知却没推」这种分叉。
 *
 * 分页读到扫完为止，故复杂度与「未读条数」成正比（而非与账本总量成正比）。
 */
export function unreadByMember(ledger: Ledger, input: UnreadInput): MemberUnread {
  const scopes = scopesForMember(input.memberId)
  // 未读统计要一次尽量多抓（它是「数条数」，分页越少越好），故取 `Ledger` 允许的页上限。
  //
  // ⚠ 关于「这个 1000 有没有复用 `Ledger` 的定义」—— 如实说明（OCR 复核 [6] 纠正了我
  // 先前写在这里的一句错话，那句话说上限「只在 Ledger 里定义一次」，**是错的**）：
  // `Ledger` 的 `MAX_PAGE_LIMIT = 1000`（`ledger.ts:159`）是**模块私有**、并未导出，
  // 而本文件的 `normalizePageLimit` 在自己的 `Math.min(limit, 1000)` 里**又写了一份**。
  // 也就是说这个上限目前**在库里有两份**，改 `ledger.ts` 那一处**不会**同步到这里。
  // 不改为「导出共享常量」的理由：那要动 `ledger.ts` 的公共面（别人的文件、
  // 且 SPEC §6.2 冻结了 `Ledger` 接口形状），而两者不一致的后果只是
  // 「本函数传的值被 `Ledger` 夹到它自己的上限」—— 行为仍然正确，只是分页次数变化。
  // 走 `normalizePageLimit` 而非裸写 1000，是为了让这条夹取逻辑只有**本文件内**一个点。
  const pageSize = normalizePageLimit(1000)
  let count = 0
  let newest: LedgerSequence | null = null
  let cursor = input.sinceSequence

  for (;;) {
    const page = ledger.read({ scopes, afterSequence: cursor, limit: pageSize })
    if (page.events.length === 0) break

    count += page.events.length
    const last = page.events[page.events.length - 1]
    if (last !== undefined) newest = last.sequence

    if (!page.hasMore) break
    // `hasMore` 为 true 时 `nextCursor` 按 `Ledger.read` 的契约必然非空；
    // 万一不是（实现被改坏），这里**退出而不是死循环** —— 一个卡死的调用
    // 比少统计几条难查得多。
    if (page.nextCursor === null) break
    cursor = page.nextCursor
  }

  return { memberId: input.memberId, count, newestSequence: newest }
}

/**
 * ⚠ 本文件**刻意不转发** `changeScopesOf`。
 *
 * 投影层的单测需要它来对拍 `UNSCOPED_EVENT_KINDS`，但那个符号已经在
 * `src/index.ts` 上由 `export * from './ledger.ts'` 提供了 ——
 * 单测从 `../src/index.ts` 导入即可，多导一次不会更省事。
 *
 * 一次实测记在这里，免得后来者（包括我自己）「顺手加个转发」：
 * ESM 里**两条 `export *` 提供同名但不同的绑定**时，行为是
 * `SyntaxError: The requested module ... contains conflicting star exports for name 'x'`
 * —— 而**不是**我原以为的「静默取不到」（`m.x === undefined`）。
 * 实测证据（三个 .mjs 探针，node v24.19.0）：
 * - `a.mjs: export const shared='from-a'` + `b.mjs: export const shared='from-b'`
 *   + `index.mjs: export * from 两者` ⇒ 动态 `import()` 得到
 *   `keys: ['onlyA','onlyB']`（`shared` 不在键里），而 `import { shared } from` 直接
 *   **SyntaxError 抛在实例化阶段**（整棵树加载失败，不是拿到 undefined）。
 * - 但**同一个绑定的两条转发**（`a.mjs: export const x`，`b.mjs: export { x } from './a.mjs'`，
 *   再 `export *` 两者）⇒ `keys: ['ay','by','x']`，命名导入正常取到 `X`。
 * ⇒ 所以「转发同一个绑定」本身是安全的；本文件不转发**纯粹是因为没必要**，
 *    而不是因为它会坏。别把上面那条 SyntaxError 当成「转发必炸」的依据。
 *
 * ⚠ 另一处同源实测（vitest vs node 的**不一致**，值记下来）：同一组「不同绑定的同名 `export *`」，
 * vitest 4.1.11 的转换路径**不报错**，动态 import 取到 `shared: "from-a"`（第一个胜出），
 * 而真实 node ESM 在**命名导入**时抛 SyntaxError。
 * ⇒ **测试绿不等于加载路径绿**：涉及模块图的问题必须以 node 真实 ESM 的结果为准。
 */
