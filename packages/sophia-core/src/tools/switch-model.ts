/**
 * `sophia_switch_model` —— 申请 / 执行换模（FR-6.2 / FR-6.4 / FR-6.5 / FR-6.1）。
 *
 * ## 它写什么、为什么
 *
 * 落一条 `team/member-model-switched`，载荷按 FR-6.4 的五项：
 * 成员、旧模型（`from`）、新模型（`to`）、触发原因（`reason`）、触发者（`trigger`）。
 *
 * - **`from` 取账本投影**（`projection.modelOf`），**不接受模型自报**。
 *   理由与 `sophia_task_claim` 的 `from` 同源且更强：换模事件的 `from` 若可由调用方编造，
 *   账本上就会留下「从 B 换到 C」这样一条**从未发生过**的历史，
 *   而它是不可改写的 —— 之后任何重放换模链的消费方都会从 B 开始，而真实起点是 A。
 *   成员**从未换过模**时 `from` 取不到：此时**拒绝**（`unknown-current-model`），
 *   而不是拿 `to` 顶上（那会写出一条 `from === to` 的空转换，看起来像「换过了」）。
 *
 * - **`trigger` 恒为 `'member-self'`**，不由参数决定。`ModelSwitchTrigger` 是闭集
 *   （`'human' | 'member-self' | 'policy'`），而这个工具**只可能是成员自己**发起的：
 *   人类换模走 UI（FR-6.1「在成员卡片上直接切换」），策略换模走调度体。
 *   让模型自己填 `trigger` 就等于允许它把「我自己想换」记成「人类让我换」——
 *   那是一条**伪造的审批痕迹**（FR-6.4 的触发者字段正是为此存在）。
 *
 * ## ⚠ `effectiveAtSequence` —— 一个真实的写序依赖，用「预测 + 校验」解掉
 *
 * 载荷要求 `effectiveAtSequence: LedgerSequence`，而这个值**只有 `commit` 返回后才知道**
 * （它就是这条事件的序号）。`commit` 是**同步**的（SPEC §6.5），账本又是 append-only
 * （不可「先写占位再回填」）。这是一个真实的写序依赖。
 *
 * 解法：`Ledger.head()` 与 `commit()` **都是同步的，两者之间没有 `await`** ——
 * 因此在**同一进程内**，「本次 `commit` 拿到的序号 = `head().sequence + 1`」是**可证明**的
 * （JS 单线程，同步段不可被打断）。于是：
 *
 * 1. `predicted = ledger.head().sequence + 1`；
 * 2. 用它写载荷；
 * 3. `commit` 返回后**校验** `receipt.sequence === predicted`。
 *
 * 第 3 步不是装饰性的：**跨进程**并发提交（本仓 AC-10-6 就是那样验的：另开一条连接
 * 绕过本类直接写）能在那两步之间插进来，此时我们就把**别人的序号**写进了自己的载荷。
 * 校验会抓住它并回到 `failed`，把两个数字都带出来供人工核对 ——
 * **响亮失败**，而不是一条悄悄写错的账本事实。
 *
 * ⚠ 如实标注残余风险：校验发生在写入**之后**，所以万一触发，账本里**确实**留下了一条
 * `effectiveAtSequence` 偏差 1 的事件（append-only，改不了）。
 * 彻底消除它需要账本支持「提交时把序号交给载荷构造函数」（本包此刻的 `Ledger` 契约里没有）
 * —— 那是契约扩展，不由实现单方面发明。本工具的处置是**探测并如实上报**。
 *
 * ## ⚠ FR-6.5「正忙时在最近的步骤边界生效」—— 本工具的边界
 *
 * 生效点**不在本工具层**：它是成员运行时下一个 step 边界的事。
 * 上面那个 `effectiveAtSequence` 记的是「这条事实在账本里的序号」，
 * **不是**「换模在运行时生效于哪一步」。二者不要混读 ——
 * `SOPHIA_EFFECTIVE_SEQUENCE_NOTE` 会随结果一起返回，把这句说清。
 * 结果里的 `presence` 给出提交时刻该成员的存在态（运行期观测，按 FR-3.2 **不入账本**）。
 *
 * @module @sophia/core/tools/switch-model
 */

