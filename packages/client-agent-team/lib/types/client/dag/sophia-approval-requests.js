/**
 * Host routes for the Sophia approval card. The client is a leaf — durable
 * truth lives on the Node side, so every interaction posts the full action
 * record and lets the host settle the state; local UI never guesses.
 * @module dsh-sophia-entities/client/sophia-approval-requests
 */
/** POST body target for approval-plan actions (design §4.4.2 / routes.ts). */
export const APPROVALS_PLAN_URL = '/plugins/dsh-sophia-entities/approvals/plan';
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
 */
export async function postApprovalPlanAction(sessionId, payload) {
    const owner = sessionId.trim();
    if (owner === '')
        throw new Error('approval actions require the viewing session id');
    const response = await fetch(APPROVALS_PLAN_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, sessionId: owner }),
    });
    if (response.ok)
        return;
    let message = `HTTP ${response.status}`;
    try {
        const body = await response.json();
        if (typeof body.error === 'string' && body.error.trim() !== '')
            message = body.error;
    }
    catch { }
    throw new Error(message);
}
/** Normalize an unknown thrown value into a displayable message. */
export function approvalErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
