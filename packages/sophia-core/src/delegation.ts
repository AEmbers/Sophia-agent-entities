/**
 * 团队派生策略与两级审批（SPEC §4 §5 全文 / FR-5.2 · FR-5.3 · FR-5.4 · FR-5.6）。
 *
 * ## 三块职责
 *
 * 1. **权限矩阵**（§4）：`PERSISTENT_POLICY` / `TEMPORARY_POLICY` / `policyOf`。
 * 2. **派生入口**（§5.2）：`requestSpawn` —— 临时团免审直建，持久团走两级审批。
 * 3. **第二级与善后**：`decideSpawnTicket`（人类批准/否决）、`reattachOrphanedTeams`（FR-5.6）。
 *
 * ## 五条不可动摇的性质
 *
 * 1. **不设层数上限**（AC-5-3 / FR-5.2.2）。控制手段是**审批门**而不是**深度闸**：
 *    `requestSpawn` 的签名里没有 `depth` / `maxDepth`，实现里也没有任何深度常量。
 *    每开一层持久团都要过「团长预审 + 人类批准」，因此可无限嵌套而不会失控 ——
 *    该不该多开一层由人和监正按实际情况判断，不由一个硬编码魔数决定。
 * 2. **「不得绕开」按 `requestId` 绑定，不按成员封禁**（§5.4 / FR-5.3.4 与 FR-5.3.5 的张力）。
 *    同一 `requestId` 一旦被否决，后续以它发起的**任何**派生都是 `noDowngradeBypass`；
 *    换一个新的 `requestId` 即可（且开临时团依然免审）。若按成员封禁，就会直接违反 FR-5.3.5。
 * 3. **`SpawnOutcome` 恰 5 个 `kind`**（AC-5-4）。因此本文件**不发明新的结果分支**去表达
 *    并发重复提交 —— 那种情况用「共享同一个在途 Promise」处理（见 `requestSpawn`），
 *    两次调用得到同一份结论，而不是新增一个第 6 种 `kind`。
 * 4. **票据状态是账本事实的投影**（FR-10.2）：状态变迁的唯一入口是「落一条新事件」，
 *    `readSpawnTicket` 每次都从账本重算，绝不返回内存里的可变对象。
 * 5. **副作用为零的可验证性**：被拒 / 进审批的路径**绝不**调用 `createTeam`。
 *    测试里用计数 spy 逐条断言（AC-5-2 / AC-5-6 / AC-5-7）。
 *
 * ## 只用 `Ledger` 的**公开契约**做投影（一处刻意的实现选择）
 *
 * 公理 4 要求「票据状态从账本重算」，但 SPEC §6.2 的 `Ledger` 接口上**没有**
 * 「按 `requestId` 查事件」这个方法 —— 只有 `read(query)`（按 scope 过滤）与游标分页。
 * 本实现**不接受**任何存放提案（如「读一个私有的 SQLite 句柄」），而是用 SPEC §6.3 的
 * **语义 1（省略 `scopes`，不做过滤）**逐页扫描后按 `requestId` 筛。
 * 理由：私有句柄会让本模块依赖 `src/ledger.ts` 的内部实现（一个非契约的、可随时变的细节），
 * 而审批是低频的控制面操作，一次全量分页扫描的代价可以接受；换来的是「换个账本实现也照跑」。
 *
 * ## 哪些东西刻意**没有**出现在这里
 *
 * - **`SpawnTicketId` 的随机分配器**：票号由 `requestId` **确定性派生**（`spawnTicketIdOf`）。
 *   于是「同一申请的票据」在任何进程、任何时刻都是同一个 ID；随机 ID 会让「凭票号查回申请」
 *   在进程重启后失效，也会让幂等回放产生第二个票据（同一个申请出现两张票）。
 * - **「申请已受理、待预审」这条账本事件**：SPEC §6.1 的事件表里没有它。不发明契约外的
 *   event kind 是本包的纪律（详见 `approval.ts` 的 `SpawnTicketStatus` 说明）。
 */

import type { HumanInbox, PrincipalReviewer, SpawnTicket } from './approval.ts'
import type { Ledger, LedgerPage } from './ledger.ts'
import type { MemberId, RequestId, SpawnTicketId, TeamId } from './types/ids.ts'
import type { CallerKind, TeamKind, TeamSpec } from './types/team.ts'
import type { LedgerEvent, LedgerEventOf, LedgerSequence } from './types/operations.ts'

/**
 * 拟建团规格的**转发**（SPEC §4.1 把它列在本文件下）。
 *
 * ⚠ 单一来源是 `src/types/team.ts`（`t3` 定义）。**本文件不得重写这个接口** ——
 * 重写会造出两个名义类型：`spawn/human-approved` 的事件载荷（类型层）与
 * `requestSpawn` 的入参（此处）会互相不可赋值，而报错点离原因很远。
 */
export type { TeamSpec } from './types/team.ts'

/** 一个派生申请：成员想开一个什么样的团（SPEC §4.1）。 */
export interface SpawnRequest {
  /** 幂等 + 审计键。同一 `requestId` 的重复提交按 FR-5.3.4 处理（见 SPEC §5.4）。 */
  readonly requestId: RequestId
  readonly requesterMemberId: MemberId
  /** 发起方类型：由其所处团队的 `kind` 决定。 */
  readonly requesterKind: CallerKind
  readonly targetKind: TeamKind
  /** 拟建团的规格。 */
  readonly spec: TeamSpec
}

/** 派生策略（SPEC §4.1）。 */
export interface DelegationPolicy {
  /** 该发起方允许创建的目标团队类型。 */
  readonly canSpawn: readonly TeamKind[]
  /** 目标类型 → 是否需要人类批准（两级审批）。 */
  readonly requiresApproval: Readonly<Record<TeamKind, boolean>>
}

/** 持久成员策略（FR-5.2 第一行）：两类都能开；持久团须两级审批，临时团免审（FR-5.3.5）。 */
export const PERSISTENT_POLICY: DelegationPolicy = {
  canSpawn: ['persistent', 'temporary'],
  requiresApproval: { persistent: true, temporary: false },
}

/**
 * 临时成员策略（FR-5.2 第二行）：**只能**开临时团，且免审。
 *
 * `requiresApproval.persistent` 仍是 `true` 而不是 `false` —— 该字段回答的是
 * 「该目标类型在**需要**审批时是否必须审批」，而临时成员压根到不了那一步
 * （`canSpawn` 会先拒绝）。写成 `false` 会让「临时团免审」这条判断被两个字段重复表达，
 * 从而掩盖矩阵第一格的真实来源。AC-5-1 逐字断言本对象为
 * `{persistent:true, temporary:false}`。
 */
export const TEMPORARY_POLICY: DelegationPolicy = {
  canSpawn: ['temporary'],
  requiresApproval: { persistent: true, temporary: false },
}

/** 按发起方类型取策略（SPEC §4.1）。 */
export function policyOf(caller: CallerKind): DelegationPolicy {
  return caller === 'persistent' ? PERSISTENT_POLICY : TEMPORARY_POLICY
}

/** 派生结果的错误码（SPEC §4.2）。工具层（`sophia-tools`）据此翻译成对模型可读的文本。 */
export type SpawnErrorCode = 'ERR_SPAWN_FORBIDDEN' | 'ERR_NO_DOWNGRADE_BYPASS'

/**
 * 派生结果（SPEC §4.2，**恰 5 个 `kind`**）。
 *
 * **用返回值而非异常**（SPEC §4.3）：这些分支是预期内的业务结果，不是异常。
 * 返回值让调用方被迫穷尽处理（`switch` 无 `default` 也能通过 `tsc`），
 * 而异常容易被上层 `catch` 后笼统吞掉，把一个权限拒绝变成静默失败。
 *
 * `errorCode` 是 SPEC §4.2 定义的 `SpawnErrorCode`；`forbidden` 与 `noDowngradeBypass`
 * 两个分支各自携带它，是为了让工具层不必按 `kind` 猜错误码（`SpawnErrorCode` 与
 * `kind` 一一对应，写错会在下面的注释处被看出来）。
 */
export type SpawnOutcome =
  /** 免审直建：临时团。 */
  | { readonly kind: 'created'; readonly teamId: TeamId }
  /** 持久团：第一级已过，等待人类批准。 */
  | { readonly kind: 'awaitingHumanApproval'; readonly ticketId: SpawnTicketId }
  /** 第一级被团长否决。 */
  | {
      readonly kind: 'rejectedByPrincipal'
      readonly ticketId: SpawnTicketId
      readonly reason: string
    }
  /** 权限矩阵拒绝（临时成员开持久团）——对应 `ERR_SPAWN_FORBIDDEN`。 */
  | {
      readonly kind: 'forbidden'
      readonly errorCode: 'ERR_SPAWN_FORBIDDEN'
      readonly reason: string
    }
  /** FR-5.3.4：同一 `requestId` 已被否决，禁止换目标类型绕开——对应 `ERR_NO_DOWNGRADE_BYPASS`。 */
  | {
      readonly kind: 'noDowngradeBypass'
      readonly ticketId: SpawnTicketId
      readonly errorCode: 'ERR_NO_DOWNGRADE_BYPASS'
      readonly reason: string
    }

/**
 * `decideSpawnTicket` 的结果。
 *
 * 它是 `SpawnOutcome` 的**超集**，多出两个只可能出现在第二级的 `kind`。
 * 为什么不直接复用 `SpawnOutcome`：SPEC §4.2 里没有「第二级被人类否决」这个结果，
 * 而 `decideSpawnTicket(..., 'reject')` 恰恰会走到那里。若硬塞进 `forbidden`
 * （「权限矩阵拒绝」），就把「人类否决」谎报成「你没权限」——账本上的事实与返回值互相矛盾。
 * 这样保留 `SpawnOutcome` 恰 5 个 `kind`（AC-5-4 的闭集不被污染），另立一个更宽的结果类型。
 */
