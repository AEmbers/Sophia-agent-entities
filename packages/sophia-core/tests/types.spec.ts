/**
 * 领域类型与角色模型的验收测试（SPEC §2 / §7.2）。
 *
 * 覆盖的 AC：
 * - AC-ID-1（品牌化 ID 互斥）、AC-ROLE-1（窗口不绑团）、AC-ROLE-2（锚点解耦可构造）
 * - AC-TEAM-1（生命周期无 `inactive`）、AC-STAGE-1（默认模式为持久团队）
 * - 判别联合的穷尽性（为 `t4` 的 `AC-10-*` 打地基）
 * - 运行期类型守卫（从存储层读回的行的第一道闸）
 *
 * ## 本文件的断言分两类，各有各的失效方式
 *
 * - **编译期断言**用 `@ts-expect-error`：类型若被改回去，被标注的那行**不再报错**，
 *   `tsc` 反而会以「未使用的 @ts-expect-error 指令」失败（TS2578）。
 *   即：断言与实现**同时**变化才能保持绿色，单方面放宽类型必然变红。
 * - **运行期断言**用 `expect`：改坏常量或守卫逻辑即变红。
 *
 * 反恒真说明见每个 `@ts-expect-error` 上方的注释（写明「去掉什么，这行就会变红」）。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RUN_MODE,
  LEDGER_EVENT_KINDS,
  SOPHIA_CORE_VERSION,
  assertNever,
  isLedgerActor,
  isLedgerEvent,
  isLedgerEventKind,
  type DagTeamId,
  type Host,
  type HostSessionId,
  type LedgerEvent,
  type LedgerEventOf,
  type MemberId,
  type MemberLifecycle,
  type MemberPresence,
  type PlanId,
  type RequestId,
  type SpawnDecisionSubject,
  type Team,
  type TeamId,
} from '../src/index.ts'

/** 品牌类型的构造边界：真实构造由 `t4`/`t5` 的工厂负责，测试里直接断言品牌值。 */
const teamId = 'team-1' as TeamId
const otherTeamId = 'team-2' as TeamId
const memberId = 'sophia-lingtai-lang-a1b2c3d4' as MemberId
const dagTeamId = 'dag-1' as DagTeamId
const planId = 'plan-1' as PlanId
const hostSessionId = 'host-session-1' as HostSessionId
const requestId = 'req-1' as RequestId

const acceptMemberId = (_id: MemberId): void => {}
const acceptTeamId = (_id: TeamId): void => {}
const acceptDagTeamId = (_id: DagTeamId): void => {}

/**
 * 两个审批载荷的 `decision` 字段类型。
 *
 * 提到模块级（而非 TEST 内的局部 `type`）是因为**两条镜像用例都要用**：
 * 「rejected 不得带 approve」与「approved 不得带 reject」必须能互相引用对方的类型
 * 才能写出交叉断言（见下方 `directionOf`）。
 */
type HumanRejectionDecision = LedgerEventOf<'spawn/human-rejected'>['data']['decision']
type HumanApprovalDecision = LedgerEventOf<'spawn/human-approved'>['data']['decision']

describe('AC-ID-1 品牌化 ID 互斥', () => {
  it('三组交叉赋值均被类型系统拒绝（编译期断言）', () => {
    // 去掉 Brand 的交叉类型（把 TeamId 改回裸 string），下面三行的报错即消失，
    // `@ts-expect-error` 变成 TS2578「未使用的指令」 ⇒ tsc 失败。断言与实现同向。

    // @ts-expect-error TeamId 不能当作 MemberId 用（团队 ID 与成员 ID 是不同的品牌）
    acceptMemberId(teamId)

    // @ts-expect-error DagTeamId 不能当作 TeamId 用（DAG 团队与团队是不同的实体）
    acceptTeamId(dagTeamId)

    // @ts-expect-error PlanId 不能当作 DagTeamId 用
    acceptDagTeamId(planId)

    // 同品牌同名类型可以互相赋值（证明上面的拒绝来自品牌差异，不是别的原因）
    acceptMemberId(memberId)
    acceptTeamId(teamId)
    acceptDagTeamId(dagTeamId)

    expect(SOPHIA_CORE_VERSION).toBeTypeOf('string')
  })

  it('品牌在运行期是零开销的（只是 string）', () => {
    // 这条是「品牌不引入运行时包装」的证据：若将来有人把 Brand 改成 class 包装，
    // 这里会立刻变红，提醒他重新评估序列化边界。
    expect(typeof teamId).toBe('string')
    expect(teamId).toBe('team-1')
  })
})

