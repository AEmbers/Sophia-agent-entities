import type { AgentTeamActivity, AgentTeamClaim, AgentTeamClientMemberStatus, AgentTeamMemberId, AgentTeamTask, AgentTeamTaskRef, AgentTeamThreadRef } from 'dsh-sophia-entities/types';
import type { TeamKey } from './locales.ts';
import type { TeamConversationProps } from './slots.ts';
import type { TeamStateDotState } from './TeamStateDot.tsx';
export declare function formatTaskStatus(status: AgentTeamTask['status'], t: TeamConversationProps['t']): string;
export declare function formatClaimState(state: AgentTeamClaim['state'], t: TeamConversationProps['t']): string;
/**
 * The two localized halves of one runtime-risk statement: the class label names
 * what kind of problem this is, and the sentence key states it of the Member
 * (it keeps its `{member}` placeholder so the caller supplies the handle). The
 * Host's own diagnostic stays English and belongs in the row's title, so the
 * visible line reads in the interface language.
 */
export declare function formatRiskClass(status: Pick<AgentTeamClientMemberStatus, 'diagnostic'>, t: TeamConversationProps['t']): {
    readonly label: string;
    readonly sentenceKey: TeamKey;
};
/**
 * The first sentence of a Host diagnostic: risk rows read one line, and the
 * Host writes the reason as its first sentence with recovery context after it.
 * A terminator the Host used mid-sentence becomes a full stop so the clamped
 * line reads as a sentence; the untouched text stays in the row's title.
 */
export declare function firstSentence(detail: string): string;
/**
 * Status indicator for a Task status, the dot every Task surface renders.
 * Active states map to StateDot variants; every status renders a dot so they
 * share one shape language — todo is a hollow ring (not started), closed a
 * quiet gray dot (archived).
 */
export declare function taskStatusDot(status: AgentTeamTask['status']): TeamStateDotState;
/** One-line title snippet derived from the Task's root Message body. */
export declare function formatTaskTitle(body: string): string;
/** Deterministic avatar hue for one Member identity; stable across sessions and themes. */
export declare function memberHue(memberId: string): number;
/** One branded-ref occurrence inside a literal body segment. */
export interface RefSegment {
    readonly text: string;
    /** The full `task:`/`channel:`/`thread:`/`member:` ref when this segment is a link. */
    readonly ref?: string;
}
/**
 * Split a literal text run into plain and branded-ref segments. The pattern
 * anchors on the fixed ref prefixes plus a UUID shape (full or abbreviated),
 * so ordinary prose containing a colon never linkifies; a doubled colon from
 * model output is tolerated. Segment refs are always canonical, so resolution
 * and navigation work regardless of how the ref was spelled; text without any
 * ref comes back as one untouched segment.
 */
export declare function splitBrandedRefs(text: string): readonly RefSegment[];
/**
 * Whether one string's whole content is exactly one branded ref. A code span
 * like this is the model styling a ref as an identifier, not publishing code,
 * so the Markdown pass may linkify it; anything larger stays literal.
 */
export declare function isSingleBrandedRef(text: string): boolean;
export interface MentionSegment {
    readonly text: string;
    readonly mention: boolean;
    /** Canonical handle of the mentioned Member; present only on mention segments. */
    readonly name?: string;
}
/** The Human's handle before they could rename themselves; the Host keeps it as an alias. */
export declare const HUMAN_HISTORIC_HANDLE = "human";
/**
 * One mentioned Member as a Message renders them: the display name the seat
 * prints, plus every older handle that still addresses the same person. A
 * rename must not orphan the mentions written before it — the bodies say
 * `@human`, the roster says the new name, and both are the Human.
 */
export type MentionHandle = string | {
    readonly name: string;
    readonly also: readonly string[];
};
/** The printed name of one mention entry; its aliases follow that name, never the body. */
export declare function mentionNameOf(mention: MentionHandle): string;
/**
 * Locate one Message's delivered mention names inside its literal body. Matching
 * is the shared Host delivery scan — an authored `@`, case-insensitive on Unicode
 * word boundaries, longest handle first, code quoted rather than called — so a chip
 * never lands where delivery would not reach. A chip names the person by their
 * current name, the way member refs do: a body that wrote an older handle of a
 * renamed Human chips as the name they answer to today. A person whose entry
 * matched through any of their handles counts as matched, so the fallback row
 * never repeats someone already chipped inline; names absent from the body come
 * back unmatched so the consumer can append them as a fallback chip row.
 */
export declare function splitMentionNames(text: string, mentions: readonly MentionHandle[]): {
    segments: MentionSegment[];
    unmatched: readonly string[];
};
/**
 * Whether one draft spells a handle as an authored `@mention`: the shared
 * delivery scan, so the composer's recipient prune and will-notify preview agree
 * with the Host on what the draft actually calls.
 */
export declare function containsMention(body: string, handle: string): boolean;
/** Whether one draft carries the `@all` marker the mention menu expands. */
export declare function containsAllMention(body: string): boolean;
/**
 * Every Member the mention menu's `@all` row stands for: the roster this
 * composer was handed minus Members who cannot take a Message right now — the
 * same filter the per-handle rows apply, so the expansion and the menu agree.
 */
