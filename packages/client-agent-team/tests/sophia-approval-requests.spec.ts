import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPROVALS_PLAN_URL,
  fetchApprovalRequestState,
  postApprovalPlanAction,
  type SophiaApprovalPlanAction,
} from '../src/client/dag/sophia-approval-requests.ts'
import { APPROVALS_STATE_URL } from '../src/client/dag/sophia-approval-badge.ts'

interface Call { readonly url: string; readonly init: RequestInit | undefined }

/** Replace the global fetch and record every call. */
function stubFetch(response: Response = new Response('', { status: 200 })): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(response)
  })
  return calls
}

/** A fresh JSON responder, because a Response body can only be read once. */
function stubJson(body: unknown, status = 200): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  })
  return calls
}

function bodyOf(call: Call | undefined): Record<string, unknown> {
  expect(call).toBeDefined()
  const body = call?.init?.body
  expect(typeof body).toBe('string')
  return JSON.parse(body as string) as Record<string, unknown>
}

/** Every action the card can fire, one per union member. */
const ACTIONS: readonly SophiaApprovalPlanAction[] = [
  { action: 'set_mode', requestId: 'req-1', mode: 'dag' },
  { action: 'approve', requestId: 'req-1', decision: 'approve', mode: 'dag' },
  { action: 'reject', requestId: 'req-1' },
  { action: 'review', requestId: 'req-1', decision: 'downgrade_to_dag', reason: 'why' },
]

describe('postApprovalPlanAction', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  // Regression: the host route reads `sessionId` from the body and answers 400
  // `sessionId is required` without it, which is exactly what made [批准][退回]
  // and the mode switch look dead. Every action must carry it.
  it('carries the viewing session id on every action', async () => {
    for (const action of ACTIONS) {
      const calls = stubFetch()
      await postApprovalPlanAction('sess-1', action)
      expect(calls.length).toBe(1)
      expect(calls[0]?.url).toBe(APPROVALS_PLAN_URL)
      expect(calls[0]?.init?.method).toBe('POST')
      expect(calls[0]?.init?.cache).toBe('no-store')
      expect(bodyOf(calls[0])).toEqual({ ...action, sessionId: 'sess-1' })
    }
  })

  it('trims the session id and refuses an empty one before any request', async () => {
    const calls = stubFetch()
    await postApprovalPlanAction('  sess-2  ', { action: 'reject', requestId: 'req-2' })
    expect(bodyOf(calls[0])['sessionId']).toBe('sess-2')

    const none = stubFetch()
    await expect(postApprovalPlanAction('   ', { action: 'reject', requestId: 'req-2' }))
      .rejects.toThrow(/session id/)
    expect(none.length).toBe(0)
  })

  it('surfaces the host error message instead of the bare status', async () => {
    stubFetch(new Response(JSON.stringify({ error: 'sessionId is required' }), { status: 400 }))
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' }))
      .rejects.toThrow('sessionId is required')

    vi.unstubAllGlobals()
    stubFetch(new Response('nope', { status: 500 }))
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-3' }))
      .rejects.toThrow('HTTP 500')
  })

  it('resolves quietly on an ok response', async () => {
    const calls = stubFetch(new Response('', { status: 200 }))
    await expect(postApprovalPlanAction('sess-1', { action: 'approve', requestId: 'req-4', decision: 'approve' }))
      .resolves.toBeUndefined()
    expect(calls.length).toBe(1)
  })

  // Regression: the card kept offering [批准][退回] after a decision because the
  // ok body was discarded, so the next click came back "is not awaiting owner
  // decision". The host's verdict is what tells the card to stand down.
  it('returns the state the host settled the request into', async () => {
    stubJson({ request_id: 'req-5', state: 'rejected' })
    await expect(postApprovalPlanAction('sess-1', { action: 'reject', requestId: 'req-5' }))
      .resolves.toEqual({ requestId: 'req-5', state: 'rejected' })

    vi.unstubAllGlobals()
    stubJson({ request_id: 'req-6', state: 'materialized', mode: 'dag', materialized: true, team_ref: 'team-9' })
    await expect(postApprovalPlanAction('sess-1', { action: 'approve', requestId: 'req-6', decision: 'approve' }))
      .resolves.toEqual({ requestId: 'req-6', state: 'materialized', mode: 'dag', materialized: true, teamRef: 'team-9' })

    vi.unstubAllGlobals()
    stubJson({ request_id: 'req-7', state: 'pending_owner', mode: 'dag' })
    await expect(postApprovalPlanAction('sess-1', { action: 'set_mode', requestId: 'req-7', mode: 'dag' }))
      .resolves.toEqual({ requestId: 'req-7', state: 'pending_owner', mode: 'dag' })
  })
})

describe('fetchApprovalRequestState', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('reports the queued state and mode of a request that is still pending', async () => {
    const calls = stubJson({ requests: [{ id: 'req-1', state: 'pending_owner', mode: 'dag' }] })
    await expect(fetchApprovalRequestState('req-1')).resolves.toEqual({ kind: 'state', state: 'pending_owner', mode: 'dag' })
    expect(calls[0]?.url).toBe(APPROVALS_STATE_URL)
    expect(calls[0]?.init?.cache).toBe('no-store')
  })

  it('reports a request the queue no longer carries as absent', async () => {
    stubJson({ requests: [{ id: 'req-other', state: 'pending_owner' }] })
    await expect(fetchApprovalRequestState('req-1')).resolves.toBe('absent')
  })

  it('concludes nothing from a failed or unreadable snapshot', async () => {
    stubJson({ error: 'failed to load pending approvals' }, 500)
    await expect(fetchApprovalRequestState('req-1')).resolves.toBeUndefined()

    vi.unstubAllGlobals()
    stubJson({ not_requests: [] })
    await expect(fetchApprovalRequestState('req-1')).resolves.toBeUndefined()

    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('host restarting')))
    await expect(fetchApprovalRequestState('req-1')).resolves.toBeUndefined()

    vi.unstubAllGlobals()
    const none = stubJson({ requests: [] })
    await expect(fetchApprovalRequestState('  ')).resolves.toBeUndefined()
    expect(none.length).toBe(0)
  })
})
