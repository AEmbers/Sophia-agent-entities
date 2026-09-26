/**
 * The DAG approval backend's host wiring.
 *
 * The orchestration facade calls `backend.create(this, request)` — it passes
 * *itself*, and the facade carries no team state. The host therefore hands
 * `{ captain, stateRoot }` over through the `hostContext` provider, read fresh
 * on every call. Without that provider the backend throws on `create` (and
 * degrades on `describe`/`list`), which is exactly how every owner approval
 * used to fail: the request stayed `pending_owner` and the card showed a bare
 * HTTP 500. These tests pin the wiring so it cannot silently come undone.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalRequest, MaterializeResult } from 'dsh-sophia-entities/orchestration'
import { createSophiaDagBackend, sophiaDagBackendFor } from '../src/sophia-dag-backend.ts'
import { writeTeam } from '../src/state.ts'
import type { AgentTeamsRuntime } from '../src/tools.ts'
import type { TeamState } from '../src/types.ts'

/** A captain stand-in: the backend only reads it to hand to `materializePlan`. */
const CAPTAIN = { session: { header: { cwd: 'C:/workspace' } } } as unknown as Agent
const OTHER_CAPTAIN = { session: { header: { cwd: 'C:/elsewhere' } } } as unknown as Agent

function request(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'req-1',
    requester: 'human',
    goal: 'Polish the activity panel',
    plan: { members: [], tasks: [] },
    state: 'pending_owner',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as ApprovalRequest
}

/** A `materializePlan` stub that records what the backend handed it. */
function stubRuntime(): {
  runtime: AgentTeamsRuntime
  calls: Array<{ captain: unknown; stateRoot: string; teamId: string; teamName: string }>
} {
  const calls: Array<{ captain: unknown; stateRoot: string; teamId: string; teamName: string }> = []
  const materializePlan = vi.fn(async (captain: Agent, input: { stateRoot: string; teamId: string; teamName: string }) => {
    calls.push({ captain, ...input })
    return { teamId: input.teamId } as never
  })
  return { runtime: { materializePlan } as unknown as AgentTeamsRuntime, calls }
}

const temps: string[] = []
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sophia-dag-backend-'))
  temps.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('createSophiaDagBackend host wiring', () => {
  it('materializes through the captain and state root the host supplies', async () => {
    const { runtime, calls } = stubRuntime()
    const stateRoot = tempRoot()
    const backend = createSophiaDagBackend({ materializePlan: runtime.materializePlan, hostContext: () => ({ captain: CAPTAIN, stateRoot }) })

    // The facade passes itself; it carries neither field.
    const result = await backend.create({}, request())

    expect(calls).toHaveLength(1)
    expect(calls[0]?.captain).toBe(CAPTAIN)
    expect(calls[0]?.stateRoot).toBe(stateRoot)
    expect(result.teamRef).toBe(calls[0]?.teamId)
    expect(result.mode).toBe('dag')
  })

  it('reads the provider fresh on every call, so binding a captain later works', async () => {
    const { runtime, calls } = stubRuntime()
    const stateRoot = tempRoot()
    let host: { captain?: Agent; stateRoot: string } = { stateRoot }
    const backend = createSophiaDagBackend({ materializePlan: runtime.materializePlan, hostContext: () => host })

    // No captain yet: the deciding session has not been bound.
    await expect(backend.create({}, request())).rejects.toThrow('ctx.captain is required')

    host = { stateRoot, captain: CAPTAIN }
    await backend.create({}, request())
    expect(calls[0]?.captain).toBe(CAPTAIN)
  })

  it('lets fields on the passed ctx win over the provider', async () => {
    const { runtime, calls } = stubRuntime()
    const providerRoot = tempRoot()
    const passedRoot = tempRoot()
    const backend = createSophiaDagBackend({ materializePlan: runtime.materializePlan, hostContext: () => ({ captain: CAPTAIN, stateRoot: providerRoot }) })

    await backend.create({ captain: OTHER_CAPTAIN, stateRoot: passedRoot }, request())

    expect(calls[0]?.captain).toBe(OTHER_CAPTAIN)
    expect(calls[0]?.stateRoot).toBe(passedRoot)
  })

  it('throws loudly when the host never supplies a captain or a state root', async () => {
    const { runtime } = stubRuntime()
    const bare = createSophiaDagBackend({ materializePlan: runtime.materializePlan })

    await expect(bare.create({}, request())).rejects.toThrow('dag backend create: ctx.captain is required — the host must pass the captain agent')
    await expect(bare.create({ captain: CAPTAIN }, request())).rejects.toThrow('dag backend create: ctx.stateRoot is required — the host must pass the team state root')
    await expect(bare.create({}, request({ goal: '   ' }))).rejects.toThrow('ctx.captain is required')
  })

  it('derives the team identity from the approved goal, capped like the persistent backend', async () => {
    const { runtime, calls } = stubRuntime()
    const backend = createSophiaDagBackend({ materializePlan: runtime.materializePlan, hostContext: () => ({ captain: CAPTAIN, stateRoot: tempRoot() }) })

    await backend.create({}, request({ goal: 'x'.repeat(200) }))

    expect(calls[0]?.teamName).toHaveLength(80)
    expect(calls[0]?.teamId).toMatch(/^[a-z0-9-]+$/)
  })

  it('finds a committed team through the provider state root', async () => {
    const { runtime } = stubRuntime()
    const stateRoot = tempRoot()
    const team: TeamState = {
      name: 'Polish the activity panel',
      id: 'polish-the-activity-panel',
      captainSessionId: 'session-1',
      createdAt: 1,
      members: [],
      tasks: [],
      taskSeq: 0,
    }
    await mkdirSync(join(stateRoot, team.id), { recursive: true })
    await writeTeam(stateRoot, team)
    const backend = createSophiaDagBackend({ materializePlan: runtime.materializePlan, hostContext: () => ({ captain: CAPTAIN, stateRoot }) })

    const described = await backend.describe({}, team.id)
    expect(described?.teamId).toBe(team.id)
    expect(described?.mode).toBe('dag')

    const listed = await backend.list({})
    expect(listed.map((entry) => entry.teamId)).toEqual([team.id])
  })

  it('degrades to no teams when the host has no state root yet', async () => {
    const { runtime } = stubRuntime()
    const backend = createSophiaDagBackend({ materializePlan: runtime.materializePlan, hostContext: () => ({ captain: CAPTAIN }) })

    expect(await backend.describe({}, 'anything')).toBeUndefined()
    expect(await backend.list({})).toEqual([])
  })

  it('forwards the provider through sophiaDagBackendFor', async () => {
    const { runtime, calls } = stubRuntime()
    const stateRoot = tempRoot()
    const backend = sophiaDagBackendFor(runtime, () => ({ captain: CAPTAIN, stateRoot }))

    const result: MaterializeResult = await backend.create({}, request())
    expect(calls[0]?.stateRoot).toBe(stateRoot)
    expect(result.teamRef).toBeDefined()
  })
})
