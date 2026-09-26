import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Sophia approval conversation card: the in-conversation approver surface for
 * a pending team proposal (design §4.4.2–4.4.3). It renders BEFORE the team is
 * materialized while the proposal is awaiting owner or captain approval.
 *
 * The card is a leaf: every interaction posts the full action record to the
 * host (`POST /plugins/dsh-sophia-entities/approvals/plan`); durable truth
 * stays on the Node side and returns through the session events.
 *
 * View selection — the same folded proposal appears in different sessions with
 * different controls, per §4.4.3:
 *  - `requester.isHuman` proposal → the owner session renders the mode-selector
 *    plus [批准][退回] (path ④ owner approval).
 *  - member-initiated proposal in the member's own session → a read-only
 *    "已提交队长审核，等待中…" status card (no approve buttons).
 *  - the captain review surface (`approve_dag` / `approve_persistent` /
 *    `downgrade_to_dag` / `reject`) is provided by the node-side owner/captain
 *    session injection, which registers this component with `reviewer: true`.
 * @module dsh-sophia-entities/client/sophia-approval-card
 */
import { useState } from 'react';
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives';
import { approvalErrorMessage, postApprovalPlanAction } from "./sophia-approval-requests.js";
import { LEAD_ART, memberArtUrl } from "./artwork.js";
import css from './SophiaApprovalCard.module.css';
/** Team-mode selector entries: id, label and designer description. */
const MODE_IDS = ['persistent', 'dag'];
function DisclosureChevron({ open }) {
    return (_jsx("svg", { className: css.modeChevron, "data-open": open, width: "12", height: "12", viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", "aria-hidden": true, children: _jsx("path", { d: "M4 2.5 7.5 6 4 9.5" }) }));
}
function TeamModeMenu({ mode, busy, onSelect, t, }) {
    const [open, setOpen] = useState(false);
    const items = MODE_IDS.map((candidate) => ({
        id: candidate,
        label: (_jsxs("span", { className: css.modeItem, children: [_jsx("span", { className: css.modeOptionTitle, children: t(`approval.mode.${candidate}`) }), _jsx("span", { className: css.modeOptionDesc, children: t(`approval.mode.${candidate}.desc`) })] })),
    }));
    return (_jsx(Menu, { open: open, portal: true, align: "end", compact: true, className: css.modeTrigger, items: items, selectedId: mode ?? undefined, onSelect: (id) => {
            if (id === 'persistent' || id === 'dag')
                onSelect(id);
        }, onClose: () => setOpen(false), anchor: (_jsxs("button", { type: "button", className: css.modeTrigger, "aria-haspopup": "menu", "aria-expanded": open, disabled: busy, onClick: () => setOpen((value) => !value), children: [t(mode === 'dag' ? 'approval.mode.dag' : 'approval.mode.persistent'), _jsx(DisclosureChevron, { open: open })] })) }));
}
/**
 * Shared card header: the lead avatar, the card title and the pending-state
 * badge. Every view wears the same head so a folded proposal looks identical
 * whichever session it is read in.
 */
function ApprovalHead({ variant, t }) {
    return (_jsxs("header", { className: css.head, children: [_jsx("img", { className: css.leadAvatar, src: LEAD_ART, alt: "", "aria-hidden": true }), _jsx("span", { className: css.title, children: t('approval.title') }), _jsx("span", { className: css.stateBadge, children: t(variant === 'owner' ? 'approval.state.pending_owner' : 'approval.state.pending_captain') })] }));
}
/**
 * Member roster: one chip per proposed member, wearing the same OC avatar the
 * activity panel uses (falls back to an initial when the role has no art).
 * Renders nothing for a proposal that carries no plan.
 */
function ApprovalRoster({ members, t }) {
    if (members.length === 0)
        return null;
    return (_jsx("div", { className: css.roster, role: "list", "aria-label": t('approval.rosterLabel'), children: members.map((member) => {
            const art = memberArtUrl(member.name, member.role);
            return (_jsxs("span", { className: css.memberChip, role: "listitem", title: `${member.name} · ${member.role}`, children: [art !== null
                        ? _jsx("img", { className: css.memberArt, src: art, alt: "", "aria-hidden": true })
                        : _jsx("span", { className: css.memberInitial, "aria-hidden": true, children: member.name.slice(0, 1).toUpperCase() }), _jsx("span", { className: css.memberName, children: member.name }), _jsx("span", { className: css.memberRole, children: member.role })] }, `${member.name}:${member.role}`));
        }) }));
}
/** Count chips: members, tasks and dependency edges, one chip each. */
function ApprovalCounts({ data, t }) {
    return (_jsxs("div", { className: css.chips, children: [_jsx("span", { className: css.chip, children: t('approval.chip.members', { count: data.members.length }) }), _jsx("span", { className: css.chip, children: t('approval.chip.tasks', { count: data.taskCount }) }), _jsx("span", { className: css.chip, children: t('approval.chip.deps', { count: data.dependencyCount }) })] }));
}
/**
 * The proposed task graph in one flat list: each task keeps its id, its subject
 * and the ids it waits for. A card is not a canvas, so the dependencies are
 * named rather than drawn; the activity panel draws the real graph once the
 * team exists.
 */
function ApprovalTasks({ tasks, t }) {
    if (tasks.length === 0)
        return null;
    return (_jsxs("div", { className: css.tasks, children: [_jsx("span", { className: css.sectionLabel, children: t('approval.tasksLabel') }), _jsx("ul", { className: css.taskList, children: tasks.map((task) => (_jsxs("li", { className: css.taskRow, children: [_jsx("span", { className: css.taskId, children: task.id }), task.subject !== '' && _jsx("span", { className: css.taskSubject, children: task.subject }), task.dependsOn.length > 0
                            && _jsx("span", { className: css.taskDeps, children: t('approval.taskDeps', { deps: task.dependsOn.join(' · ') }) })] }, task.id))) })] }));
}
/** Read-only status used in the member's own session for a member proposal. */
function MemberWaitingCard({ data, t }) {
    return (_jsxs("section", { className: css.root, "data-sophia-approval": true, "data-request-id": data.requestId, children: [_jsx(ApprovalHead, { variant: "captain", t: t }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.goalLabel') }), _jsx("span", { className: css.lineValue, children: data.goal })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.requesterLabel') }), _jsx("span", { className: css.lineValue, children: t('approval.requester.member', { handle: data.requester.handle ?? '' }) })] }), _jsx(ApprovalRoster, { members: data.members, t: t }), _jsx(ApprovalCounts, { data: data, t: t }), _jsx(ApprovalTasks, { tasks: data.tasks, t: t }), _jsx("div", { className: css.feedback, children: t('approval.waiting') })] }));
}
/** Owner approval surface: mode-selector + [批准][退回]. */
function OwnerApprovalCard({ data, sessionId, t }) {
    const [mode, setMode] = useState(data.mode);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(undefined);
    const pendingAction = (action, payload) => async () => {
        setBusy(true);
        setError(undefined);
        try {
            await postApprovalPlanAction(sessionId, { action, requestId: data.requestId, ...payload });
        }
        catch (err) {
            setError(approvalErrorMessage(err));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("section", { className: css.root, "data-sophia-approval": true, "data-request-id": data.requestId, children: [_jsx(ApprovalHead, { variant: "owner", t: t }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.goalLabel') }), _jsx("span", { className: css.lineValue, children: data.goal })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.requesterLabel') }), _jsx("span", { className: css.lineValue, children: data.requester.isHuman ? t('approval.requester.human') : t('approval.requester.member', { handle: data.requester.handle ?? '' }) })] }), _jsx(ApprovalRoster, { members: data.members, t: t }), _jsx(ApprovalCounts, { data: data, t: t }), _jsx(ApprovalTasks, { tasks: data.tasks, t: t }), _jsxs("div", { className: css.modeRow, children: [_jsx("span", { className: css.modeLabel, children: t('approval.modeLabel') }), _jsx(TeamModeMenu, { mode: mode, busy: busy, t: t, onSelect: (next) => {
                            setMode(next);
                            void pendingAction('set_mode', { mode: next })();
                        } })] }), _jsxs("div", { className: css.actions, children: [_jsx("button", { type: "button", className: `${css.actionButton} ${css.approve}`, disabled: busy, onClick: () => void pendingAction('approve', { decision: 'approve', mode })(), children: t('approval.approve') }), _jsx("button", { type: "button", className: `${css.actionButton} ${css.danger}`, disabled: busy, onClick: () => void pendingAction('reject', {})(), children: t('approval.reject') })] }), error !== undefined && _jsx("div", { className: css.feedback, role: "alert", children: error })] }));
}
/** Captain review surface for a member-initiated pending_captain proposal. */
function CaptainReviewCard({ data, sessionId, t }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(undefined);
    const review = (decision) => async () => {
        setBusy(true);
        setError(undefined);
        try {
            const needReason = decision === 'downgrade_to_dag';
            const reason = needReason ? t('approval.review.downgradeReason') : undefined;
            await postApprovalPlanAction(sessionId, { action: 'review', requestId: data.requestId, decision, reason });
        }
        catch (err) {
            setError(approvalErrorMessage(err));
        }
        finally {
            setBusy(false);
        }
    };
    const verdicts = [
        { id: 'approve_dag', label: t('approval.review.approve_dag') },
        { id: 'approve_persistent', label: t('approval.review.approve_persistent') },
        { id: 'downgrade_to_dag', label: t('approval.review.downgrade_to_dag') },
        { id: 'reject', label: t('approval.review.reject') },
    ];
    return (_jsxs("section", { className: css.root, "data-sophia-approval": true, "data-request-id": data.requestId, children: [_jsx(ApprovalHead, { variant: "captain", t: t }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.goalLabel') }), _jsx("span", { className: css.lineValue, children: data.goal })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.requesterLabel') }), _jsx("span", { className: css.lineValue, children: t('approval.requester.member', { handle: data.requester.handle ?? '' }) })] }), _jsx(ApprovalRoster, { members: data.members, t: t }), _jsx(ApprovalCounts, { data: data, t: t }), _jsx(ApprovalTasks, { tasks: data.tasks, t: t }), _jsx("div", { className: css.actions, children: verdicts.map((verdict) => (_jsx("button", { type: "button", className: `${css.actionButton} ${verdict.id === 'reject' ? css.danger : ''}`, disabled: busy, onClick: () => void review(verdict.id)(), children: verdict.label }, verdict.id))) }), error !== undefined && _jsx("div", { className: css.feedback, role: "alert", children: error })] }));
}
/** Render one pending Sophia approval proposal as a compact conversation card. */
export default function SophiaApprovalCard({ node, sessionId, t, reviewer }) {
    const data = node.data;
    // Member-initiated (requester is a member, not the human owner):
    if (!data.requester.isHuman) {
        return reviewer
            ? _jsx(CaptainReviewCard, { data: data, sessionId: sessionId, t: t })
            : _jsx(MemberWaitingCard, { data: data, t: t });
    }
    // Human-owner initiated: owner session controls (mode-selector + approve/reject).
    return _jsx(OwnerApprovalCard, { data: data, sessionId: sessionId, t: t }, data.requestId);
}
