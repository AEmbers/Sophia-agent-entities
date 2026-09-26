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
export const APPROVALS_STATE_URL = '/plugins/dsh-sophia-entities/approvals';
/** Live-poll cadence for the badge. Matches the activity monitor's hot loop. */
export const APPROVAL_POLL_MS = 5000;
/**
 * The state the badge reacts to. Present-day orchestration keeps proposals in
 * `pending_captain` then `pending_owner`; both are in-flight approvals the
 * Human should see. `draft` is excluded — it is not yet routed to anyone.
 */
export const APPROVAL_BADGE_STATES = new Set([
    'pending_owner',
    'pending_captain',
]);
/** Fold a raw ApprovalsSnapshot body into the badge aggregate. */
export function aggregateApprovalSnapshot(body) {
    if (body === null || body === undefined)
        return { count: 0, states: [] };
    if (!Array.isArray(body.requests))
        return { count: 0, states: [] };
    const states = new Set();
    let count = 0;
    for (const row of body.requests) {
        if (typeof row !== 'object' || row === null)
            continue;
        const state = row.state;
        if (typeof state !== 'string' || !APPROVAL_BADGE_STATES.has(state))
            continue;
        states.add(state);
        count += 1;
    }
    return { count, states: [...states].sort() };
}
export function startApprovalBadgePolling(subscriber, runtime = {}) {
    const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init));
    const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs));
    const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer); });
    let cancelled = false;
    let inFlight = false;
    let timer;
    let controller;
    const tick = async () => {
        if (inFlight || cancelled)
            return;
        inFlight = true;
        controller = new AbortController();
        try {
            const response = await fetchState(APPROVALS_STATE_URL, {
                cache: 'no-store',
                signal: controller.signal,
            });
            if (cancelled)
                return;
            if (!response.ok)
                throw new Error('Approvals unavailable');
            const body = (await response.json());
            if (cancelled)
                return;
            subscriber(aggregateApprovalSnapshot(body));
        }
        catch (error) {
            if (error?.name === 'AbortError')
                return;
            // Host restarting; keep the last snapshot and retry on the next tick.
        }
        finally {
            inFlight = false;
        }
    };
    const firstTick = tick();
    if (timer === undefined)
        timer = schedule(() => { void tick(); }, APPROVAL_POLL_MS);
    return {
        firstTick,
        stop: () => {
            if (cancelled)
                return;
            cancelled = true;
            controller?.abort();
            cancel(timer);
        },
        isCancelled: () => cancelled,
    };
}
