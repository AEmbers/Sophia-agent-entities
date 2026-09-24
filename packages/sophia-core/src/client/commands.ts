/**
 * 斜杠命令 `/sophia-agent-entities` —— 浏览器半的命令入口。
 *
 * ## 这个 DSH 版本里，斜杠命令有**两个互斥的注册面**（结论逐条读源码得出）
 *
 * 1. **宿主面** `ctx.commands.register(definition)`
 *    —— 服务名 `@deepseek-ai/dsh-commands/lib/index.js:70`（`const name = "commands"`），
 *    注册方法同文件 `:257`；真实生产方用法见
 *    `dsh-command-compact/lib/index.js:8`（`inject = ["commands", …]`）与 `:92`。
 *    handler 的入参是 `{ commandId, agent, rawInput, attachments, signal }`
 *    （同文件 `:370-376`），返回值只能是 `{ kind: 'success' | 'error', text }`
 *    （`:175-195`）。
 *    ⚠ **它结构上没有触达浏览器 UI 的能力** —— 入参、返回值里没有任何字段，
 *    也没有任何宿主服务，能让一个宿主 handler 去调浏览器侧的 `layout`
 *    （`ctx.layout` 只存在于 client 半）。它能做的最多是往会话日志 append 事件。
 *    ⇒ 走宿主面**打不出面板**，而主人的验收标准正是「打完命令到面板」。
 *
 * 2. **浏览器面** `ctx.commandUi.register(contribution)`
 *    —— 服务名 `@deepseek-ai/dsh-client-ui-commands/lib/client.js:514`
 *    （`super(ctx, "commandUi")`），注册方法同文件 `:553`。
 *    当贡献的 `ui.kind === 'action'` 时，宿主**在浏览器里直接调 `ui.run(session)`**
 *    （同文件 `:765-768`）⇒ 那一刻 `layout.selectPanel(panelId)` 可用
 *    （`dsh-client-ui-layout/lib/client.js:412-416`）⇒
 *    **这是本版本里唯一能真正打开面板的路径。**
 *
 * **两边同名会炸**：浏览器面在候选合成时对重名抛错
 * （`dsh-client-ui-commands/lib/client.js:648`
 * `contribution /X collides with a host command`），宿主面同层重名也抛
 * （`dsh-commands/lib/index.js:82`）⇒ 只能二选一。本文件选 2。
 *
 * ## 形状是**反推**自两个真实调用点，不是照命名猜的
 *
 * | 字段 | 出处 | 取值 |
 * |---|---|---|
 * | `name` | `dsh-client-ui-commands/lib/client.js:646-653`（候选合成按 `name` 去重） | `'sophia-agent-entities'`（与包名同形，主人点名） |
 * | `description` | 同上 `:651` `contribution.description()` —— **是 thunk**，不是字符串 | `() => string` |
 * | `available` | 同文件 `:665` / `:724` `contribution.available(session)` | `(session) => boolean` |
 * | `ui.kind: 'action'` + `ui.run` | 同文件 `:765-768`（`if (ui.kind === "action") { … ui.run(session) }`） | `{ kind: 'action', run(session): void }` |
 * | 真实实例 | `dsh-client-ui-message-feedback/lib/client.js:870-879` | 唯一的 `kind: 'action'` 贡献（`/feedback`） |
 * | 真实实例（`register` 而非 `decorate`） | `dsh-client-ui-model-selection/lib/client.js:919-937` | `/model` 贡献 + `description` thunk |
 *
 * ## 名字为什么合法
 *
 * 宿主面与浏览器面都只接受 `^[a-z][a-z0-9_-]*$`
 * （`dsh-commands/lib/index.js:71` 的 `COMMAND_NAME`；
 * 浏览器面解析同一形状的 token，见 `client.js:479-483`）。
 * `sophia-agent-entities` 全小写字母加连字符 ⇒ 合法（`-` 在字符类里）。
 *
 * ## 两条输入路径都到面板（这也是选浏览器面的实证好处）
 *
 * - 打 `/sophia-agent-entities` 回车 ⇒ `client.js:712-731` 的 `matchEnter`
 *   ⇒ bare token 且贡献 `available` ⇒ `invoke()` ⇒ `ui.run()`；
 * - 打 `/` 从菜单里选 ⇒ 同文件 `:662-689` 的 `dispatch`
 *   ⇒ 贡献在场 ⇒ `invoke()` ⇒ `ui.run()`。
 *
 * 两条都**不产生模型消息**（命令面与模型历史分离，同文件 `:784-793` 的说明）。
 *
 * @module @sophia/core/client/commands
 */

