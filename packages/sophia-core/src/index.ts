/**
 * `@sophia/core` 的公共入口。
 *
 * 已导出：
 * - **领域类型与角色模型**（`t3`，SPEC §2 §3.1 §6.1）；
 * - **追加式账本与 scope 增量读取**（`t4`，SPEC §6，`src/ledger.ts`）；
 * - **三层标识命名门禁**（`t5`，SPEC §3 全文，`src/naming.ts`）；
 * - **派生策略与两级审批**（`t6`，SPEC §4 §5，`src/delegation.ts` / `src/approval.ts`）。
 *
 * `docs/SPEC-sophia-core.md` 是本包的唯一契约来源。
 *
 * 设计约束（SPEC §1.1，实测得出）：
 * 本包**自持全部领域类型**，不 import 任何 `@deepseek-ai/*` 类型。
 * 本机 DSH SDK 安装（`~/.dsh/core-0.1.5-rc.1/@deepseek-ai`，243 个包）含 0 个 `.d.ts`，
 * 各包 `types` 字段指向的 `lib/types/index.d.ts` 全部不存在 ⇒ import 会报
 * `TS7016` 并以 exit 2 失败。
 */

/** 本包语义版本；与 `package.json` 的 `version` 同源，由 `tests/scaffold.spec.ts` 断言一致。 */
export const SOPHIA_CORE_VERSION = '0.1.0'

/** 版本号类型（脚手架占位，供下游正常 import 到非空符号）。 */
export type SophiaCoreVersion = typeof SOPHIA_CORE_VERSION

/** 领域类型与角色模型（`src/types/`）。 */
export * from './types/index.ts'

/** 追加式账本与 scope 增量读取（`src/ledger.ts`，SPEC §6 / FR-10）。 */
export * from './ledger.ts'

/** FR-5A 三层标识命名门禁（`src/naming.ts`，SPEC §3 全文）。 */
export * from './naming.ts'

/** 审批票据与人类收件箱的类型（`src/approval.ts`，SPEC §5.1）。 */
export * from './approval.ts'

/** 派生策略与两级审批（`src/delegation.ts`，SPEC §4 §5 全文 / FR-5.2·5.3·5.4·5.6）。 */
export * from './delegation.ts'
