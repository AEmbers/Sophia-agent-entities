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

import { useEffect, useState, type JSX } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { startApprovalBadgePolling, type SophiaApprovalAggregate } from './sophia-approval-badge.ts'
import css from './SophiaApprovalCard.module.css'

/** Injection passed by the plugin registration (empty for the footer badge). */
export interface SophiaApprovalBadgeInjected {
  readonly onOpenApprovals?: () => void
}

/** Complete footer-row props for the additive `sidebar.footer.action` slot. */
export type SophiaApprovalBadgeProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'sophiaEntities'>
  & SophiaApprovalBadgeInjected

const EMPTY_AGGREGATE: SophiaApprovalAggregate = { count: 0, states: [] }

/**
 * Default export registered into `sidebar.footer.action` with its own id so it
 * can stack alongside the Team-mode footer action without claiming a seat.
 * Renders nothing (fragments to the tooltip title guard) while the queue is
 * empty; a non-zero count shows the red dot plus the count when the rail is
 * wide. A click hands off to the injected `onOpenApprovals` navigation (or
 * falls back to no-op when the host surfaces no such handler).
 */
export default function SophiaApprovalBadge({
  wide,
  onOpenApprovals,
  t,
}: SophiaApprovalBadgeProps) {
  const [aggregate, setAggregate] = useState<SophiaApprovalAggregate>(EMPTY_AGGREGATE)

  useEffect(() => {
    const controller = startApprovalBadgePolling((next) => {
      setAggregate(next)
    })
    return () => { controller.stop() }
  }, [])

  if (aggregate.count <= 0) return null

  const label = t('approval.badge.label', { count: aggregate.count })
  const onClick = (): void => { onOpenApprovals?.() }

  return (
    <Tooltip label={label} delayMs={400} disabled={wide}>
      <button
        type="button"
        className={wide ? css.badgeWide : `${css.badgeRail} ${css.badgeAction}`}
        aria-label={label}
        data-approval-badge-count={aggregate.count}
        onClick={onClick}
      >
        {wide && <span className={css.badgeText}>{t('approval.badge.title')}</span>}
        <span className={css.badgeDot} data-count={aggregate.count}>
          {aggregate.count}
        </span>
      </button>
    </Tooltip>
  )
}