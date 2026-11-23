import { Chess, validateFen, type Square } from 'chess.js'
import type { Key } from '@lichess-org/chessground/types'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export type Color = 'white' | 'black'

export interface PlayedMove {
  san: string
  uci: string
  fen: string
}

export function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

export function fullmoveOf(fen: string): number {
  const n = parseInt(fen.split(' ')[5] ?? '1', 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function safeChess(fen: string): Chess | null {
  try {
    return new Chess(fen)
  } catch {
    return null
  }
}

/** Legal destinations for chessground. */
export function destsOf(fen: string): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  const chess = safeChess(fen)
  if (!chess) return dests
  for (const m of chess.moves({ verbose: true })) {
    const list = dests.get(m.from as Key)
    if (list) list.push(m.to as Key)
    else dests.set(m.from as Key, [m.to as Key])
  }
  return dests
}

export function isCheck(fen: string): boolean {
  return safeChess(fen)?.inCheck() ?? false
}

export function isPromotion(fen: string, from: string, to: string): boolean {
  const chess = safeChess(fen)
  if (!chess) return false
  const piece = chess.get(from as Square)
  if (!piece || piece.type !== 'p') return false
  return to[1] === '8' || to[1] === '1'
}

/** Play a UCI move ("e2e4", "e7e8q") on a FEN. Returns null if illegal. */
export function playUci(fen: string, uci: string): PlayedMove | null {
  const chess = safeChess(fen)
  if (!chess) return null
  try {
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
    return { san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fen: chess.fen() }
  } catch {
    return null
  }
}

export function uciSquares(uci: string | undefined): [Key, Key] | undefined {
  if (!uci || uci.length < 4) return undefined
  return [uci.slice(0, 2) as Key, uci.slice(2, 4) as Key]
}

export function checkFen(fen: string): { ok: boolean; error?: string } {
  const result = validateFen(fen.trim())
  return result.ok ? { ok: true } : { ok: false, error: result.error }
}

export function looksLikeFen(text: string): boolean {
  const t = text.trim()
  return /^[pnbrqkPNBRQK1-8]+(\/[pnbrqkPNBRQK1-8]+){7}(\s|$)/.test(t)
}

/** "12." for White to move, "12..." for Black. */
export function moveNumberLabel(fen: string, forceBlack = true): string {
  const n = fullmoveOf(fen)
  return turnOf(fen) === 'white' ? `${n}.` : forceBlack ? `${n}...` : ''
}

/** Numbered tokens for a SAN line starting at `fen`, e.g. ["12...", "Nf6", "13.", "e5"]. */
export function numberedLine(fen: string, sans: string[]): { label: string | null; san: string; index: number }[] {
  let n = fullmoveOf(fen)
  let white = turnOf(fen) === 'white'
  return sans.map((san, index) => {
    let label: string | null = null
    if (white) label = `${n}.`
    else if (index === 0) label = `${n}...`
    if (!white) n += 1
    white = !white
    return { label, san, index }
  })
}

export const PIECE_NAMES: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}
