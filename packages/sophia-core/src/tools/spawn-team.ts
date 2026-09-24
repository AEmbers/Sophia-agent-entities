/**
 * `sophia_spawn_team` —— 派生持久 / 临时团（FR-5.2 / FR-5.3 / FR-5.4）。
 *
 * ## 本文件的核心纪律：**一行判定逻辑都不重写**
 *
 * 权限矩阵（FR-5.2）、两级审批（FR-5.3）、`requestId` 幂等、以及
 * 「不得绕开」（FR-5.3.4）**全部**由 `src/delegation.ts` 的 `requestSpawn` 实现。
 * 本工具只做四件事：
 *
 * 1. **收窄入参**（模型生成的 JSON 不可信）；
 * 2. **补上调用方自己知道的那一半事实**：`requesterMemberId` 与 `requesterKind` 取自
 *    闭包里的 `caller` **与账本投影**，而**不是**从参数里读（见下面的防冒充）；
 * 3. 调 `requestSpawn(deps.delegation, request)`；
 * 4. 把 `SpawnOutcome` **逐分支**翻译成模型能读懂的话。
 *
 * ## ⚠ 为什么 `requestId` 省略时由**确定性派生**而不是「生成一次并记住」
 *
 * `requestId` 是 FR-5.3.4「不得绕开」的绑定键（SPEC §5.4）。模型若每次重试都**换一个**
 * `requestId`，被否过的申请就能被无限重投（每次都当成一份新申请）——
 * 而人（或团长）刚刚否决过它。故：
 *
 * - 模型显式给出 `requestId` ⇒ 用它（并裁剪、限长，见 `SOPHIA_SPAWN_REQUEST_ID_MAX`）；
 * - 模型没给 ⇒ 由本工具从「调用者 + 目标类型 + 拟建团名 + 名册 + 任务清单」
 *   **确定性派生**（`requestIdForApplication`，对申请键做 SHA-256）。
 *   于是同一份申请无论重投多少次、**跨多少个进程**，派生的都是同一个 `requestId`
 *   ⇒ 走幂等回放，不会重复建团、不会重复推收件箱。
 *
 * ## ⚠ 本节此前描述的是一个**已被删除**的设计（OCR 复核 MEDIUM [21]）
 *
 * 初版是「生成一次并**记住**在进程内的 `Map` 里」，并如实标注了「跨进程幂等依赖模型显式给 id」。
 * 那张表已被删除，理由见 `requestIdForApplication` 的文档（HIGH [26]：计数器方案会撞 id）。
 * 派生方案同时**消掉了**那个跨进程边界 —— `requestId` 会写进账本，重启后照样查得到。
 * 旧的边界说明留在本文件里会与实现**直接矛盾**，故整段重写。
 * **本工具现在不持有任何进程内状态**（这个性质本身值得保留：它让幂等判定只依赖账本）。
 *
 * ## ⚠ 防冒充：`requesterMemberId` / `requesterKind` 不进参数
 *
 * 上游参照实现（`dsh-agent-teams/src/tools.ts:1899`）用「`args.from` 必须等于调用者身份」
 * 这条**运行期校验**防冒充。本实现把它前移成**结构性**的：调用者身份是闭包常量，
 * 参数里**没有**这个字段，模型填不出别人的身份。越权的尝试连一次调用都构造不出来。
 *
 * `requesterKind` 必须从**账本投影**读（`projection.callerKindOf`），不能由模型自报：
 * 否则一个临时团成员只要填 `requesterKind: 'persistent'` 就绕过了 FR-5.2 的第一格 ——
 * 而那正是「临时成员无权创建持久团」这条规则的全部内容。
 * 本工具**先用投影判一次**（早失败、省掉一次审批链路调用），但**仍把
 * `requesterKind` 交给 `requestSpawn` 再判一次**：真正的判定权属于 delegation
 * （单一真相），本文件那次只是镜像 —— `tests/tools.spec.ts` 有一条用例**绕过工具层**
 * 直调 `requestSpawn` 断言它自己也拦得住（证明本工具不是唯一防线）。
 *
 * @module @sophia/core/tools/spawn-team
 */

import { createHash } from 'node:crypto'

import type { MemberId, RequestId } from '../types/ids.ts'
import type { CallerKind, TeamKind, TeamSpec } from '../types/team.ts'
import { requestSpawn, type SpawnOutcome } from '../delegation.ts'
import {
  sophiaToolDescriptor,
  type SophiaToolDefinition,
  type SophiaToolDescriptor,
  type SophiaToolsDeps,
} from './types.ts'
import {
  asUncheckedRecord,
  badFieldReason,
  describeError,
  isNonEmptyString,
  narrowTrimmedString,
  renderValueForMessage,
  unreachableOutcome,
} from './internal.ts'

