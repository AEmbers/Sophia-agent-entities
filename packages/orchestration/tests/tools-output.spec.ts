/**
 * Regression (P2.3): every approval tool output must be lossless JSON.
 *
 * The host snapshots a tool result before the model may see it, and a value
 * that cannot survive `JSON.parse(JSON.stringify(value))` is rejected whole
 * with "value is not lossless JSON". A key that is present but `undefined` is
 * exactly that, and every optional key in these three outputs is optional on
 * the ordinary path — so the tools failed on every plain call while the
 * facade-level P2 tests stayed green. Assert the boundary directly: no
 * `undefined` value may reach a tool result.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerApprovalTools } from '../src/tools.ts'
import { SophiaTeamFacade, type CallerIdentity } from '../src/facade.ts'
import type {
  ApprovalPlan,
  MaterializeResult,
  TeamBackend,
  TeamSummary,
} from '../src/types.ts'

// -- fixtures ---------------------------------------------------------------

let workspace: string
const now = 1_700_000_000_000

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sophia-tools-'))
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const plan: ApprovalPlan = {
  members: [{ name: 'alice', role: 'verifier' }, { name: 'bob' }],
  tasks: [{ id: 't1', subject: 'check', assignee: 'alice', dependencies: [] }],
}

const human: CallerIdentity = { isHuman: true }
const captain: CallerIdentity = { isHuman: false, sessionId: 'captain-1', handle: 'captain', teamId: 'team-1' }
const member: CallerIdentity = { isHuman: false, sessionId: 'member-1', handle: 'member-1', teamId: 'team-1' }

/** One registered definition, narrowed to what these tests drive. */
interface CapturedTool {
  name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

function fakeBackend(): TeamBackend {
  const summaries: TeamSummary[] = []
  return {
    mode: 'dag',
    async create(_ctx, request) {
      const result: MaterializeResult = { mode: 'dag', teamRef: 'team-1', teamName: 'Team One' }
      summaries.push({
        mode: 'dag',
        teamId: result.teamRef,
        name: result.teamName ?? result.teamRef,
        captainSessionId: 'captain-1',
        memberCount: request.plan.members.length,
        taskCount: request.plan.tasks.length,
        createdAt: now,
      })
      return result
    },
    async describe(_ctx, teamRef) {
      return summaries.find((summary) => summary.teamId === teamRef)
    },
    async list() {
      return summaries
    },
  }
}

function makeTools(options: { caller?: CallerIdentity; backend?: TeamBackend } = {}) {
  const facade = new SophiaTeamFacade({
    workspace,
    host: {
      workingDirectory: workspace,
      captainOf: async () => 'captain-1',
      depthOf: async () => 0,
      maxTeamDepth: 2,
    },
    dagBackend: options.backend,
    now: () => now,
    notify: async () => undefined,
  })
  const registered: CapturedTool[] = []
  let caller = options.caller ?? human
  registerApprovalTools(
    { tools: { register: (tool: unknown) => { registered.push(tool as CapturedTool) } } },
    { facade, resolveCaller: async () => caller },
  )
  const run = async (name: string, args: unknown): Promise<Record<string, unknown>> => {
    const tool = registered.find((candidate) => candidate.name === name)
    if (tool === undefined) throw new Error(`tool ${name} was not registered`)
    return await tool.execute(args, {}) as Record<string, unknown>
  }
  return {
    facade,
    run,
    asCaller: (next: CallerIdentity) => { caller = next },
  }
}

/** Keys the host's lossless-JSON snapshot would reject. */
function undefinedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).filter((key) => value[key] === undefined)
}

// -- the boundary -----------------------------------------------------------

describe('P2.3 tool outputs are lossless JSON', () => {
  it('propose without a mode or plan omits the optional keys', async () => {
    const tools = makeTools()
    const output = await tools.run('sophia_team_propose', { goal: 'smoke' })
    expect(undefinedKeys(output)).toEqual([])
    expect(output['state']).toBe('pending_owner')
    expect(output['requester']).toBe('human')
    expect(Object.keys(output)).not.toContain('mode')
    expect(Object.keys(output)).not.toContain('duplicate')
  })

  it('propose keeps a supplied mode and reports a duplicate', async () => {
    const tools = makeTools()
    const first = await tools.run('sophia_team_propose', { goal: 'same', mode: 'dag', plan })
    expect(undefinedKeys(first)).toEqual([])
    expect(first['mode']).toBe('dag')
    const second = await tools.run('sophia_team_propose', { goal: 'same', mode: 'dag', plan })
    expect(undefinedKeys(second)).toEqual([])
    expect(second['duplicate']).toBe(true)
  })

  it('a member proposal with a mode waits on its captain', async () => {
    const tools = makeTools({ caller: member })
    const output = await tools.run('sophia_team_propose', { goal: 'from a member', mode: 'dag', plan })
    expect(undefinedKeys(output)).toEqual([])
    expect(output['requester']).toBe('member-1')
    expect(output['state']).toBe('pending_captain')
  })

  it('review without materialization omits materialized and team keys', async () => {
    const tools = makeTools({ caller: member })
    const proposed = await tools.run('sophia_team_propose', { goal: 'g', mode: 'dag', plan })
    tools.asCaller(captain)
    const output = await tools.run('sophia_team_review', {
      request_id: String(proposed['request_id']),
      decision: 'reject',
    })
    expect(undefinedKeys(output)).toEqual([])
    expect(Object.keys(output)).not.toContain('materialized')
    expect(Object.keys(output)).not.toContain('team_ref')
    expect(Object.keys(output)).not.toContain('team_name')
  })

  it('review that materializes carries the live team ref', async () => {
    const tools = makeTools({ caller: member, backend: fakeBackend() })
    const proposed = await tools.run('sophia_team_propose', { goal: 'g', mode: 'dag', plan })
    tools.asCaller(captain)
    const output = await tools.run('sophia_team_review', {
      request_id: String(proposed['request_id']),
      decision: 'approve_dag',
    })
    expect(undefinedKeys(output)).toEqual([])
    expect(output['materialized']).toBe(true)
    expect(output['team_ref']).toBe('team-1')
    expect(output['team_name']).toBe('Team One')
  })

  it('approve that rejects omits every materialization key', async () => {
    const tools = makeTools()
    const proposed = await tools.run('sophia_team_propose', { goal: 'g', mode: 'dag', plan })
    const output = await tools.run('sophia_team_approve', {
      request_id: String(proposed['request_id']),
      decision: 'reject',
    })
    expect(undefinedKeys(output)).toEqual([])
    expect(Object.keys(output)).not.toContain('materialized')
    expect(Object.keys(output)).not.toContain('team_ref')
  })

  it('approve that materializes omits nothing the schema declares', async () => {
    const tools = makeTools({ backend: fakeBackend() })
    const proposed = await tools.run('sophia_team_propose', { goal: 'g', plan })
    const output = await tools.run('sophia_team_approve', {
      request_id: String(proposed['request_id']),
      decision: 'approve',
      mode: 'dag',
    })
    expect(undefinedKeys(output)).toEqual([])
    expect(output['materialized']).toBe(true)
    expect(output['mode']).toBe('dag')
  })
})
