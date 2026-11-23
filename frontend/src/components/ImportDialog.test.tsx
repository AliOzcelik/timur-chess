import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { START_FEN } from '../lib/chess'
import type { GameTree } from '../lib/tree'
import { fakeServer } from '../test/helpers'
import { ImportDialog } from './ImportDialog'

const parsedGame = {
  headers: { White: 'Ann', Black: 'Ben' },
  game_count: 1,
  tree: {
    fen: START_FEN,
    children: [{ fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', san: 'e4', uci: 'e2e4', children: [] }],
  },
}

function setup() {
  const onLoad = vi.fn<(tree: GameTree, note: string | null) => void>()
  const onClose = vi.fn()
  render(<ImportDialog open onClose={onClose} onLoad={onLoad} />)
  const box = screen.getByRole('textbox', { name: 'PGN or FEN' })
  const load = screen.getByRole('button', { name: 'Load on the board' })
  return { onLoad, onClose, box, load }
}

describe('ImportDialog', () => {
  it('asks for text first', async () => {
    const { load, onLoad } = setup()
    await userEvent.click(load)
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a PGN or a FEN first.')
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('loads a FEN without asking the server', async () => {
    const server = fakeServer({})
    const { box, load, onLoad, onClose } = setup()
    const fen = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'
    await userEvent.type(box, fen)
    await userEvent.click(load)
    expect(server).not.toHaveBeenCalled()
    const tree = onLoad.mock.calls[0][0]
    expect(tree.nodes[tree.rootId].fen).toBe(fen)
    expect(onClose).toHaveBeenCalled()
  })

  it('explains a broken FEN', async () => {
    const { box, load, onLoad } = setup()
    await userEvent.type(box, '4k3/8/8/8/8/8/4P3/4K3 x - - 0 1')
    await userEvent.click(load)
    expect(screen.getByRole('alert')).toHaveTextContent(/That FEN is not valid/)
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('loads a PGN through the server', async () => {
    fakeServer({ 'POST /api/pgn/parse': () => ({ body: parsedGame }) })
    const { box, load, onLoad } = setup()
    await userEvent.type(box, '1. e4 *')
    await userEvent.click(load)
    const [tree, note] = onLoad.mock.calls[0]
    expect(note).toBeNull()
    expect(tree.headers.White).toBe('Ann')
    expect(tree.nodes[tree.nodes[tree.rootId].children[0]].san).toBe('e4')
  })

  it('says when only the first of several games was loaded', async () => {
    fakeServer({ 'POST /api/pgn/parse': () => ({ body: { ...parsedGame, game_count: 3 } }) })
    const { box, load, onLoad } = setup()
    await userEvent.type(box, '1. e4 *')
    await userEvent.click(load)
    expect(onLoad.mock.calls[0][1]).toBe('This PGN has 3 games. The first one was loaded.')
  })

  it('a PGN without moves is refused', async () => {
    fakeServer({ 'POST /api/pgn/parse': () => ({ body: { ...parsedGame, tree: { fen: START_FEN, children: [] } } }) })
    const { box, load, onLoad } = setup()
    await userEvent.click(box)
    await userEvent.paste('[Event "x"]')
    await userEvent.click(load)
    expect(screen.getByRole('alert')).toHaveTextContent('No moves were found.')
    expect(onLoad).not.toHaveBeenCalled()
  })

  it('shows the server error', async () => {
    fakeServer({ 'POST /api/pgn/parse': () => ({ status: 400, body: { detail: 'The PGN has a problem: illegal san' } }) })
    const { box, load } = setup()
    await userEvent.type(box, '1. e4 e5 2. Ke3')
    await userEvent.click(load)
    expect(await screen.findByRole('alert')).toHaveTextContent('The PGN has a problem: illegal san')
  })

  it('reads a .pgn file into the box', async () => {
    setup()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['1. d4 d5 *'], 'game.pgn', { type: 'text/plain' }))
    expect(await screen.findByDisplayValue('1. d4 d5 *')).toBeInTheDocument()
  })

  it('refuses files over 2 MB', async () => {
    setup()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const big = new File(['x'], 'big.pgn', { type: 'text/plain' })
    Object.defineProperty(big, 'size', { value: 2_000_001 })
    await userEvent.upload(input, big)
    expect(screen.getByRole('alert')).toHaveTextContent('That file is larger than 2 MB.')
  })
})
