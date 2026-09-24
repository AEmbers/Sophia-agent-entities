/**
 * 视图投影的验收测试（`t3`，FR-10.2 / FR-10.3）。
 *
 * ## 本文件的断言为什么不是恒真的
 *
 * 每条用例都写明「怎么让它变红」。核心的三条：
 * - **scope 增量 ≡ 全量**：不是拿两个都调同一个函数的结果互比 —— 增量路径走
 *   `catchUpFold`（`maxPages: 1`，一页一页爬），全量路径走 `rebuildFold`。
 *   两者若在游标、分页或 scope 上任一处写错，`toEqual` 立刻红。
 *   反恒真：把 `catchUpFold` 收口时的 `ledger.head().sequence` 改成
 *   `page.events.at(-1)?.sequence ?? 0`，带 scope 的用例会因游标重复而红
 *   （不带 scope 时两者相等，故**必须**有带 scope 的那条用例才抓得住 —— 见下）。
 * - **墓碑语义**：`archived` 与 `destroyed` 各自有用例（**分支级不可测**是本团
 *   已固化的一条教训：一个 `tombstone` 判定若有两条分支而只测一条，另一条改恒真仍全绿）。
 *   反恒真：把 `isTombstone` 的 `destroyed` 分支改成 `return false` → 对应用例必红。
 * - **未读计数是在**过滤**、不是在全量数**：配一条「频道创建不计入」的负向对照。
 *   反恒真：把 `unreadByMember` 里的 `scopes` 去掉（改成读全部）→ 负向对照必红。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LEDGER_EVENT_KINDS,
  UNSCOPED_EVENT_KINDS,
  catchUpFold,
  changeScopesOf,
  emptyProjectionFold,
  foldLedgerEvents,
  openLedger,
  projectChannel,
  projectRoster,
  projectThread,
  rebuildFold,
  scopesForMember,
  scopesForTeam,
  unreadByMember,
  type ChannelId,
  type ChannelSnapshot,
  type Ledger,
  type LedgerActor,
  type LedgerCommitInput,
  type LedgerEventKind,
  type MemberId,
  type MemberIdentity,
  type ProjectionFold,
  type TeamId,
  type ThreadId,
} from '../src/index.ts'

const teamA = 'team-a' as TeamId
const teamB = 'team-b' as TeamId
const channel1 = 'ch-1' as ChannelId
const channel2 = 'ch-2' as ChannelId
const thread1 = 'th-1' as ThreadId
const thread2 = 'th-2' as ThreadId
const thread3 = 'th-3' as ThreadId
const threadOther = 'th-other' as ThreadId
const memberA = 'sophia-lingtai-lang-aaaa1111' as MemberId
const memberB = 'sophia-lingtai-lang-bbbb2222' as MemberId
const memberElsewhere = 'sophia-tuibu-zhushi-cccc3333' as MemberId

const humanActor: LedgerActor = { kind: 'human', humanId: 'human-1' }

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

function newLedger(): Ledger {
  const ledger = openLedger({ path: ':memory:' })
  openLedgers.push(ledger)
  return ledger
}

/**
 * 建一个**真实文件**账本（返回路径）。
 *
 * 竞态用例需要**两条独立连接**指向同一个库文件 —— `:memory:` 做不到这点：
 * 每条连接各是一个独立的内存库，`other.commit()` 影响不到 `main`，
 * 于是「并发提交」根本不会发生，测试会**恒绿**（这是最容易写出的假断言）。
 */
function newFileLedgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sophia-projection-'))
  tempDirs.push(dir)
  return join(dir, 'ledger.db')
}

/** 打开文件账本；与 `newLedger` 同样登记进 afterEach 统一关闭。 */
function openFileLedger(path: string): Ledger {
  const ledger = openLedger({ path })
  openLedgers.push(ledger)
  return ledger
}

function commit(ledger: Ledger, input: LedgerCommitInput): void {
  ledger.commit(input)
}

// ── 事件构造helper（每个 kind 一份，避免测试之间手抄载荷而各自写错）──────────

function teamCreated(teamId: TeamId, name: string, parentTeamId: TeamId | null = null): LedgerCommitInput {
  return {
    kind: 'team/created',
    data: { teamId, kind: 'persistent', ownerMemberId: null, parentTeamId, name },
    actor: humanActor,
  }
}

function identity(position: string, name: string, memberId: MemberId): MemberIdentity {
  return { position, name, memberId }
}

/**
 * 建一条 `team/member-added`。
 *
 * `model` 默认 `null`（= 旧形态 / 跟随全局默认）。要测「带初始模型」的分支时显式传
 * `{provider, model}` —— 两个分支**各有各的用例**（见第 ⑨ 节）：
 * 本批已反复出现「分支级不可测」，一个判定若只测一条分支，另一条改恒真仍会全绿。
 */
function memberAdded(
  teamId: TeamId,
  member: MemberIdentity,
  model: { readonly provider: string; readonly model: string } | null = null,
): LedgerCommitInput {
  return {
    kind: 'team/member-added',
    data: { teamId, member, lifecycle: 'active', model },
    actor: humanActor,
  }
}

/**
 * 建一条**旧形态**的 `team/member-added`（载荷里**根本没有** `model` 键）。
 *
 * 它与 `memberAdded(..., null)` 不是一回事，二者都要测：
 * - `model: null` = 新写入方**显式表态**「成员跟随全局默认」；
 * - **无 `model` 键** = 本字段引入**之前**落进账本的既有事件 —— 账本只追加、不可改写，
 *   所以这种形态会**永远**存在，折叠必须兼容它。
 * 用类型断言构造，因为类型层已把它收窄成必填（这正是「旧账本无法用类型表达」的现实）。
 */
function legacyMemberAdded(teamId: TeamId, member: MemberIdentity): LedgerCommitInput {
  return {
    kind: 'team/member-added',
    data: { teamId, member, lifecycle: 'active' } as unknown,
    actor: humanActor,
  }
}

/** 生命周期变更事件。**故意允许 `to` 取任意生命周期** —— 见 `member-archived` 的用例说明。 */
function lifecycleChanged(
  kind: 'team/member-suspended' | 'team/member-resumed' | 'team/member-destroyed',
  teamId: TeamId,
  memberId: MemberId,
  from: string,
  to: string,
): LedgerCommitInput {
  return { kind, data: { teamId, memberId, from, to }, actor: humanActor }
}

function channelCreated(teamId: TeamId, channelId: ChannelId, title: string): LedgerCommitInput {
  return { kind: 'team/channel-created', data: { channelId, teamId, title }, actor: humanActor }
}

function threadStarted(
  channelId: ChannelId,
  threadId: ThreadId,
  title: string,
  assigneeMemberId: MemberId | null = null,
): LedgerCommitInput {
  return { kind: 'team/thread-started', data: { threadId, channelId, title, assigneeMemberId }, actor: humanActor }
}

// ── 断言辅助 ────────────────────────────────────────────────────────────────

