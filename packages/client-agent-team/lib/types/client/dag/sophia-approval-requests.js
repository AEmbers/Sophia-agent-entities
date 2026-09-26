/**
 * Host routes for the Sophia approval card. The client is a leaf — durable
 * truth lives on the Node side, so every interaction posts the full action
 * record and lets the host settle the state; local UI never guesses.
 * @module dsh-sophia-entities/client/sophia-approval-requests
 */
import { APPROVALS_STATE_URL } from "./sophia-approval-badge.js";
/** POST body target for approval-plan actions (design §4.4.2 / routes.ts). */
export const APPROVALS_PLAN_URL = '/plugins/dsh-sophia-entities/approvals/plan';
/** Fold the host's snake_case result body into the card's result shape. */
function parsePlanResult(body) {
    if (typeof body !== 'object' || body === null)
        return undefined;
    const raw = body;
    const result = {};
    if (typeof raw['request_id'] === 'string')
        result.requestId = raw['request_id'];
    if (typeof raw['state'] === 'string')
        result.state = raw['state'];
    if (raw['mode'] === 'persistent' || raw['mode'] === 'dag')
        result.mode = raw['mode'];
    if (raw['materialized'] === true)
        result.materialized = true;
    if (typeof raw['team_ref'] === 'string')
        result.teamRef = raw['team_ref'];
    return result;
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
    if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
            const body = await response.json();
            if (typeof body.error === 'string' && body.error.trim() !== '')
                message = body.error;
        }
        catch { }
        throw new Error(message);
    }
    try {
        return parsePlanResult(await response.json());
    }
    catch {
        return undefined;
    }
}
/**
 * Read the live queue and report what it says about `requestId`. The card is
 * rendered from immutable conversation records, so a request decided earlier —
 * by this card, by the captain, or from another paired device — stays
 * "pending" in the transcript forever. This is how the card learns otherwise.
 */
export async function fetchApprovalRequestState(requestId) {
    if (requestId.trim() === '')
        return undefined;
    try {
        const response = await fetch(APPROVALS_STATE_URL, { cache: 'no-store' });
        if (!response.ok)
            return undefined;
        const body = await response.json();
        if (typeof body !== 'object' || body === null || !Array.isArray(body.requests))
            return undefined;
        for (const row of body.requests) {
            if (typeof row !== 'object' || row === null)
                continue;
            const entry = row;
            if (entry.id !== requestId)
                continue;
            if (typeof entry.state !== 'string')
                return undefined;
            return typeof entry.mode === 'string'
                ? { kind: 'state', state: entry.state, mode: entry.mode }
                : { kind: 'state', state: entry.state };
        }
        return 'absent';
    }
    catch {
        return undefined;
    }
}
/** Normalize an unknown thrown value into a displayable message. */
export function approvalErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
