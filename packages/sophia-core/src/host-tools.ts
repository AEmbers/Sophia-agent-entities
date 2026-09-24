/**
 * 宿主侧**工具注册适配层**（`t1` 装配：把 `t4` 的描述符交给宿主的 `tools` 服务）。
 *
 * ## 这一层解决的是「形状差」，不是「业务」
 *
 * `t4` 交付的是 `SophiaToolDescriptor`（`{name, description, parameters, render, run}`，
 * 见 `src/tools/types.ts`），而宿主注册链要的是另一套形状。两处差异都是**实测**的：
 *
 * | 缺口 | 宿主的硬要求 | 证据 |
 * |---|---|---|
 * | `defineTool` 要 `output` **整体** | `register()` 必抛 | `dsh-tools/lib/index.js:2776` 原文：`must declare output { schema, render, presentationMeta? }` |
 * | 字段名是 `output.schema` | 由 `valueSchemaSpecToJsonSchema` 编译 | 同文件 `:847` |
 * | 执行入口叫 `execute` | `defineTool` 读 `options.execute` | 同文件 `:838` |
 *
 * 实测（仓库外探针，真实 `defineTool`）：把**只有 `render` 没有 `output`** 的形状喂进去
 * ⇒ `TypeError: Cannot read properties of undefined (reading 'render')`；
 * 组装成 `output: { schema, render }` ⇒ 通过。
 *
 * ## ⚠ 这里**只搬家，不转换**（这是本层唯一容易写错的地方）
 *
 * `t4` 已经在自己的 `sophiaToolDescriptor()` 里做完了全部形状适配：
 *
 * - `outputSchema` 是**裸 DSL**（与 `parameters` 同源）⇒ 原样塞进 `output.schema` 即可，
 *   编译交给 `defineTool`（它调 `valueSchemaSpecToJsonSchema`）。
 *   **不要**在这里预转成标准 JSON Schema —— 那会让编译发生两次。
 * - `render` 已经是 **`(args, output) => Content[]`**（`types.ts` 的注释写明「本层主动对齐它，
 *   而不是留给装配层去包一层」，理由正是「谁负责让两者对上」会成为没人负责的缝）。
 *   ⇒ **原样转交**。这里**绝不能**再包一次 `[{type:'text', text: …}]`：
 *   那会把已经是 `Content[]` 的值嵌进 text 里，模型收到的是
 *   `"[object Object]"` 之类的字符串而不是结构化内容 —— 而编译、类型检查**都不会报错**。
 * - `parameters` 同理原样透传（编译器是 `defineTool`，见上）。
 *
 * ⇒ 本层的职责收窄成一句：**把 `t4` 的三个字段搬到 `defineTool` 认的键名上**。
 * 任何"顺手转换"都是造第二份契约。
 *
 * ## ⚠ 刻意不 import `@deepseek-ai/dsh-tools`
 *
 * SPEC §1.1 的实测结论：本机 SDK 安装递归含 **0 个 `.d.ts`** ⇒ 静态 `import` 会以
 * `TS7016`/`TS2307` 失败。且该包**不在本仓的解析链里**（实测三处 `node_modules/@deepseek-ai`
 * 全不存在），npm 上只有远旧版本（`0.0.1-rc.1` / `0.1.0-rc.x`），而宿主运行期是 `0.1.5-rc.2`
 * ⇒ 装进来会拿到**插件私有的那一份**，与宿主正在用的那份版本偏斜。
 *
 * ⇒ 沿用本仓既有的处置（与 `src/host.ts` 对 `webServer` / `systemPrompt` 同一条纪律）：
 * **结构化声明**。真正的 `defineTool` 由宿主在运行期用**计算出的 specifier** 解析后注入
 * （见 `src/host.ts` 的 `resolveDefineTool`），tsc 因此从不看到那个裸包名。
 *
 * @module @sophia/core/host-tools
 */

import { createSophiaTools } from './tools/index.ts'
import type { SophiaToolDescriptor, SophiaToolName, SophiaToolsDeps } from './tools/index.ts'

// ────────────────────────────────────────────────────────────────────────────
// 宿主面（结构化声明）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 交给 `defineTool` 的入参（本层唯一的对外形状）。
 *
 * 字段名与语义逐条对应 `defineTool` 的读取点（见文件头的对照表）；
 * 刻意全部用 `unknown` 承接，因为本层**不校验**模型输入 ——
 * 真正的门禁在 `SophiaToolDescriptor.run` 内部（`t4` 的契约：入参是未校验的模型输入）。
 */
export interface SophiaDefineToolOptions {
  readonly name: string
  readonly description: string
  /** `t4` 的**裸 map**，原样透传（编译器是 `defineTool`，见文件头）。 */
  readonly parameters: Readonly<Record<string, unknown>>
  readonly output: {
    /** `t4` 的 `outputSchema`（**裸 DSL**）原样透传；不在此预转成标准 JSON Schema。 */
    readonly schema: unknown
    /** `t4` 的 `render`（已经是 `(args, output) => Content[]`）原样转交。 */
    readonly render: (args: unknown, value: unknown) => unknown
  }
  readonly execute: (args: unknown, exec: unknown) => Promise<unknown>
}

