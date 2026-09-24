/**
 * 把宿主平台模块 `@deepseek-ai/dsh-client-ui-primitives` 的**测试替身**种进
 * `packages/sophia-core/node_modules/@deepseek-ai/`。
 *
 * ## 为什么需要「种进 node_modules」这种脏手法
 *
 * 要它的是 `src/client/vendor/bridge.ts` 那句：
 *
 * ```js
 * require('@deepseek-ai/dsh-client-ui-primitives')[key]
 * ```
 *
 * **裸 `require` 不受 Vite/vitest 的任何模块配置约束** —— 实测三条路全试过，全部无效：
 *
 * | 手段 | 对 `import` | 对裸 `require` |
 * |---|---|---|
 * | `resolve.alias` | ✅ 生效 | ❌ 不生效 |
 * | `test.alias`   | ✅ 生效 | ❌ 不生效 |
 * | `vi.mock`      | ✅ 生效 | ❌ 不生效 |
 *
 * 原因是裸 `require` 在 vitest 的 ESM 环境里走 **Node 自己的解析**（`createRequire`），
 * 不进 Vite 的模块图。对照：`react-runtime.ts` 也写 `require('react')`，它没事 ——
 * 差别不在写法，而在 **`react` 真的躺在 `node_modules` 里**。
 *
 * ⇒ 所以唯一可靠的办法就是**让它真的躺在那儿**。
 *
 * ## 为什么是脚本而不是往仓库里塞一个假包
 *
 * 直接手放 `node_modules` 会被下一次 `pnpm install` 清掉（那是 pnpm 的地盘）。
 * 所以做成脚本 + 挂在 `pretest` 上：**每次 `pnpm test` 之前自动重放**，不靠人记得。
 * 它是**幂等**的 —— 内容一致时什么都不写。
 *
 * ## 它掩盖了什么（与 `tests/stubs/ui-primitives.ts` 同一口径）
 *
 * 每个成员都渲染 `null`、无副作用 ⇒ 子组件的存在性/属性/交互一概验不到；成员名不做
 * 拼写校验。用例只能验「这条路走到了、没抛、结构标记在」。
 * **不要**把「测试通过」读成「宿主模块的形状对了」——真实形状只能从宿主包反推
 * （见 `vendor/upstream-modules.d.ts` 的说明）。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const TARGET_DIR = join(REPO, 'packages', 'sophia-core', 'node_modules', '@deepseek-ai', 'dsh-client-ui-primitives')

/** 取自 `upstream-modules.d.ts` 的 `declare module` 块（上游真实调用点反推）。 */
const COMPONENTS = [
  'Menu', 'Button', 'DisclosureRow', 'Modal', 'Pill', 'Tooltip', 'MarkdownText', 'MarkdownLabels',
  'IconChevronLeftOutline14', 'IconChevronRightOutline14', 'IconChevronDownOutline14', 'IconChecklistOutline14',
  'IconPaperclipOutline16', 'IconSendOutline16', 'IconPanelLeftOutline16',
  'IconBranchOutline16', 'IconStopFill16', 'IconWarningOutline16',
  // 频道页 + 模式切换控件带来的三个（`TeamChannelPage` / `TeamFooterAction` / `TeamMemberEditor`）。
  'IconAgentPresetOutline16', 'Input',
  // ⚠ 左栏（侧边栏）带来的七枚。**必须在这里列出**，否则 `bridge.ts` 的惰性代理
  //   会取到 `undefined`，React 渲染 `<undefined />` 当场抛
  //   `Element type is invalid` —— 而症状会出现在**别的** agent 把它挂进
  //   `panel.tsx` 的那一刻，看起来像新接线的锅。
  //   这七条与 `vendor/upstream-modules.d.ts` 里那一段**同名同序**，两处一起改。
  'IconPlusOutline16', 'IconEllipsisOutline16', 'IconFolderOpen16', 'IconQueueOutline14',
  'IconListPenOutline16', 'IconUserOutline16', 'IconPlayOutline16',
]

const PKGJSON = JSON.stringify(
  {
    name: '@deepseek-ai/dsh-client-ui-primitives',
    version: '0.0.0-sophia-test-stub',
    private: true,
    main: 'index.js',
    description: '索菲亚测试替身（由 scripts/seed-ui-primitives-stub.mjs 生成，勿手工编辑）',
  },
  null,
  2,
) + '\n'

const INDEX = `// ⚠ 索菲亚的**测试替身**，由 scripts/seed-ui-primitives-stub.mjs 生成。
// 真身是 DSH 运行期提供的平台模块（宿主的模块表里有它，本仓 node_modules 里没有）。
//
// ⚠ 组件**必须渲染 children**，不能返回 null —— 上游把这些宿主组件当**容器**用
//    （<Tooltip><button data-team-action="enter" /></Tooltip> / <Modal>…</Modal> /
//     <DisclosureRow>…</DisclosureRow>），返 null 会把整棵子树吞掉，于是
//     「子树里有没有那个按钮」在测试里结构性不可观测。
//     实测代价（2026-09-24）：TeamFooterAction（上游**模式切换控件**的宿主）在用例里
//     渲染成空的 <div class="_footerStack_…">，我第一反应是去产品代码里找 bug —— 白跑一轮。
//     语义说明的完整版见 tests/stubs/ui-primitives.ts 的文件头（那份是 ESM 副本，两份要一致）。
'use strict'
const Null = (props) => (props === undefined || props === null ? null : props.children ?? null)
const nullFn = () => null
const noop = () => undefined
const api = {
${COMPONENTS.map(name => `  ${name}: Null,`).join('\n')}
  useAnchoredMaxHeight: nullFn,
  useDismissOnOutsidePointer: noop,
}
// 具名 + default 双给：取用途经是 \`require(...)[key]\`，但有的转译会把 CJS 归到 default。
module.exports = { ...api, default: api }
// ESM 互操作：某些加载路径按 ESM 取具名导出。
${COMPONENTS.map(name => `module.exports.${name} = api.${name}`).join('\n')}
`

function writeIfChanged(path, content) {
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8')
    if (current === content) return false
  }
  writeFileSync(path, content)
  return true
}

mkdirSync(TARGET_DIR, { recursive: true })
const wrotePkg = writeIfChanged(join(TARGET_DIR, 'package.json'), PKGJSON)
const wroteIndex = writeIfChanged(join(TARGET_DIR, 'index.js'), INDEX)

console.log(
  wrotePkg || wroteIndex
    ? `已种入测试替身：${TARGET_DIR}（package.json ${wrotePkg ? '写入' : '未变'} / index.js ${wroteIndex ? '写入' : '未变'}）`
    : `测试替身已就位且内容一致：${TARGET_DIR}`,
)
