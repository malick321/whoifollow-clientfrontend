<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import EventLineupModal from '../components/EventLineupModal.vue'
import GameLineupSubmissionModal from '../components/GameLineupSubmissionModal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import TravelArrangementsModal from '../components/TravelArrangementsModal.vue'
import SummaryCard from '../components/SummaryCard.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import { pushToast } from '../toast-center'
import { gameLineupSubmissionStatusMeta } from '../game-lineup-status'
import activeGamesIcon from '../assets/icon-active-games.svg'
import emailIcon from '../assets/email.svg'
import fieldLineIcon from '../assets/field-line.svg'
import jerseyIcon from '../assets/jersy.svg'
import mobileIcon from '../assets/mobile.svg'
import statisticsIcon from '../assets/icon-statistics.svg'
import timerStartIcon from '../assets/timer-start.svg'
import totalGamesIcon from '../assets/icon-total-games.svg'
import totalLostIcon from '../assets/icon-total-lost.svg'
import totalWonIcon from '../assets/icon-total-won.svg'
import boxscoreIcon from '../assets/boxscore.svg'
import seedIcon from '../assets/seed.svg'
import { fetchDivisionOverviewStandings } from '../api/divisionOverview'
import { fetchEventAttendance, saveEventAttendance, sendAttendanceReminder } from '../api/eventAttendance'
import { fetchParticipationGames, ParticipationNotFoundError } from '../api/participationPage'
import { fetchTeamMembers } from '../api/teamMembers'
import { DEFAULT_SLOW_PITCH_FIELD_POSITIONS } from '../constants/fieldConfig'
import { fetchGameLineupSubmission, fetchTeamParticipation, saveGameLineupSubmission } from '../api/team'
import { fetchEventWeather } from '../api/weather'
import { shouldShowWeather } from '../lib/weather-window'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import type {
  FieldConfigPosition,
  EventAttendanceMember,
  GameLineupPlayer,
  GameLineupSubmission,
  GameLineupSubmissionDetail,
  GameSummary,
  LineupPlayer,
  RegistrationStatus,
  TeamEventForecastDay,
  TeamMemberOption,
  TeamParticipation
} from '../types'

const route = useRoute()
const router = useRouter()
const teamParticipationId = computed(() =>
  (route.params.teamParticipationId as string | undefined) ||
  (route.query.team_participation_id as string | undefined)
)

const participation = ref<TeamParticipation | null>(null)
const participationLoading = ref(true)
const gamesLoading = ref(false)
const divisionLoading = ref(true)
const attendanceLoading = ref(false)
const condensedHeaderVisible = ref(false)
const scheduleCardMenuOpenId = ref<string | null>(null)
const lineupModalOpen = ref(false)
const gameLineupModalOpen = ref(false)
const gameLineupLoading = ref(false)
const gameLineupSaving = ref(false)
const selectedGame = ref<GameSummary | null>(null)
const gameLineupDraft = ref<GameLineupPlayer[]>([])
const gameLineupSubmissionId = ref<string | null>(null)
const gameLineupFormStatus = ref<GameLineupSubmission['status']>('draft')
const gameLineupFormNotes = ref('')
const attendanceModalOpen = ref(false)
type AttendanceTabKey = 'going' | 'not_going' | 'maybe' | 'not_responded'
const attendanceActiveTab = ref<AttendanceTabKey>('going')
// `team_members.id` of the currently logged-in user. Null until the listing or
// save response surfaces `loggedInUserAttendee`. Drives the self-row highlight
// and hides the admin inline selector on the user's own card.
const selfMemberId = ref<string | null>(null)
// `'self'` while the self-RSVP row is saving, otherwise the `member_id` of the
// admin-targeted teammate whose save is in flight. Null when idle. Used to
// toggle "Saving..." on the active button and block double-submits.
const attendanceSavingKey = ref<string | null>(null)
// True while the admin-only "Send Reminder Now" call to
// /event/sendRemainderToTeammates is in flight. Disables the link so a
// jumpy click doesn't fire two reminder rounds against the same event.
const reminderSending = ref(false)
// Hero "Are you going?" CTA expansion state. Starts collapsed — a single
// pill that either shows the current RSVP status or prompts the user. Taps
// expand into three options (going / not going / maybe); a successful save
// auto-collapses so the hero reflects the new state at a glance.
const rsvpExpanded = ref(false)
// Modal: which attendee card (if any) is currently in its "edit RSVP" state.
// Only one card expands at a time — clicking Edit/Mark on another card
// collapses the previous via the v-if comparison. Null when no card is
// editing. Resets to null after a successful save.
const attendanceEditingMemberId = ref<string | null>(null)
// Travel-arrangements flow refs. Triggered after a Going save completes
// (either the user marking themselves, or an admin marking another
// teammate). travelConfirmOpen drives the small "Do you want to enter
// travel arrangements?" overlay; travelModalOpen drives the actual
// TravelArrangementsModal form. travelInitial is the pre-fill payload
// (null = blank form). travelTargetMemberId holds the team_members.id
// of the person whose travel info we're capturing — null when filling
// for self (so the saveEventAttendance call omits the member_id and the
// backend derives it from the bearer token). travelTargetName is the
// display name shown in the modal subtitle when filling on behalf of
// another teammate, so the admin doesn't lose track of whose record
// they're editing.
const travelConfirmOpen = ref(false)
const travelModalOpen = ref(false)
const travelInitial = ref<{
  services: string[]
  roomCount: number | null
  adultCount: number | null
  exactStartDate: string | null
  exactEndDate: string | null
  note: string | null
} | null>(null)
const travelTargetMemberId = ref<string | null>(null)
const travelTargetName = ref<string>('')
const draggedGameLineupPlayerId = ref<string | null>(null)
const gameLineupDropTargetId = ref<string | null>(null)
const gameSubstituteDrafts = ref<Record<string, { targetId: string | null; inning: number | null; positionCode: string | null }>>({})
const gameLineupFieldConfigName = ref<string>('Slow Pitch 10 Player')
const gameLineupFieldPositions = ref<FieldConfigPosition[]>(DEFAULT_SLOW_PITCH_FIELD_POSITIONS)
const DEFAULT_GAME_LINEUP_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF']

function registrationTone(status: RegistrationStatus) {
  if (status === 'registered' || status === 'paid') return 'success'
  if (status === 'pending' || status === 'partially_paid') return 'warning'
  return 'danger'
}

function participationTone(status: TeamParticipation['participationStatus']) {
  switch (status) {
    case 'confirmed':
      return 'success'
    case 'withdrawn':
    case 'cancelled':
      return 'danger'
    case 'waitlisted':
    case 'pending_approval':
      return 'warning'
    default:
      return 'info'
  }
}

function formatStatusLabel(status: string) {
  switch (status) {
    case 'pending_approval':
      return 'Under-Review'
    case 'waitlisted':
      return 'Waiting List'
    case 'withdrawn':
      return 'Withdrawn'
    case 'cancelled':
      return 'Cancelled'
    case 'confirmed':
      return 'Confirmed'
    case 'initiated':
      return 'Initiated'
    default:
      return status
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
  }
}

function participationBadgeLabel(status: TeamParticipation['participationStatus']) {
  switch (status) {
    case 'waitlisted':
      return 'Waiting List'
    case 'withdrawn':
      return 'Participation Withdrawn'
    case 'cancelled':
      return 'Participation Cancelled'
    default:
      return `Participation ${formatStatusLabel(status)}`
  }
}

function formatFeeStatusLabel(status: RegistrationStatus) {
  switch (status) {
    case 'registered':
    case 'paid':
      return 'Paid'
    case 'unpaid':
      return 'Unpaid'
    case 'partially_paid':
      return 'Partially Paid'
    default:
      return formatStatusLabel(status)
  }
}

const totalGames = computed(() => participation.value?.games.length ?? 0)
const activeGames = computed(
  () =>
    participation.value?.games.filter(
      (game) =>
        game.status === 'live' ||
        (game.status === 'scheduled' && !!(game.dateLabel?.trim() || game.timeLabel?.trim() || game.gameTime?.trim()))
    ).length ?? 0
)
const mappedSheets = computed(
  () =>
    participation.value?.games.filter(
      (game) => game.scoresheetStatus === 'mapped' || game.scoresheetStatus === 'published'
    ).length ?? 0
)
const wonGames = computed(
  () =>
    participation.value?.games.filter(
      (game) =>
        game.status === 'final' &&
        game.scoreFor !== undefined &&
        game.scoreAgainst !== undefined &&
        game.scoreFor > game.scoreAgainst
    ).length ?? 0
)
const lostGames = computed(
  () =>
    participation.value?.games.filter(
      (game) =>
        game.status === 'final' &&
        game.scoreFor !== undefined &&
        game.scoreAgainst !== undefined &&
        game.scoreFor < game.scoreAgainst
    ).length ?? 0
)

function parseGameTimeSortValue(game: GameSummary) {
  const source = `${game.timeLabel ?? ''} ${game.gameTime ?? ''}`
  const match = source.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return Number.MAX_SAFE_INTEGER

  let hours = Number(match[1]) % 12
  const minutes = Number(match[2])
  if (match[3].toUpperCase() === 'PM') hours += 12

  return hours * 60 + minutes
}

function parseGroupDateSortValue(label: string, games: GameSummary[]) {
  if (label === 'Unscheduled Games') return Number.MAX_SAFE_INTEGER

  const fallbackParts = games[0]?.gameTime.split(' - ') ?? []
  const fallbackDate = fallbackParts.length ? fallbackParts[fallbackParts.length - 1].trim() : ''
  const candidates = [
    label,
    label.replace(/^[A-Za-z]{3}\s+/, ''),
    fallbackDate
  ].filter(Boolean)

  for (const candidate of candidates) {
    const parsed = Date.parse(candidate)
    if (!Number.isNaN(parsed)) return parsed
  }

  return Number.MAX_SAFE_INTEGER - 1
}

function timelineSlotLabel(game: GameSummary) {
  const explicitTime = game.timeLabel?.trim()
  if (explicitTime) return explicitTime

  const match = game.gameTime.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i)
  if (match?.[1]) return match[1]

  return 'Unscheduled'
}

function timelineSlotSubLabel(game: GameSummary) {
  if (scheduleDelayLabel(game)) return 'Delayed'
  if (game.status === 'live') return 'Live'
  if (game.status === 'final') return 'Final'
  if (game.status === 'scheduled' && hasScheduledDateTime(game)) return 'Scheduled'
  return ''
}

/**
 * StatusBadge label + tone for the Game Lineup preview header.
 * Wrapped as its own helper (instead of reusing the timeline-dot
 * helpers) because StatusBadge accepts a narrower tone union than
 * the timeline ('live' / 'final' / 'muted' aren't valid badge tones).
 */
function gameStatusBadgeLabel(game: GameSummary) {
  if (scheduleDelayLabel(game)) return 'Delayed'
  if (game.status === 'live') return 'Live'
  if (game.status === 'final') return 'Final'
  return 'Yet to begin'
}

function gameStatusBadgeTone(
  game: GameSummary
): 'success' | 'warning' | 'info' | 'danger' | 'neutral' | 'primary' {
  if (scheduleDelayLabel(game)) return 'warning'
  if (game.status === 'live') return 'danger'
  if (game.status === 'final') return 'success'
  return 'info'
}

function timelineDelayReason(game: GameSummary) {
  const delay = scheduleDelayLabel(game)
  return delay.replace(/^Delayed\s*-\s*/i, '').trim()
}

function timelineSlotTone(game: GameSummary) {
  if (scheduleDelayLabel(game)) return 'warning'
  if (game.status === 'live') return 'live'
  if (game.status === 'final') return 'final'
  if (!game.timeLabel?.trim() && !game.dateLabel?.trim()) return 'muted'
  return 'default'
}

function timelineDotTone(game: GameSummary) {
  if (scheduleDelayLabel(game)) return 'warning'
  if (game.status === 'live') return 'live'
  if (game.status === 'final') return 'final'
  return 'pending'
}

function normalizeText(value?: string | null) {
  return value?.trim() ?? ''
}

function hasScheduledDateTime(game: GameSummary) {
  return Boolean(normalizeText(game.dateLabel) || normalizeText(game.timeLabel) || normalizeText(game.gameTime))
}

function isUnscheduledGame(game: GameSummary) {
  return !hasScheduledDateTime(game)
}

function showStartedGameMeta(game: GameSummary) {
  return game.status === 'live' || game.status === 'final' || !!scheduleDelayLabel(game)
}

function formatClockLabel(value?: string | null) {
  const normalized = value?.trim()
  if (!normalized) return ''

  const meridiemMatch = normalized.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i)
  if (meridiemMatch?.[1]) return meridiemMatch[1].toUpperCase()

  const isoDate = new Date(normalized)
  if (!Number.isNaN(isoDate.getTime())) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'UTC'
    }).format(isoDate)
  }

  const twentyFourMatch = normalized.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/)
  if (twentyFourMatch) {
    const hours = Number(twentyFourMatch[1])
    const minutes = twentyFourMatch[2]
    const suffix = hours >= 12 ? 'PM' : 'AM'
    const normalizedHours = hours % 12 || 12
    return `${normalizedHours}:${minutes} ${suffix}`
  }

  return normalized
}

function parseClockMinutes(value?: string | null) {
  const label = formatClockLabel(value)
  if (!label) return null

  const match = label.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
  if (!match) return null

  let hours = Number(match[1]) % 12
  const minutes = Number(match[2])
  if (match[3].toUpperCase() === 'PM') hours += 12

  return hours * 60 + minutes
}

function scheduleStartedLabel(game: GameSummary) {
  const actualLabel = formatClockLabel(game.actualStartTime)
  const scheduledLabel = formatClockLabel(game.timeLabel)
  return actualLabel || scheduledLabel || timelineSlotLabel(game)
}

function scheduleStartedMetaLabel(game: GameSummary) {
  return `Started ${scheduleStartedLabel(game)}`
}

function scheduleStartVarianceLabel(game: GameSummary) {
  const scheduledMinutes = parseClockMinutes(game.timeLabel)
  const actualMinutes = parseClockMinutes(game.actualStartTime)

  if (scheduledMinutes == null || actualMinutes == null) return ''

  const difference = actualMinutes - scheduledMinutes
  if (difference <= 0) return 'Ontime'
  if (difference === 1) return '1 min late'
  return `${difference} mins late`
}

function scheduleStartVarianceTone(game: GameSummary) {
  const scheduledMinutes = parseClockMinutes(game.timeLabel)
  const actualMinutes = parseClockMinutes(game.actualStartTime)

  if (scheduledMinutes == null || actualMinutes == null) return 'neutral'
  return actualMinutes > scheduledMinutes ? 'late' : 'ontime'
}

function scheduleTimeLimitLabel(game: GameSummary) {
  if (game.timeLimit == null || `${game.timeLimit}`.trim() === '') return ''
  return `Time Limit ${game.timeLimit}`
}

function scheduleDelayLabel(game: GameSummary) {
  const note = game.statusNote?.trim() ?? ''
  return /^delayed\b/i.test(note) ? note : ''
}

function scheduleRightSummary(game: GameSummary) {
  const delay = scheduleDelayLabel(game)
  if (delay && game.status !== 'live') return delay
  if (game.status === 'scheduled') return game.statusNote ?? 'Match yet to begin'
  return null
}

function normalizeVenueValue(value?: string) {
  const normalized = value?.trim() ?? ''
  if (!normalized) return ''
  if (/^field\s+tbd$/i.test(normalized) || /^tbd$/i.test(normalized)) return ''
  return normalized
}

function scheduleVenueLabel(game: GameSummary) {
  const field = normalizeVenueValue(game.field)
  const park = normalizeVenueValue(game.facilityLabel)

  if (field && park) return `${field} - ${park}`
  if (field) return field
  return ''
}

function scheduleScoresheetLabel(game: GameSummary) {
  return game.scoresheetStatus === 'published' || game.scoresheetStatus === 'mapped'
    ? 'Scoresheet available'
    : 'Scoresheet not started'
}

function scheduleLineupTone(game: GameSummary) {
  return game.lineupSubmitted ? 'success' : 'warning'
}

function scheduleScoresheetTone(game: GameSummary) {
  if (game.scoresheetStatus === 'published' || game.scoresheetStatus === 'mapped') return 'success'
  if (game.scoresheetStatus === 'review' || game.scoresheetStatus === 'uploading') return 'warning'
  return 'neutral'
}

