import { numberedLine, turnOf } from '../lib/chess'
import { evalSide, formatEval } from '../lib/evals'
import type { EngineInfo } from '../state/engine'

interface Props {
  info: EngineInfo | null
  multipv: number
  on: boolean
  threat: boolean
  error: string | null
  /** Play the line up to and including move `index`. */
  onPlay: (ucis: string[]) => void
}

function formatNodes(nps?: number): string {
  if (!nps) return ''
  if (nps > 1e6) return `${(nps / 1e6).toFixed(1)}M nodes/s`
  return `${Math.round(nps / 1e3)}k nodes/s`
}

export function EngineLines({ info, multipv, on, threat, error, onPlay }: Props) {
  if (!on) {
    return <p className="engine-off">The engine is off. Think about the position first, then press Space to check your ideas.</p>
  }
  if (error) return <p className="engine-error" role="alert">{error}</p>
  if (info?.terminal) {
    const t = info.terminal
    return <p className="engine-off">{t.winner ? `Checkmate. ${t.winner === 'white' ? 'White' : 'Black'} wins.` : 'Draw. The game is over.'}</p>
  }

  const rows = info?.lines ?? []
  const placeholders = Math.max(0, multipv - rows.length)
  return (
    <div className="engine-lines">
      {threat && info && (
        <p className="threat-note">Threat: what {turnOf(info.fen) === 'white' ? 'White' : 'Black'} would play if it were their move.</p>
      )}
      <ol className="lines">
        {rows.map((line, i) => {
          const tokens = numberedLine(info!.fen, line.san)
          return (
            <li key={line.multipv} className={`line ${i === 0 && !threat ? 'best' : ''}`}>
              <span className={`line-eval side-${evalSide(line.eval)}`}>{formatEval(line.eval)}</span>
              <span className="line-moves">
                {tokens.map((t) => (
                  <button
                    type="button"
                    key={t.index}
                    className={`pv-move ${t.index === 0 ? 'pv-first' : ''}`}
                    disabled={threat}
                    onClick={() => onPlay(line.uci.slice(0, t.index + 1))}
                    title={threat ? undefined : 'Play the line up to this move'}
                  >
                    {t.label && <span className="pv-num">{t.label}</span>}
                    {t.san}
                  </button>
                ))}
              </span>
            </li>
          )
        })}
        {Array.from({ length: placeholders }, (_, i) => (
          <li key={`p${i}`} className="line placeholder">
            <span className="line-eval" />
            <span className="line-moves">&nbsp;</span>
          </li>
        ))}
      </ol>
      <p className="engine-stats engine-foot">
        {info?.depth ? <>Depth {info.depth}{info.seldepth ? `/${info.seldepth}` : ''}</> : 'Thinking…'}
        {info?.nps ? <span>{formatNodes(info.nps)}</span> : <span>MultiPV {multipv}</span>}
      </p>
    </div>
  )
}
