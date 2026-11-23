// Evals are always from White's point of view (same shape as the backend).
export interface Eval {
  cp: number | null
  mate: number | null
  winner?: 'white' | 'black'
  draw?: boolean
}

const CP_CAP = 1000
const WIN_K = 0.00368208

export function whiteCp(e: Eval): number {
  if (e.winner === 'white') return CP_CAP
  if (e.winner === 'black') return -CP_CAP
  if (e.mate !== null && e.mate !== undefined) return e.mate > 0 ? CP_CAP : -CP_CAP
  return Math.max(-CP_CAP, Math.min(CP_CAP, e.cp ?? 0))
}

/** White's winning chance, 0-100 (same curve as lichess). */
export function winWhite(e: Eval): number {
  if (e.winner === 'white') return 100
  if (e.winner === 'black') return 0
  const cp = whiteCp(e)
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1)
}

export function formatEval(e: Eval | null | undefined): string {
  if (!e) return ''
  if (e.winner) return e.winner === 'white' ? '1-0' : '0-1'
  if (e.draw) return '½-½'
  if (e.mate !== null && e.mate !== undefined) return e.mate > 0 ? `#${e.mate}` : `#-${-e.mate}`
  const v = (e.cp ?? 0) / 100
  if (Math.abs(v) < 0.005) return '0.00'
  return (v > 0 ? '+' : '') + v.toFixed(2)
}

/** Which side the eval favors, for coloring. */
export function evalSide(e: Eval | null | undefined): 'white' | 'black' | 'even' {
  if (!e) return 'even'
  const cp = whiteCp(e)
  if (cp > 20) return 'white'
  if (cp < -20) return 'black'
  return 'even'
}
