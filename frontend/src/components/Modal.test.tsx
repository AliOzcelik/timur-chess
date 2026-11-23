import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('opens and closes with the open prop', () => {
    const { rerender, container } = render(<Modal title="Import" open={false} onClose={() => {}}>body</Modal>)
    const dialog = container.querySelector('dialog')!
    expect(dialog.open).toBe(false)
    expect(screen.queryByText('body')).toBeNull()
    rerender(<Modal title="Import" open onClose={() => {}}>body</Modal>)
    expect(dialog.open).toBe(true)
    expect(screen.getByRole('heading', { name: 'Import' })).toBeInTheDocument()
    rerender(<Modal title="Import" open={false} onClose={() => {}}>body</Modal>)
    expect(dialog.open).toBe(false)
  })

  it('the close button and a click on the backdrop call onClose', async () => {
    const onClose = vi.fn()
    const { container } = render(<Modal title="Import" open onClose={onClose}><p>inside</p></Modal>)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByText('inside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(container.querySelector('dialog')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
