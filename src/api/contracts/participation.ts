export type ApiRegistrationStatus =
  | 0
  | 1
  | 2
  | 'registered'
  | 'pending'
  | 'expired'
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | null
export type ApiParticipationStatus =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 'initiated'
  | 'pending_approval'
  | 'confirmed'
  | 'waitlisted'
  | 'withdrawn'
  | 'cancelled'
  | null
export type ApiGameStatus = 0 | 1 | 2 | 'scheduled' | 'live' | 'final' | null
export type ApiUploadStatus = 'idle' | 'uploading' | 'review' | 'mapped' | 'published' | null

export interface ApiParticipationManager {
  name: string | null
  email: string | null
  phone: string | null
  /** Optional linked WIF user id; will be used later to deep-link the manager
   *  name to a user profile. Currently just carried through the adapter. */
  manager_linked_user_id?: string | number | null
}

/** Per-player entry in the new structured lineup_summary list.
 *  Note the `jersy` spelling matches the backend wire format — do not
 *  silently rename here or the adapter will miss the field. */
export interface ApiParticipationLineupSummaryPlayer {
  user_id: string | number | null
  jersy: string | null
  name: string | null
  position: string | null
  isStarter: boolean | null
  isActive: boolean | null
  isBench: boolean | null
}

export interface ApiParticipationEventMeta {
  name: string | null
  timezone: string | null
  /** Raw ISO event date range (yyyy-mm-dd). Drives the weather-strip
   *  visibility window (start − 5 days through end) on the sidebar. */
  start_date?: string | null
  end_date?: string | null
}

export interface ApiParticipationDivisionMeta {
  id: string | number | null
  guid?: string | null
  name: string | null
  start_date: string | null
  end_date: string | null
  tie_breaker_text?: string | null
  pool_games_guaranteed?: number | null
  pool_id?: string | number | null
  wins?: number | null
  losses?: number | null
  seed?: number | null
  scheduled_parks?: string[] | null
  bracket?: ApiParticipationDivisionBracket | null
}

export interface ApiParticipationDivisionWinner {
  rank: number | null
  label: string | null
  team_id: string | number | null
  team_guid: string | null
  team_name: string | null
}

export interface ApiParticipationDivisionBracket {
  bracket_id?: string | number | null
  bracket_name: string | null
  format: string | null
  bracket_completed: boolean | null
  is_seed_generated: boolean | null
  winners: ApiParticipationDivisionWinner[] | null
}

export interface ApiParticipationLineupPlayer {
  id: string | number
  team_member_id?: string | number | null
  user_id?: string | number | null
  jersey_number: string | null
  player_name: string | null
  position_code: string | null
  status: 'active' | 'bench' | null
}

export interface ApiParticipationForecastDay {
  label: string | null
  icon: 'sun' | 'partly-cloudy' | 'rain' | null
  high: number | null
  low: number | null
}

export interface ApiParticipationEventOverview {
  /** Backend migrated this from a comma-joined string to a structured list.
   *  We keep `string | null` in the union so the adapter can survive the
   *  transitional rollout window where some envs might still emit the old
   *  shape — it coerces either to a typed LineupSummaryPlayer[]. */
  lineup_summary: ApiParticipationLineupSummaryPlayer[] | string | null
  venue_text: string | null
  forecast?: ApiParticipationForecastDay[] | null
  attendee_count?: number | null
}

export interface ApiParticipationDivisionPodiumEntry {
  rank_label: string | null
  team_name: string | null
  note: string | null
  image_url: string | null
  runs_differential: string | null
  bracket_record: string | null
}

export interface ApiParticipationDivisionStandingEntry {
  seed: number | null
  wins: number | null
  losses: number | null
  team_name: string | null
  team_meta: string | null
  location: string | null
  image_url: string | null
}

export interface ApiParticipationDivisionOverview {
  tie_breaker_text: string | null
  format_text: string | null
  podium: ApiParticipationDivisionPodiumEntry[]
  standings: ApiParticipationDivisionStandingEntry[]
}

export interface ApiTeamParticipationSummaryResponse {
  team_id?: string | number | null
  team_guid?: string | null
  team_avatar?: string | null
  /** Team metadata sourced from team association registration. Optional so
   *  older backends that don't emit these fields still parse cleanly. */
  team_rating?: string | number | null
  team_agegroup?: string | null
  team_city?: string | null
  team_state?: string | null
  event_id: string | number
  event_guid?: string | null
  event_name?: string | null
  event_date?: string | null
  event?: ApiParticipationEventMeta | null
  division: string | ApiParticipationDivisionMeta | null
  tournament_id?: string | number | null
  tournament_guid?: string | null
  fee_status: ApiRegistrationStatus
  association_status: ApiRegistrationStatus
  participation_status: ApiParticipationStatus
  team_name: string | null
  manager: ApiParticipationManager | null
  event_overview: ApiParticipationEventOverview | null
}

export interface ApiParticipationGame {
  id: string | number
  bracket_label: string | null
  game_time: string | null
  date_label: string | null
  time_label: string | null
  field: string | null
  facility_label: string | null
  division_label: string | null
  opponent: string | null
  opponent_image_url: string | null
  team_image_url: string | null
  opponent_seed: string | null
  team_seed: string | null
  score_for: number | null
  score_against: number | null
  status: ApiGameStatus
  status_note: string | null
  badge_count: number | null
  lineup_submitted: boolean | null
  scoresheet_status: ApiUploadStatus
}

export interface ApiTeamParticipationResponse {
  /** Envelope-level status — backend may return HTTP 200 but signal a
   *  business error via this field (e.g. participation not found, not
   *  authorized). Anything other than 200 → view redirects to NotFoundView.
   *  Absent means "ignore" for backward compat with older envelopes. */
  statusCode?: number | null
  message?: string | null
  team_id?: string | number | null
  team_guid?: string | null
  team_avatar?: string | null
  /** Team metadata sourced from team association registration. See
   *  ApiTeamParticipationSummaryResponse for the same set. */
  team_rating?: string | number | null
  team_agegroup?: string | null
  team_city?: string | null
  team_state?: string | null
  event_id: string | number
  event_guid?: string | null
  event_name?: string | null
  event_date?: string | null
  event?: ApiParticipationEventMeta | null
  divisions?: ApiParticipationDivisionMeta[] | null
  /** @deprecated use divisions[0] */
  division?: string | ApiParticipationDivisionMeta | null
  tournament_id?: string | number | null
  tournament_guid?: string | null
  fee_status: ApiRegistrationStatus
  association_status: ApiRegistrationStatus
  participation_status: ApiParticipationStatus
  participation_status_code?: string | number | null
  event_joined_team_id?: string | number | null
  user_role_id?: number | null
  user_role?: string | null
  is_admin?: boolean | null
  team_name: string | null
  manager: ApiParticipationManager | null
  lineup?: ApiParticipationLineupPlayer[] | null
  games?: ApiParticipationGame[] | null
  event_overview: ApiParticipationEventOverview | null
  division_overview?: ApiParticipationDivisionOverview | null
}