/** `sophia_spawn_team` 的入参（类型层的期望形状）。 */
export interface SpawnTeamInput {
  /** 目标团类型（FR-5.1）：`persistent` 走两级审批，`temporary` 免审直建。 */
  readonly targetKind: TeamKind
  /** 拟用团名（展示用，非空）。 */
  readonly name: string
  /** 拟建名册：职位 + 数量 + 可选的**初始模型**。 */
  readonly roster: readonly {
    readonly position: string
    readonly count: number
    /**
     * 该职位的**初始模型**；省略或 `null` = 跟随全局默认（`locales.ts` 的 `modelFollowDefault`）。
     *
     * ## 为什么这个字段存在（它修复的是一个**结构性**缺陷）
     *
     * 改前：`MemberAddedData` 没有 `model`，投影折叠 `member-added` 时硬写 `model: null`
     * ⇒ 新团成员**恒无模型** ⇒ `sophia_switch_model` 的 `from` 取不到
     * ⇒ **人类点「换模」第一次必然失败**（`unknown-current-model`），
     * 而全仓**没有**任何初始模型写入路径，故那个失败无法绕过。
     * ⇒ 让建团方在名册里就能指定初始模型，是这条链路上**唯一**的源头。
     *
     * ## ⚠ 省略 与 `null` 在这里**语义相同**（都=跟随全局默认）
     *
     * 与 `MemberAddedData.model` 的「必填可空」**刻意不同**：那是**账本载荷**，
     * 记录侧必须如实逐条落地（`null` 是一个要显式表态的事实）；而这里是**调用方输入**，
     * 「没指定」本身就是合法输入，逼每个调用方写 `null` 只是噪音。
     * `undefined → null` 的归一化在 `narrowRoster` 里做（那是落账前的最后一道）。
     */
    readonly model?: { readonly provider: string; readonly model: string } | null
  }[]
  /** 拟建任务标题清单。 */
  readonly tasks: readonly string[]
  /**
   * 幂等 / 审计键。**省略时由本工具确定性派生**（见 `requestIdForApplication`），
   * 因此不填也能拿到正确的幂等行为。
   *
   * ⚠ 两条纪律（OCR 复核 MEDIUM [19] 指出此前的文档会诱导模型犯错，已改写）：
   * 1. **一般不要填**。填了就意味着你放弃了「同一份申请自动同键」的保证 ——
   *    每次换一个值，等于把 FR-5.3.4 的「不得绕开」交给模型自觉。
   * 2. **不要为了绕开一次否决而换新值**。同一份申请被否后换 `targetKind` 重投，
   *    会被 `delegation.ts` 判成 `noDowngradeBypass`（FR-5.3.4）；
   *    想开临时团就要把它作为**另一份申请**（不同的目标与意图）来发起，
   *    而不是拿同一个 `requestId` 换皮。
   */
  readonly requestId?: string
}

/** 名册项与任务清单的个数上限（见 `narrowInput` 的理由）。 */
export const SOPHIA_SPAWN_ROSTER_MAX = 64
export const SOPHIA_SPAWN_TASKS_MAX = 256

/**
 * 团名长度上限（OCR 复核 LOW [17]）。
 *
 * 与 roster / tasks 的上限同源理由：`name` 会被 `delegation` 逐字落进**不可改写**的
 * 账本，超长内容一旦落盘永远留着，且每条后续读取都要把它读回来。
 * 取值 200：团名是给人看的短标签，200 已远超任何真实需要。
 */
export const SOPHIA_SPAWN_NAME_MAX = 200

/**
 * `requestId` 长度上限（OCR 复核 HIGH [18]）。
 *
 * 它是全局幂等/审计键、会被原样落进**不可改写**的账本，故与其他字段同样限长。
 * 取值 256：本工具自己派生的是 `req-` + 16 位十六进制（20 字符），
 * 256 给调用方留了充足余量，同时挡住「模型塞一整个文档当 id」。
 */
export const SOPHIA_SPAWN_REQUEST_ID_MAX = 256

/**
 * 名册项 `position` 的长度上限（OCR 复核 MEDIUM [8]）。
 *
 * `SOPHIA_SPAWN_ROSTER_MAX` 限的是**项数**，不是载荷大小 —— 一个超长 position
 * 能通过所有既有检查，然后被逐字写进**不可改写**的账本，此后每次读取都要读回来。
 * 与 `SOPHIA_SPAWN_NAME_MAX` 同一动机（都取自同一句实测理由）。
 * 取值 200：职位是给人看的短标签，200 已远超任何真实需要。
 */
export const SOPHIA_SPAWN_POSITION_MAX = 200

/**
 * 单个任务标题的长度上限（OCR 复核 MEDIUM [26]）。
 *
 * `SOPHIA_SPAWN_TASKS_MAX` 限的是**项数**，不是单条载荷大小 ——
 * 与 `position`/`name` 同源理由，故同样限长。取值 500：任务标题允许比职位长一些。
 */
export const SOPHIA_SPAWN_TASK_MAX = 500

/**
 * 名册项 `model` 里 `provider` / `model` 各自的长度上限（OCR 复核 MEDIUM [11]）。
 *
 * 与 `name`/`position`/`tasks`/`requestId` **同一条纪律**：这些字段都会被**逐字写进
 * 不可改写的账本**（经 `TeamSpec.roster[].model` → `member-added.model`），
 * 且此后**每次**读取都要把它们读回来。初版只对它们做了裁剪、没限长 ——
 * 那是漏了，不是有意放宽（同文件里其它自由文本字段全都限了）。
 * 取值 200：provider / model 名是短标识，200 已远超任何真实需要。
 */
export const SOPHIA_SPAWN_MODEL_FIELD_MAX = 200

export type SpawnTeamOutcome =
  | {
      readonly kind: 'created'
      readonly requestId: RequestId
      readonly targetKind: TeamKind
      readonly teamId: string
    }
  | {
      readonly kind: 'awaitingHumanApproval'
      readonly requestId: RequestId
      readonly targetKind: TeamKind
      readonly ticketId: string
    }
  | {
      readonly kind: 'rejectedByPrincipal'
      readonly requestId: RequestId
      readonly ticketId: string
      readonly reason: string
    }
  /** FR-5.2.1：权限矩阵拒绝（临时成员开持久团）。 */
  | {
      readonly kind: 'forbidden'
      readonly requestId: RequestId
      readonly errorCode: string
      readonly reason: string
    }
  /** FR-5.3.4：同一 `requestId` 已被否决，禁止降级绕开。 */
  | {
      readonly kind: 'noDowngradeBypass'
      readonly requestId: RequestId
      readonly ticketId: string
      readonly errorCode: string
      readonly reason: string
    }
  | { readonly kind: 'invalid-input'; readonly reason: string }
  /** 账本里认不出调用者所属团的类型（FR-5.2 的判据取不到）。 */
  | { readonly kind: 'unknown-caller'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string }

function invalid(reason: string): SpawnTeamOutcome {
  return { kind: 'invalid-input', reason }
}

function asTeamKind(value: unknown): TeamKind | null {
  return value === 'persistent' || value === 'temporary' ? value : null
}

