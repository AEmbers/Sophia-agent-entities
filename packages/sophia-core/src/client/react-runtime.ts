/**
 * 浏览器半的 React 运行时访问层 —— **惰性 require**，故工厂注册期零 `require`。
 *
 * ## 这个文件存在的唯一理由（实测得出，不是风格偏好）
 *
 * `tests/shell.spec.ts:474` 用**真实 loader 契约**把 `lib/client.js` 载进来，
 * 并传一个**会抛错**的 `require`：
 *
 * ```ts
 * const mod = factory!((id) => { throw new Error(`unexpected require ${id}`) })
 * ```
 *
 * 这条断言的含义是：**`lib/client.js` 在被 materialize 的那一刻不得 require 任何东西**。
 * 实测（本任务，真实构建产物逐一比对）：
 *
 * | 写法 | 产物里的 `require(...)` | `factory(抛出型 require)` |
 * |---|---|---|
 * | `import { useState } from 'react'` / 默认 `jsx: react-jsx` | 顶层 `require("react")` + `require("react/jsx-runtime")` | **抛错** ⇒ 该条验收变红（已复现） |
 * | `import('./x.tsx')` 动态导入 | 顶层无，但产出**独立 chunk 文件** | 会去 `require("./x-<hash>.cjs")` ⇒ 抛错 |
 * | **本文件**：函数体内 `require('react')` | **只有 `factory: (require) =>` 那一行**（形参本身） | **通过** |
 *
 * 后两种各自为什么不行：
 *
 * - 顶层 `require("react")` 在真实浏览器里其实**是合法的** —— 宿主的浏览器模块表
 *   确实种了 `react` / `react/jsx-runtime` / `react-dom` / `react-dom/client`
 *   （实测读自 `dsh-web-frontend/dist/assets/index-*.js` 的 `staticModules`）。
 *   但它把「插件注册成功」与「React 已就绪」绑成硬依赖，与本仓
 *   「服务没到齐也先降级加载」的既有纪律冲突；而 t1 已把那条纪律钉成了验收。
 * - 独立 chunk 文件是真的坏：宿主只按 `/plugins/<包名>/client.js` 一张路由表发
 *   bundle（`dsh-client-modules/lib/index.js` 的 `comboUrl()`），没有任何机制
 *   去取同目录的 `<hash>.cjs` ⇒ 运行期 404。
 *   `outputOptions.codeSplitting: false` 能强行并成单文件，但实测它会把
 *   `require("react")` **提升回顶层**，于是退回第一种失败。
 *
 * ⇒ 结论：要既用 React 又保持「注册期零 require」，唯一可行结构是
 * **把 `require` 推迟到函数体内、首次真正需要时再取**。
 * JSX 语法侧的做法见 `./jsx-runtime.ts`。
 *
 * @module @sophia/core/client/react-runtime
 */

import type { ReactElement, ReactNode } from 'react'

/**
 * 宿主 `require` —— 在 bundle 里就是 CJS 闭包工厂的**形参**。
 *
 * `declare` 只给 tsc 一个类型、不产生运行时代码；它出现在**函数体内**时，
 * 打包器不会把它提升到顶层（这正是本文件的核心手法）。
 */
declare const require: (id: string) => unknown

/**
 * 本文件用到的 React 面（**结构化声明**，不 `import` React 的值）。
 *
 * 为什么不直接 `import * as React from 'react'`：那正是上表第一种写法，会在顶层
 * 留下 `require("react")`。**类型**可以 `import type`（会被完全擦除），
 * **值**必须走惰性路径。
 */
