import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { Masthead, Meta } from '../components/Masthead'
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

  const kind = note.fen ? 'Position note' : note.tournament_id ? 'Tournament note' : note.game_id ? 'Game note' : note.opening ? 'Opening note' : 'Note'
  return (
    <article className="note-sheet note-editor" aria-label="Note">
      <div className="note-head">
        <div className="kicker">
          {note.pinned && <><span className="pin">●</span>Pinned<span>·</span></>}
          {kind}<span>·</span>
          <span className={`save-state save-${state}`} role="status">
            {state === 'saving' ? 'Saving…' : state === 'error' ? 'Not saved' : `Saved ${formatDate(note.updated_at)}`}
          </span>
        </div>
        <input className="note-title-input" value={title} onChange={(e) => { setTitle(e.target.value); schedule() }} onBlur={save}
          placeholder="Title" aria-label="Title" />
        <div className="note-toolbar">
          <div className="seg" role="tablist" aria-label="Mode">
            <button type="button" role="tab" aria-selected={mode === 'read'} className={mode === 'read' ? 'seg-on' : ''} onClick={() => { save(); setMode('read') }}>Read</button>
            <button type="button" role="tab" aria-selected={mode === 'write'} className={mode === 'write' ? 'seg-on' : ''} onClick={() => setMode('write')}>Write</button>
          </div>
          <input className="note-tags-input" value={tags} onChange={(e) => { setTags(e.target.value); schedule() }} onBlur={save}
            placeholder="Tags, comma separated" aria-label="Tags" />
          <span className="spacer" />
          {note.opening && <span className="badge brass">{note.opening.split(':')[0]}</span>}
          <button type="button" className={`icon-btn bordered ${note.pinned ? 'on' : ''}`} aria-pressed={note.pinned} onClick={togglePin} aria-label={note.pinned ? 'Unpin' : 'Pin'} title={note.pinned ? 'Unpin' : 'Pin to the top'}>
            <Icon name="pin" size={16} />
          </button>
          <button type="button" className="icon-btn" onClick={remove} aria-label="Delete note" title="Delete note">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>

      <div className="note-body">
        {mode === 'write' ? (
          <textarea className="note-body-input note-prose" value={body} onChange={(e) => { setBody(e.target.value); schedule() }} onBlur={save}
            placeholder={'Write in Markdown.\n\n## Plans\n- Play f3 and g4\n- Watch out for …d5\n\n> **Key idea:** …'} aria-label="Note text" autoFocus={!note.body} />
        ) : (
          <div className="note-read note-prose" onDoubleClick={() => setMode('write')}>
            {body.trim() ? <Markdown text={body} /> : <p className="muted">Nothing written yet. Double-click or choose Write.</p>}
          </div>
        )}
      </div>

      {(note.fen || note.opening || note.game_id || note.tournament_id) && (
        <footer className="note-foot note-links">
          {note.fen && (
            <div className="note-position">
              <MiniBoard fen={note.fen} orientation={note.fen.split(' ')[1] === 'b' ? 'black' : 'white'} label="Position this note is about" />
            </div>
          )}
          <div className="cap">
            {note.fen ? <b>Linked to a position</b> : <b>Linked</b>}
            {note.opening ? <><span className="eco">{note.eco}</span> {note.opening}</> : 'The note appears on the board whenever this position comes up.'}
          </div>
          <div className="links note-link-list">
            {note.fen && <button type="button" className="link-btn" onClick={() => openPositionOnBoard(note.fen!)}><Icon name="board" size={13} />Open on board</button>}
            {note.game_id && <button type="button" className="link-btn" onClick={() => openGameOnBoard(note.game_id!)}><Icon name="library" size={13} />Open the game</button>}
            {note.tournament_id && <a href={`#/prep/${note.tournament_id}`}><Icon name="prep" size={13} />Go to the tournament</a>}
          </div>
        </footer>
      )}
    </article>
  )
}

