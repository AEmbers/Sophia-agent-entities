import { type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives';
/**
 * Row-level overflow menu shared by sidebar Channel and Agent rows, mirroring
 * the harness session-row pattern: a portal list anchored to a bare ellipsis
 * icon button, with the owning row pinned to its hover fill while open.
 */
export declare function TeamRowMenu({ label, items, onSelect, onOpenChange }: {
    /** Localized action label for the trigger, e.g. "{name} 的操作". */
    readonly label: string;
    /** Menu rows plus optional non-interactive labels and separators. */
    readonly items: readonly MenuEntry[];
    readonly onSelect: (id: string) => void;
    /** Lets the row pin its hover styling while the portal list is up. */
    readonly onOpenChange?: (open: boolean) => void;
}): import("react").JSX.Element;
//# sourceMappingURL=TeamRowMenu.d.ts.map