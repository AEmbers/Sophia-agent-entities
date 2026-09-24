/**
 * `sophia_task_claim` —— 认领一条 DAG 任务（FR-4.1 / FR-7.2 / FR-10.1）。
 *
 * ## 两道门，顺序不可换（各自都有零副作用要求）
 *
 * | 顺序 | 门 | 依据 | 不过时的结果 |
 * |---|---|---|---|
 * | 1 | **归属门**：任务所在 DAG 团的 owner 必须是调用者 | FR-7.2 | `not-owner`（**零副作用**） |
 * | 2 | **依赖门**：未完成的依赖必须为空 | FR-4.1 | `blocked`（**零副作用**） |
 *
 * 先归属后依赖不是随手排的：**泄露信息**的代价不对称。若先判依赖，
 * 一个非 owner 的成员就能从「blocked / 通过」这个**二元信号**推断出别人 DAG 的任务依赖
 * 是否已完成 —— 而 FR-7.2 要求「任何读/写/派发操作须被拒绝」，那正是**读**。
 * 先判归属，非 owner 无论依赖如何都只得到同一句拒绝。
 *
 * 两道门都在**落账之前**判完，因此被拒的调用**不会**在账本上留下任何痕迹
 * （`tests/tools.spec.ts` 逐分支断言账本事件数为 0 —— 与 `delegation.spec.ts` 用计数 spy
 * 断言 AC-5-2 是同一手法：只断言结果 `kind` 的话，一个「先落账再判不合格」的实现也能全绿）。
 *
 * ## 状态从哪来
 *
 * `from` 取**账本投影**给出的当前状态（`deps.projection.dag.taskStateOf`），
 * 而不是由调用方提供 —— 让调用方填 `from` 就等于允许它伪造一次状态转换的起点，
 * 而账本是不可改写的：一条假的 `from` 会**永久**留在链上，之后任何按
 * `dag/task-state-changed` 重放状态机的消费方（FR-4.1 的显式状态机）都会从错的地方开始。
 *
 * @module @sophia/core/tools/task-claim
 */

import type { DagTeamId, MemberId } from '../types/ids.ts'
import type { DagTaskState } from '../types/team.ts'
import { SOPHIA_TOOL_CONTRACT_GAPS } from './types.ts'
import {
  sophiaToolDescriptor,
  type SophiaToolDefinition,
  type SophiaToolDescriptor,
  type SophiaToolsDeps,
} from './types.ts'
// ⚠ 只导入**实际用到**的（OCR 复核 LOW [11]）：本文件的字符串校验全部走
// narrowTrimmedString，故 isNonEmptyString / badFieldReason 曾是死 import。
import {
  asUncheckedRecord,
  guarded,
  isNonEmptyString,
  describeError,
  isNonNegativeSafeInteger,
  missingFieldReason,
  narrowTrimmedString,
  renderValueForMessage,
  unreachableOutcome,
} from './internal.ts'

/** `sophia_task_claim` 的入参（类型层的期望形状）。 */
export interface TaskClaimInput {
  readonly dagTeamId: DagTeamId
  readonly taskId: string
  /** 认领理由（可空；写进账本便于回溯「为什么认领」）。 */
  readonly reason?: string
}

/**
 * 认领后写入的状态名。
 *
 * 取值**刻意不发明一套状态机**：`DagTaskState` 是 `string`
 * （`src/types/team.ts` 的说明：FR-4.1 的状态机属 `sophia-engine-dag`，本包只冻结载荷形状），
 * 因此本工具只用一个**中性且直白**的名字表示「已被这个成员认领」。
 * 若将来 `sophia-engine-dag` 定义了规范状态名，改本常量一处即可 ——
 * 这也是把它导出的原因（测试与宿主共用同一处字面量，不各写一份）。
 */
export const SOPHIA_CLAIMED_TASK_STATE = 'claimed'

