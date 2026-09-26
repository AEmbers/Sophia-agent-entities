/**
 * DAG (subagent task-team) backend for the orchestration approval plane.
 *
 * `createSophiaDagBackend` builds the `TeamBackend` that materializes an
 * owner-approved plan into a dag-team *running* team: one team.json committed
 * under the host-provided state root (members/tasks written un-staged, no
 * planReviewState) and the team kicked so the scheduler dispatches ready
 * tasks. Where the persistent backend commits through the ledger with the
 * Human actor, this backend commits through the dag-team runtime's
 * `materializePlan` — the approval-flow-driven equivalent of
 * `agent_teams_create` with `approval=automatic`.
 *
 * `teamRef` is the team's id (`team.json`'s id). The ApprovalRequest carries
 * no team name, so teamName/teamId are derived from the approved goal per
 * dag-team conventions (name budget capped like the persistent backend,
 * `teamId = sanitizeKey(teamName)`).
 *
 * `ctx` is host-provided and duck-typed: the orchestration facade passes
 * *itself* (`backend.create(this, request)`), and the facade carries no team
 * state of its own. The host therefore hands `{ captain, stateRoot, config }`
 * over through the `hostContext` provider below, read fresh on every call —
 * the state root follows the captain's workspace and the captain is only known
 * once a session actually decides. Fields present on the passed `ctx` win over
 * the provider's. `create` throws loudly when `captain`/`stateRoot` are absent
 * (host wiring bug, not a silent no-op); `describe`/`list` degrade to
 * `undefined`/`[]` without a state root.
 */
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { TeamBackend } from 'dsh-sophia-entities/orchestration';
import type { AgentTeamsRuntime } from './tools.ts';
/** Duck-typed host context expected on the orchestration facade. */
interface SophiaDagHostContext {
    captain?: Agent;
    stateRoot?: string;
    config?: {
        memberModel?: string;
    };
}
/**
 * Create the DAG backend bound to one dag-team materialization runtime.
 *
 * The backend itself is stateless: every call reads the team from disk via
 * `readTeamSync` and writes through `deps.materializePlan`.
 *
 * `hostContext` is the host's team state (`captain` / `stateRoot` / `config`),
 * read on every call rather than captured once: the state root follows the
 * deciding session's workspace and the captain only exists after a decision.
 * Without it the backend has nothing to work with and `create` throws.
 */
export declare function createSophiaDagBackend(deps: {
    materializePlan: AgentTeamsRuntime['materializePlan'];
    hostContext?: () => SophiaDagHostContext | undefined;
}): TeamBackend;
/**
 * Convenience binding for hosts (agent-team) that already hold the dag-team
 * runtime: pre-wires `createSophiaDagBackend` with the runtime's
 * `materializePlan`, so wiring never touches the tools registry. Re-exported
 * from the dag-team package index.
 *
 * `hostContext` is the host's own team state (state root, and the captain once
 * a session decides) — the facade the backends receive cannot supply it.
 */
export declare function sophiaDagBackendFor(runtime: AgentTeamsRuntime, hostContext?: () => SophiaDagHostContext | undefined): TeamBackend;
export {};
//# sourceMappingURL=sophia-dag-backend.d.ts.map