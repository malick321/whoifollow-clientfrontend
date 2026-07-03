<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import GameLineupSubmissionModal from '../components/GameLineupSubmissionModal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import ScoresheetGrid from '../components/scoring-lib/ScoresheetGrid.vue'
import LineScore, { type LineScoreHeadBadge } from '../components/scoring-lib/LineScore.vue'
import PlateAppearanceModal from '../components/scoring-lib/PlateAppearanceModal.vue'
import emailIcon from '../assets/email.svg'
import mobileIcon from '../assets/mobile.svg'
import {
  createPlateAppearance,
  deletePlateAppearance,
  fetchScoresheet,
  fetchScoresheetShell,
  fetchGameLineupSubmission,
  fetchTeamParticipation,
  saveGameLineupSubmission,
  submitScoresheetForPublish,
  updatePlateAppearance,
  uploadScoresheetImage
} from '../api/team'
import { gameLineupSubmissionStatusMeta } from '../game-lineup-status'
import { pushToast } from '../toast-center'
import type {
  FieldConfigPosition,
  GameLineupPlayer,
  GameLineupSubmissionDetail,
  GameLineupSubmission,
  LineupPlayer,
  ScoresheetCell,
  ScoresheetDetail,
  ScoresheetPlateAppearance,
  TeamParticipation,
  UploadStatus
} from '../types'

type CardTone = 'success' | 'warning' | 'info' | 'danger'

interface GridPlayer {
  id: number
  row_id: string
  batting_order: number
  position_code: string | null
  player_name: string
  player_note?: string | null
  substitute_name?: string | null
  substitute_note?: string | null
  substitute_inning?: number | null
  // Sub identity, exposed so the grid can resolve the effective player per
  // inning for both cell display and the plate-appearance modal.
  substitute_id?: number | null
  substitute_player_name?: string | null
  substitute_jersey_number?: string | null
  substitute_position_code?: string | null
}

interface GridAppearance {
  id: string
  game_lineup_player_id: number
  inning_number: number
  result_code: string | null
  batter_end_base?: '1B' | '2B' | '3B' | 'HP' | null
  rbi: number
  run_scored: boolean
  result_detail?: string | null
  pitch_type?: string | null
  which_out?: number | null
}

interface GridBattingStat {
  game_lineup_player_id: number
  at_bats: number
  runs: number
  hits: number
  rbi: number
  stolen_bases: number
  walks: number
  strikeouts: number
}

const route = useRoute()
const router = useRouter()
// New standardized route: /event/participation/:participationId/team/:teamId/game/:gameGuid
// participationId drives back-nav + participation fetch (for isAdmin + team context)
// teamId is submitted with every scoresheet / lineup API call
// gameGuid is canonical — numeric gameId is resolved via the shell fetch
const participationId = computed(() => route.params.participationId as string | undefined)
const teamId = computed(() => route.params.teamId as string)
const gameGuid = computed(() => route.params.gameGuid as string | undefined)
// Derived from the shell fetch once it lands — numeric ids for the v2
// scoresheet + plate-appearance endpoints.
const gameId = computed(() => scoresheet.value?.gameId ?? '')
const eventId = computed(() => route.params.eventId as string | undefined ?? '')
const tournamentId = computed(() => route.query.tournament_id as string | undefined)

const scoresheet = ref<ScoresheetDetail | null>(null)
// Participation fetched in parallel with the scoresheet, purely to retrieve
// isAdmin (the scoresheet endpoint doesn't carry role info) and to power
// back-navigation copy.
const participation = ref<TeamParticipation | null>(null)
const shellLoading = ref(true)
const ledgerLoading = ref(false)
const saving = ref(false)
const deleting = ref(false)
const uploading = ref(false)
const condensedHeaderVisible = ref(false)
const lineupModalOpen = ref(false)
const lineupSaving = ref(false)
const appearanceModalOpen = ref(false)
const appearanceModalPlayer = ref<GridPlayer | null>(null)
const appearanceModalInning = ref<number | null>(null)
const appearanceModalExisting = ref<GridAppearance | null>(null)
const appearanceModalCount = ref(0)
const appearanceModalNumber = ref(1)
const appearanceModalCreatingNext = ref(false)
const appearanceModalExistingPayload = computed<Record<string, any> | undefined>(() =>
  appearanceModalExisting.value ? { ...appearanceModalExisting.value } : undefined
)
const lineupDraft = ref<GameLineupPlayer[]>([])
const lineupFormStatus = ref<GameLineupSubmission['status']>('draft')
const lineupFormNotes = ref('')
const draggedLineupPlayerId = ref<string | null>(null)
const lineupDropTargetId = ref<string | null>(null)
const substituteDrafts = ref<Record<string, { targetId: string | null; inning: number | null; positionCode: string | null }>>({})

const DEFAULT_SLOW_PITCH_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LC', 'RC', 'RF']

const sportTypeId = 1
const gameVariant = 'slow_pitch'
// Sourced from the participation fetch. Safe default is false so a missing
// or in-flight participation response locks down every edit control until
// the real flag arrives.
const isAdmin = computed(() => participation.value?.isAdmin ?? false)

// Team Manager block uses the participation-sourced manager, NOT the
// scoresheet's own one. Background: the `/tournaments/scoresheet/...`
// backend either omits the `manager` field or returns null fields,
// and `adaptScoresheetDetail` falls back to empty strings, which the
// template would render as a blank Team Manager block. The
// participation fetch already fires in parallel here for `isAdmin` /
// back-nav, and `adaptTeamParticipation` populates manager.{name,
// email, phone} reliably — so we read off that ref instead. Falls
// back through to scoresheet.manager and a final empty default so a
// failed participation fetch (or future scoresheet endpoint that
// starts returning manager) is still handled gracefully.
const displayManager = computed(
  () => participation.value?.manager
    ?? scoresheet.value?.manager
    ?? { name: '', email: '', phone: '' }
)

// Hero meta line: "<age-group> <rating> - City, State". Sourced from the
// `participation` payload already fetched for isAdmin / back-nav — no
// extra API call. Matches the ParticipationV2 hero format verbatim so
// the two views share an identical meta line.
const heroTeamMetaText = computed(() => {
  const p = participation.value
  if (!p) return ''
  const left = [p.teamAgeGroup, p.teamRating].filter(Boolean).join(' ')
  const right = [p.teamCity, p.teamState].filter(Boolean).join(', ')
  if (left && right) return `${left} - ${right}`
  return left || right
})

function statusTone(status: UploadStatus) {
  if (status === 'published' || status === 'mapped') return 'success'
  if (status === 'review' || status === 'uploading') return 'warning'
  return 'info'
}

const mappedPlayers = computed(
  () => scoresheet.value?.players.filter((player) => player.mappingState === 'matched').length ?? 0
)
const unresolvedPlayers = computed(
  () => scoresheet.value?.players.filter((player) => player.mappingState !== 'matched').length ?? 0
)
const trackedAppearances = computed(
  () =>
    scoresheet.value?.players.reduce(
      (total, player) => total + player.cells.reduce((sum, cell) => sum + cell.appearances.length, 0),
      0
    ) ?? 0
)
const verifiedCells = computed(
  () =>
    scoresheet.value?.players.reduce(
      (total, player) => total + player.cells.filter((cell) => cell.reviewState === 'verified').length,
      0
    ) ?? 0
)

const innings = computed(() => {
  const inningSet = new Set<number>()
  for (const player of scoresheet.value?.players ?? []) {
    for (const cell of player.cells) inningSet.add(cell.inning)
  }
  return Array.from(inningSet).sort((left, right) => left - right)
})

const scorebookSummary = computed(() =>
  innings.value.map((inning) => ({
    inning,
    appearances:
      scoresheet.value?.players.reduce((total, player) => {
        const cell = player.cells.find((entry) => entry.inning === inning)
        return total + (cell?.appearances.length ?? 0)
      }, 0) ?? 0
  }))
)

