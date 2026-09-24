/**
 * Human presentation preference for the Team sidebar: whether each disclosure
 * section (workspaces / channels / agents) is expanded. The state lives in
 * this browser only — it is UI taste, never a shared Team fact, so nothing
 * here touches the ledger. Same storage discipline as `sidebar-order.ts`: one
 * localStorage key, defensive parsing, a read-through cache over the raw
 * payload so writes from other tabs are picked up, and an in-memory fallback
 * when storage is unavailable.
 *
 * ⚠ 索菲亚移植点（**只改取用方式，其余逐字照抄**）：
 * 1. 上游 `import { useCallback, useSyncExternalStore } from 'react'` 是**顶层值导入**，
 *    会在产物里多出一条顶层模块加载调用，撞红「产物里顶层模块加载调用 ≤ 2」的既有断言。
 *    索菲亚的现成手法是 `react-runtime.ts` 的 `hooks()` 惰性取用（见该文件头）。
 *    调用点写法不变，只在 `useSidebarSectionOpen` 里解构一次 —— 与
 *    `TeamPresenceDot.tsx` 取 `primitives` 的方式同源。
 * 2. 上游 `import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'`
 *    —— 索菲亚没有这个包（类型不在 `upstream-modules.d.ts`，值会被
 *    `sophia-client-bundle-purity` 拒绝）。索菲亚的同名不透明串在 `./ids.ts`。
 *    它在本文件里**只做相等/拼接**（见 `sectionKey`），语义逐字相容。
 */
import { hooks } from '../../react-runtime.ts'
import type { WorkspaceId } from './ids.ts'

/** Which sidebar section a collapse state belongs to. */
export type TeamSidebarSectionKind = 'channels' | 'agents'

const STORAGE_KEY = 'dsh.agent-team.sidebar-sections'

function sectionKey(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind): string | undefined {
  // Both panels are per-workspace: the Team shell remounts them on workspace
  // switch, and the Workspace selector above them is a field rather than a
  // collapsible section, so it keeps no preference of its own.
  return workspaceId === undefined ? undefined : `${workspaceId}|${kind}`
}

const MEMORY_ONLY = Symbol('sidebar-sections.memory')

/** Read-through parse cache over the raw persisted payload; see `sidebar-order.ts`. */
let cachedRaw: string | null | typeof MEMORY_ONLY | undefined
let cachedCollapsed: ReadonlySet<string> = new Set()

function storedCollapsed(): ReadonlySet<string> {
  let raw: string | null = null
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  } catch {
    raw = null
  }
  if (cachedRaw !== undefined && raw !== null && raw === (cachedRaw as string)) return cachedCollapsed
  if (raw === null) {
    if (cachedRaw === MEMORY_ONLY) return cachedCollapsed
    cachedRaw = raw
    cachedCollapsed = new Set()
    return cachedCollapsed
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    const keys = (parsed as Record<string, unknown>).collapsed
    if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) throw new Error('bad shape')
    cachedRaw = raw
    cachedCollapsed = new Set(keys)
    return cachedCollapsed
  } catch {
    // Corrupted payloads degrade to "no preference"; the next valid write
    // replaces them.
    return new Set()
  }
}

function writeCollapsed(collapsed: ReadonlySet<string>): void {
  cachedCollapsed = collapsed
  try {
    if (typeof localStorage === 'undefined') throw new Error('no localStorage')
    const raw = JSON.stringify({ collapsed: [...collapsed] })
    localStorage.setItem(STORAGE_KEY, raw)
    cachedRaw = raw
    return
  } catch {
    // Private mode and quota failures do not block folding; the session keeps
    // serving the in-memory state above.
    cachedRaw = MEMORY_ONLY
  }
}

const listeners = new Set<() => void>()

/**
 * Effective expanded state for one sidebar section: `false` only when this
 * browser explicitly collapsed it. Booleans are primitives, so the snapshot
 * is naturally identity-stable for `useSyncExternalStore`.
 */
export function useSidebarSectionOpen(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind): boolean {
  const { useCallback, useSyncExternalStore } = hooks()
  const key = sectionKey(workspaceId, kind)
  const subscribe = useCallback((listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  return useSyncExternalStore(subscribe,
    () => key === undefined ? true : !storedCollapsed().has(key),
    () => key === undefined ? true : !storedCollapsed().has(key))
}

/**
 * The only mutation path: record one section's expanded state for this
 * browser. Unknown keys (missing workspace) no-op so an unloaded workspace
 * never persists a phantom preference.
 */
export function setSidebarSectionOpen(workspaceId: WorkspaceId | undefined, kind: TeamSidebarSectionKind, open: boolean): void {
  const key = sectionKey(workspaceId, kind)
  if (key === undefined) return
  const next = new Set(storedCollapsed())
  if (open) next.delete(key)
  else next.add(key)
  writeCollapsed(next)
  for (const listener of listeners) listener()
}
