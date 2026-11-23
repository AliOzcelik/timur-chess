import { useState } from 'react'
import { Icon } from '../components/Icon'
import { Masthead, Meta } from '../components/Masthead'
import { MiniBoard } from '../components/MiniBoard'
import { useLoad } from '../hooks/useLoad'
import { api, type LessonSummary, type TrainingState } from '../lib/api'
import { navigate } from '../lib/router'

export function progressLabel(p: TrainingState | null): { text: string; cls: string } {
  if (!p) return { text: 'Not started', cls: 'next' }
  if (p.mastered) return { text: 'Mastered', cls: 'mastered' }
  if (p.due) return { text: p.last_result === 'again' ? 'Try again' : 'Due today', cls: 'due' }
  return { text: `Next ${inDays(p.due_at)}`, cls: 'next' }
}

function inDays(iso: string): string {
  const days = Math.max(1, Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000))
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

export const LEVEL = ['', 'Basic', 'Intermediate', 'Advanced']

/** Five dots: how far along the spaced-repetition ladder a lesson is. */
export function StreakDots({ p }: { p: TrainingState | null }) {
  const filled = p ? (p.mastered ? 5 : Math.min(4, p.successes)) : 0
  return (
    <span className="sdots" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => <i key={i} className={i < filled ? 'f' : undefined} />)}
    </span>
  )
}

function LessonCard({ l }: { l: LessonSummary }) {
  const prog = progressLabel(l.progress)
  return (
    <li>
      <a className="lesson" href={`#/endgames/${encodeURIComponent(l.id)}`}>
        <span className="lesson-top">
          <span className="mini">
            <MiniBoard fen={l.fen} orientation={l.side} label={`Starting position of ${l.title}`} />
            <span className={`goal ${l.goal}`}>{l.goal === 'win' ? 'Win' : 'Draw'}</span>
            {l.progress?.mastered && <span className="ribbon"><Icon name="check" size={9} />Mastered</span>}
          </span>
        </span>
        <span className="lesson-body">
          <span className="lesson-title">{l.title}</span>
          <span className="lesson-meta">
            <span>{l.side === 'white' ? 'White' : 'Black'} to {l.goal}</span>
            {l.level > 0 && l.level < LEVEL.length && <><span aria-hidden="true">·</span><span>{LEVEL[l.level]}</span></>}
          </span>
          <span className="lesson-status">
            <StreakDots p={l.progress} />
            <span className={prog.cls}>{prog.cls === 'due' && <span className="d" aria-hidden="true" />}{prog.text}</span>
          </span>
        </span>
      </a>
    </li>
  )
}

/** The lesson to open when the user presses Start: the first one due, else the first not mastered. */
export function nextLesson(lessons: LessonSummary[]): LessonSummary | null {
  return lessons.find((l) => l.progress?.due) ?? lessons.find((l) => !l.progress) ?? lessons.find((l) => !l.progress?.mastered) ?? null
}

export function EndgamesPage() {
  const { data, error } = useLoad(() => api.endgames(), [])
  const [howOpen, setHowOpen] = useState(false)
  const lessons = data?.lessons ?? []
  const due = lessons.filter((l) => l.progress?.due).length
  const practised = lessons.filter((l) => l.progress && l.progress.successes > 0).length
  const mastered = lessons.filter((l) => l.progress?.mastered).length
  const start = nextLesson(lessons)
  const upcoming = lessons
    .filter((l) => l.progress && !l.progress.due && !l.progress.mastered)
    .sort((a, b) => a.progress!.due_at.localeCompare(b.progress!.due_at))[0]
  const pctMastered = lessons.length ? Math.round((mastered / lessons.length) * 100) : 0

  return (
    <div className="page endgames-page">
      <Masthead
        section="Train"
        page="Endgames"
        title="Endgames"
        sub={<Meta items={[
          data && `${lessons.length} positions judged ${data.tablebases.available ? 'exactly by the Syzygy tablebases' : 'by Stockfish'}`,
          'Spaced repetition after 1, 3 and 7 days',
        ]} />}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setHowOpen((o) => !o)} aria-expanded={howOpen}>
            <Icon name="info" />How it works
          </button>
        }
      />
      {error && <p className="form-error" role="alert">{error}</p>}
      {howOpen && (
        <p className="notice-bar how-it-works">
          Play each key endgame against a perfect defender. With 5 pieces or fewer the Syzygy tablebases know the exact result of every move,
          so a slip is caught at once. A lesson you solve comes back after 1 day, then 3, then 7, and less often after that.
        </p>
      )}
      {data && !data.tablebases.available && (
        <p className="notice-bar">
          The tablebases are not installed, so Stockfish judges the moves instead. For exact answers, run <code>./scripts/get-tablebases.sh</code> (about 1 GB) and restart Timur.
        </p>
      )}

      {data && lessons.length > 0 && (
        <div className="hero">
          <div className="ring" style={{ '--p': pctMastered } as React.CSSProperties} role="img" aria-label={`${mastered} of ${lessons.length} mastered`}>
            <span className="n">{mastered}<small>of {lessons.length}</small></span>
          </div>
          <div className="hero-main">
            <p className="eyebrow">Today’s study {due > 0 && <><span className="sep">/</span><span className="quiet">{due} due</span></>}</p>
            <h2>Endgame syllabus</h2>
            <p>
              {upcoming
                ? <>Next review · <span className="hl">{upcoming.title}</span>, {inDays(upcoming.progress!.due_at)}.</>
                : practised === 0 ? 'Start with the basic mates. Each lesson takes a few minutes.' : 'Nothing waiting after today’s lessons.'}
            </p>
          </div>
          <div className="hero-metrics">
            <div className="hero-metric"><span className="v brass">{due}</span><span className="l">Due today</span></div>
            <div className="hero-metric"><span className="v">{practised}</span><span className="l">Practised</span></div>
            <div className="hero-metric"><span className="v">{mastered}</span><span className="l">Mastered</span></div>
          </div>
          {start && (
            <button type="button" className="btn btn-primary" onClick={() => navigate(`/endgames/${encodeURIComponent(start.id)}`)}>
              <Icon name="play" />{due > 0 ? 'Start session' : practised ? 'Keep going' : 'Start'}
            </button>
          )}
        </div>
      )}

      {data?.categories.map((cat) => {
        const items = lessons.filter((l) => l.category === cat)
        if (cat === 'From your games' && items.length === 0) {
          return (
            <section key={cat} className="lesson-group">
              <div className="group-head"><h2>From your games</h2><span className="group-rule" aria-hidden="true" /></div>
              <p className="empty">Endgames where you went wrong show up here after you review your games. You can then replay them against the engine.</p>
            </section>
          )
        }
        if (!items.length) return null
        return (
          <section key={cat} className="lesson-group">
            <div className="group-head">
              <h2>{cat}</h2>
              <span className="count">{items.filter((l) => l.progress?.mastered).length} of {items.length} mastered</span>
              <span className="group-rule" aria-hidden="true" />
              <span className="count">{items.length} lesson{items.length === 1 ? '' : 's'}</span>
            </div>
            <ul className="lesson-grid">{items.map((l) => <LessonCard key={l.id} l={l} />)}</ul>
          </section>
        )
      })}
    </div>
  )
}
