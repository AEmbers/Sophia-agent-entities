/**
 * 「真 Agent 底座」的接线：把宿主 ctx 里的 DSH 服务装配成 `MemberRuntimeDeps`。
 *
 * ## 桩 → 真身 的对照表（每一行都有出处，**没有一处按名字猜**）
 *
 * | 本仓的端口 | 真身 | 出处（本机 DSH core 0.1.5-rc.1） |
 * |---|---|---|
 * | `mountPreset(setup, presetId)` | `ctx.agentPresets.mount(agentCtx, presetId)` | `dsh-agent-presets/lib/index.js:1511`；typert 签名 `lib/typert.host.js:243` |
 * | `applyToolPolicy(setup, allow)` | `agentCtx.tools.restrict({ allow })` | `dsh-tools/lib/types/index.js:478`（`:481` 未作用域即抛、`:486` 空 filter 即抛、`:498` 名字不在已知全局工具清单即抛、`:500` 返回 disposer） |
 * | `createHandle({memberId,presetId,setup})` | `ctx.agents.create({ sessionId, meta, agentOptions, setup })` | `dsh-agent/lib/index.js:289`（服务）/`:417`（`create`）；工厂 `dsh-agent-loop/lib/index.js:1818 createAgent(ownerCtx, options)` |
 * | `MemberHandle` | `{ agent, dispose }` | `dsh-agent-loop/lib/index.js:1722-1725`（`publish()` 的返回） |
 *
 * ## 三条**必须**照做的上游约定（都有实测代价）
 *
 * 1. **`setup` 必须被调用，且只调用一次**。上游 `setupAndPublish` 是
 *    `(await raceAbort(setup?.(prepared.agent.ctx, prepared.agent), …))?.commit()`
 *    （`dsh-agent-loop/lib/index.js:1856`），而本仓运行时**校验它被调用过**：
 *    未调用 ⇒ `activate` 判 `failed`（`src/runtime/member-runtime.ts:1130-1140` 的
 *    `SetupState`；实测：本批第一版测试的假件漏调它，`activate` 直接返回 `failed`，
 *    唤醒全被句柄门挡成 `no-handle`）。所以下面 `setup` 里那一行**不是**可选装饰。
 * 2. **`mountPreset` 只能在 `setup(agentCtx)` **里面**调**。上游逐字要求：
 *    "Call from the agent factory's `setup(agentCtx)`; a rejection there rolls the
 *    agent creation back"（`dsh-agent-presets/lib/index.js:1503-1505`），且它要求
 *    **scoped** 上下文 —— 未作用域直接抛 `refusing to compose an unscoped context`
 *    （`:1513`）。这就是本文件把 `agentContext` 原样透传的原因：那个对象才是
 *    `agent.ctx`，`setup` 回调之外的任何 ctx 都不是它。
 * 3. **顺序：先挂 preset，再注入工具策略**。工具策略是 `tools.restrict()` 的
 *    effect 层，挂在后面对**这次**挂载生效；反过来会被 preset 的注册覆盖，
 *    而两种顺序**都不报错**（本仓 `src/runtime/member-runtime.ts:408-411` 已记录该顺序，
 *    上游同序：`…/agent-team/src/index.ts:2394-2395`）。
 *
 * ## 本文件**不**做的事（如实列出，别把它读成完备）
 *
 * - **不判会话是否已存在**：只会走 `agents.create`。上游在重启恢复路径上用
 *   `resume({ resumeSessionId })`（`dsh-agent-loop/lib/index.js:1925`），而本仓这一步
 *   留到后续（父任务的分段）。**代价**：进程重启后同一个成员会拿同一个派生 sessionId
 *   再走一次 create；真持久化后端若拒绝同名创建，表现是 `activate → failed` 且
 *   reason 里带后端原文（**响亮**，不静默）；若它接受，则多一份会话日志。两种都不会
 *   让消息丢失（账本先落、唤醒尽力而为）。
 * - **不设成员的工具白名单**：账本里没有 capabilities 字段，`toolPolicy` 传 `undefined`
 *   ⇒ 运行时按既有规则**跳过**策略注入（`member-runtime.ts:432` 的说明），
 *   该成员拿到 preset 自带的工具面。要收紧就落账本字段，那是后续分段的事。
 */

import { mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'

import { rebuildFold } from '../projection/index.ts'
import type { Ledger } from '../ledger.ts'
import type {
  MemberAgentSetup,
  MemberHandle,
  MemberLogger,
  MemberRuntimeDeps,
} from './member-runtime.ts'
import type { MemberId } from '../types/index.ts'

/**
 * 成员默认挂载的 preset 标识。
 *
 * `'sophia'`：磁盘上**现成存在**的那个 preset（`~/.dsh/.agent-presets/sophia/`，
 * 内含 `preset.yml` + `agent.cordis.yml` + `skills/`；同目录另有 `ptc-cordis`）。
 * 选它而不是 `ptc-cordis`：后者把每个工具改成经 PTC SDK 呈现、以 `run_code` 为编排面，
 * 而成员要的是**原生**工具调用（`agent.cordis.yml` 文件头把两者差别写明了）。
 *
 * ⚠ 这是**写死的默认值**，不是一个配置项：账本里没有成员 preset 字段
 *（`team/member-added` 载荷只有 `teamId` / `member` / `lifecycle` / `model`）。
 * 等到「每个成员挂不同 preset」成为真需求时，该字段要落账本，而不是在这里加分支。
 */
export const SOPHIA_MEMBER_PRESET_ID = 'sophia'

/**
 * 成员的会话 id：**由成员 id 确定性派生**（本仓唯一的派生处）。
 *
 * ## 为什么派生而不是落账本
 *
 * 上游要求 `agents.create({ sessionId })` 有一个**调用方给的**会话身份，
 * 而本仓账本里**没有**任何成员会话字段（宿主侧 `grep sessionId` 只命中 `src/client/**`；
 * `team/member-added` 的载荷只有 `teamId`/`member`/`lifecycle`/`model`）。
 * 两条路：**派生**（0 处账本改动，且天然可 resume —— 同一个成员重启后还是同一个 id），
 * 或**落一条新账本事实**（要动 types / guards / ledger / 投影 / 线格式五处，
 * 换来的只是"可以在账本里查到它"）。本批取前者。
 *
 * ## ⚠ 代价（改动本函数前必读）
 *
 * 派生规则就是**会话身份**。改了它（哪怕只是加个前缀）= 该成员换了一个会话：
 * 真 DSH 那边旧会话日志仍在磁盘上，但成员从此在一个**没有历史上下文**的新会话里干活。
 * 所以：这个函数只准有一个实现，改动它等于一次**数据迁移**，必须同时想清楚
 * 「旧会话怎么办」。同理，它**不许**依赖任何随时间/环境变化的东西
 *（`Date.now()`、`process.pid`、随机数）——那会让同一个成员每次重启都换会话。
 *
 * ## 形状
 *
 * `sophia-member-<memberId>`。前缀让会话在 DSH 的会话列表里**一眼可辨**
 *（那些会话是索菲亚成员，不是主人手开的）。`SessionId()` 本身**不做任何格式校验**
 *（`dsh-session/lib/types/types.js:7-9` 只是 `brandString(id)`），
 * `sessions.prepare` 也只在**进程内 store 里**查重（`dsh-session/lib/index.js:1374-1380`）
 * —— 所以这里用人类可读的 id 是安全的，也正是这样才便于排查。
 *
 * @param memberId - 成员 id（`sophia-<slug>-<uuid8>` 形状，全局唯一）。
 * @returns 该成员**恒等**的会话 id（同一个输入永远得到同一个输出）。
 */
export function memberSessionIdOf(memberId: MemberId): string {
  return `sophia-member-${memberId}`
}

/**
 * 成员的私有工作目录（`meta.cwd` 要的**绝对**路径）。
 *
 * 为什么需要一个真目录：`ctx.agents.create` 的 `meta.cwd` 会被写进会话头，
 * 而非绝对路径会被直接拒绝（`dsh-session/lib/index.js:1371-1372` 的 `@throws` 写明
 * "`meta.cwd` is a non-absolute path"）。上游给每个成员一个私有内存目录的办法相同
 *（`…/agent-team/src/index.ts:2378-2379` 用 `dshHomePath('agent-team','members',…)`）。
 *
 * 目录**不是**共享工作区：成员在这里落自己的临时产物，彼此不串。
 */
export function memberWorkspacePathOf(dataDir: string, memberId: MemberId): string {
  return join(dataDir, 'members', memberId)
}

/** 宿主 ctx 的**最小**结构（只声明本文件要读的东西；与 `src/host.ts` 的同名习惯一致）。 */
export interface HostAgentContext {
  get(name: string): unknown
}

/** `ctx.agents` 的最小面（`dsh-agent` 的 `AgentRegistry`）。 */
interface AgentsService {
  create(options: {
    readonly sessionId: string
    readonly meta: { readonly cwd: string; readonly agentPreset: string }
    readonly agentOptions: { readonly provider: string; readonly model: string }
    readonly setup: (agentCtx: unknown, agent: unknown) => Promise<void>
  }): Promise<unknown>
}

/** `ctx.agentPresets` 的最小面（`dsh-agent-presets`）。 */
interface AgentPresetsService {
  mount(agentCtx: unknown, presetId: string): Promise<unknown> | unknown
}

/** `agentCtx.tools` 的最小面（`dsh-tools`）。 */
interface ToolsService {
  restrict(filter: { readonly allow: readonly string[] }): unknown
}

/** `ctx.agentDefaultModel` 的最小面（`dsh-agent-default-model`）。 */
interface AgentDefaultModelService {
  currentSelection(): unknown
}

/** 结构化守卫：把 `ctx.get()` 的 `unknown` 收窄成可用的面（认不出就返回 `undefined`，不抛）。 */
function asAgents(value: unknown): AgentsService | undefined {
  const create = (value as { create?: unknown } | null | undefined)?.create
  return typeof create === 'function' ? (value as AgentsService) : undefined
}

function asAgentPresets(value: unknown): AgentPresetsService | undefined {
  const mount = (value as { mount?: unknown } | null | undefined)?.mount
  return typeof mount === 'function' ? (value as AgentPresetsService) : undefined
}

function asToolsOf(agentContext: unknown): ToolsService | undefined {
  const restrict = (agentContext as { tools?: { restrict?: unknown } } | null | undefined)?.tools
    ?.restrict
  return typeof restrict === 'function'
    ? ((agentContext as { tools: ToolsService }).tools)
    : undefined
}

function asAgentDefaultModel(value: unknown): AgentDefaultModelService | undefined {
  const current = (value as { currentSelection?: unknown } | null | undefined)?.currentSelection
  return typeof current === 'function' ? (value as AgentDefaultModelService) : undefined
}

/** 从 `unknown` 里读出 `{provider, model}` 两条非空字符串，读不出返回 `undefined`。 */
function asModelSelection(value: unknown): { provider: string; model: string } | undefined {
  const record = value as { provider?: unknown; model?: unknown } | null | undefined
  if (record === null || record === undefined) return undefined
  const { provider, model } = record
  if (typeof provider !== 'string' || provider.trim() === '') return undefined
  if (typeof model !== 'string' || model.trim() === '') return undefined
  return { provider, model }
}

/** 从 `create` 的返回值里读出 `{agent, dispose}`；读不出抛（面不符契约时不能假装成功）。 */
function asAgentHandle(value: unknown): MemberHandle {
  const record = value as { agent?: unknown; dispose?: unknown } | null | undefined
  if (record === null || record === undefined || record.agent === undefined) {
    throw new Error(
      `ctx.agents.create 没有返回 {agent, dispose}（收到 ${renderValue(value)}）—— 接线不符契约。`,
    )
  }
  return {
    agent: record.agent as MemberHandle['agent'],
    dispose: typeof record.dispose === 'function'
      ? (record.dispose as MemberHandle['dispose'])
      : () => undefined,
  }
}

/** 只用于错误文案：把任意值渲染成短而可读的一行。 */
function renderValue(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
    case 'boolean':
    case 'undefined':
      return String(value)
    case 'object':
      return `一个 ${Array.isArray(value) ? '数组' : '对象'}（键：${Object.keys(value as object).slice(0, 8).join(',') || '无'}）`
    default:
      return `一个 ${typeof value}`
  }
}

