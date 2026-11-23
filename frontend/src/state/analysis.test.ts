import { beforeEach, describe, expect, it, vi } from 'vitest'
import { START_FEN } from '../lib/chess'
import { createTree, fromUciLine, lineEnd, movesTo } from '../lib/tree'
import { useAnalysis } from './analysis'

const state = () => useAnalysis.getState()
const currentMoves = () => movesTo(state().tree, state().currentId)

beforeEach(() => {
  const tree = createTree()
  useAnalysis.setState({ tree, currentId: tree.rootId, orientation: 'white', threat: false, engineOn: true, multipv: 3, depth: 30, arrows: true })
})

describe('playing moves', () => {
  it('play adds a move and goes to it', () => {
    state().play('e2e4')
    expect(currentMoves()).toEqual(['e2e4'])
  })

  it('illegal moves are ignored', () => {
    state().play('e2e5')
    expect(currentMoves()).toEqual([])
  })

  it('playing turns threat mode off', () => {
    state().setThreat(true)
    state().play('e2e4')
    expect(state().threat).toBe(false)
  })

  it('playLine plays until the first illegal move', () => {
    state().playLine(['e2e4', 'e7e5', 'e7e5', 'g1f3'])
    expect(currentMoves()).toEqual(['e2e4', 'e7e5'])
  })
})

describe('moving through the game', () => {
  beforeEach(() => {
    state().playLine(['e2e4', 'e7e5', 'g1f3'])
  })

  it('back, forward, start and end', () => {
    state().back()
    expect(currentMoves()).toEqual(['e2e4', 'e7e5'])
    state().forward()
    expect(currentMoves()).toEqual(['e2e4', 'e7e5', 'g1f3'])
    state().forward() // nothing after the last move
    expect(currentMoves()).toHaveLength(3)
    state().toStart()
    expect(state().currentId).toBe(state().tree.rootId)
    state().back() // nothing before the start
    expect(state().currentId).toBe(state().tree.rootId)
    state().toEnd()
    expect(currentMoves()).toHaveLength(3)
  })

  it('goTo ignores unknown ids', () => {
    const before = state().currentId
    state().goTo('nope')
    expect(state().currentId).toBe(before)
  })
})

describe('editing', () => {
  it('remove deletes from a move on and steps back if needed', () => {
    state().playLine(['e2e4', 'e7e5', 'g1f3'])
    const e5 = state().tree.nodes[state().currentId].parentId!
    state().remove(e5)
    expect(currentMoves()).toEqual(['e2e4'])
    expect(state().tree.nodes[e5]).toBeUndefined()
  })

  it('remove keeps the current move when it is elsewhere', () => {
    state().playLine(['e2e4', 'e7e5'])
    const e5 = state().currentId
    state().back()
    state().playLine(['c7c5'])
    state().remove(e5)
    expect(currentMoves()).toEqual(['e2e4', 'c7c5'])
  })

  it('the root cannot be removed', () => {
    const tree = state().tree
    state().remove(tree.rootId)
    expect(state().tree).toBe(tree)
  })

  it('promote makes a side line the main line', () => {
    state().playLine(['e2e4', 'e7e5'])
    state().back()
    state().play('c7c5')
    const c5 = state().currentId
    state().promote(c5)
    const root = state().tree.nodes[state().tree.rootId]
    const e4 = state().tree.nodes[root.children[0]]
    expect(e4.children[0]).toBe(c5)
  })
})

describe('loading and resetting', () => {
  it('load uses the given move, or the start when it is unknown', () => {
    const tree = fromUciLine(START_FEN, ['d2d4', 'd7d5'])
    const end = lineEnd(tree, tree.rootId)
    state().load(tree, end, 'black')
    expect(state().currentId).toBe(end)
    expect(state().orientation).toBe('black')
    state().load(tree, 'unknown')
    expect(state().currentId).toBe(tree.rootId)
    expect(state().orientation).toBe('black')
  })

  it('reset starts a new board, optionally from a position', () => {
    state().playLine(['e2e4'])
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
    state().reset(fen)
    expect(state().tree.nodes[state().tree.rootId].fen).toBe(fen)
    expect(state().currentId).toBe(state().tree.rootId)
    state().reset()
    expect(state().tree.nodes[state().tree.rootId].fen).toBe(START_FEN)
  })

  it('flip', () => {
    state().flip()
    expect(state().orientation).toBe('black')
    state().flip()
    expect(state().orientation).toBe('white')
  })
})

describe('saving', () => {
  it('engine settings are saved right away', () => {
    state().setSettings({ multipv: 5, depth: null })
    expect(JSON.parse(window.localStorage.getItem('timur.engine-settings.v1')!)).toEqual({
      engineOn: true, multipv: 5, depth: null, arrows: true,
    })
  })

  it('the board is saved shortly after a change', () => {
    vi.useFakeTimers()
    state().playLine(['e2e4', 'e7e5'])
    expect(window.localStorage.getItem('timur.analysis.v1')).toBeNull()
    vi.advanceTimersByTime(350)
    const saved = JSON.parse(window.localStorage.getItem('timur.analysis.v1')!)
    expect(saved.currentId).toBe(state().currentId)
    expect(saved.orientation).toBe('white')
    expect(Object.keys(saved.tree.nodes)).toHaveLength(3)
  })

  it('a saved board and settings come back after a reload', async () => {
    const tree = fromUciLine(START_FEN, ['e2e4', 'c7c5'])
    const end = lineEnd(tree, tree.rootId)
    window.localStorage.setItem('timur.analysis.v1', JSON.stringify({ tree, currentId: end, orientation: 'black' }))
    window.localStorage.setItem('timur.engine-settings.v1', JSON.stringify({ multipv: 1, engineOn: false }))
    vi.resetModules()
    const fresh = (await import('./analysis')).useAnalysis.getState()
    expect(fresh.currentId).toBe(end)
    expect(fresh.orientation).toBe('black')
    expect(fresh.multipv).toBe(1)
    expect(fresh.engineOn).toBe(false)
    expect(fresh.depth).toBe(30) // default kept for settings that were not saved
  })

  it('a broken saved board is replaced by a new one', async () => {
    window.localStorage.setItem('timur.analysis.v1', JSON.stringify({ tree: { rootId: 'x', nodes: {} }, currentId: 'x' }))
    vi.resetModules()
    const fresh = (await import('./analysis')).useAnalysis.getState()
    expect(fresh.tree.nodes[fresh.tree.rootId].fen).toBe(START_FEN)
    expect(fresh.currentId).toBe(fresh.tree.rootId)
  })
})
