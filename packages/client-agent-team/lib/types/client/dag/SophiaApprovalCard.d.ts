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
import { type JSX } from 'react';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** Injection from the plugin (and the node-side owner/captain session card). */
export interface SophiaApprovalCardInjected {
    /** True when rendered in the captain's session: show the review verdicts. */
    readonly reviewer?: boolean;
    /** Optional "view in activity tree" handler (teams summary surface). */
    readonly onOpenActivity?: () => void;
}
/** Complete keyed Chat renderer props. */
export type SophiaApprovalCardProps = PropsRuntime<'conversation.chat.node', 'sophia-approval'> & PropsLocale<'sophiaEntities'> & SophiaApprovalCardInjected;
/** Render one pending Sophia approval proposal as a compact conversation card. */
export default function SophiaApprovalCard({ node, sessionId, t, reviewer }: SophiaApprovalCardProps): JSX.Element;
//# sourceMappingURL=SophiaApprovalCard.d.ts.map