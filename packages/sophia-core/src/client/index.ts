/**
 * `@sophia/core` 的 client（浏览器）半 —— **真实界面**（`t5`）。
 *
 * 交付四块（对应任务书 1–5 项职责）：
 * 1. **槽位注册**：侧边栏入口（`sidebar.panellist`，list 槽）+ 主区页面
 *    （`main`，keyed 槽，key 与入口 id 相同 —— 宿主点入口时调的
 *    `layout.selectPanel(id)` 会校验 `main` 槽里确实有同名 key，
 *    两者不一致会当场抛 `is not registered`）；
 * 2. **频道页**：频道列表 + 线程列表 + 消息流（`components.tsx`）；
 * 3. **成员卡片**：头像 + 显示名 + 状态点 + 模型切换入口；
 * 4. **活动面板**：可折叠，含进度分段条 / 成员卡 / 阻塞提示；
 * 5. **文案跟随 DSH 官方 locale**（`locales.ts` 的中/英字典）。
 *
 * ── 为什么这个文件必须是 `src/client/index.ts`（**不是 `.tsx`**）──
 * `tests/shell.spec.ts` 有一条验收**直接读本文件的源码**并断言
 * `export const PLUGIN_ID: string = __SOPHIA_PLUGIN_ID__` —— 它守的是
 * 「插件名只有构建期一个真相」。改名成 `.tsx` 会让那条断言因为**读不到文件**
 * 而变红。故 JSX 全部落在 `seats.tsx` / `components.tsx` / `panel.tsx`，
 * 本文件只做挂载编排。
 *
 * ── 为什么这个文件单独一套 tsconfig ──
 * 主 `tsconfig.json` 的 `lib` 被 SPEC §1.3 冻结为 `["es2024"]`（**无 DOM**），
 * 而浏览器半边必然要用 DOM。因此主 tsconfig 用
 * `exclude: ["src/client", "tests/client"]` 把这一半交给 `tsconfig.client.json`。
 *
 * ⚠ **`tsconfig.client.json` 的 `jsx` 设置与上游不同，这是有意且承重的**
 * （OCR 复核 MEDIUM：本注释曾写成「与上游逐字一致（react-jsx）」，
 * 那个写法会让 t1 的一条验收恒红 —— 已按真实配置改写，勿改回去）：
 *
 * ```jsonc
 * "jsx": "react-jsx",
 * "jsxImportSource": "sophia-jsx",
 * "baseUrl": ".",
 * "paths": { "sophia-jsx/jsx-runtime": ["./src/client/jsx-runtime.ts"] }
 * ```
 *
 * 即：**保留自动运行时的严格 prop 检查，但把运行时指向本包自己的
 * `jsx-runtime.ts`**（它惰性取 React，不在模块作用域 `require`）。
 * 依据与实测对照表见 `src/client/react-runtime.ts` 的文件头：
 * 默认的 `react/jsx-runtime` 会在产物里留下**顶层** `require(...)`，而
 * `tests/shell.spec.ts` 用真实 loader 契约 + 一个**会抛错**的 `require`
 * materialize 本 bundle ⇒ 当场变红（已复现 `Error: unexpected require react`）。
 *
 * ── 打包契约（tsdown，见 tsdown.config.ts）──
 * 产物 `lib/client.js` 必须是 CJS 闭包工厂：
 *   `window.__ModuleLoader__.load({ id: '@sophia/core', factory: (require) => {...} })`
 * `id` 必须**逐字等于 package.json 的 name**：宿主按包名查找 bundle，
 * 名字不一致会在浏览器侧才炸（此时宿主半边已经正常加载，症状极难定位）。
 *
 * @module @sophia/core/client
 */

