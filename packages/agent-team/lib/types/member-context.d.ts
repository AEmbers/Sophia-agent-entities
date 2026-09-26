import type { Context } from '@deepseek-ai/cordis';
import { type ContextFormed } from '@deepseek-ai/dsh-llm';
import type { AgentTeamAgentMember } from './types.ts';
export declare const name = "wowyuarm-agent-team-member-context";
/** This producer's own attribution. `kind` must be producer-owned (Session format V4);
 * the second member is the read-time conversion's rename of this producer's
 * released V3 history (`plugin:` + id, `plugin` key dropped) — read-side only. */
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'wowyuarm-agent-team-member-context': {
            kind: 'wowyuarm-agent-team-member-context';
        } & ContextFormed;
        'plugin:wowyuarm-agent-team-member-context': {
            kind: 'plugin:wowyuarm-agent-team-member-context';
        } & ContextFormed;
    }
}
export declare function apply(ctx: Context): void;
export declare function renderMemberIdentity(member: Pick<AgentTeamAgentMember, 'handle' | 'description'>): string;
/** A current address list, not a copy of instructions from another checkout. */
export declare function renderMemberWorkspaces(workspaces: readonly {
    readonly workspaceId: string;
    readonly path: string | undefined;
    readonly default: boolean;
}[]): string;
export declare function renderMemberMemory(raw: Buffer, privateMemoryPath?: string): string;
//# sourceMappingURL=member-context.d.ts.map