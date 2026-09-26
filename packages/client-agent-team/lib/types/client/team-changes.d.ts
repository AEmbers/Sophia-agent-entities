import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client';
import type { AgentTeamChangeScope } from 'dsh-sophia-entities/types';
export type TeamChangeScope = AgentTeamChangeScope | undefined;
export type TeamChangeUpdate = {
    readonly type: 'changed';
    readonly version: number;
} | {
    readonly type: 'failed';
    readonly message: string;
};
export type TeamChangeListener = (update: TeamChangeUpdate) => void;
/** One logical stream per scope per page; Harness owns the shared transport and recovery. */
export declare class TeamChangeStream {
    private readonly remote;
    private readonly subscriptions;
    constructor(remote: Pick<ClientRemote, '$stream' | 'agentTeam'>);
    subscribe(scope: TeamChangeScope, listener: TeamChangeListener): () => void;
    /**
     * Reopen every scope whose stream already ended for good. The Harness resumes a
     * live generation across reconnects, but a terminated one is gone for good: a new
     * Host generation is the moment the scope was waiting for can come back, and the
     * listeners keep their seats, so only the stream is replaced.
     */
    recover(): void;
    private open;
    dispose(): Promise<void>;
    private fail;
    private run;
}
/**
 * The Host's `changes` stream never wakes on a Thread read — a read advances
 * only the reader's private watermark, so no shared projection changes. A
 * durable read does consume the reader's own mention markers, so the Human's
 * badge and Inbox page refresh from the completed read itself instead of
 * waiting for the next unrelated commit.
 */
export declare class TeamReadStream {
    private version;
    private readonly listeners;
    bump(): void;
    subscribe(listener: () => void): () => void;
}
//# sourceMappingURL=team-changes.d.ts.map