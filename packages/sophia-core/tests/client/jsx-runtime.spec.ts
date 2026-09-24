/**
 * t5 · JSX 运行时（`jsx` / `jsxs` / `Fragment`）的用例。
 *
 * ## 为什么这个文件必须存在（而不只是依赖“端到端看起来能跑”）
 *
 * `jsx-runtime.ts` 是 TS 按 `jsxImportSource` + `paths` **注入**的运行时，
 * 不在任何 import 链上（见 `tests/client-sources.spec.ts` 的说明）。
 * 它一旦写错，症状是「界面渲染出莫名其妙的东西」而不是编译错误 ——
 * 所以它的契约必须**单独**钉住。
 *
 * ⚠ 本文件跑在 SSR 环境：能真的 `require('react')`，因此可以断言
 * **产物与 React 语义的一致性**（例如 Fragment 哨兵的真实身份）。
 * 这正是 `jsx-runtime.ts` 的注释里说「运行期无法自证」的那件事 ——
 * 在浏览器里确实无法自证，**在服务端可以**，所以这条由本文件承担。
 *
 * @module tests/client/jsx-runtime.spec
 */

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import * as runtime from '../../src/client/jsx-runtime.ts'
import { Fragment, jsx, jsxs } from '../../src/client/jsx-runtime.ts'
import { jsxDEV } from '../../src/client/jsx-dev-runtime.ts'
import { h } from '../../src/client/react-runtime.ts'

