import type { AgentTeamAddMemberRequest, AgentTeamAddMemberResult, AgentTeamCreateChannelRequest, AgentTeamCreateChannelResult, AgentTeamSendMessageRequest, AgentTeamSendMessageResult, AgentTeamView, AgentTeamViewRequest } from './types/requests-results.ts';
import type { TeamBackend } from 'dsh-sophia-entities/orchestration';
/**
 * Structural narrow pick of the `AgentTeam` host's public surface, so the
 * orchestration plane drives the backend with the live host instance (from
 * `exec.agent.ctx.get('agentTeam')`) instead of the private `AgentTeamLedger`.
 * Every mutating method forces the Human actor internally
 * (`agentTeamHumanActor()`), preserving the「主人批准后代为提交」semantics without
 * the backend supplying an actor. `addMember` returns the host-generated
 * member (memberId/sessionId/privateMemoryPath come from the host), which the
 * backend uses to map planned handles to memberIds.
 */
export interface PersistentHostAPI {
    readonly createChannel: (request: AgentTeamCreateChannelRequest) => Promise<AgentTeamCreateChannelResult>;
    readonly addMember: (request: AgentTeamAddMemberRequest) => Promise<AgentTeamAddMemberResult>;
    readonly sendMessage: (request: AgentTeamSendMessageRequest) => Promise<AgentTeamSendMessageResult>;
    /** Synchronous Human-facing projection; used for reads only, never mutation. */
    readonly view: (request: AgentTeamViewRequest) => AgentTeamView;
}
export interface SophiaPersistentBackendDeps {
    /** The live `AgentTeam` host instance, narrowed to the backend's structural needs. */
    readonly host: PersistentHostAPI;
    /** The workspace the materialized team lives in (matches the channel workspace so member participation seeds correctly). */
    readonly workspaceId: string;
}
/**
 * Create the persistent backend bound to one host + workspace.
 *
 * `describe`/`list` resolve teams through `host.view({ workspaceId })` reading
 * as the Human (no memberId filter, so the whole workspace is visible) and map
 * each Channel to a `TeamSummary`. `teamRef` is `${workspaceId}/${channelRef}`;
 * `describe` also tolerates a bare `channelRef` (falls back to this workspace).
 */
export declare function createSophiaPersistentBackend(deps: SophiaPersistentBackendDeps): TeamBackend;
//# sourceMappingURL=sophia-persistent-backend.d.ts.map