import { useEffect, useState } from 'react'
import { initials } from '../components/BoardShell'
import { Icon } from '../components/Icon'
import { Masthead, Meta } from '../components/Masthead'
import { Modal } from '../components/Modal'
import { useLoad } from '../hooks/useLoad'
import { api, type ChecklistItem, type OpponentSide, type Round, type Side, type Tournament, type TournamentDetail } from '../lib/api'
import { formatDate, points } from '../lib/format'
import { openGameOnBoard } from '../lib/open'
import { navigate } from '../lib/router'
import { toast } from '../state/toast'

const RESULT_TEXT: Record<string, string> = { '1': 'Won', '0.5': 'Drew', '0': 'Lost' }
const RESULT_MARK: Record<string, { text: string; cls: string }> = { '1': { text: '1', cls: 'w' }, '0.5': { text: '½', cls: 'd' }, '0': { text: '0', cls: 'l' } }

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dateRange(a: string | null, b: string | null): string {
  if (!a) return 'No dates yet'
  return b && b !== a ? `${formatDate(a)} – ${formatDate(b)}` : formatDate(a)
}

/** "Today", "Tomorrow", "In 5 days", or a date for anything further away. */
function whenText(date: string | null): string | null {
  if (!date) return null
  const days = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today()}T00:00:00`).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days > 1 && days < 14) return `In ${days} days`
  if (days < 0) return formatDate(date)
  return formatDate(date)
}

/** The tournament to put in focus: one running now, else the next one, else none. */
function focusOf(list: Tournament[]): Tournament | null {
  const t = today()
  const running = list.find((x) => x.start_date && x.start_date <= t && (!x.end_date || x.end_date >= t))
  if (running) return running
  const upcoming = list
    .filter((x) => !x.end_date || x.end_date >= t)
    .sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'))
  return upcoming[0] ?? null
}

// ---- new tournament ---------------------------------------------------------------------------

function NewTournamentForm({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel?: () => void }) {
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
    <form onSubmit={submit} className="tour-form">
      <label className="field"><span className="field-label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="City Open 2026" autoFocus /></label>
      <div className="form-grid">
        <label className="field"><span className="field-label">First day</span><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field"><span className="field-label">Last day</span><input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        <label className="field"><span className="field-label">Where</span><input className="input" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
        <label className="field"><span className="field-label">Time control</span><input className="input" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="90+30" /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row row-end">
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        <button type="submit" className="btn btn-primary">Create tournament</button>
      </div>
    </form>
  )
}

function NewTournamentButton({ primary = true }: { primary?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOpen(true)}><Icon name="plus" />New tournament</button>
      <Modal title="New tournament" open={open} onClose={() => setOpen(false)}>
        <NewTournamentForm onCancel={() => setOpen(false)} onCreated={(id) => { setOpen(false); navigate(`/prep/${id}`) }} />
      </Modal>
    </>
  )
}

// ---- all tournaments --------------------------------------------------------------------------

function TournamentList() {
  const list = useLoad(() => api.tournaments(), [])
  const opponents = useLoad(() => api.opponents(), [])
  const items = list.data?.tournaments ?? []
  const t = today()
  const upcoming = items.filter((x) => !x.end_date || x.end_date >= t)
  const past = items.filter((x) => x.end_date && x.end_date < t)
  return (
    <div className="page prep-page">
      <Masthead
        section="Train"
        crumb={{ href: '#/prep', label: 'Tournament prep' }}
        title="All tournaments"
        sub={<Meta items={[`${items.length} tournament${items.length === 1 ? '' : 's'}`, `${upcoming.length} coming up`, `${past.length} played`]} />}
        actions={<NewTournamentButton />}
      />
      {list.error && <p className="form-error" role="alert">{list.error}</p>}
      <div className="prep-grid">
        <div className="prep-left">
          {list.data && items.length === 0 && (
            <div className="card">
              <div className="empty-state">
                <p className="eyebrow">Tournament prep</p>
                <h2>Plan your next tournament</h2>
                <p>Add a tournament to keep a checklist, your pairings round by round, what you expect each opponent to play, and notes for the event.</p>
                <NewTournamentForm onCreated={(id) => navigate(`/prep/${id}`)} />
              </div>
            </div>
          )}
          {upcoming.length > 0 && (
            <section className="card">
              <div className="card-head"><h2 className="card-title"><Icon name="calendar" />Coming up</h2><span className="right">{upcoming.length}</span></div>
              <ul className="tour-list">{upcoming.map((x) => <TourRow key={x.id} t={x} />)}</ul>
            </section>
          )}
          {past.length > 0 && (
            <section className="card">
              <div className="card-head"><h2 className="card-title">Played</h2><span className="right">{past.length}</span></div>
              <ul className="tour-list">{past.map((x) => <TourRow key={x.id} t={x} />)}</ul>
            </section>
          )}
        </div>
        <div className="prep-right">
          <OpponentTools known={opponents.data?.opponents ?? []} onFetched={opponents.reload} />
        </div>
      </div>
    </div>
  )
}

function TourRow({ t }: { t: Tournament }) {
  const done = t.checklist.filter((c) => c.done).length
  return (
    <li>
      <a className="tour-row" href={`#/prep/${t.id}`}>
        <span className="tour-date">
          <b>{t.start_date ? new Date(`${t.start_date}T00:00:00`).getDate() : '–'}</b>
          <span>{t.start_date ? new Date(`${t.start_date}T00:00:00`).toLocaleString(undefined, { month: 'short' }) : ''}</span>
        </span>
        <span className="tour-main">
          <span className="tour-name">{t.name}</span>
          <span className="tour-meta">
            <Meta items={[dateRange(t.start_date, t.end_date), t.location, `${t.rounds ?? 0} round${t.rounds === 1 ? '' : 's'}`, t.checklist.length > 0 && `Checklist ${done}/${t.checklist.length}`]} />
          </span>
        </span>
        <Icon name="chev" className="tour-go" size={14} />
      </a>
    </li>
  )
}

