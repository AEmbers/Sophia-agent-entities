/**
 * t8 · 装配层端到端集成测试（`tests/assembly.spec.ts`）。
 *
 * ## 验证契约
 * 1. `createTeam` 落地：落 `team/created`（基座带 `requestId`）与 `team/member-added`（名册展开 + `model` 保真）；
 * 2. 跨进程幂等：同一 `requestId` 查回同一 `teamId`，绝不重复写入；
 * 3. `host.ts apply()` 接线：`createSophiaTools` 5 个工具经 `toDefineToolOptions` + `defineTool` 注册进 `ctx.tools`；
 * 4. 结构化断言：断言注册表里确实出现 5 个 `sophia_*` 名字，不得以"没抛错"当判据；
 * 5. 运行时与路由对接：`createMemberRuntime` 句柄与委托依赖接通，`/status` 路由如实回报能力边界；
 * 6. 服务访问方式：兼容 `ctx.tools` 与 `ctx.get('tools')`，迟到挂载完整支持。
 *
 * @module tests/assembly
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ASSEMBLY_CALLER,
  assembleSophiaToolsDeps,
  createDefaultMemberRuntime,
  createDelegationDeps,
  createInMemoryHumanInbox,
  createSophiaProjectionPorts,
  createTeam,
  ensureRootTeam,
  resolveAssemblyCaller,
} from '../src/host-assembly.ts'
import {
  asDefineTool,
  asToolsRegistry,
  toDefineToolOptions,
  type SophiaDefineTool,
} from '../src/host-tools.ts'
import { apply, inject, name } from '../src/host.ts'
import { openLedger, type Ledger, type LedgerCommitInput } from '../src/ledger.ts'
import { requestSpawn, type SpawnRequest } from '../src/delegation.ts'
import { POSITIONS } from '../src/naming.ts'
import { rebuildFold } from '../src/projection/index.ts'
import { createSophiaTools, SOPHIA_TOOL_NAMES } from '../src/tools/index.ts'
import type { MemberId, RequestId, TeamId } from '../src/types/ids.ts'
import type { MemberAddedData, TeamCreatedData } from '../src/types/operations.ts'
import type { TeamSpec } from '../src/types/team.ts'

// ────────────────────────────────────────────────────────────────────────────
// 真实 defineTool 解析（复用宿主环境 SDK）
// ────────────────────────────────────────────────────────────────────────────

function sdkCandidates(): readonly string[] {
  const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  const explicit = process.env['DSH_TOOLS_PATH']
  return [
    ...(typeof explicit === 'string' && explicit !== '' ? [explicit] : []),
    join(dshHome, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    join(dshHome, 'core-0.1.5-rc.1', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ]
}

let realDefineTool: SophiaDefineTool | undefined

beforeAll(async () => {
  for (const candidate of sdkCandidates()) {
    if (!existsSync(candidate)) continue
    const mod = (await import(pathToFileURL(candidate).href)) as Record<string, unknown>
    const dt = asDefineTool(mod['defineTool'])
    if (dt !== undefined) {
      realDefineTool = dt
      return
    }
  }
})

function getDefineTool(): SophiaDefineTool {
  if (realDefineTool !== undefined) return realDefineTool
  // 若本机无 SDK（CI/极简环境），提供符合 defineTool 契约的模拟器
  return (options: unknown) => {
    const opt = options as Record<string, unknown>
    return {
      name: opt['name'],
      description: opt['description'],
      parameters: { type: 'object', properties: opt['parameters'] },
      output: opt['output'],
      execute: opt['execute'],
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 测试替身与脚手架
// ────────────────────────────────────────────────────────────────────────────

const tempDirs: string[] = []

function newTempLedger(): { ledger: Ledger; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'sophia-assembly-'))
  tempDirs.push(dir)
  const path = join(dir, 'ledger.sqlite')
  return { ledger: openLedger({ path }), path }
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 忽略 Windows 文件句柄残留
    }
  }
  tempDirs.length = 0
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

interface MockToolsRegistry {
  readonly registered: Map<string, Record<string, unknown>>
  readonly register: (definition: never) => () => void
}

function makeMockRegistry(): MockToolsRegistry {
  const registered = new Map<string, Record<string, unknown>>()
  return {
    registered,
    register(definition: never): () => void {
      const def = definition as Record<string, unknown>
      const toolName = String(def['name'])
      registered.set(toolName, def)
      return () => {
        registered.delete(toolName)
      }
    },
  }
}

interface FakeRes {
  status: number
  headers: Record<string, string>
  body: string
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

function makeFakeRes(): FakeRes {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(body) {
      this.body = typeof body === 'string' ? body : (body ? Buffer.from(body).toString('utf8') : '')
    },
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 测试集 1：createTeam 真实落地与幂等性
// ────────────────────────────────────────────────────────────────────────────

describe('t8 · createTeam 落地与幂等契约', () => {
  it('落账事实完整：写 team/created（requestId 在基座）与 team/member-added（含 model）', async () => {
    const { ledger } = newTempLedger()
    const requestId = 'req-spawn-001' as RequestId
    const requesterMemberId = 'sophia-xing-yi-zhu-shi-0000000a' as MemberId

    const spec: TeamSpec = {
      name: '神策军',
      roster: [
        {
          position: '星仪主事',
          count: 1,
          model: { provider: 'deepseek', model: 'deepseek-chat' },
        },
        {
          position: '灵台郎',
          count: 2,
          model: null,
        },
      ],
      tasks: ['初始化架构'],
    }

    const request: SpawnRequest = {
      requestId,
      requesterMemberId,
      requesterKind: 'persistent',
      targetKind: 'temporary',
      spec,
    }

    const teamId = await createTeam(ledger, request)
    expect(teamId).toMatch(/^team-[0-9a-f]{8}$/)

    const events = ledger.read({}).events
    // 1 条 team/created + 3 条 team/member-added = 4 条
    expect(events).toHaveLength(4)

    // 1. 验证 team/created
    const created = events[0]!
    expect(created.kind).toBe('team/created')
    // ★ 关键断言：requestId 在基座，而非 data 中
    expect(created.requestId).toBe(requestId)
    const createdData = created.data as unknown as TeamCreatedData
    expect(createdData.teamId).toBe(teamId)
    expect(createdData.name).toBe('神策军')
    expect(createdData.kind).toBe('temporary')
    expect(createdData.ownerMemberId).toBe(requesterMemberId)
    expect(createdData.parentTeamId).toBeNull()

    // 2. 验证 team/member-added
    const memberEvents = events.slice(1)
    expect(memberEvents).toHaveLength(3)

    // 成员 1：星仪主事（model 携带具体值）
    const m1Data = memberEvents[0]!.data as unknown as MemberAddedData
    expect(m1Data.teamId).toBe(teamId)
    expect(m1Data.member.position).toBe('星仪主事')
    expect(m1Data.member.name).toBe('星仪主事')
    expect(m1Data.member.memberId).toMatch(/^sophia-xing-yi-zhu-shi-[0-9a-f]{8}$/)
    expect(m1Data.lifecycle).toBe('active')
    expect(m1Data.model).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })

    // 成员 2：灵台郎（model 为 null）
    const m2Data = memberEvents[1]!.data as unknown as MemberAddedData
    expect(m2Data.teamId).toBe(teamId)
    expect(m2Data.member.position).toBe('灵台郎')
    expect(m2Data.member.name).toBe('灵台郎')
    expect(m2Data.model).toBeNull()

    // 成员 3：灵台郎（同团第 2 名，分配名「灵台郎-2」）
    const m3Data = memberEvents[2]!.data as unknown as MemberAddedData
    expect(m3Data.teamId).toBe(teamId)
    expect(m3Data.member.position).toBe('灵台郎')
    expect(m3Data.member.name).toBe('灵台郎-2')
    expect(m3Data.member.memberId).not.toBe(m2Data.member.memberId)
    expect(m3Data.model).toBeNull()
  })

  it('跨进程幂等：同 requestId 重复调用 createTeam 返回同一 teamId，不追加事件', async () => {
    const { ledger } = newTempLedger()
    const requestId = 'req-idempotency-1' as RequestId
    const request: SpawnRequest = {
      requestId,
      requesterMemberId: 'sophia-xing-yi-zhu-shi-0000000a' as MemberId,
      requesterKind: 'temporary',
      targetKind: 'temporary',
      spec: {
        name: '幂等测试团',
        roster: [{ position: '历算主事', count: 1 }],
        tasks: [],
      },
    }

    const firstTeamId = await createTeam(ledger, request)
    const eventsAfterFirst = ledger.read({}).events.length

    // 第二次调用同 requestId
    const secondTeamId = await createTeam(ledger, request)
    expect(secondTeamId).toBe(firstTeamId)

    const eventsAfterSecond = ledger.read({}).events.length
    expect(eventsAfterSecond).toBe(eventsAfterFirst)
  })

  it('接入 delegation 派生入口：requestSpawn 临时团免审直建落账并查回', async () => {
    const { ledger } = newTempLedger()
    const deps = createDelegationDeps({ ledger })

    const requestId = 'req-delegation-spawn-1' as RequestId
    const outcome = await requestSpawn(deps, {
      requestId,
      requesterMemberId: 'sophia-xing-yi-zhu-shi-0000000a' as MemberId,
      requesterKind: 'persistent',
      targetKind: 'temporary', // 临时团免审直建
      spec: {
        name: '免审临时团',
        roster: [{ position: '推步主事', count: 1 }],
        tasks: [],
      },
    })

    expect(outcome.kind).toBe('created')
    if (outcome.kind === 'created') {
      expect(outcome.teamId).toMatch(/^team-[0-9a-f]{8}$/)
      // 验证账本中确已写入
      const events = ledger.read({}).events
      expect(events.some((e) => e.kind === 'team/created' && e.requestId === requestId)).toBe(true)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 测试集 2：host.ts apply 接线工具与运行时
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// t8 · 根团自举（ensureRootTeam）：派生链的第一推动力
//
// 为什么单独立一组（2026-09-24 线上实测）：空账本 ⇒ 认不出装配身份 ⇒
// `sophia_spawn_team` 的 unknown-caller 拒绝 ⇒ 账本永远空 ⇒ 面板永远空态。
// 本组钉死「自举补上起点」与「派生链第一次真正跑通」两件事。
// ────────────────────────────────────────────────────────────────────────────

describe('t8 · 根团自举：账本为空时补上第一推动力', () => {
  it('写入「索菲亚根团 + 钦天监监正」，且重复调用零写入（幂等）', () => {
    const { ledger } = newTempLedger()
    const before = ledger.head().sequence

    ensureRootTeam(ledger)
    ensureRootTeam(ledger) // 第二次必须什么都不写

    const fold = rebuildFold(ledger).fold
    expect(fold.teams.size).toBe(1)
    expect(fold.members.size).toBe(1)

    const team = [...fold.teams.values()][0]
    const member = [...fold.members.values()][0]
    expect(team?.kind).toBe('persistent')
    expect(team?.name).toBe('索菲亚')
    expect(team?.ownerMemberId).toBe(member?.memberId)
    expect(member?.position).toBe('钦天监监正')
    expect(member?.lifecycle).toBe('active')

    // 反恒真：把幂等判据（`fold.teams.size > 0` 早返回）删掉 ⇒ 这里变 4 条 ⇒ 红。
    expect(ledger.head().sequence - before).toBe(2)
  })

  it('自举后 caller 自愈为索菲亚，派生链第一次真正跑通（临时 created / 持久 awaiting）', async () => {
    const { ledger } = newTempLedger()
    ensureRootTeam(ledger)

    const deps = assembleSophiaToolsDeps({ ledger })
    // 关键：caller 不再是命中不了账本的装配占位身份 —— 那正是死锁的成因。
    expect(deps.caller.memberId).not.toBe(ASSEMBLY_CALLER.memberId)
    expect(deps.projection.callerKindOf(deps.caller.memberId)).toBe('persistent')

    const tools = createSophiaTools(deps)
    const spawn = tools.find((tool) => tool.name === 'sophia_spawn_team')
    if (spawn === undefined) throw new Error('未注册 sophia_spawn_team')

    // 临时团：免审直建（FR-5.3.5）
    const temporary = (await spawn.run({
      targetKind: 'temporary',
      name: '自举验证·临时',
      roster: [{ position: '灵台主事', count: 1 }],
      tasks: [],
    })) as { readonly kind?: string }
    expect(temporary.kind).toBe('created')

    // 持久团：仍必须过两级审批 —— 人类收件箱是最终门，权限强度不变。
    const persistent = (await spawn.run({
      targetKind: 'persistent',
      name: '自举验证·持久',
      roster: [{ position: '星图主事', count: 1 }],
      tasks: [],
    })) as { readonly kind?: string }
    expect(persistent.kind).toBe('awaitingHumanApproval')
  })

  it('半截状态（**根团**有团无成员）会被补齐 —— 否则死锁会以更隐蔽的方式重现', () => {
    const { ledger } = newTempLedger()
    // 模拟「team/created 成功、team/member-added 失败」的半截账本。
    //
    // ⚠ 这条事实的 `name` **必须是根团名**（与 `host-assembly.ts` 的私有常量
    // `ROOT_TEAM_NAME` 同值 —— 该常量未导出，故此处写字面量）。原因：`ensureRootTeam`
    // 只承认「名字与 kind 都对得上的根团」才复用（OCR 复核 HIGH 指出初版拿
    // `[...fold.teams.keys()][0]` 当目标，会把创始人塞进账本里**任意**一个先出现的团）。
    // 所以本用例复现的是「**根团**半截」；「无关团半截」是另一条语义，见下一条用例。
    ledger.commit({
      kind: 'team/created',
      data: {
        teamId: 'team-00000000' as TeamId,
        kind: 'persistent',
        ownerMemberId: null,
        parentTeamId: null,
        name: '索菲亚',
      },
      actor: { kind: 'human', humanId: 'test-half-bootstrap' },
    })
    expect(rebuildFold(ledger).fold.members.size).toBe(0)

    ensureRootTeam(ledger)

    const fold = rebuildFold(ledger).fold
    expect(fold.members.size).toBe(1)
    const member = [...fold.members.values()][0]
    expect(member?.position).toBe(POSITIONS[0])
    expect(member?.lifecycle).toBe('active')
    // **不重复建团**：仍是原来那个团，总数没有变成 2。
    expect(fold.teams.size).toBe(1)
    expect(fold.teams.has('team-00000000' as TeamId)).toBe(true)
    // 补齐的意义就在这里：它真的能被解析成发起方（死锁解除）。
    expect(
      assembleSophiaToolsDeps({ ledger }).projection.callerKindOf(
        member?.memberId ?? ('' as MemberId),
      ),
    ).toBe('persistent')
  })

  it('无关团队（有团无成员）**不被**塞入创始人 —— 授权归因不得被污染', () => {
    // 本用例是 OCR 复核 HIGH 那条缺陷的**回归防护**：初版把「半截状态」的修复目标
    // 写成 `[...fold.teams.keys()][0]`（Map 的插入序）⇒ 账本里先有别的团时，创始人
    // 「钦天监监正」会被塞进**那个无关团队**，紧接着 `resolveAssemblyCaller` 会选中
    // 这个活跃成员 ⇒ **之后所有工具调用都被归因到它**。
    const { ledger } = newTempLedger()
    ledger.commit({
      kind: 'team/created',
      data: {
        teamId: 'team-00000000' as TeamId,
        kind: 'persistent',
        ownerMemberId: null,
        parentTeamId: null,
        name: '别的业务线建的团',
      },
      actor: { kind: 'human', humanId: 'test-unrelated-team' },
    })

    ensureRootTeam(ledger)

    const fold = rebuildFold(ledger).fold
    // ★ 核心判据：账本里**已有别的团、且没有根团** ⇒ **不自举**，也不往那个团塞人。
    // （早期版本会在这里新建一个根团，或者更糟 —— 把创始人塞进那个无关团。
    //   现在的规则是「只在账本**完全为空**时给第一推动力」，理由见 `ensureRootTeam`。）
    expect(fold.teams.size).toBe(1)
    expect(fold.members.size).toBe(0)
    // 那个无关团队**原样保留**：还在账本里、名字没变。
    expect(fold.teams.has('team-00000000' as TeamId)).toBe(true)
    expect(fold.teams.get('team-00000000' as TeamId)?.name).toBe('别的业务线建的团')
  })
})

describe('t8 · host.ts apply() 工具注册与装配接线', () => {
  it('★ 结构化断言：5 个 sophia_* 工具全部注册进 ctx.tools（不得以未抛错作判据）', async () => {
    const { ledger, path } = newTempLedger()
    process.env['SOPHIA_DATA_DIR'] = join(path, '..')

    const mockRegistry = makeMockRegistry()
    const defineTool = getDefineTool()
    const effects: Array<() => void> = []

    const ctx = {
      get: (key: string) => {
        if (key === 'tools') return mockRegistry
        if (key === 'defineTool') return defineTool
        return undefined
      },
      effect: (fn: () => void | (() => void)) => {
        const d = fn()
        if (typeof d === 'function') effects.push(d)
      },
      on: () => {},
    }

    apply(ctx as never, { defineTool, ledger })

    // ★ 核心断言：结构化断言注册表内确实出现 5 个 sophia_* 工具
    const registeredNames = [...mockRegistry.registered.keys()].sort()
    const expectedNames = [...SOPHIA_TOOL_NAMES].sort()

    expect(registeredNames).toEqual(expectedNames)
    expect(registeredNames).toEqual([
      'sophia_context_rollover',
      'sophia_spawn_team',
      'sophia_switch_model',
      'sophia_task_claim',
      'sophia_team_message',
    ])

    // 每个注册的定义满足结构
    for (const name of expectedNames) {
      const def = mockRegistry.registered.get(name)
      expect(def).toBeDefined()
      expect(def!['name']).toBe(name)
      expect(typeof def!['description']).toBe('string')
    }
  })

  it('effect 可逆性：卸载时注销全部 5 个工具', async () => {
    const { ledger } = newTempLedger()
    const mockRegistry = makeMockRegistry()
    const defineTool = getDefineTool()
    const effects: Array<() => void> = []

    const ctx = {
      get: (key: string) => (key === 'tools' ? mockRegistry : undefined),
      effect: (fn: () => void | (() => void)) => {
        const d = fn()
        if (typeof d === 'function') effects.push(d)
      },
      on: () => {},
    }

    apply(ctx as never, { defineTool, ledger })
    expect(mockRegistry.registered.size).toBe(5)

    // 触发全部 effect 的 disposer 回收
    for (const dispose of effects) {
      dispose()
    }

    expect(mockRegistry.registered.size).toBe(0)
  })

  it('服务访问方式：兼容 ctx.tools 属性直接访问与 ctx.get("tools") 访问', async () => {
    const { ledger } = newTempLedger()
    const defineTool = getDefineTool()

    // 1. ctx.tools 属性访问模式
    const regProp = makeMockRegistry()
    const ctxProp = {
      tools: regProp,
      get: () => undefined,
      effect: (fn: () => void | (() => void)) => fn(),
      on: () => {},
    }
    apply(ctxProp as never, { defineTool, ledger })
    expect(regProp.registered.size).toBe(5)

    // 2. ctx.get("tools") 模式
    const regGet = makeMockRegistry()
    const ctxGet = {
      get: (key: string) => (key === 'tools' ? regGet : undefined),
      effect: (fn: () => void | (() => void)) => fn(),
      on: () => {},
    }
    apply(ctxGet as never, { defineTool, ledger })
    expect(regGet.registered.size).toBe(5)
  })

  it('迟到挂载：tools 服务在 apply 之后到达时，通过 internal/service 补挂成功', async () => {
    const { ledger } = newTempLedger()
    const mockRegistry = makeMockRegistry()
    const defineTool = getDefineTool()
    const listeners: Array<(name: unknown) => void> = []

    let toolsService: MockToolsRegistry | undefined

    const ctx = {
      get: (key: string) => (key === 'tools' ? toolsService : undefined),
      effect: (fn: () => void | (() => void)) => fn(),
      on: (_event: string, l: (name: unknown) => void) => {
        listeners.push(l)
      },
    }

    // apply 时 tools 服务未就绪
    apply(ctx as never, { defineTool, ledger })
    expect(mockRegistry.registered.size).toBe(0)

    // 服务迟到就绪并触发事件
    toolsService = mockRegistry
    for (const listener of listeners) {
      listener('tools')
    }

    expect(mockRegistry.registered.size).toBe(5)
  })

  it('status 路由：如实报告 surfaces.tools 与 surfaces.runtime 状态', async () => {
    const { ledger } = newTempLedger()
    const defineTool = getDefineTool()
    const mockRegistry = makeMockRegistry()

    let capturedStatusHandler: ((req: unknown, res: FakeRes) => void) | undefined

    const webServer = {
      register: (route: { path: string; handler: (req: unknown, res: FakeRes) => void }) => {
        if (route.path === '/api/sophia/status') {
          capturedStatusHandler = route.handler
        }
        return () => {}
      },
    }

    // 场景 A：无 tools 服务时，tools 与 runtime 均为 false
    const ctxWithoutTools = {
      get: (key: string) => (key === 'webServer' ? webServer : undefined),
      effect: (fn: () => void | (() => void)) => fn(),
      on: () => {},
    }
    apply(ctxWithoutTools as never, { ledger })

    const resA = makeFakeRes()
    capturedStatusHandler!({ socket: { remoteAddress: '127.0.0.1' } }, resA)
    const payloadA = JSON.parse(resA.body) as {
      ok: boolean
      surfaces: { host: boolean; client: string; tools: boolean; runtime: boolean }
    }
    expect(payloadA.ok).toBe(true)
    expect(payloadA.surfaces.tools).toBe(false)
    expect(payloadA.surfaces.runtime).toBe(false)

    // 场景 B：注册了 tools 服务时，tools 与 runtime 均为 true
    const ctxWithTools = {
      get: (key: string) => {
        if (key === 'webServer') return webServer
        if (key === 'tools') return mockRegistry
        return undefined
      },
      effect: (fn: () => void | (() => void)) => fn(),
      on: () => {},
    }
    apply(ctxWithTools as never, { defineTool, ledger })

    const resB = makeFakeRes()
    capturedStatusHandler!({ socket: { remoteAddress: '127.0.0.1' } }, resB)
    const payloadB = JSON.parse(resB.body) as {
      ok: boolean
      surfaces: { host: boolean; client: string; tools: boolean; runtime: boolean }
    }
    expect(payloadB.ok).toBe(true)
    expect(payloadB.surfaces.tools).toBe(true)
    expect(payloadB.surfaces.runtime).toBe(true)
  })
})
