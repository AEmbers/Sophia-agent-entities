// MultiMenuField: one labeled multi-select picker shared by every creation
// form (Agent initial Channels, Channel initial Members). Selection toggles
// without closing the list so several entries can be picked in one pass; the
// capped card scrolls internally through long catalogs.
//
// ⚠ 索菲亚移植点（**只改 import 与取值时机**）：`useState` 走 `hooks()`、
// UI 原子走 `../bridge.ts` 的 `primitives` 惰性代理（理由见 `TeamRowMenu.tsx`）。
// `create.module.css` 是上游同目录的既有文件，本次一并整份复制（它定义
// `field` / `selectTrigger` / `selectValue` / `chevron` / `menuCap` 等类名，
// 是这些创建表单的**外观本体**）。

import { hooks } from '../../react-runtime.ts'
import { primitives } from '../bridge.ts'
import type { ReactNode } from 'react'
import createCss from './create.module.css'
import css from './sidebar.module.css'

/** One selectable entry; disabled rows render greyed with their reason. */
export interface MultiMenuOption {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  /** Leading marker such as a presence dot. */
  readonly icon?: ReactNode
  /** Secondary reason text rendered after the label. */
  readonly hint?: string
}

/**
 * Render the labeled multi-select Menu field.
 * @param props.label - field caption; doubles as the trigger's accessible name.
 * @param props.options - selectable entries in display order.
 * @param props.selected - currently checked ids.
 * @param props.onToggle - invoked with an id when its row is clicked.
 * @param props.disabled - disables the trigger while a mutation is in flight.
 * @param props.emptyText - shown instead of the picker when there is nothing to pick.
 * @param props.triggerEmptyLabel - trigger caption when nothing is selected.
 * @param props.formatCount - builds the trigger caption for N selections.
 */
export function MultiMenuField<I extends string>({ label, options, selected, onToggle, disabled = false, emptyText, triggerEmptyLabel, formatCount }: {
  readonly label: string
  readonly options: readonly MultiMenuOption[]
  readonly selected: readonly I[]
  readonly onToggle: (id: I) => void
  readonly disabled?: boolean
  readonly emptyText?: string
  readonly triggerEmptyLabel: string
  readonly formatCount: (count: number) => string
}) {
  const { useState } = hooks()
  const { IconChevronDownOutline14, Menu } = primitives
  const [open, setOpen] = useState(false)
  const items: import('@deepseek-ai/dsh-client-ui-primitives').MenuEntry[] = options.map(option => ({
    id: option.id,
    label: option.hint === undefined ? option.label : <>{option.label}<small className={css.menuHint}>{` ${option.hint}`}</small></>,
    ...(option.disabled === true ? { disabled: true } : {}),
    ...(option.icon === undefined ? {} : { icon: option.icon }),
  }))
  return (
    <div className={createCss.field}>
      <span>{label}</span>
      {options.length === 0 && emptyText !== undefined ? <small className={css.editHint}>{emptyText}</small> : (
        <Menu
          open={open}
          portal
          className={createCss.menuCap!}
          items={items}
          selectedIds={selected}
          onSelect={id => { onToggle(id as I) }}
          onClose={() => { setOpen(false) }}
          anchor={
            <button
              type="button"
              className={createCss.selectTrigger!}
              aria-label={label}
              aria-haspopup="menu"
              aria-expanded={open}
              disabled={disabled}
              onClick={() => { setOpen(value => !value) }}
            >
              <span className={createCss.selectValue}>{selected.length === 0 ? triggerEmptyLabel : formatCount(selected.length)}</span>
              <span className={`${createCss.chevron!} ${open ? createCss.chevronOpen! : ''}`} aria-hidden><IconChevronDownOutline14 /></span>
            </button>
          }
        />
      )}
    </div>
  )
}