function OpponentTools({ known, onFetched }: { known: { name: string; games: number }[]; onFetched: () => void }) {
  return (
    <section className="card">
      <div className="card-head"><h2 className="card-title"><Icon name="people" />Opponents</h2><span className="right">{known.length}</span></div>
      <div className="card-body">
        <DownloadGames onFetched={onFetched} />
        {known.length > 0 && (
          <ul className="opp-list">
            {known.map((o) => (
              <li key={o.name}>
                <a href={`#/prep/opponent/${encodeURIComponent(o.name)}`}>
                  <span className="avatar sm" aria-hidden="true">{initials(o.name)}</span>
                  <span className="nm">{o.name}</span>
                  <span className="muted small">{o.games} games</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function DownloadGames({ onFetched, initialUser = '' }: { onFetched: () => void; initialUser?: string }) {
  const [site, setSite] = useState<'lichess' | 'chesscom'>('lichess')
  const [user, setUser] = useState(initialUser)
  const [max, setMax] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchGames = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.fetchOpponent(site, user.trim(), max)
      toast(`${r.added.length} games added${r.duplicates.length ? `, ${r.duplicates.length} were already there` : ''}.`, 'success')
      onFetched()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="download-form" onSubmit={fetchGames}>
      <p className="muted small">
        Download someone’s public games from lichess or Chess.com to see what they play. This is the only feature that uses the internet;
        turn it on under <a href="#/settings">Settings</a>.
      </p>
      <div className="download-row">
        <span className="select"><select value={site} onChange={(e) => setSite(e.target.value as 'lichess' | 'chesscom')} aria-label="Site">
          <option value="lichess">lichess</option>
          <option value="chesscom">Chess.com</option>
        </select></span>
        <input className="input" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Username" aria-label="Username" />
      </div>
      <div className="download-row">
        <span className="select"><select value={max} onChange={(e) => setMax(Number(e.target.value))} aria-label="How many games">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>Last {n} games</option>)}
        </select></span>
        <button type="submit" className="btn btn-sm" disabled={busy || user.trim().length < 2}><Icon name="download" />{busy ? 'Downloading…' : 'Download games'}</button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}

// ---- one opponent -----------------------------------------------------------------------------

function ScoutLines({ side, limit }: { side: OpponentSide; limit?: number }) {
  if (side.games === 0) return <p className="muted small">No games.</p>
  return (
    <>
      {side.openings.slice(0, limit).map((o) => {
        const pct = Math.round((o.count / side.games) * 100)
        return (
          <div key={o.family} className="scout-line" title={`${o.count} game${o.count === 1 ? '' : 's'}${o.score != null ? `, scores ${o.score}%` : ''}`}>
            <span className="nm">{o.family}</span>
            <span className="bar"><i style={{ width: `${pct}%` }} /></span>
            <span className="pc">{pct}%</span>
          </div>
        )
      })}
    </>
  )
}

export function OpponentPage({ name }: { name: string }) {
  const { data, error } = useLoad(() => api.opponent(name), [name])
  return (
    <div className="page prep-page">
      <Masthead
        section="Train"
        crumb={{ href: '#/prep', label: 'Tournament prep' }}
        title={name}
        sub={data ? <Meta items={[`${data.games} games in your library`, `${data.as_white.games} with White`, `${data.as_black.games} with Black`]} /> : null}
        actions={<a className="btn btn-ghost" href="#/library"><Icon name="library" />Open the library</a>}
      />
      {error && <p className="form-error">{error}</p>}
      {data && data.games === 0 && (
        <div className="card"><div className="empty-state">
          <h2>No games by {name} yet</h2>
          <p>Download their public games, or add them to the library, to see what they play.</p>
          <DownloadGames onFetched={() => navigate(`/prep/opponent/${encodeURIComponent(name)}`)} initialUser={name} />
        </div></div>
      )}
      {data && data.games > 0 && (
        <div className="opp-grid">
          {(['as_white', 'as_black'] as const).map((k) => (
            <section key={k} className="card">
              <div className="card-head"><h2 className="card-title">{k === 'as_white' ? 'With White' : 'With Black'}</h2><span className="right">{data[k].games} game{data[k].games === 1 ? '' : 's'}</span></div>
              <div className="card-body">
                {data[k].openings.length === 0 && <p className="muted small">No games.</p>}
                <ul className="opp-openings">
                  {data[k].openings.map((o) => (
                    <li key={o.family}>
                      <div className="row-between">
                        <strong>{o.family}</strong>
                        <span className="small muted">{o.count} game{o.count === 1 ? '' : 's'}{o.score != null ? ` · scores ${o.score}%` : ''}</span>
                      </div>
                      <div className="meter"><i style={{ width: `${(o.count / data[k].games) * 100}%` }} /></div>
                      {o.lines.length > 0 && <p className="opp-lines">{o.lines.map((l) => `${l.name} (${l.count})`).join(' · ')}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ))}
          <section className="card">
            <div className="card-head"><h2 className="card-title">Recent games</h2></div>
            <ul className="opp-recent">
              {data.recent.map((g) => (
                <li key={g.id}>
                  <button type="button" className="opp-game" onClick={() => openGameOnBoard(g.id)}>
                    <span className="nm">{g.white} – {g.black}</span>
                    <span className="muted small">{g.result} · {g.opening ?? 'Unknown opening'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

// ---- one tournament ---------------------------------------------------------------------------

function RoundRow({ tid, r, isNext, onChange }: { tid: number; r: Round; isNext: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(r)
  useEffect(() => setDraft(r), [r])
  const save = async (patch: Partial<Round>) => {
    setDraft({ ...draft, ...patch })
    try {
      await api.updateRound(tid, r.id, patch)
      onChange()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const remove = async () => {
    if (!window.confirm(`Delete round ${r.number}?`)) return
    await api.deleteRound(tid, r.id)
    onChange()
  }
  const mark = r.result ? RESULT_MARK[r.result] : null
  const plan = [
    r.opening ?? (r.expected ? `Expect ${r.expected}` : null),
    r.prep ? 'prep written' : null,
    r.review_id ? 'reviewed' : null,
  ].filter(Boolean).join(' · ')
  return (
    <li className={`round-item ${isNext ? 'next' : ''} ${open ? 'open' : ''}`}>
      <button type="button" className="round-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="round-no">{String(r.number).padStart(2, '0')}</span>
        <span className="round-main">
          <span className="who">
            {r.opponent || <span className="muted">Opponent not set</span>}
            {r.my_color && <span className="pill">{r.my_color === 'white' ? 'White' : 'Black'}</span>}
            {r.opponent_rating ? <span className="pill">{r.opponent_rating}</span> : null}
          </span>
          <span className="plan">{plan || (isNext ? 'Open to write your preparation' : 'No notes')}</span>
        </span>
        {mark
          ? <span className={`round-res ${mark.cls}`} aria-label={RESULT_TEXT[r.result!]}>{mark.text}</span>
          : <span className="round-side">{isNext && <span className="mini-tag">{whenText(r.round_date) ?? 'Next'}</span>}</span>}
        <Icon name="chevd" size={14} className="round-chev" />
      </button>
      {open && (
        <div className="round-body">
          <div className="round-fields">
            <label className="field"><span className="field-label">Opponent</span>
              <input className="input" value={draft.opponent} onChange={(e) => setDraft({ ...draft, opponent: e.target.value })}
                onBlur={() => draft.opponent !== r.opponent && save({ opponent: draft.opponent })} placeholder="Name" aria-label={`Round ${r.number} opponent`} /></label>
            <label className="field"><span className="field-label">Rating</span>
              <input className="input" type="number" value={draft.opponent_rating ?? ''} aria-label="Rating"
                onChange={(e) => setDraft({ ...draft, opponent_rating: e.target.value ? Number(e.target.value) : null })}
                onBlur={() => draft.opponent_rating !== r.opponent_rating && save({ opponent_rating: draft.opponent_rating })} /></label>
            <label className="field"><span className="field-label">Date</span>
              <input className="input" type="date" value={draft.round_date ?? ''} onChange={(e) => save({ round_date: e.target.value || null })} /></label>
            <label className="field"><span className="field-label">My colour</span>
              <span className="select"><select value={draft.my_color ?? ''} aria-label="My colour" onChange={(e) => save({ my_color: (e.target.value || null) as Side | null })}>
                <option value="">Not known</option><option value="white">White</option><option value="black">Black</option>
              </select></span></label>
            <label className="field"><span className="field-label">Result</span>
              <span className="select"><select value={draft.result ?? ''} aria-label="Result" onChange={(e) => save({ result: (e.target.value || '') as Round['result'] })}>
                <option value="">Not played</option><option value="1">Won</option><option value="0.5">Drew</option><option value="0">Lost</option>
              </select></span></label>
          </div>
          <label className="field"><span className="field-label">What I expect them to play</span>
            <input className="input" value={draft.expected} onChange={(e) => setDraft({ ...draft, expected: e.target.value })} onBlur={() => draft.expected !== r.expected && save({ expected: draft.expected })}
              placeholder="London System, 1…c5 against 1.e4" /></label>
          <label className="field"><span className="field-label">My preparation</span>
            <textarea className="input prep-text" rows={4} value={draft.prep} onChange={(e) => setDraft({ ...draft, prep: e.target.value })} onBlur={() => draft.prep !== r.prep && save({ prep: draft.prep })}
              placeholder="Lines to check, plans, what to avoid" /></label>
          <div className="row">
            {r.opponent && <a className="btn btn-sm" href={`#/prep/opponent/${encodeURIComponent(r.opponent)}`}><Icon name="people" />What does {r.opponent} play?</a>}
            {r.game_id && <button type="button" className="btn btn-sm" onClick={() => openGameOnBoard(r.game_id!)}><Icon name="board" />Open the game</button>}
            {r.review_id && <a className="btn btn-sm" href={`#/review/${r.review_id}`}><Icon name="review" />Review</a>}
            <span className="spacer" />
            <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={remove}><Icon name="trash" />Delete round</button>
          </div>
        </div>
      )}
    </li>
  )
}

function Scouting({ round }: { round: Round | null }) {
  const name = round?.opponent?.trim() ?? ''
  const { data, reload } = useLoad(() => (name ? api.opponent(name) : Promise.resolve(null)), [name])
  return (
    <section className="card scout-card">
      <div className="card-head"><h2 className="card-title"><Icon name="target" />Scouting</h2><span className="right">{round ? `Round ${round.number}` : ''}</span></div>
      <div className="card-body">
        {!name && <p className="muted small">Add the next round’s opponent to see what they play.</p>}
        {name && (
          <>
            <div className="scout-name">
              <span className="avatar" aria-hidden="true">{initials(name)}</span>
              <div>
                <div className="n">{name}</div>
                <div className="r">{[round?.opponent_rating, data ? `${data.games} game${data.games === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
            {data && data.games > 0 && (
              <>
                <div className="scout-label">With White</div>
                <ScoutLines side={data.as_white} limit={3} />
                <div className="scout-label">With Black</div>
                <ScoutLines side={data.as_black} limit={3} />
                <a className="btn btn-sm btn-block scout-more" href={`#/prep/opponent/${encodeURIComponent(name)}`}>Full report<Icon name="chev" size={13} /></a>
              </>
            )}
            {data && data.games === 0 && <DownloadGames onFetched={reload} initialUser={name} />}
          </>
        )}
      </div>
    </section>
  )
}

function Checklist({ items, onChange }: { items: ChecklistItem[]; onChange: (list: ChecklistItem[]) => void }) {
  const [text, setText] = useState('')
  const done = items.filter((c) => c.done).length
  return (
    <section className="card checklist-card">
      <div className="card-head"><h2 className="card-title"><Icon name="check" />Checklist</h2><span className="right">{done} of {items.length}</span></div>
      <div className="card-body">
        {items.length === 0 && <p className="muted small">Things to do before the event: lines to check, what to pack.</p>}
        <ul className="checklist">
          {items.map((c, i) => (
            <li key={i} className={`check-item ${c.done ? 'done' : ''}`}>
              <label>
                <input type="checkbox" className="visually-hidden" checked={c.done} onChange={() => onChange(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
                <span className="box" aria-hidden="true">{c.done && <Icon name="check" size={10} />}</span>
                <span className="txt">{c.text}</span>
              </label>
              <button type="button" className="icon-btn" aria-label={`Remove ${c.text}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="close" size={13} /></button>
            </li>
          ))}
        </ul>
        <form className="check-add" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onChange([...items, { text: text.trim(), done: false }]); setText('') } }}>
          <Icon name="plus" size={13} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
        </form>
      </div>
    </section>
  )
}

function DetailsModal({ d, open, onClose, onSave }: { d: TournamentDetail; open: boolean; onClose: () => void; onSave: (patch: Partial<Tournament>) => Promise<void> }) {
  const [form, setForm] = useState({ name: d.name, start_date: d.start_date ?? '', end_date: d.end_date ?? '', location: d.location, time_control: d.time_control })
  useEffect(() => {
    if (open) setForm({ name: d.name, start_date: d.start_date ?? '', end_date: d.end_date ?? '', location: d.location, time_control: d.time_control })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    await onSave({ ...form, start_date: form.start_date || null, end_date: form.end_date || null })
    onClose()
  }
  return (
    <Modal title="Tournament details" open={open} onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field"><span className="field-label">Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <div className="form-grid">
          <label className="field"><span className="field-label">First day</span><input className="input" type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
          <label className="field"><span className="field-label">Last day</span><input className="input" type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          <label className="field"><span className="field-label">Where</span><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label>
          <label className="field"><span className="field-label">Time control</span><input className="input" value={form.time_control} onChange={(e) => setForm({ ...form, time_control: e.target.value })} placeholder="90+30" /></label>
        </div>
        <div className="row row-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">Save</button>
        </div>
      </form>
    </Modal>
  )
}

function TournamentView({ id, focus }: { id: number; focus?: boolean }) {
  const t = useLoad(() => api.tournament(id), [id])
  const [editing, setEditing] = useState(false)

  const update = async (patch: Partial<Tournament>) => {
    try {
      t.setData(await api.updateTournament(id, patch))
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  if (t.error) {
    return (
      <div className="page prep-page">
        <Masthead section="Train" crumb={{ href: '#/prep/all', label: 'Tournament prep' }} title="Tournament not found" />
        <p className="form-error">{t.error}</p>
      </div>
    )
  }
  if (!t.data) return <div className="page prep-page"><p className="muted">Loading…</p></div>
  const d = t.data

  const addNote = async () => {
    const n = await api.createNote({ title: `${d.name}: notes`, body: '', tournament_id: id })
    navigate(`/notes/${n.id}`)
  }
  const remove = async () => {
    if (!window.confirm(`Delete ${d.name}? Its notes are kept.`)) return
    await api.deleteTournament(id)
    toast(`${d.name} deleted.`)
    navigate('/prep/all')
  }
  const addRound = async () => {
    await api.addRound(id, {})
    t.reload()
  }

  const rounds = [...d.rounds].sort((a, b) => a.number - b.number)
  const next = rounds.find((r) => !r.result) ?? null
  const played = rounds.filter((r) => r.result).length
  const left = rounds.length - played
  const shown = [...rounds].sort((a, b) => {
    if (next && a.id === next.id) return -1
    if (next && b.id === next.id) return 1
    return b.number - a.number
  })
  const nextWhen = next ? whenText(next.round_date) : null

  return (
    <div className="page prep-page">
      <Masthead
        section="Train"
        crumb={focus ? undefined : { href: '#/prep/all', label: 'Tournament prep' }}
        page={focus ? 'Tournament prep' : undefined}
        title={focus ? 'Tournament prep' : d.name}
        sub={<Meta items={[focus ? 'One event in focus' : dateRange(d.start_date, d.end_date), rounds.length ? `${left} round${left === 1 ? '' : 's'} left` : 'No rounds yet', 'Prep is saved with the tournament']} />}
        actions={
          <>
            <a className="btn btn-ghost" href="#/prep/all"><Icon name="calendar" />All tournaments</a>
            <NewTournamentButton />
          </>
        }
      />
      <div className="prep-grid">
        <div className="prep-left">
          <section className="ticket" aria-label={d.name}>
            <div className="ticket-top">
              <div className="ticket-main">
                <p className="eyebrow">{focus ? 'In focus' : 'Tournament'} <span className="sep">/</span> <span className="quiet">{dateRange(d.start_date, d.end_date)}</span></p>
                <h2>{d.name}</h2>
                <p className="where">{[d.location, rounds.length ? `${rounds.length} rounds` : null, d.time_control].filter(Boolean).join(' · ') || 'Add where and the time control'}</p>
              </div>
              <div className="ticket-side">
                <div className="score">
                  <span className="n">{points(d.score.points)}</span>
                  <span className="l">points<br />from {d.score.played}</span>
                </div>
                {next && (
                  <div className="countdown"><b>{nextWhen ?? `Round ${next.number}`}</b>{nextWhen ? `Round ${next.number}` : 'Next up'}</div>
                )}
                <div className="ticket-tools">
                  <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit details" title="Edit details"><Icon name="edit" size={15} /></button>
                  <button type="button" className="icon-btn" onClick={remove} aria-label="Delete tournament" title="Delete tournament"><Icon name="trash" size={15} /></button>
                </div>
              </div>
            </div>
            {rounds.length > 0 && (
              <div className="progress-row">
                <span className="lbl">{next ? `Round ${next.number} of ${rounds.length}` : `All ${rounds.length} rounds played`}</span>
                <span className="segbar" aria-hidden="true">
                  {rounds.map((r) => <i key={r.id} className={r.result ? 'done' : next && r.id === next.id ? 'next' : undefined} />)}
                </span>
                <span className="lbl brass">{left ? `${left} left` : 'Done'}</span>
              </div>
            )}
          </section>

          <section className="card round-card">
            <div className="card-head">
              <h2 className="card-title">Rounds</h2>
              <span className="right">
                {played} played · {left} left
                <button type="button" className="btn btn-sm" onClick={addRound}><Icon name="plus" />Add round</button>
              </span>
            </div>
            {rounds.length === 0 && <p className="muted small round-empty">Add a round when the pairings are out. Note your opponent, colour and what you expect them to play.</p>}
            <ul className="rounds">
              {shown.map((r) => <RoundRow key={r.id} tid={id} r={r} isNext={Boolean(next && r.id === next.id)} onChange={t.reload} />)}
            </ul>
          </section>

          <section className="card tour-notes">
            <div className="card-head">
              <h2 className="card-title"><Icon name="notes" />Tournament notes</h2>
              <span className="right">
                {d.notes_list.length} note{d.notes_list.length === 1 ? '' : 's'}
                <button type="button" className="btn btn-sm" onClick={addNote}><Icon name="plus" />New note</button>
              </span>
            </div>
            {d.notes_list.length === 0 ? <p className="muted small round-empty">Notes you write for this tournament appear here.</p> : (
              <ul className="tour-note-list">
                {d.notes_list.map((n) => (
                  <li key={n.id}><a href={`#/notes/${n.id}`}><span>{n.pinned ? <Icon name="pin" size={12} /> : null}{n.title || 'Untitled note'}</span><span className="muted small">{formatDate(n.updated_at)}</span></a></li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="prep-right">
          <Checklist items={d.checklist} onChange={(list) => update({ checklist: list })} />
          <Scouting round={next} />
        </div>
      </div>
      <DetailsModal d={d} open={editing} onClose={() => setEditing(false)} onSave={update} />
    </div>
  )
}

/** /prep shows the tournament in focus; with none, the list of all tournaments. */
function FocusedPrep() {
  const list = useLoad(() => api.tournaments(), [])
  if (!list.data && !list.error) return <div className="page prep-page"><p className="muted">Loading…</p></div>
  const focus = list.data ? focusOf(list.data.tournaments) : null
  if (!focus) return <TournamentList />
  return <TournamentView id={focus.id} focus />
}

export function PrepPage({ route }: { route: string[] }) {
  if (route[0] === 'opponent' && route[1]) return <OpponentPage name={decodeURIComponent(route[1])} />
  if (route[0] === 'all') return <TournamentList />
  if (route[0] && /^\d+$/.test(route[0])) return <TournamentView id={Number(route[0])} />
  return <FocusedPrep />
}
