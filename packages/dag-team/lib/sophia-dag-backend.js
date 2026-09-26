import { readdirSync } from 'node:fs';
import { readTeamSync, sanitizeKey } from "./state.js";
/** Display-name budget for the materialized team (mirrors the persistent backend). */
const TEAM_NAME_MAX = 80;
/** Truncate by code points so surrogate pairs (emoji) are never split. */
function truncateText(text, max) {
    const points = [...text];
    return points.length <= max ? text : points.slice(0, max).join('');
}
/** Extract the host-provided state root; absent/invalid → undefined. */
function hostStateRoot(ctx) {
    const host = (ctx ?? {});
    const stateRoot = host.stateRoot;
    return typeof stateRoot === 'string' && stateRoot !== '' ? stateRoot : undefined;
}
/**
 * Create the DAG backend bound to one dag-team materialization runtime.
 *
 * The backend itself is stateless: every call reads the team from disk via
 * `readTeamSync` and writes through `deps.materializePlan`.
 */
export function createSophiaDagBackend(deps) {
    return Object.freeze({
        mode: 'dag',
        async create(ctx, request) {
            const host = (ctx ?? {});
            const captain = host.captain;
            if (captain === undefined) {
                throw new Error('dag backend create: ctx.captain is required — the host must pass the captain agent');
            }
            const stateRoot = hostStateRoot(ctx);
            if (stateRoot === undefined) {
                throw new Error('dag backend create: ctx.stateRoot is required — the host must pass the team state root');
            }
            const goal = typeof request.goal === 'string' ? request.goal.trim() : '';
            const teamName = truncateText(goal === '' ? 'Materialized approval plan' : goal, TEAM_NAME_MAX);
            const teamId = sanitizeKey(teamName);
            const result = await deps.materializePlan(captain, {
                stateRoot,
                teamId,
                teamName,
                goal,
                plan: request.plan,
            });
            return Object.freeze({
                mode: 'dag',
                teamRef: result.teamId,
                teamName,
                detail: `dag team materialized from approval '${request.id}'`,
            });
        },
        async describe(ctx, teamRef) {
            const stateRoot = hostStateRoot(ctx);
            if (stateRoot === undefined)
                return undefined;
            const team = readTeamSync(stateRoot, teamRef);
            if (team === undefined)
                return undefined;
            return Object.freeze({
                mode: 'dag',
                teamId: team.id,
                name: team.name,
                captainSessionId: team.captainSessionId,
                memberCount: team.members.length,
                taskCount: team.tasks.length,
                createdAt: team.createdAt,
            });
        },
        async list(ctx) {
            const stateRoot = hostStateRoot(ctx);
            if (stateRoot === undefined)
                return [];
            let dirNames = [];
            try {
                dirNames = readdirSync(stateRoot, { withFileTypes: true })
                    .filter((entry) => entry.isDirectory())
                    .map((entry) => entry.name);
            }
            catch {
                // Vanished/unreadable state root: no teams.
                return [];
            }
            const teams = [];
            for (const dirName of dirNames) {
                // A team dir is `<stateRoot>/<teamId>/team.json`; malformed records are
                // skipped (readTeamSync throws on invalid JSON, not only ENOENT).
                let team;
                try {
                    team = readTeamSync(stateRoot, dirName);
                }
                catch {
                    continue;
                }
                if (team !== undefined) {
                    teams.push(Object.freeze({
                        mode: 'dag',
                        teamId: team.id,
                        name: team.name,
                        captainSessionId: team.captainSessionId,
                        memberCount: team.members.length,
                        taskCount: team.tasks.length,
                        createdAt: team.createdAt,
                    }));
                }
            }
            return teams;
        },
    });
}
/**
 * Convenience binding for hosts (agent-team) that already hold the dag-team
 * runtime: pre-wires `createSophiaDagBackend` with the runtime's
 * `materializePlan`, so wiring never touches the tools registry. Re-exported
 * from the dag-team package index.
 */
export function sophiaDagBackendFor(runtime) {
    return createSophiaDagBackend({ materializePlan: runtime.materializePlan });
}
