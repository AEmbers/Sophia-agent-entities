import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * 包名 —— 从 `package.json` **读**，不重述字面量。
 *
 * 为什么要在这里读（而不是只在 `tsdown.config.ts` 里读一次）：
 * `src/client/index.ts` 的 `export const PLUGIN_ID = __SOPHIA_PLUGIN_ID__`
 * 是一个**构建期注入**的自由变量（tsdown 的 `define` 会替换它）。
 * 测试直接跑**源码**、不经过 tsdown，所以那个标识符在测试里是**未定义**的 ⇒
 * 一旦有用例 import 到 `src/client/index.ts`，会当场
 * `ReferenceError: __SOPHIA_PLUGIN_ID__ is not defined`（已实测）。
 *
 * 故下面用 `define` 把同一个字面量注进去 —— **仍然只有一个真源**
 * （`package.json` 的 `name`），只是现在有**两处**注入点（tsdown 与 vitest）。
 * 若哪天包改名，两处都跟着变（都是从 package.json 读的），不会漂移。
 *
 * ⚠ 与 `tsdown.config.ts` 的 `PLUGIN_ID` 是**同一个判据**：读到空/非字符串
 * 就当场抛。否则会得到 `PLUGIN_ID === undefined`，
 * 而那是「宿主好了、浏览器半静默找不到」的经典成因。
 */
const PLUGIN_ID: string = (() => {
  const pkgPath = new URL('./package.json', import.meta.url)
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const name = (parsed as { name?: unknown }).name
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('vitest.config: package.json 的 name 缺失或是空串，__SOPHIA_PLUGIN_ID__ 无法注入')
  }
  return name
})()

/**
 * `@sophia/core` 的 vitest 配置。
 *
 * 说明：本包 tsconfig 采用 `docs/SPEC-sophia-core.md` §1.3 的冻结配置
 * （`"types": ["node"]` + devDependency `@types/node`），因此这里的
 * `vitest.config.ts` 本身也在 tsconfig 的 `include` 范围内、参与类型检查。
 *
 * `.ts` 显式扩展名的相对 import 由 `allowImportingTsExtensions` 允许
 * （配合 `noEmit: true`，本期只做类型检查与测试，不产出构建物）。
 */