/**
 * 命令名 —— **与包名同形**（主人原话点名这条命令）。
 *
 * 提到常量而不是在两处写字符串：`index.ts` 把它写进诊断标记、本文件用它注册，
 * 两处漂移的症状是「用户打了命令没反应、而诊断里报的是另一个名字」。
 */
export const SOPHIA_SLASH_COMMAND = 'sophia-agent-entities'

/**
 * 浏览器侧会话的最小面 —— 只用到 `sessionId`。
 *
 * 结构化声明（不 import 任何 `@deepseek-ai/*` 类型）：本机 SDK 安装
 * **不含 `.d.ts`**（`src/index.ts:16-18` 的实测记录），那个 import 会以
 * `TS7016` 失败。本文件两处真实调用点都只用这个字段：
 * `client.js:665` 把它转交给 `available`、`:767` 转交给 `run`。
 */
export interface SophiaCommandSession {
  readonly sessionId: string
}

/** 浏览器侧命令贡献（`commandUi.register()` 的入参形状，出处见文件头表）。 */
export interface SophiaCommandContribution {
  readonly name: string
  /** **thunk**：每次候选取用时求值 ⇒ 跟随语言切换（`client.js:651`）。 */
  readonly description: () => string
  readonly available: (session: SophiaCommandSession) => boolean
  readonly ui: {
    readonly kind: 'action'
    readonly run: (session: SophiaCommandSession) => void
  }
}

/** `ctx.commandUi` 的结构化面（本文件只用到 `register`）。 */
export interface CommandUiFace {
  /**
   * 注册一个贡献。
   *
   * 返回类型声明成 `unknown` 而不是 `() => void`：真实实现返回**包装过的**
   * disposer（`client.js:562-564` `return () => { dispose() }`），但本包在
   * **边界**上收窄外部输入 —— 返回值是不是函数由调用方 `typeof` 判，
   * 不靠类型断言（与 `index.ts` 的 `asSlots` / `asLocale` 同一纪律）。
   */
  register(contribution: SophiaCommandContribution): unknown
}

/** `ctx.layout` 的结构化面（本文件只用到 `selectPanel`）。 */
export interface LayoutFace {
  /**
   * 切到某个全局面板（`null` 表示回到对话）。
   *
   * ⚠ 面板未注册时**会抛**（`dsh-client-ui-layout/lib/client.js:413`
   * `layout.selectPanel: main panel "…" is not registered`）——
   * 调用方必须自己兜住，见下面 `openSophiaPanel` 的注释。
   */
  selectPanel(panelId: string | null): void
}

/** effect 登记器：返回「真的登记成功了吗」（与 `index.ts` 的 `registerEffect` 同形）。 */
export type EffectRegistrar = (execute: () => void | (() => void), label: string) => boolean

/** 挂载结果。`outcome` 是**闭集**，供诊断如实回报（穷尽性由调用方 switch 保证）。 */
export interface SophiaCommandMount {
  /** `registered` = 已交到 `commandUi` 手上；其余是**没挂上**的三种可区分原因。 */
  readonly outcome: 'registered' | 'service-missing' | 'effect-unavailable' | 'register-threw'
  /** 人类可读的原因（进 console 与诊断字段，不扔给用户界面）。 */
  readonly detail: string
}

/** 把未知值收窄成 `commandUi` 面；形状不符返回 `undefined`（不抛）。 */
export function asCommandUi(value: unknown): CommandUiFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { register?: unknown }
  return typeof candidate.register === 'function' ? (value as CommandUiFace) : undefined
}

/** 把未知值收窄成 `layout` 面；形状不符返回 `undefined`（不抛）。 */
export function asLayout(value: unknown): LayoutFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { selectPanel?: unknown }
  return typeof candidate.selectPanel === 'function' ? (value as LayoutFace) : undefined
}

