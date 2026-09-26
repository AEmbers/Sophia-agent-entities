/**
 * Sophia approval conversation card: the in-conversation approver surface for
 * a pending team proposal (design §4.4.2–4.4.3). It renders BEFORE the team is
 * materialized while the proposal is awaiting owner or captain approval.
 *
 * The card is a leaf: every interaction posts the full action record to the
 * host (`POST /plugins/dsh-sophia-entities/approvals/plan`) and reads back the
 * host's own verdict, so durable truth stays on the Node side.
 *
 * A card is folded from immutable conversation records, which means the state
 * baked into the transcript stays `pending_*` forever. The card therefore keeps
 * its own settlement: the `state` the host returns for an action, plus one
 * reconciliation against the live pending queue on mount. Without it a decided
 * proposal kept offering [批准][退回] and answered every further click with
 * "is not awaiting owner decision" — which reads as buttons that do nothing.
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