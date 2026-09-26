import type { AgentTeamChannelRef, AgentTeamJoinChannelRequest, AgentTeamJoinChannelResult, AgentTeamMemberId, AgentTeamRemoveChannelMemberRequest, AgentTeamRemoveChannelMemberResult } from 'dsh-sophia-entities/types';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
/** One idempotent membership intent: `joined` rows leave, others join. */
export interface ChannelMembershipChange {
    readonly workspaceId: WorkspaceId;
    readonly channelRef: AgentTeamChannelRef;
    readonly memberId: AgentTeamMemberId;
    readonly joined: boolean;
}
export interface ChannelMembershipTransport {
    readonly joinChannel: (request: AgentTeamJoinChannelRequest) => Promise<RemoteResult<AgentTeamJoinChannelResult>>;
    readonly removeChannelMember: (request: AgentTeamRemoveChannelMemberRequest) => Promise<RemoteResult<AgentTeamRemoveChannelMemberResult>>;
}
/**
 * Shared Channel membership mutation. One stable requestId per direction,
 * Member, and Channel survives transport failures until the Host commits it;
 * rows observe pending flags and error text keyed by `rowKeyOf`.
 */
export declare function useChannelMembership(transport: ChannelMembershipTransport, rowKeyOf: (change: ChannelMembershipChange) => string, onCommitted: (change: ChannelMembershipChange) => void | Promise<void>): {
    readonly pending: ReadonlySet<string>;
    readonly errors: ReadonlyMap<string, string>;
    readonly change: (change: ChannelMembershipChange) => Promise<void>;
};
//# sourceMappingURL=team-membership.d.ts.map