function scheduleRows(game: GameSummary) {
  const isFinal = game.status === 'final'
  const rows = [
    {
      key: 'opponent',
      name: game.opponent,
      imageUrl: game.opponentImageUrl,
      seed: game.opponentSeed,
      side: game.opponentSide,
      score: game.scoreAgainst ?? 0,
      won: game.opponentWon ?? false
    },
    {
      key: 'team',
      name: participation.value?.teamName ?? '',
      imageUrl: game.teamImageUrl,
      seed: game.teamSeed,
      side: game.teamSide,
      score: game.scoreFor ?? 0,
      won: game.teamWon ?? false
    }
  ]

  if (
    isFinal &&
    game.teamWon == null &&
    game.opponentWon == null &&
    game.scoreFor !== undefined &&
    game.scoreAgainst !== undefined &&
    game.scoreFor !== game.scoreAgainst
  ) {
    const winningScore = Math.max(game.scoreFor, game.scoreAgainst)
    rows.forEach((row) => {
      row.won = row.score === winningScore
    })
  }

  return rows.sort((left, right) => {
    if (left.side === right.side) return 0
    if (left.side === 'V') return -1
    if (right.side === 'V') return 1
    return 0
  })
}

const groupedGames = computed(() => {
  const groups = new Map<string, GameSummary[]>()

  for (const game of participation.value?.games ?? []) {
    const key = game.dateLabel || game.gameTime.split(',')[0] || 'Unscheduled Games'
    const existing = groups.get(key) ?? []
    existing.push(game)
    groups.set(key, existing)
  }

  return Array.from(groups.entries())
    .map(([label, games]) => ({
      label,
      games: games.slice().sort((left, right) => parseGameTimeSortValue(left) - parseGameTimeSortValue(right))
    }))
    .sort((left, right) => parseGroupDateSortValue(left.label, left.games) - parseGroupDateSortValue(right.label, right.games))
})

const condensedSubline = computed(() => {
  if (!participation.value) return ''
  return `${participation.value.division} - ${participation.value.eventName} - ${participation.value.eventDate}`
})

const teamMembers = ref<TeamMemberOption[]>([])

const lineupTeammates = computed<TeamMemberOption[]>(() => {
  // Prefer the live team roster from /chat/getTeamMembers (only players, not
  // staff). Fall back to anything the participation payload happens to carry,
  // and finally to deriving options from the existing lineup itself so the
  // dropdown is never empty when a lineup exists.
  const fetched = teamMembers.value.filter((member) => member.isPlayer ?? true)
  if (fetched.length) return fetched
  if (participation.value?.teamMembers?.length) {
    return participation.value.teamMembers.filter((member) => member.isPlayer ?? true)
  }
  return (participation.value?.lineup ?? []).map((player) => ({
    id: player.teamMemberId ?? `fallback-${player.id}`,
    name: player.name,
    jerseyNumber: player.jerseyNumber,
    defaultPosition: player.position,
    status: player.status,
    isPlayer: true
  }))
})

const eventLineupFieldPositions = computed<FieldConfigPosition[]>(
  () => participation.value?.fieldConfigPositions?.length ? participation.value.fieldConfigPositions : DEFAULT_SLOW_PITCH_FIELD_POSITIONS
)
// Lineup summary is a structured list of players with starter / bench
// flags. Split into two comma-joined text lines (starters + bench) so the
// side-panel "Event Lineup" card remains scannable without introducing
// heavy chip/row UI. `hasLineupSubmitted` drives the empty-state fallback.
const lineupStartersText = computed(() =>
  (participation.value?.eventOverview.lineupSummary ?? [])
    .filter((p) => p.isStarter)
    .map((p) => p.name)
    .filter(Boolean)
    .join(', ')
)
const lineupBenchText = computed(() =>
  (participation.value?.eventOverview.lineupSummary ?? [])
    .filter((p) => p.isBench)
    .map((p) => p.name)
    .filter(Boolean)
    .join(', ')
)
const hasLineupSubmitted = computed(
  () => (participation.value?.eventOverview.lineupSummary ?? []).length > 0
)

// Hero meta line format: "<age-group> <rating> - City, State". Each piece
// is optional; missing pieces collapse out. Examples:
//   "Men's 65+ 1300 - Glendale, AZ"   (all fields)
//   "Men's 65+ - Glendale, AZ"        (no rating)
//   "Men's 65+ 1300"                  (no location)
//   ""                                (nothing → template skips the <p>)
const heroTeamMetaText = computed(() => {
  const p = participation.value
  if (!p) return ''
  const left = [p.teamAgeGroup, p.teamRating].filter(Boolean).join(' ')
  const right = [p.teamCity, p.teamState].filter(Boolean).join(', ')
  if (left && right) return `${left} - ${right}`
  return left || right
})
const hasDivisionTieBreakerText = computed(() => !!participation.value?.divisionOverview.tieBreakerText?.trim())
const hasDivisionFormatText = computed(() => !!participation.value?.divisionOverview.formatText?.trim())
const hasDivisionStandings = computed(() => (participation.value?.divisionOverview.standings.length ?? 0) > 0)
// Weather forecast for the event location. Lives separately from
// participation.eventOverview.forecast (which is the legacy backend-
// populated stub) because the real data comes from WeatherAPI.com at
// runtime, not from our backend. Only populated when today is inside
// [eventStart − 5 days, eventEnd] AND the event has coords.
const weatherForecast = ref<TeamEventForecastDay[]>([])
const weatherWindowOpen = computed(() =>
  shouldShowWeather(
    participation.value?.eventStartDate,
    participation.value?.eventEndDate
  )
)
const hasEventOverviewForecast = computed(() => weatherForecast.value.length > 0)
const teamAttendance = ref<EventAttendanceMember[]>([])
const divisionOverviewTitle = computed(
  () => participation.value?.divisionOverview.bracketName?.trim() || participation.value?.division || ''
)
const teamAttendanceKeys = computed(() => {
  const keys = new Set<string>()

  const participationTeamGuid = participation.value?.teamGuid?.trim()
  const participationTeamId = participation.value?.teamId?.trim()

  // Attendance API team_id aligns with the participation payload's team_guid value.
  if (participationTeamGuid) keys.add(participationTeamGuid)
  if (participationTeamId && participationTeamId.includes('-')) keys.add(participationTeamId)

  return keys
})
const filteredTeamAttendance = computed(() => {
  const filterKeys = teamAttendanceKeys.value
  if (!filterKeys.size) return teamAttendance.value

  return teamAttendance.value.filter((entry) => filterKeys.has(entry.teamId?.trim() ?? ''))
})

/** Case-insensitive locale-aware compare on `fullName`. Used to sort
 *  every per-tab attendee list alphabetically. `sensitivity: 'base'`
 *  treats accented variants as equal so e.g. "Álvarez" sorts next to
 *  "Alvarez" the way a human would expect. */
function byFullName<T extends { fullName?: string | null }>(a: T, b: T) {
  return (a.fullName ?? '').localeCompare(b.fullName ?? '', undefined, { sensitivity: 'base' })
}

const goingAttendees = computed(() =>
  filteredTeamAttendance.value.filter((entry) => entry.status === 'going').sort(byFullName)
)
const notGoingAttendees = computed(() =>
  filteredTeamAttendance.value.filter((entry) => entry.status === 'not_going').sort(byFullName)
)
const maybeAttendees = computed(() =>
  filteredTeamAttendance.value.filter((entry) => entry.status === 'maybe').sort(byFullName)
)
const attendeePreview = computed(() => goingAttendees.value.slice(0, 5))
// "Not Responded": team roster minus members who already have an attendance
// record. Cross-checks on BOTH identity fields because `member_id` in the
// attendance API and `id` in getTeamMembers may each come from a different
// table (team_members vs users). Matching member.id against attendance
// memberId OR user:userId in either direction covers all four pairings so
// someone who's responded never double-shows in Not Responded.
const respondedMatchKeys = computed(() => {
  const keys = new Set<string>()
  for (const entry of filteredTeamAttendance.value) {
    if (entry.memberId) keys.add(`m:${entry.memberId}`)
    if (entry.userId) keys.add(`u:${entry.userId}`)
    // Also add the raw values (unprefixed) so a match works if
    // TeamMemberOption.id happens to equal the attendance userId, or vice
    // versa — i.e., when the two adapters chose different source columns.
    if (entry.memberId) keys.add(entry.memberId)
    if (entry.userId) keys.add(entry.userId)
  }
  return keys
})
const notRespondedAttendees = computed<AttendanceCardEntry[]>(() =>
  teamMembers.value
    .filter((member) => {
      if (respondedMatchKeys.value.has(`m:${member.id}`)) return false
      if (member.userId && respondedMatchKeys.value.has(`u:${member.userId}`)) return false
      // Fallback: unprefixed match if the two endpoints cross-reference
      // different source columns (e.g., one returns team_members.id, the
      // other returns users.id but both under the name `id`).
      if (respondedMatchKeys.value.has(member.id)) return false
      if (member.userId && respondedMatchKeys.value.has(member.userId)) return false
      return true
    })
    .map<AttendanceCardEntry>((member) => ({
      kind: 'pending',
      id: `pending-${member.id}`,
      // /event/eventAttendeeSelect expects the user id as `member_id` — not the
      // team_members row id. TeamMemberOption.userId maps to user_id from
      // /chat/getTeamMembers; fall back to member.id only if userId is absent
      // so we don't block the save outright for rosters missing that field.
      memberId: member.userId ?? member.id,
      fullName: member.name,
      profileAvatar: member.imageUrl,
      status: null
    }))
    // Alphabetical, same compare used for the responded buckets so the
    // ordering convention is identical across all four tabs.
    .sort(byFullName)
)
const selfAttendance = computed<EventAttendanceMember | null>(() => {
  if (!selfMemberId.value) return null
  return (
    filteredTeamAttendance.value.find((entry) => entry.memberId === selfMemberId.value) ?? null
  )
})
// All four logical tabs with their current counts. Filtered down to
// `attendanceTabs` (visible tabs only) below — empty buckets are hidden
// from the tab bar so the user only sees groupings that actually have
// people in them. We keep the unfiltered list around as
// `attendanceTabsAll` so the count-based logic (and the auto-switch
// watcher) has the full picture even when the user is staring at,
// say, only the Going tab because every other status is empty.
const attendanceTabsAll = computed(() => [
  { key: 'going' as const, label: 'Going', count: goingAttendees.value.length },
  { key: 'not_going' as const, label: 'Not Going', count: notGoingAttendees.value.length },
  { key: 'maybe' as const, label: 'Maybe', count: maybeAttendees.value.length },
  { key: 'not_responded' as const, label: 'Not Responded', count: notRespondedAttendees.value.length }
])
const attendanceTabs = computed(() => attendanceTabsAll.value.filter((tab) => tab.count > 0))

// Auto-redirect when the currently-active tab becomes empty. Without
// this, a user who is on (say) the Going tab and then admin-marks the
// last Going teammate as Maybe would see the tab bar shrink to "Maybe"
// while the panel below stays empty — because attendanceActiveTab is
// still pointing at 'going' which has just been hidden. Whenever the
// visible-tab list changes and no longer contains the active key, we
// jump to the first visible tab so the user always sees content.
watch(attendanceTabs, (visible) => {
  if (visible.length === 0) return
  if (!visible.some((tab) => tab.key === attendanceActiveTab.value)) {
    attendanceActiveTab.value = visible[0].key
  }
})

const activeAttendanceList = computed<AttendanceCardEntry[]>(() => {
  if (attendanceActiveTab.value === 'not_going') return notGoingAttendees.value.map(toAttendedCardEntry)
  if (attendanceActiveTab.value === 'maybe') return maybeAttendees.value.map(toAttendedCardEntry)
  if (attendanceActiveTab.value === 'not_responded') return notRespondedAttendees.value
  return goingAttendees.value.map(toAttendedCardEntry)
})
const activeAttendanceLabel = computed(
  () => attendanceTabs.value.find((tab) => tab.key === attendanceActiveTab.value)?.label ?? 'Going'
)
// Unified render shape for the attendee card. Pending entries (Not Responded
// tab) have `status: null`; attended entries carry the real EventAttendanceMember.
type AttendanceCardEntry =
  | {
      kind: 'attended'
      id: string
      memberId: string | undefined
      fullName: string
      profileAvatar: string | undefined
      status: EventAttendanceMember['status']
      source: EventAttendanceMember
    }
  | {
      kind: 'pending'
      id: string
      memberId: string
      fullName: string
      profileAvatar: string | undefined
      status: null
    }
function toAttendedCardEntry(member: EventAttendanceMember): AttendanceCardEntry {
  return {
    kind: 'attended',
    id: `attended-${member.id}`,
    memberId: member.memberId,
    fullName: member.fullName,
    profileAvatar: member.profileAvatar,
    status: member.status,
    source: member
  }
}
// True when the "Saving..." label belongs to the button identified by `key`
// ('self' or a teammate's member_id). Used to swap the label on the in-flight
// button. All attendance buttons disable while any save is in flight, since
// the response overwrites the full roster and partial interleaving would race.
function isAttendanceSaving(key: string) {
  return attendanceSavingKey.value === key
}
const anyAttendanceSaving = computed(() => attendanceSavingKey.value !== null)

function attendanceCountLabel(count: number, label = 'going') {
  return `${count} ${label}`
}

function attendanceStatusLabel(status: EventAttendanceMember['status']) {
  if (status === 'going') return 'Going'
  if (status === 'not_going') return 'Not Going'
  return 'Maybe'
}

// Source of truth for the three RSVP buttons rendered in the self-row and in
// the admin inline selector on each attendee card. `shortLabel` fits the
// compact admin buttons where horizontal space is tighter.
const attendanceSelfOptions: ReadonlyArray<{
  status: EventAttendanceMember['status']
  label: string
  shortLabel: string
}> = [
  { status: 'going', label: 'Going', shortLabel: 'Going' },
  { status: 'not_going', label: 'Not Going', shortLabel: "Not Going" },
  { status: 'maybe', label: 'Maybe', shortLabel: 'Maybe' }
]

function attendanceStayLabel(attendee: EventAttendanceMember) {
  const start = attendee.exactStartDate?.trim() ?? ''
  const end = attendee.exactEndDate?.trim() ?? ''
  if (start && end) return `Stay ${start} - ${end}`
  if (start) return `Stay starts ${start}`
  if (end) return `Stay ends ${end}`
  return ''
}

function attendanceSupportLabel(attendee: EventAttendanceMember) {
  const parts = []
  if (attendee.services?.trim()) {
    // Backend stores services as a comma-separated string with no spaces
    // around the commas (`Hotel,Bnb,Car Rental`). Re-join with `, ` for a
    // more readable rendering on the card. Empty/whitespace tokens are
    // dropped so a stray trailing comma doesn't render as `, ` at the end.
    const services = attendee.services
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ')
    if (services) parts.push(services)
  }
  if (attendee.roomCount?.trim()) parts.push(`Rooms ${attendee.roomCount.trim()}`)
  if (attendee.adultCount?.trim()) parts.push(`Adults ${attendee.adultCount.trim()}`)
  return parts.join(' - ')
}

/**
 * Services-only line for the self travel info column. Splits the
 * comma-separated backend value, trims and re-joins with ", " for a
 * more readable rendering. Returns empty string when no services are
 * selected so the template can `v-if` the row out cleanly.
 */
function attendanceServicesLabel(attendee: EventAttendanceMember) {
  if (!attendee.services?.trim()) return ''
  return attendee.services
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
}

/**
 * Combined "stay" line for the self travel info column — concatenates
 * stay dates, room count, and adult count into a single ` - `-joined
 * string. Used in the Travel Info column row 3 alongside the freeform
 * note (rendered as a separate italic line below). Returns empty when
 * none of the three pieces are populated so the row collapses cleanly.
 */
function attendanceStayDetailsLabel(attendee: EventAttendanceMember) {
  const parts: string[] = []
  const stay = attendanceStayLabel(attendee)
  if (stay) parts.push(stay)
  if (attendee.roomCount?.trim()) parts.push(`Rooms ${attendee.roomCount.trim()}`)
  if (attendee.adultCount?.trim()) parts.push(`Adults ${attendee.adultCount.trim()}`)
  return parts.join(' - ')
}

async function loadAttendance() {
  if (!participation.value?.eventId) return
  // The listing endpoint now scopes by team_guid; without one we'd get an
  // empty or mistakenly-global roster, so skip the call and leave the panel
  // in its empty state instead of firing a half-parameterised request.
  if (!participation.value.teamGuid) {
    teamAttendance.value = []
    return
  }

  attendanceLoading.value = true
  try {
    const result = await fetchEventAttendance(
      participation.value.eventId,
      participation.value.teamGuid
    )
    teamAttendance.value = result.members
    // Preserve any self-id we already learned from a prior save if the listing
    // endpoint doesn't surface loggedInUserAttendee — don't clobber with null.
    if (result.selfMemberId) selfMemberId.value = result.selfMemberId
  } catch {
    teamAttendance.value = []
  } finally {
    attendanceLoading.value = false
  }
}

