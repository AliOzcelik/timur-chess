import type { Accent, BoardPalette, Theme } from '../lib/api'
import { loadJson, saveJson } from '../lib/storage'

const KEY = 'timur.theme.v1'
const APPEARANCE_KEY = 'timur.appearance.v1'

export interface Appearance {
  theme: Theme
  accent: Accent
  board: BoardPalette
}

/** 'system' follows macOS; 'dark' and 'light' override it. Remembered locally so the page doesn't flash. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  saveJson(KEY, theme)
}

/** Theme, accent (the UI's attention colour) and board palette, applied as attributes on <html>. */
export function applyAppearance(a: Partial<Appearance>): void {
  const current = loadAppearance()
  const next: Appearance = { ...current, ...Object.fromEntries(Object.entries(a).filter(([, v]) => v)) } as Appearance
  applyTheme(next.theme)
  const root = document.documentElement
  if (next.accent === 'brass') root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', next.accent)
  if (next.board === 'walnut') root.removeAttribute('data-board')
  else root.setAttribute('data-board', next.board)
  saveJson(APPEARANCE_KEY, { accent: next.accent, board: next.board })
}

export function loadAppearance(): Appearance {
  const saved = loadJson<Partial<Appearance>>(APPEARANCE_KEY, {})
  return { theme: loadJson<Theme>(KEY, 'system'), accent: saved.accent ?? 'brass', board: saved.board ?? 'walnut' }
}

export function applySavedTheme(): void {
  applyAppearance(loadAppearance())
}
