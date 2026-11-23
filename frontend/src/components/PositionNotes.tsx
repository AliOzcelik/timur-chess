import { useEffect, useState } from 'react'
import { api, type Note, type Opening } from '../lib/api'
import { formatDate } from '../lib/format'
import { Icon } from './Icon'

/** Notes saved for the position on the board: a collapsed card with a count, a preview, and a quick way to add one. */
export function PositionNotes({ fen, opening, gameId }: { fen: string; opening: Opening | null; gameId: number | null }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

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

  const first = notes[0]
  return (
    <section className="card notes-card position-notes" aria-label="Notes for this position">
      <button type="button" className="notes-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="notes" size={15} />
        <h3 className="t">Notes on this position</h3>
        {notes.length > 0 && <span className="count">{notes.length}</span>}
        <span className="spacer" />
        <Icon name="chevd" size={15} className={open ? 'rot' : undefined} />
      </button>
      {!open && first && (
        <a className="note-preview" href={`#/notes/${first.id}`}>
          <p>{first.title || 'Untitled note'}{first.body ? ` — ${first.body.slice(0, 140)}${first.body.length > 140 ? '…' : ''}` : ''}</p>
          <span className="meta">{first.opening && <span className="tag">{first.opening}</span>}<span>{formatDate(first.updated_at)}</span></span>
        </a>
      )}
      {open && (
        <div className="notes-body">
          {notes.length > 0 && (
            <ul className="position-note-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <a href={`#/notes/${n.id}`}>{n.title || n.body.slice(0, 60) || 'Untitled note'}</a>
                  <span className="dim">{formatDate(n.updated_at)}</span>
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
              <span className="dim small">⌘ Enter to save</span>
              <button type="submit" className="btn btn-sm" disabled={saving || !text.trim()}>
                <Icon name="plus" size={15} /> Add note
              </button>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
          </form>
        </div>
      )}
    </section>
  )
}
