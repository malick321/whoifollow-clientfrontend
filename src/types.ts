export type RegistrationStatus =
  | 'registered'
  | 'pending'
  | 'expired'
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
export type ParticipationStatus =
  | 'initiated'
  | 'pending_approval'
  | 'confirmed'
  | 'waitlisted'
  | 'withdrawn'
  | 'cancelled'
export type UploadStatus = 'idle' | 'uploading' | 'review' | 'mapped' | 'published'

export interface TeamManager {
  name: string
  email: string
  phone: string
  /** Linked WIF user id for the manager. Carried through from the API for
   *  a future profile-link; no UI consumption yet. */
  linkedUserId?: string
}

/** Single entry in the event lineup summary list. Backend now returns a
 *  structured list (previously this was a comma-joined string). Contains
 *  both starters and bench/inactive players, flagged via booleans. */
export interface LineupSummaryPlayer {
  userId?: string
  jerseyNumber: string
  name: string
  position: string
  isStarter: boolean
  isActive: boolean
  isBench: boolean
}

export interface LineupPlayer {
  id: string
  battingOrder?: number
  teamMemberId?: string | null
  userId?: string | null
  imageUrl?: string
  jerseyNumber: string
  name: string
  position: string
  status: 'active' | 'bench'
  playerSourceType?: 'manual' | 'team_member'
}

export interface TeamMemberOption {
  id: string
  name: string
  jerseyNumber: string
  defaultPosition: string
  status: 'active' | 'bench'
  isPlayer?: boolean
  userId?: string | null
  imageUrl?: string
}

export interface FieldConfigPosition {
  code: string
  label: string
  area: 'infield' | 'outfield' | 'battery' | 'flex'
  id?: number
  fieldConfigurationId?: number | null
  positionName?: string
  positionNumber?: number | null
  xAxis?: number | null
  yAxis?: number | null
  status?: number | null
}

export type GameLineupSubmissionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'finalized'
export type GameLineupApprovalMode = 'auto' | 'manual'

export interface GameLineupPlayer {
  id: string
  eventLineupId?: string
  teamMemberId?: string
  userId?: string
  imageUrl?: string
  playerName: string
  jerseyNumber: string
  battingOrder: number
  positionCode: string | null
  isStarter: boolean
  isBench: boolean
  isSubstitute: boolean
  isActive: boolean
  enteredInning?: number | null
  exitedInning?: number | null
  substitutesForId?: string | null
  playerSourceType: 'manual' | 'team_member' | 'invited_member' | 'association_entered' | 'uploaded_scoresheet'
}

export interface GameLineupSubmission {
  id?: string | null
  status: GameLineupSubmissionStatus
  approvalMode: GameLineupApprovalMode
  sourceType: 'manual' | 'scoresheet_upload' | 'system_generated' | 'ball_by_ball_derived' | 'copied_from_event_lineup'
  submittedAt?: string | null
  approvedAt?: string | null
  rejectionReason?: string | null
  notes?: string
  players: GameLineupPlayer[]
}

export interface FieldConfigDetail {
  name?: string
  positions: FieldConfigPosition[]
}

export interface GameLineupSubmissionDetail {
  hasExistingSubmission: boolean
  submission: GameLineupSubmission | null
  players?: GameLineupPlayer[]
  templateLineup?: LineupPlayer[]
  fieldConfig?: FieldConfigDetail | null
}

export interface GameSummary {
  id: string
  guid?: string
  bracketLabel: string
  gameTime: string
  dateLabel?: string
  timeLabel?: string
  actualStartTime?: string
  timeLimit?: number | string
  field: string
  facilityLabel?: string
  divisionLabel?: string
  opponent: string
  opponentImageUrl?: string
  teamImageUrl?: string
  opponentSeed?: string
  teamSeed?: string
  opponentSide?: 'H' | 'V'
  teamSide?: 'H' | 'V'
  scoreFor?: number
  scoreAgainst?: number
  teamWon?: boolean
  opponentWon?: boolean
  status: 'scheduled' | 'live' | 'final'
  statusNote?: string
  badgeCount?: number
  lineupSubmitted: boolean
  scoresheetStatus: UploadStatus
}

export interface DivisionPodiumEntry {
  rankLabel: string
  teamName: string
  teamId?: string
  teamGuid?: string
  note: string
  imageUrl?: string
  runsDifferential?: string
  bracketRecord?: string
}

export interface DivisionStandingEntry {
  seed: number
  wins: number
  losses: number
  teamName: string
  teamMeta: string
  location: string
  imageUrl?: string
  /** Pool the team belongs to (from `tournament_teams.pool_id`).
   *  `poolName` is the display label ("Pool A" / "Pool 1"). Both
   *  optional until the standings API returns the pool join — the UI
   *  falls back to a single ungrouped list when absent. */
  poolId?: string
  poolName?: string
}

// ── Team Notifications (MatchGeni) ───────────────────────────────
// Admin → team messaging (results, reminders, schedule changes, custom).
// Mock-first; the real backend resolves recipient contacts by joining
// `association_teams`. See `src/api/matchGeniNotifications.ts`.

/** Which roster a notification targets — drives the composer's left tabs. */
export type NotificationAudienceType = 'teams' | 'officials' | 'umpires'
/** Delivery channel for a notification. */
export type NotificationChannel = 'in_app' | 'email'
/** Who on a team receives it — the whole team (in-app) or just the manager. */
export type NotificationAudience = 'team' | 'manager'
/** Notification category — drives the default template + the badge tone. */
export type NotificationCategory =
  | 'result'
  | 'schedule_change'
  | 'custom'
  | 'payment_reminder'
  | 'registration_reminder'
  | 'promotion'
/** Per-recipient delivery state (mock stamps `sent`). */
export type NotificationDeliveryStatus = 'sent' | 'queued' | 'failed'

/** A default per-category message template (subject + tokenised body). */
export interface NotificationTemplate {
  category: NotificationCategory
  label: string
  subject: string
  /** Body with `{teamName} {eventName} {divisionName} {amountDue} {validUntil}` tokens. */
  body: string
}

/** A recipient *scope* — the selection is expressed as a small set of these
 *  tokens rather than an enumerated team list, so "all teams" / "a whole
 *  division" cost nothing to select (no team fetch). The backend resolves
 *  each scope to the underlying contacts at send time. */
export type NotificationRecipientKind =
  | 'all_event'
  | 'division'
  | 'pool'
  | 'team'
  | 'all_officials'
  | 'official'
  | 'all_umpires'
  | 'umpire'
export interface NotificationRecipient {
  kind: NotificationRecipientKind
  /** Chip display label (e.g. "All teams", "Men's 40 Major+", "Pool A", "Sharks"). */
  label: string
  /** Present for division / pool / team scopes. */
  divisionId?: string
  /** Present for pool scopes. */
  poolId?: string
  /** Present for team scopes. */
  teamName?: string
  /** Present for official / umpire scopes (the person's id). */
  personId?: string
  /** Known recipient count for the chip (division → teamCount; pool → its
   *  teams; team/person → 1; all_* → roster total). Display + total only. */
  count?: number
}

/** A stored (sent) notification record. */
export interface TeamNotification {
  id: string
  /** Roster targeted (teams / officials / umpires). */
  audienceType: NotificationAudienceType
  category: NotificationCategory
  audience: NotificationAudience
  channels: NotificationChannel[]
  subject: string
  body: string
  /** The recipient scopes this was sent to (resolved to contacts by the
   *  backend). */
  recipients: NotificationRecipient[]
  /** Human-readable recipient summary (e.g. "All teams" / "3 teams"). */
  recipientSummary: string
  /** Best-known recipient count (sum of scope counts). */
  recipientCount: number
  createdAt: string
  createdBy?: string
  status: NotificationDeliveryStatus
}

/** Payload to send a notification to a set of recipient scopes. */
export interface SendNotificationPayload {
  audienceType: NotificationAudienceType
  category: NotificationCategory
  audience: NotificationAudience
  channels: NotificationChannel[]
  subject: string
  body: string
  recipients: NotificationRecipient[]
}

// ── Event Discussions ────────────────────────────────────────────
/** Who a discussion topic is visible to / aimed at. */
export type DiscussionAudience = 'all' | 'teams' | 'officials' | 'umpires'
/** Lifecycle of a discussion topic. */
export type DiscussionStatus = 'open' | 'resolved'

/** A discussion topic (thread head) for an event. Replies live behind a
 *  detail view (future); the list surfaces `replyCount` + last activity. */
export interface EventDiscussion {
  id: string
  title: string
  /** First-post excerpt shown in the list row. */
  excerpt: string
  audience: DiscussionAudience
  authorName: string
  authorAvatarUrl?: string
  replyCount: number
  createdAt: string
  lastActivityAt: string
  status: DiscussionStatus
}

/** Payload to start a new discussion topic. */
export interface CreateDiscussionPayload {
  title: string
  body: string
  audience: DiscussionAudience
}

export interface DivisionOverview {
  tieBreakerText: string
  formatText: string
  bracketName?: string
  bracketCompleted?: boolean
  isSeedGenerated?: boolean
  podium: DivisionPodiumEntry[]
  standings: DivisionStandingEntry[]
}

export interface TeamEventForecastDay {
  /** Display label, e.g. "Mon, Apr 12". */
  label: string
  /** Fallback condition bucket used when no iconUrl is available (mock data
   *  or older code paths). Kept for backward-compat. */
  icon: 'sun' | 'partly-cloudy' | 'rain'
  /** Full icon URL from WeatherAPI.com (e.g. "https://cdn.weatherapi.com/
   *  weather/64x64/day/113.png"). Preferred over `icon` when present. */
  iconUrl?: string
  /** Condition text (e.g. "Partly cloudy") for <img alt="">. */
  conditionText?: string
  /** Max temperature in Fahrenheit, rounded to integer. */
  high: number
  /** Min temperature in Fahrenheit, rounded to integer. */
  low: number
}

export interface TeamEventOverview {
  /** Structured list of event lineup players (starters + bench + inactive).
   *  Was a comma-joined string in the old shape; the adapter converts
   *  legacy payloads to an empty array. */
  lineupSummary: LineupSummaryPlayer[]
  venueText: string
  forecast: TeamEventForecastDay[]
  attendeeCount: number
}

export type EventAttendanceStatus = 'going' | 'not_going' | 'maybe'

export interface EventAttendanceMember {
  id: string
  teamId?: string
  memberId?: string
  userId?: string
  guid?: string
  firstName: string
  lastName: string
  nickName?: string
  fullName: string
  profileAvatar?: string
  status: EventAttendanceStatus
  services?: string | null
  roomCount?: string | null
  adultCount?: string | null
  exactStartDate?: string | null
  exactEndDate?: string | null
  note?: string | null
}

export interface EventAttendanceListingResult {
  members: EventAttendanceMember[]
  /** `team_members.id` of the currently authenticated user, if the listing
   *  response surfaces it. Used to pre-highlight "your attendance" in the modal
   *  and to distinguish the self card from admin-targetable attendee cards. */
  selfMemberId: string | null
}

export interface SaveEventAttendancePayload {
  eventId: string
  /** Team GUID — submitted as `team_id` to the endpoint (the legacy contract
   *  uses the GUID string, not the numeric team id). */
  teamGuid: string
  status: EventAttendanceStatus
  /** Omit to mark self — backend derives from the bearer token. Pass when an
   *  admin is editing another member's attendance. */
  memberId?: string
  /** Optional travel-arrangements bundle. Only meaningful when status is
   *  `going` and the user opts in via the post-RSVP form. When any field is
   *  omitted the API receives an empty string for that field, matching the
   *  pre-feature behaviour for status-only saves. */
  services?: string[]
  roomCount?: number | null
  adultCount?: number | null
  /** ISO date strings (`YYYY-MM-DD`). Only sent when Hotel is in `services`. */
  exactStartDate?: string | null
  exactEndDate?: string | null
  note?: string | null
}

export type SaveEventAttendanceResult = EventAttendanceListingResult

/** Response shape from `/event/sendRemainderToTeammates`. The endpoint
 *  emails every teammate who hasn't yet RSVP'd (status: not_responded)
 *  and reports back the totals + the list of users it actually mailed. */
export interface SendAttendanceReminderResult {
  totalTeammates: number
  respondedUsers: number
  notRespondedUsers: Array<{
    userId: number
    firstName: string
    lastName: string
    email: string
  }>
  emailsSent: number
  /** Verbatim `message` field from the backend envelope, if present.
   *  Useful as a diagnostic when the count fields look unexpected. */
  message?: string
}

export interface TeamParticipation {
  eventId: string
  eventGuid?: string
  eventName: string
  eventDate: string
  /** Raw ISO event start / end dates (yyyy-mm-dd). Drive the weather-strip
   *  visibility window on the sidebar. Optional because older API responses
   *  may not include them on the `event` object yet. */
  eventStartDate?: string
  eventEndDate?: string
  division: string
  tournamentId?: string
  tournamentGuid?: string
  teamId?: string
  teamGuid?: string
  teamAvatarUrl?: string
  /** Team metadata sourced from team association registration. All optional
   *  so older API responses that don't emit these still type-check. */
  teamRating?: string
  teamAgeGroup?: string
  teamCity?: string
  teamState?: string
  divisionGuid?: string
  feeStatus: RegistrationStatus
  associationStatus: RegistrationStatus
  participationStatus: ParticipationStatus
  eventJoinedTeamId?: string
  teamName: string
  manager: TeamManager
  userRoleId?: number
  userRole?: string
  isAdmin?: boolean
  lineup: LineupPlayer[]
  teamMembers?: TeamMemberOption[]
  fieldConfigName?: string
  fieldConfigPositions?: FieldConfigPosition[]
  games: GameSummary[]
  eventOverview: TeamEventOverview
  divisionOverview: DivisionOverview
}

export interface ScoresheetInning {
  inning: number
  runs: string
  outcome: string
}

export type ScoresheetMappingState = 'matched' | 'review' | 'unmapped'
export type ScoresheetCellReviewState = 'empty' | 'review' | 'verified'

export interface ScoresheetPlateAppearance {
  id: string
  sequence: number
  result: string
  batterEndBase: '1B' | '2B' | '3B' | 'HP' | null
  contactType: string
  rbi: number
  outsOnPlay: number
  baserunning: string
  fieldZone: string
  fieldersInvolved: string
  notes: string
}

export interface ScoresheetCell {
  inning: number
  appearances: ScoresheetPlateAppearance[]
  reviewState: ScoresheetCellReviewState
}

export interface ScoresheetPlayerRow {
  id: string
  gameLineupPlayerId?: number
  battingOrder: number
  jerseyNumber: string
  playerName: string
  mappedLineupId?: string
  mappedLineupName?: string
  mappingState: ScoresheetMappingState
  innings: ScoresheetInning[]
  cells: ScoresheetCell[]
  runs: number
  hits: number
  rbi: number
  // Populated when this batting slot has a substitute. `cells` above is the
  // starter's appearance stream; the sub has its own parallel stream here.
  // Rendering uses `substituteEnteredInning` to decide which stream applies
  // per inning and which player's identity to submit on save.
  substituteGameLineupPlayerId?: number
  substitutePlayerName?: string
  substituteJerseyNumber?: string
  substitutePositionCode?: string
  substituteEnteredInning?: number
  substituteExitedInning?: number
  substituteCells?: ScoresheetCell[]
  substituteRuns?: number
  substituteHits?: number
  substituteRbi?: number
}

export interface ScoresheetReviewItem {
  id: string
  title: string
  detail: string
  tone: 'success' | 'warning' | 'info'
}

export interface ScoresheetDetail {
  gameId: string
  eventName?: string
  teamName: string
  teamAvatarUrl?: string
  opponent: string
  opponentAvatarUrl?: string
  teamSeed?: string
  opponentSeed?: string
  teamSide: 'H' | 'V'
  opponentSide: 'H' | 'V'
  bracketLabel: string
  division: string
  gameTime: string
  actualStartTime?: string
  timeLimit?: number | string
  venueField?: string
  venuePark?: string
  venueCity?: string
  venueState?: string
  teamLineScores?: Array<number | string>
  opponentLineScores?: Array<number | string>
  teamRunsTotal?: number
  opponentRunsTotal?: number
  teamHomeRuns?: number | null
  opponentHomeRuns?: number | null
  currentInning?: number | null
  currentBattingTeamSide?: 'H' | 'V'
  gameStatusCode?: number
  gameStatusLabel?: string
  isDelayed?: boolean
  delayReason?: string
  isLive?: boolean
  manager: TeamManager
  uploadStatus: UploadStatus
  sourceImageName?: string
  extractionConfidence: number
  notes: string
  gameLineupSubmitted: boolean
  fieldConfigName?: string
  fieldConfigPositions: FieldConfigPosition[]
  gameLineupSubmission: GameLineupSubmission | null
  lineupOptions: LineupPlayer[]
  reviewItems: ScoresheetReviewItem[]
  players: ScoresheetPlayerRow[]
}

/** Association user record displayed in the association portal's
 *  Users tab. v1 uses mocked data — see `src/api/associationUsers.ts`. */
export type AssociationUserStatus = 'active' | 'inactive' | 'pending'

/** Canonical permission keys used by both the AssociationUserModal
 *  toggle grid and the role-pill derivation. The display labels live
 *  in `src/constants/associationPermissions.ts` so users / admins can
 *  iterate on copy without touching the type. */