export type SpawnDecisionOutcome =
  | SpawnOutcome
  /** 第二级：人类否决（FR-5.3.2）。 */
  | {
      readonly kind: 'rejectedByHuman'
      readonly ticketId: SpawnTicketId
      readonly reason: string
    }
  /**
   * 票号不可用：不存在、第二级从未开启（第一级已被否）、或**已有人类结论**（重复提交）。
   * 三种情况的共同点是「这条申请此刻不接受新的第二级结论」，故合用一个 `kind`，
   * 由 `reason` 说明具体是哪一种。
   */
  | { readonly kind: 'ticketNotFound'; readonly reason: string }

/** 派生入口的依赖（SPEC §5.2 逐字，另加 `currentHumanOperatorId`，理由见下）。 */
export interface DelegationDeps {
  readonly ledger: Ledger
  readonly inbox: HumanInbox
  /** 按 `memberId` 解析其所属团的团长（监正）。 */
  readonly principalOf: (memberId: MemberId) => Promise<PrincipalReviewer>
  /**
   * 免审路径与第二级批准后使用：真正创建团队。
   *
   * ## ⚠ 实现方**必须**遵守的接线约定（否则跨进程幂等不成立）
   *
   * 建团成功后，实现应当把 `request.requestId` **写进 `team/created` 事件**
   * （`LedgerEventBase.requestId`，不是载荷字段），并把该事件提交到同一个账本。
   *
   * 为什么这是硬要求而不是建议：本包用「账本里有没有一条带该 `requestId` 的
   * `team/created`」来判定「这条申请是否已经建过团」（见 `findTeamCreatedFor`）。
   * 这是**跨进程**幂等的唯一依据 —— 内存缓存在进程重启后为空。
   * - 遵守约定 ⇒ 重启后重投同一 `requestId`、或跨进程重复批准，都能查回同一个团，不会重复建；
   * - 不遵守 ⇒ 那些场景会各建一个团（账本上仍有痕迹，不会静默错乱，
   *   但「同一申请只建一个团」的幂等契约在跨进程维度上不成立）。
   *
   * 本包**无法**单方面保证这一点：`createTeam` 是注入的，真正落 `team/created` 的是宿主。
   * 若要彻底消除，正确做法是给账本加一条「按 `requestId` 原子占用」的能力
   * （如唯一索引）——那属于账本契约的扩展，不在本期范围。
   * OCR 评审曾就此提过 HIGH，结论是：**代码侧已无可做的守卫，只能把约定写在注入点的文档上**
   * （即这里），并如实标注残余风险，而不是留一段假装解决问题的代码。
   */
  readonly createTeam: (request: SpawnRequest) => Promise<TeamId>
  readonly now: () => number
  /**
   * 当前人类操作者标识（FR-5.3.3「两级审批人」里的第二级）。
   *
   * **为什么是依赖项而不是 `decideSpawnTicket` 的参数**：SPEC §5.2 逐字钉死了后者的入参
   * 只有 `{ticketId, decision, reason}`。把操作者身份放进入参要改契约；放在依赖里则由宿主
   * 在构造 `DelegationDeps` 时绑定（谁在操作这个窗口，宿主最清楚）。允许返回 Promise：
   * 身份解析常常要查会话。
   *
   * AC-5-9 要求该标识**非空**：实现里对空串 / 纯空白 / 非字符串一律显式抛错，
   * 绝不静默写一个空的 `humanOperatorId` 进账本 —— 那会让「谁批准的」永久丢失。
   */
  readonly currentHumanOperatorId: () => string | Promise<string>
}

/**
 * 一次已得出的结论（进程内缓存），用于把重复提交回放成同一结论。
 *
 * `targetKind` 一并记下是**必须的**，不是冗余：幂等键是**整份申请**（`requestId` + 目标类型），
 * 而「不得绕开」的封禁键才是**单独 `requestId`**（SPEC §5.4）。两者是不同粒度的规则：
 * - 同 `requestId` 同 `targetKind` 且**未被否决** → 重复提交，逐字回放原结论；
 * - 同 `requestId` **不同** `targetKind` → `noDowngradeBypass`（见 `requestSpawn` 第 2 步）。
 *
 * 若只按 `requestId` 存一条记录且不看 `targetKind`，就会开出一个真实的漏洞：
 * 持久成员先用 `R` 免审建成一个临时团，再用同一个 `R` 申请持久团 —— 幂等回放会把
 * 「已创建」再答一遍，而持久团**从未经过审批**。这条漏洞在测试里有专门的用例守着。
 */
interface DecidedRecord {
  readonly outcome: SpawnOutcome
  readonly targetKind: TeamKind
  /** 已创建的真实 `teamId`（结论为 `created` 时）。回放时直接返回它。 */
  readonly teamId?: TeamId | undefined
}

/**
 * 「该 `requestId` 已被否决，整体作废」的早期短路判定（SPEC §5.4）。
 *
 * **只看 `rejectedByPrincipal` 一个分支**，因为只有它是「下游分支都覆盖不到」的那一种。
 * 这不是推断，是变异测试一步步逼出来的结论（三次收窄）：
 *
 * | 写过什么 | 变异结果 |
 * |---|---|
 * | 另设一张按 `requestId` 索引的「已否决」表 | 把读改恒假 / 把写键改成 `requesterMemberId` —— 全绿 ⇒ **整张表是冗余**，删除 |
 * | 在 `DecidedRecord` 上存 `rejected: boolean` | 把人类否决那处改成 `rejected: false` —— 全绿 ⇒ 该标志在人类路径上冗余，删除 |
 * | 本函数同时判 `rejectedByPrincipal \\|\\| noDowngradeBypass` | 去掉 `noDowngradeBypass` —— 全绿 ⇒ 该分支也冗余，收窄为只判前者 |
 *
 * 为什么人类否决那条不需要在这里判：它在 `decided` 里存的 `outcome.kind` 就是
 * `noDowngradeBypass`，于是无论后续提交的 `targetKind` 是原样还是换类型，
 * 下游的两个分支（第 4 步的「类型不一致」与幂等回放 `switch` 的 `noDowngradeBypass` 分支）
 * 都必然给出 `noDowngradeBypass`。留着只会是一段永不生效、却可能与真相分叉的代码。
 *
 * 为什么第一级否决**必须**在这里判：它在 `decided` 里存的是 `rejectedByPrincipal`，
 * 而幂等回放 `switch` 的该分支是**逐字回放原结论**。不在这里拦，
 * 「同 `requestId` 原样重投」就会拿回上一次的 `rejectedByPrincipal`
 * —— 而 §5.4 要求的是 `noDowngradeBypass`。（AC-5-10 的强形式用例守着这条。）
 */
function isRejectedOutcome(outcome: SpawnOutcome): boolean {
  return outcome.kind === 'rejectedByPrincipal'
}

/**
 * 在途申请（并发去重）。
 *
 * 与 `DecidedRecord` 分开记 `targetKind`：结论未出时也要能判断「第二次提交是不是同一份申请」。
 */
interface InFlightRecord {
  readonly targetKind: TeamKind
  readonly promise: Promise<SpawnOutcome>
}

/**
 * 进程内的幂等状态。
 *
 * 用 `WeakMap` 挂在 `Ledger` 对象上而不是模块级 `Map`：模块级会让**两个不同账本**
 * （例如测试里的两个 `:memory:` 库）互相串味；`WeakMap` 的键是账本本身，生命周期随之
 * （账本被回收，缓存即消失）。
 *
 * ## 为什么只有一张表（曾经有过第二张 `rejected: Map<requestId, TeamKind>`）
 *
 * 起初另设了一张「被否过的 requestId」表来实现 §5.4。**变异测试证明它是纯冗余**：
 * 把它的读取改恒假（`if (false)`）、把它的写入键从 `requestId` 改成 `requesterMemberId`，
 * 两套命令**仍然全绿** —— 因为 `decided` 表已经覆盖了全部判定：
 * - 同类型重复提交 → `decided` 命中且类型相同 → 逐字回放原否决结论；
 * - 换类型重提 → `decided` 命中但类型不同 → `noDowngradeBypass`。
 *
 * 两张表互相冗余不只是「多余」：它们可以各自演化并**悄悄分叉**，而分叉的表现是
 * 「同一份申请这次被拦、下次放行」。故删掉第二张表，只留一个真相来源。
 * （这条结论由 15 个变异体实测得出，不是推断。）
 *
 * ## 内存增长特征（OCR 评审 [5]：如实标注，不做无依据的优化）
 *
 * 三张表都按 `requestId` 累积，**随 `Ledger` 对象存活**、没有淘汰。
 * 判断「要不要加 LRU」依据的是量级而不是「理论上会涨」：
 * - 这些条目只在**派生/审批**时产生 —— 是控制面操作，人（或团长）实际发起的频率
 *   是「每小时几条到几十条」量级，而不是数据面的每条消息；
 * - 每条记录是几个字符串 + 一个小的 `SpawnOutcome` 对象（数十~数百字节）。
 *   按 100 条/小时、连续跑 30 天估算约 7 万条、个位数 MB —— 与 `Ledger` 本身
 *   （每条事件都要写 SQLite）相比可以忽略：**真正会先撞墙的是账本，不是这个缓存**。
 * ⇒ 当前**不加** LRU：它会引入淘汰时机与「淘汰后又重复建团」的新正确性问题，
 *   换来的收益按上述量级可以忽略。等真的观察到内存压力，或 `sophia-tools`
 *   暴露出高频自动派生路径时再加，届时也应同时给出实测增长数据。
 * （判据来自本仓纪律：理论上存在但现实中几乎不触发的缺陷，判「可不做」并写明依据。）
 */
