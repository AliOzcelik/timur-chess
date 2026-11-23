import type { Theme } from '../lib/api'
import { loadJson, saveJson } from '../lib/storage'

const KEY = 'timur.theme.v1'

/** 'system' follows macOS; 'dark' and 'light' override it. Remembered locally so the page doesn't flash. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  saveJson(KEY, theme)
}

export function applySavedTheme(): void {
  applyTheme(loadJson<Theme>(KEY, 'system'))
}
