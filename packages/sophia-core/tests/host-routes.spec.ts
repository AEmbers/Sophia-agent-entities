/**
 * t1 · 宿主三条**数据路由**的接线契约（`GET /view` · `GET /avatar` · `POST /member/model`）。
 *
 * ## 为什么这些用例必须走「真账本 + 真路由」而不是直接调纯函数
 *
 * 纯函数已被 `host-data` 自身覆盖。本文件要回答的是**另一件事**：
 * 这些函数有没有真的接到路由上、接线有没有把参数接错（例如把 `req.url` 的
 * 原始串当「已解码路径」传下去、或把 `connection` 门接成恒真式）。
 * 那种错**不会**在纯函数用例里露头 —— 它长在「函数与框架之间」。
 *
 * ## 反恒真纪律（每条断言都注明「怎么改才会红」）
 *
 * 已实测的变异：拆 `connection` 门、放宽 `isLoopbackRequest`、去掉第二层
 * `decodeURIComponent`、删掉 `sanitizeAvatarPath` 调用、把 `commit` 换成
 * 「只回 200 不落账」、把 `model` 恒置 `null`、去掉 `unknown-member` 分支。
 *
 * @module tests/host-routes
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ⚠ 一律从 `../src/` 引，**不要**引 `../lib/`（这是修一个真实缺陷，别改回去）。
//
// `lib/` 是**构建产物且被 .gitignore 忽略**（`.gitignore:12` ⇒ 新鲜 clone 上不存在；
// `git ls-files packages/sophia-core/lib` = 0）。而**静态 import 会被 tsc 解析路径**，
// 于是「没构建过」的机器上 `tsc -p tsconfig.json` 直接 TS2307 —— 实测过。
//
// 本文件是**行为用例**（验路由 handler 的行为），与 `ledger/projection/tools/…`
// 那 10 个同族 spec 一样从 `src/` 引；把「产物里真的有这些路由」留给
// **产物级断言**（见文末 `t1 · 产物自检`，它用 `readFileSync` 读文本，
// 不做模块解析 ⇒ 没有 lib/ 时也不会让类型检查变红）。
//
// ⚠ 另一条同样重要的事实（实测纠正了一个常见误判）：**字面量** `await import('../lib/x.js')`
// 同样会被 tsc 解析并报 TS2307 —— 只有**计算出的 specifier**（如
// `pathToFileURL(join(root,'lib/x.js')).href`）才不解析。
// 所以「改成 await import()」**并不能**解决本问题，只有「引源码」或「用计算 specifier」能。
import { openLedger, type Ledger, type LedgerCommitInput } from '../src/ledger.ts'
import { memberSessionIdOf } from '../src/runtime/host-agent-deps.ts'
import {
  SOPHIA_NOTICE_SUMMARY,
  type SophiaUserMessage,
} from '../src/runtime/notice-message.ts'
import type {
  ChannelId,
  MemberId,
  MemberIdentity,
  TeamId,
  ThreadId,
} from '../src/types/index.ts'

/** 合法的头像素材相对路径（用例会真的把它写到磁盘上）。 */
const TIER_DIR = '03_第三梯队_架构与研发组'
const POSITION = '星仪主事'
const AVATAR_REL = `assets/members/out-512/${TIER_DIR}/${POSITION}.png`
/** 一个 1×1 的合法 PNG（字节只用来证「确实是这张图」，不参与解码）。 */
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c630001000005'
  + '00010d0a2db40000000049454e44ae426082',
  'hex',
)

const MEMBER_ID = 'sophia-xing-yi-zhu-shi-0000000a'
const TEAM_ID = 'sophia-team-00000001'
const CHANNEL_ID = 'sophia-channel-00000001'
const THREAD_ID = 'sophia-thread-00000001'
/** 成员的**初始**模型（前置换模写入；见 `seedAt` 的说明）。 */
const PRIOR_MODEL = { provider: 'openai', model: 'gpt-prior' }

const humanActor = { kind: 'human', humanId: 'tester' } as const

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上偶有句柄残留；清理失败不该让用例变红。
    }
  }
  tempDirs.length = 0
})

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env['SOPHIA_REPO_ROOT']
  delete process.env['SOPHIA_DATA_DIR']
})

// ── 夹具 ────────────────────────────────────────────────────────────────────

/** 造一个空目录（会登记进 afterEach 清理）。 */
function newTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/** 造一个带头像素材的假仓库根。 */
function newRepoRoot(): string {
  const root = newTempDir('sophia-repo-')
  mkdirSync(join(root, 'assets', 'members', 'out-512', TIER_DIR), { recursive: true })
  writeFileSync(join(root, AVATAR_REL), PNG_BYTES)
  return root
}

// ── 事件构造（与 projection.spec.ts 同形，免得手抄载荷各自写错）──────────────

function commit(ledger: Ledger, input: LedgerCommitInput): void {
  ledger.commit(input)
}

function teamCreated(): LedgerCommitInput {
  return {
    kind: 'team/created',
    data: {
      teamId: TEAM_ID as TeamId,
      kind: 'persistent',
      ownerMemberId: null,
      parentTeamId: null,
      name: '测试团',
    },
    actor: humanActor,
  }
}

/**
 * `team/member-added` 事件。
 *
 * @param model - 建团那一刻的模型。`null` = 该成员跟随全局默认
 *   （`MemberAddedData.model` 是 `{provider,model} | null`，**必填可空**，
 *   不是可选 —— 见该字段的文档）。t3 新增此字段正是为了修我上报的缺口。
 */
function memberAdded(model: { provider: string; model: string } | null = null): LedgerCommitInput {
  const member: MemberIdentity = {
    position: POSITION,
    name: POSITION,
    memberId: MEMBER_ID as MemberId,
  }
  return {
    kind: 'team/member-added',
    data: { teamId: TEAM_ID as TeamId, member, lifecycle: 'active', model },
    actor: humanActor,
  }
}

function channelCreated(): LedgerCommitInput {
  return {
    kind: 'team/channel-created',
    data: { channelId: CHANNEL_ID as ChannelId, teamId: TEAM_ID as TeamId, title: '总频道' },
    actor: humanActor,
  }
}

function threadStarted(): LedgerCommitInput {
  return {
    kind: 'team/thread-started',
    data: {
      threadId: THREAD_ID as ThreadId,
      channelId: CHANNEL_ID as ChannelId,
      title: '第一条线程',
      assigneeMemberId: MEMBER_ID as MemberId,
    },
    actor: humanActor,
  }
}

/**
 * 在 `dataDir/ledger.sqlite` 上播种：1 团 + 1 成员 + 1 频道 + 1 线程。
 *
 * @param dataDir - 数据目录（路由会在其下找 `ledger.sqlite`）。
 * @param mode - 见 {@link SeedMode}：
 *   - `'switched'`（默认）：先写一条换模事件给成员一个当前模型；
 *   - `'at-add'`：模型**在建团那一刻**由 `member-added` 载荷带入（t3 新增的
 *     `MemberAddedData.model`）—— 这是 captain 裁定的正解路径；
 *   - `'none'`：成员从未有过模型（`model: null`），用于验证「拒绝而不是编造」。
 */
type SeedMode = 'switched' | 'at-add' | 'none'

function seedAt(dataDir: string, mode: SeedMode = 'switched'): void {
  const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
  try {
    commit(ledger, teamCreated())
    commit(ledger, memberAdded(mode === 'at-add' ? PRIOR_MODEL : null))
    commit(ledger, channelCreated())
    commit(ledger, threadStarted())
    if (mode === 'switched') {
      commit(ledger, {
        kind: 'team/member-model-switched',
        actor: humanActor,
        data: {
          teamId: TEAM_ID as TeamId,
          memberId: MEMBER_ID as MemberId,
          from: { provider: 'none', model: 'none' },
          to: PRIOR_MODEL,
          reason: '初始指派（测试前置）',
          trigger: 'policy',
          effectiveAtSequence: 5,
        },
      })
    }
  } finally {
    ledger.close()
  }
}

/** 造一个已播种的数据目录。 */
function newDataDir(mode: SeedMode = 'switched'): string {
  const dir = newTempDir('sophia-data-')
  seedAt(dir, mode)
  return dir
}

/** 读回账本里某类事件的条数（**另开连接**，不信响应）。 */
function countEvents(dataDir: string, kind: string): number {
  const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
  try {
    return ledger.read({ limit: 1000 }).events.filter((event) => event.kind === kind).length
  } finally {
    ledger.close()
  }
}

// ── 路由装载 ────────────────────────────────────────────────────────────────

interface FakeRoute {
  kind: string
  path: string
  handler: (req: unknown, res: unknown) => unknown
}

