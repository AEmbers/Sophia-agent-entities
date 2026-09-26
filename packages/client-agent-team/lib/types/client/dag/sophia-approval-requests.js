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
 */
export async function postApprovalPlanAction(payload) {
    const response = await fetch(APPROVALS_PLAN_URL, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