/**
 * 收窄名册（`TeamSpec.roster`）。
 *
 * 上限（`SOPHIA_SPAWN_ROSTER_MAX` / `SOPHIA_SPAWN_TASKS_MAX`）**不是**权限门，而是
 * 「模型吐出一个 10 万项的数组」这类**形状事故**的护栏：`delegation` 会把 `spec` 原样
 * 落进账本，而账本载荷无界增长的代价是**每条**后续读取都要把它读回来。
 * 判据是量级而不是「理论上会涨」：一个有意义的团的名册是个位数到几十，
 * 64 已经远超实际需要；超过它一律判非法输入（而不是静默截断 ——
 * 截断会造出一份**看起来合法**、却与用户意图不同的团规格）。
 */
/**
 * 把名册项里的 `model` 归一成**账本载荷要求的形状**（`{provider, model} | null`）。
 *
 * ⚠ 调用点**只应有一处**（`narrowRoster` 里那次）：算出来的结果直接进 `out.push`，
 * 不要为了"再确认一次"重复调用 —— 重复调用会让「校验用的值」与「存下来的值」
 * 变成两次推导，将来任何一处加规则（例如长度上限）都会让两者分叉（OCR 复核 MEDIUM [10]）。
 *
 * ## 为什么要有这一步（三种输入 → 一种落账形状）
 *
 * | 调用方写的 | 含义 | 归一成 |
 * |---|---|---|
 * | 省略字段 | 没指定 | `null`（跟随全局默认） |
 * | 显式 `null` | 明确跟随默认 | `null` |
 * | `{provider, model}` | 指定了 | 原样（**裁剪**后） |
 *
 * 前两者在**申请侧**语义相同（所以 `TeamSpec.roster[].model` 是可选的），
 * 但落到**账本**时必须是一个显式的值 —— `MemberAddedData.model` 是**必填可空**，
 * 因为「写的人忘了」与「初始确实未知」在不可改写的账本上必须可区分。
 * 这个 `undefined → null` 的转换是**本函数唯一的存在理由**。
 *
 * ⚠ 形状不对时返回 `null` 而不报错？**不** —— 见下面 `narrowRoster` 的调用点：
 * 形状非法会在那里变成 `invalid-input`。本函数只负责**已知合法**的归一化，
 * 不做二次判定（判据只有一处，就是 `narrowRoster`）。
 */
function normalizeRosterModel(
  raw: unknown,
): { readonly provider: string; readonly model: string } | null {
  if (raw === undefined || raw === null) return null
  const record = asUncheckedRecord(raw)
  const provider = record['provider']
  const model = record['model']
  // 走到这里说明 `narrowRoster` 已经校验过形状；这里只是取值 + 裁剪。
  // 保留 `typeof` 判定是为了让「形状守卫被绕过」时**退化成 null 而不是抛错**
  //（本包的工具契约：绝不抛）。
  if (!isNonEmptyString(provider) || !isNonEmptyString(model)) return null
  const trimmedProvider = provider.trim()
  const trimmedModel = model.trim()
  // [11] 逐字段限长（理由见 `SOPHIA_SPAWN_MODEL_FIELD_MAX`）。
  // 超长时返回 `null` 会让调用点把它读成「形状不对」⇒ 报 invalid-input，
  // 这正是我们要的（**不静默截断**：截断会在账本里留下一个调用方从未给过的值）。
  if (trimmedProvider.length > SOPHIA_SPAWN_MODEL_FIELD_MAX) return null
  if (trimmedModel.length > SOPHIA_SPAWN_MODEL_FIELD_MAX) return null
  return { provider: trimmedProvider, model: trimmedModel }
}