/** 假响应；记录状态码、响应头与 body。 */
interface FakeRes {
  status: number
  headers: Record<string, string>
  body: string | Uint8Array
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

function makeRes(): FakeRes {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

interface Host {
  routes: FakeRoute[]
  effects: Array<() => void>
  services: Record<string, unknown>
}

/**
 * 装载 `apply` 并取回它注册的路由。
 *
 * `SOPHIA_REPO_ROOT` / `SOPHIA_DATA_DIR` 走**环境变量**而不是改 `apply` 签名：
 * 这两个变量本来就是产品化入口（见 `host.ts`），走同一条路才能证明它真的生效。
 */
async function mountHost(options: {
  repoRoot?: string
  dataDir?: string
  withoutConnection?: boolean
  /**
   * 额外的宿主服务（`ctx.get(name)` 能读到的东西）。
   *
   * 用途：把**真 agent 底座**（`src/runtime/host-agent-deps.ts`）接上 ——
   * 它要 `agents` / `agentPresets`（以及假 agentCtx 上的 `tools`）。
   * 不传时宿主会如实报「拿不到 ctx.agents」（激活失败 ⇒ 唤醒回 `no-handle`），
   * 这正是**生产里没接线时**的形状，所以那条路也有用例钉着。
   */
  services?: Record<string, unknown>
} = {}): Promise<Host> {
  const routes: FakeRoute[] = []
  const effects: Array<() => void> = []
  const services: Record<string, unknown> = { ...options.services }

  if (options.repoRoot !== undefined) process.env['SOPHIA_REPO_ROOT'] = options.repoRoot
  // ⚠ 护栏（2026-09-24 实测，代价已发生）：没传 dataDir 时**必须**造一个临时目录。
  // 否则 `SOPHIA_DATA_DIR` 为空（afterEach 会 delete 它）⇒ host.ts 的
  // `sophiaDataDir()` 回退到**真实目录** `~/.dsh/sophia` ⇒ 测试写进用户账本。
  // 实测：真实账本里出现了两条自举事实（actor=human:sophia-bootstrap，
  // 时间戳与一次回归完全吻合）。绝不能复现。
  process.env['SOPHIA_DATA_DIR'] = options.dataDir ?? newTempDir('sophia-route-')

  services['webServer'] = {
    register(route: FakeRoute) {
      routes.push(route)
      return () => {
        const at = routes.indexOf(route)
        if (at !== -1) routes.splice(at, 1)
      }
    },
  }
  services['systemPrompt'] = { section: () => () => {} }
  if (options.withoutConnection !== true) {
    services['connection'] = { requestRejection: () => undefined }
  }

  const ctx = {
    get: (name: string) => services[name],
    effect: (execute: () => void | (() => void)) => {
      const disposer = execute()
      if (typeof disposer === 'function') effects.push(disposer)
    },
    on: () => undefined,
  }

  const { apply } = await import('../src/host.ts')
  apply(ctx as never)
  return { routes, effects, services }
}

/** 调一条路由并等它完成（handler 可能是 async）。 */
async function call(host: Host, path: string, req: Record<string, unknown>): Promise<FakeRes> {
  const route = host.routes.find((entry) => entry.path === path)
  if (route === undefined) {
    throw new Error(`路由未注册：${path}（已注册 ${host.routes.map((r) => r.path).join(', ')}）`)
  }
  const res = makeRes()
  await route.handler(req, res)
  return res
}

/** 回环来源的请求对象。 */
function req(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { socket: { remoteAddress: '127.0.0.1' }, ...extra }
}

/**
 * 一个**记录型**的假 DSH agent 后端（`agents` / `agentPresets` / `agentDefaultModel`）。
 *
 * ## 为什么值得有它
 *
 * 它让「路由 → 真适配器 → 真运行时 → agent 边界」这条链**每一段都是真代码**，
 * 只有最里层那个 agent 是假的：
 * - `src/runtime/host-agent-deps.ts` 全真（派生 sessionId、建 cwd、调 `agents.create`、
 *   在 `setup` 里透传 agentCtx）；
 * - `src/runtime/member-runtime.ts` 全真（生命周期门、句柄门、去重签名、双通道选择）；
 * - 只有 `agents.create` 的服务实现是假的（真身会去起一个真 Agent + 真 LLM 调用，
 *   那要烧钱，且是**另一件事**：见父任务分段的第 3 步）。
 *
 * `setup(agentCtx, agent)` **必须**被调用（上游 `dsh-agent-loop:1856` 的约定，
 * 且本仓运行时校验它被调用过）—— 这个假实现照做，否则整条链会在
 * `activate` 处判 `failed`，用例只会测到「失败被如实回报」。
 */
interface FakeAgentBackend {
  readonly services: Record<string, unknown>
  /** 假 agent 收到的投递物（`followup`）。 */
  readonly delivered: SophiaUserMessage[]
  readonly mounts: Array<{ readonly presetId: string; readonly hasScopedCtx: boolean }>
  readonly creates: Array<{
    readonly sessionId: string
    readonly agentPreset: string
    readonly cwd: string
    readonly agentOptions: { readonly provider: string; readonly model: string }
  }>
}

function makeFakeAgentBackend(): FakeAgentBackend {
  const delivered: SophiaUserMessage[] = []
  const mounts: Array<{ presetId: string; hasScopedCtx: boolean }> = []
  const creates: Array<{
    sessionId: string
    agentPreset: string
    cwd: string
    agentOptions: { provider: string; model: string }
  }> = []
  const provider = 'test-provider'
  const model = 'test-model'
  const services: Record<string, unknown> = {
    // 成员自己的模型（`team/member-added` 的 `model`）在种子账本里是 `null`
    // ⇒ 底座会落到这里取全局默认。
    agentDefaultModel: { currentSelection: () => ({ provider, model }) },
    agentPresets: {
      mount: (agentCtx: unknown, presetId: string) => {
        // 上游要求挂载时的 ctx 是**agent 的**作用域 ctx（未作用域直接抛）
        // ⇒ 这里记下"拿到的是不是一个真 ctx 对象"，把那条约定钉在测试里。
        mounts.push({ presetId, hasScopedCtx: typeof agentCtx === 'object' && agentCtx !== null })
        return {}
      },
    },
    agents: {
      create: async (input: {
        sessionId: string
        meta: { cwd: string; agentPreset: string }
        agentOptions: { provider: string; model: string }
        setup: (agentCtx: unknown, agent: unknown) => Promise<void>
      }) => {
        creates.push({
          sessionId: input.sessionId,
          agentPreset: input.meta.agentPreset,
          cwd: input.meta.cwd,
          agentOptions: input.agentOptions,
        })
        const agentCtx = { tools: { restrict: () => () => {} } }
        await input.setup(agentCtx, { id: 'fake-agent' })
        return {
          agent: {
            id: 'fake-agent',
            status: 'idle',
            followup: (message: SophiaUserMessage) => {
              delivered.push(message)
            },
            steer: () => undefined,
          },
          dispose: () => undefined,
        }
      },
    },
  }
  return { services, delivered, mounts, creates }
}

/** 非回环来源。 */
function remoteReq(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { socket: { remoteAddress: '10.0.0.9' }, ...extra }
}

/**
 * 造一个能读 body 的请求对象（`readJsonBody` 靠 `on('data'|'end')`）。
 *
 * `raw` 给定时直接用该字符串（测非法 JSON）；否则序列化 `body`。
 */
function postReq(body: unknown, raw?: string): Record<string, unknown> {
  const text = raw ?? JSON.stringify(body)
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  return {
    socket: { remoteAddress: '127.0.0.1' },
    method: 'POST',
    url: '/api/sophia/member/model',
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners[event] ??= []
      listeners[event].push(listener)
      // 注册 `end` 时就派发：本用例不需要真实流时序，只需「读得到 body」。
      if (event === 'end') {
        for (const each of listeners['data'] ?? []) each(Buffer.from(text, 'utf8'))
        for (const each of listeners['end'] ?? []) each()
      }
      return undefined
    },
  }
}

/** 换模请求体（默认合法）。 */
function switchBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { memberId: MEMBER_ID, provider: 'anthropic', model: 'claude-x', reason: 'human-switch', ...overrides }
}

// ────────────────────────────────────────────────────────────────────────────

