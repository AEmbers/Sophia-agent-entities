import { useSyncExternalStore } from 'react';
/** Compare refs by branded prefix plus hyphen-stripped UUID, so abbreviated spellings line up with their full form. */
export function refKeyOf(ref) {
    return ref.toLowerCase().replaceAll('-', '');
}
/**
 * One versioned resolution cache per Host-resolved ref kind. Concurrent
 * callers deduplicate through the pending set; refs the Host does not know
 * are parked for the session so renders never retry-loop; a landing
 * resolution wakes every rendered link through the version token.
 */
function createRefStore(refOf) {
    const resolved = new Map();
    const pending = new Set();
    /** Refs the Host did not recognize; never re-queried (no retry loops). */
    const unresolvable = new Set();
    const listeners = new Set();
    let version = 0;
    const emit = () => {
        version += 1;
        for (const listener of listeners)
            listener();
    };
    const subscribe = (listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    };
    /** Stable snapshot token; the map is read directly after this changes. */
    const getSnapshot = () => version;
    /** React binding: re-renders the caller when any ref resolution lands. */
    const useVersion = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const cached = (ref) => resolved.get(ref);
    /** Store one resolution (click path) and wake every rendered link. */
    const remember = (entry) => {
        resolved.set(refOf(entry), entry);
        pending.delete(refOf(entry));
        emit();
    };
    /**
     * Batch-resolve unknown refs through the Host lookup. Concurrent callers
     * deduplicate through the pending set; failures just clear the pending mark
     * so a later interaction can retry.
     */
    const resolveUnknown = async (refs, lookup) => {
        const missing = refs.filter(ref => !resolved.has(ref) && !pending.has(ref) && !unresolvable.has(ref));
        if (missing.length === 0)
            return;
        for (const ref of missing)
            pending.add(ref);
        try {
            const entries = await lookup(missing);
            for (const entry of entries) {
                resolved.set(refOf(entry), entry);
                pending.delete(refOf(entry));
            }
            // Refs the Host does not know are parked for the session: re-querying
            // them on every render would loop and hammer the Host.
            for (const ref of missing) {
                if (!resolved.has(ref))
                    unresolvable.add(ref);
            }
            if (entries.length > 0)
                emit();
        }
        finally {
            for (const ref of missing)
                pending.delete(ref);
        }
    };
    return { useVersion, cached, remember, resolveUnknown };
}
const taskStore = createRefStore((entry) => entry.taskRef);
const threadStore = createRefStore((entry) => entry.threadRef);
/** React binding: re-renders the caller when any Task ref resolution lands. */
export const useResolvedTaskRefVersion = taskStore.useVersion;
export const cachedResolvedTaskRef = taskStore.cached;
/** Store one Task resolution (click path) and wake every rendered link. */
export const rememberResolvedTaskRef = taskStore.remember;
export const resolveUnknownTaskRefs = taskStore.resolveUnknown;
/** React binding: re-renders the caller when any Thread ref resolution lands. */
export const useResolvedThreadRefVersion = threadStore.useVersion;
export const cachedResolvedThreadRef = threadStore.cached;
/** Store one Thread resolution (click path) and wake every rendered link. */
export const rememberResolvedThreadRef = threadStore.remember;
export const resolveUnknownThreadRefs = threadStore.resolveUnknown;
/**
 * Click-path Host lookup shared by both ref kinds: remember every resolved
 * entry and hand them back for immediate navigation. The Host keeps
 * `resolved` in the same order as the input refs (one entry per resolvable
 * input, unknowns omitted); the pairing walk below relies on that contract,
 * so it must be preserved together with this implementation. The Host
 * answers with full refs even for abbreviated inputs; the returned entries
 * keep the input order, so the walk remembers each authored spelling as an
 * alias of its resolution.
 */