export type AssociationPermissionKey =
  | 'manage_events'
  | 'manage_users'
  | 'manage_umpires'
  | 'manage_players'
  | 'manage_teams'
  | 'manage_followers'
  | 'manage_settings'
  | 'manage_financials'
  | 'manage_products'
  | 'manage_orders'
  | 'manage_reports'

/**
 * MyAssociation — the access record returned by `/v2/my/associations`
 * (list) and `/v2/my/associations/{slug}` (single). One row per
 * association the logged-in user has live admin access to.
 *
 * Slim by design: id / guid / slug / shortName / associationName /
 * logoUrl give the sidebar + switcher everything they need, and
 * `fullControl` + `permissions[]` drive UI gating. The full
 * association profile (cover, addresses, social links, etc.) loads
 * separately via `GET /v2/association/profile/{slug}` only when the
 * profile modal opens.
 *
 * `logoUrl` is a public, unsigned URL — never an AWS pre-signed URL
 * with expiring query parameters.
 *
 * `status` is the ASSOCIATION's status (not the membership's).
 * Membership status is implicit: if a row is returned, the user has
 * live access. The status surfaces inactive / suspended associations
 * to the UI for banners + read-only treatment.
 */
export interface MyAssociation {
  id: string
  guid: string
  slug: string
  shortName: string
  associationName: string
  logoUrl: string
  fullControl: boolean
  permissions: AssociationPermissionKey[]
  status: 'active' | 'inactive' | 'suspended'
  /** Whether the association has connected Stripe Connect — gates online
   *  credit-card payment settings (e.g. the event wizard's "Allow credit
   *  card payments"). From `GET /v2/my/associations/{slug}`. */
  stripeConnected?: boolean
}

/** Event-scoped permission keys. Granted PER-EVENT to officials —
 *  a user can be on staff for many events with a different subset
 *  of these permissions on each. Distinct from
 *  AssociationPermissionKey even where names overlap (e.g.
 *  manage_teams here is event-roster scoped, not association-roster
 *  scoped). */
export type EventPermissionKey =
  | 'edit_event'
  | 'manage_officials'
  | 'manage_divisions'
  | 'manage_parks'
  | 'manage_hotels'
  | 'manage_sponsors'
  | 'manage_team_participation'
  | 'manage_scoring'
  | 'manage_scheduling'
  | 'manage_umpires'

/** A field the event admin added against a park during event setup
 *  (the curated "fields in use" set). From `event_field_selections`,
 *  NOT derived from scheduled games — present even before any games
 *  exist. */
export interface ParkFieldInUse {
  id: string
  name: string
}

/** One calendar day a park is in use, with that day's scheduling
 *  window. Per-day — each day can carry a different start/end (e.g.
 *  Fri 08:00–18:30, Sat 08:00–20:00). All label fields are
 *  backend-rendered in the event's timezone and treated as opaque. */
export interface ParkScheduleEntry {
  /** ISO `YYYY-MM-DD`, local to the event timezone. */
  date: string
  /** 24-hour `HH:MM` — earliest game start at this park this day. */
  startTime: string
  /** 24-hour `HH:MM` — latest game end at this park this day. */
  endTime: string
  /** Long form, e.g. "Wednesday, April 29, 2026". */
  dateLabel: string
  /** Short form with weekday, e.g. "Wed, Apr 29, 2026". */
  dateLabelShort: string
  /** Time-range string, e.g. "8:00 AM – 6:30 PM". */
  timeRangeLabel: string
}

/** A park (venue) inside a tournament event, as returned by the §9
 *  Event Resources endpoint. Parks are event-scoped. The id is what
 *  gets persisted in `ScoringScope.parkIds`; `fieldsInUse` + `schedule`
 *  drive the MatchGeni scheduler / field-grid rendering. */
export interface Park {
  id: string
  name: string
  /** Google `place_id` — canonical identity for dedup (primary key over a
   *  lat/long radius check). Absent for non-Google / manually-added parks. */
  placeId?: string
  /** Single-line street address. `""` when not recorded. */
  address?: string
  city?: string
  state?: string
  /** Decimal degrees, stringified to preserve precision. `null`
   *  when no geocode is on file. */
  latitude?: string | null
  longitude?: string | null
  /** Fields the admin added for this park during event setup.
   *  Empty array when none added yet. */
  fieldsInUse?: ParkFieldInUse[]
  /** One entry per calendar day the park is in use, each with that
   *  day's scheduling window. Empty array when no games scheduled. */
  schedule?: ParkScheduleEntry[]
}

// ── Add Playing Facility wizard ──────────────────────────────────
// Types backing the multi-step "Add Facility" wizard (location search →
// fields → scheduling). Maps integration is mock-first (Maps-ready); the
// real endpoints are drafted in the API contract. See
// `src/api/matchGeniParks.ts`.

/** A place suggestion from the location search (Google Places-shaped so
 *  swapping the mock for the real Places Autocomplete is a drop-in). */
export interface PlaceSuggestion {
  /** Google `place_id` (mock id for now). */
  placeId: string
  /** Primary name, e.g. "Imran Khan Cricket Stadium Peshawar". */
  name: string
  /** Formatted address, e.g. "Shahi Bagh, Peshawar, Pakistan". */
  address: string
  /** Decimal degrees. */
  latitude: number
  longitude: number
}

/** Result of the nearby-park check: an existing WIF park within the
 *  radius of the selected coordinates, or `null` (→ create-park flow). */
export interface NearbyParkResult {
  park: Park | null
}

/** Payload to create a new park from a picked place + default field
 *  count (the create-park popup). */
export interface CreateParkPayload {
  name: string
  address: string
  latitude: number
  longitude: number
  /** Number of fields to seed the park with. */
  fieldCount: number
  /** Google `place_id` — lets the backend dedup against existing parks
   *  by exact identity before creating a new one. */
  placeId?: string
}

/** One day's window in the wizard's scheduling step. */
export interface FacilityScheduleDay {
  /** ISO `YYYY-MM-DD`. */
  date: string
  /** Whether the park is in use this day. */
  enabled: boolean
  /** 24-hour `HH:MM`. */
  startTime: string
  endTime: string
}

/** Payload to attach a park to an event with its selected fields +
 *  per-day scheduling window. */
export interface EventFacilityPayload {
  parkId: string
  fieldIds: string[]
  schedule: { date: string; startTime: string; endTime: string }[]
}

/** A division inside a tournament event, as returned by §9. id +
 *  display name plus the aggregate date window of its games. */
export interface Division {
  id: string
  name: string
  /** ISO `YYYY-MM-DD` — first scheduled day (event-local). `null` when no games. */
  startDate?: string | null
  endDate?: string | null
  /** Absolute UTC instant (ISO 8601, `Z`) of the division's earliest game
   *  (`MIN(tournament_games.start_at_utc)`) / latest game end
   *  (`MAX(...end_at_utc)`). `null` when no scheduled games. For
   *  countdowns / cross-tz sorting. */
  startDateUtc?: string | null
  endDateUtc?: string | null
  /** Count of teams in the division (`tournament_teams`, active + not
   *  deleted). `0` when none assigned — independent of game scheduling. */
  teamCount?: number
  /** Full label with weekdays + year, e.g.
   *  "Wed, Apr 29 – Sun, May 3, 2026". `""` when no games. */
  dateRangeLabel?: string
  /** Short form without weekday/year, e.g. "Apr 29 – May 3". */
  dateRangeLabelShort?: string
}

/** Mutually-exclusive scope mode for the `manage_scoring`
 *  permission. Drives which list (parks/divisions) is active in
 *  the access modal's scope picker. */
export type ScoringScopeMode = 'all' | 'parks' | 'divisions'

/** A sponsor attached to an event (§9 `sponsors` slice). Mirrors the
 *  backend row; `imageUrl` is the logo CDN URL (may be empty). */
export interface EventSponsor {
  id: string
  /** Owning event id. */
  eventId: string
  name: string
  /** Sponsor site, opened from the logo. `""` when none. */
  websiteUrl: string
  /** Logo CDN URL. `""`/absent when no logo uploaded — render a
   *  wordmark fallback. */
  imageUrl: string
  /** 1 = active, 0 = inactive (hidden). */
  status: number
}

/** A hotel added to an event (§9 `hotels` slice). The §9 wire fields
 *  below map 1:1 to `event_hotels` columns (camelCased). The remaining
 *  fields are the in-app Map-Explorer "add hotel" representation (Google
 *  Place lookup) kept for that flow. */
export interface EventHotel {
  id: string
  eventId: string
  name: string
  // ── §9 wire fields (← event_hotels columns) ──
  /** `event_hotels.website_url`. */
  websiteUrl?: string | null
  /** `event_hotels.phone_number`. */
  phoneNumber?: string | null
  /** `event_hotels.mob_code` — dialing country code, e.g. "+1". */
  mobCode?: string | null
  /** `event_hotels.latitude` — stringified decimal degrees; drives the
   *  Map Explorer pin. `null` when no geocode. */
  latitude?: string | null
  /** `event_hotels.longitude`. */
  longitude?: string | null
  /** `event_hotels.address_description` — free-form locality / landmark. */
  addressDescription?: string | null
  /** `event_hotels.street_address`. */
  streetAddress?: string | null
  /** `event_hotels.zip`. */
  zip?: string | null
  /** `event_hotels.notes`. */
  notes?: string | null
  /** Single-line address (composed for display surfaces that don't show
   *  the granular parts). `""` when not recorded. */
  address?: string
  /** Pre-formatted distance from the primary venue (e.g. "1.1 mi").
   *  NOT a §9 wire field — the client computes it from `latitude` /
   *  `longitude`; kept optional for display surfaces that show it. */
  distanceLabel?: string
  status: number
  /** Map coordinates — drives the Map Explorer pin. Optional. */
  position?: GeoPosition
  /** External booking URL — when present, the Map Explorer shows a
   *  "Book Now" affordance for the hotel. */
  bookingUrl?: string
  /** Google `place_id` — canonical identity for dedup. */
  placeId?: string
  // ── Captured when a hotel is added from the Map Explorer (Google
  //    Place lookup). All optional — older rows won't carry them. ──
  /** Hotel website (the in-map add form's "website URL"). */
  website?: string
  /** Dialling country code, e.g. "+1". */
  phoneCountryCode?: string
  /** Local phone number (without the country code). */
  phone?: string
  /** Street address line (without city/state/zip). */
  street?: string
  city?: string
  state?: string
  postalCode?: string
  /** ISO-3166 alpha-2 country code, e.g. "US". */
  countryCode?: string
  /** Photo / hero image URL. */
  imageUrl?: string
}

/** Payload to create a hotel from the in-map "Add Hotel" form. Most
 *  fields are prefilled from the picked Google Place; the admin can
 *  edit before saving. Mock-saved via `src/api/matchGeniHotels.ts`. */
export interface CreateHotelPayload {
  name: string
  /** Google `place_id` — lets the backend dedup against existing hotels. */
  placeId?: string
  website?: string
  phoneCountryCode?: string
  phone?: string
  street?: string
  city?: string
  state?: string
  postalCode?: string
  countryCode?: string
  latitude: number
  longitude: number
  imageUrl?: string
}

/** Response shape for `GET /v2/association/events/{associationId}/{eventId}/resources`
 *  per `association-events-api-contract.md` §9. A bucket key is present
 *  only when the caller requested it via the comma-separated `type`
 *  (e.g. `type=parks,hotels` returns just `parks` + `hotels`); `type=all`
 *  returns every bucket. Consumers read each bucket defensively (`?? []`). */
export interface EventResources {
  parks?: Park[]
  divisions?: Division[]
  sponsors?: EventSponsor[]
  hotels?: EventHotel[]
}

/** The event-entity slice returned by the MatchGeni access endpoint
 *  (`matchgeni-access-api-contract.md` §1) — caller-INDEPENDENT data
 *  sourced from the `team_events` row: header-display strings, raw
 *  date/time + sport-type/tz values the Division / Add-Facility forms
 *  seed from, and the event-level config `defaults` a new division /
 *  park / game inherits. (Caller-SPECIFIC data lives in the sibling
 *  `access` / `association*` members, not here.) Heavier event data
 *  stays behind the regular `fetchEvent` call. */
export interface MatchGeniEvent {
  id: string
  guid: string
  eventName: string
  /** Full date range with TZ label — e.g. "May 4 to May 9, 2026 (Central Time)". */
  dateRange: string
  /** Compact date range — e.g. "May 4–9, 2026". */
  dateRangeShort: string
  /** Raw event start, plain `YYYY-MM-DD` (no TZ/formatting) — binds
   *  directly to date controls. Default division Start Date. */
  startDate?: string
  /** Raw event end, plain `YYYY-MM-DD`. Default division End Date. */
  endDate?: string
  /** Raw event start time, `HH:MM:SS` — `null`/absent when the event is
   *  all-day. Seeds the default per-day window in the Add Facility
   *  wizard's scheduling step. */
  eventStartTime?: string | null
  /** Raw event end time, `HH:MM:SS` — `null`/absent when all-day. */
  eventEndTime?: string | null
  /** Event start as an absolute UTC instant (ISO 8601, `Z` suffix) —
   *  server-computed from `startDate` + `eventStartTime` resolved against
   *  `timeZone` (start-of-day for all-day events). For precise moments
   *  (countdowns, "is it live now", cross-tz sorting). Derived, not stored. */
  startDateUtc?: string
  /** Event end as an absolute UTC instant (ISO 8601, `Z` suffix) —
   *  server-computed from `endDate` + `eventEndTime` resolved against
   *  `timeZone` (end-of-day for all-day events). Derived, not stored. */
  endDateUtc?: string
  /** Whether the event is all-day (no specific start/end time). When
   *  true the facility wizard defaults the scheduling window to
   *  8:00 AM – 8:00 PM. */
  allDay?: boolean
  /** Event's sport type id — sent to
   *  `/v2/tournaments/field-configurations/sport-type/{id}` to fetch
   *  the field-configuration catalogue for the Add/Edit Division form. */
  sportsTypeId?: number
  /** Event's IANA timezone id (e.g. "America/Chicago"). Shipped so a
   *  surface that needs to turn an event-local date into an instant
   *  computes it against the EVENT's tz, not the viewer's browser. */
  timeZone?: string
  eventStatus: EventStatus
  /** Event director contact details — surfaced so MatchGeni can show a
   *  "contact the director" affordance without a second event fetch.
   *  Sourced from `team_events.director_name` / `director_email` /
   *  `mob_code` (dialing country code, e.g. "+1") / `director_phone`.
   *  Any may be absent/empty when not set on the event. */
  directorName?: string | null
  directorEmail?: string | null
  directorCountryCode?: string | null
  directorNumber?: string | null
  /** Event-level config defaults a freshly-created division / park / game
   *  inherits as its starting point. Optional — absent on older payloads;
   *  consumers read it defensively and only pre-fill a control when the
   *  value is present. */
  defaults?: EventDefaults
}

/** Event-level config defaults a freshly-created division / park / game
 *  inherits as its starting point (matchgeni-access-api-contract.md §1,
 *  the `event.defaults` object). All members optional + nullable: a field
 *  is `null` when the event hasn't set that default, and the whole
 *  object may be absent on older payloads — consumers read each
 *  defensively and only pre-fill a control when the value is present. */
export interface EventDefaults {
  /** Default Pool Play time limit (minutes) — regulation length used for
   *  live "remaining" / "over time". */
  poolPlayTimeLimit?: number | null
  /** Default Bracket time limit (minutes). */
  bracketTimeLimit?: number | null
  /** Default Championship time limit (minutes). */
  championshipTimeLimit?: number | null
  /** Default game time SLOT (minutes) — the grid footprint a game
   *  occupies. A single event-level value (not per game type). Seeds a new
   *  park's default slot + a new game's slot. Distinct from the time limit
   *  (the slot can be reslotted on the grid without changing the
   *  regulation limit). */
  gameTimeSlot?: number | null
  /** Default pool-play game guarantee (1–5) for a custom format. */
  poolPlayGuarantee?: number | null
  /** Default bracket-format id (FK → `/getBracketFormats`). */
  bracketFormatId?: string | null
  /** Default field-configuration id (FK → field-configurations). */
  fieldConfigId?: string | null
  /** Default tie-breaker (seed-criteria) ids in priority order — the
   *  event-level `event_seed_criteria`. A division inherits these unless it
   *  overrides them. Lets the division popup show the inherited tie breakers
   *  in its "Event default" mode (resolved to names via the /v2/seeders
   *  catalogue). Omitted when the event has no custom seed default. */
  seedCriteriaIds?: readonly string[]
}

/** Field-configuration catalogue entry (v2
 *  `/v2/tournaments/field-configurations/sport-type/{id}`). `{ id, name }`
 *  feed the Field Configuration select; `positions` (the on-field layout)
 *  drive the field-diagram preview. */
export interface FieldConfigurationOption {
  id: string
  name: string
  positions: FieldConfigPosition[]
}

/** Seeding-criterion catalogue entry (legacy
 *  `GET /associationEvent/fetchFilteredSeedars`). Normalized from the
 *  raw `{ id, criteria_name }` row onto the shared `{ id, name }` option
 *  shape. Reused by the event-create popup AND the division Seed step. */
