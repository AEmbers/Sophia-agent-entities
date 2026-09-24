/**
 * 上游 `refs.ts`（281 行 / 12.1KB）的索菲亚版 —— **结构与函数体照抄**，只改三件事。
 *
 * ## 索菲亚移植点（逐条，只允许三类差异）
 *
 * | 上游 | 索菲亚 | 依据 |
 * |---|---|---|
 * | `import { useSyncExternalStore } from 'react'` | `hooks()` 惰性取 | 顶层值导入会多一条顶层模块加载调用，撞红「模块加载调用 ≤ 2」的既有断言（见 `../../react-runtime.ts` 文件头对照表）。⚠ 本行刻意**不写出那个字面量**（`require` + 左括号）—— 它是**文本级**计数的，写在注释里也会被算进去（本文件初版就因为这一行把计数从 2 顶到 3，实测于 `lib/client.js`）。 |
 * | `RemoteResult`（`@deepseek-ai/dsh-typert-protocol`） | `TeamRemoteResult`（`./slots.ts`） | 索菲亚没有那个包的类型桩（`upstream-modules.d.ts` 只声明 4 个模块） |
 * | `AgentTeamClientMemberStatus` 等类型源 | `./agent-team-types.ts` | 上游包 `@wowyuarm/dsh-agent-team/types` 在索菲亚不存在 |
 *
 * ## 两个 ref 种类的处置**不对称**（照抄上游结构，但只有一半有宿主）
 *
 * - **Task refs**：索菲亚**没有** ref 解析路由（`../../host.ts` 的路由清单里没有
 *   任何 resolve 端点）⇒ `hostTaskRefLookup` / `jumpToTaskThread` 收成 no-op。
 * - **Thread refs**：同上，`hostThreadRefLookup` / `jumpToThread` 也收成 no-op。
 *
 * 但两者的**缓存骨架（`createRefStore`）完整保留**：上游那套
 * 「并发去重 / 宿主不认的 ref 本次会话不再问 / 解析落地后唤醒所有已渲染链接」
 * 的语义是本文件的主体，且 `TeamMessage.tsx` 的 ref chip 渲染直接建在它上面。
 * 宿主补上解析路由后只要把两个 lookup 的 `request` 接回去即可，不用回上游再抄一遍。
 *
 * @module @sophia/core/client/vendor/team/refs
 */

import { hooks } from '../../react-runtime.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AgentTeamClientMemberStatus, AgentTeamChannelRef, AgentTeamMemberId,
  AgentTeamResolveTaskRefsRequest, AgentTeamResolveTaskRefsResult, AgentTeamResolveThreadRefsRequest, AgentTeamResolveThreadRefsResult,
  AgentTeamTaskRef, AgentTeamThreadRef,
} from './agent-team-types.ts'
import type { TeamChannelView, TeamRemoteResult } from './slots.ts'

/** Navigation facts for one branded Task ref, resolved once per session. */
export interface ResolvedTaskRef {
  readonly taskRef: AgentTeamTaskRef
  readonly channelRef: AgentTeamChannelRef
  readonly threadRef: AgentTeamThreadRef
  readonly taskNumber: number
}

/** Navigation facts for one branded Thread ref, resolved once per session. */
export interface ResolvedThreadRef {
  readonly threadRef: AgentTeamThreadRef
  readonly channelRef: AgentTeamChannelRef
  readonly taskRef?: AgentTeamTaskRef
  readonly taskNumber?: number
  /** Opening-line gist distinguishing one Thread chip from another. */
  readonly title: string
}

/** One roster-resolved Member behind a `member:` chip. */
export interface ResolvedMemberRef {
  readonly memberId: AgentTeamMemberId
  /** Bare handle without the `@`; the chip renders it. */
  readonly handle: string
  /**
   * Present for agent Members; absent for the Human (no session to open).
   *
   * ⚠ 索菲亚**恒缺席**：索菲亚没有「把成员会话嵌进会话座」这条路
   * （`slots.ts` 剥掉的 `openMemberSession`），`WireMember` 也没有 `sessionId`
   * （见 `../../wire.ts`）。⇒ `openable` 恒 `false`，字段保留是为了让上游的
   * chip 分支结构不动（`TeamMessage` 的 `resolved.openable` 判断照抄）。
   */
  readonly sessionId?: SessionId
  /** Only active agent Members open a session — mirrors the agent card rule. */
  readonly openable: boolean
}