interface DelegationRuntimeState {
  readonly decided: Map<string, DecidedRecord>
  readonly inFlight: Map<string, InFlightRecord>
  /**
   * 第二级（人类决议）的在途调用，按 `requestId` 索引。
   *
   * **必须与 `inFlight` 分开**：两者的键空间与语义都不同 —— `inFlight` 键的是
   * 「谁在发起派生」（`requestSpawn`），这里是「谁在对某张票作结论」（`decideSpawnTicket`）。
   * 共用一张表会让「正在发起」与「正在审批」互相冒充。
   *
   * 为什么必须存在（OCR 评审 [1] 抓出的 HIGH）：`decideSpawnTicket` 的查重是**读账本**的，
   * 而两次并发 `approve` 都会在对方落 `spawn/human-approved` **之前**读到「尚无人类结论」，
   * 于是各自 `createTeam` —— 一个票号建出两个团。这与 `requestSpawn` 免审路径上的那个缺陷
   * 是同一类：**读-判断-写**之间存在 `await` 窗口，只有「在途注册」能关上它。
   * 同样地，并发的「批准 + 否决」会落下**两条互相矛盾**的人类结论 —— 也由它拦住。
   */
  readonly deciding: Map<string, Promise<SpawnDecisionOutcome>>
}

const runtimeStates = new WeakMap<Ledger, DelegationRuntimeState>()

function stateOf(ledger: Ledger): DelegationRuntimeState {
  const existing = runtimeStates.get(ledger)
  if (existing !== undefined) {
    return existing
  }
  const created: DelegationRuntimeState = {
    decided: new Map(),
    inFlight: new Map(),
    deciding: new Map(),
  }
  runtimeStates.set(ledger, created)
  return created
}

/** 票据 ID 的确定性派生（见文件头的「刻意没有」一节）。 */
export function spawnTicketIdOf(requestId: RequestId): SpawnTicketId {
  return `ticket:${requestId}` as SpawnTicketId
}

/** 票号前缀，与 `spawnTicketIdOf` 成对（仅在 `requestIdOfTicket` 里使用）。 */
const TICKET_ID_PREFIX = 'ticket:'

/** 审批链上会被投影成票据的四类事件。 */
type SpawnTicketEvent =
  | LedgerEventOf<'spawn/principal-rejected'>
  | LedgerEventOf<'spawn/awaiting-human-approval'>
  | LedgerEventOf<'spawn/human-approved'>
  | LedgerEventOf<'spawn/human-rejected'>

/** 单页扫描上限（SPEC §6.3：`limit` 最大 1000）。 */
const SCAN_PAGE_LIMIT = 1000

/**
 * 逐页走完整个账本，对每条事件调用 `visit`（OCR 评审 [4]：抽出重复的分页逻辑）。
 *
 * `Ledger.read` 是游标分页（`afterSequence` 严格大于 + `nextCursor`/`hasMore`），
 * 而 SPEC §6.2 的 `Ledger` 接口上**没有**「按 requestId / kind 过滤」的方法
 * （只有按 scope 过滤的 `read`，而审批事件投的是别的 scope）。故本模块的两次投影
 * （收集审批链事件、找已建成的团）都只能全量扫，各自写一遍分页循环就是两份会分叉的游标处理。
 *
 * `visit` 返回 `true` 表示「可以停下来了」，此时本函数立即返回。
 */
function scanAllPages(ledger: Ledger, visit: (event: LedgerEvent) => boolean | void): void {
  let cursor: LedgerSequence | null = null
  for (;;) {
    // 显式标注 `LedgerPage`：`cursor` 的类型取决于上一轮的 `page.nextCursor`，而 `page`
    // 又取决于 `cursor` —— 不标注会让 `tsc` 判定这是循环推断（TS7022）。
    const page: LedgerPage =
      cursor === null
        ? ledger.read({ limit: SCAN_PAGE_LIMIT })
        : ledger.read({ afterSequence: cursor, limit: SCAN_PAGE_LIMIT })
    for (const event of page.events) {
      if (visit(event) === true) {
        return
      }
    }
    if (!page.hasMore || page.nextCursor === null) {
      return
    }
    cursor = page.nextCursor
  }
}

/**
 * 按 `requestId` 从账本收集审批链事件（SPEC §6.3 语义 1：不过滤，全部事件）。
 *
 * 返回按 `sequence` **升序**（`Ledger.read` 保证升序，逐页拼接自然保持有序）。
 * 只认 `requestId` 相等的事件 —— 这也是「不得绕开按 requestId 绑定」在数据层的样子：
 * 判定依据就是事件基座上的这个字段（`LedgerEventBase.requestId`），不是发起成员。
 */
function collectSpawnEvents(ledger: Ledger, requestId: RequestId): readonly SpawnTicketEvent[] {
  const found: SpawnTicketEvent[] = []

  scanAllPages(ledger, (event) => {
    if (event.requestId !== requestId) {
      return
    }
    switch (event.kind) {
      case 'spawn/principal-rejected':
      case 'spawn/awaiting-human-approval':
      case 'spawn/human-approved':
      case 'spawn/human-rejected':
        found.push(event)
        break
      default:
        // 其余事件与票据无关。不写 `assertNever`：这里的 `switch` 是**筛选**而非穷尽分发，
        // 将来新增 kind 时不该在这里编译报错（新增的 kind 默认就是「与票据无关」）。
        break
    }
  })

  return found
}

/**
 * 找出「已经为这条申请建成」的团队（靠 `team/created` 事件上的 `requestId` 关联）。
 *
 * 为什么需要它：`decideSpawnTicket` 的授权路径是「先落 `spawn/human-approved`，再 `createTeam`」。
 * 若 `createTeam` 失败或进程在两者之间崩溃，账本上就留下「已批准但团不存在」。
 * 重试时必须能区分这两种情况 —— 否则重试要么建出**第二个**团，要么永远建不出来。
 *
 * 关联键是事件基座的 `requestId`（`TeamCreatedData` 本身没有该字段，但 `LedgerEventBase` 有）。
 * 宿主建团时若**没有**把 `requestId` 写进 `team/created`，本函数就找不到它 →
 * 返回 `null` → 调用方走「续做建团」。那种情况下仍可能建出第二个团，
 * **但这是接线约定问题而非本包能单方面解决的**：`DecidedRecord` 的内存回放
 * 覆盖了同一进程内的重复批准，跨进程的那一半依赖宿主按约定写 `requestId`。
 * 这一点在返回类型里如实暴露（`ticketNotFound` 的 `reason` 会说明），不假装已经解决。
 *
 * **取 `sequence` 最大的那条**（OCR 评审 [2]）：同一个 `requestId` 上理论上可能有多条
 * `team/created`（例如批准→建团→团被销毁后重试）。取第一条会把**陈旧**的团交给调用方，
 * 并让刚建出来的新团静默丢失。最新的一条才代表「此刻这个申请对应的团」。
 * 先收齐再取最大，而不是「遇到就返回」—— 后者依赖事件顺序，是这里最容易写错的地方。
 */
function findTeamCreatedFor(ledger: Ledger, requestId: RequestId): TeamId | null {
  // 用数组累积而不是「在闭包里更新一个 `let latest`」：后者的控制流分析在回调里不可靠
  // （`tsc` 会把闭包外的变量收窄成 `never`，实际写出来就是 TS2339）。
  // 这里的形状与 `collectSpawnEvents` 保持一致，两处都好读。
  const matches: { readonly sequence: LedgerSequence; readonly teamId: TeamId }[] = []

  scanAllPages(ledger, (event) => {
    if (event.kind !== 'team/created' || event.requestId !== requestId) {
      return
    }
    // ⚠ **运行期收窄载荷**（OCR 评审 [12] 的 HIGH）：`isLedgerEvent` 只保证 `data` 是
    // 非 null 对象，**不保证它与 `kind` 匹配**。一条载荷畸形（例如 `data: {}`）的
    // `team/created` 会让 `event.data.teamId` 取到 `undefined`，而本函数的返回类型是
    // `TeamId | null` —— 于是 `undefined` 被当成一个「真实的 teamId」交给调用方，
    // 恢复路径会返回 `{kind:'created', teamId: undefined}`：一个 **phantom success**。
    // 实测后果：调用方拿到"建团成功"，而 `createTeam` 从未被调用（团根本不存在）。
    //
    // 处置与 `readSpawnTicket` 对畸形载荷的处置一致（那里有对应用例）：**拒绝采信**，
    // 即「这一行证明不了团已建成」→ 不 push → 最终返回 null → 调用方走「续做建团」。
    // 不抛错：抛错会让这条申请永久卡死，正是本函数要修的那种状态。
    const teamId: unknown = event.data.teamId
    if (typeof teamId !== 'string' || teamId.trim() === '') {
      return
    }
    matches.push({ sequence: event.sequence, teamId: teamId as TeamId })
  })

  let newest: { readonly sequence: LedgerSequence; readonly teamId: TeamId } | null = null
  for (const match of matches) {
    if (newest === null || match.sequence > newest.sequence) {
      newest = match
    }
  }
  return newest === null ? null : newest.teamId
}
/**
 * 从账本事实重建一张票据（公理 4）。
 *
 * **不可重建时返回 `null`**，而不是拼一张半成品票据 —— 半成品会让调用方以为
 * 「票据存在但内容为空」，而真相是「这条申请没有可投影的事实」。
 *
 * 状态判定取**优先级最高**的那条结论事件（`events` 已按 `sequence` 升序）：
 * - 有 `human-rejected` → `rejected-human`
 * - 否则有 `human-approved` → `approved`
 * - 否则有 `awaiting-human-approval` → `pending-human`
 * - 否则有 `principal-rejected` → `rejected-principal`
 * - 都没有 → `null`
 *
 * 载荷字段**逐个做运行期类型检查**：`isLedgerEvent` 只验结构、**不验载荷**
 * （见 `types/guards.ts` 的边界说明），所以「Kind 与载荷匹配」这件事必须由消费方自己保证。
 *
 * ## 关于 `rejected-principal`（captain 裁定 Q-E，SPEC §11）
 *
 * 本函数**曾经**对「只被第一级否决的申请」返回 `null`，因为当时 §6.1 的
 * `spawn/principal-rejected` 载荷里没有 `spec`，而 `SpawnTicket.spec` 是必填（§5.1）——
 * 两者不可能同时成立。当时的处置是**如实返回 null**，刻意不填
 * `{name:'',roster:[],tasks:[]}` 空规格（空规格看起来是合法 `TeamSpec`，
 * 调用方会当真值用，属「跑得通但内容全错」，比「明确没有」危险得多）。
 *
 * captain 核查时发现这其实是**契约漏写**：第二级的 `human-approved` / `human-rejected`
 * 两种载荷**都**带 `targetKind` + `spec`，只有第一级的否决什么都不带 ——
 * 两级审批在流程上是对称的（同一次申请、同一份规格，只是审核人不同），
 * 载荷也应当对称。故裁 **(a) 扩载荷**，`spec` 与 `targetKind` 一并补上（同一处漏写）。
 * 现在本函数对 `rejected-principal` 返回**真票据**，该状态由「不可达」变为可达。
 *
 * 仍保留「不编造」的纪律：若载荷里的 `spec` 不是对象（例如宿主用旧版载荷落账），
 * 依然返回 `null` 而不是补一个空规格 —— 那条纪律的正确性与 Q-E 无关。
 */
