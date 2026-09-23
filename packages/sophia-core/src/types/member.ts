/**
 * 成员标识三层模型（SPEC §3.1 / FR-5A）。
 *
 * 三层各自解决一个不同的问题，**不可合并**：
 * | 层 | 字段 | 唯一性 | 字符集 | 界面展示 | 烧进素材像素 |
 * |---|---|---|---|---|---|
 * | 职位 | `position` | 否（可多实例） | 纯中文且属规范名册 | ✅ 优先 | ✅ 是 |
 * | 成员名 | `name` | 团队内唯一 | 职位名 或 `职位名-<序号>` | ✅ 重名时才露序号 | ❌ |
 * | 成员 ID | `memberId` | 全局唯一 | `sophia-<slug>-<uuid8>` | ❌ | ❌ |
 *
 * 素材图的职位标签已烧入像素（实测不透明像素占比 94.4%），无法改写 ——
 * 这正是 `position` 与 `name` 必须分层的原因（FR-5A.4：界面显示名优先用职位名）。
 *
 * 名册闭集 `POSITIONS`、slug 表 `POSITION_SLUGS`、`memberId` 的构造/解析/门禁
 * 由 SPEC §3.2–§3.6 定义，落在 `src/naming.ts`（`t5` 产出）；本文件只冻结三层**类型**。
 */

import type { MemberId } from './ids.ts'

/**
 * 职位名（FR-5A.1）：规范名册内的一项，纯中文。
 *
 * 刻意是 `string` 而非 `KnownPosition` 字面量联合 —— 名册是 `src/naming.ts` 的运行时闭集，
 * 类型层不能反向依赖它（否则命名门禁与类型定义会循环依赖）。门禁在创建/重命名入口执行。
 *
 * **也不做品牌化**（评审建议过 `Brand<string,'Position'>`）。理由：
 * 1. SPEC §3.1 把这个类型逐字钉为 `export type Position = string`；改口径要改契约。
 * 2. 真正决定合法值的不是品牌，而是 `validatePosition()` 的**运行时闭集校验**
 *    （20 个规范职位，裁定 Q-D 定为硬拒绝）。品牌只挡得住「把 MemberName 传进来」，
 *    挡不住「传一个不在名册里的字符串」—— 而后者才是实际的失效模式。
 * 3. 品牌会让每个构造点都要 `as` 强转，把校验压力从门禁挪到调用点，方向是反的。
 * （`MemberName` 同理，见下。）
 */
export type Position = string

/**
 * 成员名（FR-5A.2）：职位名本身，或 `职位名-<序号≥2>`。团队内唯一。
 * 与 `Position` 同为 `string` 的理由见上 —— 由 `validateMemberName()` 在入口校验形状与唯一性。
 */
export type MemberName = string

/** 三层标识的整体携带体。 */
export interface MemberIdentity {
  /** 职位（FR-5A.1）：非唯一，同职位可多实例。 */
  readonly position: Position
  /** 成员名（FR-5A.2）：团队内唯一。 */
  readonly name: MemberName
  /** 成员 ID（FR-5A.3）：全局唯一，界面不展示。 */
  readonly memberId: MemberId
}
