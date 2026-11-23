import { create } from 'zustand'
import { api } from '../lib/api'
import type { Color } from '../lib/chess'
import { loadJson, saveJson } from '../lib/storage'
import {
  addMove, createTree, deleteFrom, lineEnd, makeMainline, toPgn, type GameTree,
} from '../lib/tree'

export interface EngineSettings {
  engineOn: boolean
  multipv: number
  depth: number | null // null = no limit
  arrows: boolean
}

interface Saved {
  tree: GameTree
  currentId: string
  orientation: Color
  /** The library entry this board is saved in; changes are saved there automatically. */
  gameId?: number | null
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'


interface AnalysisState extends EngineSettings {
  tree: GameTree
  currentId: string
  orientation: Color
  threat: boolean
  gameId: number | null
  saveState: SaveState
  play: (uci: string) => void
  playLine: (ucis: string[]) => void
  goTo: (id: string) => void
  back: () => void
  forward: () => void
  toStart: () => void
  toEnd: () => void
  remove: (id: string) => void
  promote: (id: string) => void
  load: (tree: GameTree, currentId?: string, orientation?: Color, gameId?: number | null) => void
  setGameId: (id: number | null) => void
  reset: (fen?: string) => void
  flip: () => void
  setSettings: (s: Partial<EngineSettings>) => void
  setThreat: (on: boolean) => void
}

const BOARD_KEY = 'timur.analysis.v1'
const SETTINGS_KEY = 'timur.engine-settings.v1'

const defaultSettings: EngineSettings = { engineOn: true, multipv: 3, depth: 30, arrows: true }

function initialBoard(): Saved {
  const saved = loadJson<Saved | null>(BOARD_KEY, null)
  if (saved && saved.tree?.nodes?.[saved.tree.rootId] && saved.tree.nodes[saved.currentId]) return saved
  const tree = createTree()
  return { tree, currentId: tree.rootId, orientation: 'white', gameId: null }
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  ...defaultSettings,
  ...loadJson<Partial<EngineSettings>>(SETTINGS_KEY, {}),
  gameId: null,
  ...initialBoard(),
  threat: false,
  saveState: 'idle',

  play: (uci) => {
    const { tree, currentId } = get()
    const res = addMove(tree, currentId, uci)
    if (res) set({ tree: res.tree, currentId: res.id, threat: false })
  },
  playLine: (ucis) => {
    let { tree, currentId } = get()
    for (const uci of ucis) {
      const res = addMove(tree, currentId, uci)
      if (!res) break
      tree = res.tree
      currentId = res.id
    }
    set({ tree, currentId, threat: false })
  },
  goTo: (id) => {
    if (get().tree.nodes[id]) set({ currentId: id })
  },
  back: () => {
    const { tree, currentId } = get()
    const parent = tree.nodes[currentId].parentId
    if (parent) set({ currentId: parent })
  },
  forward: () => {
    const { tree, currentId } = get()
    const next = tree.nodes[currentId].children[0]
    if (next) set({ currentId: next })
  },
  toStart: () => set({ currentId: get().tree.rootId }),
  toEnd: () => {
    const { tree, currentId } = get()
    set({ currentId: lineEnd(tree, currentId) })
  },
  remove: (id) => {
    const { tree, currentId } = get()
    const node = tree.nodes[id]
    if (!node?.parentId) return
    const next = deleteFrom(tree, id)
    set({ tree: next, currentId: next.nodes[currentId] ? currentId : node.parentId })
  },
  promote: (id) => set({ tree: makeMainline(get().tree, id) }),
  load: (tree, currentId, orientation, gameId = null) =>
    set({
      tree, currentId: currentId && tree.nodes[currentId] ? currentId : tree.rootId, threat: false,
      gameId, saveState: gameId ? 'saved' : 'idle', ...(orientation ? { orientation } : {}),
    }),
  setGameId: (id) => set({ gameId: id, saveState: id ? 'saved' : 'idle' }),
  reset: (fen) => {
    const tree = createTree(fen)
    set({ tree, currentId: tree.rootId, threat: false, gameId: null, saveState: 'idle' })
  },
  flip: () => set({ orientation: get().orientation === 'white' ? 'black' : 'white' }),
  setSettings: (s) => set(s),
  setThreat: (on) => set({ threat: on }),
}))

// Save the board and engine settings so a page refresh keeps your work.
let saveTimer: number | undefined
useAnalysis.subscribe((s, prev) => {
  if (s.engineOn !== prev.engineOn || s.multipv !== prev.multipv || s.depth !== prev.depth || s.arrows !== prev.arrows) {
    saveJson(SETTINGS_KEY, { engineOn: s.engineOn, multipv: s.multipv, depth: s.depth, arrows: s.arrows })
  }
  if (s.tree !== prev.tree || s.currentId !== prev.currentId || s.orientation !== prev.orientation || s.gameId !== prev.gameId) {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      const { tree, currentId, orientation, gameId } = useAnalysis.getState()
      saveJson(BOARD_KEY, { tree, currentId, orientation, gameId })
    }, 300)
  }
  // A board saved in the library keeps its library copy up to date.
  if (s.gameId && s.tree !== prev.tree && s.gameId === prev.gameId) {
    window.clearTimeout(libraryTimer)
    useAnalysis.setState({ saveState: 'saving' })
    libraryTimer = window.setTimeout(async () => {
      const { tree, gameId } = useAnalysis.getState()
      if (!gameId) return
      try {
        await api.updateGame(gameId, { pgn: toPgn(tree) })
        if (useAnalysis.getState().gameId === gameId) useAnalysis.setState({ saveState: 'saved' })
      } catch {
        if (useAnalysis.getState().gameId === gameId) useAnalysis.setState({ saveState: 'error' })
      }
    }, 1200)
  }
})
let libraryTimer: number | undefined

/** PGN handed from the analysis board to the review form. */
export const useReviewDraft = create<{ pgn: string | null; myColor: Color | null; gameId?: number | null }>(() => ({
  pgn: null, myColor: null, gameId: null,
}))
