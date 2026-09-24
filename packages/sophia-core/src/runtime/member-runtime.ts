/**
 * 成员运行时：把账本里的成员实体拉成**活 Agent**（SPEC §2.3 / FR-3.2 / FR-5.0.5 / FR-6.5 / FR-9）。
 *
 * 上层文档：`docs/DEVELOPMENT.md:109` 把「成员激活 / 句柄缓存 / 工具策略注入」列为本模块的职责；
 * 双通道唤醒的参照实现是上游 `dsh-agent-team/packages/agent-team/src/index.ts:2811`
 * 的 `notifyMember`。本文件是它的**自有实现**（不是拷贝）——因为它必须落在本包的契约上
 * （自持类型、自持错误口径、不 import `@deepseek-ai/*`）。
 *
 * ── 四条职责与它们各自的「可证伪」形式 ──
 *
 * | 职责 | 落点 | 怎么证明它真的成立（而不是"看起来对"） |
 * |---|---|---|
 * | 激活 + 句柄缓存 | `activate()` | 并发调用时 `createHandle` 只被调 **1** 次；setup 未被调用即判失败 |
 * | 双通道唤醒 | `notify()` | idle / running **各一条独立用例**，各自断言目标通道 1 次、另一通道 0 次 |
 * | 状态同步 | `presenceOf()` / `lifecycleOf` 端口 | 存在态**不缓存**（读活句柄的实时 status）；生命周期只有账本一个来源 |
 * | 通知去重 | `noticeSignatureOf()` | 同签名第二次投递被拒；**顺序不同算同一条**；待办清空后同签名可再投 |
 *
 * ── 三条被实测钉住的外部事实（不是推断）──
 *
 * 1. **存在态是 Agent 自身的派生 getter**：`~/.dsh/core-0.1.5-rc.1/@deepseek-ai/dsh-agent-loop/lib/index.js:773-774`
 *    逐字为 `get status() { return this.phase.kind === "idle" || this.phase.kind === "maintenance" ? "idle" : "running" }`
 *    ⇒ 读 `agent.status` 就是读实时状态。因此本模块**刻意不缓存**存在态 ——
 *    「缓存过期」这一整类故障在本模块里结构性地不存在。
 * 2. **两个通道是不同的投递通道，且都带唤醒**：同文件 `:783-797`
 *    逐字为 `followup(input) { this.send(input, "next-turn", true) }` /
 *    `steer(input) { this.send(input, "next-step", true) }`。
 *    两条都传 `wakeup = true`，而 `:837-852` 的 `wakeDriver` 在 `phase.kind === "idle"`
 *    时直接开一个 driver ⇒ **steer 打在空闲成员上也会把它唤醒**，区别只在投递通道
 *    （`next-step` 最近步骤边界 / `next-turn` 开新 turn）。
 *    这解释了为什么「空闲走哪个通道」必须显式判分支，而不能靠"反正都会醒"糊过去：
 *    走错通道不会报错、只会改变消息落在哪一步。
 * 3. **上游的句柄缓存与竞态**：上游 `packages/agent-team/src/index.ts:368` 是
 *    `private readonly handles = new Map<MemberId, AgentHandle>()`，`:2371` 的守卫是
 *    `if (this.handles.has(member.memberId)) return`（在**第一个 await 之前**），
 *    而 `:2502` 的 `handles.set(...)` 在 `agents.create(...)` **之后** ——
 *    也就是说两次并发激活在真实实现里能各建一个 Agent。本模块用「在途 Promise」关掉这个窗口
 *    （与 `src/delegation.ts` 对同一类缺陷的处置同形），并有专门用例守着。
 *
 * ── 「唤醒不绑定任何窗口会话」不是承诺，是结构性事实 ──
 *
 * 本模块的**全部**输入、输出、依赖里都没有 `HostSessionId` / `sessionId` 这类字段：
 * 唤醒一个成员只需要 `memberId` + 一条通知，不需要知道是谁在跟它说话。
 * 这句话由 `tests/runtime.spec.ts` 的源码扫描用例守着（剥掉注释后逐字扫该标识符）。
 * 依据是 SPEC §2.2 的角色模型：`Host` 与团是**多对多、可替换的引用**，不是所有权
 * （`src/types/roles.ts` 的 `Host` 上刻意没有 `teamId`，AC-ROLE-1）；
 * 一个把成员唤醒绑在某个窗口会话上的运行时，会在那个窗口关闭时变成僵尸。
 *
 * ── 生命周期与存在态是两个正交维度（FR-3.2），本模块分别处理 ──
 *
 * - **存在态** `idle | running`：从活句柄的 `agent.status` 按需读（上述事实 1）。
 * - **生命周期** `active | suspended | archived | destroyed`：从**账本**读。
 *   本模块**不持有**生命周期真相 —— 依赖里的 `lifecycleOf` 由宿主绑定到账本投影，
 *   所以 FR-10.2「所有视图须为账本事实的投影，不得持有独立真相」在这里是结构性的：
 *   本模块没有第二个真相来源可以与账本分叉。
 *
 * @module @sophia/core/runtime/member-runtime
 */

import type { MemberId, TeamId } from '../types/ids.ts'
import type { MemberLifecycle, MemberPresence } from '../types/team.ts'
// 「通知 → 合法 user message」的唯一转换处。为什么是**结构镜像**而不是
// `import { createUserMessage } from '@deepseek-ai/dsh-llm'`：本包零运行时依赖、
// 且该包在本包解析不到（实测两处 `Test-Path` 均为 False）—— 完整理由与代价
// 见 `notice-message.ts` 的文件头，改动形状前必读。
import { noticeMessageOf, type SophiaUserMessage } from './notice-message.ts'

// ────────────────────────────────────────────────────────────────────────────
// 最小 Agent 面（结构化声明，不 import `@deepseek-ai/*`）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 成员 Agent 的最小面。
 *
 * **为什么不是 `import type { Agent } from '@deepseek-ai/dsh-agent'`**：SPEC §1.1 的实测结论 ——
 * 本机 DSH SDK 安装（`~/.dsh/core-0.1.5-rc.1/@deepseek-ai`，243 个包目录）递归含 **0** 个 `.d.ts`
 * （本轮再次核实：`Get-ChildItem -Recurse -Filter *.d.ts | Measure-Object` → `Count 0`），
 * 那个 import 会报 `TS7016` 并以 exit 2 失败。故这里只声明真正调用的三个成员，
 * 与 `src/host.ts` 对 `SophiaHostContext` 的处置同形。
 *
 * `status` 刻意是 `string` 而不是 `'idle' | 'running'`：SDK 是无类型声明的 JavaScript，
 * 将来多一个 phase 不应让整个运行时**静默失效**（若把守卫收窄成两个字面量，
 * 一个未知状态会让结构守卫判「这不是句柄」⇒ 成员再也唤不醒，且没有任何报错）。
 * 未知状态的处置写在 `readBusyness` / `channelForBusyness`（读不出来也算"未知"）。
 */
export interface MemberAgent {
  /**
   * Agent 的身份。
   *
   * ⚠ 本模块**自己不消费** `id`，但仍把它放进形状守卫（OCR 复核 MEDIUM 质疑过这点，
   * 已核实**保留**，依据如下）：
   *
   * 1. 真实 SDK Agent **确实**有 `id`：同仓的参考实现
   *    `dsh-agent-team/packages/agent-team/src/index.ts` 里读 `active.agent.id` 至少 6 处
   *    （`:489`、`:583`、`:584`、`:964`、`:1034`、`:1035`）—— 不是"猜它应该有"。
   * 2. 守卫的职责是**判断这个对象是不是我们要的那个东西**，不是"只校验我自己用到的字段"。
   *    `id` 是 Agent 最基本的身份字段；一个没有 `id` 的对象更可能是**别的东西**
   *    （或接线错误），把它当句柄缓存下来才是危险的那一侧。
   * 3. 代价是**有界且可自愈**的：真的遇到"合法 Agent 但没有 id"，表现为 `no-handle`
   *    + 一条形状非法的失败原因（**响亮**，不静默），且本模块**不删**缓存里的原值 ⇒
   *    接线修好即恢复。相反若放行一个 `id` 不可读的对象，问题会晚得多地暴露。
   *
   * 若将来 SDK 真的去掉 `id`（或改成惰性/非字符串），**证据会是**：`activate` 返回
   * `failed`（原因含"形状不合法"）而 Agent 明明可用 —— 那时删掉这一项即可，
   * 本条注释就是判据。
   */
  readonly id: string
  readonly status: string
  /**
   * ⚠ 参数是**一条消息**，不是一段文本、也不是 `MemberNotice`。
   *
   * 真 DSH 的 `Agent.followup(input)` 把 `input` 原样塞进 inbox
   *（`dsh-agent-loop/lib/index.js:783-790`：`send → inbox.splice(target, ∞, 0, [message])`
   * `→ wakeDriver()`），后续请求装配读的是 `message.content` / `message.source`。
   * 而 inbox 的来源只有**一条**正典路径：`createUserMessage({content, source})`
   *（`dsh-api-session-controller/lib/types/commands.js:317`；插件通知同形见
   * `dsh-agent-team/packages/agent-team/src/index.ts:2838-2841`）。
   *
   * ⇒ 结构由 `SophiaUserMessage` 镜像（为什么是镜像而不是 import，见
   * `notice-message.ts` 的文件头），**转换只有一处**：`noticeMessageOf`。
   * 把 `MemberNotice`（`{items, text}`）直接喂进来在假 agent 上"能跑"，
   * 但对真 agent 是一条**没有 content 的空消息** —— 不报错、只是成员读不到东西。
   */
  followup(message: SophiaUserMessage): void
  steer(message: SophiaUserMessage): void
}

/**
 * 一个成员的活句柄。
 *
 * `dispose` 的返回值放宽成 `void | Promise<void>`：真实 `AgentHandle.dispose()` 是异步的
 * （上游 `index.ts:637` 用 `Promise.all([...handles.values()].map(h => h.dispose()))`），
 * 而测试用的假句柄同步即可。放宽的代价是宿主侧必须 `await` —— 本模块统一 `await`。
 */
export interface MemberHandle {
  readonly agent: MemberAgent
  dispose(): Promise<void> | void
}

// ────────────────────────────────────────────────────────────────────────────
// 通知与去重签名
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一条待办事实的**去重维度**。
 *
 * 与上游 `index.ts:2825-2827` 的签名元组同构（上游取
 * `[threadRef, revision, unreadCount, directCount, newestSequence]`）。
 * 这里少一个 `directCount`：本包此刻没有"直达消息"这个维度，**按需再加**。
 * 不预先塞一个恒为 0 的字段 —— 那会让签名看起来能区分一件它其实区分不了的事。
 *
 * ## ⚠ 去重键**不含通知正文**（`MemberNotice.text`）—— 这是取舍，不是疏漏
 *
 * OCR 复核 MEDIUM 指出「同一组待办、不同措辞的第二条通知会被静默压制」。
 * 该行为属实，但**把正文并入键更糟**，所以本模块**有意**维持"事实键"：
 *
 * | 口径 | 风险 |
 * |---|---|
 * | 含正文 | **唤醒风暴** —— 正文由调用方渲染，"带上当前时间/进度"是极自然的写法；此刻事实没变、正文每秒都变 ⇒ 每条都算"新" ⇒ 每次轮询都烧成员一个**完整 turn**。实测推演：60 轮轮询下含正文口径唤醒 **60** 次、事实口径 **1** 次 |
 * | 不含正文（现状） | 事实完全相同、仅措辞不同时，第二条不推送。但"事实相同"意味着成员**已经拥有那批信息**，丢失的是措辞而不是信息 |
 *
 * 两条都是静默的，但代价不对称：一个多烧 N 次模型调用（真金白银，且直接违反
 * "同一条待办不得重复推送"这条设计目标），另一个最多是措辞陈旧。
 * ⇒ **维持事实键**，同时把残余风险写在这里（原先完全没写，那才是真问题）。
 *
 * 若将来确实需要"正文更新也要提醒"，正确做法是给待办加一个**语义版本**
 * （例如 `revision` 已经承担该职责 —— 让它随着正文所依赖的事实一起变），
 * 而不是把整段渲染文本塞进去重键。
 *
 * ## ⚠ 调用方必须传数组（`noticeSignatureOf` 不兜底非数组，这是**有意**的）
 *
 * OCR 复核 LOW 建议"非数组输入收敛为空签名，避免它成为新的抛错点"。
 * 实测该函数对 `undefined` / `null` / 数字 / 字符串 / 普通对象**都会抛** `TypeError`。
 * **不采纳"收敛成空签名"**，理由是它会造出一个比抛错更糟的失效模式：
 * 空签名是一个**合法取值**（空待办集合的签名），于是任何非法输入都会与"真的没有待办"
 * 算出**同一个**签名 ⇒ 两条本不相干的输入在去重表里互相冒充（静默、且方向危险）。
 * 抛错则把"调用方违反了前提"当场说清楚；而 `notify` 已经在校验**之前**拦掉了所有非法输入，
 * 所以真跑在系统里的路径不会触发它 —— 会触发的是直接调用这个导出函数的测试/工具代码，
 * 那些地方抛错正是想要的反馈。
 */