const totalInningsForGrid = computed(() => Math.max(27, innings.value.length || 0))
const lineScoreInnings = computed(() => {
  const values = Math.max(
    scoresheet.value?.teamLineScores?.length ?? 0,
    scoresheet.value?.opponentLineScores?.length ?? 0
  )
  return Array.from({ length: values }, (_, index) => index + 1)
})
const teamLineScore = computed(() => scoresheet.value?.teamLineScores ?? [])
const opponentLineScore = computed(() => scoresheet.value?.opponentLineScores ?? [])
const teamRunsTotal = computed(() =>
  scoresheet.value?.teamRunsTotal ??
  teamLineScore.value.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : Number(value) || 0), 0)
)
const opponentRunsTotal = computed(() =>
  scoresheet.value?.opponentRunsTotal ??
  opponentLineScore.value.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : Number(value) || 0), 0)
)
const teamHomeRunsTotal = computed(() => scoresheet.value?.teamHomeRuns ?? '-')
const opponentHomeRunsTotal = computed(() => scoresheet.value?.opponentHomeRuns ?? '-')
const lineScoreRows = computed(() => {
  if (!scoresheet.value) return []

  const rows = [
    {
      key: 'team',
      name: scoresheet.value.teamName,
      imageUrl: scoresheet.value.teamAvatarUrl,
      seed: scoresheet.value.teamSeed,
      side: scoresheet.value.teamSide,
      isBatting: scoresheet.value.currentBattingTeamSide === scoresheet.value.teamSide,
      scores: teamLineScore.value,
      runs: teamRunsTotal.value,
      homeRuns: teamHomeRunsTotal.value
    },
    {
      key: 'opponent',
      name: scoresheet.value.opponent,
      imageUrl: scoresheet.value.opponentAvatarUrl,
      seed: scoresheet.value.opponentSeed,
      side: scoresheet.value.opponentSide,
      isBatting: scoresheet.value.currentBattingTeamSide === scoresheet.value.opponentSide,
      scores: opponentLineScore.value,
      runs: opponentRunsTotal.value,
      homeRuns: opponentHomeRunsTotal.value
    }
  ]

  return rows.sort((left, right) => {
    if (left.side === right.side) return 0
    return left.side === 'V' ? -1 : 1
  })
})
/* Viewport-width tracking + `lineScoreGridStyle` computed were
 * moved into the `LineScore` component when the line-score
 * markup was extracted there. The component owns its own resize
 * listener + grid-template calc so this view stays focused on
 * scoresheet data. */
/**
 * Venue display for the meta box. Backend assigns field / park / city
 * / state together when the game is SCHEDULED. The previous mock seed
 * defaulted each piece to a placeholder which leaked through, and the
 * intermediate fix showed city/state alone (without field/park) for
 * games that only had partial venue data — also wrong, because that
 * partial state is itself a mock leftover.
 *
 * Rules now:
 *   - top    = "<field> - <park>" when BOTH are present (or whichever
 *              of the two is set, joined with ' - ').
 *   - bottom = "<city>, <state>" only when `top` is also non-empty.
 *              Without a field/park we treat city/state as orphan
 *              mock leftovers and skip them entirely. The template
 *              renders a single dash placeholder in that case.
 */
const venueSummary = computed(() => {
  if (!scoresheet.value) {
    return { top: '', bottom: '' }
  }
  const field = scoresheet.value.venueField?.trim() ?? ''
  const park = scoresheet.value.venuePark?.trim() ?? ''
  const city = scoresheet.value.venueCity?.trim() ?? ''
  const state = scoresheet.value.venueState?.trim() ?? ''
  const top = [field, park].filter(Boolean).join(' - ')
  const bottom = top ? [city, state].filter(Boolean).join(', ') : ''
  return { top, bottom }
})
const condensedTeamName = computed(() => scoresheet.value?.teamName ?? '')
const condensedOpponentName = computed(() => scoresheet.value?.opponent ?? '')
const condensedMatchupSubline = computed(() => {
  if (!scoresheet.value) return ''
  return [
    scoresheet.value.bracketLabel,
    scoresheet.value.gameTime,
    `${scoresheet.value.division} - ${scoresheet.value.eventName ?? ''}`.replace(/ - $/, '')
  ]
    .filter(Boolean)
    .join(' - ')
})
/**
 * Time value rendered under the meta box label. Three branches:
 *
 *   1. `actualStartTime` present → game has started (or finished /
 *      delayed); show the actual start time as-is.
 *   2. No actualStartTime BUT scheduled `gameTime` present → game is
 *      scheduled but hasn't started yet. Pull just the TIME portion
 *      out of `gameTime` (built by `buildGameTime` as "<time> - <date>")
 *      so we don't show the trailing date / year. Falls back to the
 *      whole `gameTime` string if the format is unexpected.
 *   3. Neither → game is unscheduled; we return empty so the template
 *      can hide the value-strong via v-if (label-only "Unscheduled" card).
 *
 * The previous implementation split on `,` and took the LAST chunk —
 * with the standard `"7:30 PM - Tue, April 7, 2026"` format that
 * yielded just "2026" (the year), which was the bug being fixed here.
 */
const displayStartTime = computed(() => {
  const actualStartTime = scoresheet.value?.actualStartTime?.trim()
  if (actualStartTime) return actualStartTime

  const gameTime = scoresheet.value?.gameTime?.trim()
  if (!gameTime) return ''

  const dashIndex = gameTime.indexOf(' - ')
  if (dashIndex > 0) return gameTime.slice(0, dashIndex).trim()
  return gameTime
})

/**
 * Label above the time value in the meta box. Three states:
 *   - "Started"     — actual start time recorded
 *   - "Scheduled"   — schedule exists, hasn't started yet
 *   - "Unscheduled" — no schedule on file
 * The previous implementation only flipped between Started / Scheduled
 * — which meant a game with no schedule rendered as "Scheduled -" with
 * a stray time-leak under it.
 */
const displayStartTimeLabel = computed(() => {
  if (scoresheet.value?.actualStartTime?.trim()) return 'Started'
  if (scoresheet.value?.gameTime?.trim()) return 'Scheduled'
  return 'Unscheduled'
})

/**
 * True once the umpire has set an actual start time (game is in
 * progress, finished, or delayed). Drives a few UI affordances that
 * are only meaningful after the first pitch — currently the Home /
 * Visitor labels under each linescore team row, which read as noise
 * before the game has started.
 */
const gameHasStarted = computed(() => Boolean(scoresheet.value?.actualStartTime?.trim()))
/**
 * Time limit display. Backend assigns this only once the game has
 * STARTED. When missing we render a single dash so the card always
 * has a value line below the "Time Limit" label (label-only would
 * make the card look broken). Per product: dash when no value, real
 * "<n> min" formatting when present.
 */
const displayTimeLimit = computed(() => {
  const value = scoresheet.value?.timeLimit
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return `${value} min`
  const trimmed = String(value).trim()
  if (!trimmed) return '-'
  return /^\d+$/.test(trimmed) ? `${trimmed} min` : trimmed
})
const reviewBadgeItems = computed<{ label: string; tone: CardTone }[]>(() => {
  if (!scoresheet.value?.sourceImageName) return []

  return [
    {
      label: `${unresolvedPlayers.value} lineup fixes`,
      tone: unresolvedPlayers.value > 0 ? 'warning' : 'success'
    },
    {
      label: `${scoresheet.value.reviewItems.length} review items`,
      tone: scoresheet.value.reviewItems.length > 0 ? 'info' : 'success'
    },
    {
      label: `${trackedAppearances.value} plays staged`,
      tone: 'success'
    }
  ]
})
const delayBadgeLabel = computed(() => {
  if (!scoresheet.value?.isDelayed) return ''
  return scoresheet.value.delayReason ? `Delayed - ${scoresheet.value.delayReason}` : 'Delayed'
})
const headerLineupBadgeLabel = computed(() =>
  scoresheet.value?.gameLineupSubmitted ? 'Lineup Submitted' : 'Lineup Pending'
)
const headerLineupBadgeTone = computed<CardTone>(() =>
  scoresheet.value?.gameLineupSubmitted ? 'success' : 'warning'
)
const headerScorebookBadgeLabel = computed(() => {
  if (scoresheet.value?.uploadStatus === 'idle') return 'Scoresheet Not Started'
  if (scoresheet.value?.uploadStatus === 'review') return 'Scoresheet In Review'
  if (scoresheet.value?.uploadStatus === 'mapped') return 'Scoresheet Mapped'
  if (scoresheet.value?.uploadStatus === 'published') return 'Scoresheet Published'
  return 'Scoresheet Uploading'
})
const headerScorebookBadgeTone = computed<CardTone>(() => {
  if (scoresheet.value?.uploadStatus === 'published' || scoresheet.value?.uploadStatus === 'mapped') return 'success'
  if (scoresheet.value?.uploadStatus === 'review' || scoresheet.value?.uploadStatus === 'uploading') return 'warning'
  return 'info'
})
const gameStatusBadgeLabel = computed(() => {
  if (scoresheet.value?.isDelayed) return ''
  return scoresheet.value?.gameStatusLabel ?? ''
})
const gameStatusBadgeTone = computed<CardTone>(() => {
  if (scoresheet.value?.isDelayed) return 'warning'
  if (scoresheet.value?.gameStatusCode === 1) return 'danger'
  if (scoresheet.value?.gameStatusCode === 2) return 'info'
  return 'info'
})

