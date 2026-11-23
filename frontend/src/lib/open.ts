import { api } from './api'
import { navigate } from './router'
import { fromParsed, hasMoves, lineEnd } from './tree'
import { useAnalysis } from '../state/analysis'

/** Load a library game onto the analysis board. Later changes are saved back to the library. */
function boardCanBeReplaced(): boolean {
  const { tree, gameId } = useAnalysis.getState()
  if (!hasMoves(tree) || gameId) return true // empty, or already saved in the library
  return window.confirm('Replace the moves on the analysis board? They are not saved in the library.')
}

export async function openGameOnBoard(id: number, atEnd = false): Promise<void> {
  if (!boardCanBeReplaced()) return
  const game = await api.getGame(id)
  if (!game.tree) throw new Error('This game could not be read.')
  const tree = fromParsed(game.tree, game.headers)
  useAnalysis.getState().load(tree, atEnd ? lineEnd(tree, tree.rootId) : tree.rootId, game.my_color ?? undefined, game.id)
  navigate('/analysis')
}

/** Put a single position on the analysis board (a new, unsaved board). */
export function openPositionOnBoard(fen: string, orientation?: 'white' | 'black'): void {
  if (!boardCanBeReplaced()) return
  const s = useAnalysis.getState()
  s.reset(fen)
  if (orientation && s.orientation !== orientation) s.flip()
  navigate('/analysis')
}
