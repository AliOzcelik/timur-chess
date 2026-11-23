import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import { glyphToSvg } from '@lichess-org/chessground/glyph'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { EvalBar } from '../components/EvalBar'
import { EvalGraph } from '../components/EvalGraph'
import { Icon } from '../components/Icon'
import { Scoresheet } from '../components/Scoresheet'
import { api, type Classification, type ReviewDetail, type ReviewMove } from '../lib/api'
import { numberedLine, playUci, uciSquares, type Color } from '../lib/chess'
import { formatEval, winWhite } from '../lib/evals'
import { useShortcuts } from '../lib/keys'
import { navigate } from '../lib/router'
import { fromUciLine, hasMoves, pathTo, lineEnd } from '../lib/tree'
import { useAnalysis } from '../state/analysis'
import { formatDate, formatPgnDate, playersOf } from './ReviewListPage'

export const CLASS_LABEL: Record<Classification, string> = {
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
  forced: 'Forced',
}

const COUNT_ROWS: Classification[] = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder']
const BAD: Classification[] = ['inaccuracy', 'mistake', 'blunder']

const glyphs = glyphToSvg(1)
const STAR = '<g transform="matrix(.4 0 0 .4 71 -12)"><circle cx="50" cy="50" r="50" fill="#2e8b57"/><path fill="#fff" d="M50 17l9.6 19.6 21.6 3.1-15.6 15.2 3.7 21.5L50 66.3 30.7 76.4l3.7-21.5L18.8 39.7l21.6-3.1z"/></g>'

function glyphFor(m: ReviewMove): string | null {
  if (m.classification === 'blunder') return glyphs['??'](0)
  if (m.classification === 'mistake') return glyphs['?'](0)
  if (m.classification === 'inaccuracy') return glyphs['?!'](0)
  if (m.classification === 'best') return m.tags.includes('only_move') ? glyphs['□'](0) : STAR
  return null
}

type RetryState = {
  moveIndex: number
  fen: string
  lastMove?: [Key, Key]
  status: 'waiting' | 'checking' | 'correct' | 'close' | 'wrong'
  text?: string
}

function LineText({ fen, sans }: { fen: string; sans: string[] }) {
  return (
    <span className="line-text">
      {numberedLine(fen, sans).map((t) => (
        <span key={t.index}>{t.label && <span className="pv-num">{t.label}</span>}{t.san} </span>
      ))}
    </span>
  )
}