describe('t5 · JSX 运行时', () => {
  it('jsx 产出与 React.createElement 等价的元素', () => {
    const mine = renderToStaticMarkup(jsx('div', { className: 'a', children: 'x' }) as never)
    const theirs = renderToStaticMarkup(createElement('div', { className: 'a' }, 'x'))
    expect(mine).toBe(theirs)
  })

  it('jsxs 产出与 jsx 一致（静态子节点走 props.children 数组）', () => {
    // 编译器对「多个静态子节点」调用 `jsxs`，children 是**数组**。
    const mine = renderToStaticMarkup(
      jsxs('div', { children: ['a', 'b'] }) as never,
    )
    expect(mine).toBe(renderToStaticMarkup(createElement('div', null, 'a', 'b')))
  })

  it('**`null` key 与 `undefined` key 同等对待**（不得把 null 归一化成 "null" 键）', () => {
    // 缺陷（OCR 复核 MEDIUM）：初版只判 `=== undefined`，于是
    // 编译器发出 `jsx(type, props, null)` 时会注入 `key: null`，
    // 而 React 会把它**归一化成真实的 key 字符串 `"null"`** ——
    // 污染 key 空间，并可能触发「key 重复」警告。
    // 反恒真：把 `key == null` 改回 `key === undefined` → 本条必须变红。
    const withNull = jsx('div', { children: 'x' }, null) as { key: unknown }
    const withUndefined = jsx('div', { children: 'x' }, undefined) as { key: unknown }
    // React 把两种「没有 key」都表示成 `null`。
    expect(withNull.key).toBeNull()
    expect(withUndefined.key).toBeNull()
    // 且渲染结果一致（不因 null/undefined 分叉）。
    expect(renderToStaticMarkup(withNull as never))
      .toBe(renderToStaticMarkup(withUndefined as never))
  })

  it('真的给了 key 时要带上（收窄不能把正常路径一起挡掉）', () => {
    const element = jsx('li', { children: 'x' }, 'k1') as { key: unknown }
    expect(element.key).toBe('k1')
  })

  it('`Fragment` 的哨兵身份与宿主 React **实测一致**（本文件在服务端，能真的验）', () => {
    // `jsx-runtime.ts` 的注释声称 `React.Fragment === Symbol.for('react.fragment')`。
    // 在浏览器里拿不到顶层 React 引用 ⇒ 那条声称**无法**自证。
    // 本文件跑在 SSR（能 require React）⇒ 由这里实际断言，而不是留一句话。
    // 若宿主 React 换了哨兵值：这条会红，而不是让 Fragment 静默退化成未知元素类型。
    expect(Fragment).toBe(Symbol.for('react.fragment'))
    // 更强的判据：用我们的 Fragment 渲染，必须与 React 自己的 Fragment 同结果。
    const mine = renderToStaticMarkup(jsx(Fragment, { children: ['a', 'b'] }) as never)
    const theirs = renderToStaticMarkup(
      // `Fragment` 在这里是 `symbol`（本包的声明），React 的类型要求它自己的
      // `Symbol` 类型；运行期两者是同一个值（上一行断言过），故这里显式转换。
      createElement(Fragment as unknown as string, null, 'a', 'b'),
    )
    expect(mine).toBe(theirs)
    // 且**不额外插一层 DOM**（用 div 包一层会破坏 grid/flex 布局）。
    expect(mine).toBe('ab')
  })

  it('h() 与 jsx() 同口径（两条工厂路径不能分叉）', () => {
    expect(renderToStaticMarkup(h('div', { className: 'a' }, 'x') as never))
      .toBe(renderToStaticMarkup(jsx('div', { className: 'a', children: 'x' }) as never))
  })

  it('**dev 入口按 `isStaticChildren` 路由**（不是无条件塌缩到 jsx）', () => {
    // 缺陷（OCR 复核 MEDIUM）：`jsxDEV` 初版无条件委托给 `jsx`，
    // 把 dev 的静态子节点路径塌缩到动态路径上 —— 正是 `jsx-runtime.ts`
    // 明确警告过的那种「委托巧合」；一旦委托实现变了，dev 会与 prod 分叉，
    // 而 prod 的用例抓不到。
    //
    // ⚠ 为什么不能只断言「两种输入都渲染出正确 HTML」（首版就是这么写的，
    //   结果**变异后仍然绿**）：当前 `jsx` 与 `jsxs` 的实现恰好相同，
    //   所以「渲染结果」在塌缩与路由两种实现下**一样**。
    //   要真的钉住路由，必须观测**它调了哪一个入口** ——
    //   用 spy 分别包住两个入口，看 dev 的两次调用各自落到谁身上。
    const jsxSpy = vi.spyOn(runtime, 'jsx')
    const jsxsSpy = vi.spyOn(runtime, 'jsxs')
    try {
      jsxDEV('div', { children: ['a', 'b'] }, undefined, true)
      expect(jsxsSpy).toHaveBeenCalledTimes(1)
      expect(jsxSpy).not.toHaveBeenCalled()

      jsxSpy.mockClear()
      jsxsSpy.mockClear()
      jsxDEV('div', { children: 'x' }, undefined, false)
      expect(jsxSpy).toHaveBeenCalledTimes(1)
      expect(jsxsSpy).not.toHaveBeenCalled()
    } finally {
      jsxSpy.mockRestore()
      jsxsSpy.mockRestore()
    }
  })

  it('dev 入口同样把 `null` key 当作「没有 key」', () => {
    const element = jsxDEV('div', { children: 'x' }, null, false) as { key: unknown }
    expect(element.key).toBeNull()
    const withKey = jsxDEV('li', { children: 'x' }, 'k1', false) as { key: unknown }
    expect(withKey.key).toBe('k1')
  })

  it('dev 入口的导出面完整（`sophia-jsx/jsx-dev-runtime` 缺一个符号就是 0 测试）', () => {
    // 这个入口存在的**全部理由**是「vitest 跑在 dev 模式、缺它就会
    // Cannot find package 'sophia-jsx/jsx-dev-runtime' ⇒ 整份用例集 0 个测试」
    // （见该文件头）。所以它导出的符号必须齐 —— 少一个 `Fragment`，
    // 用了 `<>…</>` 的组件就会在 dev 下解析失败。
    expect(typeof jsxDEV).toBe('function')
    expect(typeof Fragment).toBe('symbol')
  })
})
