/**
 * THROWAWAY probe for ticket 03 — Phase 0 gauge ⑥ re-run ("changes version and
 * phantom refresh") on the frozen ledger through the assembled service.
 *
 *   mkdir -p /tmp/t03 && gunzip -c artifacts/team-perf/frozen-ledger-11695ops.sqlite.gz > /tmp/t03/run.sqlite
 *   BENCH_DB=/tmp/t03/run.sqlite npx vitest run packages/agent-team/tests/zz-p0-changes.spec.ts
 *
 * Copy in, run, delete. Not type-clean on purpose; never committed.
 */
import { describe, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam from '../src/index.ts'
import * as agentTeamInvariant from '../src/invariant.ts'

const DB = process.env.BENCH_DB ?? '/tmp/t03/run.sqlite'
const WS = WorkspaceId(process.env.BENCH_WS ?? '40459c33-743d-4030-9e50-9419d72abe06')

async function boot(): Promise<{ ctx: any, dispose: () => Promise<void> }> {
  const ctx: any = new Context()
  await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path: DB, journalMode: 'wal' })
  ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: { agent_team: 'sqlite' } })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', {
    get: (id: WorkspaceId) => id === WS
      ? { id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} }
      : undefined,
    list: () => [{ id: WS, path: process.cwd() }],
  })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') }, list: () => [] })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  await ctx.plugin(InvariantRegistry)
  const fiber = await ctx.plugin(AgentTeam)
  await ctx.plugin(agentTeamInvariant)
  return { ctx, dispose: async () => { await fiber.dispose(); await facility.closeAll?.(); await ctx.stop?.() } }
}

/** Count how many of ten stale-version clients are answered immediately. */
async function staleProbe(service: any, afterVersion: number, samples = 10): Promise<{ immediate: number, medianMs: number }> {
  const latencies: number[] = []
  for (let index = 0; index < samples; index += 1) {
    const controller = new AbortController()
    const start = performance.now()
    const settled = await Promise.race([
      service.changes({ afterVersion }, controller.signal).then(() => true, () => true),
      new Promise(resolve => setTimeout(() => resolve(false), 20)),
    ])
    if (settled === true) latencies.push(performance.now() - start)
    controller.abort()
  }
  latencies.sort((left, right) => left - right)
  const median = latencies.length === 0 ? null : Number(latencies[Math.floor(latencies.length / 2)]!.toFixed(3))
  return { immediate: latencies.length, medianMs: median as unknown as number }
}

async function staysPending(promise: Promise<unknown>, ms = 20): Promise<boolean> {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  await new Promise(resolve => setTimeout(resolve, ms))
  return !settled
}

describe('phase 0 gauge 6 re-run', () => {
  it('measures phantom refresh around a committing private read', async () => {
    const { ctx, dispose } = await boot()
    const service: any = ctx.agentTeam

    const inbox = service.inbox({ workspaceId: WS, limit: 50 })
    const unread = (inbox.items ?? []).filter((item: any) => item.unreadCount > 0)
    if (unread.length < 2) throw new Error(`probe needs two unread Threads in ${WS}, found ${unread.length}`)

    const readOne = async (index: number): Promise<{ threadRef: string, committed: boolean, sequence: number | null }> => {
      const threadRef = unread[index].thread.threadRef
      const result = await service.readThread({ requestId: `zz-p0-changes-${index}`, workspaceId: WS, threadRef })
      const ledger = (service as any).ledger
      const operation = result.receipt === undefined ? undefined : ledger.getOperation(result.receipt.operationId)
      return { threadRef, committed: result.receipt !== undefined, sequence: operation?.sequence ?? null }
    }

    const baseline = (await service.changes({ afterVersion: 0 })).version
    const first = unread[0].thread.threadRef
    const parked = {
      global: service.changes({ afterVersion: baseline }),
      thread: service.changes({ afterVersion: baseline, scope: { kind: 'thread', threadRef: first } }),
      presence: service.changes({ afterVersion: baseline, scope: { kind: 'presence', workspaceId: WS } }),
    }
    const parkedBefore = {
      global: await staysPending(parked.global),
      thread: await staysPending(parked.thread),
      presence: await staysPending(parked.presence),
    }

    const readA = await readOne(0)
    const afterRead = (await service.changes({ afterVersion: 0 })).version
    const parkedWoke = {
      global: !(await staysPending(parked.global)),
      thread: !(await staysPending(parked.thread)),
      presence: !(await staysPending(parked.presence)),
    }
    const passOne = await staleProbe(service, baseline)

    // Second pass: another committing private read on a Thread that still has
    // unread facts for the Human, then the same ten stale-version probes.
    const readB = await readOne(1)
    const second = await staleProbe(service, afterRead)

    // Long-poll timeout arm: park a waiter at the current version, commit one
    // more committing private read while it is parked, then let the 25 s Host
    // timeout answer it. A larger late version is what makes the Client
    // refresh on a timeout it never needed.
    const timeoutBaseline = (await service.changes({ afterVersion: 0 })).version
    const timeoutWaiter = service.changes({ afterVersion: timeoutBaseline })
    const readC = unread.length > 2 ? await readOne(2) : { committed: false, sequence: null }
    const timeoutStart = performance.now()
    const late = await timeoutWaiter
    const timeoutMs = Number((performance.now() - timeoutStart).toFixed(0))

    console.log('P0_CHANGES ' + JSON.stringify({
      baseline,
      unreadThreads: unread.length,
      committedReads: [readA.committed, readB.committed, readC.committed],
      readSequences: [readA.sequence, readB.sequence, readC.sequence],
      versionBumpsForOneRead: afterRead - baseline,
      parkedBefore,
      parkedWoke,
      instantAnswersOf10: passOne.immediate,
      medianParkMs: passOne.medianMs,
      phantomRefreshesSecondPass: second.immediate,
    }))
    console.log('P0_CHANGES_TIMEOUT ' + JSON.stringify({
      baseline: timeoutBaseline, afterRead: (await service.changes({ afterVersion: 0 })).version,
      bumpedByPrivateRead: (await service.changes({ afterVersion: 0 })).version - timeoutBaseline,
      lateVersion: late.version, timeoutMs,
    }))
    await dispose()
  }, 900_000)
})
