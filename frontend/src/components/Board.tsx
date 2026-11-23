import { useEffect, useRef, useState } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { destsOf, isCheck, isPromotion, turnOf, type Color } from '../lib/chess'

export interface BoardProps {
  fen: string
  orientation: Color
  lastMove?: [Key, Key]
  /** Which side may move: 'turn' = side to move, null = nobody. */
  movable: 'turn' | null
  shapes?: DrawShape[]
  onMove?: (uci: string) => void
}

const PROMO_ROLES = ['queen', 'knight', 'rook', 'bishop'] as const
const ROLE_LETTER: Record<(typeof PROMO_ROLES)[number], string> = { queen: 'q', knight: 'n', rook: 'r', bishop: 'b' }

export const BRUSHES = {
  green: { key: 'g', color: '#3aa35f', opacity: 0.85, lineWidth: 10 },
  red: { key: 'r', color: '#d55e00', opacity: 0.85, lineWidth: 10 },
  blue: { key: 'b', color: '#4a90c8', opacity: 0.85, lineWidth: 10 },
  yellow: { key: 'y', color: '#c9a24a', opacity: 0.85, lineWidth: 10 },
  paleGreen: { key: 'pg', color: '#3aa35f', opacity: 0.45, lineWidth: 8 },
  paleBlue: { key: 'pb', color: '#4a90c8', opacity: 0.42, lineWidth: 8 },
  paleGrey: { key: 'pgr', color: '#9aa7b4', opacity: 0.4, lineWidth: 7 },
  threat: { key: 't', color: '#d55e00', opacity: 0.7, lineWidth: 9 },
}

export function Board({ fen, orientation, lastMove, movable, shapes, onMove }: BoardProps) {
  const el = useRef<HTMLDivElement>(null)
  const cg = useRef<Api | null>(null)
  const latest = useRef({ fen, onMove })
  latest.current = { fen, onMove }
  const [promotion, setPromotion] = useState<{ from: Key; to: Key; color: Color } | null>(null)

  useEffect(() => {
    if (!el.current) return
    cg.current = Chessground(el.current, {
      coordinates: true,
      animation: { enabled: true, duration: 160 },
      highlight: { lastMove: true, check: true },
      premovable: { enabled: false },
      drawable: { enabled: true, brushes: BRUSHES },
      movable: {
        free: false,
        showDests: true,
        events: {
          after: (orig, dest) => {
            const { fen: current, onMove: cb } = latest.current
            if (isPromotion(current, orig, dest)) {
              setPromotion({ from: orig, to: dest, color: turnOf(current) })
              return
            }
            cb?.(orig + dest)
          },
        },
      },
    })
    return () => {
      cg.current?.destroy()
      cg.current = null
    }
  }, [])

  useEffect(() => {
    const api = cg.current
    if (!api) return
    const turn = turnOf(fen)
    api.set({
      fen,
      orientation,
      turnColor: turn,
      lastMove,
      check: isCheck(fen) ? turn : false,
      movable: {
        color: movable === 'turn' ? turn : undefined,
        dests: movable === 'turn' ? destsOf(fen) : new Map(),
      },
    })
    setPromotion(null)
  }, [fen, orientation, lastMove?.[0], lastMove?.[1], movable]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    cg.current?.setAutoShapes(shapes ?? [])
  }, [shapes])

  const choosePromotion = (role: (typeof PROMO_ROLES)[number] | null) => {
    const p = promotion
    setPromotion(null)
    if (!p) return
    if (role === null) {
      cg.current?.set({ fen: latest.current.fen })
      return
    }
    latest.current.onMove?.(p.from + p.to + ROLE_LETTER[role])
  }

  let promoStyle: React.CSSProperties | undefined
  let promoFromTop = true
  if (promotion) {
    const file = promotion.to.charCodeAt(0) - 97
    const col = orientation === 'white' ? file : 7 - file
    const rank = promotion.to[1]
    promoFromTop = (rank === '8') === (orientation === 'white')
    promoStyle = { left: `${col * 12.5}%`, [promoFromTop ? 'top' : 'bottom']: 0 }
  }

  return (
    <div className="board-frame">
      <div ref={el} className="board" />
      {promotion && (
        <div className="promo-veil" onClick={() => choosePromotion(null)}>
          <div className={`promo cg-wrap ${promoFromTop ? 'from-top' : 'from-bottom'}`} style={promoStyle} onClick={(e) => e.stopPropagation()}>
            {PROMO_ROLES.map((role) => (
              <button key={role} type="button" className="promo-choice" aria-label={`Promote to ${role}`} onClick={() => choosePromotion(role)}>
                <piece className={`${role} ${promotion.color}`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// chessground's <piece> element is not a standard HTML tag.
declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      piece: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}