export interface MemberPendingItem {
  /** 待办标识（频道 / 线程 / 任务）。同一成员内应唯一。 */
  readonly ref: string
  /** 该待办的版本号：内容变了它就该变（否则成员会错过更新）。 */
  readonly revision: number
  /** 未读条数。 */
  readonly unreadCount: number
  /** 最新一条相关事件的账本序号。 */
  readonly newestSequence: number
}

/**
 * 一条待唤醒通知。
 *
 * **正文由调用方渲染**：文案要跟随 DSH 官方 locale（中/英）与投影层的事实，
 * 不属于运行时的职责（上游把 `notificationText` 单独放在 `index.ts:2869`，
 * 也是同一个分工）。本模块只负责**去重**与**投递**。
 */
export interface MemberNotice {
  /** 待办事实；**空数组 = 没有待办**（见 `notify`）。 */
  readonly items: readonly MemberPendingItem[]
  /** 面向成员的正文。 */
  readonly text: string
}

/** 非负安全整数（序号 / 计数类字段的唯一合法形状）。 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** 待办事实的结构守卫（`notify` 的入口校验，见 `invalid-notice` 的处置说明）。 */
function isPendingItem(value: unknown): value is MemberPendingItem {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate['ref'] === 'string'
    && candidate['ref'] !== ''
    && isNonNegativeSafeInteger(candidate['revision'])
    && isNonNegativeSafeInteger(candidate['unreadCount'])
    && isNonNegativeSafeInteger(candidate['newestSequence'])
  )
}

/**
 * 读生命周期的结果：**"读失败"与"没有"分开**。
 *
 * 存在的理由（OCR 复核 MEDIUM，本处曾是真缺口）：`lifecycleOf` 是注入的宿主投影，
 * 它会读账本 —— 而账本读取**是会抛的**（`src/ledger.ts` 的 `read` 在遇到读不回来的行时
 * 刻意抛错，见那里的注释）。本模块在别处都遵守「读不到就降级，不要抛」，
 * 唯独这里曾直接裸调：宿主投影一抛，异常就会从 `notify` 冲进调用方 ——
 * 而 `notify` 的文档承诺正是**从不抛错**（它运行在事件派发路径上，
 * 见 `MemberRuntime` 的接口文档与 `src/host.ts` 文件头第 3 条）。
 *
 * `'unknown'` 与「账本不认识这个成员」**不是一回事**：
 * - `{kind:'known', lifecycle:null}` ⇒ 账本**明确**不认识它；
 * - `{kind:'unknown', reason}` ⇒ 我们**读不出来**，因此不知道它是什么状态。
 * 后者在两条路径上都保守处理：激活拒绝、唤醒拒绝（fail-closed）——
 * 一个状态未知的成员可能已被销毁，唤醒它比不唤醒更危险。
 */
type LifecycleRead =
  | { readonly kind: 'known'; readonly lifecycle: MemberLifecycle | null }
  | { readonly kind: 'unknown'; readonly reason: string }

/** 带兜底地读生命周期（任何注入方抛出的异常都变成 `'unknown'`，不外泄）。 */
function readLifecycle(deps: MemberRuntimeDeps, memberId: MemberId): LifecycleRead {
  try {
    return { kind: 'known', lifecycle: deps.lifecycleOf(memberId) }
  } catch (error) {
    return { kind: 'unknown', reason: describeError(error) }
  }
}

/**
 * 安全序列化一个可能非法的值（用于错误信息构造，保证自身绝不抛错，族 C 修复：OCR [3]/[19]）。
 *
 * ## 为什么必须有本函数而不是直接裸调 `JSON.stringify`
 *
 * 走入错误信息构造路径的值，其形状恰恰是**未通过校验**的畸形值：
 * - `BigInt`（如 `1n`）传入 `JSON.stringify` 会抛 `TypeError: Do not know how to serialize a BigInt`；
 * - 循环引用对象（如 `a.self = a`）传入 `JSON.stringify` 会抛 `TypeError: Converting circular structure to JSON`；
 * - `Symbol` / 自定义抛错的 `toJSON` 等亦同理。
 *
 * `notify()` 和 `activate()` 的契约是「绝不抛错，预期内失败一律返回结构化结果」。
 * 若错误信息的拼接过程本身抛出异常，TypeError 就会逃出 notify 冲进宿主的事件派发路径。
 *
 * 参照本包既有守卫风格（`src/naming.ts` 的 `describeValue` 与 `src/tools/internal.ts` 的 `renderValueForMessage`）：
 * 1. 对确定安全的原始值（null / undefined / boolean / number / bigint / string）做针对性处理；
 * 2. 对 object / function 等复杂对象，在 `try/catch` 保护下执行 `JSON.stringify`；
 * 3. 失败时降级返回安全描述（如 `[无法序列化的 ${typeName}]`），绝不让序列化本身向外抛错。
 */
function safeStringify(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') {
    try {
      return JSON.stringify(value)
    } catch {
      return `"${value}"`
    }
  }
  const typeName = typeof value
  try {
    const json = JSON.stringify(value)
    if (typeof json === 'string') return json
    return `[${typeName}]`
  } catch {
    return `[无法序列化的 ${typeName}]`
  }
}

/**
 * 校验通知的**结构**形状；返回 `null` 表示合法，否则返回拒绝理由。
 *
 * ## 为什么抽成纯函数并在 `notify` **最前面**调用（OCR 复核 LOW，本处曾是真缺口）
 *
 * 原先的形状校验排在**句柄门之后**，于是 `notify(某个没有活句柄的成员, 非法通知)`
 * 返回的是 `no-handle` 而不是 `invalid-notice` —— 调用方**构造通知的 bug**
 * 在"该成员恰好没句柄"时完全静默（只回一句 no-handle，不告警、不指出输入错在哪）。
 * 讽刺的是那正是诊断信息最该出现的场合。
 * 现在输入校验先于成员状态 ⇒ 无论成员处于什么状态，**输入错误一律如实报 `invalid-notice`**。
 *
 * 抽成纯函数而不是内联：它同时被 `notify` 调用与测试直接调用，
 * 且"什么算非法输入"的判据只该有一份（内联在长方法里迟早会与 `isPendingItem` 分叉）。
 *
 * 注意本函数**只判形状**，不判"空待办"或"空正文"——那些是**语义**上的"无需投递"，
 * 由 `notify` 在句柄门之后处理（它们需要句柄上下文才能给出准确结论，且空待办还带副作用）。
 */
function validateNoticeShape(notice: unknown): string | null {
  if (notice === null || typeof notice !== 'object') {
    return (
      `notice 必须是非 null 对象，收到 ${notice === null ? 'null' : typeof notice}。` +
      '（本方法运行在事件派发路径上，对非法输入一律以返回值拒绝、绝不抛错。）'
    )
  }
  const items: unknown = (notice as { items?: unknown }).items
  if (!Array.isArray(items)) {
    return `notice.items 必须是数组，收到 ${items === null ? 'null' : typeof items}。`
  }
  for (const item of items) {
    if (!isPendingItem(item)) {
      // 见 `noticeSignatureOf` 的说明：形状不对的序号字段会被 JSON 写成 null，
      // 从而让**不同的**待办算出同一个签名而互相冒充。故在算签名之前拦住。
      // 族 C 修复（OCR [3]）：item 序列化过 safeStringify（内部带 try/catch 兜底），
      // 避免循环引用或 BigInt 输入导致 TypeError 逃出 notify()。
      return (
        `notice.items 含形状非法的待办项（需要 { ref: 非空 string, revision / unreadCount / `
        + `newestSequence: 非负安全整数 }）：${safeStringify(item)}。`
        + '（若放行，NaN/Infinity 会被 JSON 写成 null，使不同的待办算出同一个签名而互相冒充。）'
      )
    }
  }
  const text: unknown = (notice as { text?: unknown }).text
  // ⚠ `text` 必须是字符串，**非字符串要如实拒绝**（OCR 复核 HIGH，本处曾是真缺陷，已实测）。
  //
  // 第一版这里写成"空正文不是 bug，返回 null"—— 但它把 `typeof text !== 'string'` 与
  // "空串/纯空白"混成了一件事，于是 `text: 42` **过校验**，随后 `notify` 里执行
  // `notice.text.trim()` 抛 `TypeError: notice.text.trim is not a function`，
  // 从事件派发路径冲出去 —— 正是本函数声称要堵住的那类失败。
  // 实测（修前，五种输入**全部抛**）：`42` / `null` / `undefined` / `{}` / `['x']`。
  //
  // 两者的区别是**形状**与**语义**：
  //   · `text` 不是字符串 ⇒ **形状非法**（调用方 bug）⇒ 在这里拒成 `invalid-notice`；
  //   · `text` 是空串/纯空白 ⇒ **形状合法**、只是"这次不值得投递" ⇒ 返回 null，
  //     由 `notify` 落 `nothing-pending`（那是语义判断，需要句柄上下文）。
  if (typeof text !== 'string') {
    return `notice.text 必须是字符串，收到 ${text === null ? 'null' : typeof text}。`
  }
  return null
}

/**
 * 待办集合的去重签名（纯函数，导出以便单独测）。
 *
 * ## 为什么按 `ref` **排序**再序列化（与上游的差别，有理由）
 *
 * 上游直接 `JSON.stringify(notifications.map(...))`，签名对**枚举顺序敏感**。
 * 那么同一组待办只要投影层的枚举顺序变了（换一处分页、换一个 Map 迭代顺序），
 * 签名就变 ⇒ 同一条待办被再推一次 ⇒ 成员被白开一个 turn。
 * 而 turn 是**成员最贵的资源**（一次完整模型调用），且「重复打扰」没有任何可观测的报错。
 * 按 `ref` 规范排序后，同一组待办只有**一个**签名。`ref` 是待办的唯一标识，
 * 故排序键唯一确定（同一 `ref` 出现两次的输入本身就是调用方的缺陷，
 * 排序不会掩盖它：两条都在签名里）。
 *
 * ## 为什么字段必须是安全整数（不是洁癖）
 *
 * `JSON.stringify` 把 `NaN` / `Infinity` 写成 `null`。于是
 * `{revision: NaN, unreadCount: NaN, newestSequence: NaN}` 与另一条**完全不同**的待办
 * 会算出**同一个**签名 `[["a",null,null,null]]` ⇒ 第二条被当成"重复"而**静默丢弃**：
 * 成员永远收不到它，而且账本上看不出任何异常。
 * 因此 `notify` 在算签名**之前**就把形状不对的待办判成 `invalid-notice`（响亮失败），
 * 而不是让签名把一个类型错误吸收成一个去重结论。
 *
 * ## ⚠ 前置条件：每一项都必须是**形状合法**的 `MemberPendingItem`
 *
 * 本函数**自己不做校验**（OCR 复核 LOW 指出，属**有意**设计、非疏漏）：
 * 它是纯函数，校验的唯一入口是 `notify` 的 `validateNoticeShape`。
 * 直接用裸输入调用它（例如"单独测它"）会**静默**得到一个可能与别组冲突的签名 ——
 * 正是上面那段说的 NaN→null 冒充。
 * 之所以不在函数内重复校验：那会让"什么算合法"有两份判据，而两份迟早分叉；
 * 且纯函数做校验会把"校验失败"变成返回值/异常，需要调用方再处理一轮。
 * 若将来确实出现"外部直接用裸输入调用"的场景（目前没有），
 * 证据会是**两个不同待办算出了同一个签名** —— 那时再来这里加断言。
 */
export function noticeSignatureOf(items: readonly MemberPendingItem[]): string {
  const tuples = items.map(
    (item) =>
      [item.ref, item.revision, item.unreadCount, item.newestSequence] as readonly [
        string,
        number,
        number,
        number,
      ],
  )
  // ⚠ 排序必须是**全序**，且不得因字段取值而"跳过"某些位置（OCR 复核 MEDIUM，
  // 本处第一版逐字段比较 + `continue` 跳过 undefined，实测有真缺陷）。
  //
  // 实测（`[t1,t2]` 与 `[t2,t1]` 两个签名**不同**）：
  //   t1 = { ref: undefined, revision: 1, ... }
  //   t2 = { ref: 'z',        revision: undefined, ... }
  //   noticeSignatureOf([t1,t2]) = [["z",null,1,1],[null,1,1,1]]   ← 前者被排到后面
  //   noticeSignatureOf([t2,t1]) = [["z",null,1,1],[null,1,1,1]] 的同组反序
  // 成因：`continue` 在一个位置遇到 undefined 就跳过该位置，于是 `compare(a,b)` 与
  // `compare(b,a)` 可能**都**返回 0，比较器不再是全序 ⇒ `Array.prototype.sort` 的结果
  // 依赖输入顺序 ⇒ 签名对顺序敏感 —— 正是本函数要消除的那件事。
  //
  // 修法：把每个元组先序列化成**单条字符串**，再按字符串排序。
  // 这样比较的是同类型（string vs string），不存在"跳到下一个位置"，天然是全序；
  // `undefined` 被 `JSON.stringify` 稳定地写成 `null`（实测上面的输出里就是 `null`），
  // 于是任何输入都有确定顺序。
  //
  // 为什么不按字段逐项比较并显式处理 undefined：那要把"类型不同怎么比"的规则全部写出来，
  // 而序列化字符串已由语言定义为全序 —— 少一套需要维护的规则。
  // 为什么不用 `localeCompare`：它依赖语言环境，反而会让"同一个签名"在不同机器上不同。
  const keys = tuples.map((tuple) => JSON.stringify(tuple))
  keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(keys)
}

