import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'
import { START_FEN } from './chess'
import {
  addMove, createTree, deleteFrom, fromParsed, fromUciLine, hasMoves, isOnMainline, lineEnd, makeMainline, movesTo,
  pathTo, toPgn, type GameTree, type ParsedNode,
} from './tree'

function play(tree: GameTree, from: string, ...ucis: string[]): { tree: GameTree; ids: string[] } {
  const ids: string[] = []
  let id = from
  for (const uci of ucis) {
    const res = addMove(tree, id, uci)
    if (!res) throw new Error(`illegal ${uci}`)
    tree = res.tree
    id = res.id
    ids.push(id)
  }
  return { tree, ids }
}

/** 1.e4 e5 2.Nf3 (2.Bc4 Nf6) Nc6 */
function sample() {
  const t0 = createTree()
  const main = play(t0, t0.rootId, 'e2e4', 'e7e5', 'g1f3', 'b8c6')
  const side = play(main.tree, main.ids[1], 'f1c4', 'g8f6')
  return { tree: side.tree, main: main.ids, side: side.ids }
}

describe('building the tree', () => {
  it('starts with one empty root', () => {
    const tree = createTree()
    expect(tree.nodes[tree.rootId]).toMatchObject({ parentId: null, ply: 0, fen: START_FEN, children: [] })
    expect(hasMoves(tree)).toBe(false)
  })

  it('adds moves without changing the old tree', () => {
    const tree = createTree()
    const res = addMove(tree, tree.rootId, 'e2e4')!
    expect(tree.nodes[tree.rootId].children).toEqual([])
    expect(res.tree.nodes[res.id]).toMatchObject({ san: 'e4', uci: 'e2e4', ply: 1, parentId: tree.rootId })
    expect(hasMoves(res.tree)).toBe(true)
  })

  it('reuses a move that is already there', () => {
    const tree = createTree()
    const first = addMove(tree, tree.rootId, 'e2e4')!
    const again = addMove(first.tree, first.tree.rootId, 'e2e4')!
    expect(again.id).toBe(first.id)
    expect(again.tree).toBe(first.tree)
  })

  it('refuses illegal moves and unknown nodes', () => {
    const tree = createTree()
    expect(addMove(tree, tree.rootId, 'e2e5')).toBeNull()
    expect(addMove(tree, 'missing', 'e2e4')).toBeNull()
  })

  it('a second move from the same position becomes a side line', () => {
    const { tree, main, side } = sample()
    expect(tree.nodes[main[1]].children).toEqual([main[2], side[0]])
  })
})

describe('walking the tree', () => {
  it('paths and moves', () => {
    const { tree, side } = sample()
    expect(pathTo(tree, side[1])).toHaveLength(5)
    expect(movesTo(tree, side[1])).toEqual(['e2e4', 'e7e5', 'f1c4', 'g8f6'])
    expect(movesTo(tree, tree.rootId)).toEqual([])
  })

  it('lineEnd follows the main continuation', () => {
    const { tree, main, side } = sample()
    expect(lineEnd(tree, tree.rootId)).toBe(main[3])
    expect(lineEnd(tree, side[0])).toBe(side[1])
  })

  it('knows what is on the main line', () => {
    const { tree, main, side } = sample()
    expect(isOnMainline(tree, main[3])).toBe(true)
    expect(isOnMainline(tree, side[1])).toBe(false)
    expect(isOnMainline(tree, tree.rootId)).toBe(true)
  })
})

describe('editing the tree', () => {
  it('deleteFrom removes the move and everything after it', () => {
    const { tree, main } = sample()
    const next = deleteFrom(tree, main[2])
    expect(next.nodes[main[2]]).toBeUndefined()
    expect(next.nodes[main[3]]).toBeUndefined()
    expect(next.nodes[main[1]].children).toHaveLength(1)
    expect(Object.keys(next.nodes)).toHaveLength(5)
    expect(Object.keys(tree.nodes)).toHaveLength(7) // original untouched
  })

  it('cannot delete the root', () => {
    const tree = createTree()
    expect(deleteFrom(tree, tree.rootId)).toBe(tree)
  })

  it('makeMainline promotes the side line at every branch above it', () => {
    const { tree, main, side } = sample()
    const next = makeMainline(tree, side[1])
    expect(next.nodes[main[1]].children).toEqual([side[0], main[2]])
    expect(isOnMainline(next, side[1])).toBe(true)
    expect(isOnMainline(next, main[3])).toBe(false)
  })
})

