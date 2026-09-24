/**
 * 团队实体与生命周期（SPEC §2.3 / FR-5.1）。
 *
 * **不存在性锚定是本文件的核心约束**：`Team` 上**没有** `hostSessionId`
 * （只有可选的、纯审计用途的 `lastHostSessionId`），因此窗口关不关都不会让团变成
 * 「占着资源却办不了事」的僵尸团 —— 上游 `dsh-agent-teams/src/types.ts:248` 的
 * `captainSessionId` 正是把团锚在窗口会话上，才产生该问题（AC-ROLE-1）。
 */

import type { DagTeamId, HostSessionId, MemberId, TeamId } from './ids.ts'

/** 团队类型：持久团 / 临时团（FR-5.1）。 */
export type TeamKind = 'persistent' | 'temporary'

/** 派生发起方类型：由其所处团队的 kind 决定（FR-5.2）。 */
export type CallerKind = TeamKind

/**
 * 成员可用性 —— 持久态，只由显式操作改变（FR-9 的 suspend / resume / destroy）。
 *
 * 恰为 4 个字面量（AC-TEAM-1）。**`'inactive'` 不在其中**：
 * `REQUIREMENTS.md` FR-3.2 原写 `active / inactive / archived`，而 FR-9.1 的挂起操作却把状态置为
 * `suspended` —— 同物异名。依 captain 裁定 Q-C（SPEC §10）**合并，规范名取 `suspended`**：
 * FR-9.1 为它定义了明确的可逆操作对（suspend/resume，含断点保存与运行时句柄释放），
 * 而 `inactive` 只有名称、没有任何进入/离开的转换定义。一个没有转换定义的状态不是真状态。
 */
export type MemberLifecycle = 'active' | 'suspended' | 'archived' | 'destroyed'

/**
 * 成员存在态 —— 运行期派生，**不得持久化**（FR-3.2）。
 * 与 `MemberLifecycle` 是两个正交维度：一个已 `archived` 的成员叙述上不会 `running`，
 * 但类型层不表达该耦合，由运行时保证。
 */
export type MemberPresence = 'idle' | 'running'

/** 团队整体状态（FR-5.1 / FR-9）。 */
export type TeamState = 'active' | 'suspended' | 'destroyed'

/**
 * 持久团队范式（FR-3 / FR-5.0）。
 *
 * 团队是**独立实体**：有自身 `teamId` 与生命周期，不归属于任何窗口会话（FR-5.0.1）。
 * 团长是**团内成员**（`Principal`，见 `roles.ts`），不是窗口 Agent（FR-5.0.2）。
 */
export interface Team {
  readonly teamId: TeamId
  readonly kind: TeamKind
  /** FR-5.4.1：子团归发起成员个人所有；顶层团为 `null`。 */
  readonly ownerMemberId: MemberId | null
  /** 父团 ID；顶层团为 `null`。 */
  readonly parentTeamId: TeamId | null
  /**
   * 审计字段：最近一次呈送核准 / 下达任务的窗口。
   * **不是**存在性锚点 —— 窗口关闭不影响团存续（FR-5.0.3）。
   */
  readonly lastHostSessionId?: HostSessionId | undefined
  readonly state: TeamState
  readonly createdAtSequence: number
}

/**
 * DAG 团队实例（FR-7.1）。
 *
 * 与 `Team` 是两个不同的实体：`Team` 是持久/临时团队的容器，`DagTeam` 是 DAG 调度器
 * 为某次子 DAG 攻坚新建的实例，带 `dagTeamId` 与 `ownerMemberId`（FR-7.1）。
 * 归属移交（FR-7.4）落 `dag/ownership-transferred` 事件。
 *
 * **与 `DagTeamCreatedData`（`operations.ts`）的关系**：后者是创建**那一刻的事实快照**，
 * 本接口是该实例的**当前状态**；事件载荷刻意不内嵌本接口 —— 账本事件是不可变的历史，
 * 把可变实体的形状嵌进历史事件，会让「后来给 `DagTeam` 加字段」变成对历史的重解释。
 * 两者共享字段名（`dagTeamId`/`ownerMemberId`/`parentTeamId`）即接口，形状若有出入以事件为准。
 */
export interface DagTeam {
  readonly dagTeamId: DagTeamId
  readonly ownerMemberId: MemberId
  /** 归属者所属的团；用于解析「最近存活祖先」（FR-5.6.1）。 */
  readonly parentTeamId: TeamId | null
  readonly state: TeamState
  readonly createdAtSequence: number
}

