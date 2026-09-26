/**
 * Pending-approval badge state (P4.2, design §4.6 channel 3 / dev-plan:190).
 *
 * The client is a leaf: durable truth lives on the Node side, so the badge
 * polls the host `GET /plugins/dsh-sophia-entities/approvals` snapshot and
 * counts the requests that demand the Human owner's attention. We surface the
 * count plus the states so the footer action can decide wording; the badge is
 * rendered only when the count is non-zero (§4.2 acceptance: '有 pending_owner
 * 时徽标计数 > 0').
 * @module dsh-sophia-entities/client/sophia-approval-badge
 */
/** GET target mirroring the card's POST plan route (orchestration routes.ts). */
export declare const APPROVALS_STATE_URL = "/plugins/dsh-sophia-entities/approvals";
/** Live-poll cadence for the badge. Matches the activity monitor's hot loop. */
export declare const APPROVAL_POLL_MS = 5000;
/** One row of the host ApprovalsSnapshot (routes.ts ApprovalsSnapshot). */
export interface SophiaApprovalSnapshotRow {
    readonly id: string;
    readonly goal: string;
    readonly requester: string;
    readonly mode?: string;
    readonly state: string;
    readonly createdAt: number;
    readonly expiresAt?: number;
}
/**
 * The state the badge reacts to. Present-day orchestration keeps proposals in
 * `pending_captain` then `pending_owner`; both are in-flight approvals the
 * Human should see. `draft` is excluded — it is not yet routed to anyone.
 */
export declare const APPROVAL_BADGE_STATES: ReadonlySet<string>;
/**
 * Count the rows that belong in the badge, and report the states present so a
 * caller can tailor copy. `aggregateApprovalSnapshot(undefined)` returns an
 * empty aggregate (a failed/absent poll must not summon a phantom badge).
 */
export interface SophiaApprovalAggregate {
    readonly count: number;
    readonly states: readonly string[];
}
/** Fold a raw ApprovalsSnapshot body into the badge aggregate. */
export declare function aggregateApprovalSnapshot(body: {
    readonly requests?: unknown;
} | null | undefined): SophiaApprovalAggregate;
/** Optional seams for pull an isolated vitest bench. */
export interface ApprovalBadgeRuntime {
    fetchState?: (url: string, init?: RequestInit) => Promise<Response>;
    schedule?: (callback: () => void, intervalMs: number) => unknown;
    cancel?: (timer: unknown) => void;
}
/**
 * Start the badge polling loop. Notifies the subscriber with the latest
 * aggregate on every tick; a failed poll keeps the previous snapshot (host
 * restarting) and retries on the next tick, so the badge never flickers away
 * mid-restart-only to appear when the host answers.
 */
export interface ApprovalBadgeController {
    readonly firstTick: Promise<void>;
    stop: () => void;
    isCancelled: () => boolean;
}
export declare function startApprovalBadgePolling(subscriber: (aggregate: SophiaApprovalAggregate) => void, runtime?: ApprovalBadgeRuntime): ApprovalBadgeController;
//# sourceMappingURL=sophia-approval-badge.d.ts.map