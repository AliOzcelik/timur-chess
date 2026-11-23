import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ReviewSummaryRow } from '../lib/api'
import { useReviewDraft } from '../state/analysis'
import { callsOf, fakeServer } from '../test/helpers'
import { ReviewListPage, formatDate, formatPgnDate, playersOf } from './ReviewListPage'

function row(overrides: Partial<ReviewSummaryRow> = {}): ReviewSummaryRow {
  return {
    id: 1, created_at: '2026-11-23T13:08:25+03:00', updated_at: '2026-11-23T13:08:25+03:00', status: 'done',
    progress: 8, total: 8, profile: 'quick', my_color: 'black', white: 'You', black: 'Opponent', result: '1-0',
    event: 'Club night', game_date: '2026.11.20', ply_count: 7, white_accuracy: 91.8, black_accuracy: 22.1,
    error: null, ...overrides,
  }
}

describe('date and name helpers', () => {
  it('formatDate uses English dates', () => {
    expect(formatDate('2026-11-23T13:08:25+03:00')).toBe('23 Nov 2026')
    expect(formatDate(null)).toBe('')
    expect(formatDate('not a date')).toBe('not a date')
  })

  it.each([
    ['2026.11.20', '20 Nov 2026'],
    ['2026.11.??', 'Nov 2026'],
    ['2026.??.??', '2026'],
    ['????.??.??', null],
    [null, null],
  ])('formatPgnDate(%s) = %s', (input, expected) => {
    expect(formatPgnDate(input)).toBe(expected)
  })

  it('playersOf', () => {
    expect(playersOf({ white: 'Ann', black: 'Ben' })).toBe('Ann vs Ben')
    expect(playersOf({ white: 'Ann', black: null })).toBe('Ann vs Unknown')
    expect(playersOf({ white: null, black: null })).toBe('Unnamed game')
  })
})

describe('ReviewListPage', () => {
  it('lists reviewed games with their details and accuracy', async () => {
    fakeServer({ 'GET /api/reviews': () => ({ body: { reviews: [row()], current: null } }) })
    render(<ReviewListPage startNew={false} />)
    const link = await screen.findByRole('link', { name: /You vs Opponent/ })
    expect(link).toHaveAttribute('href', '#/review/1')
    expect(link).toHaveTextContent('1-0')
    expect(link).toHaveTextContent('Played 20 Nov 2026')
    expect(link).toHaveTextContent('Reviewed 23 Nov 2026')
    expect(link).toHaveTextContent('4 moves')
    expect(within(link).getByTitle('White accuracy')).toHaveTextContent('92%')
    const black = within(link).getByTitle('Black accuracy')
    expect(black).toHaveTextContent('22%')
    expect(black).toHaveClass('acc-mine')
  })

  it('shows reviews that are not finished', async () => {
    fakeServer({
      'GET /api/reviews': () => ({
        body: {
          reviews: [
            row({ id: 3, status: 'queued', progress: 0 }),
            row({ id: 2, status: 'running', progress: 3 }),
            row({ id: 1, status: 'error', error: 'boom' }),
          ],
          current: 2,
        },
      }),
    })
    render(<ReviewListPage startNew={false} />)
    expect(await screen.findByText('Waiting in line')).toBeInTheDocument()
    expect(screen.getByText('Analyzing, 38%')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('checks again while a review is running', async () => {
    let calls = 0
    fakeServer({
      'GET /api/reviews': () => {
        calls += 1
        return { body: { reviews: [row(calls === 1 ? { status: 'running', progress: 4 } : {})], current: null } }
      },
    })
    render(<ReviewListPage startNew={false} />)
    expect(await screen.findByText('Analyzing, 50%')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTitle('White accuracy')).toBeInTheDocument(), { timeout: 3000 })
  })

  it('empty list', async () => {
    fakeServer({ 'GET /api/reviews': () => ({ body: { reviews: [], current: null } }) })
    render(<ReviewListPage startNew={false} />)
    expect(await screen.findByText(/No reviews yet/)).toBeInTheDocument()
  })

  it('server down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    render(<ReviewListPage startNew={false} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the Timur server')
  })

  it('asks for a PGN before starting', async () => {
    fakeServer({ 'GET /api/reviews': () => ({ body: { reviews: [], current: null } }) })
    render(<ReviewListPage startNew={false} />)
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Paste the PGN of the game you want reviewed.')
  })

  it('starts a review with the chosen side and depth, then opens it', async () => {
    const server = fakeServer({
      'GET /api/reviews': () => ({ body: { reviews: [], current: null } }),
      'POST /api/reviews': () => ({ status: 201, body: { id: 5, game_count: 1 } }),
    })
    render(<ReviewListPage startNew={false} />)
    await userEvent.click(screen.getByRole('textbox', { name: 'PGN' }))
    await userEvent.paste('1. e4 e5 *')
    await userEvent.click(screen.getByRole('radio', { name: 'Black' }))
    await userEvent.click(screen.getByRole('radio', { name: /Deep/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }))
    await waitFor(() => expect(window.location.hash).toBe('#/review/5'))
    expect(callsOf(server).find((c) => c.route === 'POST /api/reviews')?.body).toEqual({
      pgn: '1. e4 e5 *', profile: 'deep', my_color: 'black',
    })
  })

  it('shows why the server refused the game', async () => {
    fakeServer({
      'GET /api/reviews': () => ({ body: { reviews: [], current: null } }),
      'POST /api/reviews': () => ({ status: 400, body: { detail: 'This game has no moves to review.' } }),
    })
    render(<ReviewListPage startNew={false} />)
    await userEvent.click(screen.getByRole('textbox', { name: 'PGN' }))
    await userEvent.paste('[White "A"]')
    await userEvent.click(screen.getByRole('button', { name: 'Start review' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This game has no moves to review.')
    expect(window.location.hash).toBe('')
  })

  it('takes over the game sent from the analysis board', async () => {
    fakeServer({ 'GET /api/reviews': () => ({ body: { reviews: [], current: null } }) })
    useReviewDraft.setState({ pgn: '1. d4 d5 *', myColor: 'black' })
    render(<ReviewListPage startNew />)
    const box = screen.getByRole('textbox', { name: 'PGN' })
    expect(box).toHaveValue('1. d4 d5 *')
    expect(box).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Black' })).toBeChecked()
    expect(useReviewDraft.getState().pgn).toBeNull()
  })

  it('reads a .pgn file', async () => {
    fakeServer({ 'GET /api/reviews': () => ({ body: { reviews: [], current: null } }) })
    render(<ReviewListPage startNew={false} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['1. c4 *'], 'game.pgn', { type: 'text/plain' }))
    expect(await screen.findByDisplayValue('1. c4 *')).toBeInTheDocument()
  })

  it('deletes a review after asking', async () => {
    let reviews = [row()]
    const server = fakeServer({
      'GET /api/reviews': () => ({ body: { reviews, current: null } }),
      'DELETE /api/reviews/1': () => { reviews = []; return { body: { ok: true } } },
    })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ReviewListPage startNew={false} />)
    const button = await screen.findByRole('button', { name: 'Delete review of You vs Opponent' })

    await userEvent.click(button)
    expect(callsOf(server).some((c) => c.route.startsWith('DELETE'))).toBe(false)

    await userEvent.click(button)
    expect(confirm).toHaveBeenLastCalledWith('Delete the review of You vs Opponent? This cannot be undone.')
    expect(await screen.findByText(/No reviews yet/)).toBeInTheDocument()
  })
})