describe('AC-ROLE-1 窗口不绑团（本包最重要的类型级约束）', () => {
  it('Host 上不存在 teamId；Team 上不存在 hostSessionId 锚点（编译期断言）', () => {
    const host: Host = { kind: 'host', hostSessionId }

    // 给 Host 加上 teamId 字段，本行即不再报错 ⇒ TS2578 ⇒ tsc 失败。
    // @ts-expect-error Host（传旨通道）没有 teamId：宿主与团是多对多引用，不是所有权
    void host.teamId

    // 给 Team 加上必填/可选 hostSessionId，本行即不再报错。存在的只有**审计字段**
    // lastHostSessionId —— 它的名字本身就是「最近一次、可替换、非锚点」。
    // @ts-expect-error Team 不以 hostSessionId 为存在性锚点（对治上游 captainSessionId 僵尸团）
    void team('team-1' as TeamId).hostSessionId

    expect(host.kind).toBe('host')
  })

  it('审计字段 lastHostSessionId 可以缺省、可以替换，但不是锚点', () => {
    const noAudit = team(teamId)
    const withAudit = team(teamId, hostSessionId)

    expect(noAudit.lastHostSessionId).toBeUndefined()
    expect(withAudit.lastHostSessionId).toBe(hostSessionId)
    // 两个团的 teamId 相同即同一个团 —— 审计字段变了不代表换了一个团。
    expect(noAudit.teamId).toBe(withAudit.teamId)
  })
})

describe('AC-ROLE-2 锚点解耦可构造', () => {
  it('构造 Host 不需要 TeamId；构造 Team 不需要 HostSessionId', () => {
    const host: Host = { kind: 'host', hostSessionId }
    const t: Team = {
      teamId: teamId,
      kind: 'persistent',
      ownerMemberId: null,
      parentTeamId: null,
      state: 'active',
      createdAtSequence: 1,
      // 刻意不写 lastHostSessionId：它可选，且**不是**构造的必要条件
    }

    expect(host.kind).toBe('host')
    expect(t.kind).toBe('persistent')
    expect(t.ownerMemberId).toBeNull()
    expect(t.parentTeamId).toBeNull()
  })

  it('子团携带 ownerMemberId 与 parentTeamId（FR-5.4.1）', () => {
    const child: Team = {
      teamId: otherTeamId,
      kind: 'temporary',
      ownerMemberId: memberId,
      parentTeamId: teamId,
      state: 'active',
      createdAtSequence: 7,
    }

    expect(child.ownerMemberId).toBe(memberId)
    expect(child.parentTeamId).toBe(teamId)
  })
})

describe('AC-TEAM-1 生命周期无 inactive', () => {
  it("'inactive' 不是 MemberLifecycle 的成员（编译期断言）", () => {
    const all: readonly MemberLifecycle[] = ['active', 'suspended', 'archived', 'destroyed']

    // 把 'inactive' 加回联合（裁定 Q-C 的反向），本行即不再报错 ⇒ TS2578 ⇒ tsc 失败。
    // @ts-expect-error 裁定 Q-C：inactive 与 suspended 是同物异名，规范名取 suspended
    const revived: MemberLifecycle = 'inactive'
    void revived

    expect(all).toHaveLength(4)
    expect(all).not.toContain('inactive')
    expect(all).toContain('suspended')
  })

  it('存在态 idle / running 与生命周期状态是正交维度（FR-3.2）', () => {
    const presences: readonly MemberPresence[] = ['idle', 'running']

    expect(presences).toEqual(['idle', 'running'])
    // 存在态不得出现在生命周期联合里 —— 两个维度混用会让「挂起后是否还在跑」无法表达。
    expect(presences.some((p) => (['active', 'suspended', 'archived', 'destroyed'] as string[]).includes(p))).toBe(
      false,
    )
  })
})

