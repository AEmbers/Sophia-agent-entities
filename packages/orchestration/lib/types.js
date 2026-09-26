/**
 * Approval orchestration domain model (design §4.1.1).
 *
 * The orchestration layer is a thin, dependency-free approval plane that sits
 * ABOVE the two team backends (the persistent ledger-backed teams and the DAG
 * subagent teams). It owns the approval queue as an independent truth: requests
 * are stored under `<workspace>/.sophia-entities/approvals/<id>.json`, parallel
 * to — and un-transactionally separate from — either backend's state directory
 * (design §4.1.2). Materialization is the ONLY crossing point into a backend.
 */
/** Stable hash of a proposal, used to dedupe identical goals (§4.8 point 4). */
export function proposalKey(goal, plan) {
    const memberKey = plan.members
        .map((m) => `${m.name}:${m.role ?? ''}:${m.provider ?? ''}:${m.model ?? ''}`)
        .join('|');
    const taskKey = plan.tasks
        .map((t) => `${t.id}:${t.assignee ?? ''}:${t.dependencies.join(',')}`)
        .join('|');
    return `${goal}\u0000${memberKey}\u0000${taskKey}`;
}
