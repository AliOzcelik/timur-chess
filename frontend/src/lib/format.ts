// The interface is in English, so dates are too ("2 Nov 2026"), whatever the system language.
const LOCALE = 'en-GB'

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPgnDate(date: string | null): string | null {
  if (!date) return null
  const [y, m, d] = date.split('.')
  if (!y || y.includes('?')) return null
  if (!m || m.includes('?')) return y
  const parsed = new Date(Number(y), Number(m) - 1, d && !d.includes('?') ? Number(d) : 1)
  return parsed.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', ...(d && !d.includes('?') ? { day: 'numeric' } : {}) })
}

export function playersOf(r: { white: string | null; black: string | null }): string {
  if (!r.white && !r.black) return 'Unnamed game'
  return `${r.white ?? 'Unknown'} vs ${r.black ?? 'Unknown'}`
}

/** A percentage such as "86%", or a dash when there is no value. */
export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–'
  return `${n.toFixed(digits)}%`
}

/** 4.5 -> "4½" */
export function points(n: number): string {
  const whole = Math.floor(n)
  return n - whole >= 0.5 ? `${whole || ''}½` : String(whole)
}
