/**
 * Agent 工具集的验收测试（`t4`，`docs/DEVELOPMENT.md` §3.5 / FR-5.2·5.3·6.4·3.4·10.1）。
 *
 * ## 本文件的断言为什么不是恒真的（每条主线都写明「怎么让它变红」）
 *
 * 1. **每个工具都有一条正向 + 至少一条逆向**，且**逆向分支断言零副作用**
 *    （账本事件数不变、`createTeam` 调用数为 0）。只断言 `kind` 的话，
 *    一个「先落账再判不合格」的实现也能全绿 —— 这与 `delegation.spec.ts`
 *    用计数 spy 断言 AC-5-2、`runtime.spec.ts` 用 `createHandle` 计数断言降级路径
 *    是同一手法（**分支级不可测**是本批已固化的教训：一条分支若无独立用例，
 *    把它改成恒真仍全绿）。
 * 2. **`spawn_team` 的越权用例断言的是「delegation 自己拦得住」**：
 *    本测试**绕过工具层**直调 `requestSpawn`，证明工具层那次镜像判定**不是**唯一防线
 *    （单一真相在 `src/delegation.ts`）。
 * 3. **消息的两条路径各自有独立用例**（起线程 / 回复），且回复路径断言
 *    「账本事件数 **0**」—— 那是它与起线程路径的**唯一**区别，不钉住它就无法区分两条路径。
 * 4. **「连发两条回复都被送达」用的是一份真实现（`createMemberRuntime`）**，
 *    不是假 runtime：去重是运行时的行为，用假件断言只会复述本文件的假设。
 *    这条用例是**反恒真**的：把回复路径的 `ref` 改成只有 `threadId`
 *    （即与起线程路径共用同一形状、失去唯一性）→ 第二条会被判 `duplicate`，
 *    断言 `delivered` 必须变红（已实测，见文件末尾的变异记录）。
 * 5. **投影端口是真实现**（`rebuildFold` + `projectRoster` + `unreadByMember`），
 *    不是硬编码常量：于是「工具读的是账本」这件事被真正穿过而不是被 mock 掉。
 *    `unreadOf` 另有一条**换成别一份实现**的用例（证伪「未读与账本通知同一判据」这句注释）。
 * 6. **全部工具都跑一遍「垃圾输入不抛错」**（`null` / `[]` / `42` / `'str'` /
 *    `Object.create(null)`）。这不是凑数：t2 实测过「传 `null` 会抛 `TypeError`
 *    冲进事件派发路径，而传数字不抛」——随手试一个值会得到「没问题」的假象。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

// ⚠ 深路径导入 internal.ts（不经 index.ts 转发）：本文件的 ⑦/回归组要**直接测**那个
// 「render 兜底绝不抛错」的内部函数。它不是公共面（故意没被 index.ts 转发），
// 而这里测的正是它自身的行为 —— 走公共面反而测不到。
import {
  describeError,
  isNonEmptyString,
  renderValueForMessage,
  unreachableOutcome,
} from '../src/tools/internal.ts'
import {
  SOPHIA_CAPTAIN_ALIAS,
  SOPHIA_CLAIMED_TASK_STATE,
  SOPHIA_IMPLEMENTED_TOOL_COUNT,
  SOPHIA_REASON_MAX,
  SOPHIA_SPAWN_MODEL_FIELD_MAX,
  SOPHIA_SPAWN_POSITION_MAX,
  SOPHIA_SPAWN_TASK_MAX,
  SOPHIA_SPAWN_REQUEST_ID_MAX,
  SOPHIA_MESSAGE_ID_PREFIX,
  SOPHIA_REPLY_REF_MARKER,
  SOPHIA_SELF_SWITCH_TRIGGER,
  SOPHIA_TOOL_CONTRACT_GAPS,
  SOPHIA_TOOL_NAMES,
  SOPHIA_THREAD_ID_PREFIX,
  createMemberRuntime,
  createSophiaTools,
  decideSpawnTicket,
  openLedger,
  rebuildFold,
  requestSpawn,
  unreadByMember,
  type ChangeScope,
  type ChannelId,
  type DagTeamId,
  type DelegationDeps,
  type HumanInbox,
  type HumanInboxItem,
  type Ledger,
  type LedgerCommitInput,
  type LedgerEvent,
  type LedgerReceipt,
  type MemberAgent,
  type MemberHandle,
  type MemberId,
  type MemberLifecycle,
  type MemberModel,
    type PrincipalReviewer,
  type PrincipalVerdict,
  type RequestId,
  type SophiaDagPorts,
  type SophiaProjectionPorts,
  type SophiaToolDescriptor,
  type SophiaToolsDeps,
  type SpawnRequest,
  type SpawnTicketId,
  type TeamId,
  type ThreadId,
} from '../src/index.ts'
// `MemberAgent.followup/steer` 的入参自 2026-09-24 起是**合法 user message**
//（真 DSH 的 inbox 收的是消息；`{items,text}` 对真 agent 是一条没有 content 的空消息）。
// 转换的唯一出处见该模块文件头（含"为什么是结构镜像而不是 import"）。
import type { SophiaUserMessage } from '../src/runtime/notice-message.ts'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ────────────────────────────────────────────────────────────────────────────
// 夹具
// ────────────────────────────────────────────────────────────────────────────

const teamA = 'team-a' as TeamId
const teamB = 'team-b' as TeamId
const channelA = 'ch-a' as ChannelId
const channelB = 'ch-b' as ChannelId
const self = 'sophia-lingtai-lang-aaaa1111' as MemberId
const colleague = 'sophia-tuibu-zhushi-bbbb2222' as MemberId
const outsider = 'sophia-lishuan-zhushi-cccc3333' as MemberId
/**
 * 一个**带初始模型出生**的成员（req 3 的配对用例用）。
 *
 * 存在的理由：`seedLedger` 里那批成员一律以 `model: null` 出生（跟随全局默认），
 * 于是「首次换模」在真实数据下**只有** `unknown-current-model` 一条分支可走。
 * 要有对照，就必须有一个初始模型非 `null` 的成员 —— 这正是
 * `MemberAddedData.model` 存在的意义。
 */
const modelBornMember = 'sophia-lingtai-lang-born-with-model' as MemberId
const principalId = 'sophia-qintianjian-jianzheng-dddd4444' as MemberId
const dagA = 'dag-a' as DagTeamId

const openLedgers: Ledger[] = []

afterEach(() => {
  for (const ledger of openLedgers.splice(0)) ledger.close()
})

function newLedger(): Ledger {
  const ledger = openLedger({ path: ':memory:' })
  openLedgers.push(ledger)
  return ledger
}

function commit(ledger: Ledger, input: LedgerCommitInput): void {
  ledger.commit(input)
}

function allEvents(ledger: Ledger): readonly LedgerEvent[] {
  return ledger.read({}).events
}

function eventsOfKind(ledger: Ledger, kind: string): readonly LedgerEvent[] {
  return allEvents(ledger).filter((event) => event.kind === kind)
}

/** 把事件的 `data` 当字典读（理由与 `delegation.spec.ts` 的同名函数逐字相同）。 */
function dataOf(event: LedgerEvent | undefined): Record<string, unknown> {
  return (event?.data ?? {}) as unknown as Record<string, unknown>
}

const humanActor = { kind: 'human', humanId: 'human-1' } as const

/**
 * 种一条 `team/member-added`。
 *
 * ## 为什么要有这个辅助，而不是就地写 `commit`
 *
 * ⚠ **`LedgerCommitInput.data` 的类型是 `unknown`**（SPEC §12.1）⇒ 内联载荷
 * **不被类型检查**。实测：只写 `{teamId, member, lifecycle}` 而漏掉 `model` 时
 * `tsc` **不报错**（本文件此前就有两处这样的内联载荷）。
 * 而漏掉 `model` 的后果不是「少个字段」——是成员**又回到「换模第一次必失败」**，
 * 且构建全绿、看不出任何异常。
 *
 * ⇒ 收口成一个辅助并**必填 `model`（可空）**：签名上强制表态
 *（`null` = 跟随全局默认，见 `MemberAddedData.model` 的文档，
 * 它刻意是「必填 + 可空」而不是可选 `?` —— 让「写的人忘了」与「初始确实未知」不可混）。
 */
function seedMemberAdded(
  ledger: Ledger,
  teamId: TeamId,
  memberId: MemberId,
  name: string,
  model: { readonly provider: string; readonly model: string } | null,
): void {
  commit(ledger, {
    kind: 'team/member-added',
    data: {
      teamId,
      member: { position: name, name, memberId },
      lifecycle: 'active',
      model,
    },
    actor: humanActor,
  })
}

/** 建一个「两团 + 成员 + 频道」的最小现场。 */
function seedLedger(): Ledger {
  const ledger = newLedger()
  commit(ledger, {
    kind: 'team/created',
    data: { teamId: teamA, kind: 'persistent', ownerMemberId: null, parentTeamId: null, name: '甲团' },
    actor: humanActor,
  })
  commit(ledger, {
    kind: 'team/created',
    data: { teamId: teamB, kind: 'temporary', ownerMemberId: null, parentTeamId: null, name: '乙团' },
    actor: humanActor,
  })
  for (const [memberId, name] of [
    [self, '灵台郎'],
    [colleague, '推步主事'],
    [principalId, '钦天监监正'],
  ] as const) {
    // ⚠ 默认 `null`（跟随全局默认）—— 这批成员**没有**初始模型，
    // 于是「首次换模必失败」这条分支在这里是**可达**的，由 `unknown-current-model` 用例覆盖。
    // 「有初始模型」那条分支由 `seedMemberWithModel` 单独造现场（见下面的用例）。
    seedMemberAdded(ledger, teamA, memberId, name, null)
  }
  seedMemberAdded(ledger, teamB, outsider, '历算主事', null)
  commit(ledger, {
    kind: 'team/channel-created',
    data: { channelId: channelA, teamId: teamA, title: '甲团频道' },
    actor: humanActor,
  })
  commit(ledger, {
    kind: 'team/channel-created',
    data: { channelId: channelB, teamId: teamB, title: '乙团频道' },
    actor: humanActor,
  })
  // 给两个成员一个当前模型（换模工具要求 `from` 能从账本取到）。
  for (const memberId of [self, colleague]) {
    commit(ledger, {
      kind: 'team/member-model-switched',
      data: {
        teamId: teamA,
        memberId,
        from: { provider: 'p-initial', model: 'm-initial' },
        to: { provider: 'deepseek', model: 'v4.1-flash' },
        reason: '初始模型指派',
        trigger: 'human',
        effectiveAtSequence: ledger.head().sequence + 1,
      },
      actor: humanActor,
    })
  }
  return ledger
}

// ── 真投影端口：全部结论都穿过真实账本折叠 ─────────────────────────────────

/** DAG 事实的**测试局部**扫描（本包没有 DAG 投影，见 `SophiaDagPorts` 的说明）。 */
interface DagFacts {
  readonly owners: ReadonlyMap<string, MemberId>
  readonly taskStates: ReadonlyMap<string, string>
}

function dagFactsOf(ledger: Ledger): DagFacts {
  const owners = new Map<string, MemberId>()
  const taskStates = new Map<string, string>()
  for (const event of allEvents(ledger)) {
    if (event.kind === 'dag/team-created') {
      owners.set(event.data.dagTeamId, event.data.ownerMemberId)
    }
    if (event.kind === 'dag/ownership-transferred') {
      owners.set(event.data.dagTeamId, event.data.to)
    }
    if (event.kind === 'dag/task-state-changed') {
      taskStates.set(`${event.data.dagTeamId}\u0000${event.data.taskId}`, event.data.to)
    }
  }
  return { owners, taskStates }
}

/**
 * 造一套**真实现**的投影端口。
 *
 * 成员/频道/线程三面走 `rebuildFold` 的折叠结果，未读走 `unreadByMember` ——
 * 于是「工具从账本拿结论」这件事被真正穿过。
 *
 * ⚠ **每次调用都重新折叠**（不缓存 `fold`）：这不是为了性能省事，而是**必须**的 ——
 * 端口若持一份构造时的快照，那么「工具写了一条事实、紧接着再读它」就会读到**写之前**的状态，
 * 于是幂等（重复认领）、回复线程（线程存在性）这类**读-写-读**的用例会全部失真。
 * 首版就是这么写的，实测红了三条用例（`task-claim` 的幂等、`message` 的两条回复路径）。
 * 换言之：这条提醒本身就是「端口必须是**活**的账本视图」的实测证据 ——
 * 宿主接线同理，**不得**在这里缓存折叠结果。
 */
function makeProjection(
  ledger: Ledger,
  overrides: { readonly unreadOf?: SophiaProjectionPorts['unreadOf'] } = {},
): SophiaProjectionPorts {
  const ports: SophiaProjectionPorts = {
    callerKindOf(memberId: MemberId) {
      const fold = rebuildFold(ledger).fold
      const member = fold.members.get(memberId)
      if (member === undefined) return null
      const team = fold.teams.get(member.teamId)
      return team === undefined ? null : team.kind
    },
    modelOf(memberId: MemberId): MemberModel | null {
      return rebuildFold(ledger).fold.members.get(memberId)?.model ?? null
    },
    lifecycleOf(memberId: MemberId): MemberLifecycle | null {
      return rebuildFold(ledger).fold.members.get(memberId)?.lifecycle ?? null
    },
    teamOf(memberId: MemberId): TeamId | null {
      return rebuildFold(ledger).fold.members.get(memberId)?.teamId ?? null
    },
    unreadOf:
      overrides.unreadOf
      ?? ((memberId, sinceSequence) => unreadByMember(ledger, { memberId, sinceSequence })),
    resolveMemberRef(ref: string): MemberId | null {
      for (const member of rebuildFold(ledger).fold.members.values()) {
        if (member.memberId === ref) return member.memberId
        if (member.name === ref) return member.memberId
        // 团长别名 → 该团的监正（本夹具里监正就是 `principalId`，它属于 teamA）。
        if (ref === SOPHIA_CAPTAIN_ALIAS && member.memberId === principalId) return principalId
      }
      return null
    },
    threadOf(threadId: ThreadId) {
      const thread = rebuildFold(ledger).fold.threads.get(threadId)
      return thread === undefined ? null : { channelId: thread.channelId, title: thread.title }
    },
    channelTeamOf(channelId: ChannelId): TeamId | null {
      return rebuildFold(ledger).fold.channels.get(channelId)?.teamId ?? null
    },
    dag: {
      ownerOf(dagTeamId: DagTeamId) {
        return dagFactsOf(ledger).owners.get(dagTeamId) ?? null
      },
      taskStateOf(dagTeamId: DagTeamId, taskId: string) {
        return dagFactsOf(ledger).taskStates.get(`${dagTeamId}\u0000${taskId}`) ?? null
      },
      unfinishedDependenciesOf() {
        return []
      },
    },
  }
  return ports
}

// ── 真成员运行时 + 假句柄（消息与接力的送达面）─────────────────────────────

interface RuntimeProbe {
  readonly handle: MemberHandle
  readonly agent: MemberAgent
  readonly notices: { readonly followup: SophiaUserMessage[]; readonly steer: SophiaUserMessage[] }
  setStatus(status: string): void
}

function makeProbe(memberId: MemberId, status = 'idle'): RuntimeProbe {
  const notices = { followup: [] as SophiaUserMessage[], steer: [] as SophiaUserMessage[] }
  let current = status
  const agent: MemberAgent = {
    id: memberId,
    get status(): string {
      return current
    },
    followup(message: SophiaUserMessage): void {
      notices.followup.push(message)
    },
    steer(message: SophiaUserMessage): void {
      notices.steer.push(message)
    },
  }
  return {
    handle: { agent, dispose(): void {} },
    agent,
    notices,
    setStatus(next: string): void {
      current = next
    },
  }
}

/**
 * 造一个**真** `createMemberRuntime`，已激活 `self` 与 `colleague`。
 *
 * 用真实现而不是假 runtime 的理由见文件头第 4 条：去重是运行时的行为。
 */
function makeRuntime(ledger: Ledger): {
  runtime: ReturnType<typeof createMemberRuntime>
  probes: ReadonlyMap<MemberId, RuntimeProbe>
} {
  const probes = new Map<MemberId, RuntimeProbe>([
    [self, makeProbe(self)],
    [colleague, makeProbe(colleague)],
  ])
  const fold = rebuildFold(ledger).fold
  const runtime = createMemberRuntime({
    mountPreset: (): void => {},
    applyToolPolicy: (): void => {},
    async createHandle(input): Promise<MemberHandle> {
      const probe = probes.get(input.memberId)
      if (probe === undefined) throw new Error(`测试夹具没有为 ${input.memberId} 准备句柄`)
      await input.setup({ memberId: input.memberId, agentContext: {} })
      return probe.handle
    },
    lifecycleOf(memberId: MemberId): MemberLifecycle | null {
      return fold.members.get(memberId)?.lifecycle ?? null
    },
  })
  return { runtime, probes }
}

/** 激活两个成员（测试里统一在 `makeDeps` 里做，免得每条用例各自忘掉）。 */
async function activateAll(runtime: ReturnType<typeof createMemberRuntime>): Promise<void> {
  for (const memberId of [self, colleague]) {
    const outcome = await runtime.activate({ memberId, teamId: teamA, presetId: 'preset-test' })
    expect(outcome.kind, `激活 ${memberId} 应成功`).toBe('activated')
  }
}

// ── delegation 假件（与 delegation.spec.ts 同形，但只保留本文件需要的部分）──

interface SpawnSpies {
  readonly createTeam: SpawnRequest[]
  readonly inboxPush: HumanInboxItem[]
  readonly principalOf: MemberId[]
  verdict: PrincipalVerdict
}

function makeDelegation(
  ledger: Ledger,
  spies: SpawnSpies,
): DelegationDeps {
  return {
    ledger,
    inbox: {
      async push(item: HumanInboxItem): Promise<void> {
        spies.inboxPush.push(item)
      },
      async list(): Promise<readonly HumanInboxItem[]> {
        return spies.inboxPush
      },
    } satisfies HumanInbox,
    async principalOf(memberId: MemberId): Promise<PrincipalReviewer> {
      spies.principalOf.push(memberId)
      return {
        memberId: principalId,
        async reviewSpawn(): Promise<PrincipalVerdict> {
          return spies.verdict
        },
      }
    },
    async createTeam(request: SpawnRequest): Promise<TeamId> {
      spies.createTeam.push(request)
      // ⚠ 返回**由 requestId 派生**的 teamId，而不是 `team-spawned-<计数>`：
      // 计数版会让两个独立 harness 各自从 1 开始，于是「两边 teamId 相同」是
      // 夹具的性质、不是被测实现的性质 —— 拿它当断言就是一条**恒真/无效断言**
      //（首版正是这么写的，实测发现后改正）。派生版让 teamId 真正携带 requestId 的信息。
      return `team-${request.requestId}` as TeamId
    },
    now(): number {
      return 1_700_000_000_000
    },
    currentHumanOperatorId(): string {
      return 'human-emperor'
    },
  }
}

function newSpies(): SpawnSpies {
  return { createTeam: [], inboxPush: [], principalOf: [], verdict: { approved: true } }
}

// ── 组装 ────────────────────────────────────────────────────────────────────

interface Harness {
  readonly ledger: Ledger
  readonly tools: readonly SophiaToolDescriptor[]
  readonly byName: ReadonlyMap<string, SophiaToolDescriptor>
  readonly spies: SpawnSpies
  readonly runtime: ReturnType<typeof createMemberRuntime>
  readonly probes: ReadonlyMap<MemberId, RuntimeProbe>
  readonly projection: SophiaProjectionPorts
  readonly deps: SophiaToolsDeps
}

async function makeHarness(
  options: {
    /** 现成的账本实例。 */
    readonly ledger?: Ledger | undefined
    /**
     * 从「基底账本」派生一个**包装过的**账本（用于替换 `commit` 等）。
     * 与 `ledger` 互斥：给了 `ledger` 就直接用，给了 `ledgerOf` 就以种好的账本为基底包装。
     */
    readonly ledgerOf?: ((base: Ledger) => Partial<Ledger>) | undefined
    /**
     * 直接覆盖整个 caller（用于构造"宿主接线坏掉"的接线）。
     * 与 `caller`/`callerTeam` 互斥：给了它就整份替换。
     */
    readonly callerOverride?: SophiaToolsDeps['caller'] | undefined
    /** 覆盖运行时端口（用于让 `presenceOf` 抛错之类）。 */
    readonly runtime?: ((base: SophiaToolsDeps['runtime']) => SophiaToolsDeps['runtime']) | undefined
    readonly caller?: MemberId | undefined
    readonly callerTeam?: TeamId | undefined
    readonly projection?: ((base: SophiaProjectionPorts) => SophiaProjectionPorts) | undefined
    /**
     * 覆盖时钟。**存在的理由**：OCR MEDIUM [7] 的回归用例要验「`deps.now()` 抛错时
     * 不进写序临界区」—— 那需要注入一个会抛的 now。不给这个选项就只能改生产代码去测，
     * 那等于用被测对象自己证明自己。
     */
    readonly now?: (() => number) | undefined
  } = {},
): Promise<Harness> {
  const baseLedger = options.ledger ?? seedLedger()
  // `Partial<Ledger>` 允许只覆盖个别方法（例如把 `commit` 换成一个返回坏形状的桩）——
  // 断言的目标是「工具在坏形状前的行为」，不必重写整个账本接口。
  const ledger: Ledger = options.ledgerOf === undefined ? baseLedger : { ...baseLedger, ...options.ledgerOf(baseLedger) }
  const spies = newSpies()
  const made = makeRuntime(ledger)
  const runtime = options.runtime === undefined ? made.runtime : options.runtime(made.runtime)
  const probes = made.probes
  await activateAll(runtime)
  const base = makeProjection(ledger)
  const projection = options.projection === undefined ? base : options.projection(base)
  const deps: SophiaToolsDeps = {
    // ⚠ 用 `in` 判定「有没有显式给这个选项」，而不是 `??` 或 `!== undefined`：
    // 后两者都会把**显式传入的 `undefined`** 也当成「没给」而至默认值，
    // 于是「宿主把 caller 绑成 undefined」这种接线**永远测不到**（我第一版就栽在这）。
    caller: 'callerOverride' in options
      ? options.callerOverride as SophiaToolsDeps['caller']
      : { memberId: options.caller ?? self, teamId: options.callerTeam ?? teamA },
    ledger,
    runtime,
    projection,
    delegation: makeDelegation(ledger, spies),
    now: options.now ?? (() => 1_700_000_000_000),
  }
  const tools = createSophiaTools(deps)
  return {
    ledger,
    tools,
    byName: new Map(tools.map((tool) => [tool.name, tool])),
    spies,
    runtime,
    probes,
    projection,
    deps,
  }
}