function openAttendanceModal() {
  attendanceModalOpen.value = true
}

function closeAttendanceModal() {
  attendanceModalOpen.value = false
}

/**
 * Admin-only "Send Reminder Now" action shown atop the Not Responded
 * tab. Calls the legacy `/event/sendRemainderToTeammates` endpoint
 * (POST + form-data with `event_id`) which emails everyone who hasn't
 * yet RSVP'd. Surfaces success / failure as a toast, including the
 * count of emails actually sent so the admin gets clear feedback even
 * when the response is fast.
 *
 * Guarded against double-clicks via reminderSending. Bails silently
 * if eventId is missing — the page shouldn't be in a state where the
 * reminder action is reachable AND eventId is unset, but we'd rather
 * no-op than 500.
 */
async function onSendReminder() {
  if (reminderSending.value) return
  if (!participation.value?.eventId) return
  reminderSending.value = true
  try {
    const result = await sendAttendanceReminder(participation.value.eventId)
    // Decision tree for the user-facing toast:
    //   1. emailsSent > 0  → success with the count.
    //   2. emailsSent === 0 AND backend has nobody pending in
    //      `not_responded_users` → "everyone has already responded".
    //   3. emailsSent === 0 BUT backend reports pending users → the
    //      backend processed the call without actually mailing anyone
    //      (often a backend / data-sync issue — e.g. the team's
    //      not-responded list disagrees with the per-event listing).
    //      Surface the backend's own `message` so the user sees the
    //      truth instead of a misleading "everyone responded" line.
    if (result.emailsSent > 0) {
      pushToast({
        tone: 'success',
        title: 'Reminders sent',
        message: `Sent ${result.emailsSent} reminder email${result.emailsSent === 1 ? '' : 's'}.`
      })
    } else if (result.notRespondedUsers.length === 0) {
      pushToast({
        tone: 'success',
        title: 'No reminders needed',
        message: 'Everyone on the team has already responded.'
      })
    } else {
      pushToast({
        tone: 'warning',
        title: 'Reminder not sent',
        message:
          result.message
          || `${result.notRespondedUsers.length} teammate${result.notRespondedUsers.length === 1 ? '' : 's'} still pending, but the server reported zero emails sent. Please retry shortly.`
      })
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not send reminders',
      message:
        error instanceof Error
          ? error.message
          : 'Something went wrong while sending the reminder. Please try again.'
    })
  } finally {
    reminderSending.value = false
  }
}

// Body-scroll lock for the attendance modal — same convention used by
// EventLineupModal and GameLineupSubmissionModal (see src/body-scroll-lock.ts).
// While the popup is open the page behind it stays put, so the user
// scrolling inside the modal doesn't bleed scroll into the underlying
// participation page. The ref-counted helper is safe even if multiple
// modals briefly overlap during a state transition.
watch(attendanceModalOpen, (open, wasOpen) => {
  if (open && !wasOpen) lockBodyScroll()
  else if (!open && wasOpen) unlockBodyScroll()
})

onBeforeUnmount(() => {
  // Defensive: if the participation view unmounts while the attendance
  // modal is still open (route change, parent v-if flip, etc.), release
  // the lock so the next page is scrollable.
  if (attendanceModalOpen.value) unlockBodyScroll()
})

// Hero RSVP CTA click: if already marked, tapping the trigger pill expands
// into the three options so the user can change. Otherwise expansion reveals
// the initial RSVP choice set.
function toggleRsvpExpanded() {
  rsvpExpanded.value = !rsvpExpanded.value
}

// Pick an RSVP status from the hero CTA. Auto-collapses on success so the
// trigger pill can reflect the new status label; on failure leaves the options
// visible so the user can retry without an extra tap.
async function onSelfRsvpSelect(status: EventAttendanceMember['status']) {
  await onMarkAttendance(status)
  // `onMarkAttendance` overwrites `selfAttendance` only on success (the catch
  // branch leaves state untouched and toasts the error). Matching status
  // means we can collapse; otherwise the options stay on screen.
  if (selfAttendance.value?.status === status) {
    rsvpExpanded.value = false
  }
}

// Admin flow on attendee cards: save the teammate's RSVP and collapse the
// edit row back to the Edit Attendance / Mark Attendance button on success.
// Matches the self CTA's collapse-on-success UX so both interactions feel
// identical to the user.
async function onAdminRsvpSelect(status: EventAttendanceMember['status'], memberId: string) {
  await onMarkAttendance(status, memberId)
  const updated = filteredTeamAttendance.value.find((entry) => entry.memberId === memberId)
  if (updated?.status === status) {
    attendanceEditingMemberId.value = null
  }
}

async function onMarkAttendance(
  status: EventAttendanceMember['status'],
  memberId?: string
) {
  if (!participation.value?.eventId) return
  if (!participation.value.teamGuid) {
    pushToast({ tone: 'warning', title: 'Missing team', message: 'Team GUID is missing; cannot update attendance.' })
    return
  }
  // Guard at handler level so double-taps during an in-flight save are silent
  // no-ops (matches the PA modal's save/delete pattern).
  if (attendanceSavingKey.value !== null) return

  const key = memberId ?? 'self'
  attendanceSavingKey.value = key
  try {
    const result = await saveEventAttendance({
      eventId: participation.value.eventId,
      teamGuid: participation.value.teamGuid,
      status,
      memberId
    })
    // Trust the save response as-is: the backend will return the complete
    // post-save attendee list in event_attendee_all. No local synthesis /
    // optimistic merging — that caused edge-case drift where the Edit
    // button attached to the wrong person after an admin changed a status.
    teamAttendance.value = result.members
    // DO NOT update selfMemberId from the save response. The backend's
    // loggedInUserAttendee field in the save payload is actually the
    // JUST-SAVED record, not the logged-in user's record — so overwriting
    // here made the admin's "self" flip to the teammate just edited,
    // which in turn attached the Edit Attendance button to the admin's
    // card instead of the teammate's. Self identity is established once
    // on load via the JWT sub match in fetchEventAttendance; it doesn't
    // change between saves.
    // No success toast — the button label flip (or the modal re-render)
    // already communicates the state change. Only surface failures.

    // Travel-arrangements branch — fires for ANY Going save (self OR
    // admin-marks-someone-else). Not Going / Maybe paths skip this
    // entirely. Same rules apply regardless of who the actor is:
    //   - If the target already has travel info on file (any of the
    //     five fields populated) → skip the confirmation prompt and
    //     open the form pre-filled. They've opted in once; don't
    //     re-ask.
    //   - Otherwise → show the small confirm overlay. Yes opens a
    //     blank form; No dismisses with no further backend call.
    //
    // Target identity:
    //   - Self mark: memberId is omitted; we use selfMemberId.value to
    //     find the just-saved record. travelTargetMemberId stays null
    //     so the modal save omits member_id (backend derives from JWT).
    //   - Admin mark: memberId is the explicit team_members.id of the
    //     teammate. travelTargetMemberId is set to that id so the
    //     modal save passes it through.
    if (status === 'going') {
      const lookupId = memberId ?? selfMemberId.value
      if (lookupId) {
        const target = result.members.find((m) => m.memberId === lookupId)
        const existing = readTravelInfo(target)
        travelTargetMemberId.value = memberId ?? null
        travelTargetName.value = target?.fullName ?? ''
        if (existing) {
          travelInitial.value = existing
          travelModalOpen.value = true
        } else {
          travelConfirmOpen.value = true
        }
      }
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Failed to update attendance',
      message: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'
    })
  } finally {
    attendanceSavingKey.value = null
  }
}

/**
 * Parse an attendee record's travel fields into the structured shape
 * the TravelArrangementsModal expects, OR null if every field is empty.
 * Empty/whitespace strings, null, undefined, and missing services list
 * all collapse to "no travel info". Counts come back from the API as
 * stringified numbers; we coerce via Number with NaN → null.
 */
function readTravelInfo(member: EventAttendanceMember | undefined) {
  if (!member) return null
  const services = (member.services ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const roomCount = member.roomCount && member.roomCount.trim() ? Number(member.roomCount) : null
  const adultCount = member.adultCount && member.adultCount.trim() ? Number(member.adultCount) : null
  const exactStartDate = member.exactStartDate && member.exactStartDate.trim() ? member.exactStartDate : null
  const exactEndDate = member.exactEndDate && member.exactEndDate.trim() ? member.exactEndDate : null
  const note = member.note && member.note.trim() ? member.note : null
  // Treat NaN counts as null — defensive against bad backend payloads.
  const safeRoom = Number.isFinite(roomCount as number) ? (roomCount as number) : null
  const safeAdult = Number.isFinite(adultCount as number) ? (adultCount as number) : null
  // null when literally everything is blank — caller uses this to
  // decide between "ask the user if they want to add info" vs "open
  // the form pre-filled".
  if (
    services.length === 0 &&
    safeRoom == null &&
    safeAdult == null &&
    !exactStartDate &&
    !exactEndDate &&
    !note
  ) {
    return null
  }
  return {
    services,
    roomCount: safeRoom,
    adultCount: safeAdult,
    exactStartDate,
    exactEndDate,
    note
  }
}

function onTravelConfirmYes() {
  travelConfirmOpen.value = false
  travelInitial.value = null // blank form
  travelModalOpen.value = true
}

function onTravelConfirmNo() {
  // Per spec: dismiss without any further backend call. Also wipe the
  // target refs so a subsequent self-mark / admin-mark doesn't inherit
  // stale "for {name}" context from this declined prompt.
  travelConfirmOpen.value = false
  travelTargetMemberId.value = null
  travelTargetName.value = ''
}

/** Apply the travel-form save response back into the page's attendance
 *  state so the target's card immediately reflects the new services /
 *  hotel info without a refetch. Mirrors the trust-the-response
 *  approach in onMarkAttendance. Also clears the targeting refs so the
 *  next open of the form doesn't accidentally inherit stale "for
 *  {name}" context from a previous admin-edit session. */
function onTravelSaved(result: { members: EventAttendanceMember[]; selfMemberId: string | null }) {
  teamAttendance.value = result.members
  travelModalOpen.value = false
  travelTargetMemberId.value = null
  travelTargetName.value = ''
  // No success toast — the modal closing + the right-column travel
  // summary updating in place already communicate the save. Errors
  // still surface via the catch block inside TravelArrangementsModal's
  // save() handler (warning toast). saveEventAttendance throws when
  // the response body's `statusCode` is anything other than 200, so
  // backend-reported failures land in that catch.
}

/** Open the travel form pre-filled for an arbitrary member — used by
 *  the "Edit travel info" / "Add travel info" link on each Going card.
 *  Self and admin paths share this single helper:
 *    - If the member is the logged-in user, travelTargetMemberId stays
 *      null so the save omits member_id (backend derives from JWT).
 *    - If the member is anyone else (admin path), the explicit
 *      member_id is recorded so the save persists against THAT
 *      teammate's record, not the admin's.
 *  Falls back to a blank initial when the member has no existing
 *  travel info, so toggling Hotel ON shows fresh defaults. */
function openTravelEditorFor(member: EventAttendanceMember) {
  if (!member.memberId) return
  const isSelf = member.memberId === selfMemberId.value
  travelInitial.value = readTravelInfo(member) ?? {
    services: [],
    roomCount: null,
    adultCount: null,
    exactStartDate: null,
    exactEndDate: null,
    note: null
  }
  travelTargetMemberId.value = isSelf ? null : member.memberId
  travelTargetName.value = member.fullName ?? ''
  travelModalOpen.value = true
}
const gameLineupStarters = computed(() =>
  gameLineupDraft.value
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
)
const gameLineupBench = computed(() =>
  gameLineupDraft.value
    .filter((player) => player.isBench && !player.isSubstitute)
    .slice()
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
)
const gameLineupSubstitutions = computed(() =>
  gameLineupDraft.value
    .filter((player) => player.isSubstitute || (!player.isBench && !player.isActive && !!player.exitedInning))
    .slice()
    .sort((left, right) => {
      const leftInning = left.enteredInning ?? left.exitedInning ?? 999
      const rightInning = right.enteredInning ?? right.exitedInning ?? 999
      return leftInning - rightInning || left.playerName.localeCompare(right.playerName)
    })
)
const gameSubstitutionTargets = computed(() =>
  gameLineupDraft.value
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
)
const gameLineupInningOptions = computed(() => Array.from({ length: 12 }, (_, index) => index + 1))
const gameLineupStatusMeta = computed(() => {
  return gameLineupSubmissionStatusMeta(gameLineupFormStatus.value)
})

function handleScroll() {
  condensedHeaderVisible.value = window.scrollY > 140
}

function openLineupModal() {
  lineupModalOpen.value = true
}

function normalizeGameLineupPlayers(players: GameLineupPlayer[]) {
  return players
    .map((player, index) => ({
      ...player,
      battingOrder: player.battingOrder || index + 1,
      positionCode: player.positionCode ?? null,
      isStarter: player.isBench ? false : player.isStarter,
      isBench: player.isBench,
      isSubstitute: player.isSubstitute ?? false,
      isActive: player.isActive ?? true,
      substitutesForId: player.substitutesForId ?? null,
      playerSourceType: player.playerSourceType ?? 'manual'
    }))
    .sort((left, right) => left.battingOrder - right.battingOrder)
}

function buildGameLineupFromTemplate(templateLineup: LineupPlayer[]): GameLineupPlayer[] {
  return templateLineup.map((player, index) => ({
    id: `draft-${player.id}`,
    eventLineupId: player.id,
    teamMemberId: player.teamMemberId ?? undefined,
    userId: player.userId ?? undefined,
    playerName: player.name,
    jerseyNumber: player.jerseyNumber,
    battingOrder: player.battingOrder ?? index + 1,
    positionCode: player.position?.trim() ? player.position : DEFAULT_GAME_LINEUP_POSITIONS[index] ?? 'EH',
    isStarter: player.status !== 'bench',
    isBench: player.status === 'bench',
    isSubstitute: false,
    isActive: true,
    substitutesForId: null,
    playerSourceType:
      player.teamMemberId != null || player.userId != null
        ? 'team_member'
        : player.playerSourceType ?? 'manual'
  }))
  .sort((left, right) => left.battingOrder - right.battingOrder)
}

function gameLineupPlayerLinkageLabel(player: GameLineupPlayer) {
  return player.teamMemberId || player.userId ? 'Linked teammate' : 'Manual Player'
}

function syncGameStarterState(players: GameLineupPlayer[]) {
  const orderedStarters = players
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
  const orderedBench = players
    .filter((player) => player.isBench)
    .slice()
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
  const orderedInactive = players
    .filter((player) => !player.isBench && !player.isActive)
    .slice()
    .sort((left, right) => {
      const leftOrder = left.exitedInning ?? left.battingOrder
      const rightOrder = right.exitedInning ?? right.battingOrder
      return leftOrder - rightOrder
    })

  let starterIndex = 0
  for (const player of orderedStarters) {
    starterIndex += 1
    player.isStarter = true
    player.isBench = false
    player.battingOrder = starterIndex
    if (!player.positionCode) {
      player.positionCode = DEFAULT_GAME_LINEUP_POSITIONS[starterIndex - 1] ?? 'EH'
    }
  }

  for (const [benchIndex, player] of orderedBench.entries()) {
    player.isStarter = false
    player.battingOrder = 90 + benchIndex + 1
    if (!player.positionCode) player.positionCode = 'EH'
  }

  players.splice(0, players.length, ...orderedStarters, ...orderedInactive, ...orderedBench)
}

function applyGameLineupFieldConfig(detail: GameLineupSubmissionDetail) {
  gameLineupFieldConfigName.value = detail.fieldConfig?.name ?? participation.value?.fieldConfigName ?? 'Slow Pitch 10 Player'
  gameLineupFieldPositions.value = detail.fieldConfig?.positions?.length
    ? detail.fieldConfig.positions
    : participation.value?.fieldConfigPositions?.length
      ? participation.value.fieldConfigPositions
      : DEFAULT_SLOW_PITCH_FIELD_POSITIONS
}

async function openGameLineupModal(game: GameSummary) {
  selectedGame.value = game
  gameLineupModalOpen.value = true
}

function closeGameLineupModal() {
  gameLineupModalOpen.value = false
}

function setGamePlayerBench(playerId: string, isBench: boolean) {
  const player = gameLineupDraft.value.find((entry) => entry.id === playerId)
  if (!player) return
  player.isBench = isBench
  player.isSubstitute = false
  player.substitutesForId = null
  player.enteredInning = null
  player.exitedInning = null
  player.isActive = !isBench
  player.positionCode = isBench ? 'EH' : player.positionCode ?? DEFAULT_GAME_LINEUP_POSITIONS[0]
  syncGameStarterState(gameLineupDraft.value)
}

function gameSubstituteLabel(playerId: string | null | undefined) {
  if (!playerId) return ''
  return gameLineupDraft.value.find((entry) => entry.id === playerId)?.playerName ?? ''
}

function prepareGameSubstitute(playerId: string) {
  const player = gameLineupDraft.value.find((entry) => entry.id === playerId)
  if (!player) return
  const existingDraft = gameSubstituteDrafts.value[playerId]
  gameSubstituteDrafts.value = {
    ...gameSubstituteDrafts.value,
    [playerId]: {
      targetId: existingDraft?.targetId ?? gameSubstitutionTargets.value[0]?.id ?? null,
      inning: existingDraft?.inning ?? 5,
      positionCode: existingDraft?.positionCode ?? player.positionCode ?? 'EH'
    }
  }
}

function applyGameSubstitute(playerId: string) {
  const substitute = gameLineupDraft.value.find((entry) => entry.id === playerId)
  const draft = gameSubstituteDrafts.value[playerId]
  if (!substitute || !draft?.targetId || !draft.inning) return
  const target = gameLineupDraft.value.find((entry) => entry.id === draft.targetId)
  if (!target) return

  target.isActive = false
  target.isStarter = false
  target.exitedInning = draft.inning

  substitute.isBench = false
  substitute.isSubstitute = true
  substitute.isActive = true
  substitute.enteredInning = draft.inning
  substitute.substitutesForId = target.id
  substitute.battingOrder = target.battingOrder
  substitute.positionCode = draft.positionCode ?? target.positionCode ?? 'EH'

  syncGameStarterState(gameLineupDraft.value)
  const { [playerId]: _removedDraft, ...remainingDrafts } = gameSubstituteDrafts.value
  gameSubstituteDrafts.value = remainingDrafts
}

function undoGameSubstitute(playerId: string) {
  const substitute = gameLineupDraft.value.find((entry) => entry.id === playerId)
  if (!substitute || !substitute.substitutesForId) return
  const target = gameLineupDraft.value.find((entry) => entry.id === substitute.substitutesForId)
  if (target) {
    target.isActive = true
    target.isStarter = true
    target.exitedInning = null
  }

  substitute.isBench = true
  substitute.isSubstitute = false
  substitute.isActive = false
  substitute.enteredInning = null
  substitute.substitutesForId = null
  substitute.positionCode = 'EH'
  syncGameStarterState(gameLineupDraft.value)
}

function onGameLineupDragStart(event: DragEvent, playerId: string) {
  draggedGameLineupPlayerId.value = playerId
  gameLineupDropTargetId.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', playerId)
  }
}

