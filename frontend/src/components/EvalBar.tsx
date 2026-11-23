import { formatEval, winWhite, type Eval } from '../lib/evals'
import type { Color } from '../lib/chess'

/** The thin evaluation ribbon beside the board, with the number above it. White's share grows from White's side. */
export function EvalBar({ value, orientation, hidden }: { value: Eval | null; orientation: Color; hidden?: boolean }) {
  const white = value ? winWhite(value) : 50
  const text = value ? formatEval(value) : ''
  const whiteAhead = white >= 50
  return (
    <div className={`eval-col ${hidden ? 'is-hidden' : ''}`}>
      <span className={`eval-num eval-bar-text ${whiteAhead ? 'on-white' : 'on-black'}`} aria-hidden="true">
        {!hidden && text ? text : ''}
      </span>
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
      </div>
    </div>
  )
}