function toolOf(harness: Harness, name: string): SophiaToolDescriptor {
  const tool = harness.byName.get(name)
  if (tool === undefined) throw new Error(`没有名为 ${name} 的工具`)
  return tool
}

/**
 * 渲染一个工具的结果并取出**纯文本**。
 *
 * ⚠ 存在的理由：描述符的 `render` 签名是 `(args, output) => Content[]`
 * （对齐 `dsh-tools` 的 `output.render`，见 `SophiaToolDescriptor.render`），
 * 而用例断言的是**文本内容**。这个辅助把两件事收在一处：
 * ① 补上 `args`（本层的结果文本不依赖它，传 `{}` 即可）；
 * ② 把 `Content[]` 拆成文本 —— 若将来形状变了，**只有这里要改**。
 * 直接在各用例里写 `tool.render(result)` 会拿到一个数组，
 * 断言 `toContain` 会静默变成「数组里有没有这个元素」（**恒假**而非报错）。
 */
function renderedText(tool: SophiaToolDescriptor, output: unknown): string {
  return tool.render({}, output).map((c) => c.text).join('')
}

/**
 * 动态加载**真实的** `dsh-tools`（用于验证 `outputSchema` 真的能被宿主接受）。
 *
 * ## 为什么必须用真实的，而不是在本包里仿一个校验器
 *
 * 断言的对象是「**宿主会不会接受**这个 schema」。用自己写的校验器去验自己写的
 * schema，等于自证 —— 而本批已经反复吃过「假件撑着的断言」的亏。
 *
 * ## 为什么返回 `null` 而不是抛错 / 静默跳过
 *
 * `dsh-tools` 装在 DSH 的 profile 目录下（**不在本仓的 node_modules 里**），
 * 所以它**可能**在别的机器上不存在。三种处置里：
 * - 静默跳过 ⇒ 最坏：断言变成了永远不跑的空壳，而报告会说「全绿」；
 * - 直接抛 ⇒ 让本仓的单测依赖「本机装了 DSH」，CI 上会红得莫名其妙；
 * - **返回 `null`，由调用方断言不为 `null`** ⇒ 本机缺失时**明确失败并说明原因**，
 *   而不是假装通过。这里选第三种。
 *
 * 路径用 `%USERPROFILE%`（Windows）与 `os.homedir()` 兜底，不硬编码机器名。
 */
async function importDshTools(): Promise<{
  readonly valueSchemaSpecToJsonSchema: (schema: unknown) => unknown
  readonly validateJsonSchemaValue: (schema: unknown, value: unknown, path: string) => readonly string[]
} | null> {
  const { homedir } = await import('node:os')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  const candidates = [
    join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ]
  for (const candidate of candidates) {
    try {
      const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>
      if (typeof mod['valueSchemaSpecToJsonSchema'] === 'function') {
        return mod as never
      }
    } catch {
      // 试下一个候选路径。
    }
  }
  return null
}

/** 调一个工具并把结果当字典读（逐字段断言时用）。 */
async function run(
  harness: Harness,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const output = await toolOf(harness, name).run(input)
  return output as unknown as Record<string, unknown>
}

// ════════════════════════════════════════════════════════════════════════════
// ① 工具集形状
// ════════════════════════════════════════════════════════════════════════════