export function readSpawnTicket(ledger: Ledger, requestId: RequestId): SpawnTicket | null {
  const events = collectSpawnEvents(ledger, requestId)
  const first = events[0]
  if (first === undefined) {
    return null
  }

  // 载荷字段的运行期收窄。`requesterMemberId` / `principalMemberId` 在运行期都是普通字符串
  // （品牌只存在于类型层），因此这里能做的只有「是不是非空字符串」。
  const requesterMemberId = first.data.requesterMemberId
  const principalMemberId = first.data.principalMemberId
  const targetKind = first.data.targetKind
  if (
    typeof requesterMemberId !== 'string' ||
    requesterMemberId === '' ||
    typeof principalMemberId !== 'string' ||
    principalMemberId === '' ||
    (targetKind !== 'persistent' && targetKind !== 'temporary')
  ) {
    return null
  }

  const approved = events.find((event) => event.kind === 'spawn/human-approved')
  const humanRejected = events.find((event) => event.kind === 'spawn/human-rejected')
  const awaiting = events.find((event) => event.kind === 'spawn/awaiting-human-approval')
  const principalRejected = events.find((event) => event.kind === 'spawn/principal-rejected')

  let status: SpawnTicket['status']
  let specSource: SpawnTicketEvent | undefined
  let rejectionReason: string | null

  if (humanRejected !== undefined) {
    status = 'rejected-human'
    specSource = humanRejected
    rejectionReason = humanRejected.data.reason
  } else if (approved !== undefined) {
    status = 'approved'
    specSource = approved
    rejectionReason = null
  } else if (awaiting !== undefined) {
    status = 'pending-human'
    specSource = awaiting
    rejectionReason = null
  } else if (principalRejected !== undefined) {
    // 被第一级否决 —— **可投影**（captain 裁定 Q-E，SPEC §11）。
    // Q-E 之前这里返回 `null`，因为当时 `spawn/principal-rejected` 载荷里没有 `spec`；
    // 现在载荷与第二级对称地携带 `targetKind` + `spec`，故能给出真票据。
    status = 'rejected-principal'
    specSource = principalRejected
    rejectionReason = principalRejected.data.reason
  } else {
    return null
  }

  if (specSource === undefined) {
    return null
  }
  const spec = specSource.data.spec
  if (typeof spec !== 'object' || spec === null) {
    return null
  }

  const humanDecidedAtSequence =
    humanRejected !== undefined ? humanRejected.sequence : approved?.sequence
  // `decidedAtSequence` 的优先级必须与上面 `status` 的判定**逐条对应**（OCR 评审 [2]）：
  // 否则当账本里同时存在 approved 与 human-rejected 时，会投影出
  // 「status=rejected-human 但 humanDecidedAtSequence 指向 approval」这种自相矛盾的票据。
  const decidedAtSequence = awaiting?.sequence ?? specSource.sequence

  return {
    ticketId: spawnTicketIdOf(requestId),
    requestId,
    requesterMemberId,
    principalMemberId,
    targetKind,
    spec,
    status,
    raisedAtSequence: first.sequence,
    // 票据出现的那一刻就是「第一级已得出结论」的那一刻（见 approval.ts 对
    // `pending-principal` 不可达的说明），故第一级结论序号与 `raisedAtSequence` 同源。
    principalDecidedAtSequence: decidedAtSequence,
    humanDecidedAtSequence,
    ...(rejectionReason === null ? {} : { reason: rejectionReason }),
  }
}

/**
 * 可读的中文拒因（AC-5-2：**同时**说明「为什么不行」与「该怎么办」）。
 *
 * 两个要点写进同一句话，是因为调用方（工具层）通常原样转给模型看：
 * 只说「无权」会让模型反复重试；只说「该怎么办」又不解释被拒的原因。
 */
function forbiddenReason(request: SpawnRequest): string {
  return (
    `临时成员（${request.requesterMemberId}）无权创建持久团队：临时团是任务组、完成即回收（FR-5.1），` +
    '而持久团需要长期编制与跨会话存续，其准入由两级审批把关，临时成员不在该权限矩阵内（FR-5.2.1）。' +
    '如需长期编制的团队，请把需求汇报给你所在团的团长（监正），由持久成员发起创建。'
  )
}

function noDowngradeReason(request: SpawnRequest, targetKind: TeamKind): string {
  return (
    `申请 ${request.requestId} 已被否决，不能再以同一申请改开 ${targetKind} 团来绕开审批（FR-5.3.4）：` +
    '否决针对的是这次申请本身，换个目标类型重提会让「需要批准」形同虚设。' +
    '请换一个新的 requestId 重新发起；临时团本身无需审批，换新申请即可直接创建（FR-5.3.5）。'
  )
}

/** 人类操作者标识的校验（AC-5-9：**不得为空**）。 */
function requireHumanOperator(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new TypeError(
      `DelegationDeps.currentHumanOperatorId 返回了空标识（${JSON.stringify(raw)}）：` +
        'FR-5.3.3 要求账本记下两级审批人，人类操作者标识是其中之一。' +
        '空串会让「谁批准的」永久丢失，故此处硬拒绝而不是静默写空。',
    )
  }
  return raw
}

/**
 * 审批路径：① 团长预审 → ② 推送人类收件箱（SPEC §5.3 的图，**顺序不可调换**）。
 *
 * 若调换这两步，被团长否决的申请也会出现在人类待办里 —— 这正是 AC-5-6 的反恒真手法。
 * `principalOf` 在本函数里**恰好调用一次**：重复调用既浪费，也会让「团长是谁」在
 * 同一次申请里出现两个答案（fake 每次返回不同值时尤其明显）。
 *
 * ## 可恢复性（OCR 评审 [1] 的 HIGH —— 这里曾有一个真缺陷）
 *
 * `awaiting` 事件在 `inbox.push` **之前**落账，而调用方的幂等缓存只在整条链路
 * **成功返回后**才写。于是 push 抛错时缓存是空的，重试会**重新走一遍本函数**：
 * 再预审一次、再落一条 `awaiting`、再推一次收件箱（实测：重试后账本里有 **2** 条 awaiting）。
 *
 * 修法：进入本函数后先看账本**是否已有** `awaiting` 事件。
 * - 有 ⇒ 说明这条申请**已经过了第一级**，只需补做第 ② 步（推送），
 *   **不重跑预审、不重复落账**。这既修了重复落账，也避免「第二次预审给出相反结论
 *   从而落出互相矛盾的事件」这种更坏的情况（预审结论本该只产生一次）。
 * - 没有 ⇒ 正常走 ①②。
 *
 * 之所以能靠账本判断：`awaiting` 事件带的 `requestId` 就是本次申请的键，
 * 而账本是只追加且持久的事实来源 —— 以此为准比靠内存缓存更可靠（跨进程也成立）。
 */
