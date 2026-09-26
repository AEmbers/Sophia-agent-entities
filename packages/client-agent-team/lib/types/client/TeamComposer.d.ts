import type { AgentTeamClientMemberStatus, AgentTeamMemberId } from 'dsh-sophia-entities/types';
import type { TeamConversationProps } from './slots.ts';
import type { TeamDraftKey, TeamDraftStore } from './drafts.ts';
export declare function TeamComposer({ members, followerMemberIds, drafts, draftKey, pending, confirmation, error, onEdit, onSubmit, placeholder, pendingFiles, onFilesChange, asTask, onAsTaskChange, t }: {
    readonly members: readonly AgentTeamClientMemberStatus[];
    /** Current Thread followers; the Thread surface passes them so they rank above other candidates. */
    readonly followerMemberIds?: ReadonlySet<AgentTeamMemberId>;
    /**
     * The draft cache this composer subscribes to: owning the subscription here
     * instead of in the hosting page keeps a keystroke from re-rendering the
     * timeline around it.
     */
    readonly drafts: TeamDraftStore;
    readonly draftKey: TeamDraftKey;
    readonly pending: boolean;
    readonly confirmation?: string;
    readonly error?: string;
    /** The Human edited the draft: the hosting page drops its one-shot send state. */
    readonly onEdit?: () => void;
    readonly onSubmit: () => void;
    /** Conversation-specific prompt; the shared default fits Channel surfaces. */
    readonly placeholder?: string;
    /** Upload-capable surfaces pass this to enable the "+" file picker; the reply path omits it. */
    readonly pendingFiles?: readonly File[];
    readonly onFilesChange?: (files: readonly File[]) => void;
    /** Channel-only: create a real Task with the top-level Message. Default off. */
    readonly asTask?: boolean;
    readonly onAsTaskChange?: (asTask: boolean) => void;
    readonly t: TeamConversationProps['t'];
}): import("react").JSX.Element;
//# sourceMappingURL=TeamComposer.d.ts.map