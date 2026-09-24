/**
 * `@sophia/core` 的公共入口。
 *
 * 已导出：
 * - **领域类型与角色模型**（`t3`，SPEC §2 §3.1 §6.1）；
 * - **追加式账本与 scope 增量读取**（`t4`，SPEC §6，`src/ledger.ts`）；
 * - **三层标识命名门禁**（`t5`，SPEC §3 全文，`src/naming.ts`）；
 * - **派生策略与两级审批**（`t6`，SPEC §4 §5，`src/delegation.ts` / `src/approval.ts`）；
 * - **成员运行时**（`t2`，`src/runtime/member-runtime.ts`）：激活、句柄缓存、双通道唤醒；
 * - **视图投影**（`t3`，`src/projection/index.ts`）：账本事实 → UI 数据面。
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

/**
 * 成员运行时（`src/runtime/member-runtime.ts`，`t2`）。
 *
 * 放在**领域入口**而不是只留在 `./runtime/member-runtime`：`docs/SPEC-sophia-core.md`
 * 与 `src/types/index.ts` 都写明「下游一律从 `@sophia/core` 导入」，
 * 而 t3（视图投影）要读成员存在态、t4（工具集）要按成员注入策略。
 * 让它只能从深路径导入会造出第二套导入约定。
 */
export * from './runtime/member-runtime.ts'

/**
 * 视图投影（`src/projection/index.ts`，`t3`，FR-10.2 / FR-10.3）。
 *
 * ⚠ 它导出的运行期值**刻意没有一个以 `View` / `Projection` / `State` 结尾**：
 * `tests/ledger.spec.ts` 的 AC-10-10 按导出名后缀判「有没有导出可变的视图状态」，
 * 而本模块的投影函数是**动词式**命名（`projectRoster` / `projectChannel` / `projectThread`），
 * 类型（`RosterSnapshot` 等）在运行期被擦除、不进 `Object.keys`。
 * 细节与实测依据见 `src/projection/index.ts` 的文件头。
 */
export * from './projection/index.ts'

/**
 * Agent 工具集（`src/tools/`，`t4`，`docs/DEVELOPMENT.md` §3.5）。
 *
 * 五个成员可调用的工具：消息 / 认领任务 / 派生团 / 换模 / 上下文接力。
 * 本模块只**定义**工具；**注册**由宿主半（`src/host.ts`）完成。
 *
 * ⚠ 它经过 `src/tools/index.ts` 的**显式转发**（不是 `export *`）：工具层内部的
 * 校验小工具（`src/tools/internal.ts`）不是契约，不该出现在本包的公共面上。
 * 它拉进 `node:crypto`（`randomUUID`）—— 与 `src/ledger.ts` 的 `node:sqlite` 同类，
 * 因此**浏览器半不得 import 本模块**（见 `src/projection/index.ts` 文件头对 t5 的同类警告）。
 */
export * from './tools/index.ts'