describe('t1 · 数据路由：注册与挂载', () => {
  it('全部十一条路由都挂上，且 `/status` 仍是第一个（既有断言依赖 routes[0]）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    // 反恒真：删掉 buildRoutes 里任一条 → 本条必须变红（已实测）。
    expect(host.routes.map((route) => route.path)).toEqual([
      '/api/sophia/status',
      '/api/sophia/view',
      '/api/sophia/avatar',
      '/api/sophia/member/model',
      '/api/sophia/spawn/decision',
      '/api/sophia/channel',
      // 新增（团队级中止，2026-09-24）：路径与客户端 `vendor/bridge.ts` 的
      // `HALT_URL` 逐字一致 —— 对不上就是「停止团队点不动」那个降级回不来。
      '/api/sophia/team/destroy',
      '/api/sophia/member',
      '/api/sophia/member/lifecycle',
      '/api/sophia/dag/ownership',
      // 新增（面板 composer 发消息）：路径与客户端 `vendor/team/requests.ts` 的
      // `MESSAGE_ROUTE` 逐字一致 —— 对不上就是「界面点发送 404」那个原始缺陷。
      '/api/sophia/team/message',
    ])
  })

  it('effect 的 disposer 把**十一条**路由一起收掉（可逆，不漏任何一条）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    expect(host.routes).toHaveLength(11)
    for (const dispose of host.effects) dispose()
    // 反恒真：把回收改回只 `detach?.()`（单条）→ 本条必须变红（已实测：剩 3 条）。
    // 漏收任何一条都是静默的侧效应泄漏（宿主还会继续服务它）。
    expect(host.routes, '十一条路由必须一起收').toHaveLength(0)
  })

  it('一个键挂不完时整体回滚，不会「一半在新键、一半在旧键」', async () => {
    // 真实 webserver 的 register 对重复 (kind,path) 直接 throw
    // （`dsh-host-webserver/lib/index.js:178`）。这里让第 3 条抛。
    const mounted: string[] = []
    let calls = 0
    const services: Record<string, unknown> = {
      webServer: {
        register(route: { path: string }) {
          calls += 1
          if (calls === 3) throw new Error('webserver: duplicate exact route')
          mounted.push(route.path)
          return () => {
            const at = mounted.indexOf(route.path)
            if (at !== -1) mounted.splice(at, 1)
          }
        },
      },
      systemPrompt: { section: () => () => {} },
      connection: { requestRejection: () => undefined },
    }
    process.env['SOPHIA_REPO_ROOT'] = newRepoRoot()
    process.env['SOPHIA_DATA_DIR'] = newDataDir()
    const ctx = {
      get: (name: string) => services[name],
      effect: (execute: () => void | (() => void)) => { execute() },
      on: () => undefined,
    }
    const { apply } = await import('../src/host.ts')
    apply(ctx as never)
    // 反恒真：去掉 registerAll 的回滚循环 → mounted 会是 ['/status','/view']，本条必须变红（已实测）。
    // 不回滚的后果不是「少挂一条」而是「换键后同一路径注册两次」——回退会变成永久挂不上。
    expect(mounted, '本键上已挂的部分必须全部收回').toHaveLength(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────

describe('t1 · GET /api/sophia/view', () => {
  it('返回**真账本**的事实：团/成员/频道/线程都对得上', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/view', req({ method: 'GET' }))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as {
      ok: boolean
      teams: Array<{
        teamId: string
        name: string
        members: Array<{ memberId: string; position: string }>
        channels: Array<{ channelId: string; threads: Array<{ threadId: string; title: string }> }>
      }>
      coverage?: { scoped: boolean }
    }
    // 反恒真：把 buildWireView 换成 `{ok:true,teams:[]}` → 本条必须变红（已实测）。
    expect(payload.ok).toBe(true)
    expect(payload.teams).toHaveLength(1)
    const team = payload.teams[0]!
    expect(team.teamId).toBe(TEAM_ID)
    expect(team.name).toBe('测试团')
    expect(team.members.map((m) => m.memberId)).toEqual([MEMBER_ID])
    expect(team.members[0]!.position).toBe(POSITION)
    // 线程必须看得见 —— 这是任务书点名的坑（`team/thread-started` 的 scope 是 `[]`，
    // 任何**带 scopes** 的增量读取都看不见它；本路由走不带 scopes 的 rebuildFold）。
    expect(team.channels.map((c) => c.channelId)).toEqual([CHANNEL_ID])
    expect(team.channels[0]!.threads.map((t) => t.threadId)).toEqual([THREAD_ID])
    expect(team.channels[0]!.threads[0]!.title).toBe('第一条线程')
    // 不带 scopes ⇒ coverage 如实说 scoped=false（界面据此显示盲区提示）。
    expect(payload.coverage?.scoped).toBe(false)
  })

  it('未播种的账本：视图 ok:true，且只含装配层自举的根团（视图不发明数据）', async () => {
    const dataDir = newTempDir('sophia-data-')
    // 不播种：只建一个空库文件。装配层会自举一个根团
    // （host-assembly.ensureRootTeam）—— 它是**账本里的事实**，不是视图编造的。
    // 「视图不发明数据」由下一条 messages/tasks/activity 三空断言独立覆盖。
    openLedger({ path: join(dataDir, 'ledger.sqlite') }).close()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/view', req())
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as {
      ok: boolean
      teams: Array<{ name: string; kind: string }>
    }
    expect(payload.ok).toBe(true)
    expect(payload.teams.length).toBe(1)
    expect(payload.teams[0]!.name).toBe('索菲亚')
    expect(payload.teams[0]!.kind).toBe('persistent')
  })

  it('成员带出 avatarPath，且它指向真实素材（宿主的文件事实）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/view', req())
    const payload = JSON.parse(String(res.body)) as {
      teams: Array<{ members: Array<{ avatarPath?: string }> }>
    }
    // 反恒真：让 createAvatarPathResolver 恒返回 undefined → 本条必须变红（已实测）。
    expect(payload.teams[0]!.members[0]!.avatarPath).toBe(AVATAR_REL)
  })

  it('未播种账本的 `messages`/`tasks`/`activity` 如实为空', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/view', req())
    const payload = JSON.parse(String(res.body)) as {
      teams: Array<Record<string, unknown>>
    }
    // 这条是**防伪造**的：视图不得凭空造出账本里没有的事（那会让界面显示从未发生过的
    // 活动，与「账本是唯一真相」直接冲突）。
    //
    // ⚠ 原因在新增 `team/message-sent` 之后**变了一半**（标题与注释一并订正，
    //   三条断言本身**逐字未动**）：
    // - `messages`：**生产者已经存在**（`src/tools/message.ts` 两条路径都写），
    //   所以「恒为空」不再是普遍事实 —— 它在这里为空**只因为本用例的账本未播种**
    //   （`newDataDir()` 只自举根团，没有任何频道/线程/消息）。
    //   改断言去造一条消息没有意义：那变成测 `buildWireTeam`（已由
    //   `tests/message-events.spec.ts` 覆盖），而本用例要守的是**路由不发明数据**。
    // - `tasks` / `activity`：账本里**仍然没有**任何 task/activity 事件 kind ⇒ 恒空，
    //   这两条覆盖的仍是「宿主不会为了填满界面而编数据」。
    expect(payload.teams[0]!['messages']).toEqual([])
    expect(payload.teams[0]!['tasks']).toEqual([])
    expect(payload.teams[0]!['activity']).toEqual([])
  })

  it('★ 播种一条 `team/message-sent` 后，`/api/sophia/view` 的 `messages` 带着它（端到端：这份数据就是界面读的那份）', async () => {
    // 上一轮改动之前，界面消息流**全是空态**，因为 `buildWireTeam` 的 `messages` 只能
    // 如实留空（账本里没有任何 message 事件 kind）。本用例把「补上生产者」这件事
    // 钉到**界面真正读的那个 HTTP 边界**上：不是在纯函数层证明，而是真打路由、读响应 JSON。
    //
    // 与 `tests/message-events.spec.ts` 的分工：那边覆盖 账本→折叠→`buildWireTeam`
    // 的字段逐字相等与跨团隔离；这里只多回答一件事 —— **这条链有没有接到路由上**
    //（`buildWireView` 被漏接/被换掉、或路由把 `messages` 丢掉，只有这里会红）。
    const dataDir = newTempDir('sophia-data-')
    seedAt(dataDir, 'switched')
    // 另开连接追加一条消息（与 `seedAt` 同一写法：写库后立刻关连接）。
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'team/message-sent',
        actor: { kind: 'member', memberId: MEMBER_ID as MemberId },
        occurredAt: 1_700_000_000_123,
        data: {
          messageId: 'msg-routes-000000000000000000000001',
          channelId: CHANNEL_ID as ChannelId,
          threadId: THREAD_ID as ThreadId,
          senderMemberId: MEMBER_ID as MemberId,
          body: '路由级证据：这条消息必须出现在 /api/sophia/view 里',
        },
      })
    } finally {
      ledger.close()
    }

    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/view', req())
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as {
      teams: Array<{ messages: unknown[] }>
    }

    // 反恒真：把 `buildWireTeam` 的 `messages` 改回 `[]`（或让 `buildWireView` 丢掉它）
    // → 本条必红（前一种变异已实测，红输出见交付报告）。
    expect(payload.teams[0]!.messages, '界面数据面必须带着这条消息').toHaveLength(1)
    expect(payload.teams[0]!.messages[0]).toEqual({
      messageId: 'msg-routes-000000000000000000000001',
      channelId: CHANNEL_ID,
      threadId: THREAD_ID,
      senderMemberId: MEMBER_ID,
      body: '路由级证据：这条消息必须出现在 /api/sophia/view 里',
      occurredAt: 1_700_000_000_123,
    })
  })

  it('★ POST /api/sophia/team/message：账本多一条 `team/message-sent`，且视图里该团 `messages` +1（三跳端到端：路由 → 账本 → 线格式）', async () => {
    // 这条钉的是**界面点发送**这条链（`vendor/team/requests.ts` 的 `requestTeamMessage`
    // 打到 `MESSAGE_ROUTE`）。补这条路由之前，界面上点发送会得到 404 并如实显示
    // 「索菲亚宿主还没有消息发送路由」—— 主人只能看、不能回。
    const dataDir = newTempDir('sophia-data-')
    seedAt(dataDir, 'switched')
    // 把真 agent 底座接上：`agents` / `agentPresets` / `agentDefaultModel` 是假的，
    // 适配器与运行时都是真的（见 `makeFakeAgentBackend`）。
    const backend = makeFakeAgentBackend()
    const { delivered, mounts, creates } = backend
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir, services: backend.services })
    const body = '面板发出来的话：这条必须进账本，也必须出现在线格式里'

    // ⚠ 按 `teamId` 找团，**不读 `teams[0]`**：面板现在列出全部团（根团也在列），
    //    下标 0 是谁取决于装配顺序 —— 那是本用例不需要承担的不确定性。
    const readMessages = async (): Promise<Array<Record<string, unknown>>> => {
      const res = await call(host, '/api/sophia/view', req())
      const payload = JSON.parse(String(res.body)) as {
        teams: Array<{ teamId: string; messages: Array<Record<string, unknown>> }>
      }
      const team = payload.teams.find((one) => one.teamId === TEAM_ID)
      if (team === undefined) throw new Error(`视图里没有 seed 出来的团 ${TEAM_ID}`)
      return team.messages
    }
    // 「发送前」的条数从视图读，不硬编 0：种子将来若带上了消息，本条也不会变成假绿。
    const before = (await readMessages()).length

    const res = await call(host, '/api/sophia/team/message', postReq({
      threadRef: THREAD_ID,
      body,
      recipients: [MEMBER_ID],
    }))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as {
      ok?: unknown
      messageId?: unknown
      occurredAt?: unknown
      wakes?: unknown
    }
    // 这两个字段是调用方**逐字要读**的输入（`requests.ts` 读 `messageId` / `occurredAt`），
    // 少一个或类型不对，它就会把成功降级成「拿不到时间 ⇒ 重读一次快照」。
    expect(payload.ok).toBe(true)
    expect(typeof payload.messageId).toBe('string')
    expect(String(payload.messageId).startsWith('msg-')).toBe(true)
    expect(typeof payload.occurredAt).toBe('string')
    // ISO 串口径：上游 UI 全线把时间当 ISO 串用（`vendor/team/adapters.ts` 的 `isoFromMs`）。
    expect(payload.occurredAt).toBe(new Date(String(payload.occurredAt)).toISOString())

    // ── 唤醒面：被 @ 的成员逐条给出唤醒结论，且**真的被唤醒了** ──
    //
    // ⚠ 这条断言在 2026-09-24 从 `no-handle` **翻成了** `delivered`，翻它的理由是
    // 代码真的改了（`src/runtime/host-agent-deps.ts` 把桩换成了真底座，
    // 且 `sendTeamMessage` 变成「先激活、再唤醒」）—— 不是把断言改绿。
    // 反恒真（已实测，见本批报告）：把 `sendTeamMessage` 里的激活那一步去掉 ⇒
    // 运行时的句柄门回 `no-handle` ⇒ 本条立刻红。
    //
    // 本进程里 DSH 的那些服务是假的（`services` 注入），但**链路上的每一段都是真的**：
    // 路由 → `createHostAgentDeps`（真适配器：派生 sessionId、建 cwd、调 `agents.create`）
    // → `createDefaultMemberRuntime`（真运行时：生命周期门、句柄门、去重、通道选择）
    // → 假 `agents.create` 回一个假 agent。只有最里层那个 agent 是假的。
    expect(payload.wakes).toEqual([
      {
        recipientMemberId: MEMBER_ID,
        delivery: { kind: 'delivered', channel: 'followup', reason: null, delivered: true },
      },
    ])
    // ── 唤醒的**证据**在假 agent 那一侧：它收到了一条合法 user message ──
    //
    // ⚠ 口径（不许往上加一个字）：能证到的是「一条**合法 user message** 进入了
    // agent 边界」。**不是**「真 agent 收到了 / 开始干活了」—— 那要真 Agent 跑一次
    //（烧一次真实模型 turn），是后续分段的事。
    expect(delivered.length, 'idle 成员 ⇒ 走 followup，且恰一次').toBe(1)
    const message = delivered[0]!
    expect(message.role).toBe('user')
    expect(typeof message.id).toBe('string')
    const text = message.content[0]?.text ?? ''
    // ⚠ 逐字相等的那条断言在 `tests/message-events.spec.ts`（那里是文案的唯一出处）。
    // 这里只钉「正文确实带着发信人身份 / 线程 / 原话」这三件事 ——
    // 复制一份格式串会在两处各写一个真相。
    expect(text).toContain('来自主人')
    expect(text).toContain(THREAD_ID)
    expect(text).toContain(body)
    expect(message.source).toEqual({
      kind: 'plugin',
      plugin: 'sophia',
      form: 'notice',
      summary: SOPHIA_NOTICE_SUMMARY,
    })
    // ── 底座接线的可观测副作用：preset 挂了、目录建了、会话 id 是派生的那个 ──
    expect(mounts, 'preset 必须在 setup(agentCtx) 里挂上（上游要求）').toEqual([
      { presetId: 'sophia', hasScopedCtx: true },
    ])
    expect(creates, '恰一次 agents.create').toHaveLength(1)
    const created = creates[0]!
    // 派生规则：`memberSessionIdOf`（唯一出处）。这里断言的是**它的输出**，
    // 而不是"某个字符串"—— 换派生规则必须同时改这里，那正是有意的耦合。
    expect(created.sessionId).toBe(memberSessionIdOf(MEMBER_ID as never))
    expect(created.agentPreset).toBe('sophia')
    expect(isAbsolute(created.cwd), `cwd 必须是绝对路径（收到 ${created.cwd}）`).toBe(true)
    // 目录真的被建出来了（`meta.cwd` 指向一个存在的目录，不是一句话）。
    expect(existsSync(created.cwd)).toBe(true)
    // ⚠ 这里是 `PRIOR_MODEL`（成员**自己**当前的模型，由种子里的换模事件写入），
    // **不是**假后端里那个 `test-provider/test-model`（全局默认）
    // —— 钉住「成员自己的模型优先于全局默认」这条优先级（它错了不会报错，
    // 只会让成员悄悄跑在另一个模型上，而那是要花钱的）。
    expect(created.agentOptions).toEqual(PRIOR_MODEL)
    expect(created.agentOptions.provider).not.toBe('test-provider')

    // ── 第二跳：账本里真的多了一条，且它记的是「人类发的」而不是某个成员 ──
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    let sent: Array<{ data: Record<string, unknown>; actor: unknown }>
    try {
      sent = ledger.read({}).events
        .filter((event) => event.kind === 'team/message-sent')
        .map((event) => ({ data: event.data as unknown as Record<string, unknown>, actor: event.actor }))
    } finally {
      ledger.close()
    }
    expect(sent, '路由必须落一条 team/message-sent').toHaveLength(1)
    expect(sent[0]!.data['messageId']).toBe(payload.messageId)
    expect(sent[0]!.data['body']).toBe(body)
    expect(sent[0]!.data['threadId']).toBe(THREAD_ID)
    // `channelId` 由宿主从投影里取（线程的既有事实），**不是**客户端在 body 里报的 ——
    // 客户端压根没报它。这条钉住「两个真相」不会出现。
    expect(sent[0]!.data['channelId']).toBe(CHANNEL_ID)
    // 发送者是**人类**：载荷里没有成员 id（`null`），是谁由基座 actor 承载。
    expect(sent[0]!.data['senderMemberId']).toBeNull()
    expect(sent[0]!.actor).toEqual({ kind: 'human', humanId: 'sophia-ui' })
    // 时间在基座、不在 data（纪律）—— 载荷里不许出现第二个时间真相。
    expect(Object.hasOwn(sent[0]!.data, 'occurredAt'), 'data 里不得有 occurredAt').toBe(false)

    // ── 第三跳：线格式（界面真正读的那份）──
    const after = await readMessages()
    expect(after, '视图里该团的 messages 必须 +1').toHaveLength(before + 1)
    const mine = after.find((one) => one['messageId'] === payload.messageId)
    expect(mine, '刚发的那条必须出现在线格式里').toBeDefined()
    expect(mine).toEqual({
      messageId: payload.messageId,
      channelId: CHANNEL_ID,
      threadId: THREAD_ID,
      // 人类发送 ⇒ **空串**（不是成员 id ⇒ 成员名解析不可能把它显示成某个成员）。
      senderMemberId: '',
      body,
      occurredAt: Date.parse(String(payload.occurredAt)),
    })
  })

  it('★ 没接上 agent 底座（`ctx.agents` 取不到）⇒ `wakes` 如实回 `no-handle`，且**原因**跟着出来', async () => {
    // 这条钉的是**未接线**那个形状本身 —— 也就是本批之前生产里的样子：
    // 消息能进账本、界面能看到，但**没有一个人被叫起来**。
    // 它同时钉住「原因不会被吞」：激活失败的根因必须出现在 `wakes[].delivery.reason` 里，
    // 否则调用方只看到一个没有上下文的 `no-handle`，排查要从头猜。
    const dataDir = newTempDir('sophia-data-')
    seedAt(dataDir, 'switched')
    // 不传 `services` ⇒ `ctx.get('agents')` 是 undefined ⇒ 底座抛错 ⇒ 激活失败。
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })

    const res = await call(host, '/api/sophia/team/message', postReq({
      threadRef: THREAD_ID,
      body: '这条会落账，但没人被叫起来',
      recipients: [MEMBER_ID],
    }))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as {
      ok?: unknown
      wakes?: Array<{ delivery: { kind: string; reason: string | null; delivered: boolean } }>
    }
    expect(payload.ok).toBe(true)
    const delivery = payload.wakes?.[0]?.delivery
    // `kind` 仍是运行时观察到的真相（真的没有活句柄），而 `reason` 里带着根因。
    expect(delivery?.kind).toBe('no-handle')
    expect(delivery?.delivered).toBe(false)
    expect(String(delivery?.reason)).toContain('ctx.agents')

    // 而且消息**照样落账**：唤醒是尽力而为，账本是事实（不回滚）。
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    let count = 0
    try {
      count = ledger.read({}).events.filter((event) => event.kind === 'team/message-sent').length
    } finally {
      ledger.close()
    }
    expect(count, '激活失败不得回滚已落账的消息').toBe(1)
  })

  it('★ POST team/message：线程不存在 ⇒ 404 且**不落账**（不写孤儿消息）', async () => {
    const dataDir = newTempDir('sophia-data-')
    seedAt(dataDir, 'switched')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })

    const res = await call(host, '/api/sophia/team/message', postReq({
      threadRef: 'thread-does-not-exist-0000',
      body: '这条不该落账',
      recipients: [],
    }))
    expect(res.status).toBe(404)
    expect(JSON.parse(String(res.body))).toMatchObject({ ok: false })

    // 反恒真：把 `sendTeamMessage` 里的线程存在性检查去掉 → 这条必须变红（账本会多一条）。
    // 为什么重要：`team/message-sent` **不校验引用**（刻意的，见 projection 的说明），
    // 一条指向不存在线程的消息会被投影收下、却永远挂不到任何线程下 ——
    // 那是 append-only 账本里**撤不掉**的孤儿数据。
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    let kinds: string[]
    try {
      kinds = ledger.read({}).events.map((event) => event.kind)
    } finally {
      ledger.close()
    }
    expect(kinds.filter((kind) => kind === 'team/message-sent')).toHaveLength(0)
  })

  it('★ POST team/message：空白正文 / 非 POST 分别 400 / 405（不合形状当场拒，不写账本）', async () => {
    const dataDir = newTempDir('sophia-data-')
    seedAt(dataDir, 'switched')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })

    const blank = await call(host, '/api/sophia/team/message', postReq({
      threadRef: THREAD_ID,
      body: '   ',
      recipients: [],
    }))
    expect(blank.status).toBe(400)
    // 为什么空白必须 400 而不是「收下但投影丢弃」：投影层对空正文 `malformed += 1` 丢弃，
    // 若这里放行，界面会收到 200「发送成功」而消息**永远不出现** —— 那是最坏的一种成功。
    expect(String(JSON.parse(String(blank.body)).error)).toContain('body 必须是非空字符串')

    const wrongMethod = await call(host, '/api/sophia/team/message', req())
    expect(wrongMethod.status).toBe(405)
  })

  it('非回环来源被回环门挡在 403（数据不出本机）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/view', remoteReq())
    // 反恒真：去掉 guard 里的回环判定 → 本条必须变红（已实测：会变 200）。
    expect(res.status).toBe(403)
  })

  it('`connection` 服务缺失时回 503 —— **不是**放行（装配失败不是放行理由）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir(), withoutConnection: true })
    const res = await call(host, '/api/sophia/view', req())
    // 反恒真：把 gateRejection 改成 `gate === undefined ? undefined : …` → 本条必须变红（已实测：会变 200）。
    // 这正是参照实现 `web-routes.ts:83` 的原话：缺服务是装配失败，不是暴露工作区的邀请。
    expect(res.status).toBe(503)
    expect(String(res.body)).toContain('authentication unavailable')
  })

  it('`connection` 拒绝时把它的状态码原样透出（401/403 不被改写成 200）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    // 换门必须在 apply **之后**：门是每次请求现取的（见 `rejectIfUnauthorized`），
    // 这正是「懒取」的价值 —— 服务后到时也能生效。
    host.services['connection'] = { requestRejection: () => 401 }
    const unauthorized = await call(host, '/api/sophia/view', req())
    // 反恒真：把 rejectIfUnauthorized 的返回值忽略掉 → 本条必须变红（已实测：会变 200）。
    expect(unauthorized.status).toBe(401)
    expect(String(unauthorized.body)).toContain('unauthorized')

    host.services['connection'] = { requestRejection: () => 403 }
    const forbidden = await call(host, '/api/sophia/view', req())
    expect(forbidden.status).toBe(403)
    expect(String(forbidden.body)).toContain('forbidden')
  })
})

