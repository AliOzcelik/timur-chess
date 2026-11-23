import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineClient, engineClient, useEngine, useLiveAnalysis, type AnalyzeRequest } from './engine'

class FakeSocket {
  static OPEN = 1
  static all: FakeSocket[] = []
  readyState = 0
  sent: Record<string, unknown>[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: typeof msg === 'string' ? msg : JSON.stringify(msg) })
  }
  drop() {
    this.readyState = 3
    this.onclose?.()
  }
}

const REQ: AnalyzeRequest = { fen: 'start-fen', moves: ['e2e4'], multipv: 2, depth: 20, threat: false }
const latest = () => FakeSocket.all[FakeSocket.all.length - 1]

beforeEach(() => {
  FakeSocket.all = []
  vi.stubGlobal('WebSocket', FakeSocket)
  useEngine.setState({ connected: false, requestId: null, info: null, done: false, error: null })
})

describe('EngineClient', () => {
  it('connects once to the engine socket', () => {
    const client = new EngineClient()
    client.connect()
    client.connect()
    expect(FakeSocket.all).toHaveLength(1)
    expect(latest().url).toBe('ws://localhost:3000/api/engine/ws')
    latest().open()
    expect(useEngine.getState().connected).toBe(true)
  })

  it('sends analysis requests with increasing ids', () => {
    const client = new EngineClient()
    client.connect()
    latest().open()
    expect(client.analyze(REQ)).toBe(1)
    expect(client.analyze({ ...REQ, multipv: 1 })).toBe(2)
    expect(latest().sent).toEqual([
      { type: 'analyze', id: 1, ...REQ },
      { type: 'analyze', id: 2, ...REQ, multipv: 1 },
    ])
    expect(useEngine.getState()).toMatchObject({ requestId: 2, info: null, done: false, error: null })
  })

  it('a request made before the socket opens is sent when it opens', () => {
    const client = new EngineClient()
    client.connect()
    client.analyze(REQ)
    expect(latest().sent).toEqual([])
    latest().open()
    expect(latest().sent).toEqual([{ type: 'analyze', id: 1, ...REQ }])
  })

  it('keeps only answers to the current request', () => {
    const client = new EngineClient()
    client.connect()
    latest().open()
    client.analyze(REQ)
    client.analyze(REQ)
    latest().receive({ type: 'info', id: 1, fen: 'old', lines: [] })
    expect(useEngine.getState().info).toBeNull()
    latest().receive({ type: 'info', id: 2, fen: 'new', lines: [] })
    expect(useEngine.getState().info?.fen).toBe('new')
    latest().receive({ type: 'done', id: 1 })
    expect(useEngine.getState().done).toBe(false)
    latest().receive({ type: 'done', id: 2 })
    expect(useEngine.getState().done).toBe(true)
  })

  it('shows engine errors', () => {
    const client = new EngineClient()
    client.connect()
    latest().open()
    client.analyze(REQ)
    latest().receive({ type: 'error', id: 1, message: 'This position is not legal.' })
    expect(useEngine.getState()).toMatchObject({ error: 'This position is not legal.', done: true })
  })

  it('ignores broken messages and tells listeners about the rest', () => {
    const client = new EngineClient()
    const listener = vi.fn()
    const unsubscribe = client.subscribe(listener)
    client.connect()
    latest().open()
    latest().receive('not json')
    latest().receive({ type: 'hello' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ type: 'hello' })
    unsubscribe()
    latest().receive({ type: 'pong' })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('stop tells the server and clears the state', () => {
    const client = new EngineClient()
    client.connect()
    latest().open()
    client.analyze(REQ)
    client.stop()
    expect(latest().sent[1]).toEqual({ type: 'stop' })
    expect(useEngine.getState()).toMatchObject({ requestId: null, info: null })
    client.stop() // nothing running: nothing sent
    expect(latest().sent).toHaveLength(2)
  })

  it('reconnects after the server goes away and resumes the analysis', () => {
    vi.useFakeTimers()
    const client = new EngineClient()
    client.connect()
    latest().open()
    client.analyze(REQ)
    latest().drop()
    expect(useEngine.getState().connected).toBe(false)

    vi.advanceTimersByTime(399)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)

    latest().open()
    expect(useEngine.getState().connected).toBe(true)
    expect(latest().sent).toEqual([{ type: 'analyze', id: 1, ...REQ }])
  })

  it('waits longer after each failed reconnect, up to 5 seconds', () => {
    vi.useFakeTimers()
    const client = new EngineClient()
    client.connect()
    latest().drop() // retry 0 -> 400 ms
    vi.advanceTimersByTime(400)
    latest().drop() // retry 1 -> 800 ms
    vi.advanceTimersByTime(799)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
    for (let i = 0; i < 6; i++) {
      latest().drop()
      vi.advanceTimersByTime(5000)
    }
    expect(FakeSocket.all).toHaveLength(9)
  })
})

describe('useLiveAnalysis', () => {
  it('asks for analysis after a short pause and only for the latest position', () => {
    vi.useFakeTimers()
    const analyze = vi.spyOn(engineClient, 'analyze').mockReturnValue(1)
    vi.spyOn(engineClient, 'stop').mockImplementation(() => {})
    const { rerender } = renderHook((req) => useLiveAnalysis(req), { initialProps: { ...REQ, enabled: true } })
    rerender({ ...REQ, moves: ['e2e4', 'e7e5'], enabled: true })
    expect(analyze).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(70) })
    expect(analyze).toHaveBeenCalledOnce()
    expect(analyze).toHaveBeenCalledWith({ ...REQ, moves: ['e2e4', 'e7e5'] })
  })

  it('stops when switched off and when the page closes', () => {
    vi.useFakeTimers()
    vi.spyOn(engineClient, 'analyze').mockReturnValue(1)
    const stop = vi.spyOn(engineClient, 'stop').mockImplementation(() => {})
    const { rerender, unmount } = renderHook((req) => useLiveAnalysis(req), { initialProps: { ...REQ, enabled: true } })
    rerender({ ...REQ, enabled: false })
    expect(stop).toHaveBeenCalledTimes(1)
    unmount()
    expect(stop).toHaveBeenCalledTimes(2)
  })

  it('pauses while the tab is hidden', () => {
    vi.useFakeTimers()
    const analyze = vi.spyOn(engineClient, 'analyze').mockReturnValue(1)
    const stop = vi.spyOn(engineClient, 'stop').mockImplementation(() => {})
    renderHook(() => useLiveAnalysis({ ...REQ, enabled: true }))
    act(() => { vi.advanceTimersByTime(70) })
    expect(analyze).toHaveBeenCalledTimes(1)

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(stop).toHaveBeenCalledTimes(1)

    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(analyze).toHaveBeenCalledTimes(2)
  })
})
