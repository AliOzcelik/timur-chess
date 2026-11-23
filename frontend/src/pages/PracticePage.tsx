import { useEffect, useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useLoad } from '../hooks/useLoad'
import { useOpening } from '../hooks/useOpening'
import { api, type Puzzle, type PuzzleCheck, type RepEdge, type Side } from '../lib/api'
import { START_FEN, numberedLine, playUci, turnOf, uciSquares } from '../lib/chess'
import { openPositionOnBoard } from '../lib/open'
import { navigate } from '../lib/router'
import { createTree, addMove, toPgn } from '../lib/tree'
import { useAnalysis } from '../state/analysis'
import { useHealth } from '../state/health'
import { progressLabel } from './EndgamesPage'
import { formatPgnDate } from './ReviewListPage'

interface Ply {
  uci: string
  san: string
  fen: string
}

function MoveText({ start, plies }: { start: string; plies: Ply[] }) {
  if (!plies.length) return <p className="muted small">No moves yet.</p>
  return (
    <p className="line-text">
      {numberedLine(start, plies.map((p) => p.san)).map((m) => (
        <span key={m.index}>{m.label && <span className="pv-num">{m.label} </span>}{m.san} </span>
      ))}
    </p>
  )
}

// ---- play the engine --------------------------------------------------------------------

const LEVELS = [
  { elo: 1350, label: 'Club beginner', detail: 'about 1350' },
  { elo: 1600, label: 'Club player', detail: 'about 1600' },
  { elo: 1850, label: 'Strong club', detail: 'about 1850' },
  { elo: 2100, label: 'Expert', detail: 'about 2100' },
  { elo: 2400, label: 'Master', detail: 'about 2400' },
  { elo: 0, label: 'Full strength', detail: 'Stockfish 19' },
]

