/**
 * 「通知」→「合法 user message」的唯一出处。
 *
 * ## 为什么需要这个文件（本批的**要害**，写清楚别被后人删掉）
 *
 * 成员运行时最终要调 `agent.followup(...)` / `agent.steer(...)`。在**真** DSH 里，
 * 那个参数的契约是**一条消息对象**，不是一段文本：
 *
 * - 正典投递点：`dsh-api-session-controller/lib/types/commands.js:317`
 *   `const message = createUserMessage({ content, source })` → `:325 agent.followup(message)`
 *   （`steer` 走 `:323`）。
 * - 插件通知的同形用法：`dsh-agent-team/packages/agent-team/src/index.ts:2838-2850`
 *   —— 它也是 `createUserMessage({content, source})` 之后才 `followup`/`steer`。
 *
 * 在此之前，本仓把 `MemberNotice`（`{items, text}`）**直接**交给 `followup`。那在
 * 「到达 agent 边界」这一层看不出问题（假 agent 照样收到、照样能断言），但真 agent 的
 * inbox 收的是一批**消息**（`inbox.splice(target, Infinity, 0, [message])`，
 * `dsh-agent-loop/lib/index.js:783-787`），后续请求装配读的是 `message.content` /
 * `message.source` —— 一个没有这些字段的对象进去，**不会报错**，只会变成一条空消息。
 *
 * ⇒ 本文件把那个转换收成**一处**。运行时不自己拼消息，测试也不自己拼消息。
 *
 * ## 为什么是「结构镜像」而不是 `import { createUserMessage }`
 *
 * 三条**实测**事实，合起来排除了 import：
 *
 * 1. 本包 `package.json` **没有任何运行时依赖**（只有 `devDependencies`），
 *    声明一个 `@deepseek-ai/dsh-llm` 会改掉这个契约。
 * 2. `@deepseek-ai/dsh-llm` 在本包**解析不到**：`packages/sophia-core/node_modules/`
 *    与仓根 `node_modules/` 下都没有它（实测两处 `Test-Path` 均为 `False`）
 *    ⇒ 静态 import 连 `tsc` 都过不去。
 * 3. 被镜像的实现是**纯函数**、且依赖只有两个通用工具，没有隐藏状态：
 *    `dsh-llm/lib/types/message.js:26-39` ——
 *    `createMessage = (input) => freezeMessage({...input, id: brandString(randomUUID())})`、
 *    `freezeMessage = (message) => deepFreeze(structuredClone(message))`、
 *    `createUserMessage = (input) => createMessage({...input, role:'user'})`。
 *
 * ## ⚠ 这个镜像的**已知代价**（改动本文件前先读）
 *
 * 它不是「同一个函数」，是**两份实现**。上游若改 `createMessage`（加必填字段、
 * 改 `role` 取值、换成非普通对象的类实例），本仓**不会**自动跟上，症状是
 * 「通知进了 inbox 但内容/身份不对」，而且**没有测试会红**（我们的测试断言的是
 * 这份镜像自己的形状）。⇒ 判据：凡是动这里的形状，必须回上游核
 * `dsh-llm/lib/types/message.js` 的当前实现（本节引用的行号就是那次核对的结果，
 * 文件指纹：`dsh-llm/lib/types/message.js` 的前 40 行含 `freezeMessage` 定义）。
 * 上游**未**改而本仓改动这里的形状 = 造了一个上游不认的消息，属于自伤。
 */

import { randomUUID } from 'node:crypto'

/**
 * 本插件在消息 `source` 里的标识。
 *
 * 与 `src/plugin.ts` 的 `export const name = 'sophia'` 同值：那个名字是 DSH loader
 * 做诊断的标签，消息来源也应当报同一个名字 —— 两份不同的话，「这条 notice 是谁投的」
 * 在日志与消息里会各说一套。**不用** `@sophia/core`：`source.plugin` 是插件 id 而不是包名。
 */
export const SOPHIA_PLUGIN_ID = 'sophia'