function narrowRoster(value: unknown): TeamSpec['roster'] | string {
  if (!Array.isArray(value)) return '名册（roster）必须是非空数组。'
  if (value.length === 0) return '名册（roster）不能为空 —— 一个没有成员的团建不出来。'
  if (value.length > SOPHIA_SPAWN_ROSTER_MAX) {
    return `名册（roster）最多 ${String(SOPHIA_SPAWN_ROSTER_MAX)} 项，收到 ${String(value.length)} 项。`
  }
  // ⚠ 局部数组的类型必须是**可变**版本（`-readonly`），因为 `TeamSpec['roster']` 是
  // `readonly {…}[]` 且字段全 `readonly` —— 直接用它当累加器会编译不过（push 被拒）。
  // 这里刻意**逐字段列出**而不是 `Partial<>`/`any`：漏写一个字段（正是本次修的
  // 「`model` 被静默丢掉」那类缺陷）会在这里变成 **TS2353/TS2741**，而不是运行时静默。
  const out: {
    position: string
    count: number
    model: { readonly provider: string; readonly model: string } | null
  }[] = []
  for (const [index, entry] of value.entries()) {
    const item = asUncheckedRecord(entry)
    const position = item['position']
    if (!isNonEmptyString(position)) {
      return `名册第 ${String(index + 1)} 项的 position 必须是非空字符串（收到 ${renderValueForMessage(position)}）。`
    }
    const count = item['count']
    // 至少 1：`count: 0` 造出一个「名册里有这位职位、却一个都不建」的歧义规格。
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
      return `名册第 ${String(index + 1)} 项的 count 必须是 ≥1 的安全整数（收到 ${renderValueForMessage(count)}）。`
    }
    // [13] **必须裁剪**：`'灵台郎'` 与 `' 灵台郎 '` 不裁剪就是两个不同的职位，
    // 且申请键取自这些原值 ⇒ 空白变体会派生出**另一个 requestId**，被当成一份全新申请
    //（重复建团 / 重复推收件箱）。它们都会原样落进不可改写的账本。
    // 与 `name`/`requestId` 走同一条「先校验、再裁剪」纪律。
    const trimmedPosition = position.trim()
    // [8] **逐项**长度上限（OCR 复核 MEDIUM [8]，真实缺陷）。
    // `SOPHIA_SPAWN_ROSTER_MAX` 限的是**项数**，不是载荷大小 ——
    // 一个 1MB 的 position 能通过所有既有检查，然后被逐字写进**不可改写**的账本，
    // 且此后**每一次**读取都要把它读回来。这与 `name`/`requestId` 的限长动机同源。
    if (trimmedPosition.length > SOPHIA_SPAWN_POSITION_MAX) {
      return `名册第 ${String(index + 1)} 项的 position 最多 ${String(SOPHIA_SPAWN_POSITION_MAX)} 个字符，`
        + `收到 ${String(trimmedPosition.length)} 个（它会原样落进不可改写的账本）。`
    }
    // ── 初始模型（可选）：形状非法必须**报错**，不能静默退化成 `null` ──
    //
    // ⚠ 这里刻意**不用**「形状不对就当没给」的宽松处置：那会让调用方的拼写错误
    //（`provider` 写成 `providerId`）静默变成「跟随全局默认」，而调用方以为自己指定了 ——
    // 成员于是**没有**初始模型、换模第一次失败，且**没有任何迹象**指向那个拼写错误。
    // 与 `name`/`position` 同一条纪律：**给了但形状不对**永远是错误，不是「没给」。
    const rawModel = item['model']
    const model = normalizeRosterModel(rawModel)
    if (rawModel !== undefined && rawModel !== null && model === null) {
      return `名册第 ${String(index + 1)} 项的 model 必须是 {provider, model} 形状的非空字符串对（收到 ${renderValueForMessage(rawModel)}）。`
    }
    // `[{position:'a',count:1},{position:'a',count:2}]` 会造出一份含糊的规格
    //（同一职位两行、数量还不一样），而 `delegation` 无从判断该按哪一行建人。
    // 项数上限挡得住体积、挡不住这种语义歧义。
    if (out.some((item) => item.position === trimmedPosition)) {
      return `名册第 ${String(index + 1)} 项的 position "${trimmedPosition}" 与前面重复 —— `
        + '同一职位只能出现一次（否则"这位职位建几个人"就有两个互相矛盾的答案）。'
    }
    // ⚠ 这里**逐字段重建**而不是透传 —— 这正是「初始模型丢了」的**运行时丢弃点**。
    //
    // 实测（captain 裁定 + 我的探针 B/C）：改前本行只带 `position`/`count`，
    // 于是即使调用方在 `roster[i].model` 里给了初始模型，它也会**在这里被丢掉**，
    // 而**编译全绿**（`spec` 那里 `roster` 是变量引用 ⇒ 无多余属性检查，TS 拦不住）。
    // 后果不是「少个字段」——是成员**又回到「换模第一次必失败」**，且构建看不出异常。
    // ⇒ `model` 必须显式带上；`undefined → null` 的归一化也在这里做
    //（见 `SpawnTeamInput.roster` 的说明：申请侧「省略」与「null」语义相同，
    //   而账本侧 `MemberAddedData.model` 是必填可空）。
    out.push({ position: trimmedPosition, count, model })
  }
  return out
}

function narrowTasks(value: unknown): readonly string[] | string {
  if (!Array.isArray(value)) return '任务清单（tasks）必须是字符串数组（可以是空数组）。'
  if (value.length > SOPHIA_SPAWN_TASKS_MAX) {
    return `任务清单（tasks）最多 ${String(SOPHIA_SPAWN_TASKS_MAX)} 项，收到 ${String(value.length)} 项。`
  }
  const out: string[] = []
  for (const [index, entry] of value.entries()) {
    if (!isNonEmptyString(entry)) {
      return `任务清单第 ${String(index + 1)} 项必须是非空字符串（收到 ${renderValueForMessage(entry)}）。`
    }
    // [13] 同 `position`：**裁剪后才参与申请键**，否则 `'编算'` 与 `'编算 '`
    // 会派生出两个不同的 requestId —— 同一件事被当成两件事（重复建团/重复推收件箱），
    // 且它们都会原样落进不可改写的账本。
    const trimmedEntry = entry.trim()
    // [26] **逐项**长度上限（OCR 复核 MEDIUM [26]）。
    // `SOPHIA_SPAWN_TASKS_MAX` 限的是**项数**；一个 1MB 的任务标题能通过所有既有检查，
    // 然后被逐字写进**不可改写**的账本并在**每次**读取时被读回来。
    // 与 `position`/`name` 的限长动机逐字相同（那两处的注释已写明这条实测理由）。
    if (trimmedEntry.length > SOPHIA_SPAWN_TASK_MAX) {
      return `任务清单第 ${String(index + 1)} 项最多 ${String(SOPHIA_SPAWN_TASK_MAX)} 个字符，`
        + `收到 ${String(trimmedEntry.length)} 个（它会原样落进不可改写的账本）。`
    }
    out.push(trimmedEntry)
  }
  return out
}

/**
 * 收窄后的申请。
 *
 * `requestId` **已裁剪 / 限长**；`undefined` 表示**省略**（含空串 / 纯空白，
 * 见 `narrowInput` 的归一化）⇒ 走确定性派生。
 *
 * ⚠ 早期这里写的是「`requestId` 一定非空」——**与类型和实际语义都不符**
 *（OCR 复核 LOW [14]）：字段类型是 `string | undefined`，而 `undefined` 是
 * 一条**正常**取值，不是"不该出现"的状态。
 */

interface NarrowedSpawnTeamInput {
  readonly targetKind: TeamKind
  readonly name: string
  readonly roster: TeamSpec['roster']
  readonly tasks: readonly string[]
  readonly requestId: string | undefined
}

