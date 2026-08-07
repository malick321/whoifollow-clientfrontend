import { postLegacyJson } from './client'

// Team-event game scoring — wraps the LEGACY v1 `game/*` endpoints (the `games`
// table). These return the v1 envelope `{ data, message, statusCode }`; we
// unwrap `.data`. See docs: run/inning line-score model (NOT plate appearances).
//
// Semantics: GameScore.team_flag 1 = my team / 2 = opponent; team_type 1 =
// visiting / 2 = home; batting_flag 1 = currently batting; end_inning_flag =
// current inning no. GameInning.inning_type 1 = HR / 2 = runs.

export interface GameInningRow {
  id: number
  game_score_id: number
  inning_type: number // 1 = HR, 2 = runs
  inning_no: number
  score: number
}

export interface GameScoreRow {
  id: number
  game_id: number
  team_name: string
  team_type: number // 1 = visiting, 2 = home
  team_flag: number // 1 = my team, 2 = opponent
  batting_flag: number // 1 = batting
  end_inning_flag: number
  gameInnings: GameInningRow[]
}

export interface GameRow {
  id: number
  guid: string
  name: string
  opponent_name: string
  status: number
  win_status: number | null
  game_live: number
  team_id: string
  gameScores: GameScoreRow[]
}

export interface GameLineupRow {
  id: number
  user_id: number
  position_index: number
  position_id: number | null
  ab: number
  one_b: number
  two_b: number
  three_b: number
  hr: number
  rbi: number
  r: number
  bb: number
  sac: number
  e: number
  solo_hr: number
  h: number
  average: string
  on_base_avg: string
  position?: { position_name?: string } | null
  user_profile?: { picture?: string; profile_avatar?: string; guid?: string; fname?: string; lname?: string } | null
  teamMember?: { uniform_no?: string | null } | null
  user?: { name?: string } | null
}

export interface StatsSums {
  ab: number; h: number; one_b: number; two_b: number; three_b: number; hr: number
  rbi: number; r: number; bb: number; sac: number; e: number; solo_hr: number
  average: string; on_base_avg: string
}

export interface GameScoringData {
  game: GameRow | null
  teamName: string
  opponentName: string
  teamRuns: number
  opponentRuns: number
  isMyTeamBatting: boolean
  gameLineUps: GameLineupRow[]
  stats_sums?: StatsSums | null
}

type Envelope<T> = { data?: T | null; message?: string; statusCode?: number }

function unwrap<T>(res: Envelope<T>): T | null {
  const data = res?.data
  if (data === null || data === undefined) return null
  // v1 returns `[]` (empty array) when there's no payload object.
  if (Array.isArray(data) && data.length === 0) return null
  return data as T
}

export async function fetchGameScoring(gameId: string | number): Promise<GameScoringData | null> {
  const res = await postLegacyJson<Envelope<GameScoringData>>('/game/getGameScoresAndLineups', { gameId })
  return unwrap(res)
}

export interface SelectHomeTeamPayload {
  game_id: number | string
  team_id: string
  team_name: string
  team_avatar?: string | null
  opponent_flag: number // 1 = my team is home, 0 = my team is visiting
  actual_start_time?: string
  time_limit?: string | number | null
}
export function selectHomeTeam(payload: SelectHomeTeamPayload) {
  return postLegacyJson('/game/selectHomeTeam', payload)
}

export interface UpdateScorePayload {
  game_id: number | string
  team_type: number
  inning_no: number
  score: number
  inning_type: number // 1 = HR, 2 = runs
}
export function updateScore(payload: UpdateScorePayload) {
  return postLegacyJson('/game/updateScore', payload)
}

// Correct a previously-scored inning cell (legacy line-score cell edit).
export interface UpdatePreviousScorePayload {
  game_id: number | string
  game_score_id: number | string
  inning_no: number
  run_score: number
  hr_score: number
}
export function updatePreviousScore(payload: UpdatePreviousScorePayload) {
  return postLegacyJson('/game/updatePreviousScore', payload)
}

const gameAction = (path: string) => (gameId: number | string) =>
  postLegacyJson(path, { game_id: gameId })

export const addInning = gameAction('/game/addInning')
export const endHalfInning = gameAction('/game/endHalfInning')
export const swapGameTeams = gameAction('/game/swapGameTeams')
export const deleteLastInning = gameAction('/game/deleteLastInning')
export const endGame = gameAction('/game/endGame')
export const reopenGame = gameAction('/game/reopenGame')

export interface BattingStatsPayload {
  id: number
  ab: number
  one_b: number
  two_b: number
  three_b: number
  hr: number
  rbi: number
  r: number
  bb: number
  sac: number
  e: number
  solo_hr?: number
}
export function updateBattingStats(payload: BattingStatsPayload) {
  return postLegacyJson('/game/updateBattingStats', payload)
}