// ────────────────────────────────────────────────────────────────────────────
// 依赖端口与结果
// ────────────────────────────────────────────────────────────────────────────

/**
 * 成员 Agent 的装配点（宿主侧 `agents.create(setup)` 的 `setup` 形参）。
 *
 * `agentContext` 是 `unknown`：本模块不消费它，只把它原样交给注入的
 * `mountPreset` / `applyToolPolicy`（它们是宿主侧对 `preset.mount` / `tools.restrict`
 * 的适配）。**本模块不假装知道那些服务的形状** —— 它只负责**顺序**：
 * 先挂 preset，再注入工具策略（上游 `index.ts:2392-2402` 的 `setup` 正是这个顺序）。
 * 顺序反了的话，工具策略会被随 preset 挂载的注册覆盖掉，而两种顺序都不会报错。
 */
export interface MemberAgentSetup {
  readonly memberId: MemberId
  readonly agentContext: unknown
}

/** 诊断日志端口（可选）。降级事实由**返回值**如实回报，这里只是给宿主额外的通道。 */
export interface MemberLogger {
  warn(message: string): void
}

/** 运行时的注入端口。 */
export interface MemberRuntimeDeps {
  /** 挂载成员 preset（`await` 与否由实现决定；本模块统一 `await`）。 */
  readonly mountPreset: (setup: MemberAgentSetup, presetId: string) => Promise<void> | void
  /**
   * 把成员的工具策略注入该成员 Agent 的上下文。
   *
   * 只在 `allow` **非空**时被调用（空清单连入口都过不了，见 `normalizeToolPolicy`）。
   */
  readonly applyToolPolicy: (setup: MemberAgentSetup, allow: readonly string[]) => void
  /**
   * 创建一个成员 Agent 句柄。
   *
   * ## 实现方**必须**遵守的接线约定
   *
   * 1. `setup` 必须在创建完成前被调用**恰好一次**，且其 `agentContext` 必须是**该成员自己的**
   *    那层上下文（不是宿主根上下文）—— 否则工具策略会落到全局，把每个成员的权限一起改掉。
   *    本模块会检测「`createHandle` 解析成功但从未调用 `setup`」并判激活失败
   *    （那种情况下的成员既没有 preset 也没有策略，却会显示为"已激活"）。
   * 2. 返回的句柄形状必须满足 `MemberHandle`；否则本模块判失败并**不缓存**它。
   *
   * 本模块无法单方面保证第 1 条（`createHandle` 是注入的），故把它写成**文档化的约定**
   * 并加一条运行时探测 —— 与 `src/delegation.ts` 对 `createTeam` 的处置同一思路：
   * 约定写在注入点上，残余风险如实标注，而不是留一段假装解决问题的代码。
   */
  readonly createHandle: (input: {
    readonly memberId: MemberId
    readonly presetId: string
    readonly setup: (setup: MemberAgentSetup) => Promise<void>
  }) => Promise<MemberHandle>
  /**
   * 读一个成员**当前的**生命周期（账本投影）。
   *
   * `null` = 账本不认识这个成员（从未 `team/member-added`）。
   * 宿主应把它绑定到账本事实的折叠（`team/member-added` → `active`，
   * `team/member-suspended` → `suspended`，`team/member-resumed` → `active`，
   * `team/member-destroyed` → `destroyed`）。
   *
   * **不在本模块缓存**：缓存会让"账本已挂起、运行时还活着"这种分叉变得可发生，
   * 而那种分叉的表现是"挂起了的成员还在被唤醒"。
   */
  readonly lifecycleOf: (memberId: MemberId) => MemberLifecycle | null
  /** 可选诊断日志。 */
  readonly logger?: MemberLogger | undefined
}

/** 成员的工具策略（对应上游 `member.capabilities?.tools?.allow`）。 */
export interface MemberToolPolicy {
  /**
   * 允许的工具名清单。
   * - 省略（或整个 `toolPolicy` 省略）⇒ **不注入任何限制**；
   * - 给出数组 ⇒ 注入该清单（去重、保持原顺序）。
   *
   * ⚠ 给出**空数组**是非法输入（`invalid-policy`），不是"不限制"也不是"全禁"——理由见
   * `normalizeToolPolicy`。
   */
  readonly allow?: readonly string[] | undefined
}

/** `activate()` 的输入。 */
export interface MemberActivationInput {
  readonly memberId: MemberId
  /** 成员所属团（诊断用；**不是**唤醒锚点 —— 本模块没有任何会话锚点）。 */
  readonly teamId: TeamId
  /** 要挂载的成员 preset 标识。 */
  readonly presetId: string
  readonly toolPolicy?: MemberToolPolicy | undefined
}

/**
 * 激活结果。
 *
 * **用返回值而非异常**（与 `SpawnOutcome` 同一纪律）：这些都是预期内的结果，
 * 异常会被上层笼统 `catch` 掉，把一个"没激活"变成"看起来激活了"。
 * 逐分支说明见 `runActivation`。
 */
export type MemberActivationOutcome =
  | { readonly kind: 'activated' }
  /**
   * 已有活句柄：**不重复创建**（否则一个成员会跑两个 Agent，turns 与费用翻倍）。
   *
   * ## ⚠ 这条**不**表示"本次入参已生效"（调用方最容易读错的一点）
   *
   * 它只说"该成员已有一个活着的 Agent"。若它与本次的 `presetId` / `toolPolicy`
   * **不同**，本模块**不会**重挂也不会报错 —— 在位的仍是先前那套装配。
   * 实测：先 `activate(A)` 成功，再 `activate(B)` ⇒ 返回 `already-active`，
   * 而**没有任何** `mountPreset('B')` 发生（挂载记录为 `[]`）。
   *
   * 这与 `conflicting-activation` 是同一种"返回值没告诉你入参被吞了"的风险，
   * 只是一个在并发窗口、一个在提交之后。把两者都写成明确的返回值，
   * 就是为了让调用方能分辨；**但判断依据只能是"本次入参是否与在位那次一致"**，
   * 而这一点调用方自己知道（它知道自己想挂哪个 preset）。
   *
   * 调用方该怎么做：把 `activated` 当作"本次入参已生效"的**唯一**证据。
   * 拿到 `already-active` 而你需要的是**另一套**装配时，唯一正确的路径是
   * **先 `release(memberId)` 再 `activate(...)`**（实测：release 后 `activate(B)`
   * 返回 `activated`，且真的挂载了 `B`）；**不要**指望再调一次 `activate` 会换装。
   */
  | { readonly kind: 'already-active' }
  /**
   * 运行时正在停用（`releaseAll` 已开始，其语义是**终态**）。
   *
   * 这条不是"防御性"的：没有它，一次在 `releaseAll` 的 await 窗口里发起的激活
   * 会把句柄写回缓存，留下一个停用后仍然活着的 Agent（见 `activate` 与 `releaseAll` 的注释）。
   */
  | { readonly kind: 'releasing'; readonly reason: string }
  /**
   * 该成员**正在以不同装配参数激活中**（并发的同成员 `activate` 传了不同
   * `presetId` / `toolPolicy`）。
   *
   * 与 `already-active` / 复用同参在途的本质区别（OCR 复核 MEDIUM）：
   * 复用**不同参**的在途激活会返回一个 `activated`，而实际挂载的是**先前那次的** preset
   * ⇒ 调用方以为自己的参数生效了（实测：并发 A/B 两次都回 `activated`，实际只挂了 A）。
   * 宁如实拒绝，也不回一个调用方无法分辨的结果。
   *
   * ## 调用方应当怎么处理（实测口径，不是推测）
   *
   * - **可重试，但不是"拿同参原地重试就会成功"**：重试时若仍传**你原来那套**参数，
   *   而在途那次已提交，你会拿到 `already-active`（见该分支的说明）—— 值不是错误，但
   *   **你的参数没被采纳**。真正能让你的参数生效的路径是 `release` 后再 `activate`。
   * - **同参**的在途激活**不**返回本条：它会复用同一次创建并一起拿到 `activated`
   *   （实测：并发同参两次都 `activated`，且 `createHandle` 只被调用 **1** 次）。
   *   所以并发**同参**的调用方无需处理本条，正常 `await` 即可。
   * - 退避建议：本条是**瞬时**冲突（只在该成员那次激活的在途期间成立），
   *   不需要长退避 —— `await` 在途那次结束（或按上面的 release 路径重来）即可。
   *   本模块**不**提供"排队等待并自动换装"，因为换装涉及释放一个正在跑的 Agent，
   *   那是调用方的决策，不该由一次 `activate` 暗中代劳。
   */
  | { readonly kind: 'conflicting-activation'; readonly reason: string }
  /** 账本不认识这个成员。 */
  | { readonly kind: 'unknown-member'; readonly reason: string }
  /** 生命周期不是 `active`（已挂起 / 归档 / 销毁）。 */
  | { readonly kind: 'not-active'; readonly lifecycle: MemberLifecycle }
  /**
   * **生命周期读不出来**（注入的账本投影抛错）。与 `unknown-member` 分开：
   * 前者是"账本明确说没有它"，这里是"我们不知道它是什么状态"。
   * 两条路径都拒绝激活（fail-closed），但原因不同 —— 混成一个 `kind`
   * 会让排查的人去查错误的账本分区。
   */
  | { readonly kind: 'lifecycle-read-failed'; readonly reason: string }
  /** 工具策略非法（空 allow 清单 / 非字符串项）。 */
  | { readonly kind: 'invalid-policy'; readonly reason: string }
  /** 创建或装配失败（`createHandle` 抛错、句柄形状不对、`setup` 未完成）。 */
  | { readonly kind: 'failed'; readonly reason: string }

/** 唤醒结果。`delivered` 带上**实际走的那条通道**，所以分支选择是可断言的。 */
export type MemberWakeOutcome =
  | { readonly kind: 'delivered'; readonly channel: 'followup' | 'steer' }
  /** 同签名已在案：这条待办已经推过，不重复打扰。 */
  | { readonly kind: 'duplicate' }
  /** 没有待办（`items` 为空），或通知没有正文。 */
  | { readonly kind: 'nothing-pending' }
  /** 没有活句柄（未激活 / 已挂起 / 句柄已丢失）。**安全降级，不抛错。** */
  | { readonly kind: 'no-handle' }
  /** 生命周期不是 `active`。`lifecycle` 为 `null` 时表示账本不认识该成员。 */
  | { readonly kind: 'not-active'; readonly lifecycle: MemberLifecycle | null }
  /** 生命周期读不出来（注入的账本投影抛错）；保守拒绝唤醒，**不抛错**。 */
  | { readonly kind: 'lifecycle-read-failed'; readonly reason: string }
  /** 待办事实形状非法（详见 `invalid-notice` 的判定依据）。 */
  | { readonly kind: 'invalid-notice'; readonly reason: string }
  /** 投递时 Agent 抛错。**已从通知路径里隔离**，不让它冲进调用方（通常是事件派发路径）。 */
  | {
      readonly kind: 'delivery-failed'
      readonly channel: 'followup' | 'steer'
      readonly reason: string
    }

// ────────────────────────────────────────────────────────────────────────────
// 运行时接口
// ────────────────────────────────────────────────────────────────────────────

/**
 * 成员运行时（会话内单例）。
 *
 * 所有方法都**不抛错**：预期内的失败以返回值如实回报（`MemberActivationOutcome` /
 * `MemberWakeOutcome` / `handleOf` 的 `undefined`）。理由不是"宽容"，
 * 而是 `notify` 常常运行在**事件派发路径**上（宿主的状态回调里）——
 * 那里抛出的异常会冲进派发层，与「本插件不可用是可接受的降级，拖垮别的插件不是」
 * 是同一条纪律（`src/host.ts` 文件头第 3 条）。
 */
export interface MemberRuntime {
  /** 激活一个成员：挂 preset → 注入工具策略 → 创建句柄 → 缓存。 */
  activate(input: MemberActivationInput): Promise<MemberActivationOutcome>

  /** 双通道唤醒。见 `MemberWakeOutcome` 与 `channelForBusyness`。 */
  notify(memberId: MemberId, notice: MemberNotice): MemberWakeOutcome

