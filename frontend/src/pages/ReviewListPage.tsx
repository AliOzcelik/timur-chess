import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { api, type MyColor, type ReviewProfile, type ReviewSummaryRow } from '../lib/api'
import { navigate } from '../lib/router'
import { useReviewDraft } from '../state/analysis'
import { useHealth } from '../state/health'

const PROFILES: { value: ReviewProfile; label: string; detail: string }[] = [
  { value: 'quick', label: 'Quick', detail: 'Depth 14, about 15 seconds for a 40-move game' },
  { value: 'standard', label: 'Standard', detail: 'Depth 18, about 45 seconds' },
  { value: 'deep', label: 'Deep', detail: 'Depth 22, about 2 to 3 minutes' },
]

// The interface is in English, so dates are too ("2 Nov 2026"), whatever the system language.
const LOCALE = 'en-GB'

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPgnDate(date: string | null): string | null {
  if (!date) return null
  const [y, m, d] = date.split('.')
  if (!y || y.includes('?')) return null
  if (!m || m.includes('?')) return y
  const parsed = new Date(Number(y), Number(m) - 1, d && !d.includes('?') ? Number(d) : 1)
  return parsed.toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', ...(d && !d.includes('?') ? { day: 'numeric' } : {}) })
}

export function playersOf(r: { white: string | null; black: string | null }): string {
  if (!r.white && !r.black) return 'Unnamed game'
  return `${r.white ?? 'Unknown'} vs ${r.black ?? 'Unknown'}`
}

function StatusText({ r }: { r: ReviewSummaryRow }) {
  if (r.status === 'queued') return <span className="status status-wait">Waiting in line</span>
  if (r.status === 'running') {
    const pct = r.total ? Math.round((r.progress / r.total) * 100) : 0
    return <span className="status status-run">Analyzing, {pct}%</span>
  }
  if (r.status === 'error') return <span className="status status-error">Failed</span>
  return null
}

export function ReviewListPage({ startNew }: { startNew: boolean }) {
  const [reviews, setReviews] = useState<ReviewSummaryRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [pgn, setPgn] = useState('')
  const defaultProfile = useHealth((h) => h.health?.settings?.default_profile)
  const [profile, setProfile] = useState<ReviewProfile>(defaultProfile ?? 'standard')
  const [myColor, setMyColor] = useState<MyColor>('white')
  const [gameId, setGameId] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const pgnRef = useRef<HTMLTextAreaElement>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api.listReviews()
      setReviews(data.reviews)
      setListError(null)
    } catch (e) {
      setListError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Take the game handed over from the analysis board.
  useEffect(() => {
    const draft = useReviewDraft.getState()
    if (draft.pgn) {
      setPgn(draft.pgn)
      if (draft.myColor) setMyColor(draft.myColor)
      setGameId(draft.gameId ?? null)
      useReviewDraft.setState({ pgn: null, myColor: null, gameId: null })
    }
    if (startNew) pgnRef.current?.focus()
  }, [startNew])

  const busy = reviews?.some((r) => r.status === 'queued' || r.status === 'running')
  useEffect(() => {
    if (!busy) return
    const t = window.setInterval(refresh, 1500)
    return () => window.clearInterval(t)
  }, [busy, refresh])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pgn.trim()) {
      setFormError('Paste the PGN of the game you want reviewed.')
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      const { id } = await api.createReview(pgn, profile, myColor, gameId)
      setPgn('')
      navigate(`/review/${id}`)
    } catch (err) {
      setFormError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async (r: ReviewSummaryRow) => {
    if (!window.confirm(`Delete the review of ${playersOf(r)}? This cannot be undone.`)) return
    try {
      await api.deleteReview(r.id)
      refresh()
    } catch (e) {
      setListError((e as Error).message)
    }
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > 2_000_000) {
      setFormError('That file is larger than 2 MB.')
      return
    }
    setPgn(await file.text())
    setFormError(null)
  }

  return (
    <div className="page review-list-page">
      <header className="page-head">
        <h1>Game review</h1>
        <p className="page-sub">Stockfish checks every move and shows where the game was won and lost.</p>
      </header>

      <div className="review-list-layout">
        <form className="panel new-review" onSubmit={submit}>
          <h2>Review a game</h2>
          <label className="field">
            <span className="field-label">PGN</span>
            <textarea
              ref={pgnRef}
              className="input mono-ish"
              rows={9}
              value={pgn}
              onChange={(e) => setPgn(e.target.value)}
              placeholder={'[White "You"]\n[Black "Opponent"]\n[Date "2026.11.20"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 …'}
              spellCheck={false}
            />
          </label>
          <label className="btn btn-quiet file-btn">
            <Icon name="file" size={16} /> Open a .pgn file
            <input type="file" accept=".pgn,.txt,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>

          <fieldset className="choice-group">
            <legend>You played</legend>
            <label><input type="radio" name="color" checked={myColor === 'white'} onChange={() => setMyColor('white')} /> White</label>
            <label><input type="radio" name="color" checked={myColor === 'black'} onChange={() => setMyColor('black')} /> Black</label>
            <label><input type="radio" name="color" checked={myColor === 'both'} onChange={() => setMyColor('both')} /> Neither, review both sides</label>
          </fieldset>

          <fieldset className="choice-group stacked">
            <legend>How deep</legend>
            {PROFILES.map((p) => (
              <label key={p.value}>
                <input type="radio" name="profile" checked={profile === p.value} onChange={() => setProfile(p.value)} />
                <span><strong>{p.label}</strong> <span className="muted">{p.detail}</span></span>
              </label>
            ))}
          </fieldset>

          {formError && <p className="form-error" role="alert">{formError}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Starting…' : 'Start review'}
          </button>
        </form>

        <section className="panel review-history" aria-label="Reviewed games">
          <h2>Reviewed games</h2>
          {listError && <p className="form-error" role="alert">{listError}</p>}
          {reviews === null && !listError && <p className="muted">Loading…</p>}
          {reviews?.length === 0 && (
            <p className="empty">No reviews yet. Paste a game on the left, or play through one on the analysis board and choose “Review this game”.</p>
          )}
          <ul className="review-rows">
            {reviews?.map((r) => {
              const played = formatPgnDate(r.game_date)
              return (
                <li key={r.id} className="review-row">
                  <a href={`#/review/${r.id}`} className="review-link">
                    <span className="review-players">{playersOf(r)}</span>
                    <span className="review-meta">
                      {r.result && <span>{r.result}</span>}
                      {r.opening && <span className="review-opening">{r.eco} {r.opening}</span>}
                      {played && <span>Played {played}</span>}
                      <span>Reviewed {formatDate(r.created_at)}</span>
                      <span>{Math.ceil(r.ply_count / 2)} moves</span>
                    </span>
                    <span className="review-acc">
                      <StatusText r={r} />
                      {r.status === 'done' && (
                        <>
                          <span className={`acc ${r.my_color === 'white' ? 'acc-mine' : ''}`} title="White accuracy">
                            <span className="acc-dot acc-white" />{r.white_accuracy?.toFixed(0) ?? '–'}%
                          </span>
                          <span className={`acc ${r.my_color === 'black' ? 'acc-mine' : ''}`} title="Black accuracy">
                            <span className="acc-dot acc-black" />{r.black_accuracy?.toFixed(0) ?? '–'}%
                          </span>
                        </>
                      )}
                    </span>
                  </a>
                  <button type="button" className="icon-btn" aria-label={`Delete review of ${playersOf(r)}`} onClick={() => remove(r)}>
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </div>
  )
}
