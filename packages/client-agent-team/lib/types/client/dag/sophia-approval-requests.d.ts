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
 * What the host answered for one plan action (`routes.ts` runApprovalPlanAction
 * returns `{request_id, state, mode, materialized, team_ref}`). `state` is the
 * settlement: the card reads it to stop offering buttons for a request that is
 * no longer awaiting a decision, instead of leaving the card pending forever
 * and answering the next click with "is not awaiting owner decision".
 */
export interface SophiaApprovalPlanResult {
    readonly requestId?: string;
    readonly state?: string;
    readonly mode?: TeamMode;
    readonly materialized?: boolean;
    readonly teamRef?: string;
}
/**
 * Fire one approval-plan action at the host. Mirrors the AgentTeams plan
 * mutation fetch (`mutatePlan`): posts JSON, throws with the host's error
 * message (or an HTTP status) on any non-ok response.
 *
 * `sessionId` is the session the card is rendered in, and it is REQUIRED: the
 * host route authenticates the browser as the human operator but still refuses
 * the action with 400 `sessionId is required` (or 409 `human session is not
 * attached`) unless the owning session id rides in the body. Omitting it made
 * every owner interaction — approve, reject, and the mode switch — fail with no
 * visible effect.
 *
 * The resolved value is the host's own verdict. An ok response whose body is
 * empty or unreadable resolves to `undefined` (the action still succeeded).
 */
export declare function postApprovalPlanAction(sessionId: string, payload: SophiaApprovalPlanAction): Promise<SophiaApprovalPlanResult | undefined>;
/**
 * What the live pending queue says about one request.
 *
 *  - `{kind:'state'}` — the request is still queued, with this state (and mode).
 *  - `'absent'` — the snapshot answered and the request is NOT in it, so it was
 *    decided (approved, rejected or expired) after the card was rendered.
 *  - `undefined` — the snapshot could not be read (host restarting); the card
 *    must not conclude anything from a failed poll.
 */
export type ApprovalLiveState = {
    readonly kind: 'state';
    readonly state: string;
    readonly mode?: string;
} | 'absent' | undefined;
/**
 * Read the live queue and report what it says about `requestId`. The card is
 * rendered from immutable conversation records, so a request decided earlier —
 * by this card, by the captain, or from another paired device — stays
 * "pending" in the transcript forever. This is how the card learns otherwise.
 */
export declare function fetchApprovalRequestState(requestId: string): Promise<ApprovalLiveState>;
/** Normalize an unknown thrown value into a displayable message. */
export declare function approvalErrorMessage(error: unknown): string;
//# sourceMappingURL=sophia-approval-requests.d.ts.map