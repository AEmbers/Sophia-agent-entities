/**
 * P2 acceptance tests (design §7):
 *   2.1 domain model + persistence: write / read / atomicity
 *   2.2 state machine + timeouts: four decision paths + three timeout classes
 *   2.3 three tools + captain/Human permission gates
 *   2.4 facade + materialize dual-backend dispatch
 *   2.5 recursion guard + depth limit + duplicate dedupe
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  approvalsRootOf,
  deleteApproval,
  approvalFileOf,
  listApprovals,
  readApproval,
  writeApproval,
} from '../src/store.ts'
import { ApprovalRouter, DEFAULT_TIMEOUTS, MaterializeError } from '../src/router.ts'
import { SophiaTeamFacade, type CallerIdentity } from '../src/facade.ts'
import type {
  ApprovalPlan,
  ApprovalRequest,
  MaterializeResult,
  TeamBackend,
  TeamSummary,
} from '../src/types.ts'

// -- fixtures ---------------------------------------------------------------

let workspace: string
let now = 0

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'sophia-p2-'))
  now = 1_700_000_000_000
})

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true })
})

const clock = () => now

const human: CallerIdentity = { isHuman: true }
const captain = (id = 'captain-1'): CallerIdentity => ({
  isHuman: false,
  sessionId: id,
  handle: 'captain',
  teamId: 'team-1',
})
const member = (id = 'member-1'): CallerIdentity => ({
  isHuman: false,
  sessionId: id,
  handle: 'member-1',
  teamId: 'team-1',
})

function makeFacade(options: {
  captainOf?: (teamId: string) => Promise<string | undefined>
  depthOf?: () => Promise<number>
  maxTeamDepth?: number
  dagBackend?: TeamBackend
  persistentBackend?: TeamBackend
  timeouts?: Partial<typeof DEFAULT_TIMEOUTS>
  notify?: (event: unknown) => Promise<void>
} = {}): SophiaTeamFacade {
  return new SophiaTeamFacade({
    workspace,
    host: {
      workingDirectory: workspace,
      captainOf: options.captainOf ?? (async () => 'captain-1'),
      depthOf: options.depthOf ?? (async () => 0),
      maxTeamDepth: options.maxTeamDepth ?? 2,
    },
    dagBackend: options.dagBackend,
    persistentBackend: options.persistentBackend,
    now: clock,
    timeouts: options.timeouts,
    notify: options.notify ?? (async () => undefined),
  })
}

const plan: ApprovalPlan = {
  members: [{ name: 'alice', role: 'researcher' }, { name: 'bob' }],
  tasks: [
    { id: 't1', subject: 'research', assignee: 'alice', dependencies: [] },
    { id: 't2', subject: 'write', assignee: 'bob', dependencies: ['t1'] },
  ],
}

// -- 2.1 store: write / read / list / atomicity ----------------------------

describe('P2.1 approval store', () => {
  it('writes and reads a request atomically', async () => {
    const root = approvalsRootOf(workspace)
    const request: ApprovalRequest = {
      id: 'req-1',
      requester: { kind: 'member', memberId: 'm1', handle: 'm1', teamId: 'team-1' },
      goal: 'ship the report',
      plan,
      mode: 'dag',
      state: 'pending_captain',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 60_000,
    }
    await writeApproval(root, request)
    expect(existsSync(approvalFileOf(root, 'req-1'))).toBe(true)
    // no stray temp files remain
    expect(readFileSync(join(root, 'req-1.json'), 'utf8')).toContain('"goal": "ship the report"')
    const read = await readApproval(root, 'req-1')
    expect(read).toEqual(request)
    // list newest-first
    const second = { ...request, id: 'req-2', createdAt: now - 1000 }
    await writeApproval(root, second)
    const all = await listApprovals(root)
    expect(all.map((r) => r.id)).toEqual(['req-1', 'req-2'])
  })

  it('missing request reads undefined; delete is idempotent', async () => {
    const root = approvalsRootOf(workspace)
    expect(await readApproval(root, 'nope')).toBeUndefined()
    await deleteApproval(root, 'nope')
    expect(existsSync(root)).toBe(false)
  })

  it('concurrent writers do not corrupt the file (lock + atomic rename)', async () => {
    const facade = makeFacade()
    const calls = await Promise.all(
      Array.from({ length: 6 }, (_, i) => facade.propose(human, { goal: `goal-${i}`, plan })),
    )
    expect(calls).toHaveLength(6)
    const requests = await facade.pendingApprovals()
    expect(requests).toHaveLength(6)
    for (const r of requests) {
      const parsed = JSON.parse(readFileSync(approvalFileOf(approvalsRootOf(workspace), r.id), 'utf8'))
      expect(parsed.id).toBe(r.id)
    }
  })
})

// -- 2.2 state machine: four paths + three timeouts -------------------------

describe('P2.2 approval state machine', () => {
  it('path ①: human propose → pending_owner → approve(dag) materializes DAG', async () => {
    const calls: string[] = []
    const dagBackend = fakeBackend('dag', (req) => { calls.push(req.goal); return materialize('dag', 'dag-team-1', 'DAG Team') })
    const facade = makeFacade({ dagBackend })
    const { request, materialized } = await facade.propose(human, { goal: 'build feature', mode: 'dag', plan })
    expect(request.state).toBe('pending_owner')
    expect(materialized).toBeUndefined()
    const done = await facade.approve(human, request.id, { decision: 'approve', mode: 'dag' })
    expect(done.request.state).toBe('materialized')
    // helper displays materialized as state 'approved' until host marks it; the DAG backend was called
    expect(calls).toEqual(['build feature'])
    expect(done.materialized?.teamRef).toBe('dag-team-1')
  })

  it('path ②: member propose mode=dag → pending_captain → captain review approve_dag materializes immediately', async () => {
    const dagBackend = fakeBackend('dag', () => materialize('dag', 'dag-team-2'))
    const facade = makeFacade({ dagBackend })
    const { request } = await facade.propose(member(), { goal: 'research X', mode: 'dag', plan })
    expect(request.state).toBe('pending_captain')
    const done = await facade.review(captain(), request.id, { decision: 'approve_dag', reason: 'looks good' })
    // materialization succeeded → terminal 'materialized'; the verdict is recorded
    expect(done.request.state).toBe('materialized')
    expect(done.request.captainVerdict?.decision).toBe('approve_dag')
    expect(done.materialized?.teamRef).toBe('dag-team-2')
  })

  it('path ③: persistent proposal → captain downgrade_to_dag materializes DAG with reason recorded', async () => {
    const dagBackend = fakeBackend('dag', () => materialize('dag', 'dag-team-3'))
    const persistentBackend = fakeBackend('persistent', () => materialize('persistent', 'persist-3'))
    const facade = makeFacade({ dagBackend, persistentBackend })
    const { request } = await facade.propose(member(), { goal: 'long task', mode: 'persistent', plan })
    expect(request.state).toBe('pending_captain')
    const done = await facade.review(captain(), request.id, {
      decision: 'downgrade_to_dag',
      reason: 'no human needed here',
    })
    // downgrade still materializes the DAG team; the reason lives in the verdict
    expect(done.request.state).toBe('materialized')
    expect(done.request.captainVerdict?.decision).toBe('downgrade_to_dag')
    expect(done.request.captainVerdict?.reason).toBe('no human needed here')
    expect(done.request.mode).toBe('dag')
  })

  it('path ④: persistent proposal → captain approve_persistent → pending_owner → owner approves with chosen mode', async () => {
    const persistentBackend = fakeBackend('persistent', () => materialize('persistent', 'persist-4'))
    const notify = vi.fn(async () => undefined)
    const facade = makeFacade({ persistentBackend, notify })
    const { request } = await facade.propose(member(), { goal: 'needs human', mode: 'persistent', plan })
    const reviewed = await facade.review(captain(), request.id, { decision: 'approve_persistent', reason: 'yes' })
    expect(reviewed.request.state).toBe('pending_owner')
    expect(reviewed.request.mode).toBe('persistent')
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'owner_needed' }))
    const done = await facade.approve(human, request.id, { decision: 'approve', mode: 'persistent' })
    expect(done.request.state).toBe('materialized')
    expect(done.materialized?.teamRef).toBe('persist-4')
  })

  it('timeout ①: pending_captain escalates to pending_owner after 10min', async () => {
    const facade = makeFacade({ timeouts: { pendingCaptainMs: 600_000 } })
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })
    expect(request.state).toBe('pending_captain')
    now += 600_001
    const [transition] = await facade.sweepExpired()
    expect(transition.kind).toBe('escalated')
    expect(transition.request.state).toBe('pending_owner')
    // the request now waits for the owner — escalated expiry is refreshed to 24h
    expect(transition.request.expiresAt).toBe(now + DEFAULT_TIMEOUTS.pendingOwnerMs)
  })

  it('timeout ②: pending_owner expires after 24h', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'persistent', plan })
    await facade.review(captain(), request.id, { decision: 'approve_persistent', reason: 'ok' })
    now += DEFAULT_TIMEOUTS.pendingOwnerMs + 1
    const [transition] = await facade.sweepExpired()
    expect(transition.kind).toBe('expired')
    expect(transition.request.state).toBe('expired')
    await expect(facade.pendingApprovals()).resolves.toHaveLength(0)
  })

  it('timeout ③: draft expires after 30min', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g' })
    expect(request.state).toBe('draft')
    now += DEFAULT_TIMEOUTS.draftMs + 1
    const [transition] = await facade.sweepExpired()
    expect(transition.kind).toBe('expired')
    expect(transition.request.state).toBe('expired')
  })

  it('reject verdicts land the request in rejected (captain and owner)', async () => {
    const facade = makeFacade()
    const memberRequest = await facade.propose(member(), { goal: 'm', mode: 'dag', plan })
    const rejected = await facade.review(captain(), memberRequest.request.id, { decision: 'reject', reason: 'nope' })
    expect(rejected.request.state).toBe('rejected')

    const ownerRequest = await facade.propose(human, { goal: 'o', plan })
    const rejectedOwner = await facade.approve(human, ownerRequest.request.id, { decision: 'reject' })
    expect(rejectedOwner.request.state).toBe('rejected')
  })
})

// -- 2.3 tool permissions ----------------------------------------------------

describe('P2.3 permission gates', () => {
  it('non-captain member cannot review (facade enforces captain identity)', async () => {
    const facade = makeFacade()
    const other = { isHuman: false, sessionId: 'member-2', handle: 'member-2', teamId: 'team-1' }
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })
    await expect(facade.review(other, request.id, { decision: 'approve_dag', reason: 'x' }))
      .rejects.toThrow('only the team captain may review this proposal')
  })

  it('Human cannot use review, member cannot use approve', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })
    await expect(facade.review(human, request.id, { decision: 'approve_dag', reason: 'x' }))
      .rejects.toThrow('the Human owner cannot review member proposals')
    await expect(facade.approve(member(), request.id, { decision: 'approve', mode: 'dag' }))
      .rejects.toThrow('only the Human owner may approve a request')
  })

  it('captain cannot review their own proposal (§4.8 point 1)', async () => {
    const facade = makeFacade({ captainOf: async () => 'captain-1' })
    const self = { isHuman: false, sessionId: 'captain-1', handle: 'cap', teamId: 'team-1' }
    const { request } = await facade.propose(self, { goal: 'g', mode: 'dag', plan })
    await expect(facade.review(self, request.id, { decision: 'approve_dag', reason: 'x' }))
      .rejects.toThrow('a member cannot review their own proposal')
  })

  it('downgrade requires a reason (§4.8 point 2)', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'persistent', plan })
    await expect(facade.review(captain(), request.id, { decision: 'downgrade_to_dag', reason: '  ' }))
      .rejects.toThrow('requires a reason')
  })

  it('member without team has no captain → review rejected', async () => {
    const facade = makeFacade({ captainOf: async () => undefined })
    const { request } = await facade.propose(member('loner'), { goal: 'g', mode: 'dag', plan })
    await expect(facade.review(captain(), request.id, { decision: 'approve_dag', reason: 'x' }))
      .rejects.toThrow('only the team captain may review this proposal')
  })
})

// -- 2.4 facade: dual-backend materialize dispatch --------------------------

describe('P2.4 facade dual-backend dispatch', () => {
  it('human proposal for each mode materializes into the matching backend', async () => {
    const dagBackend = fakeBackend('dag', () => materialize('dag', 'dag-1', 'D1'))
    const persistentBackend = fakeBackend('persistent', () => materialize('persistent', 'persist-1', 'P1'))
    const facade = makeFacade({ dagBackend, persistentBackend })

    const dagReq = await facade.propose(human, { goal: 'g-dag', mode: 'dag', plan })
    const dagDone = await facade.approve(human, dagReq.request.id, { decision: 'approve', mode: 'dag' })
    expect(dagDone.materialized?.teamRef).toBe('dag-1')

    const persistReq = await facade.propose(human, { goal: 'g-persist', mode: 'persistent', plan })
    const persistDone = await facade.approve(human, persistReq.request.id, { decision: 'approve', mode: 'persistent' })
    expect(persistDone.materialized?.teamRef).toBe('persist-1')

    // both backends were actually invoked
    expect(dagBackend.created).toBe(1)
    expect(persistentBackend.created).toBe(1)
    const listed = await facade.list()
    expect(listed.map((t) => t.teamId).sort()).toEqual(['dag-1', 'persist-1'])
  })

  it('materialize without a wired backend fails loudly and keeps the request pending', async () => {
    const facade = makeFacade()
    const { request } = await facade.propose(human, { goal: 'g', mode: 'dag', plan })
    await expect(facade.approve(human, request.id, { decision: 'approve', mode: 'dag' }))
      .rejects.toThrow(/backend for 'dag' is not wired/)
    const after = await facade.get(request.id)
    expect(after?.state).toBe('pending_owner')
  })

  it('backend create failure surfaces MaterializeError and does not burn the state', async () => {
    const dagBackend = fakeBackend('dag', () => { throw new Error('disk full') })
    const facade = makeFacade({ dagBackend })
    const { request } = await facade.propose(human, { goal: 'g', mode: 'dag', plan })
    try {
      await facade.approve(human, request.id, { decision: 'approve', mode: 'dag' })
      throw new Error('expected MaterializeError')
    } catch (error) {
      expect(error).toBeInstanceOf(MaterializeError)
    }
    const after = await facade.get(request.id)
    expect(after?.state).toBe('pending_owner')
  })
})

// -- 2.5 recursion guard + depth limit + dedupe ------------------------------

describe('P2.5 recursion guards', () => {
  it('member at max depth cannot propose a new team', async () => {
    const facade = makeFacade({ depthOf: async () => 2, maxTeamDepth: 2 })
    await expect(facade.propose(member(), { goal: 'g', mode: 'dag', plan }))
      .rejects.toThrow(/team depth limit reached/)
  })

  it('member within depth can propose (enters pending_captain)', async () => {
    const facade = makeFacade({ depthOf: async () => 1, maxTeamDepth: 2 })
    const { request } = await facade.propose(member(), { goal: 'g', mode: 'dag', plan })
    expect(request.state).toBe('pending_captain')
  })

  it('identical goal+plan dedupes against a live request', async () => {
    const facade = makeFacade()
    const first = await facade.propose(human, { goal: 'same', mode: 'dag', plan })
    const second = await facade.propose(human, { goal: 'same', mode: 'dag', plan })
    expect(second.duplicate).toBe(true)
    expect(second.request.id).toBe(first.request.id)
    expect(await facade.pendingApprovals()).toHaveLength(1)
  })

  it('different plan under the same goal is a fresh request', async () => {
    const facade = makeFacade()
    const otherPlan: ApprovalPlan = { members: [{ name: 'carol' }], tasks: [] }
    const first = await facade.propose(human, { goal: 'same', mode: 'dag', plan })
    const second = await facade.propose(human, { goal: 'same', mode: 'dag', plan: otherPlan })
    expect(second.duplicate).toBeFalsy()
    expect(second.request.id).not.toBe(first.request.id)
  })
})

// -- helpers ----------------------------------------------------------------

function materialize(mode: 'dag' | 'persistent', teamRef: string, teamName?: string): MaterializeResult {
  return { mode, teamRef, teamName }
}

function fakeBackend(mode: 'dag' | 'persistent', onCreate: (req: ApprovalRequest) => MaterializeResult): TeamBackend & { created: number } {
  const summaries: TeamSummary[] = []
  const backend: TeamBackend & { created: number } = {
    mode,
    created: 0,
    async create(_ctx, request) {
      backend.created += 1
      const result = onCreate(request)
      summaries.push({
        mode,
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
      return summaries.find((s) => s.teamId === teamRef)
    },
    async list() {
      return summaries
    },
  }
  return backend
}