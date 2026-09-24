/**
 * 宿主平台模块 `@deepseek-ai/dsh-client-ui-primitives` 的**测试替身**（ESM 副本）。
 *
 * ## 为什么有两份替身
 *
 * | 取用途经 | 谁在用 | 哪一份生效 |
 * |---|---|---|
 * | ESM `import` | 直接 import 这个模块的代码/用例 | **本文件**（经 `vitest.config.ts` 的 `resolve.alias`） |
 * | 裸 `require` | `src/client/vendor/bridge.ts` 的 `primitives` 惰性代理 | `node_modules/@deepseek-ai/dsh-client-ui-primitives/`（由 `scripts/seed-ui-primitives-stub.mjs` 种入，挂在 `pretest`） |
 *
 * 两份**必须保持同样的语义**。只改一份，症状是：用例绿、真实渲染路径红（或反过来）。
 *
 * ## ⚠ 本文件最重要的一条：组件**必须渲染 children**
 *
 * 最初这里每个组件都是 `() => null`，理由是「替身不该往 DOM 里塞东西」。**那是错的**，
 * 而且错得很隐蔽 —— 它把**整棵子树**从渲染结果里吞掉了：
 *
 * 上游把这些宿主组件当**容器**用，例如
 * `<Tooltip><button data-team-action="enter" /></Tooltip>`、`<Modal>…</Modal>`、
 * `<DisclosureRow>…</DisclosureRow>`。替身返回 `null` 之后，「子树里到底有没有那个按钮」
 * 在测试里就**结构性不可观测**了。
 *
 * **实测代价（2026-09-24）**：`TeamFooterAction`（上游**模式切换控件**的宿主组件）
 * 在用例里渲染成一个空的 `<div class="_footerStack_…">`，我第一反应是去**产品代码**里找
 * bug、怀疑移植丢了按钮 —— 实际是替身把按钮吞了。白跑一轮。
 * ⇒ **一个吞 children 的替身，是一层假绿（也可能假红）的来源。**
 *
 * 现在的实现：有 children 就原样渲染，没有就返回 null（后者让
 * `tests/client/primitives-stub.spec.ts` 里那条「无参调用返回 null」的既有断言仍然为真）。
 *
 * ## 它仍然掩盖什么（必须写明）
 *
 * 替身**不模拟**真实宿主组件的任何行为：`Tooltip` 不定位、`Modal` 不做遮罩、`Button` 的
 * `variant` 不给类名、图标不画路径。所以用例只能验「这条路走到了、没抛、子树里的结构标记
 * 在」，**不能**验样式与真实交互。**不要**把「测试通过」读成「宿主模块的形状对了」。
 * 真实形状的权威来源是 `src/client/vendor/upstream-modules.d.ts`（从上游**真实调用点**反推，
 * 目前声明 34 个成员；下面导出的是其中被索菲亚实际取用的 27 个 + 1 个预留）。
 */
type StubProps = { readonly children?: unknown } & Record<string, unknown>

/**
 * 替身的统一实现：**把 children 原样渲染出去**，其余 props 一概无视。
 * 无 props 调用返回 `null`（保持既有断言的语义）。
 */
function passChildren(props?: StubProps): unknown {
  return props?.children ?? null
}

/** hook：可调用、不抛、返回 null。 */
const nullFn = (): null => null
/** hook：可调用、不抛、返回 undefined。 */
const noop = (): void => undefined

/**
 * ⚠ 这张表要与 `scripts/seed-ui-primitives-stub.mjs` 的 `COMPONENTS` 保持
 * **成员集合一致**。
 *
 * ⚠ 上一版这里写的是「**逐字一致**」，而独立评审核到那句**不成立**：两表的
 * 成员集合相同，但**顺序不同**（本表把 `Input` 排在第 9，seed 脚本排在第 20）。
 * 顺序对功能零影响（两处都是「有没有这个成员」的集合判定）⇒ 就把要求
 * 改成真正要守的那一条：**集合一致**。写「逐字」会让后来者去做一次没有
 * 意义的字面比对，还会因为比对不上而怀疑是一处真缺陷。
 *
 * 依据是 `vendor/upstream-modules.d.ts` 的 `declare module` 块（上游真实调用点反推），
 * 不是凭命名习惯写的。已用脚本核过「vendor 树里真实取用的成员」= 27 个，全部在此表内。
 */
const COMPONENTS = [
  'Menu',
  'Button',
  'DisclosureRow',
  'Modal',
  'Pill',
  'Tooltip',
  'MarkdownText',
  'MarkdownLabels',
  'Input',
  'IconChevronLeftOutline14',
  'IconChevronRightOutline14',
  'IconChevronDownOutline14',
  'IconChecklistOutline14',
  'IconPaperclipOutline16',
  'IconSendOutline16',
  'IconPanelLeftOutline16',
  'IconBranchOutline16',
  'IconStopFill16',
  'IconWarningOutline16',
  'IconAgentPresetOutline16',
  'IconPlusOutline16',
  'IconEllipsisOutline16',
  'IconFolderOpen16',
  'IconQueueOutline14',
  'IconListPenOutline16',
  'IconUserOutline16',
  'IconPlayOutline16',
] as const

const api: Record<string, unknown> = {
  useAnchoredMaxHeight: nullFn,
  useDismissOnOutsidePointer: noop,
}
for (const name of COMPONENTS) api[name] = passChildren

// 具名导出 + default：`bridge.ts` 取具名成员，但有的转译路径会把 CJS 归到 `default` 上。
export default api
export const {
  Menu, Button, DisclosureRow, Modal, Pill, Tooltip, MarkdownText, MarkdownLabels, Input,
  IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronDownOutline14,
  IconChecklistOutline14, IconPaperclipOutline16, IconSendOutline16, IconPanelLeftOutline16,
  IconBranchOutline16, IconStopFill16, IconWarningOutline16, IconAgentPresetOutline16,
  IconPlusOutline16, IconEllipsisOutline16, IconFolderOpen16, IconQueueOutline14,
  IconListPenOutline16, IconUserOutline16, IconPlayOutline16,
  useAnchoredMaxHeight, useDismissOnOutsidePointer,
} = api as Record<string, any>