/** Resolved badge for the `LineScore` component's `headBadge`
 *  prop. Delay takes precedence over game status — same as the
 *  original `v-if="delayBadgeLabel" / v-else-if="gameStatusBadgeLabel"`
 *  chain in the inline markup. Returns `null` when neither
 *  applies so the team-head cell renders as an empty grid
 *  spacer. */
const lineScoreHeadBadge = computed<LineScoreHeadBadge | null>(() => {
  if (delayBadgeLabel.value) {
    return { label: delayBadgeLabel.value, tone: 'warning' }
  }
  if (gameStatusBadgeLabel.value) {
    return { label: gameStatusBadgeLabel.value, tone: gameStatusBadgeTone.value }
  }
  return null
})

function lineupSummary(playerId: string) {
  const player = scoresheet.value?.players.find((entry) => entry.id === playerId)
  if (!player?.mappedLineupId) return null
  return scoresheet.value?.lineupOptions.find((entry) => entry.id === player.mappedLineupId) ?? null
}

function playerDisplayName(rawName: string) {
  return rawName.replace(/\s*\([^)]*\)\s*/g, '').trim() || rawName
}

function playerNickname(playerId: string, rawName: string) {
  const nickname = rawName.match(/\(([^)]+)\)/)?.[1]?.trim()
  if (nickname) return nickname
  const rawDisplay = playerDisplayName(rawName)
  const firstName = rawDisplay.split(/\s+/)[0] ?? ''
  const mappedName = lineupSummary(playerId)?.name?.trim() ?? ''
  if (mappedName && mappedName !== rawDisplay) return rawDisplay
  return firstName !== rawDisplay ? firstName : ''
}

function playerFullName(playerId: string, rawName: string) {
  const mappedName = lineupSummary(playerId)?.name?.trim()
  if (mappedName) return mappedName
  return playerDisplayName(rawName)
}

// Resolve per-slot starter / substitute / active player from the submitted
// game lineup so each row renders the correct person + their sub (if any).
function submittedLineupForOrder(order: number) {
  return (scoresheet.value?.gameLineupSubmission?.players ?? []).filter(
    (player) => player.battingOrder === order && !player.isBench
  )
}

function lineupSlotContext(order: number) {
  const slotPlayers = submittedLineupForOrder(order)
  return {
    starter: slotPlayers.find((entry) => !entry.isSubstitute) ?? null,
    substitute: slotPlayers.find((entry) => entry.isSubstitute) ?? null,
    active: slotPlayers.find((entry) => entry.isActive) ?? null
  }
}

// Only include rows that carry a real gameLineupPlayerId (= game_lineup_players.id).
// The adapter already filters these out upstream, so this is belt-and-braces to
// guarantee the grid never falls back to batting_order as an identity key —
// batting_order changes when the lineup is reordered, which would silently
// detach score cells from the player they belong to.
const scoresheetLineupRows = computed(() =>
  (scoresheet.value?.players ?? []).filter(
    (player): player is typeof player & { gameLineupPlayerId: number } =>
      player.gameLineupPlayerId != null
  )
)

const lineup = computed<GridPlayer[]>(() =>
  scoresheetLineupRows.value.map((player) => {
    const slot = lineupSlotContext(player.battingOrder)
    // Row anchor is the starter; fall back to the scoresheet row's own data
    // so the jersey/name never cross-borrows from another slot.
    const starterName = slot.starter?.playerName ?? playerFullName(player.id, player.playerName)
    const starterJersey = slot.starter?.jerseyNumber ?? player.jerseyNumber ?? null
    const positionCode = slot.starter?.positionCode ?? lineupSummary(player.id)?.position ?? 'EH'
    // Sub identity — prefer the adapter's attached fields (strict id match),
    // falling back to the submission-derived slot context for display-only
    // props if the adapter didn't populate (e.g. pre-persistence edge cases).
    const subId = player.substituteGameLineupPlayerId ?? null
    const subName = player.substitutePlayerName ?? slot.substitute?.playerName ?? null
    const subJersey = player.substituteJerseyNumber ?? slot.substitute?.jerseyNumber ?? null
    const subPosition = player.substitutePositionCode ?? slot.substitute?.positionCode ?? null
    const subInning = player.substituteEnteredInning ?? slot.substitute?.enteredInning ?? null
    return {
      id: player.gameLineupPlayerId,
      row_id: player.id,
      batting_order: player.battingOrder,
      position_code: positionCode,
      player_name: starterName,
      player_note: starterJersey || null,
      substitute_name: subName,
      substitute_note:
        subName && subInning
          ? `In ${subInning} - ${subPosition ?? 'EH'}`
          : null,
      substitute_inning: subInning,
      substitute_id: subId,
      substitute_player_name: subName,
      substitute_jersey_number: subJersey,
      substitute_position_code: subPosition
    }
  })
)

function computeStats(
  cells: ScoresheetCell[]
): { atBats: number; hits: number; walks: number; strikeouts: number; rbi: number } {
  const allAppearances = cells.flatMap((cell) => cell.appearances)
  const hits = allAppearances.filter((appearance) => ['1B', '2B', '3B', 'HR'].includes(appearance.result)).length
  const walks = allAppearances.filter((appearance) => ['BB', 'IBB'].includes(appearance.result)).length
  const strikeouts = allAppearances.filter((appearance) => ['K', 'KC'].includes(appearance.result)).length
  const atBats = allAppearances.filter(
    (appearance) => !['BB', 'IBB', 'SAC', 'SF', 'HBP', 'CI'].includes(appearance.result)
  ).length
  const rbi = allAppearances.reduce((sum, appearance) => sum + (appearance.rbi ?? 0), 0)
  return { atBats, hits, walks, strikeouts, rbi }
}

const plateAppearances = computed<GridAppearance[]>(() =>
  scoresheetLineupRows.value.flatMap((player) => {
    const entries: GridAppearance[] = []
    // Starter's appearances — keyed by starter's game_lineup_player_id.
    for (const cell of player.cells) {
      for (const appearance of cell.appearances) {
        entries.push({
          id: appearance.id,
          game_lineup_player_id: player.gameLineupPlayerId,
          inning_number: cell.inning,
          result_code: appearance.result,
          batter_end_base: appearance.batterEndBase,
          rbi: appearance.rbi,
          run_scored: appearance.batterEndBase === 'HP',
          result_detail: appearance.notes || null,
          pitch_type: null,
          which_out: appearance.outsOnPlay || null
        })
      }
    }
    // Sub's appearances — keyed by sub's own game_lineup_player_id so the
    // grid's appearanceIndex can resolve them via effective-identity lookup.
    if (player.substituteGameLineupPlayerId != null && player.substituteCells) {
      for (const cell of player.substituteCells) {
        for (const appearance of cell.appearances) {
          entries.push({
            id: appearance.id,
            game_lineup_player_id: player.substituteGameLineupPlayerId,
            inning_number: cell.inning,
            result_code: appearance.result,
            batter_end_base: appearance.batterEndBase,
            rbi: appearance.rbi,
            run_scored: appearance.batterEndBase === 'HP',
            result_detail: appearance.notes || null,
            pitch_type: null,
            which_out: appearance.outsOnPlay || null
          })
        }
      }
    }
    return entries
  })
)

const battingStats = computed<GridBattingStat[]>(() =>
  scoresheetLineupRows.value.flatMap((player) => {
    const entries: GridBattingStat[] = []
    const starterStats = computeStats(player.cells)
    entries.push({
      game_lineup_player_id: player.gameLineupPlayerId,
      at_bats: starterStats.atBats,
      runs: player.runs,
      hits: player.hits || starterStats.hits,
      rbi: player.rbi || starterStats.rbi,
      stolen_bases: 0,
      walks: starterStats.walks,
      strikeouts: starterStats.strikeouts
    })
    if (player.substituteGameLineupPlayerId != null && player.substituteCells) {
      const subStats = computeStats(player.substituteCells)
      entries.push({
        game_lineup_player_id: player.substituteGameLineupPlayerId,
        at_bats: subStats.atBats,
        runs: player.substituteRuns ?? 0,
        hits: (player.substituteHits ?? 0) || subStats.hits,
        rbi: (player.substituteRbi ?? 0) || subStats.rbi,
        stolen_bases: 0,
        walks: subStats.walks,
        strikeouts: subStats.strikeouts
      })
    }
    return entries
  })
)