export function ReviewPage({ id }: { id: number }) {
  const [review, setReview] = useState<ReviewDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState(0)
  const [orientation, setOrientation] = useState<Color>('white')
  const [retry, setRetry] = useState<RetryState | null>(null)

  const orientedFor = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await api.getReview(id)
      setReview(data)
      if (orientedFor.current !== data.id) {
        orientedFor.current = data.id
        setOrientation(data.my_color === 'black' ? 'black' : 'white')
      }
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [id])

  useEffect(() => {
    setReview(null)
    setPos(0)
    setRetry(null)
    load()
  }, [load])

  const pending = review && (review.status === 'queued' || review.status === 'running')
  useEffect(() => {
    if (!pending) return
    const t = window.setInterval(load, 1000)
    return () => window.clearInterval(t)
  }, [pending, load])

  const analysis = review?.analysis ?? null
  const moves = useMemo(() => analysis?.moves ?? [], [analysis])
  const positions = analysis?.positions ?? []
  const tree = useMemo(
    () => (analysis ? fromUciLine(analysis.root_fen, analysis.moves.map((m) => m.uci), analysis.headers) : null),
    [analysis],
  )
  const nodeIds = useMemo(() => (tree ? pathTo(tree, lineEnd(tree, tree.rootId)) : []), [tree])
  const annotations = useMemo(() => {
    const out: Record<string, Classification> = {}
    moves.forEach((m, i) => { if (nodeIds[i + 1]) out[nodeIds[i + 1]] = m.classification })
    return out
  }, [moves, nodeIds])

  const myColor = review?.my_color ?? 'both'
  const isMine = (m: ReviewMove) => myColor === 'both' || m.color === myColor
  const mistakeIndexes = useMemo(
    () => moves.filter((m) => BAD.includes(m.classification) && (myColor === 'both' || m.color === myColor)).map((m) => m.index),
    [moves, myColor],
  )

  const maxPos = positions.length - 1
  const go = (p: number) => {
    setRetry(null)
    setPos(Math.max(0, Math.min(maxPos, p)))
  }
  const nextMistake = () => {
    const next = mistakeIndexes.find((i) => i + 1 > pos)
    if (next !== undefined) go(next + 1)
  }
  const prevMistake = () => {
    const prev = [...mistakeIndexes].reverse().find((i) => i + 1 < pos)
    if (prev !== undefined) go(prev + 1)
  }

  useShortcuts({
    ArrowLeft: () => go(pos - 1),
    ArrowRight: () => go(pos + 1),
    ArrowUp: () => go(0),
    ArrowDown: () => go(maxPos),
    Home: () => go(0),
    End: () => go(maxPos),
    n: () => nextMistake(),
    p: () => prevMistake(),
    f: () => setOrientation((o) => (o === 'white' ? 'black' : 'white')),
  }, !!analysis && !retry)

  const move: ReviewMove | null = pos > 0 ? moves[pos - 1] ?? null : null

  const shapes = useMemo<DrawShape[]>(() => {
    if (!move || retry) return []
    const out: DrawShape[] = []
    const glyph = glyphFor(move)
    if (glyph) out.push({ orig: move.uci.slice(2, 4) as Key, customSvg: { html: glyph } })
    if (move.best && move.best.uci !== move.uci && move.classification !== 'forced') {
      const sq = uciSquares(move.best.uci)
      if (sq) out.push({ orig: sq[0], dest: sq[1], brush: 'green' })
    }
    return out
  }, [move, retry])

  const startRetry = (m: ReviewMove) => {
    const prevUci = m.index > 0 ? moves[m.index - 1].uci : undefined
    setPos(m.index + 1)
    setRetry({ moveIndex: m.index, fen: m.fen_before, lastMove: uciSquares(prevUci), status: 'waiting' })
  }

  const onRetryMove = async (uci: string) => {
    if (!retry) return
    const m = moves[retry.moveIndex]
    const played = playUci(retry.fen, uci)
    if (!played) return
    const base = { ...retry, fen: played.fen, lastMove: uciSquares(uci) }
    if (m.best && uci === m.best.uci) {
      setRetry({ ...base, status: 'correct', text: `Yes! ${played.san} is the engine's top move.` })
      return
    }
    if (uci === m.uci) {
      setRetry({ ...base, status: 'wrong', text: `${played.san} is the move from the game. Look for something better.` })
      return
    }
    setRetry({ ...base, status: 'checking', text: `Checking ${played.san}…` })
    try {
      const res = await api.evaluate(m.fen_before, [uci], 18, 2)
      const white = winWhite(res.eval)
      const mine = m.color === 'white' ? white : 100 - white
      const loss = Math.max(0, m.win_before - mine)
      if (loss < 5) {
        setRetry({ ...base, status: 'close', text: `Good find. ${played.san} is nearly as strong as the best move, ${m.best?.san ?? ''}.` })
      } else {
        setRetry({ ...base, status: 'wrong', text: `${played.san} still gives away about ${loss.toFixed(0)}% of your winning chance. Try again.` })
      }
    } catch (e) {
      setRetry({ ...base, status: 'wrong', text: (e as Error).message })
    }
  }

  const openInAnalysis = () => {
    if (!tree) return
    const board = useAnalysis.getState()
    if (hasMoves(board.tree) && !window.confirm('Open this game on the analysis board? The moves currently there will be replaced.')) return
    board.load(tree, nodeIds[pos] ?? tree.rootId, orientation)
    navigate('/analysis')
  }

  const remove = async () => {
    if (!review || !window.confirm(`Delete the review of ${playersOf(review)}? This cannot be undone.`)) return
    try {
      await api.deleteReview(review.id)
      navigate('/review')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (error && !review) {
    return (
      <div className="page">
        <p className="form-error" role="alert">{error}</p>
        <a href="#/review" className="btn btn-quiet">Back to game review</a>
      </div>
    )
  }
  if (!review) return <div className="page"><p className="muted">Loading…</p></div>

  const header = (
    <header className="page-head">
      <a href="#/review" className="back-link"><Icon name="prev" size={16} /> All reviews</a>
      <h1>{playersOf(review)}</h1>
      <p className="page-sub">
        {[review.result, review.event, formatPgnDate(review.game_date) ? `Played ${formatPgnDate(review.game_date)}` : null, `Reviewed ${formatDate(review.created_at)}`]
          .filter(Boolean)
          .join(', ')}
      </p>
    </header>
  )

  if (review.status !== 'done' || !analysis || !tree) {
    const pct = review.total ? Math.round((review.progress / review.total) * 100) : 0
    return (
      <div className="page">
        {header}
        {review.status === 'error' ? (
          <div className="panel">
            <p className="form-error" role="alert">{review.error ?? 'The review failed.'}</p>
            <p className="muted">You can delete it and start the review again.</p>
            <button type="button" className="btn btn-quiet" onClick={remove}><Icon name="trash" size={16} /> Delete review</button>
          </div>
        ) : (
          <div className="panel progress-panel" aria-live="polite">
            <p>{review.status === 'queued' ? 'Waiting for the reviewer to finish another game…' : `Stockfish is checking position ${review.progress} of ${review.total}.`}</p>
            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="muted">You can keep using the analysis board while this runs.</p>
          </div>
        )}
      </div>
    )
  }

  const boardFen = retry ? retry.fen : positions[pos].fen
  const lastMove = retry ? retry.lastMove : uciSquares(move?.uci)
  const evalHere = retry ? null : positions[pos].eval
  const summary = analysis.summary
  const wins = positions.map((p) => p.win)
  const labels = positions.map((p, i) => {
    if (i === 0) return `Start ${p.eval_text}`
    const m = moves[i - 1]
    return `${m.move_number}${m.color === 'white' ? '.' : '...'}${m.san} ${p.eval_text}`
  })
  const markers = moves
    .filter((m) => BAD.includes(m.classification) && m.classification !== 'inaccuracy')
    .map((m) => ({ index: m.index + 1, cls: m.classification }))

  const firstOf = (cls: Classification, color: 'white' | 'black') => {
    const m = moves.find((x) => x.classification === cls && x.color === color)
    if (m) go(m.index + 1)
  }

  const retryMove = retry ? moves[retry.moveIndex] : null

  return (
    <div className="page review-page">
      {header}
      <div className="analysis-layout">
        <section className="board-column" aria-label="Board">
          <div className="board-area">
            <EvalBar value={evalHere} orientation={orientation} hidden={!!retry} />
            <Board
              fen={boardFen}
              orientation={orientation}
              lastMove={lastMove}
              movable={retry && (retry.status === 'waiting') ? 'turn' : null}
              shapes={shapes}
              onMove={onRetryMove}
            />
          </div>
          <EvalGraph wins={wins} labels={labels} current={pos} markers={markers} onSelect={go} />
          <div className="board-toolbar" role="toolbar" aria-label="Review actions">
            <button type="button" className="tool" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
              <Icon name="flip" /> <span>Flip</span>
            </button>
            <button type="button" className="tool" onClick={openInAnalysis}>
              <Icon name="board" /> <span>Open on analysis board</span>
            </button>
            <button type="button" className="tool" onClick={remove}>
              <Icon name="trash" /> <span>Delete review</span>
            </button>
          </div>
        </section>

        <aside className="side-panel" aria-label="Review">
          <section className="summary">
            <table className="summary-table">
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Move type</span></th>
                  <th scope="col" className={myColor === 'white' ? 'mine' : ''}>
                    <span className="acc-dot acc-white" />{review.white ?? 'White'}
                  </th>
                  <th scope="col" className={myColor === 'black' ? 'mine' : ''}>
                    <span className="acc-dot acc-black" />{review.black ?? 'Black'}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="acc-row">
                  <th scope="row">Accuracy</th>
                  <td>{summary.white.accuracy?.toFixed(1) ?? '–'}%</td>
                  <td>{summary.black.accuracy?.toFixed(1) ?? '–'}%</td>
                </tr>
                {COUNT_ROWS.map((cls) => (
                  <tr key={cls} className={`count-row cls-${cls}`}>
                    <th scope="row"><span className="cls-swatch" />{CLASS_LABEL[cls]}</th>
                    {(['white', 'black'] as const).map((color) => (
                      <td key={color}>
                        {summary[color].counts[cls] ? (
                          <button type="button" className="count-btn" onClick={() => firstOf(cls, color)} title={`Go to ${color}'s first ${CLASS_LABEL[cls].toLowerCase()}`}>
                            {summary[color].counts[cls]}
                          </button>
                        ) : <span className="zero">0</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={`move-card ${retryMove ? `cls-${retryMove.classification}` : move ? `cls-${move.classification}` : ''}`} aria-live="polite">
            {retry && retryMove ? (
              <>
                <h2 className="move-card-title">Find a better move than {retryMove.move_number}{retryMove.color === 'white' ? '.' : '...'}{retryMove.san}</h2>
                <p>{retryMove.color === 'white' ? 'White' : 'Black'} to move. Play your move on the board.</p>
                {retry.text && <p className={`retry-result retry-${retry.status}`}>{retry.text}</p>}
                <div className="row">
                  {(retry.status === 'wrong' || retry.status === 'close' || retry.status === 'correct') && (
                    <button type="button" className="btn btn-quiet" onClick={() => startRetry(retryMove)}><Icon name="retry" size={16} /> Try again</button>
                  )}
                  <button type="button" className="btn btn-quiet" onClick={() => { setRetry(null); setPos(retryMove.index + 1) }}>
                    <Icon name="bulb" size={16} /> {retry.status === 'correct' ? 'Back to the review' : 'Show the answer'}
                  </button>
                </div>
              </>
            ) : move ? (
              <>
                <h2 className="move-card-title">
                  <span className="move-card-san">{move.move_number}{move.color === 'white' ? '.' : '...'}{move.san}</span>
                  <span className="cls-badge">{CLASS_LABEL[move.classification]}</span>
                  <span className="move-card-eval">{move.eval_after_text}</span>
                </h2>
                <p className="explanation">{move.explanation}</p>
                {move.best && move.best.uci !== move.uci && move.classification !== 'forced' && (
                  <p className="best-line"><span className="muted">Best line </span><LineText fen={move.fen_before} sans={move.best_line_san} /></p>
                )}
                {move.reply_line_san.length > 0 && BAD.includes(move.classification) && (
                  <p className="best-line"><span className="muted">After your move </span><LineText fen={move.fen_after} sans={move.reply_line_san.slice(0, 6)} /></p>
                )}
                <p className="muted small">
                  Winning chance {move.win_before.toFixed(0)}% before, {move.win_after.toFixed(0)}% after. Engine eval {formatEval(move.eval_before)} before the move.
                </p>
                {BAD.includes(move.classification) && isMine(move) && (
                  <button type="button" className="btn btn-primary" onClick={() => startRetry(move)}>
                    <Icon name="retry" size={16} /> Retry this move
                  </button>
                )}
              </>
            ) : (
              <>
                <h2 className="move-card-title">Starting position</h2>
                <p className="explanation">
                  {mistakeIndexes.length
                    ? `${mistakeIndexes.length} ${mistakeIndexes.length === 1 ? 'move needs' : 'moves need'} a second look. Press N or use the button below to jump to each one, then try to find the better move yourself.`
                    : 'No inaccuracies, mistakes or blunders on your side. Step through the game with the arrow keys.'}
                </p>
              </>
            )}
            {!retry && (
              <div className="row mistake-nav">
                <button type="button" className="btn btn-small btn-quiet" onClick={prevMistake} disabled={!mistakeIndexes.some((i) => i + 1 < pos)}>
                  <Icon name="prev" size={15} /> Previous mistake
                </button>
                <button type="button" className="btn btn-small btn-quiet" onClick={nextMistake} disabled={!mistakeIndexes.some((i) => i + 1 > pos)}>
                  Next mistake <Icon name="next" size={15} />
                </button>
              </div>
            )}
          </section>

          <section className="moves-panel" aria-label="Moves">
            <Scoresheet
              tree={tree}
              currentId={nodeIds[pos] ?? tree.rootId}
              onSelect={(nid) => go(nodeIds.indexOf(nid))}
              annotations={annotations}
            />
            <div className="nav-bar">
              <div className="nav-buttons">
                <button type="button" className="icon-btn" onClick={() => go(0)} aria-label="First move"><Icon name="first" /></button>
                <button type="button" className="icon-btn" onClick={() => go(pos - 1)} aria-label="Previous move"><Icon name="prev" /></button>
                <button type="button" className="icon-btn" onClick={() => go(pos + 1)} aria-label="Next move"><Icon name="next" /></button>
                <button type="button" className="icon-btn" onClick={() => go(maxPos)} aria-label="Last move"><Icon name="last" /></button>
              </div>
              <span className="muted small">
                {analysis.settings.engine ?? 'Stockfish'}, depth {analysis.settings.depth}
              </span>
            </div>
          </section>

          <details className="shortcuts">
            <summary>Keyboard shortcuts</summary>
            <dl>
              <dt>← →</dt><dd>Previous and next move</dd>
              <dt>N P</dt><dd>Next and previous mistake</dd>
              <dt>F</dt><dd>Flip the board</dd>
            </dl>
          </details>
        </aside>
      </div>
    </div>
  )
}