async function runApprovalPath(deps: DelegationDeps, request: SpawnRequest): Promise<SpawnOutcome> {
  const ticketId = spawnTicketIdOf(request.requestId)
  const alreadyAwaiting = collectSpawnEvents(deps.ledger, request.requestId).some(
    (event) => event.kind === 'spawn/awaiting-human-approval',
  )

  if (alreadyAwaiting) {
    // 第一级已经过了（事件在账本上），只补第 ② 步。**不重跑预审、不重复落账。**
    await pushTicketToInbox(deps, ticketId, request.spec.name)
    return { kind: 'awaitingHumanApproval', ticketId }
  }

  let principal: PrincipalReviewer
  try {
    principal = await deps.principalOf(request.requesterMemberId)
  } catch (cause) {
    // 团长身份解析不了 = 这条申请无法进入第一级。此时**零副作用**（没建团、没推收件箱）。
    // 抛错而不是静默返回 `forbidden`：这不是权限结论，而是宿主接线问题，吞掉它会让人查不出原因。
    throw new Error(
      `无法为成员 ${request.requesterMemberId} 解析所属团的团长（principalOf 抛错），` +
        `申请 ${request.requestId} 未能进入第一级预审：${String(cause)}`,
      { cause },
    )
  }

  let verdict: Awaited<ReturnType<PrincipalReviewer['reviewSpawn']>>
  try {
    verdict = await principal.reviewSpawn(request)
  } catch (cause) {
    throw new Error(
      `团长（监正）${principal.memberId} 预审申请 ${request.requestId} 时抛错，未能得出结论：${String(cause)}`,
      { cause },
    )
  }

  // ① 第一级否决 ⇒ **立即中止**，不落 awaiting、不推收件箱、不建团（AC-5-6）。
  if (!verdict.approved) {
    const reason =
      verdict.reason !== undefined && verdict.reason.trim() !== ''
        ? verdict.reason
        : '团长（监正）预审未通过（未说明理由）。'

    // 否决**必须落账本**（`spawn/principal-rejected`）：否则「这条申请被否过」这个事实
    // 只存在于进程内存里，重启后 §5.4 的「不得绕开」就失效了。
    //
    // 载荷携带 `targetKind` 与 `spec`（captain 裁定 Q-E，SPEC §11）：两级审批是对称的，
    // 第二级的两种否决都带完整规格，第一级也应当带 —— 缺了 `spec`，
    // `readSpawnTicket` 就投影不出 §5.1 要求的真票据（那正是 Q-E 要修的冲突）。
    deps.ledger.commit({
      kind: 'spawn/principal-rejected',
      actor: { kind: 'member', memberId: principal.memberId },
      requestId: request.requestId,
      occurredAt: deps.now(),
      data: {
        requestId: request.requestId,
        requesterMemberId: request.requesterMemberId,
        principalMemberId: principal.memberId,
        targetKind: request.targetKind,
        spec: request.spec,
        reason,
      },
    })

    return {
      kind: 'rejectedByPrincipal',
      ticketId: spawnTicketIdOf(request.requestId),
      reason,
    }
  }

  // ② 第二级：落 `awaiting` 事件（票据由此可被投影出来）+ 推送人类收件箱。**此前不创建**（AC-5-7）。
  deps.ledger.commit({
    kind: 'spawn/awaiting-human-approval',
    actor: { kind: 'member', memberId: request.requesterMemberId },
    requestId: request.requestId,
    occurredAt: deps.now(),
    data: {
      requestId: request.requestId,
      requesterMemberId: request.requesterMemberId,
      principalMemberId: principal.memberId,
      targetKind: request.targetKind,
      spec: request.spec,
    },
  })

  await pushTicketToInbox(deps, ticketId, request.spec.name)

  return { kind: 'awaitingHumanApproval', ticketId }
}

/**
 * 把待办推给人类收件箱（第 ② 步）。
 *
 * 抽成函数而不是两处各写一遍（OCR 评审 [4]）：本函数的两处调用点（首次进入第二级、
 * 以及「push 失败后重试」的补推）**必须逐字同形** —— 两条路径的差别只在于
 * 「要不要重跑预审、要不要再落一条 awaiting」，推送内容本身没有任何理由不同。
 * 各写一份的话，改了其中一处的标题格式就会让重试推出一条不同的待办，
 * 而那种不一致极难在评审中看出来（两段代码相隔近 100 行）。
 */
async function pushTicketToInbox(
  deps: DelegationDeps,
  ticketId: SpawnTicketId,
  specName: string,
): Promise<void> {
  await deps.inbox.push({
    ticketId,
    title: `成员请求创建持久团：${specName}`,
    actions: ['approve', 'reject'],
  })
}

/**
 * 派生入口（SPEC §5.2 / FR-5.2 / FR-5.3）。
 *
 * 判定顺序（即契约，对应 SPEC §5.3 的图）：
 *
 * 1. **权限矩阵**：`policy.canSpawn` 不含目标类型 → `forbidden`，**零副作用**（AC-5-2）。
 * 2. **不得绕开**（§5.4）：该 `requestId` 被否过 → 同类型则逐字回放原否决结论，
 *    换类型则 `noDowngradeBypass`；两种情况都**零副作用**。
 * 3. **并发去重**：同一 `requestId` + 同一 `targetKind` 已有在途 Promise → `await` 它，
 *    两次调用得到同一份结论（不新增 `kind`：`SpawnOutcome` 是恰 5 个 `kind` 的闭集，AC-5-4）。
 * 4. **幂等回放**：同一 `(requestId, targetKind)` 已出结论 → 逐字回放结论，
 *    不重复建团、不重复推收件箱。同一 `requestId` 换成**另一种** `targetKind` → `noDowngradeBypass`
 *    （依据见该分支的注释：`requestId` 是「一次派生意图」的幂等键）。
 * 5. **免审路径**（FR-5.3.5）：`requiresApproval[targetKind] === false` → 直接 `createTeam`。
 *    此路径**不调用** `principalOf`、**不调用** `inbox.push`（AC-5-5）。
 * 6. **审批路径**：见 `runApprovalPath`。
 *
 * 第 1–4 步全是同步判定，之间没有 `await`，因此在途注册与查表不会交错
 * （JS 单线程，同步段不可被打断）—— 这就是「并发去重」能成立的原因。
 *
 * ⚠ **`inbox.push` 抛错时不会**把结果降级成任何「看起来像成功」的分支：错误照常抛出，
 * 而 `awaiting` 事件**已经落账**（账本才是事实）。重试**不会**重复落账或重跑预审 ——
 * 但**不是**靠第 4 步的内存幂等回放（缓存要到成功返回后才写，抛错时它是空的），
 * 而是靠 `runApprovalPath` 开头那次**账本查询**：它看到已有的 `awaiting` 便只补推送。
 * （先前这里的注释把功劳记在了内存回放上，与代码不符 —— OCR 评审 [1] 抓出并已更正；
 * 对应的重复落账缺陷有专门用例守着。）
 */