export interface SeedingCriterionOption {
  id: string
  name: string
}

/** One ordered seeding-criterion selection on a division — persisted to
 *  `tournament_seed_criteria`. */
export interface DivisionSeedCriterion {
  /** FK → seeding-criteria catalogue (`SeedingCriterionOption.id`). */
  seedingCriteriaId: string
  /** 1-based priority within the division's tie-break chain. */
  order: number
}

/** Request body for create/update division
 *  (`matchgeni-division-api-contract.md`). Plain `YYYY-MM-DD` dates (no
 *  tz). The three Format-step sections each send an explicit toggle flag
 *  (always present) plus their value fields only when overriding. */
export interface CreateDivisionPayload {
  tournamentName: string
  startDate: string
  endDate: string
  /** Event IANA timezone (e.g. "America/Chicago"). Sent so the backend can
   *  combine the plain `startDate`/`endDate` DATEs into UTC instants
   *  (start-of-day / end-of-day in this zone). `null` when the event has none. */
  timeZone: string | null
  poolPlayTime: number | null
  bracketTime: number | null
  championshipTime: number | null
  continuousTeamSrNo: boolean
  /** Format section toggle → `custom_format` (0/1). `true` = custom format
   *  chosen, so `poolPlayGuarantee` + `bracketFormatId` carry values;
   *  `false` = inherit the event default (both `null`). */
  customFormat: boolean
  /** → `pool_game_guarantee`. Non-null only when `customFormat`. */
  poolPlayGuarantee: number | null
  /** → `bracket_format`. Non-null only when `customFormat`. */
  bracketFormatId: string | null
  /** Restrict Team Entry toggle → `restrict_teams_entry` (0/1). `true` =
   *  only teams matching the selected age groups + ratings can be added;
   *  `false` = open entry (`ageGroupIds` / `ratingIds` sent empty). */
  restrictTeamsEntry: boolean
  ageGroupIds: string[]
  ratingIds: string[]
  /** Tie-breakers section toggle → `use_event_seed` (0/1). `true` = use the
   *  event's default seeding (`seedCriteria` empty); `false` = custom, so
   *  `seedCriteria` carries the ordered list. */
  useEventSeed: boolean
  /** Field-config section toggle → `use_event_field_config` (0/1). `true` =
   *  inherit the event field config (`fieldConfigId` null); `false` = custom,
   *  so `fieldConfigId` carries the chosen value. */
  useEventFieldConfig: boolean
  /** → `field_config_id`. Non-null only when `useEventFieldConfig` is `false`. */
  fieldConfigId: string | null
  notes: string
  /** → `tournament_seed_criteria` rows. Non-empty only when `useEventSeed`
   *  is `false`. */
  seedCriteria: DivisionSeedCriterion[]
}

/** Result of a successful create/update division call — the created/updated
 *  row's identity. (The backend also seeds a default pool, but its id isn't
 *  surfaced — no client surface uses it.) */
export interface CreateDivisionResult {
  tournamentId: number
  tournamentGuid: string
}

/** Permission slice returned by the MatchGeni access endpoint.
 *  Identical wire shape to the per-event permission summary used
 *  elsewhere so the same gating helpers can consume it. */
export interface MatchGeniAccess {
  /** `true` when the caller holds Full Control via ANY path:
   *  event-scoped FC on their `event_officials` row OR
   *  association-level FC on their `association_users` row.
   *  Short-circuits every per-key check. */
  fullControl: boolean
  /** Effective event-level permission keys for the caller.
   *  Always empty when `fullControl: true` (FC implies every key
   *  per the wire-encoding rule). Also empty when the only path
   *  in was association-level `manage_events` — that lets the
   *  user enter MatchGeni read-only but unlocks no writes. */
  permissions: EventPermissionKey[]
  /** Scoring scope restriction for the caller. `null` when the
   *  caller doesn't hold `manage_scoring`, OR when scope is "all
   *  games", OR when `fullControl: true`. */
  scoringScope: ScoringScope | null
}

/** Combined payload returned by the MatchGeni access endpoint.
 *  Drives the entry guard (presence of payload = allowed) and
 *  every per-action write gate inside MatchGeni. */
export interface MatchGeniAccessPayload {
  /** Caller-independent event entity — display fields, form-seed values,
   *  and the event-level config `defaults` (nested under `event`). */
  event: MatchGeniEvent
  access: MatchGeniAccess
  // NOTE: association-portal standing is NOT carried here. MatchGeni and the
  // portal run in the same app on the same subdomain, and every MatchGeni
  // user is an association member (an event-official invite creates an
  // `association_users` row), so `currentAssociation` is always loaded on
  // matchgeni routes and already holds `fullControl` / `permissions`. The
  // "Back to portal" button reads that (see `canEnterAssociation`) instead
  // of duplicating it on this payload.
}

/** One requestable resource bucket on the §9 event-resources endpoint. */
export type EventResourceBucket = 'parks' | 'divisions' | 'sponsors' | 'hotels'

/** The `type` selection for the §9 event-resources endpoint. Either an
 *  explicit list of buckets — serialized comma-separated on the wire
 *  (e.g. `type=parks,hotels`) — or the `'all'` shorthand (every bucket).
 *  REQUIRED: the endpoint has no default; an omitted / empty / unknown
 *  `type` is a `422`. (The legacy `'both'` value was dropped — request
 *  `['parks', 'divisions']` explicitly instead.) */
export type EventResourcesSelection = EventResourceBucket[] | 'all'

/** Scope of a user's `manage_scoring` permission inside one
 *  event. Only meaningful when `manage_scoring` is in the
 *  user's permissions array; ignored otherwise. The shape is
 *  intentionally a discriminated union (one of all/parks/
 *  divisions) so adding a new mode later (e.g. `teams`) is
 *  additive. */
export interface ScoringScope {
  mode: ScoringScopeMode
  /** Park ids — non-empty only when `mode === 'parks'`. */
  parkIds: string[]
  /** Division ids — non-empty only when `mode === 'divisions'`. */
  divisionIds: string[]
}

/** Mirror of `invites.status` — the central polymorphic invites
 *  table. Cached on `association_users.invite_status` to keep the
 *  users-list query JOIN-free. See
 *  `docs/association-users-api-contract.md`. */
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface AssociationUser {
  id: string
  name: string
  email: string
  avatarUrl?: string
  status: AssociationUserStatus
  /** Master "full control" flag. When true, every permission below is
   *  implicitly granted regardless of the `permissions` array contents
   *  — the role pill renders as "Admin" and the per-permission
   *  toggles are disabled in the form. */
  fullControl: boolean
  /** Individually granted permissions when `fullControl` is false.
   *  When `fullControl` is true this array is ignored at the
   *  presentation layer (still persisted so toggling Full Control off
   *  later restores prior selections). */
  permissions: AssociationPermissionKey[]
  /** ISO timestamp of when the user was invited. */
  invitedAt?: string
  /** ISO timestamp of when the user accepted the invitation. */
  joinedAt?: string
  /** FK to the central `invites` table. Opaque handle the UI passes
   *  back to resend / cancel calls if the backend wants id-based
   *  addressing. */
  inviteId?: string
  /** Cached mirror of `invites.status` denormalized onto
   *  `association_users.invite_status`. Lets the UI decide whether
   *  to surface "Resend" vs "Cancel invite" without a second
   *  fetch. */
  inviteStatus?: InviteStatus
  /** Count of events this user is currently rostered as an Official
   *  on. Drives the activity chip in the user listing — gives admins
   *  a second axis for understanding member involvement beyond just
   *  the `permissions` array. Sourced from the event_staff join in
   *  the real backend; mock data seeds it directly today. */
  eventOfficialCount: number
}

/** Standard response envelope every `/v2` endpoint returns. The mock
 *  layer exposes unwrapped payloads (envelopes get stripped by the
 *  HTTP client interceptor in production), so frontend code rarely
 *  sees this type directly — but it's exported so server-mode code
 *  and tests can construct it. See `docs/conventions.md`. */
export interface ResponseStatus {
  message: string
  statusCode: number
  text?: string
}

export interface ResponseEnvelope<T> {
  responseStatus: ResponseStatus
  data?: T
}

/** Standard Laravel paginator shape returned by list endpoints. The
 *  Association Users UI reads only `total`, `current_page`,
 *  `per_page`, `from`, `to`; the URL helpers are kept for cross-
 *  endpoint consistency. See `docs/conventions.md`. */
export interface PaginatorLink {
  url: string | null
  label: string
  active: boolean
}

export interface LaravelPaginator<T> {
  current_page: number
  data: T[]
  first_page_url: string
  from: number | null
  last_page: number
  last_page_url: string
  links: PaginatorLink[]
  next_page_url: string | null
  path: string
  per_page: number
  prev_page_url: string | null
  to: number | null
  total: number
}

/** Query params accepted by `GET /v2/association/users/{associationId}`. */
export interface AssociationUsersListParams {
  search?: string
  status?: 'all' | AssociationUserStatus
  page?: number
  perPage?: number
  sort?: 'name' | 'joined' | 'invited'
  order?: 'asc' | 'desc'
}

/** Query params accepted by
 *  `GET /v2/association/users/{associationId}/{userId}/events`. */
export interface UserOfficialEventsListParams {
  search?: string
  page?: number
  perPage?: number
}

/** Permission-catalogue payload returned by §10 of the Association
 *  Users contract. */
export interface AssociationPermissionCatalogueEntry {
  key: AssociationPermissionKey
  label: string
  description: string
}

export interface EventPermissionCatalogueEntry {
  key: EventPermissionKey
  label: string
  description: string
  expandable?: boolean
}

export interface PermissionCatalogue {
  associationPermissions: AssociationPermissionCatalogueEntry[]
  eventPermissions: EventPermissionCatalogueEntry[]
}

/** Payload for both Add and Edit flows on the Association User modal.
 *  `id` is undefined for invites, populated for edits. */
/** Team registered with an association. Drives the listing on the
 *  /association/:slug/portal/teams page. v1 uses mock data — see
 *  `src/api/associationTeams.ts`. */
export type AssociationTeamStatus = 'pending' | 'active' | 'expired' | 'rejected' | 'suspended'

export interface AssociationTeam {
  /** The registration id — `association_teams.id` (this association's PK
   *  for the team's registration). Used by every team lifecycle / edit
   *  endpoint in this portal. */
  id: string
  /** FK to the global `teams` table (`association_teams.team_id`). Back-links
   *  this registration to the underlying WIF team that owns members, team
   *  chat, etc. Distinct from `id` (the registration). A team registers with
   *  many associations; each registration is its own `association_teams` row
   *  but shares this `teamId`. */
  teamId: string
  name: string
  avatarUrl?: string
  status: AssociationTeamStatus
  /** Player gender division — "Male", "Female", or "Coed". */
  gender: 'Male' | 'Female' | 'Coed'
  /** Age-group label, e.g. "50 Older", "60 Older", "55 Older". */
  ageGroup: string
  /** Age-group catalogue FK (`age_group_id`) — the write/edit value. Pairs with
   *  the `ageGroup` display label. Optional for defensive reads. */
  ageGroupId?: string
  /** Rating tier label, e.g. "AAA", "AA", "Major", "Major+". */
  rating: string
  /** Association ratings FK (`rating_id`) — the write/edit value. Pairs with
   *  the `rating` display label. Optional for defensive reads. */
  ratingId?: string
  /** Sport-type catalogue FK (`sports_type_id`) — the write/edit value. */
  sportsTypeId?: string
  /** Resolved sport-type label (e.g. "Softball - Slow Pitch") for display —
   *  joined from the sport-types catalogue. Pairs with `sportsTypeId` the same
   *  way `ageGroup` pairs with `ageGroupId`. */
  sportType?: string
  city: string
  state: string
  /** Coarse geographic grouping above state level (e.g. "Southwest").
   *  From the shared regions catalogue (`src/constants/regions.ts`).
   *  Optional for defensive reads of older mock rows. */
  region?: string
  /** ISO date — last time the team's roster or profile was updated. */
  lastUpdatedAt: string
  /** WIF-issued registration number (e.g. "SSUSA00382"). */
  systemRegNo: string
  /** External / partner registration number (e.g. a tournament-host
   *  league number). Free-form numeric string. */
  externalRegNo: string
  managerName: string
  managerEmail: string
  /** Manager mobile country dial code, e.g. "+1" (maps `mob_code`).
   *  Pairs with the raw-digit `managerPhone` per the shared PhoneInput
   *  convention. Optional for defensive reads of older mock rows. */
  managerDialCode?: string
  managerPhone: string
  /** When the manager already has a WIF account, the linked
   *  `users.id` (`manager_linked_user_id`). `null` / undefined when the
   *  manager is tracked by name + email only (an invite is sent). */
  managerLinkedUserId?: string | null
  /** Association-defined custom field answers for the `team` entity
   *  (wire-encoded `{ definitionId, value }`). Returned on read so the
   *  Edit wizard can rehydrate the Additional-details step. */
  customFields?: { definitionId: string; value: string }[]
  /** When true, this team's registration never expires — the card
   *  shows "Never Expires" instead of a Valid Thru date and the
   *  Renew action is hidden. */
  neverExpires: boolean
  /** ISO date string for the expiry of the registration. Only
   *  meaningful when `neverExpires` is false. Pending teams have
   *  an empty string here — they have no validity until activated. */
  validUntil: string
}

/** Minimal, privacy-limited identity returned by the WIF user lookup
 *  (`GET /v2/users/lookup?email=`). Surfaced when an admin types a
 *  person's email and the system finds an existing WIF account — so the
 *  caller can LINK that user instead of inviting a stranger. Carries only
 *  display essentials; never profile data. See `src/api/identity.ts`. */
export interface WifUserIdentity {
  id: string
  name: string
  email: string
  avatarUrl?: string
}

/** The registration types an association configures separately. Maps to
 *  `association_reg_settings.registration_type` (0=team, 1=player, 2=umpire). */
export type RegistrationEntityType = 'team' | 'player' | 'umpire'

/** Per-association, per-type registration settings — see
 *  `association_reg_settings` (`docs/system/sql-schema-association.md`) and
 *  `docs/api/association-registration-settings-api-contract.md`. */
export interface RegistrationSetting {
  registrationType: RegistrationEntityType
  /** Whether the public may self-register this type. */
  allowSelfRegistration: boolean
  /** Whether a fee applies to register this type. */
  paymentApplicable: boolean
  /** Fee amount when `paymentApplicable` is true; `null` otherwise. */
  applicableFee: number | null
  /** Whether online credit-card payment (Stripe) is an allowed rail for this
   *  type. Only meaningful when `paymentApplicable` is true. Forced/saved
   *  `false` when the association has no Stripe Connect account. */
  allowCardPayment: boolean
  /** Whether offline payment (cash / cheque / bank transfer / other) is an
   *  allowed rail for this type. Only meaningful when `paymentApplicable` is
   *  true. Turning this off (with card on) funnels all collection through
   *  Stripe — admins can't record manual payments for this type. */
  allowOfflinePayment: boolean
  /** Default validity policy: `true` = never expires; `false` = expires after
   *  `durationDays`. */
  neverExpires: boolean
  /** Default validity length in days when `neverExpires` is false; `null`
   *  otherwise. */
  durationDays: number | null
  /** The **resolved** WIF platform-fee rule for this registration type (from
   *  `platform_fee_rules`, after scope/priority/active-window resolution). Lets
   *  the registration wizard preview the platform fee + total without
   *  re-implementing rule resolution. Informational — the backend re-resolves +
   *  is authoritative. `null` when no rule applies. */
  platformFee?: PlatformFeeRule | null
}

/** A resolved platform-fee rule the backend hands to the client for previewing
 *  a charge (see `docs/system/sql-schema-payments.md#platform_fee_rules`). Already
 *  resolved (one rule), so the client only applies the simple formula. */
export interface PlatformFeeRule {
  /** `fixed` = flat `feeValue`; `percent` = `feeValue`% of the amount;
   *  `tiered` = banded (reserved — not used yet). */
  feeType: 'fixed' | 'percent' | 'tiered'
  /** Flat amount (`fixed`) or percentage (`percent`, e.g. `5` = 5%). */
  feeValue: number
  /** Optional fee floor / cap applied after computing. */
  minFeeAmount: number | null
  maxFeeAmount: number | null
  /** The source `platform_fee_rules.id` (traceability); optional. */
  ruleId?: string
}

/** Editable subset of the `associations` MySQL table. The
 *  Association Profile modal exposes these fields for self-edit;
 *  identifiers (`username`, `short_name`), audit timestamps,
 *  computed coords (lat/lng), and admin-controlled flags
 *  (`status`, `stripe_connected`, `deleted_at`) are intentionally
 *  excluded — those require platform-side review. */
export interface AssociationProfile {
  /** Association identifier (matches the URL slug). Read-only —
   *  surfaced for the API call but not editable in the UI. */
  id: string
  logoUrl: string
  coverUrl: string
  associationName: string
  websiteUrl: string
  email: string
  /** Country dial code, e.g. "+1". */
  mobileCode: string
  mobileNumber: string
  fbUrl: string
  instaUrl: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  /** Coordinates captured from the street-address Google Places pick and
   *  submitted by the client (not server-geocoded). Empty string when no
   *  address has been picked; cleared when the street is edited by hand. */
  lat: string
  long: string
  notes: string
}