/**
 * `reason` 的长度上限（OCR 复核 LOW [16]）。
 *
 * 取值 2000：正常理由是一两句话（几十字符），2000 已远超任何真实理由；
 * 而它拦住的是「模型把一大段文档塞进 reason」——那种内容落进**不可改写**的账本后
 * 永远无法清理，且每条后续读取都要把它读回来。
 */
export const SOPHIA_REASON_MAX = 2000

export type TaskClaimOutcome =
  | {
      readonly kind: 'claimed'
      readonly dagTeamId: DagTeamId
      readonly taskId: string
      readonly from: DagTaskState
      readonly to: DagTaskState
      readonly sequence: number
      /**
       * 本次踩到的契约缺口（见 `SOPHIA_TOOL_CONTRACT_GAPS`）。
       *
       * OCR 复核 LOW [19]：`claimableStates` 这个缺口此前**只在注释里**提到，
       * 调用方看不到 —— 而「除已认领外的任何状态都可被认领」是一个**刻意的未裁定决策**，
       * 调用方有权知道。与 `message.ts` / `rollover.ts` 把 gaps 放进结果的作法一致。
       */
      readonly gaps: readonly string[]
    }
  /** 该任务已经是认领态：**幂等**，不重复落账。 */
  | {
      readonly kind: 'already-claimed'
      readonly dagTeamId: DagTeamId
      readonly taskId: string
      readonly from: DagTaskState
    }
  | { readonly kind: 'invalid-input'; readonly reason: string }
  /** 账本里没有这个 DAG 团队。 */
  | { readonly kind: 'unknown-dag-team'; readonly reason: string }
  /** FR-7.2：调用者不是该 DAG 团队的 owner。 */
  | { readonly kind: 'not-owner'; readonly reason: string }
  /** FR-4.1：依赖未完成，不可认领。 */
  | {
      readonly kind: 'blocked'
      readonly dagTeamId: DagTeamId
      readonly taskId: string
      readonly unfinishedDependencies: readonly string[]
    }
  /** 该 DAG 团队里没有这个任务。 */
  | { readonly kind: 'unknown-task'; readonly reason: string }
  /**
   * 写序校验失败：判门与提交之间有**另一个进程**提交了事件。
   *
   * **认领事实已写入**（append-only，撤不回），但载荷里的 `from` 可能已过期。
   * 与 `switch-model.ts` 的同名分支同源（OCR 复核 MEDIUM [16]）：
   * 这条不是「失败了什么也没做」，而是「做了一条可能需要人工核对的事实」——
   * 故它单独一个 `kind`，绝不与 `failed` 混用。
   */
  | {
      readonly kind: 'sequence-mismatch'
      readonly predicted: number
      readonly actual: number
      readonly reason: string
    }
  | { readonly kind: 'failed'; readonly reason: string }

function invalid(reason: string): TaskClaimOutcome {
  return { kind: 'invalid-input', reason }
}

