import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { winWhite } from '../lib/evals'
import { EvalBar } from './EvalBar'

describe('EvalBar', () => {
  it('is half and half without an eval', () => {
    render(<EvalBar value={null} orientation="white" />)
    const bar = screen.getByRole('meter', { name: 'Evaluation' })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(bar).toHaveAttribute('aria-valuetext', 'no evaluation')
  })

  it('shows the eval without a plus sign, on the side that is ahead', () => {
    const { container } = render(<EvalBar value={{ cp: 150, mate: null }} orientation="white" />)
    const bar = screen.getByRole('meter')
    expect(bar).toHaveAttribute('aria-valuenow', String(Math.round(winWhite({ cp: 150, mate: null }))))
    expect(bar).toHaveAttribute('aria-valuetext', '+1.50')
    expect(container.querySelector('.eval-bar-text')).toHaveTextContent('1.50')
    expect(container.querySelector('.eval-bar-text')).toHaveClass('on-white')
    expect(container.querySelector('.eval-bar-white')).toHaveStyle({ height: `${winWhite({ cp: 150, mate: null })}%` })
  })

  it('Black ahead, board flipped', () => {
    const { container } = render(<EvalBar value={{ cp: null, mate: -2 }} orientation="black" />)
    expect(container.querySelector('.eval-bar')).toHaveClass('flipped')
    expect(container.querySelector('.eval-bar-text')).toHaveClass('on-black')
    expect(container.querySelector('.eval-bar-text')).toHaveTextContent('#-2')
  })

  it('hidden hides the number', () => {
    const { container } = render(<EvalBar value={{ cp: 20, mate: null }} orientation="white" hidden />)
    expect(container.querySelector('.eval-bar')).toHaveClass('is-hidden')
    expect(container.querySelector('.eval-bar-text')).toBeNull()
  })
})
