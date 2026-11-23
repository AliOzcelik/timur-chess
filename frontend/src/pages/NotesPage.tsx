import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { MiniBoard } from '../components/MiniBoard'
import { useLoad } from '../hooks/useLoad'
import { api, type Note } from '../lib/api'
import { openGameOnBoard, openPositionOnBoard } from '../lib/open'
import { navigate } from '../lib/router'
import { formatDate } from './ReviewListPage'

/** Search hits come back with [[...]] around the matching words. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[.*?\]\])/g)
  return (
    <>
      {parts.map((p, i) => (p.startsWith('[[') ? <mark key={i}>{p.slice(2, -2)}</mark> : <span key={i}>{p}</span>))}
    </>
  )
}

function NoteEditor({ note, onSaved, onDeleted }: { note: Note; onSaved: (n: Note) => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [tags, setTags] = useState(note.tags)
  const [mode, setMode] = useState<'write' | 'read'>(note.body ? 'read' : 'write')
  const [state, setState] = useState<'saved' | 'saving' | 'error'>('saved')
  const timer = useRef<number>(undefined)
  const latest = useRef({ title, body, tags })
  latest.current = { title, body, tags }

  const save = async () => {
    window.clearTimeout(timer.current)
    const { title: t, body: b, tags: g } = latest.current
    if (t === note.title && b === note.body && g === note.tags) return
    setState('saving')
    try {
      onSaved(await api.updateNote(note.id, { title: t, body: b, tags: g }))
      setState('saved')
    } catch {
      setState('error')
    }
  }

  const schedule = () => {
    setState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 800)
  }

  // Save what's typed when leaving the note.
  useEffect(() => () => {
    window.clearTimeout(timer.current)
    const { title: t, body: b, tags: g } = latest.current
    if (t !== note.title || b !== note.body || g !== note.tags) api.updateNote(note.id, { title: t, body: b, tags: g }).catch(() => {})
  }, [note.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePin = async () => onSaved(await api.updateNote(note.id, { pinned: !note.pinned }))
  const remove = async () => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    window.clearTimeout(timer.current)
    latest.current = { title: note.title, body: note.body, tags: note.tags }
    await api.deleteNote(note.id)
    onDeleted()
  }

  return (
    <article className="note-editor panel" aria-label="Note">
      <div className="row-between note-toolbar">
        <div className="seg" role="tablist" aria-label="Mode">
          <button type="button" role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'seg-on' : ''} onClick={() => setMode('write')}>Write</button>
          <button type="button" role="tab" aria-selected={mode === 'read'} className={mode === 'read' ? 'seg-on' : ''} onClick={() => { save(); setMode('read') }}>Read</button>
        </div>
        <div className="row">
          <span className={`save-state save-${state}`} role="status">
            {state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : `Saved ${formatDate(note.updated_at)}`}
          </span>
          <button type="button" className={`chip ${note.pinned ? 'chip-on' : ''}`} aria-pressed={note.pinned} onClick={togglePin}>
            {note.pinned ? 'Pinned' : 'Pin'}
          </button>
          <button type="button" className="icon-btn" onClick={remove} aria-label="Delete note" title="Delete note">
            <Icon name="trash" size={17} />
          </button>
        </div>
      </div>

      <input className="note-title-input" value={title} onChange={(e) => { setTitle(e.target.value); schedule() }} onBlur={save}
        placeholder="Title" aria-label="Title" />
      <input className="input note-tags-input" value={tags} onChange={(e) => { setTags(e.target.value); schedule() }} onBlur={save}
        placeholder="Tags, comma separated: najdorf, prep, endgame" aria-label="Tags" />

      {mode === 'write' ? (
        <textarea className="input note-body-input" value={body} onChange={(e) => { setBody(e.target.value); schedule() }} onBlur={save}
          placeholder={'Write in Markdown.\n\n## Plans\n- Play f3 and g4\n- Watch out for …d5\n\n**Key idea:** …'} aria-label="Note text" />
      ) : (
        <div className="note-read" onDoubleClick={() => setMode('write')}>
          {body.trim() ? <Markdown text={body} /> : <p className="muted">Nothing written yet. Double-click or choose Write.</p>}
        </div>
      )}

      {(note.fen || note.opening || note.game_id || note.tournament_id) && (
        <footer className="note-links">
          {note.fen && (
            <div className="note-position">
              <MiniBoard fen={note.fen} orientation={note.fen.split(' ')[1] === 'b' ? 'black' : 'white'} label="Position this note is about" />
              <button type="button" className="btn btn-small" onClick={() => openPositionOnBoard(note.fen!)}>
                <Icon name="board" size={15} /> Open on board
              </button>
            </div>
          )}
          <div className="note-link-list">
            {note.opening && <p><span className="muted">Opening</span><br /><span className="eco">{note.eco}</span> {note.opening}</p>}
            {note.game_id && (
              <p><button type="button" className="link-btn" onClick={() => openGameOnBoard(note.game_id!)}>Open the game this note belongs to</button></p>
            )}
            {note.tournament_id && <p><a href={`#/prep/${note.tournament_id}`}>Go to the tournament</a></p>}
          </div>
        </footer>
      )}
    </article>
  )
}

export function NotesPage({ id }: { id: number | null }) {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(q.trim()), 200)
    return () => window.clearTimeout(t)
  }, [q])

  const list = useLoad(() => api.listNotes({ q: query, tag }), [query, tag])
  const tags = useLoad(() => api.noteTags(), [])
  const current = useLoad(() => (id ? api.getNote(id) : Promise.resolve(null)), [id])

  const create = async () => {
    try {
      const n = await api.createNote({ title: 'New note', body: '' })
      list.reload()
      navigate(`/notes/${n.id}`)
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const exportFolder = async () => {
    try {
      const r = await api.exportNotes()
      setNotice(`${r.count} notes written as Markdown files to ${r.folder}`)
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  const notes = list.data?.notes ?? []
  const empty = list.data && notes.length === 0 && !query && !tag

  return (
    <div className="page notes-page">
      <header className="page-head row-between">
        <div>
          <h1>Notes</h1>
          <p className="page-sub">Ideas, plans and lessons, linked to positions, games and tournaments.</p>
        </div>
        <div className="row">
          <details className="menu">
            <summary className="btn btn-quiet">Export</summary>
            <div className="menu-pop">
              <a className="menu-item" href="/api/notes/export/zip" download>Download as .zip of Markdown files</a>
              <button type="button" className="menu-item" onClick={exportFolder}>Write Markdown files to the data folder</button>
            </div>
          </details>
          <button type="button" className="btn btn-primary" onClick={create}><Icon name="plus" size={16} /> New note</button>
        </div>
      </header>
      {notice && <p className="notice-bar" role="status">{notice} <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={15} /></button></p>}

      {empty && !id ? (
        <div className="empty-state">
          <h2>No notes yet</h2>
          <p>Write down plans for your openings, lessons from your games, or what to remember before a tournament. Notes are searchable and can be tied to a position: on the analysis board, use “Notes on this position” under the moves.</p>
          <button type="button" className="btn btn-primary" onClick={create}>Write your first note</button>
        </div>
      ) : (
        <div className="notes-layout">
          <aside className="notes-list panel" aria-label="All notes">
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
            {(tags.data?.tags.length ?? 0) > 0 && (
              <div className="tag-row">
                {tags.data!.tags.slice(0, 14).map((t) => (
                  <button key={t.tag} type="button" className={`chip chip-small ${tag === t.tag ? 'chip-on' : ''}`} aria-pressed={tag === t.tag}
                    onClick={() => setTag(tag === t.tag ? '' : t.tag)}>
                    {t.tag}
                  </button>
                ))}
              </div>
            )}
            {list.error && <p className="form-error" role="alert">{list.error}</p>}
            {list.data && notes.length === 0 && <p className="muted small">No notes match.</p>}
            <ul className="note-rows">
              {notes.map((n) => (
                <li key={n.id}>
                  <a href={`#/notes/${n.id}`} className="note-row" aria-current={n.id === id ? 'true' : undefined}>
                    <span className="note-row-title">
                      {n.pinned && <span className="pin" aria-label="Pinned">●</span>}
                      {n.title || 'Untitled note'}
                    </span>
                    <span className="note-row-text">
                      {n.snippet ? <Snippet text={n.snippet} /> : n.body.slice(0, 110)}
                    </span>
                    <span className="note-row-meta"><span>{formatDate(n.updated_at)}</span>{n.opening && <span>{n.opening.split(':')[0]}</span>}</span>
                  </a>
                </li>
              ))}
            </ul>
          </aside>
          <section className="notes-main">
            {current.data ? (
              <NoteEditor key={current.data.id} note={current.data}
                onSaved={(n) => { current.setData(n); list.reload(); tags.reload() }}
                onDeleted={() => { list.reload(); navigate('/notes') }} />
            ) : current.error ? (
              <p className="form-error" role="alert">{current.error}</p>
            ) : (
              <p className="empty">Choose a note on the left, or write a new one.</p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
