/**
 * Tars' measurement probe for ticket 04 (slim `team/thread-read` records).
 *
 * Throwaway: run a copy from `packages/agent-team/tests/`, then delete the copy.
 * The source stays here beside Vera's instruments so she can reproduce or
 * replace every number with her own independent probe.
 *
 *   T04_ARM=curve  T04_DB=<sqlite>  25/50/75/100% prefix replay curve
 *   T04_ARM=boot   T04_DB=<sqlite>  real assembly boot, 3 iterations
 *   T04_ARM=append T04_DB=<sqlite>  one appended read, measured end to end
 *
 * Protocol (mirrors `findings.md` §1/§2): boot from a private copy with its
 * `-wal`/`-shm` removed; feed `validateRecords` a real record prefix, never a
 * synthetic record; report counts next to wall clock, because ±30% noise on a
 * 1.5 s boot is bigger than most of the effects under test.
 */
import { copyFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { describe, it } from 'vitest'
import AgentTeam from '../src/index.ts'
import { AgentTeamLedger, agentTeamHumanActor } from '../src/ledger.ts'
import * as agentTeamInvariant from '../src/invariant.ts'
import type { AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId, AgentTeamTaskRef, AgentTeamThreadRef } from '../src/types.ts'

const DB = process.env.T04_DB ?? '/tmp/phase0/frozen.sqlite'
const ARM = process.env.T04_ARM ?? 'curve'
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId

/** Every stored record, in sequence order — the prefix input both gauges share. */
function loadRecords(path: string): Array<[string, unknown]> {
  const db = new DatabaseSync(path, { readOnly: true })
  const rows = db.prepare('select key, value from u_agent_team_operations').all() as Array<{ key: string, value: string }>
  db.close()
  return rows.map(row => [row.key, JSON.parse(row.value)] as [string, unknown])
    .sort((left, right) => (left[1] as AgentTeamOperation).sequence - (right[1] as AgentTeamOperation).sequence)
}

function storedBytes(path: string): { readonly records: number, readonly bytes: number, readonly readBytes: number, readonly readRecords: number } {
  const db = new DatabaseSync(path, { readOnly: true })
  const rows = db.prepare('select key, value from u_agent_team_operations').all() as Array<{ key: string, value: string }>
  db.close()
  let bytes = 0
  let readBytes = 0
  let readRecords = 0
  for (const row of rows) {
    bytes += Buffer.byteLength(row.value)
    if ((JSON.parse(row.value) as AgentTeamOperation).kind === 'team/thread-read') { readBytes += Buffer.byteLength(row.value); readRecords += 1 }
  }
  return { records: rows.length, bytes, readBytes, readRecords }
}

function prefixTable(records: Array<[string, unknown]>, size: number): KvTable<AgentTeamOperationId, AgentTeamOperation> {
  const map = new Map(records.slice(0, size).map(([key, value]) => [key as AgentTeamOperationId, value as AgentTeamOperation]))
  return {
    get: key => map.get(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    size: map.size,
    put: async (key, value) => { map.set(key, value) },
    delete: async key => map.delete(key),
  }
}

function freshCopy(source: string, destination: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(destination + suffix, { force: true })
  copyFileSync(source, destination)
}

interface TeamHarness {
  readonly ctx: Context
  readonly fiber: Awaited<ReturnType<Context['plugin']>>
  readonly facility: DomainFacility
}

async function sqliteHarness(path: string): Promise<TeamHarness> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path, journalMode: 'delete' })
  ctx.storage.backend.register('sqlite', backend)
  const facility = new DomainFacility(ctx, { backend: 'sqlite', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  ctx.provide('workspaceRegistry', { get: (id: WorkspaceId) => ({ id, path: process.cwd(), attachSession: async () => {}, archiveSession: async () => {} }), list: () => [] })
  ctx.provide('agents', { create: async () => { throw new Error('unused') }, resume: async () => { throw new Error('unused') } })
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'mock', model: 'mock' }) })
  ctx.provide('agentPresets', { mount: async () => { throw new Error('unused') } })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('sessionPersistence', { list: async () => [] })
  const fiber = await ctx.plugin(AgentTeam)
  return { ctx, fiber, facility }
}