/** Follower of an association — appears in the
 *  /association/:slug/portal/followers list. v1 uses mock data —
 *  see `src/api/associationFollowers.ts`. */
export interface AssociationFollower {
  id: string
  name: string
  avatarUrl?: string
  /** ISO timestamp — when the user followed the association. */
  followedAt: string
}

/** Action types tracked in the `association_team_lifecycle` audit
 *  log. One row is appended whenever an admin or the system
 *  changes a team registration's status or validity. The set is
 *  closed: every status / validity mutation in the codebase maps
 *  to exactly one of these. */
export type TeamLifecycleActionType =
  | 'register'         // initial registration creation
  | 'mark_active'      // pending → active (first activation)
  | 'renew'            // expired/active → active (cycle renewal)
  | 'suspend'          // active → suspended
  | 'reactivate'       // suspended → active
  | 'reject'           // active/pending → rejected (admin cancellation)
  | 'validity_change'  // never_expires ↔ specific date, no status move

/** A single audit entry from `association_team_lifecycle`. The
 *  Lifecycle tab on the team-details page renders these as a
 *  timeline; reporting tools query them by action_type / actor /
 *  date range.
 *
 *  Identifiers are serialized as strings even though the underlying
 *  columns are integer types — keeps the wire format stable across
 *  potential PK type changes and matches the rest of the portal's
 *  string-id convention. */
export interface TeamLifecycleEntry {
  id: string                          // BIGINT serialized as string
  associationTeamId: string           // INT serialized as string
  teamId: string                      // INT serialized as string
  actionType: TeamLifecycleActionType
  /** Admin who performed the action. `null` for system-driven
   *  rows (e.g. nightly auto-expire job). */
  actorUserId: string | null
  /** Display name hydrated client-side from the user lookup the
   *  rest of the portal uses. The DB row does NOT store this — the
   *  API resolves it on read so the timeline UI never deals with
   *  raw user IDs. */
  actorName: string
  /** When the change took effect (ISO timestamp, ms precision). */
  occurredAt: string
  /** Status before the change. `null` only on the initial
   *  `register` row. */
  fromStatus: AssociationTeamStatus | null
  /** Status after the change. Equals `fromStatus` for
   *  `validity_change` rows (validity moved, status didn't). */
  toStatus: AssociationTeamStatus
  fromNeverExpires: boolean | null
  /** ISO date (YYYY-MM-DD) or null. */
  fromValidUntil: string | null
  toNeverExpires: boolean
  toValidUntil: string | null
  /** How the renewal happened. Only set for `renew` /
   *  `mark_active`; null for every other action type. */
  source: 'payment' | 'manual' | null
  /** Logical FK to payment_order. Non-null iff `source === 'payment'`. */
  paymentOrderId: string | null
  /** Hydrated for display, e.g. "PO #1234". */
  paymentReference: string | null
  /** Dollars (only when `source === 'payment'`). */
  amount: number | null
  /** Free-text admin note. App enforces non-empty for `suspend`
   *  and `reject`; optional elsewhere. */
  reason: string | null
  /** Escape hatch for future fields without migration churn. */
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Action types tracked in the per-game lifecycle log. One row is
 *  appended whenever a scoring operator OR the system mutates a
 *  game's state — including pure lifecycle transitions (start/
 *  delay/resume/end/lock/unlock) AND scoring-side events (a new
 *  inning being added, a bulk score upload, an inning-by-inning
 *  correction). Operators view the log from the game-details
 *  drawer's settings menu; reporting tools query by gameId / type. */
export type GameLifecycleActionType =
  | 'start'             // scheduled → live (operator pressed Start Game)
  | 'mark_delayed'      // live → delayed (operator flagged a stoppage)
  | 'resume'            // delayed → live (operator cleared the delay)
  | 'end_game'          // live → final (operator confirmed final score)
  | 'reopen_game'       // final → live (operator un-ended a final game)
  | 'lock'              // final unlocked → final locked
  | 'unlock'            // final locked → final unlocked
  | 'add_inning'        // new inning row opened during live scoring
  | 'delete_inning'     // existing inning row removed during scoring
  | 'swap_sides'        // home/visitor team assignment swapped
  | 'score_upload'      // bulk inning-by-inning upload pushed
  | 'score_correction'  // edit applied to a prior inning's score
  | 'lineup_submit'     // either team's batting-order lineup confirmed

/** A single audit row from the per-game lifecycle log. Mirrors the
 *  shape of `TeamLifecycleEntry` (timeline UI is the same pattern)
 *  but adds game-specific context: which inning the action touched
 *  (for `add_inning` / `score_correction`) and a free-form reason
 *  string (mandatory for `mark_delayed`, optional elsewhere). */
export interface GameLifecycleEntry {
  id: string                            // BIGINT serialized as string
  /** Logical FK to `scheduler_game.id`. */
  gameId: string
  actionType: GameLifecycleActionType
  /** Admin or scoring official who performed the action. `null`
   *  for system-driven rows (e.g. auto-locking N hours after a
   *  game ends). */
  actorUserId: string | null
  /** Display name hydrated client-side. The DB row stores the
   *  actor id; the API resolves the name on read so the timeline
   *  UI never deals with raw IDs. */
  actorName: string
  /** When the change took effect (ISO timestamp, ms precision). */
  occurredAt: string
  /** Status before the change. `null` for entries that don't
   *  involve a status transition (e.g. `add_inning`, `score_upload`). */
  fromStatus: 'scheduled' | 'live' | 'delayed' | 'final' | null
  /** Status after the change. `null` for non-transitioning entries
   *  (the row's actionType still tells you what happened). */
  toStatus: 'scheduled' | 'live' | 'delayed' | 'final' | null
  /** Free-text operator note. App enforces non-empty for
   *  `mark_delayed` (the delay reason) and `score_correction`
   *  (why the correction); optional elsewhere. */
  reason: string | null
  /** Inning number the action touched. Set for `add_inning` (the
   *  inning that was opened) and `score_correction` (the inning
   *  whose score was edited). `null` for non-inning actions. */
  inningNumber: number | null
  /** Escape hatch for future fields without migration churn. */
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Mirrors the `payable.payment_completion_status` enum — purely
 *  payment-state oriented (does the line item still owe money?).
 *  Distinct from `AssociationPayableStatus`, which captures the
 *  business state of the payable itself (draft / active / paid /
 *  cancelled / etc.). */
export type AssociationPaymentCompletionStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'

/** Mirrors the `payable.status` enum from the MySQL schema. */
export type AssociationPayableStatus =
  | 'draft'
  | 'pending'
  | 'payment_in_progress'
  | 'active'
  | 'completed'
  | 'paid'
  | 'cancelled'

/** Mirrors the `payment_orders.status` enum from the MySQL schema. */
export type AssociationPaymentOrderStatus =
  | 'draft'
  | 'pending'
  | 'checkout_created'
  | 'awaiting_offline_payment'
  | 'processing'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'partially_refunded'
  | 'refunded'

/** Mirrors the `payment_orders.payment_method_type` enum. */
export type AssociationPaymentMethodType =
  | 'stripe'
  | 'cash'
  | 'manual'
  | 'cheque'
  | 'check'
  | 'mixed'

/** Mirrors the `payment_orders.collection_mode` enum. */
export type AssociationPaymentCollectionMode = 'online' | 'offline'

/** Mirrors the `payment_orders.order_type` enum. */
export type AssociationPaymentOrderType = 'single' | 'mixed'

/** Mirrors the `payment_orders.payment_proof_status` enum. Tracks
 *  the lifecycle of an offline-payment proof (cheque image, receipt). */
export type AssociationPaymentProofStatus =
  | 'not_required'
  | 'pending_verification'
  | 'verified'
  | 'rejected'

/** A single transaction against a payable / payment order. Mirrors
 *  the conceptual row of a downstream `payment_transactions` /
 *  `charges` table — the schemas the user shared don't include it
 *  yet, so the shape here represents the minimum the UI needs to
 *  render the transaction ledger inside `PaymentTransactionsModal`. */
export interface AssociationPaymentTransaction {
  id: string
  /** ISO timestamp. */
  paidAt: string
  /** Amount paid in this transaction. */
  amount: number
  /** Method label, e.g. "Credit Card", "Cheque", "Cash". */
  method: string
  /** External reference / receipt number / cheque number. */
  reference: string
}

/** Mirrors the `payment_orders` row at the level the team-details
 *  Payments tab cares about. Strings on the wire to keep BIGINT
 *  ids stable; timestamps are ISO. */
export interface AssociationPaymentOrder {
  id: string
  /** Human-friendly identifier (e.g. "PO-2025-00102"). Hydrated
   *  from `payment_orders.order_number`. */
  orderNumber: string
  orderType: AssociationPaymentOrderType
  paymentMethodType: AssociationPaymentMethodType | null
  collectionMode: AssociationPaymentCollectionMode | null
  currency: string
  /** Gross total — sum of `payables.total_amount` (each line's
   *  unit × quantity). Discounts and platform fees are tracked
   *  separately so the breakdown is auditable. */
  totalAmount: number
  discountAmount: number
  /** Sum of `payables.platform_fee_amount`. Mirrors
   *  `payment_orders.platform_fee_amount`. */
  platformFeeAmount: number
  paidAmount: number
  /** Outstanding amount = (totalAmount − discountAmount + platformFeeAmount) − paidAmount. */
  balanceAmount: number
  paymentCompletionStatus: AssociationPaymentCompletionStatus
  paymentProofStatus: AssociationPaymentProofStatus
  status: AssociationPaymentOrderStatus
  /** ISO timestamp — null while unpaid. */
  paidAt: string | null
  failedAt: string | null
  expiredAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  /** Aggregated transaction ledger across the whole order. The line
   *  items (`payables[]`) reference the same ledger for display. */
  transactions: AssociationPaymentTransaction[]
}

/** Closed set of `payables.related_entity_type` values currently
 *  in production. Drives the statement-descriptor copy in the
 *  Payments listing — `association_team` rows render as "Team
 *  Association Registration", `event_joined_team` rows render as
 *  "Team Event Participation" with the event name underneath. */
export type AssociationPayableRelatedEntityType =
  | 'association_team'
  | 'event_joined_team'

/** Mirrors a `payables` row — one line item under a payment order.
 *  The team-details Payments tab lists these (each row = one
 *  payable) and clicking one drills into the parent payment_order. */
/** Generic paginated result — mirrors the Laravel-paginator wire shape
 *  ([conventions](../api/conventions.md)) flattened to what the UI needs:
 *  the page of rows + enough to render "load more" / page counters. */
export interface Paginated<T> {
  data: T[]
  currentPage: number
  perPage: number
  total: number
  /** True when more pages exist after `currentPage` (i.e. `to < total`). */
  hasMore: boolean
}

export interface AssociationPayable {
  id: string
  /** FK → `payment_orders.id`. Lets the UI hydrate the parent order
   *  when the admin drills into a payable row. */
  paymentOrderId: string
  /** `payment_item_types.code` (e.g. `association_team_registration`,
   *  `event_team_registration`) — the `itemType` filter target. */
  itemType?: string
  /** Dedicated indexed entity columns — exactly one populated per payable;
   *  the shared payables list filters on these (not `related_entity_*`). */
  teamId?: string | null
  userId?: string | null
  playerId?: string | null
  umpireId?: string | null
  eventId?: string | null
  /** Hydrated alongside the row for display — saves a join in the
   *  payable listing. */
  paymentOrderNumber: string
  /** What this line item is for — e.g. "Annual Registration —
   *  2025 Season", "Tournament Entry — Spring Classic". */
  description: string
  /** Polymorphic-association discriminator from
   *  `payables.related_entity_type`. The statement descriptor in
   *  the listing is derived from this value. */
  relatedEntityType: AssociationPayableRelatedEntityType | null
  /** Hydrated event name when `relatedEntityType === 'event_joined_team'`.
   *  Joined server-side from `events.name` via `related_entity_id`.
   *  Null for non-event payables. */
  eventName: string | null
  quantity: number
  unitAmount: number
  /** Gross line total: `unitAmount × quantity`. Pre-discount and
   *  pre-fee — discount and platform fee are tracked separately. */
  totalAmount: number
  discountAmount: number
  /** Platform fee charged on this line item (mirrors
   *  `payables.platform_fee_amount`). The displayed "Payable"
   *  amount is computed as `totalAmount − discountAmount + platformFeeAmount`. */
  platformFeeAmount: number
  paidAmount: number
  /** Pre-calculated by the backend as `payable − paidAmount` where
   *  `payable = totalAmount − discountAmount + platformFeeAmount`. */
  balanceAmount: number
  currency: string
  paymentCompletionStatus: AssociationPaymentCompletionStatus
  status: AssociationPayableStatus
  /** ISO date — when the payable becomes due. */
  dueAt: string | null
  /** ISO date — when an unpaid payable expires (if applicable). */
  expiresAt: string | null
  /** ISO timestamp — null while unpaid. */
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

/** Lifecycle status of an association-managed event. 4-state machine:
 *    - `draft`     — work in progress; not visible publicly.
 *    - `published` — visible publicly; registration window honored.
 *    - `completed` — event has wrapped; scores + brackets locked.
 *    - `cancelled` — event won't happen. Soft-cancelled, not deleted.
 *
 *  Transitions (enforced server-side):
 *    draft     → draft, published, cancelled
 *    published → published, completed, cancelled
 *    completed → completed only
 *    cancelled → cancelled only */
export type EventStatus = 'draft' | 'published' | 'completed' | 'cancelled'

/** Event-type enum — the four canonical kinds of association event.
 *  Wire format is the snake_case key; the human-readable label is
 *  resolved via `EVENT_TYPES_CATALOGUE` / `eventTypeLabel()` in
 *  `src/api/events.ts`. Add / remove keys here only in lockstep with
 *  the backend enum + the catalogue mirror documented in
 *  `docs/system/shared-catalogues.md`. */
export type EventType = 'tournament' | 'online_meeting' | 'league' | 'other'

/** Registration window status — derived server-side by comparing
 *  `registrationOpeningUtc` and `entryFeeDeadlineUtc` against
 *  `UTC_TIMESTAMP()`. The UI renders the matching label
 *  (`registrationOpensLabel` / `registrationClosesLabel`). */
export type EventRegistrationStatus = 'not_open' | 'open' | 'closed'

/** Participation breakdown returned with every `Event` /
 *  `EventSummary` row. Backend computes from `event_joined_team`
 *  status column per request. UI typically renders "N Teams
 *  Participating" = pending + confirmed + waitlisted (withdrawn is
 *  informational, not "participating"). */
export interface EventTeamCounts {
  pending: number
  confirmed: number
  waitlisted: number
  withdrawn: number
}

/** Payment-collection terms. Wire format is a string enum even
 *  though the DB stores `TINYINT`. */
export type EventPaymentTerms = 'full' | 'partial'

/** When `paymentTerms='partial'`, how the partial amount is
 *  interpreted: a fixed dollar amount or a percentage of the
 *  total entry fee. */
export type EventPartialPaymentType = 'fixed_amount' | 'percentage'

/** Sport-type lookup pair surfaced from `team_sports_types`. The
 *  Event row carries `sportsTypeId` (numeric string) for filter /
 *  write paths and `sportsTypeName` for display. */
export interface SportsTypeOption {
  id: string
  name: string
}

/** One umpire role config for a sport type (e.g. `PLATE` / "Plate Umpire").
 *  Sourced from `sports_type_umpire_configs`, ordered by `sortOrder`.
 *  Nested under `SportType` from `GET /v2/sport-types`. */
export interface SportTypeUmpireConfig {
  id: string
  code: string
  name: string
  sortOrder: number
}

/** A sport type with everything it carries — its supported field
 *  configurations (each with on-field positions) and its umpire role
 *  configs. The unified resource behind `GET /v2/sport-types` (all) and
 *  `GET /v2/sport-types/{id}` (one); supersedes the per-sport §5 field-
 *  config endpoint. See `docs/api/shared-services-api-contract.md` §8. */
export interface SportType {
  id: string
  name: string
  fieldConfigurations: FieldConfigurationOption[]
  umpireConfigs: SportTypeUmpireConfig[]
}

/** Bracket-format lookup pair. Event row carries `bracketFormatId`
 *  for writes + `bracketFormat` (text) for display, mirroring the
 *  sport-type pattern. */
export interface BracketFormatOption {
  id: string
  name: string
}

/** Age-group catalogue entry (legacy `GET /getAgeGroup`). Normalized
 *  from the raw `{ id, name, type, fieldconfig_id }` row. `type`
 *  distinguishes youth (2) from adult (1) groups; `fieldConfigId` ties
 *  a group to its default field configuration. */
export interface AgeGroupOption {
  id: string
  name: string
  type?: number
  fieldConfigId?: number | null
}

/** Rating (skill tier) — now association-scoped CRUD. `name` = the label
 *  (DB `rate`, e.g. "AA"). `sortOrder`/`active` only populated by the
 *  Settings manager read. See `association-ratings-api-contract.md`. */
export interface RatingOption {
  id: string
  name: string
  sortOrder?: number
  active?: boolean
}

/** Create/update input for an association rating (Settings manager). */
export interface RatingInput {
  name: string
  sortOrder: number
  active?: boolean
}

/** Online-event medium option — shared-services "Get Mediums" lookup
 *  (`shared-services-api-contract.md` §7, backed by the `mediums` catalogue).
 *  Consumed by the Add/Edit Event wizard's Online location step; the picked
 *  `id` persists to `team_events.medium_id`, `name` snapshots to `.medium`. */
export interface MediumOption {
  id: string
  name: string
}

/** Static IANA timezone catalogue entry used by EventFormModal.
 *  Three labels per timezone so different UI surfaces pick the
 *  appropriate one — see `docs/api/association-events-api-contract.md`. */
export interface EventTimezoneOption {
  /** IANA identifier (e.g. `America/Los_Angeles`). Persisted in
   *  `team_events.time_zone`. */
  value: string
  /** Form-dropdown label with the UTC offset prefix
   *  (e.g. `(UTC-05:00) Eastern Time`). Used in the create / edit
   *  form so the admin can pick by offset clarity. */
  formLabel: string
  /** Medium-length display name (e.g. `Eastern Time`). Used in
   *  listings, headers, and inside the backend's `dateRangeLabel`. */
  nameLabel: string
  /** Compact abbreviation (e.g. `EST`). Used in tight UI surfaces:
   *  sticky-header chips, table cells, `dateRangeLabelShort`. */
  shortLabel: string
}

/** Association-managed event — the master record an admin creates +
 *  edits via the Events portal page. Wire shape per
 *  `docs/api/association-events-api-contract.md` §10.
 *
 *  Date strategy: LOCAL fields are the source of truth
 *  (`startDate`, `endDate`, `startTime`, `endTime`, `timeZone`,
 *  `allDay`). The backend generates UTC mirrors (`startAtUtc`,
 *  `endAtUtc`) for indexable cross-TZ queries and exposes pre-
 *  formatted display strings (`dateRangeLabel`, `dateRangeLabelShort`,
 *  `registrationOpensLabel`, `registrationClosesLabel`) so the
 *  frontend never does TZ math. */
export interface Event {
  // Identity
  id: string
  guid: string
  /** URL-safe, globally-unique handle auto-generated by the backend from the
   *  event name on create (e.g. "2026 My Event" → "2026-my-event", with a
   *  `-2`, `-3`… counter suffix on collision). Read-only: never sent on
   *  create/edit, always returned on read. Backs the public `/public/event/:slug`
   *  route. Optional in the type for defensive reads (older payloads). */
  slug?: string
  /** Whether the owning association has an active Stripe Connect account, as
   *  resolved by the backend on **get-one**. Same field name + boolean shape as
   *  `stripeConnected` on the my-associations response. Used to gate the event's
   *  online-payment toggle when editing. Read-only. */
  stripeConnected?: boolean