export declare function allMentionMembers(members: readonly AgentTeamClientMemberStatus[]): readonly AgentTeamClientMemberStatus[];
/**
 * Member ids one draft asks to notify by text alone: the Client's preview of
 * the Host's own body mention resolution, so a hand-typed `@Handle` reports
 * exactly like a pick from the mention menu. `@all` stands for the menu's
 * expansion; a written handle counts whenever its Member can still take a
 * Message — state decides, not presence, because an offline Member is notified
 * and reads it later.
 *
 * The result is preview-only. Only picked recipients travel as explicit
 * recipients, where a name the Channel cannot reach would be a rejected target
 * rather than the prose the Host reads.
 */
export declare function mentionedMemberIds(body: string, members: readonly AgentTeamClientMemberStatus[]): readonly AgentTeamMemberId[];
/**
 * Canonical chip handles for one Message's structured mention refs. The Human
 * is Team authority, not an Agent projection, so `members()` does not include
 * it: the caller hands over the profile name every seat names them by, so a
 * rename reaches old mention chips the same way it reaches the roster.
 *
 * A renamed Human also keeps the historic `human` handle, because the Host
 * accepts it as an alias and Message bodies written before the rename say
 * exactly that: without the alias those mentions would stop chipping inline and
 * reappear as a trailing chip under a name the body never used.
 */
export declare function mentionNamesOf(mentions: readonly AgentTeamMemberId[], handles: ReadonlyMap<AgentTeamMemberId, string>, humanName: string): MentionHandle[];
/** Accessible label for one "who is on this work" stack: its owners' handles, comma-separated. */
export declare function claimersLabel(owners: ReadonlyArray<{
    readonly name: string;
}>, t: TeamConversationProps['t']): string;
/**
 * Whether an Agent body survives literal rendering unchanged: no fences,
 * inline code, emphasis markers, links, images, tables, or block constructs.
 * Only such plain-prose bodies may reuse the Human inline mention flow —
 * anything richer keeps the trailing chip row because the Markdown primitive
 * renders block-level documents that cannot interleave inline chips.
 */
export declare function isPlainTextBody(text: string): boolean;
/** Absolute local `YYYY-MM-DD HH:mm` label: the precise instant behind every shorter form. */
export declare function formatAbsoluteTime(occurredAt: string): string;
/**
 * Wall-clock label for one Message instant: time within the current day,
 * month-day time within the year, full date otherwise.
 */
export declare function formatMessageTime(occurredAt: string, now?: Date): string;
/**
 * Recency label for one Inbox row's newest fact, shared with the Channel feed's
 * entry line so the two agree about the same instant. Today is a bare clock time
 * — the reader is in today, and 「今天」 printed down every row spends the label's
 * first word on the one segment that never varies, while `HH:mm` alone still
 * reads as a clock because it is exactly one. The first day that is not today is
 * the fact the reader has to be told, so it keeps its word; everything older
 * keeps the Message date form, so the row and the Thread it opens agree.
 */
export declare function formatInboxTime(occurredAt: string, t: TeamConversationProps['t'], now?: Date): string;
export declare function formatActivity(activity: AgentTeamActivity, options: {
    readonly t: TeamConversationProps['t'];
    readonly actorName: (memberId: AgentTeamMemberId) => string;
    readonly claims: readonly AgentTeamClaim[];
}): string;
/** Remove the machine-facing `[attachment] <path>` prompt lines from a body before display. */
export declare function stripAttachmentLines(body: string): string;
/**
 * Displayed bodies past this character count render clamped behind an expand
 * control. The rule is deterministic from the body alone, so every surface
 * derives the same default for the same Message and no client has to remember
 * a fold state.
 */
export declare const MESSAGE_COLLAPSE_CHARS = 600;
/** Whether one displayed Message body starts clamped behind the expand control. */
export declare function shouldClampMessage(displayBody: string): boolean;
/** How one Message body renders: mention-chip segments, literal text, or Markdown. */
export type MessageBodyRender = 'inline' | 'literal' | 'markdown';
/** Rendering decision for one Message body, resolved once from its stored form. */
export interface PlannedMessageBody {
    /** Stored body without machine-facing attachment prompt lines; the raw body when stripping would empty it. */
    readonly displayBody: string;
    /** Rich Agent Markdown: only such bodies get the post-render chipify pass. */
    readonly richAgentBody: boolean;
    /** Which rendering branch the body takes. */
    readonly render: MessageBodyRender;
    /** Mention-chip segments for literal bodies; absent on the Markdown branch. */
    readonly inline?: ReturnType<typeof splitMentionNames>;
    /** Mention handles that did not render as chips; the trailing row shows them. */
    readonly fallbackNames: readonly string[];
    /** Non-Task branded refs for the trailing fallback row; rich Agent bodies keep the legacy row. */
    readonly fallbackRefs: readonly string[];
    /** Task refs authored in a literal body; resolved labels replace them in place. */
    readonly taskRefs: readonly AgentTeamTaskRef[];
    /** Thread refs authored in a literal body; resolved titles replace them in place. */
    readonly threadRefs: readonly AgentTeamThreadRef[];
}
/**
 * Decide how one Message body renders. Human input and plain-prose Agent
 * bodies stay literal, with structured mention chips inline where possible;
 * rich Agent Markdown keeps unmatched mentions and non-Task refs in the
 * trailing fallback row while the post-render pass handles Task refs at their
 * authored position. Surfaces without ref navigation render everything
 * literally and keep the full fallback row.
 */
export declare function planMessageBody(body: string, options: {
    readonly human: boolean;
    readonly mentionNames?: readonly MentionHandle[];
    readonly canOpenRefs: boolean;
}): PlannedMessageBody;
//# sourceMappingURL=team-formatters.d.ts.map