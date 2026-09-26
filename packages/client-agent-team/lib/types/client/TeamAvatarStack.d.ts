import type { AgentTeamMemberId } from 'dsh-sophia-entities/types';
/** One owner as the stack draws it: the id carries the hue, the name the initial. */
export interface TeamAvatarOwner {
    readonly memberId: AgentTeamMemberId;
    /** Public handle, or the raw Member id when the roster no longer names them. */
    readonly name: string;
}
/**
 * The reader's own identity, as the Client's one Human projection holds it.
 *
 * The stack draws every owner from the shared Member language — hue plus
 * initial — which is the whole identity an Agent has. The Human is the one
 * Member with a picture, so that one chip draws the picture and falls back to
 * this name's initial, exactly as the timeline already does.
 */
export interface TeamAvatarHuman {
    readonly memberId: AgentTeamMemberId;
    readonly name: string;
    readonly avatarUrl?: string | undefined;
}
/**
 * Owners as a seat names them: the Client's Human identity outranks the name
 * the Host projected for that actor, so a rename moves label and initial
 * together in every seat that draws the stack.
 */
export declare function namedAvatarOwners(owners: readonly TeamAvatarOwner[], human: TeamAvatarHuman | undefined): readonly TeamAvatarOwner[];
/**
 * The compact "who is on this work" stack: overlapping 18px Member circles in
 * the shared identity language, capped at three plus a `+N` chip. The circles
 * are presentational, so the stack is one `role="img"` whose label carries the
 * whole roster — three anonymous initials would read as noise.
 */
export declare function TeamAvatarStack({ owners, label, human }: {
    readonly owners: readonly TeamAvatarOwner[];
    readonly label: string;
    /** The reader's own identity; one owner matching it draws the Human's picture. */
    readonly human?: TeamAvatarHuman | undefined;
}): import("react").JSX.Element | null;
//# sourceMappingURL=TeamAvatarStack.d.ts.map