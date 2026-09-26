import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, DisclosureRow, IconChevronLeftOutlineRegular, IconChecklistOutlineRegular, Modal, Pill } from '@deepseek-ai/dsh-client-ui-primitives';
import { TeamComposer } from "./TeamComposer.js";
import { diagnosticText, TeamPresenceDot } from "./TeamPresenceDot.js";
import { TeamMessage } from "./TeamMessage.js";
import { TeamRunDivider } from "./TeamRunDivider.js";
import { firstSentence, formatActivity, formatClaimState, formatRiskClass, formatTaskStatus, formatTaskTitle, mentionNameOf, mentionNamesOf, mentionedMemberIds, taskStatusDot } from "./team-formatters.js";
import { TeamStateDot } from "./TeamStateDot.js";
import { mintRequestId, uploadComposerFiles } from "./requests.js";
import { daySeparatorLabel, isRunGap, timelineDayKey } from "./team-separators.js";
import { useTimelineScroll } from "./timeline-scroll.js";
import { hostTaskRefLookup, jumpToTaskThread } from "./refs.js";
import { hostThreadRefLookup, jumpToThread } from "./refs.js";
import { rosterChannelName, rosterMember } from "./refs.js";
import css from './conversation.module.css';
import threadCss from './thread.module.css';
function factKey(fact) {
    return fact.kind === 'message' ? `message:${fact.message.messageRef}` : `activity:${fact.activity.activityRef}`;
}
function messageFact(message, mentions = []) {
    return { kind: 'message', sequence: message.sequence, message, mentions, occurredAt: message.occurredAt };
}
/**
 * A fact owns its mention array, so the rendered name list is cached against
 * that array. Every roster refresh replaces the handles map with a fresh Map of
 * identical content, so the cache compares the resolved names rather than the
 * map identity: identity stays stable while the names are unchanged, which is
 * what keeps a memoized row from re-rendering on every refresh.
 */