function onGameLineupDragEnd() {
  draggedGameLineupPlayerId.value = null
  gameLineupDropTargetId.value = null
}

function onGameLineupDragOver(event: DragEvent, targetPlayerId: string) {
  event.preventDefault()
  gameLineupDropTargetId.value = targetPlayerId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function moveGameStarterTo(event: DragEvent, targetPlayerId: string) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/plain') || draggedGameLineupPlayerId.value
  if (!draggedId || draggedId === targetPlayerId) return

  const starters = gameLineupDraft.value
    .filter((player) => !player.isBench)
    .sort((left, right) => left.battingOrder - right.battingOrder)
  const draggedIndex = starters.findIndex((player) => player.id === draggedId)
  const targetIndex = starters.findIndex((player) => player.id === targetPlayerId)
  if (draggedIndex < 0 || targetIndex < 0) return

  const reordered = starters.slice()
  const [draggedPlayer] = reordered.splice(draggedIndex, 1)
  reordered.splice(targetIndex, 0, draggedPlayer)

  reordered.forEach((player, index) => {
    player.battingOrder = index + 1
  })
  syncGameStarterState(gameLineupDraft.value)
  draggedGameLineupPlayerId.value = null
  gameLineupDropTargetId.value = null
}

function availableGamePositions(forPlayerId: string) {
  const taken = new Set(
    gameLineupDraft.value
      .filter((player) => !player.isBench && player.id !== forPlayerId)
      .map((player) => player.positionCode)
      .filter(Boolean)
  )
  return gameLineupFieldPositions.value.filter(
    (position) => position.code === 'EH' || !taken.has(position.code)
  )
}

async function saveApprovedGameLineup() {
  if (!selectedGame.value) return
  gameLineupSaving.value = true
  try {
    const normalizedPlayers = normalizeGameLineupPlayers(gameLineupDraft.value)
    syncGameStarterState(normalizedPlayers)
    const timestamp = new Date().toISOString()
    const nextSubmission: GameLineupSubmission = {
      id: gameLineupSubmissionId.value,
      status: gameLineupFormStatus.value,
      approvalMode: 'manual',
      sourceType: 'manual',
      submittedAt: timestamp,
      rejectionReason: null,
      notes: gameLineupFormNotes.value.trim(),
      players: normalizedPlayers
    }
    const savedSubmission = await saveGameLineupSubmission(selectedGame.value.id, participation.value?.teamId ?? '', nextSubmission)
    gameLineupSubmissionId.value = savedSubmission.id ?? null
    gameLineupDraft.value = normalizeGameLineupPlayers(savedSubmission.players)
    gameLineupFormStatus.value = savedSubmission.status
    if (participation.value) {
      participation.value.games = participation.value.games.map((game) =>
        game.id === selectedGame.value?.id ? { ...game, lineupSubmitted: ['submitted', 'approved', 'finalized'].includes(savedSubmission.status) } : game
      )
    }
    pushToast({
      tone: 'success',
      title: 'Lineup submitted',
      message: 'The game lineup submission was saved successfully.'
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Unable to submit lineup',
      message: error instanceof Error ? error.message : 'Something went wrong while saving the game lineup submission.'
    })
  } finally {
    gameLineupSaving.value = false
  }
}

function onGameLineupSaved(_savedSubmission: GameLineupSubmission) {
  if (!participation.value) return
  const savedGameId = selectedGame.value?.id
  if (!savedGameId) return
  // The save handler only runs when the PATCH resolved without throwing —
  // i.e. the backend confirmed a submission exists. That's the contract the
  // pill actually tracks (presence of a submission, not its approval-
  // workflow status label). Flip the pill immediately so the card reflects
  // the save without waiting for a page refresh.
  participation.value.games = participation.value.games.map((game) =>
    game.id === savedGameId ? { ...game, lineupSubmitted: true } : game
  )
}

function handleDocumentClick(event: MouseEvent) {
  const target = event.target as Element | null
  const clickedScheduleMenu = !!(target?.closest('.participation-v2__card-menu-anchor') || target?.closest('.participation-v2__card-menu-panel'))

  if (scheduleCardMenuOpenId.value && !clickedScheduleMenu) {
    scheduleCardMenuOpenId.value = null
  }
}

async function load() {
  participationLoading.value = true
  try {
    let nextParticipation
    try {
      nextParticipation = await fetchTeamParticipation(
        teamParticipationId.value ?? ''
      )
    } catch (err) {
      if (err instanceof ParticipationNotFoundError) {
        // Backend signalled a non-200 envelope (missing participation,
        // unauthorized, etc.). Route the user to NotFoundView so they see
        // a friendly "this page isn't available" page instead of a broken
        // participation shell. The other sub-fetches below are skipped.
        router.replace({ name: 'not-found' })
        return
      }
      throw err
    }

    participation.value = nextParticipation

    // Kick off the team roster fetch in parallel — drives the teammate
    // dropdown in the Event Lineup and Game Lineup modals. Uses the team's
    // GUID (not the numeric team_id) per the /chat/getTeamMembers contract.
    const teamMembersPromise = nextParticipation.teamGuid
      ? fetchTeamMembers(nextParticipation.teamGuid).then((members) => {
          teamMembers.value = members
        })
      : Promise.resolve()

    gamesLoading.value = true
    const gamesPromise = fetchParticipationGames(
        nextParticipation,
        nextParticipation.teamId ?? '',
        nextParticipation.tournamentId,
        nextParticipation.tournamentGuid
      )
    const attendancePromise = loadAttendance()
    void teamMembersPromise

    nextParticipation.games = await gamesPromise
    participation.value = { ...nextParticipation }
    gamesLoading.value = false
    void attendancePromise

    if (nextParticipation.tournamentId) {
      divisionLoading.value = true
      try {
        const divisionOverview = await fetchDivisionOverviewStandings(
          nextParticipation.tournamentGuid ?? ''
        )

        nextParticipation.divisionOverview = {
          ...divisionOverview,
          bracketName: nextParticipation.divisionOverview.bracketName || nextParticipation.division
        }
        participation.value = { ...nextParticipation }
      } catch {
        nextParticipation.divisionOverview = {
          ...nextParticipation.divisionOverview,
          tieBreakerText: '',
          formatText: '',
          podium: [],
          standings: [],
          isSeedGenerated: false
        }
        participation.value = { ...nextParticipation }
      } finally {
        divisionLoading.value = false
      }
    } else {
      divisionLoading.value = false
    }
    participationLoading.value = false
  } finally {
    participationLoading.value = false
    gamesLoading.value = false
    divisionLoading.value = false
  }

  // Fetch the weather forecast AFTER everything else has settled. Placed
  // outside the try/finally so it only fires once the primary page data
  // (participation, division, games, attendance) has finished loading.
  // Backed by the legacy /event/getApiWeatherData endpoint — no API key
  // on the client. Any failure is swallowed and the strip stays hidden.
  void loadWeather()
}

/** Fetch weather for the current event via /event/getApiWeatherData.
 *  No-op when the event is outside the visibility window (today outside
 *  [start−5 days, end]) or when we don't have an event id. The backend
 *  endpoint takes just the numeric event_id and handles WeatherAPI/coords
 *  on the server side. */
async function loadWeather() {
  weatherForecast.value = []
  const dev = import.meta.env.DEV
  const p = participation.value
  if (dev) {
    // eslint-disable-next-line no-console
    console.log('[weather] loadWeather() checks:', {
      hasParticipation: !!p,
      eventId: p?.eventId,
      eventStartDate: p?.eventStartDate,
      eventEndDate: p?.eventEndDate,
      weatherWindowOpen: weatherWindowOpen.value
    })
  }
  if (!weatherWindowOpen.value) {
    if (dev) console.log('[weather] skipped — visibility window is closed (or event start/end dates are missing)')
    return
  }
  const eventId = p?.eventId
  if (!eventId) {
    if (dev) console.log('[weather] skipped — no eventId on participation')
    return
  }
  if (dev) console.log('[weather] calling /event/getApiWeatherData with event_id =', eventId)
  const result = await fetchEventWeather(eventId)
  if (dev) console.log('[weather] response →', result ? `${result.length} day(s)` : 'null (failed or empty)')
  if (result && result.length > 0) weatherForecast.value = result
}

function onEventLineupSaved(saved: LineupPlayer[]) {
  if (!participation.value) return
  participation.value.lineup = saved
  participation.value.participationStatus = 'confirmed'
  // Mirror the structured shape the backend now returns so the side-panel
  // "Event Lineup" card reflects the save immediately without a refetch.
  participation.value.eventOverview.lineupSummary = saved.map((p) => ({
    userId: p.userId ?? undefined,
    jerseyNumber: p.jerseyNumber ?? '',
    name: p.name ?? '',
    position: p.position ?? '',
    isStarter: p.status === 'active',
    isActive: p.status === 'active',
    isBench: p.status === 'bench'
  }))
}

onMounted(load)
watch(teamParticipationId, (newId, oldId) => {
  if (newId && newId !== oldId) void load()
})
onMounted(() => {
  handleScroll()
  window.addEventListener('scroll', handleScroll, { passive: true })
  document.addEventListener('click', handleDocumentClick)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
  document.removeEventListener('click', handleDocumentClick)
})
</script>

