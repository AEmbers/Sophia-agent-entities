/**
 * 追加式账本与 scope 增量读取的验收测试（SPEC §6 / §7.2 的 AC-10-1…AC-10-10）。
 *
 * ## 本文件的断言为什么不是恒真的
 *
 * - **AC-10-6 用独立连接**：篡改不是通过 `Ledger` 的方法做的（那只能证明「这个类碰巧没暴露
 *   update」），而是另开一条 `DatabaseSync` 直接发 SQL。只有这样才证明 append-only 落在
 *   **存储层**。反恒真手法：删掉 `LEDGER_SCHEMA_SQL` 里的 `CREATE TRIGGER` 语句，该用例必须变红。
 * - **AC-10-1/AC-10-4 依赖 scope 过滤真的在过滤**：把 `read` 的 scope 判定改成恒真，
 *   这两条必须变红（见文件末尾「反恒真抽检记录」）。
 * - **`verifyIntegrity` 的三态**用**外部注入的行**制造断裂（空洞 / 首条锚点丢失），
 *   不是靠调一个「假装坏了」的开关 —— 后者是自证。
 *
 * 语义边界与 SPEC §6.3 三条语义一一对应，并在每个用例里写明它测的是哪一条。
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LEDGER_EVENT_KINDS,
  changeScopesOf,
  isLedgerEvent,
  openLedger,
  type ChangeScope,
  type Ledger,
  type LedgerActor,
  type LedgerCommitInput,
  type LedgerEvent,
  type LedgerEventKind,
} from '../src/index.ts'
import type { DagTeamId, EventId, MemberId, MemberIdentity, PlanId, TeamId } from '../src/index.ts'

const teamA = 'team-a' as TeamId
const teamB = 'team-b' as TeamId
const teamC = 'team-c' as TeamId
const dagTeam1 = 'dag-1' as DagTeamId
const plan1 = 'plan-1' as PlanId
const memberId = 'sophia-lingtai-lang-a1b2c3d4' as MemberId
const otherMemberId = 'sophia-lingtai-lang-ffffffff' as MemberId

const humanActor: LedgerActor = { kind: 'human', humanId: 'human-1' }

/** 已打开的账本与临时目录，`afterEach` 统一清理（避免测试互相污染）。 */
const openLedgers: Ledger[] = []
const tempDirs: string[] = []

afterEach(() => {
  for (const ledger of openLedgers.splice(0)) {
    ledger.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function newMemoryLedger(now?: () => number): Ledger {
  const ledger = openLedger(now === undefined ? { path: ':memory:' } : { path: ':memory:', now })
  openLedgers.push(ledger)
  return ledger
}

/** 建一个**真实文件**账本，返回路径（AC-10-6/AC-10-8 需要独立连接打开同一个文件）。 */
function newFileLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sophia-ledger-'))
  tempDirs.push(dir)
  return join(dir, 'ledger.db')
}

function openFileLedger(path: string): Ledger {
  const ledger = openLedger({ path })
  openLedgers.push(ledger)
  return ledger
}

function commit(ledger: Ledger, input: LedgerCommitInput) {
  return ledger.commit(input)
}

/** 建一条 `team/created` 事件（scope = 该团）。 */
function teamCreated(teamId: TeamId, name: string): LedgerCommitInput {
  return {
    kind: 'team/created',
    data: { teamId, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name },
    actor: humanActor,
  }
}

const memberIdentity: MemberIdentity = {
  position: '灵台郎',
  name: '灵台郎',
  memberId,
}

describe('AC-10-1 只追加 + 按 scope 可查', () => {
  it('按 {kind:team, teamId:A} 只读到 A 的那条；hasMore=false、nextCursor=null', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    commit(ledger, teamCreated(teamC, '丙团'))

    const page = ledger.read({ scopes: [{ kind: 'team', teamId: teamA }] })

    expect(page.events).toHaveLength(1)
    const [only] = page.events
    expect(only?.kind).toBe('team/created')
    expect(only?.data).toMatchObject({ teamId: teamA, name: '甲团' })
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it('省略 scopes 时不做过滤，三条全部可见（SPEC §6.3 语义 1）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    commit(ledger, teamCreated(teamC, '丙团'))

    const page = ledger.read({})

    expect(page.events.map((event) => event.sequence)).toEqual([1, 2, 3])
  })

  it('scope 交集要求 kind 与 id 同时相等（同 kind 不同 id 不得命中）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))

    // 这一条是 AC-10-1 的反恒真的「近邻」：过滤若只比 kind 不比 id，下面会读到 1 条。
    const page = ledger.read({ scopes: [{ kind: 'team', teamId: teamB }] })

    expect(page.events).toHaveLength(0)
  })

  it('事件按 sequence 升序返回', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    commit(ledger, teamCreated(teamC, '丙团'))

    expect(ledger.read({}).events.map((event) => event.sequence)).toEqual([1, 2, 3])
  })

  it('提交是同步的：返回值不是 Promise，且返回即已落盘可读', () => {
    const ledger = newMemoryLedger()
    const receipt = commit(ledger, teamCreated(teamA, '甲团'))

    // 裁定 Q-B：同步签名。若把 commit 改成 async，这里 receipt.eventId 会是 undefined。
    expect(receipt).not.toBeInstanceOf(Promise)
    expect(receipt.sequence).toBe(1)
    expect(typeof receipt.eventId).toBe('string')
    expect(ledger.read({}).events).toHaveLength(1)
  })
})

