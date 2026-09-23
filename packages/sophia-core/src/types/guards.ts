/**
 * 类型守卫与穷尽性工具（`LedgerEvent` 判别联合的运行时配套）。
 *
 * 判别联合的价值一半在编译期（`switch` 穷尽性），一半在运行期（从 SQLite 读回的行
 * 必须先证明形状正确才能当成 `LedgerEvent` 用）。本文件提供后者。
 *
 * ⚠ **运行期守卫测不到品牌类型**：`MemberId` 与 `TeamId` 在运行期都只是 `string`
 * （品牌字段只存在于类型层）。因此 `isLedgerEvent` 只能验证**结构形状**，
 * 不能验证「这个字符串确实是某个真实的成员 ID」—— 那是账本内容的职责（FR-10）。
 */

import type { LedgerActor, LedgerEvent, LedgerEventKind } from './operations.ts'

/**
 * 全部事件 kind 的运行期清单。
 *
 * 与 `LedgerEventMap` 的一致性由下方 `_LEDGER_EVENT_KINDS_IS_COMPLETE` 在**编译期**保证：
 * 漏写任一项（或写错字面量）都会让那个 `const` 的类型变成 `never`，`true` 不可赋值而报错。
 * 反恒真：删掉数组里的 `'spawn/human-approved'`，`tsc` 必须报错。
 */
export const LEDGER_EVENT_KINDS = [
  'team/initialized',
  'team/created',
  'team/member-added',
  'team/member-renamed',
  'team/member-suspended',
  'team/member-resumed',
  'team/member-destroyed',
  'team/member-model-switched',
  'team/channel-created',
  'team/thread-started',
  'plan/approved',
  'spawn/awaiting-human-approval',
  'spawn/principal-rejected',
  'spawn/human-approved',
  'spawn/human-rejected',
  'team/ownership-reattached',
  'dag/team-created',
  'dag/ownership-transferred',
  'dag/task-state-changed',
] as const satisfies readonly LedgerEventKind[]

type MissingLedgerEventKind = Exclude<LedgerEventKind, (typeof LEDGER_EVENT_KINDS)[number]>

/** 编译期断言：`LEDGER_EVENT_KINDS` 必须覆盖 `LedgerEventMap` 的全部键。 */
const _LEDGER_EVENT_KINDS_IS_COMPLETE: MissingLedgerEventKind extends never ? true : never = true
void _LEDGER_EVENT_KINDS_IS_COMPLETE

/** 额外断言：不得有多余项（清单里出现映射中不存在的字面量同样必须报错）。 */
type ExtraLedgerEventKind = Exclude<(typeof LEDGER_EVENT_KINDS)[number], LedgerEventKind>

const _NO_EXTRA_LEDGER_EVENT_KIND: ExtraLedgerEventKind extends never ? true : never = true
void _NO_EXTRA_LEDGER_EVENT_KIND

const LEDGER_EVENT_KIND_SET: ReadonlySet<string> = new Set(LEDGER_EVENT_KINDS)

/** 判断一个字符串是否是合法的账本事件 kind。 */
export function isLedgerEventKind(value: unknown): value is LedgerEventKind {
  return typeof value === 'string' && LEDGER_EVENT_KIND_SET.has(value)
}

/** 判断一个值是否是合法的账本操作者（三类之一）。 */
export function isLedgerActor(value: unknown): value is LedgerActor {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate: Record<string, unknown> = value as Record<string, unknown>
  switch (candidate['kind']) {
    case 'human':
      return typeof candidate['humanId'] === 'string'
    case 'host':
      return typeof candidate['hostSessionId'] === 'string'
    case 'member':
      return typeof candidate['memberId'] === 'string'
    default:
      return false
  }
}

/**
 * 判断一个值是否具备 `LedgerEvent` 的**结构**。
 *
 * 用于从存储层读回的行：先过这道守卫，再做业务判断。
 *
 * **它证明什么、不证明什么**（OCR 评审前置条件，勿再放宽）：
 * - 证明：`kind` 属清单、`eventId` 为 string、`sequence` 为 ≥1 的**安全整数**、
 *   `occurredAt` 为**有限** number、`previousEventId` 为 string 或 null、
 *   `actor` 合法、**`data` 是非 null 对象**。
 * - **不**证明：品牌（运行期都是 string）、`data` 的具体载荷形状与 `kind` 是否匹配。
 *   后者由 §6.4 的完整性自检负责。
 *   ⇒ 因此调用方**不得**把本守卫当载荷校验用；要读具体字段仍需按 kind 收窄后自行判空。
 *
 * `data` 必须是非 null 对象这一条是硬要求：载荷表（`LedgerEventMap`）里**没有一项**是
 * 标量或 null，若这里放行 `data: undefined`，调用方按 kind 收窄后访问 `event.data.x`
 * 就会在运行期炸 `TypeError` —— 而守卫的本职恰是拦住这种行。
 */
