/** One rendered timeline block: a same-sender run or an injected day marker. */
export type TimelineBlock<T> = {
    readonly kind: 'run';
    readonly items: readonly T[];
} | {
    readonly kind: 'day';
    readonly label: string;
};
/** Same-sender messages at least this many minutes apart count as separate turns. */
export declare const RUN_GAP_MINUTES = 5;
/**
 * Whether two adjacent same-sender run items are separated by a real waiting
 * gap: only such gaps earn an explicit time divider, while rapid bursts stay
 * merged into one seamless run.
 */
export declare function isRunGap(previousOccurredAt: string | undefined, occurredAt: string | undefined): boolean;
/** Local-calendar day key for one wall-clock instant; shared by bespoke loops. */
export declare function timelineDayKey(occurredAt: string): string;
/**
 * Numeric day label matching the message-time convention: MM-DD within the
 * current year, full YYYY-MM-DD across years.
 */
export declare function daySeparatorLabel(occurredAt: string, now?: Date): string;
/**
 * Chunk one ordered timeline into same-sender runs, breaking a run at every
 * calendar-day change so identity chrome restarts across days. Items without a
 * wall-clock instant (activities) inherit the preceding message's day and never
 * trigger a boundary; callers interleave activity rows between returned blocks.
 */
export declare function chunkRunsWithDays<T>(items: readonly T[], senderOf: (item: T) => string | undefined, occurredAtOf: (item: T) => string | undefined): readonly TimelineBlock<T>[];
//# sourceMappingURL=team-separators.d.ts.map