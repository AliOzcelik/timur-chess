import { useEffect, useRef } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Key } from '@lichess-org/chessground/types'
import type { Color } from '../lib/chess'

/** A small board that only shows a position (lesson cards, notes, puzzles lists). */
export function MiniBoard({ fen, orientation = 'white', lastMove, label }: {
  fen: string
  orientation?: Color
  lastMove?: [Key, Key]
  label?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const cg = useRef<Api | null>(null)
  useEffect(() => {
    if (!el.current) return
    cg.current = Chessground(el.current, { viewOnly: true, coordinates: false, animation: { enabled: false }, drawable: { enabled: false } })
    return () => {
      cg.current?.destroy()
      cg.current = null
    }
  }, [])
  useEffect(() => {
    cg.current?.set({ fen, orientation, lastMove })
  }, [fen, orientation, lastMove?.[0], lastMove?.[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mini-board" role="img" aria-label={label ?? 'Chess position'}>
      <div ref={el} className="board" />
    </div>
  )
}
