import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EngineInfo } from '../state/engine'
import { EngineLines } from './EngineLines'

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'

const info: EngineInfo = {
  id: 1,
  fen: AFTER_E4,
  threat: false,
  depth: 22,
  seldepth: 30,
  nps: 2_500_000,
  lines: [
    { multipv: 1, eval: { cp: 31, mate: null }, depth: 22, uci: ['c7c5', 'g1f3', 'd7d6'], san: ['c5', 'Nf3', 'd6'] },
    { multipv: 2, eval: { cp: -45, mate: null }, depth: 22, uci: ['e7e5'], san: ['e5'] },
  ],
}

const props = { info, multipv: 3, on: true, threat: false, error: null, onPlay: () => {} }

describe('EngineLines', () => {
  it('lists each line with its eval and numbered moves', () => {
    const { container } = render(<EngineLines {...props} />)
    const lines = container.querySelectorAll('li.line:not(.placeholder)')
    expect(lines).toHaveLength(2)
    expect(lines[0].textContent).toBe('+0.311...c52.Nf3d6')
    expect(lines[0].querySelector('.line-eval')).toHaveClass('side-white')
    expect(lines[1].querySelector('.line-eval')).toHaveClass('side-black')
  })

  it('keeps space for lines that have not arrived yet', () => {
    const { container } = render(<EngineLines {...props} />)
    expect(container.querySelectorAll('li.placeholder')).toHaveLength(1)
  })

  it('shows depth and speed', () => {
    render(<EngineLines {...props} />)
    expect(screen.getByText(/Depth 22\/30/)).toBeInTheDocument()
    expect(screen.getByText('2.5M nodes/s')).toBeInTheDocument()
  })

  it('shows "Thinking…" before the first result', () => {
    render(<EngineLines {...props} info={null} />)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
  })

  it('clicking a move plays the line up to that move', async () => {
    const onPlay = vi.fn()
    render(<EngineLines {...props} onPlay={onPlay} />)
    await userEvent.click(screen.getByRole('button', { name: '2.Nf3' }))
    expect(onPlay).toHaveBeenCalledWith(['c7c5', 'g1f3'])
  })

  it('in threat mode the moves cannot be played', () => {
    const threatInfo = { ...info, threat: true, fen: info.fen.replace(' b ', ' w '), lines: [info.lines[0]] }
    render(<EngineLines {...props} info={threatInfo} threat multipv={1} />)
    expect(screen.getByText('Threat: what White would play if it were their move.')).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('engine off', () => {
    render(<EngineLines {...props} on={false} />)
    expect(screen.getByText(/The engine is off/)).toBeInTheDocument()
  })

  it('shows errors', () => {
    render(<EngineLines {...props} error="This position is not legal." />)
    expect(screen.getByRole('alert')).toHaveTextContent('This position is not legal.')
  })

  it('finished games', () => {
    const { rerender } = render(<EngineLines {...props} info={{ ...info, lines: [], terminal: { cp: null, mate: 0, winner: 'black' } }} />)
    expect(screen.getByText('Checkmate. Black wins.')).toBeInTheDocument()
    rerender(<EngineLines {...props} info={{ ...info, lines: [], terminal: { cp: 0, mate: null, draw: true } }} />)
    expect(screen.getByText('Draw. The game is over.')).toBeInTheDocument()
  })
})