export async function requestSpawn(
  deps: DelegationDeps,
  request: SpawnRequest,
): Promise<SpawnOutcome> {
  const state = stateOf(deps.ledger)
  const policy = policyOf(request.requesterKind)

  // —— 1. 权限矩阵（AC-5-1 第一格 / AC-5-2）——
  if (!policy.canSpawn.includes(request.targetKind)) {
    return {
      kind: 'forbidden',
      errorCode: 'ERR_SPAWN_FORBIDDEN',
      reason: forbiddenReason(request),
    }
  }

  // —— 2. 「不得绕开」（§5.4 / AC-5-10…AC-5-12）——
  //
  // SPEC §5.4 的措辞是：同一 `requestId` 一旦被否决，后续以该 `requestId` 发起的**任何**
  // 派生 —— 无论 `targetKind` 是什么 —— 一律返回 `noDowngradeBypass`。
  // 因此这里不区分「换类型」还是「原样重投」：被否过的 `requestId` 整体作废。
  //
  // 判定见 `isRejectedOutcome` 的说明（该函数是 §5.4 唯一的早期短路点）。
  // 为什么不另设一张「被否过的 requestId」表：变异测试实测过 —— 那样的表是纯冗余
  // （把它的读改恒假、把写键改成 `requesterMemberId`，两套命令仍全绿，因为它覆盖的
  // 每一种情形 `decided` 都已覆盖）。两张冗余的表会各自演化并悄悄分叉，
  // 分叉的表现是「同一份申请这次被拦、下次放行」—— 故只留一张表。
  const decided = state.decided.get(request.requestId)
  if (decided !== undefined && isRejectedOutcome(decided.outcome)) {
    return {
      kind: 'noDowngradeBypass',
      ticketId: spawnTicketIdOf(request.requestId),
      errorCode: 'ERR_NO_DOWNGRADE_BYPASS',
      reason: noDowngradeReason(request, request.targetKind),
    }
  }

  // —— 3. 在途申请（并发去重）：同一份申请直接共享同一个 Promise ——
  const inFlight = state.inFlight.get(request.requestId)
  if (inFlight !== undefined) {
    if (inFlight.targetKind === request.targetKind) {
      return inFlight.promise
    }
    // 同一 `requestId` 同时挂着两种目标类型的申请：一个 `requestId` 只代表**一次**派生意图，
    // 放行会让它同时占着「免审直建」与「审批中」两条路。判 `noDowngradeBypass`（不得创建）。
    return {
      kind: 'noDowngradeBypass',
      ticketId: spawnTicketIdOf(request.requestId),
      errorCode: 'ERR_NO_DOWNGRADE_BYPASS',
      reason: noDowngradeReason(request, request.targetKind),
    }
  }

  // —— 4. 幂等回放：键 = `requestId` + `targetKind` ——
  if (decided !== undefined) {
    if (decided.targetKind !== request.targetKind) {
      // 同一 `requestId` 已用于**另一种**目标类型（且它没被否决 —— 被否决的在上一步已拦下）。
      //
      // 依据是 **FR-5.3.4 的原文**：「**未获批准时**，不允许该成员降级为『先开个临时团凑合』」。
      // 注意它说的是「未获批准时」而不只是「被否决后」：`R` 正在两级审批中时，
      // 用同一个 `R` 去开一个免审的临时团，正是「先开个临时团凑合」的字面情形 ——
      // 若放行，`R` 会既产出一个临时团、又继续等着人类批准一个持久团，
      // 「需要批准」就此形同虚设（人批的那个团根本不是成员真正在用的那个）。
      //
      // 这条收紧**不削弱 FR-5.3.5**：换一个新的 `requestId` 开临时团依然免审直建（AC-5-11）。
      return {
        kind: 'noDowngradeBypass',
        ticketId: spawnTicketIdOf(request.requestId),
        errorCode: 'ERR_NO_DOWNGRADE_BYPASS',
        reason: noDowngradeReason(request, request.targetKind),
      }
    }
    switch (decided.outcome.kind) {
      case 'created':
        // `teamId` 与 `outcome` 是同一次 `set` 写入的，故这里必然有值。
        // 若哪天真取不到（说明有人改坏了写入处），**显式抛错**而不是 `break` 落到下面的建团路径 ——
        // 落到那里会对一个**已创建**的申请再 `createTeam` 一次（OCR 评审 [4]，已采纳）。
        // 一句 `throw` 把「不变量被破坏」与「正常业务分支」彻底分开：
        // 后者是返回值，前者必须响亮地失败。
        if (decided.teamId === undefined) {
          throw new Error(
            `内部不变量被破坏：申请 ${request.requestId} 的结论是 created，但幂等记录里没有 teamId。` +
              '二者由同一次 state.decided.set 写入，出现此错说明写入处被改坏。' +
              '拒绝继续（否则会对已创建的申请再建一个团）。',
          )
        }
        return { kind: 'created', teamId: decided.teamId }
      case 'noDowngradeBypass':
        return {
          kind: 'noDowngradeBypass',
          ticketId: spawnTicketIdOf(request.requestId),
          errorCode: 'ERR_NO_DOWNGRADE_BYPASS',
          reason: noDowngradeReason(request, request.targetKind),
        }
      case 'rejectedByPrincipal':
        // 回放**逐字返回原结论**（含原 `reason`）：重复提交不该让同一条申请产生
        // 两个不同的返回值 —— 那会让「按 requestId 幂等」变成「第一次和第二次说法不同」。
        // （注意：被否过的 `requestId` 在第 2 步就被短路成 `noDowngradeBypass`，
        //  故这条只在「第一级没否、但结论恰好是 rejectedByPrincipal」这种不可能的情形下才走到 ——
        //  保留它是为了让这个 `switch` 对 `SpawnOutcome` **穷尽**，`tsc` 才能替我们守住新增分支。）
        return { ...decided.outcome }
      case 'awaitingHumanApproval':
        // 同上，逐字回放。`awaitingHumanApproval` 载荷里**没有** `reason` 字段
        // （SPEC §4.2 的形状），故不能往它上面挂说明文字。
        return { ...decided.outcome }
      case 'forbidden':
        // ⚠ **不可达**：`forbidden` 从不写入 `decided`（唯一的免审/审批写入点分别记
        // `created` 与审批结论；权限拒绝在第 1 步直接返回、不落状态）。
        // 保留这一支同样是为了**穷尽性** —— 删掉它 `tsc` 会报 `switch` 未覆盖。
        // 真要走到这里（说明有人给 `decided` 写了 `forbidden`），如实返回同一个结论即可。
        return {
          kind: 'forbidden',
          errorCode: 'ERR_SPAWN_FORBIDDEN',
          reason: forbiddenReason(request),
        }
    }
  }

  // —— 5. 免审路径（AC-5-5：`principalOf` 0 次、`inbox.push` 0 次）——
  //
  // ⚠ **免审路径也必须在途注册**（OCR 评审 [1] 抓出的真缺陷，已补测试）。
  // 起初这里只是 `await deps.createTeam(request)` 然后写 `decided` —— 于是两次并发调用
  // 都会读到「`decided` 为空、`inFlight` 也为空」，各自 `await` 一次建团，
  // 一个 `requestId` 建出**两个团**。文件头说「第 1–4 步同步 ⇒ 不会交错」是对的，
  // 但那句话只保证「判断」不交错，**不保证 `await` 之后写回之前没有窗口** ——
  // `await createTeam` 正是那个窗口。修法：与审批路径同构，先注册在途 Promise 再 await。
  if (!policy.requiresApproval[request.targetKind]) {
    // **跨进程幂等**（OCR 评审 [3]）：内存缓存（上面的 `decided`）随进程消失，
    // 但账本是持久的。若宿主按约定把 `requestId` 写进了 `team/created`，
    // 重启后重投同一 `requestId` 就能查出「这个团早已建过」，从而**不重复建团**。
    // 这与 `decideSpawnTicket` 的恢复路径用的是同一个助手、同一份接线约定。
    const existingTeamId = findTeamCreatedFor(deps.ledger, request.requestId)
    if (existingTeamId !== null) {
      state.decided.set(request.requestId, {
        outcome: { kind: 'created', teamId: existingTeamId },
        targetKind: request.targetKind,
        teamId: existingTeamId,
      })
      return { kind: 'created', teamId: existingTeamId }
    }

    // 两条路径共用同一种在途记录（`Promise<SpawnOutcome>`），因此这里把 `TeamId` 就地包成
    // `{ kind: 'created', teamId }`。**这不是为了类型好看**：不包的话，并发的第二次调用
    // `return inFlight.promise` 会把一个裸 `TeamId` 字符串当成 `SpawnOutcome` 返回给调用方
    // （我第一版就是这样，`r.kind` 读出 `undefined`，被测试当场抓住）。
    const freePromise: Promise<SpawnOutcome> = (async (): Promise<SpawnOutcome> => {
      const teamId = await deps.createTeam(request)
      state.decided.set(request.requestId, {
        outcome: { kind: 'created', teamId },
        targetKind: request.targetKind,
        teamId,
      })
      return { kind: 'created', teamId }
    })()
    // 注册与「IIFE 开始执行」在同一段同步代码里，中间没有 await ⇒ 无窗口期。
    state.inFlight.set(request.requestId, { targetKind: request.targetKind, promise: freePromise })
    try {
      return await freePromise
    } finally {
      state.inFlight.delete(request.requestId)
    }
  }

  // —— 6. 审批路径（AC-5-6 / AC-5-7）——
  const promise = runApprovalPath(deps, request)
  state.inFlight.set(request.requestId, { targetKind: request.targetKind, promise })
  try {
    const outcome = await promise
    state.decided.set(request.requestId, {
      outcome,
      targetKind: request.targetKind,
      // §5.4：第一级否决后该 `requestId` 整体作废 —— 后续任何派生（含原样重投）都是绕开。
    })
    return outcome
  } finally {
    state.inFlight.delete(request.requestId)
  }
}

/**
 * 第二级：人类批准/否决（SPEC §5.2 / FR-5.3.2 / FR-5.3.3）。
 *
 * **批准后才创建团队**（AC-5-7 / AC-5-8）。批准同时落一条 `spawn/human-approved`，
 * 载荷含 FR-5.3.3 明列的六项（申请成员、目标团规格、两级审批人、时间、结论）——
 * 其中「时间」由事件基座的 `occurredAt` 承载（见 `SpawnDecisionData` 的注释），
 * 不再重复进 `data`。
 *
 * ## 重复提交的三层防线与**它们各自覆盖到哪里**（勿夸大，OCR 评审 [3] 已纠正过一版）
 *
 * 1. **进程内在途注册**（`state.deciding`）：覆盖**同一进程内**的并发调用。
 *    注册与决议逻辑的第一行之间没有 `await`，故两次并发调用必然共享同一份结论。
 * 2. **进程内幂等回放**（`state.decided` / 内存优先的恢复路径）：覆盖同进程内**先后**的重复调用。
 * 3. **账本查重**（本函数读 `spawn/human-approved` / `spawn/human-rejected`）：
 *    覆盖「结论事件**已落账之后**」的一切重复调用 —— 包括换 `Ledger` 句柄、跨进程。
 *
 * ⚠ **三层合起来仍有一个跨进程的窄窗口**，此处如实写明（先前的注释曾夸大成效）：
 * 两个**不同进程**同时批准同一票号时，双方都还没落结论事件，第 1、2 层各管各的进程、
 * 第 3 层读到的都是「尚无人类结论」⇒ 可能各自 `createTeam`。
 * 缓解手段是第 3 层之外再读 `team/created`（见恢复路径）：**前提是宿主把 `requestId`
 * 写进了该事件**。满足该约定的跨进程并发会收敛到同一个团；不满足则可能多建一个团，
 * 但不会静默错乱（账本上两条 `createTeam` 的痕迹都在，且批准事件只有一条）。
 * 彻底消除它需要一条「按 `requestId` 原子占用」的存储层能力（如唯一索引），
 * 那属于账本契约的扩展，不在本期范围内 —— 这里选择如实标注而不是假装已经解决。
 */
export async function decideSpawnTicket(
  deps: DelegationDeps,
  input: {
    readonly ticketId: SpawnTicketId
    readonly decision: 'approve' | 'reject'
    readonly reason?: string | undefined
  },
): Promise<SpawnDecisionOutcome> {
  const requestId = requestIdOfTicket(input.ticketId)
  if (requestId === null) {
    return {
      kind: 'ticketNotFound',
      reason:
        `「${input.ticketId}」不是合法票号（缺少 \`${TICKET_ID_PREFIX}\` 前缀）。` +
        `票号由 requestId 确定性派生（见 spawnTicketIdOf），形如 \`${TICKET_ID_PREFIX}<requestId>\`。`,
    }
  }

  // ⚠ **并发去重（OCR 评审 [1] 的 HIGH）**：整段决议逻辑必须在「同一个 requestId 只有一份在途」
  // 的保护下跑。少了它，两次并发 `approve` 都会先在 `collectSpawnEvents` 读到「尚无人类结论」
  // （因为对方还没 commit），各自 `createTeam` ⇒ 一个票号两个团；
  // 并发的「批准 + 否决」还会落下两条互相矛盾的人类结论。
  //
  // 注册与「IIFE 开始执行」之间没有 await ⇒ 无窗口期（与 `requestSpawn` 同构）。
  const state = stateOf(deps.ledger)
  const alreadyDeciding = state.deciding.get(requestId)
  if (alreadyDeciding !== undefined) {
    return alreadyDeciding
  }
  const deciding = decideSpawnTicketInner(deps, requestId, input)
  state.deciding.set(requestId, deciding)
  try {
    return await deciding
  } finally {
    state.deciding.delete(requestId)
  }
}

