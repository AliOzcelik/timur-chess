import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import type { Eval } from '../lib/evals'

export interface EngineLine {
  multipv: number
  eval: Eval
  depth: number | null
  uci: string[]
  san: string[]
}

export interface EngineInfo {
  id: number
  fen: string
  threat: boolean
  depth?: number
  seldepth?: number
  nodes?: number
  nps?: number
  time?: number
  lines: EngineLine[]
  terminal?: Eval
}

interface EngineState {
  connected: boolean
  requestId: number | null
  info: EngineInfo | null
  done: boolean
  error: string | null
}

export const useEngine = create<EngineState>(() => ({
  connected: false,
  requestId: null,
  info: null,
  done: false,
  error: null,
}))

export interface AnalyzeRequest {
  fen: string
  moves: string[]
  multipv: number
  depth: number | null
  threat: boolean
}

type Listener = (msg: { type: string; [k: string]: unknown }) => void

/** One WebSocket to the Python server, reconnecting automatically. */
export class EngineClient {
  private ws: WebSocket | null = null
  private seq = 0
  private active: Record<string, unknown> | null = null
  private retry = 0
  private listeners = new Set<Listener>()

  connect(): void {
    if (this.ws) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/api/engine/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      useEngine.setState({ connected: true })
      // After a reconnect (e.g. the server restarted) resume the current analysis.
      if (this.active) ws.send(JSON.stringify(this.active))
    }
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data))
      } catch {
        /* ignore malformed messages */
      }
    }
    ws.onclose = () => {
      this.ws = null
      useEngine.setState({ connected: false })
      const delay = Math.min(5000, 400 * 2 ** this.retry++)
      window.setTimeout(() => this.connect(), delay)
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private send(msg: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  analyze(req: AnalyzeRequest): number {
    const id = ++this.seq
    this.active = { type: 'analyze', id, ...req }
    useEngine.setState({ requestId: id, info: null, done: false, error: null })
    this.send(this.active)
    return id
  }

  stop(): void {
    if (this.active) this.send({ type: 'stop' })
    this.active = null
    useEngine.setState({ requestId: null, info: null, done: false, error: null })
  }

  private onMessage(msg: { type: string; id?: number; message?: string; [k: string]: unknown }): void {
    const { requestId } = useEngine.getState()
    if (msg.type === 'info' && msg.id === requestId) {
      useEngine.setState({ info: msg as unknown as EngineInfo })
    } else if (msg.type === 'done' && msg.id === requestId) {
      useEngine.setState({ done: true })
      this.active = null
    } else if (msg.type === 'error' && (msg.id === undefined || msg.id === requestId)) {
      useEngine.setState({ error: msg.message ?? 'Engine error', done: true })
      this.active = null
    }
    this.listeners.forEach((fn) => fn(msg))
  }
}

export const engineClient = new EngineClient()

/**
 * Keep the live engine analyzing the given position while `enabled`.
 * Pauses while the browser tab is hidden, to save battery.
 */
export function useLiveAnalysis(req: AnalyzeRequest & { enabled: boolean }): void {
  const ref = useRef(req)
  ref.current = req
  const key = JSON.stringify(req)

  useEffect(() => {
    if (!req.enabled) {
      engineClient.stop()
      return
    }
    const timer = window.setTimeout(() => {
      if (!document.hidden) {
        const { enabled: _enabled, ...rest } = ref.current
        engineClient.analyze(rest)
      }
    }, 70)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) engineClient.stop()
      else if (ref.current.enabled) {
        const { enabled: _enabled, ...rest } = ref.current
        engineClient.analyze(rest)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      engineClient.stop()
    }
  }, [])
}
