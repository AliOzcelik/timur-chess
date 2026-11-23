import { useEffect, useState } from 'react'

/** Tiny hash router: "#/review/3" -> ["review", "3"]. */
function parse(): string[] {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const [path] = hash.split('?')
  return path.split('/').filter(Boolean)
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const onChange = () => setRoute(parse())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: string): void {
  window.location.hash = path.startsWith('/') ? path : `/${path}`
}
