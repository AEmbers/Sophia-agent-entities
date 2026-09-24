/**
 * Agent 工具集的**定义层**形状（`docs/DEVELOPMENT.md` §3.5 / FR-5.2·5.3·6.4·3.4·10.1）。
 *
 * ## 这一层只做「定义」，不做「注册」
 *
 * 注册（`ctx.tools.register(defineTool(...))`）是**宿主半**的职责：本包的自检路由与
 * 面向模型的公告落在 `src/host.ts`，工具集在这里只交出
 * 「名称 + 参数 schema + 执行函数 + 结果渲染」四件事。
 *
 * ## ⚠ 为什么不直接返回 `@deepseek-ai/dsh-tools` 的 `defineTool(...)` 产物
 *
 * SPEC §1.1 的实测结论：本机 DSH SDK 安装（`~/.dsh/core-0.1.5-rc.1/@deepseek-ai`，243 个包）
 * 递归含 **0 个 `.d.ts`** —— `import { defineTool } from '@deepseek-ai/dsh-tools'`
 * 会报 `TS7016` 并以 exit 2 失败（t1 的 `src/host.ts`、t2 的成员运行时都因此改用结构化声明）。
 * 所以本文件自持一个**足够小、且与 DSH 裸 schema 同形**的描述符：
 * 宿主半拿到它之后，`parameters` 可以直接塞进 `defineTool` 的 `parameters`，
 * `render` 可以直接当 `output.render` 的实现（`[{type:'text', text: render(value)}]`）。
 *
 * 判据是「宿主能不能无歧义地转接」，而不是「长得像不像 SDK」——
 * 与 `src/host.ts` 里 `SophiaWebServer` / `SophiaSystemPrompt` 的处置同一思路。
 *
 * ## 调用者身份**不进参数**（结构性防冒充）
 *
 * 每个成员的工具集由宿主按该成员各建一份（`SophiaToolsDeps.caller`），
 * 因此「我是谁」是**闭包里的常量**，而不是模型可填的字段。
 * 上游参照实现 `dsh-agent-teams/src/tools.ts:1899` 是靠
 * 「`args.from` 必须等于调用者身份，否则抛错」来做这件事的（也防住了冒充），
 * 但那是**运行期校验**：模型若填了别人的名字，得到的是一条错误，而不是「结构上填不了」。
 * 本实现选择后者（更省一次调用，也没有被误报成合法事实的中间态）。
 *
 * @module @sophia/core/tools/types
 */

import type { DelegationDeps } from '../delegation.ts'
import type { Ledger } from '../ledger.ts'
import type { MemberModel, MemberUnread } from '../projection/index.ts'
import type { MemberLogger, MemberRuntime } from '../runtime/member-runtime.ts'
import type { ChannelId, DagTeamId, MemberId, TeamId, ThreadId } from '../types/ids.ts'
import type { CallerKind, DagTaskState, MemberLifecycle } from '../types/team.ts'

// ────────────────────────────────────────────────────────────────────────────
// 名称（闭集）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 工具的模型可见名。
 *
 * 收窄成字面量联合的理由：`tests/tools.spec.ts` 断言
 * 「`SOPHIA_TOOL_NAMES` 与 `createSophiaTools()` 实际返回的定义**逐字一致**」——
 * 两边若各写一份字符串，改名时只会改一处，而**没有任何东西会报错**
 * （模型看到的名字与宿主注册的名字不同 ⇒ 调用永远匹配不上）。
 */
export type SophiaToolName =
  | 'sophia_team_message'
  | 'sophia_task_claim'
  | 'sophia_spawn_team'
  | 'sophia_switch_model'
  | 'sophia_context_rollover'

// ────────────────────────────────────────────────────────────────────────────
// 参数 schema（与 DSH 的**裸 schema** 同形）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一个参数的 schema。
 *
 * 与 DSH 的裸 schema 同形（`{ type, required?, description, items?, properties? }`，
 * 见上游 `dsh-agent-teams/src/tools.ts:1867` 的用法），**不是**标准 JSON Schema 的
 * `{type, items}` 嵌套写法 —— 本机插件生态用的是前者，抄错形状会让模型看不到参数语义。
 *
 * ⚠ `required` 只声明「必填」这颗信息位；**构造期不强制**。真正的门禁在各工具的执行函数里
 * （模型输入不可信，见 `SophiaToolDescriptor.run`）—— 描述符里的 `required` 是给模型看的，
 * 不是给宿主当校验器用的。这与 `src/types/guards.ts` 对「守卫证明什么、不证明什么」的
 * 如实标注是同一条纪律。
 */