/** 把 `catch` 到的未知值收窄成可读文本（`useUnknownInCatchVariables` 下 `error.message` 是 TS2339）。 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 打开索菲亚面板 —— 命令的**全部**副作用。
 *
 * ## 为什么两层容错都是必需的（不是防御性编程的顺手活）
 *
 * ① **`layout` 服务可能不在**：它是 client 半的可选服务，`index.ts` 的既有纪律是
 *    「可选服务用 `ctx.get` 惰性探测并按缺失降级」（见该文件 `export const inject`
 *    与 `ClientContext.inject` 两处的说明）。
 *    缺失时**必须给出一条能定位的日志**，不能静默什么也不做。
 *
 * ② **`selectPanel` 会抛**：它在面板未注册时抛
 *    （`dsh-client-ui-layout/lib/client.js:412-414`），而「`main` 槽已声明」
 *    与本命令的可用时机**不是同一件事**（`index.ts` 用 `slots.inject('main', …)`
 *    等声明，声明未到时面板确实不在册）。
 *    ⇒ 不兜住的话，异常会从 `ui.run` 里穿出去 ——
 *    而 `ui.run` 是**裸调用**（`dsh-client-ui-commands/lib/client.js:767`，
 *    `ui.run(session)` 既不看返回值也不 try/catch），穿出去的异常要一路穿过
 *    `invoke` → `dispatch`/`matchEnter` 才到达宿主的处置路径。
 *
 * ⚠ **如实说明本机制的反馈上限**：`ui.run` 的返回值被忽略（同上一行出处），
 * 所以失败**没有**用户可见的提示通道 —— 只能进 console 与诊断字段。
 * 这不是省事，是机制如此；面板在正常使用时机必然已注册（用户能打命令 ⇒
 * GUI 已完全加载 ⇒ `main` 槽早已声明），这个窗口只在启动的头几百毫秒存在。
 *
 * @param get - 取服务（`ctx.get` 的转发，与 `index.ts` 同源）。
 * @param panelId - 目标面板 id（= `main` 槽的 `key`，由 `index.ts` 传入 `PANEL_ID`）。
 */
export function openSophiaPanel(get: (name: string) => unknown, panelId: string): void {
  const layout = asLayout(get('layout'))
  if (layout === undefined) {
    console.error(
      `[sophia] /${SOPHIA_SLASH_COMMAND} 无法打开面板：layout 服务不可用`
      + '（客户端布局插件未挂载）。侧边栏的索菲亚入口仍可手动点击。',
    )
    return
  }
  try {
    layout.selectPanel(panelId)
  } catch (error) {
    console.error(
      `[sophia] /${SOPHIA_SLASH_COMMAND} 打开面板失败（面板 "${panelId}" 尚未注册）：${errorText(error)}`
      + ' —— 侧边栏的索菲亚入口仍可手动点击。',
    )
  }
}

/** `mountSophiaSlashCommand` 的入参。 */
export interface MountSophiaCommandOptions {
  /** 目标面板 id（`main` 槽的 `key`）。**由调用方传入，不在这里硬编码** —— 见注释。 */
  readonly panelId: string
  /** 取服务；`commandUi` 与 `layout` 都经它。 */
  readonly get: (name: string) => unknown
  /** 命令描述（跟随语言的 thunk，`index.ts` 传已有的 `panelEntryTitle` 文案）。 */
  readonly describe: () => string
}

