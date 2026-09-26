/**
 * Human presentation preference for the Team sidebar: the row order of the
 * Channels and Agents lists. The order lives in this browser only — it is UI
 * taste, never a shared Team fact, so nothing here touches the ledger.
 *
 * One deep module owns the whole concern: storage, reconcile against the
 * current Remote order (drop removed refs, keep the user's relative order,
 * append newcomers in default order), the single `moveSidebarItem` mutation
 * behind whole-row drag, and a small subscription hook with snapshot-stable
 * results for `useSyncExternalStore`.
 */
import { useCallback, useSyncExternalStore } from 'react';
const STORAGE_KEY = 'dsh.agent-team.sidebar-order';
function listKey(workspaceId, kind) {
    return workspaceId === undefined ? undefined : `${workspaceId}|${kind}`;
}
const MEMORY_ONLY = Symbol('sidebar-order.memory');
/**
 * Read-through parse cache over the raw persisted payload: repeated snapshots
 * skip re-validating an unchanged payload, while anything written outside this
 * module — another tab, devtools, a cleared store — is picked up because the
 * raw comparison misses.
 */
let cachedRaw;
let cachedOrders = {};
/**
 * Parse persisted orders defensively: private mode, quota errors, and stale
 * or corrupted payloads all degrade to "no preference" instead of breaking
 * the sidebar.
 */
function storedOrders() {
    let raw = null;
    try {
        raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    }
    catch {
        raw = null;
    }
    if (cachedRaw !== undefined && raw !== null && raw === cachedRaw)
        return cachedOrders;
    if (raw === null) {
        if (cachedRaw === MEMORY_ONLY)
            return cachedOrders;
        cachedRaw = raw;
        cachedOrders = {};
        return cachedOrders;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('not an object');
        const clean = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (!Array.isArray(value) || !value.every(entry => typeof entry === 'string'))
                continue;
            clean[key] = value;
        }
        cachedRaw = raw;
        cachedOrders = clean;
        return cachedOrders;
    }
    catch {
        return {};
    }
}
function saveOrder(key, refs) {
    const next = { ...structuredClone(storedOrders()), [key]: refs };
    cachedOrders = next;
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = JSON.stringify(next);
            localStorage.setItem(STORAGE_KEY, raw);
            cachedRaw = raw;
            return;
        }
    }
    catch {
        // Private mode and quota failures do not block reordering; the session
        // keeps serving the in-memory order below.
    }
    cachedRaw = MEMORY_ONLY;
}
/**
 * Merge the saved personal order into the current Remote order: kept refs
 * stay in the user's relative order with duplicates collapsed, removed refs
 * disappear, and new refs join in their Remote default positions after the
 * known ones.
 */
export function reconcileSidebarOrder(saved, current) {
    const present = new Set(current);
    const seen = new Set();
    const merged = [];
    for (const ref of saved) {
        if (seen.has(ref) || !present.has(ref))
            continue;
        seen.add(ref);
        merged.push(ref);
    }
    for (const ref of current) {
        if (seen.has(ref))
            continue;
        seen.add(ref);
        merged.push(ref);
    }
    return merged;
}
let revision = 0;
const listeners = new Set();
const snapshots = new Map();
function savedFingerprint(key) {
    const saved = storedOrders()[key];
    return saved === undefined ? '' : `f${saved.length}:${saved.join(',')}`;
}
function emitChange() {
    revision += 1;
    for (const listener of listeners)
        listener();
}
function orderedSnapshot(workspaceId, kind, refs) {
    const key = listKey(workspaceId, kind);
    if (key === undefined)
        return refs;
    const signature = refs.join('\u0000');
    const fingerprint = savedFingerprint(key);
    const hit = snapshots.get(key);
    if (hit !== undefined && hit.atRevision === revision && hit.signature === signature && hit.savedFingerprint === fingerprint) {
        return hit.result;
    }
    const result = reconcileSidebarOrder(storedOrders()[key] ?? [], refs);
    snapshots.set(key, { atRevision: revision, signature, savedFingerprint: fingerprint, result });
    return result;
}
/**
 * Effective row order for one sidebar list: the user's saved order folded
 * into the given Remote default order. Identity-stable across renders while
 * neither the data nor this browser's preference changes.
 */
export function useSidebarOrder(workspaceId, kind, refs) {
    const subscribe = useCallback((listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, []);
    return useSyncExternalStore(subscribe, () => orderedSnapshot(workspaceId, kind, refs), () => orderedSnapshot(workspaceId, kind, refs));
}
/**
 * The only mutation path: move `movedRef` to the given side of `targetRef`
 * inside the list's current effective order. Returns the new order, or
 * `undefined` when the request cannot change anything (unknown refs, dropping
 * a row onto itself, or an adjacent marker that would put it right back).
 * Persistence and subscriber notification happen here.
 */
export function moveSidebarItem(workspaceId, kind, refs, movedRef, targetRef, marker) {
    const key = listKey(workspaceId, kind);
    const from = refs.indexOf(movedRef);
    const nextFromTarget = refs.indexOf(targetRef);
    if (key === undefined || from < 0 || nextFromTarget < 0 || movedRef === targetRef)
        return undefined;
    const next = [...refs];
    const [item] = next.splice(from, 1);
    if (item === undefined)
        return undefined;
    const insertAt = next.indexOf(targetRef) + (marker === 'after' ? 1 : 0);
    if (insertAt === from)
        return undefined;
    next.splice(insertAt, 0, item);
    saveOrder(key, next);
    snapshots.delete(key);
    emitChange();
    return next;
}
