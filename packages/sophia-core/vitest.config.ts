import { defineConfig } from 'vitest/config'

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
    include: ['src/**/*.{spec,test}.ts', 'tests/**/*.{spec,test}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