function narrowInput(input: unknown): TaskClaimInput | TaskClaimOutcome {
  const raw = asUncheckedRecord(input)
  // 字符串字段一律「先校验、再裁剪」（见 internal.ts 的 narrowTrimmedString）。
  const dagTeamId = narrowTrimmedString(raw, 'dagTeamId')
  if (!dagTeamId.ok) return invalid(dagTeamId.reason)
  if (dagTeamId.value === undefined) return invalid(missingFieldReason('dagTeamId'))
  const taskId = narrowTrimmedString(raw, 'taskId')
  if (!taskId.ok) return invalid(taskId.reason)
  if (taskId.value === undefined) return invalid(missingFieldReason('taskId'))
  // OCR MEDIUM [22]：可选字段空白 ⇒ 按「省略」处理（同 spawn-team requestId）；
  // missingFieldReason 的「缺少必填参数 reason」对可选字段是假文案。
  const rawReason = raw['reason']
  const reason = typeof rawReason === 'string' && rawReason.trim() === ''
    ? { ok: true as const, value: undefined }
    : narrowTrimmedString(raw, 'reason')
  if (!reason.ok) return invalid(reason.reason)
  // [16] 长度上限：`reason` 会被**原样写入不可改写的账本**（FR-10.1），
  // 超长/噪声一旦落盘就永久留在审计链上。上限取一个远超正常理由的长度，
  // 只拦「明显是模型吐了个长文档」这类形状事故（判据是量级，不是洁癖）。
  if (reason.value !== undefined && reason.value.length > SOPHIA_REASON_MAX) {
    return invalid(
      `参数 reason 最多 ${String(SOPHIA_REASON_MAX)} 个字符（它会被原样写入不可改写的账本），`
      + `收到 ${String(reason.value.length)} 个字符。`,
    )
  }
  return {
    dagTeamId: dagTeamId.value as DagTeamId,
    taskId: taskId.value,
    ...(reason.value === undefined ? {} : { reason: reason.value }),
  }
}

/**
 * 构造 `sophia_task_claim`。
 *
 * @param deps - 工具集依赖（宿主唯一接线点，见 `SophiaToolsDeps`）。
 */