import type { MemberId, TeamId } from '../types/ids.ts'
import type { MemberLifecycle, MemberPresence } from '../types/team.ts'
import type { MemberModel } from '../projection/index.ts'
// `LedgerReceipt` 是 `deps.ledger.commit` 的返回类型；在 try 外声明它的变量
// 才能在 try 之后做「写序校验」（见第 6 步的说明）。
import type { LedgerReceipt } from '../ledger.ts'
import {
  sophiaToolDescriptor,
  type SophiaToolDefinition,
  type SophiaToolDescriptor,
  type SophiaToolsDeps,
} from './types.ts'
import {
  asUncheckedRecord,
  describeError,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  missingFieldReason,
  renderValueForMessage,
  unreachableOutcome,
  narrowTrimmedString,
} from './internal.ts'

/** `sophia_switch_model` 的入参（类型层的期望形状）。 */
export interface SwitchModelInput {
  /** 新模型的 provider 名。 */
  readonly provider: string
  /** 新模型的 model 名。 */
  readonly model: string
  /** 触发原因（FR-6.4 必填）。成员**必须**说明理由 —— 空理由会被拒。 */
  readonly reason: string
  /** 要换模的成员；省略 = 换自己（成员只应换自己，见文件头）。 */
  readonly memberId?: MemberId
}

/** `trigger` 的**唯一**取值（本工具只可能是成员自身发起，见文件头）。 */
export const SOPHIA_SELF_SWITCH_TRIGGER = 'member-self'

/** `effectiveAtSequence` 的语义说明（必进结果，见文件头）。 */
export const SOPHIA_EFFECTIVE_SEQUENCE_NOTE =
  'effectiveAtSequence 记录的是「这条换模事实在账本里的序号」，'
  + '不是 FR-6.5 所说的「运行时在哪个步骤边界生效」——后者由成员运行时的下一个 step 边界决定。'

export type SwitchModelOutcome =
  | {
      readonly kind: 'switched'
      readonly memberId: MemberId
      readonly from: MemberModel
      readonly to: MemberModel
      readonly trigger: typeof SOPHIA_SELF_SWITCH_TRIGGER
      readonly effectiveAtSequence: number
      /**
       * 提交时刻该成员的存在态（运行期观测，**不入账本**）。
       *
       * `'unknown'` 表示**读失败**（运行时的 `presenceOf` 抛错）——
       * 与 `'idle'` 必须区分：把读不出来报成「空闲」是在**编造一个观测值**
       *（该成员此刻可能正在 running）。见 `execute` 第 5 步的说明。
       */
      readonly presence: MemberPresence | 'unknown'
      readonly notes: readonly string[]
    }
  /** 目标模型与当前模型完全相同：**不落账**（否则会写出一条空转换）。 */
  | { readonly kind: 'no-change'; readonly memberId: MemberId; readonly current: MemberModel }
  | { readonly kind: 'invalid-input'; readonly reason: string }
  /** 账本里认不出该成员，或它从未有过模型（`from` 取不到 ⇒ 拒绝，见文件头）。 */
  | { readonly kind: 'unknown-current-model'; readonly reason: string }
  /** 生命周期不是 `active`（已挂起 / 归档 / 销毁）：换模无意义。 */
  | { readonly kind: 'not-active'; readonly lifecycle: MemberLifecycle }
  /**
   * 账本完全不认识这个成员（`lifecycleOf` 返回 `null`）。
   *
   * OCR 复核 MEDIUM [7]：与 `not-active` / `unknown-current-model` 是**三件不同的事** ——
   * 这里意味着「投影里根本没有这个成员」，而不是「它存在但没换过模」。
   * 合并会让调用方以为「一个有效成员只是缺个模型」。
   */
  | { readonly kind: 'unknown-member'; readonly reason: string }
  /** 越权：只能给自己换模。 */
  | { readonly kind: 'not-self'; readonly reason: string }
  /** 写序校验失败（跨进程并发提交插进了两次调用之间）——**事件已写入**，需人工核对。 */
  | {
      readonly kind: 'sequence-mismatch'
      readonly predicted: number
      readonly actual: number
      /**
       * 本应写入的那次换模的**标识**（OCR 复核 MEDIUM [18]）。
       *
       * 初版这个分支只带两个序号，而它们分别是**外来事件**与本事件的序号 ——
       * 光凭它们，人工核对时**不知道该去账本里找哪一条**（哪个成员、从什么换成什么）。
       * 既然 render 明确要求「需要人工核对」，就得把核对该条事实所需的标识一起带出。
       */
      readonly memberId: MemberId
      readonly from: MemberModel
      readonly to: MemberModel
      readonly reason: string
    }
  | { readonly kind: 'failed'; readonly reason: string }

