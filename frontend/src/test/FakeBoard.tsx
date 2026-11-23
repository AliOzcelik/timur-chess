import { useState } from 'react'
import type { BoardProps } from '../components/Board'

/**
 * Stand-in for the chessground board in page tests: shows the props it got and
 * lets a test "play" a move by typing UCI and pressing a button.
 */
export function FakeBoard({ fen, orientation, movable, shapes, lastMove, onMove }: BoardProps) {
  const [uci, setUci] = useState('')
  return (
    <div
      data-testid="board"
      data-fen={fen}
      data-orientation={orientation}
      data-movable={String(movable)}
      data-last-move={lastMove?.join('') ?? ''}
      data-shapes={JSON.stringify(shapes ?? [])}
    >
      <input aria-label="test move" value={uci} onChange={(e) => setUci(e.target.value)} />
      <button type="button" onClick={() => onMove?.(uci)}>play test move</button>
    </div>
  )
}