export function createTaskClaimTool(deps: SophiaToolsDeps): SophiaToolDescriptor {
  const definition: SophiaToolDefinition<TaskClaimInput, TaskClaimOutcome> = {
    name: 'sophia_task_claim',
    description:
      '认领一条 DAG 任务：把该任务的状态置为「已认领」并落账。'
      + '两道门会先判：① 你必须是该 DAG 团队的归属者（FR-7.2）；'
      + '② 该任务的依赖必须已全部完成（FR-4.1）。两道门不过时不会在账本留下任何痕迹。',
    parameters: {
      dagTeamId: { type: 'string', required: true, description: '任务所在的 DAG 团队 ID。' },
      taskId: { type: 'string', required: true, description: '要认领的任务 ID。' },
      reason: { type: 'string', description: '认领理由（可选，写进账本便于回溯）。' },
    },
    // ── 输出 schema（裸 DSL；判别联合只能扁平表达，见 SophiaToolDefinition.outputSchema）──
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          required: true,
          enum: ['claimed', 'already-claimed', 'blocked', 'unknown-dag-team', 'not-owner', 'unknown-task', 'sequence-mismatch', 'invalid-input', 'failed'],
          description: '结果分支。claimed = 本次真的认领并落账。',
        },
        dagTeamId: { type: 'string', description: 'DAG 团队 id。' },
        taskId: { type: 'string', description: '任务 id。' },
        from: { type: 'string', description: '（claimed）认领前的状态；取自账本投影，不是自报。' },
        to: { type: 'string', description: '（claimed）认领后的状态（恒为 claimed）。' },
        sequence: { type: 'number', description: '（claimed）本条事件的账本序号。' },
        unfinishedDependencies: { type: 'array', items: { type: 'string' }, description: '（blocked）尚未完成的依赖 id（FR-4.1 门禁）。' },
        predicted: { type: 'number', description: '（sequence-mismatch）预测的事件序号。' },
        actual: { type: 'number', description: '（sequence-mismatch）实际拿到的事件序号。' },
        gaps: { type: 'array', items: { type: 'string' }, description: '（claimed）本次踩到的契约缺口。' },
        reason: { type: 'string', description: '拒绝 / 失败 / 需人工核对时的可读原因。' },
      },
    },
    render: (outcome) => {
      switch (outcome.kind) {
        case 'claimed':
          return `已认领任务 ${outcome.taskId}（DAG ${outcome.dagTeamId}）：状态 ${outcome.from} → ${outcome.to}，账本序号 ${outcome.sequence}。`
        case 'already-claimed':
          return `任务 ${outcome.taskId} 已经是认领态（${outcome.from}），未重复落账（幂等）。`
        case 'blocked':
          return (
            `任务 ${outcome.taskId} 依赖未完成（FR-4.1），不可认领；未完成依赖共 ${outcome.unfinishedDependencies.length} 项：`
            + `${outcome.unfinishedDependencies.join('、')}。`
          )
        case 'sequence-mismatch':
          return (
            `⚠ 认领事实已写入，但写序校验失败：预测序号 ${String(outcome.predicted)}、`
            + `实际序号 ${String(outcome.actual)} —— 期间有另一个进程提交过。${outcome.reason}`
          )
        case 'invalid-input':
        case 'unknown-dag-team':
        case 'not-owner':
        case 'unknown-task':
        case 'failed':
          return `未认领（${outcome.kind}）：${outcome.reason}`
        default:
          return unreachableOutcome(outcome)
      }
    },
    execute(input: unknown): TaskClaimOutcome {
      const narrowed = narrowInput(input)
      if ('kind' in narrowed) return narrowed

      const { dagTeamId, taskId } = narrowed

      // 与 `switch-model.ts` 同构的前置：把「授权判定用的身份」与「时间」都在
      // 进入 `head()`/`commit()` 临界区**之前**取好（理由见那边 MEDIUM [7][8] 的说明）。
      //
      // ⚠ **身份必须先校验再裁剪**（OCR 复核 MEDIUM [4]，这是**安全**问题不是健壮性）：
      // 初版直接 `deps.caller.memberId.trim()`，有两种坏结果：
      // 1. 宿主把 `caller` 绑成 `undefined`/`null` ⇒ `.trim()` 抛 TypeError 穿出 `execute`；
      // 2. `memberId` 是 `''`/纯空白 ⇒ 裁成 `''`，而脏账本里 `owner` 若是 `''` 也会裁成 `''`
      //    ⇒ `'' !== ''` 为 false ⇒ **归属门放行**，一个没有身份（或身份是空串）的调用者
      //    就能认领任务 —— 绕过 FR-7.2。空串身份在**两侧同时为空**时会互相"匹配"。
      // ⇒ 身份非空白是**前置条件**，不满足就 fail-closed（不进入任何门）。
      const rawSelf = deps.caller === null || deps.caller === undefined ? undefined : deps.caller.memberId
      if (!isNonEmptyString(rawSelf)) {
        return {
          kind: 'failed',
          reason:
            `调用者身份不可用（收到 ${renderValueForMessage(rawSelf)}）—— `
            + '工具集的 caller.memberId 必须是非空白字符串；'
            + '空身份与"账本里 owner 也是空串"会互相匹配，从而绕过归属门（FR-7.2），故 fail-closed。',
        }
      }
      const selfMemberId = rawSelf.trim() as MemberId

      // ── 门 1：归属（FR-7.2）。**必须最先**，理由见文件头。 ──
      //
      // ⚠ 三个投影端口一律**包在 try 里**（OCR 复核 HIGH [14]，真实缺陷）。
      // 本文件（与 `internal.ts`）花了很大力气守「工具只返回错误、绝不抛」，
      // 却只把 `ledger.head()` / `ledger.commit()` 包了 try，三个投影端口是**裸调**的。
      // 而它们是宿主注入的函数、通常要读账本 —— 一次存储错误 / 脏行 / 投影被污染，
      // 就会从 `execute` **穿透出去**，把整次工具调用打崩（而不是返回一条可读的失败）。
      // ⇒ 全部收口成 `{ kind: 'failed' }`，与其余分支同一形状。
      //
      // 返回值也用 `Result` 而不是就地 return：三个端口的失败**必须**在同一个地方
      // 归一成 `failed`，否则「哪个端口漏包 try」又会变成看一眼才知道的事。
      const readOwner = guarded(() => deps.projection.dag.ownerOf(dagTeamId))
      if (!readOwner.ok) {
        return { kind: 'failed', reason: `读 DAG 团队归属时抛错：${readOwner.reason}` }
      }
      const owner = readOwner.value
      // [2] `ownerOf` 契约是 `MemberId | null`，但注入实现可能返回 `undefined`
      //（JS 宿主很容易写出这种）。不判的话 `owner !== selfMemberId` 会为 true，
      // 调用方拿到的是**误导性的 `not-owner`**（还把 undefined 当 owner id 播出去），
      // 而不是真实诊断「适配器不符契约」。与本文件其他形状守卫同源。
      if (owner === undefined || owner === null) {
        return {
          kind: 'unknown-dag-team',
          reason: owner === undefined
            ? `DAG 团队 ${dagTeamId} 的归属是 undefined（不是 null）—— ownerOf 的实现与契约不符。`
            : `账本里没有 DAG 团队 ${dagTeamId}（它从未被创建，或 id 写错了）。`,
        }
      }
      // [4] owner 不能是空/空白串：否则与空身份的**互相匹配**会绕过归属门。
      if (!isNonEmptyString(owner)) {
        return {
          kind: 'failed',
          reason:
            `DAG 团队 ${dagTeamId} 的 owner 是空串/纯空白（脏账本数据）—— `
            + '不接受空 owner：它会与空身份互相匹配从而绕过 FR-7.2 的归属门。请先修账本。',
        }
      }
      if (owner !== selfMemberId) {
        // 拒绝文案**不透露**该 DAG 团队里有没有这个任务、依赖是否完成 —— 那些都是别人的数据。
        //
        // ⚠ 关于「存在性是否算泄露」的说明（OCR 复核 MEDIUM [15]，**采纳其观察、不采纳其改法**）：
        // 复核指出本分支让非 owner 能二分出「这个 dagTeamId 存不存在」，并从中读到 owner 的 id。
        // 观察属实。但**不把归属门挪到存在性之后**，因为那会**放大**泄露：
        // 挪过去就得先读任务/依赖，于是非 owner 能拿到的信号从「团存不存在」升级为
        // 「这个团里有没有这个任务、它的依赖完成没有」—— 正是本文件开头分类要挡住的那类数据。
        // 而「团存不存在 + owner 是谁」在 FR-7.4（归属移交）下**本来就是需要可见的**：
        // 移交要找得到当前 owner。⇒ 维持现有顺序，并在此**显式声明**这一取舍（复核的另一选项）。
        return {
          kind: 'not-owner',
          reason:
            `DAG 团队 ${dagTeamId} 归成员 ${owner} 所有，你不是它的归属者（FR-7.2：非 owner 的任何读/写/派发操作一律拒绝）。`
            + '若确实需要接手，请由当前 owner 发起归属移交（FR-7.4）。',
        }
      }

      // ── 门 2：任务存在性 + 依赖（FR-4.1）──
      const readState = guarded(() => deps.projection.dag.taskStateOf(dagTeamId, taskId))
      if (!readState.ok) {
        return { kind: 'failed', reason: `读任务状态时抛错：${readState.reason}` }
      }
      const current = readState.value
      // ⚠ 判定顺序**必须**是「先 null、后 typeof」（OCR 复核 MEDIUM [7]，真实缺陷）。
      //
      // 我先前为修 HIGH [5]（`current.trim()` 在非字符串上抛错）加了一道
      // `typeof current !== 'string'` 守卫，但把它**放在了 `null` 判定之前** ——
      // 而 `typeof null === 'object'` ⇒ `null`（即「没有这个任务」）会被那道守卫
      // **吞掉**，报成「taskStateOf 的实现与契约不符」这个**错的诊断**，
      // `unknown-task` 这个分支从此不可达。两者的调用方动作完全不同
      //（「任务不存在，检查 taskId」 vs 「适配器坏了」），不可混。
      // ⇒ 顺序改为：`null` → 非字符串 → 空串，三条各归各的诊断。
      if (current === null) {
        return {
          kind: 'unknown-task',
          reason: `DAG 团队 ${dagTeamId} 里没有任务 ${taskId}。`,
        }
      }
      if (typeof current !== 'string') {
        return {
          kind: 'failed',
          reason:
            `任务 ${taskId} 的状态既不是字符串也不是 null（收到 ${renderValueForMessage(current)}）—— `
            + 'taskStateOf 的实现与契约（string | null）不符，拒绝据此落账。',
        }
      }
      // ⚠ 空串是**脏数据**，不是「某个可认领的状态」（OCR 复核 MEDIUM [16]，真实缺陷）。
      //
      // `SophiaDagPorts.taskStateOf` 的文档明确区分「`null` = 没有这个任务」与
      // 「空串 = 脏数据」。而初版让空串**直接穿过**这道门，最终把 `from: ''` 写进
      // **不可改写**的账本 —— 即：把非法状态**前推**给了所有回放者，
      // 而那正是「`from` 必须取自投影」这套设计要防的事。
      // ⇒ 显式拒绝，并说明这是脏数据（而不是「任务不存在」）。
      if (current.trim() === '') {
        return {
          kind: 'failed',
          reason:
            `任务 ${taskId} 的当前状态是**空串**（脏数据，不是"任务不存在"）—— `
            + '若在此落账，会把 `from: \'\'` 前推给所有回放者。请先修账本里的这条状态记录。',
        }
      }
      if (current === SOPHIA_CLAIMED_TASK_STATE) {
        // 幂等：重复认领不落第二条事件。落第二条会把「同一次认领」记成两次事实，
        // 而账本不可改写 ⇒ 之后任何统计「谁认领了几次」的消费方都会多数一次。
        return { kind: 'already-claimed', dagTeamId, taskId, from: current }
      }

      // ⚠ **其余状态一律可认领** —— 这是有意的，不是漏判（OCR 复核 MEDIUM [13]）。
      //
      // 复核建议「`current !== 'pending'/'ready'` 就拒绝」，**不采纳**，理由与
      // SPEC §11 的 Q-G 裁定同源：`DagTaskState` 被刻意冻结为 `string`，
      // 因为 FR-4.1 的显式状态机属 `sophia-engine-dag`（本期未实现）。
      // 在这里hardcode 一份「哪些状态可认领」的白名单，等于**在尚无实现约束时
      // 冻结一个错误的形状** —— 等引擎立项后它的规范状态名很可能与这份名单不同，
      // 而名单会把合法认领也拦下来（表现为「任务永远认领不了」，极难查到原因）。
      //
      // 另有一层：落在 `claimed` 之外的任何状态上写 `from: <当前>, to: 'claimed'`
      // **不是伪造事实** —— 认领这件事确实发生了，`from` 也确实取自账本的当前投影
      //（这正是本文件坚持不接受调用方自报 `from` 的原因）。
      // 「该不该允许认领一个已完成/已取消的任务」是**引擎的策略**，不是本层的。
      //
      // 已如实登记为契约缺口（见 `SOPHIA_TOOL_CONTRACT_GAPS.claimableStates`），
      // 供 `sophia-engine-dag` 立项时收口。
      const readUnfinished = guarded(() => deps.projection.dag.unfinishedDependenciesOf(dagTeamId, taskId))
      if (!readUnfinished.ok) {
        return { kind: 'failed', reason: `读任务依赖时抛错：${readUnfinished.reason}` }
      }
      const unfinished = readUnfinished.value
      // [3] 形状守卫：契约是 `readonly string[]`，但注入实现可能返回非数组。
      // 不判的话 `unfinished.length` 会抛（`guarded` 只罩住**调用**、不罩住**取属性**），
      // 破掉「绝不抛」；若是「像数组但不是数组」的对象，坏值还会被静默播进 `blocked`。
      if (!Array.isArray(unfinished)) {
        return {
          kind: 'failed',
          reason:
            `任务的未完成依赖不是数组（收到 ${renderValueForMessage(unfinished)}）—— `
            + 'unfinishedDependenciesOf 的实现与契约（readonly string[]）不符，拒绝据此判门禁。',
        }
      }
      if (unfinished.length > 0) {
        return { kind: 'blocked', dagTeamId, taskId, unfinishedDependencies: unfinished }
      }

      // ── 落账 ──
      //
      // ⚠ **写序竞争（OCR 复核 MEDIUM [16]，真实缺陷，已按 switch-model 同一手法处置）**
      //
      // `current` 是在上面**读**出来的，而 `commit` 只在自己的内部开写事务
      //（`ledger.ts` 的 `BEGIN IMMEDIATE`）。这两者之间**没有**任何锁保护 ——
      // 于是另一个进程可以合法地改掉该任务的状态（例如任务被取消、依赖回退），
      // 而我们随后落下的 `from: current` 就是一条**不成立的转换起点**。
      // 账本不可改写 ⇒ 任何按 `dag/task-state-changed` 重放状态机的消费方
      //（FR-4.1 的显式状态机）都会从错的地方开始，且无法纠正。
      //
      // 本工具**无法**消除这个窗口：`Ledger` 的公开契约里没有「读-判-写在同一事务内」
      // 的能力（`commit` 只收一条事件，不接受断言）。能做的是**探测并如实上报**：
      //  1. 在**紧邻 commit 之前、且中间没有 `await`** 的位置重读一次 `head()`，
      //     据此预测本次 commit 会拿到的序号（`head()` 与 `commit` 都是同步的，
      //     同一进程内两者之间不可被打断 —— 这一点 `switch-model.ts` 有同样的说明）；
      //  2. commit 返回后校验 `receipt.sequence === predicted`；
      //  3. 不等则说明**跨进程**插入了事件，此时如实回报 `sequence-mismatch`，
      //     把两个序号都带出来供人工核对，而不是把它读成一次干净的认领。
      //
      // 残余风险如实标注：校验发生在写入**之后**，真的触发时账本里**确实**留下了一条
      // `from` 可能过期的转换（append-only，撤不回）。彻底消除需要账本支持
      // 「把序号交给载荷构造函数」或「条件提交」—— 那是契约扩展，不由实现单方面发明。
      let occurredAt: number
      try {
        occurredAt = deps.now()
      } catch (error) {
        return {
          kind: 'failed',
          reason: `读当前时间失败（deps.now 抛错），未写账本、也未进入写序临界区：${describeError(error)}`,
        }
      }

      let predicted: number
      try {
        const head = deps.ledger.head()
        // ⚠ `head().sequence` 必须**校验形状**（OCR 复核 HIGH [1]）。
        // 与 `switch-model.ts` 的同一步现在**对齐**（我此前只给那边的读侧补了校验，
        // 这一处漏了 —— 同一个端口、同一类要求，两处不一致本身就是缺陷）。
        // 不校验时：`sequence` 非整数 ⇒ `predicted` 成 `NaN`/非整数 ⇒
        // `receipt.sequence !== predicted` 恒真 ⇒ 被**误报成 `sequence-mismatch`**，
        // 而那是个**假的并发冲突**（真因是 adapter 违约），排查方向会整个歪掉。
        if (!isNonNegativeSafeInteger(head.sequence)) {
          return {
            kind: 'failed',
            reason:
              `账本 head() 返回的序号不是非负安全整数（收到 ${renderValueForMessage(head.sequence)}）—— `
              + '说明注入的 Ledger 实现与契约不符。此处**尚未写账本**，故没有留下任何痕迹；'
              + '这里拒绝把它当成「跨进程并发」上报（那是两件不同的事）。',
          }
        }
        predicted = head.sequence + 1
      } catch (error) {
        return { kind: 'failed', reason: `读账本头部失败，无法确定写序：${describeError(error)}` }
      }

      try {
        const receipt = deps.ledger.commit({
          kind: 'dag/task-state-changed',
          // ⚠ 用**裁剪过的** `selfMemberId`（与归属门同源）——
          // 与 `switch-model.ts` 的 HIGH/MEDIUM [1][8] 是同一类缺陷：
          // 门用裁剪值、落账用未裁剪值，会让「判定」与「事实」读两个不同的真相，
          // 而不一致永久留在不可改写的账本上。
          actor: { kind: 'member', memberId: selfMemberId },
          occurredAt,
          data: {
            dagTeamId,
            taskId,
            from: current,
            to: SOPHIA_CLAIMED_TASK_STATE,
            // `reason` 是可选字段（`DagTaskStateChangedData.reason?: string`）。
            // ⚠ 用条件展开而不是 `reason: narrowed.reason ?? ''`：空串是一条**看起来有值**的事实，
            // 而 `exactOptionalPropertyTypes` 下省略才是「没有理由」的正确表达。
            ...(narrowed.reason === undefined ? {} : { reason: narrowed.reason }),
          },
        })
        // ⚠ `receipt.sequence` 必须**先校验形状**再使用（OCR 复核 MEDIUM [6]）。
        //
        // 初版直接拿它去比 `predicted`：若注入的 ledger 返回 `undefined`，
        // 比较不成立 ⇒ 走 `sequence-mismatch` —— 一个**声称"认领事实已写入（序号 undefined）"**
        // 的分支。那是把「适配器坏了」读成「跨进程并发」，还把 undefined 当序号播出去，
        // 人工核对时会去找一条根本不存在的记录。
        // ⇒ 先判它是非负安全整数（与 `switch-model.ts` 的 `actual` 处理同源），
        // 形状不对就如实判 `failed`，并说清是 ledger 的实现不符契约。
        const actualSequence = receipt.sequence
        if (!isNonNegativeSafeInteger(actualSequence)) {
          return {
            kind: 'failed',
            reason:
              `账本 commit 返回的序号不是非负安全整数（收到 ${renderValueForMessage(actualSequence)}）—— `
              + '说明注入的 Ledger 实现与契约不符。事件可能已写入，请人工核对账本尾部；'
              + '这里拒绝把它当成「跨进程并发」上报（那是两件不同的事）。',
          }
        }
        if (actualSequence !== predicted) {
          // 事件**已写入**（撤不回）⇒ 如实上报，不读成成功。
          deps.logger?.warn(
            `[sophia] sophia_task_claim 写序校验失败：预测 ${String(predicted)}、实际 ${String(actualSequence)}`,
          )
          return {
            kind: 'sequence-mismatch',
            predicted,
            actual: actualSequence,
            reason:
              `认领事实已写入（序号 ${String(actualSequence)}），但写序校验失败（预测 ${String(predicted)}）：`
              + '判门与提交之间有另一个进程提交了事件，因此载荷里的 from '
              + `（${renderValueForMessage(current)}）可能已经不是该任务提交瞬间的真实状态，需要人工核对。`,
          }
        }
        return {
          kind: 'claimed',
          dagTeamId,
          taskId,
          // [19] 如实带出契约缺口（此前只在注释里提到它，调用方**看不到**）。
          // 「除已认领外的任何状态都可被认领」是一个**刻意的未裁定决策**，
          // 调用方有权知道 —— 与 `message.ts`/`rollover.ts` 的做法一致。
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.claimableStates],
          from: current,
          to: SOPHIA_CLAIMED_TASK_STATE,
          sequence: receipt.sequence,
        }
      } catch (error) {
        return { kind: 'failed', reason: `写 dag/task-state-changed 失败：${describeError(error)}` }
      }
    },
  }
  return sophiaToolDescriptor(definition)
}