export default defineConfig({
  /**
   * 构建期注入（与 `tsdown.config.ts` 的 `define` 同源，见上面的 `PLUGIN_ID`）。
   * 没有这一条时，任何 import `src/client/index.ts` 的用例会
   * `ReferenceError: __SOPHIA_PLUGIN_ID__ is not defined`。
   */
  define: {
    __SOPHIA_PLUGIN_ID__: JSON.stringify(PLUGIN_ID),
  },
  /**
   * JSX 变换设置 —— **必须与 `tsconfig.client.json` 对齐**（t5）。
   *
   * client 半用 `jsx: "react-jsx"` + `jsxImportSource: "sophia-jsx"`，
   * 而 `sophia-jsx/jsx-runtime` 是 tsconfig 的 **paths 映射**
   * （指向 `src/client/jsx-runtime.ts`）。
   *
   * ⚠ **实测：本机 vitest 4.1.11 走 Vite 8 + oxc，不是 esbuild。**
   * 故只配 `oxc.jsx`。曾经同时写过一份 `esbuild: { jsx, jsxImportSource }`，
   * 带来两个问题（都由队友独立复核并报回）：
   *
   * 1. **它让 `tsc -p tsconfig.json` 恒红**：`vitest.config.ts` 在
   *    `tsconfig.json` 的 `include` 里（t1 有意加进去的：构建配置本身也是代码），
   *    而 vitest 4 的 `esbuild` 选项类型不接受顶层 `jsx` / `jsxImportSource` ⇒
   *    `TS2769: 'jsx' does not exist in type 'ESBuildOptions'`。
   *    这条红会同时拖垮 t1 / t5 / t7 的 typecheck 门禁。
   * 2. **它根本不生效**：Vite 8 打印
   *    「Both esbuild and oxc options were set. oxc options will be used」——
   *    即一份**看起来在配、实际被忽略**的配置。
   *
   * ⇒ 删掉 `esbuild` 块。理由不是「删掉就能过」，而是**它是一份无效配置**：
   * 留着它既过不了类型检查，也不会在运行时起作用，只会误导后来者以为
   * 「JSX 由 esbuild 处理」。真要用 esbuild 路径（Vite 换回时）再加，
   * 那时它的类型形状也已不同。
   */
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'sophia-jsx',
    },
  },
  resolve: {
    alias: {
      'sophia-jsx/jsx-runtime': fileURLToPath(new URL('./src/client/jsx-runtime.ts', import.meta.url)),
      // ⚠ **dev 模式用另一个说明符**（实测：只映射上面那条会报
      // `Cannot find package 'sophia-jsx/jsx-dev-runtime'`，整份用例集
      // 0 个测试 —— 典型的「测试没跑起来」假绿）。
      // 两套说明符的签名不同，见 `src/client/jsx-dev-runtime.ts`。
      'sophia-jsx/jsx-dev-runtime': fileURLToPath(new URL('./src/client/jsx-dev-runtime.ts', import.meta.url)),
      // ⚠ 这一条**只管 `import`** —— 对裸 `require` 无效（实测：require 走 Node 解析，
      //   不进 Vite 模块图）。真正让 `vendor/bridge.ts` 那句 require 能解析的，是
      //   `scripts/seed-ui-primitives-stub.mjs` 种进 node_modules 的替身（挂在 `pretest`）。
      //   两条同时存在不是冗余：这条服务「直接 import 这个模块」的用例，
      //   那条服务「产品代码 require 它」的真实路径。
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/stubs/ui-primitives.ts', import.meta.url)),
      // ── 宿主平台模块的测试替身 ─────────────────────────────────────────────
      //
      // `@deepseek-ai/dsh-client-ui-primitives` 是**运行期由宿主提供**的平台模块，
      // 它**不在本包的 `node_modules` 里**（实测 `Test-Path
      // packages\sophia-core\node_modules\@deepseek-ai\dsh-client-ui-primitives`
      // = False）。`vendor/bridge.ts` 用 `require('…')[key]` 惰性取用它，于是：
      //
      // - 面板**折叠态**不碰它 ⇒ 既有 SSG 断言不受影响；
      // - 面板**展开态**（主体 / 名册 / 头像 / Modal）在测试里当场抛
      //   `MODULE_NOT_FOUND` ⇒ 核心路径结构上不可测。
      //
      // 这里把它指到一个**显式的测试替身**（`tests/stubs/ui-primitives.ts`，
      // 文件头写明了它掩盖什么）。**不是**在生产代码里给缺失做降级 ——
      // 那会把「宿主没提供这个模块」这件事实藏起来。
    },
  },
  test: {
    environment: 'node',
    // ⚠ **必须同时写 `root`**（OCR 评审 [37] 的假绿隐患）：
    // `include` 是相对 `root` 解析的。若只在命令行传 `--root packages/sophia-core`
    // 而配置里没有 `root`，那么任何**不带 `--root`** 的调用（从仓库根直接 `vitest run`、
    // 或将本包并入 workspace/projects 聚合）都会以仓库根为 root 去套这两个 glob，
    // 匹配不到文件 —— 而 vitest 在「一个测试文件都没匹配到」时会**静默报 0 个测试**，
    // 正是 SPEC §7.1/§11 警告的那类假绿。
    // 用 `import.meta.dirname` 锚定到本配置文件所在目录，配置即与调用方的 cwd 无关。
    root: import.meta.dirname,
    // 同时覆盖两种通行命名（*.spec.ts 与 *.test.ts），避免测试文件被静默漏跑。
    // 已用反向自检实测：删掉全部测试文件后 vitest 以 exit 1 退出，不会静默通过。
    //
    // `tsx` 是 t5 加的（client 半的用例要渲染 JSX）：它们是**真测试**，
    // 不是构建产物 —— `lib/` 是产物、被 .gitignore 忽略，而 `tests/client/`
    // 入库、随 `pnpm test` 跑。故 glob 必须覆盖它，否则那些用例**静默不跑**。
    // ⚠ 全局替身走 `setupFiles` + `vi.mock`，**不是** `resolve.alias`：
    //   alias 只对 ESM `import` 生效，而 `vendor/bridge.ts` 用的是裸 `require`，
    //   真切用途经是后者。实测：只配 alias 时那条「能解析」的用例是绿的，
    //   但面板一展开就是 `Cannot find module` —— 假绿。理由详见该文件头。
    setupFiles: ['./tests/setup/ui-primitives-mock.ts'],
    include: ['src/**/*.{spec,test}.{ts,tsx}', 'tests/**/*.{spec,test}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
