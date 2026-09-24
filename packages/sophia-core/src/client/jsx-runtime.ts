/**
 * 本插件的 **JSX 运行时入口**（`tsconfig.client.json` 的 `jsxImportSource` 目标）。
 *
 * ```jsonc
 * // tsconfig.client.json
 * "jsx": "react-jsx",
 * "jsxImportSource": "sophia-jsx",
 * "baseUrl": ".",
 * "paths": { "sophia-jsx/jsx-runtime": ["./src/client/jsx-runtime.ts"] }
 * ```
 *
 * ## 为什么需要这个文件（而不是让 TS 注入 `react/jsx-runtime`）
 *
 * 默认自动运行时会注入 `import { jsx } from 'react/jsx-runtime'`，打包产物里
 * 那是一条**顶层** `require("react/jsx-runtime")`，会让
 * `tests/shell.spec.ts:474`（真实 loader 契约 + 抛出型 `require`）当场变红
 * —— 已实测复现（`Error: unexpected require react`）。
 * 完整对照表与取舍见 `./react-runtime.ts` 的文件头。
 *
 * ## 为什么不用经典 `jsxFactory: "h"`
 *
 * 那条路也能消除顶层 require，但 TS 对 JSX 元素**不做组件 prop 检查**
 * （`h` 的形参是 `unknown`），拼错属性名不报错。本文件这条路保留了
 * 自动运行时的**严格 prop 检查** —— 实测（临时给 `Deep` 传 `extraProp`）：
 *
 * ```
 * error TS2322: Property 'extraProp' does not exist on type 'IntrinsicAttributes & Props'
 * ```
 *
 * 这正是本仓反复强调的那类问题（「用 `as never` 绕过检查」的同源变体）：
 * **不要用配置去换掉类型安全**。
 *
 * @module @sophia/core/client/jsx-runtime
 */

import type { ReactElement } from 'react'

import { react } from './react-runtime.ts'

/**
 * JSX 工厂的**唯一**实现（`jsx` 与 `jsxs` 共用）。
 *
 * 为什么抽出一个共享体（OCR 复核 MEDIUM）：初版把 `jsx` 与 `jsxs` 写成两份
 * **逐字节相同**的函数体，并在注释里声称「两者契约不同」。注释与代码矛盾本身
 * 就是缺陷 —— 将来只改其中一份就会静默分叉。正确的表达是：
 * **契约在调用点上不同（静态 vs 动态子节点），实现上目前恰好相同**，
 * 所以共享一个体、并把这个「恰好」写清楚。
 */
function createElementFromJsx(type: unknown, props: unknown, key: unknown): ReactElement {
  // React 把 `key === null` 与 `key === undefined` **同等**视为「没有 key」。
  // 因此这里必须覆盖两者（用严格相等而不是 `==`：本仓风格门禁要求 `===`/`!==`，
  //  而 `key == null` 虽然语义正确，却会被 lint/复核反复当成疏漏 —— 写全更清楚）。
  if (key === null || key === undefined) return react().createElement(type, props)
  // `props` 可能是 `null`/`undefined`：`{...null}` 得到 `{}`，此时只有 `key` 一个属性
  // ——没有「丢掉别的 prop」的问题（本来就没有别的 prop）。这是 `createElement`
  // 在「无 props 但有 key」时的正确输入。
  return react().createElement(type, { ...(props as object), key })
}

/**
 * 单子节点 JSX（`<div>a</div>`）的运行时。
 *
 * 与 `react/jsx-runtime` 的 `jsx` 同签名：TS 的自动运行时按名字注入 `jsx` / `jsxs`。
 * `props` 里的 `children` 已经由编译器放好，故这里不再单独接 `children` 形参。
 *
 * ⚠ **`null` key 与 `undefined` key 是同一件事**（OCR 复核 MEDIUM）：
 * React 把 `key === null` 当作「没有 key」。初版只判 `undefined`，
 * 于是编译器发出 `jsx(type, props, null)` 时会走 `{...props, key: null}`，
 * 而 React 会把 `null` **归一化成一个真实的 key 字符串 `"null"`** ——
 * 凭空污染 key 空间，并可能触发「key 重复」警告。
 */
export function jsx(type: unknown, props: unknown, key?: unknown): ReactElement {
  return createElementFromJsx(type, props, key)
}

/**
 * 多子节点 JSX 的运行时（编译器对「多个静态子节点」调用它）。
 *
 * ⚠ `jsxs` / `jsxDEV(isStaticChildren=true)` 与 `jsx` 的**契约不同**：
 * 静态子节点入口的 `children` 是**作为 `props.children` 的数组**传入、
 * 且 `key` 已并入 props。
 * 当前两者共用同一个实现，只是因为 `createElement` 恰好接受数组形态的
 * `props.children` —— 一个**委托实现的巧合**，不是本文件的契约。
 * ⇒ 所以这里显式声明自己的签名（而不是 `export const jsxs = jsx` 这种别名），
 *   将来若换掉委托实现，两个入口要分别处理。
 */
export function jsxs(type: unknown, props: unknown, key?: unknown): ReactElement {
  return createElementFromJsx(type, props, key)
}

/**
 * Fragment 运行时（`<>…</>`）。
 *
 * 用真正的 `Symbol.for('react.fragment')` 而不是包一层 `<div>`：后者会凭空往
 * DOM 插一层元素，破坏 grid/flex 布局（成员卡是网格单元）。
 *
 * ⚠ **上面的「实测为真」不是一句可自证的注释**（OCR 复核 LOW）：本文件在浏览器里
 * 拿不到顶层 React 引用，故**运行期无法**校验这个 symbol 的身份。
 * 该身份由 `tests/client/jsx-runtime.spec.ts` 在**服务端**（能 require React 的
 * 环境）实际断言，而不是靠这里的一句话保证。若宿主 React 换了哨兵值，
 * 那条用例会红、而不是让 Fragment 静默退化成未知元素类型。
 *
 * 契约：本值依赖「宿主 React 用 `Symbol.for('react.fragment')` 作 Fragment 哨兵」，
 * 这是 React 18/19 的稳定实现细节；升级宿主 React 大版本时应重跑上述用例。
 */
export const Fragment: symbol = Symbol.for('react.fragment')