<template>
  <main v-if="participationLoading && !participation" class="participation-v2">
    <div class="page-shell participation-v2__shell page-shell--loading">
      <section class="hero participation-skeleton participation-v2__hero-skeleton">
        <div class="hero__main">
          <div class="participation-skeleton__eyebrow shimmer-block"></div>
          <div class="participation-skeleton__badges">
            <div class="participation-skeleton__badge shimmer-block"></div>
            <div class="participation-skeleton__badge shimmer-block"></div>
          </div>
          <div class="participation-skeleton__team-row">
            <div class="participation-skeleton__avatar shimmer-circle"></div>
            <div class="participation-skeleton__headline shimmer-block"></div>
          </div>
          <div class="participation-skeleton__line shimmer-block"></div>
          <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
          <div class="hero-strip">
            <div class="participation-skeleton__action shimmer-block"></div>
            <div class="participation-skeleton__action shimmer-block"></div>
            <div class="participation-skeleton__action shimmer-block"></div>
          </div>
        </div>
        <div class="hero-status">
          <div class="hero-manager-card participation-skeleton__manager">
            <div class="participation-skeleton__manager-label shimmer-block"></div>
            <div class="participation-skeleton__manager-line shimmer-block"></div>
            <div class="participation-skeleton__manager-line shimmer-block"></div>
            <div class="participation-skeleton__manager-line shimmer-block"></div>
          </div>
        </div>
      </section>

      <section class="summary-grid">
        <div v-for="index in 5" :key="`summary-${index}`" class="summary-card participation-skeleton">
          <div class="summary-card__top">
            <div class="participation-skeleton__summary-label shimmer-block"></div>
            <div class="participation-skeleton__summary-icon shimmer-circle"></div>
          </div>
          <div class="participation-skeleton__summary-value shimmer-block"></div>
          <div class="participation-skeleton__summary-hint shimmer-block"></div>
        </div>
      </section>

      <section class="content-grid participation-v2__content-grid">
        <div class="stack participation-v2__games-column">
          <div class="panel panel--games participation-v2__games-panel">
            <div class="games-stack participation-skeleton">
              <section v-for="groupIndex in 2" :key="`game-group-${groupIndex}`" class="games-day-group">
                <div class="participation-skeleton__day-title shimmer-block"></div>
                <div class="games-grid games-grid--boxscore participation-v2__games-list">
                  <div
                    v-for="cardIndex in 2"
                    :key="`game-card-${groupIndex}-${cardIndex}`"
                    class="boxscore-card participation-skeleton__game-card participation-v2__game-card"
                  >
                    <div class="participation-skeleton__game-top">
                      <div class="participation-skeleton__game-pool shimmer-block"></div>
                      <div class="participation-skeleton__game-badges">
                        <div class="participation-skeleton__badge shimmer-block"></div>
                        <div class="participation-skeleton__badge shimmer-block"></div>
                      </div>
                    </div>
                    <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
                    <div
                      v-for="teamIndex in 2"
                      :key="`game-team-${groupIndex}-${cardIndex}-${teamIndex}`"
                      class="participation-skeleton__game-team"
                    >
                      <div class="participation-skeleton__avatar shimmer-circle"></div>
                      <div class="participation-skeleton__game-team-line shimmer-block"></div>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>

        <aside class="side-panel participation-v2__sidebar">
          <div class="panel panel--accent participation-skeleton participation-skeleton__side-card">
            <div class="participation-skeleton__side-row" v-for="rowIndex in 2" :key="`side-row-${rowIndex}`">
              <div class="participation-skeleton__side-icon shimmer-circle"></div>
              <div class="participation-skeleton__side-copy">
                <div class="participation-skeleton__side-title shimmer-block"></div>
                <div class="participation-skeleton__side-line shimmer-block"></div>
              </div>
            </div>
            <div class="participation-skeleton__line shimmer-block"></div>
            <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
          </div>

          <div class="panel participation-skeleton participation-skeleton__side-card participation-v2__division-card">
            <div class="participation-skeleton__eyebrow shimmer-block"></div>
            <div class="participation-skeleton__headline participation-skeleton__headline--medium shimmer-block"></div>
            <div class="participation-skeleton__line shimmer-block"></div>
            <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
            <div class="participation-skeleton__standing" v-for="standingIndex in 4" :key="`standing-${standingIndex}`">
              <div class="participation-skeleton__standing-stats shimmer-block"></div>
              <div class="participation-skeleton__avatar shimmer-circle"></div>
              <div class="participation-skeleton__standing-copy">
                <div class="participation-skeleton__side-line shimmer-block"></div>
                <div class="participation-skeleton__side-line participation-skeleton__side-line--short shimmer-block"></div>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  </main>

  <main v-else-if="participation" class="participation-v2">
    <section class="condensed-team-header" :class="{ 'condensed-team-header--visible': condensedHeaderVisible }">
      <div class="condensed-team-header__main">
        <div class="condensed-team-header__top">
          <TeamAvatar :name="participation.teamName" :image-url="participation.teamAvatarUrl" size="md" />
          <span class="condensed-team-header__name">{{ participation.teamName }}</span>
          <div class="condensed-team-header__badges">
            <StatusBadge
              :label="participationBadgeLabel(participation.participationStatus)"
              :tone="participationTone(participation.participationStatus)"
            />
            <StatusBadge
              :label="`Fee ${formatFeeStatusLabel(participation.feeStatus)}`"
              :tone="registrationTone(participation.feeStatus)"
            />
          </div>
        </div>
        <div class="condensed-team-header__subline">{{ condensedSubline }}</div>
      </div>
      <div class="condensed-team-header__meta">
        <div class="condensed-team-header__manager-row">
          <span class="condensed-team-header__meta-label">Team Manager</span>
          <strong class="condensed-team-header__meta-value">{{ participation.manager.name }}</strong>
        </div>
      </div>
    </section>
    <div class="page-shell participation-v2__shell">
    <section class="hero">
      <div class="hero__main">
        <div class="hero-title-row">
          <p class="eyebrow">Team Participation</p>
          <div class="hero-inline-badges">
            <StatusBadge
              :label="participationBadgeLabel(participation.participationStatus)"
              :tone="participationTone(participation.participationStatus)"
            />
            <StatusBadge
              :label="`Fee ${formatFeeStatusLabel(participation.feeStatus)}`"
              :tone="registrationTone(participation.feeStatus)"
            />
          </div>
        </div>
        <div class="team-heading">
          <TeamAvatar :name="participation.teamName" :image-url="participation.teamAvatarUrl" size="lg" />
          <h1>{{ participation.teamName }}</h1>
        </div>
        <p v-if="heroTeamMetaText" class="hero-team-meta">{{ heroTeamMetaText }}</p>
        <p class="hero-copy">{{ participation.division }} - {{ participation.eventName }}</p>
        <p class="hero-copy">{{ participation.eventDate }}</p>
        <!-- Hero action strip (Message Team / Team Statistics / View Complete
             Schedule). Hidden for now via v-if="false"; planned for future
             wiring so the markup is intentionally preserved rather than
             deleted. -->
        <div v-if="false" class="hero-strip">
          <span class="hero-strip__item">Message Team</span>
          <span class="hero-strip__item">Team Statistics</span>
          <span class="hero-strip__item">View Complete Schedule</span>
        </div>
      </div>
      <div class="hero-status">
        <div class="hero-manager-card">
          <span class="hero-manager-card__label">Team Manager</span>
          <span class="hero-manager-card__name">{{ participation.manager.name }}</span>
          <span class="hero-manager-card__meta-item">
            <img :src="mobileIcon" alt="" class="hero-manager-card__meta-icon" />
            {{ participation.manager.phone }}
          </span>
          <span class="hero-manager-card__meta-item">
            <img :src="emailIcon" alt="" class="hero-manager-card__meta-icon" />
            {{ participation.manager.email }}
          </span>
        </div>
      </div>
    </section>

    <section v-if="gamesLoading" class="summary-grid">
      <div v-for="index in 5" :key="`summary-live-${index}`" class="summary-card participation-skeleton">
        <div class="summary-card__top">
          <div class="participation-skeleton__summary-label shimmer-block"></div>
          <div class="participation-skeleton__summary-icon shimmer-circle"></div>
        </div>
        <div class="participation-skeleton__summary-value shimmer-block"></div>
        <div class="participation-skeleton__summary-hint shimmer-block"></div>
      </div>
    </section>
    <section v-else class="summary-grid">
      <SummaryCard title="Total Games" :value="String(totalGames)" hint="Tournament schedule" :icon-src="totalGamesIcon" />
      <SummaryCard title="Total Won" :value="String(wonGames)" hint="Completed wins" :icon-src="totalWonIcon" />
      <SummaryCard title="Total Lost" :value="String(lostGames)" hint="Completed losses" :icon-src="totalLostIcon" />
      <SummaryCard title="Active Games" :value="String(activeGames)" hint="Scheduled or live" :icon-src="activeGamesIcon" />
      <SummaryCard title="Statistics" :value="String(mappedSheets)" hint="Published to team stats" :icon-src="statisticsIcon" />
    </section>

    <section class="content-grid participation-v2__content-grid">
      <div class="stack participation-v2__games-column">
        <div class="panel panel--games participation-v2__games-panel">
          <div v-if="gamesLoading" class="games-stack participation-skeleton">
            <section v-for="groupIndex in 2" :key="`partial-game-group-${groupIndex}`" class="games-day-group">
              <div class="participation-skeleton__day-title shimmer-block"></div>
              <div class="games-grid games-grid--boxscore participation-v2__games-list">
                <div v-for="cardIndex in 2" :key="`partial-game-card-${groupIndex}-${cardIndex}`" class="boxscore-card participation-skeleton__game-card participation-v2__game-card">
                  <div class="participation-skeleton__game-top">
                    <div class="participation-skeleton__game-pool shimmer-block"></div>
                    <div class="participation-skeleton__game-badges">
                      <div class="participation-skeleton__badge shimmer-block"></div>
                      <div class="participation-skeleton__badge shimmer-block"></div>
                    </div>
                  </div>
                  <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
                  <div class="participation-skeleton__game-team" v-for="teamIndex in 2" :key="`partial-game-team-${groupIndex}-${cardIndex}-${teamIndex}`">
                    <div class="participation-skeleton__avatar shimmer-circle"></div>
                    <div class="participation-skeleton__game-team-line shimmer-block"></div>
                  </div>
                </div>
              </div>
            </section>
          </div>
          <div v-else-if="!groupedGames.length" class="participation-v2__games-empty">
            <h3 class="participation-v2__games-empty-title">No games scheduled yet</h3>
            <p class="participation-v2__games-empty-copy">
              Once the organizer publishes the tournament schedule, each of your games will appear here with times, opponents, field assignments, and a shortcut to the scoresheet.
            </p>
          </div>
          <div v-else class="games-stack">
            <section v-for="group in groupedGames" :key="group.label" class="games-day-group">
              <div class="participation-v2__day-heading">
                <h3 class="games-day-title participation-v2__day-title">{{ group.label }}</h3>
                <span class="participation-v2__day-count">{{ group.games.length }} games</span>
              </div>
              <div class="games-grid games-grid--boxscore participation-v2__games-list">
                <div
                  v-for="game in group.games"
                  :key="game.id"
                  class="participation-v2__timeline-item"
                >
                  <div class="participation-v2__timeline-slot">
                    <div class="participation-v2__timeline-slot-stack">
                      <span
                        class="participation-v2__timeline-time"
                        :data-tone="timelineSlotTone(game)"
                      >
                        <span class="participation-v2__timeline-time-main">{{ timelineSlotLabel(game) }}</span>
                        <span v-if="timelineSlotSubLabel(game)" class="participation-v2__timeline-time-sub">
                          {{ timelineSlotSubLabel(game) }}
                        </span>
                      </span>
                      <span v-if="timelineDelayReason(game)" class="participation-v2__timeline-delay-text">
                        {{ timelineDelayReason(game) }}
                      </span>
                    </div>
                  </div>
                  <div class="participation-v2__timeline-rail" aria-hidden="true">
                    <span class="participation-v2__timeline-dot" :data-tone="timelineDotTone(game)"></span>
                  </div>
                  <RouterLink
                    class="participation-v2__timeline-card participation-v2__timeline-card--link"
                    :to="{ name: 'scoresheet', params: { participationId: participation?.eventJoinedTeamId ?? teamParticipationId ?? '', teamId: participation?.teamId ?? '', gameGuid: game.guid ?? String(game.id) } }"
                  >
                    <article class="participation-v2__schedule-card">
                      <!-- First row of the card: game label on the left,
                           ellipsis menu button on the right. Always two
                           columns on every screen size so the button is
                           predictable. Meta (time, field) is a separate
                           section below so it never pushes the ellipsis
                           out of this row. -->
                      <div class="participation-v2__schedule-head">
                        <div class="participation-v2__schedule-kicker">
                          <span class="participation-v2__schedule-label">{{ game.bracketLabel }}</span>
                        </div>

                        <div
                          v-if="participation.isAdmin"
                          class="participation-v2__schedule-actions"
                          @click.stop.prevent
                        >
                          <button
                            class="participation-v2__card-menu-anchor ellipsis-button ellipsis-button--sm"
                            type="button"
                            @click="scheduleCardMenuOpenId = scheduleCardMenuOpenId === game.id ? null : game.id"
                          >
                            <AppIcon name="ellipsis" :size="16" />
                          </button>
                          <div
                            v-if="scheduleCardMenuOpenId === game.id"
                            class="menu-panel menu-panel--boxscore participation-v2__card-menu-panel"
                          >
                            <button
                              class="menu-link menu-link--button"
                              type="button"
                              @click="scheduleCardMenuOpenId = null; openGameLineupModal(game)"
                            >
                              Lineup
                            </button>
                          </div>
                        </div>
                      </div>

                      <!-- Meta: time, field. Sits as its own row under the
                           head row so wrapping content (multi-line
                           venue, etc.) never affects the ellipsis position. -->
                      <div class="participation-v2__schedule-meta">
                        <span v-if="!isUnscheduledGame(game) && showStartedGameMeta(game)" class="participation-v2__schedule-meta-item participation-v2__schedule-meta-item--time">
                          <img :src="timerStartIcon" alt="" class="participation-v2__schedule-meta-icon participation-v2__schedule-meta-icon--time" />
                          <span class="participation-v2__schedule-meta-copy">
                            <span class="participation-v2__schedule-meta-inline">
                              <span>{{ scheduleStartedMetaLabel(game) }}</span>
                              <span
                                v-if="scheduleStartVarianceLabel(game)"
                                class="participation-v2__schedule-meta-inline-note"
                                :data-tone="scheduleStartVarianceTone(game)"
                              >
                                {{ scheduleStartVarianceLabel(game) }}
                              </span>
                            </span>
                            <span v-if="scheduleTimeLimitLabel(game)" class="participation-v2__schedule-meta-subline">
                              {{ scheduleTimeLimitLabel(game) }}
                            </span>
                          </span>
                        </span>
                        <span v-if="scheduleVenueLabel(game)" class="participation-v2__schedule-meta-item">
                          <img :src="fieldLineIcon" alt="" class="participation-v2__schedule-meta-icon" />
                          <span class="participation-v2__schedule-meta-copy">
                            <span>{{ scheduleVenueLabel(game) }}</span>
                          </span>
                        </span>
                      </div>

                      <div class="participation-v2__status-row">
                        <span class="participation-v2__status-chip" :data-tone="scheduleLineupTone(game)">
                          {{ game.lineupSubmitted ? 'Lineup submitted' : 'Lineup pending' }}
                        </span>
                        <span class="participation-v2__status-chip" :data-tone="scheduleScoresheetTone(game)">
                          {{ scheduleScoresheetLabel(game) }}
                        </span>
                      </div>

                      <div class="participation-v2__matchup-shell">
                        <div class="participation-v2__matchup-list" :class="{ 'participation-v2__matchup-list--scheduled': !!scheduleRightSummary(game) }">
                          <div
                            v-for="row in scheduleRows(game)"
                            :key="`${game.id}-${row.key}`"
                            class="participation-v2__team-row"
                          >
                            <div class="participation-v2__team-identity">
                              <TeamAvatar :name="row.name" :image-url="row.imageUrl" size="md" />
                              <div class="participation-v2__team-copy">
                                <span class="participation-v2__team-name" :class="{ 'participation-v2__team-name--winner': row.won }">
                                  {{ row.seed ?? '' }}: {{ row.name }}
                                </span>
                              </div>
                            </div>
                            <div v-if="!scheduleRightSummary(game)" class="participation-v2__team-score" :class="{ 'participation-v2__team-score--winner': row.won }">
                              <span v-if="row.won" class="participation-v2__team-score-cup" aria-hidden="true"></span>
                              {{ row.score }}
                            </div>
                          </div>
                        </div>

                        <div v-if="scheduleRightSummary(game)" class="participation-v2__schedule-summary">
                          {{ scheduleRightSummary(game) }}
                        </div>
                      </div>
                    </article>
                  </RouterLink>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <aside class="side-panel participation-v2__side-panel">
        <div class="participation-v2__side-rail">
        <div class="panel panel--accent event-overview-card participation-v2__overview-card">
          <div class="event-overview-card__row">
            <img :src="jerseyIcon" alt="" class="event-overview-card__row-icon event-overview-card__row-icon--jersey" />
            <div class="event-overview-card__text">
              <!-- Title on the left, admin-only "Manage Lineup" primary
                   CTA on the right. Replaces the former hero 3-dot menu:
                   co-locating the action with the lineup itself makes the
                   affordance obvious while the manager is reviewing who's
                   in the lineup. -->
              <div class="event-overview-card__title-row">
                <span class="event-overview-card__title">Event Lineup</span>
                <button
                  v-if="participation.isAdmin"
                  class="ledger-action-button event-overview-card__cta-button"
                  type="button"
                  @click="openLineupModal"
                >
                  Manage Lineup
                </button>
              </div>
              <template v-if="hasLineupSubmitted">
                <span v-if="lineupStartersText">{{ lineupStartersText }}</span>
                <span v-if="lineupBenchText">
                  <strong class="event-roster__bench-label">Benched</strong> {{ lineupBenchText }}
                </span>
              </template>
              <span v-else>No lineup submitted for this event yet.</span>
            </div>
          </div>

          <div v-if="hasEventOverviewForecast" class="event-overview-card__forecast">
            <div
              v-for="day in weatherForecast"
              :key="day.label"
              class="event-overview-card__forecast-day"
            >
              <!-- Row 1: date label, e.g. "Mon, Apr 12" -->
              <span class="event-overview-card__forecast-label">{{ day.label }}</span>

              <!-- Row 2: WeatherAPI condition icon (falls back to emoji for
                   mock data without an iconUrl) -->
              <span class="event-overview-card__forecast-icon">
                <img
                  v-if="day.iconUrl"
                  :src="day.iconUrl"
                  :alt="day.conditionText ?? ''"
                  class="event-overview-card__forecast-img"
                  width="40"
                  height="40"
                  loading="lazy"
                />
                <span v-else-if="day.icon === 'sun'">☀️</span>
                <span v-else-if="day.icon === 'rain'">🌧️</span>
                <span v-else>⛅</span>
              </span>

              <!-- Row 3: min / max temperature in Fahrenheit -->
              <span class="event-overview-card__forecast-temps">
                {{ day.low }}° / {{ day.high }}°F
              </span>
            </div>
          </div>

          <div class="event-overview-card__footer">
            <!-- Three mutually exclusive states:
                 1. Loading — single "Loading..." button, matches the right-side
                    CTA being hidden so both halves resolve together.
                 2. No one going — empty-state copy with an admin-only "View
                    Attendance" link stacked beneath it.
                 3. At least one going — avatar preview + "X going" link. -->
            <div
              v-if="attendanceLoading"
              class="event-overview-card__attendees"
            >
              <button class="event-overview-card__attendee-link" type="button" @click="openAttendanceModal">
                Loading...
              </button>
            </div>
            <div
              v-else-if="goingAttendees.length === 0"
              class="event-overview-card__attendees event-overview-card__attendees--empty"
            >
              <span class="event-overview-card__attendees-empty-text">
                No one's joined yet &mdash; be the first.
              </span>
              <!-- Visible to all teammates so anyone can open the attendance
                   modal and see who's going / not going / maybe. Marking
                   OTHER teammates' attendance is still admin-only and is
                   gated inside the modal on the per-card Edit/Mark buttons. -->
              <button
                class="event-overview-card__attendee-link"
                type="button"
                @click="openAttendanceModal"
              >
                View Team Attendance
              </button>
            </div>
            <div
              v-else
              class="event-overview-card__attendees event-overview-card__attendees--stacked"
            >
              <div class="event-overview-card__attendees-row">
                <TeamAvatar
                  v-for="attendee in attendeePreview"
                  :key="`attendee-preview-${attendee.id}`"
                  :name="attendee.fullName"
                  :image-url="attendee.profileAvatar"
                  size="attendee"
                />
                <button class="event-overview-card__attendee-link" type="button" @click="openAttendanceModal">
                  {{ attendanceCountLabel(goingAttendees.length) }}
                </button>
              </div>
              <!-- Explicit "View Team Attendance" link on its own row, flush-left
                   below the avatar+count row so teammates can discover the
                   full modal (going / not going / maybe / not responded)
                   rather than just the going subset the avatars preview. -->
              <button class="event-overview-card__attendee-link" type="button" @click="openAttendanceModal">
                View Team Attendance
              </button>
            </div>
            <!-- Self RSVP CTA — collapsed: single light button showing the
                 user's current status (or "Are you going?" when unmarked).
                 Expanded: three options with the current one highlighted. On
                 a successful save the CTA auto-collapses so the button
                 reflects the new status at a glance. Hidden while attendance
                 is loading so it comes in alongside the "X going" label on
                 the left (otherwise the button would flash "Are you going?"
                 before the listing finished and self-status could resolve). -->
            <div v-if="!attendanceLoading" class="event-overview-card__rsvp-wrap">
              <span class="event-overview-card__rsvp-eyebrow">Your Attendance</span>
              <button
                v-if="!rsvpExpanded"
                class="event-overview-card__cta"
                :class="{ 'event-overview-card__cta--going': selfAttendance && selfAttendance.status === 'going' }"
                type="button"
                @click="toggleRsvpExpanded"
              >
                {{ selfAttendance ? attendanceStatusLabel(selfAttendance.status) : 'Are you going?' }}
              </button>
              <div v-else class="event-overview-card__cta-group">
                <button
                  v-for="option in attendanceSelfOptions"
                  :key="option.status"
                  type="button"
                  class="event-overview-card__cta-option"
                  :class="{ 'event-overview-card__cta-option--active': selfAttendance && selfAttendance.status === option.status }"
                  :disabled="anyAttendanceSaving"
                  @click="onSelfRsvpSelect(option.status)"
                >
                  <span v-if="isAttendanceSaving('self') && (!selfAttendance || selfAttendance.status !== option.status)">{{ option.label }}</span>
                  <span v-else-if="isAttendanceSaving('self')">Saving...</span>
                  <span v-else>{{ option.label }}</span>
                </button>
                <button
                  type="button"
                  class="event-overview-card__cta-close"
                  :disabled="anyAttendanceSaving"
                  aria-label="Close attendance options"
                  @click="rsvpExpanded = false"
                >
                  <AppIcon name="close" :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-if="divisionLoading" class="panel participation-skeleton participation-skeleton__side-card participation-v2__division-card">
          <div class="participation-skeleton__eyebrow shimmer-block"></div>
          <div class="participation-skeleton__headline participation-skeleton__headline--medium shimmer-block"></div>
          <div class="participation-skeleton__line shimmer-block"></div>
          <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
          <div class="participation-skeleton__standing" v-for="standingIndex in 4" :key="`partial-standing-${standingIndex}`">
            <div class="participation-skeleton__standing-stats shimmer-block"></div>
            <div class="participation-skeleton__avatar shimmer-circle"></div>
            <div class="participation-skeleton__standing-copy">
              <div class="participation-skeleton__side-line shimmer-block"></div>
              <div class="participation-skeleton__side-line participation-skeleton__side-line--short shimmer-block"></div>
            </div>
          </div>
        </div>
        <div v-else class="panel participation-v2__division-card">
          <p class="eyebrow">Division Overview</p>
          <h2>{{ divisionOverviewTitle }}</h2>

          <div v-if="hasDivisionTieBreakerText || hasDivisionFormatText" class="division-rule-list">
            <div v-if="hasDivisionTieBreakerText" class="division-rule-row">
              <img :src="seedIcon" alt="" class="division-rule-row__icon" />
              <span>{{ participation.divisionOverview.tieBreakerText }}</span>
            </div>
            <div v-if="hasDivisionFormatText" class="division-rule-row">
              <img :src="boxscoreIcon" alt="" class="division-rule-row__icon" />
              <span>{{ participation.divisionOverview.formatText }}</span>
            </div>
          </div>

          <div v-if="participation.divisionOverview.podium.length" class="division-podium">
            <div
              v-for="entry in participation.divisionOverview.podium"
              :key="entry.rankLabel"
              class="division-podium__row"
            >
              <TeamAvatar :name="entry.teamName" :image-url="entry.imageUrl" size="sm" />
              <div class="division-podium__text">
                <div class="division-podium__title">
                  <strong>{{ entry.rankLabel }}</strong>
                  <span>{{ entry.teamName }}</span>
                </div>
                <span v-if="entry.runsDifferential || entry.bracketRecord" class="division-podium__kpi">
                  <template v-if="entry.runsDifferential">RD {{ entry.runsDifferential }}</template>
                  <template v-if="entry.runsDifferential && entry.bracketRecord"> - </template>
                  <template v-if="entry.bracketRecord">Bracket {{ entry.bracketRecord }}</template>
                </span>
              </div>
            </div>
          </div>

          <div
            v-if="hasDivisionStandings"
            class="division-standings"
            :class="{ 'division-standings--no-seed': !participation.divisionOverview.isSeedGenerated }"
          >
            <div class="division-standings__header">
              <span v-if="participation.divisionOverview.isSeedGenerated">Seed</span>
              <span>Win</span>
              <span>Loss</span>
            </div>

            <div
              v-for="entry in participation.divisionOverview.standings"
              :key="`${entry.seed}-${entry.teamName}`"
              class="division-standings__row"
            >
              <span v-if="participation.divisionOverview.isSeedGenerated">{{ entry.seed }}</span>
              <span>{{ entry.wins }}</span>
              <span>{{ entry.losses }}</span>
              <div class="division-standings__team">
                <TeamAvatar :name="entry.teamName" :image-url="entry.imageUrl" size="md" />
                <div class="division-standings__copy">
                  <strong>{{ entry.teamName }}</strong>
                  <span>{{ entry.teamMeta }}</span>
                  <span>{{ entry.location }}</span>
                </div>
              </div>
            </div>
          </div>

          <p v-else class="panel-copy">Division teams are not available for this tournament yet.</p>
        </div>
        </div>
      </aside>
    </section>

    <div v-if="attendanceModalOpen" class="modal-backdrop" @click.self="closeAttendanceModal">
      <section class="modal-card participation-v2__attendance-modal">
        <div class="modal-card__header participation-v2__attendance-header">
          <div>
            <p class="eyebrow">Team Attendance</p>
            <h2>{{ participation.teamName }}</h2>
            <p class="panel-copy participation-v2__attendance-subtitle">{{ participation.eventName }} &mdash; {{ participation.eventDate }}</p>
          </div>
          <button class="ellipsis-button ellipsis-button--close" type="button" @click="closeAttendanceModal">
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <!-- Self-RSVP row: persistent above the tabs so the user can mark their
             own attendance from any tab without hunting for their card. Active
             button reflects selfAttendance.status when known; in-flight button
             flips to "Saving..." and all three disable until the save settles.
             When the user is Going, this row also surfaces their travel info
             summary + an Edit/Add Travel Info button — that responsibility is
             moved here so the user has a single, persistent "your attendance"
             control instead of scrolling the Going tab to find their own card. -->
        <div class="participation-v2__attendance-self">
          <!-- LEFT: status label + the three RSVP pills. The wrapper is
               needed so the parent .attendance-self can lay out the two
               halves (status / travel) side-by-side without the label
               and buttons drifting onto separate flex tracks. -->
          <div class="participation-v2__attendance-self-status">
            <p class="participation-v2__attendance-self-label">Your Attendance</p>
            <div class="participation-v2__attendance-self-actions">
              <button
                v-for="option in attendanceSelfOptions"
                :key="option.status"
                type="button"
                class="participation-v2__attendance-status-btn"
                :class="{ 'participation-v2__attendance-status-btn--active': selfAttendance?.status === option.status }"
                :disabled="anyAttendanceSaving"
                @click="onMarkAttendance(option.status)"
              >
                <span v-if="isAttendanceSaving('self') && selfAttendance?.status !== option.status">{{ option.label }}</span>
                <span v-else-if="isAttendanceSaving('self')">Saving...</span>
                <span v-else>{{ option.label }}</span>
              </button>
            </div>
          </div>

          <!-- RIGHT: travel info summary + button — visible only when the
               user is Going. Three vertical rows:
                 1. "Travel Info" label on the left, Edit/Add button on
                    the right (always visible when Going so the user can
                    open the form even if no info is filled yet).
                 2. Services line — comma-separated list of selected
                    services (Hotel, Bnb, Car Rental, Airline Tickets).
                 3. Stay row — start/end dates + rooms + adults
                    concatenated as "Stay <start> - <end> - Rooms 1 -
                    Adults 2", followed by the freeform notes on a new
                    line (italic) when present. Notes get their own
                    visual line so long preferences don't crush the
                    structured meta above them.
               On narrow viewports the parent flex row wraps and this
               column drops beneath the status block (see @720 rule). -->
          <div v-if="selfAttendance?.status === 'going'" class="participation-v2__attendance-self-travel">
            <div class="participation-v2__attendance-self-travel-head">
              <!-- "Your Travel Info" label is only shown when there's
                   actually something to label — i.e. the user has at
                   least one travel field populated. When their record
                   is blank, the label would just be sitting next to an
                   "Add Travel Info" button with nothing below it, so we
                   hide it and let the button speak for itself. -->
              <p
                v-if="readTravelInfo(selfAttendance)"
                class="participation-v2__attendance-self-label"
              >
                Your Travel Info
              </p>
              <button
                type="button"
                class="participation-v2__attendance-card-action-btn"
                @click="openTravelEditorFor(selfAttendance)"
              >
                {{ readTravelInfo(selfAttendance) ? 'Edit Travel Info' : 'Add Travel Info' }}
              </button>
            </div>
            <span v-if="attendanceServicesLabel(selfAttendance)" class="participation-v2__attendance-self-travel-meta">
              {{ attendanceServicesLabel(selfAttendance) }}
            </span>
            <span v-if="attendanceStayDetailsLabel(selfAttendance)" class="participation-v2__attendance-self-travel-meta">
              {{ attendanceStayDetailsLabel(selfAttendance) }}
            </span>
            <span v-if="selfAttendance.note?.trim()" class="participation-v2__attendance-self-travel-note">
              {{ selfAttendance.note?.trim() }}
            </span>
          </div>
        </div>

        <div class="participation-v2__attendance-tabs" role="tablist" aria-label="Attendance statuses">
          <button
            v-for="tab in attendanceTabs"
            :key="tab.key"
            class="participation-v2__attendance-tab"
            :class="{ 'participation-v2__attendance-tab--active': attendanceActiveTab === tab.key }"
            type="button"
            role="tab"
            :aria-selected="attendanceActiveTab === tab.key"
            @click="attendanceActiveTab = tab.key"
          >
            <span>{{ tab.label }}</span>
            <span class="participation-v2__attendance-count-badge">{{ tab.count }}</span>
          </button>
        </div>

        <div class="participation-v2__attendance-panel">
          <!-- Admin-only "Send Reminder" notice — sits above the
               attendance list inside the Not Responded tab so admins
               can ping the holdouts without leaving the modal.
               Hidden on the other tabs (Going / Not Going / Maybe)
               and for non-admins. The action is the entire "Send
               Reminder Now." link; it disables while the network
               call is in flight to avoid duplicate fires. -->
          <aside
            v-if="
              attendanceActiveTab === 'not_responded' &&
                participation.isAdmin &&
                activeAttendanceList.length
            "
            class="participation-v2__attendance-notice"
          >
            <div class="participation-v2__attendance-notice-copy">
              <p class="participation-v2__attendance-notice-title">Still waiting on a response.</p>
              <p class="participation-v2__attendance-notice-body">
                These teammates haven't responded yet. You can send them a quick reminder.
              </p>
            </div>
            <button
              type="button"
              class="participation-v2__attendance-notice-action"
              :disabled="reminderSending"
              @click="onSendReminder"
            >
              {{ reminderSending ? 'Sending…' : 'Send Reminder Now.' }}
            </button>
          </aside>

          <div v-if="activeAttendanceList.length" class="participation-v2__attendance-list">
            <article
              v-for="attendee in activeAttendanceList"
              :key="`${attendanceActiveTab}-${attendee.id}`"
              class="participation-v2__attendance-card"
            >
              <div class="participation-v2__attendance-card-main">
                <TeamAvatar :name="attendee.fullName" :image-url="attendee.profileAvatar" size="player" />
                <div class="participation-v2__attendance-card-copy">
                  <strong>{{ attendee.fullName }}</strong>
                  <!-- The tab grouping already communicates each attendee's
                       status, so the per-card status pill would be
                       redundant and is omitted. 'Going' attendees surface
                       only their selected services here — the structured
                       hotel meta (stay dates, rooms, adults, notes) lives
                       in the dedicated Travel Info column above the tabs
                       (for self) and inside the Travel form (for admin
                       edits), so the per-card meta is intentionally just
                       the services line to keep the card scannable. -->
                  <template v-if="attendee.kind === 'attended'">
                    <span
                      v-if="attendee.status === 'going' && attendanceServicesLabel(attendee.source)"
                      class="participation-v2__attendance-card-meta"
                    >
                      {{ attendanceServicesLabel(attendee.source) }}
                    </span>
                  </template>
                </div>
              </div>
              <!-- Action row sits BELOW the main avatar+name row. Hosts up
                   to two buttons in the SAME row:
                     - Travel button: visible on Going cards when the viewer
                       can edit travel info (own card, or any card if the
                       viewer is admin).
                     - Edit/Mark Attendance button: visible only when admin
                       is viewing another teammate's card (self uses the
                       hero / modal self row).
                   When admin clicks Edit/Mark, the row swaps to compact
                   status pills (going / not going / maybe) plus a close
                   button — the travel button is hidden during that swap so
                   the pills aren't crowded. -->
              <!-- Action row hosts up to two pill buttons. Order is intentional:
                     1. Edit/Mark Attendance (left, primary action)
                     2. Edit/Add Travel Info  (right, secondary)
                   Travel button is HIDDEN on the user's own card — the
                   self-attendance section above the tabs surfaces a
                   single canonical "Your Attendance" travel control, so
                   duplicating it in the user's own Going card would
                   confuse which one is canonical. Admins still see the
                   travel button on every other Going card. -->
              <div
                v-if="
                  (
                    attendee.kind === 'attended' &&
                      attendee.status === 'going' &&
                      attendee.memberId &&
                      attendee.memberId !== selfMemberId &&
                      participation.isAdmin
                  ) || (
                    participation.isAdmin &&
                      attendee.memberId &&
                      attendee.memberId !== selfMemberId
                  )
                "
                class="participation-v2__attendance-card-actions"
              >
                <template v-if="attendanceEditingMemberId !== attendee.memberId">
                  <button
                    v-if="participation.isAdmin && attendee.memberId && attendee.memberId !== selfMemberId"
                    type="button"
                    class="participation-v2__attendance-card-action-btn"
                    @click="attendanceEditingMemberId = attendee.memberId ?? null"
                  >
                    {{ attendee.kind === 'pending' ? 'Mark Attendance' : 'Edit Attendance' }}
                  </button>
                  <button
                    v-if="
                      attendee.kind === 'attended' &&
                        attendee.status === 'going' &&
                        attendee.memberId &&
                        attendee.memberId !== selfMemberId &&
                        participation.isAdmin
                    "
                    type="button"
                    class="participation-v2__attendance-card-action-btn"
                    @click="openTravelEditorFor(attendee.source)"
                  >
                    {{ readTravelInfo(attendee.source) ? 'Edit Travel Info' : 'Add Travel Info' }}
                  </button>
                </template>
                <template v-else>
                  <button
                    v-for="option in attendanceSelfOptions"
                    :key="option.status"
                    type="button"
                    class="participation-v2__attendance-status-btn participation-v2__attendance-status-btn--compact"
                    :class="{ 'participation-v2__attendance-status-btn--active': attendee.status === option.status }"
                    :disabled="anyAttendanceSaving"
                    @click="onAdminRsvpSelect(option.status, attendee.memberId || '')"
                  >
                    <span v-if="isAttendanceSaving(attendee.memberId || '') && attendee.status !== option.status">{{ option.shortLabel }}</span>
                    <span v-else-if="isAttendanceSaving(attendee.memberId || '')">Saving...</span>
                    <span v-else>{{ option.shortLabel }}</span>
                  </button>
                  <button
                    type="button"
                    class="participation-v2__attendance-card-actions-close"
                    :disabled="anyAttendanceSaving"
                    aria-label="Close attendance options"
                    @click="attendanceEditingMemberId = null"
                  >
                    <AppIcon name="close" :size="14" />
                  </button>
                </template>
              </div>
            </article>
          </div>
          <p v-else class="panel-copy">No teammates marked {{ activeAttendanceLabel }}.</p>
        </div>
      </section>
    </div>

    <EventLineupModal
      :model-value="lineupModalOpen"
      :participation-id="participation?.eventJoinedTeamId ?? teamParticipationId ?? ''"
      :team-name="participation?.teamName ?? ''"
      :team-avatar-url="participation?.teamAvatarUrl ?? ''"
      :team-age-group="participation?.teamAgeGroup ?? ''"
      :team-rating="participation?.teamRating ?? ''"
      :team-city="participation?.teamCity ?? ''"
      :team-state="participation?.teamState ?? ''"
      :event-name="participation?.eventName ?? ''"
      :event-date="participation?.eventDate ?? ''"
      :division="participation?.division ?? ''"
      :participation-status-label="participation ? participationBadgeLabel(participation.participationStatus) : undefined"
      :participation-status-tone="participation ? participationTone(participation.participationStatus) : undefined"
      :field-config-name="participation?.fieldConfigName"
      :field-config-positions="eventLineupFieldPositions"
      :teammates="lineupTeammates"
      :is-admin="participation?.isAdmin ?? false"
      @update:modelValue="lineupModalOpen = $event"
      @saved="onEventLineupSaved"
    />

    <GameLineupSubmissionModal
      v-if="selectedGame"
      :model-value="gameLineupModalOpen"
      :game-id="selectedGame.id"
      :team-id="participation?.teamId ?? ''"
      :team-name="participation?.teamName ?? ''"
      :opponent-name="selectedGame.opponent"
      :bracket-label="selectedGame.bracketLabel"
      :game-date-label="selectedGame.dateLabel"
      :game-time-label="selectedGame.timeLabel"
      :game-time="selectedGame.gameTime"
      :game-field-name="selectedGame.field"
      :game-park-name="selectedGame.facilityLabel"
      :fallback-lineup="participation?.lineup ?? []"
      :fallback-field-config-name="participation?.fieldConfigName"
      :fallback-field-positions="participation?.fieldConfigPositions ?? []"
      :team-avatar-url="participation?.teamAvatarUrl ?? ''"
      :team-age-group="participation?.teamAgeGroup ?? ''"
      :team-rating="participation?.teamRating ?? ''"
      :team-city="participation?.teamCity ?? ''"
      :team-state="participation?.teamState ?? ''"
      :opponent-avatar-url="selectedGame.opponentImageUrl ?? ''"
      :event-name="participation?.eventName ?? ''"
      :event-date="participation?.eventDate ?? ''"
      :division="participation?.division ?? ''"
      :game-status-label="selectedGame ? gameStatusBadgeLabel(selectedGame) : ''"
      :game-status-tone="selectedGame ? gameStatusBadgeTone(selectedGame) : 'info'"
      :is-admin="participation?.isAdmin ?? false"
      @update:modelValue="gameLineupModalOpen = $event"
      @saved="onGameLineupSaved"
    />

    <!-- Travel arrangements: small confirm overlay + the form modal.
         Confirm appears after a successful self-marks-Going save when
         no existing travel info is on file. The modal opens on Yes (or
         skips the confirm entirely when the user already has data).
         Both render at the root level so they overlay the attendance
         modal cleanly (no nested-modal stacking). -->
    <div
      v-if="travelConfirmOpen"
      class="travel-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="travel-confirm-title"
      @click.self="onTravelConfirmNo"
    >
      <div class="travel-confirm__card">
        <h3 id="travel-confirm-title" class="travel-confirm__title">Travel arrangements</h3>
        <!-- Body copy adapts to whether the actor is filling in for
             themselves (target id null) or on behalf of another teammate
             (admin path — target id set, target name available). -->
        <p v-if="travelTargetMemberId && travelTargetName" class="travel-confirm__body">
          Does {{ travelTargetName }} require travel arrangements for this event? The team manager uses this info to book hotel and transportation.
        </p>
        <p v-else class="travel-confirm__body">
          Do you require travel arrangements for this event? The team manager uses this info to book hotel and transportation.
        </p>
        <div class="travel-confirm__actions">
          <button class="primary-button" type="button" @click="onTravelConfirmYes">Yes, add details</button>
          <button class="secondary-button" type="button" @click="onTravelConfirmNo">No thanks</button>
        </div>
      </div>
    </div>

    <TravelArrangementsModal
      :model-value="travelModalOpen"
      :event-id="participation?.eventId ?? ''"
      :team-guid="participation?.teamGuid ?? ''"
      :event-name="participation?.eventName ?? ''"
      :event-date="participation?.eventDate ?? ''"
      :event-start-date="participation?.eventStartDate ?? ''"
      :event-end-date="participation?.eventEndDate ?? ''"
      :initial="travelInitial"
      :member-id="travelTargetMemberId ?? ''"
      :target-name="travelTargetName"
      @update:modelValue="travelModalOpen = $event"
      @saved="onTravelSaved"
    />
    </div>
  </main>