  /** 存在态：读活句柄的**实时** `agent.status`（无活句柄 ⇒ `'idle'`，即"不在跑"）。 */
  presenceOf(memberId: MemberId): MemberPresence

  /** 活句柄（形状守卫已过）；没有/形状不对 ⇒ `undefined`。 */
  handleOf(memberId: MemberId): MemberHandle | undefined

  /** 当前有活句柄的成员（宿主用来枚举"谁真的活着"）。顺序为插入顺序。 */
  liveMemberIds(): readonly MemberId[]

  /**
   * 释放一个成员的句柄（挂起 / 销毁路径调用）。**幂等、不抛错。**
   *
   * @returns 缓存里是否确实有一个活句柄被摘除。
   */
  release(memberId: MemberId): Promise<boolean>

  /** 释放全部句柄并清空内部状态（插件停用 / 进程收尾；副作用必须可逆）。 */
  releaseAll(): Promise<void>
}

// ────────────────────────────────────────────────────────────────────────────
// 内部工具
// ────────────────────────────────────────────────────────────────────────────

/** 统一把一个 `catch` 到的值变成可读文本。 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 两份工具策略是否**等价**（用于判"并发的同成员激活能否共享在途那一次"）。
 *
 * 只比 `allow` 的**内容与顺序** —— 顺序有意义（见 `normalizeToolPolicy` 的说明：
 * 越靠前越"顺位"），所以不排序、不做集合化。
 * `allow` 为 `undefined`（省略）与空数组**不等价**：前者是"不注入限制"，
 * 后者会被 `normalizeToolPolicy` 判非法 —— 两者语义相反，绝不能在这里被当成同一件事。
 * （空数组那条其实到不了这里：`runActivation` 之前的校验…… 严格说校验在 `runActivation`
 *  内部、而本函数在 `activate` 里被调用 —— 故这里仍按"字符串完全相同"判，
 *  不依赖那条校验，免得将来校验挪位置时这里静默放宽。）
 */
function sameToolPolicy(
  left: MemberToolPolicy | undefined,
  right: MemberToolPolicy | undefined,
): boolean {
  const a = left?.allow
  const b = right?.allow
  if (a === undefined || b === undefined) return a === b
  return a.length === b.length && a.every((name, index) => name === b[index])
}

/**
 * 「句柄已被丢弃」这类失败的统一文案。
 *
 * 抽出来的理由（OCR 复核 LOW）：这句话原先在两条 return 分支里各写一份，
 * 两份又只在"原因"处不同 —— 改一处忘另一处，就会出现同一种失败对调用方
 * 说两种话。现在原因与**后果**都由调用方给，骨架只有这一份。
 *
 * ⚠ `consequence` 必须由调用方按**它确实知道的事实**给（OCR 复核 MEDIUM）：
 * 原先把"这个 Agent 会以宿主默认面运行"写死在这条尾巴里，但那句话对
 * `setup` 从未被调用（`'none'`）的分支是**未经证实的断言** ——
 * 那种情况下 Agent 很可能压根没被装配/启动，"会以宿主默认面运行"把后果说轻了。
 * 现在两种成因各给自己的后果，谁也不替谁说话。
 */
function buildDiscardedHandleReason(cause: string, consequence: string): string {
  return `${cause} —— ${consequence}已丢弃该句柄、未写入缓存。`
}

/**
 * 本模块全部诊断日志的前缀。
 *
 * ⚠ 取值与 `src/host.ts` 里的字面量（`'[sophia] …'`）**逐字一致**，
 * 这是 OCR 复核 LOW 的修复点：本模块原先用 `'sophia:'`、host 用 `'[sophia]'`，
 * 同一插件的日志因此有两种写法 —— 运维 `grep '[sophia]'` 会**漏掉本模块的全部告警**
 *（而本模块的告警恰恰是「成员句柄 dispose 失败」「通知投递失败」这类最需要被看到的）。
 *
 * 为什么只在本文件收敛、不去改 `host.ts`：那是 t1 的交付物（不在本任务的 inScope），
 * 而且 t4 正在把工具集接进宿主半、会碰那些文件。**把本文件对齐到既有约定**
 * 就能达成 grep 一致性，不需要动别人的文件；等 t7 集成时若还要抽共享常量，
 * 正确位置是本包的一个中立模块（如 `src/plugin-name`），而不是让它散在两处字面量里。
 */
const LOG_PREFIX = '[sophia]'

/**
 * 句柄的结构守卫。
 *
 * 存在的理由与 `src/host.ts` 的 `asWebServer` 逐字同类：**读不到就判不可用，
 * 不要当成通过**。这里额外一层含义是"句柄可能丢失或坏掉"——
 * 缓存里存的是 `unknown`，每次读取都过守卫，于是
 * 「拿到的对象其实已经不是那个句柄了」（SDK 升级、宿主提前 dispose、
 * 或者 JS 调用方传了个形状不对的东西）会退化成 `undefined` ⇒ 走安全降级分支，
 * 而不是在 `agent.followup(...)` 上抛 `TypeError` 冲进事件派发路径。
 */
function asMemberHandle(value: unknown): MemberHandle | undefined {
  // ⚠ **整个函数体都在 try/catch 里**（OCR 复核 MEDIUM，本处曾是真缺陷，已实测）。
  //
  // 为什么必须包住**全部**属性读取，而不是只护 `status`：
  // 「读属性」在 JS 里**就是执行代码** —— 任何一个是 accessor 的属性都可能抛。
  // 实测四个都是 activity 的 accessor 各试一遍，`activate` **每一个都抛**：
  //   · `followup` 是抛错 getter → 抛
  //   · `steer`    是抛错 getter → 抛
  //   · `agent`    是抛错 getter → 抛
  //   · `dispose`  是抛错 getter → 抛
  // 而本守卫是所有读取路径的必经之处 ⇒ 任何一个属性抛，`activate` / `notify` /
  // `presenceOf` / `liveMemberIds` / `handleOf` 会**一起**变成抛错点，
  // 违反 `MemberRuntime` 文档写明的"所有方法都不抛错"（`notify` 更是跑在事件派发路径上）。
  //
  // 为什么只护 `status` 不够（第一版就是这么写的）：那只堵住了一个属性，
  // 而失效模式对**任意**属性成立 —— 修一处、漏四处，且漏掉的那几处在测试里看不出来。
  //
  // 语义与文件头一致：**读不到就判不可用，不要当成通过**。
  // 一个形状验证过程本身抛错的句柄，就是无法被验证的句柄 ⇒ 返回 `undefined` 走安全降级。
  // （`readHandle` 会为缓存里这种值发出"缓存句柄已失效"的告警，故不会静默。）
  //
  // ⚠⚠ 返回的**必须是一个本函数自己构造的对象**（OCR 复核 HIGH，第三轮，本处曾是真缺陷）：
  // 第一版 `return value as MemberHandle` 只验证了 `value.agent` **当时**可读，
  // 而调用方随后每次写 `handle.agent` 都会**再执行一次 accessor** ——
  // 一个"第 N 次读取开始抛"的 getter 因此能穿过守卫，在**用点**抛出去。
  // 实测（修前，`agent` 是"读若干次后抛"的 getter）：
  //   · 第 2 次读取起抛 → `presenceOf` **抛**
  //   · 第 4 次读取起抛 → `notify` **抛**（`handle.agent` 读在投递的 try 之外）
  // 两者都跑在宿主的派发/渲染路径上 ⇒ 违反"所有方法都不抛错"。
  //
  // 修法：在这里把 `agent` / `dispose` **各读一次**并固化进一个新字面量。
  // 此后 `handle.agent` 是**本模块自己对象上的普通数据属性** ⇒ 再读也不会执行任何
  // accessor，不可能抛。而 `agent` 指向的**仍是原来的对象**（不是拷贝），
  // 所以 `handle.agent.status` 读到的是**活的**状态、`followup`/`steer` 也是活的 ——
  // 双通道唤醒依赖的"实时忙碌度"没有被快照掉（这是不能拷贝 `status` 的原因：
  // 拷贝会让一个已转 running 的 Agent 永远显示 idle）。
  try {
    if (typeof value !== 'object' || value === null) return undefined
    const candidate = value as { agent?: unknown; dispose?: unknown }
    const dispose = candidate.dispose
    if (typeof dispose !== 'function') return undefined
    const agent = candidate.agent
    if (typeof agent !== 'object' || agent === null) return undefined
    const inner = agent as Record<string, unknown>
    if (typeof inner['id'] !== 'string') return undefined
    if (typeof inner['status'] !== 'string') return undefined
    const followup = inner['followup']
    const steer = inner['steer']
    if (typeof followup !== 'function') return undefined
    if (typeof steer !== 'function') return undefined
    // 固化：`agent` 与 `dispose` 都只在上面的 try 里读过这一次。
    //
    // ⚠ `dispose` 必须 **bind 回原对象**（OCR 复核 HIGH，本轮实测复现的**新**缺陷）：
    // 第一版直接放裸函数引用，于是 `handleOf(m).dispose()` 的 `this` 会是**包装对象**，
    // 而不是原来的句柄 —— 类风格实现（`dispose() { this.sessionId... }`）会
    // 抛 `TypeError` 或**静默什么都没释放**。
    // 实测（修前）：`wrapper.dispose()` 抛 `TypeError: dispose 的 this 不对`。
    // （`release()` 路径不受影响：它走 `disposeQuietly(raw)` 用的是**原始**值，
    //   实测 release 正常。受影响的只有从这里暴露出去的包装对象。
    //   但 `handleOf` 是公开面 —— 调用方拿它调 `dispose` 是合理用法，不能坏。）
    // bind 之后 `this` 语义与"在原对象上调用"**等价**，这正是包装该保留的。
    return {
      agent: agent as MemberAgent,
      dispose: (dispose as MemberHandle['dispose']).bind(value),
    }
  } catch {
    return undefined
  }
}

/**
 * 「能 dispose 的东西」——比 `asMemberHandle` **宽**：只要求 `dispose()` 可调用。
 *
 * 单独一个判据的理由（这是实测踩出来的，不是洁癖）：被丢弃的句柄恰恰常常是
 * **形状不合法**的那些（agent 缺 `followup` / 缺 `steer` / 少了整个 agent），
 * 而它们**仍然持有真实资源**（一个 Session、一张订阅）。用完整守卫去判"要不要 dispose"，
 * 就会把最需要释放的那一类判成"无从释放"而直接泄漏。
 * 实测：`tests/runtime.spec.ts` 的「句柄形状不合法 ⇒ 丢弃并释放」用例在我第一版
 * （用 `asMemberHandle` 判）上变红，`disposed` 停在 0。
 *
 * ⚠ **函数形状也要接受**（OCR 复核 MEDIUM，本处曾是真缺陷）：
 * `typeof fn === 'function'`，不是 `'object'`。JS 里"可调用对象"（带属性的函数、
 * 某些 Proxy / 工厂产物）是完全合法的句柄形状，而第一版只放行 `object` ⇒
 * 这种句柄走不进 disposeQuietly，`dispose()` 从不被调用 ⇒ **静默泄漏**。
 * 实测：把 `dispose` 挂在一个函数上，`activate` 返 `failed`（形状守卫正确地拒了它，
 * 因为它的 `agent` 形状不合法），但 `dispose` 调用次数为 **0** —— 本该释放却没有。
 *
 * 两个判据**不可合并**：`asMemberHandle` 回答"能不能用它"，本函数回答"要不要释放它"。
 */
function asDisposable(value: unknown): { dispose(): Promise<void> | void } | undefined {
  // 与 `asMemberHandle` 同理：属性读取会执行 accessor，可能抛 ⇒ 整体包 try/catch。
  // 这里只读一个属性，但它同样可能是抛错的 getter（实测口径见 `asMemberHandle`）。
  try {
    if (value === null) return undefined
    const kind = typeof value
    if (kind !== 'object' && kind !== 'function') return undefined
    const candidate = value as { dispose?: unknown }
    return typeof candidate.dispose === 'function'
      ? (value as { dispose(): Promise<void> | void })
      : undefined
  } catch {
    return undefined
  }
}

/**
 * 读一个 agent 的**是否正忙**，**保证不抛错**（OCR 复核 [18]/[26] 的共同根因，见下）。
 *
 * ## 为什么必须有这一个函数（这是第五轮 OCR 抓到的真缺陷，实测范围比报告更大）
 *
 * `status` 在真实 SDK 里是**派生 getter**（`dsh-agent-loop/lib/index.js:773`：
 * `get status() { return this.phase.kind === 'idle' || ... }`）—— 也就是说
 * **读它就是在执行代码**，而执行代码会抛。实测：把 getter 换成抛错的实现后，
 * 泄漏的不止报告指出的两处，而是**五处**：
 *
 * | 入口 | 实测结果 |
 * |---|---|
 * | `activate` | **抛**（`asMemberHandle` 判形状时读 status） |
 * | `notify` | **抛** —— 违反"从不抛错"契约，且它跑在事件派发路径上 |
 * | `presenceOf` | **抛** |
 * | `liveMemberIds` | **抛**（内部逐个走 `readHandle`） |
 * | `handleOf` | **抛**（同上） |
 *
 * 根因是**形状守卫自己调用了那个 getter**（`typeof inner['status'] !== 'string'`
 * 会触发 getter）⇒ 一个抛错的 getter 让守卫本身变成抛错点，于是每个走守卫的入口一起炸。
 * 只按报告那样"把 channel 计算移进 try"只能堵住 `notify` 一处，
 * 另外四个入口照旧 —— 所以修在这里（唯一读取点），而不是逐个打补丁。
 *
 * 返回 `undefined` = **读不出来**（getter 抛错，或返回值不是字符串）。
 * 调用方必须把 `undefined` 当成"正忙"处理（理由见 `channelForBusyness` 与
 * `isBusyStatus` 的代价不对称论证），且 `presenceOf` 也必须如此 —— 两者的结论
 * 由**同一个返回值派生**，所以在结构上不可能互相打脸。
 */