function invalid(reason: string): SwitchModelOutcome {
  return { kind: 'invalid-input', reason }
}

function narrowInput(input: unknown): SwitchModelInput | SwitchModelOutcome {
  const raw = asUncheckedRecord(input)
  // ⚠ 四个字符串字段一律走 narrowTrimmedString（先校验、再裁剪）——
  // 理由见 src/tools/internal.ts 的该函数文档（OCR 复核 MEDIUM [17]）：
  // 不裁剪会让「带空格的 memberId」被误报成 not-self（看起来像越权），
  // 让「带空格的 model」绕过同模型短路并在账本上写出一条假转换。
  const provider = narrowTrimmedString(raw, 'provider')
  if (!provider.ok) return invalid(provider.reason)
  if (provider.value === undefined) return invalid(missingFieldReason('provider'))
  const model = narrowTrimmedString(raw, 'model')
  if (!model.ok) return invalid(model.reason)
  if (model.value === undefined) return invalid(missingFieldReason('model'))
  // FR-6.4 把 `reason` 列为必落账字段 ⇒ 空理由必须被拒，而不是写一个空串进账本。
  // 与 `delegation.ts` 的 `requireHumanOperator` 对空操作者的硬拒同一口径。
  const reason = narrowTrimmedString(raw, 'reason')
  if (!reason.ok) return invalid(reason.reason)
  if (reason.value === undefined) {
    return invalid(
      `缺少必填参数 reason（FR-6.4 要求换模落账时说明触发原因；必须是**非空白**字符串）。`,
    )
  }
  // OCR MEDIUM [21]：可选字段显式给空白 = 「省略」（与 spawn-team 的 optional
  // requestId 同处置）。走 missingFieldReason 会给「缺少必填参数 memberId」
  // 这条对可选字段为假的文案，诱导模型编一个非空 id —— 那会立刻被 not-self
  // 拒绝（错误文案把自己变成下一次失败的原因）。
  const rawMemberId = raw['memberId']
  const memberId = typeof rawMemberId === 'string' && rawMemberId.trim() === ''
    ? { ok: true as const, value: undefined }
    : narrowTrimmedString(raw, 'memberId')
  if (!memberId.ok) return invalid(memberId.reason)
  return {
    provider: provider.value,
    model: model.value,
    reason: reason.value,
    ...(memberId.value === undefined ? {} : { memberId: memberId.value as MemberId }),
  }
}

/**
 * 构造 `sophia_switch_model`。
 *
 * @param deps - 工具集依赖（宿主唯一接线点，见 `SophiaToolsDeps`）。
 */