/** Count and time every full record-level replay, the constructor's included. */
function instrumentReplays(): { readonly calls: () => number, readonly ms: () => number, readonly restore: () => void } {
  const prototype = AgentTeamLedger.prototype as unknown as { validateRecords: (records: unknown) => void }
  const original = prototype.validateRecords
  let calls = 0
  let total = 0
  prototype.validateRecords = function (this: unknown, records: unknown) {
    const started = performance.now()
    try { return original.call(this, records) } finally { calls += 1; total += performance.now() - started }
  }
  return { calls: () => calls, ms: () => total, restore: () => { prototype.validateRecords = original } }
}

interface KindCost { calls: number, validateMs: number, applyMs: number }

/**
 * Attribute one replay to the record kinds that paid for it. `validate()`
 * spends its time in two per-record halves — the rule check and the scratch
 * apply — and only splitting them by kind shows whether a read record's own
 * cost fell, as opposed to the whole ledger getting smaller.
 */
function instrumentByKind(): { readonly of: (kind: string) => KindCost, readonly rows: () => Array<{ kind: string } & KindCost>, readonly restore: () => void } {
  const prototype = AgentTeamLedger.prototype as unknown as {
    validateOperation: (operation: AgentTeamOperation, projection: unknown, refs: unknown) => void
    applyTo: (target: unknown, operation: AgentTeamOperation) => void
  }
  const originalValidate = prototype.validateOperation
  const originalApply = prototype.applyTo
  const costs = new Map<string, KindCost>()
  const forKind = (kind: string): KindCost => {
    const existing = costs.get(kind)
    if (existing !== undefined) return existing
    const created = { calls: 0, validateMs: 0, applyMs: 0 }
    costs.set(kind, created)
    return created
  }
  prototype.validateOperation = function (this: unknown, operation: AgentTeamOperation, projection: unknown, refs: unknown) {
    const bucket = forKind(operation.kind)
    const started = performance.now()
    try { return originalValidate.call(this, operation, projection, refs) } finally { bucket.calls += 1; bucket.validateMs += performance.now() - started }
  }
  prototype.applyTo = function (this: unknown, target: unknown, operation: AgentTeamOperation) {
    const bucket = forKind(operation.kind)
    const started = performance.now()
    try { return originalApply.call(this, target, operation) } finally { bucket.applyMs += performance.now() - started }
  }
  return {
    of: kind => forKind(kind),
    rows: () => [...costs].map(([kind, cost]) => ({ kind, ...cost })).sort((left, right) => right.validateMs - left.validateMs),
    restore: () => { prototype.validateOperation = originalValidate; prototype.applyTo = originalApply },
  }
}

function report(key: string, payload: unknown): void {
  console.log(`${key} ${JSON.stringify(payload)}`)
}