/** Compare refs by branded prefix plus hyphen-stripped UUID, so abbreviated spellings line up with their full form. */
export function refKeyOf(ref: string): string {
  return ref.toLowerCase().replaceAll('-', '')
}

type Listener = () => void

/** Session cache behind one Host-resolved ref kind: resolved entries, in-flight refs, and parked unknowns. */
interface RefStore<TEntry, TRef extends string> {
  readonly useVersion: () => number
  readonly cached: (ref: TRef) => TEntry | undefined
  readonly remember: (entry: TEntry) => void
  readonly resolveUnknown: (refs: readonly TRef[], lookup: (refs: readonly TRef[]) => Promise<readonly TEntry[]>) => Promise<void>
}

/**
 * One versioned resolution cache per Host-resolved ref kind. Concurrent
 * callers deduplicate through the pending set; refs the Host does not know
 * are parked for the session so renders never retry-loop; a landing
 * resolution wakes every rendered link through the version token.
 */
function createRefStore<TEntry, TRef extends string>(refOf: (entry: TEntry) => TRef): RefStore<TEntry, TRef> {
  const resolved = new Map<TRef, TEntry>()
  const pending = new Set<TRef>()
  /** Refs the Host did not recognize; never re-queried (no retry loops). */
  const unresolvable = new Set<TRef>()
  const listeners = new Set<Listener>()
  let version = 0

  const emit = (): void => {
    version += 1
    for (const listener of listeners) listener()
  }

  const subscribe = (listener: Listener): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  /** Stable snapshot token; the map is read directly after this changes. */
  const getSnapshot = (): number => version

  /**
   * React binding: re-renders the caller when any ref resolution lands.
   *
   * ⚠ 索菲亚移植点：上游是 `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)`
   * 的**直接引用**（顶层导入的那个值）。这里改成**每次调用时**从 `hooks()` 取 ——
   * 本函数只在渲染期被调用，惰性取成立（`react-runtime.ts` 的 `hooks()` 说明）。
   */
  const useVersion = (): number => {
    const { useSyncExternalStore } = hooks()
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  }

  const cached = (ref: TRef): TEntry | undefined => resolved.get(ref)

  /** Store one resolution (click path) and wake every rendered link. */
  const remember = (entry: TEntry): void => {
    resolved.set(refOf(entry), entry)
    pending.delete(refOf(entry))
    emit()
  }

  /**
   * Batch-resolve unknown refs through the Host lookup. Concurrent callers
   * deduplicate through the pending set; failures just clear the pending mark
   * so a later interaction can retry.
   */
  const resolveUnknown = async (
    refs: readonly TRef[],
    lookup: (refs: readonly TRef[]) => Promise<readonly TEntry[]>,
  ): Promise<void> => {
    const missing = refs.filter(ref => !resolved.has(ref) && !pending.has(ref) && !unresolvable.has(ref))
    if (missing.length === 0) return
    for (const ref of missing) pending.add(ref)
    try {
      const entries = await lookup(missing)
      for (const entry of entries) {
        resolved.set(refOf(entry), entry)
        pending.delete(refOf(entry))
      }
      // Refs the Host does not know are parked for the session: re-querying
      // them on every render would loop and hammer the Host.
      for (const ref of missing) {
        if (!resolved.has(ref)) unresolvable.add(ref)
      }
      if (entries.length > 0) emit()
    } finally {
      for (const ref of missing) pending.delete(ref)
    }
  }

  return { useVersion, cached, remember, resolveUnknown }
}

const taskStore = createRefStore((entry: ResolvedTaskRef) => entry.taskRef)
const threadStore = createRefStore((entry: ResolvedThreadRef) => entry.threadRef)

/** React binding: re-renders the caller when any Task ref resolution lands. */
export const useResolvedTaskRefVersion = taskStore.useVersion
export const cachedResolvedTaskRef = taskStore.cached
/** Store one Task resolution (click path) and wake every rendered link. */
export const rememberResolvedTaskRef = taskStore.remember
export const resolveUnknownTaskRefs = taskStore.resolveUnknown

