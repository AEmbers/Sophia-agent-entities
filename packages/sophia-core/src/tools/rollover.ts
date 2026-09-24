/**
 * `sophia_context_rollover` —— 上下文接力（FR-3.4）。
 *
 * ## 它解决的问题与「不丢」为什么是结构性的
 *
 * FR-3.4：**上下文支持 rollover / checkpoint，切换与重启不丢待决事项。**
 *
 * 本包里「待决事项」**不是一份内存状态**，而是
 * 「账本事实 × 读水位」的函数（`src/projection/index.ts` 的 `unreadByMember`：
 * 水位是宿主的游标，账本里没有任何「已读」记录）。
 * ⇒ **没有任何东西随上下文一起消失**，因此不需要 checkpoint 事件来「保存」它。
 * 新上下文（换模后 / 重启后 / 换了会话）只要用同一个水位去问账本，就得到同一份待办清单。
 *
 * 这解释了本工具为什么**不写账本**：它做的是**读取与交接**，不是产生新事实。
 * 写一条「我 rollover 了」的事件会是账本里第一条**没有对应现实变化**的事实
 * （FR-10.1：「所有协作事实（…）须只追加写入」，rollover 不是协作事实，
 * 它是读取方换了个消费者）。
 *
 * ## 它做三件事（顺序是「先读事实，再唤醒」）
 *
 * 1. **读待办**（`unreadByMember` 的同一判据：按成员 scope、从水位之后）；
 * 2. **唤醒自己**：经成员运行时投一条通知，让新上下文**从账本拿到**待办清单
 *    —— 而不是由本工具把清单塞给它（那会让工具成为第二真相：清单是它算的，
 *    而运行时看到的账本可能已经又变了几条）。
 *    通知正文里给出的 `count` / `newestSequence` 是**渲染给模型看的摘要**，
 *    权威清单仍以账本为准。
 * 3. **如实回报**：清单、水位、以及「哪些东西不在账本里」。
 *
 * ## ⚠ 三条边界（如实标注，不假装做到）
 *
 * 1. **checkpoint 不是可查询的落点**（`SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint`）：
 *    契约里没有 checkpoint 事件，本工具也不发明一个。续接能力来自账本，不来自快照。
 * 2. **不切换运行时上下文**：真正的 rollover（丢弃旧上下文、开新对话）
 *    是**宿主**的事（`context-continuity` 引擎的职责，见 `docs/DEVELOPMENT.md:111`）。
 *    本工具在交接点上把待办送达，**不假装自己换了上下文**。
 * 3. **水位由调用方给**（`sinceSequence`）：它是宿主的游标，本包不存储它
 *    （`UnreadInput.sinceSequence` 的说明）。省略时按 `0` 处理 ——
 *    即「这个成员的全部相关事件」，那是**保守**的一侧（宁可多报几条，不可漏报）。
 *
 * @module @sophia/core/tools/rollover
 */

import type { MemberId } from '../types/ids.ts'
import type { MemberNotice, MemberWakeOutcome } from '../runtime/member-runtime.ts'
import type { MemberUnread } from '../projection/index.ts'
import {
  SOPHIA_TOOL_CONTRACT_GAPS,
  sophiaToolDescriptor,
  type SophiaToolDefinition,
  type SophiaToolDescriptor,
  type SophiaToolsDeps,
} from './types.ts'
import {
  asUncheckedRecord,
  describeError,
  isNonNegativeSafeInteger,
  isNonEmptyString,
  renderValueForMessage,
  unreachableOutcome,
  narrowTrimmedString,
} from './internal.ts'

