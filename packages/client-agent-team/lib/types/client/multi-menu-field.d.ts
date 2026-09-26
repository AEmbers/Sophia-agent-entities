import type { ReactNode } from 'react';
/** One selectable entry; disabled rows render greyed with their reason. */
export interface MultiMenuOption {
    readonly id: string;
    readonly label: string;
    readonly disabled?: boolean;
    /** Leading marker such as a presence dot. */
    readonly icon?: ReactNode;
    /** Secondary reason text rendered after the label. */
    readonly hint?: string;
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
export declare function MultiMenuField<I extends string>({ label, options, selected, onToggle, disabled, emptyText, triggerEmptyLabel, formatCount }: {
    readonly label: string;
    readonly options: readonly MultiMenuOption[];
    readonly selected: readonly I[];
    readonly onToggle: (id: I) => void;
    readonly disabled?: boolean;
    readonly emptyText?: string;
    readonly triggerEmptyLabel: string;
    readonly formatCount: (count: number) => string;
}): import("react").JSX.Element;
//# sourceMappingURL=multi-menu-field.d.ts.map