describe('AC-10-2 scope 计算正确', () => {
  it('team/member-added 同时返回新成员 member scope 与所属团 team scope', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/member-added',
      data: { teamId: teamA, member: memberIdentity, lifecycle: 'active' },
      actor: humanActor,
    })
    const [event] = ledger.read({}).events
    expect(event).toBeDefined()
    if (event === undefined) return

    const scopes = changeScopesOf(event)

    expect(scopes.length).toBeGreaterThanOrEqual(2)
    expect(scopes).toContainEqual({ kind: 'member', memberId })
    expect(scopes).toContainEqual({ kind: 'team', teamId: teamA })
  })

  it('两个方向都真的能按 scope 读到那条 member-added（scope 不是只算不用）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/member-added',
      data: { teamId: teamA, member: memberIdentity, lifecycle: 'active' },
      actor: humanActor,
    })

    expect(ledger.read({ scopes: [{ kind: 'team', teamId: teamA }] }).events).toHaveLength(1)
    expect(ledger.read({ scopes: [{ kind: 'member', memberId }] }).events).toHaveLength(1)
    expect(ledger.read({ scopes: [{ kind: 'member', memberId: otherMemberId }] }).events).toHaveLength(0)
  })

  it('成员生命周期事件同时命中成员与其所属团', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/member-suspended',
      data: { teamId: teamA, memberId, from: 'active', to: 'suspended' },
      actor: humanActor,
    })

    expect(ledger.read({ scopes: [{ kind: 'member', memberId }] }).events).toHaveLength(1)
    expect(ledger.read({ scopes: [{ kind: 'team', teamId: teamA }] }).events).toHaveLength(1)
    expect(ledger.read({ scopes: [{ kind: 'team', teamId: teamB }] }).events).toHaveLength(0)
  })

  it('plan/approved 投 plan scope；dag/ownership-transferred 投 dag-team + 两侧成员', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'plan/approved',
      data: { planId: plan1, mode: 'persistent-team', operator: 'human-1' },
      actor: humanActor,
    })
    commit(ledger, {
      kind: 'dag/ownership-transferred',
      data: { dagTeamId: dagTeam1, from: memberId, to: otherMemberId },
      actor: humanActor,
    })

    expect(ledger.read({ scopes: [{ kind: 'plan', planId: plan1 }] }).events.map((e) => e.kind)).toEqual([
      'plan/approved',
    ])
    expect(
      ledger.read({ scopes: [{ kind: 'dag-team', dagTeamId: dagTeam1 }] }).events.map((e) => e.kind),
    ).toEqual(['dag/ownership-transferred'])
    expect(ledger.read({ scopes: [{ kind: 'member', memberId }] }).events.map((e) => e.kind)).toEqual([
      'dag/ownership-transferred',
    ])
  })

  it('子团成立投父团 scope，顶层团只投自身（team/created 的 parentTeamId 分支）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/created',
      data: { teamId: teamA, kind: 'persistent', ownerMemberId: memberId, parentTeamId: teamB, name: '子团' },
      actor: humanActor,
    })

    const [event] = ledger.read({}).events
    expect(event).toBeDefined()
    if (event === undefined) return
    expect(changeScopesOf(event)).toContainEqual({ kind: 'team', teamId: teamB })
    expect(ledger.read({ scopes: [{ kind: 'team', teamId: teamB }] }).events).toHaveLength(1)
  })

  it('审批类事件投人类收件箱 scope', () => {
    const ledger = newMemoryLedger()
    const spec = { name: '新团', roster: [{ position: '灵台郎', count: 1 }], tasks: ['t'] }
    commit(ledger, {
      kind: 'spawn/awaiting-human-approval',
      data: {
        requestId: 'req-1',
        requesterMemberId: memberId,
        principalMemberId: otherMemberId,
        targetKind: 'persistent',
        spec,
      },
      actor: humanActor,
    })
    commit(ledger, {
      kind: 'spawn/principal-rejected',
      data: {
        requestId: 'req-2',
        requesterMemberId: memberId,
        principalMemberId: otherMemberId,
        targetKind: 'persistent',
        reason: '不合规',
      },
      actor: humanActor,
    })

    // 待办入队进收件箱；被团长打回**不**进收件箱（FR-5.3.1：未到第二级）。
    expect(ledger.read({ scopes: [{ kind: 'human-inbox' }] }).events.map((e) => e.kind)).toEqual([
      'spawn/awaiting-human-approval',
    ])
  })

  it('changeScopesOf 对同一事件是纯函数（两次调用结果一致，不随账本状态变化）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/member-added',
      data: { teamId: teamA, member: memberIdentity, lifecycle: 'active' },
      actor: humanActor,
    })
    const [event] = ledger.read({}).events
    expect(event).toBeDefined()
    if (event === undefined) return

    expect(changeScopesOf(event)).toEqual(changeScopesOf(event))
  })
})

describe('AC-10-3 游标增量分页', () => {
  it('limit=2 分页读 5 条：第 1 页 hasMore=true/nextCursor=2，第 2 页首条 sequence=3，末页 hasMore=false', () => {
    const ledger = newMemoryLedger()
    for (let index = 0; index < 5; index += 1) {
      commit(ledger, teamCreated(teamA, `团-${index}`))
    }

    const first = ledger.read({ limit: 2 })
    expect(first.events.map((e) => e.sequence)).toEqual([1, 2])
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe(2)

    const second = ledger.read({ afterSequence: first.nextCursor ?? 0, limit: 2 })
    expect(second.events[0]?.sequence).toBe(3)
    expect(second.events.map((e) => e.sequence)).toEqual([3, 4])
    expect(second.hasMore).toBe(true)

    const third = ledger.read({ afterSequence: second.nextCursor ?? 0, limit: 2 })
    expect(third.events.map((e) => e.sequence)).toEqual([5])
    expect(third.hasMore).toBe(false)
    expect(third.nextCursor).toBeNull()
  })

  it('afterSequence 是严格大于（游标所在那条不重复返回）', () => {
    const ledger = newMemoryLedger()
    for (let index = 0; index < 3; index += 1) {
      commit(ledger, teamCreated(teamA, `团-${index}`))
    }

    const page = ledger.read({ afterSequence: 2 })

    expect(page.events.map((e) => e.sequence)).toEqual([3])
  })

  it('翻页与 scope 过滤叠加时也不丢事件（超出单批时仍能翻完）', () => {
    const ledger = newMemoryLedger()
    // 交替团队：若实现只在第一批里做 scope 过滤，A 团就会读不全。
    for (let index = 0; index < 40; index += 1) {
      commit(ledger, teamCreated(index % 2 === 0 ? teamA : teamB, `团-${index}`))
    }

    const collected: number[] = []
    let cursor: number | undefined
    for (let guard = 0; guard < 20; guard += 1) {
      const page = ledger.read({
        scopes: [{ kind: 'team', teamId: teamA }],
        limit: 3,
        ...(cursor === undefined ? {} : { afterSequence: cursor }),
      })
      collected.push(...page.events.map((e) => e.sequence))
      if (!page.hasMore || page.nextCursor === null) break
      cursor = page.nextCursor
    }

    expect(collected).toEqual([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39])
  })

  it('空账本与越界游标都返回空页而非报错', () => {
    const ledger = newMemoryLedger()
    expect(ledger.read({})).toEqual({ events: [], hasMore: false, nextCursor: null })
    expect(ledger.read({ afterSequence: 999 })).toEqual({ events: [], hasMore: false, nextCursor: null })
  })
})

describe('AC-10-4 空 scope 不参与投影（SPEC §6.3 语义 3）', () => {
  it('team/initialized 的 changeScopesOf 为空；任何 scope 读不到它，不带 scopes 能读到', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/initialized',
      data: { teamId: teamA, kind: 'persistent', createdByHostSessionId: null },
      actor: humanActor,
    })
    commit(ledger, teamCreated(teamA, '甲团'))

    const [first] = ledger.read({}).events
    expect(first?.kind).toBe('team/initialized')
    if (first === undefined) return
    expect(changeScopesOf(first)).toEqual([])

    const allScopes: readonly ChangeScope[] = [
      { kind: 'team', teamId: teamA },
      { kind: 'member', memberId },
      { kind: 'plan', planId: plan1 },
      { kind: 'dag-team', dagTeamId: dagTeam1 },
      { kind: 'human-inbox' },
    ]
    // 只断言「`team/initialized` 不在结果里」，而不是断言结果为空：
    // 同一账本里那条 `team/created` 的 teamId 就是 teamA，本来就该命中 ——
    // 写成 `toHaveLength(0)` 会因**另一个正当原因**失败（本测试初版正是如此）。
    expect(ledger.read({ scopes: allScopes }).events.map((e) => e.kind)).toEqual(['team/created'])
    // 不带 scopes 时它必须在（否则「空 scope」就变成了「写不进去」）。
    expect(ledger.read({}).events.map((e) => e.kind)).toEqual(['team/initialized', 'team/created'])
  })

  it('查询传空数组 scopes 时返回空页（不读成「不过滤」）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))

    const page = ledger.read({ scopes: [] })

    expect(page.events).toEqual([])
    expect(page.hasMore).toBe(false)
  })

  it('空 scopes 的短路不改变结果：与表里有大量事件时的答案一致（OCR 评审 [2]）', () => {
    const ledger = newMemoryLedger()
    // 先问空账本（走短路分支）…
    expect(ledger.read({ scopes: [] })).toEqual({ events: [], hasMore: false, nextCursor: null })
    // …再灌 300 条后重问，答案必须一样（若短路分支被写成返回别的东西，这里会红）。
    for (let index = 0; index < 300; index += 1) {
      commit(ledger, teamCreated(teamA, `团-${index}`))
    }
    expect(ledger.read({ scopes: [] })).toEqual({ events: [], hasMore: false, nextCursor: null })
    // 且不干扰同一账本上的其他查询。
    expect(ledger.read({ limit: 1 }).events).toHaveLength(1)
  })
})