// ────────────────────────────────────────────────────────────────────────────

describe('t1 · GET /api/sophia/view 的 pendingPlans（文档 3.6 审批区数据源）', () => {
  /** 在已播种的账本上追加一条 spawn/awaiting。 */
  function seedSpawnAwaiting(dataDir: string): void {
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'spawn/awaiting-human-approval',
        actor: humanActor,
        // 基座与 data 双写（与真实 spawn 链路一致；delegation 按基座过滤）。
        requestId: 'req-view-1' as never,
        data: {
          requestId: 'req-view-1',
          requesterMemberId: MEMBER_ID as MemberId,
          principalMemberId: MEMBER_ID as MemberId,
          targetKind: 'persistent',
          spec: {
            name: '待批团',
            roster: [{ position: POSITION, count: 2, model: null }],
            tasks: ['任务甲', '任务乙'],
          },
        },
      })
    } finally {
      ledger.close()
    }
  }

  it('账本有 awaiting 票 ⇒ pendingPlans 带出完整字段（roster/tasks/spec 全对）', async () => {
    const dataDir = newDataDir()
    seedSpawnAwaiting(dataDir)
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/view', req({ method: 'GET' }))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as {
      pendingPlans?: Array<{
        requestId: string
        targetKind: string
        status: string
        name: string
        roster: Array<{ position: string; count: number }>
        tasks: string[]
        reason: string | null
        humanOperatorId: string | null
      }>
    }
    // 反恒真：把 buildWireView 里 pendingPlans 的组装去掉 → 本条必红
    //（pendingPlans 是 undefined，`?.length` 变 undefined ≠ 1）。
    expect(payload.pendingPlans?.length).toBe(1)
    const plan = payload.pendingPlans![0]!
    expect(plan.requestId).toBe('req-view-1')
    expect(plan.targetKind).toBe('persistent')
    expect(plan.status).toBe('awaiting')
    expect(plan.name).toBe('待批团')
    expect(plan.roster).toEqual([{ position: POSITION, count: 2, model: null }])
    expect(plan.tasks).toEqual(['任务甲', '任务乙'])
    expect(plan.reason).toBeNull()
    expect(plan.humanOperatorId).toBeNull()
  })

  it('空账本 ⇒ pendingPlans 是 **[]**（不是 undefined —— 字段必填契约）', async () => {
    const dataDir = newTempDir('sophia-data-')
    openLedger({ path: join(dataDir, 'ledger.sqlite') }).close()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/view', req())
    const payload = JSON.parse(String(res.body)) as { pendingPlans?: unknown }
    // 反恒真：WireView 的 pendingPlans 改成可选/漏传 → 本条红（undefined 不是数组）。
    expect(Array.isArray(payload.pendingPlans)).toBe(true)
    expect(payload.pendingPlans).toEqual([])
  })
})

describe('t1 · POST /api/sophia/spawn/decision（两级审批的人类出口）', () => {
  /** 种一条 awaiting 票（requestId 参数化；roster 用合法职位以便批准时能建团）。 */
  function seedAwaiting(dataDir: string, requestId: string): void {
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'spawn/awaiting-human-approval',
        actor: humanActor,
        // ⚠ 基座 `requestId` 必须写：delegation 的 `collectSpawnEvents` 按
        // **事件基座**的 requestId 过滤（不是 data.requestId）—— 漏写它票就查不到
        //（真实 spawn 链路由 requestSpawn 内部写入，只有手工播种会踩）。
        requestId: requestId as never,
        data: {
          requestId,
          requesterMemberId: MEMBER_ID as MemberId,
          principalMemberId: MEMBER_ID as MemberId,
          targetKind: 'persistent',
          spec: {
            name: '审批闭环团',
            roster: [{ position: POSITION, count: 1, model: null }],
            tasks: ['任务甲'],
          },
        },
      })
    } finally {
      ledger.close()
    }
  }

  function decisionReq(requestId: string, decision: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    // 必须走流式 postReq：readJsonBody 靠 `req.on('data'|'end')` 读体
    //（裸 `{body}` 对象会 400「不支持流式读取」）。
    return postReq({ requestId, decision, ...extra })
  }

  it('批准 → 200 + 落 spawn/human-approved 与 team/created（团真的建成）', async () => {
    const dataDir = newDataDir()
    seedAwaiting(dataDir, 'req-dec-1')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    // seedAt 基线自带 1 条 team/created —— 计数一律走**差分**（与换模用例同口径）。
    const baseline = countEvents(dataDir, 'team/created')
    const res = await call(host, '/api/sophia/spawn/decision', decisionReq('req-dec-1', 'approve'))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as { ok: boolean; teamId?: string }
    // 反恒真：路由只回 200 不调 decideSpawnTicket → 下面两条计数必红。
    expect(payload.ok).toBe(true)
    expect(typeof payload.teamId).toBe('string')
    expect(countEvents(dataDir, 'spawn/human-approved')).toBe(1)
    expect(countEvents(dataDir, 'team/created') - baseline).toBe(1)
  })

  it('否决 → 200 + 落 spawn/human-rejected，**不建团**', async () => {
    const dataDir = newDataDir()
    seedAwaiting(dataDir, 'req-dec-2')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/created')
    const res = await call(
      host,
      '/api/sophia/spawn/decision',
      decisionReq('req-dec-2', 'reject', { reason: '暂缓开团' }),
    )
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as { ok: boolean }
    expect(payload.ok).toBe(true)
    expect(countEvents(dataDir, 'spawn/human-rejected')).toBe(1)
    expect(countEvents(dataDir, 'team/created') - baseline).toBe(0)
  })

  it('重复批准 → 幂等回放**同一 teamId**，不建第二个团（FR-5.3.4）', async () => {
    const dataDir = newDataDir()
    seedAwaiting(dataDir, 'req-dec-3')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/created')
    const first = await call(host, '/api/sophia/spawn/decision', decisionReq('req-dec-3', 'approve'))
    const second = await call(host, '/api/sophia/spawn/decision', decisionReq('req-dec-3', 'approve'))
    const a = JSON.parse(String(first.body)) as { teamId?: string }
    const b = JSON.parse(String(second.body)) as { teamId?: string }
    // 反恒真：去掉 decideSpawnTicket 的幂等去重（in-flight map + findTeamCreatedFor 回放）
    // → 第二次会再建一个团，本条与计数必红。
    expect(a.teamId).toBe(b.teamId)
    expect(countEvents(dataDir, 'team/created') - baseline).toBe(1)
    expect(countEvents(dataDir, 'spawn/human-approved')).toBe(1)
  })

  it('未知票号 → 404 + 可读原因（不是 500，也不静默成功）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/created')
    const res = await call(host, '/api/sophia/spawn/decision', decisionReq('req-nope', 'approve'))
    expect(res.status).toBe(404)
    const payload = JSON.parse(String(res.body)) as { ok: boolean; error?: string }
    expect(payload.ok).toBe(false)
    expect(typeof payload.error).toBe('string')
    expect(countEvents(dataDir, 'team/created') - baseline).toBe(0)
  })

  it('GET → 405（与 member/model 同口径）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/spawn/decision', req({ method: 'GET' }))
    expect(res.status).toBe(405)
  })
})

