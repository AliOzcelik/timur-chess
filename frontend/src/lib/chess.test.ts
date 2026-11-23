import { describe, expect, it } from 'vitest'
import {
  START_FEN, checkFen, destsOf, fullmoveOf, isCheck, isPromotion, looksLikeFen, moveNumberLabel, numberedLine,
  playUci, safeChess, turnOf, uciSquares,
} from './chess'

const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'
const PROMOTE = '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1'

describe('reading a FEN', () => {
  it('finds the side to move and the move number', () => {
    expect(turnOf(START_FEN)).toBe('white')
    expect(turnOf(AFTER_E4)).toBe('black')
    expect(fullmoveOf('8/8/8/8/8/8/8/8 w - - 0 23')).toBe(23)
    expect(fullmoveOf('8/8/8/8/8/8/8/8 w - - 0 x')).toBe(1)
    expect(fullmoveOf('8/8/8/8/8/8/8/8 w')).toBe(1)
  })

  it('safeChess returns null instead of throwing', () => {
    expect(safeChess('nonsense')).toBeNull()
    expect(safeChess(START_FEN)?.fen()).toBe(START_FEN)
  })
})

describe('legal moves for the board', () => {
  it('lists 20 moves from 10 squares at the start', () => {
    const dests = destsOf(START_FEN)
    expect(dests.size).toBe(10)
    expect([...dests.values()].flat()).toHaveLength(20)
    expect(dests.get('g1')).toEqual(expect.arrayContaining(['f3', 'h3']))
  })

  it('is empty for a broken FEN', () => {
    expect(destsOf('broken').size).toBe(0)
  })
})

describe('check and promotion', () => {
  it('detects check', () => {
    expect(isCheck('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3')).toBe(true)
    expect(isCheck(START_FEN)).toBe(false)
  })

  it('detects a pawn reaching the last rank', () => {
    expect(isPromotion(PROMOTE, 'e7', 'e8')).toBe(true)
    expect(isPromotion(PROMOTE, 'e1', 'e2')).toBe(false)
    expect(isPromotion(START_FEN, 'e2', 'e4')).toBe(false)
    expect(isPromotion('broken', 'e7', 'e8')).toBe(false)
  })
})

describe('playUci', () => {
  it('plays a legal move', () => {
    expect(playUci(START_FEN, 'e2e4')).toEqual({ san: 'e4', uci: 'e2e4', fen: AFTER_E4 })
  })

  it('promotes', () => {
    const res = playUci(PROMOTE, 'e7e8n')
    expect(res?.san).toBe('e8=N+') // the new knight checks the king on g7
    expect(res?.uci).toBe('e7e8n')
  })

  it('returns null for illegal moves and bad FENs', () => {
    expect(playUci(START_FEN, 'e2e5')).toBeNull()
    expect(playUci('broken', 'e2e4')).toBeNull()
  })
})

describe('small helpers', () => {
  it('uciSquares', () => {
    expect(uciSquares('e7e8q')).toEqual(['e7', 'e8'])
    expect(uciSquares('e7')).toBeUndefined()
    expect(uciSquares(undefined)).toBeUndefined()
  })

  it('checkFen explains what is wrong', () => {
    expect(checkFen(START_FEN)).toEqual({ ok: true })
    const bad = checkFen('rnbqkbnr/pppppppp/8/8 w KQkq - 0 1')
    expect(bad.ok).toBe(false)
    expect(bad.error).toBeTruthy()
  })

  it('tells a FEN apart from a PGN', () => {
    expect(looksLikeFen(START_FEN)).toBe(true)
    expect(looksLikeFen('  8/8/8/8/8/8/8/8  ')).toBe(true)
    expect(looksLikeFen('1. e4 e5 2. Nf3')).toBe(false)
    expect(looksLikeFen('[Event "x"]\n\n1. e4')).toBe(false)
  })

  it('moveNumberLabel', () => {
    expect(moveNumberLabel(START_FEN)).toBe('1.')
    expect(moveNumberLabel(AFTER_E4)).toBe('1...')
    expect(moveNumberLabel(AFTER_E4, false)).toBe('')
  })

  it('numbers a line that starts with White', () => {
    expect(numberedLine(START_FEN, ['e4', 'e5', 'Nf3'])).toEqual([
      { label: '1.', san: 'e4', index: 0 },
      { label: null, san: 'e5', index: 1 },
      { label: '2.', san: 'Nf3', index: 2 },
    ])
  })

  it('numbers a line that starts with Black', () => {
    expect(numberedLine(AFTER_E4, ['e5', 'Nf3', 'Nc6']).map((t) => t.label)).toEqual(['1...', '2.', null])
  })
})
