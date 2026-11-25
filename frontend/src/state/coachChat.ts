import { create } from 'zustand'
import { streamCoachChat, type ChatTurn } from '../lib/api'

export interface CoachMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  /** The position the question was asked about, e.g. "9. Nb3" or "Start". */
  at?: string
  status?: string
  facts?: Record<string, unknown>
  unverified?: string[]
  error?: string
  pending?: boolean
}

interface CoachChatState {
  messages: CoachMessage[]
  busy: boolean
  ask: (question: string, position: { fen: string; moves: string[]; label: string }) => Promise<void>
  stop: () => void
  clear: () => void
}

let nextId = 1
let controller: AbortController | null = null

/** The chat with the AI coach on the analysis board. Kept while you switch pages. */
export const useCoachChat = create<CoachChatState>((set, get) => {
  const patch = (id: number, change: Partial<CoachMessage> | ((m: CoachMessage) => Partial<CoachMessage>)) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, ...(typeof change === 'function' ? change(m) : change) } : m)),
    }))

  return {
    messages: [],
    busy: false,

    ask: async (question, position) => {
      const text = question.trim()
      if (!text || get().busy) return
      const history: ChatTurn[] = get().messages
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }))
      const user: CoachMessage = { id: nextId++, role: 'user', content: text, at: position.label }
      const reply: CoachMessage = { id: nextId++, role: 'assistant', content: '', pending: true, status: 'Starting…' }
      set((s) => ({ messages: [...s.messages, user, reply], busy: true }))
      controller = new AbortController()
      try {
        await streamCoachChat(
          { fen: position.fen, moves: position.moves, messages: [...history, { role: 'user', content: text }] },
          (e) => {
            if (e.type === 'status') patch(reply.id, { status: e.text })
            else if (e.type === 'facts') patch(reply.id, { facts: e.facts, status: 'Writing…' })
            else if (e.type === 'delta') patch(reply.id, (m) => ({ content: m.content + e.text, status: undefined }))
            else if (e.type === 'done') patch(reply.id, { unverified: e.unverified, pending: false, status: undefined })
            else if (e.type === 'error') patch(reply.id, { error: e.message, pending: false, status: undefined })
          },
          controller.signal,
        )
        patch(reply.id, { pending: false, status: undefined })
      } catch (e) {
        const stopped = (e as Error).name === 'AbortError'
        patch(reply.id, (m) => ({
          pending: false,
          status: undefined,
          error: stopped ? (m.content ? undefined : 'Stopped.') : (e as Error).message,
        }))
      } finally {
        controller = null
        set({ busy: false })
      }
    },

    stop: () => controller?.abort(),

    clear: () => {
      controller?.abort()
      set({ messages: [] })
    },
  }
})
