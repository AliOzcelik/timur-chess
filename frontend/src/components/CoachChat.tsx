import { useEffect, useRef, useState } from 'react'
import { useCoachChat, type CoachMessage } from '../state/coachChat'
import { Icon } from './Icon'

const SUGGESTIONS = [
  "What's the plan here?",
  'What does my opponent threaten?',
  'Why is the best move best?',
  'Is there a tactic here?',
]

/** Facts are nested JSON; show them as short readable lines. */
function factText(v: unknown): string {
  if (v === null || v === undefined) return '–'
  if (Array.isArray(v)) return v.map(factText).join('; ')
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).map(factText).join(' · ')
  return String(v)
}

function Facts({ facts }: { facts: Record<string, unknown> }) {
  return (
    <details className="coach-facts">
      <summary>Facts from Stockfish and the board</summary>
      <dl>
        {Object.entries(facts).map(([k, v]) => (
          <div key={k} className="fact-row">
            <dt>{k.replace(/_/g, ' ')}</dt>
            <dd>{factText(v)}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}

function Message({ m }: { m: CoachMessage }) {
  if (m.role === 'user') {
    return (
      <li className="chat-msg chat-user">
        {m.at && <span className="chat-at">at {m.at}</span>}
        <p>{m.content}</p>
      </li>
    )
  }
  return (
    <li className="chat-msg chat-coach" aria-busy={m.pending}>
      {m.status && <p className="chat-status"><span className="chat-dots" aria-hidden="true" />{m.status}</p>}
      {m.content && <p className="chat-text">{m.content}</p>}
      {m.error && <p className="coach-error" role="alert">{m.error}</p>}
      {m.unverified && m.unverified.length > 0 && (
        <p className="chat-warn"><Icon name="info" size={13} /> Not checked by Stockfish: {[...new Set(m.unverified)].join(', ')}. Treat these with care.</p>
      )}
      {m.facts && !m.pending && <Facts facts={m.facts} />}
    </li>
  )
}

/** Chat with the local AI coach about the position on the board. */
export function CoachChat({ fen, moves, label }: { fen: string; moves: string[]; label: string }) {
  const { messages, busy, ask, stop, clear } = useCoachChat()
  const [text, setText] = useState('')
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const send = (q: string) => {
    if (!q.trim() || busy) return
    ask(q, { fen, moves, label })
    setText('')
  }

  return (
    <div className="coach-chat">
      {messages.length === 0 ? (
        <div className="chat-empty">
          <p>
            Ask about the position on the board. Each question first goes to Stockfish and the board checks; the local model only puts their answers into words.
          </p>
          <div className="chat-suggest">
            {SUGGESTIONS.map((q) => (
              <button key={q} type="button" className="chip" onClick={() => send(q)}>{q}</button>
            ))}
          </div>
          <p className="dim small">Name a move to have it checked, e.g. “What about Nxe5?”</p>
        </div>
      ) : (
        <ol className="chat-list" ref={listRef} aria-live="polite">
          {messages.map((m) => <Message key={m.id} m={m} />)}
        </ol>
      )}
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(text) }}>
        <textarea
          className="input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(text)
            }
          }}
          placeholder={`Ask about the position at ${label}…`}
          aria-label="Question for the coach"
        />
        <div className="chat-actions">
          {messages.length > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={clear}><Icon name="trash" size={14} />Clear</button>
          )}
          <span className="spacer" />
          {busy ? (
            <button type="button" className="btn btn-sm" onClick={stop}><Icon name="close" size={14} />Stop</button>
          ) : (
            <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}><Icon name="spark" size={14} />Ask</button>
          )}
        </div>
      </form>
    </div>
  )
}