export type SophiaToolParameter =
  | {
      readonly type: 'string' | 'number' | 'boolean'
      readonly required?: boolean | undefined
      readonly description: string
    }
  | {
      readonly type: 'array'
      readonly required?: boolean | undefined
      readonly description: string
      readonly items: SophiaToolParameter
    }
  | {
      readonly type: 'object'
      readonly required?: boolean | undefined
      readonly description: string
      readonly properties: Readonly<Record<string, SophiaToolParameter>>
      readonly additionalProperties: boolean
    }

// ────────────────────────────────────────────────────────────────────────────
// 工具定义与描述符
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一个工具：名称 + 参数 schema + 执行函数 + 结果渲染。
 *
 * `Input` 是**类型层的期望形状**，不是运行期保证 —— 模型传进来的 JSON 未过任何校验，
 * 每个工具的执行函数都必须自己逐字段收窄（见各文件的 `asUncheckedRecord` 用法）。
 * 这一点与 t2 的 `MemberRuntime.notify` 同源：那里实测过
 * 「`MemberNotice` 是类型层契约，而 JS 调用方传 `null` 会抛 `TypeError` 冲进事件派发路径」，
 * 工具面同理（只是失败的代价不同：那里拖垮派发，这里是模型拿到一条错误或——更坏——
 * 一条**看起来成功**的结果）。
 */
export interface SophiaToolDefinition<Input, Output> {
  readonly name: SophiaToolName
  readonly description: string
  readonly parameters: Readonly<Record<string, SophiaToolParameter>>
  /**
   * 输出的**裸 DSL schema**（与 `parameters` 同形）。
   *
   * ## ⚠ 这里必须用裸 DSL，**不是**标准 JSON Schema（实测，captain 裁定 (a)）
   *
   * `defineTool` 会把我给的东西**先过一层 DSL 转换**：
   * ```js
   * // dsh-tools/lib/index.js
   * parameterSchemaSpecToJsonSchema(options.parameters)
   * valueSchemaSpecToJsonSchema(options.output.schema)      // ← 关键
   * ```
   * ⇒ 写成标准 JSON Schema（对象上 `required: [...]`）会被**直接 REJECT**：
   * `required is not supported by the value schema DSL`。
   *
   * ⚠ **上游 `dsh-agent-teams/lib/tools.js` 不能当范本**：我把它的 `output.schema`
   * 逐字喂给真实校验器，得到
   * `schema.properties.team_id.required is not supported on type "string"` ——
   * **照抄会 throw**。正确范本就是本文件 `parameters` 的现有写法。
   *
   * 实测可行的形状（以下都验过）：
   * - 属性上 `required: true` ✅（数组/嵌套对象同理）
   * - `enum` ✅、`description` ✅
   * - `oneOf` / `anyOf` ❌ —— 故**判别联合只能用「扁平 + `enum` 收窄 `kind`」**表达
   * - **`additionalProperties` 必须显式给出**（漏写会 throw：
   *   `must be explicitly true or false`），且 DSH 侧**拒绝未声明字段**
   */
  readonly outputSchema: SophiaValueSchema
  /** 面向模型的单行结果文本。 */
  readonly render: (output: Output) => string
  readonly execute: (input: Input) => Promise<Output> | Output
}

/**
 * 输出的**裸 DSL schema**（一个 `object` 根节点）。
 *
 * ## 为什么与 `parameters` 的类型不同
 *
 * `parameters` 是**字段表**（`{ 字段名: 节点的形状 }`，顶层对象由宿主补）；
 * 而 `output.schema` 是**一个完整的 schema 节点**（含 `type: 'object'` 与
 * `additionalProperties`）—— 实测：`defineTool` 对它调的是
 * `valueSchemaSpecToJsonSchema`，**不补顶层**。
 *
 * ## ⚠ 硬约束（全部经真实 `dsh-tools` 校验器实测）
 *
 * - 属性上写 `required: true`（**不是**对象上 `required: [...]` —— 那会被 REJECT）
 * - `additionalProperties` **必须显式给出**（漏写即 throw：`must be explicitly true or false`）
 * - `oneOf` / `anyOf` **被拒** ⇒ 判别联合只能「扁平 + `enum` 收窄 `kind`」表达
 * - `additionalProperties: false` 会让 DSH **拒绝未声明字段** ⇒
 *   各分支字段的**并集必须完整**，否则合法输出会被拒（工具一调就报错）
 */
