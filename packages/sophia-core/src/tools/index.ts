/**
 * Agent 工具集（`docs/DEVELOPMENT.md` §3.5 / `t4`）。
 *
 * 五个成员可调用的工具：`sophia_team_message` / `sophia_task_claim` /
 * `sophia_spawn_team` / `sophia_switch_model` / `sophia_context_rollover`。
 *
 * ## 这一层交付什么、不交付什么
 *
 * **交付**：名称 + 参数 schema + 执行函数 + 结果渲染（`SophiaToolDescriptor`）。
 * **不交付**：注册。`ctx.tools.register(defineTool(...))` 是**宿主半**
 * （`src/host.ts`）的事 —— 本包不 import `@deepseek-ai/*`（SPEC §1.1 的实测结论：
 * SDK 安装递归含 0 个 `.d.ts`，那个 import 会以 TS7016 / exit 2 失败）。
 * 宿主侧的转接形状写在各 `SophiaToolDescriptor` 的文档里。
 *
 * ## 五条贯穿全部工具的性质（每条都有对应用例）
 *
 * 1. **绝不抛错**：全部失败都是返回值（`{kind:'invalid-input'|…}`），
 *    与 `MemberRuntime.notify` 的契约同源。工具运行在 Agent 的模型调用循环里，
 *    一个抛出的异常在那里表现为「工具调用失败」这一条**无信息的**反馈，
 *    而返回值能把「为什么不行」原样带给模型。
 *    （唯一的例外是**宿主接线被改坏**时：本层仍兜住，见各工具的 `failed` 分支。）
 * 2. **调用者身份是闭包常量**，不在参数里 —— 模型填不出别人的身份（防冒充是结构性的，
 *    不靠运行期校验）。
 * 3. **事实优先、通知尽力而为**：落账后的通知失败**不撤销**事实，也不把整体判失败，
 *    但一定出现在结果里。
 * 4. **结论只来自账本 / 投影**：`from`（任务状态、旧模型）一律取自投影端口，
 *    不接受调用方自报 —— 伪造 `from` 会在 append-only 账本上留下**永久**的假历史。
 * 5. **契约缺口如实带出**（`SOPHIA_TOOL_CONTRACT_GAPS`），不用新 event kind 去补
 *    （SPEC §11 的 Q-F 裁定：「宁可如实留白，也不硬塞一个语义不符的东西」）。
 *
 * ## 为什么用一个数组而不是五个具名 getter
 *
 * 宿主注册时是「遍历注册一遍」，数组正是那个用法；且
 * `tests/tools.spec.ts` 可以直接断言 `SOPHIA_TOOL_NAMES` 与
 * `createSophiaTools(deps)` 实际产出的名字**逐字一致** ——
 * 两边各写一份名字会让「模型看到的名字」与「宿主注册的名字」静默分叉。
 *
 * ⚠ **不导出 `createXxxTool` 之外的任何内部符号**：本文件用**显式转发**而不是
 * `export *`（与 `src/index.ts` 对 projection 的处置同一纪律）——
 * 一次 `export *` 会把 `internal.ts` 的校验小工具也变成公共面，
 * 那会让「工具层的判据」看起来像本包的契约。
 *
 * @module @sophia/core/tools
 */

import { createContextRolloverTool } from './rollover.ts'
import { createSpawnTeamTool } from './spawn-team.ts'
import { createSwitchModelTool } from './switch-model.ts'
import { createTaskClaimTool } from './task-claim.ts'
import { createTeamMessageTool } from './message.ts'
import { SOPHIA_IMPLEMENTED_TOOL_COUNT, SOPHIA_TOOL_NAMES } from './types.ts'
import type { SophiaToolDescriptor, SophiaToolName, SophiaToolsDeps } from './types.ts'

// ── 显式转发：形状与缺口常量（宿主与测试都要用）─────────────────────────────
// 注意：`SOPHIA_IMPLEMENTED_TOOL_COUNT` / `SOPHIA_TOOL_NAMES` **不在这里转发** ——
// 它们在文件下方用「取值出口」的形式转发（见那里的说明）；
// 在这里再 `export` 一次会造成重复标识符（实测 TS2300）。
export {
  SOPHIA_TOOL_CONTRACT_GAPS,
  sophiaToolDescriptor,
  type SophiaDagPorts,
  type SophiaProjectionPorts,
  type SophiaThreadFact,
  type SophiaToolCaller,
  type SophiaToolDefinition,
  type SophiaToolDescriptor,
  type SophiaToolName,
  type SophiaToolParameter,
  type SophiaToolsDeps,
} from './types.ts'

