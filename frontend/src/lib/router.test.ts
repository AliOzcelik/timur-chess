import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { navigate, useRoute } from './router'

describe('router', () => {
  it('navigate writes the hash, with or without a leading slash', () => {
    navigate('/review/3')
    expect(window.location.hash).toBe('#/review/3')
    navigate('analysis')
    expect(window.location.hash).toBe('#/analysis')
  })

  it('useRoute splits the hash and follows changes', async () => {
    window.location.hash = '#/review/7?tab=moves'
    const { result } = renderHook(() => useRoute())
    expect(result.current).toEqual(['review', '7'])

    await act(async () => {
      window.location.hash = '#/analysis'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current).toEqual(['analysis'])
  })

  it('an empty hash is an empty route', () => {
    const { result } = renderHook(() => useRoute())
    expect(result.current).toEqual([])
  })
})
