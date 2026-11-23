import { useEffect, useRef, useState } from 'react'
import type { Classification } from '../lib/api'

interface Props {
  /** White's winning chance (0-100) for each position, starting position first. */
  wins: number[]
  /** Text for each position, shown on hover. */
  labels: string[]
  current: number
  markers: { index: number; cls: Classification }[]
  onSelect: (index: number) => void
}

const HEIGHT = 82

export function EvalGraph({ wins, labels, current, markers, onSelect }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = Math.max(1, wins.length - 1)
  const x = (i: number) => (i / n) * width
  const y = (v: number) => HEIGHT - (v / 100) * HEIGHT
  const linePoints = wins.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `0,${HEIGHT} ${linePoints} ${x(wins.length - 1).toFixed(1)},${HEIGHT}`

  const indexAt = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect()
    return Math.max(0, Math.min(wins.length - 1, Math.round(((clientX - rect.left) / rect.width) * n)))
  }

  const tipIndex = hover ?? null
  return (
    <div
      className="eval-graph"
      ref={wrap}
      onPointerMove={(e) => setHover(indexAt(e.clientX))}
      onPointerLeave={() => setHover(null)}
      onClick={(e) => onSelect(indexAt(e.clientX))}
      role="img"
      aria-label="Evaluation graph of the game. Click to jump to a move."
    >
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
        <rect x={0} y={0} width={width} height={HEIGHT} className="graph-black" />
        <polygon points={area} className="graph-white" />
        <line x1={0} x2={width} y1={HEIGHT / 2} y2={HEIGHT / 2} className="graph-mid" />
        <polyline points={linePoints} className="graph-line" />
        <line x1={x(current)} x2={x(current)} y1={0} y2={HEIGHT} className="graph-current" />
        {tipIndex !== null && <line x1={x(tipIndex)} x2={x(tipIndex)} y1={0} y2={HEIGHT} className="graph-hover" />}
        {markers.map((m) => (
          <circle key={m.index} cx={x(m.index)} cy={y(wins[m.index])} r={m.cls === 'blunder' ? 5 : 4} className={`graph-dot dot-${m.cls}`} />
        ))}
      </svg>
      {tipIndex !== null && labels[tipIndex] && (
        <span className="graph-tip" style={{ left: Math.min(Math.max(x(tipIndex), 50), width - 50) }}>{labels[tipIndex]}</span>
      )}
    </div>
  )
}
