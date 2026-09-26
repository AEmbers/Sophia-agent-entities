import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import { claimersLabel, formatAbsoluteTime, formatInboxTime } from "./team-formatters.js";
import { namedAvatarOwners, TeamAvatarStack } from "./TeamAvatarStack.js";
import { TeamCountBadge } from "./TeamCountBadge.js";
import css from './conversation.module.css';
import inboxCss from './inbox.module.css';
/**
 * How many 「最近活跃」 rows the merged page may show. The Host bounds each
 * Workspace's own slice; this is the single bound across every Workspace on
 * screen, so the section stays the same size no matter how many are open — and
 * it stays a way back into work rather than a second queue, which is why it is
 * shorter than the queue the reader is actually being asked to work through.
 */
const RECENT_ROWS_LIMIT = 5;
/**
 * Queue order, one total order across Workspaces: the Host's own keys —
 * mentions first, then the ledger sequence, then the Thread ref. Each Workspace
 * slice already arrives in this order, and it is also the Host's truncation
 * policy, so the merge re-applies it instead of inventing a second one: a row
 * that survived the cut on mentions must not sink below a merely newer row
 * after the merge. `newestSequence` is a global ledger position, so it stays
 * comparable across Workspaces.
 */
function compareInboxRows(left, right) {
    return right.item.directCount - left.item.directCount
        || right.item.newestSequence - left.item.newestSequence
        || left.item.thread.threadRef.localeCompare(right.item.thread.threadRef);
}
/**
 * The Human Inbox: one Inbox call per visible Workspace, rendering the Host's
 * two slices — the unread queue (「需要我」, mentions counted inside it rather
 * than alone) and the 「最近活跃」 tail of Threads the reader took part in.
 * Both merge across every Workspace into one list in the Host's own order,
 * mentions first and then newest, rather than by Workspace.
 * Opening the page never acknowledges anything — only a durable Thread read
 * advances the watermark and consumes a mention marker, so rows and the badge
 * drop after the Thread is opened through the existing auto-ack path. A Thread
 * holding unread is only ever in the queue: the Host already excludes it from
 * the tail, and this page never re-derives that judgement.
 */
