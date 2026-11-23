import { useEffect, useState } from 'react'
import { Icon } from './components/Icon'
import { WelcomeDialog } from './components/WelcomeDialog'
import { navigate, useRoute } from './lib/router'
import { AnalysisPage } from './pages/AnalysisPage'
import { DrillPage } from './pages/DrillPage'
import { EndgamesPage } from './pages/EndgamesPage'
import { LibraryPage } from './pages/LibraryPage'
import { NotesPage } from './pages/NotesPage'
import { PracticePage } from './pages/PracticePage'
import { PrepPage } from './pages/PrepPage'
import { ReviewListPage } from './pages/ReviewListPage'
import { ReviewPage } from './pages/ReviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { engineClient, useEngine } from './state/engine'
import { useHealth } from './state/health'
import { applyAppearance } from './state/theme'
import { api } from './lib/api'
import { CommandPalette } from './components/CommandPalette'
import { Toasts } from './components/Toasts'
import { Masthead } from './components/Masthead'

const STUDY = [
  { id: 'analysis', label: 'Analysis', aria: 'Analysis board', icon: 'board' },
  { id: 'review', label: 'Game review', icon: 'review' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
]
const TRAIN = [
  { id: 'endgames', label: 'Endgames', icon: 'endgame' },
  { id: 'practice', label: 'Practice', icon: 'practice' },
  { id: 'prep', label: 'Tournament prep', icon: 'prep' },
]

function hashText(mb: number): string {
  return mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`
}

function EngineStatus() {
  const health = useHealth((s) => s.health)
  const healthError = useHealth((s) => s.error)
  const connected = useEngine((s) => s.connected)
  const live = health?.engines.live
  let state: 'ok' | 'warn' | 'bad' = 'ok'
  let text = live?.name ?? 'Stockfish'
  let detail = live ? `${live.threads} threads, ${hashText(live.hash_mb)} hash` : ''
  if (healthError || !connected) {
    state = 'bad'
    text = 'Server offline'
    detail = 'Start it with ./start.sh'
  } else if (live?.error) {
    state = 'bad'
    text = 'Engine problem'
    detail = 'See the analysis board'
  } else if (!health) {
    state = 'warn'
    text = 'Connecting…'
    detail = ''
  }
  const threads = live && state === 'ok' ? Math.min(8, Math.max(1, Math.round(live.threads))) : 0
  return (
    <a className={`engine-status status-${state}`} href="#/settings" role="status" title={`${text}${detail ? ` · ${detail}` : ''}`}>
      <span className="engine-top"><span className="dot" aria-hidden="true" /><span>{text}</span></span>
      {detail && <span className="engine-meta">{detail}</span>}
      {state === 'ok' && live && (
        <span className="engine-bars" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <span key={i} className={i < threads ? 'on' : undefined} />)}
        </span>
      )}
    </a>
  )
}

/** Due counts for the Train badges: endgame lessons and puzzles that are due today. */
function useDueCounts(section: string) {
  const [due, setDue] = useState<{ endgames: number; practice: number }>({ endgames: 0, practice: 0 })
  useEffect(() => {
    let live = true
    Promise.all([api.training('endgame').catch(() => null), api.training('puzzle').catch(() => null)]).then(([e, p]) => {
      if (live) setDue({ endgames: e?.due ?? 0, practice: p?.due ?? 0 })
    })
    return () => { live = false }
  }, [section])
  return due
}

function NavLink({ item, section, badge }: { item: { id: string; label: string; aria?: string; icon: string }; section: string; badge?: number }) {
  return (
    <a
      href={`#/${item.id}`}
      className="nav-item"
      aria-label={item.aria ?? item.label}
      aria-current={section === item.id ? 'page' : undefined}
      title={item.aria ?? item.label}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
      {badge ? <span className="nav-badge" aria-label={`${badge} due`}>{badge}</span> : null}
    </a>
  )
}

export function App() {
  const route = useRoute()
  const refresh = useHealth((s) => s.refresh)
  const connected = useEngine((s) => s.connected)

  useEffect(() => {
    engineClient.connect()
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh, connected])

  useEffect(() => {
    if (route.length === 0) navigate('/analysis')
  }, [route])

  // Theme and first-run welcome come from the saved settings.
  const settings = useHealth((s) => s.health?.settings)
  const [welcome, setWelcome] = useState(false)
  useEffect(() => {
    if (!settings) return
    applyAppearance({ theme: settings.theme, accent: settings.accent, board: settings.board })
    if (!settings.onboarded) setWelcome(true)
  }, [settings?.theme, settings?.accent, settings?.board, settings?.onboarded]) // eslint-disable-line react-hooks/exhaustive-deps

  const [paletteOpen, setPaletteOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const section = route[0] ?? 'analysis'
  const due = useDueCounts(section)
  let page: React.ReactNode
  if (section === 'review') {
    const sub = route[1]
    if (sub && /^\d+$/.test(sub)) page = <ReviewPage id={Number(sub)} />
    else page = <ReviewListPage startNew={sub === 'new'} />
  } else if (section === 'analysis') {
    page = <AnalysisPage />
  } else if (section === 'library') {
    page = <LibraryPage />
  } else if (section === 'notes') {
    page = <NotesPage id={route[1] && /^\d+$/.test(route[1]) ? Number(route[1]) : null} />
  } else if (section === 'endgames') {
    page = route[1] ? <DrillPage id={decodeURIComponent(route[1])} /> : <EndgamesPage />
  } else if (section === 'practice') {
    page = <PracticePage tab={route[1] ?? 'play'} />
  } else if (section === 'prep') {
    page = <PrepPage route={route.slice(1)} />
  } else if (section === 'settings') {
    page = <SettingsPage />
  } else {
    page = (
      <div className="page">
        <Masthead section="Timur" title="Not found" />
        <div className="empty-state">
          <h2>There is no page here</h2>
          <p>The link may be old. Everything is one click away in the rail.</p>
          <a className="btn btn-primary" href="#/analysis">Go to the analysis board</a>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="rail" aria-label="Main">
        <a className="brand" href="#/analysis" aria-label="Timur Chess, analysis board">
          <img src="/logo-mark.png" width="36" height="36" alt="" />
          <div>
            <div className="brand-name">Timur</div>
            <div className="brand-sub">Chess trainer</div>
          </div>
        </a>
        <button type="button" className="search" onClick={() => setPaletteOpen(true)} aria-label="Search or jump to (Command K)">
          <Icon name="search" size={15} />
          <span>Search or jump to…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="nav-group">
          <p className="nav-label">Study</p>
          {STUDY.map((item) => <NavLink key={item.id} item={item} section={section} />)}
        </div>
        <div className="nav-group">
          <p className="nav-label">Train</p>
          {TRAIN.map((item) => (
            <NavLink key={item.id} item={item} section={section}
              badge={item.id === 'endgames' ? due.endgames : item.id === 'practice' ? due.practice : undefined} />
          ))}
        </div>
        <div className="rail-foot">
          <NavLink item={{ id: 'settings', label: 'Settings', icon: 'settings' }} section={section} />
          <EngineStatus />
        </div>
      </nav>
      <main id="main" className="main" key={section}>{page}</main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <Toasts />
      <WelcomeDialog open={welcome} onDone={() => { setWelcome(false); refresh() }} />
    </div>
  )
}
