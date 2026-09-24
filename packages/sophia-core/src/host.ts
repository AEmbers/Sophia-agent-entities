/**
 * `@sophia/core/host` —— 插件宿主半入口（注册为 `@sophia/core/host` 行）。
 *
 * 本任务（t1 · 插件外壳）只交付**能被 DSH 加载**的最小合法 Cordis Plugin：
 * 一个可观测、可逆、失败不拖垮 loader 的宿主半边。真正的成员运行时（t2）、
 * 视图投影（t3）、工具集（t4）、常驻调度体（t6）在此之上挂载。
 *
 * ── 设计约束（每条都是实测得出的，不是偏好）──
 *
 * 1. **不 import `@deepseek-ai/*`**（SPEC §1.1）：本机 DSH SDK 安装
 *    （`~/.dsh/core-0.1.5-rc.1/@deepseek-ai`，243 个包）递归含 **0 个 `.d.ts`**，
 *    直接 `import type { Context } from '@deepseek-ai/cordis'` 会 TS7016 且 exit 2。
 *    因此这里的 ctx 用**结构化类型**描述，只声明本文件真正用到的三个成员。
 *
 * 2. **`inject` 声明为空，服务用 `ctx.get()` 惰性探测**。cordis 实测语义
 *    （`cordis/lib/index.js`）：访问**未声明**的服务属性会抛
 *    `cannot get property "x" without inject`，而 `ctx.get(name)` 是显式允许的
 *    读取路径（dsh-client-modules 自己就这么用：`ctx.get("webServer")`）。
 *    把 `webServer` 写进 `inject` 会让「服务没到」变成**插件不加载**（静默无功能）；
 *    惰性探测则是「先降级，服务到齐再挂上」。
 *
 * 3. **apply 整体 try/catch**：文件插件是「一行失败、整棵树报错」。
 *    本插件不可用是可接受的降级，拖垮别的插件不是。
 *
 * 4. **每个副作用都走 `ctx.effect`**：stop / update / undefine 时能完整回收。
 *    迟到挂载（服务在 apply 之后才到齐）走的也是这两块 effect ——
 *    它们各自持有 `detachers`（数组，本任务扩到 4 条路由）/ `detachSection`，
 *    所以事件里补挂的路由与公告同样随 fiber 回收。**实测**：apply 时无服务 →
 *    迟到事件补挂 → 跑两个 effect 的 disposer → 路由数回到 0
 *    （见 `tests/shell.spec.ts` 与 `tests/host-routes.spec.ts`）。
 *    （OCR 复核 [10] 认为迟到路径「绕过了 ctx.effect」；实测可逆性成立，
 *    故不改结构，只把结论记在这里 —— 后续加挂载点时，
 *    新副作用仍应挂进这两块 effect 的持有变量里。）
 *
 * @module @sophia/core/host
 */

import { mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  addMember,
  buildWireView,
  createChannel,
  destroyTeam,
  parseDestroyTeamRequest,
  memberLifecycleAction,
  parseAddMemberRequest,
  parseCreateChannelRequest,
  parseLifecycleActionRequest,
  parseSendTeamMessageRequest,
  parseSpawnDecisionRequest,
  parseSwitchModelRequest,
  parseTransferOwnershipRequest,
  readAvatarBytes,
  resolveAvatarFile,
  sendTeamMessage,
  switchMemberModel,
  transferDagOwnership,
} from './host-data.ts'
import { openLedger, type Ledger } from './ledger.ts'
import {
  asDefineTool,
  asToolsRegistry,
  resolveDefineTool,
  toDefineToolOptions,
  type SophiaDefineTool,
  type SophiaToolsRegistry,
} from './host-tools.ts'
import {
  assembleSophiaToolsDeps,
  ensureRootTeam,
  createDefaultMemberRuntime,
  createDelegationDeps,
} from './host-assembly.ts'
import { decideSpawnTicket, spawnTicketIdOf } from './delegation.ts'
import type { RequestId } from './types/index.ts'
import { createSophiaTools } from './tools/index.ts'
import type { SophiaToolCaller } from './tools/types.ts'
import type { MemberRuntime, MemberRuntimeDeps } from './runtime/member-runtime.ts'
import { createHostAgentDeps, SOPHIA_MEMBER_PRESET_ID } from './runtime/host-agent-deps.ts'

/** 插件名（DSH loader 行诊断标签）。 */
export const name = 'sophia'

/**
 * 硬依赖服务：空。
 * 理由见文件头第 2 条 —— 本半在服务缺失时必须能加载并降级。
 */
export const inject: readonly string[] = []

/** 本插件挂在本机回环上的路由前缀。 */
const ROUTE_PREFIX = '/api/sophia'

/**
 * webserver 服务在 `ctx.get()` 里的**候选键**（新键优先、旧键回退）。
 *
 * 为什么不能硬绑 `'webServer'` 一个键（OCR 复核 [2]/[3] 抓到的真实缺陷）：
 * 本仓 `dsh-agent-teams/docs/developing-dsh-plugins.md:157` 逐字记载 ——
 * npm `latest`（`0.0.1-rc.1`）的键是 `httpServer`（`HttpServerService`），
 * `next`（`rc.2`）重命名为 `webServer`（`WebServer`），并明确要求
 * 「过渡期不要硬绑定单一键名：`ctx.get('webServer') ?? ctx.get('httpServer')`
 * （新键优先、旧键回退），`internal/service` 事件同时监听两组键再补注册」。
 *
 * 参照实现 `dsh-agent-teams/src/index.ts:49` 的 `WEB_SERVER_KEYS` 用的是同一形状
 * （该文件 206 行读服务、479 行判事件名）。硬绑单键的后果是**静默无功能**：
 * 路由注册不上，而 apply 里没有任何异常 —— 症状看起来像「路由没注册」。
 */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'] as const

/** `WEB_SERVER_KEYS` 的键联合类型（事件名收窄用，见 `internal/service` 监听处）。 */
type TWebServerKey = (typeof WEB_SERVER_KEYS)[number]

/**
 * 工具提示词段在提示词带里的次序。
 *
 * ⚠ 这不是「随便取个靠后的数」（OCR 复核 [6]）。取值依据：
 * 上游参照实现 `dsh-agent-teams/src/index.ts:133` 的 `promptSectionOrder`
 * 默认值是 **117**（它的注释：`default 117, after delegation policy`）。
 * 本插件排在它之后，取 151，留出中间空档给别的插件插队。
 * 本机已装插件里没有别家注册 `systemPrompt.section`（实测扫过
 * `profiles/desktop/plugins/` 下各插件的 lib 入口，无 `order:` 命中），
 * 所以不存在与它们撞序的现成风险。
 */
const SECTION_ORDER = 151

/** 面向模型的公告：本插件是什么、能做什么、边界在哪。 */
const GUIDANCE =
  '本机已安装 Sophia-agent-entities 插件（DSH 的多 Agent 团队实体库）：'
  + '团队以 teamId 为锚点、是独立持久实体，窗口会话只是传旨入口（不绑团），'
  + '因此窗口关掉不影响团队存续。'
  + '当前处于外壳阶段：宿主半已加载并暴露只读自检路由 '
  + `${ROUTE_PREFIX}/status；成员运行时、Agent 工具集与前端 UI 随后续任务挂载。`
  + '用户提到「索菲亚 / Sophia / 持久团队 / 团队实体」时即指本插件。'