</template>

<style scoped>
.participation-v2__shell {
  max-width: 1720px;
}

.participation-v2__content-grid {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: start;
  gap: 24px;
}

.participation-v2__games-column,
.participation-v2__games-panel,
.participation-v2__side-panel {
  min-width: 0;
}

.participation-v2__games-column,
.participation-v2__games-panel,
.participation-v2__games-panel .games-stack,
.participation-v2__games-panel .games-day-group {
  overflow: visible;
}

.participation-v2__games-list {
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
}

/* Empty-state placeholder shown inside the games panel when loading is done
   but the team has zero scheduled games — tells teammates what the section
   is for instead of silently rendering nothing. */
.participation-v2__games-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 28px 20px;
  border: 1px dashed rgba(197, 209, 223, 0.9);
  border-radius: 14px;
  background: rgba(248, 251, 255, 0.6);
  text-align: center;
}

.participation-v2__games-empty-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--secondary);
}

.participation-v2__games-empty-copy {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.45;
  color: #5d7594;
  max-width: 44ch;
  align-self: center;
}

.participation-v2__side-rail {
  display: grid;
  gap: 20px;
}

.participation-v2__attendance-modal {
  width: min(1040px, 100%);
  /* Fixed full-viewport height so the popup geometry is identical
     across tabs (a tab with 2 RSVPs and a tab with 40 don't change
     the popup's outer size). The base .modal-card uses max-height +
     overflow:hidden; we promote that to a concrete `height` here so
     short content can't shrink the modal — and because our inner
     panel below has its own scroll, tall content can't expand it
     either. */
  height: calc(100vh - 60px);
  /* Override the .modal-card 20px outer padding so each pinned
     section can carry its own padding and the scroll panel below
     reaches the modal's edges (no inherited side gap that breaks the
     scrollbar gutter). */
  padding: 0;
  /* Flex column layout: header / self-RSVP / tab bar are pinned at
     auto height; the panel below absorbs the remaining vertical space
     and is the sole scroll container. Mirrors the .event-lineup-modal
     and .lineup-manager-modal pattern used elsewhere. */
  display: flex;
  flex-direction: column;
  /* overflow: hidden is already inherited from .modal-card and is
     critical here — it locks the outer container so only the inner
     panel can scroll. */
}

