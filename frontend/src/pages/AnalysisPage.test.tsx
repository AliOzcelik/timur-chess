import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { START_FEN } from '../lib/chess'
import { createTree, fromUciLine, movesTo } from '../lib/tree'
import { useAnalysis, useReviewDraft } from '../state/analysis'
import { engineClient, useEngine, type EngineInfo } from '../state/engine'
import { useHealth } from '../state/health'
import { AnalysisPage } from './AnalysisPage'

vi.mock('../components/Board', async () => ({ Board: (await import('../test/FakeBoard')).FakeBoard }))

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

const board = () => screen.getByTestId('board')
const key = (k: string) => fireEvent.keyDown(window, { key: k })
const moves = () => movesTo(useAnalysis.getState().tree, useAnalysis.getState().currentId)

async function playOnBoard(...ucis: string[]) {
  for (const uci of ucis) {
    const input = screen.getByRole('textbox', { name: 'test move' })
    await userEvent.clear(input)
    await userEvent.type(input, uci)
    await userEvent.click(screen.getByRole('button', { name: 'play test move' }))
  }
}

function engineSays(info: Partial<EngineInfo> & { fen: string }) {
  act(() => {
    useEngine.setState({
      connected: true,
      info: { id: 1, threat: false, depth: 18, lines: [], ...info },
      done: false,
      error: null,
    })
  })
}

let analyze: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  const tree = createTree()
  useAnalysis.setState({ tree, currentId: tree.rootId, orientation: 'white', threat: false, engineOn: true, multipv: 3, depth: 30, arrows: true })
  useEngine.setState({ connected: true, requestId: null, info: null, done: false, error: null })
  useHealth.setState({ health: null, error: null })
  useReviewDraft.setState({ pgn: null, myColor: null })
  analyze = vi.spyOn(engineClient, 'analyze').mockReturnValue(1)
  vi.spyOn(engineClient, 'stop').mockImplementation(() => {})
})

describe('AnalysisPage, moves', () => {
  it('starts empty', () => {
    render(<AnalysisPage />)
    expect(screen.getByRole('heading', { name: 'Analysis board' })).toBeInTheDocument()
    expect(screen.getByText('White to move')).toBeInTheDocument()
    expect(board()).toHaveAttribute('data-fen', START_FEN)
    expect(screen.getByText('Make a move on the board, or import a game.')).toBeInTheDocument()
  })

  it('moves on the board go into the move list', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4', 'e7e5')
    expect(screen.getByText('White to move')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'e5' })).toHaveAttribute('aria-current', 'true')
    expect(board()).toHaveAttribute('data-last-move', 'e7e5')
  })

  it('arrow keys and buttons step through the game', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4', 'e7e5', 'g1f3')
    key('ArrowLeft')
    expect(moves()).toEqual(['e2e4', 'e7e5'])
    key('ArrowUp')
    expect(board()).toHaveAttribute('data-fen', START_FEN)
    key('ArrowDown')
    expect(moves()).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: 'First move' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next move' }))
    expect(board()).toHaveAttribute('data-fen', AFTER_E4)
    await userEvent.click(screen.getByRole('button', { name: 'Last move' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous move' }))
    expect(moves()).toEqual(['e2e4', 'e7e5'])
  })

  it('a different move makes a side line that can become the main line or be deleted', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4', 'e7e5')
    key('ArrowLeft')
    await playOnBoard('c7c5')
    await userEvent.click(screen.getByRole('button', { name: /Make main line/ }))
    expect(screen.queryByRole('button', { name: /Make main line/ })).toBeNull()
    const root = useAnalysis.getState().tree.nodes[useAnalysis.getState().tree.rootId]
    const e4 = useAnalysis.getState().tree.nodes[root.children[0]]
    expect(useAnalysis.getState().tree.nodes[e4.children[0]].san).toBe('c5')

    await userEvent.click(screen.getByRole('button', { name: /Delete from here/ }))
    expect(moves()).toEqual(['e2e4'])
    expect(screen.queryByRole('button', { name: 'c5' })).toBeNull()
  })

  it('F flips the board', () => {
    render(<AnalysisPage />)
    key('f')
    expect(board()).toHaveAttribute('data-orientation', 'black')
  })

  it('shows the players of an imported game', () => {
    const tree = fromUciLine(START_FEN, ['e2e4'], { White: 'Ann', Black: '?' })
    useAnalysis.setState({ tree, currentId: tree.rootId })
    render(<AnalysisPage />)
    expect(screen.getByText('Ann vs Unknown')).toBeInTheDocument()
  })
})

