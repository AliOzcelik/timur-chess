import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type GameRow, type Note, type Tournament } from '../lib/api'
import { openGameOnBoard } from '../lib/open'
import { navigate } from '../lib/router'
import { toPgn } from '../lib/tree'
import { useAnalysis } from '../state/analysis'
import { toast } from '../state/toast'
import { Icon } from './Icon'

interface Item {
  id: string
  group: 'Jump to' | 'Create' | 'Do' | 'Games' | 'Notes' | 'Tournaments'
  label: string
  icon: string
  hint?: string
  run: () => void
}

const PAGES: [string, string, string][] = [
  ['analysis', 'Analysis board', 'board'],
  ['review', 'Game review', 'review'],
  ['library', 'Library', 'library'],
  ['notes', 'Notes', 'notes'],
  ['endgames', 'Endgames', 'endgame'],
  ['practice', 'Practice', 'practice'],
  ['prep', 'Tournament prep', 'prep'],
  ['settings', 'Settings', 'settings'],
]

async function newNote() {
  try {
    const n = await api.createNote({ title: 'Untitled note', body: '' })
    navigate(`/notes/${n.id}`)
  } catch (e) {
    toast((e as Error).message, 'error')
  }
}

/** ⌘K: jump to a page, a game, a note or a tournament, or run a common action. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [games, setGames] = useState<GameRow[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [tours, setTours] = useState<Tournament[]>([])

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      d.showModal()
      setQ('')
      setSel(0)
    }
    if (!open && d.open) d.close()
  }, [open])

  // Search the library and notes as you type (debounced); tournaments load once.
  useEffect(() => {
    if (!open) return
    api.tournaments().then((r) => setTours(r.tournaments)).catch(() => setTours([]))
  }, [open])
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      api.listGames(q.trim() ? { q: q.trim() } : {}, 6).then((r) => setGames(r.games)).catch(() => setGames([]))
      api.listNotes(q.trim() ? { q: q.trim() } : {}).then((r) => setNotes(r.notes.slice(0, 5))).catch(() => setNotes([]))
    }, 120)
    return () => window.clearTimeout(t)
  }, [q, open])

  const go = (path: string) => () => navigate(path)
  const items = useMemo<Item[]>(() => {
    const a = useAnalysis.getState
    const base: Item[] = [
      ...PAGES.map(([id, label, icon]): Item => ({ id: `p-${id}`, group: 'Jump to', label, icon, run: go(`/${id}`) })),
      { id: 'c-review', group: 'Create', label: 'New review', icon: 'review', run: go('/review/new') },
      { id: 'c-note', group: 'Create', label: 'New note', icon: 'notes', run: newNote },
      { id: 'c-tour', group: 'Create', label: 'New tournament', icon: 'prep', run: go('/prep') },
      { id: 'c-play', group: 'Create', label: 'Start a game against the engine', icon: 'play', run: go('/practice/play') },
      { id: 'd-flip', group: 'Do', label: 'Flip board', icon: 'flip', hint: 'F', run: () => { a().flip(); navigate('/analysis') } },
      { id: 'd-engine', group: 'Do', label: 'Toggle engine', icon: 'power', hint: 'Space', run: () => { a().setSettings({ engineOn: !a().engineOn }); navigate('/analysis') } },
      {
        id: 'd-pgn', group: 'Do', label: 'Copy the board as PGN', icon: 'copy',
        run: () => navigator.clipboard.writeText(toPgn(a().tree)).then(() => toast('PGN copied.', 'success'), () => toast('The browser blocked the clipboard.', 'error')),
      },
      { id: 'd-settings', group: 'Do', label: 'Open settings', icon: 'settings', run: go('/settings') },
    ]
    const needle = q.trim().toLowerCase()
    const filtered = needle ? base.filter((i) => i.label.toLowerCase().includes(needle)) : base
    const gameItems = games.map((g): Item => ({
      id: `g-${g.id}`, group: 'Games', icon: 'board',
      label: `${g.white ?? '?'} – ${g.black ?? '?'}${g.result ? ` · ${g.result}` : ''}`,
      hint: g.opening ?? undefined,
      run: () => { openGameOnBoard(g.id).catch((e) => toast((e as Error).message, 'error')) },
    }))
    const noteItems = notes.map((n): Item => ({ id: `n-${n.id}`, group: 'Notes', icon: 'notes', label: n.title || 'Untitled note', run: go(`/notes/${n.id}`) }))
    const tourItems = tours
      .filter((t) => !needle || t.name.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((t): Item => ({ id: `t-${t.id}`, group: 'Tournaments', icon: 'prep', label: t.name, run: go(`/prep/${t.id}`) }))
    return [...filtered, ...gameItems, ...noteItems, ...tourItems]
  }, [q, games, notes, tours])

  useEffect(() => setSel((s) => Math.min(s, Math.max(0, items.length - 1))), [items.length])

  const run = (item: Item | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  let lastGroup = ''
  return (
    <dialog
      ref={ref}
      className="palette-dialog"
      aria-label="Search or jump to"
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
    >
      {open && (
        <>
          <div className="palette-search">
            <Icon name="search" />
            <input
              autoFocus
              value={q}
              onChange={(e) => { setQ(e.target.value); setSel(0) }}
              placeholder="Search games, notes, pages…"
              aria-label="Search"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
                if (e.key === 'Enter') { e.preventDefault(); run(items[sel]) }
              }}
            />
            <kbd className="kbd">Esc</kbd>
          </div>
          <div className="palette-list" id="palette-list" role="listbox">
            {items.length === 0 && <p className="palette-empty">Nothing matches “{q}”.</p>}
            {items.map((item, i) => {
              const head = item.group !== lastGroup ? <p className="palette-group">{item.group}</p> : null
              lastGroup = item.group
              return (
                <div key={item.id}>
                  {head}
                  <button
                    type="button"
                    role="option"
                    className="palette-item"
                    aria-selected={i === sel}
                    onMouseEnter={() => setSel(i)}
                    onClick={() => run(item)}
                  >
                    <Icon name={item.icon} size={16} />
                    <span>{item.label}</span>
                    {item.hint && <span className="hint">{item.hint}</span>}
                  </button>
                </div>
              )
            })}
          </div>
          <div className="palette-foot"><span>↑↓ to move</span><span>↵ to open</span><span>Esc to close</span></div>
        </>
      )}
    </dialog>
  )
}
