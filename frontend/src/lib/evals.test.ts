import { describe, expect, it } from 'vitest'
import { evalSide, formatEval, whiteCp, winWhite, type Eval } from './evals'

const cp = (v: number): Eval => ({ cp: v, mate: null })
const mate = (n: number): Eval => ({ cp: null, mate: n })

describe('whiteCp', () => {
  it('caps centipawns and treats mates as the cap', () => {
    expect(whiteCp(cp(34))).toBe(34)
    expect(whiteCp(cp(4000))).toBe(1000)
    expect(whiteCp(cp(-4000))).toBe(-1000)
    expect(whiteCp(mate(3))).toBe(1000)
    expect(whiteCp(mate(-1))).toBe(-1000)
    expect(whiteCp({ cp: null, mate: 0, winner: 'black' })).toBe(-1000)
  })
})

describe('winWhite', () => {
  it('matches the backend curve', () => {
    expect(winWhite(cp(0))).toBeCloseTo(50)
    expect(winWhite(cp(100))).toBeCloseTo(59.1, 1)
    expect(winWhite(cp(300)) + winWhite(cp(-300))).toBeCloseTo(100)
  })

  it('is 100 or 0 once the game is decided', () => {
    expect(winWhite({ cp: null, mate: 0, winner: 'white' })).toBe(100)
    expect(winWhite({ cp: null, mate: 0, winner: 'black' })).toBe(0)
  })

  it('grows with the eval', () => {
    const values = [-1000, -300, 0, 300, 1000].map((v) => winWhite(cp(v)))
    expect([...values].sort((a, b) => a - b)).toEqual(values)
  })
})

describe('formatEval', () => {
  it.each([
    [null, ''],
    [cp(0), '0.00'],
    [cp(-0.4), '0.00'],
    [cp(150), '+1.50'],
    [cp(-34), '-0.34'],
    [mate(2), '#2'],
    [mate(-3), '#-3'],
    [{ cp: null, mate: 0, winner: 'white' } as Eval, '1-0'],
    [{ cp: null, mate: 0, winner: 'black' } as Eval, '0-1'],
    [{ cp: 0, mate: null, draw: true } as Eval, '½-½'],
  ])('%j -> %s', (e, text) => {
    expect(formatEval(e)).toBe(text)
  })
})

describe('evalSide', () => {
  it('needs more than 0.20 to favor a side', () => {
    expect(evalSide(null)).toBe('even')
    expect(evalSide(cp(20))).toBe('even')
    expect(evalSide(cp(21))).toBe('white')
    expect(evalSide(cp(-21))).toBe('black')
    expect(evalSide(mate(-2))).toBe('black')
  })
})
