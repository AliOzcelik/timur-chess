import { useEffect, useRef } from 'react'

type Handler = (e: KeyboardEvent) => boolean | void

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/**
 * Page-level keyboard shortcuts. The map is keyed by KeyboardEvent.key.
 * Ignored while typing in a field or when a dialog is open.
 */
export function useShortcuts(map: Record<string, Handler>, enabled = true): void {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const handler = ref.current[e.key]
      if (!handler) return
      const handled = handler(e)
      if (handled !== false) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