/** Map → 按 key 排序的条目数组：`toEqual` 对 Map 的 diff 很难读，且顺序敏感。 */
function sortedEntries<V>(map: ReadonlyMap<string, V>): readonly (readonly [string, V])[] {
  return [...map.entries()]
    .map(([key, value]) => [String(key), value] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
}

/** 折叠的**可比内容**（游标之外的一切）。用于「增量 ≡ 全量」的对拍。 */
function foldContent(fold: ProjectionFold): unknown {
  return {
    teams: sortedEntries(fold.teams),
    members: sortedEntries(fold.members),
    channels: sortedEntries(fold.channels),
    threads: sortedEntries(fold.threads),
    malformedEvents: fold.malformedEvents,
    unresolvedReferences: fold.unresolvedReferences,
  }
}

/**
 * 一页一页地爬完（`maxPages: 1`），模拟真实调用方的增量节奏。
 *
 * 用 `for` + 硬上限而不是 `while (hasMore)`：万一 `hasMore` 的实现坏了（永远为 true），
 * 测试会以明确的消息失败，而不是把测试进程挂死。
 */
function drainIncremental(ledger: Ledger, maxPages = 1): ProjectionFold {
  let fold = emptyProjectionFold()
  for (let step = 0; step < 10_000; step += 1) {
    const outcome = catchUpFold(ledger, fold, { maxPages })
    fold = outcome.fold
    if (!outcome.hasMore) return fold
  }
  throw new Error('drainIncremental 未收敛：hasMore 在 10000 步后仍为 true')
}

function rosterOf(fold: ProjectionFold, teamId: TeamId) {
  const roster = projectRoster(fold, teamId)
  if (roster === null) throw new Error(`测试前置失败：折叠里没有团 ${String(teamId)}`)
  return roster
}

// ════════════════════════════════════════════════════════════════════════════
// ① 空账本
// ════════════════════════════════════════════════════════════════════════════

describe('① 空账本（没有事实就没有视图，且不抛错）', () => {
  it('全量重建空账本：游标 0、四张表全空、两个异常计数都是 0', () => {
    const ledger = newLedger()
    const outcome = rebuildFold(ledger)

    expect(outcome.hasMore).toBe(false)
    expect(outcome.fold.cursor).toBe(0)
    expect(outcome.fold.teams.size).toBe(0)
    expect(outcome.fold.members.size).toBe(0)
    expect(outcome.fold.channels.size).toBe(0)
    expect(outcome.fold.threads.size).toBe(0)
    expect(outcome.fold.malformedEvents).toBe(0)
    expect(outcome.fold.unresolvedReferences).toBe(0)
    // 空账本只需一次往返（`read` 一次就报 hasMore=false）。
    expect(outcome.pagesRead).toBe(1)
  })

  it('增量读取空账本：游标不前进、coverage 声明无 scope 过滤', () => {
    const ledger = newLedger()
    const outcome = catchUpFold(ledger, emptyProjectionFold())

    expect(outcome.fold.cursor).toBe(0)
    expect(outcome.hasMore).toBe(false)
    expect(outcome.coverage.scoped).toBe(false)
    expect(outcome.coverage.unscopedKindsOmitted).toEqual([])
  })

  it('未知团的 roster 是 null（「账本里没有这个团」≠「团在但没成员」）', () => {
    const ledger = newLedger()
    const fold = rebuildFold(ledger).fold

    // 反恒真：让 projectRoster 对未知团返回一份空名册 → 本条必红。
    expect(projectRoster(fold, teamA)).toBeNull()
  })

  it('未知频道返回 channel:null 的空壳；未知线程返回 null', () => {
    const ledger = newLedger()
    const fold = rebuildFold(ledger).fold

    const channel: ChannelSnapshot = projectChannel(fold, channel1)
    expect(channel.channel).toBeNull()
    expect(channel.threads).toEqual([])
    expect(projectThread(fold, thread1)).toBeNull()
  })

  it('空账本上按成员算未读：0 条，newestSequence 是 null 而不是 0', () => {
    const ledger = newLedger()
    const unread = unreadByMember(ledger, { memberId: memberA, sinceSequence: 0 })

    expect(unread.memberId).toBe(memberA)
    expect(unread.count).toBe(0)
    // 用 0 表示「没有」会让「序号 0 的未读」与「没有未读」不可区分。
    expect(unread.newestSequence).toBeNull()
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ② 单频道多线程
// ════════════════════════════════════════════════════════════════════════════

describe('② 单频道多线程（频道/线程的归属过滤）', () => {
  /** 场景：A 团两个频道；ch-1 下三条线程，ch-2 下一条。 */
  function seed(): Ledger {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, channelCreated(teamA, channel1, '主频道'))
    commit(ledger, channelCreated(teamA, channel2, '附频道'))
    commit(ledger, threadStarted(channel1, thread3, '线程三', memberB))
    commit(ledger, threadStarted(channel1, thread1, '线程一', memberA))
    commit(ledger, threadStarted(channel1, thread2, '线程二'))
    commit(ledger, threadStarted(channel2, threadOther, '别频道线程', memberA))
    return ledger
  }

  it('三条线程都落在 ch-1，且按启动序号（不是字典序）排列', () => {
    const fold = rebuildFold(seed()).fold
    const channel = projectChannel(fold, channel1)

    expect(channel.channel?.title).toBe('主频道')
    // 启动顺序是 th-3, th-1, th-2 —— 若实现按 ID 排序，这里会得到 th-1, th-2, th-3 而变红。
    expect(channel.threads.map((thread) => thread.threadId)).toEqual([thread3, thread1, thread2])
    expect(channel.threads.map((thread) => thread.title)).toEqual(['线程三', '线程一', '线程二'])
  })

  it('线程的 assignee 原样投影；未认领的是 null（不被当成缺失字段丢掉）', () => {
    const fold = rebuildFold(seed()).fold
    const channel = projectChannel(fold, channel1)

    expect(channel.threads.map((thread) => thread.assigneeMemberId)).toEqual([
      memberB,
      memberA,
      null,
    ])
  })

  it('ch-2 只看到自己的那一条（按 channelId 过滤真的在过滤）', () => {
    const fold = rebuildFold(seed()).fold
    const channel = projectChannel(fold, channel2)

    // 反恒真：把 projectChannel 的 `fact.channelId !== channelId` 判断删掉 → 本条变红（会看到 4 条）。
    expect(channel.threads.map((thread) => thread.threadId)).toEqual([threadOther])
  })

  it('projectThread 按 ID 取单条，字段与频道视图里的一致', () => {
    const fold = rebuildFold(seed()).fold
    const channel = projectChannel(fold, channel1)
    const fromChannel = channel.threads.find((thread) => thread.threadId === thread2)

    expect(projectThread(fold, thread2)).toEqual(fromChannel)
    expect(projectThread(fold, thread2)?.title).toBe('线程二')
  })

  it('roster 的 channelIds 按创建序号升序，且**只含本团频道**', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    // ⚠ 交错创建、且**故意倒序命名**：若按 ID 字典序排，会得到 ch-1, ch-2（假绿）；
    // 真实的创建序号是 ch-2 先于 ch-1，所以正确答案是 [ch-2, ch-1]。
    commit(ledger, channelCreated(teamA, channel2, '先建的'))
    commit(ledger, channelCreated(teamB, 'ch-b' as ChannelId, '邻团频道'))
    commit(ledger, channelCreated(teamA, channel1, '后建的'))

    const fold = rebuildFold(ledger).fold

    // 反恒真（已实测）：
    //  · 把 `filter((c) => c.teamId === teamId)` 删掉 → 本站会看到 3 个频道而变红；
    //  · 把排序换成 ID 字典序 → 会得到 [ch-1, ch-2] 而变红。
    expect(rosterOf(fold, teamA).channelIds).toEqual([channel2, channel1])
    expect(rosterOf(fold, teamB).channelIds).toEqual(['ch-b' as ChannelId])
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ③ 成员生命周期与墓碑（每个分支各一条用例）
// ════════════════════════════════════════════════════════════════════════════

describe('③ 成员 archived / destroyed 后的视图（墓碑语义，NFR-4 / FR-9.3）', () => {
  /**
   * ⚠ **契约缺口（如实记录，未绕过）**：账本的 19 个 kind 里**没有任何一个**
   * 记录「active → archived」这一次转换 —— 生命周期事件只有
   * `team/member-suspended` / `resumed` / `destroyed` 三个。
   * 而 `MemberLifecycle` 有 `archived` 这个取值，`tests/ledger.spec.ts:1183` 也把
   * `{from:'archived', to:'destroyed'}` 当成合法载荷来用。
   *
   * 也就是说：**「成员被归档」这个事实在账本词汇表里没有专门的 kind**。
   * 本测试因此用「载荷的 `to` 直接写 `'archived'`」来构造该状态。
   * 这不是测试在将就实现 —— 它正是 `foldLedgerEvents` **按 `to` 折叠、不按 kind 硬编码**
   * 的原因（见该函数里那段注释）：若按 kind 推断，`archived` 在投影层结构上不可达。
   *
   * 反恒真：把 `foldLedgerEvents` 的生命周期分支改成按 kind 映射
   * （suspended→'suspended' 等），本条用例会因 lifecycle 得到 `'suspended'` 而**变红**。
   */
  function archiveMember(ledger: Ledger, memberId: MemberId): void {
    commit(ledger, lifecycleChanged('team/member-suspended', teamA, memberId, 'active', 'archived'))
  }

  function seedWith(lifecycle: 'active' | 'suspended' | 'archived' | 'destroyed'): Ledger {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    switch (lifecycle) {
      case 'active':
        break
      case 'suspended':
        commit(ledger, lifecycleChanged('team/member-suspended', teamA, memberA, 'active', 'suspended'))
        break
      case 'archived':
        archiveMember(ledger, memberA)
        break
      case 'destroyed':
        archiveMember(ledger, memberA)
        commit(ledger, lifecycleChanged('team/member-destroyed', teamA, memberA, 'archived', 'destroyed'))
        break
    }
    return ledger
  }

  function onlyMember(ledger: Ledger) {
    const roster = rosterOf(rebuildFold(ledger).fold, teamA)
    expect(roster.members).toHaveLength(1)
    const [first] = roster.members
    if (first === undefined) throw new Error('测试前置失败：roster 为空')
    return first
  }

  it('active：留在名册里，不是墓碑', () => {
    const member = onlyMember(seedWith('active'))
    expect(member.lifecycle).toBe('active')
    expect(member.tombstone).toBe(false)
  })

  it('suspended：留在名册里，仍不是墓碑（挂起是可逆的，FR-9.1）', () => {
    // 这一条专门把 `isTombstone` 的 suspended 分支与 archived 分支区分开 ——
    // 若实现写成 `lifecycle !== 'active'`，本条必红。
    const member = onlyMember(seedWith('suspended'))
    expect(member.lifecycle).toBe('suspended')
    expect(member.tombstone).toBe(false)
  })

  it('archived：**仍在名册里**（墓碑语义）且标记为墓碑，名册不因归档而少人', () => {
    const ledger = seedWith('archived')
    const roster = rosterOf(rebuildFold(ledger).fold, teamA)

    // 反恒真：让 projectRoster 过滤掉 archived → 本条必红（members 会变成空数组）。
    expect(roster.members).toHaveLength(1)
    const [member] = roster.members
    expect(member?.lifecycle).toBe('archived')
    expect(member?.tombstone).toBe(true)
  })

  it('destroyed：同样留在名册里且是墓碑（NFR-4：销毁后账本记录仍可审计）', () => {
    // 反恒真：把 isTombstone 的 destroyed 分支改成 `return false` → 本条必红。
    const member = onlyMember(seedWith('destroyed'))
    expect(member.lifecycle).toBe('destroyed')
    expect(member.tombstone).toBe(true)
  })

  it('归档后，该成员**归档之前**的事实仍可读（历史不因归档而消失）', () => {
    const ledger = seedWith('archived')
    const fold = rebuildFold(ledger).fold

    const member = rosterOf(fold, teamA).members[0]
    // 三层标识与出现序号都是归档前就落下的，必须还在。
    expect(member?.position).toBe('灵台郎')
    expect(member?.name).toBe('灵台郎')
    expect(member?.displayName).toBe('灵台郎')
    // `team/member-added` 是第 2 条事件。
    expect(member?.appearedAtSequence).toBe(2)
  })

  it('同团可存在两个同名成员（归档释放名字，SPEC §3.5）—— roster 按 ID 去重而非按名字', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    archiveMember(ledger, memberA)
    // 名字已被释放，第二个成员可以合法地叫同一个名字。
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberB)))

    const roster = rosterOf(rebuildFold(ledger).fold, teamA)

    // 反恒真：让 projectRoster 按 `name` 去重（`new Map(members.map(m => [m.name, m]))`）→ 本条必红。
    expect(roster.members).toHaveLength(2)
    expect(new Set(roster.members.map((member) => member.memberId)).size).toBe(2)
    // 排序按 `appearedAtSequence`：先归档的那个（memberA，seq 2）在前，故是 [墓碑, 活的]。
    expect(roster.members.map((member) => member.memberId)).toEqual([memberA, memberB])
    expect(roster.members.map((member) => member.tombstone)).toEqual([true, false])
  })

  it('roster 只装本团成员（邻团成员不串进来）', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, memberAdded(teamB, identity('推步主事', '推步主事', memberElsewhere)))

    const fold = rebuildFold(ledger).fold
    expect(rosterOf(fold, teamA).members.map((member) => member.memberId)).toEqual([memberA])
    expect(rosterOf(fold, teamB).members.map((member) => member.memberId)).toEqual([memberElsewhere])
  })

  it('换模后 roster 带最新模型；未换过模的成员是 null', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, memberAdded(teamA, identity('推步主事', '推步主事', memberB)))
    commit(ledger, {
      kind: 'team/member-model-switched',
      data: {
        teamId: teamA,
        memberId: memberA,
        from: { provider: 'p', model: 'm1' },
        to: { provider: 'p', model: 'm2' },
        reason: '人工换模',
        trigger: 'human',
        effectiveAtSequence: 2,
      },
      actor: humanActor,
    })

    const members = rosterOf(rebuildFold(ledger).fold, teamA).members
    expect(members.find((member) => member.memberId === memberA)?.model).toEqual({
      provider: 'p',
      model: 'm2',
    })
    // 反恒真：把「未换模 → null」改成给个默认模型 → 本条必红。
    expect(members.find((member) => member.memberId === memberB)?.model).toBeNull()
  })

  it('改名后 roster 用最新名字；displayName 按 FR-5A.4 的**两条分支**各自裁决', () => {
    // 分支一：`职位名-<序号>` ⇒ **露出序号**（这正是「重名需要区分时」的场合）。
    const renamed = newLedger()
    commit(renamed, teamCreated(teamA, '甲团'))
    commit(renamed, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(renamed, {
      kind: 'team/member-renamed',
      data: { teamId: teamA, memberId: memberA, from: '灵台郎', to: '灵台郎-2' },
      actor: humanActor,
    })

    const withIndex = onlyMember(renamed)
    expect(withIndex.name).toBe('灵台郎-2')
    // 反恒真：把 `projectRoster` 的 displayName 改成恒等 `fact.name` → 下一条（分支二）必红。
    expect(withIndex.displayName).toBe('灵台郎-2')

    // 分支二：名字与职位**脱钩**（既不是职位名、也不是 `职位名-数字`）⇒ 收敛回**职位名**。
    // 依据 FR-5A.4「显示名与图上标签始终一致」：职位标签已烧进素材像素，不可改写。
    // 这一条是本用例的价值所在 —— 只有它能把「直接用 name」与「经过 displayNameOf」区分开。
    const decoupled = newLedger()
    commit(decoupled, teamCreated(teamA, '甲团'))
    commit(decoupled, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(decoupled, {
      kind: 'team/member-renamed',
      data: { teamId: teamA, memberId: memberA, from: '灵台郎', to: '查无此职' },
      actor: humanActor,
    })

    const drifted = onlyMember(decoupled)
    expect(drifted.name).toBe('查无此职')
    expect(drifted.displayName).toBe('灵台郎')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ④ scope 增量与全量结果一致
// ════════════════════════════════════════════════════════════════════════════

describe('④ scope 增量 ≡ 全量（FR-10.2 的可执行定义）', () => {
  /** 造一个够杂的账本：两个团、多个成员、频道、线程、以及一条畸形载荷。 */
  function seedMixed(): Ledger {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, teamCreated(teamB, '乙团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, memberAdded(teamB, identity('推步主事', '推步主事', memberElsewhere)))
    commit(ledger, channelCreated(teamA, channel1, '主频道'))
    commit(ledger, threadStarted(channel1, thread1, '线程一', memberA))
    commit(ledger, threadStarted(channel1, thread2, '线程二'))
    commit(ledger, lifecycleChanged('team/member-suspended', teamA, memberA, 'active', 'suspended'))
    commit(ledger, lifecycleChanged('team/member-resumed', teamA, memberA, 'suspended', 'active'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberB)))
    // 一条**结构合法但载荷空洞**的事件：`isLedgerEvent` 只验「data 是非 null 对象」，
    // 不验载荷与 kind 匹配，所以它真的能落账（commit 也只做结构校验）。
    // 投影必须**拒绝采信**它、并把它计入 `malformedEvents`，而不是造出一个 teamId=undefined 的团。
    commit(ledger, { kind: 'team/created', data: {}, actor: humanActor })
    return ledger
  }

  it('一页一页爬（maxPages=1）的结果与一次性全量重建**逐字段相等**', () => {
    const ledger = seedMixed()

    const incremental = drainIncremental(ledger)
    const full = rebuildFold(ledger).fold

    // 反恒真：让 catchUpFold 收口时用 `page.events.at(-1)` 而非 `ledger.head()` →
    // 不带 scope 时二者恰好相等，**故本条抓不住它**；抓住它的是下面那条带 scope 的用例。
    expect(foldContent(incremental)).toEqual(foldContent(full))
    // 游标也必须收敛到账本头部。
    expect(incremental.cursor).toBe(ledger.head().sequence)
    expect(full.cursor).toBe(ledger.head().sequence)
  })

  it('分多页也一致（limit=2 逼出真实分页边界）', () => {
    const ledger = seedMixed()

    let fold = emptyProjectionFold()
    for (let step = 0; step < 10_000; step += 1) {
      const outcome = catchUpFold(ledger, fold, { limit: 2 })
      fold = outcome.fold
      if (!outcome.hasMore) break
    }

    expect(foldContent(fold)).toEqual(foldContent(rebuildFold(ledger).fold))
    expect(fold.cursor).toBe(ledger.head().sequence)
  })

  it('增量是**真增量**：第二批只读新增部分，且结果等同全量', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))

    const first = catchUpFold(ledger, emptyProjectionFold())
    expect(first.hasMore).toBe(false)
    const cursorAfterFirst = first.fold.cursor
    expect(cursorAfterFirst).toBe(2)

    // 新事实进来。
    commit(ledger, channelCreated(teamA, channel1, '主频道'))
    commit(ledger, threadStarted(channel1, thread1, '线程一'))

    const second = catchUpFold(ledger, first.fold)
    expect(second.fold.cursor).toBe(4)
    // 旧事实没丢（不是「重新开始」），新事实进来了。
    expect(second.fold.members.size).toBe(1)
    expect(second.fold.channels.size).toBe(1)
    expect(second.fold.threads.size).toBe(1)
    expect(foldContent(second.fold)).toEqual(foldContent(rebuildFold(ledger).fold))
  })

  it('带 team scope 的增量：团/成员/频道与全量一致，线程为空**且被 coverage 声明**', () => {
    const ledger = seedMixed()

    let fold = emptyProjectionFold()
    for (let step = 0; step < 10_000; step += 1) {
      const outcome = catchUpFold(ledger, fold, { scopes: scopesForTeam(teamA) })
      fold = outcome.fold
      if (!outcome.hasMore) break
    }
    const full = rebuildFold(ledger).fold

    // 游标仍必须收敛到头部：带 scope 时**不匹配的事件被跳过**，
    // 若收口用「末条匹配事件的序号」，游标会停在中间 —— 这就是反恒真的抓手。
    expect(fold.cursor).toBe(ledger.head().sequence)

    // 团 scope 覆盖：本团的团/成员/频道，与全量中属于本团的部分一致。
    expect(sortedEntries(fold.teams)).toEqual(sortedEntries(new Map([[teamA, full.teams.get(teamA)]])))

    // ⚠ 成员数**不等于**全量：`seedMixed` 里 teamB 也有一个成员，
    // 而 `{kind:'team', teamId:A}` 按 `changeScopesOf` **不该**把邻团成员带进来
    // （`team/member-added` 投的是 [memberScope(自己), teamScope(它的团)]）。
    // 全量 3 人（A 两人 + B 一人），带 A 团 scope 只该看到 2 人。
    // 反恒真：把 `catchUpFold` 的 scope 过滤去掉 → 这里会读到 3 人而必红。
    expect(full.members.size).toBe(3)
    expect(fold.members.size).toBe(2)
    expect(fold.members.has(memberElsewhere)).toBe(false)
    // 本团那两个人的事实必须与全量**逐字段相同**（过滤只该少人，不该改人）。
    for (const memberId of [memberA, memberB]) {
      expect(fold.members.get(memberId)).toEqual(full.members.get(memberId))
    }

    // 本场景里两个频道都属于 teamA，故频道数与全量一致；显式记下这个前提，
    // 免得日后往 seedMixed 里加一个邻团频道时，这里的相等断言变成**假红**或**假绿**。
    expect(full.channels.size).toBe(1)
    expect(fold.channels.size).toBe(1)

    // 邻团（teamB）必须**没**被读进来 —— 证明 scope 过滤真的在过滤。
    expect(fold.teams.has(teamB)).toBe(false)

    // 线程结构上不可达：`team/thread-started` 的 scope 是 []（SPEC §6.3 没有 channel/thread 词汇）。
    expect(fold.threads.size).toBe(0)
    expect(full.threads.size).toBe(2)
  })

  it('带 scope 时 coverage 明确声明「哪些 kind 我结构上看不见」', () => {
    const ledger = seedMixed()
    const scoped = catchUpFold(ledger, emptyProjectionFold(), { scopes: scopesForTeam(teamA) })

    // 反恒真：把 coverage 固定成 `{scoped:false, unscoped:[]}` → 本条必红。
    expect(scoped.coverage.scoped).toBe(true)
    expect(scoped.coverage.unscopedKindsOmitted).toEqual(UNSCOPED_EVENT_KINDS)
    expect(scoped.coverage.unscopedKindsOmitted).toContain('team/thread-started')

    // 不带 scope 的那条路径没这个盲区。
    const unscoped = catchUpFold(ledger, emptyProjectionFold())
    expect(unscoped.coverage.scoped).toBe(false)
    expect(unscoped.coverage.unscopedKindsOmitted).toEqual([])
  })

  it('UNSCOPED_EVENT_KINDS 与 changeScopesOf 的真实行为逐条绑定（不是手抄后没人管）', () => {
    // 遍历**全部 20 个 kind**，各造一条合法载荷提交，再真调 changeScopesOf 数出返回 [] 的那些。
    // （20 = 19 + `team/message-sent`；上面那张表会因缺键而 `tsc` 报错，故不会漂。）
    const ledger = newLedger()
    const spec = { name: '新团', roster: [{ position: '灵台郎', count: 1 }], tasks: ['t'] }
    const payloads: Record<LedgerEventKind, unknown> = {
      'team/initialized': { teamId: teamA, kind: 'persistent', createdByHostSessionId: null },
      'team/created': { teamId: teamA, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name: '甲团' },
      // ⚠ 2026-09-24 新增 `team/destroyed`（团队级中止）：本表是 `Record<LedgerEventKind, unknown>` ⇒ 必加。
      'team/destroyed': { teamId: teamA, reason: null },
      'team/member-added': { teamId: teamA, member: identity('灵台郎', '灵台郎', memberA), lifecycle: 'active' },
      'team/member-renamed': { teamId: teamA, memberId: memberA, from: '灵台郎', to: '灵台郎-2' },
      'team/member-suspended': { teamId: teamA, memberId: memberA, from: 'active', to: 'suspended' },
      'team/member-resumed': { teamId: teamA, memberId: memberA, from: 'suspended', to: 'active' },
      'team/member-destroyed': { teamId: teamA, memberId: memberA, from: 'archived', to: 'destroyed' },
      'team/member-model-switched': {
        teamId: teamA,
        memberId: memberA,
        from: { provider: 'p', model: 'm1' },
        to: { provider: 'p', model: 'm2' },
        reason: 'r',
        trigger: 'human',
        effectiveAtSequence: 1,
      },
      'team/channel-created': { channelId: channel1, teamId: teamA, title: '频道' },
      'team/thread-started': { threadId: thread1, channelId: channel1, title: '线程', assigneeMemberId: null },
      // ⚠ 这一项是**因新增 kind 而必加**的（A 类）：本表是
      // `Record<LedgerEventKind, unknown>`，少一个键就 `tsc` 报 TS2741，
      // 下面「表必须覆盖全部 kind」的前置断言也才有意义。
      'team/message-sent': {
        messageId: 'msg-1',
        channelId: channel1,
        threadId: thread1,
        senderMemberId: memberA,
        body: '正文',
      },
      'plan/approved': { planId: 'plan-1', mode: 'persistent-team', operator: 'human-1' },
      'spawn/awaiting-human-approval': {
        requestId: 'req-1',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        targetKind: 'persistent',
        spec,
      },
      'spawn/principal-rejected': {
        requestId: 'req-2',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        targetKind: 'persistent',
        spec,
        reason: '不合规',
      },
      'spawn/human-approved': {
        requestId: 'req-3',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        humanOperatorId: 'human-1',
        targetKind: 'persistent',
        spec,
        decision: 'approve',
      },
      'spawn/human-rejected': {
        requestId: 'req-4',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        humanOperatorId: 'human-1',
        targetKind: 'persistent',
        spec,
        decision: 'reject',
        reason: '暂缓',
      },
      'team/ownership-reattached': { teamId: teamA, from: memberA, to: memberB, reason: '父成员消失' },
      'dag/team-created': {
        dagTeamId: 'dag-1',
        ownerMemberId: memberA,
        parentTeamId: teamA,
        requestedByTransfer: false,
      },
      'dag/ownership-transferred': { dagTeamId: 'dag-1', from: memberA, to: memberB },
      'dag/task-state-changed': { dagTeamId: 'dag-1', taskId: 'task-1', from: 'pending', to: 'running' },
    }

    const kinds = Object.keys(payloads) as LedgerEventKind[]
    // 前置：这张表必须覆盖全部 kind，否则下面的结论只对一部分成立。
    expect(kinds).toHaveLength(LEDGER_EVENT_KINDS.length)
    for (const kind of kinds) {
      commit(ledger, { kind, data: payloads[kind], actor: humanActor })
    }

    const events = ledger.read({ limit: 1000 }).events
    expect(events).toHaveLength(kinds.length)
    const actuallyUnscoped = events
      .filter((event) => changeScopesOf(event).length === 0)
      .map((event) => event.kind)
      .sort()
    const declared = [...UNSCOPED_EVENT_KINDS].sort()

    // 反恒真：往 UNSCOPED_EVENT_KINDS 里多写一个 'team/created' → 本条必红。
    expect(actuallyUnscoped).toEqual(declared)
  })

  it('scope 构造器形状正确（团 scope 一条、成员 scope 一条）', () => {
    expect(scopesForTeam(teamA)).toEqual([{ kind: 'team', teamId: teamA }])
    expect(scopesForMember(memberA)).toEqual([{ kind: 'member', memberId: memberA }])
  })

  it('【OCR[8] 回归】按成员 scope 读一条**合法**事件时，不算进 malformed（它只是视野不全）', () => {
    // 这条是 OCR 评审 [8] 抓到的**真缺陷**的回归用例（我原实现把它算成「载荷读不回来」）。
    //
    // 场景：`team/ownership-reattached` 投 `[teamScope, memberScope(from), memberScope(to)]`。
    // 按**成员** scope 增量读时，这条事件会命中，但它引用的那个团只投 `teamScope`，
    // 因此**不在**本次折叠里。原实现据此 `unreadable += 1` —— 而对一条**载荷完全合法**的事件
    // 报「读不回来」，会让这个计数器在按 scope 读时**恒为正**，彻底失去报警意义。
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, {
      kind: 'team/ownership-reattached',
      data: { teamId: teamA, from: memberA, to: memberA, reason: '父成员消失' },
      actor: humanActor,
    })

    const scoped = catchUpFold(ledger, emptyProjectionFold(), { scopes: scopesForMember(memberA) })

    // 事件确实被读到了（游标推到头部），但团不在视野里。
    expect(scoped.fold.cursor).toBe(2)
    expect(scoped.fold.teams.size).toBe(0)
    // 反恒真：把 unresolvedReferences 那处改回 `malformed += 1` → 下面第一条必红。
    expect(scoped.fold.malformedEvents).toBe(0)
    expect(scoped.fold.unresolvedReferences).toBe(1)

    // 对照：**全量**重建下同样的账本，两个计数器都该是 0
    // （团在视野里 ⇒ 引用可解析；这条事件没有任何问题）。
    const full = rebuildFold(ledger).fold
    expect(full.malformedEvents).toBe(0)
    expect(full.unresolvedReferences).toBe(0)
    expect(full.teams.get(teamA)?.ownerMemberId).toBe(memberA)
  })

  it('【OCR[8] 回归】全量重建时 unresolvedReferences 恒为 0（它是「视野不全」而非「损坏」）', () => {
    // 这条把两个计数器的**分工**钉死：全量重建若出现 unresolved，
    // 才说明账本里真有「引用了从未出现过的实体」的不一致。
    const ledger = seedMixed()
    const full = rebuildFold(ledger).fold

    // `seedMixed` 里那条 `data:{}` 的 team/created 是**畸形**载荷 ⇒ 只该进 malformed。
    expect(full.malformedEvents).toBe(1)
    expect(full.unresolvedReferences).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑤ 纯函数性：视图不持有可变真相（FR-10.2）
// ════════════════════════════════════════════════════════════════════════════

describe('⑤ 折叠是纯函数，视图不持有可变真相（FR-10.2）', () => {
  it('foldLedgerEvents 不改写入参折叠', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    const before = rebuildFold(ledger).fold

    const events = ledger.read({}).events
    const after = foldLedgerEvents(before, events, 1)

    // 入参一个字段都不许动。
    expect(before.members.size).toBe(0)
    expect(before.cursor).toBe(1)
    // 返回值是新的折叠。
    expect(after).not.toBe(before)
  })

  it('空事件批次只推进游标，且游标已相等时**返回同一个对象**（无谓拷贝也要避免）', () => {
    const fold = emptyProjectionFold()

    expect(foldLedgerEvents(fold, [], 0)).toBe(fold)
    const advanced = foldLedgerEvents(fold, [], 7)
    expect(advanced.cursor).toBe(7)
    // 内容不变，但游标变了 ⇒ 必须是新对象（否则调用方拿到的是被共享的可变状态）。
    expect(advanced).not.toBe(fold)
  })

  it('两次独立重建同一个账本，得到逐字段相等的折叠（投影不含隐藏状态）', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))

    expect(foldContent(rebuildFold(ledger).fold)).toEqual(foldContent(rebuildFold(ledger).fold))
  })

  it('载荷读不回来时**拒绝采信**并如实计数，而不是造出半个实体', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '真团'))
    // `data:{}` 的 team/created：结构合法（isLedgerEvent 只验「非 null 对象」）故能落账，
    // 但 `data.teamId` 是 undefined —— 采信它会造出一个 teamId=undefined 的团。
    commit(ledger, { kind: 'team/created', data: {}, actor: humanActor })

    const fold = rebuildFold(ledger).fold

    // 反恒真：把 foldLedgerEvents 的收窄去掉（直接信任 event.data.teamId）→ 两个断言都红。
    expect(fold.teams.size).toBe(1)
    expect(fold.teams.get(teamA)?.name).toBe('真团')
    expect(fold.malformedEvents).toBe(1)
    expect(fold.unresolvedReferences).toBe(0)
    // 计数要能透传到视图层，否则调用方无从知道名册少了几条事实。
    const roster = rosterOf(fold, teamA)
    expect(roster.malformedEvents).toBe(1)
    expect(roster.unresolvedReferences).toBe(0)
  })

  it('坏载荷**夹在批次中间**时，它前后的事件都不受影响（不许整批作废）', () => {
    // 这条守的是「批处理循环里的失败处理必须是 `continue` 而不是 `return`」。
    // 初版实现在**兜底分支**上是 `return` 一份新折叠，那会把**同一批里它前面
    // 已经折叠好的**四张表整个丢掉。缺陷只在「坏事件不在批尾」时显形。
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团')) // 1 好
    commit(ledger, { kind: 'team/channel-created', data: {}, actor: humanActor }) // 2 坏载荷
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA))) // 3 好

    const fold = rebuildFold(ledger).fold

    // 坏事件**之前**的事实（甲团）必须还在。
    expect(fold.teams.get(teamA)?.name).toBe('甲团')
    // 坏事件**之后**的事实（成员）也必须还在。
    expect(fold.members.get(memberA)?.name).toBe('灵台郎')
    // 坏事件既不产出一个 channel，也不静默消失。
    expect(fold.channels.size).toBe(0)
    expect(fold.malformedEvents).toBe(1)
  })

  it('**兜底分支**（未知 kind）不吞掉同批其余事件 —— 直接调纯函数来打这条路径', () => {
    // ⚠ 这条必须**直接调 `foldLedgerEvents`**，不能走账本。
    // 原因（这是我自己先写错、被反恒真自检抓出来的一次）：
    // `Ledger.read` 出口处有 `isLedgerEvent`，未知 kind 根本读不出来，
    // 所以走账本构造的用例**永远碰不到 `default` 分支** —— 我第一版就是这么写的，
    // 结果「把兜底改回 `return`」的变异**仍然全绿**（不变的断言 = 没有断言）。
    // 直接调纯函数才能把那条路径真的压上去。
    const good1 = {
      eventId: 'e1',
      sequence: 1,
      occurredAt: 1,
      actor: humanActor,
      previousEventId: null,
      kind: 'team/created',
      data: { teamId: teamA, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name: '甲团' },
    }
    const bogus = {
      eventId: 'e2',
      sequence: 2,
      occurredAt: 2,
      actor: humanActor,
      previousEventId: 'e1',
      // 未知 kind：账本写不进、也读不出，故只能这样构造。
      kind: 'team/从未存在过的-kind',
      data: {},
    }
    const good2 = {
      eventId: 'e3',
      sequence: 3,
      occurredAt: 3,
      actor: humanActor,
      previousEventId: 'e2',
      kind: 'team/member-added',
      data: { teamId: teamA, member: identity('灵台郎', '灵台郎', memberA), lifecycle: 'active' },
    }

    const fold = foldLedgerEvents(
      emptyProjectionFold(),
      // 收窄断言是**测试**为了触达编译期不可达分支而做的，不代表生产路径允许它。
      [good1, bogus, good2] as never,
      3,
    )

    // 反恒真（已实测）：把兜底分支改回 `return` 的早退形式
    // → 这两个断言都会红（前面的团被丢掉、后面的成员根本没处理）。
    expect(fold.teams.get(teamA)?.name).toBe('甲团')
    expect(fold.members.get(memberA)?.name).toBe('灵台郎')
    expect(fold.malformedEvents).toBe(1)
    expect(fold.cursor).toBe(3)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑥ 未读计数
// ════════════════════════════════════════════════════════════════════════════

describe('⑥ 未读计数（按成员，复用 changeScopesOf 的成员 scope）', () => {
  it('只数与该成员相关的事件；**频道创建不计入**（负向对照证明过滤真的在过滤）', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团')) // 1: team scope only → 不计
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA))) // 2: member scope → 计
    commit(ledger, channelCreated(teamA, channel1, '主频道')) // 3: team scope only → 不计
    commit(ledger, threadStarted(channel1, thread1, '线程一')) // 4: scope=[] → 不计
    commit(ledger, lifecycleChanged('team/member-suspended', teamA, memberA, 'active', 'suspended')) // 5 → 计
    commit(ledger, lifecycleChanged('team/member-resumed', teamA, memberA, 'suspended', 'active')) // 6 → 计

    const unread = unreadByMember(ledger, { memberId: memberA, sinceSequence: 0 })

    // 反恒真：把 unreadByMember 里的 `scopes` 去掉（读全部）→ count 会变成 6 而必红。
    expect(unread.count).toBe(3)
    expect(unread.newestSequence).toBe(6)
  })

  it('水位是**排他**的：sinceSequence 之后才算未读', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA))) // seq 2
    commit(ledger, lifecycleChanged('team/member-suspended', teamA, memberA, 'active', 'suspended')) // seq 3
    commit(ledger, lifecycleChanged('team/member-resumed', teamA, memberA, 'suspended', 'active')) // seq 4

    expect(unreadByMember(ledger, { memberId: memberA, sinceSequence: 0 }).count).toBe(3)
    // 读到第 2 条之后：还剩 3、4 两条。
    expect(unreadByMember(ledger, { memberId: memberA, sinceSequence: 2 }).count).toBe(2)
    expect(unreadByMember(ledger, { memberId: memberA, sinceSequence: 3 }).count).toBe(1)
    // 全部读过：0 条、newest 为 null。
    const fullyRead = unreadByMember(ledger, { memberId: memberA, sinceSequence: 4 })
    expect(fullyRead.count).toBe(0)
    expect(fullyRead.newestSequence).toBeNull()
  })

  it('别的成员的成员-scope 事件不计入本人（按 memberId 过滤）', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, memberAdded(teamA, identity('推步主事', '推步主事', memberB)))

    // memberB 唯一的事件是它自己那条 member-added。
    const unreadB = unreadByMember(ledger, { memberId: memberB, sinceSequence: 0 })
    expect(unreadB.count).toBe(1)
    expect(unreadB.newestSequence).toBe(3)
  })

  it('审批票状态机：awaiting → 同 requestId 的人类结论翻转 status（文档 3.6 审批区数据源）', () => {
    const ledger = newLedger()
    const spec = { name: '待批团', roster: [{ position: '灵台郎', count: 1 }], tasks: ['甲'] }
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, {
      kind: 'spawn/awaiting-human-approval',
      data: {
        requestId: 'req-state-1',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        targetKind: 'persistent',
        spec,
      },
      actor: humanActor,
    })

    // 首态：awaiting；raisedAtSequence = 首次入账序号。
    const fold1 = rebuildFold(ledger).fold
    const ticket1 = fold1.spawnTickets.get('req-state-1' as never)
    expect(ticket1).toBeDefined()
    expect(ticket1!.status).toBe('awaiting')
    expect(ticket1!.spec.name).toBe('待批团')
    expect(ticket1!.reason).toBeNull()
    expect(ticket1!.humanOperatorId).toBeNull()
    const firstSequence = ticket1!.raisedAtSequence

    // 人类批准（同 requestId）→ status 翻转，序号保持首次。
    commit(ledger, {
      kind: 'spawn/human-approved',
      data: {
        requestId: 'req-state-1',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        humanOperatorId: 'tester-human',
        targetKind: 'persistent',
        spec,
        decision: 'approve',
      },
      actor: humanActor,
    })
    const fold2 = rebuildFold(ledger).fold
    const ticket2 = fold2.spawnTickets.get('req-state-1' as never)
    expect(ticket2!.status).toBe('approved')
    expect(ticket2!.humanOperatorId).toBe('tester-human')
    expect(ticket2!.raisedAtSequence).toBe(firstSequence)
  })

  it('第一级否决单独入账（无 awaiting 前态）也投影得出票（spec/reason 逐字透传）', () => {
    const ledger = newLedger()
    const spec = { name: '被打回团', roster: [{ position: '灵台郎', count: 1 }], tasks: [] }
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, {
      kind: 'spawn/principal-rejected',
      data: {
        requestId: 'req-rej-1',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        targetKind: 'persistent',
        spec,
        reason: '名册不合规',
      },
      actor: humanActor,
    })

    const fold = rebuildFold(ledger).fold
    const ticket = fold.spawnTickets.get('req-rej-1' as never)
    expect(ticket).toBeDefined()
    expect(ticket!.status).toBe('rejectedByPrincipal')
    expect(ticket!.reason).toBe('名册不合规')
    expect(ticket!.humanOperatorId).toBeNull()
    // 反恒真：把投影里 spawn 的两组 case 改回 `continue`（本轮改造前的形态）
    // → 本用例与上面的状态机用例全部变红。
  })

  it('派生申请的两级结论计入**发起成员**（FR-5.3 的收件箱语义）', () => {
    const ledger = newLedger()
    const spec = { name: '新团', roster: [{ position: '灵台郎', count: 1 }], tasks: ['t'] }
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    commit(ledger, {
      kind: 'spawn/awaiting-human-approval',
      data: {
        requestId: 'req-1',
        requesterMemberId: memberA,
        principalMemberId: memberB,
        targetKind: 'persistent',
        spec,
      },
      actor: humanActor,
    })

    // awaiting 投 [human-inbox, memberScope(requester)] —— 发起成员看得到。
    expect(unreadByMember(ledger, { memberId: memberA, sinceSequence: 0 }).count).toBe(2)
    // 审批人（principalMemberId）**不在**该事件的 scope 里，故 0 条。
    expect(unreadByMember(ledger, { memberId: memberB, sinceSequence: 0 }).count).toBe(0)
  })

  it('未读跨越多页时计数完整（limit 上限 1000 之内的分页循环）', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))
    // 造够一条能验证「不是只数第一页」的量：1 + 1200 条成员事件。
    for (let index = 0; index < 1200; index += 1) {
      commit(ledger, lifecycleChanged('team/member-suspended', teamA, memberA, 'active', 'suspended'))
    }

    const unread = unreadByMember(ledger, { memberId: memberA, sinceSequence: 0 })
    expect(unread.count).toBe(1201)
    expect(unread.newestSequence).toBe(ledger.head().sequence)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑦ 与既有门禁的一致性（AC-10-10 / SPEC §6.6）
