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

import { useEffect, useState, type JSX } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { TeamMode } from 'dsh-sophia-entities/orchestration/types'
import type { SophiaApprovalCardData } from './sophia-approval-card-definition.ts'
import type { ApprovalLiveState, CaptainVerdict } from './sophia-approval-requests.ts'
import { approvalErrorMessage, fetchApprovalRequestState, postApprovalPlanAction } from './sophia-approval-requests.ts'
import { settlementLabelOf, settlementOf, type ApprovalSettlement } from './sophia-approval-settlement.ts'
import { LEAD_ART, memberArtUrl } from './artwork.ts'
import css from './SophiaApprovalCard.module.css'

/** Bound translator for this namespace (the card's three views share it). */
type ApprovalLocale = PropsLocale<'sophiaEntities'>['t']

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

/**
 * Reconcile one folded request against the live pending queue, once per mount.
 * A failed read reports `undefined` and settles nothing, so a host restart can
 * never masquerade as a decision.
 */
function useApprovalLiveState(requestId: string): ApprovalLiveState {
  const [live, setLive] = useState<ApprovalLiveState>(undefined)
  useEffect(() => {
    let cancelled = false
    void fetchApprovalRequestState(requestId)
      .then((next) => { if (!cancelled) setLive(next) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [requestId])
  return live
}

/** Localized wording for a settlement, with the raw state as the last resort. */
function settledText(settlement: ApprovalSettlement, t: ApprovalLocale): string {
  const label = settlementLabelOf(settlement)
  switch (label.key) {
    case 'approval.settled.gone': return t('approval.settled.gone')
    case 'approval.settled.approved': return t('approval.settled.approved')
    case 'approval.settled.rejected': return t('approval.settled.rejected')
    case 'approval.settled.materialized': return t('approval.settled.materialized')
    default: return t('approval.settled.other', { state: label.state })
  }
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
  readonly t: ApprovalLocale
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

/** Which pending state the header badge names. */
type ApprovalVariant = 'owner' | 'captain'

/**
 * Shared card header: the lead avatar, the card title and the state badge —
 * the pending-state while a decision is owed, the settlement once it is not.
 * Every view wears the same head so a folded proposal looks identical whichever
 * session it is read in.
 */
function ApprovalHead({ variant, settled, t }: { readonly variant: ApprovalVariant; readonly settled: ApprovalSettlement | undefined; readonly t: ApprovalLocale }): JSX.Element {
  const badge = settled === undefined
    ? t(variant === 'owner' ? 'approval.state.pending_owner' : 'approval.state.pending_captain')
    : t('approval.state.settled')
  return (
    <header className={css.head}>
      <img className={css.leadAvatar} src={LEAD_ART} alt="" aria-hidden />
      <span className={css.title}>{t('approval.title')}</span>
      <span className={css.stateBadge} data-settled={settled !== undefined || undefined}>{badge}</span>
    </header>
  )
}

/**
 * Member roster: one chip per proposed member, wearing the same OC avatar the
 * activity panel uses (falls back to an initial when the role has no art).
 * Renders nothing for a proposal that carries no plan.
 */
function ApprovalRoster({ members, t }: { readonly members: SophiaApprovalCardData['members']; readonly t: ApprovalLocale }): JSX.Element | null {
  if (members.length === 0) return null
  return (
    <div className={css.roster} role="list" aria-label={t('approval.rosterLabel')}>
      {members.map((member) => {
        const art = memberArtUrl(member.name, member.role)
        return (
          <span className={css.memberChip} role="listitem" key={`${member.name}:${member.role}`} title={`${member.name} · ${member.role}`}>
            {art !== null
              ? <img className={css.memberArt} src={art} alt="" aria-hidden />
              : <span className={css.memberInitial} aria-hidden>{member.name.slice(0, 1).toUpperCase()}</span>}
            <span className={css.memberName}>{member.name}</span>
            <span className={css.memberRole}>{member.role}</span>
          </span>
        )
      })}
    </div>
  )
}

/** Count chips: members, tasks and dependency edges, one chip each. */
function ApprovalCounts({ data, t }: { readonly data: SophiaApprovalCardData; readonly t: ApprovalLocale }): JSX.Element {
  return (
    <div className={css.chips}>
      <span className={css.chip}>{t('approval.chip.members', { count: data.members.length })}</span>
      <span className={css.chip}>{t('approval.chip.tasks', { count: data.taskCount })}</span>
      <span className={css.chip}>{t('approval.chip.deps', { count: data.dependencyCount })}</span>
    </div>
  )
}

/**
 * The proposed task graph in one flat list: each task keeps its id, its subject
 * and the ids it waits for. A card is not a canvas, so the dependencies are
 * named rather than drawn; the activity panel draws the real graph once the
 * team exists.
 */
function ApprovalTasks({ tasks, t }: { readonly tasks: SophiaApprovalCardData['tasks']; readonly t: ApprovalLocale }): JSX.Element | null {
  if (tasks.length === 0) return null
  return (
    <div className={css.tasks}>
      <span className={css.sectionLabel}>{t('approval.tasksLabel')}</span>
      <ul className={css.taskList}>
        {tasks.map((task) => (
          <li className={css.taskRow} key={task.id}>
            <span className={css.taskId}>{task.id}</span>
            {task.subject !== '' && <span className={css.taskSubject}>{task.subject}</span>}
            {task.dependsOn.length > 0
              && <span className={css.taskDeps}>{t('approval.taskDeps', { deps: task.dependsOn.join(' · ') })}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Read-only status used in the member's own session for a member proposal. */
function MemberWaitingCard({ data, t }: { readonly data: SophiaApprovalCardData; readonly t: ApprovalLocale }): JSX.Element {
  const live = useApprovalLiveState(data.requestId)
  const settled = settlementOf(undefined, live)
  return (
    <section className={css.root} data-sophia-approval data-request-id={data.requestId}>
      <ApprovalHead variant="captain" settled={settled} t={t} />
      <div className={css.line}><span className={css.lineKey}>{t('approval.goalLabel')}</span><span className={css.lineValue}>{data.goal}</span></div>
      <div className={css.line}><span className={css.lineKey}>{t('approval.requesterLabel')}</span><span className={css.lineValue}>{t('approval.requester.member', { handle: data.requester.handle ?? '' })}</span></div>
      <ApprovalRoster members={data.members} t={t} />
      <ApprovalCounts data={data} t={t} />
      <ApprovalTasks tasks={data.tasks} t={t} />
      {settled === undefined
        ? <div className={css.feedback}>{t('approval.waiting')}</div>
        : <div className={css.settled} data-settled>{settledText(settled, t)}</div>}
    </section>
  )
}

/** Owner approval surface: mode-selector + [批准][退回]. */
function OwnerApprovalCard({ data, sessionId, t }: { readonly data: SophiaApprovalCardData; readonly sessionId: string; readonly t: ApprovalLocale }): JSX.Element {
  const [mode, setMode] = useState<TeamMode | undefined>(data.mode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [outcome, setOutcome] = useState<string | undefined>(undefined)
  const live = useApprovalLiveState(data.requestId)
  const settled = settlementOf(outcome, live)
  const liveMode = live !== undefined && live !== 'absent' ? live.mode : undefined
  useEffect(() => {
    if (liveMode === 'persistent' || liveMode === 'dag') setMode(liveMode)
  }, [liveMode])
  const pendingAction = (action: 'set_mode' | 'approve' | 'reject', payload: Record<string, unknown>) => async () => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await postApprovalPlanAction(sessionId, { action, requestId: data.requestId, ...payload } as never)
      if (result?.state !== undefined) setOutcome(result.state)
      if (result?.mode !== undefined) setMode(result.mode)
    } catch (err) {
      setError(approvalErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={css.root} data-sophia-approval data-request-id={data.requestId}>
      <ApprovalHead variant="owner" settled={settled} t={t} />
      <div className={css.line}><span className={css.lineKey}>{t('approval.goalLabel')}</span><span className={css.lineValue}>{data.goal}</span></div>
      <div className={css.line}><span className={css.lineKey}>{t('approval.requesterLabel')}</span><span className={css.lineValue}>{data.requester.isHuman ? t('approval.requester.human') : t('approval.requester.member', { handle: data.requester.handle ?? '' })}</span></div>
      <ApprovalRoster members={data.members} t={t} />
      <ApprovalCounts data={data} t={t} />
      <ApprovalTasks tasks={data.tasks} t={t} />
      {settled === undefined && (
        <>
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
        </>
      )}
      {settled !== undefined && <div className={css.settled} data-settled>{settledText(settled, t)}</div>}
      {error !== undefined && <div className={css.feedback} role="alert">{error}</div>}
    </section>
  )
}

/** Captain review surface for a member-initiated pending_captain proposal. */
function CaptainReviewCard({ data, sessionId, t }: { readonly data: SophiaApprovalCardData; readonly sessionId: string; readonly t: ApprovalLocale }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [outcome, setOutcome] = useState<string | undefined>(undefined)
  const live = useApprovalLiveState(data.requestId)
  const settled = settlementOf(outcome, live)
  const review = (decision: CaptainVerdict) => async () => {
    setBusy(true)
    setError(undefined)
    try {
      const needReason = decision === 'downgrade_to_dag'
      const reason = needReason ? t('approval.review.downgradeReason') : undefined
      const result = await postApprovalPlanAction(sessionId, { action: 'review', requestId: data.requestId, decision, reason })
      if (result?.state !== undefined) setOutcome(result.state)
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
      <ApprovalHead variant="captain" settled={settled} t={t} />
      <div className={css.line}><span className={css.lineKey}>{t('approval.goalLabel')}</span><span className={css.lineValue}>{data.goal}</span></div>
      <div className={css.line}><span className={css.lineKey}>{t('approval.requesterLabel')}</span><span className={css.lineValue}>{t('approval.requester.member', { handle: data.requester.handle ?? '' })}</span></div>
      <ApprovalRoster members={data.members} t={t} />
      <ApprovalCounts data={data} t={t} />
      <ApprovalTasks tasks={data.tasks} t={t} />
      {settled === undefined && (
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
      )}
      {settled !== undefined && <div className={css.settled} data-settled>{settledText(settled, t)}</div>}
      {error !== undefined && <div className={css.feedback} role="alert">{error}</div>}
    </section>
  )
}

/** Render one pending Sophia approval proposal as a compact conversation card. */
export default function SophiaApprovalCard({ node, sessionId, t, reviewer }: SophiaApprovalCardProps): JSX.Element {
  const data = node.data
  // Member-initiated (requester is a member, not the human owner):
  if (!data.requester.isHuman) {
    return reviewer
      ? <CaptainReviewCard data={data} sessionId={sessionId} t={t} />
      : <MemberWaitingCard data={data} t={t} />
  }
  // Human-owner initiated: owner session controls (mode-selector + approve/reject).
  return <OwnerApprovalCard key={data.requestId} data={data} sessionId={sessionId} t={t} />
}