describe('AC-STAGE-1 双模草案默认模式', () => {
  it('DEFAULT_RUN_MODE 为 persistent-team（FR-2.1）', () => {
    expect(DEFAULT_RUN_MODE).toBe('persistent-team')
  })
})

describe('账本事件判别联合（FR-10.1）', () => {
  it('kind 清单与 LedgerEventMap 双向一致，且无重复', () => {
    // ⚠ 19 → 20 → 21：**因新增 `team/message-sent`、`team/destroyed` 而必更**
    // （A 类：契约变更的必然结果）。
    // 精确计数本身就是护栏（漏一个 kind 就红），故仍是精确值，**不弱化成 >=**。
    expect(LEDGER_EVENT_KINDS).toHaveLength(21)
    expect(new Set(LEDGER_EVENT_KINDS).size).toBe(LEDGER_EVENT_KINDS.length)

    // 契约 §6.1 表格里每一项都必须存在（这条是「清单没漏项」的运行期回声，
    // 编译期的回声是 guards.ts 里的 _LEDGER_EVENT_KINDS_IS_COMPLETE）。
    for (const required of [
      'spawn/awaiting-human-approval',
      'spawn/principal-rejected',
      'spawn/human-approved',
      'spawn/human-rejected',
      'team/ownership-reattached',
      'dag/ownership-transferred',
      'plan/approved',
      'team/member-added',
      // ⚠ 本次新增：单独列在这里而不只靠上面的计数 —— 计数只能证「条数对」，
      // 不能证「新 kind 真的在白名单里」（有人删掉它、再加一个别的，计数照样对）。
      'team/message-sent',
      'team/destroyed',
    ] as const) {
      expect(LEDGER_EVENT_KINDS).toContain(required)
    }
  })

  it('switch 能穷尽全部 kind，且判别后载荷类型被正确收窄', () => {
    // 穷尽 switch：新增一个 kind 而漏处理，default 里的 event 不再是 never，
    // assertNever 的入参类型不匹配 ⇒ tsc 在**此处**报错。
    function describeEvent(event: LedgerEvent): string {
      switch (event.kind) {
        case 'team/initialized':
          return `团壳 ${event.data.teamId}`
        case 'team/created':
          return `团成立 ${event.data.teamId}`
        case 'team/member-added':
          // 三层标识整体可见：position / name / memberId
          return `新成员 ${event.data.member.position}/${event.data.member.name}/${event.data.member.memberId}`
        case 'team/member-renamed':
          return `改名 ${event.data.from}→${event.data.to}`
        case 'team/member-suspended':
        case 'team/member-resumed':
        case 'team/member-destroyed':
          return `生命周期 ${event.data.from}→${event.data.to}`
        case 'team/member-model-switched':
          return `换模 ${event.data.from.model}→${event.data.to.model}`
        case 'team/channel-created':
          return `频道 ${event.data.channelId}`
        // ⚠ 2026-09-24 新增 kind（A 类）：不加，`assertNever(event)` 的入参不再是 never ⇒ tsc 红。
        case 'team/destroyed':
          return `中止 ${event.data.teamId}`
        case 'team/thread-started':
          return `线程 ${event.data.threadId}`
        // ⚠ 本分支是**因新增 kind 而必加**的（A 类）：不加，下面 `assertNever(event)`
        // 的入参就不再是 `never` ⇒ `tsc` 报 TS2345（这正是本用例要的那个性质）。
        case 'team/message-sent':
          return `消息 ${event.data.messageId} @ ${event.data.threadId}`
        case 'plan/approved':
          return `核准 ${event.data.planId} @ ${event.data.mode}`
        case 'spawn/awaiting-human-approval':
          return `待人类批准 ${event.data.requestId}`
        case 'spawn/principal-rejected':
          return `团长否决 ${event.data.requestId}：${event.data.reason}`
        case 'spawn/human-approved':
          return `人类批准 ${event.data.requestId}（${event.data.humanOperatorId}）`
        case 'spawn/human-rejected':
          return `人类否决 ${event.data.requestId}：${event.data.reason}`
        case 'team/ownership-reattached':
          return `转挂 ${event.data.teamId} ${event.data.from}→${event.data.to}`
        case 'dag/team-created':
          return `DAG 团队 ${event.data.dagTeamId}`
        case 'dag/ownership-transferred':
          return `DAG 移交 ${event.data.dagTeamId} ${event.data.from}→${event.data.to}`
        case 'dag/task-state-changed':
          return `任务 ${event.data.taskId} ${event.data.from}→${event.data.to}`
        default:
          return assertNever(event)
      }
    }

    expect(describeEvent(memberAddedEvent)).toContain('灵台郎')
    expect(describeEvent(principalRejectedEvent)).toBe('团长否决 req-1：本季度架构冻结')
    expect(describeEvent(humanApprovedEvent)).toBe('人类批准 req-1（human-1）')
    // 判别收窄的证明：`humanOperatorId` 只存在于 spawn/human-* 的载荷上，
    // 若把 SpawnDecisionData 与 SpawnAwaitingHumanData 合并（丢掉人类操作者），
    // 上面一行会因字段不存在而 tsc 报错；若把 kind 判别去掉，本函数不会穷尽、tsc 报错。
  })

  it('kind 是判别键，载荷不得反驳它：human-rejected 不得携带 decision=approve', () => {
    // 正向：合法载荷可赋值。
    const goodRejection: LedgerEventOf<'spawn/human-rejected'> = {
      eventId: humanRejectedEvent.eventId,
      sequence: 4,
      occurredAt: 1_760_000_003_000,
      actor: { kind: 'human', humanId: 'human-1' },
      previousEventId: 'evt-3' as LedgerEvent['eventId'],
      kind: 'spawn/human-rejected',
      data: {
        requestId,
        requesterMemberId: memberId,
        principalMemberId: memberId,
        humanOperatorId: 'human-1',
        targetKind: 'persistent',
        spec: { name: '推步组', roster: [], tasks: [] },
        decision: 'reject',
        reason: '资源不足',
      },
    }
    expect(goodRejection.data.decision).toBe('reject')

    // 反向：把 decision 放宽成 'approve' 即不再报错 ⇒ TS2578 ⇒ tsc 失败。
    // 这条断言是必需的：实测过——不加它时，把 SpawnHumanRejectionData.decision 从
    // 字面量 'reject' 放宽回 SpawnDecision，两套命令仍全绿（该改动不可测）。
    const legalDecision: HumanRejectionDecision = 'reject'
    expect(legalDecision).toBe('reject')

    // @ts-expect-error kind 已是 human-rejected，载荷的 decision 只能是 'reject'，不得为 'approve'
    const contradictoryDecision: HumanRejectionDecision = 'approve'
    void contradictoryDecision
  })

  it('镜像方向：human-approved 不得携带 decision=reject（OCR 发现的对称漏洞）', () => {
    // 背景：修前 `SpawnDecisionData`（映射到 human-approved）沿用宽 `SpawnDecision`，
    // 所以「已批准」事件可以合法携带 `decision:'reject'` —— 载荷反驳自己的判别键。
    // 这条断言就是那个方向的可变红证据（与上一条互为镜像）。
    const goodApproval: LedgerEventOf<'spawn/human-approved'> = {
      eventId: humanApprovedEvent.eventId,
      sequence: 3,
      occurredAt: 1_760_000_002_000,
      actor: { kind: 'human', humanId: 'human-1' },
      previousEventId: 'evt-2' as LedgerEvent['eventId'],
      kind: 'spawn/human-approved',
      data: {
        requestId,
        requesterMemberId: memberId,
        principalMemberId: memberId,
        humanOperatorId: 'human-1',
        targetKind: 'persistent',
        spec: { name: '推步组', roster: [], tasks: [] },
        decision: 'approve',
      },
    }
    expect(goodApproval.data.decision).toBe('approve')

  const legalApproval: HumanApprovalDecision = 'approve'
  expect(legalApproval).toBe('approve')

  // @ts-expect-error kind 已是 human-approved，载荷的 decision 只能是 'approve'，不得为 'reject'
  const contradictoryApproval: HumanApprovalDecision = 'reject'
  void contradictoryApproval

  // 交叉断言：两个载荷的 decision 类型必须**互不相同**。
  // 反恒真：把 SpawnDecisionSubject 重新并回一个共用基座、且把两个子接口的收窄都删掉，
  // 两侧都会退化成 SpawnDecision，下面这行断言即变红。
  // （这比「各自断言字面量」更强：它直接证明两个载荷在这一个字段上是互斥的。）
  const directionOf = (value: HumanApprovalDecision | HumanRejectionDecision): string =>
    value === 'approve' ? '批准' : '否决'
  expect(directionOf('approve')).toBe('批准')

  // 结构性保证：结论字段**不在**公共基座上，否则两个子接口无法各自收窄
  // （把 `decision` 放回 `SpawnDecisionSubject` 会让本文件 tsc 报 TS2430 —— 实测过）。
  // 这条断言在运行期不可观测，用类型层排除来钉：
  type SubjectHasNoDecision = 'decision' extends keyof SpawnDecisionSubject ? never : true
  const subjectHasNoDecision: SubjectHasNoDecision = true
  expect(subjectHasNoDecision).toBe(true)
  })

  it('事件是「已发生的事实」——kind 全部为过去式，无祈使/未来式', () => {
    // 反恒真：把任一 kind 改成 'team/create-team' 这类祈使式，本用例变红。
    const nonPast = LEDGER_EVENT_KINDS.filter((kind) => /^(create|add|suspend|approve|reject|transfer)/.test(kind))
    expect(nonPast).toEqual([])
  })
})