/** 浏览器全局：DSH 模块加载器在脚本执行前已就位。 */
declare global {
  interface Window {
    /** 由 lib/client.js 的 banner 注册本篇工厂。 */
    __ModuleLoader__?: { load(record: { id: string; factory: (require: (id: string) => unknown) => unknown }): void }
    /** 存活标记：供验证脚本与排障判定「client 半真的挂上了、挂到哪一步」。 */
    __SOPHIA_CLIENT__?: {
      plugin: string
      phase: string
      mountedAt: number
      /** 如实回报本次挂载实际做到了哪几件事（失败面可见，不假装成功）。 */
      surfaces: { styles: boolean; locale: boolean; sidebarEntry: boolean; mainPanel: boolean }
      /**
       * 斜杠命令 `/sophia-agent-entities` 的注册状态（`src/client/commands.ts`）。
       *
       * ⚠ **为什么它不在 `surfaces` 里**（如实说明）：`surfaces` 有既有的
       * 精确形状断言（`tests/client/panel.spec.tsx:404-411` 对四个键做
       * `toEqual`），加第五个键会**打红一条与本改动无关的既有验收**。
       * 而命令注册本来就**不是槽位能力**（它是命令面），挂在标记上另起一个
       * 字段既保住了「不谎报」的可诊断性，也不动那份四键契约。
       */
      slashCommand: SlashCommandMarker
    }
  }
}

/**
 * 斜杠命令的注册状态 —— **闭集**，每个取值对应一条可区分的真实路径。
 *
 * `pending` 与 `unsupported` 不是失败：前者是「已登记、等 `commandUi` 服务就绪」，
 * 后者是「宿主 ctx 没有 `inject`，无法等可选服务就绪（命令挂不上，但界面照常）」。
 * 这两个取值存在的意义是让「还没到」与「到不了」**可区分** ——
 * 只报一个布尔的话，排障时读到的 `false` 有四种完全不同的病根。
 */
export type SlashCommandState = 'pending' | 'unsupported' | SophiaCommandMount['outcome']

/** `window.__SOPHIA_CLIENT__.slashCommand` 的形状。 */
export interface SlashCommandMarker {
  /** 命令名（与 `SOPHIA_SLASH_COMMAND` 同源，不在这里重述字面量）。 */
  readonly name: string
  /**
   * ⚠ 声明成**可变**（不是 `readonly`）且整个标记对象是同一个引用：
   * `ctx.inject` 的回调可能在 `apply` 返回**之后**才跑（服务晚到），
   * 那时才更新状态 —— 与 `surfaces` 的实时语义一致（本文件「侧边栏入口」
   * 一节记录过「只置 true 不归零」的同类缺陷）。诊断脚本读的是实时值。
   */
  state: SlashCommandState
  /** 人类可读的原因 / 去向。 */
  detail: string
}


import { PanelStore } from './panel-store.ts'
import { injectStyles } from './styles.ts'
import { EntrySeat, PanelSeat } from './seats.tsx'
import { detectLocale, en, translatorFor, zh, type LocaleKey } from './locales.ts'
import { mountSophiaSlashCommand, SOPHIA_SLASH_COMMAND, type SophiaCommandMount } from './commands.ts'
import type { Translate } from './components.tsx'

/**
 * 插件名 —— 由**构建期**从 `package.json` 注入，源码里不再重述字面量。
 *
 * 为什么不用 `export const PLUGIN_ID = '@sophia/core'`：
 * banner 里的 `id` 是 `tsdown.config.ts` **读** package.json 得到的。
 * 若这里再写一份字面量，包一旦改名就会变成**两个真相**：bundle 注册 id
 * 跟着 package.json 变，而本常量静默不变 —— 而 id 不一致正是本文件头部
 * 警告过的那种「宿主半边已正常加载、只在浏览器里静默找不到」的故障。
 * 这里会退化成一个假的存活标记：`window.__SOPHIA_CLIENT__.plugin` 报旧名。
 *
 * 实现：`tsdown.config.ts` 里 `define: { __SOPHIA_PLUGIN_ID__: ... }`
 * 在打包时把下面这个标识符替换成 package.json 的 name。
 */
