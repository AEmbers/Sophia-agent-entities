import type { AgentTeamChannelRef, AgentTeamMemberId, AgentTeamThreadRef } from 'dsh-sophia-entities/types';
/**
 * Keyed draft cache for the Channel/Thread composers. Drafts are local UI
 * convenience state — never Host-authoritative facts — so localStorage is the
 * right home: switching views unmounts the pages, and a refresh should not
 * cost the Human their half-written message.
 */
export type TeamDraftKey = `channel:${AgentTeamChannelRef}` | `thread:${AgentTeamThreadRef}`;
/** One cached composer state; `recipients` mirrors the structured mention set. */
export interface TeamDraftState {
    readonly draft: string;
    readonly recipients: ReadonlySet<AgentTeamMemberId>;
}
declare const STORAGE_KEY = "dsh.agent-team.drafts.v1";
/**
 * Root-scoped draft cache, one instance per Client context (created in
 * `applyUi` and injected like the navigation service — never a module
 * singleton). Slot lifetimes subscribe per key.
 */
export declare class TeamDraftStore {
    private entries;
    private readonly snapshots;
    private readonly listeners;
    readonly subscribe: (listener: () => void) => (() => void);
    /** Release listeners when the owning Client context disposes. */
    dispose(): void;
    /** Stable per-key snapshot identity for useSyncExternalStore. */
    readonly getSnapshot: (key: TeamDraftKey) => TeamDraftState;
    writeDraft(key: TeamDraftKey, draft: string): void;
    writeRecipients(key: TeamDraftKey, recipients: Iterable<AgentTeamMemberId>): void;
    /** Drop one key entirely — the success path after a committed send. */
    clear(key: TeamDraftKey): void;
    /** Test seam: forget everything, including what localStorage still holds. */
    reset(): void;
    /** Re-read persisted content — what a fresh page load starts from. */
    reload(): void;
    private write;
    private evict;
}
export { STORAGE_KEY as TEAM_DRAFTS_STORAGE_KEY };
//# sourceMappingURL=drafts.d.ts.map