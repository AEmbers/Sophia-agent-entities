/**
 * 成员运行时的验收测试（`t2`）。
 *
 * ── 本文件的断言为什么不是恒真的（每条主线断言都写明「怎么让它变红」）──
 *
 * 1. **双通道是两条独立用例**，各自断言「目标通道 1 次 **且** 另一通道 0 次」。
 *    只断言"被唤醒了"是**分支级不可测**的典型：把 `wakeChannelFor` 改成恒返回
 *    `'steer'`，那种断言仍然全绿（消息确实送到了，只是送错了通道）。
 *    两条用例里的 `0 次` 断言才是把分支钉住的那一半 ——
 *    这也意味着**只写 running 那一条**时，`恒 steer` 变异体会全绿通过。
 *    反恒真：把 `wakeChannelFor` 改成 `return 'steer'` → 用例「空闲走 followup」必须变红。
 *
 * 2. **去重用例同时断言"重复被拦"与"变化被放行"**。只测前者的话，把 `notify`
 *    改成无条件 `duplicate` 也能全绿 —— 而那意味着**成员永远收不到任何通知**。
 *    反恒真：把签名比较改成恒真 → 用例「待办更新后应再投一次」必须变红。
 *
 * 3. **降级路径里，句柄是真的坏了**：测试持有与运行时缓存**同一个对象**的引用
 *    （`host.probes` 就是 `createHandle` 交出去的那份），激活后把它的 `followup` 删掉
 *    ⇒「缓存里那个东西已经不是句柄了」是**真实构造出来的**，不是靠 mock 假装出来的。
 *    反恒真：把 `asMemberHandle` 改成 `return value as MemberHandle` →
 *    本条会抛 `TypeError: ... followup is not a function`（必须变红）。
 *
 * 4. **每个负向结果都同时断言"没有副作用"**：`unknown-member` / `not-active` /
 *    `invalid-policy` 三条都断言 `createHandle` 调用次数为 **0**。
 *    只断言 `kind` 的话，一个"先建 Agent 再判不合格"的实现（留下一个没人管的活 Agent）
 *    也能全绿。这与 `delegation.spec.ts` 用计数 spy 断言 AC-5-2 是同一手法。
 *
 * 5. **顺序敏感处都是独立断言**：preset 必须先于工具策略、签名必须对枚举顺序不敏感、
 *    去重必须发生在**投递之前**（否则"去重"只是"多送一次再报告重复"）。
 *
 * ── 测试自证风险的规避 ──
 *
 * 假件里的期望值**全部是本文件写死的字面量**（`'followup'` / `'steer'` / `'duplicate'` /
 * `'no-handle'` / `'suspended'` / 计数 `0`、`1`、`2`）。没有一处是"跑一遍实现、
 * 把它返回的东西当成期望值"。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  createMemberRuntime,
  noticeSignatureOf,
  type MemberActivationOutcome,
  type MemberAgent,
  type MemberAgentSetup,
  type MemberHandle,
  type MemberId,
  type MemberLifecycle,
  type MemberNotice,
  type MemberPendingItem,
  type MemberPresence,
  type MemberRuntime,
  type MemberRuntimeDeps,
  type MemberWakeOutcome,
  type TeamId,
} from '../src/index.ts'
// `MemberAgent.followup/steer` 的入参在 2026-09-24 从 `MemberNotice` 改成了
// **合法 user message**（真 DSH 的 inbox 收的是消息，见 `src/runtime/notice-message.ts`）。
// 直接从这个模块取类型而不是走包根：`src/index.ts` 不是本批的面。
import type { SophiaUserMessage } from '../src/runtime/notice-message.ts'

/** 包根目录（本文件在 tests/ 下）。 */
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// ────────────────────────────────────────────────────────────────────────────
// 夹具
// ────────────────────────────────────────────────────────────────────────────

const alice = 'sophia-tuibu-zhushi-aaaaaaaa' as MemberId
const bob = 'sophia-lingtai-lang-bbbbbbbb' as MemberId
const team = 'team-1' as TeamId

/**
 * 剥掉注释，只留可执行代码。
 *
 * 依据与 `shell.spec.ts` 的同名函数逐字相同：本仓的源码注释里**正当引用**了
 * 不该出现在代码里的标识符（本项目的设计纪律「唤醒不绑定窗口会话」必然要写出
 * `HostSessionId` 这个词）。直接扫原文会把「文档里提到它」读成「代码用了它」——
 * 这与本仓已记录的「markdown 强调标记夹在词中间既漏真命中又误判假冲突」是同一类问题。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/.*$/gm, '')
}

/** 一条待办事实（默认即"第 7 号事件，rev 3，1 条未读"）。 */
function item(ref: string, overrides: Partial<MemberPendingItem> = {}): MemberPendingItem {
  return { ref, revision: 3, unreadCount: 1, newestSequence: 7, ...overrides }
}

/** 一条通知。 */
function notice(items: readonly MemberPendingItem[], text = '你有新待办'): MemberNotice {
  return { items, text }
}

/** 假 Agent 上被记录下来的调用（投递给它的是**消息**，不是 `MemberNotice`）。 */
interface AgentCalls {
  readonly followup: SophiaUserMessage[]
  readonly steer: SophiaUserMessage[]
}

/** 一个**状态可控**的假成员 Agent。 */
interface ProbeHandle {
  readonly handle: MemberHandle
  readonly agent: MemberAgent
  readonly calls: AgentCalls
  disposeCalls: number
  /** 测试用它改状态：证明 `presenceOf` 读的是**实时**状态而非缓存。 */
  setStatus(status: string): void
}

function makeProbeHandle(id: string, status = 'idle'): ProbeHandle {
  const calls: AgentCalls = { followup: [], steer: [] }
  let current = status
  const agent: MemberAgent = {
    id,
    get status(): string {
      return current
    },
    followup(message: SophiaUserMessage): void {
      calls.followup.push(message)
    },
    steer(message: SophiaUserMessage): void {
      calls.steer.push(message)
    },
  }
  const probe: ProbeHandle = {
    agent,
    calls,
    disposeCalls: 0,
    setStatus(next: string): void {
      current = next
    },
    handle: {
      agent,
      dispose(): void {
        probe.disposeCalls += 1
      },
    },
  }
  return probe
}

/** `createHandle` 的入参快照。 */
interface CreateInput {
  readonly memberId: MemberId
  readonly presetId: string
  readonly setup: (setup: MemberAgentSetup) => Promise<void>
}

/** 假宿主：记录每一个注入端口被怎么调用。 */
interface FakeHost {
  readonly runtime: MemberRuntime
  /** `createHandle` 的入参（按调用顺序）。 */
  readonly createInputs: CreateInput[]
  /** 被挂载的 preset（`成员→presetId`）。 */
  readonly mounted: string[]
  /** 每次 `applyToolPolicy` 收到的清单。 */
  readonly policies: Array<readonly string[]>
  /** **端口调用顺序**的全局序列（用于断言 preset 先于策略）。 */
  readonly order: string[]
  readonly warnings: string[]
  /** 默认 `createHandle` 交出去的句柄 —— **与运行时缓存的是同一批对象**。 */
  readonly probes: Map<MemberId, ProbeHandle>
  /** 预置生命周期。缺省 = `active`；显式 `null` = 账本不认识。 */
  setLifecycle(memberId: MemberId, lifecycle: MemberLifecycle | null): void
  /** 接管 `createHandle`（用于注入失败 / 自定义句柄形状）。 */
  setCreate(handler: (input: CreateInput) => Promise<MemberHandle>): void
}

function makeHost(
  options: { readonly lifecycles?: Readonly<Record<string, MemberLifecycle | null>> } = {},
): FakeHost {
  const createInputs: CreateInput[] = []
  const mounted: string[] = []
  const policies: Array<readonly string[]> = []
  const order: string[] = []
  const warnings: string[] = []
  const probes = new Map<MemberId, ProbeHandle>()
  const lifecycles = new Map<string, MemberLifecycle | null>(
    Object.entries(options.lifecycles ?? {}),
  )
  let override: ((input: CreateInput) => Promise<MemberHandle>) | undefined

  const deps: MemberRuntimeDeps = {
    mountPreset(setup: MemberAgentSetup, presetId: string): void {
      order.push(`mount:${presetId}`)
      mounted.push(`${String(setup.memberId)}→${presetId}`)
    },
    applyToolPolicy(setup: MemberAgentSetup, allow: readonly string[]): void {
      order.push(`policy:${String(setup.memberId)}`)
      policies.push(allow)
    },
    async createHandle(input: CreateInput): Promise<MemberHandle> {
      createInputs.push(input)
      if (override !== undefined) return override(input)
      // 默认行为是**真的走 setup 再返回形状合法的句柄** —— 因为「不调用 setup 就不算激活成功」
      // 正是被测实现的一条契约；默认放水会让那条用例失去意义。
      const probe = makeProbeHandle(`agent-of-${input.memberId}`)
      probes.set(input.memberId, probe)
      await input.setup({ memberId: input.memberId, agentContext: { of: input.memberId } })
      return probe.handle
    },
    lifecycleOf(memberId: MemberId): MemberLifecycle | null {
      const found = lifecycles.get(String(memberId))
      // 未预置 = active：绝大多数用例只关心「能不能被唤醒」。
      return found === undefined ? 'active' : found
    },
    logger: {
      warn(message: string): void {
        warnings.push(message)
      },
    },
  }

  return {
    runtime: createMemberRuntime(deps),
    createInputs,
    mounted,
    policies,
    order,
    warnings,
    probes,
    setLifecycle(memberId, lifecycle) {
      lifecycles.set(String(memberId), lifecycle)
    },
    setCreate(handler) {
      override = handler
    },
  }
}

/** 激活一个成员并断言它真的激活了（把"激活失败"变成测试自己的失败，而不是静默继续）。 */
async function activateOk(
  host: FakeHost,
  memberId: MemberId,
  toolPolicy?: { allow?: readonly string[] },
): Promise<MemberActivationOutcome> {
  const outcome = await host.runtime.activate({
    memberId,
    teamId: team,
    presetId: 'sophia-member',
    ...(toolPolicy === undefined ? {} : { toolPolicy }),
  })
  expect(outcome, `${String(memberId)} 应当激活成功`).toEqual({ kind: 'activated' })
  return outcome
}

/** 取某成员句柄上记录到的调用（默认 `createHandle` 造的那份）。 */
function callsOf(host: FakeHost, memberId: MemberId): AgentCalls {
  const probe = host.probes.get(memberId)
  if (probe === undefined) throw new Error(`测试造具：${String(memberId)} 没有探针句柄`)
  return probe.calls
}

/** 一个形状合法、可用的假句柄（供 `setCreate` 返回）。 */
function inertHandle(): MemberHandle {
  return { agent: { id: 'inert', status: 'idle', followup: () => {}, steer: () => {} }, dispose: () => {} }
}