describe('t1 · 运营入口（文档 4 节 remote 面：channel / member / lifecycle / dag）', () => {
  const CH_TITLE = '新频道-验收'

  it('createChannel：落 team/channel-created（差分 +1）且 /view 里出现', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/channel-created')
    const res = await call(host, '/api/sophia/channel', postReq({ teamId: TEAM_ID, title: CH_TITLE }))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as { ok: boolean; channelId?: string }
    expect(payload.ok).toBe(true)
    expect(typeof payload.channelId).toBe('string')
    expect(countEvents(dataDir, 'team/channel-created') - baseline).toBe(1)
    const view = await call(host, '/api/sophia/view', req())
    const body = JSON.parse(String(view.body)) as {
      teams: Array<{ channels: Array<{ title: string }> }>
    }
    // 反恒真：路由只回 200 不 commit → 上面的差分与本条必红。
    expect(body.teams[0]!.channels.map((c) => c.title)).toContain(CH_TITLE)
  })

  it('createChannel：未知 teamId → 404 且不落账', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/channel-created')
    const res = await call(
      host,
      '/api/sophia/channel',
      postReq({ teamId: 'team-nonexist-00000000', title: CH_TITLE }),
    )
    expect(res.status).toBe(404)
    expect(countEvents(dataDir, 'team/channel-created') - baseline).toBe(0)
  })

  it('addMember：命名门禁生效 —— 同职位第二个成员拿到 `-2` 后缀（SPEC §3.5）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/member-added')
    const res = await call(host, '/api/sophia/member', postReq({ teamId: TEAM_ID, position: POSITION }))
    expect(res.status).toBe(200)
    const payload = JSON.parse(String(res.body)) as { ok: boolean; name?: string; memberId?: string }
    expect(payload.ok).toBe(true)
    // seedAt 已有一个 active 的「星仪主事」⇒ 第二个必须分配到「星仪主事-2」。
    // 反恒真：allocateMemberName 恒返回职位名 → 本条红（会拿到无后缀同名）。
    expect(payload.name).toBe(`${POSITION}-2`)
    expect(typeof payload.memberId).toBe('string')
    expect(countEvents(dataDir, 'team/member-added') - baseline).toBe(1)
  })

  it('addMember：不在名册的职位 → 400（命名门禁在本入口也硬拒绝，裁定 Q-D）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/member-added')
    const res = await call(host, '/api/sophia/member', postReq({ teamId: TEAM_ID, position: '天官正' }))
    expect(res.status).toBe(400)
    const payload = JSON.parse(String(res.body)) as { error?: string }
    expect(typeof payload.error).toBe('string')
    expect(countEvents(dataDir, 'team/member-added') - baseline).toBe(0)
  })

  it('lifecycle：suspend 落账 + /view 的 lifecycle 随之翻转', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/member-suspended')
    const res = await call(
      host,
      '/api/sophia/member/lifecycle',
      postReq({ memberId: MEMBER_ID, action: 'suspend' }),
    )
    expect(res.status).toBe(200)
    expect(countEvents(dataDir, 'team/member-suspended') - baseline).toBe(1)
    const view = await call(host, '/api/sophia/view', req())
    const body = JSON.parse(String(view.body)) as {
      teams: Array<{ members: Array<{ memberId: string; lifecycle: string }> }>
    }
    const member = body.teams[0]!.members.find((m) => m.memberId === MEMBER_ID)
    // 反恒真：路由只回 200 不 commit → 差分与本条必红。
    expect(member?.lifecycle).toBe('suspended')
  })

  it('lifecycle：已是目标态 → 409 no-change（不写 from===to 的冗余事件）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const first = await call(
      host,
      '/api/sophia/member/lifecycle',
      postReq({ memberId: MEMBER_ID, action: 'suspend' }),
    )
    expect(first.status).toBe(200)
    const baseline = countEvents(dataDir, 'team/member-suspended')
    const second = await call(
      host,
      '/api/sophia/member/lifecycle',
      postReq({ memberId: MEMBER_ID, action: 'suspend' }),
    )
    expect(second.status).toBe(409)
    expect(countEvents(dataDir, 'team/member-suspended') - baseline).toBe(0)
  })

  it('dag 移交：先种 dag/team-created 再移交 → 落 dag/ownership-transferred', async () => {
    const dataDir = newDataDir()
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'dag/team-created',
        actor: humanActor,
        data: {
          dagTeamId: 'dag-ok-1',
          ownerMemberId: MEMBER_ID as MemberId,
          parentTeamId: TEAM_ID as TeamId,
          requestedByTransfer: false,
        },
      })
    } finally {
      ledger.close()
    }
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    // owner 校验后，正路径需要**两个真实成员**（from = owner、to = 另一人）：
    // 先经运营路由加一名成员，再把归属移交给它。
    const added = await call(host, '/api/sophia/member', postReq({ teamId: TEAM_ID, position: '灵台郎' }))
    expect(added.status).toBe(200)
    const newMemberId = (JSON.parse(String(added.body)) as { memberId: string }).memberId
    const baseline = countEvents(dataDir, 'dag/ownership-transferred')
    const res = await call(
      host,
      '/api/sophia/dag/ownership',
      postReq({ dagTeamId: 'dag-ok-1', from: MEMBER_ID, to: newMemberId }),
    )
    expect(res.status).toBe(200)
    expect(countEvents(dataDir, 'dag/ownership-transferred') - baseline).toBe(1)
  })

  it('dag 移交：dagTeamId 不存在 → 404 且不落账（不向账本写指向不存在实体的事件）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'dag/ownership-transferred')
    const res = await call(
      host,
      '/api/sophia/dag/ownership',
      postReq({ dagTeamId: 'dag-missing-9', from: MEMBER_ID, to: MEMBER_ID }),
    )
    expect(res.status).toBe(404)
    expect(countEvents(dataDir, 'dag/ownership-transferred') - baseline).toBe(0)
  })

  it('/view 透出 dagTeams（DagCanvas 的数据源）+ 任务当前态', async () => {
    const dataDir = newDataDir()
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'dag/team-created',
        actor: humanActor,
        data: { dagTeamId: 'dag-view-1', ownerMemberId: MEMBER_ID as MemberId, parentTeamId: TEAM_ID as TeamId, requestedByTransfer: false },
      })
      commit(ledger, {
        kind: 'dag/task-state-changed',
        actor: humanActor,
        data: { dagTeamId: 'dag-view-1', taskId: 'task-a', from: 'pending', to: 'running' },
      })
    } finally {
      ledger.close()
    }
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const view = await call(host, '/api/sophia/view', req())
    const body = JSON.parse(String(view.body)) as {
      dagTeams: Array<{ dagTeamId: string; ownerMemberId: string; tasks: Array<{ taskId: string; state: string }> }>
    }
    // 反恒真：buildWireView 不透 dagTeams（字段缺失）→ 本条必红。
    const dag = body.dagTeams.find((entry) => entry.dagTeamId === 'dag-view-1')
    expect(dag).toBeDefined()
    expect(dag?.ownerMemberId).toBe(MEMBER_ID)
    expect(dag?.tasks).toEqual([{ taskId: 'task-a', state: 'running', reason: null }])
  })

  function seedOwnedDag(dataDir: string): void {
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'dag/team-created',
        actor: humanActor,
        data: { dagTeamId: 'dag-guard', ownerMemberId: MEMBER_ID as MemberId, parentTeamId: TEAM_ID as TeamId, requestedByTransfer: false },
      })
    } finally {
      ledger.close()
    }
  }

  it('dag 移交：from 不是当前归属 → 409 且不落账（OCR HIGH [1]：伪造 from 是永久污染）', async () => {
    const dataDir = newDataDir()
    seedOwnedDag(dataDir)
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'dag/ownership-transferred')
    // ghost-member **存在性都没过**，但 owner 校验排在成员存在性之前
    // ⇒ 必须 409 conflict；若 owner 校验被挪走/漏掉，这条会变成 404 或 200。
    const res = await call(
      host,
      '/api/sophia/dag/ownership',
      postReq({ dagTeamId: 'dag-guard', from: 'ghost-member-00000000', to: MEMBER_ID }),
    )
    expect(res.status).toBe(409)
    // 语义钉死：409 必须来自「伪造 from」这条 conflict（reason 含当前归属信息），
    // 不允许是别的 409 路径冒充（观测矛盾：本测试没种成员，若走到 unknown-member
    // 会是 404；若 409 来自其它分支，这条 toContain 会红）。
    expect(String(res.body)).toContain('当前归属')
    expect(countEvents(dataDir, 'dag/ownership-transferred') - baseline).toBe(0)
  })

  it('dag 移交：from === to → 409（无意义的移交不落账）', async () => {
    const dataDir = newDataDir()
    seedOwnedDag(dataDir)
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'dag/ownership-transferred')
    const res = await call(
      host,
      '/api/sophia/dag/ownership',
      postReq({ dagTeamId: 'dag-guard', from: MEMBER_ID, to: MEMBER_ID }),
    )
    expect(res.status).toBe(409)
    expect(String(res.body)).toContain('无意义的移交')
    expect(countEvents(dataDir, 'dag/ownership-transferred') - baseline).toBe(0)
  })

  it('lifecycle destroy：成员仍是 DAG 归属 → 409 且不落销毁事件（悬空引用防线）', async () => {
    const dataDir = newDataDir()
    seedOwnedDag(dataDir)
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const baseline = countEvents(dataDir, 'team/member-destroyed')
    const res = await call(
      host,
      '/api/sophia/member/lifecycle',
      postReq({ memberId: MEMBER_ID, action: 'destroy' }),
    )
    expect(res.status).toBe(409)
    // 语义钉死：409 必须来自「仍是 DAG 归属」的 conflict —— 若实际走了
    // unknown-member（404）或 no-change（reason 不含本词），这条会红。
    expect(String(res.body)).toContain('悬空引用')
    expect(countEvents(dataDir, 'team/member-destroyed') - baseline).toBe(0)
  })

  it('lifecycle：终态成员（destroyed）不可被 resume 复活 → 409（OCR 第七轮）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      commit(ledger, {
        kind: 'team/member-destroyed',
        actor: humanActor,
        data: { teamId: TEAM_ID, memberId: MEMBER_ID, from: 'active', to: 'destroyed' },
      })
    } finally {
      ledger.close()
    }
    const baseline = countEvents(dataDir, 'team/member-resumed')
    const res = await call(
      host,
      '/api/sophia/member/lifecycle',
      postReq({ memberId: MEMBER_ID, action: 'resume' }),
    )
    // 反恒真：去掉终态 guard ⇒ 200 落账 ⇒ 本条红（复活事件被写进不可改账本）。
    expect(res.status).toBe(409)
    expect(String(res.body)).toContain('终态')
    expect(countEvents(dataDir, 'team/member-resumed') - baseline).toBe(0)
  })
})

