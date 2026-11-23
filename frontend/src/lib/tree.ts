import { START_FEN, fullmoveOf, playUci, turnOf } from './chess'

/** One position in the analysis tree. children[0] is the main continuation. */
export interface TreeNode {
  id: string
  parentId: string | null
  ply: number
  fen: string
  san?: string
  uci?: string
  comment?: string
  nags?: number[]
  children: string[]
}

export interface GameTree {
  rootId: string
  nodes: Record<string, TreeNode>
  headers: Record<string, string>
}

/** Nested tree as returned by the backend's PGN parser. */
export interface ParsedNode {
  fen: string
  san?: string
  uci?: string
  comment?: string
  nags?: number[]
  children: ParsedNode[]
}

let counter = 0
const newId = () => `n${Date.now().toString(36)}${(counter++).toString(36)}`

export function createTree(fen: string = START_FEN, headers: Record<string, string> = {}): GameTree {
  const id = newId()
  return { rootId: id, nodes: { [id]: { id, parentId: null, ply: 0, fen, children: [] } }, headers }
}

export function hasMoves(tree: GameTree): boolean {
  return tree.nodes[tree.rootId].children.length > 0
}

/** Add a move after `parentId`, reusing an existing child with the same move. */
export function addMove(tree: GameTree, parentId: string, uci: string): { tree: GameTree; id: string } | null {
  const parent = tree.nodes[parentId]
  if (!parent) return null
  const existing = parent.children.find((cid) => tree.nodes[cid].uci === uci)
  if (existing) return { tree, id: existing }
  const played = playUci(parent.fen, uci)
  if (!played) return null
  const id = newId()
  const node: TreeNode = { id, parentId, ply: parent.ply + 1, fen: played.fen, san: played.san, uci: played.uci, children: [] }
  return {
    tree: {
      ...tree,
      nodes: { ...tree.nodes, [id]: node, [parentId]: { ...parent, children: [...parent.children, id] } },
    },
    id,
  }
}

/** Node ids from the root to `id` (inclusive). */
export function pathTo(tree: GameTree, id: string): string[] {
  const path: string[] = []
  let cur: TreeNode | undefined = tree.nodes[id]
  while (cur) {
    path.push(cur.id)
    cur = cur.parentId ? tree.nodes[cur.parentId] : undefined
  }
  return path.reverse()
}

/** UCI moves from the root to `id`, so the engine knows the game history. */
export function movesTo(tree: GameTree, id: string): string[] {
  return pathTo(tree, id).slice(1).map((nid) => tree.nodes[nid].uci!)
}

export function lineEnd(tree: GameTree, id: string): string {
  let cur = tree.nodes[id]
  while (cur.children.length) cur = tree.nodes[cur.children[0]]
  return cur.id
}

export function isOnMainline(tree: GameTree, id: string): boolean {
  let cur = tree.nodes[id]
  while (cur.parentId) {
    const parent = tree.nodes[cur.parentId]
    if (parent.children[0] !== cur.id) return false
    cur = parent
  }
  return true
}

export function deleteFrom(tree: GameTree, id: string): GameTree {
  const node = tree.nodes[id]
  if (!node || !node.parentId) return tree
  const nodes = { ...tree.nodes }
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()!
    stack.push(...nodes[cur].children)
    delete nodes[cur]
  }
  const parent = nodes[node.parentId]
  nodes[node.parentId] = { ...parent, children: parent.children.filter((c) => c !== id) }
  return { ...tree, nodes }
}

/** Make the line through `id` the main line at every branching point above it. */
export function makeMainline(tree: GameTree, id: string): GameTree {
  const nodes = { ...tree.nodes }
  let cur = nodes[id]
  while (cur && cur.parentId) {
    const parent = nodes[cur.parentId]
    if (parent.children[0] !== cur.id) {
      nodes[parent.id] = { ...parent, children: [cur.id, ...parent.children.filter((c) => c !== cur.id)] }
    }
    cur = nodes[cur.parentId]
  }
  return { ...tree, nodes }
}

export function fromParsed(root: ParsedNode, headers: Record<string, string> = {}): GameTree {
  const tree = createTree(root.fen, headers)
  tree.nodes[tree.rootId].comment = root.comment || undefined
  const stack: [ParsedNode, string][] = [[root, tree.rootId]]
  while (stack.length) {
    const [pnode, id] = stack.pop()!
    const parent = tree.nodes[id]
    for (const child of pnode.children) {
      const cid = newId()
      tree.nodes[cid] = {
        id: cid,
        parentId: id,
        ply: parent.ply + 1,
        fen: child.fen,
        san: child.san,
        uci: child.uci,
        comment: child.comment || undefined,
        nags: child.nags?.length ? child.nags : undefined,
        children: [],
      }
      parent.children.push(cid)
      stack.push([child, cid])
    }
  }
  return tree
}

/** Build a tree from a list of UCI moves (e.g. a reviewed game's main line). */
export function fromUciLine(fen: string, ucis: string[], headers: Record<string, string> = {}): GameTree {
  let tree = createTree(fen, headers)
  let id = tree.rootId
  for (const uci of ucis) {
    const res = addMove(tree, id, uci)
    if (!res) break
    tree = res.tree
    id = res.id
  }
  return tree
}

// ---- PGN export -----------------------------------------------------------------------

const cleanComment = (c: string) => c.replace(/[{}]/g, '').trim()

function moveToken(tree: GameTree, node: TreeNode, forceNumber: boolean): string {
  const parent = tree.nodes[node.parentId!]
  const n = fullmoveOf(parent.fen)
  const white = turnOf(parent.fen) === 'white'
  const prefix = white ? `${n}. ` : forceNumber ? `${n}... ` : ''
  const comment = node.comment ? ` {${cleanComment(node.comment)}}` : ''
  return `${prefix}${node.san}${comment}`
}

/** `numberFirst`: write "12..." before a first Black move (needed at the start of the game). */
function renderFrom(tree: GameTree, parentId: string, withVariations: boolean, numberFirst = true): string {
  const parts: string[] = []
  let parent = tree.nodes[parentId]
  let force = numberFirst
  while (parent.children.length) {
    const main = tree.nodes[parent.children[0]]
    parts.push(moveToken(tree, main, force))
    force = false
    if (withVariations) {
      for (const sid of parent.children.slice(1)) {
        const sib = tree.nodes[sid]
        // The side line's first move is already written with its number: "(2. Bc4 Nf6)".
        const rest = renderFrom(tree, sid, true, false)
        parts.push(`(${moveToken(tree, sib, true)}${rest ? ' ' + rest : ''})`)
        force = true
      }
    }
    parent = main
  }
  return parts.join(' ')
}

export function toPgn(tree: GameTree, opts: { variations?: boolean; extraHeaders?: Record<string, string> } = {}): string {
  const root = tree.nodes[tree.rootId]
  const headers: Record<string, string> = {
    Event: '?', Site: '?', Date: '????.??.??', Round: '?', White: '?', Black: '?', Result: '*',
    ...tree.headers,
    ...(opts.extraHeaders ?? {}),
  }
  if (root.fen !== START_FEN) {
    headers.SetUp = '1'
    headers.FEN = root.fen
  }
  const head = Object.entries(headers)
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`)
    .join('\n')
  const rootComment = root.comment ? `{${cleanComment(root.comment)}} ` : ''
  const moves = renderFrom(tree, tree.rootId, opts.variations ?? true)
  return `${head}\n\n${rootComment}${moves}${moves ? ' ' : ''}${headers.Result}\n`
}
