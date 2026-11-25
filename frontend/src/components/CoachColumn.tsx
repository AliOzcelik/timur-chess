import { useEffect, useState } from 'react'
import { api, type LlmStatus } from '../lib/api'
import { useCoachChat } from '../state/coachChat'
import { CoachChat } from './CoachChat'
import { Icon } from './Icon'

/** One line on whether the local model can answer: its name, or what is wrong. */
function statusLine(status: LlmStatus | null | undefined): { text: string; ok: boolean } {
  if (status === undefined) return { text: 'Checking the model…', ok: true }
  if (status === null) return { text: 'Server offline', ok: false }
  if (!status.enabled) return { text: 'Turned off in Settings', ok: false }
  if (!status.reachable) return { text: 'Ollama is not running', ok: false }
  if (!status.installed) return { text: `${status.model} not installed`, ok: false }
  return { text: status.model, ok: true }
}

/** The AI coach's own column, right of the engine and moves. Folds to a slim rail. */
export function CoachColumn({ collapsed, onToggle, fen, moves, label }: {
  collapsed: boolean
  onToggle: () => void
  fen: string
  moves: string[]
  label: string
}) {
  const [status, setStatus] = useState<LlmStatus | null | undefined>(undefined)
  const count = useCoachChat((s) => s.messages.filter((m) => m.role === 'user').length)
  const busy = useCoachChat((s) => s.busy)

  useEffect(() => {
    let live = true
    api.llmStatus().then((s) => { if (live) setStatus(s) }, () => { if (live) setStatus(null) })
    return () => { live = false }
  }, [])

  const line = statusLine(status)

  if (collapsed) {
    return (
      <aside className="coach-col coach-rail" aria-label="AI coach">
        <button type="button" className="icon-btn coach-rail-open" onClick={onToggle} title="Show the AI coach" aria-label="Show the AI coach" aria-expanded={false}>
          <Icon name="spark" />
        </button>
        <span className="coach-rail-label">AI coach</span>
        {(count > 0 || busy) && <span className={`saved-count ${busy ? 'busy' : ''}`}>{busy ? '…' : count}</span>}
      </aside>
    )
  }

  return (
    <aside className="coach-col card" aria-label="AI coach">
      <div className="card-head coach-head">
        <Icon name="spark" size={16} className="coach-mark" />
        <h2>AI coach</h2>
        <span className={`coach-model ${line.ok ? '' : 'off'}`} title={status?.error ?? line.text}>
          <span className="dot" aria-hidden="true" />{line.text}
        </span>
        <button type="button" className="icon-btn" onClick={onToggle} title="Fold the AI coach" aria-label="Hide the AI coach" aria-expanded>
          <Icon name="next" size={15} />
        </button>
      </div>
      <CoachChat fen={fen} moves={moves} label={label} />
    </aside>
  )
}