describe('importing', () => {
  const parsed: ParsedNode = {
    fen: START_FEN,
    comment: 'Start',
    children: [{
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
      san: 'e4', uci: 'e2e4', comment: '', nags: [1],
      children: [
        { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', san: 'e5', uci: 'e7e5', children: [] },
        { fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', san: 'c5', uci: 'c7c5', children: [] },
      ],
    }],
  }

  it('fromParsed keeps side lines, comments and NAGs', () => {
    const tree = fromParsed(parsed, { White: 'Ann' })
    const root = tree.nodes[tree.rootId]
    expect(root.comment).toBe('Start')
    const e4 = tree.nodes[root.children[0]]
    expect(e4).toMatchObject({ san: 'e4', nags: [1], comment: undefined, ply: 1 })
    expect(e4.children.map((id) => tree.nodes[id].san)).toEqual(['e5', 'c5'])
    expect(tree.headers.White).toBe('Ann')
  })

  it('fromUciLine stops at the first illegal move', () => {
    const tree = fromUciLine(START_FEN, ['e2e4', 'e7e5', 'e2e4', 'g1f3'])
    expect(movesTo(tree, lineEnd(tree, tree.rootId))).toEqual(['e2e4', 'e7e5'])
  })
})

describe('PGN export', () => {
  it('writes headers, moves, side lines and the result', () => {
    const { tree } = sample()
    const pgn = toPgn(tree)
    expect(pgn).toContain('[Event "?"]')
    expect(pgn).toContain('[Result "*"]')
    expect(pgn).not.toContain('[FEN')
    expect(pgn.trim().split('\n').pop()).toBe('1. e4 e5 2. Nf3 (2. Bc4 Nf6) 2... Nc6 *')
  })

  it('can leave the side lines out', () => {
    const { tree } = sample()
    expect(toPgn(tree, { variations: false }).trim().split('\n').pop()).toBe('1. e4 e5 2. Nf3 Nc6 *')
  })

  it('uses headers from the game and extra headers', () => {
    const tree = fromUciLine(START_FEN, ['e2e4'], { White: 'Ann "the rook"', Result: '1-0' })
    const pgn = toPgn(tree, { extraHeaders: { Event: 'Club' } })
    expect(pgn).toContain(`[White "Ann 'the rook'"]`)
    expect(pgn).toContain('[Event "Club"]')
    expect(pgn.trim().endsWith('1. e4 1-0')).toBe(true)
  })

  it('writes the start position and Black-to-move numbering', () => {
    const fen = '4k3/8/8/8/8/8/4P3/4K3 b - - 0 12'
    const tree = fromUciLine(fen, ['e8d7', 'e2e4'])
    const pgn = toPgn(tree)
    expect(pgn).toContain('[SetUp "1"]')
    expect(pgn).toContain(`[FEN "${fen}"]`)
    expect(pgn.trim().split('\n').pop()).toBe('12... Kd7 13. e4 *')
  })

  it('keeps comments but strips braces from them', () => {
    let tree = fromUciLine(START_FEN, ['e2e4'])
    const id = tree.nodes[tree.rootId].children[0]
    tree = { ...tree, nodes: { ...tree.nodes, [id]: { ...tree.nodes[id], comment: 'best {by test}' } } }
    expect(toPgn(tree)).toContain('1. e4 {best by test} *')
  })

  it('an empty board still makes a valid PGN', () => {
    expect(toPgn(createTree()).trim().split('\n').pop()).toBe('*')
  })

  it('round-trips through a PGN reader', () => {
    const { tree } = sample()
    const chess = new Chess()
    chess.loadPgn(toPgn(tree))
    expect(chess.history()).toEqual(['e4', 'e5', 'Nf3', 'Nc6'])
  })
})

describe('PGN export of nested side lines', () => {
  it('numbers moves after a nested side line', () => {
    // 1.e4 e5 (1...c5 2.Nf3 (2.Nc3 Nc6) d6) 2.Nf3
    const t0 = createTree()
    const main = play(t0, t0.rootId, 'e2e4', 'e7e5', 'g1f3')
    const side = play(main.tree, main.ids[0], 'c7c5', 'g1f3', 'd7d6')
    const nested = play(side.tree, side.ids[0], 'b1c3', 'b8c6')
    expect(toPgn(nested.tree).trim().split('\n').pop()).toBe('1. e4 e5 (1... c5 2. Nf3 (2. Nc3 Nc6) 2... d6) 2. Nf3 *')
  })
})