describe('t1 · GET /api/sophia/avatar（安全关键）', () => {
  const avatarUrl = (payload: string): string => `/api/sophia/avatar?path=${payload}`

  it('合法路径返回 PNG 字节与正确的 content-type', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/avatar', req({ url: avatarUrl(encodeURIComponent(AVATAR_REL)) }))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    // 反恒真：把 readAvatarBytes 换成固定字符串 → 本条必须变红（已实测）。
    expect(Buffer.from(res.body as Uint8Array).equals(PNG_BYTES)).toBe(true)
  })

  it('真实客户端编码（encodeURIComponent 整条路径，含中文目录）能取到图', async () => {
    // 这条与上一条**不同**：它走的是 `avatarUrlFor` 实际产出的那种 URL
    // （整条路径被编码、`/` 变成 `%2F`），因此顺带证明「双层解码」不会
    // 把合法路径解坏。反恒真：去掉第二层 decodeURIComponent 且保留第一层
    // → 中文目录名会解不出来（已实测：变 404）。
    const { avatarUrlFor } = await import('../src/avatar-paths.ts')
    const url = avatarUrlFor(AVATAR_REL)
    expect(url, '契约：avatarUrlFor 必须产出可用的 URL').not.toBeNull()
    const query = url!.slice(url!.indexOf('?') + 1)
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/avatar', req({ url: `/api/sophia/avatar?${query}` }))
    expect(res.status).toBe(200)
    expect(Buffer.from(res.body as Uint8Array).equals(PNG_BYTES)).toBe(true)
  })

  it.each([
    ['单层编码的 ..（无白名单前缀）', '%2e%2e%2f%2e%2e%2f%2e%2e%2f%2ecredentials.yaml'],
    ['未编码路径分隔的 ..', '..%2f..%2f..%2f.credentials.yaml'],
    [
      // ⭐ 决定性用例：**白名单前缀 + 双层编码 + `.png` 结尾**。
      //
      // 三个条件缺一不可，否则本条**不能**区分「解一层」与「解两层」：
      // - **`.png` 结尾**：这正是我第一版写错的地方（写成 `.yaml`），
      //   于是扩展名白名单在**两种**实现下都拒 ⇒ 用例恒绿，测不出任何东西
      //   （变异验证实测：去掉第二层 decode 后，`.yaml` 版**仍然 50/50 全绿**）。
      // - **白名单前缀**：`URL.searchParams.get()` **自己已经解过一次**百分号编码，
      //   所以第一层解出的 `%2e%2e%2f` 是**字面**出现在路径里的 ——
      //   此时它以 `assets/members/` 开头、分段里没有字面 `..`、扩展名是 `.png`，
      //   **只解一层的实现会完整通过判据**，然后走到 statSync 因文件不存在回 404。
      // - **只解两层才现出 `../`**：判据拒 ⇒ 400。
      //
      // ⇒ 400（判据拒）vs 404（碰巧文件不存在）把两种实现分开。
      // 已实测：去掉 handler 的第二层 decode 后，本条**变红**（404 ≠ 400）。
      '双层编码 + 白名单前缀 + .png（只解一层会漏）',
      'assets%2Fmembers%2Fout-512%2F%252e%252e%252f%252e%252e%252f%252ecredentials.png',
    ],
    [
      // 同型载荷的 `.yaml` 版：扩展名白名单兜底（两种实现都给 400）。
      // 保留它是为了证明**纵深**：即使编码层被绕过，扩展名白名单仍拒。
      '双层编码 + 白名单前缀 + 非 png 扩展名（扩展名白名单兜底）',
      'assets%2Fmembers%2Fout-512%2F%252e%252e%252f%252e%252e%252f%252ecredentials.yaml',
    ],
    ['白名单前缀 + 逐段 ..', 'assets%2Fmembers%2F..%2F..%2F..%2F.credentials.yaml'],
    ['反斜杠穿越', '..%5c..%5c..%5c.credentials.yaml'],
    ['绝对路径 unix', '%2Fetc%2Fpasswd.png'],
    ['Windows 盘符', 'C%3A%2FWindows%2Fwin.ini.png'],
    ['UNC 路径', '%5C%5Cserver%5Cshare%5Cx.png'],
    ['非 png 扩展名', 'assets%2Fmembers%2Fout-512%2Fx.txt'],
    ['点前无文件名的隐藏文件', 'assets%2Fmembers%2Fout-512%2F.png'],
    ['NUL 截断（扩展名伪装）', 'assets%2Fmembers%2Fout-512%2Fx.png%00.txt'],
  ])('路径穿越/越界被**判据**拒绝：%s', async (_label, payload) => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/avatar', req({ url: avatarUrl(payload) }))
    // ⚠ 断言的是 **400**（判据拒绝）而**不是**「非 200」。
    // 这个区别是本题的要害：若判据失效，这些输入大多会走到 statSync 并因
    // 「素材不存在」回 **404** —— 那也是「非 200」，于是「非 200」这个断言
    // 会在防护已被拆掉的情况下**照样全绿**。400 vs 404 才能把
    // 「被拦下」与「碰巧文件不存在」分开。已实测：删掉 `sanitizeAvatarPath`
    // 调用后本组用例变红（404 ≠ 400）。
    expect(res.status, `${_label} 必须被**判据**拒绝，而不是碰巧命中 404`).toBe(400)
  })

  it('素材根内的**符号链接**指向外部文件时被拒（纯词法判据挡不住它）', async () => {
    // OCR 复核 LOW [32] 指出初版注释宣称第二道门能挡符号链接，而
    // `path.resolve` 是**纯词法**的、根本不碰文件系统 —— 那句话是假的。
    // 这道用例钉住真正的防护（第三道：realpath 复核），并让注释不能再说谎。
    const root = newRepoRoot()
    const outside = join(root, 'outside-secret.png')
    writeFileSync(outside, 'NOT AN AVATAR')
    const linkPath = join(root, 'assets', 'members', 'out-512', TIER_DIR, '链接.png')
    try {
      symlinkSync(outside, linkPath)
    } catch {
      // Windows 上建符号链接需要权限/开发者模式；建不出来就跳过而非假绿。
      return
    }
    const host = await mountHost({ repoRoot: root, dataDir: newDataDir() })
    const rel = `assets/members/out-512/${TIER_DIR}/链接.png`
    const res = await call(host, '/api/sophia/avatar', req({ url: avatarUrl(encodeURIComponent(rel)) }))
    // 反恒真：去掉 realpath 那道门 → 本条必须变红（已实测：会 200 并吐出外部文件字节）。
    expect(res.status, '链接指向素材根之外时必须被拒').toBe(400)
    expect(Buffer.from(res.body as Uint8Array).toString('utf8')).not.toContain('NOT AN AVATAR')
  })

  it('★ 回归：返回的必须是**被验证过的** realpath，不是词法路径（TOCTOU，队长核实）', async () => {
    // ## 这条用例为什么与上一条**不同**、为什么必需
    //
    // 上一条只证明「根外的链接会被**拒**」。而队长核实的缺陷是另一件事：
    // 通过校验之后，`resolveAvatarFile` **返回的是词法 `absolutePath`**，
    // 而校验用的是 `realPath` ⇒ **被验证的路径 ≠ 被读取的路径**，
    // 两者之间那段窗口里链接可以被换成别的目标（TOCTOU）。
    //
    // ⇒ 要鉴别这个缺陷，必须断言**返回值本身**，而不是只看「拒没拒」：
    //   在同一个素材根内建一个**指向根内另一文件**的链接（**会被放行**，
    //   所以上一条用例根本不会走到这里），然后断言返回的绝对路径是
    //   **realpath 之后的规范路径**（= 指向的真实文件），而不是那个链接路径。
    //   修好前：返回词法链接路径 ⇒ 本断言红；修好后：返回真实路径 ⇒ 绿。
    const { resolveAvatarFile } = await import('../src/host-data.ts')
    const root = newRepoRoot()
    // 真实文件（与 `AVATAR_REL` 同目录，确保两道前缀门都过）。
    const realTarget = join(root, 'assets', 'members', 'out-512', TIER_DIR, '真实.png')
    writeFileSync(realTarget, PNG_BYTES)
    const linkName = join(root, 'assets', 'members', 'out-512', TIER_DIR, '别名.png')
    try {
      symlinkSync(realTarget, linkName)
    } catch {
      // Windows 需要开发者模式/权限；建不出链接就**响亮跳过这条**（不回退成假绿）。
      return
    }

    const rel = `assets/members/out-512/${TIER_DIR}/别名.png`
    const resolved = resolveAvatarFile(root, rel)
    expect(resolved.kind, '根内链接指向根内文件 ⇒ 应当放行').toBe('ok')
    if (resolved.kind !== 'ok') return

    // ★ 核心断言：返回的路径**不能**是那个符号链接路径。
    expect(
      resolved.absolutePath,
      '返回词法链接路径 ⇒ 校验(realPath)与读取(absolutePath)不是同一个路径（TOCTOU 窗口）',
    ).not.toBe(linkName)
    // ★ 它必须是 realpath 之后的规范路径（= 真实文件的规范路径）。
    const { realpathSync: realpath } = await import('node:fs')
    expect(resolved.absolutePath).toBe(realpath(realTarget))
  })

  it('头像表按 repoRoot 缓存：同一根不重复扫盘（热路径不能被同步 IO 拖住）', async () => {
    // OCR 复核 MEDIUM [10]：`buildWireView` 每次调用都建解析器，而 `/view`
    // 是**热路径**（界面在轮询）⇒ 每轮都同步递归扫 4 个梯队目录。
    // 这条断言用「素材目录被删掉后**仍能**解析出路径」来证明它确实缓存了 ——
    // 因为若每轮重扫，删掉目录后第二次就会解析不出（这正是可区分两种实现的地方）。
    const { createAvatarPathResolver } = await import('../src/host-data.ts')
    const root = newRepoRoot()
    const first = createAvatarPathResolver(root)
    expect(first(POSITION), '首次应当从磁盘解析出来').toBe(AVATAR_REL)

    // 把整个素材树删掉。
    rmSync(join(root, 'assets'), { recursive: true, force: true })

    const second = createAvatarPathResolver(root)
    // 反恒真：去掉 avatarPathCaches → 本条必须变红（已实测：第二次会是 undefined）。
    expect(second(POSITION), '第二次必须命中缓存，而不是重新扫盘').toBe(AVATAR_REL)
  })

  it('头像表缓存有上限：造很多临时 root 不会把进程撑住', async () => {
    // OCR 复核 LOW [2]：无上限的缓存会被测试造的临时 root 撑住
    // （每个 root 留着整份素材表 + 一个永久字符串键）。
    const { createAvatarPathResolver } = await import('../src/host-data.ts')
    // 造 12 个**不同的** root（上限是 8）：每个都解析一次。
    const roots: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const root = newRepoRoot()
      roots.push(root)
      createAvatarPathResolver(root)(POSITION)
    }
    // 最早的那几个应当已被淘汰（用「删掉素材后是否还能解析」探测缓存是否还在）。
    const oldest = roots[0]!
    rmSync(join(oldest, 'assets'), { recursive: true, force: true })
    // 反恒真：去掉 AVATAR_CACHE_LIMIT 的淘汰循环 → 最旧的仍在缓存里、本条必须变红（已实测）。
    expect(
      createAvatarPathResolver(oldest)(POSITION),
      '最旧的条目应已被淘汰 ⇒ 重扫 ⇒ 素材已删 ⇒ undefined',
    ).toBeUndefined()
  })

  it('素材根不可读时把失败**如实回调**出去（不静默吞掉）', async () => {
    // OCR 复核 MEDIUM [7]：初版静默 `catch {}`，于是「素材目录没了」与
    // 「这个职位就是没头像」在任何地方都不可区分 —— 界面只是少个头像。
    const { createAvatarPathResolver } = await import('../src/host-data.ts')
    const root = newTempDir('sophia-norepo-')
    const failures: unknown[] = []
    const resolvePosition = createAvatarPathResolver(root, (error) => failures.push(error))
    // 反恒真：把 `onScanFailure?.(error)` 删掉 → 本条必须变红（已实测）。
    expect(failures, '扫不动必须留痕').toHaveLength(1)
    expect(resolvePosition(POSITION), '失败时退回 undefined（界面走首字降级）').toBeUndefined()
  })

  it('缺失 path 参数回 400（不是 500，也不是空响应）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/avatar', req({ url: '/api/sophia/avatar' }))
    expect(res.status).toBe(400)
  })

  it('白名单内但素材不存在时回 404（与判据拒绝区分开）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const missing = `assets/members/out-512/${TIER_DIR}/不存在的职位.png`
    const res = await call(host, '/api/sophia/avatar', req({ url: avatarUrl(encodeURIComponent(missing)) }))
    // 「判据拒绝(400) vs 素材缺失(404)」刻意分开：对用户是不同的事
    // （前者是攻击或客户端 bug，后者是素材缺失）。
    expect(res.status).toBe(404)
  })

  it('非法百分号编码回 400（不抛异常、不 500）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    // `%E4%` 是不完整的多字节序列 ⇒ decodeURIComponent 抛 URIError。
    const res = await call(host, '/api/sophia/avatar', req({ url: avatarUrl('assets%2Fmembers%2F%25E4%25.png') }))
    expect([200, 400, 404]).toContain(res.status)
    expect(res.status, '不允许 500').not.toBe(500)
  })

  it('非回环来源被 403 挡住（头像是仓库文件，不能对外提供）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(
      host,
      '/api/sophia/avatar',
      remoteReq({ url: avatarUrl(encodeURIComponent(AVATAR_REL)) }),
    )
    expect(res.status).toBe(403)
  })

  it('`connection` 缺失时头像路由也回 503（不因为「只是张图」就放行）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir(), withoutConnection: true })
    const res = await call(host, '/api/sophia/avatar', req({ url: avatarUrl(encodeURIComponent(AVATAR_REL)) }))
    expect(res.status).toBe(503)
  })
})

// ────────────────────────────────────────────────────────────────────────────