export function isLedgerEvent(value: unknown): value is LedgerEvent {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate: Record<string, unknown> = value as Record<string, unknown>
  if (!isLedgerEventKind(candidate['kind'])) {
    return false
  }
  if (typeof candidate['eventId'] !== 'string') {
    return false
  }
  // 序号：1 起、无空洞（AC-10-8/AC-10-9）。用 isSafeInteger 而非 isInteger，
  // 免得 `-1` 或超出 2^53 的整数被当成合法序号。
  if (typeof candidate['sequence'] !== 'number' || !Number.isSafeInteger(candidate['sequence'])) {
    return false
  }
  if (candidate['sequence'] < 1) {
    return false
  }
  // 时间：必须是**非负安全整数**。NaN / ±Infinity / 负数 / 小数读回来都不是合法时间戳。
  // 用 isSafeInteger 而非 isFinite（OCR 评审 [41]）：写入侧（`commit`）因 STRICT 表的
  // INTEGER 列只接受安全整数，若这里放行小数，就会形成**写读不对称** ——
  // 一条分数时间戳的事件在守卫看来「合法」，却根本存不进库。
  // 两侧用同一判据，`commit 接受 ⟺ 读回接受` 这条不变量才真正成立。
  if (typeof candidate['occurredAt'] !== 'number' || !Number.isSafeInteger(candidate['occurredAt'])) {
    return false
  }
  if (candidate['occurredAt'] < 0) {
    return false
  }
  const previous = candidate['previousEventId']
  if (previous !== null && typeof previous !== 'string') {
    return false
  }
  // `requestId` 是可选的审计/幂等键（`LedgerEventBase.requestId?: RequestId`）。
  // 它必须**要么缺席、要么是非空字符串** —— OCR 评审 [17] 的载荷一侧。
  // 缺这道判定时 `requestId: 42` 能通过守卫，随后 `collectSpawnEvents` 拿它做
  // `event.requestId !== requestId` 比较：`42 !== 'R1'` 恒真，于是这条事件被**静默忽略**
  // （既不报错、也不出现在结果里）。这类「值在但类型不对」的静默失配正是守卫本职要拦的。
  if (candidate['requestId'] !== undefined) {
    const requestId = candidate['requestId']
    if (typeof requestId !== 'string' || requestId === '') {
      return false
    }
  }
  const data = candidate['data']
  if (typeof data !== 'object' || data === null) {
    return false
  }
  // 数组**不是**合法载荷：`LedgerEventMap` 里没有任何一个 kind 的载荷是数组
  // （全部是具名对象形状）。放行数组会让 `data` 看起来「是个对象」却取不到任何具名字段 ——
  // 实测后果：`commit({kind:'team/created', data:[1,2]})` 落账后，
  // 按 kind 收窄的消费方读 `event.data.teamId` 得到 `undefined`
  // （该缺陷在 `findTeamCreatedFor` 上真实发生过，见 delegation.ts 的 OCR [12] 注释）。
  // 在**读写共用的这一个**判定点拒绝，可一次关闭整类「载荷形状无法被任何消费者使用」的事件。
  // 注意：这只排除数组，**不**声称已验证载荷与 kind 匹配 —— 后者是 §6.4 完整性自检的职责，
  // 仍然：过守卫 ≠ 载荷正确（见下方 doc 的「不证明」一节）。
  if (Array.isArray(data)) {
    return false
  }
  return isLedgerActor(candidate['actor'])
}

/**
 * 穷尽性断言：`switch` 的分支应永不落到这里。
 *
 * 用法：`switch (event.kind) { ... default: return assertNever(event) }` ——
 * 新增一个 kind 而漏处理时，`tsc` 会在**调用处**（而不是在遥远的 `default` 里）报错，
 * 因为那时 `event` 不再收窄为 `never`。
 */
export function assertNever(value: never): never {
  throw new Error(`未处理的判别分支：${String(value as unknown)}`)
}
