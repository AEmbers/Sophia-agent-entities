/**
 * 派生策略与两级审批的验收测试（SPEC §4 §5 全文 / §7.2 的 AC-5-1…AC-5-15）。
 *
 * ## 本文件的断言为什么不是恒真的
 *
 * 1. **AC-5-2 / AC-5-6 / AC-5-7 用计数 spy 断言「副作用为零」**，而不是只看返回值：
 *    返回一个 `forbidden` 却顺手建了团，是这类代码最典型的缺陷，返回值的形状看不出来。
 *    `createTeam` / `inbox.push` / `principalOf` 三个 spy 各自独立计数，
 *    任何一条「本该 0 次」被改成 1 次都会立刻变红。
 * 2. **AC-5-10 / AC-5-11 / AC-5-12 是一组对照**：AC-5-10 禁「同 requestId 换类型」，
 *    AC-5-11 必须**放行**「换 requestId」。只测前者的话，把实现改成「一律禁止」也能全绿 ——
 *    那会直接违反 FR-5.3.5。两条一起才锁得住语义。
 * 3. **AC-5-13…15 的期望值是字面量**（`'member-grandparent'` / `'member-principal'`），
 *    不是由被测实现算出来的。
 * 4. **编译期守卫**（文件末）：`SpawnRequest` 不得出现 `depth` / `maxDepth`（AC-5-3），
 *    `SpawnOutcome` 的 `switch` 必须穷尽（AC-5-4）—— 两者都由 `tsc` 而非断言守住。
 *
 * ## 两处「先例教训」的落实
 *
 * - 退出码不在此文件里取（那是 shell 的事）；本文件只保证「有失败用例时 vitest 会红」。
 * - 每个断言都配了**阴性用例**：权限矩阵 4 格逐格各一条、被否路径的三种目标类型各一条。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { HumanInbox, HumanInboxItem, PrincipalReviewer, PrincipalVerdict, SpawnTicket } from '../src/index.ts'
import {
  PERSISTENT_POLICY,
  TEMPORARY_POLICY,
  decideSpawnTicket,
  openLedger,
  policyOf,
  readSpawnTicket,
  reattachOrphanedTeams,
  requestSpawn,
  spawnTicketIdOf,
  type DelegationDeps,
  type Ledger,
  type LedgerEvent,
  type MemberId,
  type OrphanReattachmentDeps,
  type RequestId,
  type SpawnOutcome,
  type SpawnRequest,
  type TeamId,
  type TeamSpec,
} from '../src/index.ts'

// ——————————————————————————————————————————————————————————————
// 夹具（fixtures）
// ——————————————————————————————————————————————————————————————

const memberA = 'sophia-lingtai-lang-aaaaaaaa' as MemberId
const memberB = 'sophia-tuibu-zhushi-bbbbbbbb' as MemberId
const principalId = 'sophia-qintianjian-jianzheng-cccccccc' as MemberId

/**
 * 测试里打开过的账本与临时目录，`afterEach` 统一清理。
 *
 * 必须显式清理：`:memory:` 库不会自己释放，而**文件库**（跨进程那条用例用的）
 * 不关掉会让后续测试读到别的测试遗留的行 —— 那种失败的症状离原因极远。
 */
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

const spec: TeamSpec = {
  name: '推步历算专班',
  roster: [{ position: '推步主事', count: 2 }],
  tasks: ['编算时宪历'],
}

function requestOf(
  id: string,
  targetKind: 'persistent' | 'temporary',
  requesterKind: 'persistent' | 'temporary' = 'persistent',
): SpawnRequest {
  return {
    requestId: id as RequestId,
    requesterMemberId: requesterKind === 'persistent' ? memberA : memberB,
    requesterKind,
    targetKind,
    spec,
  }
}

/** 计数 spy 的集合：每一个副作用通道各一个计数器 + 记录。 */
interface Spies {
  readonly principalOf: MemberId[]
  readonly createTeam: SpawnRequest[]
  readonly inboxPush: HumanInboxItem[]
  /** 可变计数（`now()` 被调用几次）。 */
  nowCalls: number
  readonly verdicts: PrincipalVerdict[]
}

/** 构造一套假件（SPEC §5.2 的 `DelegationDeps`）。 */
function makeDeps(
  options: {
    readonly verdict?: PrincipalVerdict | ((request: SpawnRequest) => PrincipalVerdict | Promise<PrincipalVerdict>) | undefined
    readonly humanOperatorId?: string | undefined
    readonly createTeam?: ((request: SpawnRequest) => Promise<TeamId>) | undefined
    readonly ledger?: Ledger | undefined
    /**
     * 收件箱推送的副作用钩子：抛错即模拟「收件箱暂时不可用」。
     * 用于验证「push 失败后重试」这条路径（OCR 评审 [1] 抓出的缺陷）。
     */
    readonly onInboxPush?: ((item: HumanInboxItem) => void) | undefined
  } = {},
): { deps: DelegationDeps; spies: Spies; ledger: Ledger; ticketOf: (requestId: RequestId) => SpawnTicket | null } {
  const spies: Spies = { principalOf: [], createTeam: [], inboxPush: [], nowCalls: 0, verdicts: [] }
  const ledger = options.ledger ?? openLedger({ path: ':memory:' })

  let teamCounter = 0
  const deps: DelegationDeps = {
    ledger,
    inbox: {
      async push(item: HumanInboxItem): Promise<void> {
        // 钩子在**记录之前**调用：这样 spy 记录的是「真的推成功了」那些，
        // 与「尝试推送」区分开 —— 后者会把失败也数进去，让断言读不出真实情况。
        options.onInboxPush?.(item)
        spies.inboxPush.push(item)
      },
      async list(): Promise<readonly HumanInboxItem[]> {
        return spies.inboxPush
      },
    } satisfies HumanInbox,
    async principalOf(memberId: MemberId): Promise<PrincipalReviewer> {
      spies.principalOf.push(memberId)
      const verdictSource = options.verdict
      return {
        memberId: principalId,
        async reviewSpawn(request: SpawnRequest): Promise<PrincipalVerdict> {
          const verdict =
            typeof verdictSource === 'function'
              ? await verdictSource(request)
              : (verdictSource ?? { approved: true })
          spies.verdicts.push(verdict)
          return verdict
        },
      }
    },
    async createTeam(request: SpawnRequest): Promise<TeamId> {
      spies.createTeam.push(request)
      if (options.createTeam !== undefined) {
        return options.createTeam(request)
      }
      teamCounter += 1
      return `team-${teamCounter}` as TeamId
    },
    now(): number {
      spies.nowCalls += 1
      return 1_700_000_000_000 + spies.nowCalls
    },
    currentHumanOperatorId(): string {
      return options.humanOperatorId ?? 'human-emperor'
    },
  }

  return { deps, spies, ledger, ticketOf: (requestId: RequestId) => readSpawnTicket(ledger, requestId) }
}

/** 账本里全部事件（不过滤）。 */
function allEvents(ledger: Ledger): readonly LedgerEvent[] {
  return ledger.read({}).events
}

/**
 * 断言某个判别联合的 `kind`，并**收窄类型**。
 *
 * 单独包一层是因为 vitest 的 `expect(x.kind).toBe(y)` 在联合类型上不会替我们收窄类型，
 * 后续访问 `x.reason` / `x.teamId` 会报错。这个 helper 让断言写法保持直白。
 *
 * 对 `U` 泛型是必要的：`decideSpawnTicket` 返回的是 `SpawnDecisionOutcome`
 * （`SpawnOutcome` 的超集），只认 `SpawnOutcome` 的版本会在那里报类型错。
 */
function expectKind<U extends { readonly kind: string }, T extends U['kind']>(
  outcome: U,
  kind: T,
): asserts outcome is Extract<U, { readonly kind: T }> {
  expect(outcome.kind).toBe(kind)
}

/**
 * 把事件的 `data` 当作字典读（逐字段断言载荷内容时用）。
 *
 * 走 `as unknown as` 是刻意的：`LedgerEvent['data']` 是一堆**没有索引签名**的接口的联合，
 * 直接 `as Record<string, unknown>` 会被 `tsc` 判为「两边不相交」而拒绝。
 * 这条转换只在测试里用，且断言的是「账本里真的写了这些字段」—— 不是绕过类型检查去用未定义的行为。
 */
function dataOf(event: LedgerEvent | undefined): Record<string, unknown> {
  return (event?.data ?? {}) as unknown as Record<string, unknown>
}

// ——————————————————————————————————————————————————————————————
// AC-5-1 权限矩阵（4 格）
// ——————————————————————————————————————————————————————————————

