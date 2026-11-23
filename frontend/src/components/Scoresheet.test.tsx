import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { START_FEN } from '../lib/chess'
import { addMove, createTree, fromUciLine, lineEnd, pathTo, type GameTree } from '../lib/tree'
import { Scoresheet } from './Scoresheet'

function rows(container: HTMLElement): string[][] {
  const cells = [...container.querySelectorAll('.sheet-grid > *')]
  const out: string[][] = []
  for (let i = 0; i < cells.length; i++) {
    const el = cells[i]
    if (el.classList.contains('sheet-num')) out.push([el.textContent ?? '', cells[i + 1].textContent ?? '', cells[i + 2].textContent ?? ''])
  }
  return out
}

describe('Scoresheet', () => {
  it('shows a hint when there are no moves', () => {
    const tree = createTree()
    render(<Scoresheet tree={tree} currentId={tree.rootId} onSelect={() => {}} />)
    expect(screen.getByText('Make a move on the board, or import a game.')).toBeInTheDocument()
  })

  it('writes moves in numbered White and Black columns', () => {
    const tree = fromUciLine(START_FEN, ['e2e4', 'e7e5', 'g1f3'])
    const { container } = render(<Scoresheet tree={tree} currentId={tree.rootId} onSelect={() => {}} />)
    expect(rows(container)).toEqual([['1', 'e4', 'e5'], ['2', 'Nf3', '']])
  })

  it('marks the current move and selects moves on click', async () => {
    const tree = fromUciLine(START_FEN, ['e2e4', 'e7e5'])
    const ids = pathTo(tree, lineEnd(tree, tree.rootId))
    const onSelect = vi.fn()
    render(<Scoresheet tree={tree} currentId={ids[2]} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'e5' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'e4' })).not.toHaveAttribute('aria-current')
    await userEvent.click(screen.getByRole('button', { name: 'e4' }))
    expect(onSelect).toHaveBeenCalledWith(ids[1])
  })

  it('writes side lines under the move they branch from', () => {
    // 1.e4 e5 (1...c5 2.Nf3) 2.Nf3
    let tree: GameTree = fromUciLine(START_FEN, ['e2e4', 'e7e5', 'g1f3'])
    const e4 = tree.nodes[tree.rootId].children[0]
    const c5 = addMove(tree, e4, 'c7c5')!
    tree = addMove(c5.tree, c5.id, 'g1f3')!.tree
    const { container } = render(<Scoresheet tree={tree} currentId={tree.rootId} onSelect={() => {}} />)
    const variation = container.querySelector('.sheet-variation') as HTMLElement
    expect(variation.textContent).toBe('1...c52.Nf3')
    expect(rows(container)).toEqual([['1', 'e4', 'e5'], ['2', 'Nf3', '']])
  })

  it('a game starting with Black leaves the White cell empty', () => {
    const tree = fromUciLine('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', ['e7e5', 'g1f3'])
    const { container } = render(<Scoresheet tree={tree} currentId={tree.rootId} onSelect={() => {}} />)
    expect(rows(container)).toEqual([['1', '…', 'e5'], ['2', 'Nf3', '']])
  })

  it('shows review marks next to moves', () => {
    const tree = fromUciLine(START_FEN, ['e2e4', 'e7e5', 'g1f3'])
    const ids = pathTo(tree, lineEnd(tree, tree.rootId))
    render(
      <Scoresheet
        tree={tree}
        currentId={tree.rootId}
        onSelect={() => {}}
        annotations={{ [ids[1]]: 'best', [ids[2]]: 'blunder', [ids[3]]: 'inaccuracy' }}
      />,
    )
    const e5 = screen.getByRole('button', { name: 'e5??' })
    expect(e5).toHaveClass('cls-blunder')
    expect(screen.getByRole('button', { name: 'Nf3?!' })).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'e4' })).queryByText(/\?/)).toBeNull()
  })

  it('shows comments', () => {
    let tree = fromUciLine(START_FEN, ['e2e4', 'e7e5'])
    const e4 = tree.nodes[tree.rootId].children[0]
    tree = { ...tree, nodes: { ...tree.nodes, [e4]: { ...tree.nodes[e4], comment: 'Best by test' } } }
    render(<Scoresheet tree={tree} currentId={tree.rootId} onSelect={() => {}} />)
    expect(screen.getByText('Best by test')).toHaveClass('sheet-comment')
  })
})
