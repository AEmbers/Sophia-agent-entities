// ⚠ 索菲亚移植点（**只改 import 与取值时机**）：上游的两条顶层值导入
// （`useState` from 'react'、`{ IconEllipsisOutline16, Menu, type MenuEntry }`
// from '@deepseek-ai/dsh-client-ui-primitives'）在索菲亚分别走
// `react-runtime.ts` 的 `hooks()` 与 `../bridge.ts` 的 `primitives` 惰性代理
// —— 两者都**必须在组件体内取值**，否则等价于顶层模块加载调用（撞红「产物里顶层模块加载调用 ≤ 2」）。
// ⚠ 本条注释**刻意不写出那个加载函数的字面量**（函数名 + 左括号）：`tests/client-sources.spec.ts`
//   数的是**产物里的字符串**，块注释会被原样保留 ⇒ 写在注释里同样计数。这不是洁癖：
//   实测踩过 —— 三个文件的注释把产物里的计数从 2 顶到 5，而症状只在**
//   有人把左栏真正挂进 `panel.tsx` 之后**才出现（此前这些模块被 tree-shake，看不见）。
import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import css from './sidebar.module.css'

/**
 * Row-level overflow menu shared by sidebar Channel and Agent rows, mirroring
 * the harness session-row pattern: a portal list anchored to a bare ellipsis
 * icon button, with the owning row pinned to its hover fill while open.
 */
export function TeamRowMenu({ label, items, onSelect, onOpenChange }: {
  /** Localized action label for the trigger, e.g. "{name} 的操作". */
  readonly label: string
  /** Menu rows plus optional non-interactive labels and separators. */
  readonly items: readonly import('@deepseek-ai/dsh-client-ui-primitives').MenuEntry[]
  readonly onSelect: (id: string) => void
  /** Lets the row pin its hover styling while the portal list is up. */
  readonly onOpenChange?: (open: boolean) => void
}) {
  const { useState } = hooks()
  const { IconEllipsisOutline16, Menu } = primitives
  const [open, setOpen] = useState(false)
  const toggle = (): void => {
    setOpen(current => {
      onOpenChange?.(!current)
      return !current
    })
  }
  const close = (): void => {
    setOpen(false)
    onOpenChange?.(false)
  }
  return (
    <Menu
      open={open}
      onClose={close}
      items={items}
      onSelect={(id) => { close(); onSelect(id) }}
      portal
      closeOnPointerLeave
      anchor={(
        <button
          type="button"
          className={css.rowMenuButton}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(event) => { event.stopPropagation(); toggle() }}
        >
          <IconEllipsisOutline16 />
        </button>
      )}
    />
  )
}
