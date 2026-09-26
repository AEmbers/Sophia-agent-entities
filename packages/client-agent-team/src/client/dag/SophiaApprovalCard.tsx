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

import { useState, type JSX } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamMode } from 'dsh-sophia-entities/orchestration/types'
import type { SophiaApprovalCardData } from './sophia-approval-card-definition.ts'
import type { CaptainVerdict } from './sophia-approval-requests.ts'
import { approvalErrorMessage, postApprovalPlanAction } from './sophia-approval-requests.ts'
import css from './SophiaApprovalCard.module.css'

/** Injection from the plugin (and the node-side owner/captain session card). */
export interface SophiaApprovalCardInjected {
  /** True when rendered in the captain's session: show the review verdicts. */
  readonly reviewer?: boolean
  /** Optional "view in activity tree" handler (teams summary surface). */
  readonly onOpenActivity?: () => void
}

/** Complete keyed Chat renderer props. */
export type SophiaApprovalCardProps =
  PropsRuntime<'conversation.chat.node', 'sophia-approval'>
  & PropsLocale<'sophiaEntities'>
  & SophiaApprovalCardInjected

/** Team-mode selector entries: id, label and designer description. */
const MODE_IDS = ['persistent', 'dag'] as const

function DisclosureChevron({ open }: { readonly open: boolean }): JSX.Element {
  return (
    <svg className={css.modeChevron} data-open={open} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <path d="M4 2.5 7.5 6 4 9.5" />
    </svg>
  )
}

function TeamModeMenu({
  mode,
  busy,
  onSelect,
  t,
}: {
  readonly mode: TeamMode | undefined
  readonly busy: boolean
  readonly onSelect: (mode: TeamMode) => void
  readonly t: PropsLocale<'sophiaEntities'>['t']
}) {
  const [open, setOpen] = useState(false)
  const items: readonly MenuEntry[] = MODE_IDS.map((candidate) => ({
    id: candidate,
    label: (
      <span className={css.modeItem}>
        <span className={css.modeOptionTitle}>{t(`approval.mode.${candidate}`)}</span>
        <span className={css.modeOptionDesc}>{t(`approval.mode.${candidate}.desc`)}</span>
      </span>
    ),
  }))
  return (
    <Menu
      open={open}
      portal
      align="end"
      compact
      className={css.modeTrigger}
      items={items}
      selectedId={mode ?? undefined}
      onSelect={(id) => {
        if (id === 'persistent' || id === 'dag') onSelect(id)
      }}
      onClose={() => setOpen(false)}
      anchor={(
        <button
          type="button"
          className={css.modeTrigger}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((value) => !value)}
        >
          {t(mode === 'dag' ? 'approval.mode.dag' : 'approval.mode.persistent')}
          <DisclosureChevron open={open} />
        </button>
      )}
    />
  )
}

/** Read-only status used in the member's own session for a member proposal. */
function MemberWaitingCard({ data, t }: { readonly data: SophiaApprovalCardData; readonly t: PropsLocale<'sophiaEntities'>['t'] }): JSX.Element {
  return (
    <section className={css.root} data-sophia-approval data-request-id={data.requestId}>
      <header className={css.head}>
        <span className={css.title}>{t('approval.title')}</span>
        <span className={css.stateBadge}>{t('approval.state.pending_captain')}</span>
      </header>
      <div className={css.line}><span className={css.lineKey}>{t('approval.goalLabel')}</span><span className={css.lineValue}>{data.goal}</span></div>
      <div className={css.line}><span className={css.lineKey}>{t('approval.requesterLabel')}</span><span className={css.lineValue}>{t('approval.requester.member', { handle: data.requester.handle ?? '' })}</span></div>
      <div className={css.counts}>{t('approval.counts', { members: data.members.length, tasks: data.taskCount, deps: data.dependencyCount })}</div>
      <div className={css.feedback}>{t('approval.waiting')}</div>
    </section>
  )
}