describe('AC-10-5 空结果不等于出错', () => {
  it('按不存在的 scope 读 → events 是空数组（不是 undefined、不抛错）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))

    const page = ledger.read({ scopes: [{ kind: 'spawn-ticket', ticketId: 'ticket-nonexistent' as never }] })

    expect(Array.isArray(page.events)).toBe(true)
    expect(page.events).toEqual([])
    expect(page.events).not.toBeUndefined()
    expect(page.nextCursor).toBeNull()
    expect(page.hasMore).toBe(false)
  })
})

describe('AC-10-6 篡改历史被存储层拒（用独立连接）', () => {
  it('另开一条 DatabaseSync 连接的 UPDATE / DELETE 均抛错，事后账本完好', () => {
    const path = newFileLedgerPath()
    const ledger = openFileLedger(path)
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    const before = ledger.read({}).events
    expect(before).toHaveLength(2)

    // 独立连接：绕过 Ledger 类，直接对同一个库文件发 SQL。
    const outsider = new DatabaseSync(path)
    try {
      expect(() => outsider.prepare("UPDATE ledger_events SET kind = 'team/created' WHERE sequence = 1").run()).toThrow(
        /append-only: UPDATE forbidden/,
      )
      expect(() => outsider.prepare('DELETE FROM ledger_events WHERE sequence = 2').run()).toThrow(
        /append-only: DELETE forbidden/,
      )
      expect(() => outsider.prepare('DELETE FROM ledger_events').run()).toThrow(/append-only/)
    } finally {
      outsider.close()
    }

    // 事后：全部原事件仍在，且完整性自检通过。
    expect(ledger.read({}).events).toEqual(before)
    expect(ledger.read({}).events).toHaveLength(2)
    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 2, brokenAt: null })
  })

  it('OCR [25]：另一**进程**持写锁时 commit 会等待而不是立刻失败（busy_timeout 生效）', async () => {
    // 缺陷现场（实测）：`commit` 用 `BEGIN IMMEDIATE` 串行化写事务，而 SQLite 在另一条
    // 连接/另一个进程持写锁时**默认立即**抛 `SQLITE_BUSY`（`database is locked`）。
    // 本包的设计明确预期第二条连接会碰同一文件（AC-10-6 就是那样验的），
    // 所以「短暂争用」不该被报成硬错误 —— 修法是 `openLedger` 设 `PRAGMA busy_timeout`。
    //
    // 为什么必须用**另一个进程**：`node:sqlite` 是同步 API，busy_timeout 会阻塞本进程的
    // 事件循环，因此同一个进程里用 `setTimeout` 释放锁**永远不会触发**（实测踩到过）。
    // 也正因为它**每连接**生效、不写进库文件，不能另开一条连接去读 pragma 值
    // （新建连接读回来是 0，测到的是新连接而非 Ledger 的行为）。
    // 所以这里用真行为断言：让子进程持锁 ~700ms，再提交 —— 有 busy_timeout 则等到并成功，
    // 没有则立刻 `database is locked`。
    // 反恒真：删掉 `openLedger` 里的 `PRAGMA busy_timeout`，本条必须变红（会抛 database is locked）。
    const path = newFileLedgerPath()
    const ledger = openFileLedger(path)
    commit(ledger, teamCreated(teamA, '甲团'))

    // 子进程：取写锁 → 忙等 700ms → 释放。用 `-e` 内联，不落任何临时脚本文件。
    const holderScript = [
      "const { DatabaseSync } = require('node:sqlite')",
      'const d = new DatabaseSync(process.argv[1])',
      "d.exec('BEGIN IMMEDIATE')",
      'const until = Date.now() + 700',
      'while (Date.now() < until) {}',
      "d.exec('ROLLBACK')",
      'd.close()',
    ].join(';')

    const child = spawn(process.execPath, ['-e', holderScript, path], { stdio: 'ignore' })
    // 给子进程时间真正拿到锁（它是新起的进程，启动有开销）。
    await new Promise((resolve) => setTimeout(resolve, 250))

    const startedAt = Date.now()
    let failure: string | null = null
    try {
      commit(ledger, teamCreated(teamB, '乙团'))
    } catch (error) {
      failure = (error as Error).message
    }
    const waitedMs = Date.now() - startedAt
    await new Promise((resolve) => child.once('exit', resolve))

    // 关键断言一：没有立刻失败。
    expect(failure, `不应报 database is locked，实际耗时 ${waitedMs}ms`).toBeNull()
    // 关键断言二：确实**等待过**（而不是子进程碰巧还没拿到锁）。
    expect(waitedMs).toBeGreaterThan(100)
    // 等待期间没有被写坏：两条事件都在，且序号连续。
    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 2, brokenAt: null })
  })

  it('触发器在库里真实存在（不是「碰巧没提供 update 方法」）', () => {
    const path = newFileLedgerPath()
    const ledger = openFileLedger(path)
    commit(ledger, teamCreated(teamA, '甲团'))

    const outsider = new DatabaseSync(path)
    try {
      const triggers = outsider
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
        .all()
      expect(triggers.map((row) => row['name'])).toEqual(['ledger_events_no_delete', 'ledger_events_no_update'])
    } finally {
      outsider.close()
    }
  })

  it('重开一个已存在的账本文件时约束仍在位（IF NOT EXISTS 不会让它静默消失）', () => {
    const path = newFileLedgerPath()
    const first = openFileLedger(path)
    commit(first, teamCreated(teamA, '甲团'))
    first.close()

    const second = openFileLedger(path)
    expect(second.read({}).events).toHaveLength(1)

    const outsider = new DatabaseSync(path)
    try {
      expect(() => outsider.prepare('DELETE FROM ledger_events').run()).toThrow(/append-only: DELETE forbidden/)
    } finally {
      outsider.close()
    }
  })
})