export interface HostAgentDepsOptions {
  /** 宿主 ctx（服务经 `get()` 惰性读取 —— 与 `src/host.ts` 同一习惯，不改 `inject`）。 */
  readonly ctx: HostAgentContext
  /** 本插件的数据目录（`src/host.ts` 的 `sophiaDataDir()`；成员私有目录建在它下面）。 */
  readonly dataDir: string
  /** 读成员自己的模型（`team/member-added` 的 `model`）；读不到就落全局默认。 */
  readonly ledger?: Ledger | undefined
  readonly logger?: MemberLogger | undefined
}

/**
 * 把宿主 ctx 装配成 `MemberRuntimeDeps`（**只**覆盖三个端口：`mountPreset` /
 * `applyToolPolicy` / `createHandle`）。
 *
 * 为什么只覆盖三个：另外两个（`lifecycleOf` / `logger`）本仓已有真实现 ——
 * `createDefaultMemberRuntime` 的 `lifecycleOf` 读账本投影（`src/host-assembly.ts:454-461`），
 * 那是**唯一**的生命周期真相。在这里再写一份就是第二个真相。
 *
 * ## 返回值是 `Partial`，且**允许缺少服务**（契约在运行时显式化）
 *
 * 拿不到 `agents` / `agentPresets` 时**不报错**：本函数在插件加载期被调用，
 * 那时服务可能还没注册完（cordis 的 `internal/service` 是事件）。所以缺服务的事实
 * 被推迟到**真正要激活一个成员**时才响 —— `createHandle` 会抛一条说得清的错，
 * 运行时把它折成 `activate → failed`（reason 带上原文），最终出现在路由响应的
 * `wakes` 里。**不静默**、也不假装能激活。
 */
