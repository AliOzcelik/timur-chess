import { useEffect, useState } from 'react'
import { api, type Opening } from '../lib/api'

const cache = new Map<string, Opening | null>()

/** The opening name for a line of moves (asked from the server, which knows the ECO list). */
export function useOpening(rootFen: string, moves: string[]): Opening | null {
  const key = `${rootFen}|${moves.join(' ')}`
  const [opening, setOpening] = useState<Opening | null>(cache.get(key) ?? null)
  useEffect(() => {
    if (cache.has(key)) {
      setOpening(cache.get(key) ?? null)
      return
    }
    let live = true
    const t = window.setTimeout(async () => {
      try {
        const res = await api.detectOpening(rootFen, moves)
        cache.set(key, res.opening)
        if (live) setOpening(res.opening)
      } catch {
        /* offline: no name */
      }
    }, 150)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return opening
}