/**
 * 宿主上下文里本文件用到的最小面。
 *
 * 结构化声明而非 import 官方类型：见文件头第 1 条（SDK 无 `.d.ts`）。
 * 只声明真正调用的三个成员，避免把「我猜的 API」写成契约。
 */
interface SophiaHostContext {
  /** 可选工具服务属性（ctx.<prop> 访问方式）。 */
  tools?: unknown
  /** 可选 webServer 服务属性。 */
  webServer?: unknown
  /** 可选 httpServer 服务属性。 */
  httpServer?: unknown
  /** 可选 systemPrompt 服务属性。 */
  systemPrompt?: unknown
  /** 可选 defineTool 导出。 */
  defineTool?: unknown
  /** 读取一个可选服务；未提供时返回 undefined（实测允许，无需先 inject）。 */
  get(name: string): unknown
  /** 注册一个随 fiber 生命周期的副作用；返回值被忽略（fiber 自己持有 disposer）。 */
  effect(execute: () => void | (() => void), label?: string): unknown
  /** 订阅事件；随 fiber 自动解绑。 */
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** 宿主装配可选配置（便于集成测试与依赖覆盖）。 */
export interface SophiaHostOptions {
  readonly defineTool?: SophiaDefineTool | undefined
  readonly ledger?: Ledger | undefined
  readonly caller?: SophiaToolCaller | undefined
  readonly runtimeDeps?: Partial<MemberRuntimeDeps> | undefined
}

/** 兼容获取服务（支持 ctx.<prop> 与 ctx.get() 两种路径）。 */
function getService(ctx: SophiaHostContext, name: string): unknown {
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name]
    if (direct !== undefined) return direct
  } catch {
    // 忽略直接访问未声明属性时可能的抛错（Cordis 特性）
  }
  return ctx.get(name)
}

/** 本机 webserver 服务里本文件用到的注册面（形状取自本机在跑的 dsh-postman / dsh-agy-art）。 */
interface SophiaWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: unknown, res: SophiaResponse) => void | Promise<void>
  }): () => void
}

/** Node `http.ServerResponse` 的最小面。 */
interface SophiaResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  /** 头像路由要发**字节**，不能只发字符串（PNG 走 Buffer）。 */
  end(body?: string | Uint8Array): void
}

/**
 * `connection` 服务的鉴权面（参照实现 `dsh-agent-teams/src/web-routes.ts:71`）。
 *
 * 返回值语义（逐字取自参照实现 `:83-91`）：
 * - `undefined` ⇒ 放行；
 * - `503` ⇒ 服务缺失/正在销毁（**装配失败，不是放行理由**）；
 * - `401` / `403` ⇒ 拒绝。
 */
interface BrowserRequestGate {
  requestRejection(req: unknown): number | undefined
}

/** 请求对象里本文件用到的面（读 body 需要 `on`）。 */
interface SophiaRequest {
  url?: unknown
  method?: unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

/** systemPrompt 服务的最小面。 */
interface SophiaSystemPrompt {
  section(section: { name: string; order: number; text: string }): () => void
}

/** 结构化守卫：把 `ctx.get()` 的 `unknown` 收窄成可用的 webserver 面。 */
function asWebServer(value: unknown): SophiaWebServer | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { register?: unknown }
  return typeof candidate.register === 'function' ? (value as SophiaWebServer) : undefined
}

/** 结构化守卫：把 `ctx.get()` 的 `unknown` 收窄成可用的 systemPrompt 面。 */
function asSystemPrompt(value: unknown): SophiaSystemPrompt | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { section?: unknown }
  return typeof candidate.section === 'function' ? (value as SophiaSystemPrompt) : undefined
}

/** 统一的 JSON 响应写法。 */
function writeJson(res: SophiaResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/** 本插件的数据目录（可被 `SOPHIA_DATA_DIR` 覆盖，便于测试与多实例隔离）。 */
function sophiaDataDir(): string {
  const override = process.env['SOPHIA_DATA_DIR']
  if (typeof override === 'string' && override.trim() !== '') return override
  // 与在跑的 dsh-postman 同形（`lib/index.js:61-62` 用 `DSH_HOME ?? ~/.dsh`，再挂子目录）。
  return join(process.env['DSH_HOME'] ?? join(homedir(), '.dsh'), 'sophia')
}

/** 账本文件路径。 */
function sophiaLedgerPath(): string {
  return join(sophiaDataDir(), 'ledger.sqlite')
}

/** 结构化守卫：把 `ctx.get('connection')` 的 `unknown` 收窄成鉴权面。 */
function asRequestGate(value: unknown): BrowserRequestGate | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { requestRejection?: unknown }
  return typeof candidate.requestRejection === 'function' ? (value as BrowserRequestGate) : undefined
}

/**
 * 数据路由的身份门（照抄参照实现 `dsh-agent-teams/src/web-routes.ts:71-95` 的语义）。
 *
 * @param req - 请求对象。
 * @param connectionOf - **每次调用时**再取一次 `connection`（不能在注册时取一次就固定 ——
 *   服务可能后到，注册时拿到的 `undefined` 会变成永久 503）。
 * @returns `undefined` = 放行；数字 = 应当直接回的状态码。
 *
 * ⚠ 缺服务判 **503（不可用）而不是放行**：这是参照实现的原文口径
 * （「Missing/disposing Connection is an assembly failure, never an invitation to
 * expose workspace state」）。把它写成「读不到就放行」正是那类恒真式的防护。
 */
function gateRejection(req: unknown, connectionOf: () => unknown): number | undefined {
  const gate = asRequestGate(connectionOf())
  return gate === undefined ? 503 : gate.requestRejection(req)
}

/**
 * 把 `connection` 门的拒绝结果写成响应。
 *
 * @returns 是否已拒绝（true ⇒ 调用方必须立即返回）。
 */
function rejectIfUnauthorized(req: unknown, res: SophiaResponse, connectionOf: () => unknown): boolean {
  const rejection = gateRejection(req, connectionOf)
  if (rejection === undefined) return false
  // 状态码 → 文案的映射逐字取自参照实现 `:89-90`（外部接口的措辞不自行发明）。
  const errorText = rejection === 503 ? 'authentication unavailable'
    : rejection === 401 ? 'unauthorized' : 'forbidden'
  writeJson(res, rejection, { ok: false, error: errorText })
  return true
}

/**
 * 解析仓库根：头像素材 `assets/members/out-512/` 在仓库里，不在 `lib/` 旁边。
 *
 * 做**向上查找**而不是写死 `../../..`：本包在开发态是 workspace 包
 * （`packages/sophia-core/lib/host.js` → 上溯 3 层到仓库根），安装进 profile 后
 * 层级又会变。查找「哪一层有 `assets/members/out-512/`」在两种布局下都对，
 * 而写死相对层级只对其中一种对 —— 且另一种下是**静默失效**（头像全 404）。
 *
 * @returns 仓库根绝对路径；找不到返回 `null`。
 */
