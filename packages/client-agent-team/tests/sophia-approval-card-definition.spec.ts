import { describe, expect, it } from 'vitest'
import { parseSophiaProposeArgs } from '../src/client/dag/sophia-approval-card-definition.ts'

/** The `sophia_team_propose` arguments JSON the Host records on `tool/call`. */
function args(plan: Record<string, unknown>, goal = 'Ship the release'): string {
  return JSON.stringify({ goal, mode: 'dag', plan })
}

describe('parseSophiaProposeArgs', () => {
  it('reads the goal, mode, roster and the task graph', () => {
    const parsed = parseSophiaProposeArgs(args({
      members: [{ name: 'smoke-verifier', role: 'verifier' }, { name: 'smoke-reviewer', role: 'reviewer' }],
      tasks: [
        { id: 'v1', subject: 'Verify the artifact', dependencies: [] },
        { id: 'v2', subject: 'Review the evidence', dependencies: ['v1'] },
      ],
    }))
    expect(parsed).toEqual({
      goal: 'Ship the release',
      mode: 'dag',
      members: [{ name: 'smoke-verifier', role: 'verifier' }, { name: 'smoke-reviewer', role: 'reviewer' }],
      tasks: [
        { id: 'v1', subject: 'Verify the artifact', dependsOn: [] },
        { id: 'v2', subject: 'Review the evidence', dependsOn: ['v1'] },
      ],
      taskCount: 2,
      dependencyCount: 1,
    })
  })

  it('keeps a task row per named task and still counts the ones it cannot name', () => {
    const parsed = parseSophiaProposeArgs(args({
      tasks: [
        { subject: 'No id, so no row', dependencies: ['v1'] },
        { id: '   ', subject: 'Blank id', dependencies: [] },
        { id: 'v2', dependencies: ['v1', 'v0'] },
      ],
    }))
    expect(parsed?.tasks).toEqual([{ id: 'v2', subject: '', dependsOn: ['v1', 'v0'] }])
    // The counts stay honest about the whole plan, rows or not.
    expect(parsed?.taskCount).toBe(3)
    expect(parsed?.dependencyCount).toBe(3)
  })

  it('drops non-string dependency entries instead of trusting the shape', () => {
    const parsed = parseSophiaProposeArgs(args({
      tasks: [{ id: 'v1', subject: 'x', dependencies: ['v0', 7, null, { id: 'v9' }] }],
    }))
    expect(parsed?.tasks).toEqual([{ id: 'v1', subject: 'x', dependsOn: ['v0'] }])
    expect(parsed?.dependencyCount).toBe(1)
  })

  it('reports an empty plan rather than failing', () => {
    expect(parseSophiaProposeArgs(JSON.stringify({ goal: 'Only a goal' })))
      .toEqual({ goal: 'Only a goal', mode: undefined, members: [], tasks: [], taskCount: 0, dependencyCount: 0 })
    expect(parseSophiaProposeArgs(args({ members: 'not a list', tasks: 'not a list' }))?.tasks).toEqual([])
  })

  it('rejects anything without a usable goal', () => {
    expect(parseSophiaProposeArgs('not json')).toBeUndefined()
    expect(parseSophiaProposeArgs(JSON.stringify({ goal: '   ' }))).toBeUndefined()
    expect(parseSophiaProposeArgs(JSON.stringify({ goal: 42 }))).toBeUndefined()
  })
})
