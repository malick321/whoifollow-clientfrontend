<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import EventLineupModal from '../components/EventLineupModal.vue'
import GameCard from '../components/GameCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
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
import totalGamesIcon from '../assets/icon-total-games.svg'
import totalLostIcon from '../assets/icon-total-lost.svg'
import totalWonIcon from '../assets/icon-total-won.svg'
import boxscoreIcon from '../assets/boxscore.svg'
import seedIcon from '../assets/seed.svg'
import { fetchDivisionOverviewStandings } from '../api/divisionOverview'
import { fetchParticipationGames } from '../api/participationPage'
import { fetchTeamMembers } from '../api/teamMembers'
import { DEFAULT_SLOW_PITCH_FIELD_POSITIONS } from '../constants/fieldConfig'
import { fetchGameLineupSubmission, fetchTeamParticipation, saveGameLineupSubmission } from '../api/team'
import type {
  FieldConfigPosition,
  GameLineupPlayer,
  GameLineupSubmission,
  GameLineupSubmissionDetail,
  GameSummary,
  LineupPlayer,
  RegistrationStatus,
  TeamMemberOption,
  TeamParticipation
} from '../types'

const route = useRoute()
const teamParticipationId = computed(() =>
  (route.params.teamParticipationId as string | undefined) ||
  (route.query.team_participation_id as string | undefined)
)

const participation = ref<TeamParticipation | null>(null)
const participationLoading = ref(true)
const gamesLoading = ref(false)
const divisionLoading = ref(false)
const condensedHeaderVisible = ref(false)
const teamMenuOpen = ref(false)
const lineupModalOpen = ref(false)
const gameLineupModalOpen = ref(false)
const gameLineupLoading = ref(false)
const gameLineupSaving = ref(false)
const selectedGame = ref<GameSummary | null>(null)
const gameLineupDraft = ref<GameLineupPlayer[]>([])
const gameLineupSubmissionId = ref<string | null>(null)
const gameLineupFormStatus = ref<GameLineupSubmission['status']>('draft')
const gameLineupFormNotes = ref('')
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

const groupedGames = computed(() => {
  const groups = new Map<string, GameSummary[]>()

  for (const game of participation.value?.games ?? []) {
    const key = game.dateLabel || game.gameTime.split(',')[0] || 'Unscheduled Games'
    const existing = groups.get(key) ?? []
    existing.push(game)
    groups.set(key, existing)
  }

  return Array.from(groups.entries())
    .map(([label, games]) => ({ label, games }))
    .sort((left, right) => {
      const leftUnscheduled = left.label === 'Unscheduled Games'
      const rightUnscheduled = right.label === 'Unscheduled Games'

      if (leftUnscheduled && !rightUnscheduled) return 1
      if (!leftUnscheduled && rightUnscheduled) return -1
      return 0
    })
})

const condensedSubline = computed(() => {
  if (!participation.value) return ''
  return `${participation.value.eventName} - ${participation.value.division} - ${participation.value.eventDate}`
})

const teamMembers = ref<TeamMemberOption[]>([])

