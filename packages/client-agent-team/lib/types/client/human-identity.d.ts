import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { AgentTeamHumanProfileResult } from 'dsh-sophia-entities/types';
/**
 * The Client's one projection of the Human identity.
 *
 * The durable facts live in the Host: the display name and the avatar
 * reference in the Team Host row's own Config, the avatar bytes in the
 * persistent avatar store. This store is the only place the Team Client reads
 * them, so every seat that names or draws the Human — message rows, member
 * refs, mention chips, the settings page — shows one rename and one face, and a
 * single refresh after a write moves all of them together. Writes go back
 * through the Host's `setHumanProfile` Remote, which owns the profile entry the
 * Client would otherwise have to name.
 *
 * Seats render before the first read settles; `name` stays undefined until then
 * and every caller falls back to its own localized name for the Human. Reads
 * are demand-driven: the first subscriber starts the read, so a Client that
 * never opens Team mode or the profile page never calls the Remote.
 */
/** One read of the Human identity, replaced wholesale on every change. */
export interface TeamHumanIdentitySnapshot {
    /**
     * `loading` until the first read settles, `ready` while an accepted value
     * stands (also when a later refresh failed), `unavailable` when no value was
     * ever accepted — the one state that hands the page a retry.
     */
    readonly status: 'loading' | 'ready' | 'unavailable';
    /** Host-resolved display name; undefined before the first accepted read. */
    readonly name?: string | undefined;
    /** Configured avatar reference; undefined means the identity fallback is the avatar. */
    readonly avatarRef?: string | undefined;
    /** Avatar bytes as a data URL for `<img>`; undefined renders the fallback. */
    readonly avatarUrl?: string | undefined;
    /** Bundle version for the settings footnote. */
    readonly version?: string | undefined;
    /** Repository home the footnote links to. */
    readonly repoUrl?: string | undefined;
    readonly updateAvailable: boolean;
    readonly latestVersion?: string | undefined;
    /** Last failure, kept beside the last accepted value so a page can report it. */
    readonly error?: string | undefined;
}
/** Read-side face every consumer binds: the seats' hook and the settings page alike. */
export interface TeamHumanIdentitySource {
    getSnapshot(): TeamHumanIdentitySnapshot;
    subscribe(listener: () => void): () => void;
}
/** The settings page's extra face: re-read after a failed or superseded read. */
export interface TeamHumanIdentityFace extends TeamHumanIdentitySource {
    refresh(): Promise<void>;
}
/** Host calls the store reads through; one loader per Client context. */
export interface TeamHumanIdentityLoader {
    loadProfile: () => Promise<RemoteResult<AgentTeamHumanProfileResult>>;
    /** Resolve one avatar reference to a displayable URL; null falls back to the initial. */
    loadAvatarUrl: (avatarRef: string) => Promise<string | null>;
}
export declare class TeamHumanIdentity implements TeamHumanIdentityFace {
    private snapshot;
    private readonly listeners;
    private reading;
    private readonly loader;
    constructor(loader: TeamHumanIdentityLoader);
    readonly getSnapshot: () => TeamHumanIdentitySnapshot;
    /**
     * Observe the identity, starting the first read when nobody has read yet.
     * @param listener - invoked after every snapshot replacement.
     * @returns the disposer removing this listener.
     */
    readonly subscribe: (listener: () => void) => (() => void);
    /**
     * Re-read the Host projection. Concurrent callers share one round trip, and a
     * failed refresh keeps the last accepted value beside the reported error —
     * the seats never blank out because a background read failed.
     * @returns settlement of this read (or of the read already in flight).
     */
    refresh(): Promise<void>;
    dispose(): void;
    private read;
    /**
     * Record one read failure. A value that was already accepted stays on screen
     * (the seats never blank out over a background read), and only an identity
     * that never loaded becomes `unavailable` — the state that offers a retry.
     */
    private fail;
    private commit;
}
/** Subscribe one rendered seat to the identity. */
export declare function useHumanIdentity(identity: TeamHumanIdentitySource): TeamHumanIdentitySnapshot;
//# sourceMappingURL=human-identity.d.ts.map