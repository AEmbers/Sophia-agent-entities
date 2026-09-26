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
 * `ctx` is host-provided and duck-typed. The orchestration facade passes
 * *itself* as `ctx` (`backend.create(this, request)`), so the host must extend
 * the facade with `{ captain, stateRoot, config }` before materialization;
 * `describe`/`list` only need `{ stateRoot }`. `create` throws loudly when
 * `captain`/`stateRoot` are absent (host wiring bug, not a silent no-op);
 * `describe`/`list` degrade to `undefined`/`[]` without a state root.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readdirSync } from 'node:fs'
import type {
  ApprovalRequest,
  MaterializeResult,
  TeamBackend,
  TeamSummary,
} from 'dsh-sophia-entities/orchestration'
import { readTeamSync, sanitizeKey } from './state.ts'
import type { AgentTeamsRuntime } from './tools.ts'

/** Display-name budget for the materialized team (mirrors the persistent backend). */
const TEAM_NAME_MAX = 80

/** Truncate by code points so surrogate pairs (emoji) are never split. */
function truncateText(text: string, max: number): string {
  const points = [...text]
  return points.length <= max ? text : points.slice(0, max).join('')
}

/** Duck-typed host context expected on the orchestration facade. */
interface SophiaDagHostContext {
  captain?: Agent
  stateRoot?: string
  config?: { memberModel?: string }
}

/** Extract the host-provided state root; absent/invalid → undefined. */
function hostStateRoot(ctx: unknown): string | undefined {
  const host = (ctx ?? {}) as SophiaDagHostContext
  const stateRoot = host.stateRoot
  return typeof stateRoot === 'string' && stateRoot !== '' ? stateRoot : undefined
}

/**
 * Create the DAG backend bound to one dag-team materialization runtime.
 *
 * The backend itself is stateless: every call reads the team from disk via
 * `readTeamSync` and writes through `deps.materializePlan`.
 */
export function createSophiaDagBackend(deps: {
  materializePlan: AgentTeamsRuntime['materializePlan']
}): TeamBackend {
  return Object.freeze({
    mode: 'dag' as const,

    async create(ctx: unknown, request: ApprovalRequest): Promise<MaterializeResult> {
      const host = (ctx ?? {}) as SophiaDagHostContext
      const captain = host.captain
      if (captain === undefined) {
        throw new Error('dag backend create: ctx.captain is required — the host must pass the captain agent')
      }
      const stateRoot = hostStateRoot(ctx)
      if (stateRoot === undefined) {
        throw new Error('dag backend create: ctx.stateRoot is required — the host must pass the team state root')
      }
      const goal = typeof request.goal === 'string' ? request.goal.trim() : ''
      const teamName = truncateText(goal === '' ? 'Materialized approval plan' : goal, TEAM_NAME_MAX)
      const teamId = sanitizeKey(teamName)
      const result = await deps.materializePlan(captain, {
        stateRoot,
        teamId,
        teamName,
        goal,
        plan: request.plan,
      })
      return Object.freeze({
        mode: 'dag' as const,
        teamRef: result.teamId,
        teamName,
        detail: `dag team materialized from approval '${request.id}'`,
      })
    },

    async describe(ctx: unknown, teamRef: string): Promise<TeamSummary | undefined> {
      const stateRoot = hostStateRoot(ctx)
      if (stateRoot === undefined) return undefined
      const team = readTeamSync(stateRoot, teamRef)
      if (team === undefined) return undefined
      return Object.freeze({
        mode: 'dag' as const,
        teamId: team.id,
        name: team.name,
        captainSessionId: team.captainSessionId,
        memberCount: team.members.length,
        taskCount: team.tasks.length,
        createdAt: team.createdAt,
      })
    },

    async list(ctx: unknown): Promise<TeamSummary[]> {
      const stateRoot = hostStateRoot(ctx)
      if (stateRoot === undefined) return []
      let dirNames: string[] = []
      try {
        dirNames = readdirSync(stateRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch {
        // Vanished/unreadable state root: no teams.
        return []
      }
      const teams: TeamSummary[] = []
      for (const dirName of dirNames) {
        // A team dir is `<stateRoot>/<teamId>/team.json`; malformed records are
        // skipped (readTeamSync throws on invalid JSON, not only ENOENT).
        let team
        try {
          team = readTeamSync(stateRoot, dirName)
        } catch {
          continue
        }
        if (team !== undefined) {
          teams.push(Object.freeze({
            mode: 'dag' as const,
            teamId: team.id,
            name: team.name,
            captainSessionId: team.captainSessionId,
            memberCount: team.members.length,
            taskCount: team.tasks.length,
            createdAt: team.createdAt,
          }))
        }
      }
      return teams
    },
  })
}

/**
 * Convenience binding for hosts (agent-team) that already hold the dag-team
 * runtime: pre-wires `createSophiaDagBackend` with the runtime's
 * `materializePlan`, so wiring never touches the tools registry. Re-exported
 * from the dag-team package index.
 */
export function sophiaDagBackendFor(runtime: AgentTeamsRuntime): TeamBackend {
  return createSophiaDagBackend({ materializePlan: runtime.materializePlan })
}