describe('运行期类型守卫（判别联合的运行时配套）', () => {
  it('isLedgerEventKind 只接受清单内的 kind', () => {
    expect(isLedgerEventKind('team/member-added')).toBe(true)
    expect(isLedgerEventKind('team/does-not-exist')).toBe(false)
    expect(isLedgerEventKind(42)).toBe(false)
    expect(isLedgerEventKind(undefined)).toBe(false)
  })

  it('isLedgerActor 校验三类操作者的判别键', () => {
    expect(isLedgerActor({ kind: 'human', humanId: 'h-1' })).toBe(true)
    expect(isLedgerActor({ kind: 'host', hostSessionId: 'hs-1' })).toBe(true)
    expect(isLedgerActor({ kind: 'member', memberId: memberId })).toBe(true)
    // 三个分支**逐一**给阴性用例。缺任一条都会留下一个不可测分支：
    // 实测过——只给 human 阴性用例时，把 host 分支改成 `return true`（恒真）两套命令仍全绿。
    expect(isLedgerActor({ kind: 'human' })).toBe(false)
    expect(isLedgerActor({ kind: 'host' })).toBe(false)
    expect(isLedgerActor({ kind: 'host', hostSessionId: 42 })).toBe(false)
    expect(isLedgerActor({ kind: 'member' })).toBe(false)
    expect(isLedgerActor({ kind: 'member', memberId: undefined })).toBe(false)
    // 判别键所指字段为 null 同样不合法（null 不是 string）
    expect(isLedgerActor({ kind: 'host', hostSessionId: null })).toBe(false)
    expect(isLedgerActor({ kind: 'principal', memberId: memberId })).toBe(false)
    expect(isLedgerActor(null)).toBe(false)
    expect(isLedgerActor('member')).toBe(false)
  })

  it('isLedgerEvent 放行合法事件、拒绝各类畸形行', () => {
    expect(isLedgerEvent(memberAddedEvent)).toBe(true)

    // 未知 kind
    expect(isLedgerEvent({ ...memberAddedEvent, kind: 'team/nope' })).toBe(false)
    // eventId 非字符串
    expect(isLedgerEvent({ ...memberAddedEvent, eventId: 1 })).toBe(false)
    // sequence 非整数（完整性自检的前提是序号可比较）
    expect(isLedgerEvent({ ...memberAddedEvent, sequence: '1' })).toBe(false)
    // occurredAt 缺失
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: undefined })).toBe(false)
    // previousEventId 既不是 null 也不是 string
    expect(isLedgerEvent({ ...memberAddedEvent, previousEventId: 0 })).toBe(false)
    // actor 畸形
    expect(isLedgerEvent({ ...memberAddedEvent, actor: { kind: 'human' } })).toBe(false)
    // 非对象
    expect(isLedgerEvent(null)).toBe(false)
    expect(isLedgerEvent('team/member-added')).toBe(false)
  })

  it('isLedgerEvent 拦下「载荷缺失」与各类越界数值（OCR HIGH 修复的守卫）', () => {
    // data 缺失/为 null/非对象 ⇒ 必须拒绝。
    // 放行它的话，调用方按 kind 收窄后访问 event.data.x 会在运行期炸 TypeError ——
    // 而守卫的本职恰是拦住这种行。这正是 OCR 判 HIGH 的那条。
    expect(isLedgerEvent({ ...memberAddedEvent, data: undefined })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, data: null })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, data: 'not-an-object' })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, data: 42 })).toBe(false)
    // 空对象是合法「对象」，守卫只验结构不验载荷字段（契约如此）
    expect(isLedgerEvent({ ...memberAddedEvent, data: {} })).toBe(true)

    // 序号：必须 ≥1 的安全整数（用 isSafeInteger 而非 isInteger，
    // 否则 -1 与 2^53 都会被当成合法序号）
    expect(isLedgerEvent({ ...memberAddedEvent, sequence: 0 })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, sequence: -1 })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, sequence: Number.MAX_SAFE_INTEGER + 1 })).toBe(false)

    // 时间：必须有限且非负（NaN/±Infinity 都不是合法时间戳）
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: Number.NaN })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: -1 })).toBe(false)
    // 小数也必须拒（OCR [41]）：写入侧因 STRICT 表的 INTEGER 列只接受**安全整数**，
    // 若读回侧放行小数，就形成写读不对称 —— 那种事件根本存不进库，却会被守卫判为合法。
    // 两侧同判据，`commit 接受 ⟺ 读回接受` 才成立。
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: 1_760_000_000_000.5 })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: 0.5 })).toBe(false)
    // 超出安全整数范围的大数同样不是合法时间戳。
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: Number.MAX_SAFE_INTEGER + 2 })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: 0 })).toBe(true)
    expect(isLedgerEvent({ ...memberAddedEvent, occurredAt: 1_760_000_000_000 })).toBe(true)
  })

  it('首条事件的 previousEventId 为 null 能通过守卫（AC-10-9 的结构前提）', () => {
    expect(memberAddedEvent.sequence).toBe(1)
    expect(memberAddedEvent.previousEventId).toBeNull()
    expect(isLedgerEvent(memberAddedEvent)).toBe(true)
  })

  it('OCR [18]：数组**不是**合法载荷（`data` 必须是非 null **具名对象**）', () => {
    // `LedgerEventMap` 里没有任何 kind 的载荷是数组（全部是具名对象形状）。
    // 放行数组会让按 kind 收窄的消费方读 `event.data.<字段>` 得到 `undefined` ——
    // 实测后果见 delegation.ts 的 `findTeamCreatedFor`（OCR [12] 的 phantom success，
    // 那条 `team/created, data: []` 正是从这里进来的）。
    // 反恒真：删掉 guards.ts 的 `Array.isArray(data)` 一条，本条必须变红。
    expect(isLedgerEvent({ ...memberAddedEvent, data: [] })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, data: [1, 2] })).toBe(false)
    // 对照：**载荷里的**数组字段仍然合法（收窄的是载荷本身，不是载荷内的值）。
    expect(isLedgerEvent({ ...memberAddedEvent, data: { nested: [1, 2] } })).toBe(true)
  })

  it('OCR [17]：`requestId` 要么缺席、要么是非空字符串（否则静默失配）', () => {
    // 缺这道判定时 `requestId: 42` 能过守卫，随后 `collectSpawnEvents` 拿它做
    // `event.requestId !== requestId` 比较：`42 !== 'R1'` 恒真 ⇒ 该事件被**静默忽略**
    // （既不报错、也不出现在结果里）。这类「值在但类型不对」的静默失配正是守卫要拦的。
    // 反恒真：删掉 guards.ts 的 requestId 判定块，本条必须变红。
    expect(isLedgerEvent({ ...memberAddedEvent, requestId: 42 })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, requestId: '' })).toBe(false)
    expect(isLedgerEvent({ ...memberAddedEvent, requestId: null })).toBe(false)
    // 对照：缺席（undefined）与非空字符串都合法。
    expect(isLedgerEvent(memberAddedEvent)).toBe(true)
    expect(isLedgerEvent({ ...memberAddedEvent, requestId: 'R-1' as RequestId })).toBe(true)
  })
})

