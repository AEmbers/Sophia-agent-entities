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
/** Read-only status used in the member's own session for a member proposal. */
function MemberWaitingCard({ data, t }) {
    return (_jsxs("section", { className: css.root, "data-sophia-approval": true, "data-request-id": data.requestId, children: [_jsxs("header", { className: css.head, children: [_jsx("span", { className: css.title, children: t('approval.title') }), _jsx("span", { className: css.stateBadge, children: t('approval.state.pending_captain') })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.goalLabel') }), _jsx("span", { className: css.lineValue, children: data.goal })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.requesterLabel') }), _jsx("span", { className: css.lineValue, children: t('approval.requester.member', { handle: data.requester.handle ?? '' }) })] }), _jsx("div", { className: css.counts, children: t('approval.counts', { members: data.members.length, tasks: data.taskCount, deps: data.dependencyCount }) }), _jsx("div", { className: css.feedback, children: t('approval.waiting') })] }));
}
/** Owner approval surface: mode-selector + [批准][退回]. */
function OwnerApprovalCard({ data, t }) {
    const [mode, setMode] = useState(data.mode);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(undefined);
    const pendingAction = (action, payload) => async () => {
        setBusy(true);
        setError(undefined);
        try {
            await postApprovalPlanAction({ action, requestId: data.requestId, ...payload });
        }
        catch (err) {
            setError(approvalErrorMessage(err));
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("section", { className: css.root, "data-sophia-approval": true, "data-request-id": data.requestId, children: [_jsxs("header", { className: css.head, children: [_jsx("span", { className: css.title, children: t('approval.title') }), _jsx("span", { className: css.stateBadge, children: t('approval.state.pending_owner') })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.goalLabel') }), _jsx("span", { className: css.lineValue, children: data.goal })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.requesterLabel') }), _jsx("span", { className: css.lineValue, children: data.requester.isHuman ? t('approval.requester.human') : t('approval.requester.member', { handle: data.requester.handle ?? '' }) })] }), _jsxs("div", { className: css.modeRow, children: [_jsx("span", { className: css.modeLabel, children: t('approval.modeLabel') }), _jsx(TeamModeMenu, { mode: mode, busy: busy, t: t, onSelect: (next) => {
                            setMode(next);
                            void pendingAction('set_mode', { mode: next })();
                        } })] }), _jsx("div", { className: css.counts, children: t('approval.counts', { members: data.members.length, tasks: data.taskCount, deps: data.dependencyCount }) }), _jsxs("div", { className: css.actions, children: [_jsx("button", { type: "button", className: `${css.actionButton} ${css.approve}`, disabled: busy, onClick: () => void pendingAction('approve', { decision: 'approve', mode })(), children: t('approval.approve') }), _jsx("button", { type: "button", className: `${css.actionButton} ${css.danger}`, disabled: busy, onClick: () => void pendingAction('reject', {})(), children: t('approval.reject') })] }), error !== undefined && _jsx("div", { className: css.feedback, role: "alert", children: error })] }));
}
/** Captain review surface for a member-initiated pending_captain proposal. */
function CaptainReviewCard({ data, t }) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(undefined);
    const review = (decision) => async () => {
        setBusy(true);
        setError(undefined);
        try {
            const needReason = decision === 'downgrade_to_dag';
            const reason = needReason ? t('approval.review.downgradeReason') : undefined;
            await postApprovalPlanAction({ action: 'review', requestId: data.requestId, decision, reason });
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
    return (_jsxs("section", { className: css.root, "data-sophia-approval": true, "data-request-id": data.requestId, children: [_jsxs("header", { className: css.head, children: [_jsx("span", { className: css.title, children: t('approval.title') }), _jsx("span", { className: css.stateBadge, children: t('approval.state.pending_captain') })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.goalLabel') }), _jsx("span", { className: css.lineValue, children: data.goal })] }), _jsxs("div", { className: css.line, children: [_jsx("span", { className: css.lineKey, children: t('approval.requesterLabel') }), _jsx("span", { className: css.lineValue, children: t('approval.requester.member', { handle: data.requester.handle ?? '' }) })] }), _jsx("div", { className: css.counts, children: t('approval.counts', { members: data.members.length, tasks: data.taskCount, deps: data.dependencyCount }) }), _jsx("div", { className: css.actions, children: verdicts.map((verdict) => (_jsx("button", { type: "button", className: `${css.actionButton} ${verdict.id === 'reject' ? css.danger : ''}`, disabled: busy, onClick: () => void review(verdict.id)(), children: verdict.label }, verdict.id))) }), error !== undefined && _jsx("div", { className: css.feedback, role: "alert", children: error })] }));
}
/** Render one pending Sophia approval proposal as a compact conversation card. */
export default function SophiaApprovalCard({ node, t, reviewer }) {
    const data = node.data;
    // Member-initiated (requester is a member, not the human owner):
    if (!data.requester.isHuman) {
        return reviewer
            ? _jsx(CaptainReviewCard, { data: data, t: t })
            : _jsx(MemberWaitingCard, { data: data, t: t });
    }
    // Human-owner initiated: owner session controls (mode-selector + approve/reject).
    return _jsx(OwnerApprovalCard, { data: data, t: t }, data.requestId);
}
