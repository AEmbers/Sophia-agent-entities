/**
 * 角色模型（SPEC §2.2 / FR-5.0）。
 *
 * 以「皇帝下旨」为喻的三权分立：
 *
 * | 喻体 | 系统角色 | 术语 | 是否绑定会话 |
 * |---|---|---|---|
 * | 皇帝 | 人类用户 | `Human` | — |
 * | **传旨小秘** | **当前窗口会话**（可随时更换） | `Host` | ❌ **不绑团** |
 * | **监正** | **持久团团长** | `Principal` | ✅ 绑在团上，**是团内成员** |
 * | 百官 | 团内普通成员 | `Member` | ✅ 绑在团上 |
 *
 * **本文件最重要的类型级事实是「窗口不绑团」**：
 * `Host` 上**没有** `teamId` 字段 —— 宿主与团是多对多、可替换的引用，不是所有权。
 * 任意窗口可向任意持久团下达任务，窗口关闭不影响团队存续（FR-5.0.3）。
 * 这条直接对治上游 `dsh-agent-teams/src/types.ts:248` 的 `captainSessionId` 僵尸团问题
 * （见 `DEVELOPMENT.md` §2A），并由 `tests/types.spec.ts` 的 `@ts-expect-error` 守着（AC-ROLE-1）。
 */

import type { HostSessionId, MemberId, TeamId } from './ids.ts'

/** 人类用户（皇帝）。 */
export interface Human {
  readonly kind: 'human'
  readonly humanId: string
  readonly displayName: string
}

/**
 * 宿主 / 传旨通道（窗口会话，传旨小秘）。
 *
 * FR-5.0.3：任意窗口可向任意持久团下达任务；窗口关闭不影响团队存续。
 * 关键：这里**没有** `teamId` —— 宿主与团是多对多、可替换的引用，不是所有权。
 */
export interface Host {
  readonly kind: 'host'
  readonly hostSessionId: HostSessionId
}

/**
 * 团长与成员的共同基底（都绑在团上、都是团内成员）。
 * `K` 刻意放进类型参数，让 `kind` 的**字面量**保留下来 ——
 * 若直接写 `Member & { kind: 'principal' }`，`kind` 会被交叉成 `'member' & 'principal'`（即 `never`）。
 */
export type TeamBoundEntity<K extends 'principal' | 'member'> = {
  readonly kind: K
  readonly teamId: TeamId
  readonly memberId: MemberId
}

/**
 * 持久团团长（监正）：团内成员，非窗口 Agent（FR-5.0.2）。
 *
 * 由 `TeamBoundEntity` 派生而非独立书写：两者**除 `kind` 外必须逐字相同**，
 * 各写一份迟早会漂移（给其一加字段、忘了另一个）。派生保证它们永远同步，
 * 而 `kind` 的字面量仍被保留（`Principal` 可赋给 `Entity`，且能收窄）。
 */
export type Principal = TeamBoundEntity<'principal'>

/** 团内普通成员。 */
export type Member = TeamBoundEntity<'member'>

/** 四类实体（人类 / 宿主 / 团长 / 成员）的可辨识联合。 */
export type Entity = Human | Host | Principal | Member
