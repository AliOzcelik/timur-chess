import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { Health } from './lib/api'
import { engineClient, useEngine } from './state/engine'
import { useHealth } from './state/health'
import { fakeServer, scholarsMateReview } from './test/helpers'

vi.mock('./components/Board', async () => ({ Board: (await import('./test/FakeBoard')).FakeBoard }))

const HEALTH: Health = {
  ok: true,
  version: '0.1.0',
  engines: {
    live: { label: 'live', name: 'Stockfish 19', path: '/opt/homebrew/bin/stockfish', threads: 8, hash_mb: 1024, running: true, error: null },
    review: { label: 'review', name: 'Stockfish 19', path: '/opt/homebrew/bin/stockfish', threads: 4, hash_mb: 256, running: true, error: null },
  },
}

function server(health: Health = HEALTH) {
  return fakeServer({
    'GET /api/health': () => ({ body: health }),
    'GET /api/reviews': () => ({ body: { reviews: [], current: null } }),
    'GET /api/reviews/1': () => ({ body: scholarsMateReview() }),
  })
}

beforeEach(() => {
  vi.spyOn(engineClient, 'connect').mockImplementation(() => {})
  vi.spyOn(engineClient, 'analyze').mockReturnValue(1)
  vi.spyOn(engineClient, 'stop').mockImplementation(() => {})
  useEngine.setState({ connected: true, info: null })
  useHealth.setState({ health: null, error: null })
})

describe('App', () => {
  it('opens the analysis board by default and connects to the engine', async () => {
    server()
    render(<App />)
    await waitFor(() => expect(window.location.hash).toBe('#/analysis'))
    expect(await screen.findByRole('heading', { level: 1, name: 'Analysis board' })).toBeInTheDocument()
    expect(engineClient.connect).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Analysis board' })).toHaveAttribute('aria-current', 'page')
  })

  it('shows the engine status', async () => {
    server()
    render(<App />)
    const status = document.querySelector('.engine-status') as HTMLElement
    await waitFor(() => expect(status).toHaveTextContent('Stockfish 19'))
    expect(status).toHaveTextContent('8 threads, 1 GB hash')
    expect(status).toHaveClass('status-ok')
  })

  it('shows small hash sizes in MB', async () => {
    server({ ...HEALTH, engines: { ...HEALTH.engines, live: { ...HEALTH.engines.live, hash_mb: 256 } } })
    render(<App />)
    await waitFor(() => expect(document.querySelector('.engine-status')).toHaveTextContent('8 threads, 256 MB hash'))
  })

  it('says when the server is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    render(<App />)
    await waitFor(() => expect(document.querySelector('.engine-status')).toHaveTextContent('Server offline'))
    expect(document.querySelector('.engine-status')).toHaveTextContent('Start it with ./start.sh')
  })

  it('says when the engine has a problem', async () => {
    server({ ...HEALTH, engines: { ...HEALTH.engines, live: { ...HEALTH.engines.live, error: 'Stockfish was not found.' } } })
    render(<App />)
    await waitFor(() => expect(document.querySelector('.engine-status')).toHaveTextContent('Engine problem'))
  })

  it('routes to game review pages', async () => {
    server()
    window.location.hash = '#/review'
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Game review' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Game review' })).toHaveAttribute('aria-current', 'page')
    unmount()

    window.location.hash = '#/review/1'
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: 'You — Opponent' })).toBeInTheDocument()
  })

  it('unknown pages say so', async () => {
    server()
    window.location.hash = '#/nowhere'
    render(<App />)
    expect(screen.getByText('There is no page here')).toBeInTheDocument()
  })

  it('links every section in the sidebar', () => {
    server()
    render(<App />)
    for (const name of ['Library', 'Notes', 'Endgames', 'Practice', 'Tournament prep', 'Settings']) {
      const item = screen.getByText(name).closest('.nav-item')
      expect(item?.tagName).toBe('A')
      expect(item).not.toHaveClass('nav-later')
    }
  })
})
