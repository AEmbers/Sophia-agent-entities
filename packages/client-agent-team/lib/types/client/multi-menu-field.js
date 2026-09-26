import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
// MultiMenuField: one labeled multi-select picker shared by every creation
// form (Agent initial Channels, Channel initial Members). Selection toggles
// without closing the list so several entries can be picked in one pass; the
// capped card scrolls internally through long catalogs.
import { useState } from 'react';
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import createCss from './create.module.css';
import css from './sidebar.module.css';
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
export function MultiMenuField({ label, options, selected, onToggle, disabled = false, emptyText, triggerEmptyLabel, formatCount }) {
    const [open, setOpen] = useState(false);
    const items = options.map(option => ({
        id: option.id,
        label: option.hint === undefined ? option.label : _jsxs(_Fragment, { children: [option.label, _jsx("small", { className: css.menuHint, children: ` ${option.hint}` })] }),
        ...(option.disabled === true ? { disabled: true } : {}),
        ...(option.icon === undefined ? {} : { icon: option.icon }),
    }));
    return (_jsxs("div", { className: createCss.field, children: [_jsx("span", { children: label }), options.length === 0 && emptyText !== undefined ? _jsx("small", { className: css.editHint, children: emptyText }) : (_jsx(Menu, { open: open, portal: true, className: createCss.menuCap, items: items, selectedIds: selected, onSelect: id => { onToggle(id); }, onClose: () => { setOpen(false); }, anchor: _jsxs("button", { type: "button", className: createCss.selectTrigger, "aria-label": label, "aria-haspopup": "menu", "aria-expanded": open, disabled: disabled, onClick: () => { setOpen(value => !value); }, children: [_jsx("span", { className: createCss.selectValue, children: selected.length === 0 ? triggerEmptyLabel : formatCount(selected.length) }), _jsx("span", { className: `${createCss.chevron} ${open ? createCss.chevronOpen : ''}`, "aria-hidden": true, children: _jsx(IconChevronDownOutlineRegular, {}) })] }) }))] }));
}
