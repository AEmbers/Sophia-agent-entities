import type { TeamBackend } from 'dsh-sophia-entities/orchestration';
import type { AgentTeamsRuntime } from './tools.ts';
/**
 * Create the DAG backend bound to one dag-team materialization runtime.
 *
 * The backend itself is stateless: every call reads the team from disk via
 * `readTeamSync` and writes through `deps.materializePlan`.
 */
export declare function createSophiaDagBackend(deps: {
    materializePlan: AgentTeamsRuntime['materializePlan'];
}): TeamBackend;
/**
 * Convenience binding for hosts (agent-team) that already hold the dag-team
 * runtime: pre-wires `createSophiaDagBackend` with the runtime's
 * `materializePlan`, so wiring never touches the tools registry. Re-exported
 * from the dag-team package index.
 */
export declare function sophiaDagBackendFor(runtime: AgentTeamsRuntime): TeamBackend;
//# sourceMappingURL=sophia-dag-backend.d.ts.map