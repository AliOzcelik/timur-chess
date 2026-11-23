import { useEffect, useRef, useState } from 'react'
import { Chessground } from '@lichess-org/chessground'
import type { Api } from '@lichess-org/chessground/api'
import type { Color as CgColor, Role } from '@lichess-org/chessground/types'
import { START_FEN, checkFen, safeChess } from '../lib/chess'
import { Modal } from './Modal'

type Tool = 'move' | 'trash' | { role: Role; color: CgColor }

const ROLES: Role[] = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn']
const ROLE_NAMES: Record<Role, string> = { king: 'king', queen: 'queen', rook: 'rook', bishop: 'bishop', knight: 'knight', pawn: 'pawn' }

interface Castling { K: boolean; Q: boolean; k: boolean; q: boolean }

function placementOf(fen: string): string {
  return fen.trim().split(/\s+/)[0]
}

function pieceAt(placement: string, square: string): string | null {
  const rows = placement.split('/')
  const file = square.charCodeAt(0) - 97
  const row = rows[8 - parseInt(square[1], 10)] ?? ''
  let f = 0
  for (const ch of row) {
    if (/\d/.test(ch)) f += parseInt(ch, 10)
    else {
      if (f === file) return ch
      f += 1
    }
  }
  return null
}

function composeFen(placement: string, turn: 'w' | 'b', castling: Castling): string {
  // Only keep castling rights that still make sense for the pieces on the board.
  let c = ''
  if (castling.K && pieceAt(placement, 'e1') === 'K' && pieceAt(placement, 'h1') === 'R') c += 'K'
  if (castling.Q && pieceAt(placement, 'e1') === 'K' && pieceAt(placement, 'a1') === 'R') c += 'Q'
  if (castling.k && pieceAt(placement, 'e8') === 'k' && pieceAt(placement, 'h8') === 'r') c += 'k'
  if (castling.q && pieceAt(placement, 'e8') === 'k' && pieceAt(placement, 'a8') === 'r') c += 'q'
  return `${placement} ${turn} ${c || '-'} - 0 1`
}

/** Checks chess.js does not do: one king each, no pawns on the edge ranks, no impossible check. */
export function positionProblem(fen: string): string | null {
  const placement = placementOf(fen)
  const count = (ch: string) => placement.split('').filter((x) => x === ch).length
  if (count('K') !== 1 || count('k') !== 1) return 'Each side needs exactly one king.'
  const rows = placement.split('/')
  if (/[pP]/.test(rows[0] ?? '') || /[pP]/.test(rows[7] ?? '')) return 'Pawns cannot stand on the first or last rank.'
  const check = checkFen(fen)
  if (!check.ok) return check.error ?? 'This position is not valid.'
  const parts = fen.split(' ')
  parts[1] = parts[1] === 'w' ? 'b' : 'w'
  parts[3] = '-'
  const flipped = safeChess(parts.join(' '))
  if (flipped?.inCheck()) return 'The side that just moved is in check. That cannot happen in a real game.'
  if (!safeChess(fen)) return 'This position is not valid.'
  return null
}

export function PositionEditor({ open, initialFen, onClose, onApply }: {
  open: boolean
  initialFen: string
  onClose: () => void
  onApply: (fen: string) => void
}) {
  return (
    <Modal title="Set up a position" open={open} onClose={onClose} wide>
      {open && <EditorBody initialFen={initialFen} onClose={onClose} onApply={onApply} />}
    </Modal>
  )
}