// ── 显式转发：各工具的入参 / 结果类型（宿主转接 defineTool 的 output.schema 要用）──
export {
  SOPHIA_CAPTAIN_ALIAS,
  SOPHIA_MESSAGE_ID_PREFIX,
  SOPHIA_REPLY_REF_MARKER,
  SOPHIA_THREAD_ID_PREFIX,
  createTeamMessageTool,
  // 宿主 UI 路由（`POST /api/sophia/team/message`）与工具面共用这一个写入实现 ——
  // 见 `message.ts` 的 `writeMessageSent`：宿主**不复制**写账逻辑。
  writeMessageSent,
  type TeamMessageDelivery,
  type MessageSentWriteResult,
  type TeamMessageInput,
  type TeamMessageOutcome,
} from './message.ts'
export {
  SOPHIA_CLAIMED_TASK_STATE,
  SOPHIA_REASON_MAX,
  createTaskClaimTool,
  type TaskClaimInput,
  type TaskClaimOutcome,
} from './task-claim.ts'
export {
  SOPHIA_SPAWN_REQUEST_ID_MAX,
  SOPHIA_SPAWN_POSITION_MAX,
  SOPHIA_SPAWN_MODEL_FIELD_MAX,
  SOPHIA_SPAWN_NAME_MAX,
  SOPHIA_SPAWN_ROSTER_MAX,
  SOPHIA_SPAWN_TASK_MAX,
  SOPHIA_SPAWN_TASKS_MAX,
  createSpawnTeamTool,
  type SpawnTeamInput,
  type SpawnTeamOutcome,
} from './spawn-team.ts'
export {
  SOPHIA_EFFECTIVE_SEQUENCE_NOTE,
  SOPHIA_SELF_SWITCH_TRIGGER,
  createSwitchModelTool,
  type SwitchModelInput,
  type SwitchModelOutcome,
} from './switch-model.ts'
export {
  createContextRolloverTool,
  type ContextRolloverInput,
  type ContextRolloverOutcome,
} from './rollover.ts'

/**
 * 名称清单 / 穷尽性断言 / 计数断言**全部搬到 `src/tools/types.ts`**（OCR 复核 LOW [5]）。
 *
 * 理由：`SOPHIA_TOOL_NAMES`、`SophiaToolName`、`SOPHIA_IMPLEMENTED_TOOL_COUNT` 是
 * 同一个事实的三面。初版把清单放这里、计数写成裸字面量 `5`，于是「加一个工具要改三处」
 * 且其中一处（计数）**不被编译期检查**。搬到一起后，加服务只需要改 `types.ts` 一处，
 * 三处漂移在结构上不可能发生。
 *
 * 这里只**转发**，不再保留第二份清单（两份清单就是两个真相）。
 */
// 这两个常量在本文件既被 `createSophiaTools` **使用**（见下方），又要对宿主**可见**，
// 故用 import + export 两步（而不是 `export { … } from`：那种写法不建立本地绑定，
// 本函数的 `SOPHIA_TOOL_NAMES.map(...)` 会报 TS2304 —— 实测撞过）。
export { SOPHIA_TOOL_NAMES, SOPHIA_IMPLEMENTED_TOOL_COUNT }

/**
 * 创建成员可调用的**全部**工具。
 *
 * 每次调用返回五个**新的**描述符。宿主应**按成员各建一份**
 *（`SophiaToolsDeps.caller` 是成员相关的闭包常量），而不是全进程共用一份。
 *
 * ## ⚠ 顺序是与 `SOPHIA_TOOL_NAMES` 的**第二条**契约（OCR 复核 LOW [3]）
 *
 * 文件头的注释把「顺序 = 注册顺序 = 产出顺序」当作承诺。此前的保障方式很差：
 * 本函数的数组顺序与 `types.ts` 的清单顺序**各自独立书写**，
 * 两者一致**只由测试断言**（`types/tools.spec.ts` 里那条运行期比较）。
 * 也就是说，只改本函数的顺序、不改清单 ⇒ `tsc` 全绿、只有跑测试才会红。
 *
 * ⇒ 现在这里不再手写第二份顺序：数组**按名称清单映射**构造，
 * 于是「产出顺序 = 清单顺序」是**结构性**的，不是靠两处字面量碰巧一致。
 * 加/删/重排工具时只需动 `types.ts` 一处，这里由类型检查兜底。
 *
 * （为什么不是「清单由本函数的产出派生」：清单要在**类型层**参与
 * `SophiaToolName` 的穷尽性断言，而运行期数组推不出字面量联合。
 * 故真源只能是清单，本函数向它对齐。）
 *
 * @param deps - 工具集依赖（宿主唯一接线点，见 `SophiaToolsDeps`）。
 */
export function createSophiaTools(deps: SophiaToolsDeps): readonly SophiaToolDescriptor[] {
  // 名称 → 工厂的**穷尽**映射。`Record<SophiaToolName, …>` 让「加了名字却忘了工厂」
  // 在编译期就红（而不是运行期少一个工具）。
  const factories: Record<SophiaToolName, () => SophiaToolDescriptor> = {
    sophia_team_message: () => createTeamMessageTool(deps),
    sophia_task_claim: () => createTaskClaimTool(deps),
    sophia_spawn_team: () => createSpawnTeamTool(deps),
    sophia_switch_model: () => createSwitchModelTool(deps),
    sophia_context_rollover: () => createContextRolloverTool(deps),
  }
  return SOPHIA_TOOL_NAMES.map((name) => factories[name]())
}
