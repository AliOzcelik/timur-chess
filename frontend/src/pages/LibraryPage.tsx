import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Masthead, Meta } from '../components/Masthead'
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
  const title = g.kind === 'analysis' && !g.white && !g.black ? 'Analysis' : null
  return (
    <li className="game-row">
      <button type="button" className="lib-open" onClick={onOpen} title="Open on the analysis board">
        <span className={`res ${outcome === 'win' ? 'w' : outcome === 'loss' ? 'l' : outcome === 'draw' ? 'd' : ''}`} aria-label={outcome ? OUTCOME_TEXT[outcome] : 'Result unknown'}>
          {outcome === 'win' ? '1' : outcome === 'draw' ? '½' : outcome === 'loss' ? '0' : g.kind === 'analysis' ? '·' : '–'}
        </span>
        <span className="game-main">
          <span className="game-title">
            {title ?? <>{g.white ?? 'Unknown'} <span className="vs">vs</span> {g.black ?? 'Unknown'}</>}
            {g.my_color && <span className="you">You · {g.my_color === 'white' ? 'White' : 'Black'}</span>}
            {g.kind === 'analysis' && <span className="you quiet">Analysis</span>}
          </span>
          <span className="game-meta">
            {g.opening ? <span className="op"><span className="eco">{g.eco}</span>{g.opening}</span> : <span>Opening not named</span>}
            {g.event && <span>{g.event}{g.round && g.round !== '?' && g.round !== '-' ? ` · Round ${g.round}` : ''}</span>}
            <span>{played ?? `Added ${formatPgnDate(g.sort_date.replace(/-/g, '.'))}`} · {Math.ceil(g.ply_count / 2)} moves</span>
            {g.tags && g.tags.split(',').map((t) => <span key={t} className="tag">{t.trim()}</span>)}
          </span>
        </span>
        {acc != null && g.review_status === 'done' ? (
          <span className="acc-box" title="Your accuracy">
            <span><span className="acc-num">{Math.round(acc)}</span><span className="acc-label">Accuracy</span></span>
            <span className="acc-meter"><i style={{ height: `${acc}%` }} /></span>
          </span>
        ) : <span className="acc-box empty" aria-hidden="true" />}
        <span className="row-chev" aria-hidden="true"><Icon name="chev" size={15} /></span>
      </button>
      <span className="lib-side">
        {g.review_id ? (
          <a className="btn btn-sm btn-ghost" href={`#/review/${g.review_id}`} title="Open the review">
            <Icon name="review" size={15} />{g.review_status === 'done' ? 'Review' : 'Reviewing…'}
          </a>
        ) : null}
        <button type="button" className="icon-btn" onClick={onDelete} aria-label={`Delete ${title ?? playersOf(g)}`} title="Delete">
          <Icon name="trash" size={16} />
        </button>
      </span>
    </li>
  )
}