/**
 * DAG 任务状态。
 *
 * ⚠ 具体状态机（FR-4.1 的显式状态机、FR-4.2 的门禁链）属于 `sophia-engine-dag`，
 * **在 `t3` 范围外**；这里只冻结 `dag/task-state-changed` 事件的载荷形状，
 * 故状态取值保持 `string`，不擅自发明一套状态枚举。
 *
 * **刻意不加品牌**（评审建议过）：品牌化会让「构造一个状态值」必须逐个 `as` 强转，
 * 而合法取值清单正是当前**尚未定义**的东西 —— 那等于用一个类型层面的伪约束
 * 换取每个调用点的样板代码。等状态机立项时再一次性收窄为字面量联合，才是对的顺序。
 */
export type DagTaskState = string

/**
 * 拟建团规格（`DEVELOPMENT.md` §3.4 的字面沿用）。
 *
 * **单一来源**：SPEC §4.1 把这个接口列在 `src/delegation.ts` 下，但它的两个消费者
 * 一个在类型层（`types/operations.ts` 的 `spawn/*` 事件载荷）、一个在行为层（`t6` 的 `src/delegation.ts`，
 * 尚未创建），若两处各写一份就是两个名义类型、互相不可赋值。
 * 故**定义在类型层，届时由 `src/delegation.ts` 做 `export type { TeamSpec }` 转发**
 * （转发尚未存在，因为 `t6` 未开工；当前唯一导入路径是 `@sophia/core`）。
 */
export interface TeamSpec {
  /** 拟用团名（展示用）。 */
  readonly name: string
  /**
   * 拟建名册：职位 + 数量 + **可选**的初始模型。
   *
   * ## 为什么 `model` 在这里是**可选**，而账本载荷里的 `model` 是**必填可空**
   *
   * 本接口是**调用方输入**（`tools/spawn-team.ts` 的入参 → 建团申请），
   * 而 `MemberAddedData.model`（`types/operations.ts`）是**账本载荷**。两者场景不同：
   *
   * | 层 | 形状 | 理由 |
   * |---|---|---|
   * | 申请契约（本接口） | **可选** | 「调用方没指定」是合法输入，逼每个调用方写 `null` 是噪音 |
   * | 账本载荷 | **必填可空** | 记录侧必须如实：`null` = 跟随全局默认 |
   *
   * 在**输入侧**「省略该字段」与「显式写 `null`」**语义等价**，都表示「跟随全局默认」
   * （`src/client/locales.ts` 的 `modelFollowDefault` 是这个状态的既有文案），
   * 所以这里**不需要**让调用方靠「写不写 `null`」去表达这层区别；
   * 该区别只在**账本侧**才有意义（那时它是「事实」，必须逐条落地）。
   * `undefined → null` 的归一化发生在消费侧（`narrowRoster`），不在本类型。
   *
   * ## `?` 后面为什么还要 `| null`
   *
   * 因为归一化要把「没写」写成 `null`，而本仓开着 `exactOptionalPropertyTypes`。
   * 实测（`typescript@5.9.3` 的编译器 API，内存探针、零文件足迹）：
   * 只有 `?` 时那份归一化代码报 **TS2322**；写成 `? | null` 则 **0 诊断**。
   * ⇒ `| null` 不是冗余，去掉它就会让消费侧的归一化编译不过。
   *
   * ## ⚠ 加了 `model?` **并不能**单靠自己防止「传了却被丢掉」
   *
   * 同一探针实测：只有**对象字面量**才会触发多余属性检查（TS2353）；
   * 把项先建成变量、或消费侧「只挑 `position`/`count` 重建数组」，则**0 诊断** ——
   * 即在消费侧窄化时漏掉 `model`，它会被**静默丢弃**而编译全绿。
   * 所以「初始模型真的传得出去」这件事，最终由消费侧的窄化代码负责
   * （它必须把 `model` 一并带上），本类型只负责让**合法输入**有地方写。
   */
  readonly roster: readonly {
    readonly position: string
    readonly count: number
    /** 该职位的**初始模型**；省略或 `null` = 跟随全局默认。形状与 `wire.ts` / 换模事件逐字一致。 */
    readonly model?: { readonly provider: string; readonly model: string } | null
  }[]
  /** 拟建任务标题。 */
  readonly tasks: readonly string[]
}