function readBusyness(agent: MemberAgent): boolean | undefined {
  let status: unknown
  try {
    status = agent.status
  } catch {
    // getter 内部炸了（phase 损坏、SDK 换代）⇒ 不猜它的状态。
    return undefined
  }
  if (typeof status !== 'string') return undefined
  return isBusyStatus(status)
}

/**
 * 成员是否**正忙**——**唯一**的存在态判据。
 *
 * ## 为什么必须只有一个判据（OCR 复核 LOW，本处曾是真不一致）
 *
 * 修之前有两处各自判一次：`wakeChannelFor` 用 `status === 'idle' ? 'followup' : 'steer'`，
 * 而 `presenceOf` 用 `status === 'running' ? 'running' : 'idle'`。两者在
 * `'idle'` / `'running'` 上一致，但对**任何其他** status 会给出矛盾的回答。
 * 修**前**的实测（本机跑 `paused` / `maintenance` 两个 status）：
 *
 * | status | presenceOf（修前） | 实际通道 | 矛盾 |
 * |---|---|---|---|
 * | `idle` | `idle` | `followup` | 否 |
 * | `running` | `running` | `steer` | 否 |
 * | `paused` | **`idle`** | **`steer`** | **是** |
 * | `maintenance` | **`idle`** | **`steer`** | **是** |
 *
 * 也就是说界面会把一个"正忙"的成员显示成空闲，同时运行时往它的步骤边界投消息 ——
 * 两处结论互相打脸。现在两处都由本函数派生 ⇒ 结构上不可能再分歧。
 *
 * ## 修**后**的口径，以及与 SDK 的**有意偏离**（OCR 复核 LOW：必须写明，否则读者会当成 bug）
 *
 * 本函数把**一切非 `idle`** 都读作正忙，于是 `maintenance` 在本模块里是
 * `presence=running` + `steer`；而 SDK 自己的 `status` getter
 * （`dsh-agent-loop/lib/index.js:773`）把 `maintenance` 归并成 `'idle'`。**这是刻意偏离**：
 * 1. 本模块的目标是**自洽**（presence 与投递通道不能互相打脸），不是复刻 SDK 的归并口径；
 *    复刻它反而会把上面那张矛盾表重新引回来（presence 说 idle、通道说 steer）。
 * 2. 偏离的代价不对称且落在安全的一侧：把 `maintenance` 当正忙 ⇒ 消息投进
 *    `next-step` 而不是开一个新 turn，**不会丢消息**（两条通道都带 wakeup），
 *    只是落点不同；而判错成 idle 会**多烧一个完整 turn**。
 * 3. `phase.kind === 'maintenance'` 期间 SDK 本来就在跑一段维护 job 并持有 abort
 *    controller ——"它没在跑成员自己的 turn"与"它不能接收步骤边界消息"是两件事，
 *    本模块只依赖后者。
 *
 * 若将来 SDK 新增 phase，本函数**不需要**跟着改：新的未知 phase 自动落在"正忙"侧，
 * 与通道选择保持同一结论。**读不出来**（`undefined`）同样落"正忙"侧。
 */
function isBusyStatus(status: string): boolean {
  return status !== 'idle'
}

/**
 * 「是否正忙」→ 投递通道：`idle` ⇒ `followup`，其余（含**读不出来**）⇒ `steer`。
 *
 * `'idle'` ⇒ `followup`（`send(input, 'next-turn', true)`，开新 turn）；
 * 其余 ⇒ `steer`（`send(input, 'next-step', true)`，投进最近步骤边界）。
 * 两条通道实测都带 `wakeup`（`dsh-agent-loop/lib/index.js:783-797`），
 * 所以未知/读不出来的状态落到 `steer` 也**不会丢消息**，只是落点不同。
 *
 * 为什么未知与读不出来都选 `steer`（刻意的，不是随手）：
 * - 判错的代价不对称 —— 一个**正忙**的成员被喂 `followup` 会开一个**多余的 turn**
 *   （多花一次完整模型调用）；而一个**空闲**的成员被喂 `steer` 只是消息落进 `next-step`，
 *   而它此刻本来没有 turn 在跑，`wakeDriver` 会为它开一个（实测同文件 `:837-852`）。
 * - `status` 在真实实现里只有 `idle` / `running` 两个取值（同文件 `:773-774`），
 *   "未知状态"意味着 SDK 变了 —— 此时选**不额外烧一次 turn** 的那一边。
 *   同理 `presenceOf` 也把它读作"正忙"，与这里保持同一个结论。
 */
function channelForBusyness(busy: boolean | undefined): 'followup' | 'steer' {
  return busy === false ? 'followup' : 'steer'
}

/** 工具策略的归一化结果。 */
type NormalizedPolicy =
  | { readonly kind: 'ok'; readonly allow: readonly string[] | undefined }
  | { readonly kind: 'invalid'; readonly reason: string }

/**
 * 工具策略校验 + 去重。
 *
 * ## 为什么空清单是**非法输入**而不是"不限制"或"全禁"
 *
 * `[]` 有两种读法，后果**相反且都很严重**：
 * - 读成"不限制" ⇒ 成员拿到**全部**工具，而调用方以为它什么都没拿到（**越权**）；
 * - 读成"一个工具都不给" ⇒ 成员激活成功却什么也干不了（**哑成员**，且没有任何报错）。
 * 两者都是静默的。所以不猜：判输入非法，让失败响亮。
 *
 * 上游 `member-runtime.ts:153` 的处置是 `if (allow.length === 0) return`
 * （空 ⇒ 不注入限制），但它那里的空清单是**与固定工具名并集之后**的结果
 * （`:152` 的 `[...configured.filter(...), ...AGENT_TEAM_TOOL_NAMES]`），
 * 永远非空；本模块没有那份固定并集，因此不能照抄那个分支。
 *
 * 去重是必需的：重复项会让注入实现（真实 `tools.restrict`）拿到一份本不该重复的清单，
 * 而重复在**权限**语境下应当被消解而不是原样传递。保持原顺序（不排序）——
 * 工具清单的顺序可能对提示词渲染有意义（越靠前越"顺位"），那属于调用方的意图。
 */
function normalizeToolPolicy(policy: MemberToolPolicy | undefined): NormalizedPolicy {
  if (policy === undefined) return { kind: 'ok', allow: undefined }
  const allow = policy.allow
  if (allow === undefined) return { kind: 'ok', allow: undefined }
  if (!Array.isArray(allow)) {
    return {
      kind: 'invalid',
      reason:
        'toolPolicy.allow 必须是字符串数组或省略，收到 ' +
        `${allow === null ? 'null' : typeof allow}。`,
    }
  }
  for (const name of allow) {
    if (typeof name !== 'string' || name.trim() === '') {
      // 族 C 修复（OCR [19]）：name 序列化过 safeStringify（内部带 try/catch 兜底），
      // 避免 1n (BigInt) 或循环引用对象在此处让 JSON.stringify 自己抛 TypeError 逃出 activate()。
      return {
        kind: 'invalid',
        reason:
          `toolPolicy.allow 含非法工具名 ${safeStringify(name)}：` +
          '工具名必须是非空字符串（空串会让注入实现把它当成一个真实名字去匹配）。',
      }
    }
  }
  // ⚠ 必须先 **trim 再** 去重（OCR 复核 LOW，本处曾是真缺陷）：
  // 上半段的校验用 `name.trim() === ''` 判"是不是空白"，若这里直接 `new Set(allow)`，
  // 那么 `' a '` 能过校验、并被**原样**交给 `applyToolPolicy` —— 而真实
  // `tools.restrict` 是按名字**精确匹配**的，于是 `' a '` 与名为 `'a'` 的工具
  // **静默失配**：成员以为自己被授予了 a，实际一个都没匹配上（也**不报错**）。
  //
  // 反过来（只 trim 不校验）也不行：`'   '` 会被裁成空串，那是另一个需要显式拒绝的形状。
  // 所以顺序是：**校验 → 裁剪 → 去重**。
  //
  // 顺带修掉一个易被忽略的后果：不裁剪时 `'a'` 与 `' a '` 会被当成两个不同工具名，
  // 去重也就跟着失效（同一工具在清单里出现两次，违反本函数"重复项必须被消解"的承诺）。
  const normalized = allow.map((name) => name.trim())
  const deduped = [...new Set(normalized)]
  if (deduped.length === 0) {
    return {
      kind: 'invalid',
      reason:
        'toolPolicy.allow 是空数组 —— 它既可能想表达"不限制"（成员实得全部工具＝越权），' +
        '也可能想表达"一个工具都不给"（成员激活成功却什么也干不了），两者后果相反且都很严重。' +
        '请改为省略该字段（不注入限制），或给出至少一个工具名。',
    }
  }
  return { kind: 'ok', allow: Object.freeze(deduped) }
}

// ────────────────────────────────────────────────────────────────────────────
// 工厂
// ────────────────────────────────────────────────────────────────────────────

/**
 * 创建一个成员运行时。
 *
 * 用工厂 + 闭包而不是 class（与 `src/ledger.ts` 的 `openLedger` 同形）：
 * 内部状态（句柄表、去重表、在途表）只在这一个闭包里，外部拿不到，也就没有
 * 「两个地方各改一半」的分叉面。
 */
