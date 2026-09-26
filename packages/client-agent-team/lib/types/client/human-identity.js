import { useSyncExternalStore } from 'react';
const INITIAL = { status: 'loading', updateAvailable: false };
export class TeamHumanIdentity {
    snapshot = INITIAL;
    listeners = new Set();
    reading;
    loader;
    constructor(loader) {
        this.loader = loader;
    }
    getSnapshot = () => this.snapshot;
    /**
     * Observe the identity, starting the first read when nobody has read yet.
     * @param listener - invoked after every snapshot replacement.
     * @returns the disposer removing this listener.
     */
    subscribe = (listener) => {
        this.listeners.add(listener);
        if (this.snapshot.status === 'loading' && this.reading === undefined)
            void this.refresh();
        return () => { this.listeners.delete(listener); };
    };
    /**
     * Re-read the Host projection. Concurrent callers share one round trip, and a
     * failed refresh keeps the last accepted value beside the reported error —
     * the seats never blank out because a background read failed.
     * @returns settlement of this read (or of the read already in flight).
     */
    refresh() {
        if (this.reading !== undefined)
            return this.reading;
        const reading = this.read().finally(() => {
            if (this.reading === reading)
                this.reading = undefined;
        });
        this.reading = reading;
        return reading;
    }
    dispose() {
        this.listeners.clear();
    }
    async read() {
        let profile;
        try {
            const result = await this.loader.loadProfile();
            if (!result.ok) {
                this.fail(result.error.message);
                return;
            }
            profile = result.value;
        }
        catch (error) {
            // A dropped connection surfaces as a thrown carrier error, not a result:
            // both are read failures and both keep whatever value already stands.
            this.fail(error instanceof Error ? error.message : String(error));
            return;
        }
        // Bytes are immutable per reference, so one fetch serves every later
        // refresh that still carries the same avatar.
        const avatarUrl = profile.avatarRef === undefined
            ? undefined
            : profile.avatarRef === this.snapshot.avatarRef && this.snapshot.avatarUrl !== undefined
                ? this.snapshot.avatarUrl
                : (await this.loader.loadAvatarUrl(profile.avatarRef)) ?? undefined;
        this.commit({
            status: 'ready',
            name: profile.name,
            ...(profile.avatarRef === undefined ? {} : { avatarRef: profile.avatarRef }),
            ...(avatarUrl === undefined ? {} : { avatarUrl }),
            version: profile.version,
            repoUrl: profile.repoUrl,
            updateAvailable: profile.updateAvailable,
            ...(profile.latestVersion === undefined ? {} : { latestVersion: profile.latestVersion }),
        });
    }
    /**
     * Record one read failure. A value that was already accepted stays on screen
     * (the seats never blank out over a background read), and only an identity
     * that never loaded becomes `unavailable` — the state that offers a retry.
     */
    fail(message) {
        const held = this.snapshot;
        this.commit(held.name === undefined
            ? { ...held, status: 'unavailable', error: message }
            : { ...held, status: 'ready', error: message });
    }
    commit(snapshot) {
        this.snapshot = snapshot;
        for (const listener of this.listeners)
            listener();
    }
}
/** Subscribe one rendered seat to the identity. */
export function useHumanIdentity(identity) {
    return useSyncExternalStore(identity.subscribe, identity.getSnapshot, identity.getSnapshot);
}
