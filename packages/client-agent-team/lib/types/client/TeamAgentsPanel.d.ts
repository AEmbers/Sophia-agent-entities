import type { AgentTeamAddMemberRequest, AgentTeamClientMemberStatus } from 'dsh-sophia-entities/types';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { TeamSidebarProps } from './slots.ts';
interface TeamAgentsPanelProps {
    readonly workspaceId: WorkspaceId;
    readonly loadMembers: TeamSidebarProps['loadMembers'];
    readonly subscribeChanges: TeamSidebarProps['subscribeChanges'];
    readonly addMember: TeamSidebarProps['addMember'];
    readonly updateMember: TeamSidebarProps['updateMember'];
    readonly recoverMember: TeamSidebarProps['recoverMember'];
    readonly archiveMember: TeamSidebarProps['archiveMember'];
    readonly joinWorkspace: TeamSidebarProps['joinWorkspace'];
    readonly leaveWorkspace: TeamSidebarProps['leaveWorkspace'];
    readonly loadModels: TeamSidebarProps['loadModels'];
    /** The Member Session currently embedded in the conversation seat, if any. */
    readonly memberSessionId?: AgentTeamClientMemberStatus['member']['sessionId'];
    readonly openMemberSession: TeamSidebarProps['openMemberSession'];
    readonly onCreatingChange: (request: AgentTeamAddMemberRequest, creating: boolean) => void;
    readonly t: TeamSidebarProps['t'];
}
export declare function TeamAgentsPanel({ workspaceId, loadMembers, subscribeChanges, addMember, updateMember, recoverMember, archiveMember, joinWorkspace, leaveWorkspace, loadModels, memberSessionId, openMemberSession, onCreatingChange, t }: TeamAgentsPanelProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=TeamAgentsPanel.d.ts.map