import { useEffect, useState } from 'react'
import { api, type Note, type Opening } from '../lib/api'
import { Icon } from './Icon'

/** Notes saved for the position on the board, plus a quick way to add one. */
export function PositionNotes({ fen, opening, gameId }: { fen: string; opening: Opening | null; gameId: number | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let live = true
    const t = window.setTimeout(async () => {
      try {
        const res = await api.listNotes({ fen })
        if (live) setNotes(res.notes)
      } catch {
        if (live) setNotes([])
      }
    }, 200)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [fen])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    setSaving(true)
    try {
      const [first, ...rest] = body.split('\n')
      const note = await api.createNote({
        title: first.slice(0, 120),
        body: rest.join('\n').trim() || (first.length > 120 ? first : ''),
        fen,
        game_id: gameId,
        eco: opening?.eco ?? null,
        opening: opening?.name ?? null,
      })
      setNotes((n) => [note, ...n])
      setText('')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="position-notes" aria-label="Notes for this position">
      <h3>Notes on this position</h3>
      {notes.length > 0 && (
        <ul className="position-note-list">
          {notes.map((n) => (
            <li key={n.id}>
              <a href={`#/notes/${n.id}`}>{n.title || n.body.slice(0, 60) || 'Untitled note'}</a>
            </li>
          ))}
        </ul>
      )}
      <form className="quick-note" onSubmit={add}>
        <textarea
          className="input"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e)
          }}
          placeholder="Write a note about this position. The first line is the title."
          aria-label="New note for this position"
        />
        <div className="row-between">
          <span className="muted small">⌘ Enter to save</span>
          <button type="submit" className="btn btn-small" disabled={saving || !text.trim()}>
            <Icon name="notes" size={15} /> Save note
          </button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </section>
  )
}