  // Ownership (one populated, one null)
  teamId: string | null
  associationId: string | null
  associationShortName: string | null

  // Identity + display
  eventName: string
  /** One of the four catalogue keys (`tournament` / `online_meeting`
   *  / `league` / `other`) per the shared event-type catalogue. Null
   *  only for legacy rows that pre-date the catalogue migration. */
  eventType: EventType | null
  /** Fully-qualified public CDN URL. Backend prefixes the CDN base
   *  to the stored filename on read. Null when no hero uploaded. */
  avatarUrl: string | null

  // Location
  address: string | null
  location: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  lat: string | null
  long: string | null

  // Dates & timezone (source-of-truth local fields)
  /** camelCase on the wire — the underlying DB columns are
   *  `event_start_date` / `event_end_date` / `event_start_time` /
   *  `event_end_time` (snake_case per the new-column DB convention);
   *  the backend serializer translates. Legacy `startDate` / `endDate`
   *  / `startTime` / `endTime` DB columns still exist but are not
   *  exposed on the v2 wire — see contract §3. */
  eventStartDate: string | null          // YYYY-MM-DD
  eventEndDate: string | null
  eventStartTime: string | null          // HH:MM:SS — null when allDay
  eventEndTime: string | null
  timeZone: string                       // IANA name
  allDay: boolean

  // Derived UTC + display (READ-ONLY)
  startAtUtc: string                     // ISO 8601 UTC
  endAtUtc: string
  eventYear: number                      // YEAR(startDate)
  isPast: boolean                        // endAtUtc < UTC_TIMESTAMP()
  /** Long-form date range label including timezone name
   *  (e.g. `"Apr 19 to May 24, 2026 (Eastern Time)"`). */
  dateRangeLabel: string
  /** Short date range label including timezone abbreviation
   *  (e.g. `"Apr 19 to May 24, 2026 (EST)"`). */
  dateRangeLabelShort: string

  // Misc
  note: string | null
  reminder: string | null
  mediumId: string | null
  mediumName: string | null
  url: string | null
  /** `'in_person'` | `'online'` — see association-events §4/§5. Optional/
   *  additive; older mock rows may omit it (treated as `'in_person'`). */
  locationType?: 'in_person' | 'online'
  color: string | null

  // Lifecycle
  eventStatus: EventStatus

  // Director contact
  directorName: string | null
  directorEmail: string | null
  directorPhone: string | null
  mobCode: string | null                 // country code for directorPhone

  // Tournament settings (event-level defaults)
  entryFee: number | null
  refundPolicy: string | null
  tournamentFormat: string | null
  entryFeeDeadline: string | null        // YYYY-MM-DD (local)
  entryFeeDeadlineUtc: string | null     // READ-ONLY
  /** Number of games each team is guaranteed in pool play
   *  (free-form string — e.g. "3 games", "4"). Replaces the
   *  separate poolPlay + gameGuarantee fields. */
  poolPlayGuaranteed: string | null
  /** FK to the bracket-format catalogue. Use with `bracketFormat`
   *  the same way `sportsTypeId` pairs with `sportsTypeName`. */
  bracketFormatId: string | null
  /** Denormalized bracket-format display name (e.g. "Double
   *  Elimination", "Round Robin", "Open"). READ-ONLY snapshot
   *  joined from the catalogue. */
  bracketFormat: string | null
  poolPlayTime: string | null
  championshipTime: string | null
  bracketTime: string | null
  timeInterval: string | null

  // Sport type (joined)
  sportsTypeId: string | null
  sportsTypeName: string | null

  // Registration controls
  allowTeamRegistration: boolean
  registrationOpening: string | null     // local DATETIME
  registrationOpeningUtc: string | null  // READ-ONLY
  registrationStatus: EventRegistrationStatus
  registrationOpensLabel: string | null
  registrationClosesLabel: string | null

  // Payment
  paymentRequired: boolean
  paymentTerms: EventPaymentTerms | null
  partialPaymentType: EventPartialPaymentType | null
  partialPaymentValue: number | null
  allowOfflinePayment: boolean
  autoConfirmOnFullPayment: boolean
  autoConfirmOnPartialPayment: boolean

  // Field configuration
  fieldConfigId: string | null

  /** Participation counts (READ-ONLY). Backend computes these per
   *  request via `LEFT JOIN event_joined_team` + conditional SUM
   *  per status — no cached counter on `team_events`. UI sums
   *  pending + confirmed + waitlisted to render "N Teams
   *  Participating"; detail view can show the full split. See
   *  `docs/api/association-events-api-contract.md` §10 + plan §11. */
  teamCounts: EventTeamCounts

  /** Custom-field values set on this event (for edit prefill). Empty /
   *  omitted when none. See `custom_field_values`. */
  customFields?: CustomFieldValue[]

  /** Event-default seed criteria (`event_seed_criteria`) returned on the
   *  get-one read, ordered by tie-break priority — for edit prefill. Empty /
   *  omitted when the event has no seed default. */
  seedCriteria?: { seedingCriteriaId: string; order: number }[]

  // Audit
  createdAt: string                      // ISO UTC
  updatedAt: string
  createdByUserId: string | null
  updatedByUserId: string | null
}

/** Slim subset of `Event` returned by `GET /v2/association/events/{associationId}`
 *  (the list endpoint). Carries only the fields the listing row
 *  renders — see `docs/api/association-events-api-contract.md` §11.
 *
 *  Detail / edit flows fetch the full `Event` via `fetchEvent()`
 *  (the single-event endpoint). Splitting the shape keeps the list
 *  payload ~3 KB gzipped instead of ~10 KB and stops leaking
 *  director contact / payment config / tournament prose in list
 *  responses. */
export interface EventSummary {
  id: string
  guid: string
  /** Auto-generated, globally-unique URL handle (see `Event.slug`). Returned
   *  on the list read; powers the public share URL. Read-only. */
  slug?: string

  eventName: string
  /** Catalogue key — see the `Event.eventType` doc-comment above. */
  eventType: EventType | null
  avatarUrl: string | null
  eventStatus: EventStatus

  /** Backend-formatted "Apr 19 to May 24, 2026 (Eastern Time)". The
   *  short variant (`dateRangeLabelShort`) is detail-only. */
  dateRangeLabel: string

  sportsTypeName: string | null
  city: string | null
  state: string | null
  directorName: string | null

  /** Participation breakdown — same shape as `Event.teamCounts`.
   *  Listing UI sums pending + confirmed + waitlisted. */
  teamCounts: EventTeamCounts
  entryFee: number | null
  entryFeeDeadline: string | null         // YYYY-MM-DD (local)
  paymentRequired: boolean

  allowTeamRegistration: boolean
  registrationStatus: EventRegistrationStatus
  registrationOpensLabel: string | null
  registrationClosesLabel: string | null
}

// ── Custom fields (generalized, association-owned) ───────────────
// Admin-defined controls rendered dynamically on entity forms (events,
// divisions, games, team/umpire/player registrations, products…).
// Catalogue = `custom_field_definitions`, values = `custom_field_values`.
// See association-custom-fields-api-contract + association-events §4/§5.

// Entity surfaces a custom field can attach to. Stored as the snake_case key in
// `custom_field_definitions.entity_type` (VARCHAR). Shared catalogue — keep in
// lockstep with `CUSTOM_FIELD_ENTITY_TYPES` (src/api/customFields.ts), the
// backend config, and docs/system/shared-catalogues.md. Grows rarely.
export type CustomFieldEntityType = 'event' | 'division' | 'game' | 'team' | 'umpire' | 'player' | 'product'
// Control widget the renderer maps to. Stored as the key in `input_type`
// (VARCHAR). Closed set — adding one needs a CustomFieldsRenderer branch.
export type CustomFieldInputType = 'boolean' | 'single_select' | 'multi_select' | 'number' | 'text' | 'date' | 'textarea'

/** A custom-field DEFINITION (the control to render). `entityType` / `inputType`
 *  are the catalogue string keys (no tinyint codes). The trailing fields are
 *  only populated for the Settings manager (the render fetch omits them). */
export interface CustomFieldDefinition {
  id: string
  key: string
  label: string
  inputType: CustomFieldInputType
  /** Choices for `single_select` / `multi_select`; `[]` otherwise. */
  options: string[]
  required: boolean
  sortOrder: number
  /** Manager-only: which entity form this field belongs to. */
  entityType?: CustomFieldEntityType
  /** Manager-only: sport scope (`null` = all sports). */
  sportsTypeId?: string | null
  /** Manager-only: active flag (inactive definitions don't render on forms). */
  active?: boolean
}

/** Create/update input for a custom-field definition (Settings manager). */
export interface CustomFieldDefinitionInput {
  entityType: CustomFieldEntityType
  label: string
  inputType: CustomFieldInputType
  options: string[]
  required: boolean
  sortOrder: number
  sportsTypeId: string | null
  active: boolean
}

/** A custom-field VALUE as read back on an entity (for edit prefill). */
export interface CustomFieldValue {
  definitionId: string
  fieldKey: string
  label: string
  /** Wire string: "1"/"0" boolean · option · JSON array (multi) · raw. */
  value: string
}

/** Payload shape sent to `POST /v2/association/events` (create) and
 *  `PUT /v2/association/events/{id}` (update). Includes only writable
 *  fields — read-only computed fields (UTC mirrors, labels, audit,
 *  cached counters) are stripped server-side if present. */
export interface SaveEventPayload {
  eventName: string
  /** Catalogue key — see `EventType` union + `EVENT_TYPES_CATALOGUE`
   *  in src/api/events.ts. */
  eventType: EventType | null
  /** Filename (not URL) on write. The CDN URL is returned in
   *  `avatarUrl` on read. Empty string when no hero uploaded yet. */
  avatar: string | null

  address: string | null
  location: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  lat: string | null
  long: string | null

  /** camelCase on the wire (DB columns are `event_start_date` etc.).
   *  Required on create. */
  eventStartDate: string                        // YYYY-MM-DD
  eventEndDate: string
  eventStartTime: string | null                 // HH:MM:SS — null when allDay
  eventEndTime: string | null
  timeZone: string                       // IANA name
  allDay: boolean

  note: string | null
  reminder: string | null

  mediumId: string | null
  mediumName: string | null
  url: string | null
  color: string | null

  /** `'draft'` or `'published'` only on create. Transitions on
   *  update follow the lifecycle rules (see `EventStatus`). */
  eventStatus: EventStatus

  directorName: string | null
  directorEmail: string | null
  directorPhone: string | null
  mobCode: string | null

  entryFee: number | null
  refundPolicy: string | null
  tournamentFormat: string | null
  entryFeeDeadline: string | null        // YYYY-MM-DD (local)
  /** Pool-play guaranteed games count (string for free-form
   *  display like "3 games"). */
  poolPlayGuaranteed: string | null
  /** FK to the bracket-format catalogue. `bracketFormat` is the
   *  denormalized name and is READ-ONLY — server re-derives on
   *  read. Sending it on write is harmless; the server ignores it. */
  bracketFormatId: string | null
  poolPlayTime: string | null
  championshipTime: string | null
  bracketTime: string | null
  timeInterval: string | null

  sportsTypeId: string | null
  fieldConfigId: string | null

  allowTeamRegistration: boolean
  /** Local DATETIME (`YYYY-MM-DD HH:MM:SS`) in the event's TZ.
   *  Required when `allowTeamRegistration = true`. */
  registrationOpening: string | null
  paymentRequired: boolean
  paymentTerms: EventPaymentTerms | null
  partialPaymentType: EventPartialPaymentType | null
  partialPaymentValue: number | null
  allowOfflinePayment: boolean
  autoConfirmOnFullPayment: boolean
  autoConfirmOnPartialPayment: boolean