describe('AnalysisPage, engine', () => {
  const lines = [
    { multipv: 1, eval: { cp: 31, mate: null }, depth: 18, uci: ['c7c5', 'g1f3', 'd7d6'], san: ['c5', 'Nf3', 'd6'] },
    { multipv: 2, eval: { cp: 40, mate: null }, depth: 18, uci: ['e7e5', 'g1f3'], san: ['e5', 'Nf3'] },
  ]

  it('asks the engine about the position on the board, with the history', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    act(() => { vi.advanceTimersByTime(100) })
    expect(analyze).toHaveBeenLastCalledWith({ fen: START_FEN, moves: ['e2e4'], multipv: 3, depth: 30, threat: false })
  })

  it('shows lines, eval and arrows for the position on the board', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    engineSays({ fen: AFTER_E4, lines })
    expect(document.querySelector('.big-eval')).toHaveTextContent('+0.31')
    expect(screen.getByRole('meter', { name: 'Evaluation' })).toHaveAttribute('aria-valuetext', '+0.31')
    expect(document.querySelectorAll('li.line:not(.placeholder)')).toHaveLength(2)
    const shapes = JSON.parse(board().getAttribute('data-shapes')!)
    expect(shapes).toEqual([
      { orig: 'c7', dest: 'c5', brush: 'green' },
      { orig: 'e7', dest: 'e5', brush: 'paleGreen' },
    ])
  })

  it('ignores engine output for another position', async () => {
    render(<AnalysisPage />)
    engineSays({ fen: AFTER_E4, lines })
    expect(document.querySelectorAll('li.line:not(.placeholder)')).toHaveLength(0)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
    expect(JSON.parse(board().getAttribute('data-shapes')!)).toEqual([])
  })

  it('arrows can be switched off', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    engineSays({ fen: AFTER_E4, lines })
    await userEvent.click(screen.getByRole('button', { name: 'Arrows' }))
    expect(JSON.parse(board().getAttribute('data-shapes')!)).toEqual([])
    expect(JSON.parse(window.localStorage.getItem('timur.engine-settings.v1')!).arrows).toBe(false)
  })

  it('clicking a move in a line plays the line up to it', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    engineSays({ fen: AFTER_E4, lines })
    await userEvent.click(screen.getAllByRole('button', { name: '2.Nf3' })[0])
    expect(moves()).toEqual(['e2e4', 'c7c5', 'g1f3'])
  })

  it('Space turns the engine off and on', () => {
    render(<AnalysisPage />)
    key(' ')
    expect(screen.getByText(/The engine is off/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Engine' })).not.toBeChecked()
    expect(engineClient.stop).toHaveBeenCalled()
    key(' ')
    expect(screen.getByRole('checkbox', { name: 'Engine' })).toBeChecked()
  })

  it('lines and depth settings go to the engine', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AnalysisPage />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Lines' }), '5')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Depth' }), 'No limit')
    act(() => { vi.advanceTimersByTime(100) })
    expect(analyze).toHaveBeenLastCalledWith(expect.objectContaining({ multipv: 5, depth: null }))
  })

  it('X shows the threat with one line', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    key('x')
    act(() => { vi.advanceTimersByTime(100) })
    expect(screen.getByRole('button', { name: 'Threat' })).toHaveAttribute('aria-pressed', 'true')
    expect(analyze).toHaveBeenLastCalledWith(expect.objectContaining({ threat: true, multipv: 1 }))
    expect(screen.getByRole('combobox', { name: 'Lines' })).toBeDisabled()

    const threatFen = AFTER_E4.replace(' b ', ' w ')
    engineSays({ fen: threatFen, threat: true, lines: [{ ...lines[0], uci: ['d2d4'], san: ['d4'] }] })
    expect(document.querySelector('.big-eval')).toHaveTextContent('Threat')
    expect(JSON.parse(board().getAttribute('data-shapes')!)).toEqual([{ orig: 'd2', dest: 'd4', brush: 'threat' }])
  })

  it('threat mode is not offered in check', async () => {
    render(<AnalysisPage />)
    await playOnBoard('e2e4', 'f7f6', 'd1h5')
    expect(screen.getByRole('button', { name: 'Threat' })).toBeDisabled()
    key('x')
    expect(useAnalysis.getState().threat).toBe(false)
  })

  it('shows connection and engine problems', () => {
    useEngine.setState({ connected: false })
    useHealth.setState({
      health: {
        ok: true, version: '0.1.0',
        engines: {
          live: { label: 'live', name: null, path: null, threads: 1, hash_mb: 16, running: false, error: 'Stockfish was not found.' },
          review: { label: 'review', name: null, path: null, threads: 1, hash_mb: 16, running: false, error: null },
        },
      },
    })
    render(<AnalysisPage />)
    expect(screen.getByText('Connecting to the engine…')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Stockfish was not found.')
  })
})