const currentInning = computed<number | null>(() => scoresheet.value?.currentInning ?? null)
const gameIsLive = computed(() => scoresheet.value?.isLive ?? false)
const hasSubmittedGameLineup = computed(() => scoresheet.value?.gameLineupSubmitted ?? false)
const canEditScoresheet = computed(() => isAdmin.value && hasSubmittedGameLineup.value)
const lineupSourceLabel = computed(() =>
  hasSubmittedGameLineup.value ? 'Game lineup submission' : 'Event lineup template preview'
)
const lineupStatusMeta = computed(() => {
  return gameLineupSubmissionStatusMeta(scoresheet.value?.gameLineupSubmission?.status ?? lineupFormStatus.value)
})
const fieldPositions = computed<FieldConfigPosition[]>(() => {
  if (scoresheet.value?.fieldConfigPositions?.length) return scoresheet.value.fieldConfigPositions
  return DEFAULT_SLOW_PITCH_POSITIONS.map((code) => ({
    code,
    label: code,
    area: 'flex'
  }))
})
const lineupStarters = computed(() =>
  lineupDraft.value
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
)
const lineupBench = computed(() =>
  lineupDraft.value
    .filter((player) => player.isBench && !player.isSubstitute)
    .slice()
    .sort((left, right) => left.playerName.localeCompare(right.playerName))
)
const lineupSubstitutions = computed(() =>
  lineupDraft.value
    .filter((player) => player.isSubstitute || (!player.isActive && !!player.exitedInning))
    .slice()
    .sort((left, right) => {
      const leftInning = left.enteredInning ?? left.exitedInning ?? 999
      const rightInning = right.enteredInning ?? right.exitedInning ?? 999
      return leftInning - rightInning || left.playerName.localeCompare(right.playerName)
    })
)
const substitutionTargets = computed(() =>
  lineupDraft.value
    .filter((player) => !player.isBench && player.isActive)
    .slice()
    .sort((left, right) => left.battingOrder - right.battingOrder)
)
const lineupInningOptions = computed(() => Array.from({ length: totalInningsForGrid.value }, (_, index) => index + 1))

function hasGameLineupSubmission(submission: GameLineupSubmission) {
  return !!submission.id || ['submitted', 'approved', 'finalized'].includes(submission.status)
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
  const positions = DEFAULT_SLOW_PITCH_POSITIONS
  return templateLineup.map((player, index) => ({
    id: `draft-${player.id}`,
    eventLineupId: player.id,
    teamMemberId: player.teamMemberId ?? undefined,
    userId: player.userId ?? undefined,
    playerName: player.name,
    jerseyNumber: player.jerseyNumber,
    battingOrder: index + 1,
    positionCode: positions[index] ?? player.position ?? 'EH',
    isStarter: index < 10,
    isBench: index >= 10 || player.status === 'bench',
    isSubstitute: false,
    isActive: true,
    substitutesForId: null,
    playerSourceType:
      player.teamMemberId != null || player.userId != null
        ? 'team_member'
        : player.playerSourceType ?? 'manual'
  }))
}

function lineupPlayerLinkageLabel(player: GameLineupPlayer) {
  return player.teamMemberId || player.userId ? 'Linked teammate' : 'Manual Player'
}

function syncStarterState(players: GameLineupPlayer[]) {
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
      player.positionCode = DEFAULT_SLOW_PITCH_POSITIONS[starterIndex - 1] ?? 'EH'
    }
  }

  for (const [benchIndex, player] of orderedBench.entries()) {
    if (player.isBench) {
      player.isStarter = false
      player.battingOrder = 90 + benchIndex + 1
      if (!player.positionCode) player.positionCode = 'EH'
    }
  }

  players.splice(0, players.length, ...orderedStarters, ...orderedInactive, ...orderedBench)
}

function applyLineupFieldConfig(detail: GameLineupSubmissionDetail) {
  if (!scoresheet.value || !detail.fieldConfig) return
  scoresheet.value.fieldConfigName = detail.fieldConfig.name ?? scoresheet.value.fieldConfigName
  if (detail.fieldConfig.positions.length) {
    scoresheet.value.fieldConfigPositions = detail.fieldConfig.positions
  }
}

async function openManageLineup() {
  if (!scoresheet.value) return
  lineupModalOpen.value = true
}

function closeManageLineup() {
  lineupModalOpen.value = false
}

function setPlayerBench(playerId: string, isBench: boolean) {
  const player = lineupDraft.value.find((entry) => entry.id === playerId)
  if (!player) return
  player.isBench = isBench
  player.isSubstitute = false
  player.substitutesForId = null
  player.enteredInning = null
  player.exitedInning = null
  player.isActive = !isBench
  player.positionCode = isBench ? 'EH' : player.positionCode ?? DEFAULT_SLOW_PITCH_POSITIONS[0]
  syncStarterState(lineupDraft.value)
}

function substituteLabel(playerId: string | null | undefined) {
  if (!playerId) return ''
  return lineupDraft.value.find((entry) => entry.id === playerId)?.playerName ?? ''
}

function prepareSubstitute(playerId: string) {
  const player = lineupDraft.value.find((entry) => entry.id === playerId)
  if (!player) return
  const existingDraft = substituteDrafts.value[playerId]
  substituteDrafts.value = {
    ...substituteDrafts.value,
    [playerId]: {
      targetId: existingDraft?.targetId ?? substitutionTargets.value[0]?.id ?? null,
      inning: existingDraft?.inning ?? 5,
      positionCode: existingDraft?.positionCode ?? player.positionCode ?? 'EH'
    }
  }
}

function applySubstitute(playerId: string) {
  const substitute = lineupDraft.value.find((entry) => entry.id === playerId)
  const draft = substituteDrafts.value[playerId]
  if (!substitute || !draft?.targetId || !draft.inning) return
  const target = lineupDraft.value.find((entry) => entry.id === draft.targetId)
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

  syncStarterState(lineupDraft.value)
  const { [playerId]: _removedDraft, ...remainingDrafts } = substituteDrafts.value
  substituteDrafts.value = remainingDrafts
}

function undoSubstitute(playerId: string) {
  const substitute = lineupDraft.value.find((entry) => entry.id === playerId)
  if (!substitute || !substitute.substitutesForId) return
  const target = lineupDraft.value.find((entry) => entry.id === substitute.substitutesForId)
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
  syncStarterState(lineupDraft.value)
}

function onLineupDragStart(event: DragEvent, playerId: string) {
  draggedLineupPlayerId.value = playerId
  lineupDropTargetId.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', playerId)
  }
}

function onLineupDragEnd() {
  draggedLineupPlayerId.value = null
  lineupDropTargetId.value = null
}