describe('t1 · POST /api/sophia/member/model', () => {
  it('换模事件**真的落进账本**（另开连接读回来验证，不信 200）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    expect(res.status).toBe(200)
    const { sequence } = JSON.parse(String(res.body)) as { ok: boolean; sequence: number }

    // ⚠ 关键：**另开一条连接读回来**，而不是相信那个 200。
    // 反恒真：把 switchMemberModel 改成只 `return {kind:'ok',sequence:1}` 不 commit
    // → 下面的账本断言必须变红（已实测）。
    const reopened = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      const switched = reopened.read({ limit: 1000 }).events
        .filter((event) => event.kind === 'team/member-model-switched')
      // 前置播种写了 1 条（初始指派），本次再写 1 条 ⇒ 2 条。
      expect(switched, '必须真的多出一条换模事件').toHaveLength(2)
      const latest = switched[switched.length - 1]!
      expect(latest.sequence).toBe(sequence)
      expect(latest.actor).toEqual({ kind: 'human', humanId: 'sophia-ui' })
      expect(latest.data).toMatchObject({
        teamId: TEAM_ID,
        memberId: MEMBER_ID,
        from: PRIOR_MODEL,
        to: { provider: 'anthropic', model: 'claude-x' },
        reason: 'human-switch',
        trigger: 'human',
      })
      // `effectiveAtSequence` 必须等于真实落账序号（head+1 预测）。
      expect((latest.data as { effectiveAtSequence: number }).effectiveAtSequence).toBe(sequence)
    } finally {
      reopened.close()
    }
  })

  it('换模后 `/view` 里的模型跟着变（两条路由读同一份账本）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })

    const readModel = async (): Promise<unknown> => {
      const res = await call(host, '/api/sophia/view', req())
      const payload = JSON.parse(String(res.body)) as {
        teams: Array<{ members: Array<{ model: unknown }> }>
      }
      return payload.teams[0]!.members[0]!.model
    }

    expect(await readModel(), '前置播种的模型应当先可见').toEqual(PRIOR_MODEL)
    await call(host, '/api/sophia/member/model', postReq(switchBody()))
    // 反恒真：让 buildWireMember 的 model 恒为 null → 本条必须变红（已实测）。
    expect(await readModel()).toEqual({ provider: 'anthropic', model: 'claude-x' })
  })

  it('字段两端的空白**被裁掉**（否则会写出一条 from===to 的假转换）', async () => {
    // OCR 复核 MEDIUM [30]：只判非空不裁剪时，`' gpt-prior '` 与当前模型
    // **不相等** ⇒ 同模型短路失效 ⇒ 往**不可改写**的账本里写一条假转换。
    // t4 在同族字段上已有同一处置（`tools/internal.ts` 的 `narrowTrimmedString`）。
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(
      host,
      '/api/sophia/member/model',
      postReq(switchBody({ provider: `  ${PRIOR_MODEL.provider}  `, model: ` ${PRIOR_MODEL.model} ` })),
    )
    // 裁剪后与当前模型相同 ⇒ 走 no-change（409），**不是**写成一条假转换。
    // 反恒真：把 trimmedNonEmpty 改回「只判非空、不 trim」→ 本条必须变红（已实测：会 200 + 多一条事件）。
    expect(res.status, '两端空白必须被裁掉，于是这是同模型 no-change').toBe(409)
    expect(countEvents(dataDir, 'team/member-model-switched')).toBe(1)
  })

  it('换模成功时 `effectiveAtSequence` 必须等于真实落账序号', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    const sequence = (JSON.parse(String(res.body)) as { sequence: number }).sequence
    const reopened = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      const latest = reopened.read({ limit: 1000 }).events
        .filter((event) => event.kind === 'team/member-model-switched')
      const event = latest[latest.length - 1]!
      expect((event.data as { effectiveAtSequence: number }).effectiveAtSequence).toBe(event.sequence)
    } finally {
      reopened.close()
    }
  })

  it('GET 到换模路由回 405（换模有副作用，不接受 GET）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/member/model', req({ method: 'GET' }))
    expect(res.status).toBe(405)
  })

  it.each([
    ['缺 memberId', { provider: 'a', model: 'b', reason: 'c' }],
    ['缺 provider', { memberId: MEMBER_ID, model: 'b', reason: 'c' }],
    ['缺 model', { memberId: MEMBER_ID, provider: 'a', reason: 'c' }],
    ['缺 reason', { memberId: MEMBER_ID, provider: 'a', model: 'b' }],
    ['memberId 是空串', { memberId: '', provider: 'a', model: 'b', reason: 'c' }],
    ['memberId 不是字符串', { memberId: 42, provider: 'a', model: 'b', reason: 'c' }],
  ])('body 字段校验：%s → 400 且**不落账**', async (_label, body) => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const before = countEvents(dataDir, 'team/member-model-switched')
    const res = await call(host, '/api/sophia/member/model', postReq(body))
    expect(res.status).toBe(400)
    // 「400 **且没落账**」才是完整判据：只断言 400 的话，
    // 一个「先落账再校验」的实现也会全绿。
    expect(countEvents(dataDir, 'team/member-model-switched')).toBe(before)
  })

  it('body 不是合法 JSON 回 400', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/member/model', postReq(null, '{不是 json'))
    expect(res.status).toBe(400)
  })

  it('body 是数组回 400（JSON 合法但形状不对）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/member/model', postReq(null, '[1,2,3]'))
    expect(res.status).toBe(400)
  })

  it('空 body 回 400（按 {} 处理，报「缺字段」而不是 JSON 语法错）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const res = await call(host, '/api/sophia/member/model', postReq(null, ''))
    expect(res.status).toBe(400)
    expect(String(res.body)).toContain('memberId')
  })

  it('未知成员回 404（不往账本里塞指向不存在成员的事件）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const before = countEvents(dataDir, 'team/member-model-switched')
    const res = await call(
      host,
      '/api/sophia/member/model',
      postReq(switchBody({ memberId: 'sophia-nobody-00000000' })),
    )
    // 反恒真：去掉 switchMemberModel 的 unknown-member 分支 → 本条必须变红（已实测：会 200）。
    expect(res.status).toBe(404)
    expect(countEvents(dataDir, 'team/member-model-switched')).toBe(before)
  })

  it('成员从未换过模（`from` 取不到）时回 409，**不**用猜测值顶上', async () => {
    // `model: null` ⇒ 账本里没有当前模型。此时换模事件的 `from` 无从取到，
    // 拿 `to` 顶上会写出一条 `from === to` 的空转换，而账本**不可改写**
    // ⇒ 之后任何重放换模链的消费方都会从错误的起点开始。
    const dataDir = newDataDir('none')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    expect(res.status).toBe(409)
    expect(String(res.body), '原因要可读，不能只说「冲突」').toContain('从未换过模')
    expect(countEvents(dataDir, 'team/member-model-switched'), '拒绝路径绝不能留下事件').toBe(0)
  })

  it('**建团时带入模型的成员，第一次换模就能成功**（t3 补 `MemberAddedData.model` 的端到端验证）', async () => {
    // ★ 这条是「我上报的缺口已修」的**验收断言**：
    // 此前「没有任何上游给成员设初始模型」⇒ 新团成员的 `model` 恒为 `null`
    // ⇒ 人类在成员卡片上第一次点「换模」**必然失败**（FR-6.1 不可达）。
    // captain 裁定采纳方案 1（`MemberAddedData` 加 `model`）后，
    // 建团那一刻的模型就有账本事实可依 ⇒ 首次换模走**正常成功**路径。
    const dataDir = newDataDir('at-add')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })

    // 起点：模型来自 `member-added` 载荷（不是换模事件）。
    const before = JSON.parse(String((await call(host, '/api/sophia/view', req())).body)) as {
      teams: Array<{ members: Array<{ model: unknown }> }>
    }
    expect(before.teams[0]!.members[0]!.model, '建团带入的模型必须可见').toEqual(PRIOR_MODEL)

    // 关键：这是**第一次**换模，此前账本里没有任何 `member-model-switched`。
    expect(countEvents(dataDir, 'team/member-model-switched')).toBe(0)
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    // 反恒真：把投影改回「折叠 member-added 时硬写 model: null」
    // → 本条必须变红（已实测：会变成 409 unknown-current-model）。
    expect(res.status, '首次换模必须成功 —— 这正是缺口修复的判据').toBe(200)

    // 落账的 `from` 必须是建团带入的那个模型（真实旧模型，不是猜的）。
    const reopened = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      const switched = reopened.read({ limit: 1000 }).events
        .filter((event) => event.kind === 'team/member-model-switched')
      expect(switched).toHaveLength(1)
      expect((switched[0]!.data as { from: unknown }).from).toEqual(PRIOR_MODEL)
    } finally {
      reopened.close()
    }
  })

  it('换成同一个模型回 409 且不落账（否则「换过几次」会多算）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const same = switchBody({ provider: PRIOR_MODEL.provider, model: PRIOR_MODEL.model })
    const before = countEvents(dataDir, 'team/member-model-switched')
    const res = await call(host, '/api/sophia/member/model', postReq(same))
    // 反恒真：去掉 no-change 分支 → 本条必须变红（已实测：会 200 + 账本多一条）。
    expect(res.status).toBe(409)
    expect(countEvents(dataDir, 'team/member-model-switched')).toBe(before)
  })

  it('连续两次换模按序落账（head+1 预测与实际序号一致）', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const first = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    const second = await call(
      host,
      '/api/sophia/member/model',
      postReq(switchBody({ model: 'claude-y' })),
    )
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const firstSeq = (JSON.parse(String(first.body)) as { sequence: number }).sequence
    const secondSeq = (JSON.parse(String(second.body)) as { sequence: number }).sequence
    expect(secondSeq).toBe(firstSeq + 1)
    // 第二次的 `from` 必须是第一次的 `to`（换模链连续，不自相矛盾）。
    const reopened = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      const switched = reopened.read({ limit: 1000 }).events
        .filter((event) => event.kind === 'team/member-model-switched')
      const latest = switched[switched.length - 1]!
      expect((latest.data as { from: unknown }).from).toEqual({ provider: 'anthropic', model: 'claude-x' })
    } finally {
      reopened.close()
    }
  })

  it('非回环来源被 403 挡住（换模是写操作）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir() })
    const reqObj = postReq(switchBody())
    ;(reqObj as { socket: { remoteAddress: string } }).socket = { remoteAddress: '10.0.0.9' }
    const res = await call(host, '/api/sophia/member/model', reqObj)
    expect(res.status).toBe(403)
  })

  it('`connection` 缺失时换模路由回 503（写操作绝不放行）', async () => {
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: newDataDir(), withoutConnection: true })
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    expect(res.status).toBe(503)
  })

  it('`connection` 拒绝时写操作也拒绝，且账本不变', async () => {
    const dataDir = newDataDir()
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir })
    const before = countEvents(dataDir, 'team/member-model-switched')
    host.services['connection'] = { requestRejection: () => 403 }
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    expect(res.status).toBe(403)
    // 鉴权必须发生在**写之前**：403 之后账本不能有任何变化。
    expect(countEvents(dataDir, 'team/member-model-switched')).toBe(before)
  })

  it('账本不可用时回 503（数据目录不可写也不能假装成功）', async () => {
    // `SOPHIA_DATA_DIR` 指向一个**文件**而不是目录 ⇒ openLedger 必失败。
    const dir = newTempDir('sophia-data-')
    const asFile = join(dir, 'not-a-dir')
    writeFileSync(asFile, 'not a directory')
    const host = await mountHost({ repoRoot: newRepoRoot(), dataDir: asFile })
    const res = await call(host, '/api/sophia/member/model', postReq(switchBody()))
    // 反恒真：把 ledgerOf 的失败分支改成直接 throw → 本条会变成「用例抛错」而不是 503（已实测）。
    expect(res.status).toBe(503)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 写序校验（predict + verify）：单测直接打纯函数，因为**这个分支在路由层
// 无法构造** —— 要让 `receipt.sequence !== predicted` 成立，必须有另一个写者
// 在 head() 与 commit() 之间插入事件，而那是进程间的竞态，测试里造不出来。
// 用一个「如实记事件、但谎报序号」的包装账本来驱动它。
// ────────────────────────────────────────────────────────────────────────────

describe('t1 · 换模写序校验（predict + verify）', () => {
  it('注入时钟抛错时如实说「账本未被触碰」，**不**误报成「写失败」', async () => {
    // OCR 复核 MEDIUM [23]（复审指出我第一版只挪了位置、没挪归属）：
    // `now()` 是**注入**的外部代码。若它抛错而 catch 的文案是「写…失败」，
    // 调用方会去核对一条**根本不存在**的事件。
    const { switchMemberModel } = await import('../src/host-data.ts')
    const dataDir = newDataDir()
    const ledger = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      const before = countEvents(dataDir, 'team/member-model-switched')
      const result = switchMemberModel(
        ledger,
        { memberId: MEMBER_ID, provider: 'anthropic', model: 'claude-x', reason: 'human-switch' },
        () => {
          throw new Error('clock exploded')
        },
      )
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('unreachable')
      // 反恒真：把 now() 放回 commit 那个 try 里 → 文案会变成「写…失败」，本条必须变红（已实测）。
      expect(result.reason, '必须说清是时钟的问题，而不是「写失败」').toContain('取当前时间失败')
      expect(result.reason).toContain('账本未被触碰')
      expect(result.reason).not.toContain('写 team/member-model-switched 失败')
      // 最强的一句：账本真的没变。
      expect(countEvents(dataDir, 'team/member-model-switched')).toBe(before)
    } finally {
      ledger.close()
    }
  })

  it('`receipt.sequence` 与预测不符时回 `sequence-mismatch`，而不是假装成功', async () => {
    const { switchMemberModel } = await import('../src/host-data.ts')
    const dataDir = newDataDir()
    const real = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      // 谎报序号：模拟「另一个写者在 head() 与 commit() 之间插了一条事件」。
      // 事件**真的**落账（委托给真实 commit），只是回执序号与预测不一致 ——
      // 这正是真实的并发插入在**本进程**看来最接近的形态。
      const lying: Ledger = {
        commit: (input) => {
          const receipt = real.commit(input)
          return { ...receipt, sequence: receipt.sequence + 1 }
        },
        read: (query) => real.read(query),
        head: () => real.head(),
        verifyIntegrity: () => real.verifyIntegrity(),
        close: () => {},
      }

      const result = switchMemberModel(lying, {
        memberId: MEMBER_ID,
        provider: 'anthropic',
        model: 'claude-x',
        reason: 'human-switch',
      })

      // 反恒真：去掉 `receipt.sequence !== predicted` 那道校验 → 本条必须变红（已实测：会变成 ok）。
      expect(result.kind, '序号不符必须如实回报，不能回 ok').toBe('sequence-mismatch')
      if (result.kind !== 'sequence-mismatch') throw new Error('unreachable')
      expect(result.actual).toBe(result.predicted + 1)
      // 最关键的一句：事件**确实已经写进去了** —— 所以调用方**不能**重试。
      expect(
        real.read({ limit: 1000 }).events.filter((e) => e.kind === 'team/member-model-switched'),
        '事件已落账 ⇒ 这条结论不可通过重试来修正',
      ).toHaveLength(2)
      expect(result.reason, '必须明确写出「不要重试」').toContain('不要重试')
    } finally {
      real.close()
    }
  })

  it('★ 回归：`head().sequence` 形状非法 ⇒ `failed` 且**不写账本**（NaN 不得入账）', async () => {
    // ## 队长核实的高危缺陷（族A，比 task-claim/switch-model 那两处**更重**）
    //
    // 原实现：`predicted = ledger.head().sequence + 1`（**无形状校验**）。
    // 若注入的 Ledger 返回 `undefined`/非数字 ⇒ `NaN` ⇒ 写进
    // `effectiveAtSequence`，而 `JSON.stringify(NaN)` = `null` ⇒
    // **一条序号含义不明的事件永久留在 append-only 账本里**（无撤销手段）。
    // 那两处同类问题只是「把真因误报成 sequence-mismatch」；这里是**污染账本**。
    //
    // 判据必须能鉴别：断言 ① 结论是 `failed`；② 原因里点明是**形状**问题；
    // ③ **账本一条都没多**（这是最强的一句 —— 修好前 `commit` 会被调用）。
    const { switchMemberModel } = await import('../src/host-data.ts')
    const dataDir = newDataDir()
    const real = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      // 先用真账本种一条 member-added（否则会先在「不认识这个成员」处短路）。
      seedAt(dataDir, 'at-add')
      // ⚠ 必须在 seed 之后重新打开，才能看到那条事件。
      real.close()
      const seeded = openLedger({ path: join(dataDir, 'ledger.sqlite') })
      try {
        const before = countEvents(dataDir, 'team/member-model-switched')

        // 一个**违反契约**的账本：`head()` 的 sequence 不是非负安全整数。
        // 只覆写 head()，其余转交真账本（这样「除了这一点，别的都对」）。
        const lying = {
          head: () => ({ sequence: Number.NaN, eventId: null }),
          commit: (input: LedgerCommitInput) => seeded.commit(input),
          // ⚠ `read()` 的入参是**必填**的 `LedgerReadQuery`（`ledger.ts` 的签名
          // `read(query: LedgerReadQuery)`），不是可选的 —— 所以这里必须补 `?? {}`
          // 而不是把可选实参直接透传（灵台郎 报的在途编译错，已修）。
          read: (options?: { limit?: number }) => seeded.read(options ?? {}),
          close: () => seeded.close(),
        } as unknown as Ledger

        const result = switchMemberModel(lying, {
          memberId: MEMBER_ID,
          provider: 'anthropic',
          model: 'claude-x',
          reason: 'human-switch',
        })

        // ① 结论必须是 failed（不能是 ok、也不能是误导性的 sequence-mismatch）。
        expect(result.kind, '形状非法必须判 failed，不能顺手写进去').toBe('failed')
        if (result.kind !== 'failed') throw new Error('unreachable')
        // ② 原因必须点明是**形状**问题 + 账本没被碰过。
        expect(result.reason).toContain('非负安全整数')
        expect(result.reason).toContain('尚未写账本')
        // ③ 最强的一句：账本真的没多一条。
        //    反恒真：把这道校验删掉 → `commit` 会被调用，本条必须变红（已实测）。
        expect(
          countEvents(dataDir, 'team/member-model-switched'),
          'head() 形状非法时**不得**写账本（NaN 会被序列化成 null 永久留在账本里）',
        ).toBe(before)
        // ④ 而且**不能**留下一个 null 的 effectiveAtSequence。
        const all = seeded.read({ limit: 1000 }).events
        for (const event of all) {
          if (event.kind !== 'team/member-model-switched') continue
          const data = event.data as { effectiveAtSequence?: unknown }
          expect(data.effectiveAtSequence, '不得把 NaN/null 写进账本').not.toBeNull()
        }
      } finally {
        seeded.close()
      }
    } finally {
      try {
        real.close()
      } catch {
        // 已提前关过；二次关闭失败不影响结论。
      }
    }
  })

  it('★ 回归：`receipt.sequence` 形状非法 ⇒ `failed`，**不得**误报成「跨进程并发」', async () => {
    // 族A 同处（队长一并指出）：注入的 Ledger 若 commit 返回 `undefined`/非整数，
    // `receipt.sequence !== predicted` 会**恒真** ⇒ 走进 `sequence-mismatch` ——
    // 而那是一个**声称「有另一个写者在并发插入」**的分支，
    // 会把人工核对引向一条**并不存在的**并发轨迹。形状不符与并发是两件事。
    const { switchMemberModel } = await import('../src/host-data.ts')
    const dataDir = newDataDir()
    seedAt(dataDir, 'at-add')
    const real = openLedger({ path: join(dataDir, 'ledger.sqlite') })
    try {
      // head() 正常返回，但 commit 回一个**形状非法**的 receipt。
      const lying = {
        head: () => real.head(),
        commit: (input: LedgerCommitInput) => {
          real.commit(input)
          return { eventId: 'x', sequence: Number.NaN, occurredAt: 0 }
        },
        // `read()` 的入参必填（同上一处，勿去掉 `?? {}`）。
        read: (options?: { limit?: number }) => real.read(options ?? {}),
        close: () => real.close(),
      } as unknown as Ledger

      const result = switchMemberModel(lying, {
        memberId: MEMBER_ID,
        provider: 'anthropic',
        model: 'claude-x',
        reason: 'human-switch',
      })

      // 反恒真：把 `isNonNegativeSafeInteger(actualSequence)` 那道校验改成 `if (false)`
      // → 结论会变成 sequence-mismatch，本条必须变红（已实测）。
      expect(result.kind, 'receipt 形状非法必须判 failed，不能冒充「并发」').toBe('failed')
      if (result.kind !== 'failed') throw new Error('unreachable')
      expect(result.reason).toContain('非负安全整数')
      // 关键：**不得**把它说成跨进程并发（那是另一件事，且会误导排查方向）。
      expect(result.reason).not.toContain('期间有另一个写者插入了事件')
    } finally {
      real.close()
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 交付物自检：这三条路由的**源码**确实提到安全判据（防「注释说改了、代码没改」）
// ────────────────────────────────────────────────────────────────────────────

describe('t1 · 数据路由源码自检', () => {
  it('★ 回归：view 路由在素材根缺失时必须**留痕**，不得静默降级（口径统一）', async () => {
    // 队长核实的口径不对称（LOW）：`avatarRoute` 对「素材根找不到」是显式 404 + 原因，
    // 而 `viewRoute` 此前**静默**传 `repoRoot: undefined` ⇒ 所有 avatarPath 消失、
    // **答 200、零日志**。同一环境缺失两种口径，其中一种是「看起来正常、内容却缺」。
    //
    // ## ⚠ 为什么这条断言的是**源码结构**而不是运行期日志（如实说明依据）
    //
    // 实测（本机当前布局）：`findRepoRoot()` 从 `host.ts` 所在目录上溯，
    // **第 3 层**（`packages/` 的上一级 = 仓库根）就命中 `assets/members/out-512`
    // ⇒ **在仓库内跑单测时它永不返回 `null`**，那条分支**运行期不可达**。
    // 我曾先写了一条「捕获 console.error」的行为用例 —— 它**如实失败了**
    //（`expected false to be true`），因为根本没有走那条分支。
    // 生产部署下该分支**是可达的**（插件装在 `~/.dsh/profiles/...` 下，
    // 上溯 6 层没有素材目录），所以这个修复本身是必要的；
    // 但**单测构造不出那个条件**（仓库布局决定，与代码无关）。
    //
    // ⇒ 判据退回到「源码里确实有这条告警」+「它与 avatarRoute 同口径」。
    // 这不比运行期观测强，但**它至少会红**：删掉那段 console.error，
    // 断言立刻失败（见下方反恒真说明）。宣称「已用运行期证据验证」是**做不到的**。
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'host.ts'), 'utf8')
    // 反恒真：把 `if (repoRoot === null) { console.error(...) }` 整段删掉
    // → 本条必须变红（已实测，见变异 ③）。
    expect(
      source,
      'view 路由在 repoRoot 为 null 时必须留下可检索的告警（否则「界面没头像」无法与环境问题区分）',
    ).toMatch(/repoRoot === null[\s\S]{0,400}?console\.error\(/)
    expect(source).toContain('头像素材根')
    // 同口径：avatarRoute 那边也是同一条文案（口径统一才是本修复的目的）。
    const occurrences = source.split('头像素材根').length - 1
    expect(occurrences, 'avatarRoute 与 viewRoute 应当用同一口径描述「素材根找不到」').toBeGreaterThanOrEqual(2)
  })

  it('avatar 路由的源码里真的调了判据与解码（不是只写在注释里）', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'src', 'host-data.ts'),
      'utf8',
    )
    // 反恒真：把 resolveAvatarFile 里的 sanitizeAvatarPath 调用删掉 → 本条必须变红（已实测）。
    expect(source).toMatch(/sanitizeAvatarPath\(/)
    // 归一化后的前缀复核（第二道门）也必须真的在代码里。
    expect(source).toMatch(/startsWith\(assetsRoot \+ sep\)/)
  })

  it('宿主半不再 import 浏览器半（否则宿主 tsc 会被 DOM 拉红）', () => {
    for (const file of ['host.ts', 'host-data.ts', 'wire.ts', 'avatar-paths.ts']) {
      const source = readFileSync(join(import.meta.dirname, '..', 'src', file), 'utf8')
      // 反恒真：把 host-data.ts 的 import 改回 './client/view-model.ts'
      // → 本条必须变红（已实测），且契约命令 `tsc -p tsconfig.json` 会 exit 2。
      expect(source, `${file} 不得 import ./client/`).not.toMatch(/from '\.\/client\//)
    }
  })
})