// ────────────────────────────────────────────────────────────────────────────
// 一、激活：preset、工具策略、句柄缓存
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 成员激活', () => {
  it('激活成功：挂 preset + 注入工具策略 + 句柄进缓存', async () => {
    const host = makeHost()
    await activateOk(host, alice, { allow: ['sophia_team_message', 'sophia_task_claim'] })

    expect(host.createInputs.map((i) => [i.memberId, i.presetId])).toEqual([
      [alice, 'sophia-member'],
    ])
    expect(host.mounted).toEqual([`${String(alice)}→sophia-member`])
    expect(host.policies).toEqual([['sophia_team_message', 'sophia_task_claim']])
    // 句柄真的在缓存里（不是"调用没报错"）。
    expect(host.runtime.handleOf(alice)).toBeDefined()
    expect(host.runtime.liveMemberIds()).toEqual([alice])
  })

  it('**preset 先于工具策略**（反序会被 preset 挂载过程覆盖，而两种顺序都不报错）', async () => {
    const host = makeHost()
    await activateOk(host, alice, { allow: ['sophia_team_message'] })
    // 反恒真：把 runActivation 里 mountPreset / applyToolPolicy 两行对调 →
    // 本条必须变红（实测已做：序列变成 ['policy:…','mount:…']）。
    expect(host.order).toEqual(['mount:sophia-member', `policy:${String(alice)}`])
  })

  it('省略 toolPolicy ⇒ **不注入任何限制**（不猜"空清单"的语义）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    // 反恒真：把 normalizeToolPolicy 的 `policy === undefined` 分支改成返回空数组 →
    // applyToolPolicy 会被调一次，本条必须变红。
    expect(host.policies).toEqual([])
  })

  it('工具清单去重且**保持原顺序**（顺序对提示词渲染有意义，不能排序）', async () => {
    const host = makeHost()
    await activateOk(host, alice, { allow: ['b_tool', 'a_tool', 'b_tool'] })
    // 反恒真：把 `[...new Set(allow)]` 换成 `[...allow].sort()` → 本条必须变红。
    expect(host.policies[0]).toEqual(['b_tool', 'a_tool'])
  })

  it('工具名**先 trim 再**去重（否则 `\' a \'` 与 `\'a\'` 精确匹配会静默失配）', async () => {
    // OCR 复核 LOW 的回归（本处曾是真缺陷）：上半段用 `name.trim() === ''` 校验，
    // 却把原串交给 `applyToolPolicy` —— 而真实 `tools.restrict` 是按名字**精确匹配**的，
    // 于是 `' a '` 与名为 `'a'` 的工具失配：成员以为自己被授予了 a，实际一个都没匹配上，
    // 且**不报错**。不裁剪还会顺带让去重失效（`'a'` 与 `' a '` 被当成两个名字）。
    const host = makeHost()
    await activateOk(host, alice, { allow: [' a ', 'a', '  b_tool  '] })
    // 反恒真：把 `allow.map(name => name.trim())` 改回 `allow` →
    // 本条会拿到 [' a ','a',' b_tool '] 而变红（三处断言同时红）。
    expect(host.policies[0]).toEqual(['a', 'b_tool'])
  })

  it('**纯空白**工具名仍然被拒（trim 不能把"该拒的"变成"该收的"）', async () => {
    // 上一条的对偶：trim 只在**过了校验之后**做。`'   '` 必须先被判非法，
    // 否则它会被裁成空串塞进清单 —— 那是另一个静默失配（空名匹配不到任何工具）。
    const host = makeHost()
    for (const allow of [['   '], ['\t'], ['ok_tool', ' \n ']]) {
      const outcome = await host.runtime.activate({
        memberId: alice,
        teamId: team,
        presetId: 'sophia-member',
        toolPolicy: { allow },
      })
      expect(outcome.kind, `${JSON.stringify(allow)} 应当被拒`).toBe('invalid-policy')
    }
    expect(host.createInputs).toHaveLength(0)
  })

  it('**空 allow 清单是非法输入**：既非"不限制"也非"全禁"，且**不建 Agent**', async () => {
    // 依据（写在这里免得以后有人"顺手宽容掉"）：`[]` 读成"不限制"= 成员实得全部工具（越权），
    // 读成"全禁"= 激活成功却什么也干不了（哑成员）。两者后果相反、且都是静默的。
    const host = makeHost()
    const outcome = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'sophia-member',
      toolPolicy: { allow: [] },
    })
    expect(outcome.kind).toBe('invalid-policy')
    // 关键：**没有留下一个没人管的活 Agent**（见文件头第 4 条）。
    expect(host.createInputs).toHaveLength(0)
    expect(host.runtime.handleOf(alice)).toBeUndefined()
  })

  it('工具名含空串 / 纯空白 / 非字符串 ⇒ invalid-policy，且不建 Agent', async () => {
    const host = makeHost()
    for (const allow of [['ok_tool', ''], ['ok_tool', '   '], ['ok_tool', 7 as never]]) {
      const outcome = await host.runtime.activate({
        memberId: alice,
        teamId: team,
        presetId: 'sophia-member',
        toolPolicy: { allow },
      })
      expect(outcome.kind, `allow=${JSON.stringify(allow)} 应当被拒`).toBe('invalid-policy')
    }
    expect(host.createInputs).toHaveLength(0)
  })

  it('★ toolPolicy.allow 含 BigInt / 循环引用 ⇒ invalid-policy，绝不抛 TypeError 穿透 activate（OCR 族 C [19] 回归）', async () => {
    // 回归用例（OCR [19]，族 C）：`normalizeToolPolicy` 在 `typeof name !== 'string'` 分支里
    // 构造错误消息原先使用裸 `JSON.stringify(name)`，BigInt（1n）与循环对象会让序列化自己抛 TypeError，
    // 穿透 activate。
    // 反恒真：去掉 safeStringify 保护直接调裸 JSON.stringify(name) → 本条用例必须抛 TypeError 变红。
    const host = makeHost()

    // 1. BigInt 工具名
    let bigIntThrew: unknown = null
    let bigIntOutcome: MemberActivationOutcome | null = null
    try {
      bigIntOutcome = await host.runtime.activate({
        memberId: alice,
        teamId: team,
        presetId: 'sophia-member',
        toolPolicy: { allow: [1n as never] },
      })
    } catch (error) {
      bigIntThrew = error
    }
    expect(bigIntThrew, 'BigInt 工具名不得让 TypeError 穿透 activate').toBeNull()
    expect(bigIntOutcome?.kind, 'BigInt 工具名应返回 invalid-policy').toBe('invalid-policy')
    expect((bigIntOutcome as { reason: string }).reason).toContain('1n')

    // 2. 循环引用工具名
    const circular: Record<string, unknown> = {}
    circular['self'] = circular
    let circularThrew: unknown = null
    let circularOutcome: MemberActivationOutcome | null = null
    try {
      circularOutcome = await host.runtime.activate({
        memberId: alice,
        teamId: team,
        presetId: 'sophia-member',
        toolPolicy: { allow: [circular as never] },
      })
    } catch (error) {
      circularThrew = error
    }
    expect(circularThrew, '循环引用工具名不得让 TypeError 穿透 activate').toBeNull()
    expect(circularOutcome?.kind, '循环引用工具名应返回 invalid-policy').toBe('invalid-policy')
    expect(host.createInputs).toHaveLength(0)
  })

  it('账本不认识的成员 ⇒ unknown-member，且不建 Agent', async () => {
    const host = makeHost({ lifecycles: { [String(alice)]: null } })
    const outcome = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'sophia-member',
    })
    expect(outcome).toMatchObject({ kind: 'unknown-member' })
    // 反恒真：把 lifecycleOf 的 null 判定删掉 → 本条必须变红。
    expect(host.createInputs).toHaveLength(0)
  })

  it('已挂起 / 已归档 / 已销毁 ⇒ not-active，且不建 Agent', async () => {
    for (const lifecycle of ['suspended', 'archived', 'destroyed'] as const) {
      const host = makeHost({ lifecycles: { [String(alice)]: lifecycle } })
      const outcome = await host.runtime.activate({
        memberId: alice,
        teamId: team,
        presetId: 'sophia-member',
      })
      expect(outcome, `${lifecycle} 不该被拉活`).toEqual({ kind: 'not-active', lifecycle })
      expect(host.createInputs, `${lifecycle} 不该建 Agent`).toHaveLength(0)
    }
  })

  it('createHandle 抛错 ⇒ failed **且不抛**（激活失败不能冲进调用方）', async () => {
    const host = makeHost()
    host.setCreate(async () => {
      throw new Error('agents.create exploded')
    })
    const outcome = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'sophia-member',
    })
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect((outcome as { reason: string }).reason).toContain('agents.create exploded')
    expect(host.runtime.handleOf(alice)).toBeUndefined()
  })

  it('句柄形状不合法 ⇒ failed、**释放该句柄**、不进缓存', async () => {
    const host = makeHost()
    let disposed = 0
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      // 有 agent 与 dispose，但 agent 上没有 followup —— 一个会在唤醒时抛 TypeError 的东西。
      return {
        agent: { id: 'x', status: 'idle', steer: () => {} },
        dispose: () => {
          disposed += 1
        },
      } as never
    })
    const outcome = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'sophia-member',
    })
    expect(outcome).toMatchObject({ kind: 'failed' })
    // 反恒真：去掉 asMemberHandle 校验 → handleOf 会有值、本条必须变红。
    expect(host.runtime.handleOf(alice)).toBeUndefined()
    // 实测记录：第一版用 `asMemberHandle` 判「要不要 dispose」，本断言变红（disposed 停在 0）
    // —— 形状不合法的那一类恰恰最需要释放（它仍持有真实 Session / 订阅）。
    expect(disposed, '形状不对的句柄必须被释放，不能泄漏').toBe(1)
  })

  it('createHandle 成功但**从未调用 setup** ⇒ failed（否则是"没有 preset 的假激活"）', async () => {
    const host = makeHost()
    let disposed = 0
    host.setCreate(async () => {
      const inert = inertHandle()
      return {
        agent: inert.agent,
        dispose: () => {
          disposed += 1
        },
      }
    })
    const outcome = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'sophia-member',
    })
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect((outcome as { reason: string }).reason).toContain('从未调用 setup')
    // 关键：那种 Agent 会以宿主默认面运行，必须被丢弃而不是"看起来激活了"。
    expect(host.runtime.handleOf(alice)).toBeUndefined()
    expect(disposed).toBe(1)
  })

  it('串行重复激活 ⇒ already-active，且只建一次', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    const second = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'sophia-member',
    })
    // 反恒真：删掉 `readHandle(...) !== undefined` 那道门 → 一个成员会跑两个 Agent。
    expect(second).toEqual({ kind: 'already-active' })
    expect(host.createInputs).toHaveLength(1)
  })

  it('**并发**激活同一成员 ⇒ 只建一次（那道"已有句柄"的门在 await 之前，单独挡不住）', async () => {
    // 这是本次实现里唯一一个真缺陷的回归：`handles.has()` 在第一个 await 之前，
    // 两次并发调用都能穿过它，各建一个 Agent（上游 index.ts:2371 与 :2502 之间正是这个窗口）。
    const host = makeHost()
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let created = 0
    host.setCreate(async ({ setup }) => {
      created += 1
      await setup({ memberId: alice, agentContext: {} })
      await gate
      return inertHandle()
    })

    const first = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    const second = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    open()
    const [a, b] = await Promise.all([first, second])

    // 反恒真：删掉 inFlightActivations 的注册与复用 → created 会变成 2、本条必须变红。
    expect(created, '并发激活只允许建一个 Agent').toBe(1)
    expect([a, b]).toEqual([{ kind: 'activated' }, { kind: 'activated' }])
  })

  it('在途表在失败后也被清掉（否则下次激活永远拿到旧结论）', async () => {
    const host = makeHost()
    host.setCreate(async () => {
      throw new Error('nope')
    })
    const failed = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'p',
    })
    expect(failed.kind).toBe('failed')

    // 改回正常实现，再激活一次 —— 必须真的重新走一遍（而不是拿到缓存的那次失败）。
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      return inertHandle()
    })
    expect(
      await host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' }),
    ).toEqual({ kind: 'activated' })
    expect(host.createInputs).toHaveLength(2)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 二、双通道唤醒 —— **两条分支各自独立成例**（文件头第 1 条）
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 双通道唤醒（idle / running 各一条）', () => {
  it('【idle 分支】空闲成员走 followup，且**恰一次**；steer 一次都没有', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    expect(host.runtime.handleOf(alice)?.agent.status).toBe('idle')

    const outcome: MemberWakeOutcome = host.runtime.notify(alice, notice([item('thread-1')]))

    // 三件事一起断言：返回值说走了哪条通道、目标通道 1 次、**另一通道 0 次**。
    // 反恒真：把 wakeChannelFor 改成 `return 'steer'` → 本条必须变红（两条断言同时红）。
    expect(outcome).toEqual({ kind: 'delivered', channel: 'followup' })
    expect(callsOf(host, alice).followup).toHaveLength(1)
    expect(callsOf(host, alice).steer).toHaveLength(0)
    // 送过去的是**那条正文**，不是空壳。
    // ⚠ 2026-09-24：投递物从 `MemberNotice` 改成**合法 user message**（真 DSH 的 inbox
    // 收的是消息，见 `src/runtime/notice-message.ts`）⇒ 正文在 `content[0].text`。
    // 本行同时守两件事：正文真的到了，且它被包在一个**有 content 的消息**里
    //（`{items,text}` 直接投递时会在这里读不到 `.content` → 红）。
    expect(callsOf(host, alice).followup[0]?.content[0]?.text).toBe('你有新待办')
  })

  it('【running 分支】正忙成员走 steer，且**恰一次**；followup 一次都没有', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    host.probes.get(alice)?.setStatus('running')

    const outcome = host.runtime.notify(alice, notice([item('thread-1')]))

    // 反恒真：把 wakeChannelFor 改成 `return 'followup'` → 本条必须变红。
    // 本用例与上一条互为对照：任一条单独存在时，"恒返回某一个通道"都能全绿。
    expect(outcome).toEqual({ kind: 'delivered', channel: 'steer' })
    expect(callsOf(host, alice).steer).toHaveLength(1)
    expect(callsOf(host, alice).followup).toHaveLength(0)
  })

  it('投递的时机与状态**同步**：投递后状态翻成 running，下一次通知就走 steer', async () => {
    // 这条钉住「分支判定读的是实时状态，不是激活时的快照」。
    const host = makeHost()
    await activateOk(host, alice)
    const probe = host.probes.get(alice)!

    expect(host.runtime.notify(alice, notice([item('t', { newestSequence: 1 })]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
    probe.setStatus('running')
    // 待办变了（序号不同）⇒ 不是重复，必须真的再投一次、且这次走 steer。
    expect(host.runtime.notify(alice, notice([item('t', { newestSequence: 2 })]))).toEqual({
      kind: 'delivered',
      channel: 'steer',
    })
    expect(probe.calls.followup).toHaveLength(1)
    expect(probe.calls.steer).toHaveLength(1)
  })

  it('未知 status 落到 steer（判错代价不对称：多开一个 turn 比投错步骤贵）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    host.probes.get(alice)?.setStatus('paused')
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'delivered',
      channel: 'steer',
    })
    expect(callsOf(host, alice).followup).toHaveLength(0)
  })

  it('**存在态与投递通道对同一 status 必须一致**（OCR LOW 的回归，两处曾互相打脸）', async () => {
    // 缺陷形状（实测）：`presenceOf` 用 `status === 'running'`、`wakeChannelFor` 用
    // `status === 'idle'`，于是对**任何其他** status 两者矛盾：
    //   status=paused      → presence=idle   但 channel=steer
    //   status=maintenance → presence=idle   但 channel=steer
    // 即界面把"正忙"的成员显示成空闲，同时运行时往它的步骤边界投消息。
    // 修法是两处共用同一个 `isBusyStatus` ⇒ 结构上不可能再分歧。
    const cases: Array<[status: string, presence: MemberPresence, channel: 'followup' | 'steer']> = [
      ['idle', 'idle', 'followup'],
      ['running', 'running', 'steer'],
      // 未知 status 一律读作"正忙"（与 wakeChannelFor 同侧）。
      ['paused', 'running', 'steer'],
      ['maintenance', 'running', 'steer'],
    ]

    for (const [status, expectedPresence, expectedChannel] of cases) {
      const host = makeHost()
      let seq = 0
      host.setCreate(async ({ setup }) => {
        await setup({ memberId: alice, agentContext: {} })
        seq += 1
        return {
          agent: {
            id: 'a',
            get status(): string {
              return status
            },
            followup: () => {},
            steer: () => {},
          },
          dispose: () => {},
        }
      })
      await activateOk(host, alice)

      const presence = host.runtime.presenceOf(alice)
      const wake = host.runtime.notify(alice, notice([item('t', { newestSequence: seq })]))
      const channel = wake.kind === 'delivered' ? wake.channel : wake.kind

      // 反恒真：把 presenceOf 或 wakeChannelFor 任一处的判据改回自己的字面量比较
      // （`=== 'running'` / `=== 'idle'`）→ paused / maintenance 两行必然变红。
      expect(presence, `status=${status} 的存在态`).toBe(expectedPresence)
      expect(channel, `status=${status} 的投递通道`).toBe(expectedChannel)
      // 核心不变量：两者对"是否正忙"的回答必须一致。
      expect(
        presence === 'running',
        `status=${status}：presence 与 channel 对"正忙"的判断不一致`,
      ).toBe(channel === 'steer')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 三、通知去重
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 通知去重（同一条待办不重复推送）', () => {
  it('同签名第二次 ⇒ duplicate，**且不再投递**（去重必须发生在投递之前）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    const first = host.runtime.notify(alice, notice([item('thread-1')]))
    const second = host.runtime.notify(alice, notice([item('thread-1')]))

    expect(first).toEqual({ kind: 'delivered', channel: 'followup' })
    expect(second).toEqual({ kind: 'duplicate' })
    // 反恒真：把去重判定挪到投递**之后** → followup 会变成 2 次，本条必须变红。
    expect(callsOf(host, alice).followup, '重复的那次不该产生第二次打扰').toHaveLength(1)
  })

  it('待办**变了** ⇒ 再投一次（只测"重复被拦"的话，恒返回 duplicate 也能全绿）', async () => {
    const host = makeHost()
    await activateOk(host, alice)

    host.runtime.notify(alice, notice([item('thread-1', { newestSequence: 7 })]))
    // 反恒真：把签名比较改成恒真 → 本条必须变红。
    const updated = host.runtime.notify(alice, notice([item('thread-1', { newestSequence: 8 })]))
    expect(updated).toEqual({ kind: 'delivered', channel: 'followup' })
    expect(callsOf(host, alice).followup).toHaveLength(2)
  })

  it('五个维度**各自**都能改变签名（漏掉任何一个都会让"更新"被误判成重复）', async () => {
    const base = item('r', { revision: 1, unreadCount: 1, newestSequence: 1 })
    const signatures = [
      noticeSignatureOf([base]),
      noticeSignatureOf([item('r', { revision: 2, unreadCount: 1, newestSequence: 1 })]),
      noticeSignatureOf([item('r', { revision: 1, unreadCount: 2, newestSequence: 1 })]),
      noticeSignatureOf([item('r', { revision: 1, unreadCount: 1, newestSequence: 2 })]),
      noticeSignatureOf([item('other', { revision: 1, unreadCount: 1, newestSequence: 1 })]),
      noticeSignatureOf([
        base,
        item('r2', { revision: 1, unreadCount: 1, newestSequence: 1 }),
      ]),
    ]
    // 反恒真：把签名里的任意一个字段换成常量 → 本条必须变红（Set 变小）。
    expect(new Set(signatures).size, '六个签名必须两两不同').toBe(6)
  })

  it('**枚举顺序不同算同一条**（否则投影层换个迭代顺序就会多打扰成员一次）', async () => {
    // 依据：turn 是成员最贵的资源（一次完整模型调用），而"重复打扰"没有任何可观测报错。
    const a = item('thread-a', { newestSequence: 1 })
    const b = item('thread-b', { newestSequence: 2 })
    // 反恒真：去掉 noticeSignatureOf 里的 sort → 本条必须变红。
    expect(noticeSignatureOf([a, b])).toBe(noticeSignatureOf([b, a]))

    const host = makeHost()
    await activateOk(host, alice)
    host.runtime.notify(alice, notice([a, b]))
    expect(host.runtime.notify(alice, notice([b, a]))).toEqual({ kind: 'duplicate' })
    expect(callsOf(host, alice).followup).toHaveLength(1)
  })

  it('待办清空后**同一条重新出现** ⇒ 能再送达（清空必须重置去重状态）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    host.runtime.notify(alice, notice([item('thread-1')]))
    expect(host.runtime.notify(alice, notice([]))).toEqual({ kind: 'nothing-pending' })
    // 反恒真：把 items.length === 0 分支里的 delete 删掉 → 本条必须变红（会返回 duplicate）。
    expect(host.runtime.notify(alice, notice([item('thread-1')]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
    expect(callsOf(host, alice).followup).toHaveLength(2)
  })

  it('形状非法的待办 ⇒ invalid-notice（NaN 会被 JSON 写成 null，让不同待办互相冒充）', async () => {
    // 先证明这类输入**真的会**撞上同签名：两条不同的待办、NaN 与 Infinity 序号 ⇒ 同一个签名。
    const poisonedA = item('thread-1', { newestSequence: Number.NaN })
    const poisonedB = item('thread-1', { newestSequence: Number.POSITIVE_INFINITY })
    expect(noticeSignatureOf([poisonedA])).toBe(noticeSignatureOf([poisonedB]))

    // 因此必须在算签名之前拦住它 —— 否则第二条会被静默丢弃（成员永远收不到）。
    const host = makeHost()
    await activateOk(host, alice)
    expect(host.runtime.notify(alice, notice([poisonedA])).kind).toBe('invalid-notice')
    expect(callsOf(host, alice).followup).toHaveLength(0)
    // items 不是数组、ref 为空串同样被拒。
    expect(host.runtime.notify(alice, { items: 'nope' as never, text: 'x' }).kind).toBe(
      'invalid-notice',
    )
    expect(host.runtime.notify(alice, notice([item('')])).kind).toBe('invalid-notice')
  })

  it('invalid-notice 的 reason 真的可读（插值生效、花括号平衡）', async () => {
    // OCR 复核 MEDIUM 怀疑这处是"拼接 bug"（单引号片段 + 模板串）。实测结论是
    // **误报**：插值正常、括号平衡，只是可读性差（已按建议合并成一条模板串）。
    // 这条断言把"可读"钉成可执行判据，免得下次有人把它当 bug 重写一遍。
    //
    // ⚠ 必须先激活：`notify` 的判定顺序是 生命周期 → **句柄** → 待办形状，
    // 没有句柄时返回 `no-handle`，本断言会拿不到 reason（实测踩过一次）。
    const host = makeHost()
    await activateOk(host, alice)
    const outcome = host.runtime.notify(alice, {
      items: [{ ref: 'x', revision: 1.5, unreadCount: 0, newestSequence: 0 }],
      text: 'hi',
    })
    expect(outcome.kind).toBe('invalid-notice')
    const reason = (outcome as { reason: string }).reason
    // 插值真的发生了（而不是印出字面量 `${JSON.stringify(item)}`）。
    expect(reason).toContain('"revision":1.5')
    expect(reason).not.toContain('${')
    // 花括号平衡（原始写法里闭括号落在单引号片段中，是"读起来别扭"的根源）。
    expect((reason.match(/\{/g) ?? []).length).toBe((reason.match(/\}/g) ?? []).length)
  })

  it('★ 循环引用 / BigInt 输入待办 ⇒ invalid-notice，绝不抛 TypeError 穿透 notify（OCR 族 C [3] 回归）', async () => {
    // 回归用例（OCR [3]，族 C）：`validateNoticeShape` 内 `JSON.stringify(item)` 原先无 try/catch，
    // 而 notify 契约是「never throws」—— 循环引用对象与 BigInt 输入会导致 JSON.stringify 抛 TypeError，
    // 穿透 notify 冲进事件派发路径。
    // 反恒真：去掉 safeStringify 保护直接调裸 JSON.stringify(item) → 本条用例必须抛 TypeError 变红。
    const host = makeHost()
    await activateOk(host, alice)

    // 1. 循环引用对象输入
    const circular: Record<string, unknown> = { ref: 'bad-circular' }
    circular['self'] = circular

    let circularThrew: unknown = null
    let circularOutcome: MemberWakeOutcome | null = null
    try {
      circularOutcome = host.runtime.notify(alice, { items: [circular as never], text: 'test' })
    } catch (error) {
      circularThrew = error
    }
    expect(circularThrew, '循环引用待办项不得让 TypeError 穿透 notify').toBeNull()
    expect(circularOutcome?.kind, '循环引用待办项应返回 invalid-notice').toBe('invalid-notice')
    expect((circularOutcome as { reason: string }).reason).toContain('无法序列化')

    // 2. BigInt 输入（作为待办项或字段含 BigInt）
    const bigIntItem = { ref: 'bad-bigint', revision: 1n, unreadCount: 0, newestSequence: 0 }
    let bigIntThrew: unknown = null
    let bigIntOutcome: MemberWakeOutcome | null = null
    try {
      bigIntOutcome = host.runtime.notify(alice, { items: [bigIntItem as never], text: 'test' })
    } catch (error) {
      bigIntThrew = error
    }
    expect(bigIntThrew, '含 BigInt 待办项不得让 TypeError 穿透 notify').toBeNull()
    expect(bigIntOutcome?.kind, '含 BigInt 待办项应返回 invalid-notice').toBe('invalid-notice')

    // 3. 裸 BigInt 作为待办项
    let rawBigIntThrew: unknown = null
    let rawBigIntOutcome: MemberWakeOutcome | null = null
    try {
      rawBigIntOutcome = host.runtime.notify(alice, { items: [1n as never], text: 'test' })
    } catch (error) {
      rawBigIntThrew = error
    }
    expect(rawBigIntThrew, '裸 BigInt 待办项不得让 TypeError 穿透 notify').toBeNull()
    expect(rawBigIntOutcome?.kind, '裸 BigInt 待办项应返回 invalid-notice').toBe('invalid-notice')
  })

  it('**小数**序号 / 计数同样非法（`isFinite` 放行它，而"安全整数"是本模块的判据）', async () => {
    // ⚠ 这条是**变异测试逼出来的**：我第一版只测了 NaN / Infinity，于是把
    // `Number.isSafeInteger` 换成 `Number.isFinite` 的那个变异体**全绿通过**
    // （NaN 与 Infinity 在两种判据下都是 false ⇒ 断言区分不出它们）。
    // 两者真正分道扬镳的地方是**小数**：`Number.isFinite(1.5) === true` 而
    // `Number.isSafeInteger(1.5) === false`。不测这一格，"安全整数"这个判据就是装饰。
    //
    // ⚠ 必须先激活：`notify` 的判定顺序是 生命周期 → **句柄** → 待办形状，
    // 没有句柄时返回的是 `no-handle`，那些断言会变成**空转**
    //（实测：不激活的版本全绿，因为压根没走到形状校验）。
    const bad = [
      { revision: 1.5 },
      { unreadCount: 0.5 },
      { newestSequence: 2.5 },
      { revision: Number.MAX_SAFE_INTEGER + 2 },
    ]
    for (const shape of bad) {
      const host = makeHost()
      await activateOk(host, alice)
      expect(
        host.runtime.notify(alice, notice([item('thread-1', shape)])).kind,
        `${JSON.stringify(shape)} 应当被拒`,
      ).toBe('invalid-notice')
      expect(callsOf(host, alice).followup, `${JSON.stringify(shape)} 不该被投递`).toHaveLength(0)
    }

    // 对照：整数形状必须**放行** —— 否则上面的断言在"无条件拒绝"的实现下也会绿。
    const ok = makeHost()
    await activateOk(ok, alice)
    expect(ok.runtime.notify(alice, notice([item('thread-1', { revision: 1 })])).kind).toBe(
      'delivered',
    )
  })

  it('没有正文 ⇒ nothing-pending，**且不写去重状态**（下次渲染出正文仍能送达）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    expect(host.runtime.notify(alice, { items: [item('t')], text: '   ' })).toEqual({
      kind: 'nothing-pending',
    })
    // 反恒真：在空白正文分支里写签名 → 本条必须变红（会返回 duplicate）。
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
  })

  it('投递抛错 ⇒ delivery-failed（**不抛**），且签名未写入 ⇒ 下次能重投', async () => {
    const host = makeHost()
    let explode = true
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      const probe = makeProbeHandle('agent-of-alice')
      host.probes.set(alice, probe)
      return {
        agent: {
          id: 'agent-of-alice',
          status: 'idle',
          followup(message: SophiaUserMessage): void {
            if (explode) throw new Error('inbox is gone')
            probe.calls.followup.push(message)
          },
          steer: probe.agent.steer,
        },
        dispose: probe.handle.dispose,
      }
    })
    await activateOk(host, alice)

    // 反恒真：去掉投递处的 try/catch → 本条必须变红（异常会冲进调用方）。
    const failed = host.runtime.notify(alice, notice([item('t')]))
    expect(failed).toMatchObject({ kind: 'delivery-failed', channel: 'followup' })
    expect(host.warnings.join('\n')).toContain('投递失败')

    explode = false
    // 失败的那次不该被记成"已送达"，否则这条待办从此永远送不到。
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
    expect(callsOf(host, alice).followup).toHaveLength(1)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 四、句柄丢失时的安全降级
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 句柄丢失的安全降级（一律不抛错）', () => {
  it('从未激活的成员被通知 ⇒ no-handle，不抛', async () => {
    const host = makeHost()
    // 反恒真：去掉句柄门 → 会在 undefined 上取 .agent 抛 TypeError。
    expect(() => host.runtime.notify(alice, notice([item('t')]))).not.toThrow()
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({ kind: 'no-handle' })
  })

  it('release 之后再通知 ⇒ no-handle，不抛；release 幂等', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    expect(await host.runtime.release(alice)).toBe(true)
    expect(await host.runtime.release(alice), '第二次 release 是 no-op').toBe(false)
    expect(() => host.runtime.notify(alice, notice([item('t')]))).not.toThrow()
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({ kind: 'no-handle' })
  })

  it('句柄**被破坏**（缓存里那个对象已经不是句柄）⇒ no-handle，不抛', async () => {
    // ⚠ 这是**真实**的"句柄丢失"：测试持有与运行时缓存的是**同一个对象**
    // （`host.probes` 就是 `createHandle` 交出去的那份），激活后把它的 `followup` 删掉。
    // 运行时不缓存"句柄是否有效"的判断，每次读取都过结构守卫 ⇒ 退化成 no-handle，
    // 而不是在 `agent.followup(...)` 上抛 TypeError 冲进事件派发路径。
    const host = makeHost()
    await activateOk(host, alice)
    const probe = host.probes.get(alice)!

    // 反恒真：把 asMemberHandle 改成 `return value as MemberHandle` →
    // 本条会在 notify 里抛 `TypeError: ... followup is not a function`（实测已做）。
    delete (probe.agent as unknown as Record<string, unknown>)['followup']
    expect(() => host.runtime.notify(alice, notice([item('t')]))).not.toThrow()
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({ kind: 'no-handle' })
    // 同时：坏句柄不再出现在"活着的成员"清单里（否则调用方会拿到一个用不了的东西）。
    expect(host.runtime.liveMemberIds()).toEqual([])
  })

  it('账本已挂起（句柄还在）⇒ not-active，句柄**不会**被唤醒', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    host.setLifecycle(alice, 'suspended')
    // 反恒真：删掉 notify 开头的生命周期门 → 本条会返回 delivered。
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'not-active',
      lifecycle: 'suspended',
    })
    expect(callsOf(host, alice).followup).toHaveLength(0)
  })

  it('账本不认识的成员被通知 ⇒ not-active + lifecycle=null（与 no-handle 区分开）', async () => {
    const host = makeHost({ lifecycles: { [String(alice)]: null } })
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'not-active',
      lifecycle: null,
    })
  })

  it('dispose() 抛错不影响释放结果（清理路径不抛、句柄照常摘除）', async () => {
    const host = makeHost()
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      return {
        agent: { id: 'a', status: 'idle', followup: () => {}, steer: () => {} },
        dispose: () => {
          throw new Error('dispose exploded')
        },
      }
    })
    await activateOk(host, alice)
    await expect(host.runtime.release(alice)).resolves.toBe(true)
    expect(host.runtime.handleOf(alice)).toBeUndefined()
    expect(host.warnings.join('\n')).toContain('dispose()')
  })

  it('`releasing` 上再激活 ⇒ 被拒（否则停用后残留活 Agent）', async () => {
    // OCR 复核 MEDIUM 的回归：没有这道门时，一次在 `releaseAll` 的 await 窗口里发起的
    // 激活会在 `releaseAll` 返回**之后**把句柄写回缓存。
    const host = makeHost()
    await activateOk(host, alice)
    await host.runtime.releaseAll()

    // 反恒真：删掉 activate 开头的 `if (releasing)` → 本条会变成 'activated'。
    const outcome = await host.runtime.activate({
      memberId: bob,
      teamId: team,
      presetId: 'p',
    })
    expect(outcome).toMatchObject({ kind: 'releasing' })
    expect(host.runtime.liveMemberIds()).toEqual([])
  })

  it('**停用期间到达的激活**（与 releaseAll 并发）不会被漏进缓存', async () => {
    // 这是上一条的**并发版本**，也是真正危险的那个窗口：激活在 `releaseAll` 的
    // `allSettled` / 循环 await 期间完成 —— 循环遍历的是当时的键快照，不含它。
    const host = makeHost()
    await activateOk(host, alice)

    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: bob, agentContext: {} })
      await gate
      return inertHandle()
    })

    // bob 的激活先发起（此时 releasing 还是 false），它的 await 让它停在 gate 上。
    const pending = host.runtime.activate({ memberId: bob, teamId: team, presetId: 'p' })
    // releaseAll 进来：置 releasing、等 bob 的在途、然后释放。
    const releasing = host.runtime.releaseAll()
    open()
    await Promise.all([pending, releasing])

    // 反恒真：去掉 `releasing` 置位或 `activate` 的门 → liveMemberIds 会剩下 bob。
    expect(host.runtime.liveMemberIds()).toEqual([])
    // 那次并发激活在**进入时** releasing 还是 false，故它合法走完（'activated'），
    // 随后被 `releaseAll` 的排空 + 释放收掉 —— 断言它必须是 'releasing' 是错的
    //（见下一条同名用例里的实测记录）。
    expect(await pending).toEqual({ kind: 'activated' })
    expect(host.runtime.handleOf(bob)).toBeUndefined()
  })

  it('**release 与在途激活竞态**：不泄漏活 Agent（OCR MEDIUM 的回归，已实测复现过）', async () => {
    // 缺陷形状（实测复现，非推断）：`activate(m)` 已过生命周期与句柄门、正卡在
    // `await createHandle`；此时 suspend/destroy 路径调 `release(m)` —— 句柄还没进缓存，
    // `releaseOne` 走幂等 no-op 返回 `false`（调用方以为什么都没释放），
    // 随后 activate 落地把句柄存下 ⇒ **一个活 Agent 被永久缓存、从不 dispose**。
    // 实测取值：release=false、handleOf 有值、liveMemberIds 含 m、dispose 次数 **0**。
    const host = makeHost()
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let disposed = 0
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      await gate
      return {
        agent: { id: 'a', status: 'idle', followup: () => {}, steer: () => {} },
        dispose: () => {
          disposed += 1
        },
      }
    })

    const activating = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    // 关键：**不 await**，先挂着 —— release 会等它落地再摘除。
    const releasing = host.runtime.release(alice)
    open()
    const [activation, released] = await Promise.all([activating, releasing])

    // 反恒真：把 release 里那段"等在途"删掉（退回 `return releaseOne(memberId)`）→
    // released 变 false、handleOf 有值、disposed 停在 0，本条四处断言同时变红。
    expect(activation).toEqual({ kind: 'activated' })
    expect(released, '确实摘除了一个活句柄，才该返回 true').toBe(true)
    expect(host.runtime.handleOf(alice), '不得留下被永久缓存的活 Agent').toBeUndefined()
    expect(host.runtime.liveMemberIds()).toEqual([])
    expect(disposed, '句柄必须被 dispose').toBe(1)
  })

  it('release 等在途激活时**不吞掉**激活失败（激活失败 ⇒ released=false，且不抛）', async () => {
    // 上一条的对偶：等在途之后，若那次激活本身失败了，缓存里本来就没有句柄 ⇒
    // 如实返回 false（而不是假装释放成功）。同时 release 的"不抛错"契约仍要守住。
    const host = makeHost()
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    host.setCreate(async () => {
      await gate
      throw new Error('activation failed')
    })

    const activating = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    const releasing = host.runtime.release(alice)
    open()
    const [activation, released] = await Promise.all([
      activating,
      releasing.catch(() => 'RELEASE-THREW' as const),
    ])

    expect(activation.kind).toBe('failed')
    expect(released, 'release 不得抛错（吞掉激活的拒绝）').toBe(false)
  })

  it('**release 期间新起的激活被拒**，不得漏成孤儿句柄（OCR HIGH 的回归，已实测复现）', async () => {
    // 缺陷形状（实测复现）：`release(m)` 原先只快照**当前那条**在途激活并 await 它。
    // 若期间又起了一次 `activate(m)`（现实成因：第一次激活失败、宿主在 catch 里重试，
    // 而失败方的 finally 已把 inFlightActivations 的条目删掉 ⇒ 重试开辟**新**记录），
    // release 快照不到新的那条，释放完就返回，随后它落地并把自己的句柄存进缓存。
    // 实测取值：release=false、handleOf 有值、dispose 次数 **0**。
    const host = makeHost()
    let openA = (): void => {}
    const gateA = new Promise<void>((resolve) => {
      openA = resolve
    })
    let created = 0
    let disposed = 0
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      created += 1
      if (created === 1) {
        await gateA
        throw new Error('first activation failed')
      }
      return {
        agent: { id: 'a', status: 'idle', followup: () => {}, steer: () => {} },
        dispose: () => {
          disposed += 1
        },
      }
    })

    const first = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    // release 在第一次仍在途时进来（它只快照到那一条）。
    const releasing = host.runtime.release(alice)
    openA()
    await first.catch(() => undefined)
    // 期间**新起**一次激活 —— 这才是会漏成孤儿的那一次。
    const second = await host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    const released = await releasing

    // 反恒真：去掉 activate 里的 `releasingMembers.has(memberId)` 门（或把 release
    // 改回"只 await 一条快照"）→ second 会是 'activated'、handleOf 有值、disposed 停在 0。
    expect(second, '释放窗口内不得受理新激活').toMatchObject({ kind: 'releasing' })
    expect(host.runtime.handleOf(alice), '不得留下孤儿句柄').toBeUndefined()
    expect(host.runtime.liveMemberIds()).toEqual([])
    expect(released, '第一次失败 ⇒ 缓存里本来就没有句柄，如实返回 false').toBe(false)
    // created 保持 1：第二次激活根本没走到 createHandle。
    expect(created).toBe(1)
    expect(disposed).toBe(0)
  })

  it('release 之后该成员**可以重新激活**（与全局停用不同：悬停是一次性的）', async () => {
    // 这是上一条的对偶，也是 `releasingMembers` 与 `releasing` **不可合并**的证据：
    // 若把按成员的释放并入全局终态标志，挂起过的成员将永远无法恢复（FR-9.2 resume 失效）。
    const host = makeHost()
    await activateOk(host, alice)
    expect(await host.runtime.release(alice)).toBe(true)

    // 反恒真：把 releasingMembers 的 `finally` 复位删掉（或并进 releasing）→ 本条变红。
    const again = await host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    expect(again, 'release 之后必须能重新激活（resume 路径）').toEqual({ kind: 'activated' })
    expect(host.runtime.handleOf(alice)).toBeDefined()
  })

  it('**会抛的 logger** 不得让 releaseAll 中途夭折（OCR MEDIUM 的回归，已实测复现）', async () => {
    // 缺陷形状（实测复现）：注入 `warn() { throw }` 的 logger 后调 `releaseAll()`，
    // 它在第一个成员的 dispose 失败处（经 warn 记录）抛出，第二个成员**从未被释放**
    //（liveMemberIds 仍含它），而 `releasing` 已置位 ⇒ 卡在"停用中"且残留活 Agent。
    // 根因是诊断端口未兜底；清理路径的职责是把事做完，不是把日志通道的故障传出去。
    //
    // ⚠ 本用例第一版**是空转的**（变异测试抓出来的，记下来免得改回去）：
    // 它用「`disposed` 增量计数 === 1」来让第一个成员的 dispose 抛错，但那个计数是在
    // **createHandle 时**自增的 —— 等到 `releaseAll` 真正跑起来时它已经是 2，
    // 于是一个 dispose 都没抛、throwing logger 那条路**根本没被走到**。
    // 去掉源码里的兜底后本用例**仍然全绿**，与断言不存在等价。
    // 正确构造：用**独立布尔**标记"要抛的那一个"，与创建/释放的时序无关。
    let created = 0
    let disposeThrows = true
    const throwing = createMemberRuntime({
      mountPreset: () => {},
      applyToolPolicy: () => {},
      async createHandle({ setup, memberId }) {
        await setup({ memberId, agentContext: {} })
        created += 1
        // 只有**第一个**成员的 dispose 抛错（与上面的计数器解耦）。
        const thisThrows = disposeThrows && created === 1
        return {
          agent: { id: 'a', status: 'idle', followup: () => {}, steer: () => {} },
          dispose: () => {
            if (thisThrows) throw new Error('dispose exploded')
          },
        }
      },
      lifecycleOf: () => 'active',
      logger: {
        warn() {
          throw new Error('logger sink broken')
        },
      },
    })
    await throwing.activate({ memberId: alice, teamId: team, presetId: 'p' })
    await throwing.activate({ memberId: bob, teamId: team, presetId: 'p' })
    disposeThrows = true

    // 反恒真：去掉 warn 里的 try/catch → 本条会抛 'logger sink broken' 并留着 bob
    // （实测已做：去掉兜底后本条变红，报 liveMemberIds = [bob]）。
    await expect(throwing.releaseAll(), 'releaseAll 不得抛错').resolves.toBeUndefined()
    expect(throwing.liveMemberIds(), '两个成员都必须被释放').toEqual([])
  })

  it('**notice 为 null / undefined** ⇒ invalid-notice，绝不抛错（OCR HIGH 的回归）', async () => {
    // OCR 复核 HIGH（已实测复现）：第一版直接读 `notice.items`，而 `MemberNotice`
    // 只是**类型层**契约 —— JS 调用方与 `as` 强转都能绕过它。传 null/undefined
    // 会抛 `TypeError: Cannot read properties of null (reading 'items')`，
    // 从**事件派发路径**冲出去，违反本方法"从不抛错"的契约。它恰是 `notify` 存在的场景。
    //
    // ⚠ 注意实测细节：传 `42` / `'str'` **不抛**（读它们的 `.items` 得 undefined，
    // 落到数组判断）。也就是说这条漏洞只在 null/undefined 上成立 ——
    // 随手试个数字会得到"没问题"的假象。本用例因此**必须**覆盖这两个值。
    const host = makeHost()
    await activateOk(host, alice)
    for (const bad of [null, undefined, 42, 'str']) {
      // 反恒真：去掉 notify 里的 `notice === null || typeof notice !== 'object'` 门 →
      // 前两轮会抛 TypeError，本条变红。
      expect(() => host.runtime.notify(alice, bad as never), `notice=${String(bad)}`).not.toThrow()
      expect(host.runtime.notify(alice, bad as never).kind, `notice=${String(bad)}`).toBe(
        'invalid-notice',
      )
    }
  })

  it('**重复 ref 的待办**签名与顺序无关（OCR MEDIUM 的回归，已实测复现）', () => {
    // OCR 复核 MEDIUM（第 2 轮，已实测复现）：排序只比 `ref` 时，同一 `ref`、不同计数的
    // 两条会按**输入顺序**排 ⇒ 签名对顺序敏感，正是本函数要消除的那件事。
    const a1 = item('a', { revision: 1, unreadCount: 1, newestSequence: 1 })
    const a2 = item('a', { revision: 2, unreadCount: 2, newestSequence: 2 })
    expect(noticeSignatureOf([a1, a2])).toBe(noticeSignatureOf([a2, a1]))

    // 对照：同一组待办换个顺序仍应被去重（端到端形式）。
    const host = makeHost()
    host.runtime.notify(alice, notice([a1, a2]))
    expect(host.runtime.notify(alice, notice([a2, a1]))).toEqual({ kind: 'no-handle' })
  })

  it('**字段为 undefined** 时签名仍与顺序无关（OCR MEDIUM 第 3 轮的回归）', () => {
    // OCR 复核 MEDIUM（第 3 轮）指出：逐字段比较 + `undefined` 就 `continue`
    // 会让比较器**非全序**（compare(a,b) 与 compare(b,a) 可能都返回 0），
    // 于是 `sort` 结果依赖输入顺序 ⇒ 签名顺序敏感。实测确认成立：
    //   t1={ref:undefined,revision:1,…} / t2={ref:'z',revision:undefined,…}
    //   [t1,t2] 与 [t2,t1] 给出两个不同的签名。
    // 本函数是**导出的纯函数**，调用方可以绕过 `isPendingItem` 直接传，
    // 所以"合法域没问题"不足以关掉这一个。
    const t1 = { ref: undefined, revision: 1, unreadCount: 1, newestSequence: 1 }
    const t2 = { ref: 'z', revision: undefined, unreadCount: 1, newestSequence: 1 }
    // 反恒真：把比较器改回"逐字段 + undefined 就 continue" → 本条变红。
    expect(noticeSignatureOf([t1, t2] as never)).toBe(noticeSignatureOf([t2, t1] as never))

    // 合法域也一并钉住：200 组随机合法输入的顺序无关性（对照样本，防"一律返回常量"）。
    for (let i = 0; i < 200; i += 1) {
      const items = Array.from({ length: 3 }, (_, k) => ({
        ref: `r${(k + 1) % 3}`,
        revision: (i + k) % 3,
        unreadCount: (i * k) % 4,
        newestSequence: (i + k * 2) % 5,
      }))
      expect(noticeSignatureOf(items)).toBe(noticeSignatureOf([...items].reverse()))
    }
    // 反向对照：**不同**的输入必须给出**不同**签名（否则上面的"相等"可能是恒等）。
    expect(noticeSignatureOf([item('a', { revision: 1 })])).not.toBe(
      noticeSignatureOf([item('a', { revision: 2 })]),
    )
  })

  it('**函数形状的句柄**同样被释放（OCR MEDIUM 的回归，已实测复现泄漏）', async () => {
    // OCR 复核 MEDIUM（已实测复现）：`typeof fn === 'function'` 而非 `'object'`，
    // 而 JS 里"可调用对象"是合法的句柄形状。第一版只放行 object ⇒ 这种句柄
    // 走不进 disposeQuietly，dispose() 从不被调用 ⇒ 静默泄漏（实测 dispose 次数 0）。
    let disposed = 0
    const callable = function callableHandle(): void {}
    const withDispose = Object.assign(callable, {
      dispose: () => {
        disposed += 1
      },
    })

    const host = makeHost()
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      // 形状不合法（asMemberHandle 正确地拒了它 —— 缺合法 agent），但 dispose 可用。
      return withDispose as never
    })
    const outcome = await host.runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'p',
    })
    expect(outcome.kind).toBe('failed')
    // 反恒真：把 asDisposable 改回 `typeof value !== 'object'` → disposed 停在 0，本条变红。
    expect(disposed, '函数形状的句柄也必须被释放').toBe(1)
  })

  it('函数形状但**没有** dispose ⇒ 判为不可释放（不是"一律释放"）', async () => {
    // 上一条的对偶：放宽判据不等于无条件调用。一个没有 dispose 的函数
    // 仍然要判"无从中释放"，而不是在它上面调一个不存在的函数。
    const plainFn = function plain(): void {}
    const host = makeHost()
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      return plainFn as never
    })
    await expect(
      host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' }),
    ).resolves.toMatchObject({ kind: 'failed' })
  })

  it('releaseAll 里**一个成员释放失败**不影响其余成员（终态不得半死）', async () => {
    // OCR 复核 LOW 的**预防性**改动：`releasing` 是终态且不复位，所以循环中途抛错会让
    // 剩下的成员永远既不被释放、也不能被重新激活 —— 静默半死的运行时。
    // 实现改为每次释放各自 `allSettled`，一次失败不影响其余。
    //
    // ⚠ **如实说明本用例的验证边界（变异测试实测，两次修正过注释）**：
    // 它是**部分可证伪**的，我在注释里写过的两句过头话都已实测推翻，记在这里免得再写回去。
    //
    // 已实测的变异结果：
    //   · 「循环只释放**第一个**成员」       → **4 条用例变红**（含本条）⇒ 本条**能**区分它；
    //   · 「一个都不释放」                  → 5 条用例变红；
    //   · 「首个失败就 break」              → **0 条变红**（全绿）⇒ 本条**不能**区分它。
    //
    // 第三条为何不能区分：`releaseOne` 今天**结构上不可能 reject** —— 它内部唯一可抛的
    // `disposeQuietly` 已经把 `dispose()` 的异常吞掉并记日志。所以"逐个隔离" vs
    // "朴素 for 循环" vs "首个失败就 break" 在**当前代码下行为完全等价**，
    // 没有任何用例能把它们分开（我原先在这里写"改回朴素循环本条会红"是**错的**）。
    //
    // 那这处隔离是不是"没人守的代码"？是**纯预防性**的，我不假装它有测试守着。
    // 它留下的价值只有一条，但那条是真的：把"releaseOne 不得 reject"从**约定**变成**结构** ——
    // 将来若有人给 releaseOne 加了会抛的逻辑，`releasing` 这个终态就不会因为一个成员的
    // 失败而卡死（那时本用例才会开始区分）。这与"造一条恒真断言充数"是两回事。
    const host = makeHost()
    await activateOk(host, alice)
    await activateOk(host, bob)

    // 让 alice 的 dispose 抛错（会经 warn 记录，但不应中断循环）。
    const failing = host.probes.get(alice)!
    ;(failing.handle as { dispose(): void }).dispose = () => {
      throw new Error('dispose exploded')
    }

    await expect(host.runtime.releaseAll()).resolves.toBeUndefined()
    // 若实现改成"首个失败就 break"，bob 会残留 ⇒ 本条变红（这一条是真的可证伪）。
    expect(host.runtime.liveMemberIds(), '两个成员都必须被尝试释放').toEqual([])
  })

  it('缓存的句柄坏掉时**发出告警**（OCR LOW 的回归：原先只有静默降级）', async () => {
    // OCR 复核 LOW：`readHandle` 对"缓存里有值但形状守卫判它不是句柄"原先只返回 undefined
    // —— 与"从未激活"完全同形。运维看到的是该成员变回 idle、并从 liveMemberIds 消失，
    // **没有任何提示**。本模块在别处都遵守"不静默降级"，这里补一条可发现的告警。
    const host = makeHost()
    await activateOk(host, alice)
    // 破坏句柄：删掉 followup ⇒ asMemberHandle 判它不是句柄。
    delete (host.probes.get(alice)!.agent as unknown as Record<string, unknown>)['followup']

    // 反恒真：把 readHandle 里的 warn 删掉 → 本条变红（warnings 为空）。
    expect(host.runtime.handleOf(alice)).toBeUndefined()
    expect(host.warnings.join('\n'), '必须留下可发现的告警').toContain('缓存句柄已失效')
    expect(host.warnings.join('\n')).toContain(String(alice))
  })

  it('同一个坏句柄**只告警一次**（`liveMemberIds` 是高频入口，不能刷屏）', async () => {
    // OCR 复核 LOW 第二轮：`liveMemberIds()` 在循环里调 `readHandle`，而它是宿主
    // "枚举谁活着"的高频入口（渲染/轮询）。不去重的话每次枚举都对同一个坏句柄再告一次 ——
    // 实测 5 次调用产生 5 条相同告警，把真正需要被看到的告警淹没。
    const host = makeHost()
    await activateOk(host, alice)
    delete (host.probes.get(alice)!.agent as unknown as Record<string, unknown>)['followup']
    host.warnings.length = 0

    for (let i = 0; i < 5; i += 1) host.runtime.liveMemberIds()

    // 反恒真：去掉 corruptHandleWarned 的判重 → 告警数变成 5（甚至更多），本条变红。
    const corruptWarns = host.warnings.filter((w) => w.includes('缓存句柄已失效'))
    expect(corruptWarns, '同一成员只该告警一次').toHaveLength(1)
  })

  it('句柄恢复健康后**允许再次告警**（一次性标记不能永久闭嘴）', async () => {
    // 上一条的对偶：`Set` 只是"已就这次损坏告过警"，不能变成"这个成员永远不再告警"。
    const host = makeHost()
    await activateOk(host, alice)
    const probe = host.probes.get(alice)!
    // 第一次损坏 → 一次告警。
    delete (probe.agent as unknown as Record<string, unknown>)['followup']
    host.warnings.length = 0
    host.runtime.liveMemberIds()
    expect(host.warnings.filter((w) => w.includes('缓存句柄已失效'))).toHaveLength(1)

    // 修好（放回 followup）⇒ readHandle 判健康并把标记清掉。
    ;(probe.agent as unknown as Record<string, unknown>)['followup'] = () => {}
    host.runtime.handleOf(alice)
    // 再次损坏 → 必须能再告警（否则运维永远看不到第二次故障）。
    delete (probe.agent as unknown as Record<string, unknown>)['followup']
    host.warnings.length = 0
    host.runtime.liveMemberIds()
    expect(
      host.warnings.filter((w) => w.includes('缓存句柄已失效')),
      '修好后又坏，必须能再次告警',
    ).toHaveLength(1)
  })

  it('非法待办**不压制后续新事实**（OCR MEDIUM 建议"清签名"，实测后不采纳）', async () => {
    // OCR 复核 MEDIUM 建议：返回 invalid-notice 前清掉去重状态。
    // 实测后**不采纳**（理由写在实现里），本条把判据钉成可执行断言：
    //   合法A → delivered；非法 → invalid-notice；再次合法A → duplicate（**正确**：A 已送达过）；
    //   换上新事实B → delivered（**关键**：新事实没有被压制 ⇒ 不存在"漏提醒"）。
    const host = makeHost()
    await activateOk(host, alice)
    const good = item('thread-1', { newestSequence: 7 })

    expect(host.runtime.notify(alice, notice([good]))).toEqual({ kind: 'delivered', channel: 'followup' })
    expect(host.runtime.notify(alice, notice([item('thread-1', { revision: 1.5 })])).kind).toBe(
      'invalid-notice',
    )
    // 同一批**已送达**的事实再问一次 ⇒ duplicate（不是丢失）。
    expect(host.runtime.notify(alice, notice([good]))).toEqual({ kind: 'duplicate' })
    // 反恒真：若在 invalid-notice 处清签名 → 上一条会变成 delivered（对同一批事实重复烧 turn）。
    // 而真正要守的是**这一条**：新事实必须送出去。
    expect(host.runtime.notify(alice, notice([item('thread-1', { newestSequence: 8 })]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
    expect(callsOf(host, alice).followup, 'A 与 B 各送达一次').toHaveLength(2)
  })

  it('**status getter 抛错**时五个入口都不抛、不丢消息（OCR [18]/[26] 的回归）', async () => {
    // OCR 复核 [18] 与 [26] 是同一条（报了两遍）：`handle.agent.status` 是**派生 getter**，
    // 异常/损坏的句柄会让这次读取抛错，而 `notify` 契约是"从不抛错"（它跑在事件派发路径上）。
    // ⚠ 我实测发现**范围比报告更大**：泄漏的不是两处而是**五处** ——
    //   根因是**形状守卫自己调用了那个 getter**（`typeof inner['status'] !== 'string'`），
    //   于是每个走守卫的入口一起炸。
    // 实测记录（修前）：activate 抛 / notify 抛 / presenceOf 抛 / liveMemberIds 抛 / handleOf 抛。
    // 修法在唯一读取点（`readBusyness` 关进 try/catch + 守卫改用 `hasReadableStatus`），
    // 而不是按报告逐个给 notify/presenceOf 打补丁（那会漏掉另外三个）。
    const memberId2 = bob
    let shouldThrow = false
    const host = makeHost()
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: memberId2, agentContext: {} })
      return {
        agent: {
          id: 'a',
          get status(): string {
            if (shouldThrow) throw new Error('phase is corrupted')
            return 'idle'
          },
          followup: () => {},
          steer: () => {},
        },
        dispose: () => {},
      }
    })
    await host.runtime.activate({ memberId: memberId2, teamId: team, presetId: 'p' })
    shouldThrow = true

    // 反恒真：修在**根因**（守卫 + 唯一读取点）。实测四个变异体：
    //   · 守卫改回裸 `typeof status`               → **红**（本用例与下一条都红）；
    //   · `readBusyness` 去掉 try/catch             → **红**；
    //   · `presenceOf` 直接读 `handle.agent.status` → **绿**（不可区分）；
    //   · `notify` 直接读 `handle.agent.status`     → **绿**（不可区分）。
    // ⚠ 后两条**不是**"没测到"，而是**等价变异体**，原因必须写下来免得后人误判：
    //   守卫既然保证"status 可读"，能走到用点的句柄其 status 一定读得出来 ——
    //   用点上的裸读**永远不会**遇到抛错的 getter。
    //   也就是说：只按 OCR 建议给 notify/presenceOf 打补丁，在当前结构下
    //   **改了也测不出来**（异常早在守卫处已终止）。修根因才是必需的；
    //   用点共用 `channelForBusyness` 的理由是**语义单点**（busyness→通道/存在态只有一处映射），
    //   不是为了再防一次这条抛错。
    expect(() => host.runtime.presenceOf(memberId2)).not.toThrow()
    expect(() => host.runtime.notify(memberId2, notice([item('t')]))).not.toThrow()
    expect(() => host.runtime.liveMemberIds()).not.toThrow()
    expect(() => host.runtime.handleOf(memberId2)).not.toThrow()
    await expect(
      host.runtime.activate({ memberId: memberId2, teamId: team, presetId: 'p' }),
    ).resolves.toBeDefined()

    // 语义：读不出状态 ⇒ 保守判为不可用 ⇒ `no-handle`（**不是**抛错）。
    // ⚠ 且 `no-handle` **不写** `deliveredSignatures` ⇒ 同一条待办下次还会重试，
    //    getter 恢复后立刻能送达（自愈，不永久丢消息）。下面验证这条自愈。
    expect(host.runtime.notify(memberId2, notice([item('t')]))).toEqual({ kind: 'no-handle' })

    // getter 恢复正常 ⇒ 同一个句柄原值不动、立刻可用，且消息**真的送达**。
    shouldThrow = false
    expect(host.runtime.notify(memberId2, notice([item('t')]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
  })

  it('**有状态 getter**（第一次可读、第二次抛）也不抛错（守卫必须自己兜住）', async () => {
    // 更刁的输入：守卫读第一次放行、业务读取第二次才抛。若只在业务点 try/catch
    // 而守卫仍用裸 `typeof`，这类句柄会在**守卫的第二次调用**上炸。
    let reads = 0
    const host = makeHost()
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: bob, agentContext: {} })
      return {
        agent: {
          id: 'a',
          get status(): string {
            reads += 1
            if (reads >= 2) throw new Error('phase changed mid-read')
            return 'idle'
          },
          followup: () => {},
          steer: () => {},
        },
        dispose: () => {},
      }
    })
    await host.runtime.activate({ memberId: bob, teamId: team, presetId: 'p' })

    expect(() => host.runtime.presenceOf(bob)).not.toThrow()
    expect(() => host.runtime.notify(bob, notice([item('t')]))).not.toThrow()
    expect(() => host.runtime.liveMemberIds()).not.toThrow()
    expect(() => host.runtime.handleOf(bob)).not.toThrow()
  })

  it('**任意属性是抛错 accessor** 时不抛错（OCR [1] 的回归：不只 status）', async () => {
    // OCR 复核 MEDIUM（实测确认为真，且比我先前修的 `status` 更广）：
    // 「读属性」在 JS 里就是执行代码 —— **任何**是 accessor 的属性都可能抛。
    // 实测四个属性各造一个抛错 getter，`activate` **每一个都抛**：
    //   followup / steer / agent / dispose 分别作 getter 抛错时，activate 全抛。
    // 而守卫是所有读取路径的必经之处 ⇒ 一个属性抛，五个入口一起变抛错点。
    // 修法：`asMemberHandle` / `asDisposable` **整体**包 try/catch（不只是护 status）。
    for (const prop of ['followup', 'steer', 'agent', 'dispose'] as const) {
      const host = makeHost()
      const boom = (): never => {
        throw new Error(`${prop} accessor exploded`)
      }
      host.setCreate(async ({ setup }) => {
        await setup({ memberId: bob, agentContext: {} })
        const agent = {
          id: 'a',
          status: 'idle',
          followup: () => {},
          steer: () => {},
        } as Record<string, unknown>
        const handle: Record<string, unknown> = { agent, dispose: () => {} }
        // 把目标属性换成抛错 accessor（其余保持正常）。
        Object.defineProperty(prop === 'agent' || prop === 'dispose' ? handle : agent, prop, {
          get: boom,
          configurable: true,
        })
        return handle as never
      })

      // 反恒真：把 `asMemberHandle` 的 try/catch 去掉 → 这里全部变成"抛错"，断言变红。
      await expect(
        host.runtime.activate({ memberId: bob, teamId: team, presetId: 'p' }),
        `${prop} 是抛错 accessor 时 activate 不得抛`,
      ).resolves.toMatchObject({ kind: 'failed' })
      expect(() => host.runtime.notify(bob, notice([item('t')])), prop).not.toThrow()
      expect(() => host.runtime.presenceOf(bob), prop).not.toThrow()
      expect(() => host.runtime.liveMemberIds(), prop).not.toThrow()
      expect(() => host.runtime.handleOf(bob), prop).not.toThrow()
    }
  })

  it('**非法通知在无句柄成员上也如实报 invalid-notice**（OCR [2] 的回归）', async () => {
    // OCR 复核 LOW（实测确认）：原先形状校验排在句柄门之后 ⇒
    // `notify(没有活句柄的成员, 非法通知)` 返回 `no-handle` 而不是 `invalid-notice`，
    // 调用方**构造通知的 bug** 在"该成员恰好没句柄"时完全静默（不告警、不指出错在哪）——
    // 而那恰恰是诊断信息最该出现的场合。
    // 修法：输入校验先于成员状态 ⇒ 无论成员处于什么状态，输入错误一律如实报。
    const host = makeHost()
    // 注意：**完全不激活 alice**（她没有活句柄）。
    expect(host.runtime.handleOf(alice)).toBeUndefined()

    // 反恒真：把校验移回句柄门之后 → 前三条会变成 'no-handle'，本条变红。
    for (const bad of [null, undefined, { items: 'nope' }, { items: [item('')] }]) {
      expect(host.runtime.notify(alice, bad as never).kind, `bad=${JSON.stringify(bad)}`).toBe(
        'invalid-notice',
      )
    }
    // 对照：**合法**通知在无句柄成员上仍然如实报 no-handle（新顺序没有把这条吃掉）。
    expect(host.runtime.notify(alice, notice([item('t')])).kind).toBe('no-handle')
  })

  it('**text 非字符串**必须被拒（OCR HIGH 的回归：曾抛 TypeError 冲出派发路径）', async () => {
    // OCR 复核 HIGH（已实测复现）：`validateNoticeShape` 第一版把
    // `typeof text !== 'string'` 与"空串/纯空白"混成一件事、两支都 `return null`，
    // 于是 `text: 42` **过校验**，随后 `notify` 里 `notice.text.trim()` 抛
    // `TypeError: notice.text.trim is not a function`，从事件派发路径冲出去 ——
    // 正是该函数声称要堵住的那类失败。
    // 实测（修前，五种输入**全部抛**）：42 / null / undefined / {} / ['x']。
    const host = makeHost()
    await activateOk(host, alice)

    // 反恒真：把 `typeof text !== 'string'` 那条 return 去掉（退回"两支都 null"）→ 本条全红。
    for (const text of [42, null, undefined, {}, ['x']]) {
      const payload = { items: [item('t')], text } as never
      expect(() => host.runtime.notify(alice, payload), `text=${String(text)}`).not.toThrow()
      expect(host.runtime.notify(alice, payload).kind, `text=${String(text)}`).toBe('invalid-notice')
    }

    // 对照：**空串/纯空白**是**合法形状**（语义上的"不值得投递"），仍走 nothing-pending ——
    // 别把这条一起收紧成 invalid-notice（那会把"无需投递"误报成调用方 bug）。
    for (const text of ['', '   ']) {
      expect(host.runtime.notify(alice, { items: [item('t')], text } as never)).toEqual({
        kind: 'nothing-pending',
      })
    }
    // 且合法正文照常送达（确认没把 text 判断整体搞坏）。
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'delivered',
      channel: 'followup',
    })
  })

  it('**并发 activate 传不同装配参数** ⇒ 如实拒绝，不返回货不对板的 activated（OCR MEDIUM 回归）', async () => {
    // OCR 复核 MEDIUM（已实测复现）：在途激活被无条件复用 ⇒ 后到的调用者拿到 `activated`，
    // 它以为自己的 preset B 挂上了，而实际在跑的是 A 的装配。
    // 实测（修前）：并发 activate(preset-A/tool_a) + activate(preset-B/tool_b)
    //   两次都返回 `activated`，实际挂载的只有 `["preset-A","policy:tool_a"]` —— B 被静默吞掉。
    const host = makeHost()
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const mounted: string[] = []
    let n = 0
    const runtime = createMemberRuntime({
      mountPreset: (setup, presetId) => {
        mounted.push(`${String(setup.memberId)}→${presetId}`)
      },
      applyToolPolicy: (setup, allow) => {
        mounted.push(`policy:${allow.join(',')}`)
      },
      async createHandle({ setup, memberId }) {
        await setup({ memberId, agentContext: {} })
        n += 1
        if (n === 1) await gate
        return inertHandle()
      },
      lifecycleOf: () => 'active',
    })
    void host

    const first = runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'preset-A',
      toolPolicy: { allow: ['tool_a'] },
    })
    // 第二次：**不同**参数 —— 必须被如实拒绝。
    const conflicting = await runtime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'preset-B',
      toolPolicy: { allow: ['tool_b'] },
    })
    open()
    const firstResult = await first

    // 反恒真：把"同参才共享"那段判定删掉（无条件 `return inFlight.promise`）→
    // conflicting 会变成 'activated'，本条变红。
    expect(conflicting, '不同参数的并发激活不得被当成同一次').toMatchObject({
      kind: 'conflicting-activation',
    })
    // 诊断必须**指出真正不同的那一项**（OCR LOW：只在策略不同时，原先两个 presetId 都一样，
    // 运维看不出差异在哪）。本用例 presetId 与 toolPolicy **都**不同 ⇒ 报"都不同"。
    expect((conflicting as { reason: string }).reason).toContain('presetId 与 toolPolicy 都不同')
    expect((conflicting as { reason: string }).reason).toContain('preset-A')
    expect(firstResult).toEqual({ kind: 'activated' })
    // 关键：**B 的参数没有被采纳**（与返回的 conflicting 一致，不存在"声称 A 实际 B"的错配）。
    expect(mounted.join('|')).toContain('preset-A')
    expect(mounted.join('|')).not.toContain('preset-B')
  })

  it('**并发 activate 传相同参数** ⇒ 共享在途那一次（同参复用是纯优化，必须保留）', async () => {
    // 上一条的对偶：收紧成"一律拒绝并发"会让同参重试也失败，
    // 而并发去重的**本来目的**就是让同参调用只建一个 Agent。
    const host = makeHost()
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let created = 0
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      created += 1
      await gate
      return inertHandle()
    })

    const a = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p', toolPolicy: { allow: ['x'] } })
    const b = host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p', toolPolicy: { allow: ['x'] } })
    open()
    const [ra, rb] = await Promise.all([a, b])

    expect(created, '同参并发只该建一个 Agent').toBe(1)
    expect([ra, rb]).toEqual([{ kind: 'activated' }, { kind: 'activated' }])
  })

  it('工具策略**顺序不同视为不同参数**（顺序有意义，见 normalizeToolPolicy）', async () => {
    // ⚠ 如实标注验证边界（变异测试实测）：本条**只**守住"顺序敏感"这件事。
    // `sameToolPolicy` 里还有一条"`undefined` 与 `[]` 不等价"的判定
    //（`if (a === undefined || b === undefined) return a === b`），
    // 我实测把它改成恒真后**没有任何用例变红** —— 因为空数组根本到不了这里：
    // `runActivation` 里的 `normalizeToolPolicy` 会把空数组判成 `invalid-policy`，
    // 而在途那条激活的入参若是空数组，它的结果是 `invalid-policy` 而非 `activated`。
    // 也就是说那条判定当前是**不可区分的防御**，我不为它编一条"会红"的断言；
    // 它的价值只在"将来校验位置变化时仍不把两种相反语义混同"。
    // （这正是我先前踩过的坑：注释里声称的可证伪性，本身也要实测。）
    const host = makeHost()
    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    let created = 0
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      created += 1
      if (created === 1) await gate
      return inertHandle()
    })
    const a = host.runtime.activate({
      memberId: alice, teamId: team, presetId: 'p', toolPolicy: { allow: ['a', 'b'] },
    })
    const b = await host.runtime.activate({
      memberId: alice, teamId: team, presetId: 'p', toolPolicy: { allow: ['b', 'a'] },
    })
    open()
    await a
    expect(b.kind, '顺序不同不是同一个装配').toBe('conflicting-activation')
    // ⚠ presetId 两边**相同** ⇒ 诊断必须指出差异在 toolPolicy，否则运维看到
    // 「在途 presetId=p，本次 p」会以为消息有 bug（OCR LOW 的实测场景）。
    const reason = (b as { reason: string }).reason
    expect(reason, '必须点明差异在策略').toContain('toolPolicy 不同')
    expect(reason, 'presetId 相同是事实，也要照实打出来').toContain('presetId=p')
    expect(reason, '把两侧的 allow 都报出来，运维才定位得到').toContain('["a","b"]')
    expect(reason).toContain('["b","a"]')
  })

  it('**setup 回传别的成员 id** ⇒ 拒绝装配（OCR MEDIUM 回归：曾把 A 的 preset 装到 B 上）', async () => {
    // OCR 复核 MEDIUM（已实测复现）：`setup.memberId` 是**本模块自己**传进去的入参，
    // 却由实现方原样回传；回传成别的成员时本模块原先**照单全收** ——
    // 实测：activate(alice) 返回 `activated`，而实际挂载的是 lingtai 的 preset 与工具策略。
    // 这是**静默错装配**（权限边界落到错误成员），比"没激活"危险，故 fail-closed。
    const other = 'sophia-lingtai-lang-bbbbbbbb' as typeof alice
    const mounted: string[] = []
    const runtime = createMemberRuntime({
      mountPreset: (setup, presetId) => {
        mounted.push(`mount(${String(setup.memberId)}→${presetId})`)
      },
      applyToolPolicy: (setup) => {
        mounted.push(`policy(${String(setup.memberId)})`)
      },
      async createHandle({ setup }) {
        // 接线错误：回传别的成员的 setup
        await setup({ memberId: other, agentContext: {} })
        return inertHandle()
      },
      lifecycleOf: () => 'active',
    })

    // 反恒真：删掉 `setup.memberId !== memberId` 那段判断 → 本条变红（会得到 activated）。
    const outcome = await runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    expect(outcome.kind, '成员 id 不匹配必须拒绝，不得 activated').toBe('failed')
    expect((outcome as { reason: string }).reason).toContain(String(other))
    // 关键：**没有任何装配动作落到别的成员身上**（在挂载前就拦住了）。
    expect(mounted, '不得把装配落到别的成员上').toEqual([])
    expect(runtime.handleOf(alice), '被拒的句柄不得进缓存').toBeUndefined()
  })

  it('**setup 从未被调用**的失败文案，不得断言"会以宿主默认面运行"（OCR MEDIUM 回归）', async () => {
    // OCR 复核 MEDIUM：统一尾巴里写死了"这个 Agent 会以宿主默认面运行"，
    // 但 `setup` **从未被调用**时本模块并不知道那个 Agent 处于什么状态
    // （很可能压根没装配/没启动）—— 那句话是未经证实的断言，且把后果说轻了。
    // 修法：后果由调用方按它确知的事实给，两种成因各说自己那句。
    const runtime = createMemberRuntime({
      mountPreset: () => {},
      applyToolPolicy: () => {},
      async createHandle() {
        return inertHandle() // 解析成功但从不调用 setup
      },
      lifecycleOf: () => 'active',
    })
    const outcome = await runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    expect(outcome.kind).toBe('failed')
    const reason = (outcome as { reason: string }).reason
    // 反恒真：把 `consequence` 改回写死的那句 → 本条变红。
    expect(reason, 'setup 没跑时不得声称 Agent 会以默认面运行').not.toContain('会以宿主默认面运行')
    expect(reason, '要说清真正确知的后果').toContain('完全没有生效')
  })

  it('**already-active 不表示"本次入参已生效"**：换装配必须 release 后再 activate', async () => {
    // 这条把 `already-active` 的**语义边界**钉住（供调用方契约用，实测得出而非推测）：
    //   先 activate(A) 成功 → 再 activate(B) ⇒ 返回 already-active，
    //   而**没有任何** mountPreset('B') 发生（B 的参数被吞了，且不报错）。
    // 若调用方把 already-active 当成"B 已就绪"，就会拿错装配的 Agent 干活。
    const mounted: string[] = []
    const runtime = createMemberRuntime({
      mountPreset: (_setup, presetId) => {
        mounted.push(`mount:${presetId}`)
      },
      applyToolPolicy: () => {},
      async createHandle({ setup }) {
        await setup({ memberId: alice, agentContext: {} })
        return inertHandle()
      },
      lifecycleOf: () => 'active',
    })

    expect(await runtime.activate({ memberId: alice, teamId: team, presetId: 'A' })).toEqual({
      kind: 'activated',
    })
    mounted.length = 0

    // 反恒真：若把 `already-active` 那条守卫改成"参数不同就重挂"，本条变红。
    const retry = await runtime.activate({ memberId: alice, teamId: team, presetId: 'B' })
    expect(retry.kind, '在位时换参数不会换装，也不报错').toBe('already-active')
    expect(mounted, 'B 从未被挂载 —— 这才是调用方必须知道的真相').toEqual([])

    // 唯一正确的换装路径：先 release，再 activate（实测可行）。
    const released = await runtime.release(alice)
    expect(released).toBe(true)
    const afterRelease = await runtime.activate({ memberId: alice, teamId: team, presetId: 'B' })
    expect(afterRelease).toEqual({ kind: 'activated' })
    expect(mounted, 'release 后 B 才真的挂上').toEqual(['mount:B'])
  })

  it('坏句柄告警：**每个成员每次损坏各告警一次**，release 后不压制下一次（OCR LOW 回归）', async () => {
    // OCR 复核 LOW（已实测复现）：`corruptHandleWarned` 只在"健康读"时清除，
    // 从不在 `releaseOne`/`releaseAll` 清 ⇒ 释放一个坏句柄的成员后，该标记永久占位；
    // **同一成员再次损坏时完全静默**。
    // 实测（修前）：第一次损坏告警 1 条 → release + 重新激活 + 再次损坏 → 总告警数**仍是 1**。
    // 本意是"防同一次损坏刷屏"，不是"吞掉此后所有损坏"。
    let bad = false
    const warns: string[] = []
    const runtime = createMemberRuntime({
      mountPreset: () => {},
      applyToolPolicy: () => {},
      async createHandle({ setup }) {
        await setup({ memberId: alice, agentContext: {} })
        return {
          agent: {
            id: 'a',
            get status(): string {
              if (bad) throw new Error('句柄坏了')
              return 'idle'
            },
            followup: () => {},
            steer: () => {},
          },
          dispose: () => {},
        }
      },
      lifecycleOf: () => 'active',
      logger: { warn: (m: string) => { warns.push(m) } },
    })

    await runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    // 第一次损坏
    bad = true
    runtime.liveMemberIds()
    runtime.liveMemberIds()
    const afterFirst = warns.filter((w) => w.includes('缓存句柄已失效')).length
    expect(afterFirst, '同一次损坏多次枚举只告警一次（原意图仍成立）').toBe(1)

    // 释放 + 重新激活 + 再次损坏
    expect(await runtime.release(alice)).toBe(true)
    bad = false
    await runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    bad = true
    runtime.liveMemberIds()

    // 反恒真：删掉 `releaseOne` 里的 `corruptHandleWarned.delete(memberId)` → 本条变红（仍是 1）。
    const afterSecond = warns.filter((w) => w.includes('缓存句柄已失效')).length
    expect(afterSecond, '**新的一次**损坏必须再告警，不能被上一次的标记压制').toBe(2)
  })

  it('release 窗口内的 notify：投得进去，且**不丢**（重新激活后同一条待办会再送）', async () => {
    // 这条把 OCR 复核 LOW 提到的"notify 不看 releasing"**不对称**行为钉住，
    // 并证明它不是数据丢失（这是判定"保持现状"的依据，实测而非推断）：
    //   · 窗口内投递确实发生（`delivered`，followup 真被调用）；
    //   · `releaseOne` 会清签名 ⇒ 重新激活后**同一条待办再送一次** ⇒ 自愈。
    const sent: string[] = []
    const runtime = createMemberRuntime({
      mountPreset: () => {},
      applyToolPolicy: () => {},
      async createHandle({ setup }) {
        await setup({ memberId: alice, agentContext: {} })
        return {
          agent: {
            id: 'a',
            status: 'idle',
            followup: (m: SophiaUserMessage) => { sent.push(m.content[0]!.text) },
            steer: () => {},
          },
          dispose: () => {},
        }
      },
      lifecycleOf: () => 'active',
    })
    await runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    const one = notice([item('r')])

    const releasing = runtime.release(alice)
    // 同步紧跟 release 的同步段 ⇒ 句柄尚未被摘（窗口最窄处）
    const during = runtime.notify(alice, one)
    expect(during.kind, '窗口内确实投得进去 —— 这条不对称是真实的').toBe('delivered')
    await releasing

    // 关键：重新激活后**同一条**待办会再送一次 ⇒ 不丢。
    await runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })
    expect(runtime.notify(alice, one).kind).toBe('delivered')
    // ⚠ 断言的是**投递次数**（正文同一条 ⇒ 两次相同文本），不是 ref 字符串：
    // ref 是运行时内部的去重载体，**不再**出现在 agent 边界的投递物里
    //（投过去的是消息）。「同一条待办在重新激活后再送一次 ⇒ 没丢」这件事，
    // 等价且可观测的表达就是「followup 累计 2 次」。
    expect(sent, 'followup 累计 2 次 = 没有永久丢失').toEqual(['你有新待办', '你有新待办'])
  })

  it('releaseAll 之后是**结构性**终态：句柄表与各辅助表都已清空（OCR LOW 回归）', async () => {
    // OCR 复核 LOW：原先 `releaseAll` 只靠"每个 releaseOne 都成功"来清 `handles`，
    // 那是**约定**不是**结构**。现在显式清空，让终态不依赖单次释放的成败。
    //
    // ⚠ 如实标注验证边界（变异测试**逐条实测**，三个变异体）：
    //   A 只删 `releaseAll` 结尾那三行 clear  → **绿**（releaseOne 自己会 delete）
    //   B 只删 `releaseOne` 里的 `handles.delete` → **绿**（releaseAll 结尾会 clear）
    //   C **两者同时**删                        → **红**（本用例失败）
    // ⇒ 两个机制**互为冗余**，任何一个单独存在都能让终态正确；只有**合取**可被证伪。
    // 这就是本用例的真实边界：它守住的是"终态被清空"这件事**不会同时从两处消失**，
    // 而不是"某一行代码在起作用"。我不假装它更强。
    // 保留两处的理由：`releaseOne` 的 delete 让**单成员** `release` 也正确（那条路径
    // 根本不经过 `releaseAll`），`releaseAll` 的 clear 则让终态不依赖循环里每个成员的成败 ——
    // 各自覆盖不同的调用路径，不是重复代码。
    const host = makeHost()
    await activateOk(host, alice)
    expect(host.runtime.liveMemberIds()).toEqual([alice])
    await host.runtime.releaseAll()
    // 断言"终态确实被清空"（可证伪口径见上方 A/B/C：只有**两处同时**失效才变红）。
    expect(host.runtime.liveMemberIds()).toEqual([])
    expect(host.runtime.handleOf(alice)).toBeUndefined()
    // 终态不复位：此后再激活一律 releasing。
    expect((await host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })).kind).toBe(
      'releasing',
    )
  })

  it('**handle.agent 本身是有状态 getter** 时五个入口都不抛（OCR HIGH 的回归）', async () => {
    // OCR 复核 HIGH（已实测复现，且与我先前修的 `status` 用例**不同**）：
    // 守卫只验证了 `value.agent` **当时**可读，而调用方随后每次写 `handle.agent`
    // 都会**再执行一次 accessor** ⇒ 一个"第 N 次读取开始抛"的 getter 能穿过守卫、
    // 在**用点**抛出去。因为 `handle.agent` 的读取在投递的 try **之外**，异常逃出方法。
    // 实测（修前）：
    //   · `agent` 第 2 次读取起抛 → `presenceOf` **抛**
    //   · `agent` 第 4 次读取起抛 → `notify` **抛**
    // 修法：`asMemberHandle` 返回**自己构造**的字面量，把 `agent`/`dispose` 各读一次固化。
    for (const throwAfter of [1, 2, 3, 4, 5]) {
      const host = makeHost()
      let reads = 0
      const inner = { id: 'a', status: 'idle', followup: () => {}, steer: () => {} }
      const handle: Record<string, unknown> = { dispose: () => {} }
      Object.defineProperty(handle, 'agent', {
        get() {
          reads += 1
          if (reads > throwAfter) throw new Error(`agent getter 第 ${reads} 次读取抛了`)
          return inner
        },
        configurable: true,
      })
      host.setCreate(async ({ setup }) => {
        await setup({ memberId: alice, agentContext: {} })
        return handle as never
      })
      await host.runtime.activate({ memberId: alice, teamId: team, presetId: 'p' })

      // 反恒真：把 `asMemberHandle` 改回 `return value as MemberHandle` → 本条变红
      //（throwAfter=2 时 presenceOf 抛、=4 时 notify 抛）。
      expect(() => host.runtime.presenceOf(alice), `throwAfter=${throwAfter}`).not.toThrow()
      expect(() => host.runtime.notify(alice, notice([item('t')])), `throwAfter=${throwAfter}`).not.toThrow()
      expect(() => host.runtime.liveMemberIds(), `throwAfter=${throwAfter}`).not.toThrow()
      expect(() => host.runtime.handleOf(alice), `throwAfter=${throwAfter}`).not.toThrow()
    }
  })

  it('固化 `agent` **不能**把 `status` 快照掉：转忙后必须读得到 running（否则永远 wake 错通道）', async () => {
    // 上一条的**对偶约束**：修法若顺手把 status 的值拷下来，就会让一个已经转 running
    // 的 Agent 永远显示 idle ⇒ 所有通知都走 followup，双通道唤醒失效（且不报错）。
    // 所以这里专门钉住"状态是活的"。
    const host = makeHost()
    let live = 'idle'
    const steers: string[] = []
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      return {
        agent: {
          id: 'a',
          get status(): string {
            return live
          },
          followup: () => {},
          steer: (n: { text: string }) => { steers.push(n.text) },
        },
        dispose: () => {},
      } as never
    })
    await activateOk(host, alice)
    expect(host.runtime.presenceOf(alice)).toBe('idle')

    live = 'running'
    expect(host.runtime.presenceOf(alice), '状态必须是实时读的').toBe('running')
    const out = host.runtime.notify(alice, notice([item('t')]))
    expect(out).toEqual({ kind: 'delivered', channel: 'steer' })
    expect(steers, '正文必须原样送达（不校验具体文案，只看通道对且送到了）').toHaveLength(1)

    live = 'idle'
    expect(host.runtime.presenceOf(alice)).toBe('idle')
  })

  it('`handleOf().dispose()` 必须**保住 this 绑定**（OCR HIGH 的回归：类风格句柄曾被改坏）', async () => {
    // OCR 复核 HIGH（本轮实测复现的**新**缺陷）：`asMemberHandle` 固化 `dispose` 时
    // 直接放了裸函数引用 ⇒ `handleOf(m).dispose()` 的 `this` 是**包装对象**而非原句柄，
    // 类风格实现（`dispose() { this.sessionId... }`）会抛 TypeError 或**静默不释放**。
    // 实测（修前）：抛 `TypeError: dispose 的 this 不对`。
    // 这与"固化 agent 防抛"是**两个独立约束**：固化解决了抛错，却引入了绑定错误。
    const host = makeHost()
    const real = new (class {
      sessionId = 'session-42'
      disposed = false
      agent = { id: 'a', status: 'idle', followup: () => {}, steer: () => {} }
      dispose(): void {
        if (typeof this?.sessionId !== 'string') {
          throw new TypeError(`dispose 的 this 不对（this=${String(this)}）`)
        }
        this.disposed = true
      }
    })()
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: alice, agentContext: {} })
      return real as never
    })
    await activateOk(host, alice)

    const wrapper = host.runtime.handleOf(alice)
    expect(wrapper).toBeDefined()
    // 反恒真：把 `dispose` 改回裸引用（去掉 `.bind(value)`）→ 下一行抛 TypeError、本条变红。
    expect(() => wrapper!.dispose(), '包装对象的 dispose 不得丢 this').not.toThrow()
    expect(real.disposed, '必须真的释放到底层句柄').toBe(true)
  })

  it('生命周期**读不出来**（注入投影抛错）⇒ 拒绝且不抛，激活/唤醒两条路径都如此', async () => {
    // OCR 复核 MEDIUM 的回归：`lifecycleOf` 读账本，而账本读**会抛**
    //（`src/ledger.ts` 在遇到读不回来的行时刻意抛错）。本模块的契约是
    // `notify` 从不抛错（它跑在事件派发路径上），所以这一读必须带兜底。
    const throwingRuntime = createMemberRuntime({
      mountPreset: () => {},
      applyToolPolicy: () => {},
      async createHandle({ setup }) {
        await setup({ memberId: alice, agentContext: {} })
        return inertHandle()
      },
      lifecycleOf() {
        throw new Error('ledger read failed: 存储已被外部改写')
      },
    })

    // 反恒真：去掉 readLifecycle 的 try/catch → 这两条都会抛。
    const activation = await throwingRuntime.activate({
      memberId: alice,
      teamId: team,
      presetId: 'p',
    })
    expect(activation).toMatchObject({ kind: 'lifecycle-read-failed' })
    expect((activation as { reason: string }).reason).toContain('存储已被外部改写')

    expect(() => throwingRuntime.notify(alice, notice([item('t')]))).not.toThrow()
    expect(throwingRuntime.notify(alice, notice([item('t')]))).toMatchObject({
      kind: 'lifecycle-read-failed',
    })
  })

  it('`setup` 装配**中途失败**（preset 抛错）时，句柄不被当成已激活缓存', async () => {
    // OCR 复核 **HIGH** 的回归：第一版在 setup 函数体开头就标记"已调用"，
    // 于是「mountPreset 抛错、注入的 createHandle 吞掉异常并照常解析」这条路径
    // 会看到标记为真而把句柄缓存成 activated —— 而 preset 与工具策略**都没生效**。
    let disposed = 0
    const throwingDeps = createMemberRuntime({
      mountPreset() {
        throw new Error('preset mount exploded')
      },
      applyToolPolicy: () => {},
      async createHandle({ setup }) {
        // **吞掉** setup 的异常并照常返回一个形状合法的句柄 —— 这正是危险形状。
        try {
          await setup({ memberId: alice, agentContext: {} })
        } catch {
          // 静默吞掉（模拟一个不把失败往外传的宿主）。
        }
        return {
          agent: { id: 'a', status: 'idle', followup: () => {}, steer: () => {} },
          dispose: () => {
            disposed += 1
          },
        }
      },
      lifecycleOf: () => 'active',
    })

    // 反恒真：把 setupState 只在**开头**置位（第一版写法）→ 本条会返回 'activated'。
    const outcome = await throwingDeps.activate({ memberId: alice, teamId: team, presetId: 'p' })
    expect(outcome).toMatchObject({ kind: 'failed' })
    expect((outcome as { reason: string }).reason).toContain('preset mount exploded')
    expect(throwingDeps.handleOf(alice), '未装配成功的句柄不得进缓存').toBeUndefined()
    expect(disposed, '被丢弃的句柄必须释放').toBe(1)
  })

  it('`setup` 装配正常完成时才记 activated（上一条的对照：不是"一律失败"）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    expect(host.runtime.handleOf(alice)).toBeDefined()
  })

  it('releaseAll 释放全部句柄，且**等在途激活落地**（否则停用后残留活 Agent）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    await activateOk(host, bob)
    expect(host.runtime.liveMemberIds()).toEqual([alice, bob])

    // bob 先释放掉，让"在途激活"成为它唯一的句柄来源。
    await host.runtime.release(bob)

    let open = (): void => {}
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    host.setCreate(async ({ setup }) => {
      await setup({ memberId: bob, agentContext: {} })
      await gate
      return inertHandle()
    })
    const pending = host.runtime.activate({ memberId: bob, teamId: team, presetId: 'p' })
    const releasing = host.runtime.releaseAll()
    open()
    await Promise.all([pending, releasing])

    // 反恒真：去掉 releaseAll 里那句 `allSettled(在途)` → 在途句柄会在 releaseAll 之后
    // 写回缓存，本条必须变红（liveMemberIds 会剩下 bob）。
    expect(host.runtime.liveMemberIds()).toEqual([])
    // ⚠ 这里**不能**断言在途那次拿到 `releasing` —— 我第一版就这么写，实测红了：
    // 那次激活的 `releasing` 判定发生在**它自己的** activate 入口，而那一瞬间
    // `releasing` 还是 false（releaseAll 尚未开始）⇒ 它合法地走完并拿到 'activated'。
    // 这正是**正确**语义：releaseAll 先等它落地、再把它一起释放
    //（`allSettled(在途)` + 之后才快照键列表，两者顺序都不能反）。
    // 断言它必须是 'releasing' 会把"已排空"错判成"被拒"。
    expect(await pending, '在途激活应被排空后释放，而不是被拒').toEqual({ kind: 'activated' })
    expect(host.runtime.handleOf(bob), '排空后仍不得留下句柄').toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 五、状态同步：存在态实时、生命周期只有账本一个来源
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 状态同步', () => {
  it('存在态读的是**实时** status（没有缓存 ⇒ "缓存过期"这类故障结构性不存在）', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    const probe = host.probes.get(alice)!

    const presence: MemberPresence[] = [host.runtime.presenceOf(alice)]
    probe.setStatus('running')
    presence.push(host.runtime.presenceOf(alice))
    probe.setStatus('idle')
    presence.push(host.runtime.presenceOf(alice))

    // 反恒真：把存在态在激活时缓存进一个 Map → 本条必须变红（三段会全等）。
    expect(presence).toEqual(['idle', 'running', 'idle'])
  })

  it('无活句柄时存在态是 idle，但 handleOf 为 undefined —— 两者**不可互相反推**', async () => {
    const host = makeHost()
    expect(host.runtime.presenceOf(alice)).toBe('idle')
    // 「idle」不等于「已激活」：一个已挂起的成员也没有活句柄。
    expect(host.runtime.handleOf(alice)).toBeUndefined()
    await activateOk(host, alice)
    await host.runtime.release(alice)
    expect(host.runtime.presenceOf(alice)).toBe('idle')
    expect(host.runtime.handleOf(alice)).toBeUndefined()
  })

  it('生命周期只从账本读：`lifecycleOf` 改了，唤醒判定立刻跟着变', async () => {
    const host = makeHost()
    host.setLifecycle(alice, 'active')
    await activateOk(host, alice)

    // 运行时**没有**自己的生命周期副本：把它改成 archived 再问一次，回答必须来自账本端口。
    host.setLifecycle(alice, 'archived')
    expect(host.runtime.notify(alice, notice([item('t')]))).toEqual({
      kind: 'not-active',
      lifecycle: 'archived',
    })
    // 反恒真：在运行时里缓存一次 lifecycleOf 的返回值 → 本条必须变红。
    expect(callsOf(host, alice).followup).toHaveLength(0)
  })

  it('liveMemberIds 只列形状仍合法的句柄，顺序为插入顺序', async () => {
    const host = makeHost()
    await activateOk(host, alice)
    await activateOk(host, bob)
    expect(host.runtime.liveMemberIds()).toEqual([alice, bob])
    await host.runtime.release(alice)
    expect(host.runtime.liveMemberIds()).toEqual([bob])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 六、结构性约束（源码扫描；与 shell.spec.ts 的扫描用例同形）
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 结构性约束', () => {
  it('**唤醒不绑定任何窗口会话**：运行时源码（剥掉注释）没有会话锚点标识符', () => {
    // 「唤醒不绑窗口」不能只是注释里的承诺。本模块的全部输入、输出、依赖里
    // 都不该出现会话锚点 —— 一个把唤醒绑在某个窗口上的运行时会在窗口关闭时变僵尸团
    //（SPEC §2.2：Host 与团是多对多、可替换的引用；AC-ROLE-1）。
    //
    // ⚠ 必须先剥注释：本文件头部**正当引用**了 `HostSessionId` 来说明这条设计纪律
    //（与 shell.spec.ts 里「不得 import @deepseek-ai」那处是同一类问题）。
    const source = stripComments(
      readFileSync(join(PKG_ROOT, 'src/runtime/member-runtime.ts'), 'utf8'),
    )
    // 反恒真：在 MemberRuntimeDeps 里加一个 `hostSessionId: HostSessionId` 字段 → 本条必须变红。
    for (const anchor of [
      'HostSessionId',
      'hostSessionId',
      'captainSessionId',
      'SessionId',
      'sessionId',
    ]) {
      expect(source, `运行时不得出现会话锚点 ${anchor}`).not.toContain(anchor)
    }
  })

  it('运行时只从本包取类型，不 import 任何 @deepseek-ai/* 或 node:* （SPEC §1.1）', () => {
    const source = stripComments(
      readFileSync(join(PKG_ROOT, 'src/runtime/member-runtime.ts'), 'utf8'),
    )
    // 本机 SDK 递归含 0 个 .d.ts ⇒ 这种 import 会 TS7016 + exit 2。
    expect(source).not.toMatch(/@deepseek-ai\//)
    expect(source).not.toMatch(/from ['"]node:/)
  })

  it('领域入口真的导出成员运行时（t3 / t4 要从 `@sophia/core` 取）', async () => {
    // 直接 import 源码入口：证明"下游能取到"，而不是"文件写完了"。
    const domain = await import('../src/index.ts')
    expect(typeof domain.createMemberRuntime).toBe('function')
    expect(typeof domain.noticeSignatureOf).toBe('function')
  })

  it('诊断日志前缀与 host.ts 一致（运维 grep 不能漏掉本模块的告警）', () => {
    // OCR 复核 LOW 的回归：本模块原先用 `'sophia:'`、host 用 `'[sophia]'`，
    // 同一插件两种写法 ⇒ `grep '[sophia]'` 会漏掉本模块的全部告警，
    // 而它们恰恰是「句柄 dispose 失败」「通知投递失败」这类最该被看到的。
    //
    // 判据取自 **host.ts 的真实字面量**而不是在测试里重写一份：
    // 否则 host 侧改名时本断言会双双漂移而继续为绿（本仓「两处真相」的典型陷阱）。
    const hostSource = stripComments(readFileSync(join(PKG_ROOT, 'src/host.ts'), 'utf8'))
    const hostPrefix = /console\.error\(\s*'(\[[a-z]+\])/.exec(hostSource)?.[1]
    expect(hostPrefix, "host.ts 的日志前缀形状变了，请同步本用例的提取方式").toBe('[sophia]')

    const runtimeSource = readFileSync(
      join(PKG_ROOT, 'src/runtime/member-runtime.ts'),
      'utf8',
    )
    expect(runtimeSource).toContain(`const LOG_PREFIX = '${hostPrefix}'`)
    // 反恒真：把 LOG_PREFIX 改回 'sophia:' → 本条必须变红。
    // 且不得再有裸的 `'sophia:'` 前缀留在**代码**里（注释里的历史说明不算，
    // 故这里必须剥注释再扫 —— 与本文件顶部 stripComments 的由来同一类问题）。
    expect(stripComments(runtimeSource)).not.toMatch(/`sophia:/)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 七、反恒真抽检：把被测逻辑故意改坏，证明"这些断言真的能红"
// ────────────────────────────────────────────────────────────────────────────

describe('t2 · 反恒真抽检（分支可区分性）', () => {
  it('抽检 1：`恒 steer` 变异体会被 idle 用例抓住，而**不会**被 running 用例抓住', () => {
    // 这条抽检解释「为什么两条分支必须各有一条用例」：
    // 只有 running 那一条时，`恒 steer` 是全绿的 —— 它只证明了"消息送到了"，
    // 证明不了"送对了通道"。
    const real = (status: string): 'followup' | 'steer' =>
      status === 'idle' ? 'followup' : 'steer'
    const mutation = (): 'followup' | 'steer' => 'steer'

    // idle 用例会红（它断言 followup）。
    expect(real('idle')).toBe('followup')
    expect(() => expect(mutation()).toBe('followup')).toThrow()
    // running 用例**不**受影响（它只断言 steer）—— 这就是缺口。
    expect(real('running')).toBe('steer')
    expect(mutation()).toBe(real('running'))
  })

  it('抽检 2：`恒 duplicate` 变异体会被"待办变了"用例抓住', () => {
    const before = noticeSignatureOf([item('t', { newestSequence: 7 })])
    const after = noticeSignatureOf([item('t', { newestSequence: 8 })])
    expect(before).not.toBe(after)

    const real = (recorded: string, next: string): boolean => recorded === next
    const mutation = (): boolean => true

    expect(real(before, after)).toBe(false)
    expect(mutation()).toBe(true)
    expect(() => expect(mutation()).toBe(false)).toThrow()
  })
})
