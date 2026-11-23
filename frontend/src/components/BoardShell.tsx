import type { ReactNode } from 'react'
import type { Color } from '../lib/chess'

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A player strip above or below the board: monogram, name, rating, side, and who is to move. */
export function PlayerStrip({ name, rating, side, toMove, position }: {
  name: string | null
  rating?: string | number | null
  side: Color
  toMove?: boolean
  position: 'top' | 'bottom'
}) {
  const shown = name || (side === 'white' ? 'White' : 'Black')
  return (
    <div className={`pstrip ${position}`}>
      <span className="avatar" aria-hidden="true">{name ? initials(name) : side === 'white' ? 'W' : 'B'}</span>
      <span className="name">{shown}</span>
      {rating ? <span className="rating">{rating}</span> : null}
      <span className="tag-side">
        <span className={`pdot ${side === 'white' ? 'w' : 'b'}`} aria-hidden="true" />
        {side === 'white' ? 'White' : 'Black'}
        {toMove && <><span className="turn" aria-hidden="true" />To move</>}
      </span>
    </div>
  )
}

/** The framed board object: player strips, an optional evaluation ribbon, and the board. */
export function BoardShell({ top, bottom, evalBar, children, className }: {
  top?: ReactNode
  bottom?: ReactNode
  evalBar?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`board-shell ${evalBar ? '' : 'no-eval'} ${className ?? ''}`}>
      {top}
      <div className="board-row">
        {evalBar}
        {children}
      </div>
      {bottom}
    </div>
  )
}