/** `decideSpawnTicket` 的实际逻辑；由外层负责在途注册，故此处**不做**并发去重。 */
async function decideSpawnTicketInner(
  deps: DelegationDeps,
  requestId: RequestId,
  input: {
    readonly ticketId: SpawnTicketId
    readonly decision: 'approve' | 'reject'
    readonly reason?: string | undefined
  },
): Promise<SpawnDecisionOutcome> {
  const events = collectSpawnEvents(deps.ledger, requestId)
  const state = stateOf(deps.ledger)

  // 已完成的人类结论 —— 两种情况，处理方式不同（OCR 评审 [2] 抓出的真缺陷）。
  //
  // 起初这里对「已批准」一律返回 `ticketNotFound`，但那样会留下一个**永远无法恢复**的状态：
  // 若 `spawn/human-approved` 落账之后 `createTeam` 抛错，账本上写着「已批准」而团不存在，
  // 重试批准会被这条查重挡掉，走 `requestSpawn` 又会被「同一 requestId」挡掉 ——
  // 那条申请就永久卡死了。而错误信息当时还写着「可安全重试创建」，是**假承诺**。
  //
  // 现在的处理：
  // - **否决**（human-rejected）→ 仍然 `ticketNotFound`（否决是终态，没有可恢复的动作）；
  // - **批准**（human-approved）→ 先看有没有对应的 `team/created`：
  //   - 有 ⇒ 团已建成。**幂等回放**那个 teamId（真正的「批两次不会建两个团」）；
  //   - 没有 ⇒ 批准成立但建团没完成 ⇒ **就地续做建团**（这正是错误信息承诺过的那个重试）。
  const decidedEvent = events.find(
    (event) => event.kind === 'spawn/human-approved' || event.kind === 'spawn/human-rejected',
  )
  if (decidedEvent !== undefined && decidedEvent.kind === 'spawn/human-rejected') {
    return {
      kind: 'ticketNotFound',
      reason:
        `票号 ${input.ticketId} 的申请 ${requestId} 已被人类否决（账本事件 ${decidedEvent.eventId}／第 ${decidedEvent.sequence} 条），` +
        '本次提交是重复提交，未产生任何副作用：否决是终态，同一申请不能改结论。' +
        '若要重新争取，请换一个新的 requestId 发起。',
    }
  }

  const awaitingEvent = events.find((event) => event.kind === 'spawn/awaiting-human-approval')
  if (awaitingEvent === undefined) {
    const principalRejected = events.find((event) => event.kind === 'spawn/principal-rejected')
    const because =
      principalRejected === undefined
        ? '账本里没有它的第一级结论'
        : `它在第一级已被团长否决（第 ${principalRejected.sequence} 条事件），按 FR-5.3.1 不会进入第二级`
    return {
      kind: 'ticketNotFound',
      reason: `票号 ${input.ticketId} 的第二级尚未开启：${because}，人类无法对其作出批准/否决。`,
    }
  }

  const awaitingData = awaitingEvent.data

  // **载荷运行期收窄**（OCR 评审 [4]）：`isLedgerEvent` 只验结构、**不验载荷**
  // （见 `types/guards.ts` 的边界说明），而这里读出的字段会直接流进 `createTeam`
  // 与后续 `spawn/human-*` 事件的载荷 —— 一个畸形载荷会造出「形状与 kind 不符」的账本行。
  // 判据与 `readSpawnTicket` 里的同一套（非空字符串 / 闭集 targetKind / spec 是非 null 对象）。
  const requesterMemberId = awaitingData.requesterMemberId
  const principalMemberId = awaitingData.principalMemberId
  const targetKind = awaitingData.targetKind
  const spec = awaitingData.spec
  if (
    typeof requesterMemberId !== 'string' ||
    requesterMemberId === '' ||
    typeof principalMemberId !== 'string' ||
    principalMemberId === '' ||
    (targetKind !== 'persistent' && targetKind !== 'temporary') ||
    typeof spec !== 'object' ||
    spec === null
  ) {
    return {
      kind: 'ticketNotFound',
      reason:
        `票号 ${input.ticketId} 的待办事件（第 ${awaitingEvent.sequence} 条）载荷不完整或形状非法，` +
        '无法据此作出结论。这通常意味着该事件由旧版/外部写入，或账本被外部改写。',
    }
  }

  const request: SpawnRequest = {
    requestId,
    requesterMemberId,
    // 能走到第二级的申请，其发起方必然是持久成员：临时成员的持久团申请在第一级之前
    // 就被权限矩阵拒了（AC-5-1 第二格）。此处按结论反推，不额外发明一个来源。
    requesterKind: 'persistent',
    targetKind,
    spec,
  }

  // —— 恢复路径：已批准 ——
  // 显式判 `kind`（OCR 评审 [14]）：上面的 `human-rejected` 早返回**已经**排除了另一种，
  // 所以这里隐含 `decidedEvent.kind === 'spawn/human-approved'`。但那条不变量是**远距离**的
  // —— 若将来有人挪动/放宽上面那个早返回，本分支会开始接受一张已否决的票。
  // 把判据写在这里，不变量就变成**局部**的，改动上面也不会静默破坏这里。
  if (decidedEvent !== undefined && decidedEvent.kind === 'spawn/human-approved') {
    // ① **内存优先**：本进程已经为这条申请建过团 ⇒ 直接回放，连账本都不用查。
    //    少了这一步，同进程内「批两次」会因为账本里没有宿主写的 `team/created` 而
    //    误判成「建团没完成」，从而**真的再建一个团**（我第一版就是这样，被测试抓住）。
    const inMemory = state.decided.get(requestId)
    if (inMemory !== undefined && inMemory.outcome.kind === 'created' && inMemory.teamId !== undefined) {
      return { kind: 'created', teamId: inMemory.teamId }
    }

    // ② **账本兜底**（跨进程 / 换句柄）：宿主按约定把 `requestId` 写进了 `team/created` 时能查到。
    const existingTeamId = findTeamCreatedFor(deps.ledger, requestId)
    if (existingTeamId !== null) {
      state.decided.set(requestId, {
        outcome: { kind: 'created', teamId: existingTeamId },
        targetKind,
        teamId: existingTeamId,
      })
      return { kind: 'created', teamId: existingTeamId }
    }

    // ③ 两处都查不到 ⇒ 批准成立但建团未完成 ⇒ **续做建团**（不重复落 `human-approved`）。
    //    这正是原先那条错误信息承诺的「可安全重试创建」—— 当时它是个假承诺，
    //    因为重试会被上面的查重挡掉（OCR 评审 [2]）。现在它真的存在。
    //
    //    ⚠ **残余风险如实说明**：若宿主**没有**把 `requestId` 写进 `team/created`，
    //    且进程已经重启（内存缓存没了），这一步会再建一个团。
    //    本包无法单方面解决它 —— 那需要一条「按 requestId 查团」的权威接口。
    //    跨进程的重复批准代价由此为「多一个团」而非「静默错乱」，且 `findTeamCreatedFor`
    //    的注释里写明了这个接线约定。
    const teamId = await deps.createTeam(request)
    state.decided.set(requestId, {
      outcome: { kind: 'created', teamId },
      targetKind,
      teamId,
    })
    return { kind: 'created', teamId }
  }

  // AC-5-9：人类操作者标识**非空**（空串会在 `requireHumanOperator` 里硬拒绝并抛错）。
  const humanOperatorId = requireHumanOperator(await deps.currentHumanOperatorId())
  const humanActor = { kind: 'human', humanId: humanOperatorId } as const

  if (input.decision === 'approve') {
    const receipt = deps.ledger.commit({
      kind: 'spawn/human-approved',
      actor: humanActor,
      requestId,
      occurredAt: deps.now(),
      data: {
        requestId,
        requesterMemberId,
        principalMemberId,
        humanOperatorId,
        targetKind,
        spec,
        decision: 'approve',
      },
    })

    let teamId: TeamId
    try {
      // 批准**之后**才创建（AC-5-8）。若这里失败，账本上已写着「已批准」而团没建起来 ——
      // 这是**有意的顺序**：账本是事实来源，补建比「先建后记」可恢复
      // （后者一旦落账失败，就产生一个没有审批依据的团，那是更难查的状态）。
      teamId = await deps.createTeam(request)
    } catch (cause) {
      throw new Error(
        `申请 ${requestId} 已获人类批准（事件 ${receipt.eventId}，第 ${receipt.sequence} 条），` +
          `但创建团队失败：${String(cause)}。` +
          '账本上批准事实已成立。**恢复方式**：再次以同一票号调用 decideSpawnTicket(..., "approve") —— ' +
          '它会走「已批准但团不存在」的续做路径，只补建团、不会重复落批准事件。' +
          '（注意：续做路径靠 `team/created` 事件上的 requestId 判定「是否已建成」，' +
          '故宿主建团时须把该 requestId 写进事件；否则跨进程的重复批准可能建出第二个团。）',
        { cause },
      )
    }

    const outcome: SpawnOutcome = { kind: 'created', teamId }
    // 记下 `targetKind`：`decided` 的幂等键是 `(requestId, targetKind)`，缺了它
    // 后续同键查询会在第 4 步把它当成「换了目标类型」而误判 `noDowngradeBypass`。
    state.decided.set(requestId, { outcome, targetKind, teamId })
    return outcome
  }

  const reasonText =
    input.reason !== undefined && input.reason.trim() !== ''
      ? input.reason
      : '人类审批未通过（未说明理由）。'

  const receipt = deps.ledger.commit({
    kind: 'spawn/human-rejected',
    actor: humanActor,
    requestId,
    occurredAt: deps.now(),
    data: {
      requestId,
      requesterMemberId,
      principalMemberId,
      humanOperatorId,
      targetKind,
      spec,
      decision: 'reject',
      reason: reasonText,
    },
  })

  // 人类否决同样绑定 requestId（AC-5-12）：此后同一 requestId 的任何派生都不得创建。
  // 只需写 `decided` 这一张表：该结论本身是 `noDowngradeBypass`，下游分支自会把后续提交拦成同样的结论。
  // （另设一张按 requestId 索引的否决表已被变异测试证明是纯冗余，见 `DelegationRuntimeState` 的说明）。
  state.decided.set(requestId, {
    targetKind,
    outcome: {
      kind: 'noDowngradeBypass',
      ticketId: input.ticketId,
      errorCode: 'ERR_NO_DOWNGRADE_BYPASS',
      reason: noDowngradeReason(request, targetKind),
    },
  })

  return {
    kind: 'rejectedByHuman',
    ticketId: input.ticketId,
    // 人类操作者标识、账本事件 ID 与序号一并附上：FR-5.3.3 要求它能被核验，
    // 而 `SpawnDecisionOutcome` 的两个否决分支没有操作者字段（SPEC §4.2 的形状），
    // 故把可核验的痕迹写进 `reason` —— 账本里的权威记录仍是事件的 actor 与 `humanOperatorId`。
    reason: `${reasonText}（人类操作者标识：${humanOperatorId}，账本事件：${receipt.eventId}／第 ${receipt.sequence} 条）`,
  }
}

