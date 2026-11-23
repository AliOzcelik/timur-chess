import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewDetail } from '../lib/api'
import { createTree, lineEnd, movesTo } from '../lib/tree'
import { useAnalysis } from '../state/analysis'
import { callsOf, fakeServer, scholarsMateReview } from '../test/helpers'
import { ReviewPage } from './ReviewPage'

vi.mock('../components/Board', async () => ({ Board: (await import('../test/FakeBoard')).FakeBoard }))

const review = scholarsMateReview()
const analysis = review.analysis!
const nf6 = analysis.moves[5]

function serve(detail: ReviewDetail = review, extra = {}) {
  return fakeServer({ [`GET /api/reviews/${detail.id}`]: () => ({ body: detail }), ...extra })
}

async function open(detail: ReviewDetail = review, extra = {}) {
  const server = serve(detail, extra)
  render(<ReviewPage id={detail.id} />)
  await screen.findByRole('heading', { level: 1, name: 'You vs Opponent' })
  return server
}

const board = () => screen.getByTestId('board')
const card = () => document.querySelector('.move-card') as HTMLElement
const key = (k: string) => fireEvent.keyDown(window, { key: k })

beforeEach(() => {
  const tree = createTree()
  useAnalysis.setState({ tree, currentId: tree.rootId })
})

