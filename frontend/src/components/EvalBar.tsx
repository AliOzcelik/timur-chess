import { formatEval, winWhite, type Eval } from '../lib/evals'
import type { Color } from '../lib/chess'

/** Vertical bar: White's share grows from White's side of the board. */
export function EvalBar({ value, orientation, hidden }: { value: Eval | null; orientation: Color; hidden?: boolean }) {
  const white = value ? winWhite(value) : 50
  const text = value ? formatEval(value) : ''
  const whiteAhead = white >= 50
  return (
    <div
      className={`eval-bar ${orientation === 'black' ? 'flipped' : ''} ${hidden ? 'is-hidden' : ''}`}
      role="meter"
      aria-label="Evaluation"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(white)}
      aria-valuetext={text || 'no evaluation'}
    >
      <div className="eval-bar-white" style={{ height: `${white}%` }} />
      <div className="eval-bar-mid" />
      {!hidden && text && (
        <span className={`eval-bar-text ${whiteAhead ? 'on-white' : 'on-black'}`}>{text.replace('+', '')}</span>
      )}
    </div>
  )
}