describe('AC-5-1 派生权限矩阵', () => {
  it('PERSISTENT_POLICY 两类都能开；仅持久团需审批', () => {
    expect(PERSISTENT_POLICY.canSpawn).toEqual(['persistent', 'temporary'])
    expect(PERSISTENT_POLICY.requiresApproval).toEqual({ persistent: true, temporary: false })
  })

  it('TEMPORARY_POLICY 只能开临时团；两个 requiresApproval 取值与持久策略逐字相同', () => {
    expect(TEMPORARY_POLICY.canSpawn).toEqual(['temporary'])
    expect(TEMPORARY_POLICY.requiresApproval).toEqual({ persistent: true, temporary: false })
  })

  it('policyOf 按发起方类型返回对应策略', () => {
    expect(policyOf('persistent')).toBe(PERSISTENT_POLICY)
    expect(policyOf('temporary')).toBe(TEMPORARY_POLICY)
  })

  it('矩阵第 1 格：持久成员开持久团 → 进审批（不是直建）', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R1', 'persistent', 'persistent'))
    expectKind(outcome, 'awaitingHumanApproval')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('矩阵第 2 格：持久成员开临时团 → 直建', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R2', 'temporary', 'persistent'))
    expectKind(outcome, 'created')
    expect(spies.createTeam).toHaveLength(1)
  })

  it('矩阵第 3 格：临时成员开持久团 → 拒绝', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R3', 'persistent', 'temporary'))
    expectKind(outcome, 'forbidden')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('矩阵第 4 格：临时成员开临时团 → 直建', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R4', 'temporary', 'temporary'))
    expectKind(outcome, 'created')
    expect(spies.createTeam).toHaveLength(1)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-2 临时成员被拒 + 可读报错 + 零副作用
// ——————————————————————————————————————————————————————————————

describe('AC-5-2 临时成员开持久团：拒绝且副作用为零', () => {
  it('返回 forbidden（不是抛异常），拒因同时说明「为什么不行」与「该怎么办」', async () => {
    const { deps, spies, ledger } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R-forbid', 'persistent', 'temporary'))

    expectKind(outcome, 'forbidden')
    expect(outcome.errorCode).toBe('ERR_SPAWN_FORBIDDEN')
    // 「为什么不行」：临时团是任务组、完成即回收，而持久团需长期编制（FR-5.1 / FR-5.2.1）
    expect(outcome.reason).toContain('临时成员')
    expect(outcome.reason).toContain('持久')
    // 「该怎么办」：汇报给团长，由持久成员发起
    expect(outcome.reason).toContain('团长')
    // 中文（不出现英文错误码作为给模型看的正文）
    expect(/[\u4e00-\u9fa5]/.test(outcome.reason)).toBe(true)

    // 副作用为零：不建团、不推收件箱、不解析团长、不写账本
    expect(spies.createTeam).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(0)
    expect(spies.principalOf).toHaveLength(0)
    expect(allEvents(ledger)).toHaveLength(0)
  })

  it('零副作用是「计数」而非「形状」：连续两次拒绝，计数仍为 0', async () => {
    const { deps, spies, ledger } = makeDeps()
    await requestSpawn(deps, requestOf('R-forbid-2', 'persistent', 'temporary'))
    await requestSpawn(deps, requestOf('R-forbid-3', 'persistent', 'temporary'))
    expect(spies.createTeam).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(0)
    expect(allEvents(ledger)).toHaveLength(0)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-3 不设层数上限
// ——————————————————————————————————————————————————————————————

describe('AC-5-3 深度不设层数上限（控制手段是审批门）', () => {
  it('深度 0/1/2/3 各发起同规格持久团申请，四次都返回 awaiting（而非 forbidden）', async () => {
    const { deps, spies } = makeDeps()
    const depths = [0, 1, 2, 3]
    for (const depth of depths) {
      // ⚠ 把 `depth` 作为**真实字段**塞进请求（`as` 到宽松类型上），而不是只把它写进 requestId。
      // 变异测试教训：只写进 requestId 的版本对「实现里偷偷读 `request.depth` 并加阈值」
      // 这类改动**完全无感**（`request.depth` 永远是 undefined，阈值永不触发）。
      // 这个写法让「只要实现里存在任何深度阈值，就会在 depth=2 或 3 上把它触发」，
      // 从而真正守住 AC-5-3。
      const request = {
        ...requestOf(`R-depth-${depth}`, 'persistent', 'persistent'),
        depth,
        maxDepth: depth,
      } as SpawnRequest
      const outcome = await requestSpawn(deps, request)
      expectKind(outcome, 'awaitingHumanApproval')
    }
    // 四次都真的走到了审批门（每次一张待办），而不是被某个深度阈值拦掉
    expect(spies.inboxPush).toHaveLength(depths.length)
    expect(spies.createTeam).toHaveLength(0)
  })

  it('极深（1000 层）的申请同样只受审批门约束，不被任何阈值拦下', async () => {
    const { deps } = makeDeps()
    const deep = {
      ...requestOf('R-depth-1000', 'persistent', 'persistent'),
      depth: 1000,
      maxDepth: 1000,
    } as SpawnRequest
    const outcome = await requestSpawn(deps, deep)
    expectKind(outcome, 'awaitingHumanApproval')
  })

  it('浅层与深层的返回值逐字同形（没有「深层需要额外批准」这类差异）', async () => {
    const { deps } = makeDeps()
    const shallow = await requestSpawn(deps, requestOf('R-shallow', 'persistent', 'persistent'))
    const deep = await requestSpawn(deps, requestOf('R-deep', 'persistent', 'persistent'))
    expect(Object.keys(shallow).sort()).toEqual(Object.keys(deep).sort())
    expect(shallow.kind).toBe(deep.kind)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-4 结果联合穷尽
// ——————————————————————————————————————————————————————————————

describe('AC-5-4 SpawnOutcome 是恰 5 个 kind 的可辨识联合', () => {
  it('穷尽 switch 覆盖全部 kind 且都能拿到具体分支（编译期由 tsc 守着，见文件末守卫）', () => {
    const seen = new Set<string>()
    for (const outcome of sampleOutcomes()) {
      seen.add(narrateOutcome(outcome))
    }
    expect(seen).toEqual(
      new Set([
        'created',
        'awaitingHumanApproval',
        'rejectedByPrincipal',
        'forbidden',
        'noDowngradeBypass',
      ]),
    )
  })

  it('实跑一遍：五种 kind 都能在真实调用里出现', async () => {
    // created（免审）
    const a = makeDeps()
    const created = await requestSpawn(a.deps, requestOf('E1', 'temporary', 'persistent'))
    expect(created.kind).toBe('created')

    // awaitingHumanApproval
    const b = makeDeps()
    const awaiting = await requestSpawn(b.deps, requestOf('E2', 'persistent', 'persistent'))
    expect(awaiting.kind).toBe('awaitingHumanApproval')

    // rejectedByPrincipal
    const c = makeDeps({ verdict: { approved: false, reason: '人手不足' } })
    const rejected = await requestSpawn(c.deps, requestOf('E3', 'persistent', 'persistent'))
    expect(rejected.kind).toBe('rejectedByPrincipal')

    // forbidden
    const d = makeDeps()
    const forbidden = await requestSpawn(d.deps, requestOf('E4', 'persistent', 'temporary'))
    expect(forbidden.kind).toBe('forbidden')

    // noDowngradeBypass
    const e = makeDeps({ verdict: { approved: false, reason: '不再扩编' } })
    await requestSpawn(e.deps, requestOf('E5', 'persistent', 'persistent'))
    const bypass = await requestSpawn(e.deps, requestOf('E5', 'temporary', 'persistent'))
    expect(bypass.kind).toBe('noDowngradeBypass')
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-5 免审路径零审批
// ——————————————————————————————————————————————————————————————

describe('AC-5-5 临时团免审：零审批调用', () => {
  it('持久成员开临时团 → created，且 principalOf 0 次、inbox.push 0 次、账本无审批事件', async () => {
    const { deps, spies, ledger } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R-free', 'temporary', 'persistent'))

    expectKind(outcome, 'created')
    expect(outcome.teamId).toBe('team-1' as TeamId)
    expect(spies.principalOf).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(0)
    expect(spies.createTeam).toHaveLength(1)

    // 免审路径**不写任何审批事件**（不是「写了但状态是 approved」）
    const spawnEvents = allEvents(ledger).filter((event) => event.kind.startsWith('spawn/'))
    expect(spawnEvents).toHaveLength(0)
  })

  it('临时成员开临时团同样零审批调用', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R-free-temp', 'temporary', 'temporary'))
    expectKind(outcome, 'created')
    expect(spies.principalOf).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(0)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-6 第一级否决不进第二级
// ——————————————————————————————————————————————————————————————

describe('AC-5-6 团长否决 → 不进第二级', () => {
  it('rejectedByPrincipal，inbox.push 0 次、createTeam 0 次，拒因来自团长', async () => {
    const { deps, spies, ledger } = makeDeps({ verdict: { approved: false, reason: '本季度不再扩编' } })
    const outcome = await requestSpawn(deps, requestOf('R6', 'persistent', 'persistent'))

    expectKind(outcome, 'rejectedByPrincipal')
    expect(outcome.reason).toBe('本季度不再扩编')
    expect(spies.inboxPush).toHaveLength(0)
    expect(spies.createTeam).toHaveLength(0)

    // 否决必须落账本（否则重启后「不得绕开」失效）
    const kinds = allEvents(ledger).map((event) => event.kind)
    expect(kinds).toEqual(['spawn/principal-rejected'])
  })

  it('团长未给理由时，拒因不出现空串（有可读兜底）', async () => {
    const { deps } = makeDeps({ verdict: { approved: false } })
    const outcome = await requestSpawn(deps, requestOf('R6b', 'persistent', 'persistent'))
    expectKind(outcome, 'rejectedByPrincipal')
    expect(outcome.reason.trim()).not.toBe('')
    expect(outcome.reason).toContain('团长')
  })

  it('团长批准时才推收件箱：两种预审结论形成对照', async () => {
    const rejectedDeps = makeDeps({ verdict: { approved: false, reason: 'x' } })
    await requestSpawn(rejectedDeps.deps, requestOf('R6c', 'persistent', 'persistent'))
    expect(rejectedDeps.spies.inboxPush).toHaveLength(0)

    const approvedDeps = makeDeps({ verdict: { approved: true } })
    await requestSpawn(approvedDeps.deps, requestOf('R6d', 'persistent', 'persistent'))
    expect(approvedDeps.spies.inboxPush).toHaveLength(1)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-7 第二级未批不创建
// ——————————————————————————————————————————————————————————————

describe('AC-5-7 团长批准后停在第二级，未获人类结论前不创建', () => {
  it('awaitingHumanApproval + createTeam 0 次 + inbox.push 1 次且 actions 恰为 [approve,reject]', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await requestSpawn(deps, requestOf('R7', 'persistent', 'persistent'))

    expectKind(outcome, 'awaitingHumanApproval')
    expect(outcome.ticketId).toBe(spawnTicketIdOf('R7' as RequestId))
    expect(spies.createTeam).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(1)
    expect(spies.inboxPush[0]?.actions).toEqual(['approve', 'reject'])
    expect(spies.inboxPush[0]?.ticketId).toBe(outcome.ticketId)
  })

  it('待办标题带上拟建团名（人类在收件箱里能看懂这条待办是什么）', async () => {
    const { deps, spies } = makeDeps()
    await requestSpawn(deps, requestOf('R7b', 'persistent', 'persistent'))
    expect(spies.inboxPush[0]?.title).toContain(spec.name)
  })

  it('同一 requestId 重复提交：幂等回放，不重复建团、不重复推收件箱', async () => {
    const { deps, spies } = makeDeps()
    const first = await requestSpawn(deps, requestOf('R7c', 'persistent', 'persistent'))
    const second = await requestSpawn(deps, requestOf('R7c', 'persistent', 'persistent'))

    expectKind(first, 'awaitingHumanApproval')
    expectKind(second, 'awaitingHumanApproval')
    expect(second.ticketId).toBe(first.ticketId)
    expect(spies.inboxPush).toHaveLength(1)
    expect(spies.createTeam).toHaveLength(0)
  })

  it('**并发**批准同一票号 → 只建一个团（OCR 评审 [1] 抓出的真缺陷）', async () => {
    // ⚠ `decideSpawnTicket` 起初没有在途注册：两次并发 `approve` 都在对方落
    // `spawn/human-approved` **之前**读账本（两侧都读到「尚无人类结论」），
    // 于是各自 `createTeam` —— 一个票号建出两个团，后写的 `state.decided` 静默覆盖先写的。
    // 这与 `requestSpawn` 免审路径上的那个缺陷是同一类，修法也相同。
    const { deps, spies } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('RC1', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const [r1, r2] = await Promise.all([
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' }),
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' }),
    ])
    expectKind(r1, 'created')
    expectKind(r2, 'created')
    // 两次必须得到**同一个**团，且只建了一次
    expect(r2.teamId).toBe(r1.teamId)
    expect(spies.createTeam).toHaveLength(1)
  })

  it('并发批准的第二种情形：一次批准 + 一次否决 → 只有一条人类结论，另一次被去重', async () => {
    const { deps, spies, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('RC2', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const [approved, rejected] = await Promise.all([
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' }),
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'reject', reason: '并发否决' }),
    ])
    // 结论互斥：两个返回值**必须相同**（第二次共享第一次的在途结论），
    // 不允许「一个说建好了、另一个说否了」。
    expect(rejected.kind).toBe(approved.kind)
    expect(['created', 'rejectedByHuman']).toContain(approved.kind)

    // 账本上只能有**一条**人类结论 —— 这是真正要守的不变量。
    // 修这个缺陷之前，这里会是 2 条（既批准又否决），而 `createTeam` 还会跑两次。
    const humanConclusions = allEvents(ledger).filter(
      (event) => event.kind === 'spawn/human-approved' || event.kind === 'spawn/human-rejected',
    )
    expect(humanConclusions).toHaveLength(1)

    // 若批准赢了就只建一个团；若否决赢了就一个都不建 —— 但绝不可能建两个
    expect(spies.createTeam.length).toBeLessThanOrEqual(1)
    if (approved.kind === 'created') {
      expect(spies.createTeam).toHaveLength(1)
    } else {
      expect(spies.createTeam).toHaveLength(0)
    }
  })

  it('收件箱推送失败后重试：**不得**重复落 awaiting、不得重复预审（OCR 评审 [1] 的 HIGH）', async () => {
    // ⚠ 缺陷现场：`awaiting` 事件在 `inbox.push` **之前**落账，而 `state.decided` 只在
    // 整个 promise **成功返回后**才写。于是 push 抛错时 `decided` 是空的 → 重试会
    // 重新走一遍 `runApprovalPath`：再预审一次、再落一条 awaiting、再推一次收件箱。
    // 而原来的文件头注释却声称「重试会命中幂等回放，不会重复推送」——**那是假的**。
    let failNext = true
    const { deps, spies, ledger } = makeDeps({
      onInboxPush: (): void => {
        if (failNext) {
          failNext = false
          throw new Error('收件箱暂时不可用（模拟）')
        }
      },
    })
    const request = requestOf('RF1', 'persistent', 'persistent')

    await expect(requestSpawn(deps, request)).rejects.toThrow(/收件箱暂时不可用/)

    const awaitingCount = (): number =>
      allEvents(ledger).filter((event) => event.kind === 'spawn/awaiting-human-approval').length
    // 第一次已落一条（这是**事实**：申请确实进入了第二级）
    expect(awaitingCount()).toBe(1)
    expect(spies.inboxPush).toHaveLength(0)

    // 重试：必须**复用**那条已有的 awaiting，而不是再落一条
    const retry = await requestSpawn(deps, request)
    expectKind(retry, 'awaitingHumanApproval')
    expect(awaitingCount()).toBe(1)
    // 收件箱这次真的收到了（补推成功），且只推了一条
    expect(spies.inboxPush).toHaveLength(1)
    // 预审**不得**重跑（否则第二次预审若给出相反的结论，会落出互相矛盾的事件）
    expect(spies.principalOf).toHaveLength(1)
    expect(spies.verdicts).toHaveLength(1)
  })

  it('收件箱推送失败重试后，票据仍可投影（awaiting 事件没有丢失）', async () => {
    let failNext = true
    const { deps, ledger } = makeDeps({
      onInboxPush: (): void => {
        if (failNext) {
          failNext = false
          throw new Error('收件箱暂时不可用（模拟）')
        }
      },
    })
    const request = requestOf('RF2', 'persistent', 'persistent')
    await expect(requestSpawn(deps, request)).rejects.toThrow()
    await requestSpawn(deps, request)

    const ticket = readSpawnTicket(ledger, 'RF2' as RequestId)
    expect(ticket).not.toBeNull()
    expect(ticket?.status).toBe('pending-human')
    expect(ticket?.spec).toEqual(spec)
  })

  it('**并发**重复提交（不 await 第一次就发第二次）→ 只产生一份待办、一次预审', async () => {
    // ⚠ 这条是变异测试逼出来的：上一条用的是「await 完再提」，走的是**幂等回放**那条路。
    // 把「在途 Promise 注册」整条删掉，那条用例**仍然全绿** —— 于是并发去重是无人守护的死代码。
    // 这里刻意**不 await** 第一次就发第二次：两次调用在 `runApprovalPath` 的 await 点交错，
    // 只有「在途注册」能拦住第二次真的再走一遍流程。
    const { deps, spies, ledger } = makeDeps()

    const p1 = requestSpawn(deps, requestOf('R7d', 'persistent', 'persistent'))
    const p2 = requestSpawn(deps, requestOf('R7d', 'persistent', 'persistent'))
    const [r1, r2] = await Promise.all([p1, p2])

    expectKind(r1, 'awaitingHumanApproval')
    expectKind(r2, 'awaitingHumanApproval')
    // 两次得到**同一个**票据（而不是两张）
    expect(r2.ticketId).toBe(r1.ticketId)
    // 关键计数：预审只跑了一次、待办只推了一条
    expect(spies.principalOf).toHaveLength(1)
    expect(spies.inboxPush).toHaveLength(1)
    expect(spies.createTeam).toHaveLength(0)
    // 账本里也只有一条 awaiting（不是两条）
    const awaitingEvents = allEvents(ledger).filter(
      (event) => event.kind === 'spawn/awaiting-human-approval',
    )
    expect(awaitingEvents).toHaveLength(1)
  })

  it('并发去重的第三种情形：先发持久团、再并发发同一 requestId 的临时团 → 后者不得创建', async () => {
    const { deps, spies } = makeDeps()

    const p1 = requestSpawn(deps, requestOf('R7e', 'persistent', 'persistent'))
    const p2 = requestSpawn(deps, requestOf('R7e', 'temporary', 'persistent'))
    const [r1, r2] = await Promise.all([p1, p2])

    expectKind(r1, 'awaitingHumanApproval')
    expectKind(r2, 'noDowngradeBypass')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('**免审路径**的并发去重：并发发同一 requestId 的临时团 → 只建一个团', async () => {
    // ⚠ 这条是 OCR 评审抓出的真缺陷（HIGH）：免审路径原先**没有**在途注册 ——
    // 两次并发调用都会读到 `decided` 为空、`inFlight` 也为空，于是各自 `await createTeam`，
    // 一个 requestId 建出两个团。这条用例在有缺陷的版本上必然变红（createTeam 2 次）。
    const { deps, spies, ledger } = makeDeps()

    const p1 = requestSpawn(deps, requestOf('R7f', 'temporary', 'persistent'))
    const p2 = requestSpawn(deps, requestOf('R7f', 'temporary', 'persistent'))
    const [r1, r2] = await Promise.all([p1, p2])

    expectKind(r1, 'created')
    expectKind(r2, 'created')
    // 同一个 requestId 只能建出一个团 —— 两次拿到同一个 teamId
    expect(r2.teamId).toBe(r1.teamId)
    expect(spies.createTeam).toHaveLength(1)

    // 账本视角：只提交了一条 team/created（若注入的 createTeam 会落账的话）；
    // 这里至少确认「建团调用次数」是 1，不靠实现自己报数。
    expect(new Set([r1, r2].map((r) => (r.kind === 'created' ? r.teamId : null))).size).toBe(1)
    void ledger
  })

  it('免审路径的并发去重（临时成员的临时团）：同样只建一个', async () => {
    const { deps, spies } = makeDeps()
    const p1 = requestSpawn(deps, requestOf('R7g', 'temporary', 'temporary'))
    const p2 = requestSpawn(deps, requestOf('R7g', 'temporary', 'temporary'))
    const [r1, r2] = await Promise.all([p1, p2])
    expectKind(r1, 'created')
    expectKind(r2, 'created')
    expect(spies.createTeam).toHaveLength(1)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-8 / AC-5-9 第二级批准才创建 + 两级审批人
// ——————————————————————————————————————————————————————————————

describe('AC-5-8 人类批准后才创建，且账本载荷含六项', () => {
  it('decideSpawnTicket approve → created，账本可查到 spawn/human-approved', async () => {
    const { deps, spies, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R8', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    expect(spies.createTeam).toHaveLength(0)

    const decided = await decideSpawnTicket(deps, {
      ticketId: awaiting.ticketId,
      decision: 'approve',
    })
    expectKind(decided, 'created')
    expect(spies.createTeam).toHaveLength(1)

    const approved = allEvents(ledger).find((event) => event.kind === 'spawn/human-approved')
    expect(approved).toBeDefined()
    const data = dataOf(approved)
    // FR-5.3.3 明列的六项：申请成员、目标团规格、两级审批人、时间、结论
    expect(data['requesterMemberId']).toBe(memberA)
    expect(data['principalMemberId']).toBe(principalId)
    expect(data['targetKind']).toBe('persistent')
    expect(data['spec']).toEqual(spec)
    expect(data['decision']).toBe('approve')
    expect(approved?.occurredAt).toBeTypeOf('number')
    expect(approved?.requestId).toBe('R8')
  })

  it('同一票号批两次：第二次**幂等回放**同一 teamId，createTeam 仍只有 1 次', async () => {
    // ⚠ 这条的行为在 OCR 评审后**改了**（评审 [2] 抓出的真缺陷）。
    // 原先第二次返回 `ticketNotFound`，但那种设计留下了无法恢复的状态：
    // 若批准落账后 `createTeam` 失败，同一票号就再也建不出团了（重试被查重挡掉）。
    // 现在改成幂等回放 —— 「同一申请批两次不会建两个团」这个**意图**由「返回同一个 teamId」实现，
    // 而不是靠「第二次报错」。两者都防住重复建团，但前者可恢复。
    const { deps, spies } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R8b', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const first = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(first, 'created')
    const second = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(second, 'created')
    expect(second.teamId).toBe(first.teamId)
    expect(spies.createTeam).toHaveLength(1)
  })

  it('恢复路径（OCR 评审 [2]）：批准已落账但建团失败 → 重试同票号可**补建**，且不重复落批准事件', async () => {
    // 第一次 createTeam 抛错，账本上留下「已批准但团不存在」
    let failFirst = true
    const { deps, ledger } = makeDeps({
      createTeam: async (): Promise<TeamId> => {
        if (failFirst) {
          failFirst = false
          throw new Error('磁盘满了（模拟建团失败）')
        }
        return 'team-recovered' as TeamId
      },
    })
    const awaiting = await requestSpawn(deps, requestOf('R8e', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    await expect(
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' }),
    ).rejects.toThrow(/已获人类批准/)

    const approvedEvents = (): readonly LedgerEvent[] =>
      allEvents(ledger).filter((event) => event.kind === 'spawn/human-approved')
    expect(approvedEvents()).toHaveLength(1)

    // 重试同一票号：走「已批准但团不存在」的续做路径
    const recovered = await decideSpawnTicket(deps, {
      ticketId: awaiting.ticketId,
      decision: 'approve',
    })
    expectKind(recovered, 'created')
    expect(recovered.teamId).toBe('team-recovered' as TeamId)
    // 关键：**没有**重复落批准事件（批准事实只有一条）
    expect(approvedEvents()).toHaveLength(1)
  })

  it('恢复路径的反面：团已建成时重试 → 幂等回放，绝不再建第二个团', async () => {
    const { deps, spies, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R8f', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    const first = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(first, 'created')

    // 手工在账本里补一条带 requestId 的 team/created（模拟宿主按约定落账）
    ledger.commit({
      kind: 'team/created',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'R8f' as RequestId,
      data: {
        teamId: first.teamId,
        kind: 'persistent',
        ownerMemberId: memberA,
        parentTeamId: null,
        name: spec.name,
      },
    })

    const again = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(again, 'created')
    expect(again.teamId).toBe(first.teamId)
    // 一次都没再建团
    expect(spies.createTeam).toHaveLength(1)
  })

  it('恢复路径的**跨进程**那一半：换一个账本句柄（内存缓存全空）时靠账本查出已建成的团', async () => {
    // ⚠ 这条是变异测试逼出来的。上一条的「团已建成」是**本进程内存**先命中的，
    // 于是把「查账本 `team/created`」整条删掉，上一条**仍然全绿** —— 那段代码无人守护。
    //
    // 但那段代码守的是**跨进程**的场景：进程重启后 `WeakMap` 里的 `decided` 全没了，
    // 此时唯一能证明「这个团已经建过」的就是账本。这里用一个**文件库 + 两个句柄**复现它：
    // 句柄 B 的 `stateOf(...)` 是全新的空 Map，所以它只能靠账本。
    //
    // ⚠ **诱饵事件的顺序是有意的**：那条「别人的团」必须**先于**本申请的团落账。
    // 第一版把它写在后面，于是「只按 kind 匹配、不比 requestId」的变异体**仍然全绿**
    // （循环先遇到本申请那条就返回了）—— 诱饵要能真的被先撞上，才拦得住错误实现。
    const dir = mkdtempSync(join(tmpdir(), 'sophia-delegation-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'ledger.db')

    const handleA = openLedger({ path: dbPath })
    openLedgers.push(handleA)
    const a = makeDeps({ ledger: handleA })
    const awaiting = await requestSpawn(a.deps, requestOf('RX1', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    // ① 批准已落账（进程「重启」前的事实）
    handleA.commit({
      kind: 'spawn/human-approved',
      actor: { kind: 'human', humanId: 'human-emperor' },
      requestId: 'RX1' as RequestId,
      data: {
        requestId: 'RX1',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        humanOperatorId: 'human-emperor',
        targetKind: 'persistent',
        spec,
        decision: 'approve',
      },
    })
    // ② 宿主建团并落 `team/created`（带 requestId —— 这是 `findTeamCreatedFor` 的接线约定）
    handleA.commit({
      kind: 'team/created',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RX1' as RequestId,
      data: {
        teamId: 'team-persisted' as TeamId,
        kind: 'persistent',
        ownerMemberId: memberA,
        parentTeamId: null,
        name: spec.name,
      },
    })
    // ③ 诱饵：**属于别的申请**的 `team/created`，刻意放在**最新**（最后落账）。
    //    ⚠ 位置是关键：若实现只按 `kind` 匹配而不比 `requestId`，且取「最新的一条」，
    //    它就会回放出这个诱饵 —— 把**别人的团**当成本申请的团。
    //    （放在更早的位置时，取最新仍会命中正确的那个，诱饵形同虚设。）
    handleA.commit({
      kind: 'team/created',
      actor: { kind: 'member', memberId: memberB },
      requestId: 'RX-OTHER' as RequestId,
      data: {
        teamId: 'team-other' as TeamId,
        kind: 'temporary',
        ownerMemberId: memberB,
        parentTeamId: null,
        name: '别人的团',
      },
    })

    // 句柄 B：全新的内存状态，只能从账本读。
    const handleB = openLedger({ path: dbPath })
    openLedgers.push(handleB)
    const b = makeDeps({ ledger: handleB })
    const replayed = await decideSpawnTicket(b.deps, {
      ticketId: spawnTicketIdOf('RX1' as RequestId),
      decision: 'approve',
    })
    expectKind(replayed, 'created')
    expect(replayed.teamId).toBe('team-persisted' as TeamId)
    // 绝不能拿别人的团冒充本申请的团
    expect(replayed.teamId).not.toBe('team-other' as TeamId)
    // 关键：**没有**再建团（若 `findTeamCreatedFor` 被删掉，这里会是 1 次）
    expect(b.spies.createTeam).toHaveLength(0)
  })

  it('同一 requestId 有多条 team/created 时，取**最新**的一条（OCR 评审 [2]）', async () => {
    // ⚠ 这条同样由变异测试逼出来。上一条只有一个候选，于是「取第一条 vs 取最新的一条」
    // 两种实现**结果相同**，无法区分 —— 而取第一条会在「旧团已被销毁、重试建了新团」
    // 这种真实场景里把**陈旧的团**交回给调用方，并让新团静默丢失。
    const dir = mkdtempSync(join(tmpdir(), 'sophia-delegation-latest-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'ledger.db')
    const handleA = openLedger({ path: dbPath })
    openLedgers.push(handleA)

    const bump = (teamId: string): void => {
      handleA.commit({
        kind: 'team/created',
        actor: { kind: 'member', memberId: memberA },
        requestId: 'RL1' as RequestId,
        data: {
          teamId: teamId as TeamId,
          kind: 'persistent',
          ownerMemberId: memberA,
          parentTeamId: null,
          name: spec.name,
        },
      })
    }
    // 先落一条**陈旧**的团，再落一条**最新**的
    bump('team-stale')
    bump('team-fresh')

    // 补一条 awaiting + approved，让这条申请看起来是「已批准」
    handleA.commit({
      kind: 'spawn/awaiting-human-approval',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RL1' as RequestId,
      data: {
        requestId: 'RL1',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        targetKind: 'persistent',
        spec,
      },
    })
    handleA.commit({
      kind: 'spawn/human-approved',
      actor: { kind: 'human', humanId: 'human-emperor' },
      requestId: 'RL1' as RequestId,
      data: {
        requestId: 'RL1',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        humanOperatorId: 'human-emperor',
        targetKind: 'persistent',
        spec,
        decision: 'approve',
      },
    })

    const handleB = openLedger({ path: dbPath })
    openLedgers.push(handleB)
    const b = makeDeps({ ledger: handleB })
    const replayed = await decideSpawnTicket(b.deps, {
      ticketId: spawnTicketIdOf('RL1' as RequestId),
      decision: 'approve',
    })
    expectKind(replayed, 'created')
    // 必须是**最新**那条，而不是第一条
    expect(replayed.teamId).toBe('team-fresh' as TeamId)
    expect(replayed.teamId).not.toBe('team-stale' as TeamId)
    expect(b.spies.createTeam).toHaveLength(0)
  })

  it('人类否决 → rejectedByHuman，且不创建', async () => {
    const { deps, spies, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R8c', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const decided = await decideSpawnTicket(deps, {
      ticketId: awaiting.ticketId,
      decision: 'reject',
      reason: '本季度预算已满',
    })
    expectKind(decided, 'rejectedByHuman')
    expect(decided.reason).toContain('本季度预算已满')
    expect(spies.createTeam).toHaveLength(0)

    const rejectedEvent = allEvents(ledger).find((event) => event.kind === 'spawn/human-rejected')
    expect(rejectedEvent).toBeDefined()
    expect(dataOf(rejectedEvent)['decision']).toBe('reject')
  })

  it('第一级被否的申请，人类票号不可用（第二级从未开启）', async () => {
    const { deps, spies } = makeDeps({ verdict: { approved: false, reason: '不批' } })
    const rejected = await requestSpawn(deps, requestOf('R8d', 'persistent', 'persistent'))
    expectKind(rejected, 'rejectedByPrincipal')

    const decided = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('R8d' as RequestId),
      decision: 'approve',
    })
    expectKind(decided, 'ticketNotFound')
    expect(decided.reason).toContain('第一级')
    expect(spies.createTeam).toHaveLength(0)
  })
})

describe('AC-5-9 两级审批人不缺项', () => {
  it('批准事件里 principalMemberId 与人类操作者标识均非空', async () => {
    const { deps, ledger } = makeDeps({ humanOperatorId: 'human-emperor' })
    const awaiting = await requestSpawn(deps, requestOf('R9', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })

    const approved = allEvents(ledger).find((event) => event.kind === 'spawn/human-approved')
    const data = dataOf(approved)
    expect(data['principalMemberId']).toBe(principalId)
    expect((data['principalMemberId'] as string).length).toBeGreaterThan(0)
    expect((data['humanOperatorId'] as string).length).toBeGreaterThan(0)
    expect(data['humanOperatorId']).toBe('human-emperor')

    // 事件的 **actor** 也必须是这个人类（账本的权威记录在这里）
    expect(approved?.actor).toEqual({ kind: 'human', humanId: 'human-emperor' })
  })

  it('人类操作者标识为空串 → 硬拒绝（不静默写空）', async () => {
    const { deps } = makeDeps({ humanOperatorId: '' })
    const awaiting = await requestSpawn(deps, requestOf('R9b', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    await expect(
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' }),
    ).rejects.toThrow(/空标识/)
  })

  it('人类操作者标识为纯空白 → 同样硬拒绝', async () => {
    const { deps } = makeDeps({ humanOperatorId: '   ' })
    const awaiting = await requestSpawn(deps, requestOf('R9c', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    await expect(
      decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' }),
    ).rejects.toThrow(/空标识/)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-10 / AC-5-11 / AC-5-12 不得绕开（按 requestId 绑定）
// ——————————————————————————————————————————————————————————————

describe('AC-5-10 / AC-5-11 / AC-5-12 不得绕开：按 requestId 绑定，而非按成员封禁', () => {
  it('AC-5-10：第一级否决后，同一 requestId 换开临时团 → noDowngradeBypass，createTeam 0 次', async () => {
    const { deps, spies } = makeDeps({ verdict: { approved: false, reason: '编额已满' } })
    const first = await requestSpawn(deps, requestOf('R10', 'persistent', 'persistent'))
    expectKind(first, 'rejectedByPrincipal')

    const bypass = await requestSpawn(deps, requestOf('R10', 'temporary', 'persistent'))
    expectKind(bypass, 'noDowngradeBypass')
    expect(bypass.errorCode).toBe('ERR_NO_DOWNGRADE_BYPASS')
    expect(bypass.reason).toContain('R10')
    expect(spies.createTeam).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(0)
  })

  it('AC-5-11（对照组）：换新 requestId 开临时团 → 仍然 created（FR-5.3.5 未被破坏）', async () => {
    const { deps, spies } = makeDeps({ verdict: { approved: false, reason: '编额已满' } })
    await requestSpawn(deps, requestOf('R11-first', 'persistent', 'persistent'))

    const fresh = await requestSpawn(deps, requestOf('R11-second', 'temporary', 'persistent'))
    expectKind(fresh, 'created')
    expect(spies.createTeam).toHaveLength(1)
    expect(spies.inboxPush).toHaveLength(0)
  })

  it('AC-5-11 变体：否决后同一成员开持久团（新 requestId）→ 仍可进审批', async () => {
    const { deps } = makeDeps()
    const rejectedDeps = makeDeps({ verdict: { approved: false, reason: '这次不行' } })
    await requestSpawn(rejectedDeps.deps, requestOf('R11c', 'persistent', 'persistent'))

    const retry = await requestSpawn(deps, requestOf('R11d', 'persistent', 'persistent'))
    expectKind(retry, 'awaitingHumanApproval')
  })

  it('AC-5-12：人类否决后，同一 requestId 同样返回 noDowngradeBypass', async () => {
    const { deps, spies } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R12', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    const decided = await decideSpawnTicket(deps, {
      ticketId: awaiting.ticketId,
      decision: 'reject',
      reason: '不批',
    })
    expect(decided.kind).toBe('rejectedByHuman')

    const bypass = await requestSpawn(deps, requestOf('R12', 'temporary', 'persistent'))
    expectKind(bypass, 'noDowngradeBypass')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('AC-5-12 变体：人类否决后换新 requestId → 临时团仍可直建', async () => {
    const { deps, spies } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R12b', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'reject', reason: '不批' })

    const fresh = await requestSpawn(deps, requestOf('R12c', 'temporary', 'persistent'))
    expectKind(fresh, 'created')
    expect(spies.createTeam).toHaveLength(1)
  })

  it('AC-5-10 强形式：**原样重投**被否的申请（同 requestId 同 targetKind）→ 同样是 noDowngradeBypass', async () => {
    // 这条与上一条的差别只在 `targetKind`：上一条是「换类型」，这条是「一模一样再投一次」。
    // SPEC §5.4 的措辞是「后续以该 requestId 发起的**任何**派生 —— 无论 targetKind 是什么 ——
    // 一律返回 noDowngradeBypass」，所以原样重投也必须得到 noDowngradeBypass
    // （而**不是**把上一次的 `rejectedByPrincipal` 回放一遍）。
    //
    // ⚠ 这条用例是变异测试逼出来的：没有它时，把「否决标志」整条逻辑删掉，
    // 测试**仍然全绿** —— 因为当时的用例全是「换类型」，而换类型恰好被
    // 「targetKind 不一致」那条分支也覆盖了。两条分支的结果在那些用例里**碰巧相同**，
    // 于是 `rejected` 标志是死代码，而契约里「原样重投也算绕开」这一条无人守护。
    const { deps, spies } = makeDeps({ verdict: { approved: false, reason: '编额已满' } })
    const first = await requestSpawn(deps, requestOf('R10b', 'persistent', 'persistent'))
    expectKind(first, 'rejectedByPrincipal')

    const again = await requestSpawn(deps, requestOf('R10b', 'persistent', 'persistent'))
    expectKind(again, 'noDowngradeBypass')
    expect(again.errorCode).toBe('ERR_NO_DOWNGRADE_BYPASS')
    expect(spies.createTeam).toHaveLength(0)
    // 原样重投**不得**再触发一次预审（也没有第二次收件箱推送）
    expect(spies.principalOf).toHaveLength(1)
    expect(spies.inboxPush).toHaveLength(0)
  })

  it('AC-5-12 强形式：人类否决后**原样重投** → 同样是 noDowngradeBypass', async () => {
    const { deps, spies } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R12d', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'reject', reason: '不批' })

    const again = await requestSpawn(deps, requestOf('R12d', 'persistent', 'persistent'))
    expectKind(again, 'noDowngradeBypass')
    expect(spies.createTeam).toHaveLength(0)
    // 不得再推一次待办（那会让人以为又有一条新的申请）
    expect(spies.inboxPush).toHaveLength(1)
  })

  it('「按 requestId 而非按成员」的判据：同一成员在其他 requestId 上不受影响', async () => {
    // 团长只否掉 R13-blocked 这一条申请，对同一位成员的其他申请照常批准。
    // 若实现把「不得绕开」写成按 memberId 封禁，R13-other 会被一并拒掉 —— 那时这条变红。
    const { deps } = makeDeps({
      verdict: (request) =>
        request.requestId === 'R13-blocked'
          ? { approved: false, reason: '这条不批' }
          : { approved: true },
    })
    const blocked = await requestSpawn(deps, requestOf('R13-blocked', 'persistent', 'persistent'))
    expectKind(blocked, 'rejectedByPrincipal')

    const other = await requestSpawn(deps, requestOf('R13-other', 'persistent', 'persistent'))
    expectKind(other, 'awaitingHumanApproval')
  })

  it('「按 requestId 而非按成员」的第二判据：被否后同成员开临时团仍可直建', async () => {
    const { deps, spies } = makeDeps({ verdict: { approved: false, reason: '不批' } })
    await requestSpawn(deps, requestOf('R13b-blocked', 'persistent', 'persistent'))

    const tempTeam = await requestSpawn(deps, requestOf('R13b-free', 'temporary', 'persistent'))
    expectKind(tempTeam, 'created')
    expect(spies.createTeam).toHaveLength(1)
  })

  it('审批中的申请被同一 requestId 换类型重提 → 不得创建（FR-5.3.4「先开个临时团凑合」）', async () => {
    const { deps, spies } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('R14', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const downgrade = await requestSpawn(deps, requestOf('R14', 'temporary', 'persistent'))
    expectKind(downgrade, 'noDowngradeBypass')
    expect(spies.createTeam).toHaveLength(0)
  })
})

// ——————————————————————————————————————————————————————————————
// 凭证投影（票据）
// ——————————————————————————————————————————————————————————————

describe('票据是账本事实的投影（FR-10.2）', () => {
  it('待审批的票据可被 readSpawnTicket 重建，状态为 pending-human', async () => {
    const { deps, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('RT1', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const ticket = readSpawnTicket(ledger, 'RT1' as RequestId)
    expect(ticket).not.toBeNull()
    expect(ticket?.status).toBe('pending-human')
    expect(ticket?.ticketId).toBe(awaiting.ticketId)
    expect(ticket?.requestId).toBe('RT1')
    expect(ticket?.requesterMemberId).toBe(memberA)
    expect(ticket?.principalMemberId).toBe(principalId)
    expect(ticket?.targetKind).toBe('persistent')
    expect(ticket?.spec).toEqual(spec)
  })

  it('第一级否决的票据**可投影**为真票据（captain 裁定 Q-E：载荷补 targetKind + spec）', async () => {
    // Q-E 之前这里断言的是 `null` —— 当时 §6.1 的 `spawn/principal-rejected` 载荷没有 `spec`，
    // 而 `SpawnTicket.spec` 是必填，两者不可能同时成立。captain 核查后确认那是**契约漏写**
    // （第二级的两种载荷都带 targetKind+spec，只有第一级什么都不带），裁定扩载荷。
    const { deps, spies, ledger } = makeDeps({ verdict: { approved: false, reason: '不再扩编' } })
    const outcome = await requestSpawn(deps, requestOf('RT2', 'persistent', 'persistent'))
    expectKind(outcome, 'rejectedByPrincipal')
    expect(outcome.reason).toBe('不再扩编')

    // 账本载荷必须**对称于第二级**：targetKind 与 spec 都在
    const events = allEvents(ledger)
    expect(events.map((event) => event.kind)).toEqual(['spawn/principal-rejected'])
    const payload = dataOf(events[0])
    expect(payload['targetKind']).toBe('persistent')
    expect(payload['spec']).toEqual(spec)

    // 现在能投影出**真票据**（而不是 null、也不是空规格）
    const ticket = readSpawnTicket(ledger, 'RT2' as RequestId)
    expect(ticket).not.toBeNull()
    expect(ticket?.status).toBe('rejected-principal')
    expect(ticket?.reason).toBe('不再扩编')
    expect(ticket?.requestId).toBe('RT2')
    expect(ticket?.requesterMemberId).toBe(memberA)
    expect(ticket?.principalMemberId).toBe(principalId)
    expect(ticket?.targetKind).toBe('persistent')
    // 关键：**真规格**，不是 `{name:'',roster:[],tasks:[]}` 空壳
    expect(ticket?.spec).toEqual(spec)
    expect(ticket?.spec.name).toBe(spec.name)
    expect(ticket?.spec.roster).toHaveLength(spec.roster.length)
    expect(ticket?.spec.tasks).toEqual(spec.tasks)

    // 被第一级否决后**不得**触发后续流程（Q-E 明列的断言）：
    // 不建团、不推人类收件箱、不再走第二次预审
    expect(spies.createTeam).toHaveLength(0)
    expect(spies.inboxPush).toHaveLength(0)
    expect(spies.principalOf).toHaveLength(1)
  })

  it('Q-E 反恒真：把 `spec` 从第一级否决载荷里去掉，上一条的票据断言必须变红', async () => {
    // ⚠ 这条守的是「载荷真的带了 spec」这件事本身。
    // 它断言的是**能力**而非某一处的实现细节：只要 `spec` 缺失，`readSpawnTicket`
    // 就必须退回 `null`（仍不编造空规格），于是上一条用例的 `not.toBeNull()` 会红。
    //
    // 做法：不碰源码，而是**直接往账本里手工写一条缺 `spec` 的 principal-rejected 事件**
    // （等价于「宿主用旧版载荷落账」），验证投影层对它的态度是**如实拒绝**而不是硬凑。
    const { ledger } = makeDeps()
    ledger.commit({
      kind: 'spawn/principal-rejected',
      actor: { kind: 'member', memberId: principalId },
      requestId: 'RQ1' as RequestId,
      data: {
        requestId: 'RQ1',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        targetKind: 'persistent',
        // 刻意不写 spec —— 模拟旧的（Q-E 之前的）载荷
        reason: '旧版载荷，无 spec',
      },
    })

    // 如实返回 null，**绝不**补一个 `{name:'',roster:[],tasks:[]}` 空规格
    expect(readSpawnTicket(ledger, 'RQ1' as RequestId)).toBeNull()
  })

  it('同一次申请同时有 principal-rejected 与 awaiting 时，状态按优先级取 awaiting（pending-human）', async () => {
    // 这条用例本身是 Q-E 之前的产物（当时用来证明「上一条的 null 真因是载荷缺 spec」），
    // 现在保住它守的是**另一件事**：同一 requestId 上出现多条事件时，状态判定的**优先级**。
    // 按 SPEC §5.3 的流程，第一级否决后就不会再进第二级，故现实里一般不会同时出现两条；
    // 但账本是只追加的，历史事件可能因重投而叠加 —— 判定顺序必须是确定的。
    const { deps, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('RT2b', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    // 手工补一条同 requestId 的 principal-rejected（模拟「先被否、后来重投进第二级」的历史）
    ledger.commit({
      kind: 'spawn/principal-rejected',
      actor: { kind: 'member', memberId: principalId },
      requestId: 'RT2b' as RequestId,
      data: {
        requestId: 'RT2b',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        targetKind: 'persistent',
        spec,
        reason: '上一次不批',
      },
    })

    const ticket = readSpawnTicket(ledger, 'RT2b' as RequestId)
    expect(ticket).not.toBeNull()
    // awaiting 的优先级高于 principal-rejected：末态是「等待人类」
    expect(ticket?.status).toBe('pending-human')
    expect(ticket?.spec).toEqual(spec)
  })

  it('批准后票据状态为 approved，人类否决后为 rejected-human', async () => {
    const approving = makeDeps()
    const a1 = await requestSpawn(approving.deps, requestOf('RT3', 'persistent', 'persistent'))
    expectKind(a1, 'awaitingHumanApproval')
    await decideSpawnTicket(approving.deps, { ticketId: a1.ticketId, decision: 'approve' })
    expect(readSpawnTicket(approving.ledger, 'RT3' as RequestId)?.status).toBe('approved')

    const rejecting = makeDeps()
    const r1 = await requestSpawn(rejecting.deps, requestOf('RT4', 'persistent', 'persistent'))
    expectKind(r1, 'awaitingHumanApproval')
    await decideSpawnTicket(rejecting.deps, {
      ticketId: r1.ticketId,
      decision: 'reject',
      reason: '预算不足',
    })
    const ticket = readSpawnTicket(rejecting.ledger, 'RT4' as RequestId)
    expect(ticket?.status).toBe('rejected-human')
    expect(ticket?.reason).toBe('预算不足')
  })

  it('票据投影**跨页**仍正确（扫描必须翻页，不能只看第一页）', async () => {
    // ⚠ 这条是变异测试逼出来的：把 `scanAllPages` 的翻页逻辑改成「只看第一页」，
    // 全部用例**仍然全绿** —— 因为此前没有任何一个账本超过 1000 条事件（一页装得下）。
    // 而 `SCAN_PAGE_LIMIT = 1000` 是真实存在的分页边界，跨页读错会让审批链**静默丢失**。
    //
    // 这里灌入 >1000 条与本申请无关的事件，把真正的审批事件推到第二页。
    const { deps, ledger } = makeDeps()
    const noisyActor = { kind: 'member', memberId: memberB } as const

    // 先放 1000 条噪声（把第 1 页塞满）
    for (let i = 0; i < 1000; i += 1) {
      ledger.commit({
        kind: 'team/member-renamed',
        actor: noisyActor,
        data: { teamId: 'team-noise' as TeamId, memberId: memberB, from: `a${i}`, to: `b${i}` },
      })
    }
    expect(ledger.head().sequence).toBe(1000)

    // 再把审批链推入第 2 页
    const awaiting = await requestSpawn(deps, requestOf('RP1', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    // 若扫描只看第一页，这里读不到票据（返回 null）
    const ticket = readSpawnTicket(ledger, 'RP1' as RequestId)
    expect(ticket).not.toBeNull()
    expect(ticket?.status).toBe('pending-human')
    expect(ticket?.requestId).toBe('RP1')

    // 决议也必须能跨页找到它（否则会误判成「第二级尚未开启」）
    const decided = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(decided, 'created')
  })

  it('免审路径的**跨进程**幂等：换句柄后重投同一 requestId → 不重复建团（OCR 评审 [3]）', async () => {
    // 免审路径原先只靠内存 `state.decided` 做幂等，而它随进程消失；
    // 跨进程重投同一 requestId 会再建一个团 —— 与 `SpawnRequest.requestId` 的幂等契约不符。
    // 修法与 `decideSpawnTicket` 的恢复路径一致：先查账本里带该 requestId 的 `team/created`。
    const dir = mkdtempSync(join(tmpdir(), 'sophia-delegation-free-'))
    tempDirs.push(dir)
    const dbPath = join(dir, 'ledger.db')

    const handleA = openLedger({ path: dbPath })
    openLedgers.push(handleA)
    const a = makeDeps({ ledger: handleA })
    const first = await requestSpawn(a.deps, requestOf('RFX', 'temporary', 'persistent'))
    expectKind(first, 'created')
    expect(a.spies.createTeam).toHaveLength(1)

    // 宿主按约定落一条带 requestId 的 team/created
    handleA.commit({
      kind: 'team/created',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RFX' as RequestId,
      data: {
        teamId: first.teamId,
        kind: 'temporary',
        ownerMemberId: memberA,
        parentTeamId: null,
        name: spec.name,
      },
    })

    // 句柄 B：进程「重启」后内存全空
    const handleB = openLedger({ path: dbPath })
    openLedgers.push(handleB)
    const b = makeDeps({ ledger: handleB })
    const replay = await requestSpawn(b.deps, requestOf('RFX', 'temporary', 'persistent'))
    expectKind(replay, 'created')
    expect(replay.teamId).toBe(first.teamId)
    // 一次都没再建团
    expect(b.spies.createTeam).toHaveLength(0)
  })

  it('OCR 评审 [12]：畸形的 `team/created`（载荷无 teamId）**不得**被当成已建团（phantom success 防护）', async () => {
    // 缺陷现场（实测复现）：批准已落账、`createTeam` 抛错 ⇒ 账本留下「已批准但团不存在」。
    // 重试要走「续做建团」，它靠 `findTeamCreatedFor` 从账本判断团是否已建成。
    // 而 `isLedgerEvent` 只保证 `data` 是**非 null 对象**、不保证它与 `kind` 匹配 ——
    // 于是一条 `data: {}` 的 `team/created` 会让 `event.data.teamId` 取到 `undefined`，
    // 被当成一个「真实的 teamId」返回给调用方。实测后果：
    //   `decideSpawnTicket(approve)` 返回 `{kind:'created'}`（teamId === undefined），
    //   而 `createTeam` **从未被调用** —— 调用方拿到一个凭空成功、团根本不存在。
    // 修法：`findTeamCreatedFor` 对载荷做运行期收窄，非非空 string 一律不采信。
    // 反恒真：删掉那道收窄，本条必须变红（它会看到 kind==='created' 且 teamId 为 undefined）。
    let failCreation = true
    const { deps, spies, ledger } = makeDeps({
      createTeam: async () => {
        if (failCreation) {
          throw new Error('宿主建团失败（模拟）')
        }
        return 'TEAM-REAL' as TeamId
      },
    })

    const request = requestOf('RMALFORMED', 'persistent', 'persistent')
    const first = await requestSpawn(deps, request)
    expectKind(first, 'awaitingHumanApproval')

    // 第一次批准：批准事件落账，但建团失败。
    await expect(
      decideSpawnTicket(deps, { ticketId: spawnTicketIdOf(request.requestId), decision: 'approve' }),
    ).rejects.toThrow(/宿主建团失败/)
    expect(
      allEvents(ledger).filter((event) => event.kind === 'spawn/human-approved'),
    ).toHaveLength(1)

    // 外部写入一条**载荷畸形**的 `team/created`（同 requestId，但没有任何 teamId）。
    // 这条能通过 `isLedgerEvent`（data 是非 null 对象），正是缺陷的入口。
    ledger.commit({
      kind: 'team/created',
      actor: { kind: 'member', memberId: memberA },
      requestId: request.requestId,
      data: {},
    })

    // 重试：不得采信那条畸形行去「假装团已建成」。
    failCreation = false
    const retry = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf(request.requestId),
      decision: 'approve',
    })

    // 要么如实续做建团（拿到真实 teamId），要么明确失败 —— 但**绝不能**返回
    // `{kind:'created'}` 却带着 undefined/缺失的 teamId。
    if (retry.kind === 'created') {
      expect(retry.teamId).toBe('TEAM-REAL')
    }
    // 关键断言：建团真的发生了（而不是 phantom success）。
    expect(spies.createTeam.length).toBeGreaterThan(0)
  })

  it('OCR 评审 [11]：`removedMemberId` 为空标识时**硬拒绝**，不写出 `from: ""` 的坏事件', async () => {
    // `to` 早有守卫而 `from` 没有 —— 不对称（OCR 评审 [11]）。
    // 实测后果：`reattachOrphanedTeams(deps, '')` 真的写出了 `from: ""` 的
    // `team/ownership-reattached`，而这条错误**事后无法从账本察觉**（空串看起来就是个普通字符串）。
    const { deps, ledger } = makeDeps()

    await expect(
      reattachOrphanedTeams(
        {
          ...deps,
          teamsOwnedBy: async () => ['C1' as TeamId],
          nearestLivingAncestorOf: async () => ({ ancestor: memberA }),
          principalMemberIdOf: async () => principalId,
          currentOwnerOf: async () => null,
        },
        '' as MemberId,
      ),
    ).rejects.toThrow(/removedMemberId/)

    // 失败必须是原子的：一个事件都不该落。
    expect(allEvents(ledger).filter((event) => event.kind === 'team/ownership-reattached')).toHaveLength(0)
  })

  it('载荷畸形时拒绝作结论（OCR 评审 [4]）：awaiting 事件缺 spec → ticketNotFound，不建团', async () => {
    // `isLedgerEvent` 只验结构不验载荷，所以消费方必须自己收窄 —— 否则畸形载荷
    // 会直接流进 createTeam 与后续事件载荷，造出「形状与 kind 不符」的账本行。
    const { deps, spies, ledger } = makeDeps()
    ledger.commit({
      kind: 'spawn/awaiting-human-approval',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RM1' as RequestId,
      data: {
        requestId: 'RM1',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        targetKind: 'persistent',
        // 刻意缺 spec（模拟旧版/外部写入）
      },
    })

    const outcome = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('RM1' as RequestId),
      decision: 'approve',
    })
    expectKind(outcome, 'ticketNotFound')
    expect(outcome.reason).toContain('载荷不完整')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('载荷畸形第二种：targetKind 不在闭集内 → 同样拒绝，不建团', async () => {
    const { deps, spies, ledger } = makeDeps()
    ledger.commit({
      kind: 'spawn/awaiting-human-approval',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RM2' as RequestId,
      data: {
        requestId: 'RM2',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        targetKind: '不存在的类型',
        spec,
      },
    })
    const outcome = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('RM2' as RequestId),
      decision: 'approve',
    })
    expectKind(outcome, 'ticketNotFound')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('载荷畸形：**空字符串**的 requesterMemberId / principalMemberId 也要拒（分支级覆盖）', async () => {
    // ⚠ 这条是变异测试逼出来的：把「空字符串」那几个子条件删掉，其余用例**仍然全绿** ——
    // 因为那些用例缺的是整个字段（`undefined`），走的是 `typeof !== 'string'` 那一支。
    // 空串与「字段缺失」是**两个不同的分支**，必须各有用例，否则删掉一支无人察觉。
    for (const [label, malformed] of [
      ['requesterMemberId 为空串', 'requesterMemberId'],
      ['principalMemberId 为空串', 'principalMemberId'],
    ] as const) {
      const { deps, spies, ledger } = makeDeps()
      // ⚠ 写法本身也有陷阱：先写好正文字段再用 `...patched` 覆盖，`tsc` 会报
      // TS2783「specified more than once, this usage will be overwritten」——
      // 而那正是本次真实踩到的：**会覆盖**意味着那条用例原本测的是被覆盖后的值（正常值），
      // 即「看似有覆盖、其实没测到空串」。故这里逐字段显式构造，不用展开覆盖。
      const awaited = {
        requestId: 'RM3',
        targetKind: 'persistent' as const,
        spec,
        requesterMemberId: malformed === 'requesterMemberId' ? ('' as MemberId) : memberA,
        principalMemberId: malformed === 'principalMemberId' ? ('' as MemberId) : principalId,
      }
      ledger.commit({
        kind: 'spawn/awaiting-human-approval',
        actor: { kind: 'member', memberId: memberA },
        requestId: 'RM3' as RequestId,
        data: awaited,
      })
      // 确认被测字段**真的**是空串（不是被写成了正常值）—— 这条自证不能省。
      expect(awaited[malformed], label).toBe('')

      const outcome = await decideSpawnTicket(deps, {
        ticketId: spawnTicketIdOf('RM3' as RequestId),
        decision: 'approve',
      })
      expectKind(outcome, 'ticketNotFound')
      expect(spies.createTeam, label).toHaveLength(0)
    }
  })

  it('载荷畸形：requesterMemberId 不是字符串（数字）→ 同样拒绝', async () => {
    const { deps, spies, ledger } = makeDeps()
    ledger.commit({
      kind: 'spawn/awaiting-human-approval',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RM4' as RequestId,
      data: {
        requestId: 'RM4',
        requesterMemberId: 12345,
        principalMemberId: principalId,
        targetKind: 'persistent',
        spec,
      },
    })
    const outcome = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('RM4' as RequestId),
      decision: 'approve',
    })
    expectKind(outcome, 'ticketNotFound')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('载荷畸形：spec 为 null → 同样拒绝', async () => {
    const { deps, spies, ledger } = makeDeps()
    ledger.commit({
      kind: 'spawn/awaiting-human-approval',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RM5' as RequestId,
      data: {
        requestId: 'RM5',
        requesterMemberId: memberA,
        principalMemberId: principalId,
        targetKind: 'persistent',
        spec: null,
      },
    })
    const outcome = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('RM5' as RequestId),
      decision: 'approve',
    })
    expectKind(outcome, 'ticketNotFound')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('票据投影的自相矛盾防护（OCR 评审 [2]）：approved 与 human-rejected 同时存在时，序号与状态同源', () => {
    const { ledger } = makeDeps()
    const base = {
      requestId: 'RC3' as RequestId,
      requesterMemberId: memberA,
      principalMemberId: principalId,
      humanOperatorId: 'human-emperor',
      targetKind: 'persistent' as const,
      spec,
    }
    ledger.commit({
      kind: 'spawn/awaiting-human-approval',
      actor: { kind: 'member', memberId: memberA },
      requestId: 'RC3' as RequestId,
      data: { requestId: 'RC3', requesterMemberId: memberA, principalMemberId: principalId, targetKind: 'persistent', spec },
    })
    ledger.commit({
      kind: 'spawn/human-approved',
      actor: { kind: 'human', humanId: 'human-emperor' },
      requestId: 'RC3' as RequestId,
      data: { ...base, decision: 'approve' },
    })
    const rejected = ledger.commit({
      kind: 'spawn/human-rejected',
      actor: { kind: 'human', humanId: 'human-emperor' },
      requestId: 'RC3' as RequestId,
      data: { ...base, decision: 'reject', reason: '事后又否了' },
    })

    const ticket = readSpawnTicket(ledger, 'RC3' as RequestId)
    expect(ticket?.status).toBe('rejected-human')
    // 关键：状态是 rejected-human，那么 humanDecidedAtSequence 必须指向**那条否决事件**，
    // 而不是更早的批准事件 —— 否则两个字段在描述不同的决定。
    expect(ticket?.humanDecidedAtSequence).toBe(rejected.sequence)
    expect(ticket?.reason).toBe('事后又否了')
  })

  it('内存幂等键与账本键的一致性：`decideSpawnTicket` 不会用**不同** targetKind 覆盖已记的记录', async () => {
    // OCR 评审 [2] 提出：`state.decided` 按 requestId 单键存储，若同一 requestId 下
    // 出现两种 targetKind，后来的写入会**覆盖**先前的，导致先前那次申请的重投被误判。
    //
    // 我没有直接照改，而是先验证它**是否可达**（照改一个不可达的缺陷会引入无谓复杂度）：
    // 请求侧 `requestSpawn` 的第 4 步（换类型 → noDowngradeBypass）与账本侧
    // `decideSpawnTicket`（按键从账本读）本就钉死了「一个 requestId 一种 targetKind」。
    // 本用例把这个不变量钉成可执行断言：走完一次真实的审批链后，
    // 内存键里的 targetKind 与账本 awaiting 载荷里的**必须相同**。
    const { deps, ledger } = makeDeps()
    const awaiting = await requestSpawn(deps, requestOf('RK1', 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')

    const ledgerKind = allEvents(ledger).find(
      (event) => event.kind === 'spawn/awaiting-human-approval',
    )?.data.targetKind
    expect(ledgerKind).toBe('persistent')

    const decided = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(decided, 'created')

    // 建团后重投同一 requestId 同一类型 → 幂等回放（若内存键被错写了别的类型，
    // 这里会走到「换类型」分支而返回 noDowngradeBypass，本断言就会红）
    const again = await requestSpawn(deps, requestOf('RK1', 'persistent', 'persistent'))
    expectKind(again, 'created')
    expect(again.teamId).toBe(decided.teamId)

    // 而换类型仍必须被拦（键一致不等于放宽 §5.4）
    const crossType = await requestSpawn(deps, requestOf('RK1', 'temporary', 'persistent'))
    expectKind(crossType, 'noDowngradeBypass')
  })

  it('不存在的 requestId → null（不是半成品票据）', () => {
    const { ledger } = makeDeps()
    expect(readSpawnTicket(ledger, 'never-submitted' as RequestId)).toBeNull()
  })

  it('伪造的票号（账本里没有对应申请）→ decideSpawnTicket 返回 ticketNotFound', async () => {
    const { deps, spies } = makeDeps()
    const outcome = await decideSpawnTicket(deps, {
      ticketId: 'ticket:forged-request' as never,
      decision: 'approve',
    })
    expect(outcome.kind).toBe('ticketNotFound')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('伪造票号的关键变体：**格式完全合法**但账本里没有这条申请 —— 仍必须被拒', async () => {
    // 上一条用的是「一眼假」的票号；这一条用的是**格式完全正确**的票号形态
    // （`ticket:` + 一个像样的 requestId），只是账本里没有它。
    // 若实现只做字符串切分、不回账本核对，它就会「成功地」对一个从不存在的申请作出批准。
    const { deps, spies } = makeDeps()
    // 先造一个真实申请，好让账本非空（证明拒绝不是因为「账本是空的」）
    await requestSpawn(deps, requestOf('REAL', 'persistent', 'persistent'))

    const outcome = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('also-plausible-but-never-submitted' as RequestId),
      decision: 'approve',
    })
    expectKind(outcome, 'ticketNotFound')
    // 拒因必须点名是哪张票、为什么 —— 而不是一句笼统的「失败」
    expect(outcome.reason).toContain('also-plausible-but-never-submitted')
    expect(outcome.reason).toContain('第二级')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('伪造票号的第二种变体：借**别的**申请的 requestId 拼票号 → 仍不可批（票号必须对应真实申请）', async () => {
    // 这条防的是「`ticket:` 前缀切出来的 requestId 恰好撞上一条真实申请」的误判路径：
    // 撞上了就该被受理（这是正确行为），但**没撞上**的必须一律拒绝。
    // 此处特意用一个与真实申请**只差一个字符**的 requestId。
    const { deps, spies } = makeDeps()
    await requestSpawn(deps, requestOf('RXX1', 'persistent', 'persistent'))

    const outcome = await decideSpawnTicket(deps, {
      ticketId: spawnTicketIdOf('RXX2' as RequestId),
      decision: 'approve',
    })
    expect(outcome.kind).toBe('ticketNotFound')
    expect(spies.createTeam).toHaveLength(0)
  })

  it('无前缀的票号 → ticketNotFound（不做「猜一个 requestId」的兜底）', async () => {
    const { deps } = makeDeps()
    const outcome = await decideSpawnTicket(deps, {
      ticketId: 'RT1' as never,
      decision: 'approve',
    })
    expect(outcome.kind).toBe('ticketNotFound')
  })

  it('无前缀但**偏移后恰好撞上真实 requestId** 的字符串 → 仍必须被拒（前缀校验不是装饰）', async () => {
    // ⚠ 这条是变异测试逼出来的。前一条用例只写了 `'RT1'`（8 字符以下），
    // 于是「把前缀校验整条删掉」的变异体**仍然全绿** —— 因为 `'RT1'.slice(8)` 是空串，
    // 空串在账本里查不到，最终还是 ticketNotFound。**结论相同，理由完全不同。**
    //
    // 这里构造一个「8 个填充字符 + 真实 requestId」的字符串：一旦前缀校验被删掉，
    // 它会切出一个**真实存在**的 requestId，从而成功批准一条没人合法提交过的申请。
    // 前缀校验的价值就在这条上体现 —— 它挡住的不是「明显非法的输入」，而是「恰好能切出真值」的输入。
    const { deps, spies } = makeDeps()
    const realRequestId = 'REQALPHA' // 恰好 8 字符
    const awaiting = await requestSpawn(deps, requestOf(realRequestId, 'persistent', 'persistent'))
    expectKind(awaiting, 'awaitingHumanApproval')
    expect(spies.createTeam).toHaveLength(0)

    // 构造一个「`ticket:`.length 个填充字符 + 真实 requestId」的字符串：
    // 一旦前缀校验被删掉，`.slice('ticket:'.length)` 就会切出一个**真实存在**的 requestId，
    // 从而成功批准一条没人合法提交过的申请。
    // 填充长度用 `spawnTicketIdOf('').length` 现算，不手数 —— 手数过一次，数错了 1 位，
    // 结果切出的是错位字符串，用例看似通过实则测了个寂寞。
    const pad = 'P'.repeat(spawnTicketIdOf('' as RequestId).length)
    const smuggled = `${pad}${realRequestId}`
    const outcome = await decideSpawnTicket(deps, { ticketId: smuggled as never, decision: 'approve' })
    expectKind(outcome, 'ticketNotFound')
    expect(outcome.reason).toContain('ticket:')
    expect(spies.createTeam).toHaveLength(0)

    // 对照：用**合法票号**批同一条申请是能成功的 —— 证明上一步的失败真因是票号非法，
    // 而不是「这条申请本来就不能批」。
    const legit = await decideSpawnTicket(deps, { ticketId: awaiting.ticketId, decision: 'approve' })
    expectKind(legit, 'created')
    expect(spies.createTeam).toHaveLength(1)
  })
})

// ——————————————————————————————————————————————————————————————
// AC-5-13 / AC-5-14 / AC-5-15 孤儿转挂
// ——————————————————————————————————————————————————————————————

const orphanTeam = 'team-orphan' as TeamId
const grandparent = 'sophia-qintianjian-jianzheng-99999999' as MemberId

function makeOrphanDeps(options: {
  readonly ancestor: { readonly ancestor: MemberId; readonly changed?: boolean } | null
  readonly principal: MemberId
  readonly owned?: readonly TeamId[]
}): OrphanReattachmentDeps & { readonly ledger: Ledger } {
  const ledger = openLedger({ path: ':memory:' })
  let tick = 0
  return {
    ledger,
    inbox: {
      async push(): Promise<void> {},
      async list(): Promise<readonly HumanInboxItem[]> {
        return []
      },
    },
    async principalOf(): Promise<PrincipalReviewer> {
      return { memberId: options.principal, async reviewSpawn(): Promise<PrincipalVerdict> {
        return { approved: true }
      } }
    },
    async createTeam(): Promise<TeamId> {
      return 'team-never' as TeamId
    },
    now(): number {
      tick += 1
      return 1_700_000_000_000 + tick
    },
    currentHumanOperatorId(): string {
      return 'human-emperor'
    },
    async teamsOwnedBy(): Promise<readonly TeamId[]> {
      return options.owned ?? [orphanTeam]
    },
    async nearestLivingAncestorOf(): Promise<{ readonly ancestor: MemberId; readonly changed?: boolean } | null> {
      return options.ancestor
    },
    async principalMemberIdOf(): Promise<MemberId> {
      return options.principal
    },
  }
}

describe('AC-5-13 / AC-5-14 / AC-5-15 父成员消失后的子团转挂', () => {
  it('AC-5-13：有存活祖先 → 转挂到该祖先，且不产生 destroy/suspend 事件', async () => {
    const deps = makeOrphanDeps({ ancestor: { ancestor: grandparent }, principal: principalId })
    const reattached = await reattachOrphanedTeams(deps, memberB)

    expect(reattached).toEqual([orphanTeam])
    const events = allEvents(deps.ledger)
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('team/ownership-reattached')
    expect(dataOf(events[0])['to']).toBe(grandparent)

    const destructive = events.filter(
      (event) => event.kind === 'team/member-destroyed' || event.kind === 'team/member-suspended',
    )
    expect(destructive).toHaveLength(0)
  })

  it('AC-5-14：无存活祖先 → 转挂到该团团长（不是「保持不变」）', async () => {
    const deps = makeOrphanDeps({ ancestor: null, principal: principalId })
    const reattached = await reattachOrphanedTeams(deps, memberB)

    expect(reattached).toEqual([orphanTeam])
    const event = allEvents(deps.ledger)[0]
    expect(event?.kind).toBe('team/ownership-reattached')
    const data = dataOf(event)
    expect(data['to']).toBe(principalId)
    expect(data['from']).toBe(memberB)
  })

  it('AC-5-15：每次转挂恰好一条 team/ownership-reattached，载荷含 from 与 to', async () => {
    const deps = makeOrphanDeps({
      ancestor: { ancestor: grandparent },
      principal: principalId,
      owned: ['team-1' as TeamId, 'team-2' as TeamId],
    })
    const reattached = await reattachOrphanedTeams(deps, memberB)

    expect(reattached).toHaveLength(2)
    const events = allEvents(deps.ledger).filter(
      (event) => event.kind === 'team/ownership-reattached',
    )
    expect(events).toHaveLength(2)
    for (const event of events) {
      const data = dataOf(event)
      expect(data['from']).toBe(memberB)
      expect(data['to']).toBe(grandparent)
      expect(typeof data['reason']).toBe('string')
    }
  })

  it('无子团时：不写事件、返回空数组', async () => {
    const deps = makeOrphanDeps({ ancestor: { ancestor: grandparent }, principal: principalId, owned: [] })
    const reattached = await reattachOrphanedTeams(deps, memberB)
    expect(reattached).toEqual([])
    expect(allEvents(deps.ledger)).toHaveLength(0)
  })

  it('缺少 FR-5.6 所需依赖时抛错（不静默返回空）', async () => {
    const deps = makeOrphanDeps({ ancestor: null, principal: principalId })
    const incomplete = { ...deps, teamsOwnedBy: undefined } as unknown as OrphanReattachmentDeps
    await expect(reattachOrphanedTeams(incomplete, memberB)).rejects.toThrow(/缺少必需依赖/)
  })

  it('转挂目标归属者为空标识时**硬拒绝**（OCR 评审 [1]：不写出一条 to="" 的坏事件）', async () => {
    // 一个空串在账本里看起来就是个普通字符串 —— 这条静默数据损坏事后无法察觉，
    // 所以必须在落账**之前**拦下。
    const deps = makeOrphanDeps({ ancestor: { ancestor: '' as MemberId }, principal: principalId })
    await expect(reattachOrphanedTeams(deps, memberB)).rejects.toThrow(/归属者标识非法/)
    // 关键：**没有**落任何事件（拒绝发生在 commit 之前）
    expect(allEvents(deps.ledger)).toHaveLength(0)
  })

  it('转挂目标归属者为纯空白时同样硬拒绝', async () => {
    const deps = makeOrphanDeps({ ancestor: null, principal: '   ' as MemberId })
    await expect(reattachOrphanedTeams(deps, memberB)).rejects.toThrow(/归属者标识非法/)
    expect(allEvents(deps.ledger)).toHaveLength(0)
  })
})

// ——————————————————————————————————————————————————————————————
// 编译期守卫（AC-5-3 / AC-5-4）
// ——————————————————————————————————————————————————————————————

/**
 * AC-5-3 的**编译期**守卫：`SpawnRequest` 上不得出现任何深度阈值字段。
 *
 * 写法说明（这段是本文件最容易写错的地方）：`'depth' extends keyof SpawnRequest ? never : true`
 * —— 若 `depth` **被加进**类型，这个条件类型求出 `never`，`true` 就不可赋值，`tsc` 报错。
 * 反过来（`? true : never`）会得到恒真的 `true`，**永不变红**，那不是守卫。
 */
const _NO_DEPTH_FIELD: 'depth' extends keyof SpawnRequest ? never : true = true
const _NO_MAX_DEPTH_FIELD: 'maxDepth' extends keyof SpawnRequest ? never : true = true
void _NO_DEPTH_FIELD
void _NO_MAX_DEPTH_FIELD

/**
 * AC-5-4 的**编译期**守卫：穷尽 `switch`，无 `default`。
 * 若 `SpawnOutcome` 新增一个 `kind` 而这里不处理，函数会缺少返回值 ⇒ `tsc` 报错。
 */
function narrateOutcome(outcome: SpawnOutcome): string {
  switch (outcome.kind) {
    case 'created':
      return 'created'
    case 'awaitingHumanApproval':
      return 'awaitingHumanApproval'
    case 'rejectedByPrincipal':
      return 'rejectedByPrincipal'
    case 'forbidden':
      return 'forbidden'
    case 'noDowngradeBypass':
      return 'noDowngradeBypass'
  }
}

/** 五类结果的样本（供 AC-5-4 的运行期断言使用）。 */
function sampleOutcomes(): readonly SpawnOutcome[] {
  return [
    { kind: 'created', teamId: 'team-x' as TeamId },
    { kind: 'awaitingHumanApproval', ticketId: 'ticket:x' as never },
    { kind: 'rejectedByPrincipal', ticketId: 'ticket:y' as never, reason: 'x' },
    { kind: 'forbidden', errorCode: 'ERR_SPAWN_FORBIDDEN', reason: 'x' },
    {
      kind: 'noDowngradeBypass',
      ticketId: 'ticket:z' as never,
      errorCode: 'ERR_NO_DOWNGRADE_BYPASS',
      reason: 'x',
    },
  ]
}
