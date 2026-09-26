/**
 * Incremental Session-log fold with an identity guard.
 *
 * Several Host projections are pure left folds over one Member Session's own
 * events: context intent, the clock baseline, and the one-shot pressure
 * notice. Folding the whole log on every event makes each of them cost
 * O(session length) per step, so a long Session gets steadily slower. This
 * module keeps the fold value together with how far it has consumed the log,
 * so a step folds only the tail that arrived since — the same idiom the
 * Harness Session itself uses for its own derived folds.
 *
 * The module is deliberately Session-agnostic: it takes a plain event array
 * plus the log offset that array starts at, so a caller (including a
 * measurement harness) can drive it without constructing a Session.
 *
 * Correctness rests on the log being append-only, which it is: Session logs
 * have no truncation API, `seq` is the log index, and `seq === log.length` is
 * a documented contiguity contract. A Session adopts a different log only by
 * being constructed from another seed, which replaces the whole slice rather
 * than editing one position.
 *
 * The guard covers the observable ways that contract can break: a changed
 * `logFrom`, a shorter log, a different event type at the anchor. Each
 * re-folds from `logFrom`, so a fork, resume, or rollover degrades to the cost
 * of a cold fold and never to a wrong picture.
 *
 * Named residual: the guard anchors on `(seq, type)`, so an event replaced in
 * place by another of the SAME type at the SAME seq is not detected, and the
 * cursor would keep its old value and fold only the tail. Reaching that state
 * requires a caller to violate the append-only contract above — reading one
 * Session's cursor against a log someone rewrote in place. A content-sensitive
 * anchor would not close it either: only the anchor position is re-read, so a
 * swap at any earlier folded position passes a boundary digest just as
 * silently, while costing a payload digest on every advance. Closing it
 * properly means fingerprinting every folded event, which is the full refold
 * this module exists to avoid; if the contract ever changes, that is the fix.
 * @module dsh-sophia-entities/session-event-cursor
 */
/** The minimum event shape the cursor reads: identity and position, never payload. */
export interface SessionCursorEvent {
    readonly seq: number;
    readonly type: string;
}
/**
 * One fold expressed as the two pure functions the cursor needs. `start` is
 * the value of an empty log; `step` returns the same reference when the event
 * is not this fold's business, so uninterested events cost nothing.
 */
export interface SessionEventFold<S, E extends SessionCursorEvent = SessionCursorEvent> {
    readonly start: S;
    readonly step: (state: S, event: E) => S;
}
/**
 * A fold value plus the position that produced it.
 *
 * `foldedThrough` is a log offset: the number of events consumed, so the next
 * event to fold sits at that index. `anchor` identifies the last consumed
 * event by position and type, which is what lets a rebuilt log be detected.
 */
export interface SessionEventCursor<S> {
    readonly value: S;
    readonly foldedThrough: number;
    readonly logFrom: number;
    readonly anchor: {
        readonly seq: number;
        readonly type: string;
    } | null;
}
/**
 * Open a cursor for a log slice that starts at `logFrom` (a Session's
 * `inheritedEventCount` for its own events, or 0 for a full log). Nothing is
 * consumed yet, so the first {@link advanceSessionEventCursor} folds the whole
 * slice.
 */
export declare function initSessionEventCursor<S, E extends SessionCursorEvent>(fold: SessionEventFold<S, E>, logFrom?: number): SessionEventCursor<S>;
/**
 * Fold the log tail that arrived since the cursor stopped and return the
 * advanced cursor; the same reference comes back when there is nothing new.
 *
 * `events` is the slice starting at `logFrom`, and `logEnd` is the EXCLUSIVE
 * end offset of that slice in the owning log — the same coordinate space as
 * `logFrom`, not `events.length`. An inherited Session's own events start at
 * its `inheritedEventCount`, so for a 14-event log with 10 inherited events
 * the slice is `events[0..4]` spanning `logFrom = 10` to `logEnd = 14`. This
 * mirrors the Session's own `snapshotEvents(fromSeq, toSeqExclusive)`.
 *
 * Both offsets are passed explicitly rather than read from the cursor so the
 * caller states the log it is folding, which is also what makes the fallback
 * below decidable.
 */
export declare function advanceSessionEventCursor<S, E extends SessionCursorEvent>(cursor: SessionEventCursor<S>, events: readonly E[], logFrom: number, logEnd: number, fold: SessionEventFold<S, E>): SessionEventCursor<S>;
/**
 * A cursor together with the Session it was folded from: the unit a cache
 * keyed by owner stores.
 *
 * Keying by owner (a Member) rather than by Session id keeps the entry count
 * bounded by the roster instead of by the number of generations, because a new
 * Session replaces its predecessor's entry rather than adding another. The
 * Session id kept beside the cursor is what stops that replacement from being
 * read as a hit: a cursor is only ever resumed for the log it folded, and the
 * id lives here rather than inside the cursor because the cursor is
 * Session-agnostic by design.
 */
export interface OwnedSessionEventCursor<S> {
    readonly sessionId: string;
    readonly cursor: SessionEventCursor<S>;
}
/**
 * Advance one owner's fold and answer with the entry to store back, so every
 * caller keeps the same one-entry-per-owner invariant.
 *
 * `events` is that Session's whole own-events slice starting at `logFrom` (its
 * `inheritedEventCount`), so the slice's end is the log's end. The cursor is
 * resumed only while `owned` still belongs to `sessionId`; every other case
 * starts cold at `logFrom`, which is the same degradation the cursor's own
 * guard performs for a rewritten log.
 */
export declare function advanceOwnedSessionEventCursor<S, E extends SessionCursorEvent>(owned: OwnedSessionEventCursor<S> | undefined, sessionId: string, fold: SessionEventFold<S, E>, events: readonly E[], logFrom: number): OwnedSessionEventCursor<S>;
//# sourceMappingURL=session-event-cursor.d.ts.map