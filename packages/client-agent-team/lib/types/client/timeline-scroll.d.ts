export interface TimelineScroll {
    readonly ref: React.RefObject<HTMLElement>;
    onScroll: () => void;
    /** Whether the reader currently sits within the follow margin of the bottom. */
    isPinned: () => boolean;
    /** Scroll the timeline to the latest fact immediately. */
    scrollToBottom: () => void;
}
/**
 * Chat-timeline scroll policy shared by the Channel and Thread pages: follow
 * new facts only while the reader stays pinned to the bottom, and keep
 * prepended history visually stable. The content key must change whenever
 * rendered facts change.
 */
export declare function useTimelineScroll(contentKey: string): TimelineScroll;
//# sourceMappingURL=timeline-scroll.d.ts.map