describe('AC-10-7 / AC-10-8 / AC-10-9 完整性自检三态', () => {
  it('正常账本：{ok:true, sequence:N, brokenAt:null}', () => {
    const ledger = newMemoryLedger()
    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 0, brokenAt: null })

    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    commit(ledger, teamCreated(teamC, '丙团'))

    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 3, brokenAt: null })
  })

  it('序号空洞：ok:false、brokenAt 指向该处，且不抛错', () => {
    const path = newFileLedgerPath()
    const ledger = openFileLedger(path)
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))

    // 外部连接插一条 sequence 有空洞的行（INSERT 未被触发器拦 —— append-only 拦的是改与删）。
    const outsider = new DatabaseSync(path)
    try {
      outsider
        .prepare(
          `INSERT INTO ledger_events
             (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (5, 'evt-injected', 'team/created', 1, 'human', 'human-1', NULL, NULL, '{}')`,
        )
        .run()
    } finally {
      outsider.close()
    }

    const integrity = ledger.verifyIntegrity()
    expect(integrity.ok).toBe(false)
    expect(integrity.brokenAt).toBe(5)
    // 断裂点之前的连续前缀长度，而不是「表里总行数」（3）。
    expect(integrity.sequence).toBe(2)
  })

  it('序号空洞且链式正确时，只有「序号连续性」能抓到它（M5 反恒真用的判别性用例）', () => {
    const path = newFileLedgerPath()
    // 先造一个自然账本，拿到真实的 eventId，好在注入行里续上正确的链。
    const seed = openFileLedger(path)
    const first = commit(seed, teamCreated(teamA, '甲团'))
    const second = commit(seed, teamCreated(teamB, '乙团'))
    seed.close()

    const outsider = new DatabaseSync(path)
    try {
      // sequence 跳过 3 直接写 4，但 previousEventId **正确地**指向第二条。
      // 于是「链式完整性」这一关放行 —— 唯一能发现异常的就是序号连续性检查。
      // 若把 verifyIntegrity 里的 `parsed.sequence !== expected` 判定删掉（改 `if (false)`），
      // 本用例必须变红（实测：会返回 {ok:true, sequence:3}）—— 这是它的存在意义。
      outsider
        .prepare(
          `INSERT INTO ledger_events
             (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (4, 'evt-gap', 'team/created', 1, 'human', 'human-1', ?, NULL, '{}')`,
        )
        .run(second.eventId)
    } finally {
      outsider.close()
    }

    const ledger = openFileLedger(path)
    // 前提自检：注入行的 previousEventId 用的就是第二条的真实 eventId，
    // 因此「链式完整性」这一关**必然放行**，本用例的判别力全部落在序号连续性上。
    expect(second.sequence).toBe(2)
    expect(typeof second.eventId).toBe('string')
    expect(ledger.verifyIntegrity()).toEqual({ ok: false, sequence: 2, brokenAt: 4 })
  })

  it('完整性自检跨越批边界：300 条账本仍报 ok:true 且 sequence=300（OCR 评审 [3] 的配套）', () => {
    const ledger = newMemoryLedger()
    for (let index = 0; index < 300; index += 1) {
      commit(ledger, teamCreated(teamA, `团-${index}`))
    }

    // 300 > INTEGRITY_BATCH_SIZE(256)：自检必须翻到第二批才能数完。
    // 若分页循环在第一批之后就停（把 `rows.length < INTEGRITY_BATCH_SIZE` 换成恒真），
    // sequence 会停在 256 —— 本用例必须变红。这是 M12 那个存活变异体逼出来的用例。
    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 300, brokenAt: null })
  })

  it('完整性自检在第二批里发现空洞（断裂点跨批时不被漏掉）', () => {
    const path = newFileLedgerPath()
    const seed = openFileLedger(path)
    // 1..299：仍在第一批里结束，空洞落在 300（第一批之外）。
    for (let index = 0; index < 299; index += 1) {
      commit(seed, teamCreated(teamA, `团-${index}`))
    }
    seed.close()

    const outsider = new DatabaseSync(path)
    try {
      outsider
        .prepare(
          `INSERT INTO ledger_events
             (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (301, 'evt-gap-late', 'team/created', 1, 'human', 'human-1', NULL, NULL, '{}')`,
        )
        .run()
    } finally {
      outsider.close()
    }

    const ledger = openFileLedger(path)
    // 空洞在序号 300 ⇒ 通过的前缀恰好是 299，断裂处 301。
    expect(ledger.verifyIntegrity()).toEqual({ ok: false, sequence: 299, brokenAt: 301 })
  })

  it('序号重复/非法行被自检当作断裂（不抛错）', () => {
    const path = newFileLedgerPath()
    const seed = openFileLedger(path)
    commit(seed, teamCreated(teamA, '甲团'))
    seed.close()

    const outsider = new DatabaseSync(path)
    try {
      // sequence=0 不是合法序号（1 起），行结构收窄即失败 ⇒ 断裂点退化为「前缀长度 + 1」。
      outsider
        .prepare(
          `INSERT INTO ledger_events
             (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (0, 'evt-zero', 'team/created', 1, 'human', 'human-1', NULL, NULL, '{}')`,
        )
        .run()
    } finally {
      outsider.close()
    }

    const ledger = openFileLedger(path)
    const integrity = ledger.verifyIntegrity()
    expect(integrity.ok).toBe(false)
    // sequence=0 排在 sequence=1 之前（ORDER BY ASC），所以它在第一次迭代就被判为非法行：
    // 断裂点退化为「已通过的前缀长度 + 1」= 1，前缀长度 = 0。
    expect(integrity).toEqual({ ok: false, sequence: 0, brokenAt: 1 })
  })

  it('OCR [26] 负序号非法行同样被自检抓到（游标不能只堵住 sequence=0 这一个实例）', () => {
    // 上一条用例堵的是 `sequence = 0`。但 `SELECT_PAGE_SQL` 的条件是 `sequence > ?`，
    // 游标取任何**有限**下界都只是把「被跳过的非法行」往后推一格：从 -1 起就漏掉 -5。
    // 实测：游标为 -1 时，插一条 `sequence = -5` 的行，`verifyIntegrity()` 报 ok:true
    // —— 把「表里有脏行」读成「账本完好」，正是自检最不该犯的错。
    // 修法取 `Number.MIN_SAFE_INTEGER`（不存在更小的安全整数序号）以关闭整类。
    // 反恒真：把游标改回 -1，本条必须变红。
    const path = newFileLedgerPath()
    const seed = openFileLedger(path)
    commit(seed, teamCreated(teamA, '甲团'))
    seed.close()

    const outsider = new DatabaseSync(path)
    try {
      outsider
        .prepare(
          `INSERT INTO ledger_events
           (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (-5, 'evt-negative', 'team/created', 1, 'human', 'human-1', NULL, NULL, '{}')`,
        )
        .run()
    } finally {
      outsider.close()
    }

    const ledger = openFileLedger(path)
    const integrity = ledger.verifyIntegrity()
    expect(integrity.ok).toBe(false)
    // 负序号行排在 sequence=1 之前（ORDER BY ASC）⇒ 第一次迭代即判为非法行：
    // 断裂点退化为「已通过的前缀长度 + 1」= 1，前缀长度 = 0。
    expect(integrity).toEqual({ ok: false, sequence: 0, brokenAt: 1 })
  })

  it('首条锚定：commit 之后首条 sequence=1、previousEventId=null，链式串接正确', () => {
    const ledger = newMemoryLedger()
    const first = commit(ledger, teamCreated(teamA, '甲团'))
    const second = commit(ledger, teamCreated(teamB, '乙团'))

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)

    const [eventA, eventB] = ledger.read({}).events
    expect(eventA?.previousEventId).toBeNull()
    expect(eventA?.sequence).toBe(1)
    expect(eventB?.previousEventId).toBe(eventA?.eventId)
    expect(ledger.verifyIntegrity().ok).toBe(true)
  })

  it('首条锚点被破坏（previousEventId 非 null）时自检报断裂', () => {
    const path = newFileLedgerPath()
    const ledger = openFileLedger(path)
    commit(ledger, teamCreated(teamA, '甲团'))
    ledger.close()

    // 触发器禁止 UPDATE，所以只能在一个**新库**上模拟锚点丢失：先出空库，
    // 再用外部连接插入一条 sequence=1 但指向了不存在的上一条的行。
    const brokenPath = newFileLedgerPath()
    const seed = openFileLedger(brokenPath)
    seed.close()
    const outsider = new DatabaseSync(brokenPath)
    try {
      outsider
        .prepare(
          `INSERT INTO ledger_events
             (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (1, 'evt-anchorless', 'team/created', 1, 'human', 'human-1', 'evt-ghost', NULL, '{}')`,
        )
        .run()
    } finally {
      outsider.close()
    }

    const reopened = openFileLedger(brokenPath)
    const integrity = reopened.verifyIntegrity()
    expect(integrity.ok).toBe(false)
    expect(integrity.brokenAt).toBe(1)
    expect(integrity.sequence).toBe(0)
  })

  it('链式断裂（第二条的 previousEventId 与第一条不符）被自检抓到', () => {
    const path = newFileLedgerPath()
    const seed = openFileLedger(path)
    seed.close()

    const outsider = new DatabaseSync(path)
    try {
      const insert = outsider.prepare(
        `INSERT INTO ledger_events
           (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
         VALUES (?, ?, 'team/created', 1, 'human', 'human-1', ?, NULL, '{}')`,
      )
      insert.run(1, 'evt-1', null)
      insert.run(2, 'evt-2', 'evt-not-the-previous-one')
    } finally {
      outsider.close()
    }

    const ledger = openFileLedger(path)
    expect(ledger.verifyIntegrity()).toEqual({ ok: false, sequence: 1, brokenAt: 2 })
  })
})

