/**
 * Ticket 03 acceptance probe — durable version vs. phantom refresh (THROWAWAY:
 * copy into packages/agent-team/tests/, run, delete).
 *
 * Real assembly on the frozen 11,695-operation ledger. Measures what the ticket
 * promises plus the fail-safe directions it does not state:
 *   1. one committing private read (the Human opening a Thread with unread)
 *      leaves every parked client parked and moves no projection or presence
 *      version — before: version +1 and 10/10 stale clients answered at once;
 *   2. a real reply still wakes the waiters of its own scopes only — an
 *      unrelated Thread and the presence scope stay parked (the reply is
 *      Human-authored through the service, which is the same committed
 *      `team/thread-replied` emit path a Member reply takes);
 *   3. a cursor carried in from another scope, or from another service
 *      lifetime, still settles instead of parking forever;
 *   4. the projection version does not regress across a real restart, and a
 *      Client still holding a pre-restart cursor is not left silently parked.
 *
 * Modes (same file, two commits):
 *   P0_EXPECT=legacy  (8dabaa3 and earlier) one process-wide wake counter
 *   P0_EXPECT=scoped  (03 and later) durable projection position + presence epoch
 *
 * Run:
 *   P0_DB=/tmp/phase0/frozen.sqlite P0_EXPECT=legacy \
 *     npx vitest run packages/agent-team/tests/zz-p0-version.spec.ts
 */
import { copyFile, rm } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import Storage from '@deepseek-ai/dsh-storage'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import AgentTeam from '../src/index.ts'
import * as agentTeamInvariant from '../src/invariant.ts'

const DB = process.env.P0_DB ?? '/tmp/phase0/frozen.sqlite'
const WS = WorkspaceId(process.env.P0_WS ?? '40459c33-743d-4030-9e50-9419d72abe06')
// A Thread the Human follows and has already read to the end in the frozen ledger.
const THREAD = process.env.P0_THREAD ?? 'thread:256c6379-be56-4bc4-ad02-ae65ea8e4bf4'
const EXPECT = process.env.P0_EXPECT ?? 'scoped'
const ms = (value: number): number => Number(value.toFixed(1))
const sleep = (value: number): Promise<void> => new Promise(resolve => setTimeout(resolve, value))

const presenceScope = { kind: 'presence' as const, workspaceId: WS }

interface Booted {
  readonly ctx: any
  readonly facility: any
  readonly backend: any
  readonly table: any
  readonly ledger: any
  readonly service: any
  readonly close: () => Promise<void>
}

async function boot(dbPath: string): Promise<Booted> {
  const ctx: any = new Context()
  await ctx.plugin(Storage)
  const backend = new SqliteStorageBackend({ path: dbPath, journalMode: 'wal' })
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
  return {
    ctx, facility, backend, table: facility.get('agent_team')!.table('operations'),
    ledger: (ctx.agentTeam as any).requireLedger(), service: ctx.agentTeam,
    close: async (): Promise<void> => {
      await fiber.dispose()
      await facility.closeAll?.()
      await backend.close()
      await ctx.stop?.()
    },
  }
}

let copies = 0
const RUN = String(process.pid)
async function nextCopy(label: string): Promise<string> {
  copies += 1
  const work = `${DB}.version-${label}-${RUN}-${copies}.sqlite`
  // A stale -wal/-shm from an earlier round would be replayed on top of the copy.
  await rm(`${work}-wal`, { force: true })
  await rm(`${work}-shm`, { force: true })
  await copyFile(DB, work)
  return work
}

interface Parked {
  promise: Promise<unknown>
  readonly controller: AbortController
  settled: boolean
  value: number | undefined
  error: string
  settledMs: number
}

function park(service: any, request: any): Parked {
  const controller = new AbortController()
  const started = performance.now()
  const parked: Parked = { controller, settled: false, value: undefined, error: '', settledMs: -1, promise: Promise.resolve() }
  parked.promise = service.changes(request, controller.signal).then(
    (value: any) => { parked.settled = true; parked.settledMs = ms(performance.now() - started); parked.value = value?.version; return value },
    (error: unknown) => { parked.settled = true; parked.error = String((error as Error)?.message ?? error); return undefined },
  )
  return parked
}

function release(parked: ReadonlyArray<Parked>): Promise<unknown> {
  for (const waiter of parked) if (!waiter.settled) waiter.controller.abort()
  return Promise.all(parked.map(waiter => waiter.promise))
}