function narrowInput(input: unknown): NarrowedSpawnTeamInput | SpawnTeamOutcome {
  const raw = asUncheckedRecord(input)

  const targetKind = asTeamKind(raw['targetKind'])
  if (targetKind === null) {
    return invalid(
      raw['targetKind'] === undefined
        ? '缺少必填参数 targetKind（必须是 "persistent" 或 "temporary"）。'
        : badFieldReason('targetKind', '"persistent" 或 "temporary"', raw['targetKind']),
    )
  }
  // [17] `name` 同样必须「先校验、再裁剪」，并加上长度上限：
  // 不裁剪会让 `' LingTai '` 原样写进 TeamSpec 落账，造成「同名团因不可见空白而不相等」；
  // 无上限则一个超长团名会被 delegation 逐字落账，而**每条**后续读取都要把它读回来
  //（与 roster/tasks 上限的理由同源）。`isNonEmptyString` 只 reject 纯空白、不裁剪。
  const name = narrowTrimmedString(raw, 'name')
  if (!name.ok) return invalid(name.reason)
  if (name.value === undefined) return invalid('缺少必填参数 name（拟用团名，非空白字符串）。')
  if (name.value.length > SOPHIA_SPAWN_NAME_MAX) {
    return invalid(
      `参数 name 最多 ${String(SOPHIA_SPAWN_NAME_MAX)} 个字符（它会原样落进不可改写的账本），`
      + `收到 ${String(name.value.length)} 个字符。`,
    )
  }
  const roster = narrowRoster(raw['roster'])
  if (typeof roster === 'string') return invalid(roster)
  const tasks = narrowTasks(raw['tasks'])
  if (typeof tasks === 'string') return invalid(tasks)

  // ⚠ `requestId` 也必须裁剪 + 限长（OCR 复核 HIGH [18]，真实缺陷）。
  //
  // 它是**全局幂等/审计键**，却被当成「只要非空字符串就行」放行，而本文件上面
  // 刚给 name/roster/tasks 都加了上限。两个后果：
  // 1. 不裁剪 ⇒ `' req-abc'` 与 `'req-abc'` 成了**两个不同的幂等键**
  //    —— 这正是 FR-5.3.4「不得绕开」的逃逸窗口，一个不可见字符就能打开它；
  // 2. 无上限 ⇒ 模型可以塞一个超长 id，而它会**原样落进不可改写的账本**。
  // ⚠ `''` 与纯空白必须视作**省略**（OCR 复核 MEDIUM [23]，真实缺陷）。
  //
  // `narrowTrimmedString` 把空串映射成 `missingFieldReason`，于是传 `requestId: ""` 的模型
  // 收到「缺少必填参数 requestId」—— 而 `requestId` 是**可选**的，那句文案是假话，
  // 还会逼模型去编一个非空 id（正是本文件文档叫它别做的事）。
  // ⇒ 先判「空/纯空白」，把它们归一成 `undefined`（= 没给），再走正常校验。
  // 这样既保住类型收窄，也让「空 ⇒ 走确定性派生」这条语义显式。
  const rawRequestId = raw['requestId']
  const requestIdIsBlank = typeof rawRequestId === 'string' && rawRequestId.trim() === ''
  const requestIdNarrowed = requestIdIsBlank
    ? { ok: true as const, value: undefined }
    : narrowTrimmedString(raw, 'requestId')
  if (!requestIdNarrowed.ok) return invalid(requestIdNarrowed.reason)
  // 收窄成 `string | undefined` 的**局部常量**：这样下面的 `.length` 与 `requestId.value`
  // 都在同一个已收窄的类型下，不会像中间态那样报 TS2339。
  const requestId: string | undefined = requestIdNarrowed.value
  if (requestId !== undefined && requestId.length > SOPHIA_SPAWN_REQUEST_ID_MAX) {
    return invalid(
      `参数 requestId 最多 ${String(SOPHIA_SPAWN_REQUEST_ID_MAX)} 个字符（它是全局幂等/审计键，会被原样落账），`
      + `收到 ${String(requestId.length)} 个字符。`,
    )
  }

  return {
    targetKind,
    name: name.value,
    roster,
    tasks,
    requestId,
  }
}

/**
 * 给「同一份申请」算一个稳定的键（模型没给 `requestId` 时用）。
 *
 * 全部字段都参与：只按团名去重会让「同名但名册不同」的两份申请互相冒充
 * （第二份拿到第一份的结论 —— 而它们要建的是两个不同的团）。
 * 名册按 `position` **排序**后再拼：`foldLedgerEvents` 与运行时的去重都吃过
 * 「枚举顺序变了就当成新事实」的亏（t2 的 `noticeSignatureOf` 有专门注释），
 * 这里同一份名册换个书写顺序仍然是同一次申请。
 *
 * `callerMemberId` 是键的第一项，**必须**在：见 `requestIdForApplication` 对
 * 「两个成员撞 id」那条真实缺陷的说明。
 *
 * ## ⚠ 名册项**逐项放进数组**，绝不手工拼接（OCR 复核 MEDIUM [20]，真实缺陷）
 *
 * 初版把名册拼成一个字符串：`roster.map(e => \`${e.position}x${e.count}\`).sort().join(',')`。
 * `position` 是**模型可控的自由文本**，而 `,` 与 `x` 都没有转义 ⇒
 * 两份**语义完全不同**的名册会算出同一个键。实测复现：
 *
 * | 名册 | 拼出来 |
 * |---|---|
 * | `[{position:'ax1,b', count:1}]`（**一个**职位） | `ax1,bx1` |
 * | `[{position:'a',count:1},{position:'b',count:1}]`（**两个**职位） | `ax1,bx1` |
 *
 * 两者同键 ⇒ 共享同一个 `requestId` ⇒ 第二份被当成第一份的幂等回放，
 * **建不出自己的团**（拿到对方的 `teamId` / 票据），且没有任何报错。
 * 这与 [26] 那条 HIGH 是**同一类**缺陷（幂等键不唯一），只是一个来自计数器、
 * 一个来自分隔符歧义。
 *
 * ⇒ 修法：让 `JSON.stringify` 去管边界，即名册项各自作为**数组元素**（嵌套数组），
 * 由 `JSON.stringify` 逐层加引号与分隔符 —— 转义由它负责，没有任何手工拼接。
 * 这样「不同输入 ⇒ 不同键」是**结构性**的，不依赖 `position` 里不出现某个字符。
 */
