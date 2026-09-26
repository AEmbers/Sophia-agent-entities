/**
 * Best-effort Host-side check for a newer published bundle release.
 *
 * The settings footnote needs `updateAvailable`/`latestVersion`, but the
 * profile read path must never wait on the network: the checker serves a
 * cached snapshot synchronously and refreshes it in the background. Every
 * failure mode — disabled by the operator, no fetch implementation, timeout,
 * non-OK status, malformed payload, unparsable version — settles as "no
 * update known", so the footnote degrades to version + link exactly as before.
 *
 * No durable state: the cache lives only in memory. A Host restart simply
 * starts unknown again, which is the safe default for an informational tip.
 */
/** Public npm metadata document for the bundle's `latest` dist-tag. */
export declare const HUMAN_UPDATE_CHECK_REGISTRY_URL = "https://registry.npmjs.org/dsh-sophia-entities/latest";
/** How long one settled check stays authoritative before a re-check. */
export declare const HUMAN_UPDATE_CHECK_TTL_MS: number;
/** Upper bound for one registry round trip; the read path never waits on it. */
export declare const HUMAN_UPDATE_CHECK_TIMEOUT_MS = 5000;
/** Setting this env var to `0`/`false`/`off` disables the outbound check. */
export declare const HUMAN_UPDATE_CHECK_ENV = "DSH_AGENT_TEAM_UPDATE_CHECK";
/** Minimal fetch surface the check needs; the global fetch satisfies it. */
export interface UpdateCheckFetcher {
    (url: string, init: {
        readonly signal: AbortSignal;
    }): Promise<{
        readonly ok: boolean;
        json(): Promise<unknown>;
    }>;
}
/** Operator kill-switch; anything but an explicit off value keeps the default on. */
export declare function isUpdateCheckEnabled(env?: {
    readonly [key: string]: string | undefined;
}): boolean;
/**
 * Numeric core of a `major.minor.patch…` version. Pre-release/build suffixes
 * are ignored for ordering; anything else unparsable resolves absent so the
 * caller treats it as "no update known" instead of guessing.
 */
export declare function parseVersionCore(value: string): readonly number[] | undefined;
/** True when `latest` orders strictly after `current` on the numeric core. */
export declare function isNewerVersion(current: string, latest: string): boolean;
/**
 * One registry round trip resolving the published `latest` version string.
 * Never throws: anything unexpected resolves absent.
 */
export declare function fetchLatestVersion(fetchImpl: UpdateCheckFetcher, url?: string, timeoutMs?: number): Promise<string | undefined>;
export interface HumanUpdateCheckerOptions {
    readonly currentVersion: string;
    readonly fetchImpl?: UpdateCheckFetcher | undefined;
    readonly now?: (() => number) | undefined;
    readonly ttlMs?: number | undefined;
    readonly timeoutMs?: number | undefined;
    readonly env?: {
        readonly [key: string]: string | undefined;
    } | undefined;
}
export interface HumanUpdateSnapshot {
    readonly updateAvailable: boolean;
    readonly latestVersion?: string | undefined;
}
/**
 * Synchronous snapshot over a background-refreshed latest-version cache.
 * `snapshot()` never blocks: a stale or empty cache serves the last known
 * value (initially "no update") and kicks off at most one shared refresh.
 * Concurrent and repeated calls while a refresh is in flight share it, and a
 * refresh that settles only stamps the cache — failures simply leave the
 * previous value standing.
 */
export declare function createHumanUpdateChecker(options: HumanUpdateCheckerOptions): {
    readonly snapshot: () => HumanUpdateSnapshot;
};
//# sourceMappingURL=human-update-check.d.ts.map