function onLineupDragOver(event: DragEvent, targetPlayerId: string) {
  event.preventDefault()
  lineupDropTargetId.value = targetPlayerId
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function moveStarterTo(event: DragEvent, targetPlayerId: string) {
  event.preventDefault()
  const draggedId = event.dataTransfer?.getData('text/plain') || draggedLineupPlayerId.value
  if (!draggedId || draggedId === targetPlayerId) return

  const starters = lineupDraft.value
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
  syncStarterState(lineupDraft.value)
  draggedLineupPlayerId.value = null
  lineupDropTargetId.value = null
}

function availablePositions(forPlayerId: string) {
  const taken = new Set(
    lineupDraft.value
      .filter((player) => !player.isBench && player.id !== forPlayerId)
      .map((player) => player.positionCode)
      .filter(Boolean)
  )
  return fieldPositions.value.filter(
    (position) => position.code === 'EH' || !taken.has(position.code)
  )
}

async function saveApprovedLineup() {
  if (!scoresheet.value) return
  lineupSaving.value = true
  try {
    const normalizedPlayers = normalizeGameLineupPlayers(lineupDraft.value)
    syncStarterState(normalizedPlayers)
    const timestamp =
      scoresheet.value.gameLineupSubmission?.approvedAt ??
      scoresheet.value.gameLineupSubmission?.submittedAt ??
      '2025-04-19 10:05 AM'
    const nextSubmission: GameLineupSubmission = {
      id: scoresheet.value.gameLineupSubmission?.id ?? null,
      status: lineupFormStatus.value,
      approvalMode: scoresheet.value.gameLineupSubmission?.approvalMode ?? 'manual',
      sourceType: scoresheet.value.gameLineupSubmission?.sourceType ?? 'copied_from_event_lineup',
      submittedAt: scoresheet.value.gameLineupSubmission?.submittedAt ?? timestamp,
      approvedAt: timestamp,
      rejectionReason: scoresheet.value.gameLineupSubmission?.rejectionReason ?? null,
      notes: lineupFormNotes.value.trim(),
      players: normalizedPlayers
    }
    const savedSubmission = await saveGameLineupSubmission(gameId.value, teamId.value, nextSubmission)
    scoresheet.value.gameLineupSubmission = savedSubmission
    scoresheet.value.gameLineupSubmitted = hasGameLineupSubmission(savedSubmission)
    scoresheet.value.lineupOptions = savedSubmission.players
      .filter((player) => player.isActive || player.isBench)
      .map((player) => ({
        id: player.eventLineupId ?? player.id,
        jerseyNumber: player.jerseyNumber,
        name: player.playerName,
        position: player.positionCode ?? 'EH',
        status: player.isBench ? 'bench' : 'active'
      }))
    lineupDraft.value = normalizeGameLineupPlayers(savedSubmission.players)
    lineupFormStatus.value = savedSubmission.status
  } finally {
    lineupSaving.value = false
  }
}

async function load() {
  shellLoading.value = true
  ledgerLoading.value = false
  scoresheet.value = null
  participation.value = null

  // Kick off participation fetch in parallel — only used to source isAdmin
  // and the back-nav context, so it's fire-and-forget and errors don't
  // block the scoresheet load.
  const pid = participationId.value
  if (pid) {
    void fetchTeamParticipation(pid)
      .then((data) => {
        participation.value = data
      })
      .catch(() => {
        // Leave participation null → isAdmin stays false → view stays read-only.
      })
  }

  const shell = await fetchScoresheetShell(teamId.value, gameGuid.value)
  if (shell) {
    scoresheet.value = shell
    shellLoading.value = false
  }

  ledgerLoading.value = true

  try {
    // `eventId` isn't used in the request URL by `fetchScoresheet` anymore,
    // but the param is retained for signature stability. `gameId` is pulled
    // from the shell result (the legacy score API returns the numeric id).
    const resolvedGameId = scoresheet.value?.gameId ?? ''
    scoresheet.value = await fetchScoresheet('', teamId.value, resolvedGameId, gameGuid.value)
  } finally {
    shellLoading.value = false
    ledgerLoading.value = false
  }
}

async function onGameLineupSaved(savedSubmission: GameLineupSubmission) {
  if (!scoresheet.value) return
  // Patch the in-memory submission immediately so the modal close doesn't
  // flash stale lineup copy, but then re-fetch the full scoresheet so
  // scoresheet.players (the row source) and gameLineupSubmission stay in
  // sync. Without the refetch, reordering players in the modal leaves
  // scoresheet.players on the OLD batting_order — the rows render with
  // new names (from slot lookup) but old gameLineupPlayerIds, so each
  // row's score diamonds belong to the player who *used* to be in that
  // slot, not the one whose name now appears.
  scoresheet.value.gameLineupSubmission = savedSubmission
  scoresheet.value.gameLineupSubmitted = hasGameLineupSubmission(savedSubmission)
  scoresheet.value.lineupOptions = savedSubmission.players
    .filter((player) => player.isActive || player.isBench)
    .map((player) => ({
      id: player.eventLineupId ?? player.id,
      jerseyNumber: player.jerseyNumber,
      name: player.playerName,
      position: player.positionCode ?? 'EH',
      status: player.isBench ? 'bench' : 'active'
    }))

  try {
    ledgerLoading.value = true
    const refreshed = await fetchScoresheet('', teamId.value, gameId.value, gameGuid.value)
    if (refreshed) scoresheet.value = refreshed
  } finally {
    ledgerLoading.value = false
  }
}

function handleScroll() {
  condensedHeaderVisible.value = window.scrollY > 140
}

async function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploading.value = true
  try {
    scoresheet.value = await uploadScoresheetImage(gameId.value, teamId.value, file)
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function publish() {
  if (!scoresheet.value) return
  saving.value = true
  try {
    scoresheet.value = await submitScoresheetForPublish(gameId.value, teamId.value)
  } finally {
    saving.value = false
  }
}

function openUploadReview() {
  router.push({
    name: 'scoresheet-review',
    params: {
      participationId: participationId.value ?? '',
      teamId: teamId.value,
      gameGuid: gameGuid.value ?? ''
    }
  })
}

function goToTeamParticipation() {
  const pid = participationId.value
  if (pid) {
    router.push({
      name: 'team-participation',
      params: { teamParticipationId: pid }
    })
  } else {
    router.push({ path: '/' })
  }
}

function openAppearanceEditor(payload: {
  player: GridPlayer
  inning: number
  existingAppearance: GridAppearance | null
  appearanceCount: number
  appearanceNumber: number
}) {
  appearanceModalPlayer.value = payload.player
  appearanceModalInning.value = payload.inning
  appearanceModalExisting.value = payload.existingAppearance
  appearanceModalCount.value = payload.appearanceCount
  appearanceModalNumber.value = payload.appearanceNumber
  appearanceModalCreatingNext.value = false
  appearanceModalOpen.value = true
}

function closeAppearanceEditor() {
  appearanceModalOpen.value = false
  appearanceModalPlayer.value = null
  appearanceModalInning.value = null
  appearanceModalExisting.value = null
  appearanceModalCount.value = 0
  appearanceModalNumber.value = 1
  appearanceModalCreatingNext.value = false
}

function startNextAppearanceEditor() {
  appearanceModalExisting.value = null
  appearanceModalCreatingNext.value = true
  appearanceModalNumber.value = appearanceModalCount.value + 1
}

function applyPlayerAppearanceStats(lineupPlayerId: number, stats: {
  atBats: number
  runs: number
  hits: number
  rbi: number
}) {
  const player = scoresheet.value?.players.find((entry) => entry.gameLineupPlayerId === lineupPlayerId)
  if (!player) return
  player.runs = stats.runs
  player.hits = stats.hits
  player.rbi = stats.rbi
}

function scorebookInningHalf() {
  if (scoresheet.value?.teamSide === 'H') return 'bottom' as const
  if (scoresheet.value?.teamSide === 'V') return 'top' as const
  return null
}

function nextBattingSequenceNumber() {
  if (!scoresheet.value) return null
  const appearances = scoresheet.value.players.flatMap((player) =>
    player.cells.flatMap((cell) => cell.appearances)
  )
  return appearances.length + 1
}

// Resolves a `lineupPlayerId` back to its row and which stream owns it. A row
// carries two parallel streams (starter / substitute), so optimistic save and
// delete updates need to route cell reads/writes to the stream whose id was
// passed in — otherwise sub PAs get the "Player not found" toast because the
// id doesn't match the starter's `gameLineupPlayerId`.
function resolveScoresheetRow(lineupPlayerId: number) {
  if (!scoresheet.value) return null
  const id = Number(lineupPlayerId)
  for (const row of scoresheet.value.players) {
    if (Number(row.gameLineupPlayerId) === id) {
      return { row, isSub: false as const }
    }
    if (row.substituteGameLineupPlayerId != null
        && Number(row.substituteGameLineupPlayerId) === id) {
      return { row, isSub: true as const }
    }
  }
  return null
}

async function onSaveAppearance(payload: {
  lineupPlayerId?: number
  inningNumber?: number
  appearanceId?: string | null
  createNextAppearance?: boolean
  appearanceNumber?: number | null
  result_code?: string | null
  batter_end_base?: '1B' | '2B' | '3B' | 'HP' | null
  rbi?: number
  result_detail?: string | null
  which_out?: number | null
  pitch_type?: string | null
  counts_as_at_bat?: boolean
  counts_as_plate_appearance?: boolean
  is_on_base?: boolean
  run_scored?: boolean
  is_earned_run?: boolean | null
}) {
  if (!scoresheet.value || !payload.lineupPlayerId || !payload.inningNumber || !payload.result_code) {
    pushToast({ tone: 'warning', title: 'Missing required fields', message: 'Player, inning, and result code are required to save a plate appearance.' })
    return
  }

  // Match by starter OR substitute id — the grid emits the effective id for
  // the inning, which is the sub's id on post-sub innings.
  const match = resolveScoresheetRow(payload.lineupPlayerId)
  if (!match) {
    pushToast({ tone: 'warning', title: 'Player not found', message: `Could not find player (id: ${payload.lineupPlayerId}) in the scoresheet lineup. Please refresh and try again.` })
    return
  }
  const { row: player, isSub } = match
  // Route optimistic updates to the stream the id belongs to. If a row is
  // flagged as sub but somehow has no substituteCells array yet (shouldn't
  // happen with the current adapter, but keep the fallback so UI stays
  // consistent), materialize one before writing.
  if (isSub && !player.substituteCells) {
    player.substituteCells = []
  }
  const cells = isSub ? player.substituteCells! : player.cells

  let cell = cells.find((entry) => entry.inning === payload.inningNumber)
  if (!cell) {
    cell = {
      inning: payload.inningNumber,
      appearances: [],
      reviewState: 'review'
    }
    cells.push(cell)
    cells.sort((left, right) => left.inning - right.inning)
  }

  const existingIndex = payload.appearanceId
    ? cell.appearances.findIndex((appearance) => appearance.id === payload.appearanceId)
    : -1

  saving.value = true
  try {
    const mutation = existingIndex >= 0 && !payload.createNextAppearance
      ? await updatePlateAppearance(gameId.value, teamId.value, payload.appearanceId!, {
          lineupPlayerId: payload.lineupPlayerId,
          sportTypeId,
          inningNumber: payload.inningNumber,
          resultCode: payload.result_code,
          resultDetail: payload.result_detail ?? null,
          batterEndBase: payload.batter_end_base ?? null,
          rbi: payload.rbi ?? 0,
          whichOut: payload.which_out ?? null,
          pitchType: payload.pitch_type ?? null,
          inningHalf: scorebookInningHalf(),
          battingSequenceNo: nextBattingSequenceNumber(),
          plateAppearanceNoForPlayer: payload.appearanceNumber ?? appearanceModalNumber.value,
          outsBefore: null,
          outsAfter: null,
          countsAsAtBat: payload.counts_as_at_bat ?? true,
          countsAsPlateAppearance: payload.counts_as_plate_appearance ?? true,
          isOnBase: payload.is_on_base ?? false,
          runScored: payload.run_scored ?? payload.batter_end_base === 'HP',
          isEarnedRun: payload.is_earned_run ?? null,
          sourceType: 'manual'
        })
      : await createPlateAppearance(gameId.value, teamId.value, {
          lineupPlayerId: payload.lineupPlayerId,
          sportTypeId,
          inningNumber: payload.inningNumber,
          resultCode: payload.result_code,
          resultDetail: payload.result_detail ?? null,
          batterEndBase: payload.batter_end_base ?? null,
          rbi: payload.rbi ?? 0,
          whichOut: payload.which_out ?? null,
          pitchType: payload.pitch_type ?? null,
          inningHalf: scorebookInningHalf(),
          battingSequenceNo: nextBattingSequenceNumber(),
          plateAppearanceNoForPlayer: payload.appearanceNumber ?? appearanceModalNumber.value,
          outsBefore: null,
          outsAfter: null,
          countsAsAtBat: payload.counts_as_at_bat ?? true,
          countsAsPlateAppearance: payload.counts_as_plate_appearance ?? true,
          isOnBase: payload.is_on_base ?? false,
          runScored: payload.run_scored ?? payload.batter_end_base === 'HP',
          isEarnedRun: payload.is_earned_run ?? null,
          sourceType: 'manual'
        })

    const nextAppearance: ScoresheetPlateAppearance = {
      id: mutation.appearance.id,
      sequence:
        existingIndex >= 0 && !payload.createNextAppearance
          ? cell.appearances[existingIndex].sequence
          : cell.appearances.length + 1,
      result: mutation.appearance.result,
      batterEndBase: mutation.appearance.batterEndBase,
      contactType: mutation.appearance.contactType,
      rbi: mutation.appearance.rbi,
      outsOnPlay: mutation.appearance.outsOnPlay,
      baserunning: mutation.appearance.baserunning,
      fieldZone: mutation.appearance.fieldZone,
      fieldersInvolved: mutation.appearance.fieldersInvolved,
      notes: mutation.appearance.notes
    }

    if (existingIndex >= 0 && !payload.createNextAppearance) {
      nextAppearance.sequence = cell.appearances[existingIndex].sequence
      cell.appearances.splice(existingIndex, 1, nextAppearance)
    } else {
      nextAppearance.sequence = cell.appearances.length + 1
      cell.appearances.push(nextAppearance)
    }

    cell.reviewState = 'review'
    applyPlayerAppearanceStats(payload.lineupPlayerId, mutation.playerStats)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Failed to save plate appearance',
      message: error instanceof Error ? error.message : 'An unexpected error occurred. Please try again.'
    })
  } finally {
    saving.value = false
  }
}

