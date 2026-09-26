import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPROVALS_PLAN_URL,
  postApprovalPlanAction,
  type SophiaApprovalPlanAction,
} from '../src/client/dag/sophia-approval-requests.ts'

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
})
