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
import { applyTheme } from './state/theme'

const NAV = [
  { id: 'analysis', label: 'Analysis board', icon: 'board' },
  { id: 'review', label: 'Game review', icon: 'review' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { id: 'endgames', label: 'Endgames', icon: 'endgame' },
  { id: 'practice', label: 'Practice', icon: 'practice' },
  { id: 'prep', label: 'Tournament prep', icon: 'prep' },
]

function EngineStatus() {
  const health = useHealth((s) => s.health)
  const healthError = useHealth((s) => s.error)
  const connected = useEngine((s) => s.connected)
  const live = health?.engines.live
  let state: 'ok' | 'warn' | 'bad' = 'ok'
  let text = live?.name ?? 'Stockfish'
  let detail = live ? `${live.threads} threads, ${live.hash_mb >= 1024 ? `${live.hash_mb / 1024} GB` : `${live.hash_mb} MB`} hash` : ''
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
  return (
    <div className={`engine-status status-${state}`} role="status">
      <span className="status-light" aria-hidden="true" />
      <span className="status-text">
        <strong>{text}</strong>
        {detail && <span>{detail}</span>}
      </span>
    </div>
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
    applyTheme(settings.theme)
    if (!settings.onboarded) setWelcome(true)
  }, [settings?.theme, settings?.onboarded]) // eslint-disable-line react-hooks/exhaustive-deps

  const section = route[0] ?? 'analysis'
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
        <header className="page-head"><h1>Not found</h1></header>
        <p className="empty">There is no page here.</p>
        <a className="btn btn-quiet" href="#/analysis">Go to the analysis board</a>
      </div>
    )
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <nav className="sidebar" aria-label="Main">
        <a className="brand" href="#/analysis" aria-label="Timur Chess, analysis board">
          <img className="brand-mark" src="/logo-mark.png" width="32" height="32" alt="" />
          <span>Timur</span>
        </a>
        <ul className="nav-list">
          {NAV.map((item) => (
            <li key={item.id}>
              <a href={`#/${item.id}`} className="nav-item" aria-current={section === item.id ? 'page' : undefined}>
                <Icon name={item.icon} size={19} />
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>
        <a href="#/settings" className="nav-item nav-settings" aria-current={section === 'settings' ? 'page' : undefined}>
          <Icon name="settings" size={19} />
          <span>Settings</span>
        </a>
        <EngineStatus />
      </nav>
      <main id="main" className="main" key={section}>{page}</main>
      <WelcomeDialog open={welcome} onDone={() => { setWelcome(false); refresh() }} />
    </div>
  )
}
