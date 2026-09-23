/**
 * 领域类型汇总出口（SPEC §2 / §3.1 / §6.1）。
 *
 * 分文件而非单文件，是因为三块类型有**不同的变更频率与评审人**：
 * - `ids.ts` / `roles.ts` / `team.ts` —— 角色与实体骨架（最重要，AC-ROLE-1 的窗口不绑团在此）
 * - `member.ts` —— FR-5A 三层标识
 * - `staging.ts` —— FR-1 双模草案
 * - `operations.ts` —— FR-10 账本事件的判别联合
 * - `guards.ts` —— 判别联合的运行期守卫与穷尽性工具
 *
 * 下游一律从 `@sophia/core`（或本文件）导入，**不要**深入具体文件 ——
 * 这样文件拆分是可演进的实现细节，而 `TeamSpec` 等共享类型不会出现两个名义版本。
 */

export * from './ids.ts'
export * from './roles.ts'
export * from './team.ts'
export * from './member.ts'
export * from './staging.ts'
export * from './operations.ts'
export * from './guards.ts'