/** How many stale clients at `afterVersion` are answered right away, and how fast. */
async function staleProbe(service: any, afterVersion: number, samples = 10, scope?: unknown): Promise<{ immediate: number, medianMs: number }> {
  const latencies: number[] = []
  const released: Parked[] = []
  for (let index = 0; index < samples; index += 1) {
    const waiter = park(service, scope === undefined ? { afterVersion } : { afterVersion, scope })
    released.push(waiter)
    await sleep(20)
    if (waiter.settled && waiter.error === '') latencies.push(waiter.settledMs)
  }
  await release(released)
  latencies.sort((left, right) => left - right)
  return { immediate: latencies.length, medianMs: latencies.length === 0 ? -1 : latencies[(latencies.length - 1) >> 1]! }
}

interface Row { threadRef: string, channelRef: string, revision: number, unread: number, newest: number }

async function rowsOf(service: any): Promise<Row[]> {
  const inbox: any = await service.inbox({ workspaceId: WS, limit: 50 })
  return (inbox.items ?? []).map((item: any) => ({
    threadRef: item.thread.threadRef, channelRef: item.channelRef,
    revision: item.thread.revision, unread: item.unreadCount, newest: item.newestSequence,
  }))
}

/**
 * One Human-authored reply through the assembled service. It is a committed
 * `team/thread-replied` operation, so it takes the same `emitCommitted` →
 * `changeScopesOf` path a Member reply takes; a Member actor would additionally
 * need a live Agent, which this probe does not have. The ledger's own
 * `committed` verdict gates the arm.
 */
async function humanReply(api: any, baseRevision: number, tag: string): Promise<{ revision: number, channelRef: string, sequence: number }> {
  const result: any = await api.reply({ requestId: `p0v-${tag}`, workspaceId: WS, threadRef: THREAD, body: `p0v ${tag}`, baseRevision })
  if (result?.kind !== 'committed') throw new Error(`expected a committed reply for ${tag}, received ${String(result?.kind)}`)
  return { revision: result.thread.revision, channelRef: result.message.channelRef, sequence: result.receipt.sequence }
}

