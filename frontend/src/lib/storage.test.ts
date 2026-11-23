import { describe, expect, it, vi } from 'vitest'
import { loadJson, saveJson } from './storage'

describe('storage', () => {
  it('saves and loads JSON', () => {
    saveJson('k', { a: 1 })
    expect(loadJson('k', null)).toEqual({ a: 1 })
  })

  it('falls back when nothing is stored or the data is broken', () => {
    expect(loadJson('missing', 'fallback')).toBe('fallback')
    window.localStorage.setItem('bad', '{not json')
    expect(loadJson('bad', 42)).toBe(42)
  })

  it('works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => saveJson('k', 1)).not.toThrow()
    expect(loadJson('k', 'fallback')).toBe('fallback')
  })
})
