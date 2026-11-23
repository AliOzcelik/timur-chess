import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { Icon } from '../components/Icon'
import { useLoad } from '../hooks/useLoad'
import { api, type Lesson, type MoveVerdict } from '../lib/api'
import { playUci, turnOf, uciSquares } from '../lib/chess'
import { openPositionOnBoard } from '../lib/open'
import { LEVEL, progressLabel } from './EndgamesPage'
import { BoardShell, PlayerStrip } from '../components/BoardShell'
import { Masthead, Meta } from '../components/Masthead'

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
  const holdTotal = lesson.success.type === 'hold' ? lesson.success.moves ?? 10 : 0
  const other = lesson.side === 'white' ? 'black' : 'white'
  const toMove = turnOf(shownFen)

  let status: React.ReactNode = 'Your move.'
  if (thinking) status = 'Checking your move…'
  else if (verdict && !verdict.finished) status = `${verdict.reply ? `${verdict.reply.san}. ` : ''}${verdict.message}`
  else if (verdict?.finished) status = verdict.message
  else if (plies.length) status = 'Your move.'

  return (
    <div className="analysis-grid drill-grid">
      <section className="board-col" aria-label="Board">
        <BoardShell
          top={<PlayerStrip position="top" name={lesson.exact ? 'Tablebase' : 'Stockfish'} rating={lesson.exact ? 'perfect defence' : null} side={other} toMove={toMove === other && !finished} />}
          bottom={<PlayerStrip position="bottom" name="You" side={lesson.side} toMove={toMove === lesson.side && !finished} />}
        >
          <Board
            fen={shownFen}
            orientation={lesson.side}
            lastMove={uciSquares(shownLast?.uci) as [Key, Key] | undefined}
            movable={yourTurn ? 'turn' : null}
            shapes={shapes}
            onMove={play}
          />
        </BoardShell>
        <div className="board-toolbar" role="toolbar" aria-label="Lesson actions">
          <button type="button" className="tool" onClick={askHint} disabled={!yourTurn}><Icon name="bulb" /><span>Hint</span></button>
          <button type="button" className="tool" onClick={takeBack} disabled={thinking || plies.length === 0 || (finished && Boolean(verdict?.success))}>
            <Icon name="prev" /><span>Take back</span>
          </button>
          <button type="button" className="tool" onClick={restart} disabled={thinking}><Icon name="retry" /><span>Restart</span></button>
          <div className="tool-right">
            <button type="button" className="tool" onClick={() => openPositionOnBoard(fen, lesson.side)}><Icon name="board" /><span>Analyse this position</span></button>
          </div>
        </div>
        <div className="board-status">
          <span className="status-msg">{lesson.exact ? <><Icon name="check" />The tablebase judges every move exactly.</> : <><Icon name="info" />Stockfish judges the moves in this position.</>}</span>
        </div>
      </section>

      <aside className="inspector drill-inspector" aria-label="Lesson">
        <section className="card goal-card">
          <div className="card-body">
            <p className="eyebrow">Your goal <span className="sep">/</span> <span className="quiet">{lesson.side === 'white' ? 'White' : 'Black'} to {lesson.goal}</span></p>
            <p className="goal-text">{goalText(lesson)}</p>
            {holdTotal > 0 && (
              <div className="hold-progress">
                <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={holdTotal} aria-valuenow={Math.min(myMoves, holdTotal)} aria-label="Moves held">
                  <i style={{ width: `${Math.min(100, (myMoves / holdTotal) * 100)}%` }} />
                </div>
                <span className="muted small">Move {Math.min(myMoves, holdTotal)} of {holdTotal}</span>
              </div>
            )}
          </div>
          <div className={`drill-status ${verdict?.finished ? (verdict.success ? 'is-good' : 'is-bad') : verdict && !verdict.ok ? 'is-bad' : ''}`} role="status" aria-live="polite">
            <p className="drill-msg">
              {thinking && <span className="spinner" aria-hidden="true" />}
              {verdict?.finished ? <strong>{status}</strong> : status}
            </p>
            {verdict?.finished && verdict.success && (
              <>
                <p className="muted small">
                  {recorded === 'hard' ? 'Saved as solved with help: it comes back a bit sooner.' : 'Saved. It comes back for review in a day.'}
                </p>
                <div className="row">
                  {nextId && <a className="btn btn-primary btn-sm" href={`#/endgames/${encodeURIComponent(nextId)}`}><Icon name="next" />Next lesson</a>}
                  <button type="button" className="btn btn-sm" onClick={restart}>Play it again</button>
                </div>
              </>
            )}
            {verdict?.finished && !verdict.success && (
              <>
                {verdict.best?.line && verdict.best.line.length > 1 && <p className="muted small">Line: {verdict.best.line.join(' ')}</p>}
                <div className="row">
                  {verdict.best && <button type="button" className="btn btn-primary btn-sm" onClick={takeBack}><Icon name="retry" />Try that move again</button>}
                  <button type="button" className="btn btn-sm" onClick={restart}>Restart</button>
                </div>
              </>
            )}
            {hint && !finished && (
              <p className="drill-hint"><Icon name="bulb" size={15} /><span>Try <strong>{hint.san}</strong>{hint.line.length > 1 ? `, for example ${hint.line.join(' ')}` : ''}.</span></p>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </section>

        <section className="card idea-card">
          <div className="card-head">
            <h2 className="card-title"><Icon name="book" />The idea</h2>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setShowIdea(!showIdea)} aria-expanded={showIdea}>
              {showIdea ? 'Hide' : 'Show'}
            </button>
          </div>
          {showIdea && (
            <div className="card-body lesson-text">
              <p>{lesson.idea}</p>
              {lesson.steps.length > 0 && (
                <ol className="lesson-steps">{lesson.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              )}
              {lesson.hint && <p className="tip"><strong>Tip:</strong> {lesson.hint}</p>}
              {lesson.review_id && <p className="small"><a href={`#/review/${lesson.review_id}`}>See the game review</a></p>}
            </div>
          )}
        </section>

        <section className="card drill-moves" aria-label="Moves played">
          <div className="card-head"><h2 className="card-title">Moves</h2><span className="muted small">{plies.length} plies</span></div>
          <div className="card-body">
            {plies.length === 0
              ? <p className="muted small">Your moves and the defender’s replies appear here.</p>
              : <p className="line-text">{plies.map((p, i) => {
                  const ply = i + (turnOf(lesson.fen) === 'black' ? 1 : 0)
                  const num = ply % 2 === 0 ? `${Math.floor(ply / 2) + 1}.` : i === 0 ? `${Math.floor(ply / 2) + 1}…` : ''
                  return <span key={i} className={i === plies.length - 1 ? 'mv-last' : undefined}>{num && <span className="mv-num">{num}</span>}{p.san} </span>
                })}</p>}
          </div>
        </section>
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

  const l = lesson.data
  return (
    <div className="page drill-page">
      {lesson.error && (
        <>
          <Masthead section="Train" crumb={{ href: '#/endgames', label: 'Endgames' }} title="Lesson not found" />
          <p className="form-error" role="alert">{lesson.error}</p>
        </>
      )}
      {l && (
        <>
          <Masthead
            section="Train"
            crumb={{ href: '#/endgames', label: 'Endgames' }}
            title={l.title}
            sub={<Meta items={[l.category, l.level > 0 ? LEVEL[l.level] : null, `${l.side === 'white' ? 'White' : 'Black'} to ${l.goal}`]} />}
            actions={
              <>
                <span className={`badge prog-badge ${prog(l).cls}`}>{prog(l).text}</span>
                <a className="btn btn-ghost" href="#/endgames"><Icon name="grid" />All endgames</a>
              </>
            }
          />
          <Drill key={l.id} lesson={l} nextId={nextId} />
        </>
      )}
    </div>
  )
}

function prog(l: Lesson) {
  return progressLabel(l.progress)
}
