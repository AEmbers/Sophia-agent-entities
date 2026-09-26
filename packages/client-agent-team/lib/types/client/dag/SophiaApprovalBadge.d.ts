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
import { type JSX } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Injection passed by the plugin registration (empty for the footer badge). */
export interface SophiaApprovalBadgeInjected {
    readonly onOpenApprovals?: () => void;
}
/** Complete footer-row props for the additive `sidebar.footer.action` slot. */
export type SophiaApprovalBadgeProps = PropsRuntime<'sidebar.footer.action'> & PropsLocale<'sophiaEntities'> & SophiaApprovalBadgeInjected;
/**
 * Default export registered into `sidebar.footer.action` with its own id so it
 * can stack alongside the Team-mode footer action without claiming a seat.
 * Renders nothing (fragments to the tooltip title guard) while the queue is
 * empty; a non-zero count shows the red dot plus the count when the rail is
 * wide. A click hands off to the injected `onOpenApprovals` navigation (or
 * falls back to no-op when the host surfaces no such handler).
 */
export default function SophiaApprovalBadge({ wide, onOpenApprovals, t, }: SophiaApprovalBadgeProps): JSX.Element | null;
//# sourceMappingURL=SophiaApprovalBadge.d.ts.map