/** `defineTool` 的最小面（运行期由宿主注入真实实现）。 */
export type SophiaDefineTool = (options: SophiaDefineToolOptions) => unknown

/**
 * 工具注册表的最小面（`ctx.tools`）。
 *
 * ⚠ 它**只接受已编译**的定义：`register()` 会调用 `assertSupportedJsonSchema(output.schema)`，
 * 但**不**编译 `parameters` —— 编译那一步是 `defineTool` 的职责。
 * 所以本层必须走 `defineTool`，不能把裸 map 直接塞给 `register`
 * （那样模型会看到未经规范化的参数结构）。
 */
export interface SophiaToolsRegistry {
  register(definition: never): unknown
}

/** 一次注册里失败的一项。**如实带出**，不吞掉。 */
export interface SophiaToolRegistrationFailure {
  readonly name: SophiaToolName
  readonly error: unknown
}

/** 一次注册的**结构化事实**（宿主与测试都读它，而不是靠日志推断）。 */
export interface SophiaToolRegistration {
  /** 确实注册成功的工具名，顺序 = `SOPHIA_TOOL_NAMES`。 */
  readonly registered: readonly SophiaToolName[]
  /** 每一项 `register()` 返回的 disposer（拿不到时为 `undefined`，与「是否注册成功」无关）。 */
  readonly disposers: readonly (() => void)[]
  /** 注册失败的工具（空数组 ⇒ 全部成功）。 */
  readonly failed: readonly SophiaToolRegistrationFailure[]
}

// ────────────────────────────────────────────────────────────────────────────
// 适配与注册
// ────────────────────────────────────────────────────────────────────────────

/**
 * 把一个描述符翻成 `defineTool` 的入参。
 *
 * **只搬家，不转换** —— 三个字段各自原样搬到 `defineTool` 认的键名上：
 * 1. `parameters` → `parameters`（裸 map；编译交给 `defineTool`）；
 * 2. `outputSchema` → `output.schema`（裸 DSL；编译交给 `valueSchemaSpecToJsonSchema`）；
 * 3. `render` → `output.render`（**已经是 `(args, output) => Content[]`，直接转交**）；
 * 4. `run` → `execute`（`await` 一次保持同形，避免"同步工具"成为宿主的分支）。
 *
 * ⚠ 第 3 条是这里最容易写错的地方：**不要**再包一层 `[{type:'text', …}]`。
 * 那会把一个 `Content[]` 塞进 `text` 字段，而类型与编译都**不会**报错
 * （见文件头「只搬家，不转换」）。
 */
export function toDefineToolOptions(descriptor: SophiaToolDescriptor): SophiaDefineToolOptions {
  return {
    name: descriptor.name,
    description: descriptor.description,
    parameters: descriptor.parameters,
    output: {
      schema: descriptor.outputSchema,
      render: descriptor.render,
    },
    execute: async (args: unknown) => descriptor.run(args),
  }
}

/**
 * 把**一个成员**的整套工具注册进 registry。
 *
 * ## 为什么按成员注册，而不是全进程注册一份
 *
 * `SophiaToolsDeps.caller` 是**闭包里的常量**（`t4` 的契约：
 * 「宿主应**按成员各建一份**，而不是全进程共用一份」），这是结构性防冒充：
 * 「我是谁」不在参数里，模型填不出别人的身份。
 *
 * ⚠ **由此推出一条硬约束**：本函数**不能**拿一个编造的 caller 去全局注册 ——
 * `t4` 的对照实现 `dsh-agent-teams/src/tools.ts:139` 是每次执行时从
 * `exec.agent` 解析调用者，而本包的 caller 是注册期绑定。用假 caller 全局注册，
 * 会让工具以**别人的身份**往 append-only 账本写上永不消失的假历史
 * （`t4` 文件头第 4 条：伪造 `from` 是永久性污染）。所以调用方必须保证
 * `deps.caller` 是该成员**真实**的身份。
 *
 * ## 为什么逐项 try 而不是整体 try
 *
 * `register()` 对重复名会抛（`dsh-tools` 的注册表语义）。整体 try 会让
 * 「第 3 个失败」把第 4、5 个也一起丢掉 —— 而调用方从异常里看不出到底注册上了几个。
 * 逐项收下来后，`registered` / `failed` 就是**结构化事实**，
 * 与 `src/host.ts` 里「判据是 `registered` 布尔量，不是 disposer 形状」同一条纪律。
 *
 * @param defineTool - 运行期解析到的真实 `defineTool`。
 * @param registry - 目标注册表（`ctx.tools`，或某个成员 Agent 自己的那层上下文）。
 * @param deps - 该成员的工具集依赖（`caller` 必须是它**真实**的身份）。
 */