describe('AC-10-10 不导出可变视图真相（FR-10.2）', () => {
  it('公共出口里没有以 View / Projection / State 结尾的导出', async () => {
    const module: Record<string, unknown> = await import('../src/index.ts')
    const offending = Object.keys(module).filter((key) => /(View|Projection|State)$/.test(key))

    expect(offending).toEqual([])
    // 反向自检：这个正则确实能抓到这类名字（否则「没有」可能只是正则失效）。
    expect(['ChannelView', 'ActivityPanelState', 'LedgerProjection'].filter((k) => /(View|Projection|State)$/.test(k))).toHaveLength(3)
  })
})

describe('只追加契约的其他边界（t4 范围内的反恒真配套）', () => {
  it('close() 之后 commit / read 都被拒绝（不静默写进已关闭的库）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    ledger.close()

    expect(() => ledger.commit(teamCreated(teamB, '乙团'))).toThrow(/已关闭/)
    expect(() => ledger.read({})).toThrow(/已关闭/)
    // close 幂等。
    expect(() => ledger.close()).not.toThrow()
  })

  it('读回的事件与写入时不是同一个对象（调用方改不动账本里的事实）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      kind: 'team/created',
      data: { teamId: teamA, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name: '甲团' },
      actor: humanActor,
    })

    const first = ledger.read({}).events[0] as LedgerEvent
    // 试图篡改读回对象上的载荷：它必须是本次读出的副本。
    ;(first.data as { name: string }).name = '被篡改'

    expect(ledger.read({}).events[0]?.data).toMatchObject({ name: '甲团' })
  })

  it('非法的 kind 被 commit 拒绝（否则一条错字会永久毒化账本 —— OCR 评审 [1]）', () => {
    const ledger = newMemoryLedger()

    // 纯 JS 调用方或一个 `as` 强转就能走到这里。若放行，这条事件落盘后
    // read()/verifyIntegrity() 会把它读成「存储已被外部改写」，此后任何读取都抛错。
    expect(() =>
      ledger.commit({ kind: 'team/typo' as LedgerEventKind, data: {}, actor: humanActor }),
    ).toThrow(TypeError)

    // 账本必须仍然完全可用（这才是本用例的要害：不是「抛了错」，而是「没被毒化」）。
    commit(ledger, teamCreated(teamA, '甲团'))
    expect(ledger.read({}).events.map((e) => e.kind)).toEqual(['team/created'])
    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 1, brokenAt: null })
  })

  it('合法 kind 全集逐个仍可通过 commit（上面那条守卫没有误伤闭集）', () => {
    const ledger = newMemoryLedger()
    for (const kind of LEDGER_EVENT_KINDS) {
      expect(() => commit(ledger, { kind, data: {}, actor: humanActor })).not.toThrow()
    }
    expect(ledger.read({ limit: 1000 }).events).toHaveLength(LEDGER_EVENT_KINDS.length)
  })

  it('data 为标量时 commit 拒绝（否则会写出本包自己的 isLedgerEvent 都读不回的事件）', () => {
    const ledger = newMemoryLedger()

    expect(() => ledger.commit({ kind: 'team/created', data: 'x', actor: humanActor })).toThrow(TypeError)
    expect(() => ledger.commit({ kind: 'team/created', data: null, actor: humanActor })).toThrow(TypeError)
    expect(ledger.read({}).events).toHaveLength(0)
  })

  /**
   * 「入参是对象」不等于「落盘的是对象」—— 一类绕过 t5 的 OCR 扫描发现、captain 独立复现的缺陷。
   *
   * 每个用例都做**双向**断言，缺一不可：
   * - `commit` 抛错（挡住了）；
   * - 账本仍完全可读（**没被毒化**）—— 这才是要害。只断言「抛了错」而不管账本状态，
   *   会漏掉「抛错前已经写进去了」这种半成功。
   */
  describe('data 序列化后不是对象时被拒（防毒化账本）', () => {
    const poisoningCases: readonly (readonly [string, unknown])[] = [
      ['带 toJSON 返回数字的对象', { toJSON: () => 123 }],
      ['带 toJSON 返回字符串的对象', { toJSON: () => 'x' }],
      ['Date 实例', new Date(0)],
      ['new Number(5) 包装对象', new Number(5)],
      ['new String("x") 包装对象', new String('x')],
    ]

    it.each(poisoningCases)('%s 被 commit 拒绝', (_name, data) => {
      const ledger = newMemoryLedger()

      expect(() =>
        ledger.commit({ kind: 'team/created', data, actor: humanActor }),
      ).toThrow(/序列化后不是非 null 对象/)
      expect(ledger.read({}).events).toHaveLength(0)
    })

    it.each(poisoningCases)('%s 被拒后账本仍完全可用（未被毒化）', (_name, data) => {
      const ledger = newMemoryLedger()
      expect(() => ledger.commit({ kind: 'team/created', data, actor: humanActor })).toThrow()

      // 关键：此后 read 必须照常工作并返回后续正常提交的事件。
      commit(ledger, teamCreated(teamA, '甲团'))
      expect(ledger.read({}).events.map((e) => e.kind)).toEqual(['team/created'])
      expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 1, brokenAt: null })
    })

    it('toJSON 返回 undefined 同样被拒（JSON.stringify 会返回 undefined 而非字符串）', () => {
      const ledger = newMemoryLedger()
      let message = ''
      try {
        ledger.commit({ kind: 'team/created', data: { toJSON: () => undefined }, actor: humanActor })
        // 必须抛出（不接受）；没抛就说明这条载荷被放行，账本随后会被毒化。
        expect.unreachable('toJSON 返回 undefined 的载荷必须被拒绝')
      } catch (error) {
        message = (error as Error).message
      }

      // 断言**具体的**报错信息，而不是笼统的 TypeError：
      // 若只断言「抛了错」，那么删掉 `dataJson === undefined` 这道守卫也会通过 ——
      // 因为 `JSON.parse(undefined)` 同样抛 SyntaxError（被我 catch 后转成 TypeError）。
      // 两条路径的安全性相同，**信息质量不同**：走守卫的报错点明「JSON.stringify 返回了 undefined」
      // 并给出常见成因（toJSON 返回 undefined）；走 JSON.parse 的报错只说
      // 「"undefined" is not valid JSON」，会把调用方引向「载荷 JSON 语法有问题」这个错误方向。
      // 这条断言就是让这道守卫承重、而非「删了也一样的冗余代码」。
      expect(message).toContain('JSON.stringify 返回了 undefined')
      expect(message).toContain('toJSON')
      // 且账本仍可用（未被毒化）。
      expect(ledger.read({}).events).toHaveLength(0)
    })

    it('报错信息说清「序列化后」与成因（不能只说非法）', () => {
      const ledger = newMemoryLedger()
      let message = ''
      try {
        ledger.commit({ kind: 'team/created', data: new Date(0), actor: humanActor })
      } catch (error) {
        message = (error as Error).message
      }

      // 必须点明是**序列化之后**出的问题，并给出实际类型 —— 否则调用方会去查入参，方向是错的。
      expect(message).toContain('序列化后不是非 null 对象')
      expect(message).toContain('string')
      expect(message).toContain('toJSON')
    })

    it('对照：真正的纯对象载荷仍然通过（新校验不是「一律拒绝」）', () => {
      const ledger = newMemoryLedger()

      expect(() =>
        ledger.commit({ kind: 'team/created', data: { a: 1, nested: { b: [1, 2] } }, actor: humanActor }),
      ).not.toThrow()
      // 数组**不是**合法载荷（OCR 评审 [18]）：`LedgerEventMap` 里没有任何 kind 的载荷是数组，
      // 放行它会让按 kind 收窄的消费方读 `data.x` 得到 `undefined`（真实事故见 delegation.ts
      // 的 `findTeamCreatedFor`，那里的 OCR [12] 正是被这条放行所放大）。
      // 注意：数组**作为对象字段的值**仍然合法（上面第一条载荷的 `b: [1, 2]`）——
      // 收窄的是「载荷本身」，不是「载荷里的数组」。
      expect(() =>
        ledger.commit({ kind: 'team/created', data: [1, 2], actor: humanActor }),
      ).toThrow(/数组/)
      expect(ledger.read({}).events).toHaveLength(1)
      expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 1, brokenAt: null })
    })

    it('OCR [18] 反恒真：把 `Array.isArray(data)` 那一条删掉，本条必须变红', () => {
      // 这条把「数组被拒」钉成断言，而不是依赖上面那条对照测试顺带覆盖。
      const ledger = newMemoryLedger()
      let message = ''
      try {
        ledger.commit({ kind: 'team/member-added', data: [] as unknown, actor: humanActor })
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).not.toBe('')
      expect(message).toContain('数组')
      // 关键：被拒之后账本**没有留下任何行**（失败是原子的），否则会毒化后续每次 read()。
      expect(ledger.read({}).events).toHaveLength(0)
      expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 0, brokenAt: null })
    })

    it('不变量：commit 接受 ⟺ 读回 isLedgerEvent 接受（穷举一批代表性载荷，逐条对拍两条路径）', () => {
      // 这条把「两处形状判定不能分叉」变成可执行的检查：
      // 对每种载荷，分别记录「commit 是否接受」与「读回后 isLedgerEvent 是否接受」，
      // 两者必须一致。若将来 guards.ts 收紧了 data 判定而 ledger.ts 没跟上
      // （或反之），这里会立刻变红 —— 因为 commit 现在直接复用 isLedgerEvent 做判定，
      // 而不是各自写一遍 `typeof === 'object'`。
      const payloads: readonly (readonly [string, unknown])[] = [
        ['普通对象', { a: 1 }],
        ['嵌套对象', { member: { position: '灵台郎', name: '灵台郎', memberId } }],
        ['数组', [1, 2]],
        ['空对象', {}],
        ['带 toJSON 返回数字', { toJSON: () => 123 }],
        ['Date', new Date(0)],
        ['new Number', new Number(5)],
      ]

      for (const [name, data] of payloads) {
        const ledger = newMemoryLedger()
        let accepted = true
        try {
          ledger.commit({ kind: 'team/member-added', data, actor: humanActor })
        } catch {
          accepted = false
        }

        if (accepted) {
          // 接受了就必须能读回、且读回事件通过 isLedgerEvent（账本不能留读不回的脏行）。
          const events = ledger.read({}).events
          expect(events, `${name}：被接受就必须读得回`).toHaveLength(1)
          const only = events[0]
          expect(only, `${name}：读回的事件必须通过 isLedgerEvent`).toBeDefined()
          expect(isLedgerEvent(only), `${name}：被接受的载荷必须满足 isLedgerEvent`).toBe(true)
        } else {
          // 拒绝了就必须一行都没落（失败是原子的，不能留半条）。
          expect(ledger.read({}).events, `${name}：被拒绝就必须零落盘`).toHaveLength(0)
        }
      }
    })
  })

  it('requestId 非字符串被 commit 拒绝（否则会被 SQLite 静默转成别的字符串 —— OCR 评审 [2]）', () => {
    const ledger = newMemoryLedger()

    // 实测过的具体失效：传数字 123 ⇒ SQLite 存成 "123.0"，读回时伪装成合法 RequestId，
    // 「写进去的值」与「读出来的值」不同且无人报错。对象/布尔/数组则撞在
    // 「cannot be bound to SQLite parameter 8」这种与业务无关的报错上。
    for (const bad of [123, true, { x: 1 }, ['a'], null]) {
      expect(() =>
        ledger.commit({ kind: 'team/created', data: {}, actor: humanActor, requestId: bad as never }),
      ).toThrow(/requestId 必须是字符串或省略/)
    }
    expect(ledger.read({}).events).toHaveLength(0)

    // 对照：合法字符串仍通过，且读回值与写入值逐字相同（没有静默转换）。
    commit(ledger, { ...teamCreated(teamA, '甲团'), requestId: 'req-1' as never })
    expect(ledger.read({}).events[0]?.requestId).toBe('req-1')
  })

  it('requestId 省略时不落该列（与读回路径的 requestId 组装一致）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))

    const event = ledger.read({}).events[0]
    expect(event).toBeDefined()
    // 省略 ⇒ 读回对象上不该有这个键（而不是 null/undefined 混入）。
    expect(Object.hasOwn(event as object, 'requestId')).toBe(false)
  })

  it('坏行让 read() 抛错而 verifyIntegrity() 如实报告（刻意的取舍，非疏漏）', () => {
    const path = newFileLedgerPath()
    const seed = openFileLedger(path)
    commit(seed, teamCreated(teamA, '甲团'))
    seed.close()

    // 外部注入一条载荷序列化成标量的行（经本类的写入路径现在已不可能产生这种行）。
    const outsider = new DatabaseSync(path)
    try {
      outsider
        .prepare(
          `INSERT INTO ledger_events
             (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
           VALUES (2, 'evt-bad', 'team/created', 1, 'human', 'human-1', 'evt-1', NULL, '"scalar"')`,
        )
        .run()
    } finally {
      outsider.close()
    }

    const ledger = openFileLedger(path)

    // 取舍一：read() 抛错，**不**静默跳过坏行继续返回。理由见 ledger.ts 中该分支的注释
    // （FR-10.2 要求投影不得少一条事实却无提示；静默失真比可见失败更危险）。
    expect(() => ledger.read({})).toThrow(/不是合法的 LedgerEvent/)
    // 错误信息必须给出下一步，而不是只说「出错了」。
    try {
      ledger.read({})
    } catch (error) {
      expect((error as Error).message).toContain('verifyIntegrity')
    }

    // 取舍二：坏行**并非无从发现** —— verifyIntegrity 按 SPEC §6.4 报告而不抛错。
    expect(ledger.verifyIntegrity()).toEqual({ ok: false, sequence: 1, brokenAt: 2 })
  })

  it('非法 actor / 非法 occurredAt 被拒绝，且不落任何行（失败是原子的）', () => {
    const ledger = newMemoryLedger()

    expect(() =>
      ledger.commit({ kind: 'team/created', data: {}, actor: { kind: 'nobody' } as never }),
    ).toThrow(TypeError)
    expect(() =>
      ledger.commit({ kind: 'team/created', data: {}, actor: humanActor, occurredAt: -1 }),
    ).toThrow(TypeError)
    expect(() =>
      ledger.commit({ kind: 'team/created', data: {}, actor: humanActor, occurredAt: Number.NaN }),
    ).toThrow(TypeError)
    expect(ledger.read({}).events).toHaveLength(0)
  })

  it('OCR [41]：小数 occurredAt 在入口被拒（不再漏到 SQLite 的 REAL/INTEGER 错误）', () => {
    // `occurred_at` 是 STRICT 表的 INTEGER 列；SQLite 只在无损时把 REAL 转 INTEGER。
    // 修前实测：`occurredAt: 1758600000.5` 一路穿到 `insertStatement.run`，抛出
    // `cannot store REAL value in INTEGER column ledger_events.occurred_at` ——
    // 一个与业务无关的底层错误，而且**写读不对称**（读回侧同样放行小数）。
    // 反恒真：把校验改回 `Number.isFinite`，本条必须变红。
    const ledger = newMemoryLedger()
    expect(() =>
      ledger.commit({ kind: 'team/created', data: {}, actor: humanActor, occurredAt: 1758600000.5 }),
    ).toThrow(/安全整数/)
    // 失败必须是原子的：不落任何行（否则会毒化后续每次 read()）。
    expect(ledger.read({}).events).toHaveLength(0)
    // 对照：整数毫秒时间戳仍然通过。
    expect(() =>
      ledger.commit({ kind: 'team/created', data: {}, actor: humanActor, occurredAt: 1758600000000 }),
    ).not.toThrow()
  })

  it('OCR [40]：建库失败时不得泄漏连接（否则文件锁与句柄留到进程结束）', () => {
    // 修前实测：对一个「不是数据库」的文件调用 openLedger 会抛 `file is not a database`，
    // 但那条连接**仍持着文件句柄** —— 随后删除该文件报 EPERM（Windows 上句柄未释放的硬证据）。
    // 更糟：锁留着会让**后续** openLedger 撞上 busy_timeout。
    // 反恒真：去掉 `openLedger` 里 schema 初始化的 try/catch，本条必须变红（删除会 EPERM）。
    const path = newFileLedgerPath()
    writeFileSync(path, 'this is definitely not a sqlite database file')

    expect(() => openLedger({ path })).toThrow(/not a database|无法解析|file is not/i)

    // 句柄若泄漏，Windows 会拒删这个文件。
    expect(() => rmSync(path, { force: true })).not.toThrow()
  })

  it('注入时钟决定 occurredAt；省略时用时钟值而不是墙钟', () => {
    let tick = 1000
    const ledger = newMemoryLedger(() => {
      tick += 10
      return tick
    })

    const receipt = commit(ledger, teamCreated(teamA, '甲团'))

    expect(receipt.occurredAt).toBe(1010)
    expect(ledger.read({}).events[0]?.occurredAt).toBe(1010)
  })

  it('显式 occurredAt 覆盖注入时钟', () => {
    const ledger = newMemoryLedger(() => 1000)

    const receipt = commit(ledger, { ...teamCreated(teamA, '甲团'), occurredAt: 42 })

    expect(receipt.occurredAt).toBe(42)
  })

  it('head() 反映最后一条；空账本为 {sequence:0, eventId:null}', () => {
    const ledger = newMemoryLedger()
    expect(ledger.head()).toEqual({ sequence: 0, eventId: null })

    const first = commit(ledger, teamCreated(teamA, '甲团'))
    expect(ledger.head()).toEqual({ sequence: 1, eventId: first.eventId })

    const second = commit(ledger, teamCreated(teamB, '乙团'))
    expect(ledger.head()).toEqual({ sequence: 2, eventId: second.eventId })
  })

  it('requestId 被持久化并可读回（FR-5.3.4「不得绕开」按它绑定）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, {
      ...teamCreated(teamA, '甲团'),
      requestId: 'req-abc' as never,
    })

    expect(ledger.read({}).events[0]?.requestId).toBe('req-abc')
  })

  it('三类 actor 往返一致（human / host / member）', () => {
    const ledger = newMemoryLedger()
    const actors: readonly LedgerActor[] = [
      { kind: 'human', humanId: 'human-1' },
      { kind: 'host', hostSessionId: 'host-1' as never },
      { kind: 'member', memberId },
    ]
    for (const actor of actors) {
      commit(ledger, { ...teamCreated(teamA, '甲团'), actor })
    }

    expect(ledger.read({}).events.map((event) => event.actor)).toEqual(actors)
  })

  it('limit 非法值被拒绝，超过上限时收敛到 1000（不静默截断成别的数）', () => {
    const ledger = newMemoryLedger()
    commit(ledger, teamCreated(teamA, '甲团'))

    expect(() => ledger.read({ limit: 0 })).toThrow(RangeError)
    expect(() => ledger.read({ limit: 1.5 })).toThrow(RangeError)
    expect(() => ledger.read({ afterSequence: -1 })).toThrow(RangeError)
    // 上限收敛：1001 条上限被夹到 1000，故这里只返回实际存在的 1 条且不报错。
    expect(ledger.read({ limit: 1001 }).events).toHaveLength(1)
  })

  it('全部 20 种 kind 都能提交并读回（载荷与 kind 的映射不被提交路径破坏）', () => {
    const ledger = newMemoryLedger()
    const spec = { name: '新团', roster: [{ position: '灵台郎', count: 1 }], tasks: ['t'] }
    const payloads: Record<LedgerEventKind, unknown> = {
      'team/initialized': { teamId: teamA, kind: 'persistent', createdByHostSessionId: null },
      'team/created': { teamId: teamA, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name: '甲团' },
      // ⚠ 2026-09-24 新增 `team/destroyed`（团队级中止）：本表是 `Record<LedgerEventKind, unknown>` ⇒ 必加。
      'team/destroyed': { teamId: teamA, reason: null },
      'team/member-added': { teamId: teamA, member: memberIdentity, lifecycle: 'active' },
      'team/member-renamed': { teamId: teamA, memberId, from: '灵台郎', to: '灵台郎-2' },
      'team/member-suspended': { teamId: teamA, memberId, from: 'active', to: 'suspended' },
      'team/member-resumed': { teamId: teamA, memberId, from: 'suspended', to: 'active' },
      'team/member-destroyed': { teamId: teamA, memberId, from: 'archived', to: 'destroyed' },
      'team/member-model-switched': {
        teamId: teamA,
        memberId,
        from: { provider: 'p', model: 'm1' },
        to: { provider: 'p', model: 'm2' },
        reason: '人工换模',
        trigger: 'human',
        effectiveAtSequence: 1,
      },
      'team/channel-created': { channelId: 'ch-1', teamId: teamA, title: '频道' },
      'team/thread-started': { threadId: 'th-1', channelId: 'ch-1', title: '线程', assigneeMemberId: null },
      // ⚠ 因新增 `team/message-sent` 而必加（A 类）：本表是 `Record<LedgerEventKind, unknown>`。
      'team/message-sent': {
        messageId: 'msg-1',
        channelId: 'ch-1',
        threadId: 'th-1',
        senderMemberId: memberId,
        body: '正文',
      },
      'plan/approved': { planId: plan1, mode: 'persistent-team', operator: 'human-1' },
      'spawn/awaiting-human-approval': {
        requestId: 'req-1',
        requesterMemberId: memberId,
        principalMemberId: otherMemberId,
        targetKind: 'persistent',
        spec,
      },
      'spawn/principal-rejected': {
        requestId: 'req-2',
        requesterMemberId: memberId,
        principalMemberId: otherMemberId,
        targetKind: 'persistent',
        reason: '不合规',
      },
      'spawn/human-approved': {
        requestId: 'req-3',
        requesterMemberId: memberId,
        principalMemberId: otherMemberId,
        humanOperatorId: 'human-1',
        targetKind: 'persistent',
        spec,
        decision: 'approve',
      },
      'spawn/human-rejected': {
        requestId: 'req-4',
        requesterMemberId: memberId,
        principalMemberId: otherMemberId,
        humanOperatorId: 'human-1',
        targetKind: 'persistent',
        spec,
        decision: 'reject',
        reason: '暂缓',
      },
      'team/ownership-reattached': { teamId: teamA, from: memberId, to: otherMemberId, reason: '父成员消失' },
      'dag/team-created': {
        dagTeamId: dagTeam1,
        ownerMemberId: memberId,
        parentTeamId: teamA,
        requestedByTransfer: false,
      },
      'dag/ownership-transferred': { dagTeamId: dagTeam1, from: memberId, to: otherMemberId },
      'dag/task-state-changed': { dagTeamId: dagTeam1, taskId: 'task-1', from: 'pending', to: 'running' },
    }

    const kinds = Object.keys(payloads) as LedgerEventKind[]
    // ⚠ 19 → 20 → 21：**因新增 `team/message-sent`、`team/destroyed` 而必更**（A 类）。
    expect(kinds).toHaveLength(21)
    for (const kind of kinds) {
      commit(ledger, { kind, data: payloads[kind], actor: humanActor })
    }

    const readBack = ledger.read({ limit: 1000 })
    expect(readBack.events.map((event) => event.kind)).toEqual(kinds)
    // 21 条全部落账 ⇒ 序号即 21（跟着上面的条数一起更，不是独立的事实）。
    expect(ledger.verifyIntegrity()).toEqual({ ok: true, sequence: 21, brokenAt: null })
    // 每条都被 changeScopesOf 处理过（穷尽性由 tsc 保证，这里是运行期确认不抛）。
    for (const event of readBack.events) {
      expect(() => changeScopesOf(event)).not.toThrow()
    }
  })

  it('事件 ID 全局唯一（同一毫秒内连续提交也不重复）', () => {
    const ledger = newMemoryLedger(() => 1234)
    const ids = new Set<string>()
    for (let index = 0; index < 50; index += 1) {
      ids.add(commit(ledger, teamCreated(teamA, `团-${index}`)).eventId as string)
    }

    expect(ids.size).toBe(50)
  })
})

