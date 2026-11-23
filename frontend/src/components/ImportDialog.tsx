import { useState } from 'react'
import { api } from '../lib/api'
import { checkFen, looksLikeFen } from '../lib/chess'
import { createTree, fromParsed, type GameTree } from '../lib/tree'
import { Modal } from './Modal'

export function ImportDialog({ open, onClose, onLoad }: {
  open: boolean
  onClose: () => void
  onLoad: (tree: GameTree, note: string | null) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setError(null)
    onClose()
  }

  const load = async () => {
    const value = text.trim()
    if (!value) {
      setError('Paste a PGN or a FEN first.')
      return
    }
    setError(null)
    if (looksLikeFen(value)) {
      const check = checkFen(value)
      if (!check.ok) {
        setError(`That FEN is not valid: ${check.error}`)
        return
      }
      onLoad(createTree(value), null)
      setText('')
      onClose()
      return
    }
    setBusy(true)
    try {
      const parsed = await api.parsePgn(value)
      if (!parsed.tree.children.length && !parsed.headers.FEN) {
        setError('No moves were found. A PGN looks like: 1. e4 e5 2. Nf3 Nc6 …')
        return
      }
      const note = parsed.game_count > 1 ? `This PGN has ${parsed.game_count} games. The first one was loaded.` : null
      onLoad(fromParsed(parsed.tree, parsed.headers), note)
      setText('')
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) {
      setError('That file is larger than 2 MB. Split it into smaller files first.')
      return
    }
    setText(await file.text())
    setError(null)
  }

  return (
    <Modal title="Import a game or position" open={open} onClose={close}>
      <label className="field">
        <span className="field-label">PGN or FEN</span>
        <textarea
          className="input mono-ish"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'[White "You"]\n[Black "Opponent"]\n\n1. e4 c5 2. Nf3 d6 …\n\nor a FEN such as\nr1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'}
          spellCheck={false}
          autoFocus
        />
      </label>
      <div className="row-between">
        <label className="btn btn-quiet file-btn">
          Open a .pgn file
          <input type="file" accept=".pgn,.txt,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
        <div className="row">
          <button type="button" className="btn btn-quiet" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={load} disabled={busy}>
            {busy ? 'Loading…' : 'Load on the board'}
          </button>
        </div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Modal>
  )
}
