/**
 * 视图**线格式**（wire format）：宿主路由的响应类型 + 宿主侧取值助手。
 *
 * ## 为什么这个文件在 `src/` 而不在 `src/client/`
 *
 * ⚠ 这是**修一个真实缺陷**后的位置，别挪回 `src/client/`（回归见下）。
 *
 * 这些类型描述的是「宿主**发出去**什么」，因此它们的归属本来就是宿主侧 ——
 * `src/client/view-model.ts` 的文件头也一直这么写着（「由宿主侧拥有」），
 * 只是当初把它放在了浏览器半边。
 *
 * 而「放在 `src/client/`」有一个**静默**的代价，已实测发生：
 * 宿主的 `tsconfig.json`（`lib: ["es2024"]`，**无 DOM**）里，
 * `exclude: ["src/client"]` **只决定根文件扫描范围，拦不住被 import 拉进来的文件**。
 * 于是 `src/host-data.ts`（宿主半）一旦 `import type` 本文件原来所在的
 * `./client/view-model.ts`，tsc 就会顺着
 * `view-model.ts → locales.ts → document` 把浏览器代码拉进**无 DOM** 的 program：
 *
 * ```
 * src/client/locales.ts(245,22): error TS2584: Cannot find name 'document'.
 * ```
 *
 * 实测证据（`tsc --explainFiles`）：`host-data.ts` → `client/view-model.ts` →
 * `client/locales.ts` 这条链把 `document` 带进了宿主配置，契约命令
 * `npx tsc --noEmit -p packages/sophia-core/tsconfig.json` 直接 **exit 2**。
 *
 * 本文件是**纯声明**（零 import、零 DOM、零 node:）⇒ 宿主与浏览器两半
 * 都能安全引用它，两个 tsconfig 都不再互相牵连。
 *
 * ## ⚠ 为什么载荷类型是**重新声明**的，而不是 import `t3` 的投影类型
 *
 * 实测（`tsc --noEmit -p tsconfig.client.json`，exit 2）：只要 client 侧碰一下
 * `../projection/index.ts`（哪怕只 `import type`），tsc 就会顺着
 * `projection → ledger/naming` 把 node 内建模块拉进 `types: []` + `lib: [DOM]`
 * 的配置里，当场报 `TS2307: Cannot find module 'node:crypto'`。
 * 类型解析**不看**「这个 import 会不会被擦除」，它要解析整个模块图。
 * ⇒ 线格式是对**宿主与浏览器两侧都中立**的一份声明，字段名与投影输出
 * **逐字一致**（`memberId` / `displayName` / `lifecycle` / `tombstone` /
 * `assigneeMemberId` …），这样宿主把投影结果直接 `JSON.stringify` 出来就能对上。
 *
 * @module @sophia/core/wire
 */

// ────────────────────────────────────────────────────────────────────────────
// 线格式（宿主路由的响应；字段名与 `t3` 投影输出逐字一致）
// ────────────────────────────────────────────────────────────────────────────

/** 成员生命周期。与领域类型 `MemberLifecycle` 逐字一致（4 个取值，闭集）。 */
export type WireLifecycle = 'active' | 'suspended' | 'archived' | 'destroyed'

/**
 * 「宿主没给 / 给了认不出的值」的**显式**状态。
 *
 * ⚠ 这个哨兵**必须能活到界面**（OCR 复核 MEDIUM 抓到的真实缺陷）。
 * 初版的 `asMember` 把认不出的值**强制改写成 `'active'`**，于是：
 * - `lifecycleKeyOf` 的穷尽 switch **永远看不到**未知态
 *   ⇒ `lifecycleUnknown`（「状态未知」）这个文案**结构上不可达**；
 * - 宿主漏给 `lifecycle` 时，成员被显示成「在册」——**凭空发明了一个事实**，
 *   与「线格式不可信、逐字段自证、如实回报」的纪律直接冲突。
 *
 * 现在它是一等状态：界面画虚线点 + 显示「状态未知」。
 * 类型上收进 `WireLifecycle` 的联合，避免调用方以为只有 4 个取值。
 */
export const UNKNOWN_LIFECYCLE = 'unknown' as const

/** 成员生命周期的**渲染取值**：4 个真实值 + 未知态。 */
export type WireLifecycleState = WireLifecycle | typeof UNKNOWN_LIFECYCLE

/**
 * 成员存在态。
 *
 * ⚠ 它**不是**账本事实（FR-3.2 明确不得持久化），因此**不在投影里** ——
 * `t3` 的文件头专门声明过这一点。本字段来自**成员运行时**（`src/runtime/`），
 * 宿主在拼线格式时把两种来源合在一起。故它是**可选**的：运行时没给出时
 * 界面就**不画存在态点**，而不是猜一个（猜出来就是 FR-10.2 禁的「独立真相」）。
 */
export type WirePresence = 'idle' | 'running'

/** 一个成员的渲染数据。 */
export interface WireMember {
  readonly memberId: string
  readonly position: string
  readonly name: string
  /** 界面显示名（宿主按 FR-5A.4 裁决：优先职位名，重名才露序号）。 */
  readonly displayName: string
  readonly lifecycle: WireLifecycleState
  /** 墓碑（`archived` / `destroyed`）。**按数据里的值渲染，绝不按事件 kind 反推**（见下）。 */
  readonly tombstone: boolean
  readonly model: { readonly provider: string; readonly model: string } | null
  /**
   * 头像在**仓库根**下的相对路径，形如
   * `assets/members/out-512/03_第三梯队_架构与研发组/历算主事.png`。
   *
   * 由宿主给出（它是**文件路径**，属于宿主事实），客户端只做 URL 编码与
   * 越界校验（见 `avatar.ts`）。客户端**不自己按职位名拼路径** —— 那需要
   * 在客户端复制一份「职位 → 梯队目录」映射，而那份映射已在
   * `src/naming.ts` 的 `POSITIONS` 里，复制就是第二个真相。
   */
  readonly avatarPath?: string | undefined
  /** 运行期存在态；账本里没有这一项（见 `WirePresence`）。 */
  readonly presence?: WirePresence | undefined
}

