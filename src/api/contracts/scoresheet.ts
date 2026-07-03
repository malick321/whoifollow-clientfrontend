export type ApiGameLineupSubmissionStatus = 0 | 1 | 2 | 3 | 4
export type ApiGameLineupApprovalMode = 0 | 1

export interface ApiGameLineupSubmission {
  id: number | null
  tournament_game_id?: number
  tournament_game_score_id?: number | null
  team_id?: number
  sport_type_id?: number | null
  submission_status: ApiGameLineupSubmissionStatus
  approval_mode: ApiGameLineupApprovalMode
  submitted_by_user_id?: number | null
  submitted_at: string | null
  approved_by_user_id?: number | null
  approved_at: string | null
  rejected_by_user_id?: number | null
  rejected_at?: string | null
  rejection_reason: string | null
  source_type:
    | 'manual'
    | 'scoresheet_upload'
    | 'system_generated'
    | 'ball_by_ball_derived'
    | 'copied_from_event_lineup'
  notes: string | null
}

export interface ApiGameLineupPlayer {
  id: number | null
  game_lineup_id?: number | null
  tournament_game_id?: number
  team_id?: number
  sport_type_id?: number | null
  event_id?: number | null
  event_joined_team_id?: number | null
  event_team_lineup_id: number | null
  team_member_id: number | null
  user_id: number | null
  image_url?: string | null
  avatar_url?: string | null
  profile_avatar?: string | null
  player_image_url?: string | null
  player_name: string
  jersey_number: string | null
  player_source_type: 0 | 1 | 2 | 3 | 4
  batting_order: number
  position_code: string | null
  is_starter: boolean
  is_bench: boolean
  is_substitute: boolean
  is_active: boolean
  entered_inning: number | null
  exited_inning: number | null
  replaces_game_lineup_player_id?: number | null
}

export interface ApiGameBattingAppearance {
  id: number
  tournament_game_id: number
  team_id: number
  sport_type_id: number
  game_lineup_player_id: number
  pitcher_lineup_player_id: number | null
  inning_number: number
  inning_half: string | null
  batting_sequence_no: number
  plate_appearance_no_for_player: number
  outs_before: number | null
  outs_after: number | null
  result_code: string
  result_detail: string | null
  batter_end_base: '1B' | '2B' | '3B' | 'HP' | null
  counts_as_at_bat: boolean
  counts_as_plate_appearance: boolean
  is_on_base: boolean
  rbi: number
  run_scored: boolean
  is_earned_run: boolean | null
  source_type: 'manual' | 'scoresheet_upload' | 'ball_by_ball' | 'corrected'
  entered_by_user_id: number | null
  created_at: string
  updated_at: string
}

export interface ApiGameBattingStats {
  id: number
  tournament_game_id: number
  team_id: number
  sport_type_id: number
  game_lineup_player_id: number
  plate_appearances: number
  at_bats: number
  runs: number
  hits: number
  rbi: number
  walks: number
  strikeouts: number
  left_on_base: number
  result_counts_json: Record<string, number> | null
  source_type: 'manual' | 'scoresheet_upload' | 'derived_from_pa' | 'corrected'
  is_locked: boolean
  created_at: string
  updated_at: string
}

export interface ApiFieldConfigPosition {
  id?: number
  field_configuration_id?: number | null
  position_name: string
  position_number?: number | null
  x_axis?: number | null
  y_axis?: number | null
  status?: number | null
  code?: string
  label?: string
  area?: 'infield' | 'outfield' | 'battery' | 'flex'
}

export interface ApiEventLineupOption {
  id: string
  image_url?: string | null
  avatar_url?: string | null
  profile_avatar?: string | null
  player_image_url?: string | null
  jersey_number: string
  player_name: string
  position_code: string
  status: 'active' | 'bench'
}

export interface ApiScoresheetUploadReviewItem {
  id: string
  title: string
  detail: string
  tone: 'success' | 'warning' | 'info'
}

export interface ApiScoresheetResponse {
  game_id?: string
  tournament_game_id?: number | string
  team_id?: number | string
  event_id?: string | number
  tournament_id?: string | number
  event_name?: string | null
  division?: string
  bracket_label?: string
  game_time_label?: string
  time_limit_minutes?: number | null
  current_inning?: number | null
  is_live?: boolean
  team?: {
    id: string
    name: string
    seed: string | null
    side: 'H' | 'V'
    line_scores: Array<number | string>
    home_runs: number
  }
  opponent?: {
    id: string
    name: string
    seed: string | null
    side: 'H' | 'V'
    line_scores: Array<number | string>
    home_runs: number
  }
  manager?: {
    name: string
    email: string
    phone: string
  }
  venue?: {
    field: string | null
    park: string | null
    city: string | null
    state: string | null
  }
  scoresheet_upload: {
    status: 'idle' | 'uploading' | 'review' | 'mapped' | 'published'
    source_image_name: string | null
    extraction_confidence: number | null
    notes: string | null
    review_items: ApiScoresheetUploadReviewItem[]
  }
  field_config: {
    name: string | null
    positions: ApiFieldConfigPosition[]
  }
  event_lineup_options?: ApiEventLineupOption[]
  lineup_submission: ApiGameLineupSubmission | null
  game_lineup_players?: ApiGameLineupPlayer[]
  lineup_players?: ApiGameLineupPlayer[]
  game_batting_appearances?: ApiGameBattingAppearance[]
  batting_appearances?: ApiGameBattingAppearance[]
  game_batting_stats?: ApiGameBattingStats[]
  batting_stats?: ApiGameBattingStats[]
}
