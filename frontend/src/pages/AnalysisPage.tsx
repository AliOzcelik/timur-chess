import { useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { BoardShell, PlayerStrip } from '../components/BoardShell'
import { Masthead, Meta } from '../components/Masthead'
import { EngineLines } from '../components/EngineLines'
import { EvalBar } from '../components/EvalBar'
import { Icon } from '../components/Icon'
import { ImportDialog } from '../components/ImportDialog'
import { PositionEditor } from '../components/PositionEditor'
import { PositionNotes } from '../components/PositionNotes'
import { Scoresheet } from '../components/Scoresheet'
import { fullmoveOf, isCheck, turnOf, uciSquares } from '../lib/chess'
import { formatEval, evalSide, type Eval } from '../lib/evals'
import { useOpening } from '../hooks/useOpening'
import { api } from '../lib/api'
import { useShortcuts } from '../lib/keys'
import { navigate } from '../lib/router'
import { hasMoves, isOnMainline, movesTo, toPgn } from '../lib/tree'
import { useAnalysis, useReviewDraft } from '../state/analysis'
import { useLiveAnalysis, useEngine, type EngineInfo } from '../state/engine'
import { useHealth } from '../state/health'

const DEPTHS: { value: number | null; label: string }[] = [
  { value: 20, label: '20' },
  { value: 25, label: '25' },
  { value: 30, label: '30' },
  { value: 40, label: '40' },
  { value: null, label: 'No limit' },
]

const placement = (fen: string) => fen.split(' ')[0]

function arrowsFor(info: EngineInfo, threat: boolean): DrawShape[] {
  const shapes: DrawShape[] = []
  const seen = new Set<string>()
  info.lines.forEach((line, i) => {
    const sq = uciSquares(line.uci[0])
    if (!sq) return
    const key = sq.join('')
    if (seen.has(key)) return
    seen.add(key)
    const brush = threat ? 'threat' : i === 0 ? 'green' : i === 1 ? 'paleGreen' : 'paleGrey'
    shapes.push({ orig: sq[0], dest: sq[1], brush })
  })
  return threat ? shapes.slice(0, 1) : shapes
}

export function AnalysisPage() {
  const s = useAnalysis()
  const engine = useEngine()
  const health = useHealth((h) => h.health)
  const [importOpen, setImportOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number>(undefined)

  const node = s.tree.nodes[s.currentId]
  const root = s.tree.nodes[s.tree.rootId]
  const moves = useMemo(() => movesTo(s.tree, s.currentId), [s.tree, s.currentId])
  const inCheck = isCheck(node.fen)
  const opening = useOpening(root.fen, moves)
  const [saving, setSaving] = useState(false)
  const threat = s.threat && !inCheck

  useLiveAnalysis({
    enabled: s.engineOn,
    fen: root.fen,
    moves,
    multipv: threat ? 1 : s.multipv,
    depth: s.depth,
    threat,
  })

  // Only trust engine output that belongs to the position on the board.
  const info = engine.info && engine.info.threat === threat && (threat
    ? placement(engine.info.fen) === placement(node.fen)
    : engine.info.fen.split(' ').slice(0, 2).join(' ') === node.fen.split(' ').slice(0, 2).join(' '))
    ? engine.info
    : null

  // Keep the last eval on the bar while the engine starts on a new position, so it doesn't flicker.
  const lastEval = useRef<Eval | null>(null)
  if (info && !threat) lastEval.current = info.terminal ?? info.lines[0]?.eval ?? lastEval.current
  if (!s.engineOn) lastEval.current = null
  const barEval = s.engineOn && !threat ? lastEval.current : null
  const headlineEval = info && !threat ? info.terminal ?? info.lines[0]?.eval ?? null : null

  const shapes = useMemo(
    () => (s.engineOn && s.arrows && info ? arrowsFor(info, threat) : []),
    [s.engineOn, s.arrows, info, threat],
  )

  const flash = (text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500)
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      flash(`${what} copied.`)
    } catch {
      flash(`Could not copy the ${what}. Your browser blocked the clipboard.`)
    }
  }

  const reviewThisGame = () => {
    if (!hasMoves(s.tree)) {
      flash('Play or import some moves first. The main line is what gets reviewed.')
      return
    }
    useReviewDraft.setState({ pgn: toPgn(s.tree, { variations: false }), myColor: s.orientation, gameId: s.gameId })
    navigate('/review/new')
  }

  const saveToLibrary = async () => {
    if (!hasMoves(s.tree)) {
      flash('Play or import some moves first.')
      return
    }
    setSaving(true)
    try {
      const named = Boolean(white || black)
      const res = await api.saveGame({
        pgn: toPgn(s.tree),
        kind: named ? 'game' : 'analysis',
        source: 'board',
        my_color: s.orientation,
      })
      s.setGameId(res.id)
      flash(res.created ? 'Saved in the library. Changes are saved automatically from now on.' : 'This game is already in the library. Changes are saved there.')
    } catch (e) {
      flash((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const newBoard = () => {
    if (hasMoves(s.tree) && !window.confirm('Start a new analysis? The moves on the board will be removed.')) return
    s.reset()
  }

  useShortcuts({
    ArrowLeft: () => s.back(),
    ArrowRight: () => s.forward(),
    ArrowUp: () => s.toStart(),
    ArrowDown: () => s.toEnd(),
    Home: () => s.toStart(),
    End: () => s.toEnd(),
    ' ': () => s.setSettings({ engineOn: !s.engineOn }),
    f: () => s.flip(),
    x: () => { if (!inCheck) s.setThreat(!s.threat) },
  })

  const liveStatus = health?.engines.live
  const white = s.tree.headers.White && s.tree.headers.White !== '?' ? s.tree.headers.White : null
  const black = s.tree.headers.Black && s.tree.headers.Black !== '?' ? s.tree.headers.Black : null
  const turn = turnOf(node.fen)
  const toMove = turn === 'white' ? 'White' : 'Black'
  const event = s.tree.headers.Event && s.tree.headers.Event !== '?' ? s.tree.headers.Event : null
  const roundTag = s.tree.headers.Round && s.tree.headers.Round !== '?' && s.tree.headers.Round !== '-' ? s.tree.headers.Round : null
  const plies = useMemo(() => {
    let n = 0
    let cur = s.tree.nodes[s.tree.rootId]
    while (cur.children.length) { n++; cur = s.tree.nodes[cur.children[0]] }
    return n
  }, [s.tree])
  const ply = moves.length
  const lastSan = node.san ? `${fullmoveOf(s.tree.nodes[node.parentId!].fen)}${turnOf(s.tree.nodes[node.parentId!].fen) === 'white' ? '.' : '…'} ${node.san}` : null

  const topSide = s.orientation === 'white' ? 'black' : 'white'
  const bottomSide = s.orientation
  const nameOf = (side: 'white' | 'black') => (side === 'white' ? white : black)
  const ratingOf = (side: 'white' | 'black') => s.tree.headers[side === 'white' ? 'WhiteElo' : 'BlackElo'] || null

  const saveText = s.saveState === 'saving' ? 'Saving…' : s.saveState === 'error' ? 'Not saved — server offline' : 'Saved to library'

  return (
    <div className="page analysis-page">
      <Masthead
        section="Study"
        page="Analysis"
        title="Analysis board"
        sub={
          <Meta items={[
            white || black ? <span className="strong">{`${white ?? 'Unknown'} vs ${black ?? 'Unknown'}`}</span> : `${toMove} to move`,
            event ? `${event}${roundTag ? ` · Round ${roundTag}` : ''}` : null,
            opening ? <span className="opening-name" title={`ECO ${opening.eco}`}><span className="eco">{opening.eco}</span> {opening.name}</span> : null,
            s.gameId ? (
              <a className={`save-state save-${s.saveState}`} href="#/library">
                <Icon name={s.saveState === 'error' ? 'info' : 'check'} size={15} />{saveText}
              </a>
            ) : null,
          ]} />
        }
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={newBoard}><Icon name="plus" />New board</button>
            <button type="button" className="btn btn-primary" onClick={reviewThisGame}><Icon name="spark" />Review this game</button>
          </>
        }
      />

      <div className="analysis-grid">
        <section className="board-col" aria-label="Board">
          <BoardShell
            top={<PlayerStrip position="top" name={nameOf(topSide)} rating={ratingOf(topSide)} side={topSide} toMove={turn === topSide} />}
            bottom={<PlayerStrip position="bottom" name={nameOf(bottomSide)} rating={ratingOf(bottomSide)} side={bottomSide} toMove={turn === bottomSide} />}
            evalBar={<EvalBar value={barEval} orientation={s.orientation} hidden={!s.engineOn || threat} />}
          >
            <Board
              fen={node.fen}
              orientation={s.orientation}
              lastMove={uciSquares(node.uci) as [Key, Key] | undefined}
              movable="turn"
              shapes={shapes}
              onMove={(uci) => s.play(uci)}
            />
          </BoardShell>
          <div className="board-toolbar" role="toolbar" aria-label="Board actions">
            <button type="button" className="tool" onClick={() => s.flip()} title="Flip board (F)" aria-label="Flip board">
              <Icon name="flip" /><span>Flip</span>
            </button>
            <button type="button" className="tool" onClick={() => setEditorOpen(true)} aria-label="Set up position" title="Set up position">
              <Icon name="edit" /><span>Set up</span>
            </button>
            <button type="button" className="tool" onClick={newBoard} aria-label="New" title="New board">
              <Icon name="plus" /><span>New</span>
            </button>
            <span className="tool-sep" aria-hidden="true" />
            <button type="button" className="tool" onClick={() => setImportOpen(true)}>
              <Icon name="import" /><span>Import</span>
            </button>
            <button type="button" className="tool" onClick={() => copy(toPgn(s.tree), 'PGN')} aria-label="Copy PGN" title="Copy the game as PGN">
              <Icon name="copy" /><span>PGN</span>
            </button>
            <button type="button" className="tool" onClick={() => copy(node.fen, 'FEN')} aria-label="Copy FEN" title="Copy this position as FEN">
              <Icon name="copy" /><span>FEN</span>
            </button>
            <span className="tool-right">
              {s.gameId ? (
                <span className="tool tool-quiet"><Icon name="save" /><span>{s.saveState === 'saving' ? 'Saving…' : s.saveState === 'error' ? 'Not saved' : 'Saved'}</span></span>
              ) : (
                <button type="button" className="tool" onClick={saveToLibrary} disabled={saving} aria-label="Save to library" title="Save to library">
                  <Icon name="save" /><span>Save</span>
                </button>
              )}
            </span>
          </div>
          <div className="board-status">
            <span className="status-msg notice" role="status" aria-live="polite">
              {notice ?? (lastSan ? <><Icon name="check" />{lastSan}{s.gameId && s.saveState === 'saved' ? ' · all changes saved' : ''}</> : null)}
            </span>
            <span className="spacer" />
            <span className="keys" aria-hidden="true">
              <kbd className="key">←</kbd><kbd className="key">→</kbd><span style={{ margin: '0 6px 0 1px' }}>browse</span>
              <kbd className="key">Space</kbd><span style={{ margin: '0 6px 0 1px' }}>engine</span>
              <kbd className="key">F</kbd><span style={{ marginLeft: 1 }}>flip</span>
            </span>
          </div>
        </section>

        <aside className="inspector" aria-label="Engine and moves">
          <section className="card engine-panel" aria-label="Engine">
            <div className="engine-head">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={s.engineOn}
                  onChange={(e) => s.setSettings({ engineOn: e.target.checked })}
                />
                <span className="switch-track" aria-hidden="true" />
                <span className="switch-label">Engine</span>
              </label>
              <div className="right">
                {s.engineOn && engine.connected && !liveStatus?.error && <span className="badge live"><span className="dot" />Live</span>}
                <span className="engine-name">{liveStatus?.name ?? 'Stockfish'}</span>
              </div>
            </div>
            <div className="eval-block">
              <span className={`big-eval side-${evalSide(headlineEval)}`} aria-live="off">
                {s.engineOn ? (threat ? 'Threat' : formatEval(headlineEval) || '…') : '—'}
              </span>
              <div className="eval-words">
                {s.engineOn ? (threat ? `What ${toMove === 'White' ? 'Black' : 'White'} threatens` : assess(headlineEval)) : 'Engine off'}
                <div className="sub">
                  {s.engineOn && info?.depth ? <><b>Depth {info.depth}</b>{s.depth ? ` of ${s.depth}` : ''}{info.nps ? ` · ${formatNps(info.nps)}` : ''}</> : s.engineOn ? 'Starting…' : 'Press Space to start'}
                </div>
              </div>
            </div>
            {liveStatus?.error && <p className="engine-error" role="alert">{liveStatus.error}</p>}
            {!engine.connected && <p className="engine-error">Connecting to the engine…</p>}

            <div className="engine-controls">
              <label className="select">
                <span>Lines</span>
                <select aria-label="Lines" value={s.multipv} onChange={(e) => s.setSettings({ multipv: Number(e.target.value) })} disabled={threat}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <Icon name="chevd" size={13} />
              </label>
              <label className="select">
                <span>Depth</span>
                <select
                  aria-label="Depth"
                  value={s.depth === null ? 'none' : String(s.depth)}
                  onChange={(e) => s.setSettings({ depth: e.target.value === 'none' ? null : Number(e.target.value) })}
                >
                  {DEPTHS.map((d) => <option key={d.label} value={d.value === null ? 'none' : String(d.value)}>{d.label}</option>)}
                </select>
                <Icon name="chevd" size={13} />
              </label>
              <span className="spacer" />
              <button
                type="button"
                className={`chip ${s.arrows ? 'chip-on' : ''}`}
                aria-pressed={s.arrows}
                onClick={() => s.setSettings({ arrows: !s.arrows })}
              >
                <Icon name="arrows" size={14} />Arrows
              </button>
              <button
                type="button"
                className={`chip chip-threat ${threat ? 'chip-on' : ''}`}
                aria-pressed={threat}
                disabled={inCheck}
                title={inCheck ? 'Not available while in check' : 'Show what the opponent threatens (X)'}
                onClick={() => s.setThreat(!s.threat)}
              >
                <Icon name="target" size={14} />Threat
              </button>
            </div>

            <EngineLines
              info={info}
              multipv={threat ? 1 : s.multipv}
              on={s.engineOn}
              threat={threat}
              error={engine.error}
              onPlay={(ucis) => s.playLine(ucis)}
            />
          </section>

          <section className="card moves-card moves-panel" aria-label="Moves">
            <div className="card-head">
              <h2>Moves</h2>
              <span className="right">{plies} {plies === 1 ? 'ply' : 'plies'}{isOnMainline(s.tree, node.id) ? ' · main line' : ' · side line'}</span>
            </div>
            <Scoresheet tree={s.tree} currentId={s.currentId} onSelect={s.goTo} />
            <div className="sheet-foot nav-bar">
              <button type="button" className="icon-btn" onClick={s.toStart} aria-label="First move" title="First move (↑)"><Icon name="first" /></button>
              <button type="button" className="icon-btn" onClick={s.back} aria-label="Previous move" title="Previous move (←)"><Icon name="prev" /></button>
              <button type="button" className="icon-btn" onClick={s.forward} aria-label="Next move" title="Next move (→)"><Icon name="next" /></button>
              <button type="button" className="icon-btn" onClick={s.toEnd} aria-label="Last move" title="Last move (↓)"><Icon name="last" /></button>
              {node.parentId && (
                <span className="node-actions">
                  {!isOnMainline(s.tree, node.id) && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => s.promote(node.id)} title="Make main line">
                      <Icon name="promote" size={15} />Make main line
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => s.remove(node.id)} title="Delete from here">
                    <Icon name="trash" size={15} />Delete from here
                  </button>
                </span>
              )}
              <span className="spacer" />
              <span>{ply === 0 ? 'Start' : `Ply ${ply} of ${plies}`}</span>
            </div>
          </section>

          <PositionNotes fen={node.fen} opening={opening} gameId={s.gameId} />
        </aside>
      </div>

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onLoad={(tree, note) => {
          s.load(tree, tree.rootId)
          flash(note ?? 'Game loaded. Use → to step through it.')
        }}
      />
      <PositionEditor
        open={editorOpen}
        initialFen={node.fen}
        onClose={() => setEditorOpen(false)}
        onApply={(fen) => {
          if (hasMoves(s.tree) && !window.confirm('Start a new analysis from this position? The moves on the board will be removed.')) return
          s.reset(fen)
          setEditorOpen(false)
        }}
      />
    </div>
  )
}

function formatNps(nps: number): string {
  return nps > 1e6 ? `${(nps / 1e6).toFixed(1)}M n/s` : `${Math.round(nps / 1e3)}k n/s`
}

/** The evaluation in plain words. */
function assess(e: Eval | null): string {
  if (!e) return 'Reading the position'
  if (e.winner) return `${e.winner === 'white' ? 'White' : 'Black'} has won`
  if (e.draw) return 'The game is drawn'
  if (e.mate !== null && e.mate !== undefined) return `${e.mate > 0 ? 'White' : 'Black'} mates in ${Math.abs(e.mate)}`
  const cp = e.cp ?? 0
  const side = cp > 0 ? 'White' : 'Black'
  const a = Math.abs(cp)
  if (a < 30) return 'The position is equal'
  if (a < 80) return `${side} is slightly better`
  if (a < 200) return `${side} is better`
  if (a < 500) return `${side} is winning`
  return `${side} is completely winning`
}