/** Owner approval surface: mode-selector + [批准][退回]. */
function OwnerApprovalCard({ data, t }: { readonly data: SophiaApprovalCardData; readonly t: PropsLocale<'sophiaEntities'>['t'] }): JSX.Element {
  const [mode, setMode] = useState<TeamMode | undefined>(data.mode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const pendingAction = (action: 'set_mode' | 'approve' | 'reject', payload: Record<string, unknown>) => async () => {
    setBusy(true)
    setError(undefined)
    try {
      await postApprovalPlanAction({ action, requestId: data.requestId, ...payload } as never)
    } catch (err) {
      setError(approvalErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={css.root} data-sophia-approval data-request-id={data.requestId}>
      <header className={css.head}>
        <span className={css.title}>{t('approval.title')}</span>
        <span className={css.stateBadge}>{t('approval.state.pending_owner')}</span>
      </header>
      <div className={css.line}><span className={css.lineKey}>{t('approval.goalLabel')}</span><span className={css.lineValue}>{data.goal}</span></div>
      <div className={css.line}><span className={css.lineKey}>{t('approval.requesterLabel')}</span><span className={css.lineValue}>{data.requester.isHuman ? t('approval.requester.human') : t('approval.requester.member', { handle: data.requester.handle ?? '' })}</span></div>
      <div className={css.modeRow}>
        <span className={css.modeLabel}>{t('approval.modeLabel')}</span>
        <TeamModeMenu
          mode={mode}
          busy={busy}
          t={t}
          onSelect={(next) => {
            setMode(next)
            void pendingAction('set_mode', { mode: next })()
          }}
        />
      </div>
      <div className={css.counts}>{t('approval.counts', { members: data.members.length, tasks: data.taskCount, deps: data.dependencyCount })}</div>
      <div className={css.actions}>
        <button
          type="button"
          className={`${css.actionButton} ${css.approve}`}
          disabled={busy}
          onClick={() => void pendingAction('approve', { decision: 'approve', mode })()}
        >
          {t('approval.approve')}
        </button>
        <button
          type="button"
          className={`${css.actionButton} ${css.danger}`}
          disabled={busy}
          onClick={() => void pendingAction('reject', {})()}
        >
          {t('approval.reject')}
        </button>
      </div>
      {error !== undefined && <div className={css.feedback} role="alert">{error}</div>}
    </section>
  )
}

/** Captain review surface for a member-initiated pending_captain proposal. */
function CaptainReviewCard({ data, t }: { readonly data: SophiaApprovalCardData; readonly t: PropsLocale<'sophiaEntities'>['t'] }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const review = (decision: CaptainVerdict) => async () => {
    setBusy(true)
    setError(undefined)
    try {
      const needReason = decision === 'downgrade_to_dag'
      const reason = needReason ? t('approval.review.downgradeReason') : undefined
      await postApprovalPlanAction({ action: 'review', requestId: data.requestId, decision, reason })
    } catch (err) {
      setError(approvalErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const verdicts: readonly { id: CaptainVerdict; label: string }[] = [
    { id: 'approve_dag', label: t('approval.review.approve_dag') },
    { id: 'approve_persistent', label: t('approval.review.approve_persistent') },
    { id: 'downgrade_to_dag', label: t('approval.review.downgrade_to_dag') },
    { id: 'reject', label: t('approval.review.reject') },
  ]
  return (
    <section className={css.root} data-sophia-approval data-request-id={data.requestId}>
      <header className={css.head}>
        <span className={css.title}>{t('approval.title')}</span>
        <span className={css.stateBadge}>{t('approval.state.pending_captain')}</span>
      </header>
      <div className={css.line}><span className={css.lineKey}>{t('approval.goalLabel')}</span><span className={css.lineValue}>{data.goal}</span></div>
      <div className={css.line}><span className={css.lineKey}>{t('approval.requesterLabel')}</span><span className={css.lineValue}>{t('approval.requester.member', { handle: data.requester.handle ?? '' })}</span></div>
      <div className={css.counts}>{t('approval.counts', { members: data.members.length, tasks: data.taskCount, deps: data.dependencyCount })}</div>
      <div className={css.actions}>
        {verdicts.map((verdict) => (
          <button
            type="button"
            key={verdict.id}
            className={`${css.actionButton} ${verdict.id === 'reject' ? css.danger : ''}`}
            disabled={busy}
            onClick={() => void review(verdict.id)()}
          >
            {verdict.label}
          </button>
        ))}
      </div>
      {error !== undefined && <div className={css.feedback} role="alert">{error}</div>}
    </section>
  )
}

/** Render one pending Sophia approval proposal as a compact conversation card. */
export default function SophiaApprovalCard({ node, t, reviewer }: SophiaApprovalCardProps): JSX.Element {
  const data = node.data
  // Member-initiated (requester is a member, not the human owner):
  if (!data.requester.isHuman) {
    return reviewer
      ? <CaptainReviewCard data={data} t={t} />
      : <MemberWaitingCard data={data} t={t} />
  }
  // Human-owner initiated: owner session controls (mode-selector + approve/reject).
  return <OwnerApprovalCard key={data.requestId} data={data} t={t} />
}