// ════════════════════════════════════════════════════════════════════════════

describe('⑦ 投影层的运行期导出不带 View/Projection/State 后缀（AC-10-10 的本地看门人）', () => {
  it('本模块新增的每个运行期导出都不以 View/Projection/State 结尾', async () => {
    // `tests/ledger.spec.ts` 的 AC-10-10 在**整包**层面守这条。
    // 这里在**模块**层面再守一次，理由：投影函数最容易被顺手命名成 `channelView` ——
    // 而那个名字会当场撞红整包门禁，且报错点在别人的文件里、离原因很远。
    // 反恒真：把 projectRoster 改名成 rosterView → 本条必红。
    const projection: Record<string, unknown> = await import('../src/projection/index.ts')
    const offending = Object.keys(projection).filter((key) => /(View|Projection|State)$/.test(key))
    expect(offending).toEqual([])

    // 反向自检：这个正则确实能抓到这类名字（否则上面的「没有」可能只是正则失效）。
    // 实测：`channelView` / `threadView` / `rosterView` 三者全部命中该正则。
    expect(['channelView', 'threadView', 'rosterView'].filter((k) => /(View|Projection|State)$/.test(k)))
      .toHaveLength(3)

    // 投影函数确实在（避免「什么都不导出」也让上面通过）。
    for (const name of ['projectRoster', 'projectChannel', 'projectThread']) {
      expect(Object.keys(projection)).toContain(name)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑧ 并发提交不得被跳过（收口序号的竞态）
// ════════════════════════════════════════════════════════════════════════════

describe('⑧ 并发提交不得被静默跳过（收口序号的竞态）', () => {
  /**
   * 这一节测的是**并发窗口**，单线程对拍**结构上测不到**。
   *
   * 缺陷形态（原先 `catchUpFold` 收口分支的真实写法）：
   * ```ts
   * current = foldLedgerEvents(current, page.events, ledger.head().sequence)
   * ```
   * `read()` 与 `head()` 是两次**独立**查询、没有共享快照。`read` 报 `hasMore === false`
   * 时表示它**那一刻**扫到了表尾；若在「它扫到表尾」与「head 取值」之间，
   * 有**另一条连接**提交了新事件，则 `head().sequence` 会包含那条新事件 ⇒
   * 游标被推**过**它 ⇒ 它此后**永远**折不进来（静默丢事件：不报错、界面正常、内容少一条）。
   *
   * 怎么让它变红（反恒真自证，已实测）：把收口那行改回
   * `ledger.head().sequence`（或把 `headBefore` 挪到 read 之后再采样）→ 下面两条用例必红。
   *
   * ⚠ 为什么必须用**真实文件**账本：`:memory:` 下每条连接是各不相同的独立内存库，
   * `other.commit()` 对 `main` 毫无影响，「并发」压根没发生 —— 那种写法会恒绿。
   */
  it('read 返回后、收口前落地的并发提交，下一轮必须能折进来（不被跳过）', () => {
    const path = newFileLedgerPath()
    const main = openFileLedger(path)
    const other = openFileLedger(path) // 独立连接 = 真正的并发写方

    commit(main, teamCreated(teamA, '甲团')) // seq 1

    let injected = false
    const proxy: Ledger = {
      ...main,
      // 注入点选在 `read`：真实 read 先物化出本页，紧接着由**另一条连接**提交 seq 2
      // —— 精确对应「本页已扫到表尾之后、收口取值之前」这一窗口。
      // 断言的是**后果**（那条事件还能不能被折到），不是实现细节。
      read: (query) => {
        const page = main.read(query)
        if (!injected) {
          injected = true
          commit(other, teamCreated(teamB, '并发到的乙团')) // seq 2
        }
        return page
      },
    }

    const first = catchUpFold(proxy, emptyProjectionFold())

    // 前提自检：注入**确实发生了**。否则本用例会变成一条恒真的假断言
    // （没有并发提交时，新旧两种写法都不会丢事件）。
    expect(injected).toBe(true)
    expect(other.head().sequence).toBe(2)

    // 旧写法在这一步就已经把游标推到 2 而只折了 1 条 —— 于是下面第 2 条事件永远读不回来。
    expect(first.fold.cursor).toBeLessThanOrEqual(1)

    const second = catchUpFold(main, first.fold)

    // 核心断言：并发落地的那条事件**必须**折得进来。
    expect([...second.fold.teams.keys()]).toEqual([teamA, teamB])
    expect(second.fold.teams.get(teamB)?.name).toBe('并发到的乙团')
    // 且最终与全量重建逐字段一致（游标收敛、无遗漏、无重复计数）。
    expect(foldContent(second.fold)).toEqual(foldContent(rebuildFold(main).fold))
    expect(second.fold.cursor).toBe(main.head().sequence)
  })

  it('head 采样之后、read 之前落地的事件：既被折到，也不被重复折叠', () => {
    const path = newFileLedgerPath()
    const main = openFileLedger(path)
    const other = openFileLedger(path)

    commit(main, teamCreated(teamA, '甲团')) // seq 1

    // seq 2 用一条**载荷空洞**的事件：它每被折一次就让 `malformedEvents` +1，
    // 于是「有没有被重复折叠」这件事是**可直接观测**的（重复折会让计数翻倍）。
    let injected = false
    const proxy: Ledger = {
      ...main,
      head: () => {
        const head = main.head()
        if (!injected) {
          injected = true
          commit(other, { kind: 'team/created', data: {}, actor: humanActor }) // seq 2
        }
        return head
      },
    }

    const first = catchUpFold(proxy, emptyProjectionFold())

    // 本页 read 时 seq 2 已在库里，故它被折进来了（收口取末条序号，不会把它落下）。
    expect(injected).toBe(true)
    expect(first.fold.cursor).toBe(2)
    expect(first.fold.malformedEvents).toBe(1)

    // 再折一次：**不得**把 seq 2 再折一遍（收口用了 max(headBefore, 末条序号)）。
    // 反恒真：若收口只取 `headBefore`（=1），游标会停在 1 ⇒ 这里会变成 2。
    const second = catchUpFold(main, first.fold)
    expect(second.fold.cursor).toBe(2)
    expect(second.fold.malformedEvents).toBe(1)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑨ member-added 的初始模型（FR-6.4 的 `from` 得有账本事实可依）
// ════════════════════════════════════════════════════════════════════════════

describe('⑨ member-added 的初始模型：带 model 与不带 model **两个分支各有用例**', () => {
  /**
   * 背景：换模事件按 FR-6.4 必须携带**真实的**旧模型 `from`，而 `from` 取自账本投影
   * （`tools/switch-model.ts` 的 `projection.modelOf`，不接受模型自报）。
   * 此前折叠 `member-added` 时硬写 `model: null` ⇒ 新团成员恒无模型 ⇒
   * 人类第一次点「换模」必定返回 `unknown-current-model`。
   *
   * 本节两个用例分别钉住**两条分支**：
   * - 载荷带 `model` ⇒ 折出该模型（换模因此有 `from` 可依）；
   * - 载荷不带 `model`（本字段引入前的旧账本形态）⇒ 仍折出 `null`，且**不计为畸形**。
   *
   * 反恒真自证（两条各自独立，互不遮蔽）：
   * - 把折叠改回硬写 `model: null` ⇒ 用例 1 必红；
   * - 把「取不到 model」判成 `malformed += 1` 并 `continue` ⇒ 用例 2 必红
   *   （既拿不到成员，`malformedEvents` 也会变成 1）。
   */
  it('载荷带 model：折出该模型（而非恒 null），换模才有真实 from 可依', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA), {
      provider: 'workbuddy-xdpool',
      model: 'deepseek-v4.1-flash',
    }))

    const fold = rebuildFold(ledger).fold
    const fact = fold.members.get(memberA)
    expect(fact).toBeDefined()
    // 核心断言：模型来自载荷，不是写死的 null。
    expect(fact?.model).toEqual({ provider: 'workbuddy-xdpool', model: 'deepseek-v4.1-flash' })
    // 且它经由 roster 视图如实透出（`projectRoster` 的 `model` 字段）。
    expect(rosterOf(fold, teamA).members[0]?.model).toEqual({
      provider: 'workbuddy-xdpool',
      model: 'deepseek-v4.1-flash',
    })
  })

  it('载荷不带 model（旧账本形态）：仍折出 null，且**不计为畸形事件**', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, legacyMemberAdded(teamA, identity('灵台郎', '灵台郎', memberA)))

    const fold = rebuildFold(ledger).fold
    const fact = fold.members.get(memberA)
    // 兼容性：旧形态仍然折得进来（不能因为少一个字段就丢掉整条事件）。
    expect(fact).toBeDefined()
    expect(fact?.model).toBeNull()
    // 关键：取不到 model 是**合法的向后兼容**，不是「数据损坏」——
    // 账本只追加、不可改写，旧形态会永远存在；判成畸形会让每份历史账本反复报假损坏。
    expect(fold.malformedEvents).toBe(0)
    expect(fold.unresolvedReferences).toBe(0)
    expect(rosterOf(fold, teamA).members[0]?.model).toBeNull()

    // 对偶对照：显式 `null`（新写入方表态「跟随全局默认」）与「无该键」折叠结果一致 ——
    // 两者在账本上语义相同，折叠不该把它们区分开。
    const withExplicitNull = newLedger()
    commit(withExplicitNull, teamCreated(teamA, '甲团'))
    commit(withExplicitNull, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA), null))
    expect(foldContent(rebuildFold(withExplicitNull).fold)).toEqual(foldContent(rebuildFold(ledger).fold))
  })

  it('初始模型不是终点：此后的换模事件照样覆盖它（投影取「最新那条事件」）', () => {
    const ledger = newLedger()
    commit(ledger, teamCreated(teamA, '甲团'))
    commit(ledger, memberAdded(teamA, identity('灵台郎', '灵台郎', memberA), {
      provider: 'p-original',
      model: 'm-original',
    }))
    commit(ledger, {
      kind: 'team/member-model-switched',
      data: {
        teamId: teamA,
        memberId: memberA,
        from: { provider: 'p-original', model: 'm-original' },
        to: { provider: 'p-new', model: 'm-new' },
        reason: '人类换模',
        trigger: 'human',
        effectiveAtSequence: 3,
      },
      actor: humanActor,
    })

    const fact = rebuildFold(ledger).fold.members.get(memberA)
    // 初始值被换模事件覆盖 —— 证明它是**初始**事实，不是钉死的常量。
    expect(fact?.model).toEqual({ provider: 'p-new', model: 'm-new' })
  })
})

describe('t1 · dag 投影（文档 5 · DagCanvas 数据源）', () => {
  it('dag/* 三事件收进 fold.dagTeams：建团 → 归属移交翻 owner → 任务取当前态', () => {
    const ledger = newLedger()
    commit(ledger, {
      kind: 'dag/team-created',
      data: { dagTeamId: 'dag-x', ownerMemberId: memberA, parentTeamId: teamA, requestedByTransfer: false },
      actor: humanActor,
    })
    commit(ledger, {
      kind: 'dag/ownership-transferred',
      data: { dagTeamId: 'dag-x', from: memberA, to: memberB },
      actor: humanActor,
    })
    commit(ledger, {
      kind: 'dag/task-state-changed',
      data: { dagTeamId: 'dag-x', taskId: 'task-1', from: 'pending', to: 'running' },
      actor: humanActor,
    })
    commit(ledger, {
      kind: 'dag/task-state-changed',
      data: { dagTeamId: 'dag-x', taskId: 'task-1', from: 'running', to: 'done' },
      actor: humanActor,
    })

    const fold = rebuildFold(ledger).fold
    const fact = fold.dagTeams.get('dag-x' as never)
    // 反恒真：dag case 不实现（留在「显式列出不处理」注释里）→ 下面三条必红。
    expect(fact).toBeDefined()
    // 归属取移交后的成员，不是建团时的 owner。
    expect(fact?.ownerMemberId).toBe(memberB)
    expect(fact?.parentTeamId).toBe(teamA)
    // 任务取「后值覆盖」的当前态，不是首次出现的 running。
    expect(fact?.tasks.get('task-1')?.state).toBe('done')
    expect(fold.malformedEvents).toBe(0)
  })

  it('未知 dagTeamId 的移交 ⇒ 计入「未解析引用」，不给不存在的实体造条目', () => {
    const ledger = newLedger()
    commit(ledger, {
      kind: 'dag/ownership-transferred',
      data: { dagTeamId: 'dag-none', from: memberA, to: memberB },
      actor: humanActor,
    })
    const fold = rebuildFold(ledger).fold
    expect(fold.dagTeams.size).toBe(0)
    // OCR [26] 改判：载荷合法、dag 只是不在本次视野（成员 scope 读取的常态）
    // ⇒ 计 unresolved 而不是 malformed（后者是「数据损坏」的谎报）。
    expect(fold.unresolvedReferences).toBe(1)
    expect(fold.malformedEvents).toBe(0)
  })

  it('principal-rejected 晚于同票 awaiting ⇒ raisedAtSequence 保持首次入账序号', () => {
    const ledger = newLedger()
    commit(ledger, {
      kind: 'spawn/awaiting-human-approval',
      actor: humanActor,
      data: {
        requestId: 'req-seq-1',
        requesterMemberId: memberA,
        targetKind: 'persistent',
        spec: { name: '序号团', roster: [], tasks: [] },
      },
    })
    // awaiting 是本账本第一条事件（fresh ledger）⇒ 首次入账序号 = head 此刻值。
    const awaitingSeq = ledger.head().sequence
    commit(ledger, {
      kind: 'spawn/principal-rejected',
      actor: humanActor,
      data: {
        requestId: 'req-seq-1',
        requesterMemberId: memberA,
        targetKind: 'persistent',
        spec: { name: '序号团', roster: [], tasks: [] },
        reason: '监正打回',
      },
    })
    const fold = rebuildFold(ledger).fold
    const ticket = fold.spawnTickets.get('req-seq-1' as never)
    // 反恒真：principal 分支用 `event.sequence` 无条件覆盖 → 本条必红
    //（它会拿到 principal-rejected 的序号而非 awaiting 的）。
    expect(ticket?.status).toBe('rejectedByPrincipal')
    expect(ticket?.raisedAtSequence).toBe(awaitingSeq)
    expect(awaitingSeq).toBeLessThan(ledger.head().sequence)
  })

  it('catchUpFold：scopes 空数组显式拒绝（F2 —— 静默跳过全部事件的陷阱）', () => {
    const ledger = newLedger()
    commit(ledger, {
      kind: 'team/created',
      actor: humanActor,
      data: { teamId: 'team-f2', kind: 'temporary', ownerMemberId: memberA, parentTeamId: null, name: 'f2' },
    })
    const fold = rebuildFold(ledger).fold
    // 反恒真：去掉入口那句 throw ⇒ 不抛 ⇒ 本条必红（且 cursor 会静默跳到表尾）。
    expect(() => catchUpFold(ledger, fold, { scopes: [] })).toThrow('F2')
    // 对照：undefined（不过滤）是合法语义，照常追平。
    const outcome = catchUpFold(ledger, fold, {})
    expect(outcome.coverage.scoped).toBe(false)
  })
})