export function createHostAgentDeps(
  options: HostAgentDepsOptions,
): Pick<MemberRuntimeDeps, 'mountPreset' | 'applyToolPolicy' | 'createHandle'> {
  const { ctx, dataDir, ledger, logger } = options

  /** 取服务，取不到就抛一条能定位的错（含「该装哪一行」）。 */
  const requireAgents = (): AgentsService => {
    const agents = asAgents(ctx.get('agents'))
    if (agents === undefined) {
      throw new Error(
        '拿不到 ctx.agents（@deepseek-ai/dsh-agent 那一行没挂上）⇒ 无法创建成员 Agent。',
      )
    }
    return agents
  }

  const requirePresets = (): AgentPresetsService => {
    const presets = asAgentPresets(ctx.get('agentPresets'))
    if (presets === undefined) {
      throw new Error(
        '拿不到 ctx.agentPresets（@deepseek-ai/dsh-agent-presets 那一行没挂上，'
        + '在本机由 @deepseek-ai/dsh-web-app 提供）⇒ 无法挂载成员 preset。',
      )
    }
    return presets
  }

  /** 模型：成员自己的（账本）优先，否则全局默认；都没有 ⇒ 抛（不凭空造一个）。 */
  const resolveAgentOptions = (memberId: MemberId): { provider: string; model: string } => {
    if (ledger !== undefined) {
      try {
        const pinned = asModelSelection(rebuildFold(ledger).fold.members.get(memberId)?.model)
        if (pinned !== undefined) return pinned
      } catch (error) {
        // 读账本失败**不阻止**激活：模型可以退到全局默认，而"成员起不来"是更大的损失。
        // 但也**不吞**：留一条日志，否则"为什么这次用了默认模型"无从查起。
        logger?.warn(`[sophia] 读成员 ${memberId} 的模型失败，改用全局默认：${String(error)}`)
      }
    }
    const fallback = asModelSelection(asAgentDefaultModel(ctx.get('agentDefaultModel'))?.currentSelection())
    if (fallback === undefined) {
      throw new Error(
        `成员 ${memberId} 既没有自己的模型（team/member-added 的 model 为 null），`
        + '也拿不到 ctx.agentDefaultModel 的当前选择 ⇒ 无法确定 provider/model。',
      )
    }
    return fallback
  }

  return {
    mountPreset: async (setup: MemberAgentSetup, presetId: string): Promise<void> => {
      // ⚠ 必须在 `setup(agentCtx)` 里被调用（上游 `dsh-agent-presets/lib/index.js:1503-1505`），
      // 而 `setup.agentContext` 就是那一刻的 agentCtx —— 本仓运行时正是这样组装它的
      //（`member-runtime.ts:1125-1155` 的 `setup`）。两者是同一个对象，不另做映射。
      await requirePresets().mount(setup.agentContext, presetId)
    },

    applyToolPolicy: (setup: MemberAgentSetup, allow: readonly string[]): void => {
      const tools = asToolsOf(setup.agentContext)
      if (tools === undefined) {
        // 有策略却注入不进去 ⇒ **必须响**：静默跳过会让成员带着比预期更宽的工具面干活
        //（`tools.restrict` 是收窄手段，缺了它等于越权），这正是本仓
        //「不假装能激活」的取舍。空清单到不了这里（运行时先归一化，见 `member-runtime.ts:432`）。
        throw new Error(
          `agentCtx.tools.restrict 不可用，无法为成员注入 ${allow.length} 条工具策略`
          + '（有策略却注入不进去 = 工具面比预期更宽，宁可失败）。',
        )
      }
      tools.restrict({ allow })
    },

    createHandle: async (input): Promise<MemberHandle> => {
      const agents = requireAgents()
      const sessionId = memberSessionIdOf(input.memberId)
      const cwd = memberWorkspacePathOf(dataDir, input.memberId)
      if (!isAbsolute(cwd)) {
        // 上游对非绝对 cwd 的处置是抛（`dsh-session/lib/index.js:1371-1372`），
        // 但那条错误里只有路径、没有"为什么该是绝对的"。这里先拦一次并说明来源：
        // 根因通常是 `SOPHIA_DATA_DIR` 被设成了相对路径。
        throw new Error(
          `成员工作目录不是绝对路径：${cwd}（来自 dataDir=${dataDir}）`
          + '—— 上游要求 meta.cwd 为绝对路径，请检查 SOPHIA_DATA_DIR。',
        )
      }
      await mkdir(cwd, { recursive: true })
      const agentOptions = resolveAgentOptions(input.memberId)

      const created = await agents.create({
        sessionId,
        // `meta.agentPreset` 与 `mountPreset` 的入参是**同一个** preset 标识：
        // 前者写进会话头（可查"这个会话按哪个 preset 起的"），后者真的挂载它。
        // 两者不一致会让会话头在骗人，所以都来自调用方那一个 `presetId`。
        meta: { cwd, agentPreset: input.presetId },
        agentOptions,
        // ⚠ 这一行是本文件最容易漏、且漏了**不报错**的地方（见文件头第 1 条）。
        // 原样透传 agentCtx：`setup.agentContext` 就是它，`mountPreset` 与
        // `applyToolPolicy` 都靠它定位到"这个成员的那个作用域"。
        setup: async (agentCtx: unknown): Promise<void> => {
          await input.setup({ memberId: input.memberId, agentContext: agentCtx })
        },
      })

      return asAgentHandle(created)
    },
  }
}
