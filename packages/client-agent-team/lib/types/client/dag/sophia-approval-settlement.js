/**
 * When a folded proposal stops awaiting a decision.
 *
 * A Sophia approval card is folded from immutable conversation records, so the
 * `state` baked into the transcript is whatever the propose tool reported —
 * `pending_owner` — and it stays that way forever. The card therefore decides
 * for itself whether the request is still live, from two sources:
 *
 *  1. the verdict the host returned for the action just fired
 *     (`POST /approvals/plan` answers `{state, mode, …}`), and
 *  2. one reconciliation against the live pending queue on mount
 *     (`GET /approvals`, which carries only requests still awaiting a decision).
 *
 * Without this a decided proposal kept rendering [批准][退回], and every further
 * click came back "is not awaiting owner decision" — buttons that look broken
 * because the first click worked and said nothing.
 *
 * A state that is still pending is NOT a settlement: switching the team mode
 * leaves the request awaiting a decision, so the controls must stay.
 * @module dsh-sophia-entities/client/sophia-approval-settlement
 */
import { PENDING_STATES } from "./sophia-approval-card-definition.js";
/**
 * Fold the action verdict and the live queue into a settlement, or `undefined`
 * while the request still awaits a decision. The verdict wins when present —
 * it is the response to the click that just happened.
 */
export function settlementOf(resultState, live) {
    if (resultState !== undefined) {
        return PENDING_STATES.has(resultState) ? undefined : { state: resultState };
    }
    if (live === 'absent')
        return 'gone';
    if (live !== undefined && !PENDING_STATES.has(live.state))
        return { state: live.state };
    return undefined;
}
/** Map a settlement onto its wording; an unknown state falls back to itself. */
export function settlementLabelOf(settlement) {
    if (settlement === 'gone')
        return { key: 'approval.settled.gone' };
    switch (settlement.state) {
        case 'approved': return { key: 'approval.settled.approved' };
        case 'rejected': return { key: 'approval.settled.rejected' };
        case 'materialized': return { key: 'approval.settled.materialized' };
        default: return { key: 'approval.settled.other', state: settlement.state };
    }
}
