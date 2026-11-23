import { MiniBoard } from '../components/MiniBoard'
import { useLoad } from '../hooks/useLoad'
import { api, type LessonSummary, type TrainingState } from '../lib/api'

export function progressLabel(p: TrainingState | null): { text: string; cls: string } {
  if (!p) return { text: 'New', cls: 'prog-new' }
  if (p.mastered) return { text: 'Mastered', cls: 'prog-mastered' }
  if (p.due) return { text: p.last_result === 'again' ? 'Try again' : 'Due today', cls: 'prog-due' }
  const days = Math.max(1, Math.round((new Date(p.due_at).getTime() - Date.now()) / 86_400_000))
  return { text: `Next in ${days} day${days === 1 ? '' : 's'}`, cls: 'prog-learned' }
}

const LEVEL = ['', 'Basic', 'Intermediate', 'Advanced']

function LessonCard({ l }: { l: LessonSummary }) {
  const prog = progressLabel(l.progress)
  return (
    <li>
      <a className="lesson-card" href={`#/endgames/${encodeURIComponent(l.id)}`}>
        <MiniBoard fen={l.fen} orientation={l.side} label={`Starting position of ${l.title}`} />
        <span className="lesson-body">
          <span className="lesson-title">{l.title}</span>
          <span className="lesson-meta">
            <span>{l.side === 'white' ? 'White' : 'Black'} to {l.goal === 'win' ? 'win' : 'draw'}</span>
            {l.level > 0 && l.level < LEVEL.length && <span>{LEVEL[l.level]}</span>}
          </span>
          <span className={`prog ${prog.cls}`}>{prog.text}</span>
        </span>
      </a>
    </li>
  )
}

export function EndgamesPage() {
  const { data, error } = useLoad(() => api.endgames(), [])
  const lessons = data?.lessons ?? []
  const due = lessons.filter((l) => l.progress?.due).length
  const done = lessons.filter((l) => l.progress && l.progress.successes > 0).length

  return (
    <div className="page endgames-page">
      <header className="page-head">
        <h1>Endgames</h1>
        <p className="page-sub">
          Play the key endgames against a perfect defender. With 5 pieces or fewer, the Syzygy tablebases know the exact result of every move.
        </p>
      </header>
      {error && <p className="form-error" role="alert">{error}</p>}
      {data && !data.tablebases.available && (
        <p className="notice-bar">
          The tablebases are not installed, so Stockfish judges the moves instead. For exact answers, run <code>./scripts/get-tablebases.sh</code> (about 1 GB) and restart Timur.
        </p>
      )}
      {data && (
        <p className="muted endgame-summary">
          {done} of {lessons.length} practised{due ? `, ${due} due today` : ''}. A lesson you solve comes back after 1 day, then 3, then less and less often.
        </p>
      )}
      {data?.categories.map((cat) => {
        const items = lessons.filter((l) => l.category === cat)
        if (cat === 'From your games' && items.length === 0) {
          return (
            <section key={cat} className="lesson-group">
              <h2>From your games</h2>
              <p className="empty">Endgames where you went wrong show up here after you review your games. You can then replay them against the engine.</p>
            </section>
          )
        }
        if (!items.length) return null
        return (
          <section key={cat} className="lesson-group">
            <h2>{cat}</h2>
            <ul className="lesson-grid">{items.map((l) => <LessonCard key={l.id} l={l} />)}</ul>
          </section>
        )
      })}
    </div>
  )
}
