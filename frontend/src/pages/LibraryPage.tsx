import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useLoad } from '../hooks/useLoad'
import { api, type GameFilters, type GameRow, type OpeningFamily, type Side } from '../lib/api'
import { openGameOnBoard } from '../lib/open'
import { navigate } from '../lib/router'
import { formatPgnDate, playersOf } from './ReviewListPage'

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' })

function monthOf(sortDate: string): string {
  const [y, m] = sortDate.split('-').map(Number)
  return MONTH.format(new Date(y, (m || 1) - 1, 1))
}

/** Your result in a game: win, draw, loss, or null if unknown. */
export function outcomeOf(g: { result: string | null; my_color: Side | null }): 'win' | 'draw' | 'loss' | null {
  if (!g.my_color || !g.result || g.result === '*') return null
  if (g.result === '1/2-1/2') return 'draw'
  return (g.result === '1-0') === (g.my_color === 'white') ? 'win' : 'loss'
}

const OUTCOME_TEXT = { win: 'Won', draw: 'Drew', loss: 'Lost' }

function GameRowView({ g, onOpen, onDelete }: { g: GameRow; onOpen: () => void; onDelete: () => void }) {
  const outcome = outcomeOf(g)
  const played = formatPgnDate(g.game_date)
  const acc = g.my_color === 'white' ? g.white_accuracy : g.my_color === 'black' ? g.black_accuracy : null
  const title = g.kind === 'analysis' && !g.white && !g.black ? 'Analysis' : playersOf(g)
  return (
    <li className="lib-row">
      <button type="button" className="lib-open" onClick={onOpen} title="Open on the analysis board">
        <span className={`lib-outcome ${outcome ? `out-${outcome}` : ''}`} aria-label={outcome ? OUTCOME_TEXT[outcome] : 'Result unknown'}>
          {outcome === 'win' ? '1' : outcome === 'draw' ? '½' : outcome === 'loss' ? '0' : g.kind === 'analysis' ? '·' : '–'}
        </span>
        <span className="lib-main">
          <span className="lib-title">
            {title}
            {g.my_color && <span className={`side-pill side-pill-${g.my_color}`}>{g.my_color === 'white' ? 'You: White' : 'You: Black'}</span>}
          </span>
          <span className="lib-meta">
            {g.opening ? <span><span className="eco">{g.eco}</span> {g.opening}</span> : <span>Opening not named</span>}
            {played ? <span>Played {played}</span> : <span>Added {formatPgnDate(g.sort_date.replace(/-/g, '.'))}</span>}
            {g.event && <span>{g.event}</span>}
            <span>{Math.ceil(g.ply_count / 2)} moves</span>
            {g.tags && g.tags.split(',').map((t) => <span key={t} className="tag">{t.trim()}</span>)}
          </span>
        </span>
      </button>
      <span className="lib-side">
        {g.review_id ? (
          <a className="btn btn-small btn-quiet" href={`#/review/${g.review_id}`}>
            {g.review_status === 'done' && acc != null ? `Accuracy ${Math.round(acc)}` : 'Review'}
          </a>
        ) : null}
        <button type="button" className="icon-btn" onClick={onDelete} aria-label={`Delete ${title}`} title="Delete">
          <Icon name="trash" size={17} />
        </button>
      </span>
    </li>
  )
}