export interface ReactFace {
  createElement(type: unknown, props: unknown, ...children: readonly ReactNode[]): ReactElement
  /**
   * React 的 Fragment 哨兵。
   *
   * ⚠ **不能**用 `./jsx-runtime.ts` 导出的那个 `Fragment` 去写**带 `key` 的**
   * `<Fragment key={…}>`（实测踩到）：那个导出声明的类型是 `symbol`
   * （`export const Fragment: symbol = Symbol.for('react.fragment')`），
   * 而 JSX 要求元素类型有构造/调用签名 ⇒ 当场
   * `TS2604: JSX element type 'Fragment' does not have any construct or call signatures`
   * 与 `TS2786`。
   *
   * `jsx-runtime.ts` 那个导出是给**编译器**的 `<>…</>` 用的（它走 `jsx()` 工厂，
   * 不经过「元素类型」，所以不存在这个问题）；**手写 `<Fragment>` 就必须拿到
   * React 自己的那个值**。这正是本字段存在的理由。
   *
   * ⚠ 类型**不能**写 `unknown`（第一版就是，实测报
   * `TS2604: JSX element type 'React.Fragment' does not have any construct or
   * call signatures`）：JSX 要求元素类型可调用。React 的 Fragment 是
   * 「接受 `{ children?, key? }` 的组件」，故按这个形状声明 ——
   * 它**不需要** `ReactElement` 返回值（真实 React 的 `Fragment` 类型是
   * `ExoticComponent<{ children?: ReactNode }>`，返回值对 JSX 不参与检查）。
   */
  Fragment: (props: { readonly children?: ReactNode; readonly key?: unknown }) => ReactNode
  /**
   * ⚠ **两个重载**，与 `@types/react` 对齐。
   *
   * 移植来的上游 UI（`vendor/StagingPlanEditor.tsx`）里有 `useState<PlanFeedback>()`
   * 这种**无参**写法（真实 React 允许，语义是初值 `undefined`）。只有带参重载时
   * 它报 `TS2554: Expected 1 arguments, but got 0` —— 那是**本接口声明不全**，
   * 不是调用方写错，所以补重载而不是改上游。
   */
  useState<S = undefined>(): [
    S | undefined,
    (next: S | undefined | ((previous: S | undefined) => S | undefined)) => void,
  ]
  useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  /**
   * 布局副作用。与 `useEffect` 同形，但在浏览器绘制**之前**同步执行。
   *
   * 移植来的上游 UI 依赖它的**同步**语义：`TeamComposer` 用它在提交后把
   * 光标/选区复位、`TeamMessage` 用它在 DOM 建好后量高度决定是否折叠。
   * 换成 `useEffect` 会让那两处各自差一帧（量到旧高度 / 光标跳一下），
   * 故这里**照着声明**而不是替换调用点。
   */
  useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  /**
   * ⚠ 这个签名**修过一个真实类型缺陷**（移植 `vendor/team/timeline-scroll.ts` 时暴露）。
   *
   * 初版写的是 `useRef<T>(initial: T): { readonly current: T }`，两个问题：
   *
   * 1. **`current` 被声明成 `readonly`** —— 但 React 的 ref 对象是可写的
   *    （赋 `ref.current = node` 正是它存在的意义）。上游代码里大量出现
   *    `ref.current = …`，于是那种**本来正确**的代码会在本包报
   *    `TS2540: Cannot assign to 'current' because it is a read-only property`。
   * 2. **`initial: T` 不接受 `null`** —— `useRef<HTMLElement>(null)`（React 的
   *    标准写法）会报 `TS2345: Argument of type 'null' is not assignable to
   *    parameter of type 'HTMLElement'`。
   *
   * 两处都**不是调用方写错**，是本接口声明与 React 的真实行为不符
   * ⇒ 按 React 契约修正（与本文件头「补接口而不是放宽检查」同一条纪律）。
   *
   * ⚠ 修法是**两个重载**（与 `@types/react` 同形），不是一个放宽的签名：
   *
   * - 初值**不是** `null` ⇒ `current` 的类型就是 `T`（**不含 `null`**）。
   *   这是必需的：上游有 `const heightRef = useRef(0)` 这种用法，
   *   若统一返回 `T | null`，那么 `useRef(false)` 会得到 `boolean | null`，
   *   于是 `pinnedRef.current = <boolean>` 与 `if (pinnedRef.current)` 全部报
   *   `TS18047: possibly 'null'` —— **把一个正确的写法判成错的**（实测踩到）。
   * - 初值为 `null` ⇒ `current` 是 `T | null`（React 不会替我们补一个实例）。
   */
  useRef<T>(initial: T): { current: T }
  useRef<T>(initial: T | null): { current: T | null }
  useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T
  /**
   * 下面两个是为**移植来的上游 UI**（`vendor/StagingPlanEditor.tsx`）补的 ——
   * 它用到 `useId` 与 `useSyncExternalStore`。
   *
   * 补的是**接口**而不是放宽检查：`react()` 的返回值仍是结构化声明，
   * 属性名拼错照样报 `TS2339`。之所以要在这里加，是因为 `ReactFace` 就是
   * 「本包用到的 React 面」这一声明的**唯一真相**（见本文件头）。
   */
  useId(): string
  useSyncExternalStore<T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
    /**
     * SSR 快照。React 在**服务端渲染**时要求它，缺了会抛
     * `Missing getServerSnapshot`；本包的用例确实走服务端渲染
     * （`react-dom/server` 的 `renderToStaticMarkup`，见 `components.tsx` 文件头），
     * 所以这个参数必须留在签名里 —— OCR 复核指出初版漏了它。
     */
    getServerSnapshot?: () => T,
  ): T
}

let cached: ReactFace | undefined

/**
 * 取 React 运行时（首次调用时才 `require`，之后缓存）。
 *
 * ⚠ 调用时机：本函数要求发生在组件**渲染期**。`apply()` 里不要调它 ——
 * 那会把 require 提前到挂载期，虽然仍在工厂注册之后，但会让「界面代码」
 * 与「插件挂载」耦合，失去本文件的意义。
 */
export function react(): ReactFace {
  if (cached === undefined) cached = require('react') as ReactFace
  return cached
}

/** JSX 工厂。等价于 `React.createElement`。 */
export function h(type: unknown, props: unknown, ...children: readonly ReactNode[]): ReactElement {
  return react().createElement(type, props, ...children)
}

