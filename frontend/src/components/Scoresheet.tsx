import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import type { Classification } from '../lib/api'
import { fullmoveOf, turnOf } from '../lib/chess'
import type { GameTree, TreeNode } from '../lib/tree'

export const GLYPH: Partial<Record<Classification, string>> = {
  inaccuracy: '?!',
  mistake: '?',
  blunder: '??',
}

interface Props {
  tree: GameTree
  currentId: string
  onSelect: (id: string) => void
  annotations?: Record<string, Classification>
  emptyText?: string
}

/**
 * The move list, drawn like a paper tournament scoresheet: numbered ruled rows,
 * White and Black columns. Side lines are written out underneath the move they branch from.
 */
export function Scoresheet({ tree, currentId, onSelect, annotations, emptyText }: Props) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!el || !box.current) return
    const parent = box.current
    const top = el.offsetTop - parent.offsetTop
    if (top < parent.scrollTop + 8 || top > parent.scrollTop + parent.clientHeight - 40) {
      parent.scrollTo({ top: Math.max(0, top - parent.clientHeight / 2), behavior: 'auto' })
    }
  }, [currentId])

  const nodes = tree.nodes
  const root = nodes[tree.rootId]

  const moveButton = (node: TreeNode, label: string | null, inline: boolean) => {
    const cls = annotations?.[node.id]
    return (
      <button
        type="button"
        key={node.id}
        className={`mv ${inline ? 'mv-inline' : ''} ${cls ? `cls-${cls}` : ''}`}
        aria-current={node.id === currentId ? 'true' : undefined}
        onClick={() => onSelect(node.id)}
      >
        {label && <span className="mv-num">{label}</span>}
        <span className="mv-san">{node.san}</span>
        {cls && GLYPH[cls] && <span className="mv-glyph">{GLYPH[cls]}</span>}
      </button>
    )
  }

  const inlineLine = (firstId: string): ReactNode[] => {
    const out: ReactNode[] = []
    let cur: string | undefined = firstId
    let force = true
    let first = true
    while (cur) {
      const node: TreeNode = nodes[cur]
      const parent = nodes[node.parentId!]
      const white = turnOf(parent.fen) === 'white'
      const n = fullmoveOf(parent.fen)
      out.push(moveButton(node, white ? `${n}.` : force ? `${n}...` : null, true))
      force = false
      if (node.comment) out.push(<span key={`c${node.id}`} className="mv-comment">{node.comment}</span>)
      if (!first && parent.children[0] === node.id && parent.children.length > 1) {
        for (const sid of parent.children.slice(1)) {
          out.push(<span key={`v${sid}`} className="subvar">({inlineLine(sid)})</span>)
        }
        force = true
      }
      first = false
      cur = node.children[0]
    }
    return out
  }

  const rows: ReactNode[] = []
  let row: { num: number; white?: TreeNode | null; black?: TreeNode | null } | null = null
  const flush = () => {
    if (!row) return
    const r = row
    rows.push(
      <Fragment key={`r${rows.length}`}>
        <span className="sheet-num">{r.num}</span>
        <span className="sheet-cell">{r.white ? moveButton(r.white, null, false) : <span className="mv-gap">…</span>}</span>
        <span className="sheet-cell">{r.black ? moveButton(r.black, null, false) : r.black === null ? <span className="mv-gap">…</span> : null}</span>
      </Fragment>,
    )
    row = null
  }

  let parent = root
  while (parent.children.length) {
    const node = nodes[parent.children[0]]
    const white = turnOf(parent.fen) === 'white'
    const num = fullmoveOf(parent.fen)
    if (white) {
      flush()
      row = { num, white: node }
    } else {
      if (!row) row = { num, white: null }
      row.black = node
    }
    const variations = parent.children.slice(1)
    if (variations.length || node.comment) {
      if (white && row) row.black = null
      flush()
      if (node.comment) rows.push(<p key={`c${node.id}`} className="sheet-comment">{node.comment}</p>)
      for (const vid of variations) {
        rows.push(<div key={`v${vid}`} className="sheet-variation">{inlineLine(vid)}</div>)
      }
    } else if (!white) {
      flush()
    }
    parent = node
  }
  flush()

  return (
    <div className="scoresheet" ref={box}>
      {root.comment && <p className="sheet-comment">{root.comment}</p>}
      {rows.length === 0 ? (
        <p className="sheet-empty">{emptyText ?? 'Make a move on the board, or import a game.'}</p>
      ) : (
        <div className="sheet-grid">{rows}</div>
      )}
    </div>
  )
}
