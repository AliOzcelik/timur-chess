import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { useLoad } from '../hooks/useLoad'
import { api, type AppSettings, type Backup, type SettingsView } from '../lib/api'
import { applyTheme } from '../state/theme'
import { useHealth } from '../state/health'
import { formatDate } from './ReviewListPage'

function size(bytes: number): string {
  return bytes > 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`
}

function Backups() {
  const list = useLoad(() => api.backups(), [])
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<string>) => {
    setError(null)
    try {
      setMsg(await fn())
      list.reload()
    } catch (e) {
      setError((e as Error).message)
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
  return (
    <section className="panel" id="backups">
      <h2>Backups</h2>
      <p className="muted small">
        Everything (games, reviews, notes, training progress, tournaments, settings) is in one file. Timur makes a backup each day it starts
        and keeps the last 30, in <code>{list.data?.folder ?? 'data/backups'}</code>.
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => run(async () => `Backup ${(await api.createBackup()).name} made.`)}>Back up now</button>
        <label className="btn file-btn">
          <Icon name="import" size={16} /> Restore from a file
          <input type="file" accept=".db,application/vnd.sqlite3,application/octet-stream" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {msg && <p role="status">{msg}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {list.data && list.data.backups.length > 0 && (
        <table className="backup-table">
          <thead><tr><th>Made</th><th>Size</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {list.data.backups.map((b) => (
              <tr key={b.name}>
                <td>{new Date(b.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{b.name.includes('before-restore') ? ' (before a restore)' : b.name.includes('-auto') ? ' (daily)' : ''}</td>
                <td>{size(b.size)}</td>
                <td className="row row-end">
                  <a className="btn btn-small btn-quiet" href={`/api/backups/${encodeURIComponent(b.name)}`} download>Download</a>
                  <button type="button" className="btn btn-small btn-quiet" onClick={() => restore(b)}>Restore</button>
                  <button type="button" className="icon-btn" aria-label={`Delete backup ${b.name}`}
                    onClick={() => window.confirm('Delete this backup?') && run(async () => { await api.deleteBackup(b.name); return 'Backup deleted.' })}>
                    <Icon name="trash" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

export function SettingsPage() {
  const loaded = useLoad(() => api.settings(), [])
  const refreshHealth = useHealth((h) => h.refresh)
  const [view, setView] = useState<SettingsView | null>(null)
  const [draft, setDraft] = useState<AppSettings | null>(null)
  const [names, setNames] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded.data) {
      setView(loaded.data)
      setDraft(loaded.data.settings)
      setNames(loaded.data.settings.player_names.join(', '))
    }
  }, [loaded.data])

  if (loaded.error) return <div className="page"><p className="form-error">{loaded.error}</p></div>
  if (!view || !draft) return <div className="page"><p className="muted">Loading…</p></div>

  const save = async (changes: Partial<AppSettings>, note = 'Saved.') => {
    setError(null)
    try {
      const v = await api.saveSettings(changes)
      setView(v)
      setDraft(v.settings)
      if (changes.theme) applyTheme(changes.theme)
      setMsg(note)
      refreshHealth()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => setDraft({ ...draft, [k]: v })
  const engineChanged = (['stockfish_path', 'live_threads', 'live_hash_mb', 'review_threads', 'review_hash_mb'] as const)
    .some((k) => draft[k] !== view.settings[k])
  const t = draft.thresholds

  return (
    <div className="page settings-page">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="page-sub">Stored in your local database, together with your games.</p>
      </header>
      {msg && <p className="notice-bar" role="status">{msg} <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setMsg(null)}><Icon name="close" size={15} /></button></p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="settings-grid">
        <section className="panel">
          <h2>You</h2>
          <label className="field">
            <span className="field-label">Your names as they appear in PGN files</span>
            <input className="input" value={names} onChange={(e) => setNames(e.target.value)} onBlur={() => {
              const list = names.split(',').map((n) => n.trim()).filter(Boolean)
              if (list.join(',') !== view.settings.player_names.join(',')) save({ player_names: list }, 'Names saved.')
            }} placeholder="Your name, your lichess username" />
          </label>
          <p className="muted small">Timur uses these to know which side you played in imported games, so your scores and puzzles are about your moves. Separate names with commas.</p>
        </section>

        <section className="panel">
          <h2>Appearance</h2>
          <fieldset className="choice-group">
            <legend>Theme</legend>
            {(['system', 'dark', 'light'] as const).map((th) => (
              <label key={th}>
                <input type="radio" name="theme" checked={draft.theme === th} onChange={() => save({ theme: th }, 'Theme changed.')} />
                {th === 'system' ? 'Same as this Mac' : th === 'dark' ? 'Dark' : 'Light'}
              </label>
            ))}
          </fieldset>
        </section>

        <section className="panel">
          <h2>Game review</h2>
          <label className="field">
            <span className="field-label">Default depth for new reviews</span>
            <select className="input" value={draft.default_profile} onChange={(e) => save({ default_profile: e.target.value as AppSettings['default_profile'] })}>
              <option value="quick">Quick (depth 14)</option>
              <option value="standard">Standard (depth 18)</option>
              <option value="deep">Deep (depth 22)</option>
            </select>
          </label>
          <fieldset className="field">
            <legend>A move is labelled when it lowers your winning chance by at least</legend>
            <div className="form-grid three">
              {(['inaccuracy', 'mistake', 'blunder'] as const).map((k) => (
                <label key={k} className="field">
                  <span className="field-label">{k[0].toUpperCase() + k.slice(1)}</span>
                  <input className="input" type="number" min={1} max={60} step={0.5} value={t[k]}
                    onChange={(e) => set('thresholds', { ...t, [k]: Number(e.target.value) })} />
                </label>
              ))}
            </div>
          </fieldset>
          <p className="muted small">In percentage points of winning chance. The defaults (5, 10, 15) are the ones lichess uses. New reviews use your values; old ones keep theirs.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => save({ thresholds: t }, 'Thresholds saved.')}
              disabled={JSON.stringify(t) === JSON.stringify(view.settings.thresholds)}>Save thresholds</button>
            <button type="button" className="btn btn-quiet" onClick={() => save({ thresholds: view.defaults.thresholds }, 'Thresholds reset.')}>Use the defaults</button>
          </div>
        </section>

        <section className="panel">
          <h2>Engine</h2>
          <label className="field">
            <span className="field-label">Stockfish program</span>
            <input className="input" value={draft.stockfish_path} onChange={(e) => set('stockfish_path', e.target.value)}
              placeholder={view.detected_stockfish ?? 'Not found: brew install stockfish'} />
          </label>
          <p className="muted small">Leave empty to use the one found automatically{view.detected_stockfish ? ` (${view.detected_stockfish})` : ''}.</p>
          <div className="form-grid">
            <label className="field"><span className="field-label">Analysis board threads</span>
              <input className="input" type="number" min={1} max={view.cpu_count} value={draft.live_threads} onChange={(e) => set('live_threads', Number(e.target.value))} /></label>
            <label className="field"><span className="field-label">Analysis board hash (MB)</span>
              <input className="input" type="number" min={16} step={16} value={draft.live_hash_mb} onChange={(e) => set('live_hash_mb', Number(e.target.value))} /></label>
            <label className="field"><span className="field-label">Game review threads</span>
              <input className="input" type="number" min={1} max={view.cpu_count} value={draft.review_threads} onChange={(e) => set('review_threads', Number(e.target.value))} /></label>
            <label className="field"><span className="field-label">Game review hash (MB)</span>
              <input className="input" type="number" min={16} step={16} value={draft.review_hash_mb} onChange={(e) => set('review_hash_mb', Number(e.target.value))} /></label>
          </div>
          <p className="muted small">
            This Mac has {view.cpu_count} cores. Keep the two thread counts together below that, so a review never slows down the board.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={!engineChanged} onClick={() => save({
              stockfish_path: draft.stockfish_path, live_threads: draft.live_threads, live_hash_mb: draft.live_hash_mb,
              review_threads: draft.review_threads, review_hash_mb: draft.review_hash_mb,
            }, 'Engine settings saved. Stockfish restarts with them.')}>Apply engine settings</button>
            <button type="button" className="btn btn-quiet" onClick={async () => {
              if (!window.confirm('Reset all settings to their defaults? Your names are cleared too.')) return
              const v = await api.resetSettings()
              setView(v); setDraft(v.settings); setNames(''); applyTheme(v.settings.theme); setMsg('Settings reset.')
            }}>Reset all settings</button>
          </div>
        </section>

        <section className="panel">
          <h2>Endgame tablebases</h2>
          {view.tablebases.available ? (
            <p>Installed: {view.tablebases.files} files for every position with up to {view.tablebases.max_pieces} pieces. The endgame trainer and Stockfish both use them.</p>
          ) : (
            <p>Not installed. Run <code>./scripts/get-tablebases.sh</code> in the Timur folder (about 1 GB), then press Check again.</p>
          )}
          <p className="muted small"><code>{view.tablebases.path}</code></p>
          <button type="button" className="btn" onClick={async () => {
            const tb = await api.reloadTablebases()
            setView({ ...view, tablebases: tb })
            setMsg(tb.available ? 'Tablebases found.' : 'Still no tablebases in that folder.')
          }}>Check again</button>
        </section>

        <section className="panel">
          <h2>Internet</h2>
          <label className="switch">
            <input type="checkbox" checked={draft.allow_internet} onChange={(e) => save({ allow_internet: e.target.checked }, e.target.checked ? 'Internet use allowed for downloading games.' : 'Timur is fully offline again.')} />
            <span className="switch-track" aria-hidden="true" />
            <span>Allow downloading opponents’ games from lichess and Chess.com</span>
          </label>
          <p className="muted small">Off by default. Nothing else ever leaves this computer; only the usernames you look up are sent to those sites.</p>
        </section>

        <Backups />
      </div>
    </div>
  )
}
