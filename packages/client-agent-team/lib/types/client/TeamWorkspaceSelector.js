import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { IconChevronDownOutlineRegular, IconFolderOpenRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './sidebar.module.css';
/**
 * The single-line Workspace selector that scopes the Team sidebar.
 *
 * The sections below it — Channels and Agents — belong to exactly one
 * Workspace, so a flat list of every Workspace above them states a global
 * scope over local content. Collapsing that list into one selector makes the
 * sidebar read as "you are in X, and here is X's content", and returns the
 * rows a low-frequency switch was holding. Nothing is hidden by the collapse:
 * Workspace rows carry no unread mark of their own, and cross-Workspace unread
 * is summarized by the Inbox entry above — the one destination that outlives
 * this scope, which is why it stays outside the selector's reach.
 *
 * The trigger is a field rather than a row: the line that states where the
 * reader is must not read as the first entry of the Channels list below it,
 * and its accessible name states the Workspace it is showing, because that
 * value is otherwise unavailable to a reader who cannot see the field. The
 * menu is the only way to switch Workspaces, so it takes focus on open and
 * hands it back to the trigger on Escape.
 */
export function TeamWorkspaceSelector({ workspaces, selectedId, current, onSelect, t }) {
    const [open, setOpen] = useState(false);
    // A portaled Menu list is laid out `visibility: hidden` and placed by the
    // primitive's own layout effect, so its `autoFocus` effect runs one render
    // too early: `focus()` on a hidden row is a no-op. The menu would then open
    // with focus still on the trigger, and the primitive's arrow keys — which
    // index from `document.activeElement` — stay dead, leaving a keyboard reader
    // no way to reach another Workspace. Focusing the opened row once the list is
    // on screen restores what `autoFocus` is for; it does nothing when focus is
    // already inside the list.
    useEffect(() => {
        if (!open)
            return;
        const frame = requestAnimationFrame(() => {
            // Portaled lists are children of the portal target, and the list this
            // open mounted is the last of them.
            const lists = document.querySelectorAll('body > [role="menu"]');
            const list = lists[lists.length - 1];
            if (list === undefined || list.contains(document.activeElement))
                return;
            list.querySelector('button:not(:disabled)')?.focus();
        });
        return () => { cancelAnimationFrame(frame); };
    }, [open]);
    const selected = workspaces.find(workspace => workspace.workspaceId === selectedId);
    // Nothing to state — no Workspace, or a selection the list no longer carries —
    // so the browser says that in the selector's own seat instead of a dead field.
    if (selected === undefined)
        return _jsx("p", { className: css.emptyState, children: t('empty') });
    const items = workspaces.map(workspace => ({
        id: workspace.workspaceId,
        label: workspace.title,
    }));
    return (_jsx(Menu, { open: open, portal: true, autoFocus: true, items: items, selectedIds: [selected.workspaceId], onSelect: id => { setOpen(false); onSelect(id); }, onClose: () => { setOpen(false); }, anchor: (_jsxs("button", { type: "button", className: css.workspaceTrigger, "data-team-workspace-trigger": true, "aria-label": t('workspaceSelectorWithValue', { title: selected.title }), "aria-haspopup": "menu", "aria-expanded": open, "aria-current": current ? 'page' : undefined, title: `${selected.title} · ${selected.path}`, onClick: () => { setOpen(value => !value); }, children: [_jsx("span", { className: css.workspaceIcon, "aria-hidden": "true", children: _jsx(IconFolderOpenRegular, { size: 16 }) }), _jsx("span", { className: css.workspaceValue, children: selected.title }), _jsx("span", { className: `${css.workspaceChevron} ${open ? css.workspaceChevronOpen : ''}`, "aria-hidden": "true", children: _jsx(IconChevronDownOutlineRegular, {}) })] })) }));
}
