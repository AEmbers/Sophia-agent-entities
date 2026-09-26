/**
 * Pending-approval badge state (P4.2, design §4.6 channel 3 / dev-plan:190).
 *
 * The client is a leaf: durable truth lives on the Node side, so the badge
 * polls the host `GET /plugins/dsh-sophia-entities/approvals` snapshot and
 * counts the requests that demand the Human owner's attention. We surface the
 * count plus the states so the footer action can decide wording; the badge is
 * rendered only when the count is non-zero (§4.2 acceptance: '有 pending_owner
 * 时徽标计数 > 0').
 * @module dsh-sophia-entities/client/sophia-approval-badge
 */

/** GET target mirroring the card's POST plan route (orchestration routes.ts). */
export const APPROVALS_STATE_URL = '/plugins/dsh-sophia-entities/approvals'

/** Live-poll cadence for the badge. Matches the activity monitor's hot loop. */
export const APPROVAL_POLL_MS = 5000

/** One row of the host ApprovalsSnapshot (routes.ts ApprovalsSnapshot). */
export interface SophiaApprovalSnapshotRow {
  readonly id: string
  readonly goal: string
  readonly requester: string
  readonly mode?: string
  readonly state: string
  readonly createdAt: number
  readonly expiresAt?: number
}

/**
 * The state the badge reacts to. Present-day orchestration keeps proposals in
 * `pending_captain` then `pending_owner`; both are in-flight approvals the
 * Human should see. `draft` is excluded — it is not yet routed to anyone.
 */
export const APPROVAL_BADGE_STATES: ReadonlySet<string> = new Set([
  'pending_owner',
  'pending_captain',
])

/**
 * Count the rows that belong in the badge, and report the states present so a
 * caller can tailor copy. `aggregateApprovalSnapshot(undefined)` returns an
 * empty aggregate (a failed/absent poll must not summon a phantom badge).
 */
export interface SophiaApprovalAggregate {
  readonly count: number
  readonly states: readonly string[]
}

/** Fold a raw ApprovalsSnapshot body into the badge aggregate. */
export function aggregateApprovalSnapshot(
  body: { readonly requests?: unknown } | null | undefined,
): SophiaApprovalAggregate {
  if (body === null || body === undefined) return { count: 0, states: [] }
  if (!Array.isArray(body.requests)) return { count: 0, states: [] }
  const states = new Set<string>()
  let count = 0
  for (const row of body.requests) {
    if (typeof row !== 'object' || row === null) continue
    const state = (row as { state?: unknown }).state
    if (typeof state !== 'string' || !APPROVAL_BADGE_STATES.has(state)) continue
    states.add(state)
    count += 1
  }
  return { count, states: [...states].sort() }
}

/** Optional seams for pull an isolated vitest bench. */
export interface ApprovalBadgeRuntime {
  fetchState?: (url: string, init?: RequestInit) => Promise<Response>
  schedule?: (callback: () => void, intervalMs: number) => unknown
  cancel?: (timer: unknown) => void
}

/**
 * Start the badge polling loop. Notifies the subscriber with the latest
 * aggregate on every tick; a failed poll keeps the previous snapshot (host
 * restarting) and retries on the next tick, so the badge never flickers away
 * mid-restart-only to appear when the host answers.
 */
export interface ApprovalBadgeController {
  readonly firstTick: Promise<void>
  stop: () => void
  isCancelled: () => boolean
}

export function startApprovalBadgePolling(
  subscriber: (aggregate: SophiaApprovalAggregate) => void,
  runtime: ApprovalBadgeRuntime = {},
): ApprovalBadgeController {
  const fetchState = runtime.fetchState ?? ((url, init) => fetch(url, init))
  const schedule = runtime.schedule ?? ((callback, intervalMs) => setInterval(callback, intervalMs))
  const cancel = runtime.cancel ?? ((timer) => { clearInterval(timer as ReturnType<typeof setInterval>) })
  let cancelled = false
  let inFlight = false
  let timer: unknown
  let controller: AbortController | undefined
  const tick = async (): Promise<void> => {
    if (inFlight || cancelled) return
    inFlight = true
    controller = new AbortController()
    try {
      const response = await fetchState(APPROVALS_STATE_URL, {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (cancelled) return
      if (!response.ok) throw new Error('Approvals unavailable')
      const body = (await response.json()) as { readonly requests?: unknown } | null | undefined
      if (cancelled) return
      subscriber(aggregateApprovalSnapshot(body))
    } catch (error: unknown) {
      if ((error as { name?: unknown })?.name === 'AbortError') return
      // Host restarting; keep the last snapshot and retry on the next tick.
    } finally {
      inFlight = false
    }
  }
  const firstTick = tick()
  if (timer === undefined) timer = schedule(() => { void tick() }, APPROVAL_POLL_MS)
  return {
    firstTick,
    stop: () => {
      if (cancelled) return
      cancelled = true
      controller?.abort()
      cancel(timer)
    },
    isCancelled: () => cancelled,
  }
}