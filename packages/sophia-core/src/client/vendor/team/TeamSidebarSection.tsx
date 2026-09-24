import type { ReactNode } from 'react'
// ⚠ 索菲亚移植点（**只改 import 与取值时机**）：上游写的是
// `import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'`
// —— 顶层**值导入**，会多出一条顶层模块加载调用，撞红「产物里顶层模块加载调用 ≤ 2」的既有断言。
// 索菲亚的现成手法是 `../bridge.ts` 的 `primitives` **惰性代理**；解构写在**组件体内**
// （模块求值期解构等于把 require 提前回顶层，正是要避免的那件事）。
import { primitives } from '../bridge.ts'
import css from './sidebar.module.css'

/** Collapsible sidebar section header: disclosure toggle plus trailing actions. */
export function TeamSidebarSection({ title, actions, open, onToggle, children }: {
  readonly title: string
  /** Trailing header controls (the add button); never part of the toggle. */
  readonly actions?: ReactNode
  /** Controlled disclosure state; the caller owns persistence. */
  readonly open: boolean
  readonly onToggle: (open: boolean) => void
  readonly children: ReactNode
}) {
  const { IconChevronDownOutline14 } = primitives
  return (
    <section className={css.section}>
      <div className={css.sectionHeader}>
        <button type="button" className={css.sectionToggle} aria-expanded={open} onClick={() => { onToggle(!open) }}>
          <IconChevronDownOutline14 className={css.sectionChevron} />
          <span className={css.sectionTitle}>{title}</span>
        </button>
        {actions !== undefined && <span className={css.sectionActions}>{actions}</span>}
      </div>
      {open && children}
    </section>
  )
}
