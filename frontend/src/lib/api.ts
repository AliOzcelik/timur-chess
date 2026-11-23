import type { Eval } from './evals'
import type { ParsedNode } from './tree'

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown, raw?: Blob): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new ApiError('Cannot reach the Timur server. Is ./start.sh still running?')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail
    const message = typeof detail === 'string' ? detail : Array.isArray(detail) ? 'The request was not valid.' : `Server error (${res.status}).`
    throw new ApiError(message)
  }
  return data as T
}

export interface EngineStatus {
  label: string
  name: string | null
  path: string | null
  threads: number
  hash_mb: number
  running: boolean
  error: string | null
}

export interface TablebaseStatus {
  available: boolean
  files: number
  path: string
  max_pieces: number
}

export type Theme = 'system' | 'dark' | 'light'

export interface Health {
  ok: boolean
  version: string
  engines: { live: EngineStatus; review: EngineStatus; trainer?: EngineStatus }
  tablebases?: TablebaseStatus
  openings?: number
  settings?: { theme: Theme; onboarded: boolean; default_profile: ReviewProfile }
}

export type Classification = 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | 'forced'
export type ReviewProfile = 'quick' | 'standard' | 'deep'
export type MyColor = 'white' | 'black' | 'both'

export interface ReviewSummaryRow {
  id: number
  created_at: string
  updated_at: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  total: number
  profile: ReviewProfile
  my_color: MyColor
  white: string | null
  black: string | null
  result: string | null
  event: string | null
  game_date: string | null
  ply_count: number
  white_accuracy: number | null
  black_accuracy: number | null
  error: string | null
  game_id?: number | null
  eco?: string | null
  opening?: string | null
}

export interface ReviewMove {
  index: number
  move_number: number
  color: 'white' | 'black'
  san: string
  uci: string
  fen_before: string
  fen_after: string
  eval_before: Eval
  eval_after: Eval
  eval_after_text: string
  win_before: number
  win_after: number
  drop: number
  classification: Classification
  tags: string[]
  motifs: string[]
  accuracy: number
  best: { uci: string; san: string } | null
  best_line_san: string[]
  reply_line_san: string[]
  explanation: string
}

export interface ReviewSideSummary {
  accuracy: number | null
  acpl: number | null
  counts: Record<Classification, number>
  moves: number
}

export interface ReviewAnalysis {
  version: number
  headers: Record<string, string>
  root_fen: string
  settings: { profile: ReviewProfile; depth: number; engine: string | null }
  positions: { fen: string; eval: Eval; eval_text: string; win: number; depth: number | null }[]
  moves: ReviewMove[]
  summary: { white: ReviewSideSummary; black: ReviewSideSummary }
}

export interface ReviewDetail extends ReviewSummaryRow {
  pgn: string
  analysis: ReviewAnalysis | null
}

const coreApi = {
  health: () => request<Health>('GET', '/api/health'),
  parsePgn: (pgn: string) =>
    request<{ headers: Record<string, string>; tree: ParsedNode; game_count: number }>('POST', '/api/pgn/parse', { pgn }),
  evaluate: (fen: string, moves: string[], depth = 18, seconds = 2) =>
    request<{ eval: Eval; best: { uci: string; san: string } | null; pv_san: string[] }>('POST', '/api/engine/eval', {
      fen, moves, depth, seconds,
    }),
  listReviews: () => request<{ reviews: ReviewSummaryRow[]; current: number | null }>('GET', '/api/reviews'),
  getReview: (id: number) => request<ReviewDetail>('GET', `/api/reviews/${id}`),
  createReview: (pgn: string, profile: ReviewProfile, myColor: MyColor, gameId?: number | null) =>
    request<{ id: number; game_count: number; game_id?: number | null }>('POST', '/api/reviews', {
      pgn, profile, my_color: myColor, ...(gameId != null ? { game_id: gameId } : {}),
    }),
  deleteReview: (id: number) => request<{ ok: boolean }>('DELETE', `/api/reviews/${id}`),
}

// ---- query strings -------------------------------------------------------------------

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
  const text = q.toString()
  return text ? `?${text}` : ''
}

// ---- library (Phase 3) -----------------------------------------------------------------

export type Side = 'white' | 'black'

export interface Opening {
  eco: string
  name: string
  family: string
  variation: string | null
  ply: number
}

export interface GameRow {
  id: number
  created_at: string
  updated_at: string
  kind: 'game' | 'analysis'
  source: string
  white: string | null
  black: string | null
  result: string | null
  event: string | null
  site: string | null
  round: string | null
  game_date: string | null
  sort_date: string
  my_color: Side | null
  eco: string | null
  opening: string | null
  opening_family: string | null
  ply_count: number
  tags: string
  review_id: number | null
  review_status: string | null
  white_accuracy: number | null
  black_accuracy: number | null
}