function EditorBody({ initialFen, onClose, onApply }: { initialFen: string; onClose: () => void; onApply: (fen: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const cg = useRef<Api | null>(null)
  const [placement, setPlacement] = useState(placementOf(initialFen))
  const [turn, setTurn] = useState<'w' | 'b'>(initialFen.split(' ')[1] === 'b' ? 'b' : 'w')
  const initialCastling = initialFen.split(' ')[2] ?? '-'
  const [castling, setCastling] = useState<Castling>({
    K: initialCastling.includes('K'), Q: initialCastling.includes('Q'),
    k: initialCastling.includes('k'), q: initialCastling.includes('q'),
  })
  const [tool, setTool] = useState<Tool>('move')
  const toolRef = useRef<Tool>(tool)
  toolRef.current = tool
  const [fenText, setFenText] = useState('')

  useEffect(() => {
    if (!el.current) return
    cg.current = Chessground(el.current, {
      fen: placement,
      coordinates: true,
      animation: { enabled: false },
      movable: { free: true, color: 'both', showDests: false },
      draggable: { deleteOnDropOff: true },
      premovable: { enabled: false },
      drawable: { enabled: false },
      highlight: { lastMove: false, check: false },
      events: { change: () => setPlacement(cg.current!.getFen()) },
    })
    return () => cg.current?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    cg.current?.set({ viewOnly: tool !== 'move' })
  }, [tool])

  const fen = composeFen(placement, turn, castling)
  useEffect(() => setFenText(fen), [fen])
  const problem = positionProblem(fen)

  const setBoard = (newPlacement: string) => {
    cg.current?.set({ fen: newPlacement })
    setPlacement(cg.current?.getFen() ?? newPlacement)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const t = toolRef.current
    if (t === 'move' || !cg.current) return
    const key = cg.current.getKeyAtDomPos([e.clientX, e.clientY])
    if (!key) return
    e.preventDefault()
    if (t === 'trash') cg.current.setPieces(new Map([[key, undefined]]))
    else cg.current.setPieces(new Map([[key, { role: t.role, color: t.color }]]))
    setPlacement(cg.current.getFen())
  }

  const applyFenText = () => {
    const parts = fenText.trim().split(/\s+/)
    if (!parts[0]) return
    setBoard(parts[0])
    if (parts[1] === 'w' || parts[1] === 'b') setTurn(parts[1])
    const c = parts[2] ?? '-'
    setCastling({ K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') })
  }

  const isTool = (t: Tool) => JSON.stringify(t) === JSON.stringify(tool)

  return (
    <div className="editor">
      <div className="editor-board-wrap" onPointerDownCapture={onPointerDown}>
        <div className="board-frame">
          <div ref={el} className="board" />
        </div>
      </div>
      <div className="editor-side">
        <fieldset className="palette">
          <legend>Pieces</legend>
          <p className="hint">Drag pieces to move them, or off the board to remove them. Pick a piece below to place it with a click.</p>
          <div className="palette-grid">
            <button type="button" className={`palette-btn tool-text ${isTool('move') ? 'active' : ''}`} onClick={() => setTool('move')}>Move</button>
            <button type="button" className={`palette-btn tool-text ${isTool('trash') ? 'active' : ''}`} onClick={() => setTool('trash')}>Remove</button>
            {(['white', 'black'] as CgColor[]).map((color) =>
              ROLES.map((role) => (
                <button
                  key={`${color}-${role}`}
                  type="button"
                  className={`palette-btn cg-wrap ${isTool({ role, color }) ? 'active' : ''}`}
                  aria-label={`Place ${color} ${ROLE_NAMES[role]}`}
                  onClick={() => setTool({ role, color })}
                >
                  <piece className={`${role} ${color}`} />
                </button>
              )),
            )}
          </div>
        </fieldset>

        <fieldset className="choice-group">
          <legend>Side to move</legend>
          <label><input type="radio" name="turn" checked={turn === 'w'} onChange={() => setTurn('w')} /> White</label>
          <label><input type="radio" name="turn" checked={turn === 'b'} onChange={() => setTurn('b')} /> Black</label>
        </fieldset>

        <fieldset className="choice-group">
          <legend>Castling still allowed</legend>
          <label><input type="checkbox" checked={castling.K} onChange={(e) => setCastling({ ...castling, K: e.target.checked })} /> White O-O</label>
          <label><input type="checkbox" checked={castling.Q} onChange={(e) => setCastling({ ...castling, Q: e.target.checked })} /> White O-O-O</label>
          <label><input type="checkbox" checked={castling.k} onChange={(e) => setCastling({ ...castling, k: e.target.checked })} /> Black O-O</label>
          <label><input type="checkbox" checked={castling.q} onChange={(e) => setCastling({ ...castling, q: e.target.checked })} /> Black O-O-O</label>
        </fieldset>

        <div className="row">
          <button type="button" className="btn btn-quiet" onClick={() => { setBoard(placementOf(START_FEN)); setTurn('w'); setCastling({ K: true, Q: true, k: true, q: true }) }}>Starting position</button>
          <button type="button" className="btn btn-quiet" onClick={() => setBoard('8/8/8/8/8/8/8/8')}>Clear board</button>
        </div>

        <label className="field">
          <span className="field-label">FEN</span>
          <input
            className="input mono-ish"
            value={fenText}
            onChange={(e) => setFenText(e.target.value)}
            onBlur={applyFenText}
            onKeyDown={(e) => { if (e.key === 'Enter') applyFenText() }}
            spellCheck={false}
          />
        </label>

        {problem && <p className="form-error" role="alert">{problem}</p>}
        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!!problem} onClick={() => onApply(fen)}>Analyze this position</button>
        </div>
      </div>
    </div>
  )
}