async function onSaveAppearanceFromModal(payload: {
  lineup_player_id: number
  inning_number: number
  result_code: string | null
  result_detail: string | null
  batter_end_base?: '1B' | '2B' | '3B' | 'HP' | null
  rbi: number
  which_out?: number | null
  pitch_type?: string | null
  counts_as_at_bat: boolean
  counts_as_plate_appearance: boolean
  is_on_base: boolean
  run_scored?: boolean
  is_earned_run?: boolean | null
  appearance_number?: number
}) {
  await onSaveAppearance({
    ...payload,
    lineupPlayerId: appearanceModalPlayer.value?.id ?? undefined,
    inningNumber: appearanceModalInning.value ?? undefined,
    appearanceNumber: payload.appearance_number ?? appearanceModalNumber.value,
    appearanceId: appearanceModalCreatingNext.value ? null : appearanceModalExisting.value?.id ?? null,
    createNextAppearance: appearanceModalCreatingNext.value
  })
  closeAppearanceEditor()
}

async function onDeleteAppearanceFromModal(appearanceId: string | number) {
  if (!scoresheet.value || !appearanceModalPlayer.value || !appearanceModalInning.value) return

  // Same starter/sub dual-identity resolution as the save path — the modal's
  // player.id is the effective id the grid emitted (sub id on post-sub innings).
  const match = resolveScoresheetRow(appearanceModalPlayer.value.id)
  if (!match) return
  const { row: player, isSub } = match
  const cells = isSub ? player.substituteCells : player.cells
  const cell = cells?.find((entry) => entry.inning === appearanceModalInning.value)
  if (!cell) return

  // Use a dedicated `deleting` flag (not the shared `saving` flag) so the modal
  // can show "Deleting..." on the delete button while disabling save/next,
  // instead of the old behaviour where the save button flipped to "Saving..."
  // during a delete.
  deleting.value = true
  try {
    const deletion = await deletePlateAppearance(gameId.value, teamId.value, String(appearanceId))
    const deletedId = deletion.deletedId ?? String(appearanceId)
    const deletedIndex = cell.appearances.findIndex((appearance) => appearance.id === deletedId)

    if (deletedIndex >= 0) {
      cell.appearances.splice(deletedIndex, 1)
      cell.appearances.forEach((appearance, sequence) => {
        appearance.sequence = sequence + 1
      })
    }

    cell.reviewState = cell.appearances.length ? 'review' : 'empty'
    applyPlayerAppearanceStats(deletion.gameLineupPlayerId || appearanceModalPlayer.value.id, deletion.playerStats)
    closeAppearanceEditor()
  } finally {
    deleting.value = false
  }
}

onMounted(load)
onMounted(() => {
  handleScroll()
  window.addEventListener('scroll', handleScroll, { passive: true })
  // Viewport-width tracking for the line-score grid template
  // moved into `LineScore.vue` along with the markup extraction.
})

watch(appearanceModalOpen, (open) => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('modal-open', open)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScroll)
  if (typeof document !== 'undefined') {
    document.body.classList.remove('modal-open')
  }
})

</script>

