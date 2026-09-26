/**
 * Approval HTTP surface (design §4.9, web-routes.ts:71 authenticated routes).
 *
 * P2/S3 expose the two read/write endpoints the cards and badge poll:
 *   GET  /plugins/dsh-sophia-entities/approvals          → queue snapshot
 *   POST /plugins/dsh-sophia-entities/approvals/plan     → set_mode / approve / reject / review
 *
 * Registration is a plain function so the host decides the exact raw server
 * wiring (mirroring the dag-team registerWebSurface pattern); P2 keeps the
 * handler shapes but the host attaches them with the cards in P3.
 */
import type { SophiaTeamFacade, CallerIdentity } from './facade.ts';
/** Approvals queue snapshot for the badge/cards. */
export interface ApprovalsSnapshot {
    requests: Array<{
        id: string;
        goal: string;
        requester: string;
        mode?: string;
        state: string;
        createdAt: number;
        expiresAt?: number;
    }>;
}
export interface ApprovalPlanAction {
    action: 'set_mode' | 'approve' | 'reject' | 'review';
    requestId: string;
    /** set_mode / approve. */
    mode?: 'persistent' | 'dag';
    /** approve / reject / review. */
    decision?: 'approve_dag' | 'approve_persistent' | 'downgrade_to_dag' | 'reject' | 'approve' | 'reject';
    /** review. */
    reason?: string;
}
/** Read the approval queue. */
export declare function snapshotApprovals(facade: SophiaTeamFacade): Promise<ApprovalsSnapshot>;
/** Dispatch one plan action with the caller identity resolved by the host. */
export declare function runApprovalPlanAction(facade: SophiaTeamFacade, caller: CallerIdentity, action: ApprovalPlanAction): Promise<unknown>;
//# sourceMappingURL=routes.d.ts.map