const TEMPLATES = [
  { title: 'Opening plan', tags: 'opening, plan', body: '## The idea\n\n\n## Typical plans\n- \n- \n\n## Watch out for\n- \n\n> Key position: …' },
  { title: 'Endgame lesson', tags: 'endgame', body: '## The position\n\n\n## The method\n1. \n2. \n3. \n\n> The rule to remember: …' },
  { title: 'Tournament log', tags: 'tournament', body: '## Round by round\n- Round 1: \n- Round 2: \n\n## What went well\n\n\n## What to work on\n' },
]

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
  const pinned = notes.filter((n) => n.pinned).length

  // With no note chosen, open the newest one so the sheet is never blank.
  useEffect(() => {
    if (!id && notes.length && !query && !tag) window.location.replace(`#/notes/${notes[0].id}`)
  }, [id, notes, query, tag])

  const fromTemplate = async (t: (typeof TEMPLATES)[number]) => {
    try {
      const n = await api.createNote({ title: t.title, body: t.body, tags: t.tags })
      list.reload()
      tags.reload()
      navigate(`/notes/${n.id}`)
    } catch (e) {
      setNotice((e as Error).message)
    }
  }

  return (
    <div className="page notes-page">
      <Masthead
        section="Study"
        page="Notes"
        title="Notes"
        sub={<Meta items={[
          list.data && !query && !tag ? `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}` : 'Ideas, plans and lessons, linked to positions, games and tournaments.',
          pinned ? `${pinned} pinned` : null,
          tags.data?.tags.length ? `${tags.data.tags.length} ${tags.data.tags.length === 1 ? 'tag' : 'tags'}` : null,
        ]} />}
        actions={
          <>
            <details className="menu">
              <summary className="btn btn-ghost"><Icon name="download" />Export</summary>
              <div className="menu-pop">
                <a className="menu-item" href="/api/notes/export/zip" download>Download as .zip of Markdown files</a>
                <button type="button" className="menu-item" onClick={exportFolder}>Write Markdown files to the data folder</button>
              </div>
            </details>
            <button type="button" className="btn btn-primary" onClick={create}><Icon name="plus" />New note</button>
          </>
        }
      />
      {notice && <p className="notice-bar" role="status">{notice} <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}><Icon name="close" size={15} /></button></p>}

      {empty && !id ? (
        <div className="empty-state">
          <p className="eyebrow">Notes</p>
          <h2>A study is a record of what you learned</h2>
          <p>Write a position note, an opening plan, or a tournament log. Notes are searchable, and a note tied to a position shows up on the analysis board whenever that position comes back.</p>
          <div className="template-row">
            {TEMPLATES.map((t) => (
              <button key={t.title} type="button" className="template-card" onClick={() => fromTemplate(t)}>
                <Icon name={t.tags.startsWith('endgame') ? 'endgame' : t.tags.startsWith('tournament') ? 'prep' : 'book'} />
                <span>{t.title}</span>
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={create}><Icon name="plus" />Write your first note</button>
        </div>
      ) : (
        <div className="notes-grid notes-layout">
          <aside className="card notes-list-card notes-list" aria-label="All notes">
            <div className="notes-search">
              <label className="searchbox">
                <Icon name="search" size={15} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
              </label>
            </div>
            {(tags.data?.tags.length ?? 0) > 0 && (
              <div className="note-tags tag-row">
                <button type="button" className={`chip chip-small ${!tag ? 'chip-on' : ''}`} aria-pressed={!tag} onClick={() => setTag('')}>All</button>
                {tags.data!.tags.slice(0, 14).map((t) => (
                  <button key={t.tag} type="button" className={`chip chip-small ${tag === t.tag ? 'chip-on' : ''}`} aria-pressed={tag === t.tag}
                    onClick={() => setTag(tag === t.tag ? '' : t.tag)}>
                    {t.tag}
                  </button>
                ))}
              </div>
            )}
            {list.error && <p className="form-error" role="alert">{list.error}</p>}
            {list.data && notes.length === 0 && <p className="muted small" style={{ padding: '4px 15px' }}>No notes match.</p>}
            <ul className="note-rows">
              {notes.map((n) => (
                <li key={n.id}>
                  <a href={`#/notes/${n.id}`} className={`note-row ${n.id === id ? 'on' : ''}`} aria-current={n.id === id ? 'true' : undefined}>
                    <span className="title note-row-title">
                      {n.pinned && <span className="pin" aria-label="Pinned"><Icon name="pin" size={12} /></span>}
                      {n.title || 'Untitled note'}
                    </span>
                    <span className="snippet note-row-text">
                      {n.snippet ? <Snippet text={n.snippet} /> : n.body.replace(/[#>*_`-]/g, '').slice(0, 140)}
                    </span>
                    <span className="meta note-row-meta">
                      {(n.opening || n.tags) && <span className="tag">{n.opening ? n.opening.split(':')[0] : n.tags.split(',')[0]}</span>}
                      <span>{formatDate(n.updated_at)}</span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {list.data && notes.length > 0 && <div className="list-foot"><span>{notes.length} {notes.length === 1 ? 'note' : 'notes'}{query || tag ? ' match' : ''}</span></div>}
          </aside>
          <section className="notes-main">
            {current.data ? (
              <NoteEditor key={current.data.id} note={current.data}
                onSaved={(n) => { current.setData(n); list.reload(); tags.reload() }}
                onDeleted={() => { list.reload(); navigate('/notes') }} />
            ) : current.error ? (
              <p className="form-error" role="alert">{current.error}</p>
            ) : (
              <div className="note-sheet placeholder"><p className="empty">Choose a note on the left, or write a new one.</p></div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