function PlayTab() {
  const [setup, setSetup] = useState(true)
  const [color, setColor] = useState<Side>('white')
  const [elo, setElo] = useState(1600)
  const [start, setStart] = useState(START_FEN)
  const [plies, setPlies] = useState<Ply[]>([])
  const [over, setOver] = useState<{ result: string; reason: string } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const game = useRef(0)

  const fen = plies.length ? plies[plies.length - 1].fen : start
  const myTurn = turnOf(fen) === color && !over && !thinking
  const opening = useOpening(start, plies.map((p) => p.uci))

  const botMove = async (current: Ply[]) => {
    const g = game.current
    setThinking(true)
    try {
      const res = await api.botMove(start, current.map((p) => p.uci), elo || null)
      if (g !== game.current) return
      if (res.move) {
        const lastFen = current.length ? current[current.length - 1].fen : start
        const m = playUci(lastFen, res.move.uci)
        if (m) setPlies([...current, { uci: m.uci, san: m.san, fen: m.fen }])
      }
      if (res.over) setOver({ result: res.over.result, reason: res.over.reason })
    } catch (e) {
      if (g === game.current) setError((e as Error).message)
    } finally {
      if (g === game.current) setThinking(false)
    }
  }

  const begin = () => {
    game.current += 1
    setPlies([])
    setOver(null)
    setSaved(null)
    setError(null)
    setSetup(false)
    if (turnOf(start) !== color) botMove([])
  }

  const play = async (uci: string) => {
    const m = playUci(fen, uci)
    if (!m) return
    const next = [...plies, { uci: m.uci, san: m.san, fen: m.fen }]
    setPlies(next)
    botMove(next)
  }

  const resign = () => {
    if (!window.confirm('Resign this game?')) return
    game.current += 1
    setThinking(false)
    setOver({ result: color === 'white' ? '0-1' : '1-0', reason: 'resignation' })
  }

  const pgn = () => {
    let tree = createTree(start, {
      Event: 'Practice game', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      White: color === 'white' ? 'You' : `Stockfish ${elo || 'full'}`, Black: color === 'black' ? 'You' : `Stockfish ${elo || 'full'}`,
      Result: over?.result ?? '*',
    })
    let id = tree.rootId
    for (const p of plies) {
      const r = addMove(tree, id, p.uci)
      if (!r) break
      tree = r.tree
      id = r.id
    }
    return toPgn(tree)
  }

  const finish = async (review: boolean) => {
    try {
      const r = await api.finishGame(pgn(), color, review)
      if (review && r.id) navigate(`/review/${r.id}`)
      else setSaved('Saved in the library.')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (setup) {
    return (
      <div className="panel play-setup">
        <h2>New game against Stockfish</h2>
        <fieldset className="choice-group">
          <legend>You play</legend>
          <label><input type="radio" name="pc" checked={color === 'white'} onChange={() => setColor('white')} /> White</label>
          <label><input type="radio" name="pc" checked={color === 'black'} onChange={() => setColor('black')} /> Black</label>
        </fieldset>
        <fieldset className="choice-group stacked">
          <legend>Strength</legend>
          {LEVELS.map((l) => (
            <label key={l.elo}>
              <input type="radio" name="lvl" checked={elo === l.elo} onChange={() => setElo(l.elo)} />
              <span><strong>{l.label}</strong> <span className="muted">{l.detail}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset className="choice-group">
          <legend>Start from</legend>
          <label><input type="radio" name="st" checked={start === START_FEN} onChange={() => setStart(START_FEN)} /> The starting position</label>
          <label>
            <input type="radio" name="st" checked={start !== START_FEN} onChange={() => {
              const { tree, currentId } = useAnalysis.getState()
              setStart(tree.nodes[currentId].fen)
            }} /> The position on the analysis board
          </label>
        </fieldset>
        <p className="muted small">Strength uses Stockfish’s own rating limiter, which is calibrated against human-like play at long time controls.</p>
        <button type="button" className="btn btn-primary" onClick={begin}>Start the game</button>
      </div>
    )
  }

  return (
    <div className="analysis-layout">
      <section className="board-column" aria-label="Board">
        <div className="board-area no-bar">
          <Board fen={fen} orientation={color} lastMove={uciSquares(plies[plies.length - 1]?.uci) as [Key, Key] | undefined}
            movable={myTurn ? 'turn' : null} onMove={play} />
        </div>
        <div className="board-toolbar" role="toolbar" aria-label="Game actions">
          <button type="button" className="tool" onClick={resign} disabled={Boolean(over)}><Icon name="close" /> <span>Resign</span></button>
          <button type="button" className="tool" onClick={() => setSetup(true)}><Icon name="plus" /> <span>New game</span></button>
        </div>
      </section>
      <aside className="side-panel">
        <section className="panel">
          <h2>{LEVELS.find((l) => l.elo === elo)?.label ?? 'Stockfish'}</h2>
          {opening && <p className="small"><span className="eco">{opening.eco}</span> {opening.name}</p>}
          <p role="status" aria-live="polite">
            {over ? <strong>Game over: {over.result}, {over.reason}.</strong> : thinking ? 'Stockfish is thinking…' : myTurn ? 'Your move.' : ''}
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          {over && (
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => finish(true)}>Review this game</button>
              <button type="button" className="btn" onClick={() => finish(false)}>Save to library</button>
            </div>
          )}
          {saved && <p className="muted small">{saved}</p>}
        </section>
        <section className="panel">
          <h2>Moves</h2>
          <MoveText start={start} plies={plies} />
        </section>
      </aside>
    </div>
  )
}

// ---- puzzles from your own games -----------------------------------------------------------

function PuzzlesTab() {
  const [onlyEndgames, setOnlyEndgames] = useState(false)
  const list = useLoad(() => api.puzzles(onlyEndgames ? true : undefined), [onlyEndgames])
  const [index, setIndex] = useState(0)
  const [result, setResult] = useState<PuzzleCheck | null>(null)
  const [tried, setTried] = useState<Ply | null>(null)
  const [checking, setChecking] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [failedOnce, setFailedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const puzzles = list.data?.puzzles ?? []
  const p: Puzzle | undefined = puzzles[index]

  useEffect(() => {
    setResult(null)
    setTried(null)
    setRevealed(false)
    setFailedOnce(false)
    setError(null)
  }, [index, list.data])

  if (list.data && puzzles.length === 0) {
    return (
      <div className="empty-state">
        <h2>No puzzles yet</h2>
        <p>Puzzles are made from your own mistakes and blunders. Review a few of your games (with your colour set), and each mistake becomes a position to solve here.</p>
        <a className="btn btn-primary" href="#/review/new">Review a game</a>
      </div>
    )
  }
  if (!p) return list.error ? <p className="form-error">{list.error}</p> : <p className="muted">Loading…</p>

  const attempt = async (uci: string) => {
    const m = playUci(p.fen, uci)
    if (!m) return
    setTried({ uci: m.uci, san: m.san, fen: m.fen })
    setChecking(true)
    try {
      const r = await api.checkPuzzle(p.fen, uci, p.best.uci)
      setResult(r)
      if (r.correct) await api.trainingResult(p.id, 'puzzle', failedOnce ? 'hard' : 'good')
      else if (!failedOnce) {
        setFailedOnce(true)
        await api.trainingResult(p.id, 'puzzle', 'again')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const retry = () => {
    setTried(null)
    setResult(null)
  }

  const shown = tried && result && !result.correct && !revealed ? tried.fen : tried && result?.correct ? tried.fen : p.fen
  const shapes: DrawShape[] = []
  if (revealed || result?.correct) {
    const sq = uciSquares(p.best.uci)
    if (sq && !result?.correct) shapes.push({ orig: sq[0], dest: sq[1], brush: 'green' })
  }
  const played = uciSquares(p.played.uci)
  if (!tried && played && revealed) shapes.push({ orig: played[0], dest: played[1], brush: 'red' })
  const prog = progressLabel(p.progress)

  return (
    <div className="analysis-layout">
      <section className="board-column" aria-label="Puzzle board">
        <div className="board-area no-bar">
          <Board fen={revealed ? p.fen : shown} orientation={p.color}
            lastMove={uciSquares(tried?.uci) as [Key, Key] | undefined}
            movable={!tried && !revealed ? 'turn' : null} shapes={shapes} onMove={attempt} />
        </div>
        <div className="board-toolbar" role="toolbar" aria-label="Puzzle actions">
          <button type="button" className="tool" disabled={index === 0} onClick={() => setIndex(index - 1)}><Icon name="prev" /> <span>Previous</span></button>
          <button type="button" className="tool" disabled={index + 1 >= puzzles.length} onClick={() => setIndex(index + 1)}><Icon name="next" /> <span>Next puzzle</span></button>
          <button type="button" className="tool" onClick={() => openPositionOnBoard(p.fen, p.color)}><Icon name="board" /> <span>Analyse</span></button>
        </div>
      </section>
      <aside className="side-panel">
        <section className="panel">
          <div className="row-between">
            <span className="muted small">Puzzle {index + 1} of {puzzles.length}</span>
            <label className="switch">
              <input type="checkbox" checked={onlyEndgames} onChange={(e) => { setOnlyEndgames(e.target.checked); setIndex(0) }} />
              <span className="switch-track" aria-hidden="true" />
              <span className="small">Endgames only</span>
            </label>
          </div>
          <h2>{p.color === 'white' ? 'White' : 'Black'} to move</h2>
          <p>
            In your game {p.white ?? '?'} vs {p.black ?? '?'}{p.date && formatPgnDate(p.date) ? ` (${formatPgnDate(p.date)})` : ''}, you played
            {' '}<strong>{p.move_number}{p.color === 'white' ? '.' : '...'} {p.played.san}</strong>, a {p.classification}. Find a better move.
          </p>
          {p.opening && <p className="muted small"><span className="eco">{p.eco}</span> {p.opening}</p>}
          <span className={`prog ${prog.cls}`}>{prog.text}</span>

          <div className="drill-status" role="status" aria-live="polite">
            {checking && <p className="muted">Checking…</p>}
            {result?.correct && (
              <div className="drill-result drill-good">
                <p><strong>{result.exact ? `Yes: ${result.san} is the engine’s move.` : `${result.san} works too: it keeps the advantage.`}</strong></p>
                {p.best_line_san.length > 0 && <p className="muted small">Engine line: {p.best_line_san.join(' ')}</p>}
                {index + 1 < puzzles.length && <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>Next puzzle</button>}
              </div>
            )}
            {result && !result.correct && !revealed && (
              <div className="drill-result drill-bad">
                <p><strong>{result.san} is not it.</strong> It loses about {Math.round(result.loss)} points of winning chance.</p>
                {result.reply_line && result.reply_line.length > 0 && <p className="muted small">After {result.san}: {result.reply_line.join(' ')}</p>}
                <div className="row">
                  <button type="button" className="btn btn-primary" onClick={retry}>Try again</button>
                  <button type="button" className="btn" onClick={() => setRevealed(true)}>Show the answer</button>
                </div>
              </div>
            )}
            {revealed && (
              <div className="drill-result">
                <p>The move was <strong>{p.best.san}</strong>. {p.explanation}</p>
                {p.best_line_san.length > 0 && <p className="muted small">Line: {p.best_line_san.join(' ')}</p>}
                <div className="row">
                  {index + 1 < puzzles.length && <button type="button" className="btn btn-primary" onClick={() => setIndex(index + 1)}>Next puzzle</button>}
                  <a className="btn" href={`#/review/${p.review_id}`}>See the game review</a>
                </div>
              </div>
            )}
            {!tried && !revealed && <button type="button" className="btn btn-small btn-quiet" onClick={() => setRevealed(true)}>Give up and show the answer</button>}
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        </section>
      </aside>
    </div>
  )
}

// ---- opening repertoire -----------------------------------------------------------------------

function RepertoireTab() {
  const [color, setColor] = useState<Side>('white')
  const rep = useLoad(() => api.repertoire(color), [color])
  const [mode, setMode] = useState<'build' | 'train'>('build')
  const [path, setPath] = useState<{ ply: Ply; edge: RepEdge | null }[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [wrong, setWrong] = useState<RepEdge | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [busy, setBusy] = useState(false)
  const trainRef = useRef(0)

  const edges = rep.data?.edges ?? []
  const fen = path.length ? path[path.length - 1].ply.fen : START_FEN
  const epd = path.length ? path[path.length - 1].edge?.to_epd ?? null : rep.data?.root_epd ?? null
  const here = useMemo(() => (epd ? edges.filter((e) => e.from_epd === epd) : []), [edges, epd])
  const myTurn = turnOf(fen) === color
  const opening = useOpening(START_FEN, path.map((p) => p.ply.uci))
  const offBook = path.length > 0 && !path[path.length - 1].edge

  useEffect(() => {
    setPath([])
    setMessage(null)
    setWrong(null)
  }, [color, mode])

  const push = (uci: string, edge: RepEdge | null) => {
    const m = playUci(fen, uci)
    if (!m) return null
    const next = [...path, { ply: { uci: m.uci, san: m.san, fen: m.fen }, edge }]
    setPath(next)
    return next
  }

  // Training: the app plays the opponent's moves from your repertoire, you answer.
  const opponentMove = (currentEpd: string | null, currentFen: string, currentPath: typeof path) => {
    const options = edges.filter((e) => e.from_epd === currentEpd)
    if (!options.length) {
      setMessage('End of your prepared line. Well done.')
      return
    }
    const pick = options[Math.floor(Math.random() * options.length)]
    const m = playUci(currentFen, pick.uci)
    if (!m) return
    const token = ++trainRef.current
    window.setTimeout(() => {
      if (token !== trainRef.current) return
      setPath([...currentPath, { ply: { uci: m.uci, san: m.san, fen: m.fen }, edge: pick }])
    }, 350)
  }

  const startTraining = () => {
    setPath([])
    setWrong(null)
    setMessage('Play your repertoire move.')
    if (color === 'black') opponentMove(rep.data?.root_epd ?? null, START_FEN, [])
  }

  useEffect(() => {
    if (mode === 'train' && rep.data) startTraining()
  }, [mode, rep.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMove = async (uci: string) => {
    const known = here.find((e) => e.uci === uci) ?? null
    if (mode === 'train') {
      const expected = here
      if (!expected.length) return
      if (!known) {
        setWrong(expected[0])
        setMessage(`Your repertoire plays ${expected.map((e) => e.san).join(' or ')} here.`)
        await api.trainingResult(`rep:${expected[0].id}`, 'rep', 'again').catch(() => {})
        return
      }
      setWrong(null)
      setMessage(known.comment ? `Right. ${known.comment}` : 'Right.')
      await api.trainingResult(`rep:${known.id}`, 'rep', 'good').catch(() => {})
      const next = push(uci, known)
      if (next) opponentMove(known.to_epd, next[next.length - 1].ply.fen, next)
      return
    }
    // Build mode: moves you play are added to the repertoire (yours and the replies you prepare for).
    if (known || offBook) {
      push(uci, known)
      return
    }
    setBusy(true)
    try {
      const { id } = await api.addRepMove(color, fen, uci)
      const fresh = await api.repertoire(color)
      rep.setData(fresh)
      const edge = fresh.edges.find((e) => e.id === id) ?? null
      const m = playUci(fen, uci)
      if (m) setPath([...path, { ply: { uci: m.uci, san: m.san, fen: m.fen }, edge }])
      setMessage(null)
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const removeEdge = async (e: RepEdge) => {
    if (!window.confirm(`Remove ${e.san} and everything after it from your repertoire?`)) return
    await api.deleteRepMove(e.id)
    rep.reload()
  }

  const doImport = async () => {
    try {
      const r = await api.importRepertoire(color, importText)
      setMessage(`${r.added} moves added.${r.conflict_count ? ` ${r.conflict_count} skipped because your repertoire already has a different move there.` : ''}`)
      setImportOpen(false)
      setImportText('')
      rep.reload()
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  const exportPgn = async () => {
    const { pgn } = await api.exportRepertoire(color)
    try {
      await navigator.clipboard.writeText(pgn)
      setMessage('Repertoire PGN copied.')
    } catch {
      setMessage('Could not copy: the browser blocked the clipboard.')
    }
  }

  const shapes: DrawShape[] = []
  if (mode === 'build' || wrong) {
    for (const e of mode === 'build' ? here : wrong ? [wrong] : []) {
      const sq = uciSquares(e.uci)
      if (sq) shapes.push({ orig: sq[0], dest: sq[1], brush: (turnOf(fen) === color) ? 'green' : 'paleBlue' })
    }
  }
  const mine = edges.filter((e) => e.progress).length
  const dueCount = edges.filter((e) => e.progress?.due).length

  return (
    <div className="analysis-layout">
      <section className="board-column" aria-label="Repertoire board">
        <div className="board-area no-bar">
          <Board fen={fen} orientation={color} lastMove={uciSquares(path[path.length - 1]?.ply.uci) as [Key, Key] | undefined}
            movable={busy || (mode === 'train' && !myTurn) ? null : 'turn'} shapes={shapes} onMove={onMove} />
        </div>
        <div className="board-toolbar" role="toolbar" aria-label="Repertoire actions">
          <button type="button" className="tool" onClick={() => { trainRef.current++; setPath(path.slice(0, -1)); setWrong(null) }} disabled={!path.length}>
            <Icon name="prev" /> <span>Back</span>
          </button>
          <button type="button" className="tool" onClick={() => (mode === 'train' ? startTraining() : setPath([]))}>
            <Icon name="first" /> <span>{mode === 'train' ? 'Start over' : 'Start position'}</span>
          </button>
          <button type="button" className="tool" onClick={() => setImportOpen(true)}><Icon name="import" /> <span>Import PGN</span></button>
          <button type="button" className="tool" onClick={exportPgn} disabled={!edges.length}><Icon name="copy" /> <span>Copy as PGN</span></button>
        </div>
      </section>
      <aside className="side-panel">
        <section className="panel">
          <div className="row-between">
            <div className="seg" role="tablist" aria-label="Repertoire colour">
              <button type="button" role="tab" aria-selected={color === 'white'} className={color === 'white' ? 'seg-on' : ''} onClick={() => setColor('white')}>As White</button>
              <button type="button" role="tab" aria-selected={color === 'black'} className={color === 'black' ? 'seg-on' : ''} onClick={() => setColor('black')}>As Black</button>
            </div>
            <div className="seg" role="tablist" aria-label="Mode">
              <button type="button" role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'seg-on' : ''} onClick={() => setMode('build')}>Build</button>
              <button type="button" role="tab" aria-selected={mode === 'train'} className={mode === 'train' ? 'seg-on' : ''} onClick={() => setMode('train')} disabled={!edges.length}>Train</button>
            </div>
          </div>
          {opening && <p className="small"><span className="eco">{opening.eco}</span> {opening.name}</p>}
          {mode === 'build' ? (
            <>
              <p className="muted small">
                Play moves on the board to add them: your move in each position, and the opponent replies you want to be ready for.
                {offBook && ' You left your repertoire; moves here are not saved. Go back to add a move.'}
              </p>
              {here.length > 0 ? (
                <ul className="rep-moves">
                  {here.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="mv-btn" onClick={() => push(e.uci, e)}>{e.san}</button>
                      <span className="muted small">{myTurn ? 'your move' : 'their reply'}{e.opening ? `, ${e.opening.name}` : ''}</span>
                      <button type="button" className="icon-btn" onClick={() => removeEdge(e)} aria-label={`Remove ${e.san}`}><Icon name="trash" size={15} /></button>
                    </li>
                  ))}
                </ul>
              ) : (
                !offBook && <p className="small">{myTurn ? 'Play the move you want in this position.' : 'Play the opponent replies you expect.'}</p>
              )}
            </>
          ) : (
            <p className="muted small">Timur plays the opponent’s moves from your repertoire, picking at random. Play your prepared answer.</p>
          )}
          {message && <p role="status" className={wrong ? 'form-error' : ''}>{message}</p>}
        </section>
        <section className="panel">
          <h2>Your {color} repertoire</h2>
          {edges.length === 0 ? (
            <p className="empty">Empty. Start by playing your first move on the board, or import a PGN with your lines (variations included).</p>
          ) : (
            <p className="small">{edges.length} moves saved. {mine} trained, {dueCount} due for review.</p>
          )}
          <MoveText start={START_FEN} plies={path.map((p) => p.ply)} />
        </section>
      </aside>
      <Modal title={`Import ${color} repertoire`} open={importOpen} onClose={() => setImportOpen(false)} wide>
        <p className="muted small">Paste a PGN with your lines. Variations are added too, up to move 15. Comments become notes on the moves.</p>
        <textarea className="input mono-ish" rows={10} value={importText} onChange={(e) => setImportText(e.target.value)}
          placeholder="1. e4 c5 (1... e5 2. Nf3 Nc6 3. Bb5) 2. Nf3 d6 3. d4" />
        <div className="row row-end" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-quiet" onClick={() => setImportOpen(false)}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={doImport} disabled={!importText.trim()}>Import</button>
        </div>
      </Modal>
    </div>
  )
}

const TABS = [
  { id: 'play', label: 'Play the engine' },
  { id: 'puzzles', label: 'Puzzles from your games' },
  { id: 'repertoire', label: 'Opening repertoire' },
]

export function PracticePage({ tab }: { tab: string }) {
  const current = TABS.some((t) => t.id === tab) ? tab : 'play'
  const trainer = useHealth((h) => h.health?.engines.trainer)
  return (
    <div className="page practice-page">
      <header className="page-head">
        <h1>Practice</h1>
        <p className="page-sub">Play at your level, solve the positions you got wrong, and drill your openings.</p>
      </header>
      <nav className="tabs" aria-label="Practice">
        {TABS.map((t) => (
          <a key={t.id} href={`#/practice/${t.id}`} className="tab" aria-current={current === t.id ? 'page' : undefined}>{t.label}</a>
        ))}
      </nav>
      {trainer?.error && <p className="form-error">{trainer.error}</p>}
      {current === 'play' && <PlayTab />}
      {current === 'puzzles' && <PuzzlesTab />}
      {current === 'repertoire' && <RepertoireTab />}
    </div>
  )
}