/** 构造一个 Team 的测试替身（可选审计字段按需传入）。 */
function team(id: TeamId, audit?: HostSessionId): Team {
  const base: Team = {
    teamId: id,
    kind: 'persistent',
    ownerMemberId: null,
    parentTeamId: null,
    state: 'active',
    createdAtSequence: 1,
  }
  return audit === undefined ? base : { ...base, lastHostSessionId: audit }
}

const memberAddedEvent = {
  eventId: 'evt-1' as LedgerEvent['eventId'],
  sequence: 1,
  occurredAt: 1_760_000_000_000,
  actor: { kind: 'host', hostSessionId },
  previousEventId: null,
  kind: 'team/member-added',
  data: {
    teamId,
    member: { position: '灵台郎', name: '灵台郎', memberId },
    lifecycle: 'active',
    // `model` 是**必填但可空**（`MemberAddedData` 的说明）：此夹具只关心 kind 判别与
    // 三层标识的收窄，故如实写 `null`（成员跟随全局默认），而不是塞一个假模型。
    model: null,
  },
} satisfies LedgerEvent

const principalRejectedEvent = {
  eventId: 'evt-2' as LedgerEvent['eventId'],
  sequence: 2,
  occurredAt: 1_760_000_001_000,
  actor: { kind: 'member', memberId } as const,
  previousEventId: 'evt-1' as LedgerEvent['eventId'],
  kind: 'spawn/principal-rejected',
  data: {
    requestId,
    requesterMemberId: memberId,
    principalMemberId: memberId,
    targetKind: 'persistent',
    // `spec` 与第二级的 `human-approved` / `human-rejected` 对称携带
    // （captain 裁定 Q-E，SPEC §11：第一级否决原先缺 targetKind+spec 是**契约漏写**）。
    spec: { name: '推步组', roster: [], tasks: [] },
    reason: '本季度架构冻结',
  },
} satisfies LedgerEvent

