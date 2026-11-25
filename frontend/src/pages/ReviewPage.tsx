import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import { glyphToSvg } from '@lichess-org/chessground/glyph'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { BoardShell, PlayerStrip } from '../components/BoardShell'
import { Masthead, Meta } from '../components/Masthead'
import { EvalBar } from '../components/EvalBar'
import { EvalGraph } from '../components/EvalGraph'
import { Icon } from '../components/Icon'
import { GLYPH, Scoresheet } from '../components/Scoresheet'
import { api, type Classification, type CoachExplanation, type ReviewDetail, type ReviewMove } from '../lib/api'
import { numberedLine, playUci, turnOf, uciSquares, type Color } from '../lib/chess'
import { formatEval, winWhite } from '../lib/evals'
import { useShortcuts } from '../lib/keys'
import { navigate } from '../lib/router'
import { fromUciLine, hasMoves, pathTo, lineEnd } from '../lib/tree'
import { useAnalysis } from '../state/analysis'
import { formatPgnDate, playersOf } from './ReviewListPage'

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

const FACT_LABEL: Record<string, string> = {
  side: 'You played',
  move_played: 'Move played',
  move_played_does: 'What it does',
  best_move_does: 'What the best move does',
  classification: 'Label',
  win_pct_drop: 'Winning chance lost (points)',
  best_move: 'Best move',
  best_line: 'Best line',
  refutation: 'Refutation',
  changes_after_played_line: 'What your move changed',
  changes_after_best_line: 'What the best move changed',
  material_after_refutation: 'Material after the refutation',
  material_after_best_line: 'Material after the best line',
  material_lost_by_move_played: 'Material lost',
  good_alternatives: 'Also fine',
  threat_missed: 'Missed threat',
  tactics: 'Tactics',
}

/** Asks the local LLM to explain a mistake from Stockfish's lines and board facts. */
function CoachBox({ reviewId, move, onResult }: {
  reviewId: number
  move: ReviewMove
  onResult: (index: number, coach: CoachExplanation) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const coach = move.coach

  const run = async (refresh: boolean) => {
    setBusy(true)
    setError(null)
    try {
      onResult(move.index, await api.explainMove(reviewId, move.index, refresh))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="coach" aria-busy={busy}>
      {coach ? (
        <>
          <div className="coach-text">
            <span className="lab"><Icon name="spark" size={12} /> {coach.source === 'llm' ? `Coach · ${coach.model}` : 'Coach · built-in hint'}</span>
            <p className="explain">{coach.text}</p>
          </div>
          {coach.note && <p className="dim small coach-note">{coach.note}</p>}
          <details className="coach-facts">
            <summary>Facts the coach was given</summary>
            <dl>
              {Object.entries(coach.facts).map(([k, v]) => (
                <div key={k} className="fact-row">
                  <dt>{FACT_LABEL[k] ?? k.replace(/_/g, ' ')}</dt>
                  <dd>{Array.isArray(v) ? v.join('; ') : String(v ?? '–')}</dd>
                </div>
              ))}
            </dl>
          </details>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => run(true)} disabled={busy}>
            <Icon name="refresh" size={14} /> {busy ? 'Rewriting…' : 'Explain again'}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => run(false)} disabled={busy}>
          <Icon name="spark" size={14} /> {busy ? 'Asking Stockfish and the local model…' : 'Explain with AI'}
        </button>
      )}
      {error && <p className="coach-error" role="alert">{error}</p>}
    </div>
  )
}

