import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from './helpers/memory-backend.ts'
import { AgentTeamLedger, AGENT_TEAM_HUMAN_HANDLE, agentTeamHumanActor } from '../src/ledger.ts'
import { agentTeamDomainSpec } from '../src/spec.ts'
import { assertValidHumanName, HUMAN_PROFILE_DEFAULT_NAME, normalizeHumanName } from '../src/human-profile.ts'
import { readHumanAvatar, removeHumanAvatar, writeHumanAvatar } from '../src/human-avatar.ts'
import type { AgentTeamMemberId, AgentTeamOperation, AgentTeamOperationId, AgentTeamRequestId } from '../src/types.ts'

const alpha = WorkspaceId('workspace:alpha')
const requestId = (value: string): AgentTeamRequestId => value as AgentTeamRequestId
const memberId = (value: string): AgentTeamMemberId => `member:${value}` as AgentTeamMemberId

const cleanups: Array<() => Promise<void>> = []
const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function openLedger(): Promise<AgentTeamLedger> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  cleanups.push(async () => { await facility.closeAll() })
  const domain = await ctx.storageDomain.open(agentTeamDomainSpec)
  return new AgentTeamLedger(domain.table('operations') as unknown as KvTable<AgentTeamOperationId, AgentTeamOperation>)
}

describe('human display name validation', () => {
  it('trims and rejects empty names like Member handles', () => {
    expect(normalizeHumanName('  Ada  ')).toBe('Ada')
    expect(assertValidHumanName('Ada')).toBe('Ada')
    expect(() => assertValidHumanName('   ')).toThrow('human name must not be empty')
    expect(HUMAN_PROFILE_DEFAULT_NAME).toBe(AGENT_TEAM_HUMAN_HANDLE)
  })
})

describe('ledger runtime human handle', () => {
  it('defaults to the historic literal and syncs from settings', async () => {
    const team = await openLedger()
    expect(team.humanDisplayHandle()).toBe('human')
    team.setHumanDisplayHandle('  Ada  ')
    expect(team.humanDisplayHandle()).toBe('Ada')
    team.setHumanDisplayHandle('   ')
    expect(team.humanDisplayHandle()).toBe('Ada')
    await team.initialize()
  })

  it('accepts human operations carrying either the old or the new handle', async () => {
    const team = await openLedger()
    await team.initialize()
    team.setHumanDisplayHandle('Ada')
    const renamedActor = Object.freeze({ ...agentTeamHumanActor(), handle: 'Ada' })
    const created = await team.createChannel({ requestId: requestId('human-rename-ok'), workspaceId: alpha, name: 'general', description: '', memberIds: [], actor: renamedActor })
    expect(created.committed).toBe(true)
  })

  it('reserves the human name against agent handles', async () => {
    const team = await openLedger()
    await team.initialize()
    team.setHumanDisplayHandle('Ada')
    await expect(team.addMember({
      requestId: requestId('agent-collides'), workspaceId: alpha, handle: 'ada', description: '', presetId: 'preset',
      channelRefs: [], member: {
        memberId: memberId('m1'), sessionId: 'session:m1' as never, workspaceId: alpha,
        handle: 'ada', description: '', presetId: 'preset', privateMemoryPath: '/tmp/m1', state: 'enabled',
      },
      actor: agentTeamHumanActor(),
    })).rejects.toThrow('collides with the human display name')
  })
})

describe('human avatar persistent store', () => {
  it('writes, reads, and removes one image entry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'human-avatar-'))
    tempRoots.push(root)
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const written = await writeHumanAvatar(root, 'avatar.png', 'image/png', bytes)
    expect(written.avatarRef).toMatch(/^[0-9a-f-]{36}$/)
    const stored = await readHumanAvatar(root, written.avatarRef)
    expect(stored?.mediaType).toBe('image/png')
    expect(stored?.bytes.equals(bytes)).toBe(true)
    await removeHumanAvatar(root, written.avatarRef)
    expect(await readHumanAvatar(root, written.avatarRef)).toBeUndefined()
  })

  it('rejects non-images, empty bytes, and missing entries read as undefined', async () => {
    const root = await mkdtemp(join(tmpdir(), 'human-avatar-'))
    tempRoots.push(root)
    await expect(writeHumanAvatar(root, 'a.txt', 'text/plain', Buffer.from('x'))).rejects.toThrow('must be an image')
    await expect(writeHumanAvatar(root, 'a.png', 'image/png', Buffer.alloc(0))).rejects.toThrow('must not be empty')
    expect(await readHumanAvatar(root, 'missing')).toBeUndefined()
  })
})