function findRepoRoot(): string | null {
  const override = process.env['SOPHIA_REPO_ROOT']
  if (typeof override === 'string' && override.trim() !== '') return override
  let dir = fileURLToPath(new URL('.', import.meta.url))
  // 上溯有限层（防止在异常布局下无限爬）；命中 `assets/members/out-512` 即停。
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      if (statSync(join(dir, 'assets', 'members', 'out-512')).isDirectory()) return dir
    } catch {
      // 这一层没有素材目录，继续上溯。
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * 读 body 的结果。
 *
 * ⚠ 为什么是判别式联合而不是「失败时 resolve 一个 string」（OCR 复核 LOW [31]）：
 * 初版用 `resolve('原因')` 表示失败、`resolve({...})` 表示成功，
 * 调用方靠 `typeof payload === 'string'` 区分 —— 而一个**合法**的 JSON
 * 字符串 body（如 `"abc"`）解出来**也是** string，于是它会被当成错误消息，
 * 且那条「错误消息」就是 body 自己的内容。两条通道（数据 / 错误）必须分开。
 */
type BodyReadResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string }

/** 读取并解析 JSON 请求体。 */
function readJsonBody(req: unknown, limitBytes = 64 * 1024): Promise<BodyReadResult> {
  return new Promise((resolve) => {
    if (typeof req !== 'object' || req === null) {
      resolve({ ok: false, reason: '请求对象不可读' })
      return
    }
    const carrier = req as SophiaRequest
    if (typeof carrier.on !== 'function') {
      resolve({ ok: false, reason: '请求对象不支持流式读取（on 缺失）' })
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    /** 只结算一次（`data` 早退与 `end` 都可能触发）。 */
    const settle = (result: BodyReadResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    carrier.on('data', (chunk: unknown) => {
      // 超限就**立即结算并断开**（OCR 复核 MEDIUM [12]）：初版只清空 chunks、
      // 继续等 `end` —— 而一个只发不结束的客户端会让这个 promise **永久挂起**，
      // 同时每个 chunk 仍在被分配与转换（内存与句柄都被拖住）。
      if (settled) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      size += buf.length
      if (size > limitBytes) {
        chunks.length = 0
        // `destroy` 是尽力而为：拿不到它也不影响「立刻回 400」，只是少一次主动断开。
        const destroy = (carrier as { destroy?: unknown }).destroy
        if (typeof destroy === 'function') {
          try {
            ;(destroy as () => void).call(carrier)
          } catch {
            // 断开失败不该盖住「超限」这个真正的结论。
          }
        }
        settle({ ok: false, reason: `body 超过上限 ${String(limitBytes)} 字节` })
        return
      }
      chunks.push(buf)
    })
    carrier.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim()
      if (raw === '') {
        // 空 body 按参照实现 `:60` 处理成 `{}`，于是后续字段校验给出「缺哪个字段」，
        // 而不是先报一个和字段无关的 JSON 语法错。
        settle({ ok: true, value: {} })
        return
      }
      try {
        settle({ ok: true, value: JSON.parse(raw) })
      } catch {
        settle({ ok: false, reason: 'body 不是合法 JSON' })
      }
    })
    carrier.on('error', () => {
      settle({ ok: false, reason: '读取 body 失败' })
    })
  })
}

/** 从请求 URL 里取查询参数（`pathname` 只管路由匹配，查询串要自己解析）。 */
function queryParam(req: unknown, key: string): string | null {
  if (typeof req !== 'object' || req === null) return null
  const raw = (req as { url?: unknown }).url
  if (typeof raw !== 'string') return null
  try {
    // 基地址随便给：只需要 `searchParams` 的解析（含百分号解码）能力。
    return new URL(raw, 'http://localhost').searchParams.get(key)
  } catch {
    return null
  }
}

/**
 * 判断请求是否来自回环（OCR 复核 [1] 的修复点）。
 *
 * 为什么要有它：「只绑回环」是**宿主的配置事实**，不是本路由的保证 ——
 * `dsh-host-webserver/lib/index.js:141` 的配置允许 `127.0.0.1` 或 `0.0.0.0`。
 * 把判定写进 handler 里，这句话才从注释变成代码事实。
 *
 * 取值来源优先用 `req.socket.remoteAddress`（Node 直接给的原生字段）；
 * 没有 socket 时退回 `req.connection`（老字段名）。两者都拿不到就**保守拒绝**
 * —— 与仓库既有口径一致：读不到就判不可用，而不是当成通过。
 * 说明：本插件不做反代部署，`x-forwarded-for` 这类头**不可信、因此不读**
 * （只按 TCP 对端地址判定，伪造头无法绕过）。
 *
 * ⚠ 已知盲区，别把本门当鉴权用（OCR 复核 [4]）：
 * 只按 TCP 对端判定 ⇒ **反向代理 / 隧道终结在本机**时，代理由 `127.0.0.1` 连进来，
 * `remoteAddress` 就是回环，外部调用方经由该代理即可通过本门。
 * 所以本门挡住的是「直连的非回环来源」（最常见的那类），**不是**「一切外部可达」。
 * t2–t4 的数据路由不得以本门替代 `connection` 鉴权（那才是身份门）。
 */
function isLoopbackRequest(req: unknown): boolean {
  if (typeof req !== 'object' || req === null) return false
  const carrier = req as {
    socket?: { remoteAddress?: unknown }
    connection?: { remoteAddress?: unknown }
  }
  const address = carrier.socket?.remoteAddress ?? carrier.connection?.remoteAddress
  if (typeof address !== 'string') return false
  // IPv4 / IPv6 回环及其 IPv4-mapped 形式。
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1'
}

/**
 * 挂载宿主面：只读自检路由 + 面向模型的公告。
 *
 * @param ctx - 宿主插件上下文（结构化类型，见 `SophiaHostContext`）。
 */