async function hostRefLookup(remember, refOf, alias, request, refs) {
    const result = await request(refs);
    if (!result.ok)
        return [];
    const entries = result.value;
    let entryIndex = 0;
    for (const requested of refs) {
        const entry = entries[entryIndex];
        if (entry === undefined || !refKeyOf(refOf(entry)).startsWith(refKeyOf(requested)))
            continue;
        if (refOf(entry) !== requested)
            remember(alias(entry, requested));
        remember(entry);
        entryIndex += 1;
    }
    return entries;
}
/**
 * Click-path Task lookup: remember every resolved entry and hand them back
 * for immediate navigation (see hostRefLookup for the ordering contract).
 */
export const hostTaskRefLookup = (resolveTaskRefs, workspaceId) => async (taskRefs) => hostRefLookup(rememberResolvedTaskRef, entry => entry.taskRef, (entry, taskRef) => ({ ...entry, taskRef }), async (refs) => {
    const result = await resolveTaskRefs({ workspaceId, taskRefs: refs });
    return result.ok ? { ok: true, value: result.value.resolved } : result;
}, taskRefs);
/**
 * Click-path Thread lookup: remember every resolved entry and hand them back
 * for immediate navigation (see hostRefLookup for the ordering contract).
 */
export const hostThreadRefLookup = (resolveThreadRefs, workspaceId) => async (threadRefs) => hostRefLookup(rememberResolvedThreadRef, entry => entry.threadRef, (entry, threadRef) => ({ ...entry, threadRef }), async (refs) => {
    const result = await resolveThreadRefs({ workspaceId, threadRefs: refs });
    return result.ok ? { ok: true, value: result.value.resolved } : result;
}, threadRefs);
/** Resolve one Task ref through the Host and jump to its home Channel Thread. */
export const jumpToTaskThread = (resolveTaskRefs, workspaceId, taskRef, selectThread) => {
    void resolveTaskRefs({ workspaceId, taskRefs: [taskRef] }).then(result => {
        if (!result.ok)
            return;
        const hit = result.value.resolved[0];
        if (hit !== undefined)
            selectThread(hit.threadRef, hit.channelRef, hit.taskRef, hit.taskNumber);
    });
};
/** Resolve one Thread ref through the Host and jump to its home Channel Thread. */
export const jumpToThread = (resolveThreadRefs, workspaceId, threadRef, selectThread) => {
    void resolveThreadRefs({ workspaceId, threadRefs: [threadRef] }).then(result => {
        if (!result.ok)
            return;
        const hit = result.value.resolved[0];
        if (hit !== undefined)
            selectThread(hit.threadRef, hit.channelRef, hit.taskRef, hit.taskNumber);
    });
};
/** Exactly one roster entry whose full key extends the authored spelling; ambiguity resolves to nothing. */
function uniqueByPrefix(entries, keyOf, authored) {
    const key = refKeyOf(authored);
    const hits = entries.filter(entry => refKeyOf(keyOf(entry)).startsWith(key));
    return hits.length === 1 ? hits[0] : undefined;
}
/**
 * Display name for one authored channel ref, or undefined when the loaded
 * roster does not know it — the caller keeps plain text. Archived Channels
 * never resolve: they are gone from every Team surface, so their refs are
 * not links either.
 */
export const rosterChannelName = (channels, channelRef) => uniqueByPrefix(channels.filter(channel => channel.state === 'active'), channel => channel.channelRef, channelRef)?.name;
/**
 * Roster facts for one authored member ref, or undefined when nobody on the
 * roster answers to it — the caller keeps plain text. The Human resolves to
 * a handle with no session: informative, never a link.
 */
export const rosterMember = (members, humanMemberId, humanHandle, memberRef) => {
    if (humanMemberId !== undefined && refKeyOf(memberRef) === refKeyOf(humanMemberId)) {
        return { memberId: humanMemberId, handle: humanHandle, openable: false };
    }
    const hit = uniqueByPrefix(members, status => status.member.memberId, memberRef);
    if (hit === undefined)
        return undefined;
    const openable = hit.availability === 'active';
    return {
        memberId: hit.member.memberId,
        handle: hit.member.handle.replace(/^@/, ''),
        ...(openable ? { sessionId: hit.member.sessionId } : {}),
        openable,
    };
};
