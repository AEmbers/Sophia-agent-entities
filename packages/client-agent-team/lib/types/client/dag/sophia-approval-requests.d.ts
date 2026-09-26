/**
 * Host routes for the Sophia approval card. The client is a leaf — durable
 * truth lives on the Node side, so every interaction posts the full action
 * record and lets the host settle the state; local UI never guesses.
 * @module dsh-sophia-entities/client/sophia-approval-requests
 */
import type { TeamMode } from 'dsh-sophia-entities/orchestration/types';
/** POST body target for approval-plan actions (design §4.4.2 / routes.ts). */
export declare const APPROVALS_PLAN_URL = "/plugins/dsh-sophia-entities/approvals/plan";
/** A captain-side verdict for a pending_captain proposal. */
export type CaptainVerdict = 'approve_dag' | 'approve_persistent' | 'downgrade_to_dag' | 'reject';
/**
 * Mirror of the host `ApprovalPlanAction` shape. The host's `approve` case
 * requires `decision ∈ {approve,reject}`, so the owner approval carries an
 * explicit decision; a plain reject is its own action.
 */
export type SophiaApprovalPlanAction = {
    readonly action: 'set_mode';
    readonly requestId: string;
    readonly mode: TeamMode;
} | {
    readonly action: 'approve';
    readonly requestId: string;
    readonly decision: 'approve' | 'reject';
    readonly mode?: TeamMode;
} | {
    readonly action: 'reject';
    readonly requestId: string;
} | {
    readonly action: 'review';
    readonly requestId: string;
    readonly decision: CaptainVerdict;
    readonly reason?: string;
};
/**
 * Fire one approval-plan action at the host. Mirrors the AgentTeams plan
 * mutation fetch (`mutatePlan`): posts JSON, throws with the host's error
 * message (or an HTTP status) on any non-ok response.
 */
export declare function postApprovalPlanAction(payload: SophiaApprovalPlanAction): Promise<void>;
/** Normalize an unknown thrown value into a displayable message. */
export declare function approvalErrorMessage(error: unknown): string;
//# sourceMappingURL=sophia-approval-requests.d.ts.map