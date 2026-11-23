import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { START_FEN } from '../lib/chess'
import { Board } from './Board'

describe('Board (real chessground)', () => {
  it('draws the position', () => {
    const { container } = render(<Board fen={START_FEN} orientation="white" movable="turn" />)
    expect(container.querySelector('cg-board')).not.toBeNull()
    expect(container.querySelectorAll('piece:not(.ghost)')).toHaveLength(32)
    expect(container.querySelector('.cg-wrap')).toHaveClass('orientation-white')
  })

  it('follows new positions and orientation', () => {
    const { container, rerender } = render(<Board fen={START_FEN} orientation="white" movable="turn" />)
    rerender(<Board fen="4k3/8/8/8/8/8/4P3/4K3 w - - 0 1" orientation="black" movable={null} />)
    expect(container.querySelectorAll('piece:not(.ghost)')).toHaveLength(3)
    expect(container.querySelector('.cg-wrap')).toHaveClass('orientation-black')
  })
})
