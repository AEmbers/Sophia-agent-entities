/**
 * `@sophia/core` —— 插件入口 + **领域库的公共入口**（同一个模块，两个身份）。
 *
 * ── 为什么本文件同时是这两样东西（这是被 OCR 评审 [7] 纠正过的设计）──
 *
 * DSH 的 client-modules（`@deepseek-ai/dsh-client-modules`）扫描 loader 行时，
 * 只对**裸包名**行做包解析：`exactPackageSpecifier()` 要求 `@scope/name` 恰好
 * 两段，`@sophia/core/host` 这种三段子路径会被整行跳过（实测该函数源码）。
 * 所以「让 GUI 认得本插件的浏览器半」必须有一条**裸包名行**，而那一行 import 的
 * 就是 `exports["."]` —— 也就是本文件。
 *
 * 第一版把 `exports["."]` 只做成一个空壳、把领域库挪去 `./core`。那会让
 * `import { ... } from '@sophia/core'` **拿不到任何领域符号**，而
 * `src/types/index.ts` 与 `docs/SPEC-sophia-core.md` 都写明「下游一律从
 * `@sophia/core` 导入」—— 等于给 `t2`–`t5` 埋了一个静默的坑。
 * 因此本文件**同时**导出领域库与插件三元组（`name` / `inject` / `apply`），
 * 与在跑的 `dsh-postman` 同构：它的 `exports["."]` 同样既是宿主半边、
 * 又承载自己的对外 API。
 *
 * 领域库与插件键**不冲突**：实测 `@sophia/core` 的 31 个领域导出里
 * 没有 `name` / `inject` / `apply` / `Config` / `reusable` 任何一个
 * （`Object.keys` 逐个比对）。`tests/shell.spec.ts` 把这个不冲突钉成断言。
 *
 * ── 关于启动路径上的 `node:sqlite`（如实说明，不含糊）──
 *
 * 领域库 `./index.ts` 会拉进 `node:sqlite`（`ledger.ts` 直接用 `DatabaseSync`）。
 * 本文件因此在 DSH 启动路径上。**这一点已实测**，不是推断：
 * 用真实宿主运行时 `DSH Desktop.exe`（`ELECTRON_RUN_AS_NODE=1`，
 * node=24.18.1 / electron=43.3.0）import `lib/index.js` → 成功，31 个符号；
 * 同一运行时里 `require('node:sqlite').DatabaseSync` 是 function。
 * 且 `ledger.ts` 在**模块作用域没有副作用**（只有常量与函数定义，
 * `new DatabaseSync` 在 `openLedger()` 函数体内），import 本身不碰磁盘。
 *
 * @module @sophia/core
 */

/**
 * 领域库：类型、账本、命名门禁、派生策略与两级审批。
 *
 * 这条 re-export 是**对外契约**（`src/types/index.ts` 与 SPEC §3.1 承诺
 * 下游从 `@sophia/core` 导入），不要因为「启动路径想干净」而摘掉它。
 */
export * from './index.ts'

/** 插件名；DSH loader 行用它做诊断标签。 */
export const name = 'sophia'

/**
 * 硬依赖服务：**空**。
 * 真正的宿主注册（路由 / 公告 / 工具）在 `@sophia/core/host` 那一行；
 * 本行只负责「让浏览器半被发现」这一件事，声明服务只会让它更容易不加载。
 */
export const inject: readonly string[] = []

/**
 * 裸名行的宿主侧入口。
 *
 * 有意保持**近空**：真正的宿主注册在 `src/host.ts`（`@sophia/core/host` 行）。
 * 两条行都调 `apply` 会重复挂同一条路由（cordis 路由注册不允许撞），
 * 所以这里只留一行诊断日志证明「本行确实被加载了」。
 *
 * ⚠ 这里**没有** try/catch（OCR 复核 [3]，已修正）：本函数只执行一条
 * `console.log` + 一个模板串，没有可抛语句，catch 是**不可达的死代码**
 * —— 写着一个永远走不到、却宣称「拦住了会拖垮 loader 的异常」的兜底，
 * 比没有更糟（它让读者以为这里有防护）。`host.ts` 那份是真需要的，
 * 因为那边有 `ctx.get` / `register` 等会抛的调用。
 */
export function apply(): void {
  console.log(
    `[sophia] plugin entry loaded (${name}); host half is registered by the '@sophia/core/host' row`,
  )
}