describe('AnalysisPage, toolbar', () => {
  function clipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(writeText) }, configurable: true })
    return navigator.clipboard.writeText as ReturnType<typeof vi.fn>
  }

  it('copies the PGN and the FEN', async () => {
    const write = clipboard(async () => {})
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    await userEvent.click(screen.getByRole('button', { name: 'Copy PGN' }))
    expect(write.mock.calls[0][0]).toContain('1. e4 *')
    expect(screen.getByRole('status')).toHaveTextContent('PGN copied.')
    await userEvent.click(screen.getByRole('button', { name: 'Copy FEN' }))
    expect(write).toHaveBeenLastCalledWith(AFTER_E4)
  })

  it('explains when the clipboard is blocked', async () => {
    clipboard(async () => { throw new Error('denied') })
    render(<AnalysisPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy FEN' }))
    expect(screen.getByRole('status')).toHaveTextContent('Could not copy the FEN. Your browser blocked the clipboard.')
  })

  it('Review this game sends the main line to the review form', async () => {
    render(<AnalysisPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Review this game' }))
    expect(screen.getByRole('status')).toHaveTextContent('Play or import some moves first.')

    await playOnBoard('e2e4', 'e7e5')
    key('ArrowLeft')
    await playOnBoard('c7c5') // side line, left out of the review
    key('f')
    await userEvent.click(screen.getByRole('button', { name: 'Review this game' }))
    expect(window.location.hash).toBe('#/review/new')
    const draft = useReviewDraft.getState()
    expect(draft.myColor).toBe('black')
    expect(draft.pgn).toContain('1. e4 e5 *')
    expect(draft.pgn).not.toContain('c5')
  })

  it('New board asks first when there are moves', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<AnalysisPage />)
    await playOnBoard('e2e4')
    await userEvent.click(screen.getByRole('button', { name: 'New board' }))
    expect(moves()).toEqual(['e2e4'])
    await userEvent.click(screen.getByRole('button', { name: 'New board' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(board()).toHaveAttribute('data-fen', START_FEN)
    expect(screen.getByText('Make a move on the board, or import a game.')).toBeInTheDocument()
  })

  it('imports a position', async () => {
    render(<AnalysisPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Import' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('textbox', { name: 'PGN or FEN' }))
    await userEvent.paste('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Load on the board' }))
    expect(board()).toHaveAttribute('data-fen', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')
    expect(screen.getByRole('status')).toHaveTextContent('Game loaded.')
  })

  it('sets up a position', async () => {
    render(<AnalysisPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Set up position' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Black' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Analyze this position' }))
    expect(board()).toHaveAttribute('data-fen', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1')
    expect(screen.getByText('Black to move')).toBeInTheDocument()
  })
})