/** React binding: re-renders the caller when any Thread ref resolution lands. */
export const useResolvedThreadRefVersion = threadStore.useVersion
export const cachedResolvedThreadRef = threadStore.cached
/** Store one Thread resolution (click path) and wake every rendered link. */
export const rememberResolvedThreadRef = threadStore.remember
export const resolveUnknownThreadRefs = threadStore.resolveUnknown

/**
 * Click-path Host lookup shared by both ref kinds: remember every resolved
 * entry and hand them back for immediate navigation. The Host keeps
 * `resolved` in the same order as the input refs (one entry per resolvable
 * input, unknowns omitted); the pairing walk below relies on that contract,
 * so it must be preserved together with this implementation. The Host
 * answers with full refs even for abbreviated inputs; the returned entries
 * keep the input order, so the walk remembers each authored spelling as an
 * alias of its resolution.
 *
 * ⚠ 索菲亚里**两个调用方都不再走到这里**（宿主没有解析路由，两个 lookup 收成
 * no-op，见下），但这个函数**逐字保留**：它是上游那套「按输入顺序记住别名」
 * 契约的载体，删了就等于把契约一起删掉。将来接回解析路由要按它写。
 */
async function hostRefLookup<TEntry, TRef extends string>(
  remember: (entry: TEntry) => void,
  refOf: (entry: TEntry) => TRef,
  alias: (entry: TEntry, ref: TRef) => TEntry,
  request: (refs: readonly TRef[]) => Promise<TeamRemoteResult<readonly TEntry[]>>,
  refs: readonly TRef[],
): Promise<readonly TEntry[]> {
  const result = await request(refs)
  if (!result.ok) return []
  const entries = result.value
  let entryIndex = 0
  for (const requested of refs) {
    const entry = entries[entryIndex]
    if (entry === undefined || !refKeyOf(refOf(entry)).startsWith(refKeyOf(requested))) continue
    if (refOf(entry) !== requested) remember(alias(entry, requested))
    remember(entry)
    entryIndex += 1
  }
  return entries
}

/**
 * Click-path Task lookup: remember every resolved entry and hand them back
 * for immediate navigation (see hostRefLookup for the ordering contract).
 *
 * ⚠ 索菲亚处置：**收成 no-op**。`../../host.ts` 的路由清单（`ROUTE_PREFIX`
 * 各注册点：`status` / `view` / `avatar` / `member/model` / `spawn/decision` /
 * `channel` / `member` / `member/lifecycle` / `dag/ownership` / `team/message`）
 * 里**没有任何 ref 解析端点**，而索菲亚的 `WireTask` 与 `WireThread` 之间也没有
 * 外键（`../../wire.ts`：`WireTask` 只有 `taskId/title/status/assigneeMemberId/blockedBy`）。
 * ⇒ 两个调用点收空结果，界面表现为「点了任务引用不跳转」——与
 * `adapters.ts` 的 `CAN_OPEN_REFS = false` 一致（那些引用本来也不渲染成链接）。
 * 空结果而不是抛错：一个增强性跳转能力缺失不该让整页打不开。
 */
export const hostTaskRefLookup = (
  _resolveTaskRefs: ((request: AgentTeamResolveTaskRefsRequest) => Promise<TeamRemoteResult<AgentTeamResolveTaskRefsResult>>) | undefined,
  _workspaceId: string | undefined,
): ((taskRefs: readonly AgentTeamTaskRef[]) => Promise<readonly ResolvedTaskRef[]>) =>
  async () => []

/**
 * Click-path Thread lookup: remember every resolved entry and hand them back
 * for immediate navigation (see hostRefLookup for the ordering contract).
 *
 * ⚠ 索菲亚处置：同 `hostTaskRefLookup` —— 宿主没有解析路由 ⇒ 收成 no-op。
 */
export const hostThreadRefLookup = (
  _resolveThreadRefs: ((request: AgentTeamResolveThreadRefsRequest) => Promise<TeamRemoteResult<AgentTeamResolveThreadRefsResult>>) | undefined,
  _workspaceId: string | undefined,
): ((threadRefs: readonly AgentTeamThreadRef[]) => Promise<readonly ResolvedThreadRef[]>) =>
  async () => []