  // ── Added for the MatchGeni event wizard (optional/additive so the
  //    legacy EventFormModal payloads stay valid) ──
  /** `'in_person'` → address/geo populated; `'online'` → medium/url
   *  populated. See association-events §4/§5. */
  locationType?: 'in_person' | 'online'
  /** Event-default seed criteria → `event_seed_criteria`. Order = tie-break
   *  priority. `[]` / omitted = no event-level default. */
  seedCriteria?: { seedingCriteriaId: string; order: number }[]
  /** Custom-field values → `custom_field_values` (reconciled like
   *  `seedCriteria`). `value` is a wire string per the field's type. */
  customFields?: { definitionId: string; value: string }[]
}

/** Query params for `GET /v2/association/events/{associationId}`. */
export interface EventListParams {
  /** Event-local year (e.g. 2026). `'all'` skips the filter; when
   *  omitted, server picks the first non-past year that has events. */
  year?: number | 'all'
  /** When `true`, returns events whose `endAtUtc < UTC_TIMESTAMP()`.
   *  When `false`, returns upcoming + in-flight events. */
  pastEvents?: boolean
  /** Single-select event-type filter — one of the catalogue keys
   *  (`tournament` / `online_meeting` / `league` / `other`). Omit
   *  for no constraint. */
  eventType?: EventType
  /** Single-select lifecycle filter. Omit for no constraint. */
  eventStatus?: EventStatus
  /** When set, filters by the joined sport type. */
  sportsTypeId?: string
  /** Case-insensitive partial match on event name, type, city,
   *  state, and director name. */
  search?: string
  page?: number
  per_page?: number
  sort?: 'eventStartDate' | 'eventName' | 'createdAt'
  order?: 'asc' | 'desc'
}

/** Response shape from `GET /v2/association/events/{associationId}/years`. */
export interface EventYearsResponse {
  /** Distinct local-year values across non-deleted events, ascending. */
  years: number[]
  /** The earliest year whose events aren't all in the past. Falls
   *  back to the latest year when every event is in the past. Used
   *  by the listing UI to pre-select the Year filter. */
  defaultYear: number
}

/** Event entry rendered inside the "Events as Official" slide modal
 *  on the association users list. v1 uses mock data — see
 *  `src/api/officialEvents.ts`. */
export interface OfficialEvent {
  /** The event id (`events.id`). */
  id: string
  /** The `event_officials.id` for THIS user's grant on the event.
   *  Carried so the modal's Edit / Remove access buttons can call
   *  the event-scoped write endpoints in `matchgeni-officials-api-contract.md`
   *  §5 / §6 (PUT/DELETE `.../events/{eventId}/officials/{officialId}`)
   *  directly, without a second lookup. Optional only because the
   *  team-participation context (`participationNo` flow) reuses
   *  the same shape but doesn't carry a grant row. */
  officialId?: string
  /** Thumbnail image URL — mock uses the softball-field asset for
   *  every entry, real backend will return the event's hero image. */
  imageUrl: string
  /** Pre-formatted date range string (e.g. "Mar 8 to Mar 10, 2024 (Central Time)"). */
  dateRange: string
  /** Event name (e.g. "Bart Adams March Madness II"). */
  name: string
  /** City + state where the event is held (e.g. "Polk County, FL"). */
  location: string
  /** Subtitle shown under the location (e.g. "SSUSA - Softball (Slow Pitch) Tournament"). */
  subtitle: string
  /** Director full name. */
  director: string
  /** Event-scoped Full Control. When true, every event-level
   *  permission is implicitly granted regardless of `permissions`
   *  contents (presentation layer renders a single "Full Control"
   *  chip and ignores the array — but the array stays persisted so
   *  toggling Full Control off later restores prior selections). */
  fullControl: boolean
  /** Event-scoped permissions granted to the user this OfficialEvent
   *  payload was fetched for. Empty array AND `fullControl: false`
   *  = the user is rostered on the event but has no event-level
   *  powers. The list is per-(user, event) — the same user can have
   *  different permissions on different events. */
  permissions: EventPermissionKey[]
  /** Participation reference number (e.g. "PVG-179-R8G"). Only
   *  populated when the event is fetched in the context of a team's
   *  participation list (team-details page). User-scoped fetches
   *  leave this undefined. */
  participationNo?: string
  /** Status of this team's participation in this event. Only
   *  populated when fetched in the team-participation context. */
  participationStatus?: TeamParticipationStatus
  /** Submitted lineup for this team in this event. Same shape as
   *  the side-rail Event Lineup card on ParticipationV2 — starters
   *  + bench players. Only populated in the team-participation
   *  context; user-scoped event fetches leave this undefined. */
  lineupSummary?: LineupSummaryPlayer[]
  /** Parks (venues) the event runs at. Empty / undefined for
   *  single-park events; the access modal's scope picker disables
   *  the "Specific parks" mode when this list has < 2 entries. */
  parks?: Park[]
  /** Divisions the event hosts. Same disabled-mode rule applies
   *  to "Specific divisions" when the list has < 2 entries. */
  divisions?: Division[]
  /** Scope of the user's `manage_scoring` permission for this
   *  event. Only meaningful when `permissions` includes
   *  `'manage_scoring'`; otherwise the field is ignored on read. */
  scoringScope?: ScoringScope
}

/** Status of a team's participation in a specific event. Numeric
 *  codes from the backend map as:
 *    0 = initiated
 *    1 = pending_approval
 *    2 = confirmed
 *    3 = waitlisted
 *    4 = withdrawn
 *    5 = cancelled */
export type TeamParticipationStatus =
  | 'initiated'
  | 'pending_approval'
  | 'confirmed'
  | 'waitlisted'
  | 'withdrawn'
  | 'cancelled'

export interface SaveAssociationUserPayload {
  id?: string
  name: string
  email: string
  /** Optional on save — only the edit flow surfaces a status toggle.
   *  Invites always start active so the field is omitted there. */
  status?: AssociationUserStatus
  fullControl: boolean
  permissions: AssociationPermissionKey[]
}

// ============================================================
// MatchGeni — per-event admin "mode" that surfaces divisions,
// participation, scheduling, scoring, officials, etc.
// Routes:
//   /association/:slug/portal/events/:eventId/matchgeni
//   /association/:slug/portal/events/:eventId/matchgeni/officials
//   …other sub-pages land here. `:eventId` is the event's numeric
//   PK (string), NOT the guid — see `src/router.ts` for rationale.
// ============================================================

/** Aggregate counts shown along the top of the MatchGeni dashboard. */
export interface MatchGeniStats {
  playingFacilities: number
  eventUmpires: number
  eventOfficials: number
  activeGames: number
  /** Games whose scheduled start time has passed but which haven't
   *  started / completed yet. Surfaced in the matchgeni dashboard's
   *  left-column stats row so admins can spot scheduling slippage
   *  at a glance. */
  delayedGames: number
  /** Overall progress percentage (0–100). The dashboard tile renders
   *  this as "N%" with a small donut-style indicator. */
  overallProgressPercent: number
}

/** Per-phase status enums for the division-row pills. Each phase
 *  has its own valid set:
 *    - Pool / Brackets share the full lifecycle.
 *    - Seed can be `locked` (frozen after seeding) but never
 *      `in_progress` / `completed` (it's a one-shot operation).
 *  The wide union `EventTournamentPhaseStatus` keeps a single
 *  type for the shared tone-class helper. */
export type EventTournamentPoolStatus =
  | 'pending'
  | 'generated'
  | 'in_progress'
  | 'completed'
export type EventTournamentSeedStatus =
  | 'pending'
  | 'generated'
  | 'locked'
export type EventTournamentBracketStatus =
  | 'pending'
  | 'generated'
  | 'in_progress'
  | 'completed'
export type EventTournamentPhaseStatus =
  | EventTournamentPoolStatus
  | EventTournamentSeedStatus
  | EventTournamentBracketStatus

/** Child of `team_events` — one division / tournament inside an
 *  event. Mirrors the `event_tournaments` table in the production
 *  schema (sql-schema.md §12). v1 mock surfaces the listing slice. */
export interface EventTournament {
  id: string
  guid: string
  /** Display label (e.g. "Men's 65+ Division"). */
  tournamentName: string
  /** Pre-formatted date range (e.g. "May 12 to May 14, 2026"). */
  dateRangeLabel: string
  teamCount: number
  poolStatus: EventTournamentPoolStatus
  seedStatus: EventTournamentSeedStatus
  bracketsCount: number
  bracketsStatus: EventTournamentBracketStatus
  /** Optional per-bracket lifecycle statuses (index-aligned to the
   *  division's brackets). When present, the detail page renders each
   *  bracket with its own status (drives the Announce-result gating);
   *  otherwise every bracket inherits `bracketsStatus`. Mock/demo aid
   *  until the bracket list ships per-bracket status. */
  bracketStatuses?: BracketStatus[]
  /** Overall progress for this division (0–100). */
  progressPercent: number
  /** Division's `continuous_team_sr_no` setting — drives whether team
   *  serials run unbroken across pools. Optional until the division
   *  payload carries it; the Manage Team Pools modal defaults to `true`
   *  (matching the create-form default) when absent. */
  continuousTeamSrNo?: boolean
}

/** One participating team in the Manage Team Pools surface. Sourced
 *  from the event's joined-teams (`event_joined_team`), filtered by the
 *  division's age-group / rating restrictions. `assigned` (= a
 *  `tournament_teams` row exists) drives whether the team starts in a
 *  pool or in the unassigned "Available" column. */
export interface ManagePoolTeam {
  /** `event_joined_team` id (stable identity for assignment writes). */
  id: string
  /** Team display name. */
  name: string
  /** Secondary line — rating / age-group / city, pre-joined for display. */
  meta?: string
  /** Optional team logo. */
  imageUrl?: string
}

/** A pool within a division (`tournament_pools` row) plus its ordered
 *  member teams. The team order inside a pool is meaningful — it drives
 *  the serial numbering shown in the UI. */
export interface DivisionPool {
  /** `tournament_pools` id. Client-only pools (added but not yet saved)
   *  use a `new-*` placeholder id until the save assigns a real one. */
  id: string
  /** Display name ("Pool A" / "Pool 1"); editable. */
  name: string
  /** `true` for the auto-created default pool. */
  isDefault?: boolean
  /** Ordered member teams. */
  teams: ManagePoolTeam[]
}

/** Payload backing the Manage Team Pools modal: every eligible team for
 *  the division split into the already-pooled set (inside `pools`) and
 *  the unassigned set (`available`), plus whether the division keeps a
 *  single continuous serial sequence across pools. */
export interface DivisionPoolsData {
  /** Eligible teams not yet placed in any pool. */
  available: ManagePoolTeam[]
  /** Existing pools (first is the default). At least one always exists. */
  pools: DivisionPool[]
  /** Division's `continuous_team_sr_no` — when `true`, serials run
   *  unbroken across pools (Pool 1 = 1..n, Pool 2 continues n+1…);
   *  when `false`, each pool restarts at 1. */
  continuousSerial: boolean
  /** Whether the division restricts entry to specific age groups /
   *  ratings (the create-form "Teams" toggle). When `false`, all ages
   *  and ratings are allowed and `ageGroups`/`ratings` are empty. */
  restrictTeams: boolean
  /** Allowed age-group labels — empty when `restrictTeams` is false. */
  ageGroups: string[]
  /** Allowed rating labels — empty when `restrictTeams` is false. */
  ratings: string[]
}

/** Lifecycle of a single bracket (`tournament_brackets.status`):
 *  `pending` (created, no seeds) → `initiated` (seeds moved in) →
 *  `in_progress` (first game started) → `completed` (championship / IF
 *  game finished). `cancelled` is a terminal off-ramp (rain / other) — a
 *  cancelled bracket can't produce winners, so its teams are announced via
 *  their pool instead. See `matchgeni-division-api-contract.md` §5. */
export type BracketStatus = 'pending' | 'initiated' | 'in_progress' | 'completed' | 'cancelled'

/** Preset reason a bracket didn't complete as scheduled (+ free-text note).
 *  Stored so reporting can categorise non-completions. */
export type BracketCancelReasonCode = 'rain' | 'field_conditions' | 'time_curfew' | 'other'

/** A bracket cancellation record (the reason play was stopped). */
export interface BracketCancellation {
  reasonCode: BracketCancelReasonCode
  /** Optional free-text detail. */
  note?: string
  cancelledAt?: string
  cancelledBy?: string
}

/** How a final placement was set. `auto` = materialized from a
 *  bracket's final game when it completed; `manual` = admin-announced
 *  (pool-only divisions, co-champions, rain-shortened brackets). Both
 *  live in `event_tournament_standings` — reads never re-scan games. */
export type StandingSource = 'auto' | 'manual'

/** One final-placement (winner) row. Distinct from `DivisionStandingEntry`
 *  (the pool win/loss table) — this is the podium outcome. */
export interface StandingPlacement {
  /** 1 = champion, 2 = runner-up, 3 = third. Co-champions share rank 1. */
  rank: number
  /** Display label ("1st" / "2nd" / "3rd" / "Champions"). */
  rankLabel: string
  teamId?: string
  teamName: string
  imageUrl?: string
  /** Pre-joined gender / age-group / rating line (e.g. "Men's 50+ AA"). */
  teamMeta?: string
  /** City, ST. */
  location?: string
  /** True when this row is one of two shared rank-1 co-champions. */
  coChampion?: boolean
}

/** @deprecated Division-wide basis — superseded by the per-unit model
 *  (`StandingUnit`). Kept only for the legacy `SetWinnersModal`. */
export type StandingBasis = 'bracket' | 'pool' | 'none'

/** @deprecated A bracket/pool group of placements — superseded by
 *  `StandingUnit`. Kept only for the legacy `SetWinnersModal`. */
export interface StandingGroup {
  bracketId: string | null
  groupId?: string | null
  kind?: 'bracket' | 'pool'
  bracketName: string
  source: StandingSource
  placements: StandingPlacement[]
}

/** Which existing division entity a result unit references. A team is
 *  decided by the BRACKET it's selected into; otherwise by its POOL. We
 *  never invent a new grouping — `refId` is an existing bracket/pool id. */
export type StandingUnitKind = 'bracket' | 'pool'

/** Underlying play state of a unit's bracket/pool, surfaced in the
 *  announce UI so the admin understands why a result is/ isn't ready.
 *  `initiated` = bracket seeded but not started; `cancelled` = bracket
 *  stopped (rain/other) — its teams fall back to their pool. */
export type StandingUnitPlay =
  | 'not_started'
  | 'initiated'
  | 'in_progress'
  | 'complete'
  | 'cancelled'

/** Announce state of one unit. */
export type StandingUnitStatus = 'pending' | 'announced' | 'no_result'

/** One announceable result unit in a division — an existing bracket OR an
 *  existing pool. Pools and brackets (+ `bracket_teams`, team selection)
 *  are unchanged; this is a thin "final placements" overlay that points at
 *  them. A bracket unit covers its selected teams; a pool unit covers only
 *  its teams NOT claimed by any bracket (so a team is in exactly one
 *  unit). See `matchgeni-division-api-contract.md` §5. */
export interface StandingUnit {
  kind: StandingUnitKind
  /** The existing `bracketId` (kind `bracket`) or `poolId` (kind `pool`). */
  refId: string
  name: string
  teamCount: number
  playStatus: StandingUnitPlay
  source: StandingSource
  status: StandingUnitStatus
  /** Whether the admin may edit this unit's podium now. Bracket units are
   *  always read-only (auto on completion, otherwise status-only); pool
   *  units are editable (manual announce). */
  editable: boolean
  /** Set on a `cancelled` bracket unit — the reason play was stopped. The
   *  unit is informational (its teams are announced under their pool). */
  cancellation?: BracketCancellation
  placements: StandingPlacement[]
}

/** A division's final standings (winners) as a set of per-unit results
 *  (brackets + leftover-team pools). Backs the Winners panel + the
 *  Announce-result modal. No division-wide basis — each unit carries its
 *  own source/status. See `matchgeni-division-api-contract.md` §5. */
export interface DivisionStandings {
  divisionId: string
  /** Whether the division's play is finished (winners are meaningful). */
  complete: boolean
  /** At least one unit still needs the admin to announce winners. */
  needsManual: boolean
  units: StandingUnit[]
}

/** Payload for announcing/editing ONE unit's result (per-unit, incremental
 *  — the admin finalises units independently). */
export interface SetUnitStandingsPayload {
  kind: StandingUnitKind
  /** The existing bracket/pool id this result belongs to. Only pool units
   *  are announced manually; brackets are read-only (auto or status). */
  refId: string
  /** Declare this unit no-result (records no winners for it). */
  noResult?: boolean
  placements: { rank: number; teamId?: string; teamName: string; coChampion?: boolean }[]
}

/** Lightweight per-division row for the MatchGeni dashboard's division
 *  list. Returned by the **List Divisions** endpoint
 *  (`matchgeni-division-api-contract.md` §4): the division's config
 *  (all on the single `event_tournaments` row) plus two cheap
 *  compute-on-read counts (`teamCount` / `bracketCount`, indexed
 *  `LEFT JOIN ... COUNT ... GROUP BY tournament_id`).
 *
 *  Deliberately carries NO phase statuses, progress percent, or game
 *  count — those are high-churn aggregates (recomputed on every game
 *  end) and would force per-row multi-table joins for a list that can
 *  reach 50–60 rows. The division-detail page already renders the full
 *  pool/seed/bracket breakdown for one division at a time; the
 *  dashboard list stays a fast navigation-only surface. */
export interface MatchGeniDivisionSummary {
  id: string
  guid?: string
  /** Display label (e.g. "Men's 65+ Division"). */
  name: string
  /** Pre-formatted date range (e.g. "May 12 to May 14, 2026"). `""`
   *  when the division has no scheduled days yet. */
  dateRangeLabel?: string
  /** Plain `YYYY-MM-DD` boundaries (no TZ) — present for any future
   *  client-side sort/grouping; the row renders `dateRangeLabel`. */
  startDate?: string | null
  endDate?: string | null
  /** Confirmed teams assigned to the division — compute-on-read
   *  `COUNT(tournament_teams)`. */
  teamCount: number
  /** Brackets created for the division — compute-on-read
   *  `COUNT(brackets)`. `0` before any bracket is initiated. */
  bracketCount: number
  /** Pool-play game guarantee (1–5). `null` when the division inherits
   *  the event default (custom format off). */
  poolPlayGuarantee?: number | null
  /** Human-readable bracket-format label (e.g. "Single Elimination").
   *  `null` when inheriting the event default. */
  bracketFormat?: string | null
  /** Pool-play tie-breaker order (e.g. "Win %, head-to-head, run
   *  differential"). `null` when the division has no pool play / uses
   *  the event default. */
  poolTieBreaker?: string | null
  /** Per-bracket summary for the list row's Brackets section. Empty /
   *  absent before any bracket is created. */
  brackets?: MatchGeniDivisionBracketSummary[]
}

/** One bracket's summary line in the division-list row. */
export interface MatchGeniDivisionBracketSummary {
  name: string
  teamCount: number
  /** Format label (e.g. "Single Elimination"). */
  format: string
  /** Lifecycle status label shown as a badge (e.g. "Completed",
   *  "In progress", "Initiated"). */
  status?: string
  /** Badge/dot tone for `status` (bracket-state palette). */
  statusTone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger'
}

// ── Division Detail page (matchgeni-division-api-contract.md §5 + §6) ──────
// §5 (detail shell) and §6 (reusable teams roster) are fetched SEPARATELY —
// brackets carry only LIGHT team identity (id/name/avatar) so they render
// standalone; the full roster + seed + pool-play record lives on §6.

/** §5 — the division's own row + denormalized labels for the detail shell. */
export interface MatchGeniDivisionInfo {
  id: string
  guid?: string
  tournamentName: string
  startDate: string | null
  endDate: string | null
  /** Pre-formatted range label (weekday + month + year). */
  dateRangeLabel: string
  customFormat: boolean
  poolPlayGuarantee: number | null
  bracketFormatId: string | null
  bracketFormatName: string | null
  useEventSeed: boolean
  seedCriteria: DivisionSeedCriterion[]
  useEventFieldConfig: boolean
  fieldConfigId: string | null
  fieldConfigName: string | null
  poolPlayTime: number | null
  bracketTime: number | null
  championshipTime: number | null
  continuousTeamSrNo: boolean
  restrictTeamsEntry: boolean
  /** Denormalized restriction labels (empty when entry is open). */
  ageGroups: string[]
  ratings: string[]
  notes: string
  teamCount: number
  bracketCount: number
}

/** §5 — pool meta (no roster; the team→pool mapping lives on §6 via `poolId`). */
export interface MatchGeniDivisionPool {
  id: string
  name: string
  /** Seeds (teams) created in the pool — `COUNT` of its pool-team rows. */
  seedCount: number
}

/** §5 — light team identity inside a bracket (no seed / no win-loss — those
 *  are pool-play facts on `MatchGeniDivisionTeam`). `id` cross-links to §6. */
export interface MatchGeniBracketTeamLite {
  id: string
  name: string
  avatarUrl: string | null
}

/** §5 — one bracket on the detail page. */
export interface MatchGeniDivisionBracket {
  id: string
  guid?: string
  divisionId: string
  name: string
  description: string | null
  bracketFormatId: string | null
  bracketFormatName: string | null
  /** Lifecycle KEY (not display text) — map via `src/lib/bracketStatus.ts`. */
  status: BracketStatus
  teams: MatchGeniBracketTeamLite[]
}

/** §5 response — the division detail-page shell. */
export interface MatchGeniDivisionDetail {
  division: MatchGeniDivisionInfo
  pools: MatchGeniDivisionPool[]
  brackets: MatchGeniDivisionBracket[]
}

/** §6 — one team in the division's roster, with pool-play standings. The
 *  reusable resource (detail Pool Play, Participating Teams, portal/client). */
export interface MatchGeniDivisionTeam {
  id: string
  name: string
  avatarUrl: string | null
  gender: 'Male' | 'Female' | 'Coed'
  ageGroup: string
  rating: string
  city: string
  state: string
  /** Seed within the division — `null` until seeding is generated. */
  seed: number | null
  /** Pool membership (`null` until assigned). */
  poolId: string | null
  poolName: string | null
  /** Pool-play win/loss/tie record — always present, defaults to 0-0-0.
   *  Bracket results are NOT counted here (those are §7 standings). */
  record: { wins: number; losses: number; ties: number }
}

/** Daily weather strip shown on the Playing Facility card. Reuses the
 *  same shape as `TeamEventForecastDay` but lives separately so the
 *  MatchGeni copy can evolve independently. */
export interface MatchGeniForecastDay {
  /** ISO date `YYYY-MM-DD`. */
  date: string
  /** Display label, e.g. "Tue, May 12". */
  label: string
  iconUrl?: string
  conditionText?: string
  high: number
  low: number
}

/** Single-day playing-window for the facility's schedule list. */
export interface MatchGeniScheduleDay {
  /** ISO date `YYYY-MM-DD`. */
  date: string
  /** Display label, e.g. "Tue May 12". */
  label: string
  /** Pre-formatted window, e.g. "08:30 AM - 04:00 PM". */
  windowLabel: string
}

/** Playing facility (park) selected for the event. The dashboard
 *  right column now renders ALL facilities as a horizontal carousel
 *  (first card ~80% width, next peeks in ~20% to telegraph
 *  scrollability) — see `MatchGeniDashboard.facilities` and the
 *  `.matchgeni__facility-carousel` markup in `MatchGeniDashboardView`. */
export interface MatchGeniPlayingFacility {
  id: string
  /** Venue display name (e.g. "Walnut Creek Softball Complex"). */
  name: string
  /** Single-line street + city/state (e.g. "1201 Sunnybrook Rd, Raleigh, NC 27610, USA"). */
  address: string
  /** Division names currently scheduled at this facility. Drives
   *  the "Divisions Playing" chip row. */
  divisionsPlaying: string[]
  /** Total games scheduled here (display only). */
  gamesScheduled: number
  /** Field labels (e.g. "Field 1", "Field 2", …). */
  fieldsInUse: string[]
  forecast: MatchGeniForecastDay[]
  schedule: MatchGeniScheduleDay[]
}

/** Teams-participating summary on the dashboard's right column.
 *  Four buckets matching the `participation_status` enum
 *  (`pending` / `confirmed` / `waitlisted` / `withdrawn`) so the
 *  dashboard renders one stat tile per status. `total` is the
 *  sum of the four buckets — kept on the wire so the consumer
 *  doesn't have to add client-side. */
export interface MatchGeniTeamsSummary {
  total: number
  pending: number
  confirmed: number
  waitlisted: number
  withdrawn: number
}

// ──────────────────────────────────────────────────────────────
// MatchGeni Scheduler — types for the drag-drop game-scheduler
// sub-page (`/portal/events/:eventId/matchgeni/scheduler`).
//
// Left column: division picker + pool/bracket tabs + draggable list
// of games for the selected division/phase.
// Right column: park picker + date strip + time × field grid where
// each cell is a drop target.
// ──────────────────────────────────────────────────────────────

/** A division shown in the scheduler's left-column picker. Lighter
 *  shape than `EventTournament` — just the fields the scheduler
 *  needs to label + filter games. */
export interface SchedulerDivision {
  id: string
  /** Display name — e.g. "divsion 7 teams second" */
  name: string
  /** Pre-formatted date window for the division (e.g.
   *  "Apr 29 – May 3"). Shown next to the name in the bracket-preview
   *  header. Sourced from the §9 resources division's
   *  `dateRangeLabelShort`; absent when the division has no games. */
  dateRangeLabel?: string
  /** Number of teams in the division. Drives the info banner copy
   *  ("7 teams played 2 games each" / "7 Teams - 3 Game Guarantee"). */
  teamCount: number
  /** Pool / bracket phase available — drives which tabs are enabled
   *  in the left column. */
  hasPool: boolean
  hasBracket: boolean
  /** Pool phase: how many round-robin rounds were generated.
   *  `1` = single round robin, `2` = double, etc. */
  poolRoundRobinCount: number
  /** Pool phase: games each team plays in the pool. With a single
   *  round robin and 7 teams, this is 6 (everyone plays everyone
   *  else once). The info banner surfaces this verbatim. */
  poolGamesPerTeam: number
  /** Pool phase lifecycle — drives the status pill in the scheduler's
   *  pool info banner (mirrors the division-detail banner). */
  poolStatus: 'pending' | 'generated' | 'in_progress' | 'completed' | 'locked'
  /** Seed tie-breaker label shown in the pool banner's sub-line
   *  ("Tie breaker - {…}"), matching the division-detail banner. */
  tieBreakerText: string
  /** Bracket phase: minimum games a team is guaranteed to play in
   *  the bracket. Drives the bracket info banner ("N Teams - M
   *  Game Guarantee"). */
  bracketGameGuarantee: number
  /** Bracket phase: how many separate brackets the division runs.
   *  Most divisions ship with `1`; complex events split into
   *  Gold / Silver / Bronze brackets, etc. Drives the bracket
   *  pager ("Bracket {n} of {total}"). */
  bracketCount: number
  /** Bracket phase: display name of each bracket in the order
   *  the pager steps through them. Length should match
   *  `bracketCount`. The bracket info banner shows the active
   *  bracket's name on its title line. */
  bracketNames: string[]
  /** Bracket phase: lifecycle status of each bracket, indexed in step
   *  with `bracketNames`. Drives the status dot in the scheduler's
   *  bracket info banner. */
  bracketStatuses: BracketStatus[]
}

/** A single game in the scheduler — pool or bracket. Renders as a
 *  draggable card in the left column. Carries enough scheduling
 *  state for the card to show its current slot + an "Unlink" affordance
 *  when scheduled. */
export interface SchedulerGame {
  id: string
  divisionId: string
  /** Park id the game is scheduled at. `null` when the game is
   *  still unscheduled (no park assigned yet). Distinct from
   *  `scheduledFieldLabel` which is the human-readable field
   *  string — `parkId` is the structured id needed for
   *  permission-scope filtering (e.g. the scoring page narrows
   *  the visible list to the caller's `scoringScope.parkIds`). */
  parkId: string | null
  /** `'pool'` for round-robin games, `'bracket'` for elimination games. */
  type: 'pool' | 'bracket'
  /** Display label for the game header — "Pool 1" / "G4" / etc. */
  label: string
  /** Display label for each side — "#6: GENESIS/ONYX/BG" / "#4: G2G" /
   *  "Winner of G11" / "Loser of G2". `null` when the slot isn't yet
   *  filled (bracket games that depend on earlier-round outcomes). */
  team1Label: string | null
  team2Label: string | null
  /** Scheduled-slot fields — populated when the game has been
   *  dropped onto a grid cell. `null` when the game is still in the
   *  unscheduled pool. */
  scheduledDate: string | null
  scheduledTime: string | null
  scheduledFieldLabel: string | null
  /** Current game status — drives the status badge rendered on the
   *  field-grid + scheduler cells. Optional in v1 because the
   *  scheduler payload doesn't carry it yet (mock fills in random
   *  values for demo); when backend ships, this becomes required
   *  with `'scheduled'` as the default for not-yet-started games. */
  status?: 'scheduled' | 'live' | 'delayed' | 'final'
  /** Running scores for each team. Present when the game has
   *  STARTED — `'live'` / `'delayed'` games show their current
   *  in-progress score, `'final'` games show the closing score.
   *  Absent (`undefined`) for `'scheduled'` games so the cell can
   *  cleanly skip the score render instead of showing `0–0`. */
  team1Score?: number
  team2Score?: number
  /** Per-inning run totals for each team. Index 0 = inning 1.
   *  Present alongside `team1Score`/`team2Score` for started
   *  games; absent for `'scheduled'` games. Drives the line-score
   *  table rendered in the field-grid game-details drawer. */
  team1InningScores?: number[]
  team2InningScores?: number[]
  /** Reason text for `status: 'delayed'` games — e.g. "Rain",
   *  "Lightning in area", "Late team arrival". Rendered next to
   *  the Delayed badge on the game-details drawer. Absent for
   *  non-delayed statuses. */
  delayReason?: string
  /** Locked flag — only meaningful when `status === 'final'`. A
   *  locked final game is "frozen": no scoring controls render in
   *  the game-details drawer (no Score Game / Upload / overflow
   *  actions), only the Unlock affordance. Tournament admins flip
   *  this AFTER the final score is confirmed to prevent late edits.
   *  Defaults to `false` / `undefined` for unlocked games. */
  locked?: boolean
  /** Duration of the game in minutes. When absent, consumers fall
   *  back to `SchedulerPark.defaultGameDurationMinutes` (and then to
   *  90 if that's also absent — matches the legacy fixed-slot model).
   *  Stored PER-GAME so historical/locked games keep their actual
   *  played duration even after the event's default duration changes
   *  mid-day (the canonical rain-delay scenario where remaining
   *  games shrink from 90 → 60 but already-played games stay 90). */
  durationMinutes?: number
  /** Official TIME LIMIT for the game, in minutes — distinct from
   *  `durationMinutes` (the grid time SLOT). The time limit is the
   *  regulation length assigned per game type at the EVENT level
   *  (e.g. pool 65 / bracket 70 / championship 80) and is what the
   *  live-scoring surface uses to compute "remaining" / "over time".
   *  Each game copies it from the event at creation. `durationMinutes`
   *  by contrast is purely how much room the game occupies on the
   *  schedule grid (and can be reslotted during a rain-pivot without
   *  changing the regulation time limit). When absent, consumers fall
   *  back to the event/type default. */
  timeLimitMinutes?: number
  /** Whether this game's matchup (the two teams) can be edited. Pool games
   *  are always editable. Bracket games are editable ONLY for the initial
   *  round (their teams come straight from seeds); later-round games derive
   *  their teams from earlier outcomes ("Winner of G3") and can't be hand-
   *  set. The mock marks round-1 bracket games `true`; absent ⇒ treat as
   *  `type === 'pool'`. */
  matchupEditable?: boolean
}

/** Actions available from a game card's options (kebab) menu. Shared by the
 *  scheduler + division-detail cards via `GameOptionsMenu`. Which subset shows
 *  is gated by game status + the host context (see `GameOptionsMenu`). */
export type GameMenuAction =
  | 'edit-matchup'
  | 'game-notes'
  | 'assign-umpires'
  | 'unschedule'

/** A scheduled break / blocked-time block on a park's day schedule.
 *  Examples:
 *    - Lunch (12:30 PM for 30 min, scope='park') — blocks every
 *      field on the date.
 *    - Rain delay (2:00 PM for 45 min, scope='park') — same.
 *    - Field 2 maintenance (10:00 AM for 60 min, scope='field',
 *      fieldName='Field 2') — only blocks the named field column.
 *
 *  Breaks render as striped blocks in the field grid (write surface
 *  on the scheduler, read-only on the field-grid sub-page). A break
 *  blocks drop / resize targeting any overlapping time on its
 *  affected field(s); `findConflicts` enforces this. */
export interface SchedulerBreak {
  id: string
  /** `YYYY-MM-DD` — breaks are per-day, not recurring. */
  date: string
  /** `HH:MM` 24-hour anchor. Half-hour snap on creation. */
  startTime: string
  /** Length of the break in minutes — multiple of the
   *  `ROW_GRANULARITY_MINUTES` axis grain (30). */
  durationMinutes: number
  /** Optional display label — "Lunch", "Rain delay", "Field maint.".
   *  When absent, renders as "Break". */
  label?: string
  /** `'park'` — full-width band across every field column on the
   *  date (the common case for lunch / rain delays).
   *  `'field'` — single field column (e.g. one field rained out
   *  while neighbors keep playing). */
  scope: 'park' | 'field'
  /** Required when `scope === 'field'`. Matches the
   *  `SchedulerParkField.name` of the affected field. */
  fieldName?: string
}

/** A field inside a park that the event is using. */
export interface SchedulerParkField {
  id: string
  /** Display label — "Field 1" / "Field 2" / "F1" / "F2". */
  name: string
}

/** A day on the park's schedule — same date may appear in multiple
 *  parks if a multi-park event runs concurrent days. */
export interface SchedulerParkDay {
  /** `YYYY-MM-DD`. */
  date: string
  /** Compact label for the date strip — "Wed", "29", "Apr" or
   *  "Wed 29 Apr" depending on layout. Server-formatted so the UI
   *  doesn't repeat TZ math. */
  weekdayLabel: string
  dayLabel: string
  monthLabel: string
  /** Per-day scheduling window (`HH:MM` 24-hour). When present, the
   *  calendar axis for THIS date uses these instead of the park-level
   *  `dayStartTime`/`dayEndTime` — sourced from the §9 resources
   *  `schedule[]` entry, where each day can differ. Falls back to the
   *  park window when absent. */
  startTime?: string
  endTime?: string
}

/** One row in the time × field grid — generated server-side from
 *  the event's time-slot interval + the park's start/end times for
 *  the selected day. */
export interface SchedulerParkSlot {
  /** `HH:MM` (24-hour). The grid sorts on this. */
  startTime: string
  /** Display label — "08:00 AM" / "09:30 AM". */
  label: string
}

/** A park used by the event, with the fields the event books + the
 *  per-day schedule the scheduler grid renders. */
export interface SchedulerPark {
  id: string
  /** Display name — "park no.1". */
  name: string
  /** Pre-joined "City, ST" for the toolbar location line. `''` when the
   *  park has no city/state on file. */
  location?: string
  fields: SchedulerParkField[]
  /** Days this park hosts games. The date strip is keyed off this
   *  list — days NOT in the schedule are NOT rendered. */
  days: SchedulerParkDay[]
  /** Calendar-style scheduling window for the park (applies to every
   *  day in `days[]`). `HH:MM` 24-hour. The visual time axis paints
   *  hour-aligned labels from `floor(dayStartTime → hour)` to
   *  `ceil(dayEndTime → hour)`; the portion of the axis that falls
   *  OUTSIDE `[dayStartTime, dayEndTime]` renders as a blocked-band
   *  (no drop targets, "Outside park hours" tooltip).
   *  Per-day overrides are a v2 extension. */
  dayStartTime: string
  /** `HH:MM` 24-hour. See `dayStartTime`. */
  dayEndTime: string
  /** Default per-game duration in minutes — used when a
   *  `SchedulerGame` doesn't carry its own `durationMinutes`. The
   *  bulk "Reduce remaining games" modal mutates this for unscheduled
   *  / not-yet-played games on a date; locked + final games keep
   *  their stored duration. */
  defaultGameDurationMinutes: number
  /** Park's day schedule blocks — lunch / rain delays / field
   *  maintenance. Empty / absent when the park has none today.
   *  Filtered to the active date by callers before passing to
   *  `MatchGeniFieldGrid` via the `parkBreaks` prop. */
  breaks?: SchedulerBreak[]
  /** @deprecated Retained ONE release for back-compat with the old
   *  fixed-slot rendering. The new calendar axis derives positions
   *  from `dayStartTime` / `dayEndTime` directly. Slot strings are
   *  still populated by the mock so legacy consumers don't break;
   *  delete after backend ships the new shape. */
  slots: SchedulerParkSlot[]
}

/** Aggregate scheduler payload — one fetch returns everything the
 *  view needs to render the left + right columns for an event.
 *  Future paginate-by-division if the catalogue grows beyond a few
 *  hundred games. */
export interface MatchGeniSchedulerPayload {
  divisions: SchedulerDivision[]
  games: SchedulerGame[]
  parks: SchedulerPark[]
  /** Event-level default game-slot length (minutes) — the baseline in
   *  the duration resolution chain (game → park → event → fallback).
   *  Parks override it (`SchedulerPark.defaultGameDurationMinutes`) and
   *  individual games override the park. Mocked until the event-settings
   *  UI/endpoint ships. */
  eventDefaultGameDurationMinutes?: number
}

// ──────────────────────────────────────────────────────────────
// Bracket model — normalized, READ-ONLY shape consumed by the
// reusable `MatchGeniBracket` renderer (scheduler preview, division
// info, public pages). Translated from the legacy `BracketsView`:
// the operational concerns (umpire/game-action modals, scheduling,
// API fetching) are intentionally NOT modeled here — a previewer
// only needs to draw the tree. When the bracket API ships, an
// adapter maps the wire payload (source_team JSON + game rows) into
// this shape; the renderer never touches raw API data.
// ──────────────────────────────────────────────────────────────

/** One side of a match. `name` is the resolved team name, or a
 *  derived placeholder ("Winner of G3" / "Loser of G2" / "Seed 4")
 *  when the slot isn't filled yet. */
export interface BracketTeam {
  name: string
  /** Seed label shown in the leading seed chip (e.g. `4`). Absent
   *  for game-sourced slots. */
  seed?: string | number
  /** Runs/score once the game has started; `null`/absent before. */
  score?: number | null
  /** Highlights the winning side (only meaningful for finished games). */
  isWinner?: boolean
  /** Strikethrough — legacy "not needed" loser-bracket slot. */
  strikethrough?: boolean
}

/** Display status of a bracket game. Mirrors the scheduler/field-grid
 *  status vocabulary plus `not_needed` (bracket-only). */
export type BracketGameStatus =
  | 'scheduled'
  | 'live'
  | 'delayed'
  | 'final'
  | 'not_needed'

/** A single match box in the tree. Layout fields (`top`/`height`/
 *  `left`) are populated by `computeBracketLayout` — they're absent
 *  on the authored/wire shape. */
export interface BracketMatch {
  id: string
  /** Header label — "G4" / "WF" / "Grand Final". */
  gameName: string
  /** 1-based round index within the section. */
  roundNumber: number
  /** 1-based slot within the round (drives round-1 vertical order). */
  position: number
  team1: BracketTeam
  team2: BracketTeam
  status: BracketGameStatus
  /** ids of the (up to 2) matches that feed this one — drives both
   *  the connector lines and the center-between-feeders positioning.
   *  Omit for round-1 matches. May reference matches in another
   *  section (e.g. a loser-bracket match fed by a winner-bracket
   *  game); cross-section connectors are drawn when both ends resolve. */
  feederIds?: string[]
  /** The "championship if necessary" game (legacy game 999 /
   *  `bracket_type: 'grand_final_if_necessary'`). Rendered with a
   *  dashed box + dotted connector since it's only played when the
   *  loser bracket forces a decider. */
  ifNecessary?: boolean
  delayedReason?: string
  comments?: string
  /** Pre-formatted assignment info (read-only display). */
  assignedTime?: string
  assignedDateLabel?: string
  assignedFieldName?: string
  umpireName?: string
  umpireCount?: number
  /** ── layout (filled by computeBracketLayout, in canvas px) ── */
  top?: number
  left?: number
  height?: number
}

export type BracketSectionKind = 'single' | 'winner' | 'loser' | 'grandFinal'

/** A column-group of rounds. Single-elim has one section; double /
 *  3-game-guarantee have winner + loser (+ grandFinal). */
export interface BracketSection {
  kind: BracketSectionKind
  /** Optional banner label ("Winner Bracket" / "Loser Bracket"). */
  label?: string
  /** `rounds[r]` = matches in round r, sorted by `position`. */
  rounds: BracketMatch[][]
}

/** A complete bracket ready to render. */
export interface BracketModel {
  id: string
  name: string
  /** Format label for the header (e.g. "Double Elimination"). */
  format?: string
  teamCount?: number
  gameCount?: number
  type: 'single' | 'double' | '3gg'
  sections: BracketSection[]
  /** Podium (shown once every game is final). */
  winner?: { name: string } | null
  runnerUp?: { name: string } | null
  thirdPlace?: { name: string } | null
}

/** Aggregate MatchGeni dashboard payload — fetched on the dashboard
 *  page in one call. Listing of divisions paginates separately if
 *  the catalogue grows; v1 returns up to 50 inline. */
export interface MatchGeniDashboard {
  stats: MatchGeniStats
  /** Event identity row used by the page header. */
  event: Pick<Event, 'id' | 'guid' | 'eventName' | 'dateRangeLabel' | 'timeZone' | 'eventStatus'>
  tournaments: EventTournament[]
  teamsSummary: MatchGeniTeamsSummary
  /** All playing facilities the event books. Rendered as a
   *  horizontal carousel in the dashboard's right column —
   *  first card takes the bulk of the width, subsequent cards
   *  peek in to telegraph there are more to scroll to. Empty
   *  array when the event has no parks yet. */
  facilities: MatchGeniPlayingFacility[]
}

/** Per-event grant row — the `event_officials` row joined to the
 *  underlying `association_users.user_id → users.id` for display.
 *  Wire shape matches `docs/api/matchgeni-officials-api-contract.md` §1. */
export interface EventOfficial {
  id: string
  eventId: string
  associationUserId: string
  userId: string

