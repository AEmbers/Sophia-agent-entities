import type { AgentTeamChannelRef } from 'dsh-sophia-entities/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { TeamConversationProps } from './slots.ts';
import type { TeamDraftStore } from './drafts.ts';
interface TeamChannelPageProps {
    readonly workspaceId: WorkspaceId;
    readonly channelRef: AgentTeamChannelRef;
    /** The Human's own display name and avatar, from the shared identity projection. */
    readonly humanName: string;
    readonly humanAvatarUrl?: string | undefined;
    readonly loadChannels: TeamConversationProps['loadChannels'];
    readonly subscribeChanges: TeamConversationProps['subscribeChanges'];
    readonly loadMembers: TeamConversationProps['loadMembers'];
    /** The Human's own unread per Thread: the Host's three-class judgement, never a Client guess. */
    readonly loadInbox: TeamConversationProps['loadInbox'];
    readonly drafts: TeamDraftStore;
    readonly getAttachment: TeamConversationProps['getAttachment'];
    readonly putAttachment: TeamConversationProps['putAttachment'];
    readonly sendMessage: TeamConversationProps['sendMessage'];
    readonly joinChannel: TeamConversationProps['joinChannel'];
    readonly removeChannelMember: TeamConversationProps['removeChannelMember'];
    readonly selectThread: TeamConversationProps['selectThread'];
    readonly selectChannel: TeamConversationProps['selectChannel'];
    readonly resolveTaskRefs: TeamConversationProps['resolveTaskRefs'];
    readonly resolveThreadRefs: TeamConversationProps['resolveThreadRefs'];
    readonly openMemberSession: TeamConversationProps['openMemberSession'];
    readonly backToChannels: TeamConversationProps['backToChannels'];
    readonly t: TeamConversationProps['t'];
}
export declare function TeamChannelPage({ workspaceId, channelRef, humanName, humanAvatarUrl, loadChannels, subscribeChanges, loadMembers, loadInbox, drafts, putAttachment, getAttachment, sendMessage, joinChannel, removeChannelMember, selectThread, selectChannel, backToChannels, resolveTaskRefs, resolveThreadRefs, openMemberSession, t }: TeamChannelPageProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TeamChannelPage.d.ts.map