export interface GameDetail extends GameRow {
  pgn: string
  start_fen: string | null
  headers: Record<string, string>
  tree: ParsedNode | null
}

export interface GameFilters {
  q?: string
  family?: string
  opening?: string
  eco?: string
  color?: string
  kind?: string
  tag?: string
  outcome?: string
  since?: string
  until?: string
  player?: string
}

export interface OpeningFamily {
  family: string
  count: number
  ecos: string[]
  as_white: { games: number; score: number } | null
  as_black: { games: number; score: number } | null
  variations: { variation: string; count: number; openings: { name: string; count: number }[] }[]
}

export interface SideRecord {
  games: number
  wins: number
  draws: number
  losses: number
  score: number | null
}

export interface OpeningStats {
  games: number
  reviewed: number
  by_color: { white: SideRecord; black: SideRecord }
  accuracy: Partial<Record<Side, number>>
  mistakes_by_move: { move: number; count: number }[]
  mistake_peak_move: number | null
  mistake_count: number
}

export interface ImportResult {
  added: number[]
  duplicates: number[]
  problems: string[]
  problem_count: number
}

// ---- notes (Phase 4) ------------------------------------------------------------------

export interface Note {
  id: number
  created_at: string
  updated_at: string
  title: string
  body: string
  tags: string
  pinned: boolean
  fen: string | null
  epd: string | null
  game_id: number | null
  eco: string | null
  opening: string | null
  tournament_id: number | null
  snippet?: string | null
}

export interface NoteInput {
  title?: string
  body?: string
  tags?: string
  pinned?: boolean
  fen?: string | null
  game_id?: number | null
  tournament_id?: number | null
  eco?: string | null
  opening?: string | null
}

// ---- training (Phases 5 and 6) -----------------------------------------------------------

export interface TrainingState {
  item_id: string
  kind: string
  attempts: number
  successes: number
  streak: number
  ease: number
  interval_days: number
  due_at: string
  last_result: string | null
  last_at: string | null
  due: boolean
  mastered: boolean
}

export type Goal = 'win' | 'draw'
export interface SuccessRule {
  type: 'mate' | 'promote' | 'capture' | 'hold'
  moves?: number
}

export interface LessonSummary {
  id: string
  category: string
  level: number
  title: string
  fen: string
  goal: Goal
  side: Side
  opening?: string | null
  date?: string | null
  progress: TrainingState | null
}

export interface Lesson extends LessonSummary {
  success: SuccessRule
  idea: string
  steps: string[]
  hint: string
  item_id: string
  exact: boolean
  best?: { uci: string; san: string }
  review_id?: number
  game_id?: number | null
}

export interface MoveVerdict {
  ok: boolean
  success: boolean
  finished: boolean
  message: string
  result: 'win' | 'draw' | 'loss'
  source: 'tablebase' | 'engine' | 'rules'
  reply: { uci: string; san: string } | null
  best: { uci: string; san: string; line: string[] } | null
  dtz?: number | null
  win?: number | null
}

export interface Puzzle {
  id: string
  fen: string
  color: Side
  move_number: number
  played: { san: string; uci: string }
  best: { uci: string; san: string }
  best_line_san: string[]
  classification: 'mistake' | 'blunder'
  win_before: number
  win_after: number
  explanation: string | null
  endgame: boolean
  review_id: number
  game_id: number | null
  white: string | null
  black: string | null
  date: string | null
  event: string | null
  eco: string | null
  opening: string | null
  progress: TrainingState | null
}

export interface PuzzleCheck {
  correct: boolean
  exact: boolean
  san: string
  loss: number
  best?: { uci: string; san: string } | null
  best_line?: string[]
  reply_line?: string[]
}

export interface RepEdge {
  id: number
  created_at: string
  color: Side
  from_epd: string
  uci: string
  san: string
  to_epd: string
  comment: string
  progress: TrainingState | null
  opening: Opening | null
}

// ---- tournaments (Phase 6) ---------------------------------------------------------------

export interface ChecklistItem {
  text: string
  done: boolean
}

export interface Tournament {
  id: number
  created_at: string
  updated_at: string
  name: string
  location: string
  start_date: string | null
  end_date: string | null
  time_control: string
  notes: string
  checklist: ChecklistItem[]
  rounds?: number
  note_count?: number
}

export interface Round {
  id: number
  tournament_id: number
  number: number
  round_date: string | null
  opponent: string
  opponent_rating: number | null
  my_color: Side | null
  result: '1' | '0.5' | '0' | null
  expected: string
  prep: string
  game_id: number | null
  opening?: string | null
  review_id?: number | null
}

