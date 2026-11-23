import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { Icon } from '../components/Icon'
import { useLoad } from '../hooks/useLoad'
import { api, type Lesson, type MoveVerdict } from '../lib/api'
import { playUci, turnOf, uciSquares } from '../lib/chess'
import { openPositionOnBoard } from '../lib/open'
import { progressLabel } from './EndgamesPage'

interface Ply {
  uci: string
  san: string
  fen: string
}

const GOAL_TEXT: Record<string, string> = {
  mate: 'Deliver checkmate.',
  promote: 'Promote the pawn and keep the win.',
  capture: 'Win all the opponent’s pawns and keep the win.',
}

function goalText(l: Lesson): string {
  if (l.success.type === 'hold') {
    return `${l.goal === 'win' ? 'Keep the win' : 'Hold the draw'} for ${l.success.moves ?? 10} moves.`
  }
  return GOAL_TEXT[l.success.type]
}

function Drill({ lesson, nextId }: { lesson: Lesson; nextId: string | null }) {
  const [plies, setPlies] = useState<Ply[]>([])
  const [thinking, setThinking] = useState(false)
  const [verdict, setVerdict] = useState<MoveVerdict | null>(null)
  const [hint, setHint] = useState<{ san: string; uci: string; line: string[]; source: string } | null>(null)
  const [hints, setHints] = useState(0)
  const [failed, setFailed] = useState(false)
  const [recorded, setRecorded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showIdea, setShowIdea] = useState(true)
  const attempt = useRef(0)

  const fen = plies.length ? plies[plies.length - 1].fen : lesson.fen
  const finished = Boolean(verdict?.finished)
  const yourTurn = turnOf(fen) === lesson.side && !thinking && !finished
  const last = plies[plies.length - 1]

  const record = async (outcome: 'good' | 'hard' | 'again') => {
    try {
      await api.trainingResult(lesson.item_id, 'endgame', outcome)
      setRecorded(outcome)
    } catch {
      /* progress is a nice-to-have */
    }
  }

  const restart = () => {
    attempt.current += 1
    setPlies([])
    setVerdict(null)
    setHint(null)
    setError(null)
    setRecorded(null)
  }

  const takeBack = () => {
    attempt.current += 1
    // After a wrong move only that move goes; otherwise your move and the reply.
    setPlies((p) => {
      const lastIsMine = p.length > 0 && turnOf(p[p.length - 1].fen) !== lesson.side
      return p.slice(0, lastIsMine ? -1 : -2)
    })
    setVerdict(null)
    setHint(null)
  }

  const play = async (uci: string) => {
    const played = playUci(fen, uci)
    if (!played) return
    const next = [...plies, { uci: played.uci, san: played.san, fen: played.fen }]
    setPlies(next)
    setHint(null)
    setVerdict(null)
    setThinking(true)
    setError(null)
    const mine = attempt.current
    try {
      const v = await api.endgameMove({ fen: lesson.fen, moves: next.map((p) => p.uci), goal: lesson.goal, success: lesson.success })
      if (mine !== attempt.current) return
      setVerdict(v)
      if (v.reply) {
        const r = playUci(played.fen, v.reply.uci)
        if (r) setPlies([...next, { uci: r.uci, san: r.san, fen: r.fen }])
      }
      if (v.finished && v.success) record(failed || hints > 0 ? 'hard' : 'good')
      if (v.finished && !v.success) {
        if (!failed) record('again')
        setFailed(true)
      }
    } catch (e) {
      if (mine !== attempt.current) return
      setError((e as Error).message)
      setPlies(plies)
    } finally {
      if (mine === attempt.current) setThinking(false)
    }
  }

  const askHint = async () => {
    try {
      const h = await api.endgameHint(lesson.fen, plies.map((p) => p.uci))
      setHint({ san: h.best.san, uci: h.best.uci, line: h.best.line, source: h.source })
      setHints((n) => n + 1)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const shapes = useMemo<DrawShape[]>(() => {
    const sh: DrawShape[] = []
    const best = verdict && !verdict.ok ? verdict.best : hint
    const sq = uciSquares(best?.uci)
    if (sq) sh.push({ orig: sq[0], dest: sq[1], brush: verdict && !verdict.ok ? 'green' : 'yellow' })
    return sh
  }, [verdict, hint])

  // After a wrong move, show the position before it with the right move.
  const shownFen = verdict && !verdict.ok && plies.length ? (plies.length > 1 ? plies[plies.length - 2].fen : lesson.fen) : fen
  const shownLast = verdict && !verdict.ok ? plies[plies.length - 2] : last

  const myMoves = Math.ceil(plies.length / 2)
  const prog = progressLabel(lesson.progress)

  return (
    <div className="analysis-layout drill-layout">
      <section className="board-column" aria-label="Board">
        <div className="board-area no-bar">
          <Board
            fen={shownFen}
            orientation={lesson.side}
            lastMove={uciSquares(shownLast?.uci) as [Key, Key] | undefined}
            movable={yourTurn ? 'turn' : null}
            shapes={shapes}
            onMove={play}
          />
        </div>
        <div className="board-toolbar" role="toolbar" aria-label="Lesson actions">
          <button type="button" className="tool" onClick={askHint} disabled={!yourTurn}><Icon name="bulb" /> <span>Hint</span></button>
          <button type="button" className="tool" onClick={takeBack} disabled={thinking || plies.length === 0 || (finished && Boolean(verdict?.success))}>
            <Icon name="prev" /> <span>Take back</span>
          </button>
          <button type="button" className="tool" onClick={restart} disabled={thinking}><Icon name="retry" /> <span>Restart</span></button>
          <button type="button" className="tool" onClick={() => openPositionOnBoard(fen, lesson.side)}><Icon name="board" /> <span>Analyse this position</span></button>
        </div>
      </section>

      <aside className="side-panel drill-panel" aria-label="Lesson">
        <section className="panel">
          <div className="row-between">
            <span className="goal-badge">{lesson.side === 'white' ? 'White' : 'Black'} to {lesson.goal}</span>
            <span className={`prog ${prog.cls}`}>{prog.text}</span>
          </div>
          <p className="drill-goal"><strong>Goal:</strong> {goalText(lesson)}</p>
          <p className="muted small">
            {lesson.exact ? 'The tablebase judges every move exactly.' : 'Stockfish judges the moves in this position.'}
            {lesson.success.type === 'hold' && plies.length > 0 && !finished && ` Move ${myMoves} of ${lesson.success.moves ?? 10}.`}
          </p>

          <div className="drill-status" role="status" aria-live="polite">
            {thinking && <p className="muted">Checking your move…</p>}
            {!thinking && !verdict && !error && plies.length === 0 && <p>Your move.</p>}
            {!thinking && verdict && !verdict.finished && <p>{verdict.reply ? `${verdict.reply.san}. ` : ''}{verdict.message}</p>}
            {verdict?.finished && verdict.success && (
              <div className="drill-result drill-good">
                <p><strong>{verdict.message}</strong></p>
                <p className="muted small">
                  {recorded === 'hard' ? 'Saved as solved with help: it comes back a bit sooner.' : 'Saved. It comes back for review in a day.'}
                </p>
                <div className="row">
                  {nextId && <a className="btn btn-primary" href={`#/endgames/${encodeURIComponent(nextId)}`}>Next lesson</a>}
                  <button type="button" className="btn" onClick={restart}>Play it again</button>
                </div>
              </div>
            )}
            {verdict?.finished && !verdict.success && (
              <div className="drill-result drill-bad">
                <p><strong>{verdict.message}</strong></p>
                {verdict.best?.line && verdict.best.line.length > 1 && <p className="muted small">Line: {verdict.best.line.join(' ')}</p>}
                <div className="row">
                  {verdict.best && <button type="button" className="btn btn-primary" onClick={takeBack}>Try that move again</button>}
                  <button type="button" className="btn" onClick={restart}>Restart</button>
                </div>
              </div>
            )}
            {hint && !finished && (
              <p className="drill-hint"><Icon name="bulb" size={15} /> Try <strong>{hint.san}</strong>{hint.line.length > 1 ? `, for example ${hint.line.join(' ')}` : ''}.</p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </section>

        <section className="panel lesson-text">
          <div className="row-between">
            <h2>The idea</h2>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setShowIdea(!showIdea)} aria-expanded={showIdea}>
              {showIdea ? 'Hide' : 'Show'}
            </button>
          </div>
          {showIdea && (
            <>
              <p>{lesson.idea}</p>
              {lesson.steps.length > 0 && (
                <ol className="lesson-steps">{lesson.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              )}
              {lesson.hint && <p className="muted small"><strong>Tip:</strong> {lesson.hint}</p>}
              {lesson.review_id && <p className="small"><a href={`#/review/${lesson.review_id}`}>See the game review</a></p>}
            </>
          )}
        </section>

        {plies.length > 0 && (
          <section className="panel drill-moves" aria-label="Moves played">
            <h2>Moves</h2>
            <p className="line-text">{plies.map((p) => p.san).join(' ')}</p>
          </section>
        )}
      </aside>
    </div>
  )
}

export function DrillPage({ id }: { id: string }) {
  const lesson = useLoad(() => api.lesson(id), [id])
  const all = useLoad(() => api.endgames(), [])
  const nextId = useMemo(() => {
    const list = all.data?.lessons ?? []
    const i = list.findIndex((l) => l.id === id)
    return i >= 0 && i + 1 < list.length ? list[i + 1].id : null
  }, [all.data, id])

  useEffect(() => {
    window.scrollTo?.(0, 0)
  }, [id])

  return (
    <div className="page drill-page">
      <a className="back-link" href="#/endgames"><Icon name="prev" size={15} /> All endgames</a>
      {lesson.error && <p className="form-error" role="alert">{lesson.error}</p>}
      {lesson.data && (
        <>
          <header className="page-head">
            <h1>{lesson.data.title}</h1>
            <p className="page-sub">{lesson.data.category}</p>
          </header>
          <Drill key={lesson.data.id} lesson={lesson.data} nextId={nextId} />
        </>
      )}
    </div>
  )
}
