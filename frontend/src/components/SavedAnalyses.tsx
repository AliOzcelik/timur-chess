import { useEffect, useRef, useState } from 'react'
import { api, type GameRow } from '../lib/api'
import { formatDate } from '../lib/format'
import { openGameOnBoard } from '../lib/open'
import { useAnalysis } from '../state/analysis'
import { Icon } from './Icon'
import { Modal } from './Modal'

const known = (v: string | null | undefined) => (v && v !== '?' && v !== '-' ? v : null)

/** A readable name for a saved board: its name (Event header), the players, or the opening. */
export function analysisTitle(g: Pick<GameRow, 'event' | 'white' | 'black' | 'opening' | 'id'>): string {
  if (known(g.event)) return g.event!
  if (known(g.white) || known(g.black)) return `${known(g.white) ?? 'Unknown'} vs ${known(g.black) ?? 'Unknown'}`
  if (g.opening) return g.opening
  return `Analysis ${g.id}`
}

type Scope = 'analysis' | 'all'

/** The column left of the board: saved analyses (or every library game), newest first. */
export function SavedAnalyses({ collapsed, onToggle, onSave, onError }: {
  collapsed: boolean
  onToggle: () => void
  onSave: () => void
  onError: (text: string) => void
}) {
  const gameId = useAnalysis((s) => s.gameId)
  const saveState = useAnalysis((s) => s.saveState)
  const [scope, setScope] = useState<Scope>('analysis')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<GameRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)

  // Reload when the filters change and whenever the board finishes saving.
  const settled = saveState === 'saved' || saveState === 'idle'
  useEffect(() => {
    if (!settled) return
    let live = true
    const t = window.setTimeout(async () => {
      try {
        const res = await api.listGames({ kind: scope === 'analysis' ? 'analysis' : undefined, q: q.trim() || undefined }, 200)
        if (!live) return
        setRows(res.games)
        setTotal(res.total)
        setFailed(false)
      } catch {
        if (live) setFailed(true)
      }
    }, q ? 250 : 0)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [scope, q, gameId, settled])

  const open = async (id: number) => {
    if (id === gameId) return
    try {
      await openGameOnBoard(id, true)
    } catch (e) {
      onError((e as Error).message)
    }
  }

  const remove = async (g: GameRow) => {
    if (!window.confirm(`Delete "${analysisTitle(g)}" from the library? This cannot be undone.`)) return
    try {
      await api.deleteGame(g.id)
      if (g.id === useAnalysis.getState().gameId) useAnalysis.getState().setGameId(null)
      setRows((r) => r?.filter((x) => x.id !== g.id) ?? null)
      setTotal((n) => Math.max(0, n - 1))
    } catch (e) {
      onError((e as Error).message)
    }
  }

  if (collapsed) {
    return (
      <aside className="saved-col saved-rail" aria-label="Saved analyses">
        <button type="button" className="icon-btn" onClick={onToggle} title="Show saved analyses" aria-label="Show saved analyses" aria-expanded={false}>
          <Icon name="library" />
        </button>
        {total > 0 && <span className="saved-count">{total}</span>}
        <button type="button" className="icon-btn" onClick={onSave} title="Save this analysis" aria-label="Save this analysis">
          <Icon name="save" />
        </button>
      </aside>
    )
  }

  return (
    <aside className="saved-col card" aria-label="Saved analyses">
      <div className="card-head saved-head">
        <h2>Saved</h2>
        <span className="right">{rows ? total : ''}</span>
        <button type="button" className="icon-btn" onClick={onToggle} title="Hide this column" aria-label="Hide saved analyses" aria-expanded>
          <Icon name="prev" size={15} />
        </button>
      </div>
      <div className="saved-tools">
        <button type="button" className="btn btn-sm btn-primary saved-save" onClick={onSave}>
          <Icon name="save" size={15} />{gameId ? 'Rename this analysis' : 'Save this analysis'}
        </button>
        <div className="seg saved-scope" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={scope === 'analysis'} className={scope === 'analysis' ? 'seg-on' : ''} onClick={() => setScope('analysis')}>Analyses</button>
          <button type="button" role="tab" aria-selected={scope === 'all'} className={scope === 'all' ? 'seg-on' : ''} onClick={() => setScope('all')}>All games</button>
        </div>
        <input className="input saved-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, openings…" aria-label="Search saved analyses" />
      </div>
      <ul className="saved-list">
        {failed && <li className="saved-empty">Couldn't load the library. Is the server running?</li>}
        {!failed && rows?.length === 0 && (
          <li className="saved-empty">
            {q ? 'Nothing matches.' : scope === 'analysis' ? 'No saved analyses yet. Save the board to keep it here.' : 'The library is empty.'}
          </li>
        )}
        {rows?.map((g) => (
          <li key={g.id} className={`saved-item ${g.id === gameId ? 'on' : ''}`}>
            <button type="button" className="saved-open" onClick={() => open(g.id)} aria-current={g.id === gameId ? 'true' : undefined}>
              <span className="t">{analysisTitle(g)}</span>
              <span className="m">
                {g.eco && <span className="eco">{g.eco}</span>}
                <span>{formatDate(g.updated_at)}</span>
                <span>· {Math.ceil(g.ply_count / 2)} {g.ply_count === 1 || g.ply_count === 2 ? 'move' : 'moves'}</span>
                {scope === 'all' && g.kind === 'game' && <span className="kind">game</span>}
              </span>
            </button>
            <button type="button" className="icon-btn saved-del" onClick={() => remove(g)} aria-label={`Delete ${analysisTitle(g)}`} title="Delete">
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** Asks for a name, then saves the board in the library (or renames the saved copy). */
export function SaveAnalysisDialog({ open, onClose, defaultName, saved, onSubmit }: {
  open: boolean
  onClose: () => void
  defaultName: string
  saved: boolean
  onSubmit: (name: string) => Promise<void>
}) {
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(defaultName)
    setError(null)
    // The dialog focuses its close button first; put the cursor in the name instead, text selected.
    const t = window.setTimeout(() => { input.current?.focus(); input.current?.select() }, 0)
    return () => window.clearTimeout(t)
  }, [open, defaultName])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name.trim())
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={saved ? 'Rename this analysis' : 'Save this analysis'} open={open} onClose={onClose}>
      <form onSubmit={submit} className="save-analysis-form">
        <label className="set-field">
          <span className="set-label">Name</span>
          <input ref={input} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
            placeholder="e.g. Najdorf 6.Bg5 prep" />
        </label>
        <p className="dim small">
          {saved
            ? 'The board is already saved; changes keep saving automatically.'
            : 'Saved in the library with every side line and comment. After this, every change saves automatically.'}
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row-between">
          <span />
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              <Icon name="save" size={15} />{busy ? 'Saving…' : saved ? 'Rename' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