/**
 * 把 `/sophia-agent-entities` 注册到浏览器侧命令面。
 *
 * ## 为什么 `panelId` 与 `describe` 都是**入参**而不是本文件的常量
 *
 * - `panelId` 若在这里再写一份字面量，本包就有**两个真相**（`index.ts` 的
 *   `PANEL_ID` 与本文件），而 `main` 槽的 `key` 与它不一致时宿主会抛
 *   `main panel "…" is not registered`（`dsh-client-ui-layout/lib/client.js:413`；
 *   `index.ts` 的 `main` 槽注册处记录过同一个配对关系）。入参使漂移在结构上不可能。
 * - `describe` 同理：文案真源在 `locales.ts`，这里收一个 thunk 就**不必**复制一份
 *   中英对照（本包「一个事实只有一个真相」的纪律；`index.ts` 的 `LOCALE_NS`
 *   注释处有同源记录）。
 *
 * ## `available` 为什么恒真
 *
 * 面板是**全局**槽位（`main` 的 keyed 槽，不按会话分），任何会话里打这条命令
 * 都该能打开它。这与 `/model` 的 `available` 判据不同
 * （`dsh-client-ui-model-selection/lib/client.js:922` 排除了子代理会话）——
 * 那条命令的作用域是「本会话用哪个模型」，本命令的作用域是「整个界面切到面板」，
 * 两者没有可复用的判据。
 *
 * ## 注册与回收配对
 *
 * 照 `dsh-client-ui-model-selection/lib/client.js:919` /
 * `dsh-client-ui-message-feedback/lib/client.js:870` 的范式：
 * `effect(() => commandUi.register({…}), label)` ——
 * 真实 `register` 内部把注册挂在**调用者 fiber** 上并返回 disposer，
 * 外面再包一层 effect 使「插件停用 ⇒ 命令收回」有着落。
 *
 * ⚠ 本函数**不抛**：所有失败都是返回的 `outcome`（与 `src/tools/types.ts`
 * 文件头第 1 条「绝不抛错」同一口径 —— 这里抛会一路穿到 `apply` 的 catch，
 * 把「命令没挂上」放大成「界面半挂」）。
 *
 * @param effect - 已由调用方做过可调用性检查的 effect 登记器。
 * @param options - 见 `MountSophiaCommandOptions`。
 * @returns 挂载结果（`registered` 之外的三种原因可区分，便于诊断）。
 */
export function mountSophiaSlashCommand(
  effect: EffectRegistrar,
  options: MountSophiaCommandOptions,
): SophiaCommandMount {
  const commandUi = asCommandUi(options.get('commandUi'))
  if (commandUi === undefined) {
    return {
      outcome: 'service-missing',
      detail: 'commandUi 服务不可用（浏览器侧命令面插件未挂载）',
    }
  }

  let dispose: unknown
  /**
   * `commandUi.register` 自己抛出的原因（同名冲突等）。
   *
   * ⚠ 必须与「effect 登记失败」**分开记**（否则会把两种完全不同的病根
   * 报成同一句话）：真实 `register` 在同名时抛
   * （`dsh-client-ui-commands/lib/client.js:556`
   * `ui-commands: duplicate contribution for /X`），而 effect 登记失败是
   * 宿主形状不符。两者都表现为「命令没挂上」，但补救动作完全不同。
   */
  let registerFailure: string | undefined

  const registered = effect(() => {
    let inner: unknown
    try {
      inner = commandUi.register({
        name: SOPHIA_SLASH_COMMAND,
        description: options.describe,
        available: () => true,
        ui: {
          kind: 'action',
          run: () => {
            // ⚠ `run` 收一个 session 参数，但**用不到** —— 面板是全局的
            //   （见上面 `available` 的说明）。这里写成无参闭包而不是
            //   `(session) => { void session … }`：少一个不读的形参，
            //   读的人就不会以为「它其实分会话」。
            openSophiaPanel(options.get, options.panelId)
          },
        },
      })
    } catch (error) {
      // 就地兜住：让 effect 登记**照常成功**（回调正常返回 disposer），
      // 这样「注册本身失败」不会被误报成「effect 登记失败」。
      registerFailure = errorText(error)
      return () => {}
    }
    dispose = inner
    return () => {
      // disposer 是不是函数由 `typeof` 判，不信类型断言（见 `CommandUiFace.register`）。
      if (typeof dispose === 'function') (dispose as () => void)()
    }
  }, 'sophia: slash command')

  if (!registered) {
    // `effect` 不可调用 / 调用即抛 —— 这一步失败时上面的 `register` **从未执行**
    // （effect 的回调由宿主在登记时调用，登记都没成功就没人调它），
    // 所以这里不必回滚任何东西。如实回报原因。
    return {
      outcome: 'effect-unavailable',
      detail: 'host.effect 不可调用或抛错，命令注册未登记（停用插件时也不会被回收）',
    }
  }

  if (registerFailure !== undefined) {
    return {
      outcome: 'register-threw',
      detail: `commandUi.register 抛错：${registerFailure}`,
    }
  }

  return {
    outcome: 'registered',
    detail: `已注册 /${SOPHIA_SLASH_COMMAND} → 打开面板 "${options.panelId}"`,
  }
}