/**
 * plugin-notice 的**折叠标签**（上游叫 `summary`）。
 *
 * 与上游 `INBOX_NOTICE_SUMMARY = 'Team Inbox has unread work.'`
 *（`…/agent-team/src/index.ts:151`）同一个用途：notice 在转录里折叠成一行，
 * 这一行是给人/给模型看的**它是哪一类东西**。它也是「找回自己投过的那条通知」的判据
 *（上游 `isInboxNotice`，`…/agent-team/src/index.ts:2857-2861` 逐字比这个串），
 * 所以**不许**在这里塞内容（内容进 `content`）——塞了就没法用它做匹配。
 */
export const SOPHIA_NOTICE_SUMMARY = '索菲亚团队有一条未读消息。'

/**
 * 上游对 `summary` 的长度上界（`dsh-llm/lib/types/message.js:10`
 * `CONTEXT_SUMMARY_MAX_CHARS = 120`，截断成 `…` 收尾的是 `:16-20 boundContextSummary`）。
 *
 * 本仓的 summary 是一个**常量**（远短于上界），所以这里不做截断 —— 但把这个常量
 * 写出来并断言（见测试），是为了让「上游改了上界」这件事有一个可核对的锚点，
 * 而不是靠"我们的串很短所以没事"。
 */
export const CONTEXT_SUMMARY_MAX_CHARS = 120

/** 消息里的一个文本片段（上游 `content` 的元素形状：`{type:'text', text}`）。 */
export interface SophiaMessageTextPart {
  readonly type: 'text'
  readonly text: string
}

/**
 * 一条**合法的** user message（结构镜像上游 `UserMessage`）。
 *
 * `id` 是**必须**的：真 inbox 用它对条目做增删（上游 `inbox.remove(message.id)`，
 * `…/agent-team/src/index.ts:2837`），缺 id 的消息无法被替换，于是同一线程的通知
 * 会在 inbox 里越堆越多。
 */
export interface SophiaUserMessage {
  readonly role: 'user'
  readonly id: string
  readonly content: readonly SophiaMessageTextPart[]
  readonly source: {
    readonly kind: 'plugin'
    readonly plugin: string
    readonly form: 'notice'
    readonly summary: string
  }
}

/** 深冻结（镜像上游 `freezeMessage` 的 `deepFreeze`；`structuredClone` 负责先摘除引用）。 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested)
  return Object.freeze(value)
}

/**
 * 把一段**通知正文**包成一条合法的 user message。
 *
 * 只吃 `text` 而不是整个 `MemberNotice`（有意）：待办项的 `ref`/`unreadCount`/`signature`
 * 是**运行时内部**的去重与重投载体，它们不是给模型看的消息内容 ——
 * 上游同样只把事实渲染成文本（`notificationText(notifications, memberId)`，
 * `…/agent-team/src/index.ts:2839`）。本仓那个渲染发生在
 * `wakeMemberForMessage`（`src/tools/message.ts`），所以到这里只剩文本。
 *
 * @param text - 投递给成员的通知正文（非空；空串会被本函数拒）。
 * @returns 一条冻结的 user message（`role`/`id`/`content`/`source` 齐备，与上游同形）。
 * @throws 当 `text` 不是非空字符串时 —— 空消息进了 inbox 就是一条**沉默的唤醒**
 *   （成员被叫起来了，却读不到任何内容），比不唤醒更糟，所以宁可响。
 */
export function noticeMessageOf(text: string): SophiaUserMessage {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new TypeError('noticeMessageOf: 通知正文必须是非空字符串（空消息会让成员被叫起来却读不到内容）')
  }
  return deepFreeze(
    structuredClone({
      role: 'user' as const,
      id: randomUUID(),
      content: [{ type: 'text' as const, text }],
      source: {
        kind: 'plugin' as const,
        plugin: SOPHIA_PLUGIN_ID,
        form: 'notice' as const,
        summary: SOPHIA_NOTICE_SUMMARY,
      },
    }),
  )
}