/**
 * `React.memo` 的**惰性**等价物 —— 给移植来的上游 UI 用。
 *
 * ## 为什么需要它（`memo` 不是 hook，取用时机不一样）
 *
 * 上游 `TeamMessage.tsx` 顶层写的是
 * `export const TeamMessage = memo(function TeamMessage(…) { … })`
 * —— `memo` 在**模块求值期**就被调用，而不是在组件渲染期。
 * 因此它不能像 hook 那样放进 `hooks()`：`hooks()` 要求发生在渲染期
 * （见本文件 `react()` 的调用时机说明），而模块求值期可能早于任何渲染。
 *
 * ## 为什么返回的是一个**包装函数**而不是 `memo` 本身
 *
 * 若导出 `export const memo = (…) => react().memo(…)`，上游的调用点写法
 * （`memo(Component)` 在顶层求值）会**立刻**触发 `react()` ⇒ 顶层 require，
 * 正是要避免的那件事。
 * ⇒ 这里返回一个**惰性的 memo 包装器**：它自己不碰 React；
 * 只有在 React **渲染到它**的时候（即 `jsx()` 把它当组件类型用），
 * 才去 `react().memo(...)` 一次并缓存。
 *
 * 语义等价性（可核）：React 传给组件类型的只有「调用它渲染」这一种用法 ——
 * `memo` 的作用是**渲染结果的引用比较**，推迟到首次渲染才建立这个比较
 * 不改变任何一次渲染的输出；代价是「父组件在首次渲染前就重渲染」时
 * 少省一次（而首次渲染本来就必然发生）。
 */
export function memoize<P extends object>(component: (props: P) => ReactElement | null): (props: P) => ReactElement | null {
  let wrapped: ((props: P) => ReactElement | null) | undefined
  return (props: P): ReactElement | null => {
    if (wrapped === undefined) {
      const face = react() as unknown as { memo?: (c: (props: P) => ReactElement | null) => (props: P) => ReactElement | null }
      // `memo` 在 React 18/19 都在；缺失时**退回不 memo**（正确但不省渲染），
      // 而不是抛错 —— 一个纯粹的渲染优化不该让整页打不开。
      wrapped = typeof face.memo === 'function' ? face.memo(component) : component
    }
    return wrapped(props)
  }
}
/** 常用 hook 的惰性转发；组件里 `const { useState } = hooks()`。 */
export interface ReactHooks {
  readonly useState: ReactFace['useState']
  readonly useEffect: ReactFace['useEffect']
  readonly useMemo: ReactFace['useMemo']
  readonly useRef: ReactFace['useRef']
  readonly useCallback: ReactFace['useCallback']
  /**
   * 下面两个是为**移植进来的上游 UI** 补的（`vendor/team/`，收件箱 + Thread 两页）。
   *
   * 与 `useId` / `useSyncExternalStore` 当初被加进 `ReactFace` 的理由同源（见上）：
   * 上游的 `TeamComposer.tsx` 用 `useLayoutEffect` + `useSyncExternalStore`
   * （订阅草稿缓存）、`TeamMessage.tsx` 用 `useLayoutEffect`（量高度决定是否折叠）、
   * `task-refs.ts` 用 `useSyncExternalStore`（订阅 ref 解析版本）。
   *
   * ⚠ 补的是**接口**而不是放宽检查：本接口就是「本包用到的 React 面」这一声明的
   * 唯一真相（见文件头）。加在这里而不是让调用点各自去 `react() as …` 强转 ——
   * 后者会绕开结构化声明的保护（属性名拼错也不报错）。
   *
   * `useSyncExternalStore` 的三参签名与 `ReactFace` 上那份**同源**（含
   * `getServerSnapshot`，索菲亚的用例走 `renderToStaticMarkup`，缺了会抛
   * `Missing getServerSnapshot`）。
   */
  readonly useLayoutEffect: ReactFace['useLayoutEffect']
  readonly useSyncExternalStore: ReactFace['useSyncExternalStore']
}

/**
 * 取 hook 集合。
 *
 * 每次调用都重新从 `react()` 上取，**不缓存 hook 函数本身**：
 * React 的分发器按渲染阶段切换实现，缓存住会绕过它的校验。
 */
export function hooks(): ReactHooks {
  const face = react()
  return {
    useState: face.useState.bind(face) as ReactFace['useState'],
    useEffect: face.useEffect.bind(face) as ReactFace['useEffect'],
    useMemo: face.useMemo.bind(face) as ReactFace['useMemo'],
    useRef: face.useRef.bind(face) as ReactFace['useRef'],
    useCallback: face.useCallback.bind(face) as ReactFace['useCallback'],
    // 与上面五个同一手法：每次调用重新从 face 上取（理由见 `hooks()` 上方的说明）。
    useLayoutEffect: face.useLayoutEffect.bind(face) as ReactFace['useLayoutEffect'],
    useSyncExternalStore: face.useSyncExternalStore.bind(face) as ReactFace['useSyncExternalStore'],
  }
}
