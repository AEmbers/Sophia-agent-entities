import type { AgentTeamAddMemberRequest, AgentTeamChannelRef } from 'dsh-sophia-entities/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { TeamSidebarProps } from './slots.ts';
interface TeamChannelsPanelProps {
    readonly workspaceId: WorkspaceId;
    readonly loadMembers: TeamSidebarProps['loadMembers'];
    readonly loadChannels: TeamSidebarProps['loadChannels'];
    /** Membership and channel facts change outside this panel; the workspace scope keeps the list fresh. */
    readonly subscribeChanges: TeamSidebarProps['subscribeChanges'];
    readonly createChannel: TeamSidebarProps['createChannel'];
    readonly updateChannel: TeamSidebarProps['updateChannel'];
    readonly archiveChannel: TeamSidebarProps['archiveChannel'];
    readonly joinChannel: TeamSidebarProps['joinChannel'];
    readonly removeChannelMember: TeamSidebarProps['removeChannelMember'];
    readonly creatingAgents: readonly AgentTeamAddMemberRequest[];
    readonly selectedChannelRef?: AgentTeamChannelRef;
    readonly selectChannel: TeamSidebarProps['selectChannel'];
    readonly t: TeamSidebarProps['t'];
}
export declare function TeamChannelsPanel(props: TeamChannelsPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TeamChannelsPanel.d.ts.map