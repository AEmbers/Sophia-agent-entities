import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Pending-approval badge: the Human-owner sidebar footer dot + count that
 * summons attention to a waiting team proposal (P4.2, design §4.6 channel 3).
 *
 * Pure client leaf — it polls `GET /plugins/dsh-sophia-entities/approvals`
 * (the host route the approval card already drives) and, when the queue holds
 * a request in `pending_owner` / `pending_captain`, surfaces a red count dot
 * on the sidebar footer action row. There is nothing to guess on the client:
 * the host owns the queue, the badge is only ever a mirror of what the host
 * reports (§4.2 acceptance: 徽标计数 > 0 when a pending_owner exists).
 * @module dsh-sophia-entities/client/sophia-approval-badge
 */
import { useEffect, useState } from 'react';
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { startApprovalBadgePolling } from "./sophia-approval-badge.js";
import css from './SophiaApprovalCard.module.css';
const EMPTY_AGGREGATE = { count: 0, states: [] };
/**
 * Default export registered into `sidebar.footer.action` with its own id so it
 * can stack alongside the Team-mode footer action without claiming a seat.
 * Renders nothing (fragments to the tooltip title guard) while the queue is
 * empty; a non-zero count shows the red dot plus the count when the rail is
 * wide. A click hands off to the injected `onOpenApprovals` navigation (or
 * falls back to no-op when the host surfaces no such handler).
 */
export default function SophiaApprovalBadge({ wide, onOpenApprovals, t, }) {
    const [aggregate, setAggregate] = useState(EMPTY_AGGREGATE);
    useEffect(() => {
        const controller = startApprovalBadgePolling((next) => {
            setAggregate(next);
        });
        return () => { controller.stop(); };
    }, []);
    if (aggregate.count <= 0)
        return null;
    const label = t('approval.badge.label', { count: aggregate.count });
    const onClick = () => { onOpenApprovals?.(); };
    return (_jsx(Tooltip, { label: label, delayMs: 400, disabled: wide, children: _jsxs("button", { type: "button", className: wide ? css.badgeWide : `${css.badgeRail} ${css.badgeAction}`, "aria-label": label, "data-approval-badge-count": aggregate.count, onClick: onClick, children: [wide && _jsx("span", { className: css.badgeText, children: t('approval.badge.title') }), _jsx("span", { className: css.badgeDot, "data-count": aggregate.count, children: aggregate.count })] }) }));
}