function applicationKeyOf(callerMemberId: string, input: NarrowedSpawnTeamInput): string {
  const roster = [...input.roster]
    // ⚠ OCR HIGH [21]：`model` 必须参与幂等键 —— 两份申请若**只差初始模型**，
    //   旧键会把它们算成同一次申请（后者被静默当成前者的重放，不建自己的团）。
    //   嵌套对象交给 `JSON.stringify` 管边界，与上面的裁定同源。
    .map((entry) => [entry.position, entry.count, entry.model ?? null] as const)
    // OCR LOW [第六轮]：嵌套三元（style 明禁）改 if/else 扁平 ——
    // 先比 position，再比 count（narrowRoster 已拒重复 position，count 兜底仍保留）。
    .sort((left, right) => {
      if (left[0] !== right[0]) return left[0] < right[0] ? -1 : 1
      return left[1] - right[1]
    })
  return JSON.stringify([
    callerMemberId,
    input.targetKind,
    input.name,
    roster,
    input.tasks,
  ])
}

/**
 * 由申请键**确定性地**派生 `requestId`。
 *
 * ## ⚠ 这里曾是一个真实缺陷（OCR 复核 HIGH [26]，已实测复现）
 *
 * 初版是「实例内计数器 + 键长度」：`req-${counter}-${key.length.toString(16)}`。
 * 它**不是全局唯一**的，而 `delegation.ts` 把 `requestId` 当作**全局**幂等键使用 ——
 * `state.decided` 只按 `requestId` 索引（`delegation.ts:808`），
 * `findTeamCreatedFor` / `collectSpawnEvents` 也**只**按 `requestId` 扫（`:394` / `:440`）。
 *
 * 后果不是「id 不好看」，而是**跨成员串味**：本工具集按成员各建一份
 *（见 `createSophiaTools` 的文档），于是每个成员的实例计数器都从 0 开始；
 * 两个成员 id 等长时（**同形 id 是常态**，如 `sophia-lingtai-lang-aaaa1111`）
 * 他们的第一份申请会算出**同一个** id。实测（`node` 内联复现）：
 * `sophia-lingtai-lang-aaaa1111` 与 `…-bbbb2222` 对同一份规格都得到 `req-1-40`。
 * ⇒ 成员 B 的派生会命中成员 A 已落的结论（包括 `created` 且返回 **A 的 teamId**）。
 *
 * ## 修法：把「唯一性」变成**结构性**的，而不是靠一个共享计数器
 *
 * 对整份申请键做 SHA-256 取前 16 位十六进制。于是：
 * - **不同**申请 ⇒ id 不同（哈希抗碰撞；且 `callerMemberId` 已在键里，跨成员天然分开）；
 * - **同一份**申请 ⇒ id 相同（确定性），这正是幂等回放需要的；
 * - **不需要**任何进程内计数器或缓存表 —— 初版那张 `Map` 随之删掉：
 *   它本来只是为了「同一份申请复用同一个 id」，而确定性派生已经把这件事做成结构性质。
 *   **少一处共享可变状态，就少一处可以出错的共享可变状态**（本包多处同源取舍）。
 *
 * ⚠ 注意这不改变 `requestId` 的**权威性**归属：跨进程幂等仍以账本为准
 *（`runApprovalPath` 开头那次 `collectSpawnEvents`）。哈希只保证「本工具不会为两份
 * 不同的申请生成同一个 id」，不保证「调用方显式给出的 id 一定不撞」——
 * 后者是调用方的责任，模型显式给 id 时应给一个真正唯一的审计键。
 */
function requestIdForApplication(callerMemberId: string, input: NarrowedSpawnTeamInput): RequestId {
  const digest = createHash('sha256').update(applicationKeyOf(callerMemberId, input)).digest('hex')
  return `req-${digest.slice(0, 16)}` as RequestId
}

/**
 * 构造 `sophia_spawn_team`。
 *
 * @param deps - 工具集依赖（宿主唯一接线点，见 `SophiaToolsDeps`）。
 */
