import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { Masthead, Meta } from '../components/Masthead'
import { MiniBoard } from '../components/MiniBoard'
import { useLoad } from '../hooks/useLoad'
import { api, type Accent, type AppSettings, type Backup, type BoardPalette, type LlmStatus, type SettingsView, type Theme } from '../lib/api'
import { formatDate } from '../lib/format'
import { applyAppearance } from '../state/theme'
import { useHealth } from '../state/health'
import { toast } from '../state/toast'

function size(bytes: number): string {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
}

const SECTIONS = [
  { id: 'you', label: 'You', icon: 'people' },
  { id: 'appearance', label: 'Appearance', icon: 'grid' },
  { id: 'review', label: 'Game review', icon: 'review' },
  { id: 'ai', label: 'AI coach', icon: 'spark' },
  { id: 'engine', label: 'Engine', icon: 'settings' },
  { id: 'tablebases', label: 'Tablebases', icon: 'endgame' },
  { id: 'internet', label: 'Internet', icon: 'link' },
  { id: 'backups', label: 'Backups', icon: 'save' },
]

const MODES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
]
const ACCENTS: { id: Accent; label: string; sw: string }[] = [
  { id: 'brass', label: 'Brass', sw: '#D2A54E' },
  { id: 'ember', label: 'Ember', sw: '#E2874B' },
  { id: 'amethyst', label: 'Amethyst', sw: '#B79ADE' },
  { id: 'cobalt', label: 'Cobalt', sw: '#7C8FE8' },
]
const BOARDS: { id: BoardPalette; label: string; b1: string; b2: string }[] = [
  { id: 'walnut', label: 'Walnut', b1: '#EDE4D1', b2: '#A17A55' },
  { id: 'slate', label: 'Slate', b1: '#E9E3D5', b2: '#7D8EA0' },
  { id: 'moss', label: 'Moss', b1: '#EDE6D3', b2: '#6F7F63' },
  { id: 'rosewood', label: 'Rosewood', b1: '#F0E3D2', b2: '#8E5E55' },
]

/** Highlights the section of the settings that is on screen. */
function useScrollSpy(ids: string[]): string {
  const [active, setActive] = useState(ids[0])
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const seen = new Map<string, boolean>()
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting)
      const first = ids.find((id) => seen.get(id))
      if (first) setActive(first)
    }, { rootMargin: '-10% 0px -55% 0px' })
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) obs.observe(el)
    }
    return () => obs.disconnect()
  }, [ids.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  return active
}

