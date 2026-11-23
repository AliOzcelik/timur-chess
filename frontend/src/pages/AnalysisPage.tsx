import { useMemo, useRef, useState } from 'react'
import type { DrawShape } from '@lichess-org/chessground/draw'
import type { Key } from '@lichess-org/chessground/types'
import { Board } from '../components/Board'
import { EngineLines } from '../components/EngineLines'
import { EvalBar } from '../components/EvalBar'
import { Icon } from '../components/Icon'
import { ImportDialog } from '../components/ImportDialog'
import { PositionEditor } from '../components/PositionEditor'
import { PositionNotes } from '../components/PositionNotes'
import { Scoresheet } from '../components/Scoresheet'
import { isCheck, turnOf, uciSquares } from '../lib/chess'
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
  const toMove = turnOf(node.fen) === 'white' ? 'White' : 'Black'

  return (
    <div className="page analysis-page">
      <header className="page-head">
        <h1>Analysis board</h1>
        <p className="page-sub">
          {white || black ? `${white ?? 'Unknown'} vs ${black ?? 'Unknown'}` : `${toMove} to move`}
          {opening && (
            <span className="opening-name" title={`ECO ${opening.eco}`}>
              <span className="eco">{opening.eco}</span> {opening.name}
            </span>
          )}
          {s.gameId && (
            <a className={`save-state save-${s.saveState}`} href="#/library">
              {s.saveState === 'saving' ? 'Saving…' : s.saveState === 'error' ? 'Not saved, server offline' : 'Saved in library'}
            </a>
          )}
        </p>
      </header>

      <div className="analysis-layout">
        <section className="board-column" aria-label="Board">
          <div className="board-area">
            <EvalBar value={barEval} orientation={s.orientation} hidden={!s.engineOn || threat} />
            <Board
              fen={node.fen}
              orientation={s.orientation}
              lastMove={uciSquares(node.uci) as [Key, Key] | undefined}
              movable="turn"
              shapes={shapes}
              onMove={(uci) => s.play(uci)}
            />
          </div>
          <div className="board-toolbar" role="toolbar" aria-label="Board actions">
            <button type="button" className="tool" onClick={() => s.flip()} title="Flip board (F)" aria-label="Flip board">
              <Icon name="flip" />
            </button>
            <button type="button" className="tool" onClick={() => setEditorOpen(true)} aria-label="Set up position" title="Set up position">
              <Icon name="edit" /> <span>Set up</span>
            </button>
            <button type="button" className="tool" onClick={newBoard}>
              <Icon name="plus" /> <span>New board</span>
            </button>
            <span className="tool-sep" aria-hidden="true" />
            <button type="button" className="tool" onClick={() => setImportOpen(true)}>
              <Icon name="import" /> <span>Import</span>
            </button>
            <button type="button" className="tool" onClick={() => copy(toPgn(s.tree), 'PGN')} aria-label="Copy PGN" title="Copy the game as PGN">
              <Icon name="copy" /> <span>PGN</span>
            </button>
            <button type="button" className="tool" onClick={() => copy(node.fen, 'FEN')} aria-label="Copy FEN" title="Copy this position as FEN">
              <Icon name="copy" /> <span>FEN</span>
            </button>
            {!s.gameId && (
              <button type="button" className="tool" onClick={saveToLibrary} disabled={saving} aria-label="Save to library" title="Save to library">
                <Icon name="library" /> <span>Save</span>
              </button>
            )}
            <button type="button" className="tool tool-accent" onClick={reviewThisGame}>
              <Icon name="review" /> <span>Review this game</span>
            </button>
          </div>
          <p className="notice" role="status" aria-live="polite">{notice}</p>
        </section>

        <aside className="side-panel" aria-label="Engine and moves">
          <section className="engine-panel">
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
              <span className={`big-eval side-${evalSide(headlineEval)}`} aria-live="off">
                {s.engineOn ? (threat ? 'Threat' : formatEval(headlineEval) || '…') : ''}
              </span>
              <span className="engine-name">{liveStatus?.name ?? 'Stockfish'}</span>
            </div>
            {liveStatus?.error && <p className="engine-error" role="alert">{liveStatus.error}</p>}
            {!engine.connected && <p className="engine-error">Connecting to the engine…</p>}

            <div className="engine-controls">
              <label className="mini-field">
                <span>Lines</span>
                <select value={s.multipv} onChange={(e) => s.setSettings({ multipv: Number(e.target.value) })} disabled={threat}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="mini-field">
                <span>Depth</span>
                <select
                  value={s.depth === null ? 'none' : String(s.depth)}
                  onChange={(e) => s.setSettings({ depth: e.target.value === 'none' ? null : Number(e.target.value) })}
                >
                  {DEPTHS.map((d) => <option key={d.label} value={d.value === null ? 'none' : String(d.value)}>{d.label}</option>)}
                </select>
              </label>
              <button
                type="button"
                className={`chip ${s.arrows ? 'chip-on' : ''}`}
                aria-pressed={s.arrows}
                onClick={() => s.setSettings({ arrows: !s.arrows })}
              >
                <Icon name="arrows" size={15} /> Arrows
              </button>
              <button
                type="button"
                className={`chip ${threat ? 'chip-on chip-threat' : ''}`}
                aria-pressed={threat}
                disabled={inCheck}
                title={inCheck ? 'Not available while in check' : 'Show what the opponent threatens (X)'}
                onClick={() => s.setThreat(!s.threat)}
              >
                <Icon name="target" size={15} /> Threat
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

          <section className="moves-panel" aria-label="Moves">
            <Scoresheet tree={s.tree} currentId={s.currentId} onSelect={s.goTo} />
            <div className="nav-bar">
              <div className="nav-buttons">
                <button type="button" className="icon-btn" onClick={s.toStart} aria-label="First move" title="First move (↑)"><Icon name="first" /></button>
                <button type="button" className="icon-btn" onClick={s.back} aria-label="Previous move" title="Previous move (←)"><Icon name="prev" /></button>
                <button type="button" className="icon-btn" onClick={s.forward} aria-label="Next move" title="Next move (→)"><Icon name="next" /></button>
                <button type="button" className="icon-btn" onClick={s.toEnd} aria-label="Last move" title="Last move (↓)"><Icon name="last" /></button>
              </div>
              {node.parentId && (
                <div className="node-actions">
                  {!isOnMainline(s.tree, node.id) && (
                    <button type="button" className="btn btn-small btn-quiet" onClick={() => s.promote(node.id)}>
                      <Icon name="promote" size={15} /> Make main line
                    </button>
                  )}
                  <button type="button" className="btn btn-small btn-quiet" onClick={() => s.remove(node.id)}>
                    <Icon name="trash" size={15} /> Delete from here
                  </button>
                </div>
              )}
            </div>
          </section>

          <PositionNotes fen={node.fen} opening={opening} gameId={s.gameId} />

          <details className="shortcuts">
            <summary>Keyboard shortcuts</summary>
            <dl>
              <dt>← →</dt><dd>Previous and next move</dd>
              <dt>↑ ↓</dt><dd>Start and end of the line</dd>
              <dt>Space</dt><dd>Engine on or off</dd>
              <dt>F</dt><dd>Flip the board</dd>
              <dt>X</dt><dd>Threat mode</dd>
            </dl>
          </details>
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
