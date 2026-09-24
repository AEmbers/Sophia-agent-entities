/**
 * 全局测试替身：宿主平台模块 `@deepseek-ai/dsh-client-ui-primitives`。
 *
 * ## 为什么必须是 `vi.mock`，而不是 `vitest.config.ts` 的 `resolve.alias`
 *
 * 这条是**实测踩出来的**，写下来免得后人再踩：
 *
 * 最初我把 alias 指向 `tests/stubs/ui-primitives.ts`，并配了一条「能解析这个模块」的
 * 用例 —— 它**绿的**。但那是个**假绿**：那种写法只对 **ESM `import`** 生效，而真正在
 * 取用这个模块的是 `src/client/vendor/bridge.ts` 里那句
 * `require('@deepseek-ai/dsh-client-ui-primitives')[key]` —— **裸 `require` 不走
 * Vite 的 `resolve.alias`**。桩一直在，实际一次都没被用上。
 *
 * 之所以长期没暴露：那份从上游抄来的活动面板**首帧是折叠态**，折叠态不碰 primitives。
 * 一旦让它默认展开、或有别的组件真的渲染到宿主组件，就会**同时**报
 * `Cannot find module '@deepseek-ai/dsh-client-ui-primitives'` —— 遮羞布掉了。
 * `vi.mock` 替换的是**模块解析本身**，对所有取用形式生效（含裸 `require`）。
 *
 * ## ⚠ 本文件**不再自己定义替身**（这是第二课）
 *
 * 曾经这里是**第三份手写副本**（第一份 `tests/stubs/ui-primitives.ts` 给 alias、
 * 第二份 `scripts/seed-ui-primitives-stub.mjs` 种进 `node_modules` 给 `require`）。
 * 后果：我修了前两份的「组件吞 children」缺陷、忘了这一份，于是
 * `primitives-stub.spec.ts` 里那条新断言**立刻变红**，而 `team-mode.spec.tsx` 却全绿 ——
 * 同一份语义、三处实现、两处绿一处红。**那次红灯是这条复制粘贴式设计的账单。**
 *
 * 现在：**唯一真源 = `tests/stubs/ui-primitives.ts`**，这里只把它转发出来。
 * 另一份（`node_modules` 里那份）由 `scripts/seed-ui-primitives-stub.mjs` 生成，
 * 内容是同一套语义的 CJS 写法 —— 它受同一条断言约束（`primitives-stub.spec.ts` 会红）。
 *
 * ## 它掩盖了什么（必须写明）
 *
 * 替身不模拟真实宿主组件的行为：`Tooltip` 不定位、`Modal` 不做遮罩、`Button` 的
 * `variant` 不给类名、图标不画路径。用例只能验「这条路走到了、没抛、子树里的结构标记在」。
 * **不要**把「测试通过」读成「宿主模块的形状对了」——真实形状只能从宿主包反推
 * （见 `src/client/vendor/upstream-modules.d.ts`）。
 */
import { vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  // ⚠ 动态 import **同一个真源**，不复制实现。
  // 这条 import 的路径与模块名不同 ⇒ 不会被本次 mock 拦截，不会自递归。
  const stub = await import('../stubs/ui-primitives.ts')
  return { ...stub, default: (stub as Record<string, unknown>).default }
})