function AppearanceCard({ s, onSave }: { s: AppSettings; onSave: (c: Partial<AppSettings>) => void }) {
  const choose = (c: Partial<AppSettings>) => {
    applyAppearance(c)
    onSave(c)
  }
  const accent = ACCENTS.find((a) => a.id === s.accent) ?? ACCENTS[0]
  return (
    <section className="card span2 appearance-card" id="appearance" aria-labelledby="appearance-title">
      <div className="card-head">
        <h2 className="card-title" id="appearance-title">Appearance</h2>
        <span className="right">Applies instantly · saved with the rest of your settings</span>
      </div>
      <div className="appearance-body">
        <div className="ap-block" role="radiogroup" aria-label="Mode">
          <div className="ap-label">Mode</div>
          <div className="ap-modes">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={s.theme === m.id} className={`ap-mode ${s.theme === m.id ? 'on' : ''}`} onClick={() => choose({ theme: m.id })}>
                <span className={`prev ${m.id}`} aria-hidden="true" />
                <span className="lbl">{m.id === 'system' ? 'Same as this Mac' : m.label}{s.theme === m.id && <Icon name="check" size={11} />}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ap-block" role="radiogroup" aria-label="Accent">
          <div className="ap-label">Accent</div>
          <div className="ap-swatches">
            {ACCENTS.map((a) => (
              <button key={a.id} type="button" role="radio" aria-checked={s.accent === a.id} className={`ap-swatch ${s.accent === a.id ? 'on' : ''}`}
                style={{ '--sw': a.sw } as React.CSSProperties} onClick={() => choose({ accent: a.id })}>
                <i aria-hidden="true" />{a.label}
              </button>
            ))}
          </div>
          <p className="ap-help">Brass is the house default. The room and the board stay; the fittings change.</p>
        </div>
        <div className="ap-block" role="radiogroup" aria-label="Board">
          <div className="ap-label">Board</div>
          <div className="ap-boards">
            {BOARDS.map((b) => (
              <button key={b.id} type="button" role="radio" aria-checked={s.board === b.id} className={`ap-board ${s.board === b.id ? 'on' : ''}`} onClick={() => choose({ board: b.id })}>
                <i aria-hidden="true" style={{ '--b1': b.b1, '--b2': b.b2 } as React.CSSProperties} />{b.label}
              </button>
            ))}
          </div>
          <p className="ap-help">The pieces and the frame never change.</p>
        </div>
        <div className="ap-preview" aria-hidden="true">
          <div className="ap-label">Preview</div>
          <div className="ap-preview-body">
            <div className="ap-preview-board"><MiniBoard fen="8/8/8/4k3/8/8/8/3QK3 w - - 0 1" /></div>
            <div className="ap-preview-info">
              <span className="badge brass">{accent.label}</span>
              <div className="big-eval">+0.26</div>
              <span className="btn btn-primary btn-sm"><Icon name="spark" />Review</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Backups() {
  const list = useLoad(() => api.backups(), [])
  const run = async (fn: () => Promise<string>) => {
    try {
      toast(await fn(), 'success')
      list.reload()
    } catch (e) {
      toast((e as Error).message, 'error')
    }
  }
  const restore = (b: Backup) => {
    if (!window.confirm(`Restore the backup from ${formatDate(b.created_at)}? Everything after it is replaced. A safety backup of the current data is made first.`)) return
    run(async () => {
      const r = await api.restoreBackup(b.name)
      return `Restored. Your previous data was saved as ${r.safety_backup}. Reload the page to see it.`
    })
  }
  const upload = (file: File | undefined) => {
    if (!file) return
    if (!window.confirm(`Restore from ${file.name}? Your current data is replaced. A safety backup is made first.`)) return
    run(async () => {
      const r = await api.restoreUpload(file)
      return `Restored from ${file.name}. Your previous data was saved as ${r.safety_backup}. Reload the page to see it.`
    })
  }
  const backups = list.data?.backups ?? []
  const latest = backups[0]
  return (
    <section className="card span2" id="backups" aria-labelledby="backups-title">
      <div className="card-head"><h2 className="card-title" id="backups-title">Backups</h2><span className="right">{backups.length} kept</span></div>
      <div className="set-body">
        <div className="status-line">
          <span className={latest ? 'ok' : 'warn'} aria-hidden="true" />
          <span>{latest
            ? <>Latest backup · <b>{new Date(latest.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</b></>
            : 'No backups yet'} · daily, the last 30 are kept in <b>{list.data?.folder ?? 'data/backups'}</b></span>
        </div>
        <p className="set-help">Everything (games, reviews, notes, training progress, tournaments, settings) is in one file.</p>
        <div className="row set-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => run(async () => `Backup ${(await api.createBackup()).name} made.`)}><Icon name="save" />Back up now</button>
          <label className="btn btn-sm file-btn">
            <Icon name="upload" />Restore from a file
            <input type="file" accept=".db,application/vnd.sqlite3,application/octet-stream" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </div>
        {backups.length > 0 && (
          <table className="backup-table">
            <thead><tr><th>Made</th><th>Size</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.name}>
                  <td>
                    {new Date(b.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    {b.name.includes('before-restore') ? <span className="tag">before a restore</span> : b.name.includes('-auto') ? <span className="tag">daily</span> : null}
                  </td>
                  <td>{size(b.size)}</td>
                  <td>
                    <div className="row row-end">
                      <a className="btn btn-sm btn-ghost" href={`/api/backups/${encodeURIComponent(b.name)}`} download><Icon name="download" />Download</a>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => restore(b)}><Icon name="refresh" />Restore</button>
                      <button type="button" className="icon-btn" aria-label={`Delete backup ${b.name}`}
                        onClick={() => window.confirm('Delete this backup?') && run(async () => { await api.deleteBackup(b.name); return 'Backup deleted.' })}>
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}

export function SettingsPage() {
  const loaded = useLoad(() => api.settings(), [])
  const refreshHealth = useHealth((h) => h.refresh)
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [names, setNames] = useState('')
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const active = useScrollSpy(SECTIONS.map((s) => s.id))

  useEffect(() => {
    if (loaded.data) {
      setView(loaded.data)
      setDraft(loaded.data.settings)
      setNames(loaded.data.settings.player_names.join(', '))
    }
  }, [loaded.data])

  const head = (sub?: React.ReactNode, actions?: React.ReactNode) => (
    <Masthead section="Timur" page="Settings" title="Settings" sub={sub} actions={actions} />
  )
  if (loaded.error) return <div className="page settings-page">{head()}<p className="form-error">{loaded.error}</p></div>
  if (!view || !draft) return <div className="page settings-page">{head()}<p className="muted">Loading…</p></div>

  const save = async (changes: Partial<AppSettings>, note?: string) => {
    setState('saving')
    try {
      const v = await api.saveSettings(changes)
      setView(v)
      setDraft((d) => ({ ...(d ?? v.settings), ...changes, ...pick(v.settings, Object.keys(changes) as (keyof AppSettings)[]) }))
      setState('saved')
      if (note) toast(note, 'success')
      refreshHealth()
    } catch (e) {
      setState('error')
      toast((e as Error).message, 'error')
    }
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft({ ...draft, [k]: v })
  const engineChanged = (['stockfish_path', 'live_threads', 'live_hash_mb', 'review_threads', 'review_hash_mb'] as const)
    .some((k) => draft[k] !== view.settings[k])
  const t = draft.thresholds
  const nameList = names.split(',').map((n) => n.trim()).filter(Boolean)
  const cores = Math.max(1, view.cpu_count)

  return (
    <div className="page settings-page">
      {head(
        <Meta items={[<>Stored in <span className="hl" title={`${view.data_dir}/timur.db`}>{shortPath(view.data_dir)}/timur.db</span>, together with your games</>, 'Changes save immediately']} />,
        <span className={`badge ${state === 'error' ? 'danger' : state === 'saving' ? 'warn' : 'live'}`} role="status">
          <span className="dot" aria-hidden="true" />{state === 'error' ? 'Not saved' : state === 'saving' ? 'Saving…' : 'All changes saved'}
        </span>,
      )}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#/settings`} className={`item ${active === s.id ? 'on' : ''}`} aria-current={active === s.id ? 'true' : undefined}
              onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>
              <Icon name={s.icon} size={15} />{s.label}
              {s.id === 'tablebases' && view.tablebases.available && <span className="n">{view.tablebases.files}</span>}
            </a>
          ))}
        </nav>

        <div className="settings-content">
          <section className="card span2" id="you" aria-labelledby="you-title">
            <div className="card-head"><h2 className="card-title" id="you-title">You</h2></div>
            <div className="set-body">
              <label className="set-field">
                <span className="set-label">Your names as they appear in PGN files</span>
                <span className="set-input-wrap">
                  <input className="input" value={names} onChange={(e) => setNames(e.target.value)} onBlur={() => {
                    if (nameList.join(',') !== view.settings.player_names.join(',')) save({ player_names: nameList }, 'Names saved.')
                  }} placeholder="Your name, your lichess username" />
                  <span className="input-note">{nameList.length} name{nameList.length === 1 ? '' : 's'}</span>
                </span>
              </label>
              <p className="set-help">Timur uses these to know which side you played in imported games, so your scores and puzzles are about your moves. Separate names with commas.</p>
            </div>
          </section>

          <AppearanceCard s={draft} onSave={(c) => { setDraft({ ...draft, ...c }); save(c) }} />

          <section className="card" id="review" aria-labelledby="review-title">
            <div className="card-head"><h2 className="card-title" id="review-title">Game review</h2></div>
            <div className="set-body">
              <label className="set-field set-inline">
                <span className="set-label">Default depth</span>
                <span className="select"><select value={draft.default_profile} onChange={(e) => save({ default_profile: e.target.value as AppSettings['default_profile'] })}>
                  <option value="quick">Quick · 14</option>
                  <option value="standard">Standard · 18</option>
                  <option value="deep">Deep · 22</option>
                </select></span>
              </label>
              <fieldset className="set-field">
                <legend className="set-label">Label a move when it lowers the win chance by</legend>
                <div className="set-trio">
                  {(['inaccuracy', 'mistake', 'blunder'] as const).map((k) => (
                    <label key={k} className="set-num">
                      <span>{k === 'inaccuracy' ? 'Inacc.' : k[0].toUpperCase() + k.slice(1)}</span>
                      <input type="number" min={1} max={60} step={0.5} value={t[k]} aria-label={k[0].toUpperCase() + k.slice(1)}
                        onChange={(e) => set('thresholds', { ...t, [k]: Number(e.target.value) })} />
                    </label>
                  ))}
                </div>
                <p className="set-help">Percentage points. The defaults (5, 10, 15) are the same cut-offs lichess uses. New reviews use your values; old ones keep theirs.</p>
              </fieldset>
              <div className="row set-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={() => save({ thresholds: t }, 'Thresholds saved.')}
                  disabled={JSON.stringify(t) === JSON.stringify(view.settings.thresholds)}>Save thresholds</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => save({ thresholds: view.defaults.thresholds }, 'Thresholds reset.')}>Use the defaults</button>
              </div>
            </div>
          </section>

          <CoachCard s={draft} saved={view.settings} onSave={(c, note) => { setDraft({ ...draft, ...c }); save(c, note) }} />

          <section className="card" id="engine" aria-labelledby="engine-title">
            <div className="card-head"><h2 className="card-title" id="engine-title">Engine</h2><span className="right">{view.detected_stockfish ? 'Stockfish found' : 'Stockfish not found'}</span></div>
            <div className="set-body">
              <div className="thread-row"><span className="nm">Analysis board</span><span className="bar"><i style={{ width: `${Math.min(100, (draft.live_threads / cores) * 100)}%` }} /></span><span className="v">{draft.live_threads} threads</span></div>
              <div className="thread-row"><span className="nm">Game review</span><span className="bar"><i style={{ width: `${Math.min(100, (draft.review_threads / cores) * 100)}%` }} /></span><span className="v">{draft.review_threads} threads</span></div>
              <div className="set-grid">
                <label className="set-num"><span>Board threads</span>
                  <input type="number" min={1} max={view.cpu_count} value={draft.live_threads} onChange={(e) => set('live_threads', Number(e.target.value))} aria-label="Analysis board threads" /></label>
                <label className="set-num"><span>Board hash MB</span>
                  <input type="number" min={16} step={16} value={draft.live_hash_mb} onChange={(e) => set('live_hash_mb', Number(e.target.value))} aria-label="Analysis board hash (MB)" /></label>
                <label className="set-num"><span>Review threads</span>
                  <input type="number" min={1} max={view.cpu_count} value={draft.review_threads} onChange={(e) => set('review_threads', Number(e.target.value))} aria-label="Game review threads" /></label>
                <label className="set-num"><span>Review hash MB</span>
                  <input type="number" min={16} step={16} value={draft.review_hash_mb} onChange={(e) => set('review_hash_mb', Number(e.target.value))} aria-label="Game review hash (MB)" /></label>
              </div>
              <label className="set-field">
                <span className="set-label">Stockfish program</span>
                <input className="input" value={draft.stockfish_path} onChange={(e) => set('stockfish_path', e.target.value)}
                  placeholder={view.detected_stockfish ?? 'Not found: brew install stockfish'} />
              </label>
              <p className="set-help">
                Leave the program empty to use the one found automatically. This Mac has {view.cpu_count} cores; keep the two thread counts together below that, so a review never slows down the board.
              </p>
              <div className="row set-actions">
                <button type="button" className="btn btn-sm btn-primary" disabled={!engineChanged} onClick={() => save({
                  stockfish_path: draft.stockfish_path, live_threads: draft.live_threads, live_hash_mb: draft.live_hash_mb,
                  review_threads: draft.review_threads, review_hash_mb: draft.review_hash_mb,
                }, 'Engine settings saved. Stockfish restarts with them.')}>Apply engine settings</button>
                <button type="button" className="btn btn-sm btn-ghost" onClick={async () => {
                  if (!window.confirm('Reset all settings to their defaults? Your names are cleared too.')) return
                  const v = await api.resetSettings()
                  setView(v); setDraft(v.settings); setNames('')
                  applyAppearance({ theme: v.settings.theme, accent: v.settings.accent, board: v.settings.board })
                  toast('Settings reset.')
                  refreshHealth()
                }}>Reset all settings</button>
              </div>
            </div>
          </section>

          <section className="card" id="tablebases" aria-labelledby="tb-title">
            <div className="card-head"><h2 className="card-title" id="tb-title">Tablebases</h2></div>
            <div className="set-body">
              {view.tablebases.available ? (
                <div className="status-line"><span className="ok" aria-hidden="true" /><span><b>{view.tablebases.files} files</b> · every position up to {view.tablebases.max_pieces} pieces</span></div>
              ) : (
                <div className="status-line"><span className="warn" aria-hidden="true" /><span><b>Not installed</b> · run <code>./scripts/get-tablebases.sh</code> (about 1 GB)</span></div>
              )}
              <div className="status-line"><span className={view.tablebases.available ? 'ok' : 'off'} aria-hidden="true" /><span><b className="path">{view.tablebases.path}</b> · checked on start</span></div>
              <p className="set-help">The endgame trainer and Stockfish both use them.</p>
              <button type="button" className="btn btn-sm" onClick={async () => {
                const tb = await api.reloadTablebases()
                setView({ ...view, tablebases: tb })
                toast(tb.available ? 'Tablebases found.' : 'Still no tablebases in that folder.', tb.available ? 'success' : 'info')
              }}><Icon name="refresh" />Check again</button>
            </div>
          </section>

          <section className="card" id="internet" aria-labelledby="net-title">
            <div className="card-head"><h2 className="card-title" id="net-title">Internet</h2><span className="right">{draft.allow_internet ? 'On' : 'Off'}</span></div>
            <div className="set-body">
              <label className="switch">
                <input type="checkbox" checked={draft.allow_internet} onChange={(e) => save({ allow_internet: e.target.checked }, e.target.checked ? 'Internet use allowed for downloading games.' : 'Timur is fully offline again.')} />
                <span className="switch-track" aria-hidden="true" />
                <span>Allow downloading opponents’ games from lichess and Chess.com</span>
              </label>
              <p className="set-help">Off by default. Nothing else ever leaves this computer; only the usernames you look up are sent to those sites.</p>
            </div>
          </section>

          <Backups />
        </div>
      </div>
    </div>
  )
}

/** Settings for the local LLM that writes mistake explanations in Game Review. */
function CoachCard({ s, saved, onSave }: {
  s: AppSettings
  saved: AppSettings
  onSave: (changes: Partial<AppSettings>, note?: string) => void
}) {
  const [url, setUrl] = useState(s.llm_base_url)
  const [model, setModel] = useState(s.llm_model)
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try { setStatus(await api.llmStatus()) } catch { setStatus(null) } finally { setChecking(false) }
  }, [])
  useEffect(() => { check() }, [check, saved.llm_enabled, saved.llm_base_url, saved.llm_model])

  const changed = url.trim() !== saved.llm_base_url || model.trim() !== saved.llm_model
  const ok = status?.reachable && status.installed

  return (
    <section className="card" id="ai" aria-labelledby="ai-title">
      <div className="card-head"><h2 className="card-title" id="ai-title">AI coach</h2><span className="right">{s.llm_enabled ? 'On' : 'Off'}</span></div>
      <div className="set-body">
        <label className="switch">
          <input type="checkbox" checked={s.llm_enabled} onChange={(e) => onSave({ llm_enabled: e.target.checked }, e.target.checked ? 'AI explanations turned on.' : 'AI explanations turned off.')} />
          <span className="switch-track" aria-hidden="true" />
          <span>Explain mistakes in Game Review with a local model</span>
        </label>
        {s.llm_enabled && (
          <div className="status-line" role="status">
            <span className={checking ? 'off' : ok ? 'ok' : 'warn'} aria-hidden="true" />
            <span>{checking ? 'Checking…' : ok ? <><b>{saved.llm_model}</b> is ready</> : status?.error ?? 'Not checked yet'}</span>
          </div>
        )}
        <label className="set-field">
          <span className="set-label">Model</span>
          <input className="input" value={model} onChange={(e) => setModel(e.target.value)} list="llm-models" placeholder="gemma4:12b-mlx" />
          <datalist id="llm-models">{(status?.models ?? []).map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label className="set-field">
          <span className="set-label">Model server</span>
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:11434/v1" />
        </label>
        <p className="set-help">
          Any server with an OpenAI-style API works (Ollama, LM Studio, llama.cpp). Stockfish and the board checks supply the facts; the model only puts them into words. Keep the server on this Mac (localhost) so nothing leaves it.
        </p>
        <div className="row set-actions">
          <button type="button" className="btn btn-sm btn-primary" disabled={!changed || !model.trim()}
            onClick={() => onSave({ llm_base_url: url.trim(), llm_model: model.trim() }, 'AI coach settings saved.')}>Save</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={check} disabled={checking}><Icon name="refresh" />Check again</button>
        </div>
      </div>
    </section>
  )
}

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) out[k] = o[k]
  return out
}

/** The last two folders of a path: enough to recognise it without a wall of text. */
function shortPath(p: string): string {
  const parts = p.split('/').filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p
}