const lineupTeammates = computed<TeamMemberOption[]>(() => {
  // Prefer the live roster from /chat/getTeamMembers (players only). Fall
  // back to participation.teamMembers, then derive from the lineup itself.
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
// Legacy view kept in sync with ParticipationV2. Backend lineup_summary
// is now a structured list — join starters only here (this view renders a
// single-line summary; the split starters/bench layout lives in V2).
const eventOverviewLineupText = computed(() => {
  const list = participation.value?.eventOverview.lineupSummary ?? []
  const names = list
    .filter((p) => p.isStarter)
    .map((p) => p.name)
    .filter(Boolean)
    .join(', ')
  return names || 'No lineup submitted for this event yet.'
})

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
const hasEventOverviewForecast = computed(() => (participation.value?.eventOverview.forecast.length ?? 0) > 0)
const divisionOverviewTitle = computed(
  () => participation.value?.divisionOverview.bracketName?.trim() || participation.value?.division || ''
)
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

function toggleTeamMenu() {
  teamMenuOpen.value = !teamMenuOpen.value
}

function openLineupModal() {
  teamMenuOpen.value = false
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
  gameLineupLoading.value = true
  try {
    const lineupDetail = await fetchGameLineupSubmission(game.id, participation.value?.teamId ?? '')
    applyGameLineupFieldConfig(lineupDetail)
    const sourcePlayers = lineupDetail.hasExistingSubmission
      ? lineupDetail.players ?? lineupDetail.submission?.players ?? []
      : buildGameLineupFromTemplate(lineupDetail.templateLineup ?? participation.value?.lineup ?? [])
    gameLineupDraft.value = normalizeGameLineupPlayers(sourcePlayers)
    syncGameStarterState(gameLineupDraft.value)
    gameSubstituteDrafts.value = {}
    gameLineupSubmissionId.value = lineupDetail.submission?.id ?? null
    gameLineupFormStatus.value = lineupDetail.submission?.status ?? 'draft'
    gameLineupFormNotes.value = lineupDetail.submission?.notes ?? ''
    gameLineupModalOpen.value = true
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Unable to load lineup',
      message: error instanceof Error ? error.message : 'The game lineup submission could not be loaded.'
    })
  } finally {
    gameLineupLoading.value = false
  }
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
      const savedGameId = selectedGame.value?.id
      // Save resolved without throwing → backend confirmed the submission
      // exists. Card's "Lineup" pill tracks presence of a submission, not
      // the approval-workflow status label, so flip it immediately.
      participation.value.games = participation.value.games.map((game) =>
        game.id === savedGameId ? { ...game, lineupSubmitted: true } : game
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

function handleDocumentClick(event: MouseEvent) {
  if (!teamMenuOpen.value) return
  const target = event.target as Element | null
  if (target?.closest('.team-menu-anchor') || target?.closest('.hero-menu-panel')) return
  teamMenuOpen.value = false
}

async function load() {
  participationLoading.value = true
  try {
    const nextParticipation = await fetchTeamParticipation(
      teamParticipationId.value ?? ''
    )

    participation.value = nextParticipation
    participationLoading.value = false

    // Kick off the team roster fetch — drives the teammate dropdown in the
    // Event Lineup and Game Lineup modals. Uses the team's GUID per the
    // /chat/getTeamMembers contract.
    if (nextParticipation.teamGuid) {
      void fetchTeamMembers(nextParticipation.teamGuid).then((members) => {
        teamMembers.value = members
      })
    }

    gamesLoading.value = true
    nextParticipation.games = await fetchParticipationGames(
      nextParticipation,
      nextParticipation.teamId ?? '',
      nextParticipation.tournamentId,
      nextParticipation.tournamentGuid
    )
    participation.value = { ...nextParticipation }
    gamesLoading.value = false

    if (nextParticipation.tournamentId) {
      divisionLoading.value = true
      try {
        const divisionOverview = await fetchDivisionOverviewStandings(
          nextParticipation.tournamentGuid ?? ''
        )

        nextParticipation.divisionOverview = {
          ...nextParticipation.divisionOverview,
          standings: divisionOverview.standings
        }
        participation.value = { ...nextParticipation }
      } catch {
        // Keep the participation payload visible even if the legacy division teams API is unavailable.
      } finally {
        divisionLoading.value = false
      }
    }
  } finally {
    participationLoading.value = false
    gamesLoading.value = false
    divisionLoading.value = false
  }
}

function onEventLineupSaved(saved: LineupPlayer[]) {
  if (!participation.value) return
  participation.value.lineup = saved
  participation.value.participationStatus = 'confirmed'
  // Mirror the structured backend shape so the summary stays in sync
  // after an inline save without a refetch.
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
  <main v-if="participationLoading && !participation" class="page-shell page-shell--loading">
    <section class="hero participation-skeleton">
      <div class="participation-skeleton__main">
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
        <div class="participation-skeleton__actions">
          <div class="participation-skeleton__action shimmer-block"></div>
          <div class="participation-skeleton__action shimmer-block"></div>
          <div class="participation-skeleton__action shimmer-block"></div>
        </div>
      </div>
      <div class="participation-skeleton__manager">
        <div class="participation-skeleton__manager-label shimmer-block"></div>
        <div class="participation-skeleton__manager-line shimmer-block"></div>
        <div class="participation-skeleton__manager-line shimmer-block"></div>
        <div class="participation-skeleton__manager-line shimmer-block"></div>
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

    <section class="content-grid">
      <div class="stack">
        <div class="panel panel--games participation-skeleton">
          <div class="games-stack">
            <section v-for="groupIndex in 2" :key="`game-group-${groupIndex}`" class="games-day-group">
              <div class="participation-skeleton__day-title shimmer-block"></div>
              <div class="games-grid games-grid--boxscore">
                <div v-for="cardIndex in 2" :key="`game-card-${groupIndex}-${cardIndex}`" class="boxscore-card participation-skeleton__game-card">
                  <div class="participation-skeleton__game-top">
                    <div class="participation-skeleton__game-pool shimmer-block"></div>
                    <div class="participation-skeleton__game-badges">
                      <div class="participation-skeleton__badge shimmer-block"></div>
                      <div class="participation-skeleton__badge shimmer-block"></div>
                    </div>
                  </div>
                  <div class="participation-skeleton__line participation-skeleton__line--short shimmer-block"></div>
                  <div class="participation-skeleton__game-team" v-for="teamIndex in 2" :key="`game-team-${groupIndex}-${cardIndex}-${teamIndex}`">
                    <div class="participation-skeleton__avatar shimmer-circle"></div>
                    <div class="participation-skeleton__game-team-line shimmer-block"></div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <aside class="side-panel">
        <div class="panel panel--accent participation-skeleton participation-skeleton__side-card">
          <div class="participation-skeleton__side-row" v-for="rowIndex in 3" :key="`side-row-${rowIndex}`">
            <div class="participation-skeleton__side-icon shimmer-circle"></div>
            <div class="participation-skeleton__side-copy">
              <div class="participation-skeleton__side-title shimmer-block"></div>
              <div class="participation-skeleton__side-line shimmer-block"></div>
            </div>
          </div>
        </div>

        <div class="panel participation-skeleton participation-skeleton__side-card">
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
  </main>

  <main v-else-if="participation">
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
      <button class="condensed-team-header__ellipsis ellipsis-button team-menu-anchor" type="button" @click.stop="toggleTeamMenu">
        <AppIcon name="ellipsis" :size="18" />
      </button>
    </section>
    <div class="page-shell">
    <section class="hero">
      <button v-if="participation?.isAdmin" class="hero-ellipsis-button ellipsis-button team-menu-anchor" type="button" @click.stop="toggleTeamMenu">
        <AppIcon name="ellipsis" :size="18" />
      </button>
      <div v-if="participation?.isAdmin && teamMenuOpen" class="menu-panel hero-menu-panel">
        <button class="menu-link menu-link--button" type="button" @click="openLineupModal">Event Lineup</button>
      </div>
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
        <!-- Hero action strip hidden for now; preserved for future wiring. -->
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

    <section class="content-grid">
      <div class="stack">
        <div class="panel panel--games">
          <div v-if="gamesLoading" class="games-stack participation-skeleton">
            <section v-for="groupIndex in 2" :key="`partial-game-group-${groupIndex}`" class="games-day-group">
              <div class="participation-skeleton__day-title shimmer-block"></div>
              <div class="games-grid games-grid--boxscore">
                <div v-for="cardIndex in 2" :key="`partial-game-card-${groupIndex}-${cardIndex}`" class="boxscore-card participation-skeleton__game-card">
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
          <div v-else class="games-stack">
            <section v-for="group in groupedGames" :key="group.label" class="games-day-group">
              <h3 class="games-day-title">{{ group.label }}</h3>
              <div class="games-grid games-grid--boxscore">
                <GameCard
                  v-for="game in group.games"
                  :key="game.id"
                  :event-id="participation.eventId"
                  :team-id="participation.teamId ?? ''"
                  :tournament-id="participation.tournamentId ?? ''"
                  :participation-id="participation.eventJoinedTeamId ?? teamParticipationId ?? ''"
                  :team-name="participation.teamName"
                  :division="participation.division"
                  :game="game"
                  :is-admin="participation.isAdmin ?? false"
                  @open-lineup="openGameLineupModal"
                />
              </div>
            </section>
          </div>
        </div>
      </div>

      <aside class="side-panel">
        <div class="panel panel--accent event-overview-card">
          <div class="event-overview-card__row">
            <img :src="jerseyIcon" alt="" class="event-overview-card__row-icon event-overview-card__row-icon--jersey" />
            <div class="event-overview-card__text">
              <span class="event-overview-card__title">Players Lineup</span>
              <span>{{ eventOverviewLineupText }}</span>
            </div>
          </div>

          <div v-if="hasEventOverviewForecast" class="event-overview-card__forecast">
            <div
              v-for="day in participation.eventOverview.forecast"
              :key="day.label"
              class="event-overview-card__forecast-day"
            >
              <span class="event-overview-card__forecast-label">{{ day.label }}</span>
              <span class="event-overview-card__forecast-icon">
                <span v-if="day.icon === 'sun'">?</span>
                <span v-else-if="day.icon === 'rain'">??</span>
                <span v-else>?</span>
              </span>
              <span>{{ day.high }}ï¿½F {{ day.low }}ï¿½F</span>
            </div>
          </div>

          <div class="event-overview-card__footer">
            <div class="event-overview-card__attendees">
              <TeamAvatar name="Attendee 1" image-url="https://i.pravatar.cc/80?img=21" size="attendee" />
              <TeamAvatar name="Attendee 2" image-url="https://i.pravatar.cc/80?img=24" size="attendee" />
              <TeamAvatar name="Attendee 3" image-url="https://i.pravatar.cc/80?img=29" size="attendee" />
              <TeamAvatar name="Attendee 4" image-url="https://i.pravatar.cc/80?img=32" size="attendee" />
              <TeamAvatar name="Attendee 5" image-url="https://i.pravatar.cc/80?img=36" size="attendee" />
              <span>{{ participation.eventOverview.attendeeCount }} going</span>
            </div>
            <button class="event-overview-card__cta" type="button">Are you going ?</button>
          </div>
        </div>

        <div v-if="divisionLoading" class="panel participation-skeleton participation-skeleton__side-card">
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
        <div v-else class="panel">
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
                  <template v-if="entry.runsDifferential && entry.bracketRecord"> ï¿½ </template>
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
      </aside>
    </section>

    <EventLineupModal
      :model-value="lineupModalOpen"
      :participation-id="participation?.eventJoinedTeamId ?? teamParticipationId ?? ''"
      :team-name="participation?.teamName ?? ''"
      :event-name="participation?.eventName ?? ''"
      :event-date="participation?.eventDate ?? ''"
      :participation-status-label="participation ? participationBadgeLabel(participation.participationStatus) : undefined"
      :participation-status-tone="participation ? participationTone(participation.participationStatus) : undefined"
      :field-config-name="participation?.fieldConfigName"
      :field-config-positions="eventLineupFieldPositions"
      :teammates="lineupTeammates"
      :is-admin="participation?.isAdmin ?? false"
      @update:modelValue="lineupModalOpen = $event"
      @saved="onEventLineupSaved"
    />

    <div v-if="gameLineupModalOpen" class="modal-backdrop" @click.self="closeGameLineupModal">
      <section class="modal-card lineup-manager-modal">
        <header class="modal-card__header lineup-manager-modal__header">
          <div class="lineup-manager-modal__title-block">
            <div class="lineup-manager-modal__eyebrow-row">
              <p class="eyebrow">Game Lineup Submission</p>
              <div class="lineup-manager-modal__eyebrow-badges">
                <StatusBadge
                  :label="gameLineupStatusMeta.label"
                  :tone="gameLineupStatusMeta.tone"
                />
                <StatusBadge :label="gameLineupFieldConfigName" tone="info" />
              </div>
            </div>
            <h2>
              <span class="lineup-manager-modal__title-primary">{{ participation.teamName }}</span>
              <span class="lineup-manager-modal__title-secondary">
                vs {{ selectedGame?.opponent ?? 'Opponent' }}
              </span>
            </h2>
            <p class="lineup-manager-modal__subtitle">
              {{ selectedGame?.bracketLabel ?? 'Game' }}: set the batting order and map the on-field defensive positions before first pitch.
            </p>
          </div>
          <button class="ellipsis-button ellipsis-button--close" type="button" @click="closeGameLineupModal">
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <div v-if="gameLineupLoading" class="lineup-manager-modal__panel participation-skeleton participation-skeleton__side-card">
          <div class="participation-skeleton__headline participation-skeleton__headline--medium shimmer-block"></div>
          <div class="participation-skeleton__line shimmer-block"></div>
          <div class="participation-skeleton__standing" v-for="rowIndex in 4" :key="`lineup-loading-${rowIndex}`">
            <div class="participation-skeleton__standing-stats shimmer-block"></div>
            <div class="participation-skeleton__avatar shimmer-circle"></div>
            <div class="participation-skeleton__standing-copy">
              <div class="participation-skeleton__side-line shimmer-block"></div>
              <div class="participation-skeleton__side-line participation-skeleton__side-line--short shimmer-block"></div>
            </div>
          </div>
        </div>
        <div v-else class="lineup-manager-modal__body">
          <section class="lineup-manager-modal__panel lineup-manager-modal__panel--bare">
            <div class="lineup-manager-modal__sectionhead">
              <StatusBadge :label="`${gameLineupStarters.length}/10 starters`" :tone="gameLineupStarters.length === 10 ? 'success' : 'warning'" />
            </div>

            <div class="lineup-manager-grid">
              <div class="lineup-manager-grid__header">Order</div>
              <div class="lineup-manager-grid__header">Player</div>
              <div class="lineup-manager-grid__header">Field Position</div>
              <div class="lineup-manager-grid__header"></div>

              <template v-for="player in gameLineupStarters" :key="player.id">
                <div
                  class="lineup-manager-grid__order lineup-manager-grid__order--draggable"
                  :class="{
                    'lineup-manager-grid__order--active': draggedGameLineupPlayerId === player.id,
                    'lineup-manager-grid__order--drop-target': gameLineupDropTargetId === player.id
                  }"
                  draggable="true"
                  @dragstart="onGameLineupDragStart($event, player.id)"
                  @dragend="onGameLineupDragEnd"
                  @dragover="onGameLineupDragOver($event, player.id)"
                  @drop="moveGameStarterTo($event, player.id)"
                >
                  <span class="lineup-manager-drag-handle" aria-hidden="true"></span>
                  <strong>{{ player.battingOrder }}</strong>
                </div>
                <div
                  class="lineup-manager-grid__player"
                  :class="{
                    'lineup-manager-grid__player--active': draggedGameLineupPlayerId === player.id,
                    'lineup-manager-grid__player--drop-target': gameLineupDropTargetId === player.id
                  }"
                  draggable="true"
                  @dragstart="onGameLineupDragStart($event, player.id)"
                  @dragend="onGameLineupDragEnd"
                  @dragover="onGameLineupDragOver($event, player.id)"
                  @drop="moveGameStarterTo($event, player.id)"
                >
                  <div class="lineup-manager-grid__player-jersey">
                    <img :src="jerseyIcon" alt="" class="lineup-manager-grid__player-icon" />
                    <span class="lineup-manager-grid__player-jersey-number">{{ player.jerseyNumber }}</span>
                  </div>
                  <div class="lineup-manager-grid__player-copy">
                    <div class="lineup-manager-grid__player-name">{{ player.playerName }}</div>
                    <div class="lineup-manager-grid__player-meta">
                      <span>{{ gameLineupPlayerLinkageLabel(player) }}</span>
                    </div>
                  </div>
                </div>
                <div
                  class="lineup-manager-grid__position"
                  :class="{
                    'lineup-manager-grid__position--active': draggedGameLineupPlayerId === player.id,
                    'lineup-manager-grid__position--drop-target': gameLineupDropTargetId === player.id
                  }"
                  draggable="true"
                  @dragstart="onGameLineupDragStart($event, player.id)"
                  @dragend="onGameLineupDragEnd"
                  @dragover="onGameLineupDragOver($event, player.id)"
                  @drop="moveGameStarterTo($event, player.id)"
                >
                  <select v-model="player.positionCode" class="lineup-manager-select">
                    <option
                      v-for="position in availableGamePositions(player.id)"
                      :key="position.code"
                      :value="position.code"
                    >
                      {{ position.code }} - {{ position.label }}
                    </option>
                  </select>
                </div>
                <div
                  class="lineup-manager-grid__controls"
                  :class="{
                    'lineup-manager-grid__controls--active': draggedGameLineupPlayerId === player.id,
                    'lineup-manager-grid__controls--drop-target': gameLineupDropTargetId === player.id
                  }"
                  draggable="true"
                  @dragstart="onGameLineupDragStart($event, player.id)"
                  @dragend="onGameLineupDragEnd"
                  @dragover="onGameLineupDragOver($event, player.id)"
                  @drop="moveGameStarterTo($event, player.id)"
                >
                  <button class="lineup-manager-mini" type="button" @click="setGamePlayerBench(player.id, true)">Bench</button>
                </div>
              </template>
            </div>
          </section>

          <aside class="lineup-manager-modal__aside">
            <section class="lineup-manager-modal__panel">
              <div class="lineup-manager-modal__sectionhead">
                <div>
                  <h3>Bench / Available</h3>
                  <p>Use a bench player as a substitute by selecting who they replace and the inning they enter.</p>
                </div>
              </div>

              <div class="lineup-manager-bench">
                <div v-for="player in gameLineupBench" :key="player.id" class="lineup-manager-bench__item">
                  <div class="lineup-manager-bench__copy">
                    <strong>{{ player.playerName }}</strong>
                    <div class="lineup-manager-grid__player-meta">
                      <span>#{{ player.jerseyNumber }}</span>
                      <span>{{ player.positionCode ?? 'EH' }}</span>
                    </div>
                  </div>
                  <div class="lineup-manager-bench__actions">
                    <button class="lineup-manager-mini" type="button" @click="setGamePlayerBench(player.id, false)">Make starter</button>
                    <button class="lineup-manager-mini" type="button" @click="prepareGameSubstitute(player.id)">Use as substitute</button>
                  </div>
                  <div v-if="gameSubstituteDrafts[player.id]" class="lineup-manager-substitute">
                    <div class="lineup-manager-substitute__grid">
                      <label>
                        <span>Replacing</span>
                        <select v-model="gameSubstituteDrafts[player.id].targetId" class="lineup-manager-select">
                          <option v-for="target in gameSubstitutionTargets" :key="target.id" :value="target.id">
                            {{ target.battingOrder }} - {{ target.playerName }}
                          </option>
                        </select>
                      </label>
                      <label>
                        <span>Entered inning</span>
                        <select v-model="gameSubstituteDrafts[player.id].inning" class="lineup-manager-select">
                          <option v-for="inning in gameLineupInningOptions" :key="inning" :value="inning">
                            {{ inning }}
                          </option>
                        </select>
                      </label>
                      <label>
                        <span>Field position</span>
                        <select v-model="gameSubstituteDrafts[player.id].positionCode" class="lineup-manager-select">
                          <option v-for="position in gameLineupFieldPositions" :key="position.code" :value="position.code">
                            {{ position.code }} - {{ position.label }}
                          </option>
                        </select>
                      </label>
                    </div>
                    <div class="lineup-manager-substitute__footer">
                      <button class="lineup-manager-mini lineup-manager-mini--danger" type="button" @click="delete gameSubstituteDrafts[player.id]">Cancel</button>
                      <button class="lineup-manager-mini lineup-manager-mini--primary" type="button" @click="applyGameSubstitute(player.id)">Apply sub</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section v-if="gameLineupSubstitutions.length" class="lineup-manager-modal__panel">
              <div class="lineup-manager-modal__sectionhead">
                <div>
                  <h3>Game Changes</h3>
                  <p>Track players who have entered or exited through a substitution.</p>
                </div>
              </div>

              <div class="lineup-manager-bench">
                <div v-for="player in gameLineupSubstitutions" :key="`sub-${player.id}`" class="lineup-manager-bench__item">
                  <div class="lineup-manager-bench__copy">
                    <strong>{{ player.playerName }}</strong>
                    <div class="lineup-manager-grid__player-meta">
                      <span v-if="player.isSubstitute">
                        Entered inning {{ player.enteredInning }} for {{ gameSubstituteLabel(player.substitutesForId) }}
                      </span>
                      <span v-else>
                        Exited inning {{ player.exitedInning }}
                      </span>
                    </div>
                  </div>
                  <button
                    v-if="player.isSubstitute"
                    class="lineup-manager-mini lineup-manager-mini--danger"
                    type="button"
                    @click="undoGameSubstitute(player.id)"
                  >
                    Undo sub
                  </button>
                </div>
              </div>
            </section>

            <section class="lineup-manager-modal__panel">
              <div class="lineup-manager-modal__sectionhead">
                <div>
                  <h3>Submission Notes</h3>
                  <p>Use this for manager notes or lineup-specific reminders.</p>
                </div>
              </div>

              <textarea
                v-model="gameLineupFormNotes"
                class="lineup-manager-notes"
                rows="5"
                placeholder="Add notes for lineup approval or field setup."
              />
            </section>
          </aside>
        </div>

        <footer class="lineup-manager-modal__footer">
          <button class="secondary-button" type="button" @click="closeGameLineupModal">Cancel</button>
          <div class="lineup-manager-modal__footer-actions">
            <button class="primary-button" type="button" :disabled="gameLineupSaving" @click="saveApprovedGameLineup">
              {{ gameLineupSaving ? 'Submitting Roster...' : 'Submit Roster' }}
            </button>
          </div>
        </footer>
      </section>
    </div>
    </div>
  </main>
</template>

