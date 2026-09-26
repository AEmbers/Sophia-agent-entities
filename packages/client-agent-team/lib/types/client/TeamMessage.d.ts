import { type ReactNode } from 'react';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type { AgentTeamChannelRef, AgentTeamMemberId, AgentTeamMessageAttachment, AgentTeamTaskRef, AgentTeamThreadRef } from 'dsh-sophia-entities/types';
import type { TeamConversationProps } from './slots.ts';
import type { ResolvedMemberRef } from './refs.ts';
import { type ResolvedTaskRef } from './refs.ts';
import { type ResolvedThreadRef } from './refs.ts';
import { type MentionHandle } from './team-formatters.ts';
export interface TeamMessageProps {
    readonly senderName: string;
    readonly memberId: AgentTeamMemberId;
    /** Human input stays literal text; Agent output renders as Markdown. */
    readonly human: boolean;
    readonly body: string;
    readonly occurredAt?: string;
    /** Structured mention handles of this Message; the only names that render as chips. */
    readonly mentionNames?: readonly MentionHandle[];
    readonly senderTitle?: string;
    /** Continuation of one same-sender run: suppress repeated identity chrome. */
    readonly grouped?: boolean;
    /** Continuation rows that carry their own footer chip render the time so the
        hairline-separated entry stays self-identifying. */
    readonly showGroupedTime?: boolean;
    readonly attachments?: readonly AgentTeamMessageAttachment[] | undefined;
    /** The Human's uploaded avatar; only the Human's own row draws it, and absent
     * or undecodable bytes draw the initial on the business-tinted chip. */
    readonly avatarUrl?: string | undefined;
    /** Cache readback for thumbnails; absent on surfaces without the remotes. */
    readonly loadAttachment?: TeamConversationProps['getAttachment'] | undefined;
    readonly t?: TeamConversationProps['t'] | undefined;
    /** Resolve a branded ref found in the body; absent surfaces render refs as plain text. */
    readonly onOpenRef?: ((ref: string) => void) | undefined;
    /** Host lookup turning task refs into human-facing numbers; absent keeps raw refs. */
    readonly onResolveTaskRefs?: ((taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>) | undefined;
    /** Host lookup turning thread refs into titled chips; absent keeps raw refs. */
    readonly onResolveThreadRefs?: ((threadRefs: readonly AgentTeamThreadRef[]) => Promise<readonly ResolvedThreadRef[]>) | undefined;
    /** Roster name for one authored channel ref; absent or unknown keeps plain text. */
    readonly channelNameOf?: ((ref: AgentTeamChannelRef) => string | undefined) | undefined;
    /** Roster facts for one authored member ref; absent or unknown keeps plain text. */
    readonly memberOf?: ((ref: AgentTeamMemberId) => ResolvedMemberRef | undefined) | undefined;
    /** Agent-card session jump for member chips; absent renders them as plain text. */
    readonly onOpenMemberSession?: ((sessionId: SessionId) => void) | undefined;
    readonly children?: ReactNode;
}
/**
 * One chat message row with identity chrome and sender-appropriate rendering.
 *
 * Memoized because a timeline row is rendered by the page that owns the whole
 * Thread: the Task-ref subscription below lives inside this component, so
 * skipping a render here never detaches it. Callers must therefore keep the
 * props they derive per render (mention names, ref callbacks) identity-stable.
 */
export declare const TeamMessage: import("react").NamedExoticComponent<TeamMessageProps>;
//# sourceMappingURL=TeamMessage.d.ts.map