  name: string
  email: string
  avatarUrl?: string

  fullControl: boolean
  permissions: EventPermissionKey[]
  /** Optional scope when `manage_scoring` is in `permissions`.
   *  `null` on the wire = unrestricted. */
  scoringScope: ScoringScope | null

  createdAt: string
  updatedAt: string
  /** Inviter id (only populated for grants created via invite). */
  createdByUserId: string | null
}

/** Query params accepted by
 *  `GET /v2/association/events/{associationId}/{eventId}/officials`. */
export interface EventOfficialsListParams {
  search?: string
  /** When set, returns only grants whose `permissions[]` contains
   *  the key (or whose `fullControl = true`). */
  permission?: EventPermissionKey
  sort?: 'name' | 'createdAt'
  order?: 'asc' | 'desc'
  page?: number
  per_page?: number
}

/** A umpire assigned to an event (`event_umpires` row joined to the
 *  user). Backs the MatchGeni Event Umpires roster page. Umpires carry
 *  no per-event permissions / scoping (unlike officials) — they're a
 *  flat roster the admin curates, with games assigned to them on the
 *  schedule. */
export interface EventUmpire {
  id: string
  eventId: string
  associationUserId: string
  userId: string

  name: string
  email: string
  avatarUrl?: string
  /** Contact phone, when on file. */
  phone?: string
  /** Count of games this umpire is assigned to on the schedule
   *  (compute-on-read from `tournament_games.umpire_id`). */
  gamesAssigned: number