declare const __SOPHIA_PLUGIN_ID__: string

/** 插件名；与 `package.json` 的 `name` 同源（构建期注入）。 */
export const PLUGIN_ID: string = __SOPHIA_PLUGIN_ID__

/** 本插件在 UI 里的面板 id（`sidebar.panellist` 用 `id`，`main` 用同名 `key`）。 */
export const PANEL_ID = 'sophia'

/**
 * locale 命名空间。
 *
 * ⚠ **由 `PANEL_ID` 派生，不重复写一遍字面量**（OCR 复核 MEDIUM）：
 * 初版两处各写 `'sophia'`，与「一个事实只有一个真相」的纪律冲突 ——
 * 改 `PANEL_ID` 而漏改这里，会让 `slots.register` 声明的 locale 命名空间
 * 与已注册的字典命名空间对不上，症状只是「界面没翻译」，很难定位。
 * 两者本就该同值（同一个插件名），所以直接派生。
 */
export const LOCALE_NS: string = PANEL_ID

/**
 * 两处槽位注册的 `order`。
 *
 * 提成常量（OCR 复核 LOW）：初版在两个 `slots.register` 里各写 `40`，
 * 改一处漏一处会让面板在侧栏排到意想不到的位置 —— 不报错，只是顺序不对。
 */
const SLOT_ORDER = 40

/**
 * 硬依赖服务：**只有 `slots`**。
 *
 * `slots` 是**硬**依赖：没有它一个槽位也注册不上，界面无从谈起 ——
 * 声明它让 Cordis 在服务到齐后再激活，比「激活了却什么都不做」诚实。
 * 它由 `dsh-client-ui-renderer` 提供、是 GUI 的核心服务，必然在场。
 *
 * ⚠ 其余服务（`locale` / `layout` / `connection`）一律**不**声明，
 * 改用 `ctx.get()` 惰性探测并按缺失降级：把可选服务写进 `inject` 会把
 * 「某个服务没装」升级成「整个浏览器半不加载」。
 */
export const inject: readonly string[] = ['slots']

// ────────────────────────────────────────────────────────────────────────────
// 宿主上下文的最小面（结构化声明；本包不 import 任何 @deepseek-ai/* 类型）
// ────────────────────────────────────────────────────────────────────────────

/** 槽位注册面。 */
interface SlotRegistryFace {
  register(options: {
    name: string
    id?: string
    key?: string
    order?: number
    label?: string | (() => string)
    locale?: string
    inject?: () => Record<string, unknown>
  }, component: unknown): () => void
  /** 等某个槽位被声明后再挂；返回幂等 disposer。 */
  inject(key: string, callback: () => (() => void) | readonly (() => void)[]): () => void
}

/** locale 面。 */
interface LocaleFace {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): (key: string, params?: Readonly<Record<string, string | number>>) => string
}

/** 客户端插件上下文里本文件用到的部分。 */
interface ClientContext {
  get(name: string): unknown
  effect(execute: () => void | (() => void), label?: string): unknown
  /**
   * **服务就绪注入**（cordis 内置方法，不是插件的 `export const inject`）。
   *
   * 为什么需要它：`commandUi`（浏览器侧命令面）**可能晚于本插件就绪** ——
   * 浏览器半的插件加载顺序不保证（本仓 t1 实测过「宿主半 import 失败会连
   * 浏览器半一起不被发现」，故不假定声明一定已在场）。用一次性
   * `ctx.get('commandUi')` 探测的话，服务晚到就**永久**拿不到了。
   *
   * 依此的三个真实调用点（本机 SDK 内，逐个读过）：
   * - `dsh-client-ui-model-selection/lib/client.js:915`
   *   `ctx.inject(["commandUi", "modelDirectories"], (scope) => {…})`
   * - `dsh-client-ui-message-feedback/lib/client.js:869`
   *   `ctx.inject(["commandUi"], (scope) => {…})`
   * - `dsh-client-ui-conversation/lib/client.js` 的 `ctx.get("commandUi")?.…`
   *   （说明 `get` 同样能拿到该服务 —— 两种取法并存，本文件用 `get`）。
   *
   * ⚠ 声明成**可选**：宿主形状不符时按「等不了服务就绪」降级并如实回报
   * （`SlashCommandState` 的 `unsupported`），而不是抛 ——
   * 命令挂不上不该让整个界面消失（与 `export const inject` 处记录的既有纪律一致）。
   */
  inject?(deps: readonly string[], callback: (scope: unknown) => void): unknown
}

