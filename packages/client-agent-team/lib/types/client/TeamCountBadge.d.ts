/**
 * The one count capsule. The Human Inbox entry, the Channel feed's Thread
 * entry, and the Inbox queue row all answer the same question — how much is
 * waiting here — so they wear the same box rather than one hand-written copy
 * of the same declarations per surface. Three copies is how the feed's digit
 * ended up on a different line box from the other two.
 *
 * Zero is the absence of a count rather than a capsule reading zero, which is
 * the rule every caller wants and therefore the component's own.
 */
export declare function TeamCountBadge({ count, tone, label, className }: {
    readonly count: number;
    /** `hairline` is unread that merely arrived; the solid fill is unread that names this reader. */
    readonly tone?: 'solid' | 'hairline' | undefined;
    /** The accessible name while the count is the only thing saying it; omit it when the surrounding control already carries the number. */
    readonly label?: string | undefined;
    /** Placement belongs to the surface hanging the capsule: the narrow rail pins it to the icon's corner. */
    readonly className?: string | undefined;
}): import("react").JSX.Element | null;
//# sourceMappingURL=TeamCountBadge.d.ts.map