export type SophiaValueSchema =
  | SophiaValueSchemaNode
  | { readonly [key: string]: SophiaValueSchemaNode }

/** 输出 schema 的一个节点（裸 DSL 允许的全部关键字）。 */
export interface SophiaValueSchemaNode {
  /**
   * 节点类型。`'json'` = **接受任意 JSON 值**（实测 DSL 支持），
   * 用于 `T | null` 这类字段 —— DSL **不支持** JSON Schema 的 `type: ['string','null']`
   * 数组形式（实测被拒），而 `oneOf` 也被拒 ⇒ 「可空」只能用 `'json'` 表达。
   * ⚠ 那会**放宽**约束，故此时代码里必须在 `description` 里**写明真实类型**
   * （如 `'string | null —— …'`），否则模型看到的比实际更松。
   */
  readonly type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null' | 'json'
  /**
   * 该属性**是否必填**。**只接受 `true`**（省略 = 选填）。
   *
   * ⚠ 刻意**不写成 `boolean`**（OCR 复核 MEDIUM [4]）：DSL 只认属性上的 `required: true`；
   * 写 `required: false` 在语义上是「选填」，而**省略**已经表达了这件事。
   * 允许 `false` 只多出一个「合法但无意义」的写法，且下游
   *（`valueSchemaSpecToJsonSchema`）对它的行为**未定义**。
   * ⇒ 用字面量类型把那个写法从类型层去掉（不可能表达 > 靠约定不写）。
   */
  readonly required?: true
  readonly description?: string
  readonly enum?: readonly (string | number | boolean | null)[]
  readonly items?: SophiaValueSchema
  readonly properties?: { readonly [key: string]: SophiaValueSchemaNode }
  readonly additionalProperties?: boolean
}

/**
 * 擦除泛型后的描述符（宿主半消费的形状）。
 *
 * ## 为什么 `render` / `run` 的形参写成 `unknown` 后再转一次
 *
 * 因为要让 `SophiaToolDescriptor[]` 这个数组同时装得下五种互不相同的
 * `<Input, Output>`。若把描述符声明成泛型接口，`(input: A) => X` 与 `(input: B) => Y`
 * 在 `strictFunctionTypes` 下**互不可赋值**（函数参数逆变），数组就建不起来。
 *
 * `sophiaToolDescriptor()` 里那两处 `as` 是**唯一**的转换点，并且它的语义是明确的：
 * 「宿主按 name 分派，因此调用方本来就知道该传哪一份输入」。
 * 其余任何地方都不得再做这种转换 —— 否则「类型上说的是 A、运行期收到的是 B」会散开去。
 */
export interface SophiaToolDescriptor {
  readonly name: SophiaToolName
  readonly description: string
  readonly parameters: Readonly<Record<string, SophiaToolParameter>>
  /**
   * 输出的**裸 DSL schema**（形状与 `parameters` **逐字同源**，理由见
   * `SophiaToolDefinition.outputSchema` 的说明）。
   *
   * 宿主把它直接喂给 `defineTool({ output: { schema: … } })` —— 那一侧会做
   * `valueSchemaSpecToJsonSchema` 的转换，因此**不要**在这里预转成标准 JSON Schema。
   */
  readonly outputSchema: SophiaValueSchema
  /**
   * 渲染成 `dsh-tools` 的 **`Content[]`**。
   *
   * ## 签名为什么是 `(args, output)` 而不是只有 `output`
   *
   * `dsh-tools` 的 `output.render` 契约就是 **`(args, value) => Content[]`**
   *（见上游 `lib/tools.js` 的 `render: (args, value) => [{type:'text', text: …}]`）。
   * 本层**主动对齐它**，而不是留给装配层去包一层 —— 理由（captain 裁定 (a)）：
   * `defineTool` 要的 `output` 是**一个整体** `{schema, render}`，
   * 若 schema 在我这儿、签名适配在装配层，那「谁负责让两者对上」就成了
   * **没人负责的缝**。
   *
   * `args` 在多数工具里用不到（结果文本只依赖输出），故声明为 `unknown`：
   * 需要时由具体工具自己收窄，不需要时直接忽略（`_args` 前缀即可）。
   */
  readonly render: (args: unknown, output: unknown) => SophiaToolContent[]
  /** 统一入口：入参是**未校验的模型输入**，由各工具自己收窄后执行。 */
  readonly run: (input: unknown) => Promise<unknown>
}