function OpeningTree({ families, selected, onSelect, total }: {
  families: OpeningFamily[]
  selected: { family?: string; opening?: string }
  onSelect: (f: { family?: string; opening?: string }) => void
  total: number
}) {
  const [open, setOpen] = useState<string | null>(selected.family ?? null)
  if (families.length === 0) return <p className="tree-foot">Openings appear here once you have games.</p>
  return (
    <ul className="tree op-tree">
      <li>
        <button type="button" className={`tree-item all ${!selected.family ? 'on' : ''}`} onClick={() => onSelect({})}>
          <span>All openings</span><span className="cnt">{total}</span>
        </button>
      </li>
      <li className="tree-sep" aria-hidden="true" />
      {families.map((f) => (
        <li key={f.family}>
          <button
            type="button"
            className={`tree-item ${selected.family === f.family && !selected.opening ? 'on' : ''}`}
            aria-expanded={open === f.family}
            onClick={() => {
              setOpen(open === f.family && selected.family === f.family ? null : f.family)
              onSelect({ family: f.family })
            }}
          >
            <span className="chev"><Icon name={open === f.family ? 'chevd' : 'chev'} size={12} /></span>
            <span className="op-name">{f.family}</span>
            <span className="cnt">{f.count}</span>
          </button>
          {open === f.family && (
            <ul className="op-vars">
              {f.variations.map((v) => {
                const key = v.variation === 'Main line' ? f.family : `${f.family}: ${v.variation}`
                return (
                  <li key={v.variation}>
                    <button type="button" className={`tree-item child ${selected.opening === key ? 'on' : ''}`} onClick={() => onSelect({ family: f.family, opening: key })}>
                      <span className="op-name">{v.variation}</span>
                      <span className="cnt">{v.count}</span>
                    </button>
                  </li>
                )
              })}
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
    <section className="card lib-stats" aria-label="Your results">
      <div className="card-head"><h2>{title}</h2><span className="right">{data.games} games · {data.reviewed} reviewed</span></div>
      <div className="card-body">
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
      </div>
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
        <label className="link-btn file-btn file-link">
          <Icon name="upload" size={15} /> Open a .pgn file
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
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
  // Library-wide numbers for the stat tiles and the masthead (not affected by the filters).
  const overview = useLoad(() => api.openingStats({}), [])
  const counts = useLoad(async () => {
    const [g, a] = await Promise.all([api.listGames({ kind: 'game' }, 1), api.listGames({ kind: 'analysis' }, 1)])
    return { games: g.total, analyses: a.total }
  }, [])

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
      overview.reload()
      counts.reload()
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const filtered = Boolean(query || color || outcome || kind || since || until || sel.family)
  const total = games.data?.total ?? 0
  const exportHref = api.exportUrl({ ...filters })
  const families = tree.data?.families ?? []
  const totals = overview.data
  const allGames = totals ? totals.by_color.white.games + totals.by_color.black.games : 0
  const wins = totals ? totals.by_color.white.wins + totals.by_color.black.wins : 0
  const draws = totals ? totals.by_color.white.draws + totals.by_color.black.draws : 0
  const losses = totals ? totals.by_color.white.losses + totals.by_color.black.losses : 0
  const score = allGames ? Math.round(((wins + draws / 2) / allGames) * 100) : null
  const accs = totals ? [totals.accuracy.white, totals.accuracy.black].filter((v): v is number => v != null) : []
  const accuracy = accs.length ? accs.reduce((a, b) => a + b, 0) / accs.length : null
  const topFamily = [...families].sort((a, b) => b.count - a.count)[0]

  return (
    <div className="page library-page">
      <Masthead
        section="Study"
        page="Library"
        title="Library"
        sub={<Meta items={[
          counts.data ? <span><span className="strong">{counts.data.games} {counts.data.games === 1 ? 'game' : 'games'}</span> and {counts.data.analyses} {counts.data.analyses === 1 ? 'analysis' : 'analyses'}</span> : 'Every game and analysis you saved, by date and by opening.',
          families.length ? `${families.length} opening ${families.length === 1 ? 'family' : 'families'}` : null,
        ]} />}
        actions={
          <>
            <a className="btn btn-ghost" href={exportHref} download><Icon name="download" />Export PGN</a>
            <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}><Icon name="plus" />Add games</button>
          </>
        }
      />
      {notice && <p className="notice-bar" role="status">{notice} <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={15} /></button></p>}

      {totals && totals.games > 0 && (
        <div className="stats-row">
          <div className="stat">
            <div className="label">Games with you</div>
            <div className="value">{allGames} <small>of {totals.games}</small></div>
            <div className="foot"><span>{counts.data ? `${counts.data.analyses} saved ${counts.data.analyses === 1 ? 'analysis' : 'analyses'} besides` : ''}</span></div>
          </div>
          <div className="stat">
            <div className="label">Score</div>
            <div className="value">{score ?? '–'}<span className="pct">%</span> <small>{wins} W · {draws} D · {losses} L</small></div>
            <div className="score-bar" aria-hidden="true">
              <i className="w" style={{ width: `${allGames ? (wins / allGames) * 100 : 0}%` }} />
              <i className="d" style={{ width: `${allGames ? (draws / allGames) * 100 : 0}%` }} />
              <i className="l" style={{ width: `${allGames ? (losses / allGames) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="stat">
            <div className="label">Accuracy</div>
            <div className="value">{accuracy != null ? accuracy.toFixed(1) : '–'} <small>of 100</small></div>
            <div className="foot"><span>{totals.reviewed} reviewed {totals.reviewed === 1 ? 'game' : 'games'}</span></div>
          </div>
          <div className="stat">
            <div className="label">Openings</div>
            <div className="value">{families.length} <small>{families.length === 1 ? 'family' : 'families'}</small></div>
            <div className="foot">{topFamily && <span>Most played · <span className="strong">{topFamily.family}</span></span>}</div>
          </div>
        </div>
      )}

      <div className="filters filter-bar">
        <label className="searchbox lib-search">
          <Icon name="search" size={15} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search players, events, openings, tags" aria-label="Search the library" />
        </label>
        <label className="select">
          <select value={color} onChange={(e) => setColor(e.target.value)} aria-label="Your colour">
            <option value="">Both colours</option>
            <option value="white">I had White</option>
            <option value="black">I had Black</option>
          </select>
          <Icon name="chevd" size={13} />
        </label>
        <label className="select">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Result">
            <option value="">Any result</option>
            <option value="win">Won</option>
            <option value="draw">Drew</option>
            <option value="loss">Lost</option>
          </select>
          <Icon name="chevd" size={13} />
        </label>
        <label className="select">
          <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
            <option value="">Games &amp; analyses</option>
            <option value="game">Games only</option>
            <option value="analysis">Analyses only</option>
          </select>
          <Icon name="chevd" size={13} />
        </label>
        <span className="spacer" />
        <label className="date-field"><span>From</span><input className="input" type="date" value={since} onChange={(e) => setSince(e.target.value)} /></label>
        <label className="date-field"><span>to</span><input className="input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        {filtered && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setQ(''); setColor(''); setOutcome(''); setKind(''); setSince(''); setUntil(''); setSel({}) }}>
            <Icon name="close" size={14} />Clear
          </button>
        )}
      </div>

      <div className="library-grid library-layout">
        <aside className="card openings-card lib-openings" aria-label="Openings">
          <div className="card-head"><h2>Openings</h2><span className="right">{families.length}</span></div>
          <OpeningTree families={families} selected={sel} onSelect={setSel} total={counts.data ? counts.data.games + counts.data.analyses : 0} />
          {families.length > 0 && <p className="tree-foot">Openings are matched by position, so transpositions count.</p>}
        </aside>

        <section className="lib-games" aria-label="Games">
          {sel.family && <StatsPanel filters={{ ...base, family: sel.family, opening: sel.opening }} title={sel.opening ?? sel.family} />}

          {games.error && <p className="form-error" role="alert">{games.error}</p>}
          {!games.data && !games.error && <div className="skeleton" style={{ height: 280 }} />}
          {games.data && total === 0 && !filtered && (
            <div className="empty-state">
              <p className="eyebrow">Library</p>
              <h2>Your library is empty</h2>
              <p>Games land here when you review them, save a board from the analysis page, finish a practice game, or add a PGN file.</p>
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={() => setImportOpen(true)}><Icon name="plus" />Add games from PGN</button>
                <button type="button" className="btn" onClick={() => navigate('/analysis')}><Icon name="board" />Go to the analysis board</button>
              </div>
            </div>
          )}
          {games.data && total === 0 && filtered && (
            <div className="card"><div className="card-body"><p className="empty">No games match these filters.</p></div></div>
          )}
          {games.data && total > 0 && (
            <div className="card games-card">
              {grouped.map((group, i) => (
                <section key={group.month} className="lib-month">
                  <div className="month-head">
                    <h3 className="m">{group.month}</h3>
                    <span className="n">{group.games.length} {group.games.length === 1 ? 'game' : 'games'}</span>
                    {i === 0 && <span className="sort">Newest first</span>}
                  </div>
                  <ul className="game-rows lib-rows">
                    {group.games.map((g) => <GameRowView key={g.id} g={g} onOpen={() => open(g)} onDelete={() => remove(g)} />)}
                  </ul>
                </section>
              ))}
              <div className="list-foot">
                <span>{total} {total === 1 ? 'entry' : 'entries'}{total > games.data.games.length ? `, showing the newest ${games.data.games.length}` : ''}</span>
                <span className="spacer" />
                <span className="dim">Click a game to open it on the board</span>
              </div>
            </div>
          )}
        </section>
      </div>

      <ImportGames open={importOpen} onClose={() => setImportOpen(false)} onDone={(msg) => {
        setNotice(msg)
        games.reload()
        tree.reload()
        overview.reload()
        counts.reload()
      }} />
    </div>
  )
}
