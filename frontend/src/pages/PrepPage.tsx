import { useState } from 'react'
import { Icon } from '../components/Icon'
import { useLoad } from '../hooks/useLoad'
import { api, type ChecklistItem, type Round, type Side, type Tournament } from '../lib/api'
import { openGameOnBoard } from '../lib/open'
import { navigate } from '../lib/router'
import { formatDate } from './ReviewListPage'

const RESULT_TEXT: Record<string, string> = { '1': 'Won', '0.5': 'Drew', '0': 'Lost' }

function dateRange(a: string | null, b: string | null): string {
  if (!a) return 'No dates yet'
  return b && b !== a ? `${formatDate(a)} to ${formatDate(b)}` : formatDate(a)
}

function NewTournament({ onCreated }: { onCreated: (id: number) => void }) {
  const [name, setName] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [location, setLocation] = useState('')
  const [tc, setTc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Give the tournament a name.')
      return
    }
    try {
      const t = await api.createTournament({ name, start_date: start || null, end_date: end || null, location, time_control: tc })
      onCreated(t.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <form className="panel" onSubmit={submit}>
      <h2>New tournament</h2>
      <label className="field"><span className="field-label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="City Open 2026" /></label>
      <div className="form-grid">
        <label className="field"><span className="field-label">First day</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field"><span className="field-label">Last day</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="field"><span className="field-label">Where</span><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <label className="field"><span className="field-label">Time control</span><input className="input" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="90+30" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-primary">Create tournament</button>
    </form>
  )
}

function TournamentList() {
  const list = useLoad(() => api.tournaments(), [])
  const opponents = useLoad(() => api.opponents(), [])
  const items = list.data?.tournaments ?? []
  const today = new Date().toISOString().slice(0, 10)
  const upcoming = items.filter((t) => !t.end_date || t.end_date >= today)
  const past = items.filter((t) => t.end_date && t.end_date < today)
  return (
    <div className="prep-layout">
      <div>
        {list.data && items.length === 0 && (
          <div className="empty-state">
            <h2>Plan your next tournament</h2>
            <p>Add a tournament to keep a checklist, your pairings round by round, what you expect each opponent to play, and notes for the event.</p>
          </div>
        )}
        {upcoming.length > 0 && (
          <section className="lesson-group">
            <h2>Coming up</h2>
            <ul className="tour-list">{upcoming.map((t) => <TourRow key={t.id} t={t} />)}</ul>
          </section>
        )}
        {past.length > 0 && (
          <section className="lesson-group">
            <h2>Played</h2>
            <ul className="tour-list">{past.map((t) => <TourRow key={t.id} t={t} />)}</ul>
          </section>
        )}
        <OpponentTools known={opponents.data?.opponents ?? []} onFetched={opponents.reload} />
      </div>
      <NewTournament onCreated={(id) => navigate(`/prep/${id}`)} />
    </div>
  )
}

function TourRow({ t }: { t: { id: number; name: string; start_date: string | null; end_date: string | null; location: string; checklist: ChecklistItem[]; rounds?: number } }) {
  const done = t.checklist.filter((c) => c.done).length
  return (
    <li>
      <a className="tour-row" href={`#/prep/${t.id}`}>
        <span className="tour-name">{t.name}</span>
        <span className="lib-meta">
          <span>{dateRange(t.start_date, t.end_date)}</span>
          {t.location && <span>{t.location}</span>}
          <span>{t.rounds ?? 0} round{t.rounds === 1 ? '' : 's'}</span>
          {t.checklist.length > 0 && <span>Checklist {done}/{t.checklist.length}</span>}
        </span>
      </a>
    </li>
  )
}

function OpponentTools({ known, onFetched }: { known: { name: string; games: number }[]; onFetched: () => void }) {
  const [site, setSite] = useState<'lichess' | 'chesscom'>('lichess')
  const [user, setUser] = useState('')
  const [max, setMax] = useState(50)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fetchGames = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const r = await api.fetchOpponent(site, user.trim(), max)
      setMsg(`${r.added.length} games added${r.duplicates.length ? `, ${r.duplicates.length} were already there` : ''}.`)
      onFetched()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="panel opponent-tools">
      <h2>Opponents</h2>
      <p className="muted small">
        Download someone’s public games from lichess or Chess.com to see what they play. This is the only feature that uses the internet;
        turn it on under <a href="#/settings">Settings</a>.
      </p>
      <form className="row" onSubmit={fetchGames}>
        <select className="input input-auto" value={site} onChange={(e) => setSite(e.target.value as 'lichess' | 'chesscom')} aria-label="Site">
          <option value="lichess">lichess</option>
          <option value="chesscom">Chess.com</option>
        </select>
        <input className="input input-auto" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" aria-label="Username" />
        <select className="input input-auto" value={max} onChange={(e) => setMax(Number(e.target.value))} aria-label="How many games">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>Last {n} games</option>)}
        </select>
        <button type="submit" className="btn" disabled={busy || user.trim().length < 2}>{busy ? 'Downloading…' : 'Download games'}</button>
      </form>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {known.length > 0 && (
        <ul className="opp-list">
          {known.map((o) => (
            <li key={o.name}><a href={`#/prep/opponent/${encodeURIComponent(o.name)}`}>{o.name}</a> <span className="muted small">{o.games} games</span></li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function OpponentPage({ name }: { name: string }) {
  const { data, error } = useLoad(() => api.opponent(name), [name])
  return (
    <div className="page">
      <a className="back-link" href="#/prep"><Icon name="prev" size={15} /> Tournament prep</a>
      <header className="page-head">
        <h1>{name}</h1>
        <p className="page-sub">{data ? `${data.games} games in your library` : ''}</p>
      </header>
      {error && <p className="form-error">{error}</p>}
      {data && data.games === 0 && <p className="empty">No games by {name} yet. Download them on the Tournament prep page, or add them to the library.</p>}
      {data && data.games > 0 && (
        <div className="opp-grid">
          {(['as_white', 'as_black'] as const).map((k) => (
            <section key={k} className="panel">
              <h2>{k === 'as_white' ? 'With White' : 'With Black'} <span className="muted small">{data[k].games} game{data[k].games === 1 ? '' : 's'}</span></h2>
              {data[k].openings.length === 0 && <p className="muted small">No games.</p>}
              <ul className="opp-openings">
                {data[k].openings.map((o) => (
                  <li key={o.family}>
                    <div className="row-between">
                      <strong>{o.family}</strong>
                      <span className="small">{o.count} game{o.count === 1 ? '' : 's'}{o.score != null ? `, scores ${o.score}%` : ''}</span>
                    </div>
                    <div className="bar"><span style={{ width: `${(o.count / data[k].games) * 100}%` }} /></div>
                    <ul className="opp-lines">{o.lines.map((l) => <li key={l.name} className="muted small">{l.name} ({l.count})</li>)}</ul>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="panel">
            <h2>Recent games</h2>
            <ul className="opp-recent">
              {data.recent.map((g) => (
                <li key={g.id}>
                  <button type="button" className="link-btn" onClick={() => openGameOnBoard(g.id)}>{g.white} vs {g.black}</button>
                  <span className="muted small"> {g.result} {g.opening ?? ''}</span>
                </li>
              ))}
            </ul>
            <a className="btn btn-small" href="#/library">Open the library</a>
          </section>
        </div>
      )}
    </div>
  )
}

function RoundRow({ tid, r, onChange }: { tid: number; r: Round; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(r)
  const save = async (patch: Partial<Round>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    await api.updateRound(tid, r.id, patch)
    onChange()
  }
  const remove = async () => {
    if (!window.confirm(`Delete round ${r.number}?`)) return
    await api.deleteRound(tid, r.id)
    onChange()
  }
  return (
    <li className="round">
      <div className="round-head">
        <span className="round-no">R{r.number}</span>
        <input className="input" value={draft.opponent} onChange={(e) => setDraft({ ...draft, opponent: e.target.value })}
          onBlur={() => draft.opponent !== r.opponent && save({ opponent: draft.opponent })} placeholder="Opponent" aria-label={`Round ${r.number} opponent`} />
        <input className="input input-num" type="number" value={draft.opponent_rating ?? ''} placeholder="Rating" aria-label="Rating"
          onChange={(e) => setDraft({ ...draft, opponent_rating: e.target.value ? Number(e.target.value) : null })}
          onBlur={() => draft.opponent_rating !== r.opponent_rating && save({ opponent_rating: draft.opponent_rating })} />
        <select className="input input-auto" value={draft.my_color ?? ''} aria-label="My colour" onChange={(e) => save({ my_color: (e.target.value || null) as Side | null })}>
          <option value="">Colour?</option><option value="white">White</option><option value="black">Black</option>
        </select>
        <select className="input input-auto" value={draft.result ?? ''} aria-label="Result" onChange={(e) => save({ result: (e.target.value || '') as Round['result'] })}>
          <option value="">Not played</option><option value="1">Won</option><option value="0.5">Drew</option><option value="0">Lost</option>
        </select>
        <button type="button" className="btn btn-small btn-quiet" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Close' : 'Prepare'}</button>
        <button type="button" className="icon-btn" onClick={remove} aria-label={`Delete round ${r.number}`}><Icon name="trash" size={15} /></button>
      </div>
      {r.result && <span className={`round-result res-${r.result.replace('.', '')}`}>{RESULT_TEXT[r.result]}</span>}
      {open && (
        <div className="round-body">
          <label className="field"><span className="field-label">What I expect them to play</span>
            <input className="input" value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} onBlur={() => save({ expected: draft.expected })}
              placeholder="London System, 1...c5 against 1.e4" /></label>
          <label className="field"><span className="field-label">My preparation</span>
            <textarea className="input" rows={4} value={draft.prep} onChange={(e) => setDraft({ ...draft, prep: e.target.value })} onBlur={() => save({ prep: draft.prep })}
              placeholder="Lines to check, plans, what to avoid" /></label>
          <div className="row">
            {r.opponent && <a className="btn btn-small" href={`#/prep/opponent/${encodeURIComponent(r.opponent)}`}>What does {r.opponent} play?</a>}
            {r.game_id && <button type="button" className="btn btn-small" onClick={() => openGameOnBoard(r.game_id!)}>Open the game</button>}
          </div>
        </div>
      )}
    </li>
  )
}

function TournamentView({ id }: { id: number }) {
  const t = useLoad(() => api.tournament(id), [id])
  const [newItem, setNewItem] = useState('')
  const [error, setError] = useState<string | null>(null)

  const update = async (patch: Partial<Tournament>) => {
    try {
      t.setData(await api.updateTournament(id, patch))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  if (t.error) return <p className="form-error">{t.error}</p>
  if (!t.data) return <p className="muted">Loading…</p>
  const d = t.data

  const setChecklist = (list: ChecklistItem[]) => update({ checklist: list })
  const addNote = async () => {
    const n = await api.createNote({ title: `${d.name}: notes`, body: '', tournament_id: id })
    navigate(`/notes/${n.id}`)
  }
  const remove = async () => {
    if (!window.confirm(`Delete ${d.name}? Its notes are kept.`)) return
    await api.deleteTournament(id)
    navigate('/prep')
  }

  return (
    <div className="page">
      <a className="back-link" href="#/prep"><Icon name="prev" size={15} /> All tournaments</a>
      <header className="page-head row-between">
        <div>
          <h1>{d.name}</h1>
          <p className="page-sub">
            {dateRange(d.start_date, d.end_date)}{d.location ? `, ${d.location}` : ''}{d.time_control ? `, ${d.time_control}` : ''}
          </p>
        </div>
        <div className="row">
          {d.score.played > 0 && <span className="tour-score">{d.score.points} / {d.score.played}</span>}
          <button type="button" className="icon-btn" onClick={remove} aria-label="Delete tournament"><Icon name="trash" /></button>
        </div>
      </header>
      {error && <p className="form-error">{error}</p>}
      <div className="prep-detail">
        <section className="panel">
          <div className="row-between">
            <h2>Rounds</h2>
            <button type="button" className="btn btn-small" onClick={async () => { await api.addRound(id, {}); t.reload() }}><Icon name="plus" size={15} /> Add round</button>
          </div>
          {d.rounds.length === 0 && <p className="muted small">Add a round when the pairings are out. Note your opponent, colour and what you expect them to play.</p>}
          <ul className="rounds">{d.rounds.map((r) => <RoundRow key={r.id} tid={id} r={r} onChange={t.reload} />)}</ul>
        </section>

        <div className="prep-side">
          <section className="panel">
            <h2>Checklist</h2>
            <ul className="checklist">
              {d.checklist.map((c, i) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" checked={c.done} onChange={() => setChecklist(d.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
                    <span className={c.done ? 'done' : ''}>{c.text}</span>
                  </label>
                  <button type="button" className="icon-btn" aria-label={`Remove ${c.text}`} onClick={() => setChecklist(d.checklist.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
                </li>
              ))}
            </ul>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { setChecklist([...d.checklist, { text: newItem.trim(), done: false }]); setNewItem('') } }}>
              <input className="input input-auto" value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
              <button type="submit" className="btn btn-small">Add</button>
            </form>
          </section>

          <section className="panel">
            <div className="row-between">
              <h2>Notes</h2>
              <button type="button" className="btn btn-small" onClick={addNote}><Icon name="plus" size={15} /> New note</button>
            </div>
            {d.notes_list.length === 0 ? <p className="muted small">Notes you write for this tournament appear here.</p> : (
              <ul className="position-note-list">
                {d.notes_list.map((n) => <li key={n.id}><a href={`#/notes/${n.id}`}>{n.title || 'Untitled note'}</a></li>)}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Details</h2>
            <label className="field"><span className="field-label">Name</span>
              <input className="input" defaultValue={d.name} onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && update({ name: e.target.value })} /></label>
            <div className="form-grid">
              <label className="field"><span className="field-label">First day</span>
                <input className="input" type="date" defaultValue={d.start_date ?? ''} onChange={(e) => update({ start_date: e.target.value || null })} /></label>
              <label className="field"><span className="field-label">Last day</span>
                <input className="input" type="date" defaultValue={d.end_date ?? ''} onChange={(e) => update({ end_date: e.target.value || null })} /></label>
              <label className="field"><span className="field-label">Where</span>
                <input className="input" defaultValue={d.location} onBlur={(e) => e.target.value !== d.location && update({ location: e.target.value })} /></label>
              <label className="field"><span className="field-label">Time control</span>
                <input className="input" defaultValue={d.time_control} onBlur={(e) => e.target.value !== d.time_control && update({ time_control: e.target.value })} /></label>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export function PrepPage({ route }: { route: string[] }) {
  if (route[0] === 'opponent' && route[1]) return <OpponentPage name={decodeURIComponent(route[1])} />
  if (route[0] && /^\d+$/.test(route[0])) return <TournamentView id={Number(route[0])} />
  return (
    <div className="page prep-page">
      <header className="page-head">
        <h1>Tournament prep</h1>
        <p className="page-sub">Your events, pairings, preparation and opponents in one place.</p>
      </header>
      <TournamentList />
    </div>
  )
}
