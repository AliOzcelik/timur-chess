import { describe, expect, it } from 'vitest'
import { fakeServer } from '../test/helpers'
import { useHealth } from './health'

describe('health store', () => {
  it('loads the server status', async () => {
    fakeServer({ 'GET /api/health': () => ({ body: { ok: true, version: '0.1.0', engines: {} } }) })
    await useHealth.getState().refresh()
    expect(useHealth.getState().health?.version).toBe('0.1.0')
    expect(useHealth.getState().error).toBeNull()
  })

  it('remembers why it failed', async () => {
    fakeServer({ 'GET /api/health': () => ({ status: 500, body: { detail: 'boom' } }) })
    await useHealth.getState().refresh()
    expect(useHealth.getState().error).toBe('boom')
  })
})