function OpeningTree({ families, selected, onSelect }: {
  families: OpeningFamily[]
  selected: { family?: string; opening?: string }
  onSelect: (f: { family?: string; opening?: string }) => void
}) {
  const [open, setOpen] = useState<string | null>(selected.family ?? null)
  if (families.length === 0) return <p className="muted small">Openings appear here once you have games.</p>
  return (
    <ul className="op-tree">
      <li>
        <button type="button" className={`op-node ${!selected.family ? 'op-on' : ''}`} onClick={() => onSelect({})}>
          <span>All openings</span>
        </button>
      </li>
      {families.map((f) => (
        <li key={f.family}>
          <button
            type="button"
            className={`op-node ${selected.family === f.family && !selected.opening ? 'op-on' : ''}`}
            aria-expanded={open === f.family}
            onClick={() => {
              setOpen(open === f.family && selected.family === f.family ? null : f.family)
              onSelect({ family: f.family })
            }}
          >
            <span className="op-name">{f.family}</span>
            <span className="op-count">{f.count}</span>
          </button>
          {open === f.family && (
            <ul className="op-vars">
              {f.variations.map((v) => (
                <li key={v.variation}>
                  <button
                    type="button"
                    className={`op-node op-var ${selected.opening === (v.variation === 'Main line' ? f.family : `${f.family}: ${v.variation}`) ? 'op-on' : ''}`}
                    onClick={() => onSelect({ family: f.family, opening: v.variation === 'Main line' ? f.family : `${f.family}: ${v.variation}` })}
                  >
                    <span className="op-name">{v.variation}</span>
                    <span className="op-count">{v.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  )
}

function StatsPanel({ filters, title }: { filters: GameFilters; title: string }) {
  const { data } = useLoad(() => api.openingStats(filters), [JSON.stringify(filters)])
  if (!data || data.games === 0) return null
  const max = Math.max(1, ...data.mistakes_by_move.map((m) => m.count))
  return (
    <section className="panel lib-stats" aria-label="Your results">
      <h2>{title}</h2>
      <div className="stat-cols">
        {(['white', 'black'] as const).map((c) => {
          const r = data.by_color[c]
          if (!r.games) return null
          return (
            <div key={c} className="stat-col">
              <span className="stat-label">As {c}</span>
              <span className="stat-big">{r.score}%</span>
              <span className="muted small">+{r.wins} ={r.draws} −{r.losses} in {r.games}</span>
              {data.accuracy[c] != null && <span className="muted small">Accuracy {data.accuracy[c]}</span>}
            </div>
          )
        })}
      </div>
      {data.mistake_count > 0 && (
        <>
          <p className="stat-insight">
            Your mistakes and blunders cluster around <strong>move {data.mistake_peak_move}</strong>
            {' '}({data.mistake_count} in {data.reviewed} reviewed game{data.reviewed === 1 ? '' : 's'}).
          </p>
          <div className="move-histogram" aria-hidden="true">
            {Array.from({ length: Math.max(...data.mistakes_by_move.map((m) => m.move)) }, (_, i) => {
              const n = data.mistakes_by_move.find((m) => m.move === i + 1)?.count ?? 0
              return <span key={i} style={{ height: `${(n / max) * 100}%` }} title={`Move ${i + 1}: ${n}`} />
            })}
          </div>
        </>
      )}
      {data.reviewed === 0 && <p className="muted small">Review some of these games to see where your mistakes happen.</p>}
    </section>
  )
}

function ImportGames({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [pgn, setPgn] = useState('')
  const [color, setColor] = useState<Side | ''>('')
  const [tags, setTags] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pgn.trim()) {
      setError('Paste one or more games, or open a .pgn file.')
      return
    }
    setBusy(true)
    try {
      const r = await api.importGames(pgn, color || null, tags)
      const parts = [`${r.added.length} game${r.added.length === 1 ? '' : 's'} added`]
      if (r.duplicates.length) parts.push(`${r.duplicates.length} already in the library`)
      if (r.problem_count) parts.push(`${r.problem_count} could not be read`)
      onDone(parts.join(', ') + '.')
      setPgn('')
      setError(null)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Add games" open={open} onClose={onClose} wide>
      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">PGN, one game or many</span>
          <textarea className="input mono-ish" rows={10} value={pgn} onChange={(e) => setPgn(e.target.value)} spellCheck={false}
            placeholder={'[Event "Club championship"]\n[Date "2026.10.04"]\n[White "You"]\n[Black "Opponent"]\n\n1. d4 Nf6 2. c4 e6 …'} />
        </label>
        <label className="btn btn-quiet file-btn">
          <Icon name="file" size={16} /> Open a .pgn file
          <input type="file" accept=".pgn,.txt,text/plain" onChange={async (e) => {
            const f = e.target.files?.[0]
            if (f) setPgn(await f.text())
          }} />
        </label>
        <div className="form-grid">
          <label className="field">
            <span className="field-label">You played</span>
            <select className="input" value={color} onChange={(e) => setColor(e.target.value as Side | '')}>
              <option value="">Work it out from my names in Settings</option>
              <option value="white">White in every game</option>
              <option value="black">Black in every game</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Tags (optional, comma separated)</span>
            <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="club, rapid" />
          </label>
        </div>
        <p className="muted small">Games already in the library are skipped, so importing the same file twice is safe.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row row-end">
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add to library'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function LibraryPage() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [color, setColor] = useState('')
  const [outcome, setOutcome] = useState('')
  const [kind, setKind] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [sel, setSel] = useState<{ family?: string; opening?: string }>({})
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 250)
    return () => window.clearTimeout(t)
  }, [q])

  const base: GameFilters = { q: query, color, kind, since, until }
  const filters: GameFilters = { ...base, outcome, family: sel.family, opening: sel.opening }
  const games = useLoad(() => api.listGames(filters), [JSON.stringify(filters)])
  const tree = useLoad(() => api.openingTree(base), [JSON.stringify(base)])

  const grouped = useMemo(() => {
    const out: { month: string; games: GameRow[] }[] = []
    for (const g of games.data?.games ?? []) {
      const month = monthOf(g.sort_date)
      if (!out.length || out[out.length - 1].month !== month) out.push({ month, games: [] })
      out[out.length - 1].games.push(g)
    }
    return out
  }, [games.data])

  const open = async (g: GameRow) => {
    try {
      await openGameOnBoard(g.id)
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const remove = async (g: GameRow) => {
    if (!window.confirm(`Delete ${playersOf(g)} from the library? Its review stays in Game review.`)) return
    try {
      await api.deleteGame(g.id)
      games.reload()
      tree.reload()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const filtered = Boolean(query || color || outcome || kind || since || until || sel.family)
  const total = games.data?.total ?? 0
  const exportHref = api.exportUrl({ ...filters })

  return (
    <div className="page library-page">
      <header className="page-head row-between">
        <div>
          <h1>Library</h1>
          <p className="page-sub">Every game and analysis you saved, by date and by opening.</p>
        </div>
        <div className="row">
          <a className="btn btn-quiet" href={exportHref} download>
            <Icon name="import" size={16} /> Export PGN
          </a>
          <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>
            <Icon name="plus" size={16} /> Add games
          </button>
        </div>
      </header>
      {notice && <p className="notice-bar" role="status">{notice} <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={15} /></button></p>}

      <div className="library-layout">
        <aside className="panel lib-openings" aria-label="Openings">
          <h2>Openings</h2>
          <OpeningTree families={tree.data?.families ?? []} selected={sel} onSelect={setSel} />
        </aside>

        <section className="lib-games" aria-label="Games">
          <div className="filter-bar">
            <input className="input lib-search" type="search" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search players, events, openings, tags" aria-label="Search the library" />
            <select className="input" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Your colour">
              <option value="">Both colours</option>
              <option value="white">I had White</option>
              <option value="black">I had Black</option>
            </select>
            <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Result">
              <option value="">Any result</option>
              <option value="win">Won</option>
              <option value="draw">Drew</option>
              <option value="loss">Lost</option>
            </select>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
              <option value="">Games and analyses</option>
              <option value="game">Games only</option>
              <option value="analysis">Analyses only</option>
            </select>
            <label className="mini-field">From <input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
            <label className="mini-field">to <input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
          </div>

          {sel.family && <StatsPanel filters={{ ...base, family: sel.family, opening: sel.opening }} title={sel.opening ?? sel.family} />}

          {games.error && <p className="form-error" role="alert">{games.error}</p>}
          {games.data && total === 0 && !filtered && (
            <div className="empty-state">
              <h2>Your library is empty</h2>
              <p>Games land here when you review them, save a board from the analysis page, finish a practice game, or add a PGN file.</p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}>Add games from PGN</button>
                <button type="button" className="btn" onClick={() => navigate('/analysis')}>Go to the analysis board</button>
              </div>
            </div>
          )}
          {games.data && total === 0 && filtered && <p className="empty">No games match these filters.</p>}
          {games.data && total > 0 && (
            <p className="muted small">{total} {total === 1 ? 'entry' : 'entries'}{total > (games.data.games.length) ? `, showing the newest ${games.data.games.length}` : ''}</p>
          )}
          {grouped.map((group) => (
            <section key={group.month} className="lib-month">
              <h3>{group.month}</h3>
              <ul className="lib-rows">
                {group.games.map((g) => <GameRowView key={g.id} g={g} onOpen={() => open(g)} onDelete={() => remove(g)} />)}
              </ul>
            </section>
          ))}
        </section>
      </div>

      <ImportGames open={importOpen} onClose={() => setImportOpen(false)} onDone={(msg) => {
        setNotice(msg)
        games.reload()
        tree.reload()
      }} />
    </div>
  )
}