export function ReviewPage({ id }: { id: number }) {
  const [review, setReview] = useState<ReviewDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState(0)
  const [orientation, setOrientation] = useState<Color>('white')
  const [retry, setRetry] = useState<RetryState | null>(null)
  const [allMoves, setAllMoves] = useState(false)

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

  const saveCoach = useCallback((index: number, coach: CoachExplanation) => {
    setReview((r) => {
      if (!r?.analysis) return r
      const updated = r.analysis.moves.map((m) => (m.index === index ? { ...m, coach } : m))
      return { ...r, analysis: { ...r.analysis, moves: updated } }
    })
  }, [])

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
        <Masthead section="Study" crumb={{ href: '#/review', label: 'Game review' }} title="Review not found" />
        <p className="form-error" role="alert">{error}</p>
        <a href="#/review" className="btn btn-ghost">Back to game review</a>
      </div>
    )
  }
  if (!review) {
    return (
      <div className="page">
        <Masthead section="Study" crumb={{ href: '#/review', label: 'Game review' }} title="Loading…" />
        <div className="skeleton" style={{ height: 420, maxWidth: 560 }} />
      </div>
    )
  }

  const title = review.white || review.black ? `${review.white ?? 'Unknown'} — ${review.black ?? 'Unknown'}` : 'Unnamed game'
  const exportPgn = () => {
    const blob = new Blob([review.pgn], { type: 'application/x-chess-pgn' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(review.white ?? 'white').replace(/\W+/g, '_')}-${(review.black ?? 'black').replace(/\W+/g, '_')}.pgn`
    a.click()
    URL.revokeObjectURL(url)
  }
  const header = (
    <Masthead
      section="Study"
      crumb={{ href: '#/review', label: 'Game review' }}
      title={title}
      sub={
        <>
          <Meta items={[
              review.result ? <span className="strong">{review.result.replace('1/2-1/2', '½–½')}</span> : null,
              review.event,
              formatPgnDate(review.game_date),
              review.eco || review.opening ? <><span className="eco">{review.eco}</span> {review.opening}</> : null,
              review.status === 'done'
                ? <span className="save-state"><Icon name="check" size={15} />Review complete</span>
                : review.status === 'error' ? <span className="save-state save-error"><Icon name="info" size={15} />Review failed</span>
                : <span className="save-state"><Icon name="clock" size={15} />Reviewing…</span>,
            ]} />
        </>
      }
      actions={
        <>
          <a className="btn btn-ghost" href="#/review"><Icon name="prev" />All reviews</a>
          {review.pgn && <button type="button" className="btn" onClick={exportPgn}><Icon name="download" />Export PGN</button>}
        </>
      }
    />
  )

  if (review.status !== 'done' || !analysis || !tree) {
    const pct = review.total ? Math.round((review.progress / review.total) * 100) : 0
    return (
      <div className="page review-page">
        {header}
        {review.status === 'error' ? (
          <div className="card progress-panel">
            <div className="card-body">
              <p className="form-error" role="alert">{review.error ?? 'The review failed.'}</p>
              <p className="muted">You can delete it and start the review again.</p>
              <button type="button" className="btn" onClick={remove}><Icon name="trash" size={16} /> Delete review</button>
            </div>
          </div>
        ) : (
          <div className="card progress-panel" aria-live="polite">
            <div className="card-body">
              <p className="eyebrow">{review.status === 'queued' ? 'In the queue' : 'Analysing'}</p>
              <h2 className="progress-title">
                {review.status === 'queued' ? 'In the queue' : `Analysing move ${Math.max(1, Math.ceil(review.progress / 2))} of ${Math.max(1, Math.ceil(review.total / 2))}`}
              </h2>
              <p className="muted">{review.status === 'queued' ? 'Waiting for the reviewer to finish another game…' : `Stockfish is checking position ${review.progress} of ${review.total}.`}</p>
              <div className="meter progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                <i className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="dim small" style={{ marginTop: 12 }}>You can keep using the analysis board while this runs.</p>
            </div>
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
  const moveLabel = (m: ReviewMove) => `${m.move_number}${m.color === 'white' ? '.' : '…'}${m.san}`

  // Accuracy: "mine" is the reviewed side (or White when both sides are reviewed).
  const mineSide: 'white' | 'black' = myColor === 'black' ? 'black' : 'white'
  const otherSide: 'white' | 'black' = mineSide === 'white' ? 'black' : 'white'
  const accMine = summary[mineSide].accuracy
  const accOther = summary[otherSide].accuracy
  const nameOf = (c: 'white' | 'black') => (c === 'white' ? review.white : review.black) ?? (c === 'white' ? 'White' : 'Black')
  const mineCounts = myColor === 'both'
    ? Object.fromEntries(COUNT_ROWS.map((c) => [c, (summary.white.counts[c] ?? 0) + (summary.black.counts[c] ?? 0)])) as Record<Classification, number>
    : summary[mineSide].counts
  const mixTotal = COUNT_ROWS.reduce((a, c) => a + (mineCounts[c] ?? 0), 0) || 1
  const badCount = (mineCounts.mistake ?? 0) + (mineCounts.blunder ?? 0)

  // Turning points: your biggest drops in winning chance.
  const turning = moves
    .filter((m) => BAD.includes(m.classification) && isMine(m))
    .sort((a, b) => b.drop - a.drop)
    .slice(0, 4)
    .sort((a, b) => a.index - b.index)

  // The move strip: the current pair and the two before it.
  const pairStart = Math.max(1, (move?.move_number ?? 1) - 2)
  const pairs: { n: number; w?: ReviewMove; b?: ReviewMove }[] = []
  for (const m of moves) {
    if (m.move_number < pairStart || m.move_number > pairStart + 2) continue
    let pr = pairs.find((x) => x.n === m.move_number)
    if (!pr) { pr = { n: m.move_number }; pairs.push(pr) }
    if (m.color === 'white') pr.w = m
    else pr.b = m
  }
  const turnAt = turnOf(boardFen)
  const topSide = orientation === 'white' ? 'black' : 'white'
  const bottomSide = orientation

  return (
    <div className="page review-page">
      {header}
      <div className="review-grid">
        <section className="review-left" aria-label="Board">
          <BoardShell
            top={<PlayerStrip position="top" name={nameOf(topSide)} rating={analysis.headers[topSide === 'white' ? 'WhiteElo' : 'BlackElo']} side={topSide} toMove={turnAt === topSide && !!retry} />}
            bottom={<PlayerStrip position="bottom" name={nameOf(bottomSide)} rating={analysis.headers[bottomSide === 'white' ? 'WhiteElo' : 'BlackElo']} side={bottomSide} toMove={turnAt === bottomSide && !!retry} />}
            evalBar={<EvalBar value={evalHere} orientation={orientation} hidden={!!retry} />}
          >
            <Board
              fen={boardFen}
              orientation={orientation}
              lastMove={lastMove}
              movable={retry && (retry.status === 'waiting') ? 'turn' : null}
              shapes={shapes}
              onMove={onRetryMove}
            />
          </BoardShell>
          <div className="graph-card">
            <div className="graph-head">
              <span className="t">Evaluation</span>
              <span className="now">{labels[pos]}</span>
            </div>
            <EvalGraph wins={wins} labels={labels} current={pos} markers={markers} onSelect={go} />
          </div>
          <div className="move-strip">
            <button type="button" className="icon-btn" onClick={() => go(pos - 1)} aria-label="Previous move"><Icon name="prev" /></button>
            <div className="pairs">
              {pairs.map((pr) => (
                <span key={pr.n} className={`pair ${move && move.move_number === pr.n ? 'cur' : ''}`}>
                  <span className="n">{pr.n}.</span>
                  {pr.w ? <StripMove m={pr.w} current={pos === pr.w.index + 1} onGo={go} /> : '…'}
                  {pr.b && <StripMove m={pr.b} current={pos === pr.b.index + 1} onGo={go} />}
                </span>
              ))}
            </div>
            <button type="button" className="icon-btn" onClick={() => go(pos + 1)} aria-label="Next move"><Icon name="next" /></button>
            <span className="spacer" />
            <span className="strip-count">{pos} / {maxPos}</span>
            <button type="button" className={`more ${allMoves ? 'on' : ''}`} onClick={() => setAllMoves((v) => !v)} aria-expanded={allMoves}>
              All moves <Icon name={allMoves ? 'chevd' : 'chev'} size={12} />
            </button>
          </div>
          {allMoves && (
            <section className="card moves-card review-moves" aria-label="Moves">
              <Scoresheet
                tree={tree}
                currentId={nodeIds[pos] ?? tree.rootId}
                onSelect={(nid) => go(nodeIds.indexOf(nid))}
                annotations={annotations}
              />
              <div className="sheet-foot">
                <button type="button" className="icon-btn" onClick={() => go(0)} aria-label="First move"><Icon name="first" /></button>
                <button type="button" className="icon-btn" onClick={() => go(maxPos)} aria-label="Last move"><Icon name="last" /></button>
                <span className="spacer" />
                <span>{analysis.settings.engine ?? 'Stockfish'}, depth {analysis.settings.depth}</span>
              </div>
            </section>
          )}
          <div className="board-toolbar review-tools" role="toolbar" aria-label="Review actions">
            <button type="button" className="tool" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
              <Icon name="flip" /> <span>Flip</span>
            </button>
            <button type="button" className="tool" onClick={openInAnalysis}>
              <Icon name="board" /> <span>Open on analysis board</span>
            </button>
            <span className="tool-right">
              <button type="button" className="tool" onClick={remove}>
                <Icon name="trash" /> <span>Delete review</span>
              </button>
            </span>
          </div>
        </section>

        <aside className="review-right" aria-label="Review">
          <section className="card acc-card summary">
            <div className="card-head">
              <h2>Accuracy</h2>
              <span className="right"><span className="badge brass">{myColor === 'both' ? 'Both sides' : `You played ${myColor}`}</span></span>
            </div>
            <div className="card-body">
              <div className="acc-top">
                <div className="acc-big">{accMine?.toFixed(1) ?? '–'}<small>{mineSide === 'white' ? 'W' : 'B'}</small></div>
                <div className="acc-who"><span className="name">{mineSide === 'white' ? 'White' : 'Black'}</span><span className="sub">{nameOf(mineSide)}</span></div>
                <span className="acc-divider">/</span>
                <div className="acc-big other">{accOther?.toFixed(1) ?? '–'}<small>{otherSide === 'white' ? 'W' : 'B'}</small></div>
                <div className="acc-who"><span className="name">{otherSide === 'white' ? 'White' : 'Black'}</span><span className="sub">{nameOf(otherSide)}</span></div>
                {accMine !== null && accOther !== null && (
                  <span className={`acc-delta ${accMine - accOther < 0 ? 'neg' : ''}`}>{accMine - accOther >= 0 ? '+' : '−'}{Math.abs(accMine - accOther).toFixed(1)}</span>
                )}
              </div>
              <div className="acc-bar" aria-hidden="true">
                <span className="mine" style={{ width: `${accMine ?? 0}%` }} />
                <span className="txt">{accMine?.toFixed(1) ?? '–'}% decision quality<span className="r">{nameOf(mineSide)}</span></span>
              </div>
              <div className="mix-row" aria-hidden="true">
                {COUNT_ROWS.map((c) => (mineCounts[c] ? <span key={c} className="seg" style={{ width: `${(mineCounts[c] / mixTotal) * 100}%`, background: `var(--cls-${c})` }} /> : null))}
                <span className="legend">{mineCounts.best ?? 0} best · {badCount} {badCount === 1 ? 'mistake' : 'mistakes'}</span>
              </div>
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
            </div>
          </section>

          <section className={`card move-card ${retryMove ? `cls-${retryMove.classification}` : move ? `cls-${move.classification}` : ''}`} aria-live="polite">
            {retry && retryMove ? (
              <>
                <div className="class-row">
                  <span className={`cls-badge cls-${retryMove.classification}`}>Retry</span>
                  <h2 className="move-card-title">Find a better move than {retryMove.move_number}{retryMove.color === 'white' ? '.' : '...'}{retryMove.san}</h2>
                </div>
                <div className="move-body">
                  <p className="explain">{retryMove.color === 'white' ? 'White' : 'Black'} to move. Play your move on the board.</p>
                  {retry.text && <p className={`retry-result retry-${retry.status}`}>{retry.text}</p>}
                  <div className="move-actions">
                    {(retry.status === 'wrong' || retry.status === 'close' || retry.status === 'correct') && (
                      <button type="button" className="btn btn-sm" onClick={() => startRetry(retryMove)}><Icon name="retry" size={15} /> Try again</button>
                    )}
                    <button type="button" className={`btn btn-sm ${retry.status === 'correct' ? 'btn-primary' : ''}`} onClick={() => { setRetry(null); setPos(retryMove.index + 1) }}>
                      <Icon name={retry.status === 'correct' ? 'check' : 'eye'} size={15} /> {retry.status === 'correct' ? 'Back to the review' : 'Show the answer'}
                    </button>
                  </div>
                </div>
              </>
            ) : move ? (
              <>
                <div className="class-row">
                  <span className={`cls-badge cls-${move.classification}`}>{CLASS_LABEL[move.classification]}{GLYPH[move.classification] ? ` ${GLYPH[move.classification]}` : ''}</span>
                  <h2 className="san move-card-san">{move.move_number}{move.color === 'white' ? '.' : '...'}{move.san}</h2>
                  <span className="move-eval">
                    <span className="was">{formatEval(move.eval_before)}</span><span aria-hidden="true">→</span><span className="now move-card-eval">{move.eval_after_text}</span>
                  </span>
                </div>
                <div className="move-body">
                  <p className="explain explanation">{move.explanation}</p>
                  {BAD.includes(move.classification) && review && (
                    <CoachBox key={move.index} reviewId={review.id} move={move} onResult={saveCoach} />
                  )}
                  {move.best && move.best.uci !== move.uci && move.classification !== 'forced' && (
                    <p className="best-line"><span className="lab">Best line </span><LineText fen={move.fen_before} sans={move.best_line_san} /></p>
                  )}
                  {move.reply_line_san.length > 0 && BAD.includes(move.classification) && (
                    <p className="best-line"><span className="lab">After your move </span><LineText fen={move.fen_after} sans={move.reply_line_san.slice(0, 6)} /></p>
                  )}
                  <p className="dim small win-line">
                    Winning chance {move.win_before.toFixed(0)}% before, {move.win_after.toFixed(0)}% after.
                  </p>
                  <div className="move-actions mistake-nav">
                    {BAD.includes(move.classification) && isMine(move) && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => startRetry(move)}>
                        <Icon name="retry" size={15} /> Retry this move
                      </button>
                    )}
                    <span className="spacer" />
                    <button type="button" className="btn btn-sm btn-ghost" onClick={prevMistake} disabled={!mistakeIndexes.some((i) => i + 1 < pos)}>
                      <Icon name="prev" size={14} /> Previous mistake
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={nextMistake} disabled={!mistakeIndexes.some((i) => i + 1 > pos)}>
                      Next mistake <Icon name="next" size={14} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="class-row"><h2 className="move-card-title san">Starting position</h2></div>
                <div className="move-body">
                  <p className="explain explanation">
                    {mistakeIndexes.length
                      ? `${mistakeIndexes.length} ${mistakeIndexes.length === 1 ? 'move needs' : 'moves need'} a second look. Press N or use the button below to jump to each one, then try to find the better move yourself.`
                      : 'No inaccuracies, mistakes or blunders on your side. Step through the game with the arrow keys.'}
                  </p>
                  <div className="move-actions mistake-nav">
                    <span className="spacer" />
                    <button type="button" className="btn btn-sm btn-ghost" onClick={prevMistake} disabled={!mistakeIndexes.some((i) => i + 1 < pos)}>
                      <Icon name="prev" size={14} /> Previous mistake
                    </button>
                    <button type="button" className={`btn btn-sm ${mistakeIndexes.length ? 'btn-primary' : 'btn-ghost'}`} onClick={nextMistake} disabled={!mistakeIndexes.some((i) => i + 1 > pos)}>
                      Next mistake <Icon name="next" size={14} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>

          {turning.length > 0 && (
            <section className="card turning-card">
              <div className="card-head">
                <h2>Turning points</h2>
                <span className="right">{turning.length} to review</span>
              </div>
              <div className="tp-list">
                {turning.map((m) => (
                  <button type="button" key={m.index} className={`tp-row ${pos === m.index + 1 ? 'on' : ''}`} onClick={() => go(m.index + 1)} aria-label={`Go to ${moveLabel(m)}`}>
                    <span className="tp-no">{m.move_number}{m.color === 'white' ? '.' : '…'}</span>
                    <span className="tp-san">{m.san}</span>
                    <span className={`cls-badge cls-${m.classification}`}>{CLASS_LABEL[m.classification]} {GLYPH[m.classification]}</span>
                    <span className="tp-eval">{formatEval(m.eval_before)} → {m.eval_after_text}</span>
                    <span className="tp-go"><Icon name="chev" size={14} /></span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="review-keys">
            <span><kbd className="key">N</kbd> next mistake</span>
            <span><kbd className="key">P</kbd> previous</span>
            <span><kbd className="key">F</kbd> flip</span>
            <span className="spacer" />
            <span>Reviewed with {analysis.settings.engine ?? 'Stockfish'} · depth {analysis.settings.depth}</span>
          </div>
        </aside>
      </div>
    </div>
  )
}

/** One move in the strip under the graph: its glyph, its class colour, and whether it is on the board. */
function StripMove({ m, current, onGo }: { m: { index: number; san: string; classification: Classification }; current: boolean; onGo: (pos: number) => void }) {
  return (
    <button type="button" className={`strip-mv cls-${m.classification}`} aria-current={current ? 'true' : undefined} onClick={() => onGo(m.index + 1)}>
      {m.san}{GLYPH[m.classification] ?? ''}
    </button>
  )
}
