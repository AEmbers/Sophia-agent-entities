/**
 * 追加式账本与 scope 增量读取（SPEC §6 全文 / FR-10）。
 *
 * ## 三条不可动摇的性质
 *
 * 1. **只追加落在存储层，不是应用层的自觉**（SPEC §6.4）。表上装了两个 `BEFORE UPDATE` /
 *    `BEFORE DELETE` 触发器，直接 `RAISE(ABORT, ...)`。因此哪怕调用方**另开一条
 *    `DatabaseSync` 连接**绕过本类直接发 SQL，篡改也会被拒 —— 这正是 AC-10-6 的验法
 *    （若只在应用层挡，测试就得调 `Ledger` 的方法，那只能证明「这个类碰巧没暴露 update」，
 *    是恒真断言）。
 * 2. **`commit` 是同步的**（captain 裁定 Q-B，SPEC §6.5）。本机 `node:sqlite` 提供的是
 *    `DatabaseSync`，异步包装只会引入「返回 Promise 但内部同步阻塞」的假异步。
 *    真正的异步在审批那一层（`t6` 的 `requestSpawn`），两层分工不冲突。
 * 3. **scope 只有一个真相来源**：读取时的 scope 过滤与 `changeScopesOf` 是同一份实现，
 *    不另建 `scopes` 表在写入时冗余存一份。理由：冗余会让「表里的 scope」与
 *    「`changeScopesOf` 算出的 scope」可以各自演化并悄悄分叉，而分叉的表现是
 *    「某些变更读不到」—— 一种难查的静默丢失。用序号的 SQL 游标保证增量性，
 *    scope 交到内存里判（见 `read`）。
 *
 * ## 存储层 schema
 *
 * ```sql
 * CREATE TABLE ledger_events (
 *   sequence        INTEGER PRIMARY KEY,   -- 1 起连续，无空洞（AC-10-8）
 *   event_id        TEXT NOT NULL UNIQUE,
 *   kind            TEXT NOT NULL,
 *   occurred_at     INTEGER NOT NULL,
 *   actor_kind      TEXT NOT NULL,         -- human | host | member
 *   actor_id        TEXT NOT NULL,         -- 品牌在运行期都是 string（见 guards.ts 的边界说明）
 *   previous_event_id TEXT,                -- 链式完整性；首条为 NULL（AC-10-9）
 *   request_id      TEXT,
 *   data_json       TEXT NOT NULL
 * ) STRICT;
 * ```
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { assertNever, isLedgerActor, isLedgerEvent, isLedgerEventKind } from './types/index.ts'
import type {
  DagTeamId,
  EventId,
  HostSessionId,
  LedgerActor,
  LedgerEvent,
  LedgerEventKind,
  LedgerSequence,
  MemberId,
  PlanId,
  RequestId,
  SpawnTicketId,
  TeamId,
} from './types/index.ts'

/** 提交回执（SPEC §6.2）。调用方凭 `sequence` 与 `eventId` 引用这条已落盘的事实。 */
export interface LedgerReceipt {
  readonly eventId: EventId
  readonly sequence: LedgerSequence
  readonly occurredAt: number
}

/** 账本头部：最后一条事件的序号与 ID；空账本为 `{ sequence: 0, eventId: null }`。 */
export interface LedgerHead {
  readonly sequence: LedgerSequence
  readonly eventId: EventId | null
}

/**
 * 提交输入（SPEC §6.2）。
 *
 * `data` 类型是 `unknown` 而非泛型：`LedgerEventMap` 把 kind→载荷的对应关系钉在类型层，
 * 但 `commit` 的签名（SPEC §6.2 逐字）不携带 kind 的类型参数。运行期的最低保证由
 * `commit` 用 `isLedgerEvent` 校验（载荷必须是非 null 对象），**载荷与 kind 是否匹配**
 * 由 SPEC §6.4 的完整性自检负责（`isLedgerEvent` 的结构守卫测不到这一层，见 guards.ts）。
 */
export interface LedgerCommitInput {
  readonly kind: LedgerEventKind
  readonly data: unknown
  readonly actor: LedgerActor
  readonly occurredAt?: number | undefined
  readonly requestId?: RequestId | undefined
}

/** 会话内账本句柄（SPEC §6.2）。 */
export interface Ledger {
  /** 只追加地提交一条事件，**同步**返回回执。 */
  commit(input: LedgerCommitInput): LedgerReceipt

  /** 读取事件；scope 与游标语义见 SPEC §6.3。 */
  read(query: LedgerReadQuery): LedgerPage

  head(): LedgerHead

  /** 完整性自检；只报告不抛出（SPEC §6.4）。 */
  verifyIntegrity(): LedgerIntegrity

  close(): void
}

export interface OpenLedgerOptions {
  /** 数据库文件路径；`:memory:` 表示进程内库（测试用）。 */
  readonly path: string
  /** 注入时钟，便于确定性测试。 */
  readonly now?: (() => number) | undefined
}

