import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Native whole-row drag for the Team sidebar lists. Unlike the Harness
 * workspace list there is no document-level acceptance here: hovering another
 * row shows the before/after insertion marker and releasing on a row commits
 * exactly once per gesture, while a release outside any row — including over
 * the other sidebar list, whose panel never responds — just cancels without
 * committing.
 */
import { useRef, useState } from 'react';
import css from './sidebar.module.css';
/**
 * One drag gesture per panel instance. `onCommit` receives the moved ref,
 * the drop target and the insertion side exactly once per completed gesture;
 * releases outside the list never reach it.
 */
export function useSidebarRowDrag({ refs, onCommit }) {
    const [state, setState] = useState(null);
    const committed = useRef(false);
    const half = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return event.clientY - rect.top < rect.height / 2 ? 'before' : 'after';
    };
    return {
        rowProps: orderKey => ({
            draggable: true,
            className: state === null ? undefined
                : state.active === orderKey ? css.sidebarRowDragging
                    : state.over === orderKey ? (state.marker === 'before' ? css.sidebarRowDropBefore : css.sidebarRowDropAfter)
                        : undefined,
            onDragStart: event => {
                if (event.dataTransfer === null)
                    return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', orderKey);
                committed.current = false;
                setState({ active: orderKey, over: orderKey, marker: 'after' });
            },
            onDragEnd: () => { setState(null); },
            onDragOver: event => {
                if (state === null || !refs.includes(orderKey))
                    return;
                event.preventDefault();
                if (event.dataTransfer !== null)
                    event.dataTransfer.dropEffect = 'move';
                const marker = half(event);
                if (state.over !== orderKey || state.marker !== marker)
                    setState({ ...state, over: orderKey, marker });
            },
            onDrop: event => {
                if (state === null || !refs.includes(orderKey))
                    return;
                event.preventDefault();
                if (committed.current)
                    return;
                committed.current = true;
                onCommit(state.active, orderKey, half(event));
            },
        }),
    };
}
/**
 * Transparent wrapper that owns the drop-marker styling for one draggable
 * sidebar row. It adds no layout of its own; the styled row stays inside so
 * hover/focus descendant selectors keep working.
 */
export function SortableRow({ drag, orderKey, children }) {
    const props = drag.rowProps(orderKey);
    return (_jsx("div", { ...props, children: children }));
}