/*
 * ## 反恒真抽检记录（SPEC §7.3 第 3 步）
 *
 * 每条都在本文件**跑绿之后**把实现故意改坏、确认对应用例变红、再还原复跑：
 *
 * 1. 删掉 `LEDGER_SCHEMA_SQL` 里的两条 `CREATE TRIGGER` ⇒ AC-10-6 的三个用例变红
 *    （UPDATE/DELETE 不再抛错）。
 * 2. 把 `read` 的 scope 判定改成恒真（`queryKeys === null || true`）⇒ AC-10-1、AC-10-2、AC-10-4 变红。
 * 3. 把 `nextCursor` 改成恒返回 0 ⇒ AC-10-3 变红。
 * 4. 把空 scope（`[]`）当成「匹配所有」⇒ AC-10-4 的第二个用例变红。
 * 5. 把 `verifyIntegrity` 的序号连续性检查删掉 ⇒ AC-10-8 变红。
 * 6. 让 `team/member-added` 只返回 team scope ⇒ AC-10-2 的第一个用例变红。
 *
 * 另有**两个不构成缺陷的存活变异体**，如实记录（避免后来者把它们当成测试缺口）：
 *
 * - 「删掉 `scopes: []` 的短路段」确实全绿 —— 但这不是漏测：短路只是把「必然空」的答案
 *   提前返回，去掉后走完整循环得到**完全相同**的返回值，两者语义等价，
 *   不存在一个能区分它们的输出。它是**等价变异体**，不是未覆盖分支。
 *   该短路的价值是省掉一次全表扫描（性能），而性能差异在本包的单测口径里测不到。
 * - 「把完整性自检的分页循环改成只看第一批」**曾经**全绿 —— 那是**真实缺口**：
 *   当时所有用例的账本都短于一个批（256 行），跨批行为结构性不可见。
 *   已补两条跨批用例（300 条账本、空洞落在第一批之外）后，该变异体被捕获。
 */