export function apply(ctx: SophiaHostContext, options?: SophiaHostOptions): void {
  try {
    // ── 1. 只读自检路由：证明「外壳真的挂上了」，而不是「工具调用没报错」──
    //    实测踩坑（本机 dsh-agy-art 的 /toolstatus 就是为这个加的）：
    //    注册失败时若只看「有没有抛异常」，会把静默失败读成成功。
    //    ⚠ 判据是 `registered` 布尔量（「register 没抛即成功」），
    //    **不是** disposer 的形状 —— 后者会被「注册成功但返回非函数」这条路径骗过。
    //    （此处曾写成「用 disposer 是不是函数判定」，与实现相反，已按 OCR [7] 改正。）
    let registered = false
    /**
     * 全部路由的 disposer（本任务新增数据路由后从 1 条变 4 条）。
     *
     * 为什么是数组而不是单个变量：可逆性是文件头的硬承诺
     * （「停用 fiber ⇒ 路由数回到 0」），而 4 条路由**必须一起收** ——
     * 只收第一条会让另外三条泄漏到 fiber 之外，且泄漏是静默的
     * （宿主还能继续服务它们）。
     *
     * ⚠ 这里曾经还有一个 `let detach` 单路由残留变量（OCR 复核 LOW [28] 抓到）：
     * 路由改多之后它**只被声明、从不被读写**。死变量比没有更糟 ——
     * 读者会以为「单条路由的 disposer 还在用」。已删。
     */
    let detachers: Array<() => void> = []
    /**
     * 已打开的账本句柄。
     *
     * **懒开**（第一次真正读数据时才开），理由是启动路径：`openLedger` 会
     * `new DatabaseSync`（建文件 + 建表 + 建触发器）。若在 apply 里就开，
     * 「数据目录不可写」这类环境问题会变成**插件加载失败** ——
     * 而外壳（`/status`、提示词段）本该与账本可用性无关。
     * 懒开让「外壳照常挂上、数据路由答 503」成为可能。
     */
    let ledger: Ledger | undefined
    /** 一次失败的打开尝试只记一条日志（否则每次请求都刷一条）。 */
    let ledgerFailureLogged = false

    /**
     * 取账本；不可用时返回 `undefined` 并**只记一次**日志。
     *
     * @returns 已打开的账本，或 `undefined`。
     */
    const ledgerOf = (): Ledger | undefined => {
      if (ledger !== undefined) return ledger
      if (options?.ledger !== undefined) {
        ledger = options.ledger
        return ledger
      }
      try {
        // 建数据目录（`new DatabaseSync` 不建中间目录，`~\.dsh\sophia\` 不存在时
        // 首次打开必抛 ⇒ 整条工具注册链卡在 ledgerOk=false，2026-09-24 线上实测）。
        mkdirSync(sophiaDataDir(), { recursive: true })
        ledger = openLedger({ path: sophiaLedgerPath() })
        // 自举（幂等，只在本进程首次打开账本时走一次）：账本为空时写入
        // 「索菲亚根团 + 她本人」—— 派生链的第一推动力。没有它，
        // `sophia_spawn_team` 会因为认不出装配身份而永远拒绝发起（详见
        // host-assembly.ts `ensureRootTeam` 的文档与 2026-09-24 线上实测）。
        try {
          ensureRootTeam(ledger)
        } catch (error) {
          // 自举失败**不该**让账本本身不可用（外层 catch 会把 ledger 置为
          // undefined ⇒ 所有数据路由 503）。这里降级：账本照常可用、面板
          // 显示空态，原因记日志而不是静默。
          console.error('[sophia] 根团自举失败（面板将显示空态）:', error)
        }
        return ledger
      } catch (error) {
        mountProbe.ledgerError = String(error)
        if (!ledgerFailureLogged) {
          ledgerFailureLogged = true
          console.error('[sophia] 打不开账本；数据路由将回 503:', error)
        }
        return undefined
      }
    }
    /**
     * 上一次「所有候选键都试过且都抛错」时的那个服务对象。
     *
     * 为什么需要它（数象主事 转交的 MEDIUM，已实测复现）：
     * 若某个键形状合法但 `register()` 抛错（真实 webserver 对重复 (kind,path)
     * 就是直接 throw —— `dsh-host-webserver/lib/index.js:178`），
     * `registered` 保持 false ⇒ **之后每个** `internal/service` 事件都会重进
     * mountRoute()、再抛一次、再写一条日志（实测：3 次事件 → 3 次抛错）。
     * 同一个对象不重复试；换了一个新对象则允许再试一次
     * （可能是新换上的健康服务，那种情况下应当能挂上）。
     */
    let lastFailedServer: SophiaWebServer | undefined

    // ── 成员运行时与工具集状态（用于 /status 路由真实能力回报）──
    let registeredTools = false
    let runtime: MemberRuntime | undefined
    // 诊断探针（2026-09-24）：tryMountTools 链上有 4 个静默分支，线上 tools:false
    // 无法定位死点。把每步结果记在这里、经 /status 报出，一次重启即可定位。
    const mountProbe: Record<string, unknown> = {}

    const runtimeOf = (): MemberRuntime | undefined => {
      if (runtime !== undefined) return runtime
      const activeLedger = ledgerOf()
      if (activeLedger === undefined) return undefined
      // ⚠ 合并次序**有意**：真 agent 底座在前、`options.runtimeDeps` 在后（后者胜）。
      // 这样测试可以整段替换掉底座（`createHandle` 返回一个假 agent），
      // 而产品路径拿到的是真身。反过来写会让测试**改不动**它，于是测试只能
      // 去断言"桩被调用过"——那证明不了任何事。
      runtime = createDefaultMemberRuntime(activeLedger, {
        ...createHostAgentDeps({
          ctx: ctx as unknown as { get(name: string): unknown },
          dataDir: sophiaDataDir(),
          ledger: activeLedger,
        }),
        ...options?.runtimeDeps,
      })
      return runtime
    }

    /**
     * 全部路由（顺序有意义：`/status` 必须**第一个** —— `tests/shell.spec.ts`
     * 用 `routes[0].path` 钉住「外壳挂上了」这条断言）。
     *
     * 鉴权分两层，两层都要（见 `isLoopbackRequest` 的说明）：
     * 1. **回环门**：挡掉直连的非回环来源（本机现状兜底，不是身份门）；
     * 2. **`connection` 门**：真正的身份门（`web-routes.ts:71` 的语义）。
     * `/status` 只有第 1 层（响应里没有任何可变状态，且它是「插件活着吗」的自检，
     * 不该因为 connection 未就绪就说自己不在）；三条**数据路由**两层都要。
     */
    const buildRoutes = (): ReadonlyArray<{
      kind: 'exact'
      path: string
      handler: (req: unknown, res: SophiaResponse) => void | Promise<void>
    }> => {
      /** 数据路由共用的前两道门。返回 true 表示已拒绝、调用方必须立即返回。 */
      const guard = (req: unknown, res: SophiaResponse): boolean => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { ok: false, error: 'loopback only' })
          return true
        }
        return rejectIfUnauthorized(req, res, () => getService(ctx, 'connection'))
      }

      const statusRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/status`,
        handler: (req: unknown, res: SophiaResponse): void => {
          // 回环门（OCR 复核 [1]）：`dsh-host-webserver` 的绑定地址由宿主配置决定
          // （`lib/index.js:141` 允许 `127.0.0.1` **或 `0.0.0.0`**），所以「只绑回环」
          // 是本机现状、不是代码保证。这里把「只服务回环请求」变成**代码事实**：
          // 非回环来源一律 403，不进入业务分支。
          // ⚠ 这不替代数据路由需要的鉴权（那是 `connection` 门的职责，
          //    参照实现 `dsh-agent-teams/src/index.ts:209`）；它是**额外**的一道，
          //    让本文件与数据路由抄这条形状时默认就不会对外裸奔。
          if (!isLoopbackRequest(req)) {
            writeJson(res, 403, { ok: false, error: 'loopback only' })
            return
          }
          writeJson(res, 200, {
            ok: true,
            plugin: name,
            phase: 'shell',
            route: `${ROUTE_PREFIX}/status`,
            // 如实回报：工具与运行时真实就绪状态（注册成功才 true，不谎报）
            surfaces: {
              host: true,
              client: 'skeleton',
              tools: registeredTools,
              runtime: registeredTools && runtime !== undefined,
            },
            probe: mountProbe,
          })
        },
      }

      // ── 数据路由 1/3：`GET /api/sophia/view` ──
      // 客户端契约：`src/client/panel-store.ts` 的 `VIEW_ROUTE`，GET + accept:json。
      const viewRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/view`,
        handler: (req: unknown, res: SophiaResponse): void => {
          if (guard(req, res)) return
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          // ⚠ 走 `rebuildFold`（**不带 scopes**）。`team/thread-started` 的
          // changeScope 是 `[]` ⇒ 任何带 scopes 的增量读取都看不见线程，
          // 而 `coverage.scoped=false` 会把这件事如实告诉界面。
          const repoRoot = findRepoRoot()
          // ⚠ 环境缺失必须**留痕**（队长核实的口径不对称，LOW，已统一）：
          // 此前这里**静默**传 `repoRoot: undefined` ⇒ 所有 `avatarPath` 消失、答 200、
          // **零日志**，而同一件「素材根找不到」在 `avatarRoute` 里是显式的 404 + 原因。
          // 同一环境缺失两种口径，其中一种是「看起来正常、内容却缺」
          //（`src/host-data.ts` 的 `onAvatarScanFailure` 注释把这类失效模式点得很清楚）。
          // 这里**不改状态码**（视图本身仍然有效，只是头像退化）——只补一条可检索的日志，
          // 让「界面没头像」能从日志区分出「是环境问题」而不是「素材本来就没有」。
          if (repoRoot === null) {
            console.error(
              '[sophia] 找不到头像素材根（assets/members/out-512）——'
                + '本次 /view 的所有 avatarPath 会缺失（界面退回首字头像），视图其余字段不受影响。'
                + '可用 SOPHIA_REPO_ROOT 显式指定仓库根。',
            )
          }
          writeJson(res, 200, buildWireView(active, {
            repoRoot: repoRoot ?? undefined,
            // 素材扫不动时留痕（见 `createAvatarPathResolver`）：
            // 「素材目录没了」与「这个职位没头像」在界面上长得一样，
            // 只有日志能区分 —— 所以这里必须把它接上，不能让它静默。
            onAvatarScanFailure: (error: unknown) => {
              console.error('[sophia] 扫头像素材失败（界面会退回首字头像）:', error)
            },
          }))
        },
      }

      // ── 数据路由 2/3：`GET /api/sophia/avatar?path=` ──
      // 客户端契约：`src/client/avatar.ts` 的 `AVATAR_ROUTE`（它用 `encodeURIComponent`
      // 编码整条相对路径）。⚠ 编码**不提供任何安全性** —— 判据全在本侧，见下方注释。
      const avatarRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/avatar`,
        handler: (req: unknown, res: SophiaResponse): void => {
          if (guard(req, res)) return

          const repoRoot = findRepoRoot()
          if (repoRoot === null) {
            writeJson(res, 404, { ok: false, error: '头像素材根未找到（assets/members/out-512）' })
            return
          }
          const raw = queryParam(req, 'path')
          if (raw === null) {
            writeJson(res, 400, { ok: false, error: '缺少 path 查询参数' })
            return
          }
          // ⚠⚠ 顺序是**先解码、后判据**，不能反过来。
          // 为什么必须**再解一次**：`URL.searchParams.get()` 自己已经解过一次百分号编码，
          // 于是攻击者可以把 `../` 写成**双层编码** `%252e%252e%252f` ——
          // 第一层解出 `%2e%2e%2f`（它看着像普通文件名，能骗过只解一次的判据），
          // 第二层才现出 `../`。任务书点名的三种绕过（`%2e%2e%2f` / `..%2f` / `%252e%252e%2f`）
          // 在「解到底、再判」的顺序下全部落到同一个判据上。
          // 代价如实记：文件名里若真的含 `%`，这里会多解一层而 404（素材名都是中文职位名，
          // 不存在这种文件）—— 用「可能少一张头像」换「不可能越界读任意文件」，值得。
          let decoded: string
          try {
            decoded = decodeURIComponent(raw)
          } catch {
            writeJson(res, 400, { ok: false, error: 'path 不是合法的百分号编码' })
            return
          }
          const resolved = resolveAvatarFile(repoRoot, decoded)
          if (resolved.kind === 'rejected') {
            writeJson(res, 400, { ok: false, error: resolved.reason })
            return
          }
          if (resolved.kind === 'missing') {
            writeJson(res, 404, { ok: false, error: resolved.reason })
            return
          }
          const bytes = readAvatarBytes(resolved.absolutePath)
          if (bytes === null) {
            writeJson(res, 404, { ok: false, error: '读取素材失败' })
            return
          }
          res.writeHead(200, {
            'content-type': 'image/png',
            // 素材是**内容不变**的静态文件 ⇒ 允许缓存（头像每帧都要拿，不缓存会很吵）。
            'cache-control': 'public, max-age=3600',
            'content-length': String(bytes.length),
          })
          res.end(bytes)
        },
      }

      // ── 数据路由 3/3：`POST /api/sophia/member/model` ──
      // 客户端契约：`src/client/panel-store.ts` 的 `requestModelSwitch`
      // （POST + content-type:json，body `{memberId, provider, model, reason}`）。
      const modelRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/member/model`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          const method = (req as { method?: unknown }).method
          if (method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseSwitchModelRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const result = switchMemberModel(active, parsed)
          switch (result.kind) {
            case 'ok':
              writeJson(res, 200, { ok: true, sequence: result.sequence })
              return
            case 'unknown-member':
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            case 'unknown-current-model':
            case 'no-change':
              // 409（冲突）：请求本身合法，但账本当前状态接不下这次换模。
              writeJson(res, 409, { ok: false, error: result.reason })
              return
            case 'sequence-mismatch':
              // 事件**已写入**（不可撤销），只是序号与预测不符 ⇒ 回 200 但带
              // `ok:false` 与显式标记，让界面能如实提示「已生效、但审计序号异常」，
              // **不**把它伪装成可重试的失败（重试会写第二条）。
              writeJson(res, 200, {
                ok: false,
                sequence: result.actual,
                predicted: result.predicted,
                error: result.reason,
              })
              return
            case 'failed':
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      // ── 数据路由：`POST /api/sophia/spawn/decision`（两级审批的人类出口）──      // 客户端契约：`src/client/panel-store.ts` 的 `DECISION_ROUTE`。
      // 它把界面上的「批准 / 否决」接到 delegation 的 `decideSpawnTicket`：
      // 批准 → 落 `spawn/human-approved` 并**建团**（或幂等回放既有团）；
      // 否决 → 落 `spawn/human-rejected`、不建团。票据 id 由 requestId
      // 确定性派生（`spawnTicketIdOf`）—— 线格式不携带 ticketId（见 WirePendingPlan）。
      const decisionRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/spawn/decision`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          const method = (req as { method?: unknown }).method
          if (method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseSpawnDecisionRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          try {
            const deps = createDelegationDeps({
              ledger: active,
              // ⚠ OCR HIGH [security]：批准者身份**不采信请求体** ——
              // 账本 append-only，伪造的 humanOperatorId 永远无法纠正；
              // body.operator 若给出缺省以外的值只记警告、绝不落账
              //（服务端单值 allow-list，与 WEB_ACTOR 同精神）。
              currentHumanOperatorId: () => {
                if (parsed.operator !== 'web-operator') {
                  console.warn(
                    `[sophia] 忽略请求体提供的 operator=${JSON.stringify(parsed.operator)}（审计身份由服务端派生）`,
                  )
                }
                return 'web-operator'
              },
            })
            const outcome = await decideSpawnTicket(deps, {
              ticketId: spawnTicketIdOf(parsed.requestId as RequestId),
              decision: parsed.decision,
              reason: parsed.reason ?? undefined,
            })
            switch (outcome.kind) {
              case 'created':
                writeJson(res, 200, { ok: true, teamId: outcome.teamId })
                return
              case 'rejectedByHuman':
                writeJson(res, 200, { ok: true, rejected: true, reason: outcome.reason })
                return
              case 'ticketNotFound':
                writeJson(res, 404, { ok: false, error: outcome.reason })
                return
              case 'awaitingHumanApproval':
                // 票据还在收件箱里、第二级尚无结论（本路由就是第二级入口 ——
                // 这是状态冲突，不是执行失败）。
                writeJson(res, 409, {
                  ok: false,
                  error: `票据仍在等待人类结论（${outcome.ticketId}）`,
                })
                return
              case 'rejectedByPrincipal':
              case 'forbidden':
              case 'noDowngradeBypass':
                // 请求本身合法、但票据当前状态接不下这次决议（同换模 409 口径）。
                writeJson(res, 409, { ok: false, error: outcome.reason })
                return
              default:
                writeJson(res, 500, { ok: false, error: '未知决议结果（kind 未识别）' })
            }
          } catch (error) {
            writeJson(res, 500, {
              ok: false,
              error: `审批执行失败：${error instanceof Error ? error.message : String(error)}`,
            })
          }
        },
      }

      // ── 运营入口三条（文档 4 节 remote 面）：channel / member / lifecycle / dag ──
      // 全部照 modelRoute 同构：guard → POST → ledgerOf → readJsonBody → parse → do。
      //
      // POST /api/sophia/team/destroy —— 团队级中止（2026-09-24 新增）。
      // 语义见 host-data.ts 的 destroyTeam / types/operations.ts 的 TeamDestroyedData：
      // 停止整团（wire 不再发这个团 ⇒ 收件箱/活动面板不再显示），账本历史保留。
      // 客户端按钮：活动面板的「停止团队」（bridge.ts 的 TEAM_HALT_AVAILABLE / HALT_URL）。
      const teamDestroyRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/team/destroy`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          if ((req as { method?: unknown }).method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseDestroyTeamRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const result = destroyTeam(active, parsed)
          switch (result.kind) {
            case 'ok':
              writeJson(res, 200, { ok: true, sequence: result.sequence })
              return
            case 'unknown-team':
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            default:
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      // POST /api/sophia/channel —— 建频道（team 必须存在）。
      const channelRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/channel`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          if ((req as { method?: unknown }).method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseCreateChannelRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const result = createChannel(active, parsed)
          switch (result.kind) {
            case 'ok':
              writeJson(res, 200, { ok: true, channelId: result.channelId, sequence: result.sequence })
              return
            case 'unknown-team':
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            default:
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      // POST /api/sophia/member —— 加成员（命名门禁：非法职位 400 带 violation.message）。
      const addMemberRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/member`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          if ((req as { method?: unknown }).method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseAddMemberRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const result = addMember(active, parsed)
          switch (result.kind) {
            case 'ok':
              writeJson(res, 200, {
                ok: true,
                memberId: result.memberId,
                name: result.name,
                sequence: result.sequence,
              })
              return
            case 'naming-violation':
              writeJson(res, 400, { ok: false, error: result.violation.message })
              return
            case 'unknown-team':
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            default:
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      // POST /api/sophia/member/lifecycle —— 挂起/恢复/销毁（已是目标态 409）。
      const lifecycleRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/member/lifecycle`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          if ((req as { method?: unknown }).method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseLifecycleActionRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const result = memberLifecycleAction(active, parsed)
          switch (result.kind) {
            case 'ok':
              writeJson(res, 200, { ok: true, sequence: result.sequence })
              return
            case 'unknown-member':
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            case 'no-change':
              writeJson(res, 409, { ok: false, error: result.reason })
              return
            case 'conflict':
              // OCR [3]：destroy 会留下悬空 DAG 归属 ⇒ 拒（账本不可回滚）。
              writeJson(res, 409, { ok: false, error: result.reason })
              return
            default:
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      // POST /api/sophia/dag/ownership —— DAG 归属移交（dag/成员存在性判据都在 do 里）。
      const dagOwnershipRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/dag/ownership`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          if ((req as { method?: unknown }).method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseTransferOwnershipRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const result = transferDagOwnership(active, parsed)
          switch (result.kind) {
            case 'ok':
              writeJson(res, 200, { ok: true, sequence: result.sequence })
              return
            case 'unknown-dag':
            case 'unknown-member':
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            case 'conflict':
              // OCR HIGH [1]：from 非当前归属 / from===to ⇒ 409（不落账）。
              writeJson(res, 409, { ok: false, error: result.reason })
              return
            default:
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      // POST /api/sophia/team/message —— 面板 composer 发一条消息。
      //
      // 调用方（唯一）：`src/client/vendor/team/requests.ts` 的 `requestTeamMessage()`，
      // 路径常量 `MESSAGE_ROUTE = '/api/sophia/team/message'`（那处是地址的唯一真相）。
      // 请求体 `{threadRef, body, recipients}`；响应体 `{ok:true, messageId, occurredAt}`
      // —— `messageId` 是字符串、`occurredAt` 是**ISO 串**（调用方按
      // `typeof payload.occurredAt === 'string'` 取值，且上游 UI 全线把时间当 ISO 串用，
      // 见 `vendor/team/adapters.ts` 的 `isoFromMs`）。
      //
      // **写账逻辑不在这里**：`sendTeamMessage`（host-data）→ `writeMessageSent`
      // （tools/message.ts）—— 与工具面共用唯一一份写入实现。
      const teamMessageRoute = {
        kind: 'exact' as const,
        path: `${ROUTE_PREFIX}/team/message`,
        handler: async (req: unknown, res: SophiaResponse): Promise<void> => {
          if (guard(req, res)) return
          if ((req as { method?: unknown }).method !== 'POST') {
            writeJson(res, 405, { ok: false, error: 'method not allowed（本路由只接受 POST）' })
            return
          }
          const active = ledgerOf()
          if (active === undefined) {
            writeJson(res, 503, { ok: false, error: '账本不可用' })
            return
          }
          const body = await readJsonBody(req)
          if (!body.ok) {
            writeJson(res, 400, { ok: false, error: body.reason })
            return
          }
          const parsed = parseSendTeamMessageRequest(body.value)
          if (typeof parsed === 'string') {
            writeJson(res, 400, { ok: false, error: parsed })
            return
          }
          const activeRuntime = runtimeOf()
          if (activeRuntime === undefined) {
            // 与账本那条 503 同理：`runtimeOf()` 只在拿不到账本时才返回 undefined，
            // 而上一道门已经拦过账本缺失 ⇒ 走到这里说明装配被改坏了。如实说，不猜。
            writeJson(res, 503, { ok: false, error: '成员运行时不可用（账本可用却拿不到运行时）' })
            return
          }
          const result = await sendTeamMessage(active, parsed, {
            notifier: activeRuntime,
            // 「先把他激活、再叫醒他」——被 @ 的成员从此有活 Agent，
            // 那条消息才真的进得了他的 inbox（理由见 `sendTeamMessage` 的决定 5）。
            // preset 的选择**只在这里**（部署知识不放进数据面）：
            // 取磁盘上现成存在的 `sophia` preset，见 `host-agent-deps.ts` 的常量说明。
            activate: async ({ memberId, teamId }) => {
              const outcome = await activeRuntime.activate({
                memberId,
                teamId,
                presetId: SOPHIA_MEMBER_PRESET_ID,
              })
              switch (outcome.kind) {
                case 'activated':
                case 'already-active':
                  return { ok: true, reason: null }
                // 这五种都自带 `reason`：原样带给调用方，别把它折成一句没有原因的
                // 「没唤醒」—— 那是排查时唯一能指向根因的东西。
                case 'releasing':
                case 'conflicting-activation':
                case 'unknown-member':
                case 'lifecycle-read-failed':
                case 'invalid-policy':
                case 'failed':
                  return { ok: false, reason: outcome.reason }
                // 生命周期不是 active（挂起/归档/销毁）：该 kind 不带 `reason`，
                // 但它的 `lifecycle` 就是原因本身，渲染出来比编一句话有用。
                case 'not-active':
                  return {
                    ok: false,
                    reason: `成员当前生命周期是 ${outcome.lifecycle}（不是 active），拒绝激活。`,
                  }
              }
            },
          })
          switch (result.kind) {
            case 'ok':
              // `ok:true` 与 `messageId` / `occurredAt` 都是调用方**逐字要读**的字段
              // （见 `requests.ts`），少一个它就会把成功当失败或把时间退化成重读快照。
              //
              // `wakes` 是给**测试与排查**用的（界面当前不读它）：唤醒是尽力而为，
              // 结论必须可观测 —— 否则「成员到底起没起来」只能靠猜。
              // 每条 = `{recipientMemberId, delivery:{kind,channel,reason,delivered}}`
              //（`delivery.kind === 'no-handle'` 就说明该成员还没有活句柄 ⇒ 没被真正叫起来）。
              writeJson(res, 200, {
                ok: true,
                messageId: result.messageId,
                occurredAt: new Date(result.occurredAt).toISOString(),
                sequence: result.sequence,
                wakes: result.wakes,
              })
              return
            case 'unknown-thread':
              // 线程不存在 ⇒ 404 且**不落账**（理由见 `sendTeamMessage`：不写孤儿消息）。
              writeJson(res, 404, { ok: false, error: result.reason })
              return
            default:
              writeJson(res, 500, { ok: false, error: result.reason })
          }
        },
      }

      return [
        statusRoute,
        viewRoute,
        avatarRoute,
        modelRoute,
        decisionRoute,
        channelRoute,
        teamDestroyRoute,
        addMemberRoute,
        lifecycleRoute,
        dagOwnershipRoute,
        teamMessageRoute,
      ]
    }

    /**
     * 在**一个**服务对象上挂全部路由；任一条抛错则把已挂的收回并抛出。
     *
     * 为什么做成「一个键上一次性挂完、失败整体回滚」而不是「逐条路由各自挑键」：
     * 后者会让**同一个插件的路由分散到两个服务对象上**（新键挂上 3 条、旧键补 1 条），
     * 而过渡期那两个键指向的其实是同一个 webserver —— 分散挂载的失败模式
     * （一半路由在一个对象、一半在另一个）比整体回退难排查得多。
     * 整体回滚后交给下一个候选键，语义与改前完全一致：**要么这个键全挂上，要么换键**。
     *
     * @param webServer - 目标服务。
     * @param routes - 待挂路由。
     * @returns 本次挂上的 disposer 列表。
     */
    const registerAll = (
      webServer: SophiaWebServer,
      routes: ReturnType<typeof buildRoutes>,
    ): Array<() => void> => {
      const mounted: Array<() => void> = []
      try {
        for (const route of routes) {
          const returned = webServer.register(route)
          // disposer 只在真是函数时才留用（拿不到它不影响「已注册」的判定）。
          if (typeof returned === 'function') mounted.push(returned)
        }
        return mounted
      } catch (error) {
        // 回滚：本键上已经挂上的部分必须收回，否则换键后**同一路径会被注册两次**
        // （真实 webserver 的 `register` 对重复 (kind,path) 直接 throw ——
        // `dsh-host-webserver/lib/index.js:178`），于是「回退」变成「永久挂不上」。
        for (const undo of mounted.reverse()) {
          try {
            undo()
          } catch {
            // 回滚自身失败不该盖住真正的注册错误。
          }
        }
        throw error
      }
    }

    const mountRoute = (): void => {
      if (registered) return
      const routes = buildRoutes()

      // 新键优先、旧键回退：见 WEB_SERVER_KEYS 的说明（rc.1 `httpServer` / rc.2 `webServer`）。
      //
      // ⚠ 回退必须**逐键过守卫**，不能写成
      //     asWebServer(ctx.get('webServer') ?? ctx.get('httpServer'))
      // （OCR 复核抓到的真实缺陷）：`??` 只在**取值为 null/undefined** 时才回退。
      // 过渡期两个键都在、而新键恰好形状不对时，`ctx.get('webServer')` 是非空对象
      // ⇒ `??` 短路 ⇒ 旧键根本不会被探测 ⇒ 路由静默挂不上，
      // 正是本文件反复要避免的「静默无功能」。
      // 逐键过守卫后，形状不对的新键会退化成「不可用」，继续试旧键。
      //
      // ⚠ 更进一步：**`register()` 抛错也要继续试下一个键**（数象主事 转交的 MEDIUM）。
      // 只在选键阶段回退是不够的 —— 新键形状合法但 register 抛错（重复路由）时，
      // 旧键本可以顶上，却被整段跳过。所以把 register 也放进 try 里。
      for (const key of WEB_SERVER_KEYS) {
        const webServer = asWebServer(getService(ctx, key))
        if (webServer === undefined) continue
        // 同一个已失败对象不重复试（见 lastFailedServer 的说明）。
        if (webServer === lastFailedServer) continue
        try {
          detachers = registerAll(webServer, routes)
          registered = true
          lastFailedServer = undefined
          // ⚠ 注册**是否成功**要以「register 没有抛」为准，不能拿 disposer 的形状反推
          // （OCR 复核 [3]）：真实服务 `dsh-host-webserver/lib/index.js:176-183` 必定
          // 返回 disposer，但一旦哪天它返回非函数，旧写法会把 `registered` 判成 false
          // ⇒ 后续 internal/service 事件再调 mountRoute() ⇒ 撞上「duplicate route」抛错。
          // 走到这一行说明 register 没抛 ⇒ 注册已发生。
          return
        } catch (error) {
          // 记下来并继续试下一个键；不把异常抛给调用方（apply 路径与事件路径
          // 都已各自兜底，这里就地处理能同时保住「回退」与「不刷屏」）。
          lastFailedServer = webServer
          console.error(`[sophia] webServer.register 失败（键 ${key}），尝试下一个候选键:`, error)
        }
      }
    }

    // ── 3. 工具集注册与成员运行时对接 ──
    let detachTools: Array<() => void> = []

    const mountToolsSync = (defineTool: SophiaDefineTool, toolsRegistry: SophiaToolsRegistry): boolean => {
      if (registeredTools) return true
      const activeLedger = ledgerOf()
      mountProbe.ledgerOk = activeLedger !== undefined
      if (activeLedger === undefined) return false
      const activeRuntime = runtimeOf()
      mountProbe.runtimeOk = activeRuntime !== undefined
      if (activeRuntime === undefined) return false

      const toolsDeps = assembleSophiaToolsDeps({
        ledger: activeLedger,
        runtime: activeRuntime,
        caller: options?.caller,
      })

      const descriptors = createSophiaTools(toolsDeps)
      mountProbe.descriptorsCount = descriptors.length
      const mounted: Array<() => void> = []
      try {
        for (const descriptor of descriptors) {
          const opts = toDefineToolOptions(descriptor)
          const defined = defineTool(opts)
          const returned = toolsRegistry.register(defined as never)
          if (typeof returned === 'function') {
            mounted.push(returned as () => void)
          }
        }
        detachTools = mounted
        registeredTools = true
        mountProbe.registeredCount = descriptors.length
        return true
      } catch (error) {
        mountProbe.syncError = String(error)
        for (const undo of mounted.reverse()) {
          try {
            undo()
          } catch {
            // 回滚自身失败不该盖住真正的注册错误
          }
        }
        console.error('[sophia] 注册 sophia 工具失败:', error)
        return false
      }
    }

    // ⚠ OCR HIGH [第四轮]：代数 token —— async resolveDefineTool 晚于 fiber
    // 停用才落定时，.then 若照常注册，这批工具就活在 disposer 之外（违反
    // 「停用 ⇒ 路由/工具全部收回」的硬承诺）。disposer 使本代作废。
    let mountToken = 0

    const tryMountTools = (token: number): void => {
      if (registeredTools) return
      const rawTools = getService(ctx, 'tools')
      mountProbe.rawToolsType = typeof rawTools
      const toolsRegistry = asToolsRegistry(rawTools)
      mountProbe.registryOk = toolsRegistry !== undefined
      if (toolsRegistry === undefined) return

      const syncDefineTool = options?.defineTool ?? asDefineTool(getService(ctx, 'defineTool'))
      mountProbe.defineToolSource = syncDefineTool !== undefined ? 'sync' : 'resolve'
      if (syncDefineTool !== undefined) {
        mountToolsSync(syncDefineTool, toolsRegistry)
        return
      }

      void resolveDefineTool().then((res) => {
        // 守卫：解析晚于本代（fiber 已停用/重启）⇒ 丢弃，不把注册泄漏出 fiber。
        if (token !== mountToken) {
          mountProbe.resolveDroppedStale = true
          return
        }
        mountProbe.resolveKind = res.kind
        if (res.kind === 'failed') mountProbe.resolveReason = res.reason
        if (res.kind === 'resolved' && !registeredTools) {
          const reg = asToolsRegistry(getService(ctx, 'tools'))
          mountProbe.reRegistryOk = reg !== undefined
          if (reg !== undefined) {
            mountToolsSync(res.defineTool, reg)
          }
        }
        mountProbe.registeredToolsFinal = registeredTools
      }).catch((err) => {
        mountProbe.resolveThrew = String(err)
        console.error('[sophia] 运行期解析 defineTool 异常:', err)
      })
    }

    ctx.effect(() => {
      const token = ++mountToken
      mountRoute()
      tryMountTools(token)
      return () => {
        mountToken += 1
        registered = false
        // 全部路由一起收（见 detachers 的说明）：漏收任何一条都是静默的侧效应泄漏。
        for (const undo of detachers) {
          try {
            undo()
          } catch (error) {
            console.error('[sophia] 回收路由失败（继续收其余路由）:', error)
          }
        }
        detachers = []
        // 复位「上次失败对象」：停用后若重新启用，应当允许对同一个服务再试一次。
        lastFailedServer = undefined

        registeredTools = false
        for (const undo of detachTools) {
          try {
            undo()
          } catch (error) {
            console.error('[sophia] 回收工具失败（继续收其余工具）:', error)
          }
        }
        detachTools = []
        if (runtime !== undefined) {
          void runtime.releaseAll()
          // ⚠ OCR [30]：`releaseAll` 是**终态**（releasing 永久 true）——
          //   不置 undefined 的话，重挂载时 `runtimeOf()` 拿到的还是这具
          //   死实例，此后每个成员 activate 都被 `releasing` 拒绝，
          //   而路由/工具看起来都注册正常（极难定位）。与其余 reset 同拍。
          runtime = undefined
        }
      }
    }, 'sophia: web routes and tools')

    // ── 2. 面向模型的公告：让「索菲亚」这个词能路由到本插件 ──
    //
    // 与 mountRoute 同构：**用独立布尔量记「注册是否已发生」**，不拿 disposer 的形状反推。
    // ⚠ 这里被 OCR 复核 [4] 抓过一次真错，记下来免得改回去：
    //    第一版只有 `detachSection !== undefined` 这一道门，注释还写着「与 mountRoute 同样校验」。
    //    那个说法是**错的**：mountRoute 之重不会重复注册，靠的是 `registered` 布尔量；
    //    只校验返回值形状挡不住「section() 成功注册、但返回非函数」这条路径 ——
    //    此时 detachSection 保持 undefined，门永远拦不住，每次事件都再挂一段。
    //    实测（本文件改动前）：连续两次事件 → sectionCalls 1→2→3，公告累积 3 份且都收不回。
    //    现在 registeredSection 在 section() **没抛**时就置位，因此只挂一次。
    let detachSection: (() => void) | undefined
    let registeredSection = false
    const mountSection = (): void => {
      const systemPrompt = asSystemPrompt(getService(ctx, 'systemPrompt'))
      if (systemPrompt === undefined || registeredSection) return
      const returned = systemPrompt.section({
        name: 'plugin:sophia',
        order: SECTION_ORDER,
        text: GUIDANCE,
      })
      // 走到这一行说明 section() 没抛 ⇒ 已注册（与 mountRoute 的 registered 同理）。
      registeredSection = true
      // disposer 只在真是函数时才留用；拿不到它不影响「已注册」的判定。
      if (typeof returned === 'function') detachSection = returned
    }
    ctx.effect(() => {
      mountSection()
      return () => {
        detachSection?.()
        detachSection = undefined
        registeredSection = false
      }
    }, 'sophia: prompt section')

    // ── 4. 迟到挂载：服务可能在 apply 之后才到齐 ──
    //
    // **一个监听器**同时看三组键（webServer, systemPrompt, tools）。
    // 校验风格统一成先 `typeof` 收窄再比较。
    ctx.on('internal/service', (serviceName) => {
      // ⚠ 这个监听器**运行在 apply 之外**（OCR 复核 [4]，真实缺陷）：
      // apply 的外层 try/catch 只能罩住同步调用 `ctx.on(...)` 那一下。
      // 事件真正派发时是 cordis 在调本函数 —— 此时 `mountRoute()` /
      // `mountSection()` / `tryMountTools()` 里抛的异常会直接冲进事件派发路径，
      // 违反文件头第 3 条「拖垮别的插件不是」的承诺。
      // 因此整个监听体自己兜底。
      try {
        if (typeof serviceName !== 'string') return
        if (WEB_SERVER_KEYS.includes(serviceName as TWebServerKey)) mountRoute()
        else if (serviceName === 'systemPrompt') mountSection()
        else if (serviceName === 'tools') tryMountTools(mountToken)
      } catch (error) {
        console.error('[sophia] late mount failed (ignored; other plugins unaffected):', error)
      }
    })
  } catch (error) {
    // 见文件头第 3 条：本插件降级 → 记日志；拖垮 loader → 不接受。
    console.error('[sophia] host apply failed; plugin skipped (other plugins unaffected):', error)
  }
}

export { createTeam, createDefaultMemberRuntime, assembleSophiaToolsDeps } from './host-assembly.ts'