/** 一条线程。 */
export interface WireThread {
  readonly threadId: string
  readonly channelId: string
  readonly title: string
  readonly assigneeMemberId: string | null
}

/** 频道。 */
export interface WireChannel {
  readonly channelId: string
  readonly title: string
  readonly threads: readonly WireThread[]
}

/** 一条消息。 */
export interface WireMessage {
  readonly messageId: string
  readonly channelId: string
  readonly threadId: string
  readonly senderMemberId: string
  readonly body: string
  readonly occurredAt: number
}

/** 任务状态。**不发明闭集**：DAG 状态机属 `sophia-engine-dag`（见 `types/team.ts` 的说明）。 */
export type WireTaskStatus = string

/** 活动面板里的一个任务项。 */
export interface WireTask {
  readonly taskId: string
  readonly title: string
  readonly status: WireTaskStatus
  readonly assigneeMemberId: string | null
  /** 阻塞原因；非阻塞时为 `null`。 */
  readonly blockedBy: string | null
}

/** 活动面板里的一条活动。 */
export interface WireActivity {
  readonly activityId: string
  readonly actorMemberId: string
  readonly summary: string
  readonly occurredAt: number
}

/** 一个团的完整视图。 */
export interface WireTeam {
  readonly teamId: string
  readonly name: string
  readonly kind: 'persistent' | 'temporary'
  readonly members: readonly WireMember[]
  readonly channels: readonly WireChannel[]
  readonly messages: readonly WireMessage[]
  readonly tasks: readonly WireTask[]
  readonly activity: readonly WireActivity[]
}

/**
 * 一张建团审批票（文档 3.6 审批区 / 收件箱的数据面）。
 *
 * 由 `spawn/*` 四态投影而来：`awaiting` 是待处理的申请；`approved` /
 * `rejectedBy*` 是已落结论的历史票（界面据此显示结果与理由，不再给按钮）。
 * `ticketId` 不在线格式里 —— 它由 `requestId` 确定性派生，宿主在
 * decision 路由内部换算，避免同一事实出现两个真相源。
 */
export interface WirePendingPlan {
  readonly requestId: string
  readonly targetKind: 'persistent' | 'temporary'
  readonly status: 'awaiting' | 'approved' | 'rejectedByPrincipal' | 'rejectedByHuman'
  /** 拟建团名（`spec.name`，逐字透传）。 */
  readonly name: string
  readonly requesterMemberId: string
  readonly roster: readonly {
    readonly position: string
    readonly count: number
    /** 申请侧未指定 / 跟随全局默认 → `null`（与 WireMember.model 同口径）。 */
    readonly model: { readonly provider: string; readonly model: string } | null
  }[]
  readonly tasks: readonly string[]
  readonly reason: string | null
  readonly humanOperatorId: string | null
  readonly raisedAtSequence: number
}

/** DAG 团的线格式（文档 5 · DagCanvas 数据源）。 */
export interface WireDagTeam {
  readonly dagTeamId: string
  readonly ownerMemberId: string
  readonly parentTeamId: string | null
  readonly tasks: readonly { readonly taskId: string; readonly state: string; readonly reason: string | null }[]
}

/**
 * 宿主视图路由的响应。
 *
 * `coverage` 是**必须如实透传**的一项：`changeScopesOf` 对 `team/thread-started`
 * 返回 `[]`（SPEC §6.3 的 scope 词汇表里没有 channel/thread），因此
 * **任何带 scope 的读取都看不到线程**。界面据此显示一条盲区提示，
 * 而不是静默少显示几行 —— 后者会让用户以为「线程真的就这么少」。
 *
 * ⚠ `unscopedKindsOmitted` 的类型是 `readonly string[]` 而**不是**事件 kind 的字面量联合
 * （OCR 复核 LOW [13] 指出这里被放宽了）。**这是刻意的**，理由如下：
 * 本文件必须对插件两半**同时中立**（零 import —— 见文件头），而那个联合
 * （`LedgerEventKind`）定义在 `types/guards.ts`，import 它就会把宿主类型层
 * 拉进浏览器半的 program。界面**只把这些值渲染成文本**（不做分支判断），
 * 所以 `string` 是足够的契约。真要收紧，正确做法是在本文件**镜像一份**
 * 只读 kind 清单 —— 但那会让「kind 集合」出现第二个真相，比放宽更糟。
 */
export interface WireView {
  readonly ok: boolean
  /** 失败时的可读原因（宿主的 `error` 字段）。 */
  readonly error?: string | undefined
  readonly teams: readonly WireTeam[]
  /**
   * 建团审批票（按首次入账序号升序）。**必填** —— 空账本给 `[]`：
   * 「没有票」与「宿主没实现这个字段」在界面上必须可区分（undefined ≠ 无票）。
   */
  readonly pendingPlans: readonly WirePendingPlan[]
  /**
   * DAG 团表（阶段 3 · DagCanvas）。必填：空 = 没有 DAG 团（同 pendingPlans 口径）。
   */
  readonly dagTeams: readonly WireDagTeam[]
  readonly coverage?: { readonly scoped: boolean; readonly unscopedKindsOmitted: readonly string[] } | undefined
  readonly malformedEvents?: number | undefined
  readonly unresolvedReferences?: number | undefined
}