export function TeamInboxPage({ useWorkspaces, loadInbox, subscribeChanges, selectWorkspace, selectThread, humanName, humanAvatarUrl, t }) {
    const workspaces = useWorkspaces(state => state.items);
    const [rows, setRows] = useState();
    const [recentRows, setRecentRows] = useState([]);
    // The Host names the Human's Member id on every Inbox row's payload; the
    // page keeps it so a row can draw that one actor from the Client's own
    // Human identity instead of the initials the stack gives every Agent.
    const [humanMemberId, setHumanMemberId] = useState();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState();
    // Only the first refresh owns the loading surface; later wakes refresh the
    // rendered rows in place instead of flashing them back to skeleton.
    const loadedRef = useRef(false);
    const refresh = useCallback(async () => {
        if (!loadedRef.current)
            setLoading(true);
        const results = await Promise.all(workspaces.map(async (workspace) => {
            const result = await loadInbox({ workspaceId: workspace.workspaceId, limit: 100 });
            return result.ok
                ? { ok: true, workspaceId: workspace.workspaceId, workspaceTitle: workspace.title, items: result.value.items, recent: result.value.recent, humanMemberId: result.value.humanMemberId }
                : { ok: false, message: result.error.message };
        }));
        const failure = results.find(result => !result.ok);
        setHumanMemberId(results.find(result => result.ok)?.humanMemberId);
        const asRows = (items, workspaceId, workspaceTitle) => items.map(item => ({ workspaceId, workspaceTitle, item }));
        setRows(results.flatMap(result => result.ok ? asRows(result.items, result.workspaceId, result.workspaceTitle) : []).sort(compareInboxRows));
        // The tail is one global bound rather than one per Workspace: the reader was
        // promised five Threads to step back into, and every Workspace's slice is
        // already capped on its own, so the merged list is trimmed here.
        setRecentRows(results.flatMap(result => result.ok ? asRows(result.recent, result.workspaceId, result.workspaceTitle) : [])
            .sort(compareInboxRows).slice(0, RECENT_ROWS_LIMIT));
        setError(failure?.ok === false ? failure.message : undefined);
        loadedRef.current = true;
        setLoading(false);
    }, [loadInbox, workspaces]);
    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => subscribeChanges(undefined, update => {
        if (update.type === 'failed') {
            setError(update.message);
            return;
        }
        void refresh();
    }), [subscribeChanges, refresh]);
    const open = (row) => {
        selectWorkspace(row.workspaceId);
        selectThread(row.item.thread.threadRef, row.item.channelRef, row.item.task?.taskRef, row.item.taskNumber);
    };
    // The page rides the shared conversation seat: the same header band, 880px
    // reading column, responsive gutters, and scrollbar gutter as Channel and
    // Thread, so switching surfaces does not shift the content column.
    const totalUnread = rows?.reduce((sum, row) => sum + row.item.unreadCount, 0) ?? 0;
    const totalMentions = rows?.reduce((sum, row) => sum + row.item.directCount, 0) ?? 0;
    // A row names its Workspace only while the rows on screen span more than one.
    // With a single Workspace in the list the segment is a constant printed down
    // every row, which spends the row's most readable position on something that
    // never varies; the moment a second Workspace reaches the list it comes back,
    // because two rows then have to be tellable apart. This reads the rows rather
    // than the open Workspaces: a Workspace holding nothing to show here is not a
    // reason to keep printing the name of the one that is.
    const shownWorkspaces = new Set();
    for (const row of rows ?? [])
        shownWorkspaces.add(row.workspaceTitle);
    for (const row of recentRows)
        shownWorkspaces.add(row.workspaceTitle);
    const showWorkspace = shownWorkspaces.size > 1;
    // One identity for every row on the page: the Host tells the rows which
    // actor is the reader, the Client's identity projection says what that actor
    // looks like. Either half missing leaves the stack on its initials fallback.
    const human = humanMemberId === undefined
        ? undefined
        : { memberId: humanMemberId, name: humanName, ...(humanAvatarUrl === undefined ? {} : { avatarUrl: humanAvatarUrl }) };
    return _jsxs("main", { className: css.surface, "data-team-inbox": true, children: [_jsx("div", { className: css.surfaceHeader, children: _jsx("header", { className: css.headerRow, children: _jsxs("div", { className: css.headerCopy, children: [_jsx("h1", { children: t('inboxTitle') }), rows !== undefined && rows.length > 0 && _jsxs("p", { className: inboxCss.headerMeta, children: [_jsx("span", { children: t('inboxHeaderThreads', { count: rows.length }) }), _jsx("span", { className: inboxCss.headerUnread, children: t('inboxHeaderUnread', { count: totalUnread }) }), totalMentions > 0 && _jsx("span", { children: t('inboxHeaderMentions', { count: totalMentions }) })] })] }) }) }), _jsx("div", { className: css.timeline, children: _jsxs("div", { className: css.timelineContent, children: [loading && rows === undefined && error === undefined && _jsx("div", { className: css.emptySurface, children: _jsxs("p", { className: css.loadingState, children: [_jsx("span", { className: css.loadingMark, "aria-hidden": "true" }), t('loadingInbox')] }) }), !loading && rows === undefined && error !== undefined && _jsxs("div", { className: css.errorState, role: "alert", children: [_jsx("span", { children: error }), _jsx(Button, { size: "sm", variant: "outline", onClick: () => { void refresh(); }, children: t('retry') })] }), rows !== undefined && (rows.length === 0 && recentRows.length === 0
                            ? _jsx("div", { className: css.emptySurface, children: _jsxs("div", { className: css.emptyState, children: [_jsx("strong", { children: t('inboxEmptyTitle') }), _jsx("span", { children: t('inboxEmptyHint') })] }) })
                            : _jsxs(_Fragment, { children: [rows.length > 0 && _jsxs("section", { className: inboxCss.section, children: [_jsxs("h2", { className: inboxCss.sectionTitle, children: [t('inboxSectionNeedsMe'), _jsx("span", { className: inboxCss.sectionCount, children: rows.length })] }), _jsx("div", { className: inboxCss.list, children: rows.map(row => _jsx(InboxQueueRow, { row: row, t: t, showWorkspace: showWorkspace, human: human, onOpen: () => { open(row); } }, `${row.workspaceId} ${row.item.thread.threadRef}`)) })] }), recentRows.length > 0 && _jsxs("section", { className: inboxCss.section, children: [_jsxs("h2", { className: inboxCss.sectionTitle, children: [t('inboxSectionRecent'), _jsx("span", { className: inboxCss.sectionCount, children: recentRows.length })] }), _jsx("div", { className: inboxCss.list, children: recentRows.map(row => _jsx(InboxQueueRow, { row: row, t: t, showWorkspace: showWorkspace, human: human, onOpen: () => { open(row); } }, `${row.workspaceId} ${row.item.thread.threadRef}`)) })] })] })), rows !== undefined && error !== undefined && _jsx("p", { className: css.error, role: "alert", children: error })] }) })] });
}
/**
 * One queue row, shaped like the shipped two-line result row: who is on this
 * Thread leads in the gutter, the identity line answers which Thread this is,
 * how much is waiting, and when it last moved, and the gist sits under it on the
 * same column as evidence for that identity rather than as the row's subject.
 *
 * The gutter carries the one thing every row has — who is on the work, or who
 * moved a Thread nobody has claimed — so a Thread that merely arrived and one
 * that named the reader open on the same edge instead of the quieter one opening
 * on a slot reserved for a count it does not hold. It is the grammar the Channel
 * feed's Thread entry row already speaks, where the people on the work lead the
 * row.
 *
 * Before the queue admitted every unread Thread, each row was a mention and the
 * rows were interchangeable; now that named and ambient unread share one list,
 * the row has to carry that difference itself. The count closes the identity
 * line and only its ink changes — the shared capsule fill for a row that names
 * the reader, a hairline for one that merely moved. The two numbers behind that
 * ink (unread, mentions) reach assistive tech through the capsule's own name,
 * because a second visible count beside the first would cost the row the one
 * thing it needs to stay scannable.
 */