/* Pinned header band. Picks up the side+top padding we removed from
   the modal root and adds a soft separator beneath the title row. */
.participation-v2__attendance-header {
  flex: 0 0 auto;
  /* Cancel the global .modal-card__header { margin-bottom: 16px } —
     spacing between the header and the self-RSVP card below is now
     handled by the self-RSVP card's own top margin. */
  margin: 0;
  padding: 20px 24px 14px;
  border-bottom: 1px solid rgba(207, 220, 234, 0.9);
}

.participation-v2__attendance-header h2 {
  margin: 6px 0 2px;
  font-size: 1.8rem;
  line-height: 1.1;
}

.participation-v2__attendance-subtitle {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: min(720px, 72vw);
  color: var(--secondary);
}

.participation-v2__attendance-self {
  /* Pinned below the header. Margin (not padding) so the card itself
     keeps its inset look against the modal frame. Lays out the two
     halves (status on the left, travel info on the right) as a flex
     row that wraps to a column on narrow viewports — see the @720
     override below. */
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px;
  padding: 12px 14px;
  margin: 14px 24px 12px;
  border: 1px solid rgba(207, 220, 234, 0.9);
  border-radius: 12px;
  background: rgba(244, 249, 255, 0.9);
}

/* Left column wrapper — keeps the "Your Attendance" label stacked
   above its three status pills as a single unit so the parent flex
   row can place it next to the travel column without them splitting
   onto separate tracks.
   `flex: 1 1 0` on both columns gives a 50/50 split of the available
   space after the parent gap is subtracted. When travel is hidden
   (user is Not Going), this column grows into the full row since no
   sibling competes for the remainder. min-width: 0 lets the column
   shrink under long button labels without forcing horizontal
   overflow. */
.participation-v2__attendance-self-status {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  flex: 1 1 0;
  min-width: 0;
}

/* Mirrors the hero RSVP eyebrow style (src/views/ParticipationV2.vue
   .event-overview-card__rsvp-eyebrow) so the modal label reads with the
   same typographic voice as the participation screen. */
.participation-v2__attendance-self-label {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}

.participation-v2__attendance-self-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Travel info block — sits to the RIGHT of the status block when the
   parent .attendance-self is in row layout. Visible only when the user
   is Going. Stacks the label, meta lines (services / dates / note)
   and the Edit/Add Travel Info button vertically so each line reads
   cleanly even when the column gets narrow. The dashed left border
   visually separates the two columns; on mobile the parent collapses
   to flex-column and the @720 rule below moves the dashed line to
   the top so the visual relationship is preserved when stacked. */
.participation-v2__attendance-self-travel {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  /* Pair with .attendance-self-status `flex: 1 1 0` for a 1:1 (50/50)
     split of the row. Both columns shrink past their basis (0) when
     the parent runs out of room so neither spills out of the modal. */
  flex: 1 1 0;
  min-width: 0;
  padding-left: 14px;
  border-left: 1px dashed rgba(207, 220, 234, 0.9);
}

/* Header row inside the Travel Info column: label (when present)
   aligned left, Edit/Add Travel Info button aligned right.
   align-items: center vertically centres the button against the
   multi-line label, in case the label ever wraps. The small bottom
   gap (inherited from the parent's gap: 6px) reads as the separation
   between the head row and the services row below. The button uses
   margin-left: auto so it stays glued to the right edge whether or
   not the v-if'd label is present — `justify-content: space-between`
   with a single child collapses to flex-start, which would jump the
   button to the left when the label is hidden. */
.participation-v2__attendance-self-travel-head {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.participation-v2__attendance-self-travel-head .participation-v2__attendance-card-action-btn {
  margin-left: auto;
}

.participation-v2__attendance-self-travel-meta {
  font-size: 0.82rem;
  color: var(--secondary);
}

.participation-v2__attendance-self-travel-note {
  font-size: 0.82rem;
  color: var(--text);
  font-style: italic;
}

/* Unselected variant reads as plain text — transparent border and background
   so only the label shows — and only the --active modifier paints in the
   rounded pill so the current status pops against its siblings. A transparent
   (but present) border keeps the button height identical to the active
   state, avoiding a layout jump when selection changes. */
.participation-v2__attendance-status-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  font-size: 0.85rem;
  font-weight: 600;
  color: #5d7594;
  cursor: pointer;
  /* Keep each label on a single line — without this, "Not Going" wrapped to
     two lines inside the compact variant, throwing off the action row's
     height and pushing the close button. */
  white-space: nowrap;
  flex: 0 0 auto;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.participation-v2__attendance-status-btn:hover:not(:disabled) {
  color: #31455f;
}

.participation-v2__attendance-status-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.participation-v2__attendance-status-btn--active {
  border-color: #315b89;
  background: var(--white);
  color: #315b89;
}

.participation-v2__attendance-status-btn--compact {
  min-height: 28px;
  padding: 0 8px;
  font-size: 0.76rem;
}

.participation-v2__attendance-tabs {
  /* Pinned tab bar. Side margin matches the modal frame; bottom
     margin is dropped because the panel below carries its own
     padding-top — we don't want a double gap between the tabs and
     the first card row. */
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 22px;
  margin: 0 24px;
  border-bottom: 1px solid rgba(197, 209, 223, 0.9);
}

.participation-v2__attendance-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  /* Keep the label + count badge glued together on a single line.
     `flex-shrink: 0` stops the parent's flex layout from squeezing
     a tab's intrinsic width to fit, and `white-space: nowrap` keeps
     the label text itself unbroken — important for long labels
     like "Not Responded". On mobile the parent strip already enables
     horizontal scrolling (overflow-x: auto at @1024 / @720) so a tab
     row that exceeds the modal width scrolls cleanly instead of
     wrapping into multiple lines. */
  flex-shrink: 0;
  white-space: nowrap;
  min-height: 42px;
  padding: 0 0 12px;
  border: 0;
  background: transparent;
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.2;
  color: #6c84a4;
  cursor: pointer;
}

.participation-v2__attendance-tab::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 3px;
  border-radius: 999px 999px 0 0;
  background: transparent;
}

.participation-v2__attendance-tab--active {
  color: var(--primary);
}

.participation-v2__attendance-tab--active::after {
  background: var(--primary);
}

.participation-v2__attendance-count-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(229, 236, 245, 0.9);
  color: #647a99;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1;
}

/* Sole scroll container in the attendance modal. flex: 1 absorbs the
   remaining vertical space below the pinned header / self-RSVP / tabs;
   min-height: 0 is what actually allows the flex child to shrink below
   its intrinsic content height — without it, overflow: auto never
   engages on a flex child (well-known gotcha; same trick used in
   .event-lineup-modal__body). scrollbar-gutter: stable reserves space
   for the scrollbar so the cards don't shift between tabs as it
   appears/disappears. */
.participation-v2__attendance-panel {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 14px 24px 20px;
}

/* Admin-only "Send Reminder" notice shown above the Not Responded
   tab's card list. Layout: copy block on the left (title + body
   stacked), action link on the right. Soft yellow background so the
   notice reads as a friendly nudge rather than an error/warning, and
   1px translucent border to lift it off the modal background. On
   narrow viewports the parent flex row wraps and the action drops
   below the copy via the @720 rule further down. */
.participation-v2__attendance-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 14px;
  padding: 12px 14px;
  border: 1px solid rgba(244, 209, 132, 0.7);
  border-radius: 10px;
  background: rgba(255, 248, 224, 0.85);
}

.participation-v2__attendance-notice-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.participation-v2__attendance-notice-title {
  margin: 0;
  font-size: 0.92rem;
  font-weight: 700;
  color: var(--text);
}

.participation-v2__attendance-notice-body {
  margin: 0;
  font-size: 0.84rem;
  color: var(--secondary);
  line-height: 1.4;
}

/* Action rendered as an underlined link (not a pill button) so it
   reads as the discoverable verb rather than competing with the
   primary RSVP buttons elsewhere in the modal. Disabled state dims
   to half opacity + sets cursor: not-allowed while the request is
   in flight. */
.participation-v2__attendance-notice-action {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--primary, #2d8cf0);
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  transition: color 120ms ease;
}

