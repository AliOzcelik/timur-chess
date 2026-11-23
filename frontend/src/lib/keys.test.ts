import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useShortcuts } from './keys'

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = window): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe('useShortcuts', () => {
  it('runs the handler and stops the browser default', () => {
    const next = vi.fn()
    renderHook(() => useShortcuts({ ArrowRight: next }))
    const event = press('ArrowRight')
    expect(next).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('a handler can return false to keep the browser default', () => {
    renderHook(() => useShortcuts({ ' ': () => false }))
    expect(press(' ').defaultPrevented).toBe(false)
  })

  it('ignores keys with modifiers, unknown keys and typing in fields', () => {
    const handler = vi.fn()
    renderHook(() => useShortcuts({ f: handler }))
    press('f', { metaKey: true })
    press('f', { ctrlKey: true })
    press('g')
    const input = document.body.appendChild(document.createElement('input'))
    press('f', {}, input)
    const textarea = document.body.appendChild(document.createElement('textarea'))
    press('f', {}, textarea)
    expect(handler).not.toHaveBeenCalled()
    input.remove()
    textarea.remove()
  })

  it('is quiet while a dialog is open', () => {
    const handler = vi.fn()
    renderHook(() => useShortcuts({ f: handler }))
    const dialog = document.body.appendChild(document.createElement('dialog'))
    dialog.setAttribute('open', '')
    press('f')
    expect(handler).not.toHaveBeenCalled()
    dialog.remove()
    press('f')
    expect(handler).toHaveBeenCalledOnce()
  })

  it('can be switched off and always uses the latest handlers', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ fn, on }) => useShortcuts({ n: fn }, on), {
      initialProps: { fn: first, on: true },
    })
    rerender({ fn: second, on: true })
    press('n')
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    rerender({ fn: second, on: false })
    press('n')
    expect(second).toHaveBeenCalledOnce()
  })
})