function asSlots(value: unknown): SlotRegistryFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { register?: unknown; inject?: unknown }
  return typeof candidate.register === 'function' && typeof candidate.inject === 'function'
    ? (value as SlotRegistryFace)
    : undefined
}

function asLocale(value: unknown): LocaleFace | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { register?: unknown; bind?: unknown }
  return typeof candidate.register === 'function' && typeof candidate.bind === 'function'
    ? (value as LocaleFace)
    : undefined
}

// ────────────────────────────────────────────────────────────────────────────
// 挂载
// ────────────────────────────────────────────────────────────────────────────

/**
 * 挂载 client 半。
 *
 * ⚠ 这里的 try/catch **拦的是哪一类异常**（勿再含糊）：
 * 它**不**能救「`__SOPHIA_PLUGIN_ID__` 没被替换」——那个会在**模块求值期**、
 * 即 `export const PLUGIN_ID = __SOPHIA_PLUGIN_ID__` 那一行就炸，早于 `apply`。
 * 它真正罩住的是挂载过程中的一切异常（DOM 不可用、槽位注册撞车、
 * 宿主服务形状不符）。浏览器半边一旦把异常抛进宿主派发路径，会连累同一
 * combo 的其它 UI 组件（本机实测过这起事故）。所以这一层保留。
 *
 * @param ctx - 客户端插件上下文（结构化类型，见 `ClientContext`）。
 */