/**
 * 票号 → `requestId`（票号由 `requestId` 确定性派生，故可逆）。**纯字符串解析，不查账本。**
 *
 * ## 为什么这里**不**顺手回账本核对（曾如此写过，被变异测试证明是冗余）
 *
 * 起初本函数会在切出候选值后再 `collectSpawnEvents(...)` 确认「这条申请真的存在」，
 * 不存在就返回 `null`。变异测试（把这一步删掉）显示**测试仍全绿** —— 因为调用方
 * `decideSpawnTicket` 紧接着就会自己读一次账本，并强制要求看到
 * `spawn/awaiting-human-approval` 事件：
 * 以任何伪造票号进来的调用，都会在那里得到 `ticketNotFound`。
 *
 * 那个检查因此是**纯成本**（每次决议多扫一遍完整账本），且它带来的那点差异
 * 只体现在 `ticketNotFound` 的 `reason` 措辞上 —— 不是行为差异。
 * 删掉它之后，「票号是否对应一条真实申请」这件事**只有一个判定点**
 * （`decideSpawnTicket` 里的 `awaiting === undefined`），也就不存在两处判定悄悄分叉的风险。
 *
 * 格式不合法的票号仍在这里返回 `null`：那不是「申请不存在」，而是「这压根不是票号」，
 * 调用方需要把这两种情况区分开来报错。
 */
function requestIdOfTicket(ticketId: SpawnTicketId): RequestId | null {
  const raw = ticketId as string
  if (!raw.startsWith(TICKET_ID_PREFIX) || raw.length === TICKET_ID_PREFIX.length) {
    return null
  }
  return raw.slice(TICKET_ID_PREFIX.length) as RequestId
}

/**
 * FR-5.6 的转挂接线（SPEC §5.5 的 `DelegationDeps` 里没有这三者）。
 *
 * SPEC §5.5 只给了 `reattachOrphanedTeams(deps, removedMemberId)` 这一个签名，
 * 但「哪些团归他」「最近的存活祖先是谁」「该团的团长是谁」三个问题在 `DelegationDeps`
 * 里都没有答案。本实现把它们做成**注入项**而不是在库里硬编码一个「团队表」——
 * 后者会让「谁是祖先」变成 sophia-core 私自持有的真相，直接违反 FR-10.2。
 */
export interface OrphanReattachmentDeps extends DelegationDeps {
  /** 该成员拥有（`ownerMemberId` 指向他）的全部团队 ID。 */
  readonly teamsOwnedBy?: ((removedMemberId: MemberId) => Promise<readonly TeamId[]>) | undefined
  /**
   * 最近的存活祖先（FR-5.6.1）。
   * - 返回 `null`：**无**存活祖先 ⇒ 转挂到团长（FR-5.6.2）。
   * - 返回 `{ ancestor }`：有祖先 ⇒ 转挂到它。
   * - 返回 `{ ancestor, changed: false }`：现状已正确 ⇒ 不写事件、不计入结果。
   */
  readonly nearestLivingAncestorOf?:
    | ((
        removedMemberId: MemberId,
        teamId: TeamId,
      ) => Promise<{ readonly ancestor: MemberId; readonly changed?: boolean | undefined } | null>)
    | undefined
  /** 该团的团长（监正）；FR-5.6.2 的兜底去处。 */
  readonly principalMemberIdOf?: ((teamId: TeamId) => Promise<MemberId>) | undefined
  /** 该团当前的归属者；给了它才能判定「祖先就是原所有者、无需转挂」。 */
  readonly currentOwnerOf?: ((teamId: TeamId) => Promise<MemberId | null>) | undefined
}

/**
 * 父成员被回收/销毁时，把其名下子团转挂到最近的存活祖先（SPEC §5.5 / FR-5.6）。
 *
 * 处置规则逐条：
 * - **FR-5.6.1**：转挂到最近的存活祖先（默认）；**不**级联销毁（保工作成果）、**不**冻结（免僵尸团）。
 * - **FR-5.6.2**：若无存活祖先 → 转挂到**该团团长（监正）**名下（**不是**「保持不变」——
 *   保持不变正是「无人认领的僵尸团」，正是本条要排除的状态）。
 * - **FR-5.6.3**：转挂事实**须落账本**：每次转挂**恰好一条** `team/ownership-reattached`
 *   （AC-5-15），载荷含 `from` 与 `to`。
 *
 * 返回**实际发生转挂**的团队 ID 列表（按 `teamsOwnedBy` 给出的顺序）；
 * 未发生转挂的团不出现在结果里 —— 没发生的事实不该被报告成发生了。
 */
export async function reattachOrphanedTeams(
  deps: OrphanReattachmentDeps,
  removedMemberId: MemberId,
): Promise<readonly TeamId[]> {
  const { teamsOwnedBy, nearestLivingAncestorOf, principalMemberIdOf, currentOwnerOf } = deps

  if (
    teamsOwnedBy === undefined ||
    nearestLivingAncestorOf === undefined ||
    principalMemberIdOf === undefined
  ) {
    throw new TypeError(
      'reattachOrphanedTeams 缺少必需依赖：teamsOwnedBy / nearestLivingAncestorOf / principalMemberIdOf。' +
        'SPEC §5.5 的 DelegationDeps 只给了审批相关的注入，FR-5.6 需要这三者才能定位子团与其转挂去处；' +
        '本实现刻意不在库里硬编码一个团队表 —— 那会让「谁是祖先」变成 sophia-core 私自持有的真相（违反 FR-10.2）。',
    )
  }

  const reattached: TeamId[] = []

  // `from` 也要硬拒绝空标识（OCR 评审 [11]）：`to` 有守卫而 `from` 没有，是不对称的。
  // 这个参数是**公开 API 的入参**，调用方可能从任意来源（工作区里的 id、上层传下来的值）取它；
  // 空串照样会被写进 `team/ownership-reattached` 的 `from` 字段，事后同样**无法从账本察觉**
  // —— 与 `to` 那条守卫要防的是同一类静默数据损坏。
  // 放在循环**之前**：一个非法入参应当在写任何事件之前就被拒绝，而不是写到一半才抛。
  if (typeof removedMemberId !== 'string' || removedMemberId.trim() === '') {
    throw new TypeError(
      `reattachOrphanedTeams 的 removedMemberId 非法（${JSON.stringify(removedMemberId)}）。` +
        '该标识会作为转挂事件的 `from` 落账；空标识会让「团从谁手上转出」永久丢失，' +
        '且这条错误在账本里无法事后察觉。',
    )
  }

  for (const teamId of await teamsOwnedBy(removedMemberId)) {
    const ancestor = await nearestLivingAncestorOf(removedMemberId, teamId)
    const to = ancestor === null ? await principalMemberIdOf(teamId) : ancestor.ancestor

    // 归属者标识必须是**非空字符串**（OCR 评审 [1]）。
    // 运行期不做任何校验就落账，会写出一条 `to: ''` 的转挂事件 —— 团被挂到一个不存在的成员名下，
    // 而且**事后无法从账本察觉**（一个空串看起来就是个普通字符串）。这类静默数据损坏
    // 比抛错严重得多，故这里硬拒绝。
    if (typeof to !== 'string' || to.trim() === '') {
      throw new TypeError(
        `第 ${teamId} 个团的转挂目标归属者标识非法（${JSON.stringify(to)}）。` +
          'FR-5.6.1/5.6.2 要求转挂到某个**具体成员**名下；空标识会让团被挂到一个不存在的成员上，' +
          '且这条错误在账本里无法事后察觉。请检查 nearestLivingAncestorOf / principalMemberIdOf 的实现。',
      )
    }

    // 「已经在这个人手上」⇒ 没有发生转挂 ⇒ 不写事件、不计入结果。
    // 硬写一条 `from === to` 的记录既不是事实，也无从解释。
    if (currentOwnerOf !== undefined && (await currentOwnerOf(teamId)) === to) {
      continue
    }
    if (ancestor !== null && ancestor.changed === false) {
      continue
    }

    deps.ledger.commit({
      kind: 'team/ownership-reattached',
      // 操作者记为**转挂后的归属者**：这条事件描述的是他接手了一个团。
      // 不用 `host`：窗口是传旨通道、不绑团（AC-ROLE-1），转挂是团内事实。
      actor: { kind: 'member', memberId: to },
      occurredAt: deps.now(),
      data: {
        teamId,
        from: removedMemberId,
        to,
        reason: ancestor === null ? 'parent-removed:no-living-ancestor' : 'parent-removed',
      },
    })
    reattached.push(teamId)
  }
  return reattached
}