/** `sophia_context_rollover` 的入参（类型层的期望形状）。 */
export interface ContextRolloverInput {
  /**
   * 要接力的成员；省略 = 自己。
   *
   * 给**别人**做接力是允许的（宿主在重启后重建多个成员时需要），
   * 但它**要求调用者与被接力者是同一个团的成员** —— 见 `not-same-team` 分支：
   * 这条门不是为了权限（账本本来就是按 scope 读的），而是为了防止
   * 「把一条唤醒通知投到别的团的成员身上」（那正是 FR-7.2 要挡的跨界动作）。
   */
  readonly memberId?: MemberId
  /**
   * 读水位：只交接序号**严格大于**它的事件。
   *
   * 省略按 `0`（= 全部相关事件）。水位是**你的**游标，本包不存储它
   * （见 `UnreadInput.sinceSequence`：账本里没有「已读」记录，本包也刻意不发明）。
   */
  readonly sinceSequence?: number
}

export type ContextRolloverOutcome =
  | {
      readonly kind: 'handed-over'
      readonly memberId: MemberId
      /** 待办**条数**（与 `unreadByMember` 同一判据：成员 scope + 水位之后）。 */
      readonly count: number
      /** 其中最新一条的序号；一条都没有时为 `null`（**不要**用 0 表示「无」）。 */
      readonly newestSequence: number | null
      readonly sinceSequence: number
      /**
       * 唤醒结果。**本分支下恒为 `'delivered'`** —— 其余取值走 `wake-not-delivered`
       * （见那里对「读到了」与「送到了」为何必须分开的说明）。
       */
      /**
       * 唤醒结果。**本分支下只会是 `'delivered'` 或 `'duplicate'`** ——
       * 前者是真投递，后者是「同一批待办此前已推送过」（幂等命中，交接事实上已完成）。
       * 其余取值走 `wake-not-delivered`。
       */
      readonly wake: 'delivered' | 'duplicate'
      readonly gaps: readonly string[]
    }
  /** 没有待办：**仍算成功**（接力完成），只是没有任何东西需要交接。 */
  | {
      readonly kind: 'nothing-pending'
      readonly memberId: MemberId
      readonly sinceSequence: number
      readonly gaps: readonly string[]
    }
  /**
   * 待办**算出来了**，但唤醒**没送到**（OCR 复核 MEDIUM [8]）。
   *
   * 与 `handed-over` **必须分开**：前者是「读取成功且投递成功」，这里是「读取成功、
   * 投递失败」。合成一个 `kind` 会让 `no-handle`（该成员此刻没有活句柄）/
   * `not-active`（已挂起）/ `delivery-failed` 全部显示成**接力完成**，
   * 而调用方正是靠这个结果决定「要不要为新上下文开一个 turn」——
   * 它会以为已经交接完而不再唤醒，那个成员就再也不会被唤醒。
   * `count` / `newestSequence` 一并带出，便于调用方决定重试时机。
   */
  | {
      readonly kind: 'wake-not-delivered'
      readonly memberId: MemberId
      readonly count: number
      readonly newestSequence: number
      readonly sinceSequence: number
      readonly wake: MemberWakeOutcome['kind']
      /**
       * 唤醒失败的**成因原文**（该分支带 `reason` 时为它的文本，否则 `null`）。
       *
       * OCR 复核 MEDIUM [21][22]：初版只把它写进日志，于是「运行时正常返回
       * `delivery-failed`」与「接线被改坏了」在结果上**完全同形**，调用方无从分辨。
       */
      readonly wakeReason: string | null
      readonly gaps: readonly string[]
    }
  | { readonly kind: 'invalid-input'; readonly reason: string }
  /** 被接力的成员不属于调用者所在的团（含「自己与 caller.teamId 对不上」的接线错位）。 */
  | { readonly kind: 'not-same-team'; readonly reason: string }
  /** 账本里没有这个成员（含「连自己都不在账本里」的接线错位）。 */
  | { readonly kind: 'unknown-member'; readonly reason: string }
  /**
   * 失败分支。**同样带 `gaps`**（OCR 复核 LOW [14]）：契约缺口的存在与否
   * 与「这次调用成不成功」无关，漏报会让统一 `gaps.join()` 的调用方在
   * **最需要诊断上下文的时候**（接力失败）拿到 `undefined`。
   */
  | { readonly kind: 'failed'; readonly reason: string; readonly gaps?: readonly string[] }

