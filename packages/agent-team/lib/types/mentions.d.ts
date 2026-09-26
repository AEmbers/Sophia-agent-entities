import type { AgentTeamMemberId } from './types/entities.ts';
/**
 * One addressable name in a Message body: the Member's stable id plus the
 * handle authors are expected to write. The Human is included through the
 * same shape so a body-level mention needs no special case at the call site.
 */
export interface AgentTeamBodyMentionCandidate {
    readonly memberId: AgentTeamMemberId;
    readonly handle: string;
}
/** Outcome of scanning one Message body for authored mentions. */
export interface AgentTeamBodyMentionResolution {
    /** Candidate Member ids named in the body, in candidate order; never the caller's own id. */
    readonly memberIds: readonly AgentTeamMemberId[];
    /** The body carried an `@all` marker, so the caller decides how wide that reaches. */
    readonly all: boolean;
}
/** One `@Handle` occurrence the delivery scan reads as a call, in body order. */
export interface AgentTeamBodyHandleMatch {
    /** The candidate handle, in its canonical spelling rather than the authored casing. */
    readonly handle: string;
    readonly start: number;
    readonly end: number;
}
/** Whether one body carries the `@all` marker outside code. */
export declare function hasAllMarker(body: string): boolean;
/**
 * Every `@Handle` occurrence in one body that names one of `handles`:
 * case-insensitive, on Unicode word boundaries, longest handle first, outside
 * code. Writing `@` is required: bare handles are ordinary words. This is the
 * single definition of an authored mention — the Host delivery resolution and
 * the Client's chip rendering and draft preview all read through it, so a name
 * that renders as a chip is the same name that delivers a notification.
 */
export declare function scanBodyHandles(body: string, handles: readonly string[]): readonly AgentTeamBodyHandleMatch[];
/**
 * Resolve the `@Handle` mentions authored in one Message body.
 *
 * Callers pass the candidates reachable in the Message's Channel, so a name
 * that resolves here is already an addressable target; handles the Channel
 * cannot reach simply stay prose.
 *
 * `sender` is excluded because a Message never mentions its own author, which
 * also keeps the result usable as a recipient set without further filtering.
 */
export declare function resolveBodyMentions(body: string, candidates: readonly AgentTeamBodyMentionCandidate[], sender: AgentTeamMemberId): AgentTeamBodyMentionResolution;
//# sourceMappingURL=mentions.d.ts.map