const mentionNamesCache = new WeakMap();
function stableMentionNames(mentions, handles, humanName) {
    const names = mentionNamesOf(mentions, handles, humanName);
    const cached = mentionNamesCache.get(mentions);
    if (cached !== undefined && cached.length === names.length && cached.every((name, index) => mentionNameOf(name) === mentionNameOf(names[index])))
        return cached;
    mentionNamesCache.set(mentions, names);
    return names;
}
function mergeFacts(...groups) {
    const byKey = new Map();
    for (const group of groups)
        for (const fact of group)
            byKey.set(factKey(fact), fact);
    return [...byKey.values()].sort((left, right) => left.sequence - right.sequence);
}
function minSequence(facts) {
    return facts.reduce((minimum, fact) => minimum === undefined ? fact.sequence : Math.min(minimum, fact.sequence), undefined);
}
function readMeta(facts) {
    return new Map(facts.map(fact => [factKey(fact.fact), fact]));
}
export function TeamThreadPage(props) {
    const { workspaceId, humanName, humanAvatarUrl, channelRef, taskRef, threadRef, taskNumber, backToWorkspace, selectChannel, selectThread, resolveTaskRefs, resolveThreadRefs, openMemberSession, putAttachment, loadChannels, readThread, loadThreadHistory, threadObservations, subscribeChanges, loadMembers, drafts, getAttachment, reply, changeTask, promoteThread, t, } = props;
    const threadRequest = { threadRef, ...(taskRef === undefined ? {} : { taskRef }) };
    const [projection, setProjection] = useState();
    const [channelView, setChannelView] = useState();
    const [members, setMembers] = useState([]);
    // Current Thread followers; the composer ranks them first because a mention
    // to a follower delivers directly instead of entering the invite detour.
    const [followerIds, setFollowerIds] = useState(() => new Set());
    const [currentFacts, setCurrentFacts] = useState([]);
    const [olderFacts, setOlderFacts] = useState([]);
    const [readFacts, setReadFacts] = useState([]);
    const [historyCursor, setHistoryCursor] = useState();
    const [historyHasMore, setHistoryHasMore] = useState(false);
    // A bounded read acknowledges at most 20 unread facts; larger backlogs need
    // continuation reads. Reads also never self-wake a change scope, so a
    // backlog beyond a handful of batches would otherwise linger forever. The
    // cap stops a pathological feed (facts arriving faster than they are read)
    // from looping without bound; the error surface keeps the remainder visible.
    const MAX_AUTO_READ_ROUNDS = 50;
    const [autoReadExhausted, setAutoReadExhausted] = useState(false);
    const [newFactsCount, setNewFactsCount] = useState(0);
    // The reply draft lives in the keyed draft cache: view switches unmount
    // this page, and a refresh must not cost the half-written message either.
    // The composer owns the subscription — this page only reads a snapshot when
    // it sends, so typing never re-renders the timeline.
    const draftKey = `thread:${threadRef}`;
    const [claimsOpen, setClaimsOpen] = useState(false);
    // Early acceptance: the Human may accept while Claims are still open; the
    // confirm dialog lists exactly what will be completed with the Task.
    const [confirmingAccept, setConfirmingAccept] = useState(false);
    useEffect(() => {
        if (confirmingAccept && projection?.task?.resolution === 'accepted')
            setConfirmingAccept(false);
    }, [confirmingAccept, projection?.task?.resolution]);
    const [replyRequestId, setReplyRequestId] = useState();
    const [confirmation, setConfirmation] = useState();
    const [statusMessage, setStatusMessage] = useState();
    const [pending, setPending] = useState(false);
    // Label source for the promote/accept buttons only: a reply send also raises
    // the shared `pending` gate, and must not retitle those buttons.
    const [mutating, setMutating] = useState();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState();
    const mountedRef = useRef(false);
    const currentFactsRef = useRef([]);
    const sequenceRef = useRef(0);
    const readRequestIdRef = useRef(mintRequestId());
    const projectionRef = useRef();
    const mutationRequests = useRef(new Map());
    const threadLastFact = currentFacts[currentFacts.length - 1];
    const timeline = useTimelineScroll(`${currentFacts.length}:${olderFacts.length}:${threadLastFact === undefined ? '' : factKey(threadLastFact)}`);
    const updateProjection = (next) => {
        projectionRef.current = next;
        setProjection(next);
        setReadFacts(next.facts);
        const anchor = messageFact(next.anchor, next.anchorMentions);
        const batch = [anchor, ...next.facts.map(fact => fact.fact)];
        setCurrentFacts(current => {
            const merged = mergeFacts(current, batch);
            currentFactsRef.current = merged;
            return merged;
        });
    };
    // Continue a bounded read while unread facts remain. Each round must mint a
    // fresh requestId: the Host replays a repeated id from its idempotency
    // cache, which would return the same batch forever. The loop terminates on
    // a zero remainder, a failed read (the existing error surface offers
    // retry), a superseding sequence, or the round cap.
    const drainUnread = async () => {
        for (let round = 1; round <= MAX_AUTO_READ_ROUNDS; round += 1) {
            const snapshot = projectionRef.current;
            if (snapshot === undefined || snapshot.remainingUnreadCount <= 0)
                return;
            const beforeSequence = sequenceRef.current;
            if (!await readCurrent(true))
                return;
            // A newer read or remount owns the tail now; it drains the remainder.
            if (!mountedRef.current || sequenceRef.current !== beforeSequence + 1)
                return;
            // A stalled remainder (Host fault) must not spin the loop.
            if (projectionRef.current?.remainingUnreadCount === snapshot.remainingUnreadCount)
                return;
        }
        setAutoReadExhausted(true);
    };
    const readCurrent = async (newRequest = false) => {
        if (!mountedRef.current)
            return false;
        if (newRequest)
            readRequestIdRef.current = mintRequestId();
        const sequence = sequenceRef.current + 1;
        sequenceRef.current = sequence;
        setLoading(true);
        try {
            const result = await readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest });
            if (!mountedRef.current || sequence !== sequenceRef.current)
                return false;
            if (!result.ok) {
                setError(result.error.message);
                return false;
            }
            updateProjection(result.value);
            setError(undefined);
            return true;
        }
        catch (cause) {
            if (mountedRef.current && sequence === sequenceRef.current)
                setError(cause instanceof Error ? cause.message : String(cause));
            return false;
        }
        finally {
            if (mountedRef.current && sequence === sequenceRef.current)
                setLoading(false);
        }
    };
    /** One roster + view read. Answers false once the page is gone. */
    const applySupplemental = async () => {
        try {
            const [loadedMembers, loadedView] = await Promise.all([
                loadMembers({ workspaceId }),
                loadChannels({ workspaceId, ...(channelRef === undefined ? {} : { channelRef }), threadRef, includeActivities: false, limit: 1 }),
            ]);
            if (!mountedRef.current)
                return false;
            if (loadedMembers.ok)
                setMembers(loadedMembers.value);
            if (loadedView.ok)
                setChannelView(loadedView.value);
            const failure = [loadedMembers, loadedView].find(result => !result.ok);
            if (failure !== undefined && !failure.ok)
                setError(failure.error.message);
            return true;
        }
        catch (cause) {
            if (mountedRef.current)
                setError(cause instanceof Error ? cause.message : String(cause));
            return mountedRef.current;
        }
    };
    const supplementalRef = useRef();
    const supplementalPendingRef = useRef(false);
    const refreshSupplemental = () => {
        supplementalPendingRef.current = true;
        if (supplementalRef.current !== undefined)
            return supplementalRef.current;
        const round = (async () => {
            // Collect synchronous scope notifications before issuing the shared read.
            await Promise.resolve();
            while (mountedRef.current && supplementalPendingRef.current) {
                supplementalPendingRef.current = false;
                if (!await applySupplemental())
                    return;
            }
        })().finally(() => {
            if (supplementalRef.current === round)
                supplementalRef.current = undefined;
        });
        supplementalRef.current = round;
        return round;
    };
    const refreshPassiveFacts = async () => {
        try {
            const result = await loadThreadHistory({ workspaceId, ...threadRequest, limit: 100 });
            if (!mountedRef.current || !result.ok)
                return;
            const incoming = result.value.facts;
            const shown = currentFactsRef.current;
            if (shown.length === 0)
                return;
            const known = new Set(shown.map(fact => factKey(fact)));
            // Facts older than everything already rendered are backfill of the
            // wider history window this fetch uses, not new updates; counting
            // them would re-flag already-read messages after every change wake.
            const newestShown = shown.reduce((maximum, fact) => Math.max(maximum, fact.sequence), 0);
            const additions = incoming.filter(fact => !known.has(factKey(fact)) && fact.sequence > newestShown);
            setCurrentFacts(current => {
                const merged = mergeFacts(current, incoming);
                currentFactsRef.current = merged;
                return merged;
            });
            setProjection(current => {
                const next = current === undefined ? current : { ...current, ...(result.value.task === undefined ? {} : { task: result.value.task }), thread: result.value.thread, claims: result.value.claims };
                if (next !== undefined)
                    projectionRef.current = next;
                return next;
            });
            if (additions.length === 0)
                return;
            // Every arrival while the Thread is open is acknowledged durably: the
            // timeline renders it either way, and the Human has no manual read
            // action anymore. The count only feeds the pure jump hint for a reader
            // away from the tail; a bottom-pinned reader already sees the arrivals.
            if (!timeline.isPinned())
                setNewFactsCount(current => current + additions.length);
            // The acknowledgment outcome does not change what is on screen: a
            // failed read surfaces through the error surface, not through the count.
            await readCurrent(true);
        }
        catch {
            // A passive refresh is an invalidation convenience; the next explicit action rereads Host state.
        }
    };
    // Follower ranking is an enhancement, not a page fact: a failed observation
    // read leaves the roster order in place instead of surfacing an error.
    const refreshFollowers = async () => {
        try {
            const result = await threadObservations({ workspaceId, ...threadRequest });
            if (!mountedRef.current || !result.ok)
                return;
            setFollowerIds(new Set(result.value.followers));
        }
        catch {
            // The next thread-scope wake retries; ranking falls back to roster order.
        }
    };
    useEffect(() => {
        mountedRef.current = true;
        // The previous mount's supplemental round must not answer for this one.
        supplementalRef.current = undefined;
        supplementalPendingRef.current = false;
        projectionRef.current = undefined;
        setProjection(undefined);
        setChannelView(undefined);
        setMembers([]);
        setFollowerIds(new Set());
        setCurrentFacts([]);
        currentFactsRef.current = [];
        setOlderFacts([]);
        setReadFacts([]);
        setHistoryCursor(undefined);
        setHistoryHasMore(false);
        setAutoReadExhausted(false);
        setNewFactsCount(0);
        setError(undefined);
        setStatusMessage(undefined);
        const sequence = sequenceRef.current + 1;
        sequenceRef.current = sequence;
        setLoading(true);
        void (async () => {
            // One parallel round covers the whole first paint. The durable read no
            // longer wakes any change scope; only the subscription baseline can
            // request a catch-up while this first paint is loading.
            const [read, history, observations] = await Promise.all([
                readThread({ requestId: readRequestIdRef.current, workspaceId, ...threadRequest }),
                loadThreadHistory({ workspaceId, ...threadRequest, limit: 20 }).catch(() => undefined),
                threadObservations({ workspaceId, ...threadRequest }).catch(() => undefined),
            ]);
            if (!mountedRef.current || sequence !== sequenceRef.current)
                return;
            if (!read.ok) {
                setError(read.error.message);
                setLoading(false);
                return;
            }
            updateProjection(read.value);
            // The Thread opens at the latest fact; the unread boundary stays
            // rendered as information, but reading is automatic from here on.
            timeline.scrollToBottom();
            if (history !== undefined && history.ok) {
                setCurrentFacts(current => {
                    const merged = mergeFacts(current, history.value.facts);
                    currentFactsRef.current = merged;
                    return merged;
                });
                setHistoryCursor(history.value.cursor);
                setHistoryHasMore(history.value.hasMore);
            }
            if (observations !== undefined && observations.ok)
                setFollowerIds(new Set(observations.value.followers));
            setError(undefined);
            setLoading(false);
            await drainUnread();
        })();
        void refreshSupplemental();
        const disposers = [
            subscribeChanges({ kind: 'thread', threadRef }, update => {
                if (!mountedRef.current)
                    return;
                if (update.type === 'failed') {
                    setError(update.message);
                    return;
                }
                void refreshPassiveFacts();
                // Attention changes wake this scope too; keep the mention ranking current.
                void refreshFollowers();
            }),
            subscribeChanges({ kind: 'workspace', workspaceId }, update => {
                if (!mountedRef.current)
                    return;
                if (update.type === 'failed') {
                    setError(update.message);
                    return;
                }
                void refreshSupplemental();
            }),
            // Presence transitions commit nothing: only the member rows move, so
            // the roster refresh rides the same supplemental fetch as workspace
            // membership changes, leaving the timeline untouched.
            subscribeChanges({ kind: 'presence', workspaceId }, update => {
                if (!mountedRef.current)
                    return;
                if (update.type === 'failed') {
                    setError(update.message);
                    return;
                }
                void refreshSupplemental();
            }),
        ];
        return () => {
            mountedRef.current = false;
            sequenceRef.current += 1;
            for (const dispose of disposers)
                dispose();
        };
    }, [workspaceId, taskRef, threadRef]);
    // Returning to the bottom is the reader's answer to the jump hint: the
    // arrivals are on screen, their durable read already happened (or will be
    // retried by the next change wake), and the hint has nothing left to say.
    useEffect(() => {
        if (newFactsCount > 0 && timeline.isPinned())
            setNewFactsCount(0);
    }, [newFactsCount, currentFacts, olderFacts, timeline]);
    // The hint answers "where is the tail?"; the moment the reader is back
    // within the follow margin — by the jump click or their own scroll — it
    // must go away even when no render follows that position change.
    const handleTimelineScroll = () => {
        timeline.onScroll();
        if (timeline.isPinned())
            setNewFactsCount(0);
    };
    const loadOlder = async () => {
        if (historyHasMore === false && historyCursor === undefined)
            return;
        const beforeSequence = historyCursor ?? minSequence(currentFactsRef.current);
        if (beforeSequence === undefined)
            return;
        setLoading(true);
        try {
            const result = await loadThreadHistory({ workspaceId, ...threadRequest, beforeSequence, limit: 20 });
            if (!mountedRef.current)
                return;
            if (!result.ok) {
                setError(result.error.message);
                return;
            }
            setOlderFacts(current => mergeFacts(current, result.value.facts));
            setHistoryCursor(result.value.cursor);
            setHistoryHasMore(result.value.hasMore);
            setError(undefined);
        }
        catch (cause) {
            if (mountedRef.current)
                setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            if (mountedRef.current)
                setLoading(false);
        }
    };
    const activeProjection = projection;
    const task = activeProjection?.task;
    const thread = activeProjection?.thread;
    const resolvedTaskNumber = taskNumber ?? channelView?.taskNumbers.find(entry => entry.taskRef === task?.taskRef)?.taskNumber;
    const taskTitle = activeProjection === undefined ? undefined : formatTaskTitle(activeProjection.anchor.body);
    const taskClaims = activeProjection?.claims ?? [];
    const effectiveChannelRef = task?.channelRef ?? channelRef;
    const channelMemberIds = useMemo(() => new Set(channelView?.members.filter(item => item.channelRef === effectiveChannelRef).map(item => item.memberId) ?? []), [channelView, effectiveChannelRef]);
    const channelMembers = members.filter(status => channelMemberIds.size === 0 || channelMemberIds.has(status.member.memberId));
    const mentionHandlesMap = useMemo(() => new Map(members.map(status => [status.member.memberId, status.member.handle.replace(/^@/, '')])), [members]);
    const metadata = useMemo(() => readMeta(readFacts), [readFacts]);
    const unreadIndex = useMemo(() => {
        const all = mergeFacts(...(activeProjection === undefined ? [] : [[messageFact(activeProjection.anchor, activeProjection.anchorMentions)]]), readFacts.map(fact => fact.fact), currentFacts);
        return all.findIndex(fact => metadata.get(factKey(fact))?.unread === true);
    }, [activeProjection?.anchor, readFacts, currentFacts, metadata]);
    const memberName = (memberId) => {
        if (memberId === channelView?.humanMemberId)
            return humanName;
        const status = members.find(candidate => candidate.member.memberId === memberId);
        return status === undefined ? t('memberUnknown') : `@${status.member.handle}`;
    };
    const messageSender = (fact) => fact.kind === 'message' ? fact.message.sender : undefined;
    const [pendingFiles, setPendingFiles] = useState([]);
    // Branded-ref navigation for message bodies: channel refs hop to the
    // Channel; thread and task refs cited here resolve through the Host and
    // jump to their home Channel. Unresolvable refs never become links (see
    // TeamMessage), so this path only fires for refs the Host already confirmed.
    // Identity-stable: a fresh closure per render would defeat TeamMessage's memo.
    const openRef = useCallback((ref) => {
        if (ref.startsWith('channel:') && ref !== channelRef) {
            selectChannel(ref);
            return;
        }
        if (ref.startsWith('thread:') && ref !== threadRef) {
            // Another Thread cited here: resolve its home Channel and jump.
            jumpToThread(resolveThreadRefs, workspaceId, ref, selectThread);
            return;
        }
        if (ref.startsWith('task:') && ref !== taskRef) {
            // Another Task cited here: resolve its home Channel and jump.
            jumpToTaskThread(resolveTaskRefs, workspaceId, ref, selectThread);
        }
    }, [channelRef, threadRef, taskRef, workspaceId, selectChannel, selectThread, resolveTaskRefs, resolveThreadRefs]);
    const lookupTaskRefs = useMemo(() => hostTaskRefLookup(resolveTaskRefs, workspaceId), [resolveTaskRefs, workspaceId]);
    const lookupThreadRefs = useMemo(() => hostThreadRefLookup(resolveThreadRefs, workspaceId), [resolveThreadRefs, workspaceId]);
    // Roster chips resolve synchronously from loaded data: channel names from
    // the Channel view, member facts from the member list. Anything outside the
    // loaded window stays plain text — the same rule unresolvable Task/Thread
    // refs follow. The lookups key on roster content, not array identity: every
    // refresh hands over fresh arrays, and the memoized rows must survive
    // change bursts that leave the roster itself untouched.
    const rosterKey = useMemo(() => [
        (channelView?.channels ?? []).map(channel => `${channel.channelRef}=${channel.name}=${channel.state}`).join(','),
        members.map(status => `${status.member.memberId}=${status.member.handle}=${status.member.sessionId}=${status.availability}`).join(','),
        channelView?.humanMemberId ?? '',
    ].join(';'), [channelView, members]);
    const channelNameOf = useMemo(() => {
        const channels = channelView?.channels ?? [];
        return (ref) => rosterChannelName(channels, ref);
    }, [rosterKey]);
    const memberOf = useMemo(() => {
        const humanMemberId = channelView?.humanMemberId;
        return (ref) => rosterMember(members, humanMemberId, humanName, ref);
    }, [rosterKey, humanName]);
    const renderFact = (fact, grouped = false) => {
        if (fact.kind === 'message') {
            const sender = memberName(fact.message.sender);
            const senderStatus = members.find(candidate => candidate.member.memberId === fact.message.sender);
            const human = fact.message.sender === channelView?.humanMemberId;
            return _jsx(TeamMessage, { senderName: sender, memberId: fact.message.sender, human: human, ...(human && humanAvatarUrl !== undefined ? { avatarUrl: humanAvatarUrl } : {}), body: fact.message.body, attachments: fact.message.attachments, loadAttachment: getAttachment, t: t, occurredAt: fact.message.occurredAt, mentionNames: stableMentionNames(fact.mentions, mentionHandlesMap, humanName), onOpenRef: openRef, onResolveTaskRefs: lookupTaskRefs, onResolveThreadRefs: lookupThreadRefs, channelNameOf: channelNameOf, memberOf: memberOf, onOpenMemberSession: openMemberSession, grouped: grouped, ...(senderStatus === undefined ? {} : { senderTitle: senderStatus.member.description }) }, factKey(fact));
        }
        return _jsxs("p", { className: threadCss.activityRow, children: [_jsx("span", { className: threadCss.activityMark, "aria-hidden": "true" }), _jsx("span", { className: threadCss.activityText, children: formatActivity(fact.activity, { t, actorName: memberName, claims: taskClaims }) })] }, factKey(fact));
    };
    /** One run = one same-sender reply turn; activities, the unread boundary, and day changes break runs. */
    const renderFactBlocks = (facts, boundaryIndex) => {
        const nodes = [];
        let run = [];
        let lastDay;
        const flushRun = () => {
            if (run.length > 0) {
                nodes.push(_jsx("div", { className: css.messageRun, children: run.map((entry, entryIndex) => {
                        const previous = entryIndex > 0 ? run[entryIndex - 1] : undefined;
                        const turnGap = entry.kind === 'message' && isRunGap(previous?.kind === 'message' ? previous.message.occurredAt : undefined, entry.message.occurredAt);
                        return _jsxs(Fragment, { children: [turnGap && _jsx(TeamRunDivider, { occurredAt: entry.message.occurredAt }), renderFact(entry, entryIndex > 0)] }, factKey(entry));
                    }) }, `run-${factKey(run[0])}`));
            }
            run = [];
        };
        facts.forEach((fact, index) => {
            const occurredAt = fact.kind === 'message' ? fact.message.occurredAt : undefined;
            if (occurredAt !== undefined) {
                const day = timelineDayKey(occurredAt);
                if (lastDay !== undefined && day !== lastDay) {
                    flushRun();
                    nodes.push(_jsx("p", { className: threadCss.daySeparator, children: _jsx("span", { children: daySeparatorLabel(occurredAt) }) }, `day-${index}`));
                }
                lastDay = day;
            }
            const sender = messageSender(fact);
            if (sender !== undefined && run.length > 0 && sender === messageSender(run[run.length - 1])) {
                run.push(fact);
                return;
            }
            flushRun();
            if (boundaryIndex === index)
                nodes.push(_jsx("p", { className: threadCss.unreadBoundary, role: "separator", children: _jsx("span", { children: t('unreadBoundary') }) }, `boundary-${index}`));
            if (sender !== undefined)
                run.push(fact);
            else
                nodes.push(_jsx(Fragment, { children: renderFact(fact) }, factKey(fact)));
        });
        flushRun();
        return nodes;
    };
    const refreshAfterFence = async () => {
        timeline.scrollToBottom();
        await readCurrent(true);
        await refreshSupplemental();
        await drainUnread();
    };
    const convertToTask = async () => {
        if (pending || thread === undefined || task !== undefined)
            return;
        setPending(true);
        setMutating('promote');
        setError(undefined);
        const key = 'promote';
        const requestId = mutationRequests.current.get(key) ?? mintRequestId();
        mutationRequests.current.set(key, requestId);
        try {
            const result = await promoteThread({ requestId, workspaceId, threadRef, baseRevision: thread.revision });
            if (!result.ok) {
                setError(result.error.message);
                return;
            }
            if (result.value.kind === 'committed') {
                mutationRequests.current.delete(key);
                const committed = result.value;
                setProjection(current => current === undefined ? current
                    : { ...current, task: committed.task, thread: committed.thread });
                setCurrentFacts(current => {
                    const merged = mergeFacts(current, [{ kind: 'activity', sequence: committed.activity.sequence, activity: committed.activity, occurredAt: committed.receipt.occurredAt }]);
                    currentFactsRef.current = merged;
                    return merged;
                });
                await readCurrent(true);
                await refreshSupplemental();
            }
            else if (result.value.kind === 'unread_required') {
                setError(t('unreadRequired', { count: result.value.unreadCount }));
                mutationRequests.current.delete(key);
                await refreshAfterFence();
            }
            else {
                setError(t('staleRevision'));
                mutationRequests.current.delete(key);
                await refreshPassiveFacts();
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setPending(false);
            setMutating(undefined);
        }
    };
    const mutateTask = async (action) => {
        if (pending || task === undefined || thread === undefined)
            return;
        setPending(true);
        if (action === 'accept')
            setMutating('accept');
        setError(undefined);
        const key = `task:${action}`;
        const requestId = mutationRequests.current.get(key) ?? mintRequestId();
        mutationRequests.current.set(key, requestId);
        try {
            const result = await changeTask({ requestId, workspaceId, taskRef: task.taskRef, action, baseRevision: thread.revision });
            if (!result.ok) {
                setError(result.error.message);
                return;
            }
            if (result.value.kind === 'committed') {
                mutationRequests.current.delete(key);
                const committed = result.value;
                setProjection(current => current === undefined ? current : { ...current, task: committed.task, thread: committed.thread, claims: committed.claims });
                setCurrentFacts(current => {
                    const merged = mergeFacts(current, [{ kind: 'activity', sequence: committed.activity.sequence, activity: committed.activity, occurredAt: committed.receipt.occurredAt }]);
                    currentFactsRef.current = merged;
                    return merged;
                });
                await readCurrent(true);
                await refreshSupplemental();
            }
            else if (result.value.kind === 'unread_required') {
                setError(t('unreadRequired', { count: result.value.unreadCount }));
                mutationRequests.current.delete(key);
                await refreshAfterFence();
            }
            else {
                setError(t('staleRevision'));
                mutationRequests.current.delete(key);
                await refreshPassiveFacts();
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setPending(false);
            setMutating(undefined);
        }
    };
    // Editing the draft invalidates one-shot send state: a confirmation token,
    // the retained requestId, and the status line. Every setter returns the same
    // state when there is nothing to clear, so a keystroke does not re-render the
    // timeline now that the composer owns the draft.
    const clearSendState = useCallback(() => {
        setConfirmation(current => current === undefined ? current : undefined);
        setReplyRequestId(current => current === undefined ? current : undefined);
        setStatusMessage(current => current === undefined ? current : undefined);
    }, []);
    const sendReply = async () => {
        // Read the draft at send time: this page no longer subscribes to it, so a
        // captured render value would be stale after the composer's own edits.
        const { draft, recipients } = drafts.getSnapshot(draftKey);
        if (pending || thread === undefined || draft.trim() === '')
            return;
        const id = replyRequestId ?? mintRequestId();
        setReplyRequestId(id);
        setPending(true);
        setError(undefined);
        try {
            // Upload chosen files first; any failure aborts the reply with the
            // existing error surface and keeps the chips for a retry.
            const upload = await uploadComposerFiles(putAttachment, workspaceId, pendingFiles);
            if (!upload.ok) {
                setError(upload.error);
                return;
            }
            const attachmentIds = upload.attachmentIds;
            const result = await reply({ requestId: id, workspaceId, threadRef, ...(task === undefined ? {} : { taskRef: task.taskRef }), body: draft.trim(), baseRevision: thread.revision, recipients: [...recipients].sort(), ...(attachmentIds.length === 0 ? {} : { attachments: attachmentIds }), ...(confirmation === undefined ? {} : { confirmationToken: confirmation }) });
            if (!result.ok) {
                setError(result.error.message);
                return;
            }
            if (result.value.kind === 'committed') {
                const committed = result.value;
                // The optimistic row chips what the Host is about to report: a
                // hand-typed `@Handle` delivers exactly like a picked recipient, and the
                // committed facts replace this row as soon as they arrive.
                const optimisticMentions = [...new Set([...recipients, ...mentionedMemberIds(draft, channelMembers)])].sort();
                setCurrentFacts(current => {
                    const merged = mergeFacts(current, [{ kind: 'message', sequence: committed.message.sequence, message: committed.message, mentions: optimisticMentions, occurredAt: committed.receipt.occurredAt }]);
                    currentFactsRef.current = merged;
                    return merged;
                });
                setProjection(current => current === undefined ? current : { ...current, ...(committed.task === undefined ? {} : { task: committed.task }), thread: committed.thread });
                drafts.clear(draftKey);
                setPendingFiles([]);
                setReplyRequestId(undefined);
                setConfirmation(undefined);
                setStatusMessage(undefined);
                await refreshSupplemental();
            }
            else if (result.value.kind === 'confirmation_required') {
                setConfirmation(result.value.confirmationToken);
                setStatusMessage(t('mentionConfirmation'));
            }
            else if (result.value.kind === 'unread_required') {
                setError(t('unreadRequired', { count: result.value.unreadCount }));
                setConfirmation(undefined);
                setStatusMessage(undefined);
                setReplyRequestId(undefined);
                await refreshAfterFence();
            }
            else if (result.value.kind === 'stale_revision') {
                setError(t('staleRevision'));
                setConfirmation(undefined);
                setStatusMessage(undefined);
                setReplyRequestId(undefined);
                await refreshPassiveFacts();
            }
            else {
                setError(t('memberNotFollowing', { ids: result.value.memberIds.map(memberId => `@${members.find(candidate => candidate.member.memberId === memberId)?.member.handle ?? memberId}`).join(', ') }));
                setConfirmation(undefined);
                setStatusMessage(undefined);
                setReplyRequestId(undefined);
            }
        }
        catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
        finally {
            setPending(false);
        }
    };
    const currentFactsWithAnchor = mergeFacts(activeProjection === undefined ? [] : [messageFact(activeProjection.anchor, activeProjection.anchorMentions)], currentFacts);
    const unreadBoundary = unreadIndex >= 0 ? unreadIndex : undefined;
    // One row per erroring Member holding a live Claim. The row shows the
    // diagnostic's structured class — the localizable axis — beside the first
    // sentence of the Host's own reason; the full English text moves to the
    // row's title.
    const risks = taskClaims.filter(claim => claim.state === 'active').flatMap(claim => {
        const status = members.find(candidate => candidate.member.memberId === claim.owner);
        if (status?.presence !== 'error')
            return [];
        const risk = formatRiskClass(status, t);
        const detail = diagnosticText(status);
        return [{
                claim, status, ...risk,
                reason: detail === '' ? t('statusError') : firstSentence(detail),
                full: detail === '' ? t('statusError') : detail,
            }];
    });
    // Threads are always entered through a Channel page, so a Channel origin
    // returns to its timeline; a Thread restored without one returns further.
    const backLabel = channelRef === undefined ? t('backToWorkspace') : t('backToChannel');
    return _jsxs("main", { className: css.surface, "data-team-thread": threadRef, children: [_jsxs("div", { className: css.surfaceHeader, children: [_jsx("div", { className: css.backRow, children: _jsx(Button, { size: "sm", icon: _jsx(IconChevronLeftOutlineRegular, {}), onClick: backToWorkspace, children: backLabel }) }), _jsxs("header", { className: css.headerRow, children: [_jsxs("div", { className: css.headerCopy, children: [_jsxs("div", { className: threadCss.titleLine, children: [_jsx("h1", { children: task === undefined ? t('threadLabel') : t('taskLabel', { number: resolvedTaskNumber ?? '…' }) }), task !== undefined && _jsxs(Pill, { children: [_jsx(TeamStateDot, { size: 8, state: taskStatusDot(task.status) }), formatTaskStatus(task.status, t)] })] }), taskTitle !== undefined && taskTitle !== '' && _jsx("p", { className: threadCss.taskTitle, title: taskTitle, children: taskTitle })] }), task === undefined && thread !== undefined && _jsx("div", { className: css.headerActions, children: _jsx(Button, { size: "sm", variant: "primary", disabled: pending, onClick: () => { void convertToTask(); }, children: mutating === 'promote' ? t('promotingTask') : t('promoteToTask') }) }), task !== undefined && thread !== undefined && task.resolution !== 'closed' && _jsxs("div", { className: css.headerActions, children: [(() => {
                                        const activeClaims = projection?.claims.filter(claim => claim.taskRef === task.taskRef && claim.state === 'active') ?? [];
                                        const earlyAccept = task.resolution === 'open' && task.status === 'in_progress' && activeClaims.length > 0;
                                        // todo Tasks accept directly: the work finished outside the
                                        // ledger, so there is nothing to confirm and no Claims to list.
                                        if (!(task.status === 'in_review' || task.status === 'todo' || earlyAccept) || task.resolution !== 'open')
                                            return null;
                                        return _jsx(Button, { size: "sm", variant: "primary", disabled: pending, onClick: () => { if (earlyAccept) {
                                                setConfirmingAccept(true);
                                            }
                                            else {
                                                void mutateTask('accept');
                                            } }, children: t('acceptTask') });
                                    })(), task.resolution === 'open'
                                        ? _jsx(Button, { size: "sm", variant: "outline", disabled: pending, onClick: () => { void mutateTask('close'); }, children: t('closeTask') })
                                        : _jsx(Button, { size: "sm", variant: "primary", disabled: pending, onClick: () => { void mutateTask('reopen'); }, children: t('reopenTask') })] })] }), risks.length > 0 && _jsxs("section", { className: threadCss.riskSection, "aria-label": t('runtimeRisk'), children: [_jsx("h2", { children: t('runtimeRisk') }), risks.map(({ claim, status, label, sentenceKey, reason, full }) => _jsxs("p", { className: threadCss.riskRow, children: [_jsx(TeamPresenceDot, { status: status, t: t }), _jsxs("span", { title: full, children: [_jsx("strong", { className: threadCss.riskClass, children: label }), " \u00B7 ", t(sentenceKey, { member: status.member.handle }), " \u2014 ", reason] })] }, claim.claimRef))] }), task !== undefined && thread !== undefined && (() => {
                        // Recomputed here so the confirm list never shows stale rows.
                        const activeClaims = projection?.claims.filter(claim => claim.taskRef === task.taskRef && claim.state === 'active') ?? [];
                        return _jsxs(Modal, { open: confirmingAccept, onClose: () => { if (!pending)
                                setConfirmingAccept(false); }, title: t('acceptEarlyTitle'), closeLabel: t('cancel'), footer: _jsxs(_Fragment, { children: [_jsx(Button, { variant: "outline", disabled: pending, onClick: () => { setConfirmingAccept(false); }, children: t('cancel') }), _jsx(Button, { variant: "primary", disabled: pending, onClick: () => { void mutateTask('accept'); }, children: mutating === 'accept' ? t('acceptingTask') : t('acceptTask') })] }), children: [_jsx("p", { className: css.confirmBody, children: t('acceptEarlyBody', { count: activeClaims.length }) }), _jsx("ul", { className: css.confirmList, children: activeClaims.map(claim => (_jsxs("li", { children: [memberName(claim.owner), " \u00B7 ", claim.direction] }, claim.claimRef))) })] });
                    })(), task !== undefined && thread !== undefined && _jsx("section", { className: threadCss.workSection, "aria-label": t('claims'), children: _jsx(DisclosureRow, { expandOnRowClick: true, expandable: true, open: claimsOpen, onToggle: () => { setClaimsOpen(current => !current); }, icon: _jsx(IconChecklistOutlineRegular, { size: 14 }), title: `${t('claims')} · ${taskClaims.length}`, children: _jsxs("div", { className: threadCss.claimList, children: [taskClaims.length === 0 && _jsx("p", { className: threadCss.emptyClaims, children: t('noClaims') }), taskClaims.map(claim => {
                                        const ownerStatus = members.find(status => status.member.memberId === claim.owner);
                                        return _jsxs("article", { className: `${threadCss.claimRow}${claim.state === 'done' ? ` ${threadCss.claimRowDone}` : ''}`, children: [ownerStatus === undefined ? _jsx("span", {}) : _jsx(TeamPresenceDot, { status: ownerStatus, t: t }), _jsx("strong", { className: threadCss.claimOwner, title: memberName(claim.owner), children: memberName(claim.owner) }), _jsx("span", { className: threadCss.claimDirection, children: claim.direction }), _jsx("small", { className: threadCss.claimState, children: formatClaimState(claim.state, t) })] }, claim.claimRef);
                                    })] }) }) })] }), _jsx("section", { ref: timeline.ref, onScroll: handleTimelineScroll, className: css.timeline, "aria-label": t('timelineLabel'), children: _jsxs("div", { className: css.timelineContent, children: [loading && projection === undefined && error === undefined && _jsx("div", { className: css.emptySurface, children: _jsxs("p", { className: css.loadingState, children: [_jsx("span", { className: css.loadingMark, "aria-hidden": "true" }), t('loadingThread')] }) }), projection === undefined && error !== undefined && _jsxs("div", { className: css.errorState, role: "alert", children: [_jsx("span", { children: error }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => { void readCurrent(); }, children: t('retry') })] }), olderFacts.length > 0 && _jsxs("section", { className: threadCss.historySection, "aria-label": t('olderHistory'), children: [_jsx("h2", { children: t('olderHistory') }), renderFactBlocks(olderFacts, undefined)] }), historyHasMore && _jsx("div", { className: css.timelineAction, children: _jsx(Button, { size: "sm", onClick: () => { void loadOlder(); }, children: t('loadOlder') }) }), currentFactsWithAnchor.length > 0 && _jsx("section", { className: threadCss.publicSection, children: renderFactBlocks(currentFactsWithAnchor, unreadBoundary) }), autoReadExhausted && _jsxs("div", { className: css.timelineAction, role: "alert", children: [_jsx("span", { children: t('autoReadIncomplete') }), _jsx(Button, { size: "sm", onClick: () => { setAutoReadExhausted(false); void drainUnread(); }, disabled: loading, children: t('retry') })] }), newFactsCount > 0 && _jsx("div", { className: threadCss.newUpdates, role: "status", children: _jsx("button", { type: "button", className: threadCss.newUpdatesJump, onClick: () => { setNewFactsCount(0); timeline.scrollToBottom(); }, children: t('newUpdatesJump', { count: newFactsCount }) }) })] }) }), projection !== undefined && thread !== undefined ? (task?.resolution === 'closed'
                ? _jsxs("div", { className: threadCss.closedBar, "data-team-closed": true, children: [error !== undefined && _jsx("p", { className: css.error, role: "alert", children: error }), _jsxs("div", { className: threadCss.closedNotice, children: [_jsx("span", { children: t('taskClosedNotice') }), _jsx(Button, { size: "sm", variant: "outline", disabled: pending, onClick: () => { void mutateTask('reopen'); }, children: t('reopenTask') })] })] })
                : _jsx(TeamComposer, { members: channelMembers, followerMemberIds: followerIds, drafts: drafts, draftKey: draftKey, pending: pending, ...(statusMessage === undefined ? {} : { confirmation: statusMessage }), ...(error === undefined ? {} : { error }), onEdit: clearSendState, onSubmit: () => { void sendReply(); }, placeholder: t('replyPlaceholder'), pendingFiles: pendingFiles, onFilesChange: setPendingFiles, t: t }, draftKey)) : _jsx("div", {})] });
}