function InboxQueueRow({ row, t, showWorkspace, human, onOpen }) {
    const { item } = row;
    const actor = item.newestActor;
    const owners = item.claimOwners;
    // The row's names come from the Client's Human identity where it applies, so
    // the chip's letter and the label's name move together on a rename.
    const namedOwners = namedAvatarOwners(owners, human);
    const namedActor = namedAvatarOwners([actor], human)[0];
    const named = item.directCount > 0;
    const countLabel = named
        ? t('inboxRowUnreadMentions', { count: item.unreadCount, mentions: item.directCount })
        : t('inboxRowUnread', { count: item.unreadCount });
    return _jsxs("button", { type: "button", className: inboxCss.row, "data-named": named || undefined, onClick: onOpen, children: [_jsx("span", { className: inboxCss.rowActor, children: owners.length > 0
                    ? _jsx(TeamAvatarStack, { owners: namedOwners, label: claimersLabel(namedOwners, t), human: human })
                    : _jsx(TeamAvatarStack, { owners: [namedActor], label: t('inboxRowActor', { name: `@${namedActor.name}` }), human: human }) }), _jsxs("span", { className: inboxCss.rowLine, children: [_jsxs("span", { className: inboxCss.rowCrumb, children: [showWorkspace && _jsx("span", { className: inboxCss.rowWorkspace, children: row.workspaceTitle }), showWorkspace && ' / ', _jsxs("span", { className: inboxCss.rowChannel, children: ["#", item.channelName] }), ' ', item.taskNumber !== undefined && _jsx("span", { className: inboxCss.rowTask, children: t('taskLabel', { number: item.taskNumber }) })] }), _jsx(TeamCountBadge, { count: item.unreadCount, tone: named ? 'solid' : 'hairline', label: countLabel }), _jsx("time", { className: inboxCss.rowTime, dateTime: item.newestOccurredAt, title: formatAbsoluteTime(item.newestOccurredAt), children: formatInboxTime(item.newestOccurredAt, t) })] }), _jsx("span", { className: inboxCss.rowPreview, children: item.previewText })] });
}
