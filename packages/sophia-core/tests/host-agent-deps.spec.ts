/**
 * 真 Agent 底座接线（`src/runtime/host-agent-deps.ts`）的用例。
 *
 * ## 这一组证的是什么（口径，不许往上加）
 *
 * 「给定宿主 ctx，底座会**按上游契约**把成员装配起来」—— 具体是四件事：
 * 1. preset 在 `setup(agentCtx)` 里挂、且挂在**那个** agentCtx 上；
 * 2. 工具策略走 `agentCtx.tools.restrict({allow})`（有策略却注入不进去就失败，不静默跳过）；
 * 3. `agents.create` 的入参：派生 sessionId、绝对 cwd（且目录真的建了）、preset、模型；
 * 4. `setup` 回调**真的被调用**（上游 `dsh-agent-loop:1856` 的约定 + 本仓运行时的
 *    `SetupState` 校验：不调就判 `failed`）。
 *
 * **不**声称「真 agent 起来了 / 开始干活了」：这里 `agents` 是假的。真跑一次要烧一次
 * 真实模型 turn，属于父任务分段的后续步骤。
 */

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { openLedger, type Ledger, type LedgerCommitInput } from '../src/ledger.ts'
import {
  SOPHIA_MEMBER_PRESET_ID,
  createHostAgentDeps,
  memberSessionIdOf,
  memberWorkspacePathOf,
  type HostAgentContext,
} from '../src/runtime/host-agent-deps.ts'
import { createMemberRuntime, type MemberId } from '../src/index.ts'
import type { HostSessionId } from '../src/types/ids.ts'
import type { MemberAgentSetup } from '../src/runtime/member-runtime.ts'

const MEMBER_A = 'sophia-xing-yi-zhu-shi-0000000a' as MemberId
const MEMBER_B = 'sophia-xing-yi-zhu-shi-0000000b' as MemberId

const tempDirs: string[] = []
const openLedgers: Ledger[] = []