export function createSpawnTeamTool(deps: SophiaToolsDeps): SophiaToolDescriptor {
  // 本工具**不再持有任何进程内状态**（OCR 复核 HIGH [26] 的修法）：
  // 初版有一张「申请键 → requestId」的 Map，但 requestIdForApplication 改成
  // 确定性派生（对申请键做 SHA-256）之后，那张表就是一处可能与派生结果分叉的
  // 共享可变状态 —— 分叉的表现正是 FR-5.3.4 的绕开窗口。故整块删除。

  const definition: SophiaToolDefinition<SpawnTeamInput, SpawnTeamOutcome> = {
    name: 'sophia_spawn_team',
    description:
      '派生一个团队：targetKind="temporary" 免审直建；targetKind="persistent" 走两级审批'
      + '（本团监正预审 → 人类收件箱批准）。权限矩阵由发起方**所属团的类型**决定：'
      + '临时团成员无权创建持久团（FR-5.2.1），会被明确拒绝。'
      + '同一份申请被否决后不得改目标类型绕开（FR-5.3.4）；'
      + '**未提供 requestId 时**本工具会为这份申请确定性复用一个幂等键，'
      + '因此重投不会被当成新申请（不会重复建团、不会重复推收件箱）。'
      + '一旦你自行填了 requestId，这份自动保证就交回给你。',
    parameters: {
      targetKind: {
        type: 'string',
        required: true,
        description: '"persistent"（持久团，需两级审批）或 "temporary"（临时团，免审直建）。',
      },
      name: { type: 'string', required: true, description: '拟用团名（展示用，非空）。' },
      roster: {
        type: 'array',
        required: true,
        description:
          `拟建名册：[{position: 职位名, count: ≥1 的整数, model?: {provider, model}}]，`
          + `最多 ${String(SOPHIA_SPAWN_ROSTER_MAX)} 项。`,
        items: {
          type: 'object',
          additionalProperties: false,
          description: '一项：职位 + 数量 +（可选）该职位的初始模型。',
          properties: {
            position: { type: 'string', required: true, description: '职位名（须在 20 个规范职位名册内）。' },
            count: { type: 'number', required: true, description: '该职位建几个（≥1）。' },
            model: {
              type: 'object',
              // ⚠ **不设 `required`**：省略 = 跟随全局默认（与显式 `null` 等价）。
              // 但一旦给了，`provider`/`model` 都必填 —— 半截的模型规格没有意义，
              // 且 `narrowRoster` 会把它判成非法输入（不是静默退化成 null）。
              description:
                '该职位的初始模型；省略 = 跟随全局默认。'
                + '给了它，成员一出生就有模型，`sophia_switch_model` 第一次就能换（from 有据可依）。',
              additionalProperties: false,
              properties: {
                provider: { type: 'string', required: true, description: 'provider 名（非空）。' },
                model: { type: 'string', required: true, description: 'model 名（非空）。' },
              },
            },
          },
        },
      },
      tasks: {
        type: 'array',
        required: true,
        description: `拟建任务标题清单（可为空数组），最多 ${String(SOPHIA_SPAWN_TASKS_MAX)} 项。`,
        items: { type: 'string', description: '一条任务标题。' },
      },
      requestId: {
        type: 'string',
        description:
          '幂等 / 审计键（可选，一般**省略**）。省略时本工具为这份申请确定性派生一个键，'
          + '因此同一份申请重投不会被当成新申请（不会重复建团、不会重复推收件箱）。'
          + '⚠ 只有在**确实要发起一份不同的申请**时才显式给一个**全新的**值。'
          + '不要为了绕开一次否决而换新 id：同一份申请被监正/人类否决后，'
          + '改目标类型重投会被 FR-5.3.4 拒绝（不得降级绕开）；'
          + '确实需要临时团时，请把它作为一份**新的、目标类型不同且意图不同**的申请来发起。',
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
          enum: ['created', 'awaitingHumanApproval', 'rejectedByPrincipal', 'forbidden', 'noDowngradeBypass', 'unknown-caller', 'invalid-input', 'failed'],
          description: '结果分支。created = 团已建；awaitingHumanApproval = 持久团进了两级审批（FR-5.3）。',
        },
        requestId: { type: 'string', description: '本次申请的幂等 / 审计键（FR-5.3.4 的绑定键）。' },
        targetKind: { type: 'string', enum: ['persistent', 'temporary'], description: '（created / awaitingHumanApproval）目标团类型。' },
        teamId: { type: 'string', description: '（created）新建团的 id。' },
        ticketId: { type: 'string', description: '（awaitingHumanApproval / rejectedByPrincipal / noDowngradeBypass）审批票据 id。' },
        errorCode: { type: 'string', description: '（forbidden / noDowngradeBypass）delegation 给出的机器可判别错误码。' },
        reason: { type: 'string', description: '拒绝或失败的可读原因。' },
      },
    },
    render: (outcome) => {
      switch (outcome.kind) {
        case 'created':
          // ⚠ **不得**在这里写死「免审路径」（OCR 复核 MEDIUM [9]，真实缺陷）。
          // `SpawnOutcome.created` 有**两条**来路：
          //   ① 临时团免审直建（FR-5.3.5）；
          //   ② 持久团**已获人类批准后的幂等回放** ——
          //      `delegation.ts:854-867` 对已 `decided` 的申请逐字回放 `{kind:'created'}`。
          // 初版文案一律附加「免审路径」，于是场景 ② 会被**谎报**成「未经审批就建了团」，
          // 而 FR-5.3 的审批正是本模块最要紧的合规点。
          // ⇒ 按 `targetKind` 分支措辞；两条路径都如实说清「这一次调用」的性质。
          return outcome.targetKind === 'temporary'
            ? `已创建临时团 ${outcome.teamId}（申请 ${outcome.requestId}，免审直建，FR-5.3.5）。`
            : `持久团 ${outcome.teamId} 已就绪（申请 ${outcome.requestId}）——`
              + '该申请此前已获人类批准，本次为幂等回放（未重复建团、未重复推送收件箱）。'
        case 'awaitingHumanApproval':
          return (
            `申请 ${outcome.requestId} 已过监正预审，已推送人类收件箱等待批准（票据 ${outcome.ticketId}）。`
            + '批准前不会创建团队。'
          )
        case 'rejectedByPrincipal':
          return `申请 ${outcome.requestId} 被监正预审否决（票据 ${outcome.ticketId}）：${outcome.reason}`
        case 'forbidden':
          return `派生被拒（${outcome.errorCode}）：${outcome.reason}`
        case 'noDowngradeBypass':
          return `派生被拒（${outcome.errorCode}，票据 ${outcome.ticketId}）：${outcome.reason}`
        case 'invalid-input':
        case 'unknown-caller':
        case 'failed':
          return `派生未发起（${outcome.kind}）：${outcome.reason}`
        default:
          // ⚠ **render 路径不得抛错**（OCR 复核 MEDIUM [16]，这里曾漏改）：
          // 初版用的是 `assertNever`（**抛**），而它是为**判定/执行**路径设计的。
          // 其余四个工具的 render 都已换成 unreachableOutcome，只有本文件漏了 ——
          // 一旦宿主把一个本文件没生成的联合成员透传进来，渲染这一行就会把
          // **整次工具调用**打崩，而不是退回一句说明文字。
          return unreachableOutcome(outcome)
      }
    },
    async execute(input: unknown): Promise<SpawnTeamOutcome> {
      const narrowed = narrowInput(input)
      if ('kind' in narrowed) return narrowed

      // 族 B 第 4 落点（OCR 归档 [18]，参照 task-claim.ts:248 / switch-model.ts:328）：
      // 调用方身份是前置条件，取不到非空白身份就不进入任何授权门，直接拒绝（fail-closed），
      // 并不得让异常穿透 execute（工具契约是「只返回错误、绝不抛」）。
      // 宿主把 caller 绑成 null / undefined 或 memberId 为空串时：
      // 不得让 TypeError 伪装成投影抛错或逃出 execute，而是返回结构化失败（invalid-input），
      // reason 明确说明「调用方身份缺失」。
      const rawCallerMemberId = deps.caller === null || deps.caller === undefined
        ? undefined
        : deps.caller.memberId
      if (!isNonEmptyString(rawCallerMemberId)) {
        return invalid(
          `调用方身份缺失（收到 ${renderValueForMessage(rawCallerMemberId)}）—— `
          + '工具集的 caller.memberId 必须是非空白字符串；判据取不到时本工具拒绝发起（fail-closed），'
          + '而不是抛 TypeError 逃出 execute。',
        )
      }
      const callerMemberId = rawCallerMemberId.trim() as MemberId

      // ── 1. 发起方类型**取自账本投影**，不接受模型自报（见文件头「防冒充」）──
      let callerKind: CallerKind | null
      try {
        callerKind = deps.projection.callerKindOf(callerMemberId)
      } catch (error) {
        return { kind: 'failed', reason: `读发起方所属团队类型时抛错：${describeError(error)}` }
      }
      if (callerKind === null) {
        return {
          kind: 'unknown-caller',
          reason:
            `账本里认不出成员 ${callerMemberId} 所属团的类型 —— `
            + 'FR-5.2 的权限矩阵按发起方类型裁决，判据取不到时本工具拒绝发起（fail-closed），'
            + '而不是默认放行。',
        }
      }

      // ── 2. requestId：显式优先；否则由申请键**确定性派生**（见 requestIdForApplication）──
      const requestId: RequestId = narrowed.requestId !== undefined
        ? (narrowed.requestId as RequestId)
        : requestIdForApplication(callerMemberId, narrowed)

      const spec: TeamSpec = { name: narrowed.name, roster: narrowed.roster, tasks: narrowed.tasks }

      // ── 3. 转交 delegation（**唯一**的判定点：权限矩阵 + 两级审批 + 幂等 + 不得绕开）──
      let outcome: SpawnOutcome
      try {
        outcome = await requestSpawn(deps.delegation, {
          requestId,
          requesterMemberId: callerMemberId,
          requesterKind: callerKind,
          targetKind: narrowed.targetKind,
          spec,
        })
      } catch (error) {
        // `requestSpawn` 在**接线问题**上会抛（principalOf / reviewSpawn 抛错、
        // 人类操作者标识为空 —— 见 delegation.ts 的 requireHumanOperator）。
        // 那些不是权限结论，吞掉它们会让人查不出原因，故如实带出。
        return { kind: 'failed', reason: `派生链路抛错：${describeError(error)}` }
      }

      // ── 4. 逐分支翻译。**穷尽**：`SpawnOutcome` 恰 5 个 kind，漏一个 tsc 就报错。 ──
      switch (outcome.kind) {
        case 'created':
          return { kind: 'created', requestId, targetKind: narrowed.targetKind, teamId: outcome.teamId }
        case 'awaitingHumanApproval':
          return {
            kind: 'awaitingHumanApproval',
            requestId,
            targetKind: narrowed.targetKind,
            ticketId: outcome.ticketId,
          }
        case 'rejectedByPrincipal':
          return {
            kind: 'rejectedByPrincipal',
            requestId,
            ticketId: outcome.ticketId,
            reason: outcome.reason,
          }
        case 'forbidden':
          return { kind: 'forbidden', requestId, errorCode: outcome.errorCode, reason: outcome.reason }
        case 'noDowngradeBypass':
          return {
            kind: 'noDowngradeBypass',
            requestId,
            ticketId: outcome.ticketId,
            errorCode: outcome.errorCode,
            reason: outcome.reason,
          }
        default:
          // 这里是 **execute** 路径：穷尽性由 `assertNever` 保证（新增第 6 个 kind 时
          // 这里编译失败）—— 这正是 AC-5-4「结果联合穷尽」在工具层的落点。
          // ⚠ 与上面 render 的兜底**故意不同**（见那里的注释）：判定路径该抛，
          // 渲染路径不该抛。两者混用是本文件曾被 OCR 抓到的漏改点（MEDIUM [16]）。
          return assertNeverSpawn(outcome)
      }
    },
  }
  return sophiaToolDescriptor(definition)
}