export function createSwitchModelTool(deps: SophiaToolsDeps): SophiaToolDescriptor {
  const definition: SophiaToolDefinition<SwitchModelInput, SwitchModelOutcome> = {
    name: 'sophia_switch_model',
    description:
      '给自己换一个模型，并把换模事实落账（FR-6.4：成员、旧模型、新模型、原因、触发者）。'
      + '旧模型取自账本、不接受自报；触发者恒记为你自己发起（human / policy 触发不走本工具）。'
      + '目标模型与当前相同时不会落账。',
    parameters: {
      provider: { type: 'string', required: true, description: '新模型的 provider 名（非空）。' },
      model: { type: 'string', required: true, description: '新模型的 model 名（非空）。' },
      reason: {
        type: 'string',
        required: true,
        description: '换模原因（FR-6.4 必填，非空）。例如上下文压力、质检连续失败、任务复杂度变化。',
      },
      memberId: {
        type: 'string',
        description: '要换模的成员 ID；省略 = 换自己。只允许换自己（换别人请由人类在成员卡片上操作）。',
      },
    },
    // ── 输出 schema（裸 DSL；判别联合只能扁平表达，见 SophiaToolDefinition.outputSchema）──
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: {
          type: 'string',
          required: true,
          enum: ['switched', 'no-change', 'unknown-current-model', 'unknown-member', 'not-active', 'not-self', 'sequence-mismatch', 'invalid-input', 'failed'],
          description: '结果分支。switched = 已落账换模。',
        },
        memberId: { type: 'string', description: '被换模的成员 id。' },
        from: {
          type: 'object',
          additionalProperties: false,
          description: '换模前的模型；**取自账本投影**（不接受自报）。',
          properties: {
            provider: { type: 'string', required: true },
            model: { type: 'string', required: true },
          },
        },
        to: {
          type: 'object',
          additionalProperties: false,
          description: '换模后的模型。',
          properties: {
            provider: { type: 'string', required: true },
            model: { type: 'string', required: true },
          },
        },
        current: {
          type: 'object',
          additionalProperties: false,
          description: '（no-change）当前模型（与请求相同，故未落账）。',
          properties: {
            provider: { type: 'string', required: true },
            model: { type: 'string', required: true },
          },
        },
        trigger: { type: 'string', enum: ['human', 'member-self', 'policy'], description: '（switched）触发源；本工具恒为 member-self。' },
        effectiveAtSequence: { type: 'number', description: '（switched）FR-6.5 的实际生效序号。' },
        presence: { type: 'string', description: '（switched）提交时刻的存在态（运行期观测，不入账本）；unknown = 读取失败。' },
        notes: { type: 'array', items: { type: 'string' }, description: '（switched）给调用方的补充说明。' },
        lifecycle: { type: 'string', description: '（not-active）当前生命周期。' },
        predicted: { type: 'number', description: '（sequence-mismatch）预测序号。' },
        actual: { type: 'number', description: '（sequence-mismatch）实际序号。' },
        reason: { type: 'string', description: '拒绝 / 失败 / 需人工核对时的可读原因。' },
      },
    },
    render: (outcome) => {
      switch (outcome.kind) {
        case 'switched':
          return (
            `已换模 ${outcome.memberId}：${outcome.from.provider}/${outcome.from.model} → `
            + `${outcome.to.provider}/${outcome.to.model}（触发者 ${outcome.trigger}，`
            + `账本序号 ${String(outcome.effectiveAtSequence)}，提交时存在态 ${outcome.presence}）。`
            + outcome.notes.join(' ')
          )
        case 'no-change':
          return (
            `无需换模：${outcome.memberId} 当前就是 `
            + `${outcome.current.provider}/${outcome.current.model}，未落账。`
          )
        case 'sequence-mismatch':
          return (
            `⚠ 换模事实已写入，但写序校验失败：预测序号 ${String(outcome.predicted)}、`
            + `实际序号 ${String(outcome.actual)} —— 期间有另一个进程提交过。`
            + `需要人工核对的那条事实是：成员 ${outcome.memberId} `
            + `${outcome.from.provider}/${outcome.from.model} → `
            + `${outcome.to.provider}/${outcome.to.model}（原因「${outcome.reason}」），`
            + `其载荷里的 effectiveAtSequence 是 ${String(outcome.predicted)}。`
            // ⚠ **必须明说不要重试**（OCR 复核 MEDIUM [6]）。本输出是**给模型看的**：
            // 它读到「事实已写入」若直接再调一次，就会往 append-only 账本里
            // **追加第二条** `team/member-model-switched`（第一条撤不回），
            // 把一个已检出的异常变成永久的重复历史。
            // `host-data.ts` 的 `switchMemberModel` 对同一模式已有这句告诫，这里对齐。
            + ' ⚠ **不要重试** —— 重试会写入第二条换模事件（第一条已写入、撤不回）。'
          )
        case 'invalid-input':
        case 'unknown-current-model':
        case 'not-self':
        case 'failed':
        case 'unknown-member':
          return `换模未执行（${outcome.kind}）：${outcome.reason}`
        case 'not-active':
          // 单独一支：这个分支**没有** `reason` 字段（它带的是 `lifecycle`）。
          // 合并进上面那一支会让 tsc 报 TS2339 —— 这不是打字问题，而是
          // 「有个分支的形状不同、必须被显式对待」的正确答案（本文件的设计纪律之一）。
          return (
            `换模未执行（not-active）：成员生命周期为 ${outcome.lifecycle}`
            + '（已挂起 / 归档 / 销毁的成员不需要换模）。'
          )
        default:
          return unreachableOutcome(outcome)
      }
    },
    execute(input: unknown): SwitchModelOutcome {
      const narrowed = narrowInput(input)
      if ('kind' in narrowed) return narrowed

      // ⚠ **身份必须先校验、再裁剪**（OCR 复核 HIGH [7][8]，与 `task-claim.ts` 的
      // MEDIUM [4] 同源 —— 那里修了、这里漏了）。`deps.caller` 是**宿主接线**而非模型入参：
      // 1. 绑成 `undefined`/`null`，或 `memberId` 不是字符串 ⇒ `.trim()` 抛 `TypeError`
      //    穿出 `execute`，破掉「只返回错误、绝不抛」；
      // 2. `memberId` 是空串/纯空白 ⇒ 裁成 `''`。而 `teamId` 同理，
      //    两个空串会互相"匹配" ⇒ 授权判定在**空值上失效**。
      // `teamId` 必须一起校验：它会被原样写进不可改写的账本（见下面第 6 步的说明）。
      const callerMemberId = deps.caller === null || deps.caller === undefined
        ? undefined
        : deps.caller.memberId
      const callerTeamId = deps.caller === null || deps.caller === undefined
        ? undefined
        : deps.caller.teamId
      if (!isNonEmptyString(callerMemberId)) {
        return {
          kind: 'failed',
          reason:
            `调用者身份不可用（收到 ${renderValueForMessage(callerMemberId)}）—— `
            + '工具集的 caller.memberId 必须是非空白字符串；空身份会让授权判定在空值上失效，故 fail-closed。',
        }
      }
      if (!isNonEmptyString(callerTeamId)) {
        return {
          kind: 'failed',
          reason:
            `调用者所属团不可用（收到 ${renderValueForMessage(callerTeamId)}）—— `
            + '工具集的 caller.teamId 必须是非空白字符串（它会被原样写进不可改写的账本），故 fail-closed。',
        }
      }
      // `as MemberId` 是「裁剪不改身份」的直接后果：品牌在运行期只是 `string`
      //（`src/types/ids.ts`），裁掉首尾空白后它仍是同一个成员 id。
      const selfMemberId = callerMemberId.trim() as MemberId
      const selfTeamId = callerTeamId.trim() as TeamId
      const target = narrowed.memberId ?? selfMemberId

      // ── 1. 越权门：只能换自己 ──
      // 与上游「args.from 必须等于调用者」同一意图，但这里做在**业务对象**上：
      // 换模的载荷里有 `memberId`，伪造它等于替别人改运行时模型（FR-6.1 把人类换模
      // 放在成员卡片 UI 上，正是因为它需要人类的判断）。
      if (target !== selfMemberId) {
        return {
          kind: 'not-self',
          reason:
            `你只能给自己换模（你是 ${selfMemberId}，请求的是 ${target}）。`
            + '给别的成员换模属于人类操作（FR-6.1：在成员卡片上直接切换），或由策略触发。',
        }
      }

      // ── 2. 生命周期门（账本投影；非 active 时换模无意义）──
      let lifecycle: MemberLifecycle | null
      let current: MemberModel | null
      try {
        lifecycle = deps.projection.lifecycleOf(target)
        current = deps.projection.modelOf(target)
      } catch (error) {
        return { kind: 'failed', reason: `读账本投影时抛错：${describeError(error)}` }
      }
      // [7] `null` 表示「账本不认识这个成员」，与「非 active」是两件事 ——
      // 分开报，免得调用方以为「一个有效成员只是没换过模」。
      if (lifecycle === null) {
        return {
          kind: 'unknown-member',
          reason:
            `账本里没有成员 ${target}（或它从未被加入过任何团）—— `
            + 'lifecycleOf 返回 null 表示投影完全不认识它，故拒绝换模。',
        }
      }
      if (lifecycle !== 'active') {
        return { kind: 'not-active', lifecycle }
      }

      // ── 3. 旧模型必须来自账本投影（见文件头）──
      if (current === null) {
        return {
          kind: 'unknown-current-model',
          reason:
            `账本里取不到成员 ${target} 的当前模型。`
            // ⚠ 措辞必须**只**说这一种成因：走到这里时成员**是存在的**且生命周期为
            // `active` —— 那两条分别由上面的 `unknown-member` / `not-active` 接走了。
            // 初版这里还写着「或账本里根本没有这个成员」，那在我加 `unknown-member`
            // 分支之后就**成了假话**（那种情况根本走不到这行）。
            // 这与本文件在别处建立的纪律一致：**一个分支只描述它真正覆盖的情形**。
            + `它确实在账本里（且是 active），但从未有过模型 —— 既没在 \`member-added\` 时`
            + '带上**初始模型**，也没有一条换模事件。'
            + '换模事件必须携带真实的旧模型（FR-6.4）；用一个猜测值当 from '
            + '会在不可改写的账本上留下一条从未发生过的转换，故此处拒绝而不是将就。'
            // 给出**出路**（FR-8.4 对错误信息的要求）：调用方拿到这句应当知道怎么办。
            + `要让 ${target} 能换模，须由建团方在 \`member-added\` 里带一个初始模型；`
            + '或由人类在成员卡片上直接指派（那走 `trigger: human`，不经本工具）。',
        }
      }

      // ── 4. 同模型短路：不落账 ──
      // 落一条 `from === to` 的事件不是"无害的冗余"：它在账本上表现为一次**真实发生过的换模**，
      // 于是「这个成员换过几次模」这类统计会多算一次，而账本不可改写、无法纠正。
      if (current.provider === narrowed.provider && current.model === narrowed.model) {
        return { kind: 'no-change', memberId: target, current }
      }

      // ── 5. 存在态（运行期观测，不入账本；读失败不拦换模）──
      //
      // ⚠ 读失败时**不得**报成 `'idle'`（OCR 复核 MEDIUM [2]，真实缺陷）。
      // 初版 `let presence: MemberPresence = 'idle'` 在 catch 里保持不变，
      // 于是「读不出来」被渲染成一句**确定的**观测「提交时存在态 idle」——
      // 而该成员此刻可能正在 running。对一个明确告诉调用方「可以信」的观测值来说，
      // 这属于**编造事实**。⇒ 引入 `'unknown'` 这个显式取值，让降级可见。
      let presence: MemberPresence | 'unknown' = 'unknown'
      try {
        presence = deps.runtime.presenceOf(target)
      } catch (error) {
        deps.logger?.warn(`[sophia] sophia_switch_model 读存在态失败（不影响换模）：${describeError(error)}`)
      }

      // ── 6. 预测序号 → 落账 → 校验（理由见文件头；两步之间**没有 await**）──
      let predicted: number
      try {
        const head = deps.ledger.head()
        // ⚠ `head().sequence` 也必须**校验形状**（OCR 复核 MEDIUM [1]）。
        // 这是与 `receipt.sequence` **同一个端口、同一类要求** —— 我先前只校验了回执那一侧。
        // 若不校验：`sequence` 是 `undefined`/非整数时 `predicted` 会变成 `NaN`，
        // 而它会被写进**不可改写**的账本载荷（`effectiveAtSequence: NaN` 会被 JSON 序列化成
        // `null`），此后每次回放都读到一条**序号含义不明**的事件；同时
        // `actualSequence !== predicted` 恒真 ⇒ 又走成误导性的 `sequence-mismatch`。
        // ⇒ 与回执侧对称：形状不对就如实判 `failed`，且**不写账本**（这一步在 commit 之前）。
        if (!isNonNegativeSafeInteger(head.sequence)) {
          return {
            kind: 'failed',
            reason:
              `账本 head() 返回的序号不是非负安全整数（收到 ${renderValueForMessage(head.sequence)}）—— `
              + '说明注入的 Ledger 实现与契约不符。此处**尚未写账本**，故没有留下任何痕迹。',
          }
        }
        predicted = head.sequence + 1
      } catch (error) {
        return { kind: 'failed', reason: `读账本头部失败，无法确定 effectiveAtSequence：${describeError(error)}` }
      }

      // ⚠ `deps.now()` **必须在进入临界区之前**取好（OCR 复核 MEDIUM [7]，真实缺陷）。
      //
      // 文件头明确写着：`head()` 与 `commit()` 之间**不得有任何插入**（这是 `head().sequence + 1`
      // 这个预测成立的唯一理由）。而初版把 `occurredAt: deps.now()` **写在 commit 的实参对象里** ——
      // 即：求值顺序把一次**宿主注入的、可能很慢甚至抛错**的调用塞进了那个窗口里。
      // 两个后果都真实：
      // 1. 慢 ⇒ 窗口被拉长 ⇒ 跨进程插入的概率上升（正是预测要防的事）；
      // 2. 抛 ⇒ 被下面的 catch 捕获，报成「写账本失败」，**而账本其实根本没被碰过** ——
      //    调用方会以为「可能已写入」而去人工核对一个不存在的条目。
      // ⇒ 先取值、后进临界区：`now` 抛错时给出**准确的**原因，且不进窗口。
      let occurredAt: number
      try {
        occurredAt = deps.now()
      } catch (error) {
        return {
          kind: 'failed',
          reason: `读当前时间失败（deps.now 抛错），未写账本、也未进入写序临界区：${describeError(error)}`,
        }
      }

      // `receipt` 在 try **外**声明：下面要在 try 之后读它的 `sequence`
      //（即「写序校验」那一步）。写成 try 内的 `const` 会让那份校验够不着它。
      let receipt: LedgerReceipt
      try {
        receipt = deps.ledger.commit({
          kind: 'team/member-model-switched',
          // ⚠ 用**裁剪过的** `selfMemberId`，与上面那道授权门同源（OCR 复核 MEDIUM [8]，真实缺陷）。
          //
          // 初版这里写的是 `deps.caller.memberId`（**未裁剪**），而门用的是 `selfMemberId`
          //（裁剪过）—— 于是「判定」与「落账」读的是**两个不同的真相**：
          // 宿主接线带首尾空白时，门放行了（因为 `target` 等于裁剪后的 id），
          // 而账本里记下的 actor/memberId 是**带空白**的那个。
          // 结果是同一次请求在账本里的身份与投影里的身份**对不上**，
          // 而账本不可改写 ⇒ 这个不一致永久留在审计链上。
          actor: { kind: 'member', memberId: selfMemberId },
          occurredAt,
          data: {
            // `teamId` 用**在临界区之前就校验并裁剪好**的那个值（见第 1 步的 HIGH [7][8]
            // 说明）：它会被原样写进不可改写账本，且必须与授权判定同源。
            teamId: selfTeamId,
            memberId: selfMemberId,
            from: { provider: current.provider, model: current.model },
            to: { provider: narrowed.provider, model: narrowed.model },
            reason: narrowed.reason,
            trigger: SOPHIA_SELF_SWITCH_TRIGGER,
            effectiveAtSequence: predicted,
          },
        })
      } catch (error) {
        return { kind: 'failed', reason: `写 team/member-model-switched 失败：${describeError(error)}` }
      }

      // ⚠ `receipt.sequence` 必须**先校验形状**再使用（OCR 复核 HIGH [1]，真实缺陷）。
      //
      // 初版直接拿它去比 `predicted`：若注入的 `Ledger` 返回 `undefined` / 非数字，
      // 比较不成立 ⇒ 走进 `sequence-mismatch` —— 一个**声称「跨进程并发」**的分支，
      // 把「适配器不符契约」误报成并发，还把 `undefined` 当序号播给调用方
      //（人工核对会去找一条序号未知、甚至不存在的记录）。
      //
      // ⚠ 这条修复在 `task-claim.ts` 已经做过（那里的 OCR MEDIUM [6]），而**本文件漏了** ——
      // 更糟的是 `task-claim.ts` 的注释当时写着「与 `switch-model.ts` 的 `actual` 处理同源」，
      // **那句话在写下时就是假的**（本文件根本没有那道校验）。
      // 两处现已对齐；这条注释是该不一致留下的痕迹，故写在这里免得再被引用错。
      const actualSequence = receipt.sequence
      if (!isNonNegativeSafeInteger(actualSequence)) {
        return {
          kind: 'failed',
          reason:
            `账本 commit 返回的序号不是非负安全整数（收到 ${renderValueForMessage(actualSequence)}）—— `
            + '说明注入的 Ledger 实现与契约不符。事件**可能已写入**，请人工核对账本尾部；'
            + '这里拒绝把它当成「跨进程并发」上报（那是两件不同的事）。',
        }
      }

      if (actualSequence !== predicted) {
        // 见文件头：**跨进程**并发提交插进了 head() 与 commit() 之间。
        //
        // ⚠ 措辞必须**只覆盖这个机制真正抓得到的成因**（OCR 复核 MEDIUM [2]）。
        // 这条校验比对的是「本次 commit 实际拿到的序号」与「进临界区前预测的序号」。
        // 它**抓不到**下面这一类：`current` 是在**更早**（第 2 步，`modelOf`）读的，
        // 而 `predicted` 直到第 6 步才算 —— 若另一个进程在这两者**之间**追加了一条
        // **同成员**的换模事件，那么本次 commit 的序号**仍然是 `head()+1`**
        //（因为插入发生在 head() **之前**），`actual === predicted`、校验**通过**，
        // 而载荷里的 `from` 已经是**过期**的旧模型。
        // 文件头对 `from` 的那套论证（「取自投影、不接受自报」）挡的是**伪造**，
        // 挡不住这种**读-写竞争导致的过期**。⇒ 如实标注，而不是宣称「只可能是并发插入」。
        //
        // 事件**已经写入**（append-only，撤不回），故这里如实上报数字供人工核对，
        // 而不是把它读成成功。
        deps.logger?.warn(
          `[sophia] sophia_switch_model 写序校验失败：预测 ${String(predicted)}、实际 ${String(actualSequence)}`,
        )
        return {
          kind: 'sequence-mismatch',
          predicted,
          actual: actualSequence,
          memberId: target,
          from: current,
          to: { provider: narrowed.provider, model: narrowed.model },
          reason:
            'head() 与 commit() 之间有另一个进程提交了事件（这两次调用都是同步的，'
            + '同进程内不可被打断，故此处只可能是**跨进程插入**）。'
            + '载荷里的 effectiveAtSequence 是预测值，与实际序号不符。',
        }
      }

      return {
        kind: 'switched',
        memberId: target,
        from: current,
        to: { provider: narrowed.provider, model: narrowed.model },
        trigger: SOPHIA_SELF_SWITCH_TRIGGER,
        effectiveAtSequence: actualSequence,
        presence,
        notes: [SOPHIA_EFFECTIVE_SEQUENCE_NOTE],
      }
    },
  }
  return sophiaToolDescriptor(definition)
}

