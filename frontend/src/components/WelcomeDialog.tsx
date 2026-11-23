import { useState } from 'react'
import { api } from '../lib/api'
import { Modal } from './Modal'

const TOUR = [
  { title: 'Analysis board', text: 'Play through any position with live Stockfish. Save a board to the library and add notes to positions.' },
  { title: 'Game review', text: 'Paste a game and every move gets a label, with a reason for each mistake. Reviewed games are filed in the library.' },
  { title: 'Library', text: 'All your games and analyses by date and by opening, with your score and where your mistakes happen.' },
  { title: 'Notes', text: 'Searchable Markdown notes, tied to positions, games and tournaments.' },
  { title: 'Endgames', text: 'Twenty key endgames against a perfect defender, plus the endgames you went wrong in.' },
  { title: 'Practice and prep', text: 'Play the engine at your level, solve your own mistakes, drill your repertoire, and plan tournaments.' },
]

/** First start: ask for the player's names (to know their colour in imported games) and show what's where. */
export function WelcomeDialog({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [names, setNames] = useState('')
  const [busy, setBusy] = useState(false)
  const finish = async () => {
    setBusy(true)
    const list = names.split(',').map((n) => n.trim()).filter(Boolean)
    try {
      await api.saveSettings({ onboarded: true, ...(list.length ? { player_names: list } : {}) })
    } catch {
      /* the server may be offline; ask again next time */
    }
    setBusy(false)
    onDone()
  }
  return (
    <Modal title="Welcome to Timur" open={open} onClose={finish} wide>
      <p>Timur is a chess trainer that runs entirely on this Mac. Your games, notes and analysis stay in a local database.</p>
      <label className="field">
        <span className="field-label">What name do you play under? (as in your PGN files; several names separated by commas)</span>
        <input className="input" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Your name, your lichess username" autoFocus />
      </label>
      <p className="muted small">This lets Timur tell which side you played in games you import. You can change it later in Settings.</p>
      <ul className="tour">
        {TOUR.map((t) => (
          <li key={t.title}><strong>{t.title}</strong><span>{t.text}</span></li>
        ))}
      </ul>
      <div className="row row-end">
        <button type="button" className="btn btn-primary" onClick={finish} disabled={busy}>Start</button>
      </div>
    </Modal>
  )
}