function invalid(reason: string): ContextRolloverOutcome {
  return { kind: 'invalid-input', reason }
}

/**
 * 收窄入参。
 *
 * `sinceSequence` 用 `isNonNegativeSafeInteger` 而不是 `Number.isFinite`：
 * 水位会被直接传进 `Ledger.read({ afterSequence })`，而那里的 `normalizeAfterSequence`
 * 对非安全整数**抛 `RangeError`**（`src/ledger.ts:504-514`）。
 * 在入口就判掉，可以让失败带上**正确字段名**，而不是一个从账本深处冒出来的 RangeError。
 */
function narrowInput(input: unknown): ContextRolloverInput | ContextRolloverOutcome {
  const raw = asUncheckedRecord(input)
  // 字符串字段一律「先校验、再裁剪」（见 internal.ts 的 narrowTrimmedString）。
  const memberId = narrowTrimmedString(raw, 'memberId')
  if (!memberId.ok) return invalid(memberId.reason)
  const sinceSequence = raw['sinceSequence']
  if (sinceSequence !== undefined && !isNonNegativeSafeInteger(sinceSequence)) {
    return invalid(
      '参数 sinceSequence 必须是 ≥0 的安全整数（它是你的读水位，只交接序号严格大于它的事件），'
      + `收到 ${renderValueForMessage(sinceSequence)}。`,
    )
  }
  return {
    ...(memberId.value === undefined ? {} : { memberId: memberId.value as MemberId }),
    ...(sinceSequence === undefined ? {} : { sinceSequence }),
  }
}

/**
 * 构造 `sophia_context_rollover`。
 *
 * @param deps - 工具集依赖（宿主唯一接线点，见 `SophiaToolsDeps`）。
 */