<template>
  <!--
    Real page renders only when (a) the scoresheet ref is populated AND
    (b) the full ledger fetch has completed. The shell load
    (fetchScoresheetShell) returns mock-seeded data — assigning it
    flipped `scoresheet` to non-null, which used to flash the real
    template populated with the mock 9-inning grid + dummy schedule /
    time-limit / location values for the second or two between the
    shell and the live `fetchScoresheet` call. Gating on
    `!ledgerLoading` keeps the page-level skeleton (which has matching
    shimmer placeholders for every meta-box section) on screen until
    real data arrives.
  -->
  <main v-if="scoresheet && !ledgerLoading">
    <section class="condensed-team-header" :class="{ 'condensed-team-header--visible': condensedHeaderVisible }">
        <div class="condensed-team-header__main">
          <div class="condensed-team-header__top">
            <TeamAvatar :name="scoresheet.teamName" size="md" />
            <span class="condensed-team-header__name condensed-team-header__name--scoresheet">
              <span class="condensed-team-header__name-primary">{{ condensedTeamName }}</span>
              <span class="condensed-team-header__name-separator"> vs </span>
              <span class="condensed-team-header__name-opponent">{{ condensedOpponentName }}</span>
            </span>
            <div class="condensed-team-header__badges">
              <template v-if="ledgerLoading">
                <span class="shimmer-block scoresheet-skeleton__badge"></span>
                <span class="shimmer-block scoresheet-skeleton__badge"></span>
              </template>
              <template v-else>
                <StatusBadge :label="headerLineupBadgeLabel" :tone="headerLineupBadgeTone" />
                <StatusBadge :label="headerScorebookBadgeLabel" :tone="headerScorebookBadgeTone" />
              </template>
            </div>
          </div>
          <div class="condensed-team-header__subline">{{ condensedMatchupSubline }}</div>
        </div>
      <div class="condensed-team-header__meta">
        <div class="condensed-team-header__manager-row">
          <span class="condensed-team-header__meta-label">Team Manager</span>
          <strong v-if="!ledgerLoading" class="condensed-team-header__meta-value">{{ displayManager.name }}</strong>
          <span v-else class="shimmer-block scoresheet-skeleton__mini-line"></span>
        </div>
        <button v-if="hasSubmittedGameLineup && isAdmin" class="condensed-lineup-button" type="button" @click="openManageLineup">
          Manage Lineup
        </button>
      </div>
    </section>

    <div class="page-shell">
      <section class="hero">
        <div class="hero__main">
          <div class="hero-title-row">
            <p class="eyebrow">Game Details</p>
            <div class="hero-inline-badges">
              <template v-if="ledgerLoading">
                <span class="shimmer-block scoresheet-skeleton__badge"></span>
                <span class="shimmer-block scoresheet-skeleton__badge"></span>
              </template>
              <template v-else>
                <StatusBadge :label="headerLineupBadgeLabel" :tone="headerLineupBadgeTone" />
                <StatusBadge :label="headerScorebookBadgeLabel" :tone="headerScorebookBadgeTone" />
              </template>
            </div>
          </div>
          <div class="team-heading">
            <TeamAvatar :name="scoresheet.teamName" size="lg" />
            <h1>{{ scoresheet.teamName }}</h1>
          </div>
          <p v-if="heroTeamMetaText" class="hero-team-meta">{{ heroTeamMetaText }}</p>
        <div class="scoresheet-versus-row">
          <span class="scoresheet-versus-row__label">vs</span>
          <TeamAvatar :name="scoresheet.opponent" size="md" />
          <span class="scoresheet-versus-row__opponent">{{ scoresheet.opponent }}</span>
        </div>
          <p class="hero-copy">{{ scoresheet.division }} - {{ scoresheet.eventName ?? '' }}</p>
          <!-- Bracket label + game time on one line. When the game has
               no scheduled time (gameTime empty), surface "Unscheduled"
               instead of leaving a trailing dash with nothing after it. -->
          <p class="hero-copy">{{ scoresheet.bracketLabel }} - {{ scoresheet.gameTime?.trim() || 'Unscheduled' }}</p>
          <div class="hero-strip">
            <button class="hero-strip__item hero-strip__item--button" type="button" @click="goToTeamParticipation">
              Back to Event Participation
            </button>
          </div>
      </div>
      <div class="hero-status scoresheet-hero-status">
        <button v-if="!ledgerLoading && hasSubmittedGameLineup && isAdmin" class="ledger-action-button hero-lineup-action" type="button" @click="openManageLineup">
          Manage Lineup
        </button>
        <div v-if="ledgerLoading" class="hero-manager-card scoresheet-skeleton-card">
          <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
          <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
          <span class="shimmer-block scoresheet-skeleton__line"></span>
          <span class="shimmer-block scoresheet-skeleton__line"></span>
        </div>
        <div v-else class="hero-manager-card">
          <span class="hero-manager-card__label">Team Manager</span>
          <span class="hero-manager-card__name">{{ displayManager.name }}</span>
          <span class="hero-manager-card__meta-item">
            <img :src="mobileIcon" alt="" class="hero-manager-card__meta-icon" />
            {{ displayManager.phone }}
          </span>
          <span class="hero-manager-card__meta-item">
            <img :src="emailIcon" alt="" class="hero-manager-card__meta-icon" />
            {{ displayManager.email }}
          </span>
        </div>
      </div>
    </section>

    <section class="content-grid content-grid--scoresheet">
      <div class="stack stack--wide">
        <div
          class="scoresheet-top-row"
          :class="{ 'scoresheet-top-row--solo': !isAdmin }"
        >
          <div class="panel">
            <div class="scoresheet-header-board">
              <!-- Line-score block extracted to the reusable
                   `LineScore` component (`src/components/scoring-lib/
                   LineScore.vue`). Same DOM + CSS classes as before
                   — the component renders into the same global
                   `.scoresheet-linescore*` rules from styles.css,
                   and owns its own viewport-width listener +
                   grid-template calc internally, so the surface
                   reads identically while the markup lives in one
                   place. -->
              <LineScore
                :innings="lineScoreInnings"
                :rows="lineScoreRows"
                :game-has-started="gameHasStarted"
                :current-inning="currentInning"
                :head-badge="lineScoreHeadBadge"
              />
              <div class="scoresheet-meta-column">
                <div class="scoresheet-meta-row">
                  <div class="scoresheet-meta-box scoresheet-meta-box--compact">
                    <span>{{ displayStartTimeLabel }}</span>
                    <!-- Value hidden in the Unscheduled state — `displayStartTime`
                         resolves to '' there, so showing the <strong> would
                         render an empty bold line and a vertical gap below
                         the label. Skipping the element keeps the card a
                         single-line "Unscheduled" pill. -->
                    <strong v-if="displayStartTime">{{ displayStartTime }}</strong>
                  </div>
                  <div class="scoresheet-meta-box scoresheet-meta-box--compact">
                    <span>Time Limit</span>
                    <!-- Always renders the value-strong. `displayTimeLimit`
                         resolves to a dash when the backend hasn't set
                         the cap yet (game hasn't started). -->
                    <strong>{{ displayTimeLimit }}</strong>
                  </div>
                </div>
                <div class="scoresheet-meta-box scoresheet-meta-box--location">
                  <span>Location</span>
                  <!-- Three render paths:
                       1. field+park populated → show "<field> - <park>"
                          line, plus "<city>, <state>" line when those
                          are also set.
                       2. No field/park → show a single dash so the
                          card always has SOME value below the label.
                       Dropping the city/state line in case 2 is
                       intentional: city/state without venue is treated
                       as a mock leftover (per product). -->
                  <template v-if="venueSummary.top">
                    <strong>{{ venueSummary.top }}</strong>
                    <em v-if="venueSummary.bottom">{{ venueSummary.bottom }}</em>
                  </template>
                  <strong v-else>-</strong>
                </div>
              </div>
            </div>
          </div>
          <div v-if="ledgerLoading" class="panel panel--accent scoresheet-skeleton-card scoresheet-skeleton-card--upload">
            <div class="scoresheet-skeleton__stack scoresheet-skeleton__stack--split">
              <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
              <span class="shimmer-block scoresheet-skeleton__badge"></span>
            </div>
            <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
            <span class="shimmer-block scoresheet-skeleton__line"></span>
            <div class="scoresheet-skeleton__stack scoresheet-skeleton__stack--row">
              <span class="shimmer-block scoresheet-skeleton__badge"></span>
              <span class="shimmer-block scoresheet-skeleton__badge"></span>
            </div>
          </div>
          <button v-else-if="isAdmin" class="panel panel--accent scoresheet-status-card scoresheet-status-card--link" type="button" @click="openUploadReview">
            <div class="panel__header panel__header--compact">
              <div>
                <h2>Scoresheet Upload</h2>
              </div>
              <StatusBadge :label="scoresheet.uploadStatus" :tone="statusTone(scoresheet.uploadStatus)" />
            </div>

            <div class="scoresheet-status-card__summary">
              <strong>{{ scoresheet.sourceImageName ? 'Upload staged for review' : 'No scoresheet uploaded yet' }}</strong>
              <span v-if="scoresheet.sourceImageName">{{ scoresheet.sourceImageName }}</span>
              <span v-else>{{ uploading ? 'Uploading image...' : 'Tap to start the upload and review flow.' }}</span>
            </div>

            <div v-if="reviewBadgeItems.length" class="scoresheet-status-card__badges">
              <StatusBadge
                v-for="badge in reviewBadgeItems"
                :key="badge.label"
                :label="badge.label"
                :tone="badge.tone"
              />
            </div>
          </button>
        </div>

        <div v-if="ledgerLoading" class="panel panel--scoresheet-ledger scoresheet-skeleton-card scoresheet-skeleton-card--ledger">
          <div class="panel__header">
            <div>
              <!-- Title shimmer in place of the live "Scoresheet Ledger"
                   h2 — matches the visual treatment of the other skeleton
                   sections so nothing reads as real copy while data is
                   still loading. -->
              <span class="shimmer-block scoresheet-skeleton__title"></span>
            </div>
            <span class="shimmer-block scoresheet-skeleton__button"></span>
          </div>

          <div class="scoresheet-skeleton__ledger">
            <div v-for="row in 8" :key="`ledger-skeleton-${row}`" class="scoresheet-skeleton__ledger-row">
              <span class="shimmer-block scoresheet-skeleton__ledger-player"></span>
              <span v-for="cell in 8" :key="`ledger-skeleton-${row}-${cell}`" class="shimmer-block scoresheet-skeleton__ledger-cell"></span>
            </div>
          </div>
        </div>
        <div v-else class="panel panel--scoresheet-ledger">
          <div v-if="!hasSubmittedGameLineup" class="ledger-lineup-required">
            <div>
              <strong>Game lineup required</strong>
              <p>This ledger is showing the event lineup as a preview. Submit the game lineup before scoring.</p>
            </div>
            <button v-if="isAdmin" class="ledger-lineup-required__action" type="button" @click="openManageLineup">
              Submit Game Lineup
            </button>
          </div>

          <ScoresheetGrid
            :players="lineup"
            :appearances="plateAppearances"
            :batting-stats="battingStats"
            :total-innings="totalInningsForGrid"
            :current-inning="currentInning ?? undefined"
            :sport-type-id="sportTypeId"
            :game-variant="gameVariant"
            :can-edit="canEditScoresheet"
            :is-live="gameIsLive"
            :saving="saving"
            @open-appearance="openAppearanceEditor"
          >
            <template v-slot:title>
              <h2 class="scoresheet-ledger-title">Scoresheet Ledger</h2>
            </template>
          </ScoresheetGrid>
        </div>
      </div>
    </section>

    <PlateAppearanceModal
      :model-value="appearanceModalOpen"
      :lineup-player-id="appearanceModalPlayer?.id || 0"
      :player-name="appearanceModalPlayer?.player_name || ''"
      :jersey-number="appearanceModalPlayer?.player_note || ''"
      :inning-number="appearanceModalInning || 1"
      :sport-type-id="sportTypeId"
      :game-variant="gameVariant"
      :existing-appearance="appearanceModalExistingPayload"
      :appearance-count="appearanceModalCount"
      :appearance-number="appearanceModalNumber"
      :saving="saving"
      :deleting="deleting"
      @update:modelValue="appearanceModalOpen = $event"
      @save="onSaveAppearanceFromModal"
      @delete="onDeleteAppearanceFromModal"
      @next-appearance="startNextAppearanceEditor"
      @cancel="closeAppearanceEditor"
    />

    <GameLineupSubmissionModal
      v-if="scoresheet"
      :model-value="lineupModalOpen"
      :game-id="gameId"
      :team-id="teamId"
      :team-name="scoresheet?.teamName ?? ''"
      :opponent-name="scoresheet?.opponent ?? ''"
      :bracket-label="scoresheet?.bracketLabel ?? ''"
      :game-time="scoresheet?.gameTime ?? ''"
      :game-field-name="scoresheet?.venueField"
      :game-park-name="scoresheet?.venuePark"
      :fallback-lineup="scoresheet?.lineupOptions ?? []"
      :fallback-field-config-name="scoresheet?.fieldConfigName"
      :fallback-field-positions="scoresheet?.fieldConfigPositions ?? []"
      :total-innings="totalInningsForGrid"
      :is-admin="isAdmin"
      @update:modelValue="lineupModalOpen = $event"
      @saved="onGameLineupSaved"
    />

    
    </div>
  </main>
  <main v-else class="page-shell page-shell--loading scoresheet-skeleton-page">
    <section class="hero scoresheet-skeleton-hero">
      <div class="hero__main scoresheet-skeleton__stack">
        <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
        <span class="shimmer-block scoresheet-skeleton__hero-title"></span>
        <span class="shimmer-block scoresheet-skeleton__line"></span>
        <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
        <span class="shimmer-block scoresheet-skeleton__button"></span>
      </div>
      <div class="hero-status scoresheet-hero-status">
        <div class="hero-manager-card scoresheet-skeleton-card">
          <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
          <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
          <span class="shimmer-block scoresheet-skeleton__line"></span>
          <span class="shimmer-block scoresheet-skeleton__line"></span>
        </div>
      </div>
    </section>

    <section class="content-grid content-grid--scoresheet">
      <div class="stack stack--wide">
        <div class="scoresheet-top-row">
          <div class="panel">
            <div class="scoresheet-header-board">
              <div class="scoresheet-matchup-card">
                <div class="scoresheet-linescore scoresheet-skeleton__stack">
                  <div
                    class="scoresheet-linescore__header"
                    :style="{ gridTemplateColumns: 'minmax(220px, 1fr) repeat(6, 36px) 52px 44px' }"
                  >
                    <div class="scoresheet-linescore__team-head">
                      <span class="shimmer-block scoresheet-skeleton__badge"></span>
                    </div>
                    <div v-for="inning in 6" :key="`score-head-skeleton-${inning}`" class="scoresheet-linescore__colhead">
                      <span class="shimmer-block scoresheet-skeleton__colhead"></span>
                    </div>
                    <div class="scoresheet-linescore__colhead scoresheet-linescore__colhead--summary">
                      <span class="shimmer-block scoresheet-skeleton__colhead scoresheet-skeleton__colhead--summary"></span>
                    </div>
                    <div class="scoresheet-linescore__colhead scoresheet-linescore__colhead--summary">
                      <span class="shimmer-block scoresheet-skeleton__colhead scoresheet-skeleton__colhead--summary"></span>
                    </div>
                  </div>

                  <div
                    v-for="row in 2"
                    :key="`score-row-skeleton-${row}`"
                    class="scoresheet-linescore__row"
                    :style="{ gridTemplateColumns: 'minmax(220px, 1fr) repeat(6, 36px) 52px 44px' }"
                  >
                    <div class="scoresheet-linescore__team">
                      <span class="shimmer-circle participation-skeleton__avatar"></span>
                      <div class="scoresheet-skeleton__stack">
                        <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
                        <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
                      </div>
                    </div>
                    <span
                      v-for="cell in 8"
                      :key="`score-row-skeleton-${row}-${cell}`"
                      class="shimmer-block scoresheet-skeleton__score-cell"
                    ></span>
                  </div>
                </div>
              </div>
              <div class="scoresheet-meta-column">
                <div class="scoresheet-meta-row">
                  <div class="scoresheet-meta-box scoresheet-meta-box--compact scoresheet-skeleton-card">
                    <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
                    <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
                  </div>
                  <div class="scoresheet-meta-box scoresheet-meta-box--compact scoresheet-skeleton-card">
                    <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
                    <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
                  </div>
                </div>
                <div class="scoresheet-meta-box scoresheet-meta-box--location scoresheet-skeleton-card">
                  <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
                  <span class="shimmer-block scoresheet-skeleton__line"></span>
                  <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
                </div>
              </div>
            </div>
          </div>
          <div class="panel panel--accent scoresheet-skeleton-card scoresheet-skeleton-card--upload">
            <div class="scoresheet-skeleton__stack scoresheet-skeleton__stack--split">
              <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--short"></span>
              <span class="shimmer-block scoresheet-skeleton__badge"></span>
            </div>
            <span class="shimmer-block scoresheet-skeleton__line scoresheet-skeleton__line--medium"></span>
            <span class="shimmer-block scoresheet-skeleton__line"></span>
            <div class="scoresheet-skeleton__stack scoresheet-skeleton__stack--row">
              <span class="shimmer-block scoresheet-skeleton__badge"></span>
              <span class="shimmer-block scoresheet-skeleton__badge"></span>
            </div>
          </div>
        </div>

        <div class="panel panel--scoresheet-ledger scoresheet-skeleton-card scoresheet-skeleton-card--ledger">
          <div class="panel__header">
            <div>
              <!-- Same title shimmer as the inline ledger-loading state
                   above. Page-level skeleton (no scoresheet ref yet)
                   keeps every line as a shimmer block. -->
              <span class="shimmer-block scoresheet-skeleton__title"></span>
            </div>
            <span class="shimmer-block scoresheet-skeleton__button"></span>
          </div>

          <div class="scoresheet-skeleton__ledger">
            <div v-for="row in 8" :key="`page-ledger-skeleton-${row}`" class="scoresheet-skeleton__ledger-row">
              <span class="shimmer-block scoresheet-skeleton__ledger-player"></span>
              <span v-for="cell in 8" :key="`page-ledger-skeleton-${row}-${cell}`" class="shimmer-block scoresheet-skeleton__ledger-cell"></span>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>
</template>



