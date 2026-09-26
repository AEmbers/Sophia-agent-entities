/**
 * The Team's single seam for reading stored Sessions.
 *
 * Every per-Session read the Host performs goes through here: one
 * `open → read → close` cycle whose handle lifecycle is guaranteed closed,
 * and whose failures are normalized into the five categories consumers choose
 * policy by. Callers never touch a `SessionHandle`, an artifact path, a
 * format generation, or Harness error message text.
 *
 * The reader owns reading and classification only — not Member lifecycle,
 * Agent create/resume, UI, or ledger.
 *
 * Classification notes: the shipped JSONL backend throws its
 * `corrupt session log` family as plain `Error`s, so corruption is detected by
 * that stable message prefix (an upstream gap; if the text ever changes the
 * failure degrades to `unknown`, which consumers treat conservatively —
 * blocking rather than silently skipping). Typed refusals are also matched
 * through `error.cause` chains because the Harness agent layer wraps
 * persistence failures during resume.
 * @module dsh-sophia-entities/stored-session-reader
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent, SessionHeader, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import { type SessionLocation } from '@deepseek-ai/dsh-session-persistence';
/** Why one stored Session could not be read; the policy axis for consumers. */
export type StoredSessionFailureKind = 'missing' | 'refused' | 'corrupt' | 'io' | 'unknown';
/** One normalized stored-Session read failure. */
export interface StoredSessionFailure {
    readonly kind: StoredSessionFailureKind;
    readonly sessionId: SessionId;
    /** The underlying reason, from the matched error's own message. */
    readonly detail: string;
    /** The refused artifact's location, when the backend reported one. */
    readonly location?: SessionLocation;
}
/** A complete, validated stored-Session read: storage metadata plus the whole event log. */
export interface StoredSessionInspection {
    readonly header: SessionHeader;
    readonly inheritedEventCount: SessionLogOffset;
    readonly events: readonly SessionEvent[];
}
/** The result of one read: the inspection, or its normalized failure. */
export type StoredSessionReadResult = {
    readonly ok: true;
    readonly inspection: StoredSessionInspection;
} | {
    readonly ok: false;
    readonly failure: StoredSessionFailure;
};
/**
 * A call site's session-read failure, carrying the typed classification so
 * activation can route the diagnostic without re-matching error text.
 */
export declare class StoredSessionReadError extends Error {
    readonly failure: StoredSessionFailure;
    constructor(message: string, failure: StoredSessionFailure);
}
/**
 * Classify any failure as a stored-Session read failure. Total: unmatched
 * errors become `unknown`, and a direct system error code becomes `io` —
 * call this only where the failed operation is known to be a session read.
 */
export declare function classifyStoredSessionFailure(error: unknown, sessionId: SessionId): StoredSessionFailure;
/**
 * The session-shaped failure carried by an arbitrary error, when it carries
 * one at all: deterministic markers (typed classes, the corruption message
 * family) are matched through the cause chain; transient fs errors are not —
 * outside the reader they are not provably session-related. Activation uses
 * this to route diagnostics; `undefined` means the failure is not
 * session-shaped.
 */
export declare function sessionFailureOf(error: unknown, sessionId: SessionId): StoredSessionFailure | undefined;
/** Read stored Sessions through one seam: full validated reads with normalized failures. */
export declare class StoredSessionReader {
    private readonly ctx;
    constructor(ctx: Context);
    /**
     * Read one stored Session completely. The handle is closed on every path;
     * any failure of open, read, or close is returned as its normalized
     * category, never thrown.
     */
    read(sessionId: SessionId): Promise<StoredSessionReadResult>;
    /**
     * Whether one stored Session has durable persisted content, decided through
     * `stat`: the backend reports a still-draining session through its pending
     * header, so this is the existence probe activation relies on. Only the
     * missing case returns `false`; unexpected errors propagate as before.
     */
    exists(sessionId: SessionId): Promise<boolean>;
}
//# sourceMappingURL=stored-session-reader.d.ts.map