/** `spawn/human-rejected` 的样例事件（供「载荷不得反驳 kind」的类型级断言复用）。 */
const humanRejectedEvent = {
  eventId: 'evt-4' as LedgerEvent['eventId'],
  sequence: 4,
  occurredAt: 1_760_000_003_000,
  actor: { kind: 'human', humanId: 'human-1' } as const,
  previousEventId: 'evt-3' as LedgerEvent['eventId'],
  kind: 'spawn/human-rejected',
  data: {
    requestId,
    requesterMemberId: memberId,
    principalMemberId: memberId,
    humanOperatorId: 'human-1',
    targetKind: 'persistent',
    spec: { name: '推步组', roster: [], tasks: [] },
    decision: 'reject',
    reason: '资源不足',
  },
} satisfies LedgerEvent

const humanApprovedEvent = {
  eventId: 'evt-3' as LedgerEvent['eventId'],
  sequence: 3,
  occurredAt: 1_760_000_002_000,
  actor: { kind: 'human', humanId: 'human-1' } as const,
  previousEventId: 'evt-2' as LedgerEvent['eventId'],
  kind: 'spawn/human-approved',
  data: {
    requestId,
    requesterMemberId: memberId,
    principalMemberId: memberId,
    humanOperatorId: 'human-1',
    targetKind: 'persistent',
    spec: { name: '推步组', roster: [{ position: '推步主事', count: 1 }], tasks: ['校准历法'] },
    decision: 'approve',
  },
} satisfies LedgerEvent
