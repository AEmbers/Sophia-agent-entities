/**
 * Shared Host accessors for every Team tool module. `agent.ctx.get` is the
 * one resolution path a tool row has — the preset mounts these tools beside
 * the Host, so a missing service or an inactive Member is a model-visible
 * rejection rather than a silent no-op. Both messages are user-facing text.
 */
import AgentTeam from 'dsh-sophia-entities/host';
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client';
/** The Agent shape every Team tool receives. */
export type TeamToolAgent = NonNullable<Parameters<AgentTeam['memberForAgent']>[0]>;
/** Resolve the Team Host service, or reject the tool call. */
export declare function service(agent: TeamToolAgent): AgentTeam;
/** Resolve the calling Team Member, or reject the tool call. */
export declare function member(agent: TeamToolAgent): import("dsh-sophia-entities/types").AgentTeamAgentMember;
/** A collaboration address, never a cwd or Session switch. */
export declare const workspaceParam: {
    type: "string";
    description: string;
};
/** Reject ambiguous routing before a tool reads facts or attempts a mutation. */
export declare function workspaceOf(args: {
    workspace?: string | undefined;
}, agent: TeamToolAgent): WorkspaceId;
//# sourceMappingURL=host-access.d.ts.map