afterEach(() => {
  // 先关账本再删目录：sqlite 的文件句柄没释放时删目录会得到 EPERM
  //（那会把「用例失败」伪装成「清理失败」，看起来像另一个问题）。
  for (const ledger of openLedgers.splice(0)) ledger.close()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function newTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** 一个 ctx 桩：只有 `get`，且只认识给定的那几个服务（与 `src/host.ts` 的取服务习惯同形）。 */
function ctxOf(services: Record<string, unknown>): HostAgentContext {
  return { get: (name: string) => services[name] }
}

/**
 * 记录型的假 DSH 服务（与 `tests/host-routes.spec.ts` 的那个同形，但更小）。
 *
 * `callSetup` 可关掉：用来证「不调 setup ⇒ 运行时判 failed」这条上游约定
 * 在**本仓的接线里**仍然是活的（它是本批第一版真实踩到的坑）。
 */
function fakeServices(
  options: { readonly callSetup?: boolean; readonly provider?: string; readonly model?: string } = {},
): {
  services: Record<string, unknown>
  agentCtx: { tools: { restrict(filter: { allow: readonly string[] }): () => void } }
  mounts: Array<{ agentCtx: unknown; presetId: string }>
  restrictions: Array<readonly string[]>
  creates: Array<Record<string, unknown>>
  setupCalls: MemberAgentSetup[]
} {
  const mounts: Array<{ agentCtx: unknown; presetId: string }> = []
  const restrictions: Array<readonly string[]> = []
  const creates: Array<Record<string, unknown>> = []
  const setupCalls: MemberAgentSetup[] = []
  const agentCtx = {
    tools: {
      restrict: (filter: { allow: readonly string[] }) => {
        restrictions.push(filter.allow)
        return () => undefined
      },
    },
  }
  const services: Record<string, unknown> = {
    agentDefaultModel: {
      currentSelection: () => ({ provider: options.provider ?? 'global-p', model: options.model ?? 'global-m' }),
    },
    agentPresets: {
      mount: (ctx: unknown, presetId: string) => {
        mounts.push({ agentCtx: ctx, presetId })
        return {}
      },
    },
    agents: {
      create: async (input: {
        setup: (agentCtx: unknown, agent: unknown) => Promise<void>
        [key: string]: unknown
      }) => {
        creates.push(input)
        if (options.callSetup !== false) await input.setup(agentCtx, { id: 'fake-agent' })
        return {
          agent: { id: 'fake-agent', status: 'idle', followup: () => undefined, steer: () => undefined },
          dispose: () => undefined,
        }
      },
    },
  }
  return { services, agentCtx, mounts, restrictions, creates, setupCalls }
}

/** 造一个只有 `team/member-added` 的最小账本（成员自己的模型可空）。 */
function ledgerWithMember(model: { provider: string; model: string } | null): Ledger {
  const dir = newTempDir('sophia-deps-')
  const ledger = openLedger({ path: join(dir, 'ledger.sqlite') })
  openLedgers.push(ledger)
  // 与 `src/ledger.ts:273` 同形的构造（`HostSessionId` 是 branded 类型）。
  const actor = { kind: 'host', hostSessionId: 'test-host' as HostSessionId } as const
  const commits: Array<Omit<LedgerCommitInput, 'actor'>> = [
    {
      kind: 'team/created',
      data: {
        teamId: 'team-1' as never,
        name: '甲团',
        kind: 'persistent',
        parentTeamId: null,
        createdByHostSessionId: null,
      },
    } as unknown as LedgerCommitInput,
    {
      kind: 'team/member-added',
      data: {
        teamId: 'team-1' as never,
        member: { position: '行一主事', name: '行一主事', memberId: MEMBER_A },
        lifecycle: 'active',
        model,
      },
    } as unknown as LedgerCommitInput,
  ]
  for (const commit of commits) ledger.commit({ ...commit, actor })
  return ledger
}

describe('成员 sessionId 的派生规则（唯一出处）', () => {
  it('★ 同一个 memberId 恒等（这是「可 resume」的全部前提）', async () => {
    const first = memberSessionIdOf(MEMBER_A)
    // ⚠ 必须**跨过一个时间片**再取第二次。实测（变异自检）：把实现改成
    // `` `sophia-member-${memberId}-${Date.now()}` `` 时，同一毫秒内的两次调用
    // 会给出**相同**结果 ⇒ 那种写法在本条下仍然是**绿的**。
    // 一条从未红过的断言与没有断言等价，所以这里显式等 5ms。
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(memberSessionIdOf(MEMBER_A)).toBe(first)
    expect(memberSessionIdOf(MEMBER_A)).toBe(first)
  })

  it('不同成员必须得到不同的会话（撞了就是两个成员共享一个会话）', () => {
    expect(memberSessionIdOf(MEMBER_A)).not.toBe(memberSessionIdOf(MEMBER_B))
  })

  it('形状可辨：带 `sophia-member-` 前缀（会话列表里一眼看出是成员会话）', () => {
    expect(memberSessionIdOf(MEMBER_A)).toBe(`sophia-member-${MEMBER_A}`)
  })

  it('工作目录落在 dataDir/members/<memberId> 下', () => {
    expect(memberWorkspacePathOf(join('C:', 'data'), MEMBER_A)).toBe(
      join('C:', 'data', 'members', MEMBER_A),
    )
  })
})

describe('createHostAgentDeps：把宿主 ctx 装配成成员运行时依赖', () => {
  it('★ 只覆盖三个端口（`lifecycleOf` 不在这里 —— 生命周期的唯一真相是账本投影）', () => {
    const fake = fakeServices()
    const deps = createHostAgentDeps({
      ctx: ctxOf(fake.services),
      dataDir: newTempDir('sophia-ws-'),
    })
    // 覆盖多了就意味着在别处又写了一份生命周期真相；这四个之外的键都是缺陷。
    expect(Object.keys(deps).sort()).toEqual(['applyToolPolicy', 'createHandle', 'mountPreset'])
  })

  it('★ `mountPreset` 必须用 `agentPresets.mount(agentCtx, presetId)`，且 ctx 是**那个** agentCtx', async () => {
    const fake = fakeServices()
    const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir: newTempDir('sophia-ws-') })
    const agentCtx = { marker: 'the-agent-ctx' }
    await deps.mountPreset({ memberId: MEMBER_A, agentContext: agentCtx }, SOPHIA_MEMBER_PRESET_ID)
    expect(fake.mounts).toHaveLength(1)
    // 同一个对象（`toEqual` 就够了，但这里要钉「不是复制品」）：
    expect(fake.mounts[0]!.agentCtx).toBe(agentCtx)
    expect(fake.mounts[0]!.presetId).toBe('sophia')
  })

  it('★ `applyToolPolicy` 走 `agentCtx.tools.restrict({allow})`', () => {
    const fake = fakeServices()
    const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir: newTempDir('sophia-ws-') })
    deps.applyToolPolicy({ memberId: MEMBER_A, agentContext: fake.agentCtx }, ['t1', 't2'])
    expect(fake.restrictions).toEqual([['t1', 't2']])
  })

  it('★ agentCtx 上取不到 `tools.restrict` ⇒ **抛**（有策略注入不进去 = 工具面比预期更宽）', () => {
    const fake = fakeServices()
    const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir: newTempDir('sophia-ws-') })
    // 反恒真：把这条改成 `return`（静默跳过）⇒ 本条必红。
    expect(() => { deps.applyToolPolicy({ memberId: MEMBER_A, agentContext: {} }, ['t1']) }).toThrow(
      /tools\.restrict 不可用/,
    )
  })

  it('★ `createHandle` 的入参：派生 sessionId + 绝对 cwd（目录真的建了）+ preset + **成员自己的**模型', async () => {
    const dataDir = newTempDir('sophia-ws-')
    const fake = fakeServices({ provider: 'global-p', model: 'global-m' })
    const ledger = ledgerWithMember({ provider: 'pinned-p', model: 'pinned-m' })
    try {
      const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir, ledger })
      const handle = await deps.createHandle({
        memberId: MEMBER_A,
        presetId: SOPHIA_MEMBER_PRESET_ID,
        setup: async (setup) => {
          // 运行时在这个回调里挂 preset 与工具策略；这里只要证明它被调到了。
          await deps.mountPreset(setup, SOPHIA_MEMBER_PRESET_ID)
        },
      })
      expect(fake.creates).toHaveLength(1)
      const created = fake.creates[0]! as {
        sessionId: string
        meta: { cwd: string; agentPreset: string }
        agentOptions: { provider: string; model: string }
      }
      expect(created.sessionId).toBe(memberSessionIdOf(MEMBER_A))
      expect(created.meta.agentPreset).toBe('sophia')
      const cwd = created.meta.cwd
      expect(isAbsolute(cwd), `cwd 必须是绝对路径（收到 ${cwd}）`).toBe(true)
      expect(cwd).toBe(memberWorkspacePathOf(dataDir, MEMBER_A))
      // 目录**真的**存在（不是只写了一个字符串进 meta）。
      expect(statSync(cwd).isDirectory()).toBe(true)
      // 成员自己的模型优先于全局默认。
      expect(created.agentOptions).toEqual({ provider: 'pinned-p', model: 'pinned-m' })
      // 句柄形状透传（上游 `publish()` 返回的就是 `{agent, dispose}`）。
      expect(typeof handle.dispose).toBe('function')
      expect(handle.agent.id).toBe('fake-agent')
    } finally {
      ledger.close()
    }
  })

  it('成员自带模型为 `null` ⇒ 落全局默认（`agentDefaultModel.currentSelection()`）', async () => {
    const fake = fakeServices({ provider: 'global-p', model: 'global-m' })
    const ledger = ledgerWithMember(null)
    try {
      const deps = createHostAgentDeps({
        ctx: ctxOf(fake.services),
        dataDir: newTempDir('sophia-ws-'),
        ledger,
      })
      await deps.createHandle({
        memberId: MEMBER_A,
        presetId: SOPHIA_MEMBER_PRESET_ID,
        setup: async () => undefined,
      })
      expect((fake.creates[0]! as { agentOptions: unknown }).agentOptions).toEqual({
        provider: 'global-p',
        model: 'global-m',
      })
    } finally {
      ledger.close()
    }
  })

  it('★ 既没有成员模型、也拿不到全局默认 ⇒ 抛（**不凭空造一个** provider/model）', async () => {
    const noModel = fakeServices()
    delete (noModel.services as Record<string, unknown>)['agentDefaultModel']
    const ledger = ledgerWithMember(null)
    try {
      const deps = createHostAgentDeps({
        ctx: ctxOf(noModel.services),
        dataDir: newTempDir('sophia-ws-'),
        ledger,
      })
      // 反恒真：把这条改成兜底 `{provider:'deepseek',model:'x'}` ⇒ 本条必红
      //（那会让成员在**没被授权**的模型上烧钱）。
      await expect(
        deps.createHandle({ memberId: MEMBER_A, presetId: 'sophia', setup: async () => undefined }),
      ).rejects.toThrow(/无法确定 provider\/model/)
    } finally {
      ledger.close()
    }
  })

  it('★ 缺 `ctx.agents` ⇒ 抛一条说得清「该装哪一行」的错（**不**假装能激活）', async () => {
    const fake = fakeServices()
    delete (fake.services as Record<string, unknown>)['agents']
    const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir: newTempDir('sophia-ws-') })
    await expect(
      deps.createHandle({ memberId: MEMBER_A, presetId: 'sophia', setup: async () => undefined }),
    ).rejects.toThrow(/拿不到 ctx\.agents/)
  })

  it('缺 `ctx.agentPresets` ⇒ 抛（并点明本机由哪个包提供这一行）', async () => {
    const fake = fakeServices()
    delete (fake.services as Record<string, unknown>)['agentPresets']
    const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir: newTempDir('sophia-ws-') })
    await expect(deps.mountPreset({ memberId: MEMBER_A, agentContext: {} }, 'sophia')).rejects.toThrow(
      /拿不到 ctx\.agentPresets/,
    )
  })

  it('★ dataDir 是相对路径 ⇒ 抛（上游要绝对 cwd；错误里点明 SOPHIA_DATA_DIR）', async () => {
    const fake = fakeServices()
    const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir: 'relative-data-dir' })
    // 反恒真：去掉 `isAbsolute` 那道门 ⇒ 本条必红（错误会在上游以一句没有上下文的话出现）。
    await expect(
      deps.createHandle({ memberId: MEMBER_A, presetId: 'sophia', setup: async () => undefined }),
    ).rejects.toThrow(/不是绝对路径/)
  })

  it('★ 端到端（本文件内）：真运行时 + 真底座 ⇒ `activate` 返回 `activated`，且 preset/策略都挂上了', async () => {
    // 这条把「底座」与「运行时」接在一起跑一次：`setup` 回调的调用链
    //（运行时 → 本文件 → 假 agents.create → 回运行时）在这里整体过一遍。
    const fake = fakeServices()
    const ledger = ledgerWithMember(null)
    try {
      const dataDir = newTempDir('sophia-ws-')
      const deps = createHostAgentDeps({ ctx: ctxOf(fake.services), dataDir, ledger })
      const runtime = createMemberRuntime({
        ...deps,
        lifecycleOf: () => 'active',
      })
      const outcome = await runtime.activate({
        memberId: MEMBER_A,
        teamId: 'team-1' as never,
        presetId: SOPHIA_MEMBER_PRESET_ID,
        toolPolicy: { allow: ['t1'] },
      })
      expect(outcome).toEqual({ kind: 'activated' })
      expect(fake.mounts.map((one) => one.presetId)).toEqual(['sophia'])
      expect(fake.restrictions).toEqual([['t1']])
      expect(fake.creates).toHaveLength(1)
    } finally {
      ledger.close()
    }
  })

  it('★ 假 `agents.create` **不调** `setup` ⇒ 运行时判 `failed`（上游约定在本仓是活的）', async () => {
    // 这条钉的是那个坑本身：上游要求 `create` 的实现调用 `setup(agentCtx, agent)`，
    // 而本仓运行时**校验**它被调用过（`SetupState`）。本批第一版漏了它，
    // `activate` 直接 `failed`，唤醒全被句柄门挡成 `no-handle` —— 症状与根因隔得很远。
    const fake = fakeServices({ callSetup: false })
    const ledger = ledgerWithMember(null)
    try {
      const deps = createHostAgentDeps({
        ctx: ctxOf(fake.services),
        dataDir: newTempDir('sophia-ws-'),
        ledger,
      })
      const runtime = createMemberRuntime({ ...deps, lifecycleOf: () => 'active' })
      const outcome = await runtime.activate({
        memberId: MEMBER_A,
        teamId: 'team-1' as never,
        presetId: SOPHIA_MEMBER_PRESET_ID,
      })
      expect(outcome.kind).toBe('failed')
    } finally {
      ledger.close()
    }
  })
})