describe('ticket 03 — a private read moves no version', () => {
  it('leaves every parked client parked and every stale cursor where it was', async () => {
    const booted = await boot(await nextCopy('phantom'))
    const service = booted.service

    const rows = await rowsOf(service)
    const target = rows.slice().sort((left, right) => right.unread - left.unread)[0]!
    const before = {
      projection: Number((await service.changes({ afterVersion: 0 })).version),
      presence: Number((await service.changes({ afterVersion: 0, scope: presenceScope })).version),
      thread: Number((await service.changes({ afterVersion: 0, scope: { kind: 'thread', threadRef: target.threadRef } })).version),
    }
    const parked: Parked[] = [
      park(service, { afterVersion: before.projection }),
      park(service, { afterVersion: before.thread, scope: { kind: 'thread', threadRef: target.threadRef } }),
      park(service, { afterVersion: before.projection, scope: { kind: 'channel', channelRef: target.channelRef } }),
      park(service, { afterVersion: before.presence, scope: presenceScope }),
    ]
    const [global, thread, channel, presence] = parked
    await sleep(30)
    const parkedBefore = { global: !global!.settled, thread: !thread!.settled, channel: !channel!.settled, presence: !presence!.settled }

    // The private read: the Human opens a Thread that does hold unread facts,
    // so ticket 02 still commits it.
    const opsBefore = booted.table.size
    const read: any = await service.readThread({ requestId: 'p0v-phantom-read', workspaceId: WS, threadRef: target.threadRef })
    const opsDelta = booted.table.size - opsBefore
    await sleep(30)
    const parkedWoke = { global: global!.settled, thread: thread!.settled, channel: channel!.settled, presence: presence!.settled }

    const after = {
      projection: Number((await service.changes({ afterVersion: 0 })).version),
      presence: Number((await service.changes({ afterVersion: 0, scope: presenceScope })).version),
      thread: Number((await service.changes({ afterVersion: 0, scope: { kind: 'thread', threadRef: target.threadRef } })).version),
    }
    const stale = await staleProbe(service, before.projection)
    const stalePresence = await staleProbe(service, before.presence, 10, presenceScope)

    console.log('P0V ' + JSON.stringify({ arm: 'private-read', expect: EXPECT, target: target.threadRef,
      targetUnreadBefore: target.unread, readOpsDelta: opsDelta, readCommitted: read.receipt !== undefined,
      readConsumed: read.remainingUnreadCount, before, after,
      projectionDelta: after.projection - before.projection, presenceDelta: after.presence - before.presence,
      threadDelta: after.thread - before.thread, parkedBefore, parkedWoke,
      staleImmediateOf10: stale.immediate, staleMedianMs: stale.medianMs,
      stalePresenceImmediateOf10: stalePresence.immediate }))

    await release(parked)

    expect(target.unread).toBeGreaterThan(0)
    expect(opsDelta).toBe(1)
    expect(read.receipt).toBeDefined()
    // No scope a private read cannot invalidate is answered.
    expect(parkedBefore).toEqual({ global: true, thread: true, channel: true, presence: true })
    expect(parkedWoke).toEqual({ global: false, thread: false, channel: false, presence: false })
    if (EXPECT === 'legacy') {
      // Before: one process-wide counter, so every stale client is answered at once.
      expect(after.projection - before.projection).toBe(1)
      expect(after.presence - before.presence).toBe(1)
      expect(stale.immediate).toBe(10)
      expect(stalePresence.immediate).toBe(10)
    } else {
      expect(after.projection - before.projection).toBe(0)
      expect(after.presence - before.presence).toBe(0)
      expect(after.thread - before.thread).toBe(0)
      expect(stale.immediate).toBe(0)
      expect(stalePresence.immediate).toBe(0)
    }
    await booted.close()
  }, 600_000)

  it('wakes only the scopes a real change touches, heals a foreign cursor, and keeps the version across a restart', async () => {
    const path = await nextCopy('scopes')
    const booted = await boot(path)
    const service = booted.service
    const rows = await rowsOf(service)
    // Inbox rows carry marker unread from DM Threads, whose replies are
    // `team/dm-sent` and deliberately wake no waiter. The wake arms need a
    // Channel Thread the Human follows, so they use THREAD and take the
    // Channel ref from a committed reply's own message.
    const unrelated = rows.find(row => row.threadRef !== THREAD)!
    const opening: any = await service.readThread({ requestId: 'p0v-opening', workspaceId: WS, threadRef: THREAD })
    const warmup = await humanReply(service, opening.thread.revision, 'warmup')
    const channelRef = warmup.channelRef

    // Arm A: a real reply wakes its own scopes and nothing else.
    const base = {
      projection: Number((await service.changes({ afterVersion: 0 })).version),
      presence: Number((await service.changes({ afterVersion: 0, scope: presenceScope })).version),
    }
    const wakeGlobal = park(service, { afterVersion: base.projection })
    const wakeScope = park(service, { afterVersion: base.projection, scope: { kind: 'thread', threadRef: THREAD } })
    const wakeChannel = park(service, { afterVersion: base.projection, scope: { kind: 'channel', channelRef } })
    const wakeWorkspace = park(service, { afterVersion: base.projection, scope: { kind: 'workspace', workspaceId: WS } })
    const wakeOther = park(service, { afterVersion: base.projection, scope: { kind: 'thread', threadRef: unrelated.threadRef } })
    const wakePresence = park(service, { afterVersion: base.presence, scope: presenceScope })
    await sleep(30)
    const wake = await humanReply(service, warmup.revision, 'wake')
    await sleep(60)
    const woke = {
      global: wakeGlobal.settled, scope: wakeScope.settled, channel: wakeChannel.settled,
      unrelated: wakeOther.settled, presence: wakePresence.settled,
      versions: { global: wakeGlobal.value, scope: wakeScope.value, channel: wakeChannel.value },
    }
    console.log('P0V ' + JSON.stringify({ arm: 'scope-wake', expect: EXPECT, thread: THREAD, channelRef, unrelated: unrelated.threadRef,
      commitSequence: wake.sequence, workspaceScopedWoke: wakeWorkspace.settled, base, woke }))
    expect(wakeGlobal.settled && (wakeGlobal.value ?? 0) > base.projection).toBe(true)
    expect(wakeScope.settled && (wakeScope.value ?? 0) > base.projection).toBe(true)
    expect(wakeChannel.settled && (wakeChannel.value ?? 0) > base.projection).toBe(true)
    if (EXPECT === 'scoped') {
      // The woken cursor is the durable position of the commit itself.
      expect(wakeGlobal.value).toBe(wake.sequence)
      expect(wakeScope.value).toBe(wake.sequence)
      expect(wakeChannel.value).toBe(wake.sequence)
    }
    expect(wakeOther.settled).toBe(false)
    expect(wakePresence.settled).toBe(false)

    // Arm B: a cursor carried in from another scope (much larger than anything
    // this scope's domain will reach soon) must still be answered once its own
    // scope changes — never parked forever.
    const carried = park(service, { afterVersion: base.projection + 1000, scope: { kind: 'thread', threadRef: THREAD } })
    await sleep(30)
    const carriedParked = !carried.settled
    const carriedReply = await humanReply(service, wake.revision, 'carried')
    await sleep(200)
    console.log('P0V ' + JSON.stringify({ arm: 'carried-cursor', expect: EXPECT, cursor: base.projection + 1000,
      parkedFirst: carriedParked, healedOnChange: carried.settled && carried.error === '', settledMs: carried.settledMs, error: carried.error }))
    expect(carriedParked).toBe(true)
    expect(carried.settled && carried.error === '').toBe(true)

    // Arm C: a projection number used as a presence cursor is outside that
    // scope's domain. It must settle within the Host's own timeout and hand
    // back a number from the presence domain, so a Client can re-anchor. The
    // same wait parks one Thread scope whose own content does not change, to
    // price the timeout path itself: whatever the Host hands back there is what
    // the Client re-anchors on, and a difference makes it refresh.
    const crossCursor = Number((await service.changes({ afterVersion: 0 })).version)
    const crossDomain = park(service, { afterVersion: crossCursor, scope: presenceScope })
    const untouched = park(service, { afterVersion: crossCursor, scope: { kind: 'thread', threadRef: unrelated.threadRef } })
    const crossStart = performance.now()
    const laterReply = await humanReply(service, carriedReply.revision, 'later')
    await crossDomain.promise
    await untouched.promise
    const crossMs = ms(performance.now() - crossStart)
    const presenceNow = Number((await service.changes({ afterVersion: 0, scope: presenceScope })).version)
    console.log('P0V ' + JSON.stringify({ arm: 'cross-domain-cursor', expect: EXPECT, cursor: crossCursor, laterSequence: laterReply.sequence,
      settledMs: crossMs, returned: crossDomain.value, presenceDomain: presenceNow,
      reanchorable: (crossDomain.value ?? Infinity) <= presenceNow,
      untouchedScope: unrelated.threadRef, untouchedReturned: untouched.value, untouchedRefreshesAnyway: untouched.value !== crossCursor }))
    expect(crossDomain.settled).toBe(true)
    expect(crossDomain.error).toBe('')
    expect(crossMs).toBeLessThan(26_000)
    expect((crossDomain.value ?? Infinity) <= presenceNow).toBe(true)
    expect(untouched.settled && untouched.error === '').toBe(true)

    // Arm D: the projection version is a ledger position, so a real restart
    // must not send it backwards, and a Client still holding a pre-restart
    // cursor must not be left silently parked.
    const sampled = {
      projection: Number((await service.changes({ afterVersion: 0 })).version),
      presence: Number((await service.changes({ afterVersion: 0, scope: presenceScope })).version),
      ops: booted.table.size,
    }
    await release([wakeGlobal, wakeScope, wakeChannel, wakeWorkspace, wakeOther, wakePresence, carried])
    await booted.close()

    const revived = await boot(await path)
    const after = {
      projection: Number((await revived.service.changes({ afterVersion: 0 })).version),
      presence: Number((await revived.service.changes({ afterVersion: 0, scope: presenceScope })).version),
      ops: revived.table.size,
    }
    const staleAfterRestart = await staleProbe(revived.service, sampled.projection)
    const carriedRestart = park(revived.service, { afterVersion: sampled.projection })
    await sleep(30)
    const carriedRestartParked = !carriedRestart.settled
    const postReply = await humanReply(revived.service, laterReply.revision, 'post-restart')
    await sleep(60)
    console.log('P0V ' + JSON.stringify({ arm: 'restart', expect: EXPECT, sampled, after, postReplySequence: postReply.sequence,
      projectionRegressed: after.projection < sampled.projection, presenceEpochAfterRestart: after.presence,
      staleImmediateOf10AfterRestart: staleAfterRestart.immediate, carriedRestartParked,
      healedByOneChange: carriedRestart.settled && carriedRestart.error === '', healedMs: carriedRestart.settledMs,
      healedVersion: carriedRestart.value }))
    if (EXPECT === 'scoped') {
      // Durable ledger position: an idle restart changes nothing at all, and the
      // very next real change still wakes the cursor a Client is holding.
      expect(after.projection).toBe(sampled.projection)
      expect(staleAfterRestart.immediate).toBe(0)
      expect(carriedRestartParked).toBe(true)
      expect(carriedRestart.settled && carriedRestart.error === '').toBe(true)
      expect((carriedRestart.value ?? 0) > sampled.projection).toBe(true)
    } else {
      // Before: the counter is process state, not a ledger position. A restart
      // lands on an unrelated number, so a Client still holding its pre-restart
      // cursor is woken by the next change and handed a *smaller* version —
      // which the previous Client rule (`> version`) silently discards.
      expect(after.projection).toBeLessThan(sampled.projection)
      expect(carriedRestartParked).toBe(true)
      expect(carriedRestart.settled && carriedRestart.error === '').toBe(true)
      expect(carriedRestart.value ?? 0).toBeLessThan(sampled.projection)
    }
    await release([carriedRestart])
    await revived.close()
  }, 900_000)
})
