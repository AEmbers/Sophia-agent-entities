import type { AgentTeamMemberId } from './types.ts';
/**
 * Error families the automatic recovery may act on, matched by conservative
 * string signatures. Anything unclassifiable — including context-overflow and
 * auth failures, where retrying is pointless or harmful — stays manual.
 */
export type RecoverableErrorKind = 'transient network' | 'rate limiting';
export declare function classifyRecoverableError(message: string): RecoverableErrorKind | undefined;
export interface RecoveryCoordinatorOptions {
    /** Performs a delayed recovery wakeup; throwing means the Member is gone and tracking stops. */
    readonly wake: (memberId: AgentTeamMemberId) => void;
    /** Called once when an episode reaches its failure limit and tracking stands down. */
    readonly onStandDown?: (memberId: AgentTeamMemberId, consecutiveFailures: number) => void;
    /** Delay between a recoverable error and its automatic recovery wakeup. */
    readonly delayMs?: number;
    /** Consecutive recoverable errors allowed before automatic recovery stands down. */
    readonly maxConsecutiveErrors?: number;
}
export declare const RECOVERY_DELAY_MS = 120000;
export declare const RECOVERY_MAX_CONSECUTIVE_ERRORS = 3;
/**
 * Per-member automatic recovery episodes. An episode is every recoverable
 * `agent/error` occurrence until a clean turn end, regardless of error text
 * or family. Each of the first two occurrences schedules its own wakeup.
 */
export declare class RecoveryCoordinator {
    private readonly episodes;
    private readonly wake;
    private readonly onStandDown;
    private readonly delayMs;
    private readonly maxConsecutiveErrors;
    constructor(options: RecoveryCoordinatorOptions);
    /** Observe one `agent/error` occurrence for a Member. */
    onError(memberId: AgentTeamMemberId, errorMessage: string): void;
    /** A turn ended cleanly (running→idle without an error): the episode is over. */
    onCleanTurnEnd(memberId: AgentTeamMemberId): void;
    stopTracking(memberId: AgentTeamMemberId): void;
    dispose(): void;
    private cancelTimers;
}
//# sourceMappingURL=recovery.d.ts.map