.participation-v2__attendance-notice-action:hover:not(:disabled) {
  color: var(--primary-dark, #1f6dc2);
}

.participation-v2__attendance-notice-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.participation-v2__attendance-list {
  display: grid;
  /* 3 cards per row at desktop. Was 4; bumped down to give each card
     enough horizontal room to fit two action buttons (Edit Travel Info
     + Edit Attendance) on a single row without truncating the labels. */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.participation-v2__attendance-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid rgba(207, 220, 234, 0.9);
  border-radius: 14px;
  background: rgba(248, 251, 255, 0.86);
}

.participation-v2__attendance-card-main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

/* Action row that sits below the avatar+name row of each attendance
   card. Hosts up to two buttons side-by-side in the collapsed state
   (Edit Travel Info + Edit/Mark Attendance), or — when admin clicks
   Edit/Mark — swaps to the three compact status pills + close button.
   `flex-wrap: wrap` lets the two action buttons stack on cards that
   end up narrow on smaller viewports rather than overflowing. */
.participation-v2__attendance-card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.participation-v2__attendance-card-action-btn {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border: 1px solid #d7e3f0;
  border-radius: 999px;
  background: #f7fafc;
  color: #315b89;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}

.participation-v2__attendance-card-action-btn:hover:not(:disabled) {
  border-color: rgba(120, 145, 180, 0.9);
}

.participation-v2__attendance-card-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.participation-v2__attendance-card-actions-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #6c84a4;
  cursor: pointer;
}

.participation-v2__attendance-card-actions-close:hover:not(:disabled) {
  background: rgba(108, 132, 164, 0.12);
  color: #31455f;
}

.participation-v2__attendance-card-actions-close:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.participation-v2__attendance-card-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.participation-v2__attendance-card-copy strong {
  font-size: 0.98rem;
  line-height: 1.25;
}

.participation-v2__attendance-card-status,
.participation-v2__attendance-card-note {
  font-size: 0.9rem;
  line-height: 1.35;
  color: #5d7594;
}

/* Services line under each Going attendee's name. The cards display
   only the comma-separated services list here (the structured hotel
   meta lives in the dedicated Travel Info column / form), so this
   span is intentionally compact: secondary text colour, 2 px smaller
   than the rest of the card meta, and a single line with ellipsis on
   overflow so a long list of services can't push the card height. */
.participation-v2__attendance-card-meta {
  display: block;
  max-width: 100%;
  font-size: 0.78rem;
  line-height: 1.35;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.participation-v2__attendance-card-note {
  color: #6a7f99;
}

.participation-v2__side-panel {
  position: sticky;
  top: 96px;
  align-self: start;
}

.participation-v2__overview-card,
.participation-v2__division-card {
  width: 100%;
}

.participation-v2__day-heading {
  position: sticky;
  top: 168px;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-inline: -20px;
  margin-bottom: 14px;
  padding: 10px 20px;
  background: var(--surface-opaque);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(93, 141, 201, 0.16);
  box-shadow: 0 6px 16px rgba(36, 60, 91, 0.04);
}

.participation-v2__day-title {
  margin: 0;
  font-size: 1.55rem;
  line-height: 1.15;
}

.participation-v2__day-count {
  font-size: 0.84rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(39, 78, 133, 0.62);
  line-height: 1.15;
}

.participation-v2__timeline-item {
  display: grid;
  grid-template-columns: 108px 28px minmax(0, 1fr);
  align-items: stretch;
}

.participation-v2__timeline-slot {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-right: 14px;
  padding-top: 14px;
}

.participation-v2__timeline-slot-stack {
  display: grid;
  justify-items: center;
  gap: 6px;
}

.participation-v2__timeline-time {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  justify-content: center;
  flex-direction: column;
  min-width: 82px;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 14px;
  border: 1px solid rgba(93, 141, 201, 0.14);
  background: var(--surface-schedule);
  color: rgba(39, 78, 133, 0.9);
  font-size: 0.9rem;
  font-weight: 400;
  line-height: 1;
  box-sizing: border-box;
  text-align: center;
}

.participation-v2__timeline-time[data-tone='live'] {
  background: rgba(255, 239, 241, 0.98);
  border-color: rgba(255, 90, 104, 0.24);
  color: var(--highlight);
}

.participation-v2__timeline-time[data-tone='final'] {
  background: rgba(229, 241, 255, 0.96);
  border-color: rgba(45, 140, 240, 0.22);
  color: var(--primary);
}

.participation-v2__timeline-time[data-tone='warning'] {
  background: rgba(255, 248, 234, 0.96);
  border-color: rgba(255, 212, 90, 0.42);
  color: #a87712;
}

.participation-v2__timeline-time[data-tone='muted'] {
  background: rgba(248, 250, 253, 0.96);
  border-color: rgba(143, 157, 179, 0.14);
  color: rgba(89, 102, 124, 0.88);
}

/* When the time slot is in `muted` tone — the only state where it
   fires is an unscheduled game (no timeLabel, no dateLabel) — the
   main label is "Unscheduled". We want that label to read as a
   tag/eyebrow rather than a plain time string, so promote its
   typography to the same uppercase / bold / 0.03 em letter-spacing
   used by the sub-label below. The `data-tone` selector keeps the
   override scoped to the unscheduled state — scheduled / live /
   final / warning labels keep their existing main-label typography. */
.participation-v2__timeline-time[data-tone='muted'] .participation-v2__timeline-time-main {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.participation-v2__timeline-time-main {
  display: block;
  font-weight: 400;
}

.participation-v2__timeline-time-sub {
  display: block;
  margin-top: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.participation-v2__timeline-delay-text {
  max-width: 92px;
  color: #a87712;
  font-size: 0.74rem;
  line-height: 1.25;
  text-align: center;
}

.participation-v2__timeline-rail {
  position: relative;
}

.participation-v2__timeline-rail::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, rgba(93, 141, 201, 0.1), rgba(93, 141, 201, 0.28), rgba(93, 141, 201, 0.1));
}

.participation-v2__timeline-dot {
  position: absolute;
  top: 28px;
  left: 50%;
  width: 12px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: var(--primary);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.95);
}

.participation-v2__timeline-dot[data-tone='pending'] {
  background: var(--secondary);
}

.participation-v2__timeline-dot[data-tone='final'] {
  background: var(--primary);
}

.participation-v2__timeline-dot[data-tone='warning'] {
  background: var(--warning);
}

.participation-v2__timeline-dot[data-tone='live'] {
  background: var(--highlight);
  animation: participation-v2-live-pulse 1.2s ease-in-out infinite;
}

@keyframes participation-v2-live-pulse {
  0%,
  100% {
    transform: translateX(-50%) scale(1);
    box-shadow:
      0 0 0 4px rgba(255, 255, 255, 0.95),
      0 0 0 0 rgba(255, 90, 104, 0.5),
      0 0 18px rgba(255, 90, 104, 0.32);
  }

  50% {
    transform: translateX(-50%) scale(1.22);
    box-shadow:
      0 0 0 4px rgba(255, 255, 255, 0.95),
      0 0 0 10px rgba(255, 90, 104, 0.16),
      0 0 24px rgba(255, 90, 104, 0.4);
  }
}

.participation-v2__timeline-card {
  min-width: 0;
}

.participation-v2__schedule-card {
  display: grid;
  gap: 14px;
  padding: 18px 18px 16px;
  border: 1px solid rgba(93, 141, 201, 0.16);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 251, 255, 0.96));
  box-shadow: 0 10px 28px rgba(32, 62, 105, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.participation-v2__schedule-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.participation-v2__schedule-head-main {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.participation-v2__schedule-kicker {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.participation-v2__state-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.participation-v2__state-pill--live {
  background: rgba(255, 90, 104, 0.14);
  color: var(--highlight);
}

.participation-v2__schedule-label {
  min-width: 0;
  font-size: 1.18rem;
  font-weight: 700;
  line-height: 1.25;
  color: #355f97;
}

.participation-v2__schedule-meta {
  display: grid;
  gap: 12px;
}

.participation-v2__schedule-meta-item {
  display: inline-flex;
  align-items: flex-start;
  gap: 8px;
  color: #496f9f;
  font-size: 0.98rem;
  line-height: 1.3;
  width: 100%;
}

.participation-v2__schedule-meta-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
  flex: 0 0 auto;
  margin-top: 2px;
}

.participation-v2__schedule-meta-icon--time {
  width: 18px;
  height: 18px;
}

.participation-v2__schedule-meta-item:not(.participation-v2__schedule-meta-item--time) .participation-v2__schedule-meta-icon {
  width: 18px;
  height: 18px;
}

.participation-v2__schedule-meta-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.participation-v2__schedule-meta-inline {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.participation-v2__schedule-meta-inline-note {
  font-size: 0.82rem;
  line-height: 1.2;
  font-weight: 600;
}

.participation-v2__schedule-meta-subline {
  /* Match .schedule-meta-copy size + color so "Time Limit 65" reads as
     the same secondary meta as "Started 08:00 AM" and the field/park
     line above and below it. */
  color: var(--secondary);
  font-size: 0.82rem;
  line-height: 1.25;
}

.participation-v2__schedule-meta-inline-note[data-tone='late'] {
  color: #d64545;
  font-weight: 700;
}

.participation-v2__schedule-meta-inline-note[data-tone='ontime'] {
  color: #2b8a57;
  font-weight: 600;
}

.event-overview-card__attendee-link {
  margin-left: 18px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
}

/* Stacked attendees layout — shared by both the empty state ("No one's
   joined yet" + View Team Attendance) and the with-data state (avatar+count row
   + View Team Attendance). One column, 4px gap, items flush-left — so the
   "View Team Attendance" link reads identically in both cases and there's no
   per-variant replication of layout rules. */
.event-overview-card__attendees--empty,
.event-overview-card__attendees--stacked {
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}

.event-overview-card__attendees-row {
  display: flex;
  align-items: center;
}

/* "X going" count button reads as body text at rest and turns primary on
   hover. Scoped to this specific descendant selector so the "View Team
   Attendance" link below (direct child of --stacked) keeps its default
   primary-link color. */
.event-overview-card__attendees-row .event-overview-card__attendee-link {
  color: var(--text);
  transition: color 120ms ease;
}

.event-overview-card__attendees-row .event-overview-card__attendee-link:hover {
  color: var(--primary);
}

.event-overview-card__attendees-empty-text {
  font-size: 0.9rem;
  color: #5d7594;
}

/* Unified "View Team Attendance" link styling — 0.9rem, no left indent — in
   both the empty and stacked variants. The global rule adds 18px for the
   inline avatar-row variant; we reset it for these column layouts. The
   `--stacked > ` direct-child combinator spares the count button inside
   `.event-overview-card__attendees-row`, which still wants its 18px gap
   from the last avatar. */
.event-overview-card__attendees--empty .event-overview-card__attendee-link,
.event-overview-card__attendees--stacked > .event-overview-card__attendee-link {
  margin-left: 0;
  font-size: 0.9rem;
}

/* Wraps the "Your Attendance" eyebrow above the CTA button / options group so
   the caption sits outside — and immediately above — the control itself.
   Children align right so the eyebrow reads against the button's trailing
   edge (the wrap sits on the right side of the footer). */
.event-overview-card__rsvp-wrap {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.event-overview-card__rsvp-eyebrow {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
}

/* Symmetric vertical breathing room around the weather strip — same 18px
   gap above (separating from the roster block) and below (separating from
   the attendees/RSVP footer). Scoped so the rule only touches this view. */
.event-overview-card__forecast {
  margin-top: 18px;
}

.event-overview-card__footer {
  margin-top: 18px;
}

/* Light primary-blue tint for the "Going" state — signals a positive RSVP
   at a glance without using the heavier saturated pill styling elsewhere.
   Text flips to `--primary` so it reads against the subtle blue wash. */
.event-overview-card__cta--going {
  border-color: rgba(45, 140, 240, 0.4);
  background: rgba(45, 140, 240, 0.1);
  color: var(--primary);
}

/* Expanded state of the footer "Are you going?" CTA. Reuses the light
   palette of .event-overview-card__cta (defined in src/styles.css:1795) so
   it sits in the same 44px slot without visually reflowing. */
.event-overview-card__cta-group {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 44px;
  padding: 0 6px;
  border: 1px solid #d7e3f0;
  border-radius: 10px;
  background: #f7fafc;
}

.event-overview-card__cta-option {
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: #315b89;
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}

.event-overview-card__cta-option:hover:not(:disabled) {
  background: rgba(49, 91, 137, 0.08);
}

.event-overview-card__cta-option--active {
  border-color: #315b89;
  background: var(--white);
  color: #315b89;
}

.event-overview-card__cta-option:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.event-overview-card__cta-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #6c84a4;
  cursor: pointer;
}

.event-overview-card__cta-close:hover:not(:disabled) {
  background: rgba(108, 132, 164, 0.12);
  color: #31455f;
}

.event-overview-card__cta-close:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.participation-v2__schedule-actions {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}

.participation-v2__card-menu-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 10;
}

.participation-v2__card-menu-anchor {
  background: var(--white);
  border-color: rgba(93, 141, 201, 0.18);
}

.participation-v2__status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.participation-v2__delay-row {
  display: flex;
  margin-top: -2px;
}

.participation-v2__status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 9px;
  border-radius: 999px;
  background: rgba(229, 236, 245, 0.9);
  color: #647a99;
  font-size: 0.74rem;
  font-weight: 400 !important;
}

.participation-v2__status-chip[data-tone='success'] {
  background: rgba(76, 184, 121, 0.14);
  color: #2b8d56;
}

.participation-v2__status-chip[data-tone='warning'],
.participation-v2__status-chip--warning {
  background: rgba(246, 190, 74, 0.14);
  color: #a87712;
}

.participation-v2__status-chip[data-tone='neutral'] {
  background: rgba(229, 236, 245, 0.9);
  color: #647a99;
}

.participation-v2__matchup-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  align-items: stretch;
  padding: 14px;
  border-radius: 16px;
  background: rgba(240, 246, 253, 0.65);
}

.participation-v2__matchup-list {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.participation-v2__matchup-list--scheduled {
  gap: 14px;
}

.participation-v2__team-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.participation-v2__team-identity {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.participation-v2__team-copy {
  min-width: 0;
}

.participation-v2__team-name {
  display: block;
  color: #476b99;
  font-size: 1rem;
  line-height: 1.28;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.participation-v2__team-name--winner {
  font-weight: 800;
  color: #2f3d55;
}

.participation-v2__team-score {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 52px;
  color: #476b99;
  font-size: 1.05rem;
  font-weight: 700;
  white-space: nowrap;
}

.participation-v2__team-score--winner {
  color: #2f3d55;
}

.participation-v2__team-score-cup {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  background: center / contain no-repeat url('../assets/cup.svg');
}

.participation-v2__schedule-summary {
  display: flex;
  align-items: center;
  max-width: 148px;
  padding-left: 18px;
  border-left: 1px solid rgba(93, 141, 201, 0.16);
  color: #4c74a8;
  font-size: 1rem;
  line-height: 1.3;
}

.participation-v2__division-card .division-standings__row {
  padding-block: 14px;
}

.participation-v2__division-card .division-standings__team {
  gap: 12px;
  align-items: center;
}

.participation-v2__division-card .division-standings__copy {
  gap: 2px;
}

.participation-v2__division-card .division-standings__copy strong,
.participation-v2__division-card .division-standings__copy span {
  line-height: 1.2;
}

@media (max-width: 1280px) {
  .participation-v2__content-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

@media (max-width: 1024px) {
  .participation-v2__content-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  /* Step the attendance cards down by viewport: 3 → 2 → 1. Base is
     already 3 columns now (was 4 before two buttons started sharing the
     action row), so no @1024 override is needed — the breakpoints below
     pick up where this leaves off. Tabs still get the horizontal-scroll
     treatment at this width because the label row is the wider element. */

  .participation-v2__attendance-tabs {
    gap: 16px;
    overflow-x: auto;
    /* Without this, setting overflow-x:auto causes overflow-y (default
       visible) to compute as auto per CSS spec — producing a stray
       vertical scrollbar. Lock the y-axis so only horizontal scroll
       activates when the tab labels exceed the row width. */
    overflow-y: hidden;
  }

  .participation-v2__day-heading {
    top: 152px;
  }

  .participation-v2__timeline-item {
    grid-template-columns: 92px 24px minmax(0, 1fr);
  }

  .participation-v2__timeline-slot {
    padding-right: 10px;
  }

  /* Intentionally NOT collapsing .schedule-head to a column at this
     breakpoint — the ellipsis button must stay on the right of the
     game name on every screen size. Meta rows sit below the head as a
     separate sibling, not inside this flex row. */
}

@media (max-width: 720px) {
  .participation-v2__attendance-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  /* Tighten the modal frame on mobile to match .event-lineup-modal /
     .lineup-manager-modal which collapse to `100vh - 24px` at this
     breakpoint. Combined with the per-section padding overrides
     below, the popup uses the full mobile viewport with consistent
     12–16 px gutters. */
  .participation-v2__attendance-modal {
    height: calc(100vh - 24px);
  }

  .participation-v2__attendance-header {
    padding: 16px 16px 12px;
  }

  .participation-v2__attendance-self {
    margin: 12px 16px 10px;
    /* Stack the two halves vertically on mobile — the right column's
       dashed left border converts to a top border below so the visual
       relationship between status and travel info stays consistent
       when collapsed. */
    flex-direction: column;
    gap: 10px;
  }

  .participation-v2__attendance-self-travel {
    width: 100%;
    padding-left: 0;
    padding-top: 10px;
    border-left: 0;
    border-top: 1px dashed rgba(207, 220, 234, 0.9);
  }

  .participation-v2__attendance-tabs {
    margin: 0 16px;
  }

  .participation-v2__attendance-panel {
    padding: 12px 16px 16px;
  }

  /* Stack the notice copy + action vertically on mobile so the
     "Send Reminder Now." link doesn't crush against the title at
     narrow viewports. */
  .participation-v2__attendance-notice {
    flex-direction: column;
    align-items: flex-start;
  }

  .participation-v2__day-heading {
    top: 136px;
  }

  .participation-v2__timeline-item {
    grid-template-columns: minmax(0, 1fr);
    gap: 10px;
  }

  .participation-v2__timeline-slot {
    justify-content: flex-start;
    padding: 0;
  }

  .participation-v2__timeline-slot-stack {
    justify-items: start;
  }

  .participation-v2__timeline-delay-text {
    text-align: left;
  }

  .participation-v2__timeline-rail {
    display: none;
  }

  .participation-v2__schedule-actions {
    flex-wrap: wrap;
  }

  .participation-v2__matchup-shell {
    grid-template-columns: minmax(0, 1fr);
  }

  .participation-v2__schedule-summary {
    max-width: none;
    padding-left: 0;
    padding-top: 14px;
    border-left: 0;
    border-top: 1px solid rgba(93, 141, 201, 0.16);
  }
}

@media (max-width: 520px) {
  /* Small mobile — one attendee per row so the full name, status line and
     admin edit row have room to breathe without truncating. */
  .participation-v2__attendance-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>


