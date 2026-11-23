import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { START_FEN } from '../lib/chess'
import { PositionEditor, positionProblem } from './PositionEditor'

describe('positionProblem', () => {
  it('accepts normal positions', () => {
    expect(positionProblem(START_FEN)).toBeNull()
    expect(positionProblem('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1')).toBeNull()
  })

  it.each([
    ['8/8/8/8/8/8/4P3/4K3 w - - 0 1', 'Each side needs exactly one king.'],
    ['4k3/8/8/8/8/8/8/3KK3 w - - 0 1', 'Each side needs exactly one king.'],
    ['4kP2/8/8/8/8/8/8/4K3 w - - 0 1', 'Pawns cannot stand on the first or last rank.'],
    ['4k3/8/8/8/8/8/8/4K2p w - - 0 1', 'Pawns cannot stand on the first or last rank.'],
    ['4k3/8/8/8/8/8/8/4R1K1 w - - 0 1', 'The side that just moved is in check. That cannot happen in a real game.'],
  ])('%s', (fen, problem) => {
    expect(positionProblem(fen)).toBe(problem)
  })
})

describe('PositionEditor', () => {
  it('starts from the board position and applies it', async () => {
    const onApply = vi.fn()
    render(<PositionEditor open initialFen={START_FEN} onClose={() => {}} onApply={onApply} />)
    expect(screen.getByRole('textbox', { name: 'FEN' })).toHaveValue(START_FEN)
    await userEvent.click(screen.getByRole('button', { name: 'Analyze this position' }))
    expect(onApply).toHaveBeenCalledWith(START_FEN)
  })

  it('side to move and castling change the FEN', async () => {
    render(<PositionEditor open initialFen={START_FEN} onClose={() => {}} onApply={() => {}} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Black' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'White O-O-O' }))
    expect(screen.getByRole('textbox', { name: 'FEN' })).toHaveValue('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b Kkq - 0 1')
  })

  it('a cleared board cannot be analyzed', async () => {
    render(<PositionEditor open initialFen={START_FEN} onClose={() => {}} onApply={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Clear board' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Each side needs exactly one king.')
    expect(screen.getByRole('button', { name: 'Analyze this position' })).toBeDisabled()
  })

  it('a typed FEN is loaded on Enter, dropping castling that no longer fits', async () => {
    const onApply = vi.fn()
    render(<PositionEditor open initialFen={START_FEN} onClose={() => {}} onApply={onApply} />)
    const field = screen.getByRole('textbox', { name: 'FEN' })
    await userEvent.clear(field)
    await userEvent.type(field, '4k3/8/8/8/8/8/4P3/4K3 b KQ - 0 1{Enter}')
    expect(field).toHaveValue('4k3/8/8/8/8/8/4P3/4K3 b - - 0 1')
    await userEvent.click(screen.getByRole('button', { name: 'Analyze this position' }))
    expect(onApply).toHaveBeenCalledWith('4k3/8/8/8/8/8/4P3/4K3 b - - 0 1')
  })

  it('Cancel closes', async () => {
    const onClose = vi.fn()
    render(<PositionEditor open initialFen={START_FEN} onClose={onClose} onApply={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