/**
 * 变更 scope（SPEC §6.3）。一条事件可以命中多个 scope，查询侧命中任意一个即返回该事件。
 *
 * ⚠ 关于 `spawn-ticket`：本包的账本事件载荷（`SpawnAwaitingHumanData` 等）携带的是
 * `requestId`，而 SPEC §5.1 的 `SpawnTicket` 把 `ticketId` 与 `requestId` 定义为**两个并列字段**。
 * 也就是说账本里从未记录过 `SpawnTicketId`。若把 `requestId` 强转成 `ticketId` 发出去，
 * 订阅 `SpawnTicket.ticketId` 的调用方将**永远匹配不上**，而且是静默的。
 * 因此本实现**不产出** `spawn-ticket` scope，审批类事件只投 `human-inbox` 与发起成员；
 * `spawn-ticket` 保持为契约里的词汇，等账本事件真正携带该 ID 时再启用。
 */
export type ChangeScope =
  | { readonly kind: 'team'; readonly teamId: TeamId }
  | { readonly kind: 'member'; readonly memberId: MemberId }
  | { readonly kind: 'plan'; readonly planId: PlanId }
  | { readonly kind: 'spawn-ticket'; readonly ticketId: SpawnTicketId }
  | { readonly kind: 'dag-team'; readonly dagTeamId: DagTeamId }
  | { readonly kind: 'human-inbox' }

export interface LedgerReadQuery {
  /** 省略 = 不过滤，返回全部事件（SPEC §6.3 语义 1）。 */
  readonly scopes?: readonly ChangeScope[] | undefined
  /** 只返回 sequence **严格大于**该值的事件。省略 = 从 1 开始。 */
  readonly afterSequence?: LedgerSequence | undefined
  /** 单页上限，默认 100，最大 1000。 */
  readonly limit?: number | undefined
}

export interface LedgerPage {
  readonly events: readonly LedgerEvent[]
  /** 下一页的游标 = 本页最后一条的 sequence；无更多时为 `null`。 */
  readonly nextCursor: LedgerSequence | null
  readonly hasMore: boolean
}

export interface LedgerIntegrity {
  readonly ok: boolean
  /**
   * **已连续校验通过的事件条数**。
   * - `ok === true`：等于事件总数（即最后一条的 sequence）；
   * - `ok === false`：等于断裂点之前的连续前缀长度。
   * 之所以不用「表里总行数」，是因为断裂之后的行本来就不可信，把它们计入会让这个数字
   * 看起来像「账本有 N 条事实」。
   */
  readonly sequence: LedgerSequence
  /** 首个断裂处的 sequence；无断裂为 `null`。 */
  readonly brokenAt: LedgerSequence | null
}

/** 默认页大小（SPEC §6.3）。 */
const DEFAULT_PAGE_LIMIT = 100
/** 页大小上限（SPEC §6.3）。 */
const MAX_PAGE_LIMIT = 1000
/** 内存侧过滤时的 SQL 取数批大小下限，避免 scope 过滤率低时反复往返。 */
const READ_BATCH_FLOOR = 64
/** 完整性自检的批大小：与读取路径共用同一句分页 SQL，只是不需要为 scope 留余量。 */
const INTEGRITY_BATCH_SIZE = 256

/**
 * 建表 + 两个触发器。
 *
 * 用 `IF NOT EXISTS` 是为了「打开一个已存在的账本文件」时**重新确认**约束在位 ——
 * 若约束只在首次建库时建立，一个从旧版本升级来的库就会静默失去 append-only 保护。
 */
const LEDGER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ledger_events (
  sequence          INTEGER PRIMARY KEY,
  event_id          TEXT NOT NULL UNIQUE,
  kind              TEXT NOT NULL,
  occurred_at       INTEGER NOT NULL,
  actor_kind        TEXT NOT NULL,
  actor_id          TEXT NOT NULL,
  previous_event_id TEXT,
  request_id        TEXT,
  data_json         TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_update
BEFORE UPDATE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'append-only: UPDATE forbidden');
END;

CREATE TRIGGER IF NOT EXISTS ledger_events_no_delete
BEFORE DELETE ON ledger_events
BEGIN
  SELECT RAISE(ABORT, 'append-only: DELETE forbidden');