/** Resolve one Task ref through the Host and jump to its home Channel Thread. */
export const jumpToTaskThread = (
  _resolveTaskRefs: ((request: AgentTeamResolveTaskRefsRequest) => Promise<TeamRemoteResult<AgentTeamResolveTaskRefsResult>>) | undefined,
  _workspaceId: string | undefined,
  _taskRef: AgentTeamTaskRef,
  _selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void,
): void => {
  // 见 `hostTaskRefLookup` 的说明：索菲亚没有 ref 解析路由 ⇒ 无动作。
}

/** Resolve one Thread ref through the Host and jump to its home Channel Thread. */
export const jumpToThread = (
  _resolveThreadRefs: ((request: AgentTeamResolveThreadRefsRequest) => Promise<TeamRemoteResult<AgentTeamResolveThreadRefsResult>>) | undefined,
  _workspaceId: string | undefined,
  _threadRef: AgentTeamThreadRef,
  _selectThread: (threadRef: AgentTeamThreadRef, channelRef?: AgentTeamChannelRef, taskRef?: AgentTeamTaskRef, taskNumber?: number) => void,
): void => {
  // 见 `hostThreadRefLookup` 的说明：索菲亚没有 ref 解析路由 ⇒ 无动作。
}

/** Exactly one roster entry whose full key extends the authored spelling; ambiguity resolves to nothing. */
function uniqueByPrefix<T>(entries: readonly T[], keyOf: (entry: T) => string, authored: string): T | undefined {
  const key = refKeyOf(authored)
  const hits = entries.filter(entry => refKeyOf(keyOf(entry)).startsWith(key))
  return hits.length === 1 ? hits[0] : undefined
}

/**
 * Display name for one authored channel ref, or undefined when the loaded
 * roster does not know it — the caller keeps plain text. Archived Channels
 * never resolve: they are gone from every Team surface, so their refs are
 * not links either.
 *
 * ⚠ 索菲亚移植点：上游收 `AgentTeamChannel[]` 并过滤 `channel.state === 'active'`。
 * 索菲亚**没有频道归档状态**（`WireChannel` 只有 `channelId/title/threads`，
 * 见 `../../wire.ts`）⇒ 收索菲亚的 `TeamChannelView['channels']` 形状
 * （`{ channelRef, name, threads }`，见 `slots.ts`），过滤条件去掉。
 * 「归档频道不算链接」这条语义在索菲亚没有对应事实，故不假装有。
 */
export const rosterChannelName = (
  channels: TeamChannelView['channels'],
  channelRef: AgentTeamChannelRef,
): string | undefined =>
  uniqueByPrefix(channels, channel => channel.channelRef, channelRef)?.name

/**
 * Roster facts for one authored member ref, or undefined when nobody on the
 * roster answers to it — the caller keeps plain text. The Human resolves to
 * a handle with no session: informative, never a link.
 *
 * ⚠ 索菲亚移植点：`humanMemberId` / `humanHandle` 两个入参保留（上游形状），
 * 但索菲亚**没有人类成员这一维**（主人不是名册里的成员，见 `slots.ts`
 * 剥掉 `humanName` 的理由）⇒ 调用点恒传 `undefined` / `''`，那一段不会命中。
 * `openable` 也恒 `false`：`WireMember` 没有 `sessionId` 可开。
 */
export const rosterMember = (
  members: readonly AgentTeamClientMemberStatus[],
  humanMemberId: AgentTeamMemberId | undefined,
  humanHandle: string,
  memberRef: AgentTeamMemberId,
): ResolvedMemberRef | undefined => {
  if (humanMemberId !== undefined && refKeyOf(memberRef) === refKeyOf(humanMemberId)) {
    return { memberId: humanMemberId, handle: humanHandle, openable: false }
  }
  const hit = uniqueByPrefix(members, status => status.member.memberId, memberRef)
  if (hit === undefined) return undefined
  return {
    memberId: hit.member.memberId,
    handle: hit.member.handle.replace(/^@/, ''),
    // 见上方说明：索菲亚没有可打开的成员会话 ⇒ 不带 `sessionId`、`openable` 恒 false。
    openable: false,
  }
}

/** 供结构门禁/父 agent 核对的取值：索菲亚的 ref 解析能力恒为「无」。 */
export const TASK_REF_RESOLUTION_AVAILABLE = false as const

/** 兜底：`refKeyOf` 目前无「真实解析」调用点（解析链已收成空）—— 保留并显式标注，避免被当成死代码删掉。 */
export const __refKeyOfForFutureHostRoute = refKeyOf
