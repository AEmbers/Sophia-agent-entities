import type { ReactNode } from 'react';
import type { SidebarDropMarker } from './sidebar-order.ts';
export interface SidebarRowDragHandlers<K extends string> {
    /** Per-row native wiring plus the marker this row currently shows. */
    readonly rowProps: (orderKey: K) => {
        readonly draggable: true;
        readonly className?: string | undefined;
        readonly onDragStart: (event: React.DragEvent<HTMLElement>) => void;
        readonly onDragEnd: () => void;
        readonly onDragOver: (event: React.DragEvent<HTMLElement>) => void;
        readonly onDrop: (event: React.DragEvent<HTMLElement>) => void;
    };
}
/**
 * One drag gesture per panel instance. `onCommit` receives the moved ref,
 * the drop target and the insertion side exactly once per completed gesture;
 * releases outside the list never reach it.
 */
export declare function useSidebarRowDrag<K extends string>({ refs, onCommit }: {
    /** Effective current order of the owning list, used for hit validation. */
    readonly refs: readonly K[];
    readonly onCommit: (movedRef: K, targetRef: K, marker: SidebarDropMarker) => void;
}): SidebarRowDragHandlers<K>;
/**
 * Transparent wrapper that owns the drop-marker styling for one draggable
 * sidebar row. It adds no layout of its own; the styled row stays inside so
 * hover/focus descendant selectors keep working.
 */
export declare function SortableRow<K extends string>({ drag, orderKey, children }: {
    readonly drag: SidebarRowDragHandlers<K>;
    readonly orderKey: K;
    readonly children: ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=sidebar-drag.d.ts.map