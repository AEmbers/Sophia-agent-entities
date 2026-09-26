/**
 * The one agent-facing Team timestamp formatter.
 *
 * Ledger storage keeps UTC ISO instants (`occurredAt` on every operation);
 * rendering converts them into the fixed Team coordination zone UTC+8 with
 * an explicit offset (`2026-09-08T17:00:00+08:00`). The conversion is a
 * fixed offset with no daylight-saving component, so the same stored instant
 * renders byte-identically on every reread path — the context-cache
 * invariant. The Web Client keeps its own browser-local rendering and never
 * passes through this module; a future configuration layer may make the
 * zone configurable, but the render must stay a single deterministic
 * formatter per stored instant.
 * @module dsh-sophia-entities/time-format
 */
/**
 * Format one stored UTC ISO instant as the agent-facing Team timestamp.
 * @param occurredAt - stored UTC ISO 8601 instant (ledger `occurredAt`).
 * @returns the fixed-offset UTC+8 rendering, or the input unchanged when it
 * cannot be parsed (never a fabricated time).
 */
export declare function formatTeamTimestamp(occurredAt: string): string;
/**
 * Format a non-negative elapsed millisecond count as compact whole-second
 * units (`2d 3h 12m 8s`), mirroring the shipped harness time-context
 * vocabulary so both clock families read the same way.
 */
export declare function formatTeamDuration(elapsedMs: number): string;
//# sourceMappingURL=time-format.d.ts.map