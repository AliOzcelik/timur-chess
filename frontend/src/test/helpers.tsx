import { vi } from 'vitest'
import type { ReviewDetail } from '../lib/api'
import fixture from './fixtures/scholars-mate-review.json'

/** A real review produced by the backend (Scholar's Mate, reviewed for Black at the Quick depth). */
export function scholarsMateReview(overrides: Partial<ReviewDetail> = {}): ReviewDetail {
  return { ...(structuredClone(fixture) as unknown as ReviewDetail), ...overrides }
}

type Handler = (body: unknown, init: RequestInit) => { status?: number; body?: unknown } | Promise<{ status?: number; body?: unknown }>

/**
 * Replace fetch with a tiny fake server. Routes are "METHOD /path".
 * Unknown routes answer 404. Returns the mock so tests can inspect the calls.
 */
export function fakeServer(routes: Record<string, Handler>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input.toString()
    const key = `${(init.method ?? 'GET').toUpperCase()} ${url}`
    const handler = routes[key]
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const res = handler ? await handler(body, init) : { status: 404, body: { detail: 'Not found.' } }
    return new Response(JSON.stringify(res.body ?? {}), {
      status: res.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

/** Calls made to the fake server, as "METHOD /path" with the JSON body. */
export function callsOf(mock: ReturnType<typeof fakeServer>) {
  return mock.mock.calls.map(([input, init]) => ({
    route: `${((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase()} ${String(input)}`,
    body: (init as RequestInit | undefined)?.body ? JSON.parse(String((init as RequestInit).body)) : undefined,
  }))
}
