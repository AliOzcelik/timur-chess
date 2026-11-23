import { describe, expect, it, vi } from 'vitest'
import { callsOf, fakeServer } from '../test/helpers'
import { ApiError, api } from './api'

describe('api client', () => {
  it('sends JSON and returns the answer', async () => {
    const server = fakeServer({ 'POST /api/reviews': () => ({ status: 201, body: { id: 5, game_count: 1 } }) })
    await expect(api.createReview('1. e4 *', 'quick', 'black')).resolves.toEqual({ id: 5, game_count: 1 })
    expect(callsOf(server)).toEqual([
      { route: 'POST /api/reviews', body: { pgn: '1. e4 *', profile: 'quick', my_color: 'black' } },
    ])
    const init = server.mock.calls[0][1] as RequestInit
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('GET requests have no body', async () => {
    const server = fakeServer({ 'GET /api/reviews': () => ({ body: { reviews: [], current: null } }) })
    await api.listReviews()
    expect((server.mock.calls[0][1] as RequestInit).body).toBeUndefined()
  })

  it('evaluate sends the position and limits', async () => {
    const server = fakeServer({ 'POST /api/engine/eval': () => ({ body: { eval: { cp: 0, mate: null }, best: null, pv_san: [] } }) })
    await api.evaluate('fen', ['e2e4'])
    expect(callsOf(server)[0].body).toEqual({ fen: 'fen', moves: ['e2e4'], depth: 18, seconds: 2 })
  })

  it('shows the server message on errors', async () => {
    fakeServer({ 'POST /api/pgn/parse': () => ({ status: 400, body: { detail: 'No game found.' } }) })
    const error = await api.parsePgn('').catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('No game found.')
  })

  it('validation errors get a plain message', async () => {
    fakeServer({ 'POST /api/reviews': () => ({ status: 422, body: { detail: [{ loc: ['body'], msg: 'bad' }] } }) })
    await expect(api.createReview('', 'quick', 'both')).rejects.toThrow('The request was not valid.')
  })

  it('unknown errors show the status code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>oops</html>', { status: 500 })))
    await expect(api.health()).rejects.toThrow('Server error (500).')
  })

  it('explains when the server is not running', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(api.health()).rejects.toThrow('Cannot reach the Timur server. Is ./start.sh still running?')
  })

  it('uses the right routes', async () => {
    const server = fakeServer({
      'GET /api/reviews/3': () => ({ body: { id: 3 } }),
      'DELETE /api/reviews/3': () => ({ body: { ok: true } }),
      'GET /api/health': () => ({ body: { ok: true } }),
    })
    await api.getReview(3)
    await api.deleteReview(3)
    await api.health()
    expect(callsOf(server).map((c) => c.route)).toEqual(['GET /api/reviews/3', 'DELETE /api/reviews/3', 'GET /api/health'])
  })
})