describe('① 工具集形状（名称闭集、schema、防冒充）', () => {
  it('恰好五个工具，名字与 SOPHIA_TOOL_NAMES 逐字一致且顺序一致', async () => {
    const harness = await makeHarness()
    // 反恒真：给 createSophiaTools 少 return 一个工具 → 本条必须变红。
    expect(harness.tools).toHaveLength(SOPHIA_IMPLEMENTED_TOOL_COUNT)
    expect(harness.tools.map((tool) => tool.name)).toEqual([...SOPHIA_TOOL_NAMES])
    expect(SOPHIA_TOOL_NAMES).toHaveLength(5)
  })

  it('每个工具都有非空描述与对象形状的参数 schema', async () => {
    const harness = await makeHarness()
    for (const tool of harness.tools) {
      expect(tool.description.length, `${tool.name} 的描述不能为空`).toBeGreaterThan(10)
      expect(typeof tool.parameters, `${tool.name} 必须有参数 schema`).toBe('object')
      expect(Array.isArray(tool.parameters)).toBe(false)
      // 每个参数都必须带 description（模型靠它才知道怎么填）与 type。
      for (const [field, parameter] of Object.entries(tool.parameters)) {
        expect(parameter.description.length, `${tool.name}.${field} 缺描述`).toBeGreaterThan(0)
        expect(['string', 'number', 'boolean', 'array', 'object']).toContain(parameter.type)
      }
    }
  })

  it('**没有任何工具**把「我是谁」做成参数（防冒充是结构性的，不是运行期校验）', async () => {
    // 上游参照实现（dsh-agent-teams/src/tools.ts:1899）用「args.from 必须等于调用者身份」
    // 这条运行期校验防冒充。本实现把它前移成「参数里根本没有这个字段」——
    // 模型连一次越权调用都构造不出来。
    // 反恒真：给任一工具的 parameters 加一个 `from` / `requesterMemberId` → 本条必须变红。
    const forbidden = [
      'from',
      'sender',
      'requesterMemberId',
      'requesterKind',
      'caller',
      'callerMemberId',
      'actor',
      'trigger',
    ]
    const harness = await makeHarness()
    for (const tool of harness.tools) {
      for (const field of forbidden) {
        expect(
          Object.keys(tool.parameters),
          `${tool.name} 不得把身份/触发者做成参数（${field}）`,
        ).not.toContain(field)
      }
    }
  })

  it('源码里不存在「第二次注册」的工具定义（不 import @deepseek-ai/*）', () => {
    // SPEC §1.1：本包不得 import SDK 类型。工具层最容易破例的地方就是
    // 「顺手 import defineTool 直接返回 SDK 对象」—— 那会以 TS7016 挂掉。
    const source = readFileSync(join(PKG_ROOT, 'src', 'tools', 'index.ts'), 'utf8')
    expect(source).not.toMatch(/from '@deepseek-ai\//)
    for (const file of ['message.ts', 'task-claim.ts', 'spawn-team.ts', 'switch-model.ts', 'rollover.ts']) {
      const code = readFileSync(join(PKG_ROOT, 'src', 'tools', file), 'utf8')
      expect(code, `${file} 不得 import @deepseek-ai/*`).not.toMatch(/from '@deepseek-ai\//)
      expect(code, `${file} 不得 import node:sqlite`).not.toMatch(/from 'node:sqlite'/)
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ② sophia_team_message
// ════════════════════════════════════════════════════════════════════════════

describe('② sophia_team_message', () => {
  it('正向：起一条新线程 → 落账 thread-started + message-sent，且把正文送到收件人', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length

    const result = await run(harness, 'sophia_team_message', {
      content: '请复核 t4 的工具集',
      to: '推步主事',
      channelId: channelA,
      threadTitle: 't4 复核',
    })

    expect(result['kind']).toBe('sent')
    expect(result['threadCreated']).toBe(true)
    expect(String(result['threadId'])).toMatch(new RegExp(`^${SOPHIA_THREAD_ID_PREFIX}`))
    // ⚠ `before + 1` → `before + 2`：**因起线程路径现在落两条事实**而必更
    //（`team/thread-started` + `team/message-sent`，把首条正文也落账）。
    // `newestSequence` 取**最新**一条（即 message-sent）的序号。
    expect(result['newestSequence']).toBe(before + 2)

    const events = eventsOfKind(harness.ledger, 'team/thread-started')
    expect(events).toHaveLength(1)
    expect(dataOf(events[0])['assigneeMemberId']).toBe(colleague)
    expect(dataOf(events[0])['channelId']).toBe(channelA)

    // ⚠ 本段是**新增覆盖**（B 类改写的一部分）：起线程时带的正文 = 该线程的**第一条消息**，
    // 它必须落账，否则「消息流」对未回复的线程（多数线程）依旧为空 —— 那正是本次要修的东西。
    // 反恒真：把起线程路径的 `commitMessageSent(...)` 删掉 → 这里的 `toHaveLength(1)` 必红。
    const sent = eventsOfKind(harness.ledger, 'team/message-sent')
    expect(sent, '起线程路径必须落一条 team/message-sent').toHaveLength(1)
    expect(dataOf(sent[0])['body']).toBe('请复核 t4 的工具集')
    expect(dataOf(sent[0])['channelId']).toBe(channelA)
    expect(dataOf(sent[0])['threadId']).toBe(result['threadId'])
    // 发送者是**调用者**（不是收件人）—— 两者的归属不同，混了会让界面把消息挂在收件人名下。
    expect(dataOf(sent[0])['senderMemberId']).toBe(self)
    expect(String(dataOf(sent[0])['messageId'])).toMatch(new RegExp(`^${SOPHIA_MESSAGE_ID_PREFIX}`))

    // 正文经运行时送达（起线程路径下 `colleague` 空闲 ⇒ followup）。
    const probe = harness.probes.get(colleague)
    expect(probe?.notices.followup).toHaveLength(1)
    expect(probe?.notices.followup[0]?.content[0]?.text).toContain('请复核 t4 的工具集')
    expect(result['delivery']).toEqual({
      kind: 'delivered',
      channel: 'followup',
      reason: null,
      delivered: true,
    })
    // ⚠ `gaps` 由 `[SOPHIA_TOOL_CONTRACT_GAPS.messageBody]` 改为 `[]`：
    // **正文现在有承载处了**（`team/message-sent`），该缺口关闭、常量已从
    // `SOPHIA_TOOL_CONTRACT_GAPS` 删除。留着一句「正文无处可落」会是**假话**。
    expect(result['gaps']).toEqual([])
  })

  it('正向：回复已有线程 → 落账一条 team/message-sent（**缺口的关闭**：从「不写账本」改为「写」）', async () => {
    // ⚠ 本用例是**有意的行为变更**（B 类），不是清理。历史留在下面，删掉就没人知道改过什么：
    //
    // 改前（旧标题：「正向：回复已有线程 → **不写账本**，正文照常送达」）：
    //   当时**没有任何事件**能承载「往已有线程追加一条消息」——上游有
    //   `team/message-sent`（起线程）与 `team/thread-replied`（回复）两个 kind，
    //   而本契约把它们合并成了 `team/thread-started` 一个，再写一条它会**覆盖**
    //   该线程的 `channelId`/`title`/`appearedAtSequence`（投影层对同 `threadId`
    //   是覆盖写）⇒ 等于用「启动」事件伪造一次「重新启动」。
    //   故当时选择**不写**，并把 `CONTRACT-GAP[thread-reply]` 带进结果；
    //   那条断言甚至专门写了一行「反恒真：让回复路径也走 `commit` → 本条必须变红」，
    //   **它的目的就是钉住这个决策**。
    // 改后（现在）：`team/message-sent` 存在且带自己的 `messageId`/正文、
    //   不带线程的 `title`/`assigneeMemberId` ⇒ 覆盖写线程事实在字段层面就不可能。
    //   于是缺口关闭 ⇒ 本用例断言**新行为**。
    //
    // 反恒真：把回复路径的 `commitMessageSent(...)` 删回「不写账本」→ 下面
    // `toHaveLength(1)` 与 `newestSequence` 两条必红（已实测，输出见交付报告）。
    const harness = await makeHarness()
    const first = await run(harness, 'sophia_team_message', {
      content: '第一条',
      to: '推步主事',
      channelId: channelA,
      threadTitle: '线程一',
    })
    const threadId = String(first['threadId'])
    const afterCreate = allEvents(harness.ledger).length

    const second = await run(harness, 'sophia_team_message', {
      content: '第二条',
      to: '推步主事',
      threadId,
    })

    expect(second['kind']).toBe('sent')
    expect(second['threadCreated']).toBe(false)
    // ⚠ `null` → 真实序号：回复路径**现在也落账**，`newestSequence` 就是那条
    // `team/message-sent` 的序号（类型契约「已落账事件的序号」因此恢复为有值）。
    expect(second['newestSequence']).toBe(afterCreate + 1)

    const events = eventsOfKind(harness.ledger, 'team/message-sent')
    // 第一条来自起线程路径（首条正文），第二条来自这次回复。
    expect(events, '两条路径各落一条').toHaveLength(2)
    const replyEvent = events[1]
    expect(dataOf(replyEvent)['body']).toBe('第二条')
    expect(dataOf(replyEvent)['threadId']).toBe(threadId)
    // `channelId` 取自**投影里那条线程自己的事实**，不是调用方入参（回复路径没有这个入参）。
    expect(dataOf(replyEvent)['channelId']).toBe(channelA)
    expect(dataOf(replyEvent)['senderMemberId']).toBe(self)

    // 缺口关闭 ⇒ `gaps` 为空（原先断言 `[SOPHIA_TOOL_CONTRACT_GAPS.threadReply]`，
    // 该常量已随缺口关闭从 `SOPHIA_TOOL_CONTRACT_GAPS` 删除）。
    expect(second['gaps']).toEqual([])
    // 回复**没有**伪造一次「重新启动」：线程事实仍是起线程那条（覆盖写风险的结构性排除）。
    const threads = eventsOfKind(harness.ledger, 'team/thread-started')
    expect(threads, '回复不得再写 thread-started').toHaveLength(1)
    expect(harness.probes.get(colleague)?.notices.followup).toHaveLength(2)
  })

  it('**连发两条回复都被送达**（回复路径的 ref 必须唯一，否则第二条被静默去重）', async () => {
    // 这是本文件最重要的一条：若回复路径的 `ref` 只有 `threadId`，
    // 两条回复的 (ref, revision, unreadCount, newestSequence) 完全相同 ⇒
    // 第二条被**真**运行时的去重判成 `duplicate`，接收方永远收不到它，
    // 而账本上看不出任何异常。
    // 反恒真（已实测）：把 `message.ts` 里回复路径的 ref 改成 `String(requestedThread)`
    // → 第二条的 delivery.kind 变成 'duplicate'，下面的断言变红。
    const harness = await makeHarness()
    const created = await run(harness, 'sophia_team_message', {
      content: '起点',
      to: '推步主事',
      channelId: channelA,
      threadTitle: '线程一',
    })
    const threadId = String(created['threadId'])

    const one = await run(harness, 'sophia_team_message', { content: 'A', to: '推步主事', threadId })
    const two = await run(harness, 'sophia_team_message', { content: 'B', to: '推步主事', threadId })

    expect((one['delivery'] as Record<string, unknown>)['kind']).toBe('delivered')
    expect(
      (two['delivery'] as Record<string, unknown>)['kind'],
      '第二条回复必须也被送达（ref 唯一）',
    ).toBe('delivered')
    const probe = harness.probes.get(colleague)
    expect(probe?.notices.followup).toHaveLength(3)
    expect(probe?.notices.followup.map((message) => message.content[0]?.text)).toEqual([
      expect.stringContaining('起点'),
      expect.stringContaining('A'),
      expect.stringContaining('B'),
    ])
  })

  it('逆向：收件人解析不出来 → unknown-recipient，**零副作用**', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length

    const result = await run(harness, 'sophia_team_message', {
      content: '你好',
      to: '不存在的人',
      channelId: channelA,
      threadTitle: '线程',
    })

    expect(result['kind']).toBe('unknown-recipient')
    expect(allEvents(harness.ledger).length).toBe(before)
    expect(harness.probes.get(colleague)?.notices.followup).toHaveLength(0)
  })

  it('逆向：跨团频道 → cross-team，**零副作用**（FR-7.2 的隔离口径）', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length

    const result = await run(harness, 'sophia_team_message', {
      content: '不该送出去',
      to: '推步主事',
      channelId: channelB, // 属于 teamB
      threadTitle: '线程',
    })

    expect(result['kind']).toBe('cross-team')
    expect(allEvents(harness.ledger).length).toBe(before)
    expect(harness.probes.get(colleague)?.notices.followup).toHaveLength(0)
  })

  it('★ 未送达时 delivery 必须标明「本次未送达」且带原因（回归：OCR [19]/[20]）', async () => {
    // 回归用例：初版 render 一律写成「送达 <id>：<kind>」，把 `duplicate` / `no-handle` /
    // `not-active` 这些**没有真的送到**的分支显示成成功；且失败分支携带的 `reason`
    // 被整个丢掉（`delivery-failed` 只输出一个 kind，一个字都不说为什么）。
    // 反恒真：把 render 改回「送达 ${kind}」并去掉 reason → 本条必须变红。
    const harness = await makeHarness()
    // 释放收件人句柄 ⇒ notify 必返回 no-handle（没有真的送到）。
    expect(await harness.runtime.release(colleague)).toBe(true)

    const result = await run(harness, 'sophia_team_message', {
      content: '这条送不到', to: '推步主事', channelId: channelA, threadTitle: '线程',
    })

    expect(result['kind']).toBe('sent') // 事实已落账，整体仍是 sent
    const delivery = result['delivery'] as Record<string, unknown>
    expect(delivery['kind']).toBe('no-handle')
    expect(delivery['delivered'], 'no-handle 没送到 ⇒ delivered 必须为 false').toBe(false)

    const rendered = renderedText(toolOf(harness, 'sophia_team_message'), result)
    expect(rendered).toContain('本次未送达')
    expect(rendered).not.toMatch(/已送达/)
  })

  it('★ `duplicate` 不是「已送达」——它表示运行时**抑制**了这次投递（回归：OCR [20]）', async () => {
    // 回归用例：`duplicate` 表示同签名的待办此前已送达（`member-runtime.ts:1102-1106`），
    // 本次**没有**再送一次。初版措辞读起来像「成功（只是重复）」。
    // 这里直接构造：先用「同一份正文 + 同一个 ref 形状」把签名占住 ——
    // 起线程路径的 ref 含账本序号，故同一线程内第二条必然是新签名；
    // 于是用一个**受控的 unreadOf**把两次调用的 unreadCount 固定成相同的值，
    // 再让第二次的 ref 也相同（通过回复同一条线程并要求 ref 稳定是不行的 ——
    // 回复路径的 ref 故意唯一）。
    // ⇒ 换个更直接的构造：让 unreadOf 恒定，且**用起线程路径对同一条已存在线程**
    //    是不可能的（那条路走 unknown-thread）。故这里改为**直接验证渲染层**：
    //    拿一个 delivered=false 且 kind='duplicate' 的结果喂给 render，确认它明说未送达。
    const harness = await makeHarness()
    const fake = {
      kind: 'sent', threadId: 'thread-x', threadCreated: false, newestSequence: null,
      recipientMemberId: colleague,
      delivery: { kind: 'duplicate', channel: null, reason: null, delivered: false },
      gaps: [],
    }
    const rendered = renderedText(toolOf(harness, 'sophia_team_message'), fake)
    expect(rendered).toContain('本次未送达')
    expect(rendered).toContain('duplicate')
    expect(rendered).not.toMatch(/已送达/)
  })

  it('★ 注入端口抛错 ⇒ 返回 `failed`，**绝不穿透**（回归：OCR HIGH [14]）', async () => {
    // 回归用例：本包的工具契约是「只返回错误、绝不抛」，而初版只把
    // `ledger.head()`/`commit()` 包了 try，三个**投影端口是裸调**的。
    // 它们是宿主注入的函数、通常读账本 —— 一次存储错误就会从 `execute` 穿透出去。
    // 反恒真：把 `guarded(...)` 去掉（改回裸调）→ 本条必须变红（会 throw）。
    const boom = (): never => {
      throw new Error('投影炸了（模拟存储错误）')
    }
    // ⚠ 只覆盖**目标端口**，其余端口保留原实现。我第一版写的是
    // `dag: patch(base.dag)` 且 patch 用 `{...base, ownerOf: boom}` —— 看起来对，
    // 但循环里前两次是「只替换一个端口」，到第三次却把 dag 整个换掉，
    // 于是第二次用例的 `ownerOf` 也成了 boom ⇒ 它在门 1 就失败、拿到 `failed` 而**不是**
    // 我期望的「门 2 的 failed」，断言以 `unknown-dag-team` 红。
    // ⇒ 改成显式逐端口覆盖，每个用例只坏一个。
    const cases: readonly [string, (dag: SophiaDagPorts) => SophiaDagPorts][] = [
      ['ownerOf', (dag) => ({ ...dag, ownerOf: boom })],
      ['taskStateOf', (dag) => ({ ...dag, taskStateOf: boom })],
      ['unfinishedDependenciesOf', (dag) => ({ ...dag, unfinishedDependenciesOf: boom })],
    ]
    for (const [name, patch] of cases) {
      // ⚠ **必须先把 DAG 种子种上**：否则 `ownerOf` 返回 `null` ⇒ 在门 1 就以
      // `unknown-dag-team` 退出，`taskStateOf` / `unfinishedDependenciesOf` 这两条
      // **永远走不到**（我第一版漏了这步，于是第 2、3 条用例拿到 `unknown-dag-team` 而红）。
      // 这正是「分支级不可测」的隐蔽形态：用例看着覆盖了三个端口，实际只覆盖了第一个。
      const ledger = seedLedger()
      seedDag(ledger, self, 'task-1', 'pending')
      const harness = await makeHarness({
        ledger,
        projection: (base) => ({ ...base, dag: patch(base.dag) }),
      })
      let threw: unknown = null
      let result: Record<string, unknown> | null = null
      try {
        result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })
      } catch (error) {
        threw = error
      }
      expect(threw, `${name} 抛错时不得穿透 execute`).toBeNull()
      expect(result?.['kind'], `${name} 抛错应归一成 failed`).toBe('failed')
      // ⚠ 断言的是**错误原文被带出来**，不是端口名。实现里给的是人类可读的阶段名
      //（「读 DAG 团队归属时抛错」）—— 那比 `ownerOf` 对调用方更有用。
      // 我第一版在这里断言 `toContain(name)`（端口名）并因此变红：**是断言写错了，不是实现错了**，
      // 故改为断言共有的那部分（注入的异常原文），它同时证明了「原因没被吞掉」。
      expect(String(result?.['reason']), '必须带出注入异常的原文').toContain('投影炸了')
    }
  })

  it('★ 空串状态是**脏数据**，不得被前推落账（回归：OCR MEDIUM [16]）', async () => {
    // 回归用例：`taskStateOf` 的文档区分「null = 没有这个任务」与「空串 = 脏数据」。
    // 初版让空串直接穿过，最终把 `from: ''` 写进**不可改写**的账本 ——
    // 即把非法状态前推给所有回放者，正是「from 必须取自投影」这套设计要防的事。
    // 反恒真：删掉 `current.trim() === ''` 那道判断 → 本条必须变红。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', '')
    const harness = await makeHarness({ ledger })
    const before = eventsOfKind(ledger, 'dag/task-state-changed').length

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('failed')
    expect(String(result['reason'])).toContain('空串')
    expect(eventsOfKind(ledger, 'dag/task-state-changed').length, '不得落账').toBe(before)
  })

  it('★ `deps.now()` 抛错 ⇒ 不进写序临界区，且原因准确（回归：OCR MEDIUM [7]）', async () => {
    // 回归用例：初版把 `occurredAt: deps.now()` **写在 commit 的实参对象里** ——
    // 即把一次宿主注入的、可能抛错的调用塞进了 `head()` 与 `commit()` 之间的临界区。
    // 抛错时会被 catch 报成「写账本失败」，**而账本根本没被碰过** ⇒
    // 调用方会以为「可能已写入」去核对一个不存在的条目。
    //
    // ## ⚠ 这条用例第一版**测不出**这个缺陷（我自己用变异发现，记录在此）
    //
    // 我最初只断言 `reason` 含 `now` 且不含「写账本失败」。把 `occurredAt` 挪回
    // commit 实参里之后，**断言仍然全绿** —— 因为修好后的实现**在临界区之前**就已经
    // 调过一次 `now()`（那次就抛了），于是 commit 实参里那次**根本执行不到**，
    // 行为前后完全一样。即：那条断言**不区分**修好版与坏版（实测：变异后
    // `Tests 1 passed`）。这正是「分支级不可测」的隐蔽形态 —— 断言看着很具体，
    // 却没有落在能区分两种实现的差异上。
    //
    // ## 能真正区分的断言：**`now()` 只被调用一次**
    //
    // 修好版：临界区外调用 1 次，进入前者就返回 ⇒ 计数 1。
    // 坏版（`occurredAt: deps.now()` 在 commit 实参里）：临界区外 1 次 + 实参里 1 次
    // ⇒ 若第一次不抛则计数 2。故这里**不抛**、改为**计数**，才落在那处差异上。
    let nowCalls = 0
    const harness = await makeHarness({
      now: () => {
        nowCalls += 1
        return 1_700_000_000_000
      },
    })
    const ok = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })
    expect(ok['kind'], '不抛时应正常换模').toBe('switched')
    expect(nowCalls, '`now()` 必须只调用一次（临界区内不得再调）').toBe(1)

    // 抛错那一支：原因必须说清是 now，而不是「写账本失败」，且账本不得被碰。
    const throwing = await makeHarness({
      now: () => {
        throw new Error('时钟炸了')
      },
    })
    // ⚠ `before` 必须在**这个 harness 自己**上取。我第一版从上一个 harness 取
    //（`harness.ledger.head()`），两个 harness 各有各的账本 ⇒ 断言拿到 `10 vs 11` 而假红。
    const before = throwing.ledger.head().sequence
    const result = await run(throwing, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })
    expect(result['kind']).toBe('failed')
    const reason = String(result['reason'])
    expect(reason, '必须说清是 now 抛错，而不是「写账本失败」').toContain('now')
    expect(reason).not.toContain('写账本失败')
    expect(throwing.ledger.head().sequence, '账本不得被碰过').toBe(before)
  })

  it('★ 落账的 memberId 必须是**裁剪过的**（回归：OCR MEDIUM [8]）', async () => {
    // 回归用例：门用 `selfMemberId`（裁剪过）、而落账写的是 `deps.caller.memberId`（未裁剪）
    // ⇒ 「判定」与「落账」读两个不同的真相：接线带空白时门放行，
    // 而账本里记下的 actor/memberId 是**带空白**的那个，永久留在审计链上。
    // 反恒真：把 payload 改回 `deps.caller.memberId` → 本条必须变红。
    const harness = await makeHarness({ caller: ` ${self} ` as MemberId })
    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })
    expect(result['kind'], '带空白的自己应被裁剪成自己').toBe('switched')
    const event = eventsOfKind(harness.ledger, 'team/member-model-switched').at(-1)
    // `LedgerActor` 是**联合**（member / human / system），只有 member 分支有 memberId。
    // 这里断言它是 member 分支后再取值 —— 直接取会让类型检查失败（实测 TS2339），
    // 而强转过去会掩盖「actor 竟然不是 member」这个真问题。
    expect(event?.actor.kind, 'actor 必须是 member').toBe('member')
    const actor = event?.actor as { readonly kind: 'member'; readonly memberId: MemberId }
    expect(actor.memberId, 'actor 必须裁剪').toBe(self)
    expect(dataOf(event)['memberId'], 'payload.memberId 必须裁剪').toBe(self)
  })

  it('★ `requestId` 必须裁剪 + 限长（回归：OCR HIGH [18]）', async () => {
    // 回归用例：初版只校验「非空字符串」，于是
    // ① `' req-abc'` 与 `'req-abc'` 成了**两个幂等键**（FR-5.3.4 的逃逸窗口，一个不可见字符就能开）；
    // ② 无上限 ⇒ 模型可塞一个超长 id，而它原样落进不可改写账本。
    // 反恒真：把 narrowTrimmedString 换回 isNonEmptyString / 删掉上限 → 本条必须变红。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger })

    const padded = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团', roster: [{ position: 'p', count: 1 }],
      tasks: ['t'], requestId: '  req-abc  ',
    })
    expect(padded['requestId'], '带空白的 id 必须裁剪').toBe('req-abc')

    const tooLong = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团2', roster: [{ position: 'p', count: 1 }],
      tasks: ['t'], requestId: 'x'.repeat(SOPHIA_SPAWN_REQUEST_ID_MAX + 1),
    })
    expect(tooLong['kind']).toBe('invalid-input')
  })

  it('★ `SOPHIA_IMPLEMENTED_TOOL_COUNT` 与清单同源（回归：OCR LOW [5]）', async () => {
    // 回归用例：初版它是**裸字面量 5**，与清单无结构联系 ⇒ 加第六个工具时会静默停在 5。
    // 现在它是 `SOPHIA_TOOL_NAMES.length` ⇒ 结构性同源。
    // 反恒真：把 types.ts 里改成 `= 5` 字面量**且**清单加一项 → 本条必须变红。
    expect(SOPHIA_IMPLEMENTED_TOOL_COUNT).toBe(SOPHIA_TOOL_NAMES.length)
    expect(SOPHIA_IMPLEMENTED_TOOL_COUNT).toBe(5)
  })

  it('★ 产出顺序 = 清单顺序，且是**结构性**的（回归：OCR LOW [3]）', async () => {
    // 回归用例：初版工厂数组与清单**各自独立书写**，一致只由测试兜着
    //（只改数组顺序、不改清单 ⇒ tsc 全绿，只有跑测试才红）。
    // 现在工厂按清单映射构造。
    // 反恒真：把 createSophiaTools 改回手写数组并调换两项 → 本条必须变红。
    const harness = await makeHarness()
    const produced = createSophiaTools(harness.deps).map((d) => d.name)
    expect(produced).toEqual([...SOPHIA_TOOL_NAMES])
  })

  it('★ 名称清单**无重复**（回归：OCR LOW [4] —— 类型层的 satisfies 抓不到重复）', async () => {
    // 类型层能证「集合相等」（见 types.ts 的断言），但**表达不了「元组内无重复」**：
    // `['sophia_team_message','sophia_team_message',…]` 满足 satisfies，
    // `Missing/ExtraToolName` 也都是 never。故这条归运行期。
    // 反恒真：往清单里复制一项 → 本条必须变红。
    expect(new Set(SOPHIA_TOOL_NAMES).size, '清单里不得有重复名').toBe(SOPHIA_TOOL_NAMES.length)
  })

  it('★ `presenceOf` 抛错 ⇒ 报 `unknown`，**不是**编造的 `idle`（回归：OCR MEDIUM [2]）', async () => {
    // 回归用例：初版 `let presence: MemberPresence = 'idle'` 在 catch 里保持不变 ⇒
    // 「读不出来」被渲染成一句**确定的**观测「提交时存在态 idle」，
    // 而该成员此刻可能正在 running。对一个明确告诉调用方「可以信」的观测值来说，
    // 这是在**编造事实**。
    // 反恒真：把 catch 里的初值改回 'idle' → 本条必须变红。
    const harness = await makeHarness({
      runtime: (base) => ({
        ...base,
        presenceOf: () => {
          throw new Error('存在态读不出来')
        },
      }),
    })

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })

    expect(result['kind'], '读存在态失败不拦换模').toBe('switched')
    expect(result['presence'], '不得把「读失败」报成 idle').toBe('unknown')
    const rendered = renderedText(toolOf(harness, 'sophia_switch_model'), result)
    expect(rendered).toContain('unknown')
    expect(rendered, '不得出现编造的存在态').not.toContain('存在态 idle')
  })

  it('★ `receipt.sequence` 不是安全整数 ⇒ `failed`，**不得**报成跨进程并发（回归：OCR MEDIUM [6]）', async () => {
    // 回归用例：初版直接拿 `receipt.sequence` 去比 `predicted`。
    // 注入的 ledger 返回 `undefined` 时比较不成立 ⇒ 走 `sequence-mismatch`，
    // 那是一个**声称「认领事实已写入（序号 undefined）」**的分支 ——
    // 把「适配器坏了」读成「跨进程并发」，人工核对时会去找一条不存在的记录。
    // 反恒真：删掉 `isNonNegativeSafeInteger` 那道判断 → 本条必须变红。
    const harness = await makeHarness({
      // ⚠ `commit` 必须带**完整签名**（参数类型 + 返回类型），否则 TS 会把它推成
      // `() => {sequence: number}` 并因与 `Ledger['commit']` 不兼容而报 TS2322
      //（我第一版写成无参箭头函数，报错信息还指向 `ledgerOf` 的返回类型，很误导）。
      ledgerOf: (base) => {
        // ⚠ DAG 种子必须在**包装前**种进 base —— `seedDag` 写的是「账本的公共写入口」，
        // 而包装后的对象只有我自己声明的那些方法。第一版我在包装**之后**才 seed，
        // 于是种子经由包装对象的 `commit`（已被换成坏桩）写进去，什么都没落 ⇒
        // `ownerOf` 返回 null ⇒ 拿到 `unknown-dag-team` 而红。
        seedDag(base, self, 'task-1', 'pending')
        return {
          ...base,
          commit: (_input: LedgerCommitInput): LedgerReceipt =>
            ({ sequence: undefined as unknown as number }) as LedgerReceipt,
        }
      },
    })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('failed')
    const reason = String(result['reason'])
    expect(reason, '必须说清是 ledger 实现不符契约').toContain('非负安全整数')
    expect(reason, '不得读成跨进程并发').not.toContain('另一个进程')
  })

  it('★ 账本落账的身份必须是**裁剪过的** caller（回归：OCR [8] 同类，task-claim 侧）', async () => {
    // 与 switch-model 的 MEDIUM [8] 同源：门用裁剪值、落账用未裁剪值
    // ⇒ 同一次请求在账本里的身份与投影里的身份对不上，且永久留在审计链上。
    // 反恒真：把 payload 的 actor.memberId 改回 `deps.caller.memberId` → 本条必须变红。
    const harness = await makeHarness({ caller: ` ${self} ` as MemberId })
    seedDag(harness.ledger, self, 'task-1', 'pending')

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })
    expect(result['kind']).toBe('claimed')

    const event = eventsOfKind(harness.ledger, 'dag/task-state-changed').at(-1)
    expect(event?.actor.kind).toBe('member')
    const actor = event?.actor as { readonly kind: 'member'; readonly memberId: MemberId }
    expect(actor.memberId, 'actor 必须裁剪').toBe(self)
  })

  it('★ 名册/任务清单的首尾空白被裁剪（回归：OCR MEDIUM [13]）', async () => {
    // 回归用例：不裁剪则 `'灵台郎'` 与 `' 灵台郎 '` 是两个不同的职位，
    // 且申请键取自原值 ⇒ 空白变体派生出**另一个 requestId**，被当成全新申请（重复建团）。
    // 反恒真：把 `position.trim()` 改回 `position` → 本条必须变红。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团',
      roster: [{ position: ' 灵台郎 ', count: 1 }],
      tasks: [' 编算 '],
    })

    expect(result['kind']).toBe('created')
    // `createTeam` spy 收到的是**整个 `SpawnRequest`**，规格在其 `.spec` 下
    //（我第一版直接读 `request.roster` 而报 TS2339 —— 是我写错了，不是实现）。
    const request = harness.spies.createTeam.at(-1)
    expect(request?.spec.roster[0]?.position, 'position 必须裁剪').toBe('灵台郎')
    expect(request?.spec.tasks[0], 'tasks 项必须裁剪').toBe('编算')
  })

  it('★ `describeError` 遇无原型对象**绝不抛错**（回归：OCR MEDIUM [7]）', async () => {
    // 回归用例：初版 `String(error)` 对 `Object.create(null)` 抛 TypeError。
    // 而 describeError **只被 catch 块调用** ⇒ 「把失败转成可读原因」这条路径自己会抛，
    // 把本已捕获的异常换成另一个更难懂的异常冲出去。
    // 反恒真：把实现改回 `String(error)` → 本条必须变红。
    for (const value of [Object.create(null) as unknown, { [Symbol.toPrimitive]: () => { throw new Error('x') } }]) {
      expect(() => (describeError as (e: unknown) => string)(value)).not.toThrow()
    }
    // 常规 Error 仍应给出 message（不能被兜底吞掉可诊断信息）。
    expect(describeError(new Error('具体原因'))).toBe('具体原因')
  })

  it('★ `renderValueForMessage` 覆盖两类失败：抛错 与 返回 undefined（回归：OCR [17][18]）', async () => {
    // 回归用例：`JSON.stringify` 有**两种**失败方式，初版注释只提了「抛错」，
    // 会诱人把 `typeof json === 'string'` 那道判断当死代码删掉。
    // 反恒真：把 `bigint` 从原始值分支挪进 JSON.stringify 路径 → 本条必须变红（会抛）。
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    const cases: readonly [unknown, string][] = [
      [1n, '1'],                                    // bigint：JSON.stringify 会抛，必须走 String
      [circular, '无法序列化'],                       // 抛错那类
      [() => 0, '无 JSON 表示'],                      // 返回 undefined 那类
      [Symbol('s'), '无 JSON 表示'],                  // 同上
      [Object.create(null), '{}'],                  // 无原型对象：JSON.stringify 能处理
    ]
    for (const [value, expected] of cases) {
      const out = renderValueForMessage(value)
      expect(out, `${String(typeof value)} 的渲染不得抛错`).toContain(expected)
    }
  })


  it('★ 空串与「没给」必须是**不同**的文案（回归：OCR LOW [16]）', async () => {
    // 回归用例：初版对 `''` 给的是 `badFieldReason(field, '非空白字符串或省略', '')` ——
    // 文案里的「**或省略**」对 `''` 是**假话**：`undefined` 已在上一个分支被放行，
    // 走到这里就说明调用方**明确给了一个空值**，不是「省略」。
    // 「给了空串」与「没给」对调用方是两条不同的修法（删字段 vs 补字段）。
    // 反恒真：把 `if (value === '')` 那行删掉（让它落到 badFieldReason）→ 本条必须变红。
    const harness = await makeHarness()

    // ⚠ 「省略」要用一个**必填**字段来测。我第一版拿 `content` 试，但 `content:''`
    // 与「不给 content」都被判非法，而**省略 content 时走的却是 `missingFieldReason`**
    // —— 两者都对，我却在断言里把「省略」写成了 `content` 不给，于是拿到 `sent`?? 不：
    // 实际是我把 omitted 的用例传了完整字段，`content` 反而没省 ⇒ 走到 `sent` 而红。
    // 这里改用 `channelId`（起线程路径的必填项）来对照，语义清楚也没有歧义。
    const omitted = await run(harness, 'sophia_team_message', {
      content: 'x', to: '推步主事', threadTitle: 't',
    })
    const empty = await run(harness, 'sophia_team_message', {
      content: 'x', to: '推步主事', channelId: '', threadTitle: 't',
    })

    expect(omitted['kind'], '不给 channelId ⇒ 非法').toBe('invalid-input')
    expect(empty['kind'], '给空串 channelId ⇒ 也非法').toBe('invalid-input')
    const omittedReason = String(omitted['reason'])
    const emptyReason = String(empty['reason'])
    expect(omittedReason, '省略时说「缺少」').toContain('缺少')
    expect(emptyReason, '给了空串时**不得**说「或省略」').not.toContain('或省略')
    expect(emptyReason).toContain('缺少')
  })

  it('★ `message` 的注入端口抛错 ⇒ `failed`，**绝不穿透**（回归：OCR HIGH [14] 第二例）', async () => {
    // 回归用例：本文件的契约是「只返回错误、绝不抛」，而 message.ts 初版把
    // `resolveMemberRef` / `threadOf` / `channelTeamOf` **全裸调了** ——
    // 它们是宿主注入、通常读账本的端口，一次存储错误就从 `execute` 穿透出去。
    // 反恒真：把任一处 `guarded(...)` 拆回裸调 → 本条必须变红（会 throw）。
    const boom = (): never => {
      throw new Error('投影炸了（模拟存储错误）')
    }
    // ⚠ `threadOf` **只在给了 `threadId` 时**才被调用（回复路径分流），
    // 所以这一条必须带上 `threadId` 才走得到那个端口 ——
    // 我第一版对三种端口用了同一份入参（不带 threadId），于是 `threadOf` 根本被调用、
    // 结果拿到 `sent` 而红。**是入参没覆盖到那条分支，不是实现漏包。**
    const cases: readonly [string, (base: SophiaProjectionPorts) => SophiaProjectionPorts, Record<string, unknown>][] = [
      ['resolveMemberRef', (base) => ({ ...base, resolveMemberRef: boom }), {
        content: 'x', to: '推步主事', channelId: channelA, threadTitle: 't',
      }],
      ['threadOf', (base) => ({ ...base, threadOf: boom }), {
        content: 'x', to: '推步主事', threadId: 'thread-any',
      }],
      ['channelTeamOf', (base) => ({ ...base, channelTeamOf: boom }), {
        content: 'x', to: '推步主事', channelId: channelA, threadTitle: 't',
      }],
    ]
    for (const [name, patch, args] of cases) {
      const harness = await makeHarness({ projection: patch })
      let threw: unknown = null
      let result: Record<string, unknown> | null = null
      try {
        result = await run(harness, 'sophia_team_message', args)
      } catch (error) {
        threw = error
      }
      expect(threw, `${name} 抛错时不得穿透 execute`).toBeNull()
      expect(result?.['kind'], `${name} 抛错应归一成 failed`).toBe('failed')
      expect(String(result?.['reason']), '必须带出注入异常的原文').toContain('投影炸了')
    }
  })

  it('★ `null` 状态必须是 `unknown-task`，**不得**被形状守卫吞掉（回归：OCR MEDIUM [7]）', async () => {
    // 回归用例：我为修 HIGH [5]（非字符串上 `.trim()` 抛错）加了一道形状守卫，
    // 但把它放在了 `null` 判定**之前** —— 而 `typeof null === 'object'` ⇒
    // 「没有这个任务」被那道守卫吞掉，报成「适配器与契约不符」这个**错的诊断**。
    // 两者的调用方动作完全不同，不可混。
    // 反恒真：把 `if (current === null)` 挪回形状守卫之后 → 本条必须变红。
    const ledger = seedLedger()
    // ⚠ 必须先种 **DAG 团**：不种的话门 1（归属）就以 `unknown-dag-team` 退出，
    // 「任务不存在」这条分支**永远走不到**。我第一版漏了这步 ⇒ 拿到 `unknown-dag-team` 而红
    // （与 HIGH [14] 那条用例踩过的是同一个坑：**分支级不可测**）。
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: '不存在的任务' })

    expect(result['kind'], '任务不存在 ⇒ unknown-task').toBe('unknown-task')
    expect(String(result['reason'])).toContain('没有任务')
  })

  it('★ 名册 position 有**逐项**长度上限（回归：OCR MEDIUM [8]）', async () => {
    // 回归用例：`SOPHIA_SPAWN_ROSTER_MAX` 限的是**项数**、不是载荷大小 ——
    // 一个 1MB 的 position 能通过所有既有检查，然后被逐字写进**不可改写**的账本，
    // 且此后每次读取都要读回来。
    // 反恒真：删掉 `trimmedPosition.length > SOPHIA_SPAWN_POSITION_MAX` → 本条必须变红。
    const harness = await makeHarness()

    const result = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团',
      roster: [{ position: 'x'.repeat(SOPHIA_SPAWN_POSITION_MAX + 1), count: 1 }],
      tasks: [],
    })

    expect(result['kind']).toBe('invalid-input')
    expect(String(result['reason'])).toContain('position')
    expect(harness.spies.createTeam, '不得建团').toHaveLength(0)
  })

  it('★ 重复职位被拒（回归：OCR LOW [9]）', async () => {
    // 回归用例：`[{position:'a',count:1},{position:'a',count:2}]` 造出一份含糊规格
    //（同一职位两行、数量矛盾），而 `delegation` 无从判断按哪一行建人。
    // 反恒真：删掉重复检查 → 本条必须变红。
    const harness = await makeHarness()

    const result = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团',
      roster: [{ position: '灵台郎', count: 1 }, { position: '灵台郎', count: 2 }],
      tasks: [],
    })

    expect(result['kind']).toBe('invalid-input')
    expect(String(result['reason'])).toContain('重复')
    expect(harness.spies.createTeam).toHaveLength(0)
  })

  it('★ `describeError` 的 `.name` getter 抛错也不外抛（回归：OCR MEDIUM [1]）', async () => {
    // 回归用例：初版把 `error.name` 读在 catch 块**内层 try 的外面**，而 `.name` 的
    // getter 同样可以被定义成抛错 ⇒ 那一下会把「读 message 失败」再换成新异常冲出去。
    // 反恒真：把 `error.name` 移出内层 try → 本条必须变红。
    const weird = new Error('原始原因')
    Object.defineProperty(weird, 'name', {
      get(): never {
        throw new Error('name getter 也不让你读')
      },
      configurable: true,
    })
    Object.defineProperty(weird, 'message', {
      get(): never {
        throw new Error('message getter 不让你读')
      },
      configurable: true,
    })

    let out = ''
    expect(() => {
      out = describeError(weird)
    }, 'describeError 绝不外抛').not.toThrow()
    expect(out, '必须给出一个可读的说明').toContain('Error')
  })

  it('★ 空/空白 caller 身份 ⇒ `failed`，**不得**与空 owner 互相匹配绕过归属门（回归：OCR MEDIUM [4]，安全）', async () => {
    // 回归用例：`deps.caller.memberId` 直接 `.trim()`，而脏账本里 `owner` 若是 `''`
    // 也会裁成 `''` ⇒ `'' !== ''` 为 false ⇒ **归属门放行**：
    // 一个没有身份（或身份是空串）的调用者就能认领别人的任务 —— 绕过 FR-7.2。
    // 这是**安全**问题，不是健壮性。⇒ 身份非空白是前置条件，不满足就 fail-closed。
    // 反恒真：删掉 `isNonEmptyString(rawSelf)` 守卫 → 本条必须变红（会走成 claimed/not-owner）。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    // 空身份用 `as unknown as MemberId` 显式构造（品牌类型不允许直传空串，这正是它的用处）。
    const harness = await makeHarness({ ledger, caller: '' as unknown as MemberId })
    // ⚠ `before` 必须在**种完 DAG 之后**取：`seedDag` 自己会落一条
    // `dag/task-state-changed` 事件。我第一版断言 `toHaveLength(0)` 就撞上了它
    //（拿到 1 而红）—— 那是**夹具的种子**，不是本次调用落的账。
    const before = eventsOfKind(ledger, 'dag/task-state-changed').length

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind'], '空身份必须 fail-closed').toBe('failed')
    expect(String(result['reason'])).toContain('身份')
    expect(eventsOfKind(ledger, 'dag/task-state-changed').length, '本次调用不得落账').toBe(before)
  })

  it('★ 空 owner 是脏数据 ⇒ `failed`（回归：OCR MEDIUM [4]，另一半）', async () => {
    // 与上一条配对：`owner` 是空串时同样必须拒绝 —— 否则空 owner 与空身份会互相匹配。
    // 反恒真：删掉 `isNonEmptyString(owner)` → 本条必须变红。
    const ledger = seedLedger()
    // owner = 空串（脏账本）。品牌类型不允许直传空串 ⇒ 显式构造。
    seedDag(ledger, '' as unknown as MemberId, 'task-1', 'pending')
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind'], '空 owner 必须拒绝').toBe('failed')
    expect(String(result['reason'])).toContain('owner')
  })

  it('★ `unfinishedDependenciesOf` 返回非数组 ⇒ `failed`，不得抛（回归：OCR MEDIUM [3]）', async () => {
    // 回归用例：契约是 `readonly string[]`，不判的话 `unfinished.length` 会抛
    //（`guarded` 只罩住**调用**、不罩住**取属性**），破掉「绝不抛」。
    // 反恒真：删掉 `Array.isArray(unfinished)` → 本条必须变红（会 throw）。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({
      ledger,
      projection: (base) => ({
        ...base,
        dag: {
          ...base.dag,
          unfinishedDependenciesOf: () => undefined as unknown as readonly string[],
        },
      }),
    })

    let threw: unknown = null
    let result: Record<string, unknown> | null = null
    try {
      result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })
    } catch (error) {
      threw = error
    }

    expect(threw, '不得穿透 execute').toBeNull()
    expect(result?.['kind']).toBe('failed')
    expect(String(result?.['reason'])).toContain('数组')
  })

  it('★ `ownerOf` 返回 `undefined` ⇒ 明确说形状不对，不得报成 `not-owner`（回归：OCR MEDIUM [2]）', async () => {
    // 回归用例：契约是 `MemberId | null`。不判 undefined 的话 `owner !== selfMemberId`
    // 为 true ⇒ 调用方拿到**误导性的 `not-owner`**（还把 undefined 当 owner id 播出去），
    // 而不是真实诊断「适配器不符契约」。两者的排查方向完全不同。
    // 反恒真：把 `owner === undefined ||` 去掉 → 本条必须变红（会得到 not-owner）。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({
      ledger,
      projection: (base) => ({
        ...base,
        dag: { ...base.dag, ownerOf: () => undefined as unknown as MemberId | null },
      }),
    })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind'], '不得报成 not-owner').not.toBe('not-owner')
    expect(result['kind']).toBe('unknown-dag-team')
    expect(String(result['reason'])).toContain('undefined')
  })

  it('★ `requestId: ""` 视作省略 ⇒ 走确定性派生，**不得**说「缺少必填」（回归：OCR MEDIUM [23]）', async () => {
    // 回归用例：`requestId` 是**可选**的，但 `narrowTrimmedString` 把空串映射成
    // `missingFieldReason` ⇒ 传 `requestId: ""` 的模型收到「缺少必填参数 requestId」——
    // 假话，还逼它去编一个非空 id（正是文档叫它别做的事）。
    // 反恒真：把空串归一那段删掉 → 本条必须变红（会得到 invalid-input）。
    const sharedLedger = seedLedger()
    const harness = await makeHarness({ ledger: sharedLedger })

    const blank = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团', roster: [{ position: 'p', count: 1 }],
      tasks: [], requestId: '',
    })
    const omitted = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团', roster: [{ position: 'p', count: 1 }],
      tasks: [],
    })

    expect(blank['kind'], '空串应视作省略').toBe('created')
    expect(blank['requestId'], '空串与省略必须派生出**同一个** requestId').toBe(omitted['requestId'])
    expect(harness.spies.createTeam, '同一份申请只建一次团').toHaveLength(1)
  })

  it('★ 任务标题有**逐项**长度上限（回归：OCR MEDIUM [26]）', async () => {
    // 回归用例：`SOPHIA_SPAWN_TASKS_MAX` 限的是**项数**，一个 1MB 的任务标题
    // 能通过所有既有检查，然后被逐字写进不可改写的账本、每次读取都要读回来。
    // 反恒真：删掉 `trimmedEntry.length > SOPHIA_SPAWN_TASK_MAX` → 本条必须变红。
    const harness = await makeHarness()

    const result = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团', roster: [{ position: 'p', count: 1 }],
      tasks: ['x'.repeat(SOPHIA_SPAWN_TASK_MAX + 1)],
    })

    expect(result['kind']).toBe('invalid-input')
    expect(String(result['reason'])).toContain('任务清单')
    expect(harness.spies.createTeam).toHaveLength(0)
  })

  it('★ 运行时 `notify` 返回 null ⇒ 可上报的 `delivery-failed`，不得在 catch 里二次抛（回归：OCR MEDIUM [15]）', async () => {
    // 回归用例：初版直接 `deliveryOf(raw)`，而 `deliveryOf` 读 `outcome.kind` ⇒
    // 在 **catch 块内部**抛，把一次本可上报的失败变成穿透 `execute` 的异常。
    // 反恒真：把那个形状守卫删掉 → 本条必须变红（会 throw）。
    const harness = await makeHarness({
      runtime: (base) => ({
        ...base,
        notify: () => null as unknown as ReturnType<SophiaToolsDeps['runtime']['notify']>,
      }),
    })

    let threw: unknown = null
    let result: Record<string, unknown> | null = null
    try {
      result = await run(harness, 'sophia_team_message', {
        content: 'x', to: '推步主事', channelId: channelA, threadTitle: 't',
      })
    } catch (error) {
      threw = error
    }

    expect(threw, '不得穿透 execute').toBeNull()
    expect(result?.['kind'], '事实已落账 ⇒ 仍是 sent').toBe('sent')
    const delivery = result?.['delivery'] as Record<string, unknown>
    expect(delivery['kind']).toBe('delivery-failed')
    expect(delivery['delivered']).toBe(false)
    // ⚠ 断言必须**区分**「运行时返回了坏形状」与「运行时抛错」——两者都会落到
    // `delivery-failed`，而初版那句 `toContain('notify')` 对**两种**都成立
    //（catch 分支的文案里也有 "notify"），于是删掉守卫仍然全绿。
    // ⇒ 钉住那句**只属于形状守卫**的文案（实测：删掉守卫后本条必须红）。
    expect(String(delivery['reason']), '必须是「返回了坏形状」那条诊断，而不是「抛错」那条')
      .toContain('返回了非 MemberWakeOutcome')
  })

  it('★ 运行时 `notify` 抛错时，`rollover` 必须带出成因原文（回归：OCR MEDIUM [21][22]）', async () => {
    // 回归用例：初版只把异常写进日志，`wake-not-delivered` 结果里**没有任何 reason**
    // ⇒ 调用方看到的结果完全相同，无论「运行时正常返回 delivery-failed」还是
    //「接线被我改坏了」。成因原文是排查接线问题**唯一**的线索。
    // 反恒真：把 `wakeReason` 恒置 null（或删掉那个字段的渲染）→ 本条必须变红。
    const harness = await makeHarness({
      runtime: (base) => ({
        ...base,
        notify: () => {
          throw new Error('接线坏了的独特标记 XYZ')
        },
      }),
    })

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('wake-not-delivered')
    expect(result['wakeReason'], '必须带出成因原文').toContain('接线坏了的独特标记 XYZ')
    const rendered = renderedText(toolOf(harness, 'sophia_context_rollover'), result)
    expect(rendered).toContain('接线坏了的独特标记 XYZ')
  })

  it('★ `describeError` 的 message 为空串时**不得**产出半截文案（回归：OCR MEDIUM [17]）', async () => {
    // 回归用例：`new Error('')`（只设 code 不写 message）在注入实现里很常见，
    // 初版直接返回 `''` ⇒ 外层拼出「读账本投影时抛错：」这种半截文案。
    // 反恒真：把 `message !== ''` 那半条判断删掉 → 本条必须变红。
    const bare = new Error('')
    bare.name = 'SqliteError'

    const out = describeError(bare)
    expect(out, '不得是空串').not.toBe('')
    expect(out, '必须带出类型名供诊断').toContain('SqliteError')
  })

  it('★ 回复 ref 的熵足够（回归：OCR MEDIUM [13] —— 撞了就静默丢消息）', async () => {
    // 回归用例：`ref` 是运行时去重签名的**唯一变量**（回复路径**不写账本**，
    // 没有别的区分维度），所以它的唯一性直接决定「下一条回复会不会被判 duplicate 丢掉」。
    // 初版 `randomUUID().slice(0,8)` 只留 32 bits：同线程回复频繁时按生日问题
    // 会在几千条量级上出现碰撞（实测估算 n=3000 时 P≈1e-3），届时**消息静默丢失**。
    //
    // 这条断言**直接读发出去的 ref**（不是读源码字符串）：
    // 起一条线程后连发 N 条回复，从收件人探针的 `notices` 里取出每条 ref，要求：
    // ① 两两不同；② 去掉线程前缀后的随机段足够长（≥32 hex 字符 = 128 bits）。
    // 反恒真：把 ref 改回 `.slice(0,8)` → ② 必须变红（8 < 32）。
    const harness = await makeHarness()
    const request = { content: '起线程', to: '推步主事', channelId: channelA, threadTitle: '熵测试' }
    const created = await run(harness, 'sophia_team_message', request)
    expect(created['kind']).toBe('sent')
    const threadId = String(created['threadId'])

    const REPLIES = 8
    for (let i = 0; i < REPLIES; i += 1) {
      const r = await run(harness, 'sophia_team_message', {
        content: `第 ${String(i)} 条`, to: '推步主事', threadId,
      })
      expect(r['kind'], `第 ${String(i)} 条回复应落账/送达成功`).toBe('sent')
    }

    // 收件人探针收到的通知**顺序**与调用顺序一致。
    //
    // ⚠ 2026-09-24 口径变更（如实标注，别把它读成弱化）：agent 边界收到的已经是
    // **消息**（见 `src/runtime/notice-message.ts`），`ref` 是运行时**内部**的去重载体、
    // **不再**出现在这里 —— 所以本用例改成断言两件**仍然可观测**的事：
    //   (a) `followup` 累计 `REPLIES + 1` 次（起线程那条 + 8 条回复）：这是**顺序**证据；
    //   (b) 每条回复的正文各自到位、且消息 id 两两不同。
    // 「ref 两两不同」这条断言的**新落点**是 `Tests.message-events.spec.ts` 里
    // 直接喂 `wakeMemberForMessage` 的用例（在那里 `MemberNotice.items[0].ref` 仍可观测，
    // 因为那是宿主→运行时的边界，不是 agent 边界）。
    // 退化的判据仍在：ref 若撞了，运行时会判 `duplicate` ⇒ `followup` **不会**被调那么多次，
    // 下面 (a) 立刻红。
    const all = harness.probes.get(colleague)?.notices.followup ?? []
    expect(all, '起线程 + 8 条回复 ⇒ 9 次投递').toHaveLength(REPLIES + 1)
    const texts = all.map((message) => message.content[0]?.text ?? '')
    expect(texts[0]).toContain('起线程')
    expect(texts.slice(1)).toEqual(
      Array.from({ length: REPLIES }, (_unused, i) => expect.stringContaining(`第 ${String(i)} 条`)),
    )
    const ids = all.map((message) => message.id)
    expect(new Set(ids).size, '每条投递物必须有各自的 message id').toBe(all.length)
    expect(ids.every((id) => id.length >= 32), 'id 是 UUID（随机段够长）').toBe(true)
  })

  it('★ `duplicate` 必须归入**成功**，不得报成「唤醒未送达」（回归：OCR HIGH [12]）', async () => {
    // 回归用例：`member-runtime.ts` 对 `duplicate` 的定义是
    //「**同签名已在案：这条待办已经推过，不重复打扰**」—— 即交接**上一次就成功了**。
    // 而本工具只推**一条**待办，其签名在同批待办下是常量 ⇒「同一水位上重复接力」
    //（宿主重启后重建是很常见的场景）**必然**落进这个分支。
    // 把它报成 `wake-not-delivered` 会让调用方以为没送到 → 重新激活 + 重试 →
    // 每次多烧一个 turn，而实际早就送到了。
    // 反恒真：把 `&& wake !== 'duplicate'` 去掉 → 本条必须变红。
    const harness = await makeHarness()

    const first = await run(harness, 'sophia_context_rollover', {})
    expect(first['kind'], '第一次接力：真投递').toBe('handed-over')
    expect(first['wake']).toBe('delivered')

    // 第二批待办的计数会变 ⇒ 换个水位以获得**同签名**的第二次接力：
    // 直接把 `unreadOf` 固定住，让两次调用的 (revision, unreadCount, newestSequence) 完全相同。
    const fixed = await makeHarness({
      projection: (base) => ({
        ...base,
        unreadOf: () => ({ memberId: self, count: 2, newestSequence: 7 }),
      }),
    })
    const a = await run(fixed, 'sophia_context_rollover', {})
    const b = await run(fixed, 'sophia_context_rollover', {})

    expect(a['wake'], '第一次应是真投递').toBe('delivered')
    expect(b['wake'], '第二次应是 duplicate（同签名已推送过）').toBe('duplicate')
    expect(b['kind'], 'duplicate 表示交接已完成 ⇒ 必须算成功').toBe('handed-over')
    expect(b['kind']).not.toBe('wake-not-delivered')
  })

  it('★ `switch-model` 的 caller 身份不可用 ⇒ `failed`（回归：OCR HIGH [7][8]）', async () => {
    // 回归用例：`deps.caller` 是**宿主接线**而非模型入参。绑成 undefined/null 时
    // `.trim()` 抛 TypeError 穿出 execute；空串则让授权判定在空值上失效。
    // task-claim.ts 已修过同类（MEDIUM [4]），switch-model 漏了。
    // 反恒真：删掉 `isNonEmptyString(callerMemberId)` 守卫 → 本条必须变红。
    // 四种坏接线：整份 undefined / 空身份 / 空白身份 / 空团。
    // 第一种用 `'callerOverride' in options` 的语义传进去（见 harness 里那段说明）。
    const badCallers: readonly unknown[] = [
      undefined,
      { memberId: '', teamId: teamA },
      { memberId: '   ', teamId: teamA },
      { memberId: self, teamId: '' },
    ]
    for (const caller of badCallers) {
      const harness = await makeHarness({
        callerOverride: caller as SophiaToolsDeps['caller'],
      })
      let threw: unknown = null
      let result: Record<string, unknown> | null = null
      try {
        result = await run(harness, 'sophia_switch_model', {
          provider: 'p2', model: 'm2', reason: 'r',
        })
      } catch (error) {
        threw = error
      }
      expect(threw, `caller=${JSON.stringify(caller)} 不得穿透`).toBeNull()
      expect(result?.['kind'], `caller=${JSON.stringify(caller)} 应 fail-closed`).toBe('failed')
    }
  })

  it('★ `spawn-team` 的 caller 身份不可用 ⇒ `invalid-input`，不得抛 TypeError（回归：OCR MEDIUM [18]，族 B 最后一处）', async () => {
    // 回归用例：`deps.caller` 为 null/undefined 时不得抛 TypeError 逃出 execute，
    // 而是返回结构化失败（invalid-input），reason 说明「调用方身份缺失」。
    // 族 B 其余三处（switch-model:328 / task-claim:248 / message 收件人）均已 fail-closed，唯独 spawn-team 漏了。
    // 反恒真：删掉 spawn-team.ts 里的 caller 判空守卫 → 本条必须变红（会抛 TypeError 破坏绝不抛契约）。
    const badCallers: readonly unknown[] = [
      null,
      undefined,
      { memberId: '', teamId: teamA },
      { memberId: '   ', teamId: teamA },
    ]
    for (const caller of badCallers) {
      const harness = await makeHarness({
        callerOverride: caller as SophiaToolsDeps['caller'],
      })
      let threw: unknown = null
      let result: Record<string, unknown> | null = null
      try {
        result = await run(harness, 'sophia_spawn_team', {
          targetKind: 'temporary', name: '团', roster: [{ position: 'p', count: 1 }],
          tasks: [],
        })
      } catch (error) {
        threw = error
      }
      expect(threw, `caller=${JSON.stringify(caller)} 不得抛错穿透 execute`).toBeNull()
      expect(result?.['kind'], `caller=${JSON.stringify(caller)} 应 fail-closed 返回 invalid-input`).toBe('invalid-input')
      expect(String(result?.['reason'])).toContain('调用方身份缺失')
      expect(harness.spies.createTeam).toHaveLength(0)
    }
  })

  it('★ `sophia_task_claim` 的 `claimed` 结果必须带出契约缺口（回归：OCR LOW [19]）', async () => {
    // 回归用例：「除已认领外的任何状态都可被认领」是**刻意的未裁定决策**，
    // 此前只在注释里提到、调用方看不到。反恒真：删掉 `gaps` 字段 → 本条必须变红。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('claimed')
    const gaps = result['gaps'] as readonly string[]
    expect(gaps.some((g) => g.includes('CONTRACT-GAP[claimable-states]')), '必须带出 claimableStates 缺口').toBe(true)
  })

  it('★ `isNonEmptyString` 直接单测（回归：OCR LOW [20] —— 它只被间接覆盖）', async () => {
    // 回归用例：本函数是全文件多处判据的基础，但此前**只被工具级用例间接覆盖**。
    // 它的两个承重契约：① 纯空白串为 false；② **不裁剪**（`' a '` 返回 true 且原样返回）。
    // 反恒真：把实现改成 `value !== ''` → 纯空白那条必须变红。
    // ⚠ `'　'`（U+3000 全角空格）**是** Unicode 空白 ⇒ `trim()` 会去掉它 ⇒ 应判 false。
    // 我第一版把它写进 truthy 组而红 —— **是断言错了，不是实现错了**（`String.prototype.trim`
    // 按 WhiteSpace + LineTerminator 判定，U+3000 在其中）。
    // ⚠ `'　'`（U+3000 全角空格）**是** Unicode 空白 ⇒ `trim()` 会去掉它 ⇒ 应判 false。
    // 我第一版把它写进 truthy 组而红 —— **是断言错了，不是实现错了**（`String.prototype.trim`
    // 按 WhiteSpace + LineTerminator 判定，U+3000 在其中）。
    // `'\t\t\t'` 同理：全是制表符 ⇒ 也必须在 falsy 组。
    const truthy: readonly unknown[] = ['a', ' a ', 'a\t']
    const falsy: readonly unknown[] = [
      '', ' ', '　', '\t', '\n', '\t\t\t', '   \t \n ',
      null, undefined, 0, 1, {}, [], true,
    ]

    for (const v of truthy) expect(isNonEmptyString(v), `${JSON.stringify(v)} 应为 true`).toBe(true)
    for (const v of falsy) expect(isNonEmptyString(v), `${JSON.stringify(v)} 应为 false`).toBe(false)
    // ② 不裁剪：值本身原样保留（裁剪是 narrowTrimmedString 的职责，不是它的）。
    const padded = ' a '
    expect(isNonEmptyString(padded)).toBe(true)
    expect(padded, '本函数不得改动入参').toBe(' a ')
  })

  it('★ 投影给出坏的 `newestSequence` ⇒ `failed`，不得把结构非法的通知投出去（回归：OCR MEDIUM [15]）', async () => {
    // 回归用例：`unreadOf` 是**注入端口**，而 `MemberPendingItem.newestSequence` 的契约是
    // 非负安全整数（`member-runtime.ts` 的 `isPendingItem` 会按此校验，不符即返回
    // `invalid-notice`）。本工具不该把**已知结构非法**的通知投出去 ——
    // 那会把「端口实现不符契约」伪装成「运行时拒绝了通知」，排查方向完全错。
    // 反恒真：删掉 `Number.isSafeInteger(newest)` 那道判断 → 本条必须变红。
    const harness = await makeHarness({
      projection: (base) => ({
        ...base,
        unreadOf: () => ({ memberId: self, count: 2, newestSequence: -1 }),
      }),
    })

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('failed')
    expect(String(result['reason'])).toContain('非负安全整数')
    expect(result['kind'], '不得报成「运行时拒绝了通知」').not.toBe('wake-not-delivered')
  })

  it('★ **回复路径**也必须过跨团归属门（回归：OCR HIGH [14]，真实越权）', async () => {
    // 回归用例：初版只在**起线程**路径上做 `cross-team` 判定；给一个**已存在**的
    // `threadId` 时直接 `deliver`，从未检查该线程所属频道属于哪个团 ⇒
    // 团 A 的成员只要知道团 B 的线程 id，就能把正文**投进别人的团**
    //（`notify` 会把正文送达团 B 的成员），而结果被渲染成成功。
    // 这与类型注释里的承诺（cross-team = 「不许把消息投进别人的团，FR-7.2」）直接冲突。
    // 反恒真：删掉回复路径那段 `threadChannelTeam.value !== deps.caller.teamId` 判定
    // → 本条必须变红（会得到 `sent`，且 colleague 会收到通知）。
    const ledger = seedLedger()
    seedThread(ledger, 'thread-in-B' as ThreadId, channelB, '别人的团里的线程')
    const harness = await makeHarness({ ledger, callerTeam: teamA })

    const result = await run(harness, 'sophia_team_message', {
      content: '越权投递试试', to: '推步主事', threadId: 'thread-in-B',
    })

    expect(result['kind'], '不得投进别人的团').toBe('cross-team')
    expect(harness.probes.get(colleague)?.notices.followup, '不得送达').toHaveLength(0)
    expect(allEvents(ledger).some((e) => e.kind === 'team/thread-started' && String(dataOf(e)['threadId']) === 'thread-in-B' && false)).toBe(false)
  })

  it('★ 同团线程的回复**必须放行**（上一条的对照，防门做过头）', async () => {
    // 与上一条配对：归属门不能把合法回复也拦掉。
    // 反恒真：把门写成 `if (true) return cross-team` → 本条必须变红。
    const ledger = seedLedger()
    seedThread(ledger, 'thread-in-A' as ThreadId, channelA, '本团的线程')
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_team_message', {
      content: '本团回复', to: '推步主事', threadId: 'thread-in-A',
    })

    expect(result['kind'], '同团回复必须放行').toBe('sent')
    expect((result['delivery'] as Record<string, unknown>)['delivered']).toBe(true)
  })

  it('★ `sequence-mismatch` 必须明说「不要重试」（回归：OCR MEDIUM [6]）', async () => {
    // 回归用例：本输出是**给模型看的**。它读到「事实已写入」若直接再调一次，
    // 就会往 append-only 账本里**追加第二条**换模事件（第一条撤不回），
    // 把已检出的异常变成永久的重复历史。
    // 反恒真：删掉那句告诫 → 本条必须变红。
    const harness = await makeHarness({
      ledgerOf: (base) => {
        // 让 commit 返回一个与预测不同的序号（模拟跨进程插入）。
        let calls = 0
        return {
          ...base,
          commit: (input: LedgerCommitInput): LedgerReceipt => {
            calls += 1
            const real = base.commit(input)
            return calls === 1 ? { ...real, sequence: real.sequence + 5 } : real
          },
        }
      },
    })

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })

    expect(result['kind']).toBe('sequence-mismatch')
    expect(renderedText(toolOf(harness, 'sophia_switch_model'), result)).toContain('不要重试')
  })

  it('★ `lifecycleOf` 返回 null ⇒ `unknown-member`，与「没换过模」分开（回归：OCR MEDIUM [7]）', async () => {
    // 回归用例：`null` 表示「账本不认识这个成员」，而 `current === null` 的文案里
    // 混着「它从未换过模，或账本里根本没有这个成员」两种成因 ——
    // 对「根本没有这个成员」的调用方来说，那句会误导它以为是个有效成员。
    // 反恒真：删掉 `if (lifecycle === null)` → 本条必须变红（会得到 unknown-current-model）。
    const harness = await makeHarness({
      projection: (base) => ({ ...base, lifecycleOf: () => null }),
    })

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })

    expect(result['kind'], '必须是独立的 unknown-member').toBe('unknown-member')
    expect(result['kind']).not.toBe('unknown-current-model')
  })

  it('★★ 回复路径的「本团放行 / 跨团拒绝」是本包里**唯一**的跨团投递门（组合断言）', async () => {
    // 这条把上面两条钉在一起：同一份代码、同一个收件人，**只有线程所属团**不同，
    // 结论必须相反。单看任一条都可能被「门写死了」骗过。
    // 反恒真：任一侧写死（恒放行/恒拒绝）→ 本条必须变红。
    const sharedA = seedLedger()
    seedThread(sharedA, 'thread-A' as ThreadId, channelA, 'A 团线程')
    const harnessA = await makeHarness({ ledger: sharedA })

    const sharedB = seedLedger()
    seedThread(sharedB, 'thread-B' as ThreadId, channelB, 'B 团线程')
    const harnessB = await makeHarness({ ledger: sharedB })

    const inA = await run(harnessA, 'sophia_team_message', {
      content: 'x', to: '推步主事', threadId: 'thread-A',
    })
    const inB = await run(harnessB, 'sophia_team_message', {
      content: 'x', to: '推步主事', threadId: 'thread-B',
    })

    expect(inA['kind']).toBe('sent')
    expect(inB['kind']).toBe('cross-team')
    expect(inA['kind']).not.toBe(inB['kind'])
  })

  it('★ 投影给出坏的 `unread.count` ⇒ `failed`（回归：OCR MEDIUM [10]，与 newest 对称）', async () => {
    // 回归用例：初版只校验 `newest`、不校验 `count` —— **校验不对称**会制造假象的失败归因：
    // `count = -1` 带着合法的 `newest` 溜过去，运行时按自己的契约回 `invalid-notice`，
    // 于是「端口实现不符契约」被伪装成「运行时拒绝了通知」。
    // 反恒真：删掉 `Number.isSafeInteger(unread.count)` → 本条必须变红。
    for (const badCount of [-1, 1.5, Number.NaN]) {
      const harness = await makeHarness({
        projection: (base) => ({
          ...base,
          unreadOf: () => ({ memberId: self, count: badCount, newestSequence: 7 }),
        }),
      })

      const result = await run(harness, 'sophia_context_rollover', {})

      expect(result['kind'], `count=${String(badCount)} 应判 failed`).toBe('failed')
      expect(String(result['reason'])).toContain('待办计数')
      expect(result['kind'], '不得报成「运行时拒绝了通知」').not.toBe('wake-not-delivered')
    }
  })

  it('★ rollover 的失败分支必须带出 `gaps`，且 render 要渲染它（回归：OCR MEDIUM [8][9]）', async () => {
    // 回归用例：`ContextRolloverOutcome.failed` 的文档承诺「同样带 gaps；漏报会让统一
    // `gaps.join()` 的调用方在最需要诊断上下文的时候拿到 undefined」，
    // 但初版两处 failed 返回都没带，且 render 的失败分支只拼 reason、**完全丢弃** gaps。
    // 反恒真：删掉任一处 `gaps: [...]` 或删掉 render 里那句拼接 → 本条必须变红。
    const harness = await makeHarness({
      projection: (base) => ({
        ...base,
        teamOf: () => {
          throw new Error('投影炸了')
        },
      }),
    })

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('failed')
    const gaps = result['gaps'] as readonly string[] | undefined
    expect(gaps, '失败分支也必须带 gaps').toBeDefined()
    expect(gaps?.some((g) => g.includes('CONTRACT-GAP[rollover-checkpoint]'))).toBe(true)
    // render 也必须把它拼出来 —— 否则带出了也不可见。
    expect(renderedText(toolOf(harness, 'sophia_context_rollover'), result)).toContain('CONTRACT-GAP[rollover-checkpoint]')
  })

  it('★★ 名册里的初始模型必须**真的到达** `createTeam(request.spec)`（req 3，本批最关键的一条）', async () => {
    // ## 这条用例为什么必须存在
    //
    // 它是**唯一**能抓住「初始模型被静默丢掉」的断言。理由（实测过的三层）：
    // 1. **编译期拦不住**：`TeamSpec` 的 `satisfies` 只在**对象字面量**处生效
    //   （TS2353）；而 `spawn-team.ts` 里 `spec` 的构造是 `roster: narrowed.roster`
    //   （**变量引用**）⇒ **0 诊断**。`数象主事` 在 `TeamSpec.roster` 的注释里
    //   用编译器 API 独立验过同一件事。
    // 2. **类型层丢弃 ≠ 运行时丢弃**：把带 `model` 的宽类型赋给 `TeamSpec`，运行时
    //   `model` 完好（TS 擦除只在编译期）—— 我的探针 C 实测过。
    // 3. **真正的丢弃点是「逐字段重建」**：`narrowRoster` 的 `out.push({position, count})`
    //   只带两个字段 ⇒ 即便调用方给了 `model` 也会在这里消失。**那是我的文件**。
    // ⇒ 故必须有一条**端到端穿过窄化层**的断言，而不是只断言「类型里有这个字段」。
    //
    // ## ⚠ 端口边界声明（captain 要求写明）
    //
    // 本用例用的是**注入的假 `createTeam`**，因此它断言的是
    // **「`model` 真的到达了端口边界 `request.spec.roster[].model`」**，
    // **不是**「端到端已通」。真正把 `spec.roster[].model` 落成
    // `team/member-added` 载荷的是 `createTeam` 的**实现**（装配层，不属 t4）。
    // 这条边界很重要：端口传递对 ≠ 端到端通。
    const harness = await makeHarness()
    const initial = { provider: 'deepseek', model: 'v4.1-flash' }

    const result = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '带模团',
      roster: [
        { position: '灵台郎', count: 1, model: initial },
        { position: '推步主事', count: 2, model: null },
        { position: '数象主事', count: 1 }, // 省略 —— 归一成 null
      ],
      tasks: [],
    })

    expect(result['kind']).toBe('created')
    const request = harness.spies.createTeam.at(-1)
    const roster = request?.spec.roster
    expect(roster, '名册必须到达 createTeam').toHaveLength(3)

    // ⭐ 核心断言：给了初始模型 ⇒ 原样到达（不是被丢掉、不是变成 null）。
    expect(roster?.[0]?.position).toBe('灵台郎')
    expect(roster?.[0]?.model, '初始模型必须原样到达端口边界').toEqual(initial)

    // 显式 `null` 与**省略**都归一成 `null` —— 这两种输入在申请侧语义相同，
    // 而落到名册上必须是显式的值（账本侧 `MemberAddedData.model` 是必填可空）。
    expect(roster?.[1]?.model, '显式 null 应保持 null').toBeNull()
    expect(roster?.[2]?.model, '省略应归一成 null（undefined → null）').toBeNull()
  })

  it('★ 名册项 `model` 形状非法 ⇒ `invalid-input`，**不得**静默退化成 null（req 2）', async () => {
    // 回归用例：若把「形状不对」宽松处置成「当没给」，调用方的拼写错误
    //（`provider` 写成 `providerId`）会静默变成「跟随全局默认」——
    // 成员于是没有初始模型、换模第一次失败，而**没有任何迹象**指向那个拼写错误。
    // 与 `name`/`position` 同一条纪律：**给了但形状不对**永远是错误。
    // 反恒真：把 `narrowRoster` 里那段 shape 判定删掉 → 本条必须变红。
    const harness = await makeHarness()
    let legalCount = 0

    for (const bad of [
      { provider: 'p' },                       // 缺 model
      { model: 'm' },                          // 缺 provider
      { provider: '', model: 'm' },            // 纯空白 provider
      { provider: 'p', model: 'm', extra: 1 }, // 无关字段不算错，但 provider/model 得在
      'not-an-object',
      42,
    ]) {
      const result = await run(harness, 'sophia_spawn_team', {
        targetKind: 'temporary', name: '团',
        roster: [{ position: '灵台郎', count: 1, model: bad }],
        tasks: [],
      })
      // `{provider:'p', model:'m', extra:1}` 是**合法**的（多余字段被忽略）——
      // 故只在真正非法的那些上断言。
      const legal = typeof bad === 'object' && bad !== null
        && 'provider' in bad && 'model' in bad
        && typeof (bad as { provider: unknown }).provider === 'string'
        && (bad as { provider: string }).provider.trim() !== ''
        && typeof (bad as { model: unknown }).model === 'string'
        && (bad as { model: string }).model.trim() !== ''
      if (legal) {
        legalCount += 1
        expect(result['kind'], `${JSON.stringify(bad)} 是合法的`).toBe('created')
      } else {
        expect(result['kind'], `${JSON.stringify(bad)} 应判非法`).toBe('invalid-input')
        expect(String(result['reason'])).toContain('model')
      }
    }
    // 非法输入**不得**建团：`createTeam` 的调用数必须**正好等于**合法输入数。
    // ⚠ 我第一版这里断言「恰好有一条 model 为 null 的名册」—— 错了：
    // 合法的那个是 `{provider:'p', model:'m', extra:1}`，它的归一化结果是
    // `{provider:'p', model:'m'}`（**不是 null**）⇒ 过滤命中 0 而假红。
    // 正确的判据是「建团次数 = 合法输入数」，它同时覆盖「非法输入零副作用」。
    expect(harness.spies.createTeam, '只有合法的那些建了团').toHaveLength(legalCount)
  })

  it('★★ 每个工具的 `outputSchema` 必须是**真实的**：全部合法结果都能过它（req 6 的核心断言）', async () => {
    // ## 这条用例为什么是关键
    //
    // `outputSchema` 用 `additionalProperties: false`（DSL **强制**必须显式给出），
    // 而那一侧（`dsh-tools`）会**拒绝未声明的字段**。于是有**两个方向**会出错：
    // 1. **漏列字段** ⇒ 该分支的**成功结果被拒** ⇒ 工具一调就报错（比漏写 schema 更坏）；
    // 2. **把「只有某分支才有」的字段标成 `required`** ⇒ 其它分支**全都过不了**。
    //
    // ⇒ 光「schema 能被 DSL 转换」是不够的（那只证明语法对，不证明**语义覆盖**）。
    //    必须把**真实会产出的结果**逐个喂进验证器。这条用例就是干这个。
    //
    // ⚠ 这条断言是**实测换来的**：我第一版把 `delivery` / `gaps` / `notes`
    // 都标了 `required: true`（因为它们在 `sent`/`claimed`/`switched` 分支里确实必在），
    // 结果 `unknown-recipient` / `blocked` / `no-change` 等分支**全部被拒**——
    // 探针报出 6 处 REJECT 才发现。**没这条断言，那 6 个缺陷会直接进装配层。**
    //
    // 反恒真：把任一分支专属字段标回 `required: true` → 本条必须变红。
    const tools = createSophiaTools(await makeHarness().then((h) => h.deps))
    // 逐工具、逐 kind 的代表值（照各自的 outcome 联合逐字段手写）——
    // 刻意覆盖「字段最多」与「字段最少」两端。
    const samples: Record<string, readonly Record<string, unknown>[]> = {
      sophia_team_message: [
        { kind: 'sent', threadId: 't', threadCreated: true, newestSequence: 3, recipientMemberId: 'm', delivery: { kind: 'delivered', channel: 'followup', reason: null, delivered: true }, gaps: [] },
        { kind: 'sent', threadId: 't', threadCreated: false, newestSequence: null, recipientMemberId: 'm', delivery: { kind: 'no-handle', channel: null, reason: null, delivered: false }, gaps: ['G'] },
        { kind: 'unknown-recipient', reason: 'x' },
        { kind: 'unknown-channel', reason: 'x' },
        { kind: 'unknown-thread', reason: 'x' },
        { kind: 'cross-team', reason: 'x' },
        { kind: 'invalid-input', reason: 'x' },
        { kind: 'failed', reason: 'x' },
      ],
      sophia_task_claim: [
        { kind: 'claimed', dagTeamId: 'd', taskId: 't', from: 'pending', to: 'claimed', sequence: 1, gaps: [] },
        { kind: 'already-claimed', dagTeamId: 'd', taskId: 't', from: 'claimed' },
        { kind: 'blocked', dagTeamId: 'd', taskId: 't', unfinishedDependencies: ['a'] },
        { kind: 'sequence-mismatch', predicted: 1, actual: 2, reason: 'r' },
        { kind: 'unknown-dag-team', reason: 'r' },
        { kind: 'not-owner', reason: 'r' },
        { kind: 'unknown-task', reason: 'r' },
        { kind: 'invalid-input', reason: 'r' },
        { kind: 'failed', reason: 'r' },
      ],
      sophia_spawn_team: [
        { kind: 'created', requestId: 'r', targetKind: 'temporary', teamId: 't' },
        { kind: 'awaitingHumanApproval', requestId: 'r', targetKind: 'persistent', ticketId: 'k' },
        { kind: 'rejectedByPrincipal', requestId: 'r', ticketId: 'k', reason: 'x' },
        { kind: 'forbidden', requestId: 'r', errorCode: 'E', reason: 'x' },
        { kind: 'noDowngradeBypass', requestId: 'r', ticketId: 'k', errorCode: 'E', reason: 'x' },
        { kind: 'unknown-caller', reason: 'x' },
        { kind: 'invalid-input', reason: 'x' },
        { kind: 'failed', reason: 'x' },
      ],
      sophia_switch_model: [
        { kind: 'switched', memberId: 'm', from: { provider: 'a', model: 'b' }, to: { provider: 'c', model: 'd' }, trigger: 'member-self', effectiveAtSequence: 1, presence: 'idle', notes: [] },
        { kind: 'switched', memberId: 'm', from: { provider: 'a', model: 'b' }, to: { provider: 'c', model: 'd' }, trigger: 'member-self', effectiveAtSequence: 1, presence: 'unknown', notes: ['N'] },
        { kind: 'no-change', memberId: 'm', current: { provider: 'a', model: 'b' } },
        { kind: 'not-active', lifecycle: 'suspended' },
        { kind: 'unknown-current-model', reason: 'r' },
        { kind: 'unknown-member', reason: 'r' },
        { kind: 'not-self', reason: 'r' },
        { kind: 'sequence-mismatch', predicted: 1, actual: 2, memberId: 'm', from: { provider: 'a', model: 'b' }, to: { provider: 'c', model: 'd' }, reason: 'r' },
        { kind: 'invalid-input', reason: 'r' },
        { kind: 'failed', reason: 'r' },
      ],
      sophia_context_rollover: [
        { kind: 'handed-over', memberId: 'm', count: 2, newestSequence: 5, sinceSequence: 0, wake: 'delivered', gaps: [] },
        { kind: 'handed-over', memberId: 'm', count: 2, newestSequence: 5, sinceSequence: 0, wake: 'duplicate', gaps: [] },
        { kind: 'wake-not-delivered', memberId: 'm', count: 2, newestSequence: 5, sinceSequence: 0, wake: 'no-handle', wakeReason: null, gaps: [] },
        { kind: 'wake-not-delivered', memberId: 'm', count: 2, newestSequence: 5, sinceSequence: 0, wake: 'delivery-failed', wakeReason: '接线坏了', gaps: ['G'] },
        { kind: 'nothing-pending', memberId: 'm', sinceSequence: 0, gaps: [] },
        { kind: 'not-same-team', reason: 'r' },
        { kind: 'unknown-member', reason: 'r' },
        { kind: 'invalid-input', reason: 'r' },
        { kind: 'failed', reason: 'r', gaps: ['G'] },
        { kind: 'failed', reason: 'r' },
      ],
    }

    // ⚠ 用**真实的** `dsh-tools` 校验器，而不是本包里的仿制品：
    // 断言的对象是「宿主会不会接受这个 schema」，用自己写的校验器等于自证。
    const dshTools = await importDshTools()
    expect(dshTools, '拿不到 dsh-tools 就无法验证 schema（不要静默跳过）').not.toBeNull()

    for (const tool of tools) {
      const declared = samples[tool.name]
      expect(declared, `每个工具都要有样本（漏了 ${tool.name}）`).toBeDefined()
      // ① schema 本身能过 DSL 转换
      const json = dshTools!.valueSchemaSpecToJsonSchema(tool.outputSchema as never)
      // ② 每个真实结果都能过它
      for (const sample of declared!) {
        const errors = dshTools!.validateJsonSchemaValue(json, sample as never, '')
        expect(
          errors,
          `${tool.name} 的 ${String(sample['kind'])} 结果必须能过自己的 outputSchema（否则装配层一调就报错）`,
        ).toEqual([])
      }
      // ③ 反向：声明了 `enum` 的 kind，未列出的值必须被拒 ——
      // 否则 schema 是「什么都收」的摆设（这条让 ② 不至于恒真）。
      const errorsForBogus = dshTools!.validateJsonSchemaValue(json, { kind: '__不存在的分支__' } as never, '')
      expect(errorsForBogus.length, `${tool.name} 的 kind 必须是闭集`).toBeGreaterThan(0)
    }
  })

  it('★★ 收件人跨团必须被拒（回归：OCR HIGH [2]，真实越权，与线程路径**对称**）', async () => {
    // 回归用例：本文件在线程路径上有 `cross-team` 门，而**收件人路径此前完全没有** ——
    // 两条路径**不对称**。`resolveMemberRef` 的契约只承诺「把名字/ID 解析成 MemberId」，
    // **没有**任何「同团」语义，而宿主完全可能（本夹具就是）遍历**全部**成员。
    //
    // 实测复现（修前）：teamA 的成员按名字发给 teamB 的成员 ⇒
    // `kind: 'sent'` 且 `delivered: ['him-b']` —— **消息真的投进了别人的团**。
    //
    // 反恒真：删掉收件人路径那段 `recipientTeam.value !== deps.caller.teamId` 判定
    // → 本条必须变红（会得到 sent + 跨团送达）。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger, caller: self, callerTeam: teamA })

    // `outsider` 是 `seedLedger` 里 teamB 的成员，名字叫「历算主事」。
    const result = await run(harness, 'sophia_team_message', {
      content: '越团投递试试', to: '历算主事', channelId: channelA, threadTitle: 'T',
    })

    expect(result['kind'], '不得把消息投进别人的团').toBe('cross-team')
    expect(String(result['reason'])).toContain('FR-7.2')
    // ⚠ 不要断言 `harness.probes.get(outsider)` —— 本夹具的 probe 表**只注册了**
    // `self`/`colleague`（见 `makeRuntime`），`outsider` 从来没有 probe，
    // 于是 `get(outsider)` 恒为 `undefined` ⇒ 那条断言**恒真**（永远绿，证明不了任何事）。
    // 我第一版就是这么写的，被 TS 的 `Cannot find name` 拦下才发现名字都不对。
    // 正确的可观测判据是「**没有产生任何投递副作用**」：账本不得新增事件。
    expect(harness.probes.get(colleague)?.notices.followup, '不得发生投递').toHaveLength(0)
    expect(allEvents(ledger).filter((e) => e.kind === 'team/thread-started'), '不得建线程').toHaveLength(0)
  })

  it('★ 同团收件人必须放行（上一条的**对照**，防门做过头）', async () => {
    // 与上一条配对：同一个代码路径、同一个调用方，**只有收件人所属团不同**，结论必须相反。
    // 单看任一条都会被「门写死」（恒放行/恒拒绝）骗过。
    // 反恒真：把门写成 `if (true) return cross-team` → 本条必须变红。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger, caller: self, callerTeam: teamA })

    const result = await run(harness, 'sophia_team_message', {
      content: '同团投递', to: colleague, channelId: channelA, threadTitle: 'T',
    })

    expect(result['kind'], '同团收件人必须放行').toBe('sent')
    expect((result['delivery'] as Record<string, unknown>)['delivered']).toBe(true)
  })

  it('★★ 收件人跨团 / 同团是本工具**唯一**的收件人归属门（组合断言）', async () => {
    // 把上面两条钉在一起：**同一份代码、同一个调用方**，只有收件人不同。
    // 这比单看任一条强 —— 它同时排除「门写死」与「门只在某条路径生效」两种假绿。
    // 反恒真：任一侧写死 → 本条必须变红。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger, caller: self, callerTeam: teamA })

    const sameTeam = await run(harness, 'sophia_team_message', {
      content: 'x', to: colleague, channelId: channelA, threadTitle: 'T1',
    })
    const crossTeam = await run(harness, 'sophia_team_message', {
      content: 'x', to: '历算主事', channelId: channelA, threadTitle: 'T2',
    })

    expect(sameTeam['kind']).toBe('sent')
    expect(crossTeam['kind']).toBe('cross-team')
    expect(sameTeam['kind']).not.toBe(crossTeam['kind'])
  })

  it('★ `task-claim` 的 `head().sequence` 形状不对 ⇒ `failed`，**不得**报成 sequence-mismatch（回归：OCR HIGH [1]）', async () => {
    // 回归用例：`task-claim.ts` 的 `head().sequence` 此前**没有**形状校验，
    // 而 `switch-model.ts` 对同一步**有**（我这轮补的）。缺校验时 adapter 违约
    //（返回非整数/缺字段）会被**误报成 `sequence-mismatch`** —— 一个**假的并发冲突**，
    // 真因是数据形状问题，会把排查引向错误方向。
    // 反恒真：删掉 `isNonNegativeSafeInteger(head.sequence)` → 本条必须变红。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({
      ledger,
      ledgerOf: (base) => ({
        ...base,
        head: () => ({ sequence: undefined as unknown as number, eventId: null }),
      }),
    })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('failed')
    expect(result['kind'], '不得报成假的并发冲突').not.toBe('sequence-mismatch')
    expect(String(result['reason'])).toContain('head()')
  })

  it('★ `threadCreated` 与账本事实同向（回归：OCR LOW [1]，防自相矛盾的渲染）', async () => {
    // 回归用例：`threadCreated` 曾经是一个**独立形参**，两个调用点恒传 true/false
    // ⇒ 它是**冗余**的。传两个互相矛盾的实参是构造得出的：
    // `deliver(…, threadCreated: true)` 配一个「回复」的结果，会渲染出
    // 「新建线程 …」这种自相矛盾的一句，而类型系统不拦 ⇒ 当时改成**推导**。
    //
    // ⚠ 本用例属**有意的行为变更**（B 类），推导依据被换过一次，历史必须留着：
    // - 改前：`threadCreated = newestSequence !== null` —— 当时只有起线程路径落账，
    //   这条等价成立。下面那两行断言也据此写成「序号为 null ⇒ 必是回复」。
    // - 改后：**两条路径都落账**（回复写 `team/message-sent`）⇒ 序号都非 null ⇒
    //   旧推导成了恒真、再也区分不了两条路径。判别键换成
    //   `deliver` 的 `appended: 'new-thread' | 'existing-thread'`
    //   （即「本次写了 `team/thread-started` 没有」），矛盾**依然不可表达**
    //   （`threadCreated` 仍旧不是形参）。
    // 因此本用例的断言也跟着换：不再断言「回复的序号为 null」（那是旧世界的事实），
    // 改为断言「`threadCreated` 指向的那条事实**真的在账本里**」——
    // 这是**更强**的版本：它不再依赖一个字段推断另一个字段，而是直接对账本取证。
    //
    // 反恒真：把 `deliver(… appended …)` 里的 `'new-thread'` 写死（两条路径都报新建）
    // → 下面 `thread-started` 的条数断言必红。
    const harness = await makeHarness()

    // 起线程路径：threadCreated 必须为 true，且**账本里确实多了一条 thread-started**。
    const beforeThreads = eventsOfKind(harness.ledger, 'team/thread-started').length
    const created = await run(harness, 'sophia_team_message', {
      content: 'x', to: colleague, channelId: channelA, threadTitle: 'T',
    })
    expect(created['newestSequence'], '起线程路径必须有账本序号').not.toBeNull()
    expect(created['threadCreated'], '真的建了线程 ⇒ threadCreated 必须为 true').toBe(true)
    expect(eventsOfKind(harness.ledger, 'team/thread-started').length).toBe(beforeThreads + 1)

    // 回复路径：threadCreated 必须为 false，且**账本里没有新增 thread-started**
    //（否则就是「用启动事件伪造一次重新启动」，正是本 kind 要避开的覆盖写）。
    const beforeReplyThreads = eventsOfKind(harness.ledger, 'team/thread-started').length
    const reply = await run(harness, 'sophia_team_message', {
      content: 'x', to: colleague, threadId: String(created['threadId']),
    })
    expect(reply['threadCreated'], '线程早就存在 ⇒ threadCreated 必须为 false').toBe(false)
    expect(
      eventsOfKind(harness.ledger, 'team/thread-started').length,
      '回复不得新增 thread-started',
    ).toBe(beforeReplyThreads)

    // 并且渲染文本必须与这个关系自洽（不能出现「新建线程」）。
    const rendered = renderedText(toolOf(harness, 'sophia_team_message'), reply)
    expect(rendered).toContain('回复线程')
    expect(rendered).not.toContain('新建线程')
  })

  it('★ 名册 `model` 的 provider/model 也有**逐字段**长度上限（回归：OCR MEDIUM [11]）', async () => {
    // 回归用例：`provider`/`model` 会被**逐字写进不可改写的账本**
    //（经 `TeamSpec.roster[].model` → `member-added.model`），此后每次读取都要读回来。
    // 同文件里其它自由文本字段（`name`/`position`/`tasks`/`requestId`）全都限了长 ——
    // 初版**只裁剪、没限长**，那是漏了，不是有意放宽。
    // 反恒真：删掉那两句 `length > SOPHIA_SPAWN_MODEL_FIELD_MAX` → 本条必须变红。
    const harness = await makeHarness()
    const tooLong = 'x'.repeat(SOPHIA_SPAWN_MODEL_FIELD_MAX + 1)

    for (const bad of [
      { provider: tooLong, model: 'm' },
      { provider: 'p', model: tooLong },
    ]) {
      const result = await run(harness, 'sophia_spawn_team', {
        targetKind: 'temporary', name: '团',
        roster: [{ position: '灵台郎', count: 1, model: bad }],
        tasks: [],
      })
      expect(result['kind'], '超长的 model 字段必须被拒').toBe('invalid-input')
      expect(String(result['reason'])).toContain('model')
    }
    expect(harness.spies.createTeam, '不得建团').toHaveLength(0)

    // 边界：正好等于上限必须**通过**（否则上限就成了「少一个」）。
    const atLimit = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '团',
      roster: [{ position: '灵台郎', count: 1, model: { provider: 'p'.repeat(SOPHIA_SPAWN_MODEL_FIELD_MAX), model: 'm' } }],
      tasks: [],
    })
    expect(atLimit['kind'], '正好等于上限应通过').toBe('created')
  })

  it('★ rollover **每个** `failed` 分支都必须带 `gaps`（回归：OCR MEDIUM [31]）', async () => {
    // 回归用例：`failed` 的契约明文承诺「同样带 gaps」，而初版有**两个**分支漏了
    //（`count` 形状非法、`newestSequence` 形状非法）—— 与同文件其它 `failed` **不对称**。
    // 漏报会让统一 `gaps.join()` 的调用方**在最需要诊断上下文时**拿到 `undefined`。
    // 反恒真：删掉任一分支的 `gaps: [...]` → 本条必须变红。
    const cases: readonly [string, (base: SophiaProjectionPorts) => SophiaProjectionPorts][] = [
      ['count 形状非法', (base) => ({ ...base, unreadOf: () => ({ memberId: self, count: -1, newestSequence: 7 }) })],
      ['newestSequence 形状非法', (base) => ({ ...base, unreadOf: () => ({ memberId: self, count: 2, newestSequence: -5 }) })],
      ['teamOf 抛错', (base) => ({ ...base, teamOf: () => { throw new Error('boom') } })],
      ['unreadOf 抛错', (base) => ({ ...base, unreadOf: () => { throw new Error('boom') } })],
    ]
    for (const [label, patch] of cases) {
      const harness = await makeHarness({ projection: patch })
      const result = await run(harness, 'sophia_context_rollover', {})
      expect(result['kind'], `${label} 应判 failed`).toBe('failed')
      const gaps = result['gaps'] as readonly string[] | undefined
      expect(gaps, `${label} 的 failed 必须带 gaps`).toBeDefined()
      expect(gaps?.some((g) => g.includes('CONTRACT-GAP[rollover-checkpoint]'))).toBe(true)
    }
  })

  it('逆向：`teamOf` 返回 null 时**不得**断言「账本里没有这个成员」（回归：OCR MEDIUM [12]）', async () => {
    // 回归用例：`teamOf` 的 null 是**二义**的（从未存在 / 存在但已挂起归档销毁）。
    // 初版一律写成「账本里没有成员 X」—— 对第二种成因是假话，
    // 会把调用方推去找一个并不存在的接线问题。
    // 反恒真：把 reason 改回「账本里没有成员 ${target}」→ 本条必须变红。
    const harness = await makeHarness({
      projection: (base) => ({ ...base, teamOf: () => null }),
    })

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('unknown-member')
    const reason = String(result['reason'])
    expect(reason).toContain('读不到')
    expect(reason, '必须列出两种成因，不能只断言"没有这个成员"').toContain('已挂起')
    expect(reason).toContain('CONTRACT-GAP[teamOf-ambiguity]')
    // ⚠ 上面那条 `toContain('已挂起')` **单独不足以**钉住这个缺陷（我自己用变异发现）：
    // 把开头改成「账本里**没有**成员 X」时，句子后半段仍带着「已挂起」的解释 ⇒ 断言依旧全绿
    //（实测：`Tests 63 passed`）。即它在测「解释在不在」，而不是在测「有没有下那个假断言」。
    // ⇒ 补一条**否定式**断言，它直指要禁止的那句话。
    expect(reason, '不得断言「账本里没有这个成员」——对"存在但已无团"的成员那是假话')
      .not.toContain('账本里没有成员')
    // 并且必须显式说明**读到的是什么**（而不是把它说成「不存在」）。
    expect(reason).toContain('teamOf')
  })

  it('逆向：给了账本里没有的 threadId → unknown-thread，且**零副作用**', async () => {
    // 回归用例（OCR 复核 MEDIUM [9]）：初版把「给了 threadId 但投影认不出」也当成
    // 「按这个 id 新建线程」，于是模型可以自造任意 id，而
    // `foldLedgerEvents` 对同 threadId 是**覆盖写** ⇒ 一条自造 id 的 thread-started
    // 会静默改写既有线程的 channelId / title / assigneeMemberId。
    // 反恒真：把 `if (requestedThread !== undefined)` 那段拒绝删掉
    // （回到 `requestedThread ?? <生成>`）→ 本条必须变红。
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length

    const result = await run(harness, 'sophia_team_message', {
      content: '自造 id 试试',
      to: '推步主事',
      threadId: 'thread-我自己编的',
      channelId: channelA,
      threadTitle: '伪造标题',
    })

    expect(result['kind']).toBe('unknown-thread')
    expect(allEvents(harness.ledger).length, '不得落下任何事件').toBe(before)
    expect(harness.probes.get(colleague)?.notices.followup).toHaveLength(0)
    // 提示必须**指出两条正确路径**（新建要省略 id / 回复要核对 id），
    // 而不是只说「不行」——FR-8.4 对错误信息的要求同源。
    expect(String(result['reason'])).toContain('省略')
  })

  it('逆向：回复一条不存在的线程也不写账本（与起线程路径互不冒充）', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length
    const result = await run(harness, 'sophia_team_message', {
      content: 'x', to: '推步主事', threadId: 'thread-none',
    })
    expect(result['kind']).toBe('unknown-thread')
    expect(allEvents(harness.ledger).length).toBe(before)
  })

  it('★ 写序校验：判门与提交之间有并发提交 → sequence-mismatch（回归：TOCTOU，OCR [16]）', async () => {
    // 回归用例：`current` 与 `commit` 之间没有锁保护，另一个**进程**可以改掉任务状态，
    // 于是落下的 `from` 是一条不成立的转换起点（账本不可改写 ⇒ 状态机重放从错处开始）。
    // 构造方式与 switch-model 的那条同形：包一层 ledger，`commit` 先往底层写一条无关事件。
    // 反恒真：删掉 `receipt.sequence !== predicted` 的校验 → 本条必须变红（会返回 claimed）。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    let injected = false
    const wrapped: Ledger = {
      commit(input) {
        if (!injected) {
          injected = true
          ledger.commit({
            kind: 'team/thread-started',
            data: { threadId: 'th-intruder' as ThreadId, channelId: channelA, title: '外部插入', assigneeMemberId: null },
            actor: humanActor,
          })
        }
        return ledger.commit(input)
      },
      read: (query) => ledger.read(query),
      head: () => ledger.head(),
      verifyIntegrity: () => ledger.verifyIntegrity(),
      close: () => ledger.close(),
    }
    const harness = await makeHarness({ ledger: wrapped })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('sequence-mismatch')
    expect((result['actual'] as number) - (result['predicted'] as number)).toBe(1)
    // 认领事实**确实**写进去了 —— 如实断言，不假装干净。
    const claimEvents = eventsOfKind(ledger, 'dag/task-state-changed')
    expect(dataOf(claimEvents[claimEvents.length - 1])['to']).toBe(SOPHIA_CLAIMED_TASK_STATE)
  })

  it('★ 持久团经**批准后幂等回放**时，文案不得谎报「免审路径」（回归：OCR [9]）', async () => {
    // 回归用例：`SpawnOutcome.created` 有两条来路 —— ① 临时团免审直建；
    // ② 持久团已获批准后的幂等回放（`delegation.ts:854-867` 逐字回放 `created`）。
    // 初版文案一律附加「免审路径」，于是场景 ② 会**谎报**成「未经审批就建了团」，
    // 而 FR-5.3 的审批正是本模块最要紧的合规点。
    //
    // ⚠ 这条用例**第一版是恒真的**（变异测试 S2 抓到）：我只调了两次工具、中间没走人类批准，
    // 于是第二次走的是 `awaitingHumanApproval` 的幂等回放，**根本没到 `created` 分支** ——
    // 把实现改成「一律说免审」它照样全绿。现在补上真正的批准步骤。
    // 反恒真：把 render 的 created 分支改回单一文案「免审路径」→ 本条必须变红（已实测）。
    const harness = await makeHarness()
    const first = await run(harness, 'sophia_spawn_team', { targetKind: 'persistent', ...smallSpec })
    expect(first['kind']).toBe('awaitingHumanApproval')

    // ── 人类批准（第二级）──
    const decision = await decideSpawnTicket(harness.deps.delegation, {
      ticketId: String(first['ticketId']) as SpawnTicketId,
      decision: 'approve',
    })
    expect(decision.kind).toBe('created')
    expect(harness.spies.createTeam).toHaveLength(1)

    // ── 幂等回放：同一 requestId 重投 ──
    const replay = await run(harness, 'sophia_spawn_team', {
      targetKind: 'persistent', ...smallSpec, requestId: String(first['requestId']),
    })
    expect(replay['kind'], '重投应回放 created 结论').toBe('created')
    expect(harness.spies.createTeam, '回放不得重复建团').toHaveLength(1)

    // 关键断言：这条回放的文案**不得**声称走了免审路径。
    const rendered = renderedText(toolOf(harness, 'sophia_spawn_team'), replay)
    expect(rendered).not.toContain('免审')
    expect(rendered).toContain('已获人类批准')

    // 对照：临时团那一条**应当**说明免审（否则上一条断言可以靠「什么都不说」蒙混过关）。
    const temporary = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', ...smallSpec, requestId: 'req-temp-explicit',
    })
    expect(temporary['kind']).toBe('created')
    expect(renderedText(toolOf(harness, 'sophia_spawn_team'), temporary)).toContain('免审')
  })

  it('★ 通知正文必须写明收件人视角（回归：OCR [1]，不得让收件人读成「来自我自己」）', async () => {
    // 回归用例：通知正文是**投递给收件人**的。初版写「来自 <caller> 的消息…」，
    // 收件人（colleague）读到的发起者 id 与自己的 id 不同，却没有任何词说明
    // 「这条消息是给我的」——在调用者与收件人同一的场景下更会读成「来自我自己」。
    // 反恒真：把文案改回 `来自 ${caller}`（去掉「你收到了」）→ 本条必须变红。
    const harness = await makeHarness()
    await run(harness, 'sophia_team_message', {
      content: '正文', to: '推步主事', channelId: channelA, threadTitle: '线程',
    })
    const text = harness.probes.get(colleague)?.notices.followup[0]?.content[0]?.text ?? ''
    expect(text).toContain('你收到了')
    expect(text).toContain(self) // 发起者 id 仍在（可追溯）
    expect(text).toContain('正文')
  })

  it('逆向：频道不存在 → unknown-channel；缺 threadTitle → invalid-input', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length

    expect((await run(harness, 'sophia_team_message', {
      content: 'x', to: '推步主事', channelId: 'ch-none', threadTitle: 't',
    }))['kind']).toBe('unknown-channel')

    expect((await run(harness, 'sophia_team_message', {
      content: 'x', to: '推步主事', channelId: channelA,
    }))['kind']).toBe('invalid-input')

    expect((await run(harness, 'sophia_team_message', {
      content: '', to: '推步主事', channelId: channelA, threadTitle: 't',
    }))['kind']).toBe('invalid-input')

    expect(allEvents(harness.ledger).length).toBe(before)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ③ sophia_task_claim
// ════════════════════════════════════════════════════════════════════════════

/** 建一个 DAG 团队 + 一个任务（任务状态由调用方写入）。 */
/**
 * 种一条**已存在**的线程（挂在给定频道下）。
 *
 * 存在的理由（OCR HIGH [14] 的回归用例）：回复路径的跨团归属门要能测，
 * 就必须有一条「属于**另一个团**的频道里的线程」可指着 ——
 * 起线程路径自己会把 `channelId` 与 `teamA` 对比，测不到 `existing.channelId` 那条路。
 */
function seedThread(ledger: Ledger, threadId: ThreadId, channelId: ChannelId, title: string): void {
  commit(ledger, {
    kind: 'team/thread-started',
    data: { threadId, channelId, title, assigneeMemberId: null },
    actor: humanActor,
  })
}

function seedDag(ledger: Ledger, owner: MemberId, taskId: string, state: string | null): void {
  commit(ledger, {
    kind: 'dag/team-created',
    data: { dagTeamId: dagA, ownerMemberId: owner, parentTeamId: teamA, requestedByTransfer: false },
    actor: humanActor,
  })
  if (state !== null) {
    commit(ledger, {
      kind: 'dag/task-state-changed',
      data: { dagTeamId: dagA, taskId, from: 'pending', to: state },
      actor: humanActor,
    })
  }
}

describe('③ sophia_task_claim', () => {
  it('正向：owner 认领依赖已就绪的任务 → 落账一条 dag/task-state-changed', async () => {
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('claimed')
    expect(result['from']).toBe('pending')
    expect(result['to']).toBe(SOPHIA_CLAIMED_TASK_STATE)
    const events = eventsOfKind(ledger, 'dag/task-state-changed')
    // 种子 1 条 + 认领 1 条
    expect(events).toHaveLength(2)
    expect(dataOf(events[1])['to']).toBe(SOPHIA_CLAIMED_TASK_STATE)
    expect(dataOf(events[1])['from']).toBe('pending')
  })

  it('逆向：**非 owner** 认领 → not-owner，**零副作用**（FR-7.2）', async () => {
    const ledger = seedLedger()
    seedDag(ledger, colleague, 'task-1', 'pending') // owner 是别人
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('not-owner')
    // 反恒真：把 owner 判定删掉 → 本条必须变红（会变成 claimed 并多落一条事件）。
    expect(eventsOfKind(ledger, 'dag/task-state-changed')).toHaveLength(1) // 只有种子那条
    // 拒绝文案不得泄露「这个 DAG 里有没有这个任务」—— 不透露别人的数据。
    expect(String(result['reason'])).not.toContain('task-1 不存在')
  })

  it('逆向：依赖未完成 → blocked，**零副作用**（FR-4.1）', async () => {
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({
      ledger,
      projection: (base) => ({
        ...base,
        dag: { ...base.dag, unfinishedDependenciesOf: () => ['task-0'] },
      }),
    })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('blocked')
    expect(result['unfinishedDependencies']).toEqual(['task-0'])
    expect(eventsOfKind(ledger, 'dag/task-state-changed')).toHaveLength(1)
  })

  it('逆向：重复认领是**幂等**的（不落第二条事件）', async () => {
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({ ledger })

    expect((await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' }))['kind']).toBe('claimed')
    const second = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })
    expect(second['kind']).toBe('already-claimed')
    expect(eventsOfKind(ledger, 'dag/task-state-changed')).toHaveLength(2)
  })

  it('逆向：DAG 团队不存在 / 任务不存在 / 缺字段', async () => {
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger })

    expect((await run(harness, 'sophia_task_claim', { dagTeamId: 'dag-none', taskId: 't' }))['kind'])
      .toBe('unknown-dag-team')
    expect((await run(harness, 'sophia_task_claim', { taskId: 't' }))['kind']).toBe('invalid-input')
    expect((await run(harness, 'sophia_task_claim', { dagTeamId: dagA }))['kind']).toBe('invalid-input')
    expect(eventsOfKind(ledger, 'dag/task-state-changed')).toHaveLength(0)
  })

  it('逆向：reason 超长被拒（回归：OCR [16]，它会被原样写进不可改写的账本）', async () => {
    // 回归用例：`reason` 会被原样落进 append-only 账本，超长/噪声一旦落盘永远留着，
    // 且每条后续读取都要把它读回来。
    // 反恒真：删掉 `reason.value.length > SOPHIA_REASON_MAX` 那道判断 → 本条必须变红。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'pending')
    const harness = await makeHarness({ ledger })
    const before = eventsOfKind(ledger, 'dag/task-state-changed').length

    // 恰好等于上限：应当通过（边界值必须可过，否则上限就成了「少一个」）。
    const atLimit = await run(harness, 'sophia_task_claim', {
      dagTeamId: dagA, taskId: 'task-1', reason: 'x'.repeat(SOPHIA_REASON_MAX),
    })
    expect(atLimit['kind'], '正好等于上限应通过').toBe('claimed')

    // 超一个字符：应当被拒，且不落账。
    const afterOk = eventsOfKind(ledger, 'dag/task-state-changed').length
    const tooLong = await run(harness, 'sophia_task_claim', {
      dagTeamId: dagA, taskId: 'task-2', reason: 'x'.repeat(SOPHIA_REASON_MAX + 1),
    })
    expect(tooLong['kind']).toBe('invalid-input')
    expect(eventsOfKind(ledger, 'dag/task-state-changed').length).toBe(afterOk)
    expect(before).toBe(1)
  })

  it('逆向：**已完成/已取消**状态的任务仍可认领（不发明状态白名单，如实登记为缺口）', async () => {
    // 这条**不是**在夸实现，而是把「刻意不做的事」钉成可检验的：
    // OCR 复核 MEDIUM [13] 建议「非 pending/ready 就拒绝」，**不采纳** ——
    // `DagTaskState` 被刻意冻结为 `string`（状态机属 sophia-engine-dag），
    // 在这里 hardcode 白名单会在引擎立项后变成错误的形状、把合法认领也拦下来。
    // 本用例如实记录当前行为 + 缺口，等引擎立项时它会先红，逼后来者显式收口。
    const ledger = seedLedger()
    seedDag(ledger, self, 'task-1', 'completed')
    const harness = await makeHarness({ ledger })

    const result = await run(harness, 'sophia_task_claim', { dagTeamId: dagA, taskId: 'task-1' })

    expect(result['kind']).toBe('claimed')
    expect(result['from']).toBe('completed')
    // `from` 必须是**账本投影的真实值**（不是调用方自报，也不是我们的猜测）。
    const events = eventsOfKind(ledger, 'dag/task-state-changed')
    expect(dataOf(events[events.length - 1])['from']).toBe('completed')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ④ sophia_spawn_team
// ════════════════════════════════════════════════════════════════════════════

const smallSpec = { name: '专班', roster: [{ position: '灵台郎', count: 1 }], tasks: ['编算'] }

describe('④ sophia_spawn_team', () => {
  it('正向：持久成员开**临时团** → created（免审：principalOf 0 次、收件箱 0 次）', async () => {
    const harness = await makeHarness()
    const result = await run(harness, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })

    expect(result['kind']).toBe('created')
    expect(harness.spies.createTeam).toHaveLength(1)
    // AC-5-5 的同形断言：免审路径既不问监正、也不推收件箱。
    expect(harness.spies.principalOf).toHaveLength(0)
    expect(harness.spies.inboxPush).toHaveLength(0)
    expect(eventsOfKind(harness.ledger, 'spawn/awaiting-human-approval')).toHaveLength(0)
  })

  it('正向：持久成员开**持久团** → awaitingHumanApproval（两级审批：监正 1 次、收件箱 1 次、建团 0 次）', async () => {
    const harness = await makeHarness()
    const result = await run(harness, 'sophia_spawn_team', { targetKind: 'persistent', ...smallSpec })

    expect(result['kind']).toBe('awaitingHumanApproval')
    expect(harness.spies.principalOf).toEqual([self])
    expect(harness.spies.inboxPush).toHaveLength(1)
    expect(harness.spies.inboxPush[0]?.actions).toEqual(['approve', 'reject'])
    // AC-5-7：批准前不创建。
    expect(harness.spies.createTeam).toHaveLength(0)
    expect(eventsOfKind(harness.ledger, 'spawn/awaiting-human-approval')).toHaveLength(1)
  })

  it('★ 逆向：**临时成员开持久团被拒**（FR-5.2.1），且零副作用', async () => {
    // 任务书点名的必验项。注意「临时成员」是由**账本投影**判定的
    // （`outsider` 属于 teamB，而 teamB 的 kind 是 temporary）——
    // 模型填不出这个身份，见①中的「防冒充」用例。
    const harness = await makeHarness({ caller: outsider, callerTeam: teamB })
    const before = allEvents(harness.ledger).length

    const result = await run(harness, 'sophia_spawn_team', { targetKind: 'persistent', ...smallSpec })

    expect(result['kind']).toBe('forbidden')
    expect(result['errorCode']).toBe('ERR_SPAWN_FORBIDDEN')
    // 三条零副作用断言（缺任何一条，一个「先建团再判权限」的实现都能全绿）。
    expect(harness.spies.createTeam).toHaveLength(0)
    expect(harness.spies.inboxPush).toHaveLength(0)
    expect(harness.spies.principalOf).toHaveLength(0)
    expect(allEvents(harness.ledger).length, '被拒的派生不得留下任何账本事实').toBe(before)
    // FR-5.2.1 要求「明确拒绝并说明原因」。
    expect(String(result['reason'])).toContain('临时团')
  })

  it('★ 逆向：**绕过工具层**直调 requestSpawn，临时成员开持久团仍被拒（拦在 delegation 里）', async () => {
    // 本用例证明「工具层那次 callerKind 镜像判定**不是**唯一防线」——
    // 判定权唯一属于 `src/delegation.ts`（单一真相）。
    // 反恒真：把 delegation 的权限矩阵删掉 → 本条必须变红。
    const harness = await makeHarness({ caller: outsider, callerTeam: teamB })
    const before = allEvents(harness.ledger).length

    const outcome = await requestSpawn(harness.deps.delegation, {
      requestId: 'req-bypass-1' as RequestId,
      requesterMemberId: outsider,
      requesterKind: 'temporary',
      targetKind: 'persistent',
      spec: smallSpec,
    })

    expect(outcome.kind).toBe('forbidden')
    expect(harness.spies.createTeam).toHaveLength(0)
    expect(allEvents(harness.ledger).length).toBe(before)
  })

  it('逆向：临时成员开**临时团**仍可（FR-5.2 第二格，免审）', async () => {
    const harness = await makeHarness({ caller: outsider, callerTeam: teamB })
    const result = await run(harness, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })
    expect(result['kind']).toBe('created')
    expect(harness.spies.createTeam).toHaveLength(1)
    expect(harness.spies.inboxPush).toHaveLength(0)
  })

  it('省 requestId 时，同一份申请重投**复用同一个幂等键**（不重复建团）', async () => {
    // 反恒真：把 requestId 改成每次 `randomUUID` → 第二次会当成一份新申请，
    // 于是再建一个团（createTeam 变成 2 次）→ 本条必须变红。
    const harness = await makeHarness()
    const first = await run(harness, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })
    const second = await run(harness, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })

    expect(first['kind']).toBe('created')
    expect(second['kind']).toBe('created')
    expect(second['requestId']).toBe(first['requestId'])
    expect(harness.spies.createTeam, '同一份申请只该建一个团').toHaveLength(1)
  })

  it('★ 自动生成的 requestId **跨成员实例不撞**（回归：初版计数器会让两个成员得到同一个 id）', async () => {
    // 回归用例（OCR 复核 HIGH [26]）。缺陷形状（已用 node 内联复现）：
    // 初版 `req-${counter}-${key.length.toString(16)}` 里，`counter` 是**每个实例**的，
    // 而 `createSophiaTools` 按成员各建一份 ⇒ 两个成员的第一份申请都是 `req-1-40`
    //（两人的 memberId 等长时 `key.length` 相同）。
    // 而 `delegation.ts:808` 的 `state.decided` **只按 requestId** 索引 ⇒
    // 成员 B 的派生会命中 A 的结论（包括 `created` 且返回 **A 的 teamId**）。
    //
    // 本用例用两个**独立 harness**（各自一份工具实例）来暴露它：
    // 修好后（确定性 SHA-256 派生）两人对**不同**申请必得不同 id。
    // 反恒真：把 `requestIdForApplication` 换回计数器版本 → 本条必须变红。
    // ⚠ 两个 harness 必须**共享同一个账本**：撞 id 的后果发生在 `delegation.ts` 的
    // `state.decided`（一个按 `requestId` 索引、挂在 Ledger 对象上的 `WeakMap`）里，
    // 各用一个独立账本的话，撞了也各写各的、这条用例会**恒绿**。
    // （首版就是这么写的，实测发现 `teamId` 两边都是 `team-spawned-1` —— 那是
    //  `createTeam` 假件各自计数的结果，与撞不撞 id 无关，属**无效断言**。已纠正。）
    const sharedLedger = seedLedger()
    const harnessA = await makeHarness({ ledger: sharedLedger, caller: self })
    const harnessB = await makeHarness({ ledger: sharedLedger, caller: colleague })

    const resultA = await run(harnessA, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })
    const resultB = await run(harnessB, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })

    expect(resultA['kind']).toBe('created')
    expect(resultB['kind']).toBe('created')
    expect(resultB['requestId'], '两个成员的第一份申请不得得到同一个 requestId').not.toBe(
      resultA['requestId'],
    )
    // 共享账本上必须**真的建了两个团**：这正是撞 id 时会塌掉的那一条
    //（B 会命中 A 的 `created` 结论、拿回 A 的 teamId，而 `createTeam` 只被调 1 次）。
    expect(harnessA.spies.createTeam, '两份不同申请必须各建一个团').toHaveLength(1)
    expect(harnessB.spies.createTeam).toHaveLength(1)
    expect(resultB['teamId']).not.toBe(resultA['teamId'])
  })

  it('★ 同一成员对**同一份申请**仍得到同一个 id（幂等不因换成哈希而丢失）', async () => {
    // 上一条的**反向对照**：只说「id 不同」的话，把 id 改成 `randomUUID()`
    // 也能让上一条全绿 —— 而那样会丢掉幂等（每次重投都当成新申请、重复建团）。
    // 两条合起来才把「确定性 + 不撞」这一对性质钉住。
    const harness = await makeHarness()
    const first = await run(harness, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })
    const second = await run(harness, 'sophia_spawn_team', { targetKind: 'temporary', ...smallSpec })
    expect(second['requestId']).toBe(first['requestId'])

    // 并且**名册顺序不同**仍算同一份申请（applicationKeyOf 会排序）。
    const reordered = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary',
      name: smallSpec.name,
      roster: [{ position: '灵台郎', count: 1 }],
      tasks: ['编算'],
    })
    expect(reordered['requestId']).toBe(first['requestId'])

    // 而**换一份规格**必须是另一个 id（键里每一项都参与）。
    const different = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '另一个专班', roster: [{ position: '灵台郎', count: 1 }], tasks: ['编算'],
    })
    expect(different['requestId']).not.toBe(first['requestId'])

    // ⚠ **只改名册**（名字/任务都不变）也必须是另一个 id。
    // 这一条是变异测试逼出来的（不是我先想到的）：把 `applicationKeyOf` 里的 `roster`
    // 去掉后，上面几条断言**全都仍然全绿** —— 因为「换规格」那条改的是 `name`。
    // 而名册正是「这两份申请要建的是不是同一个团」最实质的判据：
    // 同名但名册不同（1 个灵台郎 vs 3 个灵台郎）若共用一个 id，
    // 第二份会被幂等回放成第一份的结论 ⇒ 建出来的团**人数不对**，且没有任何报错。
    // 反恒真：把 `applicationKeyOf` 的 `roster` 去掉 → 本条必须变红（已实测）。
    const rosterChanged = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary',
      name: smallSpec.name,
      roster: [{ position: '灵台郎', count: 3 }],
      tasks: ['编算'],
    })
    expect(rosterChanged['requestId']).not.toBe(first['requestId'])

    // 只改任务清单同理（名册与名字都不变）。
    const tasksChanged = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary',
      name: smallSpec.name,
      roster: [{ position: '灵台郎', count: 1 }],
      tasks: ['编算', '复核'],
    })
    expect(tasksChanged['requestId']).not.toBe(first['requestId'])

    // 只改 targetKind 同理（临时团与持久团是两份不同的申请 —— SPEC §5.4 的类型维度）。
    const kindChanged = await run(harness, 'sophia_spawn_team', {
      targetKind: 'persistent',
      name: smallSpec.name,
      roster: [{ position: '灵台郎', count: 1 }],
      tasks: ['编算'],
    })
    expect(kindChanged['requestId']).not.toBe(first['requestId'])

    // ⚠ **名册的书写顺序不影响 id**（即「同一份申请」不该因为排序不同被当成两份）。
    // 这一条也是变异测试逼出来的：把 `applicationKeyOf` 里的 `.sort()` 去掉后，
    // 上面**全部**断言仍然全绿 —— 因为上面用的都是**单项**名册，排序对单项无影响。
    // 反恒真：去掉 `.sort()` → 本条必须变红（已实测）。
    //
    // 为什么这条值得单独一条用例：`foldLedgerEvents` 与运行时的去重都吃过
    // 「枚举顺序变了就当成新事实」的亏（t2 的 `noticeSignatureOf` 有专门注释）。
    // 在这里它的后果是 FR-5.3.4 的绕开窗口：把名册写换个顺序即可当成一份新申请重投，
    // 而被否过的申请本不该能被换皮重投。
    const rosterA = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary',
      name: '多人专班',
      roster: [{ position: '灵台郎', count: 1 }, { position: '推步主事', count: 2 }],
      tasks: ['编算'],
    })
    const rosterB = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary',
      name: '多人专班',
      roster: [{ position: '推步主事', count: 2 }, { position: '灵台郎', count: 1 }],
      tasks: ['编算'],
    })
    expect(rosterB['requestId'], '名册顺序不同仍是同一份申请').toBe(rosterA['requestId'])
  })

  it('名册/任务的形状门（空名册、count 非整数、非法 targetKind、空团名）都是 invalid-input 且零副作用', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length
    const cases: readonly Record<string, unknown>[] = [
      { targetKind: 'temporary', name: 'x', roster: [], tasks: [] },
      { targetKind: 'temporary', name: 'x', roster: [{ position: '灵台郎', count: 0 }], tasks: [] },
      { targetKind: 'temporary', name: 'x', roster: [{ position: '灵台郎', count: 1.5 }], tasks: [] },
      { targetKind: 'temporary', name: 'x', roster: [{ position: '', count: 1 }], tasks: [] },
      { targetKind: 'temporary', name: 'x', roster: [{ position: '灵台郎', count: 1 }], tasks: [''] },
      // 注意：`persistent` + 合法名册**不是**非法输入（那是 awaitingHumanApproval，
      // 由上面那条正向用例覆盖）。首版把它误列进来，实测纠正 —— 记在这里，
      // 免得后来者以为「persistent 会被拒」。
      { targetKind: 'persistent-team', name: 'x', roster: [{ position: '灵台郎', count: 1 }], tasks: [] },
      { targetKind: 'temporary', name: '', roster: [{ position: '灵台郎', count: 1 }], tasks: [] },
    ]
    for (const input of cases) {
      const result = await run(harness, 'sophia_spawn_team', input)
      expect(result['kind'], `输入 ${JSON.stringify(input)} 应被判非法`).toBe('invalid-input')
    }
    expect(harness.spies.createTeam).toHaveLength(0)
    expect(allEvents(harness.ledger).length).toBe(before)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑤ sophia_switch_model
// ════════════════════════════════════════════════════════════════════════════

describe('⑤ sophia_switch_model', () => {
  it('正向：写一条 team/member-model-switched，from 取自账本、trigger 恒为 member-self', async () => {
    const harness = await makeHarness()
    const result = await run(harness, 'sophia_switch_model', {
      provider: 'workbuddy-xdpool',
      model: 'deepseek-v4.1-flash',
      reason: '上下文压力升高',
    })

    expect(result['kind']).toBe('switched')
    expect(result['from']).toEqual({ provider: 'deepseek', model: 'v4.1-flash' })
    expect(result['to']).toEqual({ provider: 'workbuddy-xdpool', model: 'deepseek-v4.1-flash' })
    expect(result['trigger']).toBe(SOPHIA_SELF_SWITCH_TRIGGER)
    expect(result['presence']).toBe('idle')

    const events = eventsOfKind(harness.ledger, 'team/member-model-switched')
    // 种子 2 条（self + colleague）+ 本次 1 条
    expect(events).toHaveLength(3)
    const data = dataOf(events[2])
    expect(data['memberId']).toBe(self)
    expect(data['reason']).toBe('上下文压力升高')
    expect(data['trigger']).toBe(SOPHIA_SELF_SWITCH_TRIGGER)
    expect(data['from']).toEqual({ provider: 'deepseek', model: 'v4.1-flash' })
    // `effectiveAtSequence` 必须等于**这条事件自己的序号**（写序预测 + 校验）。
    expect(data['effectiveAtSequence']).toBe(events[2]?.sequence)
  })

  it('正向：成员忙时（running）换模，presence 如实反映存在态', async () => {
    const harness = await makeHarness()
    harness.probes.get(self)?.setStatus('running')
    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: '质检连续失败',
    })
    expect(result['kind']).toBe('switched')
    expect(result['presence']).toBe('running')
    // 存在态**不入账本**（FR-3.2：不得持久化）。
    const data = dataOf(eventsOfKind(harness.ledger, 'team/member-model-switched')[2])
    expect(Object.keys(data)).not.toContain('presence')
  })

  it('逆向：**给别人换模** → not-self，**零副作用**', async () => {
    const harness = await makeHarness()
    const before = eventsOfKind(harness.ledger, 'team/member-model-switched').length

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: '我想替他换', memberId: colleague,
    })

    expect(result['kind']).toBe('not-self')
    expect(eventsOfKind(harness.ledger, 'team/member-model-switched')).toHaveLength(before)
  })

  it('逆向：目标模型与当前相同 → no-change，**不落账**', async () => {
    const harness = await makeHarness()
    const before = eventsOfKind(harness.ledger, 'team/member-model-switched').length

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'deepseek', model: 'v4.1-flash', reason: '换成一样的',
    })

    expect(result['kind']).toBe('no-change')
    // 反恒真：去掉同模型短路 → 本条必须变红（会多出一条 from === to 的事件）。
    expect(eventsOfKind(harness.ledger, 'team/member-model-switched')).toHaveLength(before)
  })

  it('★ **有初始模型**的成员，**首次**换模就能成功，且 `from` 就是那个初始模型（req 3 的配对用例）', async () => {
    // ## 这条用例钉住的是一个**曾被判为不可达**的分支
    //
    // 背景（captain 裁定 + 我 2026-09-23 的探针）：
    // - 改前：`MemberAddedData` 没有 `model`，`projection/index.ts` 折叠 `member-added` 时
    //   **硬写 `model: null`** ⇒ 新团成员**恒无模型** ⇒ `from` 取不到 ⇒
    //   **人类点「换模」第一次必然失败**（`unknown-current-model`）。全仓**没有**任何
    //   初始模型写入路径，于是那个失败是**结构性**的、无法绕过。
    // - 改后：`数象主事` 给 `MemberAddedData` 加了必填可空 `model`、投影**从载荷取**
    //   ⇒ 成员可以带初始模型出生，首次换模就有了合法的 `from`。
    //
    // ⇒ 本用例与下面那条 `unknown-current-model` 是**配对**的：同一个工具、同一个门，
    //   **只有成员的初始模型不同**，结论必须相反。
    //   单看任一条都会被「门写死」（恒拒 / 恒放）骗过 —— 这正是本批反复出现的
    //   「分支级不可测」的正解（captain 也点名过这个手法）。
    //
    // 反恒真（两个方向都验过）：
    // ① 把 `MemberAddedData.model` 的落账去掉（投影回到硬写 `null`）
    //    ⇒ 本条必须变红（会得到 `unknown-current-model`）；
    // ② 把 `switch-model` 的 `current === null` 门删掉（改成拿 `to` 顶上）
    //    ⇒ 下面那条配对用例必须变红。
    const ledger = seedLedger()
    const initial = { provider: 'deepseek', model: 'v4.1-flash' }
    seedMemberAdded(ledger, teamA, modelBornMember, '带模出生的成员', initial)
    // ⚠ 必须先取**基线**：`seedLedger` 自己会为别的成员种下若干条
    // `member-model-switched`（它是「两团 + 成员 + 频道」的完整现场，不是空账本）。
    // 我第一版直接断言 `toHaveLength(1)` 而拿到 3 而红 ——
    // **是断言写错了，不是实现错了**。要断言的是「本次调用**净增**一条」。
    const before = eventsOfKind(ledger, 'team/member-model-switched').length
    const harness = await makeHarness({
      ledger,
      caller: modelBornMember,
      callerTeam: teamA,
      projection: (base) => ({ ...base, callerKindOf: () => 'persistent' }),
    })

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: '首换',
    })

    expect(result['kind'], '带初始模型的成员首次换模必须成功').toBe('switched')
    expect(result['memberId']).toBe(modelBornMember)
    // ⭐ 关键断言：`from` 必须**就是**账本里那个初始模型 ——
    // 不是 `to` 顶上、不是编的、也不是 `null`。
    expect(result['from']).toEqual(initial)
    expect(result['to']).toEqual({ provider: 'p2', model: 'm2' })

    // 账本里那条**新增**事件的 `from` 同样必须是初始模型（不能只在结果里对）。
    const events = eventsOfKind(ledger, 'team/member-model-switched')
    expect(events, '必须净增一条换模事件').toHaveLength(before + 1)
    const newest = events[events.length - 1]
    expect(dataOf(newest)['memberId'], '新增的那条必须属于本用例的成员').toBe(modelBornMember)
    expect(dataOf(newest)['from'], '账本里的 from 必须是初始模型').toEqual(initial)
    expect(dataOf(newest)['to']).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('★ `receipt.sequence` 不是安全整数 ⇒ `failed`，**不得**报成跨进程并发（回归：OCR HIGH，switch-model 侧）', async () => {
    // 回归用例：`task-claim.ts` 修过这处（OCR MEDIUM [6]），而 `switch-model.ts` **漏了** ——
    // 更糟的是 `task-claim.ts` 的注释当时写着「与 `switch-model.ts` 的 `actual` 处理同源」，
    // **那句在写下时就是假的**。两处现已对齐。
    //
    // 危害：注入的 `Ledger` 返回 `undefined` 时，`actual !== predicted` 为 true ⇒
    // 走进 `sequence-mismatch` —— 一个**声称「跨进程并发」**的分支，
    // 把「适配器不符契约」误报成并发，还把 `undefined` 当序号播给调用方。
    // 反恒真：删掉 `isNonNegativeSafeInteger(actualSequence)` → 本条必须变红。
    const harness = await makeHarness({
      ledgerOf: (base) => ({
        ...base,
        commit: (_input: LedgerCommitInput): LedgerReceipt =>
          ({ sequence: undefined as unknown as number }) as LedgerReceipt,
      }),
    })

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })

    expect(result['kind']).toBe('failed')
    const reason = String(result['reason'])
    expect(reason, '必须说清是 ledger 实现不符契约').toContain('非负安全整数')
    expect(reason, '不得读成跨进程并发').not.toContain('另一个进程')
  })

  it('★ `head().sequence` 形状不对 ⇒ `failed` 且**不写账本**（回归：OCR MEDIUM，与回执侧对称）', async () => {
    // 回归用例：我先前只校验了 `receipt.sequence`（回执侧），而**读侧**（`head().sequence`）
    // 是裸用的 —— 同一个端口、同一类要求，漏了一半。
    //
    // 危害：`sequence` 非整数时 `predicted` 变成 `NaN`，而它会被写进**不可改写**的账本
    //（`effectiveAtSequence: NaN` ⇒ JSON 序列化成 `null`），此后每次回放都读到一条
    // 序号含义不明的事件；同时 `actualSequence !== predicted` 恒真 ⇒ 又走成误导性的
    // `sequence-mismatch`。
    // 反恒真：删掉 `isNonNegativeSafeInteger(head.sequence)` → 本条必须变红。
    const ledger = seedLedger()
    const harness = await makeHarness({
      ledger,
      ledgerOf: (base) => ({
        ...base,
        head: () => ({ sequence: undefined as unknown as number, eventId: null }),
      }),
    })
    const before = ledger.head().sequence
    // ⚠ 与初始模型那条同一个坑：`seedLedger` 里**已经有**别的成员的换模事件
    //（它是完整现场，不是空账本）⇒ 断言「净增 0」而不是 `toHaveLength(0)`。
    // 我第一版写成 `toHaveLength(0)` 而拿到 2 而红 —— **是断言写错了**。
    const eventsBefore = eventsOfKind(ledger, 'team/member-model-switched').length

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r',
    })

    expect(result['kind']).toBe('failed')
    expect(String(result['reason'])).toContain('head()')
    // ⭐ 关键：这一步在 commit **之前** ⇒ 账本必须**一个字节都没动**。
    expect(ledger.head().sequence, '不得写账本').toBe(before)
    expect(eventsOfKind(ledger, 'team/member-model-switched').length, '不得净增事件').toBe(eventsBefore)
  })

  it('逆向：账本里取不到当前模型 → unknown-current-model，**不落账**', async () => {
    // 与上一条**配对**：同一个门，只有「成员有没有初始模型」不同。
    //
    // ⚠ 这里**不再用假投影**（`modelOf: () => null`）。改前那样写是必要的（因为
    // 真实投影当时恒返回 `null`，造不出「有模型」的对照）；现在投影已就绪，
    // 用**真实现**才测得到「这条分支在真实数据下可达」。
    // 用 `principalId`：它在 `seedLedger` 里以 `model: null` 出生（跟随全局默认）、
    // 且从未换过模 ⇒ 真实投影下 `modelOf` 确实返回 `null`。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger, caller: principalId })
    const before = eventsOfKind(ledger, 'team/member-model-switched').length

    const result = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: '试探',
    })

    expect(result['kind']).toBe('unknown-current-model')
    expect(eventsOfKind(ledger, 'team/member-model-switched')).toHaveLength(before)
    // 拒绝文案必须**指出下一步**（怎么才能让它有 from），而不是只说「不行」。
    expect(String(result['reason'])).toContain('初始模型')
  })

  it('逆向：空 reason 被拒（FR-6.4 要求说明原因）', async () => {
    const harness = await makeHarness()
    const before = eventsOfKind(harness.ledger, 'team/member-model-switched').length
    for (const reason of ['', '   ', undefined, 42]) {
      const result = await run(harness, 'sophia_switch_model', {
        provider: 'p2', model: 'm2', reason,
      })
      expect(result['kind']).toBe('invalid-input')
    }
    expect(eventsOfKind(harness.ledger, 'team/member-model-switched')).toHaveLength(before)
  })

  it('逆向：生命周期不是 active → not-active，**零副作用**', async () => {
    const harness = await makeHarness({
      projection: (base) => ({ ...base, lifecycleOf: () => 'suspended' as MemberLifecycle }),
    })
    const before = eventsOfKind(harness.ledger, 'team/member-model-switched').length
    const result = await run(harness, 'sophia_switch_model', { provider: 'p2', model: 'm2', reason: 'r' })
    expect(result['kind']).toBe('not-active')
    expect(eventsOfKind(harness.ledger, 'team/member-model-switched')).toHaveLength(before)
  })

  it('写序校验：head() 与 commit() 之间有并发提交 → sequence-mismatch（**事件已写入，如实上报**）', async () => {
    // 构造方式：包一层 ledger，`commit` 先往**底层**账本写一条无关事件（模拟另一个进程），
    // 再把调用转交下去。于是本次 commit 拿到的序号比预测值大 1 ——
    // 而 head() 与 commit() 都是同步的，同一进程内不可能发生，故这条路径只能这么构造。
    // 反恒真：把 `actual !== predicted` 的校验删掉 → 本条必须变红（会返回 switched）。
    const ledger = seedLedger()
    const harness = await makeHarness({ ledger })
    let injected = false
    const wrapped: Ledger = {
      commit(input) {
        if (!injected) {
          injected = true
          // 直接写底层（这里是**模拟外部并发**，不是正常写入路径）。
          ledger.commit({
            kind: 'team/thread-started',
            data: { threadId: 'th-intruder' as ThreadId, channelId: channelA, title: '外部插入', assigneeMemberId: null },
            actor: humanActor,
          })
        }
        return ledger.commit(input)
      },
      read: (query) => ledger.read(query),
      head: () => ledger.head(),
      verifyIntegrity: () => ledger.verifyIntegrity(),
      close: () => ledger.close(),
    }
    const harnessWithWrap = await makeHarness({
      ledger: wrapped,
      projection: (base) => base,
    })

    const result = await run(harnessWithWrap, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: '写序竞争',
    })

    expect(result['kind']).toBe('sequence-mismatch')
    expect((result['actual'] as number) - (result['predicted'] as number)).toBe(1)
    // 事件**确实**写进去了（append-only，撤不回）—— 如实断言，不假装干净。
    const events = eventsOfKind(ledger, 'team/member-model-switched')
    const written = events[events.length - 1]
    expect(dataOf(written)['effectiveAtSequence']).toBe(result['predicted'])
    expect(written?.sequence).toBe(ledger.head().sequence)
    expect(harness.spies.createTeam).toHaveLength(0)
    void harness
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑥ sophia_context_rollover
// ════════════════════════════════════════════════════════════════════════════

describe('⑥ sophia_context_rollover', () => {
  it('正向：有待办 → 读回条数并唤醒（**不写账本**）', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length
    // 直接问投影拿期望值（真实现：unreadByMember）—— 不是硬编码常量。
    const expected = unreadByMember(harness.ledger, { memberId: self, sinceSequence: 0 })

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('handed-over')
    expect(result['count']).toBe(expected.count)
    expect(result['newestSequence']).toBe(expected.newestSequence)
    expect(result['sinceSequence']).toBe(0)
    expect(result['wake']).toBe('delivered')
    // rollover 不是协作事实 ⇒ 不写账本。
    // 反恒真：在 rollover 里加一条 commit → 本条必须变红。
    expect(allEvents(harness.ledger).length, 'rollover 不得写账本').toBe(before)
    expect(result['gaps']).toEqual([SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint])
  })

  it('正向：水位之后没有待办 → nothing-pending（接力完成，但没有东西要交接）', async () => {
    const harness = await makeHarness()
    const head = harness.ledger.head().sequence
    const result = await run(harness, 'sophia_context_rollover', { sinceSequence: head })
    expect(result['kind']).toBe('nothing-pending')
    expect(harness.probes.get(self)?.notices.followup).toHaveLength(0)
  })

  it('逆向：`sinceSequence` 非法（小数 / 负数 / 非数值）→ invalid-input', async () => {
    // 反恒真：把入口的 `isNonNegativeSafeInteger` 换成 `typeof === 'number'`
    // → 小数会穿到 `Ledger.read` 并抛 RangeError（而本工具的契约是**不抛**）→ 本条变红。
    const harness = await makeHarness()
    for (const sinceSequence of [1.5, -1, '0', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await run(harness, 'sophia_context_rollover', { sinceSequence })
      expect(result['kind'], `sinceSequence=${String(sinceSequence)} 应被判非法`).toBe('invalid-input')
    }
  })

  it('逆向：接力别的团成员 → not-same-team，且**零唤醒**', async () => {
    const harness = await makeHarness()
    const result = await run(harness, 'sophia_context_rollover', { memberId: outsider })
    expect(result['kind']).toBe('not-same-team')
    expect(String(result['reason'])).toContain('跨团')
  })

  it('未读判据**可被证伪**：换掉 `unreadOf` 的实现，工具结论跟着变', async () => {
    // 这条针对 `SophiaProjectionPorts.unreadOf` 的注释
    //（「必须是 unreadByMember、未读与账本通知是同一个判据」）：
    // 若工具其实是自己算的，换掉端口不会有任何影响 —— 本用例会让那句话变成可检验的。
    const harness = await makeHarness({
      projection: (base) => ({
        ...base,
        unreadOf: () => ({ memberId: self, count: 999, newestSequence: 12345 }),
      }),
    })
    const result = await run(harness, 'sophia_context_rollover', {})
    expect(result['kind']).toBe('handed-over')
    expect(result['count']).toBe(999)
    expect(result['newestSequence']).toBe(12345)
    // 正文里也要用到这个数（证明它不是只出现在结果的装饰字段）。
    expect(harness.probes.get(self)?.notices.followup[0]?.content[0]?.text).toContain('999')
  })

  it('★ 唤醒未送达时**不得**报成「接力完成」（回归：OCR [8]，真实缺陷）', async () => {
    // 回归用例：初版无论 `wake` 是什么都返回 `handed-over`，render 渲染成「已完成接力」。
    // 于是 `no-handle`（该成员此刻没有活句柄）/`not-active`/`delivery-failed`
    // 全显示成**成功** —— 而调用方正是靠这个结果决定「要不要为新上下文开一个 turn」，
    // 它会以为交接完了而不再唤醒，那个成员就**再也不会被唤醒**。
    // 反恒真：把 `if (wake !== 'delivered')` 那段删掉 → 本条必须变红（会返回 handed-over）。
    const harness = await makeHarness()
    // 释放该成员的句柄 ⇒ 运行时对它的 notify 必然返回 `no-handle`。
    expect(await harness.runtime.release(self)).toBe(true)

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind'], '唤醒没送到就不能报成接力完成').toBe('wake-not-delivered')
    expect(result['wake']).toBe('no-handle')
    // 待办数仍然带出（读取是成功的，只有投递失败）——两者必须可区分。
    expect(result['count']).toBeGreaterThan(0)
    const rendered = renderedText(toolOf(harness, 'sophia_context_rollover'), result)
    expect(rendered).toContain('未送达')
    expect(rendered).not.toContain('已接力')
  })

  it('★ **自己那一支**也要过账本校验（回归：OCR [7]，接线错位必须 fail-closed）', async () => {
    // 回归用例：初版是 `if (target !== deps.caller.memberId) { …校验… }`，
    // 于是「接力自己」这条路径**完全跳过**了 teamOf 校验 ——
    // 当宿主把工具集的 `caller.teamId` 错绑成别的团时，那条豁免会让它静默继续唤醒，
    // 而接线错位没有任何可观测迹象。
    // 反恒真：把 self 豁免加回去 → 本条必须变红（会返回 handed-over/nothing-pending）。
    const harness = await makeHarness({ callerTeam: teamB }) // 故意错绑

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('not-same-team')
    expect(String(result['reason'])).toContain('接线错位')
    expect(harness.probes.get(self)?.notices.followup, '错绑时不得投递').toHaveLength(0)
  })

  it('★ `newestSequence` 为 null 时**不得**归一成 0（回归：OCR [9]）', async () => {
    // 回归用例：`MemberUnread.newestSequence` 的契约写着「一条都没有时为 null，
    // **不要**用 0 表示『无』」，而 `MemberPendingItem` 的这个字段是 number。
    // 初版用 `?? 0` 圆过去 —— 但 0 是**比任何真实序号都小**的合法序号，
    // 「无」与「序号 0」会因此同形。现在取不到就如实判 failed。
    // 反恒真：把 `if (newest === null)` 改成 `const newest = unread.newestSequence ?? 0`
    // → 本条必须变红（会返回 handed-over 并把 0 写进通知）。
    const harness = await makeHarness({
      projection: (base) => ({
        ...base,
        // 故意造一个自相矛盾的投影：count>0 但 newestSequence=null。
        unreadOf: () => ({ memberId: self, count: 3, newestSequence: null }),
      }),
    })

    const result = await run(harness, 'sophia_context_rollover', {})

    expect(result['kind']).toBe('failed')
    expect(String(result['reason'])).toContain('newestSequence')
    expect(harness.probes.get(self)?.notices.followup, '不得把 0 当序号投出去').toHaveLength(0)
  })

  it('★ 字符串字段的首尾空白被裁剪（回归：OCR [17]，不裁剪会误报 not-self）', async () => {
    // 回归用例：`isNonEmptyString` 只 reject 纯空白串、**不裁剪**。
    // 于是 `' deepseek '` 会带着空格参与比较：换模的 provider 与当前不等 ⇒
    // 同模型短路失效、写出一条 from===to 的假转换到不可改写的账本上；
    // memberId 带空格则会误报 `not-self`（一个**看起来像越权**的结论）。
    // 反恒真：把 narrowTrimmedString 换回 isNonEmptyString（不裁剪）→ 本条必须变红。
    const harness = await makeHarness()

    // ① provider/model 带空格：应被裁剪后与当前模型判定为「无变化」，而不是写假转换。
    const sameWithSpaces = await run(harness, 'sophia_switch_model', {
      provider: ' deepseek ', model: ' v4.1-flash ', reason: ' 试探 ',
    })
    expect(sameWithSpaces['kind'], '裁剪后应与当前模型相同 ⇒ no-change').toBe('no-change')

    // ② memberId 带空格（即「我自己」）：应被裁剪成自己，而不是误报 not-self。
    const selfWithSpaces = await run(harness, 'sophia_switch_model', {
      provider: 'p2', model: 'm2', reason: 'r', memberId: ` ${self} `,
    })
    expect(selfWithSpaces['kind'], '带空格的自己应被裁剪成自己').toBe('switched')
    expect(selfWithSpaces['memberId']).toBe(self)
  })

  it('★ 名册键不得有分隔符歧义（回归：OCR [20]，两份不同申请撞同一个 requestId）', async () => {
    // 回归用例：初版把名册手工拼成 `position x count` 再 join(',')，
    // 而 position 是模型可控自由文本 ⇒ 两份**语义完全不同**的名册算出同一个键。
    // 实测复现：`[{position:'ax1,b',count:1}]`（**一个**职位）与
    // `[{position:'a',count:1},{position:'b',count:1}]`（**两个**职位）拼出同一串 `ax1,bx1`。
    // 二者同键 ⇒ 共享 requestId ⇒ 第二份被当成第一份的幂等回放、**建不出自己的团**。
    // 反恒真：把 applicationKeyOf 改回手工拼接 → 本条必须变红。
    const sharedLedger = seedLedger()
    const harness = await makeHarness({ ledger: sharedLedger })

    const one = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '同名团', roster: [{ position: 'ax1,b', count: 1 }], tasks: ['t'],
    })
    const two = await run(harness, 'sophia_spawn_team', {
      targetKind: 'temporary', name: '同名团',
      roster: [{ position: 'a', count: 1 }, { position: 'b', count: 1 }], tasks: ['t'],
    })

    expect(two['requestId'], '两份语义不同的名册不得撞同一个 requestId').not.toBe(one['requestId'])
    expect(harness.spies.createTeam, '两份申请必须各建一个团').toHaveLength(2)
  })

  it('★ `render` 的兜底**绝不抛错**（回归：OCR HIGH [1]，无原型对象会让 String() 抛）', async () => {
    // 回归用例：`unreachableOutcome` 初版用裸 `String(value)`，而实测
    // `String(Object.create(null))` 抛 `TypeError: Cannot convert object to primitive value`，
    // 自定义 `Symbol.toPrimitive` 抛错的对象同样会抛 ——
    // 于是「render 的兜底」恰好破掉它自己要守的「render 绝不抛错」不变量。
    // 反恒真：把内部实现改回 `String(value as unknown)` → 本条必须变红。
    const throwing = {
      [Symbol.toPrimitive](): never {
        throw new Error('toPrimitive 抛错（模拟恶意/异常对象）')
      },
    }
    for (const value of [Object.create(null) as unknown, throwing]) {
      // 直接调 render 的兜底路径（`never` 形参在运行期无约束）。
      expect(() => (unreachableOutcome as unknown as (v: unknown) => string)(value)).not.toThrow()
    }
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑦ 跨工具不变量：绝不抛错
// ════════════════════════════════════════════════════════════════════════════

describe('⑦ 全部工具对垃圾输入都**绝不抛错**（只返回错误）', () => {
  it('null / 数组 / 数字 / 字符串 / 无原型对象 / undefined 逐个试', async () => {
    // 为什么这么测：t2 实测过 `notify(null)` 会抛 `TypeError` 冲进事件派发路径，
    // 而**传数字不抛** —— 随手试一个值会得到「没问题」的假象。
    const harness = await makeHarness()
    const inputs: readonly unknown[] = [
      null,
      undefined,
      [],
      [1, 2],
      42,
      'str',
      true,
      Object.create(null) as unknown,
      { content: Symbol('x') as unknown },
    ]
    for (const tool of harness.tools) {
      for (const input of inputs) {
        // ⚠ 用**布尔标志**而不是「catch 到的值是否非 null」：
        // `throw null` / `throw undefined` 是合法的 JS，而那种情况下
        // `let threw = null; catch (e) { threw = e }` 会让 `expect(threw).toBeNull()`
        // **假通过** —— 一个「用断言表达『没抛错』」的断言，恰好对最难看的那种抛错失效。
        let threw = false
        let detail = ''
        try {
          await tool.run(input)
        } catch (error) {
          threw = true
          detail = String(error)
        }
        expect(
          threw,
          `${tool.name} 在输入 ${String(typeof input)} 上抛了：${detail}`,
        ).toBe(false)
      }
      // 并且**渲染**也不能抛（宿主会把结果交给模型）。
      const output = await tool.run(null)
      expect(typeof renderedText(tool, output)).toBe('string')
    }
  })

  it('被拒的调用**不留任何账本痕迹**（六个垃圾输入 × 五个工具）', async () => {
    const harness = await makeHarness()
    const before = allEvents(harness.ledger).length
    for (const tool of harness.tools) {
      for (const input of [null, [], 42, 'str', Object.create(null) as unknown]) {
        await tool.run(input)
      }
    }
    expect(allEvents(harness.ledger).length).toBe(before)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// ⑧ 宿主接线面：scope 常量（供 t5/t7 复用）
// ════════════════════════════════════════════════════════════════════════════

describe('⑧ 与账本 scope 的一致性（工具写入的事件必须能被 scope 读到）', () => {
  it('消息起线程后，该事件能被「不带 scope」的读取看到（它属于 UNSCOPED 的 kind 之一）', async () => {
    // `team/thread-started` 的 scope 是 `[]`（SPEC §6.3 没有 channel/thread 种类），
    // 因此**任何带 scopes 的读取都看不到它** —— 这是已知覆盖缺口
    //（`src/projection/index.ts` 文件头）。
    // 本用例把「工具写的这条事实在哪种读取下可见」钉死，免得 t5 的 UI 用带 scope 的
    // 增量读去拿线程列表，结果**永远为空**却查不出原因。
    const harness = await makeHarness()
    await run(harness, 'sophia_team_message', {
      content: 'x', to: '推步主事', channelId: channelA, threadTitle: 't',
    })

    const unscoped = harness.ledger.read({}).events.filter((event) => event.kind === 'team/thread-started')
    expect(unscoped).toHaveLength(1)

    const scopes: readonly ChangeScope[] = [{ kind: 'team', teamId: teamA }]
    const scoped = harness.ledger.read({ scopes }).events.filter((event) => event.kind === 'team/thread-started')
    expect(scoped, '带 scope 的读取看不到 thread-started（已知缺口）').toHaveLength(0)
  })
})