export function registerSophiaTools(
  defineTool: SophiaDefineTool,
  registry: SophiaToolsRegistry,
  deps: SophiaToolsDeps,
): SophiaToolRegistration {
  const registered: SophiaToolName[] = []
  const disposers: Array<() => void> = []
  const failed: SophiaToolRegistrationFailure[] = []

  for (const descriptor of createSophiaTools(deps)) {
    try {
      const returned = registry.register(
        defineTool(toDefineToolOptions(descriptor)) as never,
      )
      // 走到这一行说明 register 没抛 ⇒ 注册已发生（与 host.ts 的 `registered` 同理）。
      registered.push(descriptor.name)
      // disposer 只在真是函数时才留用：拿不到它**不影响**「已注册」的判定。
      if (typeof returned === 'function') disposers.push(returned as () => void)
    } catch (error) {
      failed.push({ name: descriptor.name, error })
    }
  }

  return { registered, disposers, failed }
}

/** 结构化守卫：把 `unknown` 收窄成可用的注册表面。 */
export function asToolsRegistry(value: unknown): SophiaToolsRegistry | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { register?: unknown }
  return typeof candidate.register === 'function'
    ? (value as SophiaToolsRegistry)
    : undefined
}

/** 结构化守卫：把 `unknown` 收窄成可用的 `defineTool`。 */
export function asDefineTool(value: unknown): SophiaDefineTool | undefined {
  return typeof value === 'function' ? (value as SophiaDefineTool) : undefined
}

// ────────────────────────────────────────────────────────────────────────────
// 运行期解析 `defineTool`（**不是**编译期 import）
// ────────────────────────────────────────────────────────────────────────────

/**
 * `dsh-tools` 的包名。
 *
 * 放在变量里（而不是字面量内联进 `import(...)`）是**有意的**：
 * 本仓实测过 tsc 对动态 import 的解析行为（见 `tests/shell.spec.ts` 文件头那张对照表）：
 * **字面量**动态 `import('pkg')` 依然会被 tsc 解析 ⇒ 找不到就 `TS2307`；
 * 只有**计算出的** specifier 才不进入类型检查。而 SPEC §1.1 明确本包不 import
 * `@deepseek-ai/*`（SDK 递归 0 个 `.d.ts`）。
 */
const DSH_TOOLS_PACKAGE = '@deepseek-ai/dsh-tools'

/** 运行期解析 `defineTool` 的结果（判别式联合：失败带原因，**绝不抛**）。 */
export type SophiaDefineToolResolution =
  | { readonly kind: 'resolved'; readonly defineTool: SophiaDefineTool }
  | { readonly kind: 'failed'; readonly reason: string }

/**
 * 在**运行期**从宿主环境解析真实的 `defineTool`。
 *
 * ## 为什么是运行期解析，而不是 `import { defineTool } from '@deepseek-ai/dsh-tools'`
 *
 * 三条实测理由（都写进过 SPEC §1.1 或本任务的侦察报告）：
 * 1. 该包在本仓**解析不到**（`packages/sophia-core/node_modules/@deepseek-ai`、
 *    仓根、用户主目录三处全不存在）；
 * 2. 它有 `package.json` 的 `types` 字段指向一个**不存在**的 `lib/types/index.d.ts`
 *    ⇒ 静态 import 必 `TS7016`/`TS2307` 且 `tsc` exit 2；
 * 3. **插件的裸包名解析基准是插件自身位置**，不是调用者位置 —— 所以插件**装进
 *    `profiles/` 之后**这个方法能解析到宿主那份 `dsh-tools`（与在跑的
 *    `dsh-postman` 同一条路径：它也没在 `dependencies` 里声明）。
 *
 * ⚠ **由此推出一条必须如实说明的边界**：本包在**仓库内**跑单测时解析不到它
 * （仓库的 `node_modules` 里没有 `@deepseek-ai`）⇒ 此处返回 `failed`，
 * 而 `tests/host-tools.spec.ts` 因此**直接去 `~/.dsh/...` 找真实实现**来验证形状，
 * 不依赖本函数。本函数是**生产路径**用的。
 */
export async function resolveDefineTool(): Promise<SophiaDefineToolResolution> {
  try {
    // 计算出的 specifier（见 DSH_TOOLS_PACKAGE 的说明）：tsc 不解析它。
    const mod = (await import(DSH_TOOLS_PACKAGE)) as Record<string, unknown>
    const defineTool = asDefineTool(mod['defineTool'])
    if (defineTool === undefined) {
      return { kind: 'failed', reason: `模块 ${DSH_TOOLS_PACKAGE} 里没有可调用的 defineTool 导出` }
    }
    return { kind: 'resolved', defineTool }
  } catch (error) {
    return {
      kind: 'failed',
      reason:
        `无法解析 ${DSH_TOOLS_PACKAGE}（${error instanceof Error ? error.message : String(error)}）`
        + '—— 插件安装到 profiles/ 之后裸包名才会解析到宿主提供的那一份。',
    }
  }
}