describe('ReviewPage, finished review', () => {
  it('shows the game details and accuracy for both sides', async () => {
    await open()
    expect(screen.getByText('1-0, Club night, Played 20 Nov 2026, Reviewed 23 Nov 2026')).toBeInTheDocument()
    const accuracy = screen.getByRole('row', { name: /Accuracy/ })
    expect(accuracy).toHaveTextContent(`${analysis.summary.white.accuracy!.toFixed(1)}%`)
    expect(accuracy).toHaveTextContent(`${analysis.summary.black.accuracy!.toFixed(1)}%`)
    expect(screen.getByRole('columnheader', { name: 'Opponent' })).toHaveClass('mine')
  })

  it('starts at the beginning, from the reviewed side', async () => {
    await open()
    expect(board()).toHaveAttribute('data-fen', analysis.root_fen)
    expect(board()).toHaveAttribute('data-orientation', 'black')
    expect(card()).toHaveTextContent('Starting position')
    expect(card()).toHaveTextContent('1 move needs a second look.')
  })

  it('Next mistake jumps to the blunder and explains it', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: /Next mistake/ }))
    expect(card()).toHaveTextContent('3...Nf6')
    expect(card()).toHaveTextContent('Blunder')
    expect(card()).toHaveTextContent('This allows mate in 1: 4.Qxf7#. Best was g6.')
    expect(card()).toHaveTextContent('Best line')
    expect(card()).toHaveTextContent('After your move 4.Qxf7#')
    expect(board()).toHaveAttribute('data-fen', nf6.fen_after)
    const shapes = JSON.parse(board().getAttribute('data-shapes')!)
    expect(shapes).toContainEqual({ orig: 'g7', dest: 'g6', brush: 'green' })
    expect(shapes.some((s: { orig: string; customSvg?: unknown }) => s.orig === 'f6' && s.customSvg)).toBe(true)
    expect(screen.getByRole('button', { name: /Next mistake/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Previous mistake/ })).toBeDisabled()
  })

  it('arrow keys, Home/End, N and F', async () => {
    await open()
    key('ArrowRight')
    expect(card()).toHaveTextContent('1.e4')
    expect(card()).toHaveTextContent('Best move')
    key('End')
    expect(card()).toHaveTextContent('4.Qxf7#')
    expect(board()).toHaveAttribute('data-fen', analysis.positions[7].fen)
    key('ArrowRight') // already at the end
    expect(card()).toHaveTextContent('4.Qxf7#')
    key('Home')
    expect(card()).toHaveTextContent('Starting position')
    key('n')
    expect(card()).toHaveTextContent('3...Nf6')
    key('f')
    expect(board()).toHaveAttribute('data-orientation', 'white')
  })

  it('the count buttons and the move list jump to moves', async () => {
    await open()
    const blunders = screen.getByRole('row', { name: /Blunder/ })
    await userEvent.click(within(blunders).getByRole('button'))
    expect(card()).toHaveTextContent('3...Nf6')
    await userEvent.click(screen.getByRole('button', { name: 'Bc4' }))
    expect(card()).toHaveTextContent('2.Bc4')
    expect(screen.getByRole('button', { name: 'Bc4' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Nf6??' })).toHaveClass('cls-blunder')
  })

  it('moves by the other side cannot be retried', async () => {
    await open(scholarsMateReview({ my_color: 'white' }))
    expect(card()).toHaveTextContent('No inaccuracies, mistakes or blunders on your side.')
    await userEvent.click(screen.getByRole('button', { name: 'Nf6??' }))
    expect(screen.queryByRole('button', { name: /Retry this move/ })).toBeNull()
  })
})

describe('ReviewPage, retry mode', () => {
  async function startRetry(extra = {}) {
    const server = await open(review, extra)
    key('n')
    await userEvent.click(screen.getByRole('button', { name: /Retry this move/ }))
    return server
  }

  async function playOnBoard(uci: string) {
    const input = screen.getByRole('textbox', { name: 'test move' })
    await userEvent.clear(input)
    await userEvent.type(input, uci)
    await userEvent.click(screen.getByRole('button', { name: 'play test move' }))
  }

  it('sets up the position before the mistake', async () => {
    await startRetry()
    expect(card()).toHaveTextContent('Find a better move than 3...Nf6')
    expect(board()).toHaveAttribute('data-fen', nf6.fen_before)
    expect(board()).toHaveAttribute('data-movable', 'turn')
    expect(board()).toHaveAttribute('data-last-move', 'd1h5')
    expect(JSON.parse(board().getAttribute('data-shapes')!)).toEqual([])
  })

  it('the engine move is correct', async () => {
    await startRetry()
    await playOnBoard(nf6.best!.uci)
    expect(card()).toHaveTextContent(`Yes! ${nf6.best!.san} is the engine's top move.`)
    expect(board()).toHaveAttribute('data-movable', 'null')
    await userEvent.click(screen.getByRole('button', { name: /Back to the review/ }))
    expect(card()).toHaveTextContent('3...Nf6')
  })

  it('the game move is not accepted', async () => {
    await startRetry()
    await playOnBoard('g8f6')
    expect(card()).toHaveTextContent('Nf6 is the move from the game. Look for something better.')
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(board()).toHaveAttribute('data-fen', nf6.fen_before)
    expect(board()).toHaveAttribute('data-movable', 'turn')
  })

  it('another good move is "close"', async () => {
    const server = await startRetry({
      'POST /api/engine/eval': () => ({ body: { eval: { cp: 20, mate: null }, best: null, pv_san: [] } }),
    })
    await playOnBoard('d8e7')
    expect(await screen.findByText(/Good find\. Qe7 is nearly as strong as the best move, g6\./)).toBeInTheDocument()
    expect(callsOf(server).find((c) => c.route === 'POST /api/engine/eval')?.body).toEqual({
      fen: nf6.fen_before, moves: ['d8e7'], depth: 18, seconds: 2,
    })
  })

  it('a move that still loses is "try again"', async () => {
    await startRetry({
      'POST /api/engine/eval': () => ({ body: { eval: { cp: null, mate: 1 }, best: null, pv_san: [] } }),
    })
    await playOnBoard('a7a6')
    expect(await screen.findByText(/a6 still gives away about 49% of your winning chance\. Try again\./)).toBeInTheDocument()
  })

  it('illegal moves are ignored and keys are off while retrying', async () => {
    await startRetry()
    await playOnBoard('e1e8')
    expect(board()).toHaveAttribute('data-fen', nf6.fen_before)
    key('ArrowRight')
    expect(card()).toHaveTextContent('Find a better move than 3...Nf6')
  })

  it('Show the answer leaves retry mode', async () => {
    await startRetry()
    await userEvent.click(screen.getByRole('button', { name: /Show the answer/ }))
    expect(card()).toHaveTextContent('Blunder')
  })
})

describe('ReviewPage, other states', () => {
  it('shows progress and checks again until it is done', async () => {
    let calls = 0
    fakeServer({
      'GET /api/reviews/1': () => {
        calls += 1
        return { body: calls === 1 ? { ...review, status: 'running', progress: 3, analysis: null } : review }
      },
    })
    render(<ReviewPage id={1} />)
    expect(await screen.findByText('Stockfish is checking position 3 of 8.')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '38')
    await waitFor(() => expect(card()).toHaveTextContent('Starting position'), { timeout: 3000 })
  })

  it('waiting in the queue', async () => {
    serve({ ...review, status: 'queued', progress: 0, analysis: null })
    render(<ReviewPage id={1} />)
    expect(await screen.findByText(/Waiting for the reviewer/)).toBeInTheDocument()
  })

  it('a failed review can be deleted', async () => {
    const server = serve({ ...review, status: 'error', error: 'Could not start Stockfish at /x', analysis: null },
      { 'DELETE /api/reviews/1': () => ({ body: { ok: true } }) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ReviewPage id={1} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not start Stockfish at /x')
    await userEvent.click(screen.getByRole('button', { name: /Delete review/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/review'))
    expect(callsOf(server).map((c) => c.route)).toContain('DELETE /api/reviews/1')
  })

  it('a missing review', async () => {
    fakeServer({})
    render(<ReviewPage id={42} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found.')
    expect(screen.getByRole('link', { name: 'Back to game review' })).toHaveAttribute('href', '#/review')
  })
})

describe('ReviewPage, leaving', () => {
  it('opens the game on the analysis board at the same move', async () => {
    await open()
    key('n')
    await userEvent.click(screen.getByRole('button', { name: /Open on analysis board/ }))
    expect(window.location.hash).toBe('#/analysis')
    const s = useAnalysis.getState()
    expect(movesTo(s.tree, lineEnd(s.tree, s.tree.rootId))).toEqual(analysis.moves.map((m) => m.uci))
    expect(movesTo(s.tree, s.currentId)).toHaveLength(6)
    expect(s.orientation).toBe('black')
    expect(s.tree.headers.White).toBe('You')
  })

  it('asks before replacing moves on the analysis board', async () => {
    useAnalysis.getState().playLine(['d2d4'])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await open()
    await userEvent.click(screen.getByRole('button', { name: /Open on analysis board/ }))
    expect(confirm).toHaveBeenCalled()
    expect(window.location.hash).toBe('')
    expect(movesTo(useAnalysis.getState().tree, useAnalysis.getState().currentId)).toEqual(['d2d4'])
  })

  it('deletes the review after asking', async () => {
    const server = await open(review, { 'DELETE /api/reviews/1': () => ({ body: { ok: true } }) })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await userEvent.click(screen.getByRole('button', { name: /Delete review/ }))
    await waitFor(() => expect(window.location.hash).toBe('#/review'))
    expect(callsOf(server).map((c) => c.route)).toContain('DELETE /api/reviews/1')
  })

  it('stops checking for updates after leaving the page', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const server = serve({ ...review, status: 'running', progress: 1, analysis: null })
    const { unmount } = render(<ReviewPage id={1} />)
    await screen.findByText(/Stockfish is checking/)
    unmount()
    const before = server.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(server.mock.calls.length).toBe(before)
  })
})
