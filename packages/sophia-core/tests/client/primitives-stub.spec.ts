/**
 * 宿主平台模块**测试替身**的可解析性用例。
 *
 * ## 这条用例在防什么
 *
 * `@deepseek-ai/dsh-client-ui-primitives` 是运行期由宿主提供的平台模块，**不在本包的
 * `node_modules` 里**。`vitest.config.ts` 的 alias 把它指向 `tests/stubs/ui-primitives.ts`。
 *
 * 如果那条 alias 被删掉 / 写错 / 被后来者"清理"，症状**不是**测试报错，而是：
 * 面板**折叠态**照旧全绿（首帧不碰 primitives），而**展开态**在测试里结构上不可达 ——
 * 于是核心路径悄悄失去回归网，谁也不会发现。
 *
 * ⇒ 所以这里**直接解析那个模块并调它**，把「替身可用」这件事本身变成一条断言。
 *
 * **反恒真**：删掉 `vitest.config.ts` 里那行 alias → 本条必须变红（`Failed to resolve import`）。
 * 已实测。
 */
import { describe, expect, it } from 'vitest'

describe('宿主平台模块的测试替身', () => {
  it('能被解析，且成员形状够用（组件的能渲染、函数的能调用）', async () => {
    const mod = (await import('@deepseek-ai/dsh-client-ui-primitives')) as unknown as Record<string, unknown>

    // 组件：必须是**可调用**的（JSX 会调它），且**无 children 时**渲染成空。
    for (const name of ['Menu', 'Button', 'Modal', 'Pill', 'Tooltip', 'MarkdownText', 'IconStopFill16']) {
      const component = mod[name]
      expect(typeof component, `${name} 应该是可调用的组件替身`).toBe('function')
      expect((component as () => unknown)()).toBe(null)
    }

    // ⚠ 但**有 children 时必须原样渲染出去** —— 这是 2026-09-24 实测踩出来的硬约束。
    // 上游把这些宿主组件当**容器**用，例如 `<Tooltip><button data-team-action="enter" /></Tooltip>`
    // （`vendor/team/TeamFooterAction.tsx:32-43`，那是上游**模式切换控件**的宿主）。
    // 替身若返回 null，会把整棵子树吞掉 ⇒ 「子树里到底有没有那个按钮」在测试里
    // **结构性不可观测**，而症状是**产品代码看起来有 bug**：实测渲染成空的
    // `<div class="_footerStack_…">`，第一反应是去 `TeamFooterAction` 里找那枚"丢掉"的按钮。
    // 反恒真：把 `tests/stubs/ui-primitives.ts` 的 `passChildren` 改回 `() => null`
    // ⇒ 本条变红，且 `tests/client/team-mode.spec.tsx` 的 2 条也一起变红。已实测。
    for (const name of ['Tooltip', 'Modal', 'Pill', 'DisclosureRow', 'Menu', 'Button']) {
      const component = mod[name] as (p: unknown) => unknown
      expect(component({ children: 'CHILD' }), `${name} 必须把 children 渲染出去（不能吞子树）`).toBe('CHILD')
    }

    // hook：同样是**可调用**的（上游是按 hook 用的），调用不得抛。
    expect(typeof mod.useDismissOnOutsidePointer).toBe('function')
    expect(() => (mod.useDismissOnOutsidePointer as () => void)()).not.toThrow()
    expect((mod.useAnchoredMaxHeight as () => unknown)()).toBe(null)
  })

  it('默认导出与具名导出一致（取用方式两边都覆盖）', async () => {
    // 理由：`vendor/bridge.ts` 用 `require('…')[key]` 取**具名**成员；但有的转译路径
    // 会把 CJS 的 `module.exports` 归到 `default` 上。两边都给，则替身不会在小改动下
    // 忽然失效 —— 失效一次就是"展开态不可测"重演一次。
    const mod = (await import('@deepseek-ai/dsh-client-ui-primitives')) as unknown as Record<string, unknown>
    const fallback = mod.default as Record<string, unknown> | undefined
    expect(fallback).toBeDefined()
    expect(fallback?.Button).toBe(mod.Button)
    expect(fallback?.useDismissOnOutsidePointer).toBe(mod.useDismissOnOutsidePointer)
  })
})