  createdAt: string
}

/** A umpire registered at the association level — the pool of people
 *  who can be added to an event's umpire roster. Sourced from the
 *  association's umpire registrations (NOT the general association
 *  users list). Backs the "Add Umpire" picker. */
export interface AssociationUmpire {
  id: string
  name: string
  email: string
  avatarUrl?: string
  phone?: string
}

/** Query params accepted by
 *  `GET /v2/association/events/{associationId}/{eventId}/umpires`. */
export interface EventUmpiresListParams {
  search?: string
  sort?: 'name' | 'createdAt'
  order?: 'asc' | 'desc'
  page?: number
  per_page?: number
}

/** Softball umpire crew roles a game can be staffed with. Order is
 *  the display order in the assign popover + the fill order when an
 *  umpire is dropped onto a game (first open role). */
export const UMPIRE_ROLES = ['Plate', '1st Base', '3rd Base', 'Field'] as const
export type UmpireRole = (typeof UMPIRE_ROLES)[number]

/** One umpire assigned to a game in a specific crew role. A game can
 *  carry several (e.g. plate + base umpires), so assignments are
 *  stored as a list per game (`tournament_game_umpires` junction). */
export interface GameUmpireAssignment {
  role: UmpireRole
  umpireId: string
}

/** Payload sent to POST (add) an umpire to an event. */
export interface AddEventUmpirePayload {
  associationUserId: string
  name: string
  email: string
  avatarUrl?: string
  phone?: string
}

/** Payload sent to POST (create) / PUT (update) the per-event grant. */
export interface SaveEventOfficialPayload {
  /** Required on create; ignored on update (PUT can't move a grant
   *  between users — revoke + re-create instead). */
  associationUserId?: string
  fullControl: boolean
  permissions: EventPermissionKey[]
  scoringScope: ScoringScope | null
}

/* ─────────────────────────────────────────────────────────────────
   Association Reports
   ─────────────────────────────────────────────────────────────── */

/** Game-type categories surfaced in the Event Summary report. Drives
 *  the secondary sort within a division-and-date bucket (pool play
 *  rows precede bracket rows on the same date). The catalogue is
 *  intentionally minimal — the backend may emit more granular game
 *  types (e.g. semi-final / championship), but the report only cares
 *  about the pool-vs-bracket axis. Unknown values are treated as
 *  `bracket` for sorting (i.e. land after pool play). */
export type ReportGameType = 'pool' | 'bracket'

/** One row of the Event Summary report. Each row represents a single
 *  game between two teams, with the snapshot stats both teams
 *  produced (score + home runs). External registration numbers are
 *  the association's bookkeeping ids (`team_id_id` on the wire) used
 *  in printed brackets and roster sheets. */
export interface EventSummaryReportRow {
  /** Stable id for the row — used as the Vue list key. */
  id: string
  /** Division the game falls under. */
  divisionName: string
  /** Display name / id of the game (e.g. "Game 12", "Pool A-1"). */
  gameName: string
  /** Local game date — ISO-8601 YYYY-MM-DD. */
  gameDate: string
  /** Local game time — HH:MM:SS (24-hour). */
  gameTime: string
  /** Pool vs bracket bucket — drives the within-date sort. */
  gameType: ReportGameType
  /** Team 1 — external association-issued registration number. */
  team1RegNo: string
  team1Name: string
  team1Score: number | null
  team1HR: number | null
  /** Team 2 — external association-issued registration number. */
  team2RegNo: string
  team2Name: string
  team2Score: number | null
  team2HR: number | null
}

// ── Public event page ────────────────────────────────────────────
// Read-only, unauthenticated event showcase at /public/event/:slug.
// Self-contained display shapes (assembled from a mock aggregator);
// see `src/api/publicEvent.ts` + `docs/api/matchgeni-public-event-api-contract.md`.

/** Registration / countdown panel. */
export interface PublicEventRegistration {
  /** Whether registration is still open (drives CTA enabled vs "closed"). */
  open: boolean
  /** ISO datetime the window closes — feeds the live countdown. */
  deadline: string
  /** Pre-formatted close line, e.g. "Friday, April 12, 2026 at 11:59PM Central Time". */
  deadlineLabel: string
  /** Display entry fee, e.g. "$500". */
  feeLabel: string
  /** Remaining spots, when capped. */
  spotsLeft?: number
  /** Where the Register CTA points (parent-site registration flow). */
  registerUrl?: string
}

/** The icon-row "Event details" container. */
export interface PublicEventDetails {
  /** e.g. "3.3K people following". */
  followersLabel: string
  /** e.g. "SSUSA - Softball (Slow Pitch) Tournament". */
  sportType: string
  directorName: string
  directorPhone?: string
  directorEmail?: string
  /** e.g. "$500". */
  entryFeeLabel: string
  /** e.g. "Fri, Apr 14, 2026". */
  entryDeadlineLabel: string
  umpires: string[]
  /** e.g. "RR = 65 + open inn, Bracket = 70 + open inn, Championship = 80 + open inn". */
  timeLimit: string
  /** e.g. "Head to Head, W/L, Runs Differential". */
  seedCriteria: string
  /** e.g. "3 games Round Robin to seed, Double Elimination bracket". */
  format: string
  /** Longer blurb revealed by "See more". */
  description?: string
  /** Free-text event fields revealed by "See more". */
  tournamentFormat?: string
  refundPolicy?: string
  reminder?: string
  eventNotes?: string
}

export interface PublicDivisionTeam {
  teamName: string
  teamMeta?: string
  location?: string
  seed?: number
  wins?: number
  losses?: number
  imageUrl?: string
}
export interface PublicDivisionPool {
  id: string
  name: string
  teams: PublicDivisionTeam[]
}
export interface PublicDivisionBracketChip {
  id: string
  name: string
  format: string
  status: BracketStatus
  teamCount: number
  /** Seeded teams feeding the bracket (for the rail's avatar stack). */
  teams: { teamName: string; imageUrl?: string }[]
}
export interface PublicDivisionGame {
  id: string
  label: string
  team1: string
  team2: string
  /** ISO date `YYYY-MM-DD`. */
  date: string
  time?: string
  field?: string
  park?: string
  status?: 'scheduled' | 'live' | 'final' | 'delayed'
  team1Score?: number
  team2Score?: number
}
export interface PublicDivision {
  id: string
  name: string
  dateRangeLabel?: string
  teamCount: number
  brackets: PublicDivisionBracketChip[]
  pools: PublicDivisionPool[]
  games: PublicDivisionGame[]
  /** Pool-play summary shown in the timeline header — mirrors the admin
   *  division-detail "Pool Play" header (status pill + format + tie
   *  breaker). Optional; the panel renders defensively. */
  poolStatus?: 'scheduled' | 'in_progress' | 'completed'
  poolPlayText?: string
  tieBreaker?: string
}

/** The full public event page payload (one slug → one event). */
export interface PublicEventPage {
  slug: string
  eventName: string
  associationName: string
  /** Short tournament-type label shown in the header sub-line. */
  tournamentType: string
  /** Pre-formatted date range, e.g. "Apr 7 – Apr 12, 2026". */
  dateRangeLabel: string
  location?: string
  /** Optional event cover image for the hero. May be uploaded 1:1 or 16:9
   *  — rendered `object-fit: cover` in a fixed-height banner. Absent → a
   *  themed gradient banner. */
  coverImageUrl?: string
  /** Short event type label (e.g. "Tournament", "League"). */
  eventType?: string
  registration: PublicEventRegistration
  details: PublicEventDetails
  divisions: PublicDivision[]
  /** Optional extras reusing the dashboard cards. */
  sponsors?: EventSponsor[]
  hotels?: EventHotel[]
  /** Playing facilities (parks) shown in the Venue Guide — read-only,
   *  name + location only on the public page. */
  parks?: PublicEventPark[]
}

/** Lightweight park entry for the public Venue Guide. */
export interface PublicEventPark {
  id: string
  name: string
  /** Google `place_id` — canonical identity for dedup. */
  placeId?: string
  /** City, State (e.g. "Carson City, NV"). */
  location: string
  /** Full street address (e.g. "851 E William St, Carson City, NV 89701"). */
  address?: string
  /** Map coordinates — drives the Map Explorer pin. Optional; a park with
   *  no position is still listed but gets no pin. */
  position?: GeoPosition
  /** Field labels in use at this park (e.g. ["Field 1", "Field 2"]). */
  fieldsInUse?: string[]
  /** Grouped scheduling windows (consecutive same-window days merged). */
  scheduleWindows?: { days: string; window: string }[]
}

/** A lat/lng pair for map pins. */
export interface GeoPosition {
  lat: number
  lng: number
}

/** Place enrichment for a Map Explorer pin (mock now, Google Places later).
 *  See `src/api/placeDetails.ts`. */
export interface PlaceDetails {
  address?: string
  phone?: string
  rating?: number
  reviewCount?: number
  /** Photo URLs (already sized). */
  photos?: string[]
}

// ── In-map "Add Venue" Google Places search (live) ───────────────
// The Map Explorer's add flow searches Google Places live and enriches
// the picked place. See `src/api/placesLookup.ts`.

/** A Google Places Autocomplete prediction row. */
export interface PlacePrediction {
  placeId: string
  /** Bold primary text (place name). */
  primaryText: string
  /** Secondary text (locality / address). */
  secondaryText: string
  /** Full description string. */
  description: string
  /** True when the prediction is a business/POI (has a name); false for a
   *  pure address/geocode. Address picks trigger the nearby-venue lookup. */
  isEstablishment: boolean
}

/** A fully-resolved place from Google Place Details — used to prefill the
 *  in-map add wizard and the candidate pin's info box. */
export interface PlaceLookup {
  /** Google `place_id` — the canonical identity used to dedupe venues. */
  placeId: string
  name: string
  /** Single-line formatted address. */
  formattedAddress: string
  /** Parsed address components (when available). */
  street?: string
  city?: string
  state?: string
  postalCode?: string
  /** ISO-3166 alpha-2 country code, e.g. "US". */
  countryCode?: string
  position: GeoPosition
  /** Local phone number (national format). */
  phone?: string
  /** Dialling country code parsed from the international number, e.g. "+1". */
  phoneCountryCode?: string
  rating?: number
  reviewCount?: number
  photos?: string[]
  website?: string
}