export function createContextRolloverTool(deps: SophiaToolsDeps): SophiaToolDescriptor {
  const definition: SophiaToolDefinition<ContextRolloverInput, ContextRolloverOutcome> = {
    name: 'sophia_context_rollover',
    description:
      '上下文接力：读回「你还没处理完的账本事实」，唤醒目标成员并让它从账本继续。'
      + '待办事项本来就是账本事实的函数（不是内存状态），所以换上下文 / 重启都不会丢；'
      + '本工具做的是读取与交接，**不写账本**（rollover 不是一条协作事实）。'
      + '不给 sinceSequence 时按 0 处理（= 全部相关事件，保守的一侧）。',
    parameters: {
      memberId: {
        type: 'string',
        description: '要接力的成员 ID；省略 = 自己。只能接力本团成员。',
      },
      sinceSequence: {
        type: 'number',
        description:
          '读水位：只交接序号严格大于它的事件。省略按 0 处理（全部相关事件）。'
          + '水位是调用方的游标，本包不存储它。',
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
          enum: ['handed-over', 'nothing-pending', 'wake-not-delivered', 'not-same-team', 'unknown-member', 'invalid-input', 'failed'],
          description: '结果分支。handed-over = 读取成功且投递成功（duplicate 也算成功：同批待办此前的投递已到达）。',
        },
        memberId: { type: 'string', description: '被接力的成员 id。' },
        count: { type: 'number', description: '待办条数。' },
        newestSequence: { type: 'json', description: 'number | null —— 待办里的最新账本序号；无待办时为 null。' },
        sinceSequence: { type: 'number', description: '本次使用的水位（宿主的游标）。' },
        wake: { type: 'string', description: '运行时的唤醒结果（delivered / duplicate / no-handle / not-active / …）。' },
        wakeReason: { type: 'json', description: 'string | null —— 唤醒失败的成因原文；无则 null。' },
        gaps: { type: 'array', items: { type: 'string' }, description: '本次踩到的契约缺口。' },
        reason: { type: 'string', description: '拒绝 / 失败的可读原因。' },
      },
    },
    render: (outcome) => {
      switch (outcome.kind) {
        case 'handed-over':
          return (
            `已接力 ${outcome.memberId}：待办 ${String(outcome.count)} 条`
            + `（最新序号 ${outcome.newestSequence === null ? '无' : String(outcome.newestSequence)}，`
            + `水位 ${String(outcome.sinceSequence)}），唤醒结果 ${outcome.wake}。`
            + outcome.gaps.join(' ')
          )
        case 'nothing-pending':
          // `gaps` 在本分支也要带出（OCR 复核 LOW [10]）：契约缺口的存在与否
          // 与「有没有待办」无关，漏报会让调用方以为这条路径没有缺口。
          return `已接力 ${outcome.memberId}：水位 ${String(outcome.sinceSequence)} 之后没有待办，无需交接。`
            + outcome.gaps.join(' ')
        case 'wake-not-delivered': {
          // ⚠ **不得**用一份固定的原因清单（OCR 复核 HIGH [5]，真实缺陷）。
          // 初版把 `wake` 一律渲染成「该成员此刻没有活句柄 / 已挂起 / 投递失败」，
          // 而可达的取值有 9 个（见 `MemberWakeOutcome`）——**最要紧的那个恰好被说错**：
          // `duplicate` 表示「同签名的待办已经送达过、运行时**主动抑制**了这次重复投递」，
          // 即交接**实际上是成功的**；而那句文案却让调用方「先把它激活再重新接力」。
          // 调用方的重建流程正是靠这个结果分支的，错的指引会让它去做无用的动作。
          // ⇒ 现在按 `wake` **逐个**给出成因，并对 `duplicate` 明确说「已送达过、无需重试」。
          const cause: Record<MemberWakeOutcome['kind'], string> = {
            delivered: '（不可能出现在本分支）已送达。',
            duplicate:
              '同签名的待办此前**已经送达过**（运行时主动抑制了这次重复投递）——'
              + '接力事实上已经完成，**无需重试**，也不必再激活该成员。'
              + '若你认为待办已经变化，请确认 newestSequence 是否真的变了。',
            'nothing-pending': '通知被判定为「没有待办」，因此没有投递。',
            'no-handle': '该成员此刻**没有活句柄**（未激活 / 已挂起 / 句柄丢失），无法投递。',
            'not-active': '该成员的**生命周期不是 active**（已挂起 / 归档 / 销毁），运行时拒绝唤醒。',
            'lifecycle-read-failed': '读该成员的生命周期时失败（账本投影抛错），运行时保守拒绝唤醒。',
            'invalid-notice': '待办事实的形状非法，被运行时的守卫拒绝（不会投递）。',
            'delivery-failed': '投递时 Agent 抛错（运行时已隔离，但这次通知没能送达）。',
          }
          return (
            `待办已算出（${String(outcome.count)} 条，最新序号 ${String(outcome.newestSequence)}，`
            + `水位 ${String(outcome.sinceSequence)}），但**唤醒未送达**：${outcome.wake} —— `
            + `${cause[outcome.wake]}`
            // 成因原文（若有）原样带出：它是排查接线问题**唯一**的线索。
            + (outcome.wakeReason === null ? '' : ` 原始原因：${outcome.wakeReason}`)
            + '（待办本身是账本派生的，不会因此丢失；重新接力即可。）'
            + outcome.gaps.join(' ')
          )
        }
        case 'invalid-input':
        case 'not-same-team':
        case 'unknown-member':
        case 'failed':
          // [9] 失败分支也要把 `gaps` 渲染出来 —— 否则它即便被带出也不可见，
          // 调用方在**最需要契约缺口上下文**（接力失败）时依然拿不到。
          return `接力未完成（${outcome.kind}）：${outcome.reason}`
            + ((outcome.kind === 'failed' && outcome.gaps !== undefined) ? outcome.gaps.join(' ') : '')
        default:
          return unreachableOutcome(outcome)
      }
    },
    execute(input: unknown): ContextRolloverOutcome {
      const narrowed = narrowInput(input)
      if ('kind' in narrowed) return narrowed

      // ⚠ OCR HIGH [第七轮]：与 task-claim/switch-model 同构的 caller fail-closed
      // 前置 —— deps.caller 是**宿主接线**（非模型输入）：绑成 null/undefined 时
      // 直接解引用会让 TypeError 穿出 execute（破坏本文件「只返回错误、绝不抛」
      // 契约）；空白 memberId 会静默成为 target（下面 `?? deps.caller.memberId`）。
      const rawCallerId = deps.caller === null || deps.caller === undefined ? undefined : deps.caller.memberId
      const rawCallerTeam = deps.caller === null || deps.caller === undefined ? undefined : deps.caller.teamId
      if (!isNonEmptyString(rawCallerId) || !isNonEmptyString(rawCallerTeam)) {
        return {
          kind: 'failed',
          reason:
            `调用者身份不可用（memberId=${renderValueForMessage(rawCallerId)}, teamId=${renderValueForMessage(rawCallerTeam)}）—— `
            + '工具集 caller 必须是非空白接线；空身份会静默成为接力目标，故 fail-closed。',
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }
      // OCR HIGH [第八轮]：带空白的绑定同样拒绝 —— padded teamId 永不等于
      // 投影规范值 ⇒ 同团门会给出误导性 not-same-team（先修接线，不裁剪将就）。
      if (rawCallerId !== rawCallerId.trim() || rawCallerTeam !== rawCallerTeam.trim()) {
        return {
          kind: 'failed',
          reason:
            '调用者身份带首尾空白 —— 宿主接线必须给出裁剪规范值（fail-closed，先修接线）。',
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }

      const target = narrowed.memberId ?? deps.caller.memberId
      const sinceSequence = narrowed.sinceSequence ?? 0

      // ── 1. 跨团门：不许把唤醒通知投到别人的团 ──
      // 账本读取本身是按 scope 的（读别人的也不会泄露团外数据），这道门挡的是**动作**：
      // 唤醒一个不是同团的成员是跨界调度（FR-7.2 的隔离口径）。
      //
      // ⚠ **自己那一支也要过账本校验**（OCR 复核 MEDIUM [7] 的真实缺陷）。
      // 初版写的是 `if (target !== deps.caller.memberId) { …校验… }` ——
      // 于是「接力自己」这条路径**完全跳过**了 `teamOf` 校验。当接线错位
      //（宿主给成员 M 绑的工具集里 `caller.teamId` 记的是别的团，或该 memberId
      //  根本不在账本里）时，那条豁免会让它**静默**地继续唤醒，
      // 而错误接线本身没有任何可观测的迹象。
      // ⇒ 现在**不区分自己与他人**：一律解析 `teamOf(target)` 并要求它等于 `caller.teamId`。
      // 自己那一支同样会命中（正常接线下 `teamOf(self)` 就是 `caller.teamId`），
      // 而接线错位时会 fail-closed 地拒绝 —— 这正是我们要的。
      let targetTeam: string | null
      try {
        targetTeam = deps.projection.teamOf(target)
      } catch (error) {
        return {
          kind: 'failed',
          reason: `读被接力成员的所属团时抛错：${describeError(error)}`,
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }
      if (targetTeam === null) {
        // ⚠ 措辞**不得**断言「账本里没有这个成员」（OCR 复核 MEDIUM [12]，真实缺陷）。
        //
        // `SophiaProjectionPorts.teamOf` 的契约只说「返回所属团，取不到为 `null`」——
        // 而 `null` 至少覆盖**两种**完全不同的情况（复核的实际观察，属实）：
        // 1. 账本里**从来没有**这个成员；
        // 2. 成员**存在**，但已挂起/归档/销毁，因此没有团队归属条目。
        // 初版把两者都写成「账本里没有成员 X……这是一处接线错位」——对情况 2 是**假话**，
        // 会把调用方推去找一个并不存在的接线问题（而这正是本文件在别处极力避免的那类误导）。
        //
        // ⇒ 如实陈述「拿不到团队归属」这个**实际观察到的事实**，并把两种成因都列出来；
        // 同时把它登记为**端口契约缺口**（`teamOf` 无法区分「没有此人」与「此人已无团」），
        // 而不是在本层补一个 `memberExistsOf` 端口 —— 那是投影层的形状，不该由工具层发明
        //（SPEC §11 的「宁可如实留白」）。
        return {
          kind: 'unknown-member',
          reason:
            `读不到成员 ${target} 的团队归属（\`teamOf\` 返回 null），无法确认它是否与你同团，故拒绝接力（fail-closed）。`
            + '注意这个返回值**有两种可能成因**：该成员从未出现在账本里，'
            + `或它存在但已挂起/归档/销毁因而没有团队条目`
            + `${target === deps.caller.memberId ? '；由于目标就是你自己，第二种成因意味着工具集的接线与账本不一致' : ''}。`
            + `${SOPHIA_TOOL_CONTRACT_GAPS.memberTeamOfAmbiguity}`,
        }
      }
      if (targetTeam !== deps.caller.teamId) {
        return {
          kind: 'not-same-team',
          reason:
            `成员 ${target} 属于团 ${targetTeam}，而你的工具集绑定的是团 ${deps.caller.teamId}`
            + `${target === deps.caller.memberId ? '（连你自己都对不上 —— 这是一处**接线错位**，请检查宿主构造工具集时的 caller.teamId）' : ''}`
            + '。跨团接力会向别的团的成员投唤醒通知，属于跨团调度，一律拒绝。',
        }
      }

      // ── 2. 读待办（与 unreadByMember 同一判据；本工具**不自己实现**计数）──
      let unread: MemberUnread
      try {
        unread = deps.projection.unreadOf(target, sinceSequence)
      } catch (error) {
        return {
          kind: 'failed',
          reason: `读待办清单时抛错：${describeError(error)}`,
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }

      const gaps: readonly string[] = [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint]

      // ── 3. 无待办：接力**成功**但没有东西要交接 ──
      // 不复用 `handed-over` 且 `count: 0`：那会让「没有任何待办」与
      // 「有待办但全是 0 条」在结果上同形，而调用方（宿主的重建流程）
      // 常常要根据它决定「要不要为新上下文开一个 turn」—— 那是两种不同的动作。
      if (unread.count === 0) {
        return { kind: 'nothing-pending', memberId: target, sinceSequence, gaps }
      }

      // ── 4. 唤醒：清单**不塞进通知正文**（理由见文件头第 2 条）──
      //
      // ⚠ `ref` 的取法与文件头注释**必须一致**（OCR 复核 LOW [18] 指出初版注释与代码不符）。
      // 去重签名是 `(ref, revision, unreadCount, newestSequence)`（`noticeSignatureOf`），
      // 而本工具**每次只投一条待办**，因此「同一批待办重复接力」的去重实际由
      // **后三个数**承担（`revision`/`unreadCount`/`newestSequence` 一起标识这一批）。
      // `ref` 只需在**同一成员内唯一且稳定**即可（这里用 `rollover:<memberId>`，
      // 别的工具不会产生同形 ref）。写清楚是为了不让后来者误以为唯一性由 ref 承担。
      //
      // ⚠ `newestSequence` **不得**把 `null` 归一成 0（OCR 复核 MEDIUM [9]）：
      // `MemberUnread.newestSequence` 的契约明确写着「一条都没有时为 null，
      // **不要**用 0 表示『无』」。而 `MemberPendingItem` 的这个字段是 `number`，
      // 装不下 `null`。两者冲突时**不能擅自用 0 圆过去**：0 是一个**比任何真实序号都小**的
      // 合法序号，「无」与「序号 0」会因此同形。
      // 走到这里 `count > 0`，故 `newestSequence` 按契约**必然非 null** ——
      // 这里显式判它，取不到就**如实判失败**（而不是编一个 0 写进通知）。
      const newest = unread.newestSequence
      // [15] 形状校验：`unreadOf` 是**注入端口**，而 `MemberPendingItem.newestSequence`
      // 的契约是非负安全整数（`member-runtime.ts` 的 `isPendingItem` 会按此校验，
      // 不符则运行时返回 `invalid-notice`）。本工具不该把**已知结构非法**的通知投出去 ——
      // 那会把一个「端口实现不符契约」的问题伪装成「运行时拒绝了通知」。
      // [10] `count` 也要校验（与 `newest` **对称**）：`unreadOf` 是注入端口，
      // `unreadCount` 的契约是非负安全整数。只校验一半会制造**假象的失败归因** ——
      // `count = -1` 带着合法 `newest` 溜过去，运行时回 `invalid-notice`，
      // 于是「端口不符契约」被伪装成「运行时拒绝了通知」。
      if (!Number.isSafeInteger(unread.count) || unread.count < 0) {
        return {
          kind: 'failed',
          reason:
            `投影给出的待办计数不是非负安全整数（收到 ${renderValueForMessage(unread.count)}）—— `
            + 'unreadOf 的实现与契约不符；拒绝把结构非法的通知投给运行时。',
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }
      if (newest !== null && (!Number.isSafeInteger(newest) || newest < 0)) {
        return {
          kind: 'failed',
          reason:
            `投影给出的最新序号不是非负安全整数（收到 ${renderValueForMessage(newest)}）—— `
            + 'unreadOf 的实现与契约不符；拒绝把结构非法的通知投给运行时。',
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }
      if (newest === null) {
        return {
          kind: 'failed',
          reason:
            `待办计数为 ${String(unread.count)} 条，但投影没给出最新序号（newestSequence=null）—— `
            + '两者按 `unreadByMember` 的契约不可能同时成立，说明注入的 unreadOf 实现与契约不符。'
            + '这里拒绝编一个「0」当序号（0 是合法序号，会把「无」与「序号 0」混成同一件事）。',
          gaps: [SOPHIA_TOOL_CONTRACT_GAPS.rolloverCheckpoint],
        }
      }
      const notice: MemberNotice = {
        items: [{ ref: `rollover:${target}`, revision: newest, unreadCount: unread.count, newestSequence: newest }],
        text:
          `上下文接力：水位 ${String(sinceSequence)} 之后，与你相关的待办共有 ${String(unread.count)} 条`
          + `（最新序号 ${String(newest)}）。请从账本读取完整清单后继续；`
          + '本次接力不写账本（待办由账本派生，切换与重启都不会丢）。',
      }
      // ⚠ 与 `message.ts` 同源（OCR 复核 MEDIUM [21][22]）：
      // 三个带 `reason` 的 `MemberWakeOutcome` 分支（`delivery-failed` /
      // `lifecycle-read-failed` / `invalid-notice`）与**接线抛错**都会给出成因文本，
      // 而初版把它们**全部丢掉**（只写日志）⇒ 调用方看到的结果完全相同，
      // 无论「运行时正常返回 delivery-failed（含 Agent 的报错）」还是「接线被我改坏了」。
      // ⇒ 把成因带进结果。
      // `notify` 抛错时**不伪造** `MemberWakeOutcome`（见下面 MEDIUM [12] 的说明），
      // 用两个独立变量如实记下「接线坏了」这件事。
      let wakeOutcome: MemberWakeOutcome | null = null
      let synthesizedWakeReason: string | null = null
      try {
        const raw = deps.runtime.notify(target, notice)
        // 运行时的契约是「从不抛错 + 返回一个带 kind 的对象」，但注入实现可能返回 null
        //（review MEDIUM [15] 提的是 message.ts 的同一处；这里同源加固）。
        wakeOutcome =
          raw === null || raw === undefined || typeof raw.kind !== 'string'
            ? null
            : raw
        if (wakeOutcome === null) {
          // [10] 把**实际收到的值**带出来供诊断（与 `invalid-input` 的做法一致），
          // 而不是只给一句「返回了非 MemberWakeOutcome」。
          synthesizedWakeReason =
            `运行时 notify 返回了非 MemberWakeOutcome 的值（收到 ${renderValueForMessage(raw)}）`
        }
      } catch (error) {
        // 运行时的契约是「从不抛错」，故走到这里说明接线被改坏了。如实回报，不吞。
        const detail = describeError(error)
        deps.logger?.warn(`[sophia] sophia_context_rollover 唤醒抛错：${detail}`)
        // ⚠ **不要用 `as MemberWakeOutcome` 硬造**（OCR 复核 MEDIUM [12]）：真实的
        // `delivery-failed` 变体带 `channel: 'followup' | 'steer'`，而这里无从得知通道 ——
        // 强转会让一个形状不完整的值以合法类型流下去，将来有人按契约读 `.channel`
        // 就会拿到 `undefined`。改用**本工具自己的**合成结果（下面单独判）。
        wakeOutcome = null
        synthesizedWakeReason = `运行时 notify 抛错（接线被改坏）：${detail}`
      }
      const wake: MemberWakeOutcome['kind'] = wakeOutcome === null ? 'delivery-failed' : wakeOutcome.kind
      // 带 reason 的分支各取各的原文；不带的置 null（与 `message.ts` 的
      // `REASONED_KINDS` 同一判据）。
      //
      // ⚠ **必须校验 `.reason` 真的是非空字符串**（OCR 复核 MEDIUM [11]）：接线坏掉时
      // 那个字段可能是 `undefined`，而结果的类型声明是 `string | null` ——
      // 一个 `as` 强转正好把这种情况藏起来。
      const reasoned = wakeOutcome as { readonly reason?: unknown } | null
      const rawReason = reasoned === null ? undefined : reasoned.reason
      const wakeReason: string | null =
        synthesizedWakeReason
        ?? (typeof rawReason === 'string' && rawReason !== '' ? rawReason : null)

      // ── 5. 唤醒失败**不得**被报成「接力完成」──
      //
      // ⚠ 这是 OCR 复核 MEDIUM [8] 指出的真实缺陷：初版无论 `wake` 是什么都返回
      // `handed-over`，而 `render` 把它渲染成「已完成接力」。于是 `no-handle`
      //（该成员此刻没有活句柄）/ `not-active`（已挂起）/ `delivery-failed`
      // 全都会显示成**成功** —— 而调用方（宿主的重建流程）正是靠这个结果决定
      // 「要不要为新上下文开一个 turn」，它会以为已经交接完而不再唤醒，
      // 那个成员就**再也不会被唤醒**。
      //
      // 「待办已经算出来了」与「交接成功了」是**两件事**：前者是读取，后者是投递。
      // 只有 `delivered` 才算后者成立。
      // ⚠ `duplicate` **不算失败**（OCR 复核 HIGH [12]，真实缺陷）。
      //
      // `member-runtime.ts` 对它的定义是「**同签名已在案：这条待办已经推过，不重复打扰**」
      // —— 即交接**在上一次调用时已经成功**。而本工具只推**一条**待办，
      // 其签名 `(ref='rollover:<memberId>', revision, unreadCount, newestSequence)`
      // 在**同一批待办**下是常量 ⇒ 「同一水位上重复接力」（宿主重启后重建是很常见的场景）
      // **必然**落到这个分支。把它报成 `wake-not-delivered` 会让调用方以为没送到，
      // 于是重新激活成员并重试 —— 每次多烧一个 turn，而实际上早就送到了。
      // ⇒ `duplicate` 归入**成功**（幂等命中），只有真正没投递的才算失败。
      if (wake !== 'delivered' && wake !== 'duplicate') {
        return {
          kind: 'wake-not-delivered',
          memberId: target,
          count: unread.count,
          newestSequence: newest,
          sinceSequence,
          wake,
          wakeReason,
          gaps,
        }
      }
      return {
        kind: 'handed-over',
        memberId: target,
        count: unread.count,
        newestSequence: newest,
        sinceSequence,
        wake,
        gaps,
      }
    },
  }
  return sophiaToolDescriptor(definition)
}

