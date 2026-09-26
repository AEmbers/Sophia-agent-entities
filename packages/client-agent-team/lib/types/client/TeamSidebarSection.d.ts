import type { ReactNode } from 'react';
/** Collapsible sidebar section header: disclosure toggle plus trailing actions. */
export declare function TeamSidebarSection({ title, actions, open, onToggle, children }: {
    readonly title: string;
    /** Trailing header controls (the add button); never part of the toggle. */
    readonly actions?: ReactNode;
    /** Controlled disclosure state; the caller owns persistence. */
    readonly open: boolean;
    readonly onToggle: (open: boolean) => void;
    readonly children: ReactNode;
}): import("react").JSX.Element;
//# sourceMappingURL=TeamSidebarSection.d.ts.map