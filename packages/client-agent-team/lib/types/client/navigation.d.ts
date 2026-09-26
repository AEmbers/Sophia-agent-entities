import type { SessionId } from '@deepseek-ai/dsh-session';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { AgentTeamChannelRef, AgentTeamTaskRef, AgentTeamThreadRef } from 'dsh-sophia-entities/types';
export type TeamMode = 'conversation' | 'team';
export interface TeamNavigationSnapshot {
    mode: TeamMode;
    workspaceId?: WorkspaceId;
    channelRef?: AgentTeamChannelRef;
    taskRef?: AgentTeamTaskRef;
    threadRef?: AgentTeamThreadRef;
    taskNumber?: number;
    /**
     * Durable position of the Human mention-Inbox page (a navigation fact, not
     * an unread fact): selecting Inbox clears the Channel/Thread faces, and a
     * reload reopens the page. Read markers only move through Thread reads.
     */
    inbox?: boolean;
    /** Runtime-only Member Session embedded in the conversation seat; never persisted. */
    memberSessionId?: SessionId;
    /** Runtime-only session to restore when the Member view closes; never persisted. */
    returnToSessionId?: SessionId;
}
declare const STORAGE_KEY = "dsh.agent-team.navigation";
export interface TeamNavigationActions {
    enterTeam: () => void;
    leaveTeam: () => void;
    selectWorkspace: (workspaceId: WorkspaceId) => void;
    selectChannel: (channelRef: AgentTeamChannelRef) => void;
    selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void;
    /** Open the Human mention-Inbox page; clears the Channel/Thread faces. */
    selectInbox: () => void;
    backToWorkspace: () => void;
    /** Leave the selected Channel for the workspace Channel list; keeps mode and Workspace. */
    backToChannels: () => void;
    /**
     * Swap the conversation seat to a Member Session while Team chrome stays
     * mounted. `returnToSessionId` is captured once — switching between Member
     * Sessions keeps the original target.
     */
    enterMemberSession: (sessionId: SessionId, returnToSessionId?: SessionId) => void;
    /** Close the embedded Member Session view and return to the Team views. */
    exitMemberSession: () => void;
}
/** Root-scoped Team mode state. Slot lifetimes subscribe to this source. */
export declare class TeamNavigation {
    private snapshot;
    private readonly listeners;
    readonly getSnapshot: () => TeamNavigationSnapshot;
    readonly subscribe: (listener: () => void) => (() => void);
    actions(): TeamNavigationActions;
    dispose(): void;
    private setMode;
    private setMemberSession;
    /** Any explicit Team navigation or the footer leave closes a Member view. */
    private clearMemberSession;
    private setWorkspace;
    private setChannel;
    /** The Inbox is a face, not workspace content: selecting a Workspace leaves it. */
    private setInbox;
    private clearChannel;
    private setThread;
    private commit;
}
export { STORAGE_KEY };
//# sourceMappingURL=navigation.d.ts.map