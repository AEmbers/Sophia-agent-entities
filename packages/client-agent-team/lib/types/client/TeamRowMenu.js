import { jsx as _jsx } from "react/jsx-runtime";
import { useState } from 'react';
import { IconEllipsisOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './sidebar.module.css';
/**
 * Row-level overflow menu shared by sidebar Channel and Agent rows, mirroring
 * the harness session-row pattern: a portal list anchored to a bare ellipsis
 * icon button, with the owning row pinned to its hover fill while open.
 */
export function TeamRowMenu({ label, items, onSelect, onOpenChange }) {
    const [open, setOpen] = useState(false);
    const toggle = () => {
        setOpen(current => {
            onOpenChange?.(!current);
            return !current;
        });
    };
    const close = () => {
        setOpen(false);
        onOpenChange?.(false);
    };
    return (_jsx(Menu, { open: open, onClose: close, items: items, onSelect: (id) => { close(); onSelect(id); }, portal: true, closeOnPointerLeave: true, anchor: (_jsx("button", { type: "button", className: css.rowMenuButton, "aria-label": label, "aria-haspopup": "menu", "aria-expanded": open, onClick: (event) => { event.stopPropagation(); toggle(); }, children: _jsx(IconEllipsisOutlineRegular, {}) })) }));
}