export function createMemberRuntime(deps: MemberRuntimeDeps): MemberRuntime {
  /**
   * `memberId → 活句柄`。值刻意是 `unknown`：缓存里存的东西**不可信**，
   * 每次读都过 `asMemberHandle`（见该函数），这样"句柄坏了"只会降级、不会抛。
   */
  const handles = new Map<MemberId, unknown>()
  /**
   * `memberId → 已成功投递的签名`。
   *
   * 不变量：**表里有值 ⟺ 那个签名确实送达过**。因此写入只发生在投递成功之后
   * （`notify` 末尾），失败的那一次不会把一个没送到的签名记成"已送"而压制重试。
   */
  const deliveredSignatures = new Map<MemberId, string>()
  /** `memberId → 在途激活`（连同它的**装配入参**，用于判"同参才共享"），见 `activate`。 */
  const inFlightActivations = new Map<
    MemberId,
    {
      readonly presetId: string
      readonly toolPolicy: MemberToolPolicy | undefined
      readonly promise: Promise<MemberActivationOutcome>
    }
  >()
  /**
   * 停用中标志（`releaseAll` 的全程为 `true`，永不复位）。
   *
   * **永不复位是有意的**：`releaseAll` 的语义是终态（插件停用 / 进程收尾），
   * 复位会让「停用后又有新句柄冒出来」重新变成可能。若将来真需要"可重启的运行时"，
   * 正确做法是**新建一个实例**（`createMemberRuntime`），而不是让这一个复活 ——
   * 后者会让"这个实例是否还能用"变成一个需要跨方法追踪的状态。
   */
  let releasing = false
  /**
   * 正在被 `release` 排空的成员（按成员粒度）。
   *
   * ⚠ 存在的理由（OCR 复核 HIGH，本处曾是真缺陷，已实测复现）：
   * `release(m)` 原先只是「快照当前那条在途激活 → await 它 → releaseOne(m)」。
   * 但**期间又起了一次** `activate(m)`（现实成因：那次激活失败了，宿主在
   * `catch` 里重试；而 `inFlightActivations` 的条目在失败方的 `finally` 里被删掉，
   * 于是重试会开辟一条**新的**在途记录）时，release 快照到的仍是旧的那条 ——
   * 释放完就返回，而新的那次随后落地并把自己的句柄存进缓存。
   * 实测复现：`release()` 返回 `false`、`handleOf(m)` 仍有值、`dispose` 次数 **0**。
   *
   * 修法是**在排空窗口内拒绝新激活**，而不是"再扫一遍缓存"：
   * 后者只能缩小窗口、不能关闭它（扫描与落地之间仍有 await）。
   * 置位与 `release` 的首个 await 之间没有其他 await ⇒ 不存在交错窗口。
   *
   * 与 `releasing` 的区别（**两者不可合并**）：
   * - `releasing`：全局、**终态**、永不复位（插件停用）⇒ 复用同一条 `releasing` outcome；
   * - 本集合：按成员、**一次性**、在 `finally` 里复位 ⇒ 释放完该成员可被重新激活
   *   （suspend → resume 正是这条路径）。把它并入 `releasing` 会让"挂起过的成员永远不能恢复"。
   */
  const releasingMembers = new Set<MemberId>()
  /** 已就"该成员的缓存句柄失效"告过警的集合（防 `liveMemberIds` 高频枚举时刷屏）。 */
  const corruptHandleWarned = new Set<MemberId>()

  function readHandle(memberId: MemberId): MemberHandle | undefined {
    const raw = handles.get(memberId)
    if (raw === undefined) return undefined
    const handle = asMemberHandle(raw)
    if (handle === undefined) {
      // ⚠ 缓存里有值、但形状守卫判它**不是**句柄 ⇒ 这是一个真实且静默的异常状态
      //（OCR 复核 LOW：原先它只表现为"返回值是 undefined"，与"从未激活"完全同形，
      //  运维在界面上只会看到该成员变回 idle、并从 liveMemberIds 消失，**没有任何提示**）。
      // 本模块在别处都遵守"不静默降级"，这里补一条告警，让"句柄坏了"可被发现。
      //
      // ⚠ **每个成员只告警一次**（OCR 复核 LOW 的第二轮）：本函数被 `liveMemberIds`
      // 在循环里调用，而 `liveMemberIds` 是宿主"枚举谁活着"的高频入口（渲染/轮询路径）。
      // 不去重的话，**每一次**枚举都会对同一个坏句柄再告一次 —— 实测 5 次调用产生 5 条相同告警，
      // 日志被同一条刷屏，反而淹没真正需要被看到的告警。
      // 用 `Set` 记住"已就这个成员告警过"：状态随句柄修复/摘除自然失效（见下面的清除点）。
      if (!corruptHandleWarned.has(memberId)) {
        corruptHandleWarned.add(memberId)
        warn(
          `${LOG_PREFIX} 成员 ${memberId} 的缓存句柄已失效（未通过结构守卫）——` +
          '该成员既不会被唤醒、也不在 liveMemberIds 中。',
        )
      }
      return undefined
    }
    // 句柄恢复健康（重新激活/被替换）⇒ 允许下次再告警。
    // 清在这里而不是"激活成功时"：本函数是唯一读取点，判定与清除放在同一处不会分叉。
    corruptHandleWarned.delete(memberId)
    return handle
  }

  function warn(message: string): void {
    // ⚠ 日志端口**必须**自身兜底（OCR 复核 MEDIUM，本处曾让 releaseAll 中途夭折）：
    // `logger` 是注入的宿主实现，而 `releaseAll` / `releaseOne` / `disposeQuietly`
    // 的清理路径上都会调 `warn` —— 一个会抛的 logger（磁盘满、sink 断了、
    // 宿主自己的 bug）会让**释放流程本身**中断。
    // 实测复现：注入 `warn() { throw }` 的 logger 后调 `releaseAll()`，
    // 它在第一个成员的 dispose 失败处抛出，第二个成员**从未被释放**
    //（`liveMemberIds` 仍含它），而 `releasing` 已置位 ⇒ 运行时卡在"停用中"
    // 且残留活 Agent。清理路径的职责是**把事做完**，不是把诊断通道的故障传出去。
    try {
      deps.logger?.warn(message)
    } catch {
      // 诊断日志写不出去不是业务失败；绝不让它影响控制流。
    }
  }

  /**
   * 真正的激活流程（在途表的注册在 `activate` 里，与本函数分开）。
   *
   * 每一步的失败都映射到一个具体的 `kind`，且**不留部分状态**：只有全绿才 `handles.set`。
   */
  async function runActivation(input: MemberActivationInput): Promise<MemberActivationOutcome> {
    const { memberId, presetId } = input

    // ── 0. 生命周期必须以账本为准 ──
    // 已挂起/归档的成员不该被拉活；账本不认识的成员更不该凭空造出一个 Agent。
    const read = readLifecycle(deps, memberId)
    if (read.kind === 'unknown') {
      // 读不出来 ≠ 不存在（见 LifecycleRead）。保守拒绝，并把原因原样带出。
      return { kind: 'lifecycle-read-failed', reason: read.reason }
    }
    const lifecycle = read.lifecycle
    if (lifecycle === null) {
      return {
        kind: 'unknown-member',
        reason: `账本不认识成员 ${memberId}（没有可投影的成员事实）——拒绝激活。`,
      }
    }
    if (lifecycle !== 'active') {
      return { kind: 'not-active', lifecycle }
    }

    // ── 1. 工具策略（在创建之前校验，免得白建一个 Agent 再发现策略非法）──
    const policy = normalizeToolPolicy(input.toolPolicy)
    if (policy.kind === 'invalid') {
      return { kind: 'invalid-policy', reason: policy.reason }
    }

    // ── 2. 创建句柄：setup 里按固定顺序挂 preset 与工具策略 ──
    //
    // 探测「setup 是否真的**完成**」不是防御性代码，而是针对一类**真实的假成功**：
    // 宿主若把 setup 忘了（或没 await 它），`createHandle` 照样解析成功，
    // 于是成员显示"已激活"、却既没有 preset 也没有工具策略 ——
    // 与 `src/host.ts` 里「只看有没有抛异常会把静默失败读成成功」是同一类问题。
    //
    // ⚠ 记的是**完成**而不是"进入"（OCR 复核 HIGH，本处曾是真缺陷）：
    // 第一版在 setup 函数体**开头**就 `setupCalled = true`，于是
    // 「`mountPreset` 抛错、注入的 `createHandle` 吞掉该异常并照常解析」这条路径
    // 会看到 `setupCalled === true` 而把句柄当成激活成功缓存下来 ——
    // preset 与工具策略**都没生效**，却记成已激活，正是本守卫声称要拦的那种假成功。
    // 现在只有两步都跑完才记 `'completed'`；任一步抛错记 `'failed'` 并把原因带出去。
    type SetupState =
      | { readonly kind: 'none' }
      | { readonly kind: 'completed' }
      | { readonly kind: 'failed'; readonly reason: string }
    let setupState: SetupState = { kind: 'none' }
    /** 读回装配状态；抽成函数是为了切断 `tsc` 对 `setupState` 的错误收窄（见下方说明）。 */
    const readSetupState = (): SetupState => setupState
    let raw: unknown
    try {
      raw = await deps.createHandle({
        memberId,
        presetId,
        setup: async (setup: MemberAgentSetup): Promise<void> => {
          try {
            // ⚠ **先校验 setup 指向的是不是本次要激活的那个成员**（OCR 复核 MEDIUM，已实测）。
            //
            // `setup.memberId` 是**本模块自己**传进去的入参（见上面的 `memberId`），
            // 它不该由实现方回传一份可能不同的值 —— 但它的**类型**只是一个 `MemberId`，
            // 逃逸的 `as` / 复用了另一个 setup 对象 / 手抄错字，编译器都拦不住。
            // 实测（修前）：让实现方回传别的成员 id，本模块**照单全收** ——
            //   activate(alice) 的结果是 `activated`，而实际挂载的是
            //   `mountPreset(memberId=lingtai)`, `applyToolPolicy(memberId=lingtai)`：
            //   把 A 成员的 preset 与工具策略装到了 B 成员身上，返回 `activated` 不报错。
            // 这正是本文件反复防的那类**静默错装配**（比"没激活"危险得多：
            // 权限边界会落到错误的成员上），所以在这里 fail-closed。
            if (setup.memberId !== memberId) {
              throw new Error(
                `createHandle 调 setup 时给的 memberId 与本次激活的成员不一致：`
                + `本次要激活 ${memberId}，收到 ${String(setup.memberId)}。`
                + '（setup.memberId 必须原样用本模块传入的值；传成别的成员会把 preset 与'
                + '工具策略装到那个成员身上，而调用方会看到 activated。）',
              )
            }
            // 顺序是有意的：先 preset，再策略（上游 index.ts:2392-2402）。
            // 反过来的话，preset 挂载过程里注册的工具会覆盖掉策略，而两种顺序都不报错。
            await deps.mountPreset(setup, presetId)
            if (policy.allow !== undefined) {
              deps.applyToolPolicy(setup, policy.allow)
            }
          } catch (error) {
            setupState = { kind: 'failed', reason: describeError(error) }
            // 继续抛：让**不吞异常的** createHandle 走它自己的失败路径。
            // 那条路径下本函数会在 catch 里返回 'failed'，两条路径的结论一致。
            throw error
          }
          setupState = { kind: 'completed' }
        },
      })
    } catch (error) {
      return { kind: 'failed', reason: `createHandle 抛错：${describeError(error)}` }
    }

    const handle = asMemberHandle(raw)
    if (handle === undefined) {
      // 形状不对就不能缓存：缓存了会让此后**每一次**唤醒都撞上同一个坏对象。
      await disposeQuietly(raw)
      return {
        kind: 'failed',
        reason: buildDiscardedHandleReason(
          'createHandle 返回的句柄形状不合法'
          + '（需要 { agent: { id, status, followup, steer }, dispose() }）',
          '本模块无法对它投递或释放，',
        ),
      }
    }
    // ⚠ 必须经函数调用读回状态，不能直接读 `setupState`（实测 TS2367）：
    // `setupState` 的赋值全在 `setup` 这个异步回调里，而 `tsc` 的控制流分析
    // **不会**把回调里的赋值算进来 —— 直接比较会被收窄成初始字面量 `'none'`，
    // 于是 `!== 'completed'` 被判成"永不重叠的比较"而报错。
    // 经一次函数调用即可切断收窄（调用返回值不参与该变量的 CFA）。
    const finalSetup = readSetupState()
    if (finalSetup.kind !== 'completed') {
      await disposeQuietly(handle)
      // 显式 if/else 而不是嵌套三元（OCR 复核 LOW，两轮都提到）：这里要拼三段文字，
      // 三元链读起来要靠括号数猜分支。改成先算出 `cause`，再拼一条消息。
      const cause = finalSetup.kind === 'failed'
        ? `setup 装配失败（preset 或工具策略未生效）：${finalSetup.reason}`
        : 'createHandle 解析成功但**从未调用 setup**'
      // ⚠ 两种成因的**后果**不同，不能共用一句话（OCR 复核 MEDIUM，本处曾是失真文案）：
      //   · `'failed'`：setup 被调用过但中途抛了 —— Agent **确实已经跑起来**，
      //     只是 preset/策略没挂上 ⇒ "会以宿主默认面运行"是成立的。
      //   · `'none'`：setup **从未被调用** ⇒ 本模块**不知道**那个 Agent 处于什么状态
      //     （很可能压根没装配/没启动）。此时说"会以宿主默认面运行"是在断言一件
      //     我们没验证过的事，把后果说轻了。
      // 故这里对 `'none'` 只说我们确知的：它的装配**完全没有发生**。
      const consequence = finalSetup.kind === 'failed'
        ? '这个 Agent 会以宿主默认面运行（权限比预期更宽）。'
        : '这个 Agent 的 preset 与工具策略**完全没有生效**（setup 一次都没跑）。'
      return {
        kind: 'failed',
        reason: buildDiscardedHandleReason(cause, consequence),
      }
    }

    handles.set(memberId, handle)
    return { kind: 'activated' }
  }

  /** 尽力释放一个句柄；任何失败都只记日志（清理路径不该抛错）。 */
  async function disposeQuietly(raw: unknown): Promise<void> {
    // ⚠ 这里刻意用**更宽**的判据（只要 `dispose` 可调用）而**不是** `asMemberHandle`：
    // 被丢弃的句柄恰恰常常是形状不合法的那些（agent 缺 followup / 缺 steer），
    // 用完整守卫去判会把它们判成"无从 dispose"而**直接泄漏**。
    // 实测：第一版就是这么写的，用例「句柄形状不合法 ⇒ 丢弃并释放」红了（disposed 停在 0）。
    const disposable = asDisposable(raw)
    if (disposable === undefined) return
    try {
      await disposable.dispose()
    } catch (error) {
      warn(`${LOG_PREFIX} 成员句柄 dispose() 抛错（已忽略，句柄已摘除）：${describeError(error)}`)
    }
  }

  /**
   * 摘除一个成员的句柄（`release` 与 `releaseAll` **共用**这一处）。
   *
   * 抽成函数而不是让 `releaseAll` 去调 `this.release(...)`：两处必须逐字同形
   * （去重状态与句柄表要么一起清、要么都不清），而对象字面量里的 `this` 绑定
   * 一旦被解构调用就变 —— 那种分叉的症状是「有时清了、有时没清」，极难查。
   */
  async function releaseOne(memberId: MemberId): Promise<boolean> {
    const raw = handles.get(memberId)
    if (raw === undefined) {
      // 幂等：对不存在/已释放的成员调用是 no-op，且**不抛错**。
      //
      // ⚠ 这里**提前返回、不动去重状态**（OCR 复核 LOW，本处曾把顺序写反）：
      // 第一版先 `deliveredSignatures.delete(...)` 再判句柄，于是返回 `false`
      // （"没释放任何东西"）的那条路径**仍然改了状态** —— 布尔值从此不能区分
      // 「释放了句柄」与「只清了去重状态」，调用方无法据它判断。
      // 顺序换过来**不会**留下陈旧去重状态：句柄的唯一清除点就是本函数下面的
      // `handles.delete`，而那必然伴随一次 `delete` ⇒ 「句柄在」⟹「去重状态已被清」。
      return false
    }
    // 去重状态随句柄一起清：句柄没了以后，同一条待办在**重新激活**时应当能再送达。
    deliveredSignatures.delete(memberId)
    // ⚠ 「已就坏句柄告警过」的标记也要随句柄一起清（OCR 复核 LOW，已实测）：
    // 一次"损坏"是一个**事件**，句柄被摘除后该事件已结束。不清的话它会永久占住槽位，
    // 于是**同一个成员再次损坏时完全静默** —— 实测：第一次损坏告警 1 条，
    // release + 重新激活 + 再次损坏后总告警数**仍是 1**（第二次被压制）。
    // 那正是"每个成员只告警一次"这条去重的**过度**作用：本意是防同一次损坏刷屏，
    // 不是把此后所有的损坏都吞掉。
    corruptHandleWarned.delete(memberId)
    // 先摘表再 dispose：即使 dispose 抛错/挂住，缓存里也已经没有它了 ——
    // 「再也不会被唤醒」这个效果不依赖 dispose 的成功。
    handles.delete(memberId)
    // 坏句柄：无从 dispose（结构守卫会拒），但它已经从缓存里摘除了。
    await disposeQuietly(raw)
    return true
  }

  return {
    async activate(input: MemberActivationInput): Promise<MemberActivationOutcome> {
      const memberId = input.memberId

      // 已停用 ⇒ 拒绝新激活（OCR 复核 MEDIUM，本处曾是真缺口）。
      //
      // 依据：`releaseAll` 的语义是**终态**（插件停用 / 进程收尾），而它的实现是
      // 「等完在途 → 逐个 dispose」。若不在这里挡住，一次在 `releaseAll` 的某个
      // `await` 期间发起的 `activate` 会：
      //   (a) 在 `allSettled` 那个 await 里完成 ⇒ 它的句柄**不在**已快照的键列表里；
      //   (b) 在循环内某个 `await releaseOne` 期间完成 ⇒ 同上。
      // 两种情况下它都会在 `releaseAll` 返回**之后**把句柄写回缓存，
      // 留下一个停用后仍然活着的 Agent —— 副作用没被回收。
      // 挡住入口比在出口补救更简单也更难写错：停用期间**不可能**有新句柄产生。
      if (releasing) {
        return {
          kind: 'releasing',
          reason: '运行时正在停用（releaseAll 已开始），拒绝新的成员激活。',
        }
      }
      // 该成员正被 `release` 排空 ⇒ 同样拒绝（见 releasingMembers 的说明）。
      // 与上面的全局停用共用同一个 outcome：对调用方而言"这一瞬间不接受激活"是同一件事，
      // 而原因（全局停用 vs 该成员正在释放）在 reason 里区分。
      if (releasingMembers.has(memberId)) {
        return {
          kind: 'releasing',
          reason: `成员 ${memberId} 正在被 release 排空，拒绝此刻的新激活（避免句柄在释放返回后才落地）。`,
        }
      }

      // 已有活句柄 ⇒ 不重复创建（上游 index.ts:2371 的同形守卫）。
      if (readHandle(memberId) !== undefined) {
        return { kind: 'already-active' }
      }
      // 已在途 ⇒ 共享同一次创建。没有这一段，上面那道守卫就是**假守卫**：
      // 它在第一个 await 之前，两次并发调用都能穿过它，各建一个 Agent
      // （上游 index.ts:2371 与 :2502 之间正是这个窗口）。
      // 注册与首次 await 之间没有其他 await ⇒ 不存在交错窗口。
      const inFlight = inFlightActivations.get(memberId)
      if (inFlight !== undefined) {
        // ⚠ 这里**不删** map 条目，删除只发生在创建者的 `finally` 里
        //（OCR 复核 LOW：原先这条不变量是隐含的，重构时极易被加出"第二次 delete"）。
        //
        // 说不变量之前先说不变量**为什么不能反过来**（"谁早返回谁删"）：早返回方
        // 删掉条目后，创建者仍在跑，而**第三个**调用者会看不到这条在途记录、
        // 于是再起一次 `runActivation` ⇒ 一个成员两个 Agent，正是这段代码存在的理由。
        // 也就是说：条目必须在**创建者的生命周期**内一直可见，与有多少人复用它无关。
        //
        // 由此得到的不变量（改动此处前请先确认它仍成立）：
        //   条目被写出后，只有创建它的那次 `activate` 调用会在自己的 `finally` 里删它；
        //   其余调用者与 `release` 都只**读**。
        // 违反它的症状不是报错，而是"偶发地多建一个 Agent"或"release 等一个已经没人持有的 promise"。
        //
        // ⚠ 复用它之前必须确认**入参一致**（OCR 复核 MEDIUM，本处曾是真缺陷，已实测）：
        // `presetId` / `toolPolicy` 只在 `runActivation` 里被读，而它已经跑起来了 ——
        // 后到的调用者若传了**不同**的 preset/策略，直接复用会得到一个 `activated`，
        // 它**以为**自己的 preset B 挂上了、策略注入了，而实际在跑的是 A 的装配。
        // 返回值与"真的激活了 B"无法区分 ⇒ 静默错装配。
        // 实测（修前）：并发 `activate(preset-A)` + `activate(preset-B)`
        //   两次都返回 `activated`，而实际挂载的是 `["preset-A","policy:tool_a"]` —— B 被吞了。
        //
        // 判据是「**同参**才共享」：同参共享是纯优化（语义与各跑一次完全一致）；
        // 不同参则如实拒绝，让调用方知道这次请求没有被采纳 ——
        // 而不是回一个它无法分辨的 `activated`。
        if (inFlight.presetId !== input.presetId || !sameToolPolicy(inFlight.toolPolicy, input.toolPolicy)) {
          // ⚠ 报出**真正不同的那一项**（OCR 复核 LOW，实测过误导场景）：
          // 只在 toolPolicy 不同时，原先把两侧 presetId 都打出来会是
          // 「在途 presetId=same，本次 same」—— 运维看不出差异在哪，反而以为消息有 bug。
          // 实测复现：presetId 相同、allow 不同 ⇒ 消息里两个 presetId 一模一样。
          // 现在把 preset 与策略各报一次，且明说哪一项不同。
          const presetDiffers = inFlight.presetId !== input.presetId
          const policyDiffers = !sameToolPolicy(inFlight.toolPolicy, input.toolPolicy)
          const what = presetDiffers && policyDiffers
            ? 'presetId 与 toolPolicy 都不同'
            : presetDiffers ? 'presetId 不同' : 'toolPolicy 不同'
          return {
            kind: 'conflicting-activation',
            reason:
              `成员 ${memberId} 正在以不同的装配参数激活中（${what}）——拒绝复用，`
              + `以免返回一个与本次入参不符的 activated。`
              + `在途：presetId=${inFlight.presetId}，toolPolicy=${safeStringify(inFlight.toolPolicy?.allow ?? null)}；`
              + `本次：presetId=${input.presetId}，toolPolicy=${safeStringify(input.toolPolicy?.allow ?? null)}。`
              + '请先 await 在途那次，再按新参数重新激活。',
          }
        }
        return inFlight.promise
      }
      const promise = runActivation(input)
      inFlightActivations.set(memberId, { presetId: input.presetId, toolPolicy: input.toolPolicy, promise })
      try {
        return await promise
      } finally {
        inFlightActivations.delete(memberId)
      }
    },

    notify(memberId: MemberId, notice: MemberNotice): MemberWakeOutcome {
      // ── 1. 输入形状（**先于**生命周期与句柄门，OCR 复核 LOW 的修复点）──
      //
      // ⚠ 顺序是有意的，别按"先看成员状态"的直觉改回去：形如
      //   `notify(一个没有活句柄的成员, 非法通知)` 若先走句柄门，回答是 `no-handle` ——
      //   调用方**构造通知的 bug** 会完全静默（不告警、不指出输入错在哪），
      //   而那恰恰是诊断信息最该出现的场合。
      // 输入错误与成员状态**无关**，所以它必须最先判、且不受成员状态影响。
      //
      // ⚠ 这里也顺带堵住了 `notice === null/undefined`（OCR 复核 HIGH）：`MemberNotice`
      // 只是类型层契约，JS 调用方与 `as` 强转都能绕过它；直接读 `notice.items` 会抛
      // `TypeError` 冲出事件派发路径，违反"从不抛错"。
      // （实测提醒：传 `42` / `'str'` **不抛** —— 它们的 `.items` 是 undefined，
      //   落到数组判断。这条漏洞**只在 null/undefined 上**成立，故更易漏测。）
      const shapeProblem = validateNoticeShape(notice)
      if (shapeProblem !== null) {
        return { kind: 'invalid-notice', reason: shapeProblem }
      }

      // ── 2. 生命周期门 ──
      // 放在句柄门之前：一个已挂起的成员同时"没有活句柄"，但 `not-active` 是更有信息量的回答。
      //
      // ⚠ 这一读必须是**带兜底**的（OCR 复核 MEDIUM）：`lifecycleOf` 读账本，而账本读会抛。
      // 裸调的话异常会从这里冲进事件派发路径 —— 而本方法的契约是**从不抛错**。
      const read = readLifecycle(deps, memberId)
      if (read.kind === 'unknown') {
        // 状态未知的成员不唤醒（fail-closed）：它可能已被销毁。
        warn(`${LOG_PREFIX} 成员 ${memberId} 的生命周期读不出来，已跳过本次唤醒：${read.reason}`)
        return { kind: 'lifecycle-read-failed', reason: read.reason }
      }
      const lifecycle = read.lifecycle
      if (lifecycle !== 'active') {
        return { kind: 'not-active', lifecycle }
      }

      // ── 3. 句柄门：**安全降级**，不抛错 ──
      // `readHandle` 过结构守卫，所以"句柄丢失/坏掉"与"从未激活"在这里是同一件事。
      //
      // ⚠ 本条**有意不看** `releasing` / `releasingMembers`，与 `activate` 的 fail-closed
      // **不对称**（OCR 复核 LOW 指出，已实测确认属实，并**判为保持现状**，理由如下）：
      //   · 窗口有多窄：`release` 的同步段之后、`releaseOne` 摘句柄之前，句柄仍在 `handles` 里
      //     ⇒ 此刻 `notify` 会真的投递（实测拿到 `delivered`，且 `handle.agent.followup`
      //     确实被调用）。窗口一过（句柄被摘）就变 `no-handle`。
      //   · **为什么这不是数据丢失**（这是判"不修"的关键依据，实测而非推断）：
      //     `releaseOne` 会清掉 `deliveredSignatures` ⇒ 该成员重新激活后，
      //     **同一条待办会被再送一次**。实测三步：窗口内投递 → 释放完成 → 重新激活后
      //     同一条待办再次 `delivered`，`followup` 累计被调用 2 次 ⇒ 自愈，不丢。
      //   · 为什么**不**在这里也 fail-closed：那会让"正在释放"这个极窄窗口里的通知
      //     被回成 `no-handle` —— 而它与"句柄真的没了"同形，调用方无法分辨，
      //     反而把一个可自愈的时序问题变成一次**静默吞掉**（`no-handle` 不写签名状态，
      //     但也不投递；调用方若据此放弃，才是真丢）。
      //     现在的行为是"能投就投、投不到也自愈"，代价最小。
      //   · 若将来观测到"投进正在释放的成员"造成真实问题（例如 dispose 后调用抛错），
      //     证据会是：`followup`/`steer` 抛错并落入下面的 `delivery-failed` ——
      //     那时再按 `activate` 的方式 fail-closed，本条注释就是判据。
      const handle = readHandle(memberId)
      if (handle === undefined) {
        return { kind: 'no-handle' }
      }

      // ── 4. 语义上的"无需投递"（形状已确认合法）──
      const items = (notice as { items: readonly MemberPendingItem[] }).items
      if (items.length === 0) {
        // 待办清空 ⇒ 清掉签名状态（上游 index.ts:2815-2818 的同形语义）。
        // 这不是"顺手清一下"：不清的话，同一组待办在**下一次**重新出现时
        // 会被判成"重复"，成员就永远收不到了。
        deliveredSignatures.delete(memberId)
        return { kind: 'nothing-pending' }
      }
      if (notice.text.trim() === '') {
        // 没有正文的通知没有可送达的内容。**不写签名状态**：调用方下次渲染出正文时
        // 应当能正常送达，而不是被这一次空白通知压制住。
        return { kind: 'nothing-pending' }
      }

      // ── 5. 去重（同一条待办不重复推送）──
      //
      // ⚠ 关于「非法待办被拒时**有意不清** `deliveredSignatures`」（OCR 复核 MEDIUM 曾建议清，
      // 实测后**不采纳**，理由与实测结果写在这里防止后人再改回去）：
      // 建议的场景是「先送达合法 A → 传一条非法待办被拒 → 再传合法 A」，第三条会返回
      // `duplicate`。**但那是正确的**：A 这一批事实确实已经送达过，去重表里存的就是它
      // ⇒ 不该为同一批事实再烧一次完整 turn。
      // 实测四步：合法A→delivered、非法→invalid-notice、再次合法A→**duplicate**、
      // 换上**新**事实B→**delivered**（新事实没有被压制 ⇒ 不存在"漏提醒"）。
      // 反过来若在拒绝处清签名：第三步会变成 `delivered` —— 对同一批**已送达**的事实
      // 重复打扰成员，正是本模块用 signature 去重所要防的**唤醒风暴**
      //（一个 turn = 一次完整模型调用）。两种做法都是"某个计数不对"，
      // 但一个多烧 turn、一个只是少推一次冗余通知，代价不对称 ⇒ 保持不清。
      const signature = noticeSignatureOf(items)
      if (deliveredSignatures.get(memberId) === signature) {
        return { kind: 'duplicate' }
      }

      // ── 6. 双通道投递 ──
      //
      // ⚠ `channel` 必须用**不抛错**的 `readBusyness` 算出来（OCR 复核 [18]/[26]）：
      // `status` 是派生 getter，直接读它会让异常逃出本方法 —— 而本条路径正在
      // **事件派发**里跑，抛出会冲出派发层，违反文档写明的"从不抛错"。
      // （实测过：把 getter 换成抛错实现，`notify` 当场抛 `phase is corrupted`。）
      // 读不出来（undefined）⇒ 落 `steer`，与 `presenceOf` 保持同一结论。
      const channel = channelForBusyness(readBusyness(handle.agent))
      try {
        // ── 通知 → **合法 user message**（唯一转换处，见 `notice-message.ts`）──
        //
        // 放在 try 里而不是之前：空正文会被 `noticeMessageOf` 拒（抛），而本条路径
        // 在**事件派发**里跑、契约是"从不抛错" ⇒ 那一下必须落成可回报的
        // `delivery-failed`，不能冲进派发层。文本非空这一点上游门已保证
        //（`invalid-notice` 分支先拦了空 text），这里是第二道、且**便宜**。
        const message = noticeMessageOf(notice.text)
        if (channel === 'followup') {
          handle.agent.followup(message)
        } else {
          handle.agent.steer(message)
        }
      } catch (error) {
        // 投递失败不能反向影响任何已提交的事实，也不能让异常冲进调用方的事件派发路径。
        // 签名**不写入** ⇒ 同一条待办下次还能重投（不变量见 deliveredSignatures）。
        warn(
          `${LOG_PREFIX} 成员 ${memberId} 的通知投递失败（通道 ${channel}）：${describeError(error)}`,
        )
        return { kind: 'delivery-failed', channel, reason: describeError(error) }
      }
      deliveredSignatures.set(memberId, signature)
      return { kind: 'delivered', channel }
    },

    presenceOf(memberId: MemberId): MemberPresence {
      // 无活句柄读作 `'idle'`（＝"不在跑"），这与上游把
      // `handle.agent.status === 'running' ? 'working' : 'available'` 的处置同形。
      // ⚠ 它**不**表示"已激活"：要知道"有没有活句柄"请用 `handleOf()`，
      //    不要用 presence 反推激活状态（一个已挂起的成员也是 `'idle'`）。
      //
      // ⚠ 判据与投递通道**共用** `readBusyness`（OCR 复核 LOW 与 [18]/[26] 的共同修复点）：
      //   · 各自用一个字面量比较时，未知 status 会让"显示为空闲"与"按正忙投递"同时成立；
      //   · 直接读 `agent.status` 时，抛错的 getter 会让本方法**抛错**
      //     （实测：违反 `MemberRuntime` 文档的"所有方法都不抛"）。
      // 现在两处的结论都由同一个**不抛错**的返回值派生 ⇒ 既不会互相打脸，也不会外泄异常。
      const handle = readHandle(memberId)
      if (handle === undefined) return 'idle'
      // ⚠ 这条分支**确实可达**（OCR 复核 LOW，我先前在这里写"实际不会返回 undefined"是**错的**，
      // 两轮后的实测推翻了自己：一个**有状态 getter**（第 N 次读取开始抛）能通过激活时的形状守卫，
      // 却在之后某次读取时抛 ⇒ `readBusyness` 返回 undefined，本条返回 `'running'`。
      // 实测：让 getter 在第 3 次读取开始抛，`presenceOf` 得 `'running'` —— 分支走到了。
      // 结论：`readBusyness` 的 undefined **不是**不可达的防御分支，而是"状态暂时读不出来"的
      // 真实表达。这恰恰是保留 `channelForBusyness`（而非直接 `isBusyStatus`）的价值：
      // 读不出来 ⇒ 按正忙处理（不多烧一个 turn），且与投递通道的结论**同源**、不会互相打脸。
      return channelForBusyness(readBusyness(handle.agent)) === 'steer' ? 'running' : 'idle'
    },

    handleOf(memberId: MemberId): MemberHandle | undefined {
      return readHandle(memberId)
    },

    liveMemberIds(): readonly MemberId[] {
      // 只列出**形状仍然合法**的句柄：缓存的原始值可能已经坏掉，
      // 把它列出去会让调用方拿到一个用不了的东西。
      const live: MemberId[] = []
      for (const memberId of handles.keys()) {
        if (readHandle(memberId) !== undefined) live.push(memberId)
      }
      return live
    },

    async release(memberId: MemberId): Promise<boolean> {
      // ⚠ **必须先等在途激活落地**（OCR 复核 MEDIUM，本处曾是真缺陷，已实测复现）。
      //
      // 缺陷形状：`activate(m)` 已过生命周期与句柄门、正卡在 `await createHandle`，
      // 此时 suspend/destroy 路径调 `release(m)` —— 句柄**还没进缓存**，
      // 于是 `releaseOne` 走"幂等 no-op"分支返回 `false`：调用方以为什么都没释放，
      // 而随后 activate 落地把句柄存下 ⇒ **一个活着的 Agent 被永久缓存、从不 dispose**。
      // 这与 `releaseAll` 自己文档里防的竞态**完全同形**，只是粒度小一号。
      //
      // 实测（复现脚本，非推断）：release 返回 `false`、`handleOf(m)` 仍有值、
      // `liveMemberIds` 仍含 m、`dispose` 调用次数 **0**。
      //
      // 为什么"等一下再正常摘除"是对的（而不是在 runActivation 里加暗号）：
      // 等它落地后，`releaseOne` 会在缓存里**真的找到**那个句柄并 dispose，
      // 于是返回值 `true` 如实表示"确实有一个活句柄被摘除"，判据不需要改；
      // 而"在 runActivation 里拦下并自行 dispose"会让 release 返回 `false`
      // （缓存里确实没有过句柄），调用方读到的仍然是"什么都没发生"，
      // 只是泄漏没了 —— 语义更差。
      //
      // 无死锁：`inFlightActivations` 的 promise 是 `runActivation`，
      // 它不 await `release`，故不构成环。
      //
      // 时序上为什么真的能等到：`inFlightActivations.set` 在 `activate` 的
      // **第一个 await 之前**同步完成（`runActivation` 作为 async 函数被调用后
      // 同步执行到它自己的首个 await 即返回 promise）⇒ 同一 tick 内发起的
      // `release` 必然看得到这条在途记录。
      //
      // ⚠ 但只 await **一条**快照是不够的（OCR 复核 HIGH，见 releasingMembers 的说明）：
      // 期间新起的那次激活不在快照里，它会在释放返回后落地并留下句柄。
      // 故整个排空窗口内拒绝该成员的新激活。
      releasingMembers.add(memberId)
      try {
        // 排空该成员当前的在途激活。
        //
        // ⚠ **只 await 一条**就够了，这依赖一个明确的不变量（不是"大概只有一条"）：
        // 对同一 `memberId`，`inFlightActivations` 里**至多一条**记录。理由两点：
        //   1. 创建它的是某一次 `activate`，而它在自己的 `finally` 里删除；
        //   2. 其余调用者只**读**这条记录（见 `activate` 里那条注释）—— 不会新增条目。
        // 而"期间不会有**新**的激活插进来"由上面的 `releasingMembers.add` 保证：
        // 置位与本次 await 之间没有其他 await，故不存在交错窗口。
        //
        // 我原先在这里写了一个 `for (;;)` 循环反复收集，注释里还声称它覆盖某种"边角"，
        // 紧接着又承认那种情况"已不可能" —— 那是自相矛盾。变异测试印证了这一点：
        // 把循环改成"只跑一轮"后**没有任何用例变红**（即它与循环行为等价、无法被区分）。
        // 与其留一段没有论证支撑、也没有测试能守住的代码，不如**写清不变量**并只用一条 await：
        // 将来若真有"多条在途"的需求，那时需要改的是这个不变量，而不是在这里多转几圈。
        const pending = [...inFlightActivations.entries()]
          .filter(([id]) => id === memberId)
          .map(([, entry]) => entry.promise)
        // 无需判 `pending.length > 0`（OCR 复核 LOW）：`Promise.allSettled([])`
        // 立即 resolve（本机实测 0ms），加一个判断只是多一处要读的分支。
        // 吞掉拒绝：本方法的契约是**不抛错**，而"激活失败了"不是释放失败。
        // 激活失败时句柄本来就没进缓存，下面的 releaseOne 会如实返回 false。
        await Promise.allSettled(pending)
        return await releaseOne(memberId)
      } finally {
        // 复位（与全局 `releasing` 的关键差别）：悬停只是临时状态，
        // **复位后该成员可以被重新激活** —— 这正是 suspend → resume 的路径。
        releasingMembers.delete(memberId)
      }
    },

    async releaseAll(): Promise<void> {
      // ⚠ 先置停用标志，**再**等任何 await（OCR 复核 MEDIUM）：
      // 置位与随后的 `allSettled` 之间没有 await，所以"停用期间不再产生新句柄"
      // 这件事在同步段里就成立了 —— 期间到达的 `activate` 会直接拿到 `releasing`。
      // 这比"出口再扫一遍"更难写错：出口补救要覆盖 `allSettled` 与循环内两层 await 窗口。
      releasing = true
      await Promise.allSettled([...inFlightActivations.values()].map((entry) => entry.promise))
      // ⚠ 每个成员**独立**隔离（OCR 复核 LOW，本处原是"一个出错、后面全不释放"）：
      // `releasing` 已经置为 `true`（终态、不复位），所以若循环中途抛错，
      // 剩下的成员会**永远**既不被释放、也无法被重新激活 —— 一个静默半死的运行时，
      // 对外一律回答 `releasing` 直到进程结束。
      // `releaseOne` 今天确实不会抛（它内部唯一可抛的 `disposeQuietly` 已兜底），
      // 但那是一条**约定**而不是**结构**：这里把它变成结构 —— 每次释放各自 `allSettled`，
      // 一次失败不影响其余，也让将来给 `releaseOne` 加逻辑时不会静默毁掉终态语义。
      // 使用 `Promise.allSettled`（而不是 try/catch）是刻意的：我们**不需要**知道
      // 每个成员的成败去改变控制流（终态就在眼前），只需要"每个都试过"。
      await Promise.allSettled([...handles.keys()].map((memberId) => releaseOne(memberId)))
      // ⚠ 收尾清理**显式**做，不依赖"每个 releaseOne 都成功"（OCR 复核 LOW）。
      // 上面的循环已经把每个成员都试过了，这里再清一次，让"终态"成为**结构**而不是**约定**。
      //
      // ⚠ 关于它的**可证伪边界**（变异测试逐条实测，如实记录）：
      // 与 `releaseOne` 里的 `handles.delete` **互为冗余** —— 单独删掉任一处都不影响结果
      //（实测：只删这里 → 绿；只删 `releaseOne` 的 delete → 绿；**两处同删才红**）。
      // 两处各自覆盖不同调用路径，因此**都不是**死代码：
      //   · `releaseOne` 的 delete 让**单成员** `release(m)` 也正确（那条路径不经过本函数）；
      //   · 本函数的 clear 让**终态**不依赖循环里每个成员的成败
      //     （例如将来给 `releaseOne` 加了可能抛的逻辑、或让它提前 return）。
      // 若将来有人只看到"删了也不红"就想删其中一处，请先确认它覆盖的另一条路径仍然正确。
      handles.clear()
      corruptHandleWarned.clear()
      releasingMembers.clear()
      // 去重状态与在途记录一并清：本实例已进入终态（`releasing` 不复位），
      // 保留它们只会让"这个运行时已经停了"这件事看起来没那么确定。
      deliveredSignatures.clear()
      inFlightActivations.clear()
    },
  }
}
