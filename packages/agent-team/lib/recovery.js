const TRANSIENT_NETWORK_PATTERNS = [/fetch failed/i, /econnreset/i, /etimedout/i, /socket hang up/i];
const RATE_LIMIT_PATTERNS = [/\b429\b/, /rate limit/i, /\b503\b/, /overloaded/i];
export function classifyRecoverableError(message) {
    if (RATE_LIMIT_PATTERNS.some(pattern => pattern.test(message)))
        return 'rate limiting';
    if (TRANSIENT_NETWORK_PATTERNS.some(pattern => pattern.test(message)))
        return 'transient network';
    return undefined;
}
export const RECOVERY_DELAY_MS = 120_000;
export const RECOVERY_MAX_CONSECUTIVE_ERRORS = 3;
/**
 * Per-member automatic recovery episodes. An episode is every recoverable
 * `agent/error` occurrence until a clean turn end, regardless of error text
 * or family. Each of the first two occurrences schedules its own wakeup.
 */
export class RecoveryCoordinator {
    episodes = new Map();
    wake;
    onStandDown;
    delayMs;
    maxConsecutiveErrors;
    constructor(options) {
        this.wake = options.wake;
        this.onStandDown = options.onStandDown;
        this.delayMs = options.delayMs ?? RECOVERY_DELAY_MS;
        this.maxConsecutiveErrors = options.maxConsecutiveErrors ?? RECOVERY_MAX_CONSECUTIVE_ERRORS;
    }
    /** Observe one `agent/error` occurrence for a Member. */
    onError(memberId, errorMessage) {
        if (classifyRecoverableError(errorMessage) === undefined) {
            // A non-recoverable failure cancels anything pending: retrying cannot help.
            this.stopTracking(memberId);
            return;
        }
        let episode = this.episodes.get(memberId);
        if (episode === undefined) {
            episode = { consecutiveFailures: 0, timers: new Set() };
            this.episodes.set(memberId, episode);
        }
        if (episode.stoodDown === true)
            return;
        episode.consecutiveFailures += 1;
        if (episode.consecutiveFailures >= this.maxConsecutiveErrors) {
            this.cancelTimers(episode);
            episode.stoodDown = true;
            this.onStandDown?.(memberId, episode.consecutiveFailures);
            return;
        }
        const timer = setTimeout(() => {
            episode.timers.delete(timer);
            try {
                this.wake(memberId);
            }
            catch {
                this.stopTracking(memberId);
            }
        }, this.delayMs);
        episode.timers.add(timer);
    }
    /** A turn ended cleanly (running→idle without an error): the episode is over. */
    onCleanTurnEnd(memberId) {
        this.stopTracking(memberId);
    }
    stopTracking(memberId) {
        const episode = this.episodes.get(memberId);
        if (episode === undefined)
            return;
        this.cancelTimers(episode);
        this.episodes.delete(memberId);
    }
    dispose() {
        for (const episode of this.episodes.values())
            this.cancelTimers(episode);
        this.episodes.clear();
    }
    cancelTimers(episode) {
        for (const timer of episode.timers)
            clearTimeout(timer);
        episode.timers.clear();
    }
}