/**
 * `dsh-tools` 的 `Content` 的一个**结构化最小声明**。
 *
 * ⚠ 硬约束（SPEC §1.1）：本包**不得** import `@deepseek-ai/*` 的类型 ——
 * 本地那份安装 243 个包里 `.d.ts` 数为 **0**，一 import 就是 `TS7016`。
 * 故这里按上游**实际发出的形状**（`[{type:'text', text}]`）结构性地声明它。
 * 只声明我们真正产出的那一种；多声明一种「可能支持」的形状反而会
 * 让下游以为我们真的会发它。
 */
export interface SophiaToolContent {
  readonly type: 'text'
  readonly text: string
}

/**
 * 把具体工具擦成描述符（唯一的类型转换点，理由见 `SophiaToolDescriptor`）。
 *
 * `execute` 的同步返回被统一包成 Promise：宿主侧 `defineTool.execute` 一律 `await`，
 * 让「有的工具同步、有的异步」不成为宿主的分支（分支越多，越容易有一条没人测）。
 */
export function sophiaToolDescriptor<Input, Output>(
  definition: SophiaToolDefinition<Input, Output>,
): SophiaToolDescriptor {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    outputSchema: definition.outputSchema,
    // ⚠ 把「面向模型的单行文本」包成 `dsh-tools` 的 `Content[]`。
    // **包装只在这一处**：各工具的 `render` 继续只返回字符串（那才是它们的职责），
    // 而「文本 → Content[]」是宿主契约的适配，属于本函数（唯一的类型擦除点）的邻居。
    // 若让五个工具各自拼 `[{type:'text', …}]`，那五个地方都能写错这个形状。
    render: (_args: unknown, output: unknown) => [
      { type: 'text' as const, text: definition.render(output as Output) },
    ],
    run: async (input: unknown) => definition.execute(input as Input),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 依赖端口
// ────────────────────────────────────────────────────────────────────────────

/**
 * 工具集绑定的调用者（**闭包里的常量**，不是参数）。
 *
 * `teamId` 是诊断与账本载荷所需的「我属于哪个团」；它**不是**会话锚点
 * （FR-5.0.1 / FR-5.0.3：团不绑窗口）。本文件里没有任何 `HostSessionId` ——
 * 与 t2 的成员运行时同一条纪律。
 */
export interface SophiaToolCaller {
  readonly memberId: MemberId
  readonly teamId: TeamId
}

/** 线程事实（账本投影里与线程有关的那两列）。 */
export interface SophiaThreadFact {
  readonly channelId: ChannelId
  readonly title: string
}

/**
 * DAG 面的投影端口（FR-4.1 / FR-7.2）。
 *
 * **为什么是注入的端口而不是本模块自己扫账本**：`dag/*` 事件的折叠在
 * `src/projection/index.ts` 里被显式列为「不属于 roster / channel / thread 三面」
 * （该文件 533–548 行逐条列出；实测 533 行是 `── 不属于这三面的事实 ──` 注释头、547 行是 `dag/task-state-changed`），本包此刻**没有** DAG 投影。
 * 自己写一遍分页扫描会造出第二份游标处理实现（`delegation.ts` 里那份是模块私有的
 * 内部函数，导出它属于改别人的公共面）—— 而两份游标处理分叉的表现是
 * 「同一个任务在两处状态不同」，是最难查的一类。故**注入**，由宿主绑定到唯一真相。
 */
export interface SophiaDagPorts {
  /** FR-7.2 归属守卫：该 DAG 团队的 owner；账本里没有它时为 `null`。 */
  readonly ownerOf: (dagTeamId: DagTeamId) => MemberId | null
  /**
   * 任务**当前**状态（无此任务 ⇒ `null`）。
   *
   * 两个用途，都不可省：
   * - 作为 `dag/task-state-changed` 的 `from`（**必须**取自投影，不接受调用方自报 ——
   *   否则会在不可改写的账本上留下一条从未发生过的转换起点）；
   * - 判「已经是认领态」（幂等短路，见 `sophia_task_claim`）。
   *   `null` 与「状态是空串」是**两件事**：前者是「没有这个任务」，后者是脏数据。
   */
  readonly taskStateOf: (dagTeamId: DagTeamId, taskId: string) => DagTaskState | null
  /**
   * FR-4.1 门禁：该任务**尚未完成**的依赖 id。
   *
   * **空数组 ⇒ 依赖已全部满足 ⇒ 可认领**。刻意用「未完成依赖」而不是
   * 「已完成依赖 + 是否需要全完成」两个字段：后者把判据拆到调用方，
   * 于是「怎么算完成」就有了第二处实现（而它正是 DAG 引擎的职责）。
   * 返回 `readonly string[]` 而非布尔，是为了让拒绝时能把**具体是哪几项**告诉模型。
   */
  readonly unfinishedDependenciesOf: (dagTeamId: DagTeamId, taskId: string) => readonly string[]
}

/**
 * 账本投影端口（FR-10.2：工具不持有第二真相）。
 *
 * 全部事实都**只从账本读**（或由宿主绑定到账本投影），工具自身不缓存、不落状态；
 * `tests/tools.spec.ts` 用「换一份端口，工具结论跟着变」来钉这条。
 */
export interface SophiaProjectionPorts {
  /**
   * 该成员所属团的 kind（FR-5.2：派生权限由**发起方所处团队**的类型决定）。
   * 解析不出来（账本里没有这个成员）⇒ `null`。
   */
  readonly callerKindOf: (memberId: MemberId) => CallerKind | null
  /** 成员**当前**生效的模型（`team/member-model-switched` 的 `to`）；未知 ⇒ `null`。 */
  readonly modelOf: (memberId: MemberId) => MemberModel | null
  /**
   * 成员**当前**的生命周期（账本投影）；账本不认识它 ⇒ `null`。
   *
   * 与 `src/runtime/member-runtime.ts` 的 `MemberRuntimeDeps.lifecycleOf` 是**同一个投影**，
   * 只是那一个归运行时消费、这一个归工具层消费。刻意让它们同形而不是共用一个字段：
   * 运行时的依赖由宿主构造、工具集的依赖也由宿主构造，两处若共享一个可变引用，
   * 会让「换一个 bug 影响两个面」。宿主应当把它绑到**同一个**账本折叠函数上 ——
   * 那样"两处一致"是接线的事实，而不是本文件承诺的巧合。
   */
  readonly lifecycleOf: (memberId: MemberId) => MemberLifecycle | null
  /**
   * 该成员**所属的团**；账本不认识它 ⇒ `null`。
   *
   * 用于 `sophia_context_rollover` 的跨团门：把唤醒通知投给别的团的成员属于跨团调度，
   * 与 FR-7.2 的隔离口径同类。
   */
  readonly teamOf: (memberId: MemberId) => TeamId | null
  /**
   * 待办计数（FR-10.3 的未读面）——**必须是 `src/projection/index.ts` 的 `unreadByMember`**。
   *
   * 为什么做成注入端口而不是本模块直接调：`unreadByMember(ledger, input)` 是公开函数，
   * 工具层当然可以直接调它；做成端口是为了让
   * 「未读与账本通知是同一个判据」这条性质可以被**测试注入地用别一份实现来证伪**
   * （`tests/tools.spec.ts` 有一条换掉它、断言工具结论跟着变），
   * 而不是让它成为一条只能靠读源码相信的注释。
   *
   * ⚠ 宿主接线时**不要**在这里缓存或重算水位：交付物必须逐字是
   * `unreadByMember(deps.ledger, { memberId, sinceSequence })` 的结果。
   *
   * ## 为什么这里**不**再有一个 `watermarkOf` 端口（OCR 复核 MEDIUM [27]）
   *
   * 初版另有一个 `watermarkOf: (memberId) => number`，供
   * `sophia_context_rollover` 在省略 `sinceSequence` 时回落到该成员的读水位。
   * 复核指出它**没有任何消费者**（实测：全仓 `grep watermarkOf` 只命中它自己的声明
   * 与测试里的桩），并且它与 `UnreadInput.sinceSequence` 的**契约直接冲突** ——
   * SPEC §6.3 与 `src/projection/index.ts` 都写明「水位是**客户端的游标**，不是账本事实，
   * 本包**刻意不存储**它」。把它做成宿主端口等于要求宿主提供一个「成员的读水位」，
   * 而那个东西在本包里**结构上不存在**。
   *
   * ⇒ 删除该端口。`sophia_context_rollover` 省略 `sinceSequence` 时按 **0** 处理
   * （= 全部相关事件，**保守**的一侧：宁可多报几条，不可漏报）——
   * 这与「水位由调用方给」的契约一致，也不再需要宿主凭空造一个游标。
   * 死端口比缺端口更坏：它会让宿主以为必须维护一份本包并不存在的状态。
   */
  readonly unreadOf: (memberId: MemberId, sinceSequence: number) => MemberUnread
  /** 把消息收件人（成员名 / 成员 ID）解析成 `MemberId`；认不出 ⇒ `null`。 */
  readonly resolveMemberRef: (ref: string) => MemberId | null
  /** 线程事实；线程不存在 ⇒ `null`。用于判定「这条消息是启动线程还是回复」。 */
  readonly threadOf: (threadId: ThreadId) => SophiaThreadFact | null
  /** 频道所属的团；频道不存在 ⇒ `null`。发消息前的归属门（见 `sophia_team_message`）。 */
  readonly channelTeamOf: (channelId: ChannelId) => TeamId | null
  readonly dag: SophiaDagPorts
}

/** 工具集的全部依赖（宿主唯一接线点）。 */
export interface SophiaToolsDeps {
  readonly caller: SophiaToolCaller
  readonly ledger: Ledger
  /** 成员运行时（`t2`）：唤醒、存在态。**工具不自己实现唤醒与去重**。 */
  readonly runtime: MemberRuntime
  readonly projection: SophiaProjectionPorts
  /**
   * 派生依赖（`src/delegation.ts` 的 `DelegationDeps`）——**整体转交**。
   *
   * `sophia_spawn_team` 直接调 `requestSpawn(deps.delegation, request)`，
   * 权限矩阵、两级审批、`requestId` 幂等与「不得绕开」全部由那一处实现，
   * 本工具层**一行判定逻辑都不重写**（任务要求：「直调已有模块，不重复实现逻辑」）。
   *
   * ⚠ 接线约定：`deps.ledger` 与 `deps.delegation.ledger` 必须是**同一个账本实例**
   * （`delegation` 自己也要落 `spawn/*` 事件）。两个字段并存不是冗余：
   * 前者是本工具集直接用账本的地方（消息 / 任务状态 / 换模），后者是审批那条链路自己用的。
   */
  readonly delegation: DelegationDeps
  readonly now: () => number
  readonly logger?: MemberLogger | undefined
}

// ────────────────────────────────────────────────────────────────────────────
// 已确认的契约缺口（如实回报，不发明契约）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 工具层撞到的契约缺口。
 *
 * 为什么把它做成**具名常量**而不是散在五处注释里：
 * ① 结果里出现它时，`grep` 一次就能找到全部出现点；
 * ② `tests/tools.spec.ts` 可以直接断言「这条缺口被如实带出」，而不是靠人读注释；
 * ③ 后来者补上契约（例如 `SPEC §6.1` 增加消息事件）时，删掉常量会让那些断言变红 ——
 *    **逼他显式做决定**，而不是让一段过期的说明静静留在结果字符串里。
 *
 * 本包的纪律是「宁可如实留白，也不发明契约」（SPEC §11 的 Q-F 裁定）：
 * 这些缺口**不**由本模块用新 event kind / 新字段去补，只如实说清。
 */
export const SOPHIA_TOOL_CONTRACT_GAPS = {
  /*
   * ── 已关闭的两条缺口（留在这里，因为「删掉的常量 grep 不到」）────────────────
   *
   * `messageBody`（CONTRACT-GAP[message-body]）与 `threadReply`
   * （CONTRACT-GAP[thread-reply]）**已随 `team/message-sent` 的加入而关闭**，
   * 故从本对象中删除 —— 留着它们意味着结果里会出现一句**已经解决的缺口**，
   * 那比不写更误导。两条的来龙去脉见 `docs/SPEC-sophia-core.md` 的 §6.1 事件表
   * 与下面这段历史：
   *
   * - 关闭前：SPEC §6.1 的 19 个 kind 里**没有任何一个承载消息正文**，
   *   `team/thread-started` 的载荷是 `{threadId, channelId, title, assigneeMemberId}`，
   *   它是当时唯一与「消息」挂钩的事件 ⇒ 正文只能经运行时通知送达、**不落账本**；
   *   而「回复一条已存在的线程」更是**没有可写的事实**（再写一条 `thread-started`
   *   会把该线程的 `appearedAtSequence`/`title` 覆盖成新值，等于用「启动」事件
   *   伪造一次「重新启动」）⇒ 当时选择不写。
   * - 关闭后（现状）：`team/message-sent`
   *   （`src/types/operations.ts` 的 `MessageSentData`：`{messageId, channelId,
   *   threadId, senderMemberId, body}`）同时承载正文与「回复」这件事，
   *   且它对 `messages` 表是**追加**语义（按 `messageId` 各自成行），
   *   因此不再有覆盖写线程事实的风险。写入端见 `src/tools/message.ts`。
   *
   * ⚠ 这个对象的**存在理由**没有变：它仍然是「本层撞到的缺口」的具名清单，
   * 只是少了两条已解决的。删掉常量会让断言变红、逼后来者显式做决定 ——
   * 本次就是按这条机制走的（`tests/tools.spec.ts` 里原先断言这两条缺口被带出的
   * 用例已改写成断言**新行为**）。
   */
  /**
   * 上下文接力没有可落的 checkpoint。
   *
   * FR-3.4 要求 rollover / checkpoint，「切换与重启不丢待决事项」。
   * 本实现里待决事项**由账本派生**（`unreadByMember`），水位是宿主的游标 ——
   * 因此「不丢」是**结构性**的：不需要 checkpoint 事件，也没有任何东西随上下文一起消失。
   * 但「checkpoint」这个**可查询的落点**在契约里不存在，故如实标注为缺口。
   */
  rolloverCheckpoint:
    'CONTRACT-GAP[rollover-checkpoint]：SPEC §6.1 没有 checkpoint 事件；'
    + '待决事项由账本派生（unreadByMember + 宿主水位），因此不丢是结构性的，但不存在可查询的 checkpoint 记录。',
  /**
   * `teamOf` 的 `null` 是**二义**的（OCR 复核 MEDIUM [12] 的实际观察）。
   *
   * `SophiaProjectionPorts.teamOf` 只承诺「取不到为 `null`」，而 `null` 至少覆盖：
   * ① 账本里从来没有这个成员；② 成员存在但已挂起/归档/销毁，因而没有团队条目。
   * 工具层**无法**从这一个返回值分辨二者，于是只能说「读不到团队归属」，
   * 而不能断言「没有这个成员」——后者在情况 ② 下是假话。
   * 收口点属投影层（要么让 `teamOf` 返回一个带区分的结果，要么加一个显式的
   * `memberExistsOf`）；本层不发明那个形状（SPEC §11：宁可如实留白）。
   *
   * ⚠ **JSDoc 必须紧贴它描述的常量**（OCR 复核 MEDIUM [3]）：本块此前排在
   * `claimableStates` 后面，于是它被附着到 `claimableStates` 上，
   * 而 `memberTeamOfAmbiguity` 反而没有文档 —— 编辑器里看到的说明是**张冠李戴**的。
   * 现在两块各自紧贴自己的常量。
   */
  memberTeamOfAmbiguity:
    'CONTRACT-GAP[teamOf-ambiguity]：teamOf 的 null 无法区分「没有此成员」与「此成员已无团队条目（挂起/归档/销毁）」，'
    + '故工具层只能如实说「读不到团队归属」。收口点在投影层。',
  /**
   * 「哪些任务状态可以认领」在本包里没有判据。
   *
   * FR-4.1 要求「依赖未完成的任务不可被认领」，但**任务状态的显式状态机属
   * `sophia-engine-dag`**（`src/types/team.ts` 的 `DagTaskState = string` 就是把
   * 这个形状刻意留白的结果）。因此 `sophia_task_claim` 只能判两件事：
   * ① 依赖是否已全部完成（FR-4.1 明文要求）；② 是否**已经**是认领态（幂等短路）。
   * 「已完成/已取消的任务该不该再被认领」**没有**可依据的判据 —— 本工具不发明一份
   * 状态白名单（那会在引擎立项后变成错误的形状，把合法认领也拦下来）。
   */
  claimableStates:
    'CONTRACT-GAP[claimable-states]：任务状态机属 sophia-engine-dag（DagTaskState 刻意是 string），'
    + '本包因此只能判「依赖是否就绪」与「是否已认领」；'
    + '除已认领外的其余状态一律视为可认领，不发明状态白名单。',
} as const

/**
 * 五个工具的名称清单（顺序 = 注册顺序 = `createSophiaTools` 的产出顺序）。
 *
 * ## 为什么它住在 `types.ts` 而不是 `index.ts`（OCR 复核 LOW [5]）
 *
 * 本常量与 `SophiaToolName` 是**同一个事实的两面**，而 `SOPHIA_IMPLEMENTED_TOOL_COUNT`
 * 又要等于它的长度。三者放一起，下面的断言就能全部落在**同一个文件**里、
 * 且计数不再是一份需要手工同步的字面量。
 *
 * 初版把清单放在 `index.ts`、把计数写成裸字面量 `5`，结果：
 * 「契约说 5 个 / 实际清单 6 个」这种矛盾只能靠一条**运行期**断言兜着，
 * 而 `index.ts` 又无法被 `types.ts` 引用（会构成循环导入）。
 * ⇒ 把清单搬到 `types.ts`（`SophiaToolName` 的邻居），`index.ts` 改为转发。
 * 这不是为了好看：它让「加一个工具需要改几处」从**三处**降到**一处**。
 */
export const SOPHIA_TOOL_NAMES = [
  'sophia_team_message',
  'sophia_task_claim',
  'sophia_spawn_team',
  'sophia_switch_model',
  'sophia_context_rollover',
] as const satisfies readonly SophiaToolName[]

/** 编译期断言：清单**不多不少**地覆盖了 `SophiaToolName`。 */
type MissingToolName = Exclude<SophiaToolName, (typeof SOPHIA_TOOL_NAMES)[number]>
type ExtraToolName = Exclude<(typeof SOPHIA_TOOL_NAMES)[number], SophiaToolName>
const _TOOL_NAMES_IS_COMPLETE: MissingToolName extends never ? true : never = true
/*
 * ⚠ `_TOOL_NAMES_HAS_NO_EXTRA` 是**结构性恒真**的，且它抓不到重复项
 *（OCR 复核 LOW [4] 的观察属实 —— 我保留了它，但在这里写清它到底能证什么）：
 *
 * - 数组上的 `satisfies readonly SophiaToolName[]` **已经**要求每一项属于该联合
 *   ⇒ `ExtraToolName = Exclude<元素, SophiaToolName>` **恒为 never**。
 *   故这条 const 永远不会红。它唯一的作用是「若将来有人把 `satisfies` 去掉，
 *   这里会先报错」——一条**守卫那个约束本身**的断言，不是守卫数据的。
 * - **重复项它抓不到**：`['sophia_team_message', 'sophia_team_message', …]` 完全满足
 *   `satisfies`，`MissingToolName`/`ExtraToolName` 也都是 never。
 *   类型层表达不了「元组内无重复」，故这项**由运行期测试**兜着
 *（`tests/tools.spec.ts` 用 `new Set(SOPHIA_TOOL_NAMES).size === length` 断言唯一性）。
 *
 * 两条合起来才是完整的：「集合相等」归类型层，「无重复」归运行期。
 * 写清楚是为了不让人误以为这一条 const 已经把两件事都证了。
 */
const _TOOL_NAMES_HAS_NO_EXTRA: ExtraToolName extends never ? true : never = true
void _TOOL_NAMES_IS_COMPLETE
void _TOOL_NAMES_HAS_NO_EXTRA

/** `docs/DEVELOPMENT.md` §3.5 列出的六个工具名里，本包实现五个（`sophia_delegate_dag` 属 DAG 引擎）。 */
export const SOPHIA_IMPLEMENTED_TOOL_COUNT = SOPHIA_TOOL_NAMES.length