export function apply(ctx: unknown): void {
  // 「不在浏览器环境」要**显式**判掉，不能靠下面那个 catch 顺手吞：
  // 非浏览器环境下裸引用 `window` 抛的是 `ReferenceError: window is not defined`，
  // 被 catch 吞掉后 `apply` 正常返回、却没写存活标记 ⇒
  // 「挂上了」与「没挂上」在调用方看来**无法区分**。
  if (typeof window === 'undefined') {
    console.error('[sophia] client apply skipped: 不在浏览器环境（window 未定义），未挂载')
    return
  }
  const host = ctx as Partial<ClientContext>
  const surfaces = { styles: false, locale: false, sidebarEntry: false, mainPanel: false }
  /**
   * 登记一个 effect —— **先确认它真的是函数**（OCR 复核 MEDIUM）。
   *
   * 初版一律写 `host.effect?.(…)`：可选调用只保证「不是 `null`/`undefined`」，
   * 若宿主给的是一个**真值但不可调用**的属性（形状不符），它会抛 `TypeError`，
   * 而外层 `catch` 会把它吞掉 ⇒ 后续所有清理登记（store、样式、槽位 disposer）
   * **静默全部跳过**，正好复活了本文件刚修掉的那些泄漏；
   * 且存活标记也不会写，报成「未挂载」，与真实原因（宿主形状不符）不符。
   * 现在：不是函数就跳过并 `warn`（**不抛**），让挂载继续、让问题可见。
   *
   * ⚠ **返回「登记是否真的成功」**（captain 派修的族D 真缺陷）：
   *   初版返回 `void`，于是调用方只能**写完 `registerEffect(...)` 就无条件**
   *   `surfaces.X = true` —— 而上面那条早退路径（`host.effect` 不可调用）
   *   会让 `execute` **从不执行**、资源从未就绪，**标记却仍然报 true**。
   *   这与本文件自己的「不谎报」契约直接矛盾：`surfaces` 是
   *   `window.__SOPHIA_CLIENT__` 上供诊断读的**实时**标记，谎报 true 会让
   *   排障的人以为「样式已就绪 / 字典已注册」，从而往错方向查。
   *   ⇒ 让本函数**如实回报结果**，由调用方据此写标记（标记只能反映真实结果）。
   *
   * @returns 登记是否真的成功（`target.effect` 被调用且没抛）。
   *
   * ⚠ **为什么是工厂而不是一个函数**（本改动新增）：命令注册要挂在
   * `ctx.inject(['commandUi'], scope => …)` 给的**子作用域**上（理由见
   * `ClientContext.inject` 的注释），而 `scope` 与根 `host` 都有 `effect`。
   * 写两份就会让「可调用性检查 + 失败隔离 + 如实回布尔」这三条契约漂移成两套
   * —— 那正是本函数当初修掉的缺陷的形态（见上面族D 的记录）。
   * 抽成工厂后，两个作用域**共用同一份判据**。
   */
  const registerEffectFor = (target: Partial<ClientContext>) => (
    execute: () => void | (() => void),
    label: string,
  ): boolean => {
    if (typeof target.effect !== 'function') {
      console.warn(`[sophia] host.effect 不可调用，跳过登记：${label}（相应资源不会随卸载回收）`)
      return false
    }
    try {
      target.effect(execute, label)
      return true
    } catch (error) {
      console.warn(`[sophia] host.effect 登记失败（跳过）：${label}`, error)
      // ⚠ 登记失败也要让 `execute` **别留下半成品**：`host.effect` 抛错时
      //   `execute` 可能已经跑过（资源已申请）而 disposer 没被宿主接管。
      //   这里不额外回滚（看不到 `execute` 的返回值），但**如实回 false**，
      //   让调用方知道「标记不能写 true」。
      return false
    }
  }

  /** 根 ctx 上的登记器（下面所有槽位 / 样式 / store 都用它）。 */
  const registerEffect = registerEffectFor(host)
  try {
    // ── 1. 槽位服务（硬依赖）**先探测**（OCR 复核 MEDIUM 要求调序）──
    // 初版先注册 locale 字典、再探测 `slots`，于是「slots 缺失」这条**注定失败**
    // 的路径在返回前已经产生了副作用（字典已注册、disposer 挂在宿主上）。
    // ⇒ 把不可避免的失败判据提到前面：失败路径尽量**零残余副作用**。
    const slots = asSlots(typeof host.get === 'function' ? host.get('slots') : undefined)
    if (slots === undefined) {
      console.error('[sophia] client apply: slots 服务不可用，未挂载（界面无法注册任何槽位）')
      return
    }

    // ── 2. 文案字典（可选服务；缺失时退回内置语言探测）──
    const locale = asLocale(typeof host.get === 'function' ? host.get('locale') : undefined)
    let translate: Translate = translatorFor(detectLocale())
    if (locale !== undefined) {
      try {
        // id 兼容键（2026-09-24 主人实测「面板是英文」的根因之二的防御）：
        // 服务当前语言若内部规范化成 'zh-CN'/'zh_CN'，只注册 {zh, en} 会查不到
        // 字典 ⇒ bind 静默回退英文。常见写法全映上，无论服务用哪种 id 都命中中文
        // （settings.yaml locale.preference 是字面 'zh'，服务侧真值在 DSH 闭源包内，
        // 静态取不到 —— 故兼容而不是赌一个）。
        const disposeDict = locale.register(LOCALE_NS, { zh, en, 'zh-CN': zh, 'zh_CN': zh })
        const bound = locale.bind(LOCALE_NS)
        // 服务在场 ⇒ 跟随用户语言切换（`bind` 的 t 在每次调用时解析当前语言）。
        translate = (key: LocaleKey, params) => bound(key, params)
        // ⚠ 标记只在**登记真的成功**时写 true（族D）：`registerEffect` 早退
        //   （`host.effect` 不可调用）时 disposer 从未登记，标记若写 true
        //   就**永久无法复位**、且与「不谎报」契约矛盾。
        surfaces.locale = typeof disposeDict === 'function'
          ? registerEffect(() => () => {
            surfaces.locale = false
            disposeDict()
          }, 'sophia: dictionaries')
          // 没有 disposer 可登记 ⇒ 字典已注册但没有回收路径，
          // 此刻「已注册」是事实，但**不应**声称能回收 ⇒ 如实报 true、
          // 不再声称可逆（`surfaces` 语义是「本次真的做成了什么」）。
          : true
      } catch (error) {
        // 字典重复注册会抛（locale 服务的 `already has locale` 检查）。
        // 那不是致命错误：退回内置翻译即可，界面文案仍然完整。
        console.warn('[sophia] locale registration skipped, using built-in dictionaries:', error)
      }
    }

    const store = new PanelStore()
    // ⚠ `PanelStore` 必须**随 effect 一起回收**（OCR 复核 HIGH 抓到的真实缺陷）：
    //   初版创建后从没调过 `store.dispose()`，而它的生命周期**不**绑定到
    //   `PanelSeat` 组件（store 只是作为 props 传进去）。于是槽位 effect 的
    //   disposer 跑完、面板已被回收之后 store 仍存活：一次尚未返回的 `load()`
    //   响应回来时照样 notify 监听者、改写状态 —— 正是「卸载后仍更新状态」的泄漏
    //   （`panel-store.ts` 里为此专门备了 `disposed` 标志与 `listeners` 集合，
    //   但**调用方从没触发它**，那两个机制形同虚设）。
    //   把释放挂到 effect 上，reload / 停用插件 / 槽位消失都会走到这里。
    registerEffect(() => () => {
      store.dispose()
    }, 'sophia: panel store')

    // ── 3. 样式（幂等注入；随 effect 回收）──
    // ⚠ 标记只在**登记真的成功**时写 true（族D 真缺陷）：`registerEffect` 早退时
    //   `injectStyles` 从不执行、样式从未注入，标记却报 true —— 与「不谎报」矛盾。
    if (typeof document !== 'undefined') {
      surfaces.styles = registerEffect(() => {
        const removeStyles = injectStyles(document)
        return () => {
          // ⚠ 标记与资源**一起**回位（OCR 复核 MEDIUM）：`surfaces` 是
          //   `window.__SOPHIA_CLIENT__` 上的同一个对象，诊断读的是实时值；
          //   只置 true 不归零会让「样式已移除」之后标记仍宣称 `styles: true`。
          surfaces.styles = false
          removeStyles()
        }
      }, 'sophia: styles')
    }

    // ── 4. 侧边栏入口（`sidebar.panellist` 是 list 槽：靠 `id` 区分单元）──
    // 用 `slots.inject` 而不是直接 `register`：这两个槽位由别的插件声明，
    // 加载顺序不保证（t1 实测过「宿主半 import 失败会连浏览器半一起不被发现」，
    // 故这里不能假定声明一定已经存在）。
    // `inject` 的回调在声明出现时同步跑一次、声明消失时回收，
    // 因此 surfaces 的置位反映的是「本次真的挂上了」。
    //
    // ⚠ **回收时要把标记清回去**（OCR 复核 LOW）：`surfaces` 是
    //   `window.__SOPHIA_CLIENT__` 上**同一个对象引用**，诊断脚本读的是**实时值**。
    //   初版只置 `true`、从不清零，于是槽位声明消失 / 插件停用之后，
    //   标记仍然宣称 `sidebarEntry: true` —— 与「不谎报」的契约矛盾。
    //   在返回的 disposer 里归位，让标记在**任何时刻**都诚实。
    registerEffect(() => slots.inject('sidebar.panellist', () => {
      const dispose = slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: SLOT_ORDER,
        label: () => translate('panelLabel'),
        locale: LOCALE_NS,
        inject: () => ({ t: translate }),
      }, EntrySeat)
      surfaces.sidebarEntry = true
      return () => {
        surfaces.sidebarEntry = false
        dispose()
      }
    }), 'sophia: sidebar entry')

    // ── 5. 主区页面（`main` 是 keyed 槽；key 必须与 panellist 的 id 相同）──
    // ⚠ `key` 与上面 `id` 都取 `PANEL_ID`，**不是**两处各写一遍 ——
    //   这个配对关系是本文件头顶警告过的运行时抛错来源（`layout.selectPanel`
    //   找不到 `main` 槽就当场抛），同源才能保证一致。
    // `order` 也提成常量：两处原本各写 `40`，改一处漏一处会让面板在侧栏
    //   排到意想不到的位置（不报错，只是顺序不对）。
    registerEffect(() => slots.inject('main', () => {
      const dispose = slots.register({
        name: 'main',
        key: PANEL_ID,
        order: SLOT_ORDER,
        label: () => translate('panelTitle'),
        locale: LOCALE_NS,
        inject: () => ({ store, t: translate }),
      }, PanelSeat)
      surfaces.mainPanel = true
      return () => {
        surfaces.mainPanel = false
        dispose()
      }
    }), 'sophia: main panel')

    // ── 6. 斜杠命令 `/sophia-agent-entities`（**浏览器侧**命令面）──
    // 机制出处（哪一行、为什么必须走浏览器面而不是宿主面）逐条写在
    // `src/client/commands.ts` 的文件头。这里只做三件事：
    // **等 `commandUi` 就绪** → 注册 → 如实记账。
    //
    // ⚠ **为什么必须先等、不能一次性探测**：`ctx.get('commandUi')` 只反映
    //   「这一刻在不在」，而浏览器半的插件加载顺序不保证（第 4 节的同源理由）
    //   ⇒ 服务晚到就**永久**拿不到、命令静默挂不上。`ctx.inject` 是 cordis 的
    //   服务就绪注入：就绪时回调跑一次，插件停用时回调登记的 effect 被回收。
    //
    // ⚠ **不把 `commandUi` 写进 `export const inject`**（两条独立理由）：
    //   ① 那会把「这个可选服务没装」升级成「整个浏览器半不加载」⇒ 面板一起消失
    //      （与 `ClientContext.inject` 处记录的可选服务纪律一致）；
    //   ② 既有验收把 `inject` 钉成逐字 `['slots']`
    //      （`tests/client/panel.spec.tsx:193`）—— 加进去会打红一条无关的验收。
    //
    // ⚠ **状态写在 `slashCommand` 这个对象引用上**（而不是一个 `let` 布尔）：
    //   `ctx.inject` 的回调可能在 `apply` 返回**之后**才跑（服务晚到），
    //   而诊断读的是 `window.__SOPHIA_CLIENT__` 上的**实时值** ——
    //   与 `surfaces` 同一手法（本文件「侧边栏入口」一节记录过「只置 true
    //   不归零」那类缺陷，同一个坑不踩第二遍）。
    const slashCommand: SlashCommandMarker = {
      name: SOPHIA_SLASH_COMMAND,
      // 默认值即「等不了」：下面 `inject` 不可用时**不改写它**，于是标记
      // 一开始就诚实地报「这条路走不通」，不用一条额外的赋值去说明。
      state: 'unsupported',
      detail: '宿主 ctx 没有 inject 方法，无法等 commandUi 服务就绪（命令未注册）',
    }
    if (typeof host.inject === 'function') {
      // 已登记、等就绪 ⇒ 先如实报「还没定」，服务一到立刻改写。
      slashCommand.state = 'pending'
      slashCommand.detail = '已登记，等待 commandUi 服务就绪'
      try {
        host.inject(['commandUi'], (scope: unknown) => {
          // 子作用域的形状按「与根 ctx 同形」收窄；形状不符时退化成
          // `{}` ⇒ `registerEffectFor` 报不可调用、`get` 恒 undefined ⇒
          // 结果是如实的 `service-missing` / `effect-unavailable`，不抛。
          const scopeHost = (typeof scope === 'object' && scope !== null ? scope : {}) as Partial<ClientContext>
          const mounted: SophiaCommandMount = mountSophiaSlashCommand(
            registerEffectFor(scopeHost),
            {
              // `main` 槽的 key —— 由这里传入而不是在 commands.ts 里重述，
              // 理由见该文件的 `MountSophiaCommandOptions.panelId`。
              panelId: PANEL_ID,
              get: (name) => (typeof scopeHost.get === 'function' ? scopeHost.get(name) : undefined),
              // 文案**复用侧边栏入口的既有键**（`panelEntryTitle` =
              // 「打开索菲亚团队面板」 / 'Open the Sophia team panel'）：
              // 命令做的事与那个入口完全相同 ⇒ 复用而非新增 locale 键
              // （「一个事实只有一个真相」；主人 2026-09-24 实测过文案两处漂移
              // 导致的「面板是英文」那类事故，见「文案字典」一节的兼容键注释）。
              describe: () => translate('panelEntryTitle'),
            },
          )
          slashCommand.state = mounted.outcome
          slashCommand.detail = mounted.detail
          if (mounted.outcome === 'registered') {
            console.log(`[sophia] slash command ready: /${SOPHIA_SLASH_COMMAND} → panel "${PANEL_ID}"`)
          } else {
            console.warn(`[sophia] 斜杠命令未挂上（${mounted.outcome}）：${mounted.detail}`)
          }
        })
      } catch (error) {
        // `ctx.inject` 本身抛（宿主形状怪）：命令挂不上，但界面照常 ——
        // 不把这个异常放到外层 catch 里去（那会把「命令没挂」放大成「界面半挂」）。
        slashCommand.state = 'unsupported'
        slashCommand.detail = `host.inject 调用失败：${error instanceof Error ? error.message : String(error)}`
        console.warn('[sophia] 斜杠命令注册跳过（inject 调用失败）:', error)
      }
    } else {
      // 不静默（与 `slots` 缺失时报 error 同一纪律），但**不**升级成
      // error：界面其余能力完好，缺的只是命令入口。
      console.warn(
        `[sophia] ctx.inject 不可用，斜杠命令 /${SOPHIA_SLASH_COMMAND} 未注册`
        + '（界面其余能力不受影响；状态见 window.__SOPHIA_CLIENT__.slashCommand）',
      )
    }

    // ── 7. 存活标记 ──
    // `surfaces` 如实反映「到这一刻为止真的做成了什么」：
    // - `styles` / `locale` 是**同步**完成的，故此刻必然已定；
    // - `sidebarEntry` / `mainPanel` 取决于槽位**声明**是否已存在：
    //   `slots.inject` 在声明已存在时**同步**执行回调（于是为 true），
    //   声明尚未出现时只是登记等待（于是为 false，等声明到位后由服务补挂）。
    //   ⇒ 两者都可能是当次的真实结果，**不预设**哪一边 —— 早期版本在注释里
    //     断言「必然为 false」，那只在槽位尚未声明时成立（实测纠正）。
    // - `slashCommand` 同理可能是 `pending`（`ctx.inject` 的回调还没跑）。
    // 关键纪律不变：**不谎报**。这里不写死任何一项，只落实际值。
    window.__SOPHIA_CLIENT__ = {
      plugin: PLUGIN_ID,
      phase: 'ui',
      mountedAt: Date.now(),
      surfaces,
      slashCommand,
    }
    console.log(`[sophia] client UI mounted (${PLUGIN_ID})`, surfaces, slashCommand)
  } catch (error) {
    // 见上：罩住挂载过程；不谎报成功。
    console.error('[sophia] client apply failed (ignored):', error)
  }
}
