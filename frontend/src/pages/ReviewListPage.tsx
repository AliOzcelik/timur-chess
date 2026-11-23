import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Masthead, Meta } from '../components/Masthead'
import { api, type MyColor, type ReviewProfile, type ReviewSummaryRow } from '../lib/api'
import { navigate } from '../lib/router'
import { useReviewDraft } from '../state/analysis'
import { useHealth } from '../state/health'

const PROFILES: { value: ReviewProfile; label: string; detail: string }[] = [
  { value: 'quick', label: 'Quick', detail: 'Depth 14, about 15 seconds for a 40-move game' },
  { value: 'standard', label: 'Standard', detail: 'Depth 18, about 45 seconds' },
  { value: 'deep', label: 'Deep', detail: 'Depth 22, about 2 to 3 minutes' },
]

export { formatDate, formatPgnDate, playersOf } from '../lib/format'
import { formatDate, formatPgnDate, playersOf } from '../lib/format'

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

  const [dragging, setDragging] = useState(false)
  const done = reviews?.filter((r) => r.status === 'done') ?? []
  const avgMine = (() => {
    const vals = done.map((r) => (r.my_color === 'black' ? r.black_accuracy : r.my_color === 'white' ? r.white_accuracy : null)).filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })()

  return (
    <div className="page review-list-page">
      <Masthead
        section="Study"
        page="Game review"
        title="Game review"
        sub={<Meta items={[
          'Stockfish checks every move and shows where the game was won and lost.',
          reviews ? `${reviews.length} ${reviews.length === 1 ? 'review' : 'reviews'}` : null,
          avgMine !== null ? `Your average accuracy ${avgMine.toFixed(1)}` : null,
        ]} />}
        actions={<button type="button" className="btn btn-primary" onClick={() => pgnRef.current?.focus()}><Icon name="plus" />New review</button>}
      />

      <div className="review-list-layout">
        <form className="card new-review" onSubmit={submit}>
          <div className="card-head"><h2>New review</h2><span className="right">Runs on this Mac</span></div>
          <div className="card-body">
            <label className={`field drop-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files?.[0]) }}
            >
              <span className="field-label">PGN</span>
              <textarea
                ref={pgnRef}
                className="input mono-ish"
                rows={8}
                value={pgn}
                onChange={(e) => setPgn(e.target.value)}
                placeholder={'Paste a PGN or drop a .pgn file\n\n[White "You"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 …'}
                spellCheck={false}
              />
            </label>
            <label className="link-btn file-btn file-link">
              <Icon name="upload" size={15} /> Open a .pgn file
              <input type="file" accept=".pgn,.txt,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
            </label>

            <fieldset className="radio-cards three">
              <legend className="section-label">You played</legend>
              {([['white', 'White'], ['black', 'Black'], ['both', 'Both sides']] as const).map(([v, label]) => (
                <label key={v} className={`radio-card ${myColor === v ? 'on' : ''}`}>
                  <input type="radio" name="color" className="visually-hidden" checked={myColor === v} onChange={() => setMyColor(v)} />
                  <span className={`side-swatch ${v}`} aria-hidden="true" />
                  <span className="rc-title">{label}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="radio-cards three">
              <legend className="section-label">How deep</legend>
              {PROFILES.map((p) => (
                <label key={p.value} className={`radio-card ${profile === p.value ? 'on' : ''}`}>
                  <input type="radio" name="profile" className="visually-hidden" checked={profile === p.value} onChange={() => setProfile(p.value)} />
                  <span className="rc-title">{p.label}</span>
                  <span className="rc-sub">{p.detail}</span>
                </label>
              ))}
            </fieldset>

            {formError && <p className="form-error" role="alert">{formError}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
              <Icon name="spark" />{submitting ? 'Starting…' : 'Start review'}
            </button>
          </div>
        </form>

        <section className="card review-history" aria-label="Reviewed games">
          <div className="card-head"><h2>Reviewed games</h2>{reviews && reviews.length > 0 && <span className="right">{reviews.length}</span>}</div>
          {listError && <p className="form-error" role="alert" style={{ margin: 15 }}>{listError}</p>}
          {reviews === null && !listError && <div className="card-body"><div className="skeleton" style={{ height: 160 }} /></div>}
          {reviews?.length === 0 && (
            <div className="card-body">
              <div className="empty-state slim">
                <h2>No reviews yet</h2>
                <p>Paste a game on the left, or play through one on the analysis board and choose “Review this game”.</p>
              </div>
            </div>
          )}
          <ul className="review-rows">
            {reviews?.map((r) => {
              const played = formatPgnDate(r.game_date)
              const mine = r.my_color === 'black' ? r.black_accuracy : r.my_color === 'white' ? r.white_accuracy : r.white_accuracy
              return (
                <li key={r.id} className="review-row">
                  <a href={`#/review/${r.id}`} className="review-link">
                    <span className="ring sm" style={{ '--p': r.status === 'done' ? mine ?? 0 : r.total ? (r.progress / r.total) * 100 : 0 } as React.CSSProperties} aria-hidden="true">
                      <span className="n">{r.status === 'done' ? mine?.toFixed(0) ?? '–' : <Icon name="clock" size={13} />}</span>
                    </span>
                    <span className="review-main">
                      <span className="review-players">{playersOf(r)}</span>
                      <span className="review-meta">
                        {r.result && <span className="strong">{r.result.replace('1/2-1/2', '½–½')}</span>}
                        {r.opening && <span className="review-opening"><span className="eco">{r.eco}</span> {r.opening}</span>}
                        {played && <span>Played {played}</span>}
                        <span>Reviewed {formatDate(r.created_at)}</span>
                        <span>{Math.ceil(r.ply_count / 2)} moves</span>
                      </span>
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
                    <span className="row-chev" aria-hidden="true"><Icon name="chev" size={15} /></span>
                  </a>
                  <button type="button" className="icon-btn row-del" aria-label={`Delete review of ${playersOf(r)}`} onClick={() => remove(r)}>
                    <Icon name="trash" size={15} />
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
