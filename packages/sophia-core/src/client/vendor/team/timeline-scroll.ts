// ⚠ 索菲亚移植点（**只改这一行**）：上游写的是
// `import { useCallback, useEffect, useRef } from 'react'` —— 那是一条**顶层值导入**，
// 会在插件注册期产生一条顶层模块加载调用，撞红索菲亚两条既有断言（实测见
// `../../react-runtime.ts` 的文件头对照表）：
// - `tests/shell.spec.ts`：「materialize 那一刻不得 require 任何东西」（会抛的 require）
// - `tests/client-sources.spec.ts:254`：产物里 `require(` 出现次数 ≤ 2
//   （当前恰好 2 次：惰性 react + 惰性 primitives 代理）
// 索菲亚的既有手法是**惰性取**：`hooks()` 每次调用重新从 `react()` 上取
// （`react-runtime.ts` 明确说了**不缓存 hook 本身**，因为 React 的分发器
// 按渲染阶段切换实现）。本文件是个 hook，本来就在渲染期调用 ⇒ 惰性取成立。
import { hooks } from '../../react-runtime.ts'

const BOTTOM_MARGIN_PX = 48

export interface TimelineScroll {
  readonly ref: React.RefObject<HTMLElement>
  onScroll: () => void
  /** Whether the reader currently sits within the follow margin of the bottom. */
  isPinned: () => boolean
  /** Scroll the timeline to the latest fact immediately. */
  scrollToBottom: () => void
}

/**
 * Chat-timeline scroll policy shared by the Channel and Thread pages: follow
 * new facts only while the reader stays pinned to the bottom, and keep
 * prepended history visually stable. The content key must change whenever
 * rendered facts change.
 */
export function useTimelineScroll(contentKey: string): TimelineScroll {
  const { useCallback, useEffect, useRef } = hooks()
  const ref = useRef<HTMLElement>(null)
  const pinnedRef = useRef(true)
  const heightRef = useRef(0)

  const onScroll = useCallback(() => {
    const element = ref.current
    if (element === null) return
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_MARGIN_PX
  }, [])

  const scrollToBottom = useCallback(() => {
    const element = ref.current
    pinnedRef.current = true
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [])

  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const previousHeight = heightRef.current
    heightRef.current = element.scrollHeight
    if (pinnedRef.current) {
      element.scrollTop = element.scrollHeight
      return
    }
    // Prepended older history must not shift the content the reader is on.
    if (previousHeight > 0 && element.scrollHeight > previousHeight) {
      element.scrollTop += element.scrollHeight - previousHeight
    }
  }, [contentKey])

  return { ref, onScroll, isPinned: () => pinnedRef.current, scrollToBottom }
}