describe('ticket 04 measurement probe', () => {
  it('measures', async () => {
    if (ARM === 'curve') {
      const records = loadRecords(DB)
      const fractions = (process.env.T04_FRACTIONS ?? '0.25,0.5,0.75,1').split(',').map(Number)
      const readCount = records.filter(([, operation]) => (operation as AgentTeamOperation).kind === 'team/thread-read').length
      const rows: unknown[] = []
      for (const fraction of fractions) {
        const size = Math.round(records.length * fraction)
        // Two constructs per point: the first warms every shared schema and
        // projection map, the second is the reading. `validate()` is timed on
        // its own so construction never hides inside it.
        new AgentTeamLedger(prefixTable(records, size))
        const constructStart = performance.now()
        const ledger = new AgentTeamLedger(prefixTable(records, size))
        const constructMs = performance.now() - constructStart
        const meter = instrumentByKind()
        const validateStart = performance.now()
        ledger.validate()
        const validateMs = performance.now() - validateStart
        const reads = meter.of('team/thread-read')
        const all = meter.rows()
        meter.restore()
        rows.push({ fraction, records: size, constructMs: Number(constructMs.toFixed(1)),
          validateMs: Number(validateMs.toFixed(1)), msPerRecord: Number((validateMs / size).toFixed(4)),
          readRecords: reads.calls, readValidateMs: Number(reads.validateMs.toFixed(1)),
          readApplyMs: Number(reads.applyMs.toFixed(1)),
          otherValidateMs: Number((all.filter(row => row.kind !== 'team/thread-read').reduce((sum, row) => sum + row.validateMs, 0)).toFixed(1)),
          topKinds: all.slice(0, 4).map(row => ({ kind: row.kind, calls: row.calls, validateMs: Number(row.validateMs.toFixed(1)) })) })
      }
      report('T04_CURVE', { db: DB, records: records.length, readRecords: readCount, rows })
      return
    }

    if (ARM === 'boot') {
      const iterations = Number(process.env.T04_ITERATIONS ?? 3)
      const arms: unknown[] = []
      for (let iteration = 1; iteration <= iterations; iteration++) {
        const copy = `${DB}.t04-boot-${process.pid}-${iteration}.sqlite`
        freshCopy(DB, copy)
        const meter = instrumentReplays()
        const started = performance.now()
        const test = await sqliteHarness(copy)
        const bootMs = performance.now() - started
        meter.restore()
        arms.push({ iteration, bootMs: Number(bootMs.toFixed(1)), replayCalls: meter.calls(),
          replayMs: Number(meter.ms().toFixed(1)), operations: test.ctx.agentTeam.status().operationCount })
        await test.fiber.dispose()
        await test.facility.closeAll()
        for (const suffix of ['', '-wal', '-shm']) rmSync(copy + suffix, { force: true })
      }
      report('T04_BOOT', { db: DB, arms })
      return
    }

    if (ARM === 'append') {
      const copy = `${DB}.t04-append-${process.pid}.sqlite`
      freshCopy(DB, copy)
      const before = storedBytes(copy)
      const test = await sqliteHarness(copy)
      const ledger = new AgentTeamLedger(test.facility.get('agent_team')!.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
      const workspaceId = firstWorkspace(ledger)
      const human = agentTeamHumanActor()
      const inbox = ledger.inbox(human, { workspaceId })
      const item = inbox.items[0]
      if (item === undefined) throw new Error('the Human has nothing unread on this ledger: nothing to append')
      const target = item.thread.taskRef === undefined
        ? { threadRef: item.thread.threadRef as AgentTeamThreadRef }
        : { taskRef: item.thread.taskRef as AgentTeamTaskRef }
      const replayBefore = (() => { const start = performance.now(); ledger.validate(); return performance.now() - start })()
      const readStart = performance.now()
      const outcome = await ledger.readThread({ requestId: requestId('t04-append'), workspaceId, ...target, actor: human })
      const readMs = performance.now() - readStart
      const replayAfter = (() => { const start = performance.now(); ledger.validate(); return performance.now() - start })()
      const after = storedBytes(copy)
      const appended = [...test.facility.get('agent_team')!.table('operations').entries()]
        .map(([, operation]) => operation as AgentTeamOperation).filter(operation => operation.kind === 'team/thread-read').at(-1)
      const appendedBytes = appended === undefined ? 0 : Buffer.byteLength(JSON.stringify(appended))
      report('T04_APPEND', {
        db: DB, committed: outcome.committed, readMs: Number(readMs.toFixed(1)),
        appendedBytes, appendedKeys: appended === undefined ? [] : Object.keys(appended.data).sort(),
        ledgerBytesBefore: before.bytes, ledgerBytesAfter: after.bytes,
        readRecordsBefore: before.readRecords, readRecordsAfter: after.readRecords,
        replayMsBefore: Number(replayBefore.toFixed(1)), replayMsAfter: Number(replayAfter.toFixed(1)),
      })
      // Cold boot once more, on the file the appended read landed in.
      await test.fiber.dispose()
      await test.facility.closeAll()
      const meter = instrumentReplays()
      const bootStart = performance.now()
      const revived = await sqliteHarness(copy)
      const bootMs = performance.now() - bootStart
      meter.restore()
      report('T04_APPEND_BOOT', { db: copy, bootMs: Number(bootMs.toFixed(1)), replayCalls: meter.calls(), replayMs: Number(meter.ms().toFixed(1)),
        operations: revived.ctx.agentTeam.status().operationCount })
      await revived.fiber.dispose()
      await revived.facility.closeAll()
      for (const suffix of ['', '-wal', '-shm']) rmSync(copy + suffix, { force: true })
      return
    }

    throw new Error(`unknown T04_ARM '${ARM}'`)
  }, 3_600_000)
})

/** The Workspace the frozen ledger's first Channel lives in. */
function firstWorkspace(ledger: AgentTeamLedger): WorkspaceId {
  const ordered = (ledger as unknown as { state: { ordered: readonly AgentTeamOperation[] } }).state.ordered
  for (const operation of ordered) {
    if (operation.kind === 'team/channel-created') return operation.data.workspaceId
    if (operation.kind === 'team/thread-promoted') return operation.data.workspaceId
  }
  throw new Error('the ledger declares no Workspace')
}
