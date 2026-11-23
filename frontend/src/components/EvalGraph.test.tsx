import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EvalGraph } from './EvalGraph'

const wins = [50, 55, 52, 90, 10]
const labels = ['Start +0.00', '1.e4 +0.30', '1...e5 +0.20', '2.Qh5 +3.00', '2...Nf6 -3.00']

function setup(onSelect = vi.fn()) {
  const utils = render(<EvalGraph wins={wins} labels={labels} current={2} markers={[{ index: 3, cls: 'blunder' }, { index: 4, cls: 'mistake' }]} onSelect={onSelect} />)
  const graph = screen.getByRole('img', { name: /Evaluation graph/ })
  vi.spyOn(graph, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 600, top: 0, height: 112, right: 600, bottom: 112, x: 0, y: 0, toJSON: () => ({}) })
  return { ...utils, graph, onSelect }
}

describe('EvalGraph', () => {
  it('draws one point per position', () => {
    const { container } = setup()
    const points = container.querySelector('polyline')!.getAttribute('points')!.split(' ')
    expect(points).toHaveLength(5)
    expect(points[0]).toBe('0.0,56.0') // 50% sits on the middle line
    expect(points[3]).toBe('450.0,11.2')
  })

  it('marks mistakes and blunders', () => {
    const { container } = setup()
    const dots = container.querySelectorAll('circle')
    expect(dots).toHaveLength(2)
    expect(dots[0]).toHaveClass('dot-blunder')
    expect(dots[0]).toHaveAttribute('r', '5')
    expect(dots[1]).toHaveAttribute('r', '4')
  })

  it('draws the current position', () => {
    const { container } = setup()
    expect(container.querySelector('.graph-current')).toHaveAttribute('x1', '300')
  })

  it('click jumps to the nearest position', () => {
    const { graph, onSelect } = setup()
    fireEvent.click(graph, { clientX: 440 })
    expect(onSelect).toHaveBeenCalledWith(3)
    fireEvent.click(graph, { clientX: -20 })
    expect(onSelect).toHaveBeenLastCalledWith(0)
    fireEvent.click(graph, { clientX: 9999 })
    expect(onSelect).toHaveBeenLastCalledWith(4)
  })

  it('hover shows the move and eval', () => {
    const { graph } = setup()
    fireEvent.pointerMove(graph, { clientX: 160 })
    expect(screen.getByText('1.e4 +0.30')).toBeInTheDocument()
    fireEvent.pointerLeave(graph)
    expect(screen.queryByText('1.e4 +0.30')).toBeNull()
  })
})