export interface TournamentDetail extends Omit<Tournament, 'rounds'> {
  rounds: Round[]
  notes_list: { id: number; title: string; updated_at: string; pinned: number }[]
  score: { points: number; played: number }
}

export interface OpponentSide {
  games: number
  openings: { family: string; count: number; score: number | null; lines: { name: string; count: number }[] }[]
}

export interface OpponentSummary {
  name: string
  games: number
  as_white: OpponentSide
  as_black: OpponentSide
  recent: { id: number; white: string | null; black: string | null; result: string | null; opening: string | null; sort_date: string }[]
}

// ---- settings and backups (Phase 7) -----------------------------------------------------------

export interface AppSettings {
  stockfish_path: string
  live_threads: number
  live_hash_mb: number
  review_threads: number
  review_hash_mb: number
  default_profile: ReviewProfile
  thresholds: { inaccuracy: number; mistake: number; blunder: number }
  theme: Theme
  allow_internet: boolean
  player_names: string[]
  onboarded: boolean
}

export interface SettingsView {
  settings: AppSettings
  defaults: AppSettings
  cpu_count: number
  detected_stockfish: string | null
  tablebases: TablebaseStatus
  data_dir: string
}

export interface Backup {
  name: string
  size: number
  created_at: string
}

const featureApi = {
  // library
  listGames: (f: GameFilters = {}, limit = 500) =>
    request<{ games: GameRow[]; total: number }>('GET', `/api/games${qs({ ...f, limit })}`),
  getGame: (id: number) => request<GameDetail>('GET', `/api/games/${id}`),
  saveGame: (body: { pgn: string; kind: 'game' | 'analysis'; source?: string; my_color?: Side | null; tags?: string }) =>
    request<{ id: number; created: boolean; game: GameRow }>('POST', '/api/games', body),
  updateGame: (id: number, body: { pgn?: string; my_color?: Side | 'none'; tags?: string; kind?: 'game' | 'analysis' }) =>
    request<GameRow>('PUT', `/api/games/${id}`, body),
  deleteGame: (id: number) => request<{ ok: boolean }>('DELETE', `/api/games/${id}`),
  importGames: (pgn: string, myColor?: Side | null, tags?: string) =>
    request<ImportResult>('POST', '/api/games/import', { pgn, my_color: myColor ?? null, tags: tags ?? null }),
  gameTags: () => request<{ tags: { tag: string; count: number }[] }>('GET', '/api/games/tags'),
  openingTree: (f: GameFilters = {}) => request<{ families: OpeningFamily[] }>('GET', `/api/library/openings${qs({ ...f })}`),
  openingStats: (f: GameFilters = {}) => request<OpeningStats>('GET', `/api/library/stats${qs({ ...f })}`),
  detectOpening: (fen: string, moves: string[]) =>
    request<{ opening: Opening | null }>('POST', '/api/openings/detect', { fen, moves }),
  exportUrl: (f: GameFilters & { ids?: string } = {}) => `/api/games/export${qs({ ...f })}`,

  // notes
  listNotes: (f: { q?: string; fen?: string; game_id?: number; tournament_id?: number; tag?: string; family?: string } = {}) =>
    request<{ notes: Note[] }>('GET', `/api/notes${qs(f)}`),
  noteTags: () => request<{ tags: { tag: string; count: number }[] }>('GET', '/api/notes/tags'),
  getNote: (id: number) => request<Note>('GET', `/api/notes/${id}`),
  createNote: (body: NoteInput) => request<Note>('POST', '/api/notes', body),
  updateNote: (id: number, body: NoteInput) => request<Note>('PUT', `/api/notes/${id}`, body),
  deleteNote: (id: number) => request<{ ok: boolean }>('DELETE', `/api/notes/${id}`),
  exportNotes: () => request<{ count: number; folder: string }>('POST', '/api/notes/export'),

  // endgames and training
  endgames: () => request<{ lessons: LessonSummary[]; categories: string[]; tablebases: TablebaseStatus }>('GET', '/api/endgames'),
  lesson: (id: string) => request<Lesson>('GET', `/api/endgames/lessons/${encodeURIComponent(id)}`),
  endgameMove: (body: { fen: string; moves: string[]; goal: Goal; success: SuccessRule }) =>
    request<MoveVerdict>('POST', '/api/endgames/move', body),
  endgameHint: (fen: string, moves: string[]) =>
    request<{ best: { uci: string; san: string; line: string[] }; source: string; piece: string | null; from: string }>(
      'POST', '/api/endgames/hint', { fen, moves }),
  trainingResult: (itemId: string, kind: 'endgame' | 'puzzle' | 'rep', outcome: 'good' | 'hard' | 'again') =>
    request<TrainingState>('POST', '/api/training/result', { item_id: itemId, kind, outcome }),
  training: (kind?: string) =>
    request<{ items: Record<string, TrainingState>; due: number; mastered: number; total: number }>('GET', `/api/training${qs({ kind })}`),

  // practice
  botMove: (fen: string, moves: string[], elo: number | null) =>
    request<{ move: { uci: string; san: string } | null; over: { result: string; reason: string; winner: Side | null } | null }>(
      'POST', '/api/play/move', { fen, moves, elo }),
  finishGame: (pgn: string, myColor: Side, review: boolean) =>
    request<{ id: number | null; game_id: number | null }>('POST', '/api/play/finish', { pgn, my_color: myColor, review }),
  puzzles: (endgame?: boolean) => request<{ puzzles: Puzzle[]; total: number }>('GET', `/api/puzzles${qs({ endgame })}`),
  checkPuzzle: (fen: string, uci: string, bestUci?: string) =>
    request<PuzzleCheck>('POST', '/api/puzzles/check', { fen, uci, best_uci: bestUci ?? null }),
  repertoire: (color: Side) => request<{ color: Side; root_epd: string; edges: RepEdge[] }>('GET', `/api/repertoire?color=${color}`),
  addRepMove: (color: Side, fen: string, uci: string, comment = '') =>
    request<{ id: number }>('POST', '/api/repertoire/edges', { color, fen, uci, comment }),
  updateRepMove: (id: number, comment: string) => request<{ ok: boolean }>('PUT', `/api/repertoire/edges/${id}`, { comment }),
  deleteRepMove: (id: number) => request<{ ok: boolean; removed: number }>('DELETE', `/api/repertoire/edges/${id}`),
  importRepertoire: (color: Side, pgn: string) =>
    request<{ added: number; conflicts: string[]; conflict_count: number }>('POST', '/api/repertoire/import', { color, pgn }),
  exportRepertoire: (color: Side) => request<{ pgn: string }>('GET', `/api/repertoire/export?color=${color}`),

  // tournaments and opponents
  tournaments: () => request<{ tournaments: Tournament[] }>('GET', '/api/tournaments'),
  tournament: (id: number) => request<TournamentDetail>('GET', `/api/tournaments/${id}`),
  createTournament: (body: Partial<Tournament> & { name: string }) => request<Tournament>('POST', '/api/tournaments', body),
  updateTournament: (id: number, body: Partial<Tournament>) => request<TournamentDetail>('PUT', `/api/tournaments/${id}`, body),
  deleteTournament: (id: number) => request<{ ok: boolean }>('DELETE', `/api/tournaments/${id}`),
  addRound: (tid: number, body: Partial<Round>) => request<Round>('POST', `/api/tournaments/${tid}/rounds`, body),
  updateRound: (tid: number, rid: number, body: Partial<Round>) => request<Round>('PUT', `/api/tournaments/${tid}/rounds/${rid}`, body),
  deleteRound: (tid: number, rid: number) => request<{ ok: boolean }>('DELETE', `/api/tournaments/${tid}/rounds/${rid}`),
  fetchOpponent: (site: 'lichess' | 'chesscom', username: string, max: number) =>
    request<ImportResult & { player: string }>('POST', '/api/opponents/fetch', { site, username, max }),
  opponents: () => request<{ opponents: { name: string; games: number }[] }>('GET', '/api/opponents'),
  opponent: (name: string) => request<OpponentSummary>('GET', `/api/opponents/${encodeURIComponent(name)}`),

  // settings and backups
  settings: () => request<SettingsView>('GET', '/api/settings'),
  saveSettings: (changes: Partial<AppSettings>) => request<SettingsView>('PUT', '/api/settings', changes),
  resetSettings: () => request<SettingsView>('POST', '/api/settings/reset'),
  reloadTablebases: () => request<TablebaseStatus>('POST', '/api/tablebases/reload'),
  backups: () => request<{ backups: Backup[]; folder: string }>('GET', '/api/backups'),
  createBackup: () => request<Backup>('POST', '/api/backups'),
  deleteBackup: (name: string) => request<{ ok: boolean }>('DELETE', `/api/backups/${encodeURIComponent(name)}`),
  restoreBackup: (name: string) => request<{ ok: boolean; safety_backup: string }>('POST', `/api/backups/${encodeURIComponent(name)}/restore`),
  restoreUpload: (file: Blob) => request<{ ok: boolean; safety_backup: string }>('POST', '/api/restore', undefined, file),
}

export const api = { ...coreApi, ...featureApi }