/**
 * `execute` 的穷尽性兜底：**抛错**（`src/tools/message.ts` 的 `unreachableOutcome` 是
 * render 用的、不抛，两者不可互换 —— 理由见 `internal.ts` 里那张对照表）。
 *
 * 为什么不直接 import `src/types/guards.ts` 的 `assertNever`：本文件此前是那么做的，
 * 但那让「render 与 execute 用了同一个抛错断言」在**读代码时看不出来**
 *（OCR 复核 MEDIUM [16] 正是漏改 render 那一处）。本地包一层并写明用途，
 * 使两处的差别在**调用点**就可见。
 */
function assertNeverSpawn(value: never): never {
  // ⚠ 用 `renderValueForMessage` 而不是裸 `String()`（OCR 复核 LOW [20]）：
  // `String()` 对 `Object.create(null)` 与自定义 `Symbol.toPrimitive` 抛错的对象会抛
  //（OCR HIGH [1] 实测复现）—— 那会让这个兜底在**格式化它自己的错误信息时**抛错，
  // 于是最需要的那句「未处理的 SpawnOutcome 分支」反而丢了。
  // 本函数按构造不可达，故严重度低；但同一个不变量只该有一个实现。
  throw new Error(`sophia_spawn_team：未处理的 SpawnOutcome 分支 ${renderValueForMessage(value as unknown)}`)
}
