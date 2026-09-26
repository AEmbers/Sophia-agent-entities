/** Read the approval queue. */
export async function snapshotApprovals(facade) {
    const requests = await facade.pendingApprovals();
    return {
        requests: requests.map((request) => ({
            id: request.id,
            goal: request.goal,
            requester: request.requester.kind === 'human'
                ? 'human'
                : (request.requester.handle ?? request.requester.memberId ?? 'member'),
            mode: request.mode,
            state: request.state,
            createdAt: request.createdAt,
            expiresAt: request.expiresAt,
        })),
    };
}
/** Dispatch one plan action with the caller identity resolved by the host. */
export async function runApprovalPlanAction(facade, caller, action) {
    switch (action.action) {
        case 'set_mode': {
            if (!action.mode)
                throw new Error('set_mode requires mode');
            const result = await facade.setMode(caller, action.requestId, action.mode);
            return { request_id: result.request.id, state: result.request.state, mode: result.request.mode };
        }
        case 'approve': {
            if (action.decision !== 'approve' && action.decision !== 'reject') {
                throw new Error('approve action requires decision approve|reject');
            }
            const result = await facade.approve(caller, action.requestId, {
                decision: action.decision,
                mode: action.mode,
            });
            return {
                request_id: result.request.id,
                state: result.request.state,
                mode: result.request.mode,
                materialized: result.materialized ? true : undefined,
                team_ref: result.materialized?.teamRef,
            };
        }
        case 'reject': {
            const result = await facade.approve(caller, action.requestId, { decision: 'reject' });
            return { request_id: result.request.id, state: result.request.state };
        }
        case 'review': {
            const verdicts = ['approve_dag', 'approve_persistent', 'downgrade_to_dag', 'reject'];
            if (action.decision === undefined || !verdicts.includes(action.decision)) {
                throw new Error('review action requires decision approve_dag|approve_persistent|downgrade_to_dag|reject');
            }
            const result = await facade.review(caller, action.requestId, {
                decision: action.decision,
                reason: action.reason ?? '',
            });
            return {
                request_id: result.request.id,
                state: result.request.state,
                materialized: result.materialized ? true : undefined,
                team_ref: result.materialized?.teamRef,
            };
        }
        default: {
            throw new Error(`unknown approval plan action: ${action.action}`);
        }
    }
}