END;
`

const SELECT_PAGE_SQL = `
SELECT sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json
FROM ledger_events
WHERE sequence > ?
ORDER BY sequence ASC
LIMIT ?
`

const SELECT_HEAD_SQL = `
SELECT sequence, event_id
FROM ledger_events
ORDER BY sequence DESC
LIMIT 1
`

/** 从 SQLite 读回的原始行（列名 → 值）。 */
type RawRow = Record<string, unknown>

/**
 * 头部行的收窄。
 *
 * 单独一个函数而非复用 `toEventRow`：头部查询只取 `sequence` 与 `event_id` 两列
 * （见 `SELECT_HEAD_SQL`），拿全量行的收窄器去解它必然失败。这个错误在实现时真实发生过，
 * 症状是**第一次 commit 就抛「账本头部行无法解析」**—— 保留独立函数以免复发。
 */
function toHeadRow(raw: RawRow): { readonly sequence: number; readonly eventId: string } | null {
  const sequence = raw['sequence']
  const eventId = raw['event_id']
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) return null
  if (typeof eventId !== 'string') return null
  return { sequence, eventId }
}

/** 已做过类型收窄的一行。 */
interface EventRow {
  readonly sequence: number
  readonly eventId: string
  readonly kind: string
  readonly occurredAt: number
  readonly actorKind: string
  readonly actorId: string
  readonly previousEventId: string | null
  readonly requestId: string | null
  readonly dataJson: string
}

/** 结构性收窄：任一处类型不符即返回 `null`（不抛错，让调用方决定怎么处理）。 */
function toEventRow(raw: RawRow): EventRow | null {
  const sequence = raw['sequence']
  const eventId = raw['event_id']
  const kind = raw['kind']
  const occurredAt = raw['occurred_at']
  const actorKind = raw['actor_kind']
  const actorId = raw['actor_id']
  const previousEventId = raw['previous_event_id']
  const requestId = raw['request_id']
  const dataJson = raw['data_json']

  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 1) return null
  if (typeof eventId !== 'string') return null
  if (typeof kind !== 'string') return null
  if (typeof occurredAt !== 'number' || !Number.isFinite(occurredAt)) return null
  if (typeof actorKind !== 'string' || typeof actorId !== 'string') return null
  if (previousEventId !== null && typeof previousEventId !== 'string') return null
  if (requestId !== null && typeof requestId !== 'string') return null
  if (typeof dataJson !== 'string') return null

  return { sequence, eventId, kind, occurredAt, actorKind, actorId, previousEventId, requestId, dataJson }
}

/** 行 → `LedgerActor`；三成分列存储，避免把 `data_json` 之外的审计维度埋进 JSON。 */
function decodeActor(kind: string, id: string): LedgerActor | null {
  switch (kind) {
    case 'human':
      return { kind: 'human', humanId: id }
    case 'host':
      return { kind: 'host', hostSessionId: id as HostSessionId }
    case 'member':
      return { kind: 'member', memberId: id as MemberId }
    default:
      return null
  }
}

/**
 * 组装「事件候选对象」—— `commit` 的写入前校验与 `rowToEvent` 的读回路径**共用**这一处。
 *
 * 存在的理由是 OCR 评审 [3] 指出的分叉风险：若写入前校验自己拼一份、读回再拼一份，
 * 两处只能靠人工保持一致；将来任一处漏改字段（例如读回那边开始带 `requestId` 而校验这边没有），
 * 就会重新出现「写进去能过、读回来毒化」的裂缝。抽成一个函数后，
 * 「被校验的对象」与「被读出的对象」在结构上就是同一套组装逻辑。
 *
 * `requestId` 只在非 `null`/`undefined` 时进入（`exactOptionalPropertyTypes` 下与读回路径一致）。
 */
function buildEventCandidate(input: {
  readonly eventId: string
  readonly sequence: LedgerSequence
  readonly occurredAt: number
  readonly actor: LedgerActor
  readonly previousEventId: string | null
  readonly kind: string
  readonly data: unknown
  readonly requestId: string | null | undefined
}): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    eventId: input.eventId,
    sequence: input.sequence,
    occurredAt: input.occurredAt,
    actor: input.actor,
    previousEventId: input.previousEventId,
    kind: input.kind,
    data: input.data,
  }
  if (input.requestId !== null && input.requestId !== undefined) {
    candidate['requestId'] = input.requestId
  }
  return candidate
}

/**
 * 行 → `LedgerEvent`。
 *
 * 走 `isLedgerEvent`（`t3` 的结构守卫）而不是类型断言：读回的数据来自存储层，
 * 「形状对不对」必须由运行期证据回答。**守卫只证结构、不证载荷与 kind 匹配**
 * （品牌在运行期都是 string），载荷一致性由 `verifyIntegrity` 的链式检查与本函数的
 * 「解析不出来就当失败」共同兜底。
 */
function rowToEvent(row: EventRow): LedgerEvent | null {
  const actor = decodeActor(row.actorKind, row.actorId)
  if (actor === null) {
    return null
  }
  let data: unknown
  try {
    data = JSON.parse(row.dataJson)
  } catch {
    return null
  }
  const candidate = buildEventCandidate({
    eventId: row.eventId,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    actor,
    previousEventId: row.previousEventId,
    kind: row.kind,
    data,
    requestId: row.requestId,
  })
  return isLedgerEvent(candidate) ? candidate : null
}

/** 把 actor 拆成两列。非法 actor 由 `commit` 前置校验挡住，这里只做机械拆分。 */
function encodeActor(actor: LedgerActor): { readonly kind: string; readonly id: string } {
  switch (actor.kind) {
    case 'human':
      return { kind: 'human', id: actor.humanId }
    case 'host':
      return { kind: 'host', id: actor.hostSessionId }
    case 'member':
      return { kind: 'member', id: actor.memberId }
    default:
      return assertNever(actor)
  }
}

/** scope 的可比较键。同 kind 同 id 即同 scope（SPEC §6.3 的交集判定）。 */
function scopeKey(scope: ChangeScope): string {
  switch (scope.kind) {
    case 'team':
      return `team\u0000${scope.teamId}`
    case 'member':
      return `member\u0000${scope.memberId}`
    case 'plan':
      return `plan\u0000${scope.planId}`
    case 'spawn-ticket':
      return `spawn-ticket\u0000${scope.ticketId}`
    case 'dag-team':
      return `dag-team\u0000${scope.dagTeamId}`
    case 'human-inbox':
      return 'human-inbox'
    default:
      return assertNever(scope)
  }
}

const teamScope = (teamId: TeamId): ChangeScope => ({ kind: 'team', teamId })
const memberScope = (memberId: MemberId): ChangeScope => ({ kind: 'member', memberId })
const planScope = (planId: PlanId): ChangeScope => ({ kind: 'plan', planId })
const dagTeamScope = (dagTeamId: DagTeamId): ChangeScope => ({ kind: 'dag-team', dagTeamId })
/** 人类收件箱是一个单例 scope（FR-5.3.2）：待办项属于「任意窗口都能看到」的那一个队列。 */
const HUMAN_INBOX_SCOPE: ChangeScope = { kind: 'human-inbox' }

/**
 * 一条事件影响的所有 scope（SPEC §6.3 / FR-10.3）。
 *
 * **穷尽性由 `tsc` 保证**：`switch` 的 `default` 是 `assertNever(event)`，
 * 将来往 `LedgerEventMap` 加一个 kind 而忘了在这里定 scope，编译期就报错 ——
 * 而不是运行期静默地少投一个 scope（那种缺陷的表现是「界面不刷新」，没有任何报错）。
 *
 * 返回 `[]` 的两种情况，语义都是 SPEC §6.3 语义 3 的「不参与任何 scope 投影」：
 * - `team/initialized`：团壳创建**那一刻**还不存在订阅者（对齐上游
 *   `agent-team/src/ledger.ts:2017` 对同一 kind 返回 `undefined` 的判断）；
 * - `team/thread-started`：受影响实体是频道/线程，而 SPEC §6.3 的 scope 词汇里
 *   **没有** channel/thread 种类。宁可如实返回空，也不硬塞一个语义不符的 scope ——
 *   硬塞会让订阅方拿到「看似更新了」的通知却找不到自己关心的数据。要投影它，
 *   正确做法是先扩契约的 scope 词汇。
 */
export function changeScopesOf(event: LedgerEvent): readonly ChangeScope[] {
  switch (event.kind) {
    case 'team/initialized':
      return []

    case 'team/created': {
      // 子团成立会改变父团的成员/子团列表视图，故父团 scope 一并投递（FR-5.4）。
      const scopes: ChangeScope[] = [teamScope(event.data.teamId)]
      if (event.data.parentTeamId !== null) {
        scopes.push(teamScope(event.data.parentTeamId))
      }
      return scopes
    }

    case 'team/destroyed':
      // 团队级中止（2026-09-24）：它改变的是**这个团自己的视图**（wire 不再发它），
      // 不波及父团 —— 中止不改变父团的成员/子团列表（团还在账本里，只是停了）。
      return [teamScope(event.data.teamId)]

    case 'team/member-added':
      // AC-10-2 钉死的一条：新成员自身的 member scope + 其所属团的 team scope。
      return [memberScope(event.data.member.memberId), teamScope(event.data.teamId)]

    case 'team/member-renamed':
    case 'team/member-suspended':
    case 'team/member-resumed':
    case 'team/member-destroyed':
    case 'team/member-model-switched':
      return [memberScope(event.data.memberId), teamScope(event.data.teamId)]

    case 'team/channel-created':
      return [teamScope(event.data.teamId)]

    case 'team/thread-started':
      return []

    case 'team/message-sent':
      // 与 `team/thread-started` 同源：受影响实体是「线程里的一条消息」，
      // 而 §6.3 的 scope 词汇表里没有 channel/thread/message 种类。
      // 载荷里也没有 `teamId` 可投（见 `MessageSentData`），故如实返回空 ——
      // 详细理由与「带 scopes 的读取看不到消息」这一后果写在
      // `projection/index.ts` 的 `UNSCOPED_EVENT_KINDS`。
      return []

    case 'plan/approved':
      return [planScope(event.data.planId)]

    case 'spawn/awaiting-human-approval':
      // 待办入队（FR-5.3.2）：收件箱这个单例 scope + 发起成员（其视图转为「待审批」）。
      return [HUMAN_INBOX_SCOPE, memberScope(event.data.requesterMemberId)]

    case 'spawn/principal-rejected':
      // 未进第二级，收件箱不受影响；只需发起成员看到打回（FR-5.3.1）。
      return [memberScope(event.data.requesterMemberId)]

    case 'spawn/human-approved':
    case 'spawn/human-rejected':
      // 待办出队 + 发起成员视图更新（FR-5.3.3）。
      return [HUMAN_INBOX_SCOPE, memberScope(event.data.requesterMemberId)]

    case 'team/ownership-reattached':
      return [
        teamScope(event.data.teamId),
        memberScope(event.data.from),
        memberScope(event.data.to),
      ]

    case 'dag/team-created': {
      const scopes: ChangeScope[] = [
        dagTeamScope(event.data.dagTeamId),
        memberScope(event.data.ownerMemberId),
      ]
      if (event.data.parentTeamId !== null) {
        scopes.push(teamScope(event.data.parentTeamId))
      }
      return scopes
    }

    case 'dag/ownership-transferred':
      return [
        dagTeamScope(event.data.dagTeamId),
        memberScope(event.data.from),
        memberScope(event.data.to),
      ]

    case 'dag/task-state-changed':
      return [dagTeamScope(event.data.dagTeamId)]

    default:
      return assertNever(event)
  }
}

/** 查询 scopes 与事件 scopes 是否有交集（SPEC §6.3 语义 2）。 */
function intersects(queryKeys: ReadonlySet<string>, event: LedgerEvent): boolean {
  for (const scope of changeScopesOf(event)) {
    if (queryKeys.has(scopeKey(scope))) {
      return true
    }
  }
  return false
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_PAGE_LIMIT
  }
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`LedgerReadQuery.limit 必须是 ≥1 的安全整数，收到：${String(limit)}`)
  }
  return Math.min(limit, MAX_PAGE_LIMIT)
}

function normalizeAfterSequence(afterSequence: LedgerSequence | undefined): LedgerSequence {
  if (afterSequence === undefined) {
    return 0
  }
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new RangeError(
      `LedgerReadQuery.afterSequence 必须是 ≥0 的安全整数，收到：${String(afterSequence)}`,
    )
  }
  return afterSequence
}

/**
 * 打开（必要时创建）一个账本。
 *
 * `path === ':memory:'` 时是进程内库，仅供测试：进程退出即消失，且每个连接各自独立。
 */
export function openLedger(options: OpenLedgerOptions): Ledger {
  const db = new DatabaseSync(options.path)
  try {
    // 忙等而非立刻失败（OCR 评审 [25]）：`commit` 用 `BEGIN IMMEDIATE` 串行化写事务，
    // 但**另一个进程/另一条连接**持写锁时，SQLite 默认立即抛 `SQLITE_BUSY`
    // （实测：外部连接开着写事务时 commit → `database is locked`）。
    // 本包的设计明确预期「第二条连接/另一个进程会碰同一个文件」（AC-10-6 就是那样验的），
    // 所以把这种正常的短暂争用报成硬错误是不合适的 —— 设一个上限内的忙等更贴近真实语义。
    // 5s 是取舍：足够覆盖一次正常的短事务提交；又不会让真正卡死的调用无限期挂住。
    // ⚠ 它是**每连接**设置、不写进库文件（实测：新建连接读回来是 0）⇒ 每次 openLedger 都要设。
    // 不改变 append-only 语义（触发器与事务边界都没动）。
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(LEDGER_SCHEMA_SQL)
  } catch (error) {
    // 建表/触发器失败时必须把已打开的连接关掉（OCR 评审 [40]）：否则连接句柄与文件锁
    // 会泄漏到进程结束 —— 实测：对一个「不是数据库」的文件调用 openLedger 会抛
    // `file is not a database`，而那条连接**仍然持着文件句柄**（随后删除该文件报 EPERM）。
    // 更糟的是：锁被留着会让**后续** openLedger 撞上 busy_timeout。失败路径不该留下副作用。
    try {
      db.close()
    } catch {
      // 关闭自身失败不该盖住真正的初始化错误。
    }
    throw error
  }

  const now = options.now ?? ((): number => Date.now())

  const insertStatement = db.prepare(`
    INSERT INTO ledger_events
      (sequence, event_id, kind, occurred_at, actor_kind, actor_id, previous_event_id, request_id, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const headStatement = db.prepare(SELECT_HEAD_SQL)
  const pageStatement = db.prepare(SELECT_PAGE_SQL)

  let closed = false

  function assertOpen(): void {
    if (closed) {
      throw new Error('账本已关闭：close() 之后不得再提交或读取。')
    }
  }

  function readHead(): LedgerHead {
    const row = headStatement.get()
    if (row === undefined) {
      return { sequence: 0, eventId: null }
    }
    const parsed = toHeadRow(row)
    if (parsed === null) {
      throw new Error('账本头部行无法解析：存储已被外部改写，请先跑 verifyIntegrity()。')
    }
    return { sequence: parsed.sequence, eventId: parsed.eventId as EventId }
  }

  return {
    commit(input: LedgerCommitInput): LedgerReceipt {
      assertOpen()

      if (input.data === null || typeof input.data !== 'object') {
        throw new TypeError(
          'LedgerCommitInput.data 必须是非 null 对象：LedgerEventMap 的全部载荷都是对象形状，' +
            '写入标量会造出一条本包自己的 isLedgerEvent 都拒绝读回的事件。',
        )
      }
      // kind 必须在这里挡（OCR 评审 [1]，实测过一个 `as` 强转或纯 JS 调用方传错 kind 的后果）：
      // 一条未知 kind 的事件落盘后**永久毒化账本** —— `read()` 与 `verifyIntegrity()` 都把
      // 「解析不出来的行」读成「存储已被外部改写」，于是此后任何 scope 的读取都抛错，
      // 而真实原因是当初写进去一个错字。这与 data / actor / occurredAt 的运行期校验对称。
      // 类型层挡不住它：`LedgerEventKind` 是编译期的，`as` 与 JS 调用方都能绕过。
      if (!isLedgerEventKind(input.kind)) {
        throw new TypeError(
          `LedgerCommitInput.kind 不是合法的账本事件 kind：${String(input.kind)}`,
        )
      }
      if (!isLedgerActor(input.actor)) {
        throw new TypeError(`LedgerCommitInput.actor 不是合法的账本操作者：${JSON.stringify(input.actor)}`)
      }
      // OCR 评审 [2]：`requestId` 此前完全没校验。实测过后果 —— 传数字 `123` 会被 SQLite 存成
      // 字符串 `"123.0"` 并在读回时伪装成合法的 `RequestId`（品牌在运行期只是 string，读不回来路），
      // 即「写进去的值」与「读出来的值」不同且**无人报错**；传对象/布尔/数组则直接撞在
      // SQLite 绑定错误上，报的是 `cannot be bound to SQLite parameter 8` 这种和业务无关的信息。
      // 与 kind/data/actor/occurredAt 的校验对齐：入口就说清是哪个字段、为什么不行。
      if (input.requestId !== undefined && typeof input.requestId !== 'string') {
        throw new TypeError(
          'LedgerCommitInput.requestId 必须是字符串或省略，收到：' +
            `${input.requestId === null ? 'null' : typeof input.requestId}。` +
            '（品牌类型在运行期只是 string，错类型不会被类型系统挡住，故在此硬校验。）',
        )
      }
      const occurredAt = input.occurredAt ?? now()
      // 必须是**安全整数**而非仅「非负有限数」（OCR 评审 [41]）：
      // `occurred_at` 列声明为 `INTEGER NOT NULL`（STRICT 表），而 SQLite 只在无损时才把
      // REAL 转 INTEGER —— 传 `1758600000.5` 会一路穿到 `insertStatement.run`，抛出
      // `cannot store REAL value in INTEGER column` 这种与业务无关的底层错误。
      // 更要紧的是**写读不对称**：`Number.isFinite` 放行小数，而读回侧的 `isLedgerEvent`
      // 同样放行 ⇒ 一条分数时间戳的事件在两条路径上都"合法"，却根本存不进去。
      // 在入口显式要求安全整数，让失败在正确的层、带上正确的字段名。
      if (
        typeof occurredAt !== 'number' ||
        !Number.isSafeInteger(occurredAt) ||
        occurredAt < 0
      ) {
        throw new TypeError(
          'LedgerCommitInput.occurredAt 必须是非负**安全整数**（毫秒时间戳），收到：' +
            `${String(input.occurredAt)}。` +
            '（occurred_at 列是 STRICT 表的 INTEGER；小数会以「cannot store REAL value」的底层错误暴露，' +
            '故在此提前拒绝。默认值为 Date.now()，它本身就是整数。）',
        )
      }
      const actor = encodeActor(input.actor)
      const eventId = `evt-${randomUUID()}`
      // 类型放宽到 `string | undefined` 与被调用方的声明不符但**与运行期相符**：
      // `@types/node` 声明 `JSON.stringify` 返回 `string`，可载荷带一个返回 `undefined`
      // 的 `toJSON` 时它真的返回 `undefined`（实测：`JSON.stringify({toJSON:()=>undefined})` === undefined）。
      // 若沿用 `string`，下面那道判断就成了「类型上不可达」的死条件 —— 评审会（正确地）质疑它，
      // 而它其实是承重的。如实标注类型比删掉判断更安全。
      let dataJson: string | undefined
      try {
        dataJson = JSON.stringify(input.data)
      } catch (cause) {
        throw new TypeError(`LedgerCommitInput.data 无法 JSON 序列化（账本以 JSON 文本持久化载荷）：${String(cause)}`)
      }

      // 上面那道 `typeof input.data === 'object'` 校验**入参**，但真正落盘的是 `dataJson`，
      // 两者可以不等价 —— 于是存在一类绕过（t5 的 OCR 扫描发现、captain 独立复现，我已亲手复跑确认）：
      //
      //   | 传入值                 | 入参过校验 | 落盘的 JSON                      | 读回 isLedgerEvent |
      //   |------------------------|-----------|----------------------------------|--------------------|
      //   | `{ toJSON: () => 123 }`| ✅        | `"123"`                          | ❌ 毒化            |
      //   | `new Date(0)`          | ✅        | `"\"1970-01-01T00:00:00.000Z\""` | ❌ 毒化            |
      //   | `new Number(5)`        | ✅        | `"5"`                            | ❌ 毒化            |
      //
      // 三者都是对象（有 `toJSON` 或是包装对象），却序列化成标量。后果与未知 kind 完全同类：
      // 此后**每次** `read()` 都抛「存储已被外部改写」，而真实原因只是当初写进一个序列化成标量的载荷。
      //
      // 修法是**校验序列化之后的结果**而非入参 —— 检查的对象与落盘的对象是同一份，不存在
      // 「校验 A、存储 B」的缝隙。
      if (dataJson === undefined) {
        throw new TypeError(
          'LedgerCommitInput.data 序列化后不是非 null 对象，因此落盘后会读不回来（会毒化账本）：' +
            '该载荷的 JSON.stringify 返回了 undefined（常见成因：toJSON 返回 undefined）。' +
            '请传纯对象载荷（LedgerEventMap 的全部载荷都是对象形状）。',
        )
      }
      let persisted: unknown
      try {
        persisted = JSON.parse(dataJson) as unknown
      } catch (cause) {
        // JSON.stringify 的产物按定义总可被 JSON.parse 解析；真走到这里说明运行时被改过。
        throw new TypeError(`LedgerCommitInput.data 序列化后无法回读（账本以 JSON 文本持久化载荷）：${String(cause)}`)
      }
      if (persisted === null || typeof persisted !== 'object') {
        throw new TypeError(
          'LedgerCommitInput.data 序列化后不是非 null 对象，因此落盘后会读不回来（会毒化账本）：' +
            `该载荷序列化后是 ${persisted === null ? 'null' : typeof persisted}（JSON 文本：${dataJson}）。` +
            '常见成因：传入了带 toJSON 的对象、Date、或 new Number()/new String() 之类的包装对象。' +
            '请传纯对象载荷（LedgerEventMap 的全部载荷都是对象形状）。',
        )
      }

      // 尾部用 `isLedgerEvent` 兜底复核**即将落盘的那份载荷**，把「commit 接受 ⟺ 读回接受」
      // 这条不变量从「注释里的承诺」变成「结构上无法违反」：读回路径用的正是同一个函数，
      // 且候选对象由 `buildEventCandidate` 这一处共用组装（OCR 评审 [3]）。
      // 于是 guards.ts 将来若收紧/放宽 `data` 的判定（例如加入 `Array.isArray` 排除），
      // 这里会**同时**跟着变，不会静默失配。
      // 注意用 `persisted`（落盘后再解析出来的那份）而非 `input.data`：被判定的必须与要存储的同一份。
      // 若将来 isLedgerEvent 收紧了别的字段，这条也会立刻暴露该不变量已被破坏 —— 不是过度防御。
      const probe = buildEventCandidate({
        eventId,
        sequence: 1,
        occurredAt,
        actor: input.actor,
        previousEventId: null,
        kind: input.kind,
        data: persisted,
        requestId: input.requestId,
      })
      if (!isLedgerEvent(probe)) {
        // 消息里显式点出**数组**与 **requestId** 这两个新收窄项（OCR 评审 [17]/[18]）：
        // 否则调用方拿到「无法通过 isLedgerEvent」却不知道该改哪一处，会去查 kind 或 reader。
        const why = Array.isArray(persisted)
          ? '载荷是数组 —— 账本的载荷一律是具名对象（LedgerEventMap 里没有数组形状的载荷），' +
            '数组会让按 kind 收窄的消费方读 data.<字段> 得到 undefined。'
          : input.requestId !== undefined && (typeof input.requestId !== 'string' || input.requestId === '')
            ? `requestId 非法（${JSON.stringify(input.requestId)}）—— 它要么省略、要么是非空字符串。`
            : '载荷或 actor 的形状不满足 isLedgerEvent 的判定。'
        throw new TypeError(
          'LedgerCommitInput 组合后无法通过 isLedgerEvent（该守卫与读回路径共用）：' +
            `落盘会造出一条读不回来、从而毒化账本的事件。具体原因：${why}`,
        )
      }

      // 取头部与写入必须在同一个写事务里：否则两个进程并发提交会算出同一个 sequence
      // （PRIMARY KEY 冲突是小问题，真正的问题是序号出现空洞，而 AC-10-8 把「无空洞」
      // 当成账本的核心不变量）。
      db.exec('BEGIN IMMEDIATE')
      try {
        const head = readHead()
        const sequence = head.sequence + 1
        insertStatement.run(
          sequence,
          eventId,
          input.kind,
          occurredAt,
          actor.kind,
          actor.id,
          head.eventId,
          input.requestId ?? null,
          dataJson,
        )
        db.exec('COMMIT')
        return { eventId: eventId as EventId, sequence, occurredAt }
      } catch (error) {
        // OCR 评审 [4]：某些失败（如 SQLITE_FULL）会让 SQLite 自行回滚，
        // 此时再 ROLLBACK 会抛「cannot rollback - no transaction is active」，
        // 把真正的失败原因盖掉。回滚失败不该成为对外报告的错误。
        try {
          db.exec('ROLLBACK')
        } catch {
          // 事务已由 SQLite 自动回滚 —— 无事可做，且原始 error 才是要抛的。
        }
        throw error
      }
    },

    read(query: LedgerReadQuery): LedgerPage {
      assertOpen()

      const limit = normalizeLimit(query.limit)
      const scopes = query.scopes
      const queryKeys =
        scopes === undefined ? null : new Set(scopes.map(scopeKey))
      const want = limit + 1
      const batchSize = Math.max(want, READ_BATCH_FLOOR)

      const matched: LedgerEvent[] = []
      let cursor = normalizeAfterSequence(query.afterSequence)
      let exhausted = false

      // 空集短路：`scopes: []` 的 queryKeys 是**空集**，交集对任何事件都是空，
      // 结果可证明为空 —— 不必为此把整张表扫一遍（游标会一路推到表尾）。
      if (queryKeys !== null && queryKeys.size === 0) {
        return { events: [], hasMore: false, nextCursor: null }
      }

      // 下面遇到解析不出来的行就**抛错**（而不是跳过它继续返回其余事件），这是一个
      // 刻意的取舍，不是疏漏。第二轮的 OCR 评审提过改成「跳过坏行、降级返回」更宽容，
      // 我们**不采纳**，理由如下：
      //
      // 1. FR-10.2 要求前端视图只能是「账本事实的投影」。若 read() 静默跳过一条读不回来的事件，
      //    投影就会**少一条事实**却毫无提示 —— 界面看起来正常、内容却是错的。
      //    对「账本」这种东西，静默失真比可见失败严重得多。
      // 2. 「报告而不抛错」的职责已经有归属：`verifyIntegrity()` 按 SPEC §6.4 返回
      //    `{ok:false, brokenAt}` 且不抛错。所以坏行**并非无从发现**，错误信息里也直接
      //    给出了下一步（「请先跑 verifyIntegrity()」）。
      // 3. 坏行的唯一来源是外部直接改写库文件（append-only 触发器已挡住经本类的改删；
      //    正常写入路径的载荷现在也被 kind/data/requestId 校验 + isLedgerEvent 往返复核挡住）。
      //    也就是说这是一个「存储被破坏」的信号，此时让读取失败、逼调用方去看完整性自检，
      //    比让它带着残缺数据继续跑更安全。
      //
      // 若将来确有「单行损坏但要求账本仍可读」的部署需求，正确做法是**先扩契约**
      // （例如给 LedgerReadQuery 加 `onInvalidRow: 'throw' | 'skip'`），而不是在这里默默放宽。

      while (matched.length < want && !exhausted) {
        const rows = pageStatement.all(cursor, batchSize)
        if (rows.length === 0) {
          break
        }
        for (const raw of rows) {
          const parsed = toEventRow(raw)
          if (parsed === null) {
            throw new Error(
              '账本中存在无法解析的行（sequence 无法识别）：存储已被外部改写，请先跑 verifyIntegrity()。',
            )
          }
          cursor = parsed.sequence
          const event = rowToEvent(parsed)
          if (event === null) {
            throw new Error(
              `账本第 ${parsed.sequence} 行不是合法的 LedgerEvent：存储已被外部改写，请先跑 verifyIntegrity()。`,
            )
          }
          // scope 为 `[]` 时 queryKeys 是空集 —— 交集必然为空，故返回空页。
          // 这与「省略 scopes」不同（后者不过滤），是 SPEC §6.3 语义 1 与语义 2 的分界。
          if (queryKeys === null || intersects(queryKeys, event)) {
            matched.push(event)
          }
        }
        if (rows.length < batchSize) {
          exhausted = true
        }
      }

      const hasMore = matched.length > limit
      const events = hasMore ? matched.slice(0, limit) : matched
      const last = events[events.length - 1]
      return {
        events,
        hasMore,
        nextCursor: hasMore && last !== undefined ? last.sequence : null,
      }
    },

    head(): LedgerHead {
      assertOpen()
      return readHead()
    },

    verifyIntegrity(): LedgerIntegrity {
      assertOpen()

      let brokenAt: LedgerSequence | null = null
      let expected: LedgerSequence = 1
      let lastEventId: string | null = null
      let verified = 0

      // OCR 评审 [3]：分批遍历而不是 `all()` 一次性把所有行读进内存 ——
      // 账本按设计是无界增长的，全量物化是「活得越久越危险」的那一种写法。
      //
      // ⚠ 游标从 **Number.MIN_SAFE_INTEGER** 而不是 0 或 -1 起：`SELECT_PAGE_SQL` 的条件是
      // `sequence > ?`，游标取任何有限下界都只是把「被跳过的非法行」往后推一格：
      // 从 0 起会漏掉 `sequence = 0` 的行，从 -1 起会漏掉 `sequence = -5` 的行（两者都让自检
      // 报 ok:true —— 把「表里有脏行」读成「账本完好」）。
      // OCR 评审 [26] 指出 -1 只堵住了 0 这一个实例、没堵住这一类。取最小安全整数即可关闭
      // **整个**「小于游标的非法行」类别：不存在比它更小的安全整数序号。
      // （该性质由「序号重复/非法行被自检当作断裂」用例守住。）
      let cursor = Number.MIN_SAFE_INTEGER
      for (;;) {
        const rows = pageStatement.all(cursor, INTEGRITY_BATCH_SIZE)
        if (rows.length === 0) {
          break
        }
        let stop = false
        for (const raw of rows) {
          const parsed = toEventRow(raw)
          if (parsed === null) {
            // 连行结构都收窄不了：断裂点退化为「已连续通过的长度 + 1」，不猜它的真实序号。
            brokenAt = expected
            stop = true
            break
          }
          cursor = parsed.sequence
          const event = rowToEvent(parsed)
          if (event === null) {
            brokenAt = parsed.sequence
            stop = true
            break
          }
          if (parsed.sequence !== expected) {
            // 序号空洞或重复（重复被 PRIMARY KEY 挡住，这里主要抓空洞）。
            brokenAt = parsed.sequence
            stop = true
            break
          }
          if (expected === 1) {
            // AC-10-9：首条必须锚定在 1 且 previousEventId 为 null。
            if (event.previousEventId !== null) {
              brokenAt = parsed.sequence
              stop = true
              break
            }
          } else if (event.previousEventId !== lastEventId) {
            brokenAt = parsed.sequence
            stop = true
            break
          }
          lastEventId = event.eventId
          expected += 1
          verified += 1
        }
        if (stop || rows.length < INTEGRITY_BATCH_SIZE) {
          break
        }
      }

      return { ok: brokenAt === null, sequence: verified, brokenAt }
    },

    close(): void {
      if (closed) {
        return
      }
      closed = true
      db.close()
    },
  }
}
