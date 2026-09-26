import type { AgentTeamChannelRef, AgentTeamTaskRef, AgentTeamThreadRef } from 'dsh-sophia-entities/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { TeamConversationProps } from './slots.ts';
import type { TeamDraftStore } from './drafts.ts';
interface TeamThreadPageProps {
    readonly workspaceId: WorkspaceId;
    /** The Human's own display name and avatar, from the shared identity projection. */
    readonly humanName: string;
    readonly humanAvatarUrl?: string | undefined;
    readonly channelRef?: AgentTeamChannelRef;
    readonly taskRef?: AgentTeamTaskRef;
    readonly threadRef: AgentTeamThreadRef;
    readonly taskNumber?: number;
    readonly backToWorkspace: TeamConversationProps['backToWorkspace'];
    readonly loadChannels: TeamConversationProps['loadChannels'];
    readonly readThread: TeamConversationProps['readThread'];
    readonly loadThreadHistory: TeamConversationProps['loadThreadHistory'];
    readonly threadObservations: TeamConversationProps['threadObservations'];
    readonly subscribeChanges: TeamConversationProps['subscribeChanges'];
    readonly loadMembers: TeamConversationProps['loadMembers'];
    readonly drafts: TeamDraftStore;
    readonly getAttachment: TeamConversationProps['getAttachment'];
    readonly reply: TeamConversationProps['reply'];
    readonly changeTask: TeamConversationProps['changeTask'];
    readonly promoteThread: TeamConversationProps['promoteThread'];
    readonly putAttachment: TeamConversationProps['putAttachment'];
    readonly selectChannel: TeamConversationProps['selectChannel'];
    readonly selectThread: TeamConversationProps['selectThread'];
    readonly resolveTaskRefs: TeamConversationProps['resolveTaskRefs'];
    readonly resolveThreadRefs: TeamConversationProps['resolveThreadRefs'];
    readonly openMemberSession: TeamConversationProps['openMemberSession'];
    readonly t: TeamConversationProps['t'];
}
export declare function TeamThreadPage(props: TeamThreadPageProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TeamThreadPage.d.ts.map