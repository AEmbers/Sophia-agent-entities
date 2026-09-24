/**
 * 本插件的 **JSX 开发运行时**入口（`jsxImportSource` 在 dev 模式下的目标）。
 *
 * ## 为什么需要它（缺了它就当场红）
 *
 * 自动 JSX 运行时有**两套**说明符，按 `mode` 二选一：
 *
 * | 模式 | 说明符 | 签名 |
 * |---|---|---|
 * | production | `<source>/jsx-runtime` | `jsx(type, props, key)` |
 * | **development** | `<source>/jsx-dev-runtime` | `jsxDEV(type, props, key, isStaticChildren, source, self)` |
 *
 * 实测：只映射 `jsx-runtime` 时，vitest（跑在 dev 模式）会在
 * `components.tsx` 处报
 * `Cannot find package 'sophia-jsx/jsx-dev-runtime'` —— **整份用例集 0 个测试**。
 * 那是本仓记录过的典型假绿形态：「测试文件没跑起来」，而如果只看
 * 「有没有失败用例」，会读成「没有失败」。
 *
 * ## 为什么 `jsxDEV` 的前三个参数就够
 *
 * 后三个参数（`isStaticChildren` / `source` / `self`）只供 dev 的
 * **调试信息**使用（组件栈、行列号），React 的 `createElement` 不需要它们。
 * 本插件的目的是让 dev/prod 走**同一条**惰性 require 路径，而不是复刻
 * React 的开发期告警 —— 那套告警由 `react` 自己的 dev 构建负责。
 *
 * @module @sophia/core/client/jsx-dev-runtime
 */

import { jsx, jsxs } from './jsx-runtime.ts'

// 单一出口：不再同时「本地 import jsx」又「re-export jsx」
// （OCR 复核 LOW：两条绑定路径，改导出清单时容易分叉）。
export { Fragment } from './jsx-runtime.ts'

/**
 * 开发期 JSX 工厂。
 *
 * 签名对齐 `react/jsx-dev-runtime` 的 `jsxDEV`。
 *
 * ⚠ **`_isStaticChildren` 不能忽略**（OCR 复核 MEDIUM）：
 * dev 模式下编译器把**每个多静态子节点**的元素都走
 * `jsxDEV(..., isStaticChildren=true, ...)` —— 那是 `jsxs` 对应的入口。
 * 初版无条件委托给 `jsx`，等于把 dev 的静态子节点路径塌缩到动态路径上，
 * 而这个「恰好能用」正是姊妹文件 `jsx-runtime.ts` 明确警告过的那种**委托巧合**：
 * 一旦委托实现变了（不再接受数组形态的 `props.children`），
 * dev 会与 prod 行为分叉、而 prod 的用例抓不到。
 * 现在按标志路由到与 prod 相同的两个入口，dev/prod 语义一致。
 *
 * 后两个参数（`source` / `self`）只供 dev 的**调试信息**使用
 * （组件栈、行列号），React 的 `createElement` 不需要它们 —— 那套告警由
 * `react` 自己的 dev 构建负责，本插件不复刻。故它们**显式忽略**而不是漏接。
 */
export function jsxDEV(
  type: unknown,
  props: unknown,
  key?: unknown,
  isStaticChildren?: boolean,
  _source?: unknown,
  _self?: unknown,
): ReturnType<typeof jsx> {
  return isStaticChildren === true ? jsxs(type, props, key) : jsx(type, props, key)
}
