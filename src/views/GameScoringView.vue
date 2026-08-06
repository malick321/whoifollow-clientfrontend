<script setup lang="ts">
// GameScoringView — team-event game scoring (legacy run/inning model, matchgeni
// design). Line score + run/HR scoring pad + batting stats, wired to the v1
// game/* endpoints (see src/api/gameScoring.ts). Admin-only editing.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import NumberStepper from '../components/NumberStepper.vue'
import LineScore, { type LineScoreRow } from '../components/scoring-lib/LineScore.vue'
import { pushToast } from '../toast-center'
import { confirmDialog } from '../confirm-center'
import { fetchTeamEventOverview } from '../api/teamEventDetail'
import {
  addInning, deleteLastInning, endGame, endHalfInning, fetchGameScoring, reopenGame,
  selectHomeTeam, swapGameTeams, updateBattingStats, updateScore,
  type GameLineupRow, type GameScoreRow, type GameScoringData
} from '../api/gameScoring'

const route = useRoute()
const router = useRouter()
const teamId = computed(() => String(route.params.teamId ?? ''))
const eventId = computed(() => String(route.params.eventId ?? ''))
const gameId = computed(() => String(route.params.gameId ?? ''))

const data = ref<GameScoringData | null>(null)
const battingRows = ref<GameLineupRow[]>([])
const isAdmin = ref(false)
const loading = ref(true)
const saving = ref(false)
const loadError = ref('')

const condensedHeaderVisible = ref(false)
function handleScroll() { condensedHeaderVisible.value = window.scrollY > 140 }

// ── Derived state ────────────────────────────────────────────────
const game = computed(() => data.value?.game ?? null)
const scores = computed<GameScoreRow[]>(() => game.value?.gameScores ?? [])
const hasStarted = computed(() => scores.value.length >= 2)
const isFinal = computed(() => (game.value?.status ?? 0) === 2)
const myRow = computed(() => scores.value.find((s) => s.team_flag === 1) ?? null)
const oppRow = computed(() => scores.value.find((s) => s.team_flag === 2) ?? null)
const battingRow = computed(() => scores.value.find((s) => s.batting_flag === 1) ?? null)
const currentInning = computed(() => myRow.value?.end_inning_flag || 1)
const totalInnings = computed(() => Math.max(1, ...scores.value.map((s) => s.end_inning_flag || 1)))
const innings = computed(() => Array.from({ length: totalInnings.value }, (_, i) => i + 1))

function cell(row: GameScoreRow | null, inningNo: number, inningType: number): number {
  const hit = row?.gameInnings?.find((i) => i.inning_no === inningNo && i.inning_type === inningType)
  return hit ? Number(hit.score) : 0
}
function runsTotal(row: GameScoreRow | null): number {
  return (row?.gameInnings ?? []).filter((i) => i.inning_type === 2).reduce((a, i) => a + Number(i.score), 0)
}
function hrTotal(row: GameScoreRow | null): number {
  return (row?.gameInnings ?? []).filter((i) => i.inning_type === 1).reduce((a, i) => a + Number(i.score), 0)
}

const statusLabel = computed(() => (isFinal.value ? 'Final' : hasStarted.value ? 'Live' : 'Scheduled'))
const statusTone = computed<'success' | 'neutral' | 'info'>(() =>
  isFinal.value ? 'neutral' : hasStarted.value ? 'success' : 'info'
)

const lineScoreRows = computed<LineScoreRow[]>(() =>
  [...scores.value]
    .sort((a, b) => a.team_type - b.team_type) // visiting (1) before home (2)
    .map((s) => ({
      key: String(s.id),
      name: s.team_name || (s.team_flag === 1 ? data.value?.teamName || 'Team' : data.value?.opponentName || 'Opponent'),
      side: s.team_type === 2 ? 'H' : 'V',
      isBatting: s.batting_flag === 1,
      scores: innings.value.map((n) => (s.gameInnings?.some((i) => i.inning_no === n && i.inning_type === 2) ? cell(s, n, 2) : '-')),
      runs: runsTotal(s),
      homeRuns: hrTotal(s)
    }))
)

// ── Load / refresh ───────────────────────────────────────────────
async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [scoring, overview] = await Promise.all([
      fetchGameScoring(gameId.value),
      fetchTeamEventOverview(teamId.value, eventId.value).catch(() => null)
    ])
    data.value = scoring
    battingRows.value = (scoring?.gameLineUps ?? []).map((r) => ({ ...r }))
    isAdmin.value = !!overview?.isAdmin
    if (!scoring) loadError.value = 'This game could not be loaded.'
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Could not load the game.'
  } finally {
    loading.value = false
  }
}
async function refresh() {
  const scoring = await fetchGameScoring(gameId.value).catch(() => null)
  if (scoring) {
    data.value = scoring
    battingRows.value = scoring.gameLineUps.map((r) => ({ ...r }))
  }
}

// Guarded mutation runner — blocks concurrent writes, toasts on failure.
async function run(fn: () => Promise<unknown>, successMsg?: string) {
  if (saving.value) return
  saving.value = true
  try {
    await fn()
    await refresh()
    if (successMsg) pushToast({ tone: 'success', title: successMsg })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Action failed', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally {
    saving.value = false
  }
}

// ── Scoring pad ──────────────────────────────────────────────────
function nowHM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function setHomeTeam(weAreHome: boolean) {
  if (!game.value) return
  void run(() => selectHomeTeam({
    game_id: game.value!.id,
    team_id: game.value!.team_id,
    team_name: data.value?.teamName || 'Team',
    opponent_flag: weAreHome ? 1 : 0,
    actual_start_time: nowHM()
  }), 'Game started')
}

const runsCell = computed<number>({
  get: () => cell(battingRow.value, currentInning.value, 2),
  set: (v) => applyCell(2, v)
})
const hrCell = computed<number>({
  get: () => cell(battingRow.value, currentInning.value, 1),
  set: (v) => applyCell(1, v)
})
function applyCell(inningType: number, value: number) {
  if (!game.value || !battingRow.value) return
  void run(() => updateScore({
    game_id: game.value!.id,
    team_type: battingRow.value!.team_type,
    inning_no: currentInning.value,
    score: Math.max(0, value),
    inning_type: inningType
  }))
}

function doEndHalf() { if (game.value) void run(() => endHalfInning(game.value!.id), 'Half inning ended') }
function doAddInning() { if (game.value) void run(() => addInning(game.value!.id), 'Inning added') }
async function doDeleteInning() {
  if (!game.value) return
  if (await confirmDialog({ title: 'Delete last inning?', message: 'The most recent inning will be removed.', confirmLabel: 'Delete', danger: true })) {
    void run(() => deleteLastInning(game.value!.id), 'Inning deleted')
  }
}
async function doSwap() {
  if (!game.value) return
  if (await confirmDialog({ title: 'Swap home / visitor?', message: 'This resets all innings and scores for this game.', confirmLabel: 'Swap', danger: true })) {
    void run(() => swapGameTeams(game.value!.id), 'Teams swapped')
  }
}
async function doEndGame() {
  if (!game.value) return
  if (await confirmDialog({ title: 'End game?', message: 'The final score will be locked in.', confirmLabel: 'End game' })) {
    void run(() => endGame(game.value!.id), 'Game ended')
  }
}
function doReopen() { if (game.value) void run(() => reopenGame(game.value!.id), 'Game reopened') }

// ── Batting stats ────────────────────────────────────────────────
const STAT_FIELDS = [
  { key: 'ab', label: 'AB' }, { key: 'one_b', label: '1B' }, { key: 'two_b', label: '2B' },
  { key: 'three_b', label: '3B' }, { key: 'hr', label: 'HR' }, { key: 'rbi', label: 'RBI' },
  { key: 'r', label: 'R' }, { key: 'bb', label: 'BB' }, { key: 'sac', label: 'SAC' }, { key: 'e', label: 'E' }
] as const
function playerName(row: GameLineupRow): string {
  return row.user?.name || `${row.user_profile?.fname ?? ''} ${row.user_profile?.lname ?? ''}`.trim() || 'Player'
}
function saveBatting(row: GameLineupRow) {
  void run(() => updateBattingStats({
    id: row.id,
    ab: Number(row.ab) || 0, one_b: Number(row.one_b) || 0, two_b: Number(row.two_b) || 0,
    three_b: Number(row.three_b) || 0, hr: Number(row.hr) || 0, rbi: Number(row.rbi) || 0,
    r: Number(row.r) || 0, bb: Number(row.bb) || 0, sac: Number(row.sac) || 0, e: Number(row.e) || 0
  }))
}

function back() {
  router.push({ name: 'team-event-detail', params: { teamId: teamId.value, eventId: eventId.value } })
}

onMounted(() => {
  handleScroll()
  window.addEventListener('scroll', handleScroll, { passive: true })
  void load()
})
onBeforeUnmount(() => window.removeEventListener('scroll', handleScroll))
</script>

<template>
  <main class="gs">
    <section class="condensed-team-header gs__condensed" :class="{ 'condensed-team-header--visible': condensedHeaderVisible }">
      <div class="condensed-team-header__main">
        <div class="condensed-team-header__top">
          <span class="condensed-team-header__name">{{ data?.teamName || 'Team' }} vs {{ data?.opponentName || 'Opponent' }}</span>
          <StatusBadge :label="statusLabel" :tone="statusTone" />
        </div>
        <div class="condensed-team-header__subline">{{ game?.name || 'Game' }} · {{ data?.teamRuns ?? 0 }} – {{ data?.opponentRuns ?? 0 }}</div>
      </div>
    </section>

    <!-- Loading -->
    <div v-if="loading" class="gs__loading" aria-busy="true">
      <span class="shimmer-block gs__loading-title"></span>
      <span class="shimmer-block gs__loading-row"></span>
      <span class="shimmer-block gs__loading-row"></span>
    </div>

    <div v-else-if="loadError" class="gs__error">
      <AppIcon name="help" :size="26" />
      <h2>Game unavailable</h2>
      <p>{{ loadError }}</p>
      <button type="button" class="scoring-drawer__action scoring-drawer__action--neutral" @click="back">Back to event</button>
    </div>

    <template v-else>
      <!-- Hero -->
      <section class="gs-hero">
        <button type="button" class="gs-hero__back" aria-label="Back to event" @click="back"><span aria-hidden="true">‹</span></button>
        <div class="gs-hero__teams">
          <div class="gs-hero__team">
            <TeamAvatar :name="data?.teamName || 'Team'" size="md" />
            <span>{{ data?.teamName || 'Team' }}</span>
          </div>
          <div class="gs-hero__score"><b>{{ data?.teamRuns ?? 0 }}</b><i>–</i><b>{{ data?.opponentRuns ?? 0 }}</b></div>
          <div class="gs-hero__team gs-hero__team--opp">
            <TeamAvatar :name="data?.opponentName || 'Opponent'" size="md" />
            <span>{{ data?.opponentName || 'Opponent' }}</span>
          </div>
        </div>
        <div class="gs-hero__meta">
          <StatusBadge :label="statusLabel" :tone="statusTone" />
          <button v-if="isAdmin && hasStarted && !isFinal" type="button" class="scoring-drawer__action scoring-drawer__action--danger" :disabled="saving" @click="doEndGame">End Game</button>
          <button v-if="isAdmin && isFinal" type="button" class="scoring-drawer__action scoring-drawer__action--neutral" :disabled="saving" @click="doReopen">Reopen Game</button>
        </div>
      </section>

      <!-- Line score -->
      <section class="panel gs-panel">
        <h3 class="gs-panel__title">Line Score</h3>
        <LineScore v-if="hasStarted" :innings="innings" :rows="lineScoreRows" :game-has-started="true" :current-inning="currentInning" />
        <p v-else class="gs-empty">Scoring hasn't started. {{ isAdmin ? 'Set the home team below to begin.' : 'Check back once the game is underway.' }}</p>
      </section>

      <!-- Scoring pad (admin) -->
      <section v-if="isAdmin && !isFinal" class="panel gs-panel">
        <h3 class="gs-panel__title">Scoring</h3>

        <div v-if="!hasStarted" class="gs-sethome">
          <p>Who is the home team?</p>
          <div class="gs-segmented">
            <button type="button" class="gs-segment" :disabled="saving" @click="setHomeTeam(true)">{{ data?.teamName || 'We' }} home</button>
            <button type="button" class="gs-segment" :disabled="saving" @click="setHomeTeam(false)">{{ data?.opponentName || 'Opponent' }} home</button>
          </div>
        </div>

        <template v-else>
          <div class="gs-pad">
            <div class="gs-pad__now">
              <span class="gs-pad__label">Inning {{ currentInning }}</span>
              <span class="gs-pad__batting">{{ battingRow?.team_name || (data?.isMyTeamBatting ? data?.teamName : data?.opponentName) }} batting</span>
            </div>
            <div class="gs-pad__steppers">
              <div class="gs-pad__stepper"><span>Runs</span><NumberStepper v-model="runsCell" :min="0" :max="99" :disabled="saving" aria-label="Runs this inning" /></div>
              <div class="gs-pad__stepper"><span>Home runs</span><NumberStepper v-model="hrCell" :min="0" :max="99" :disabled="saving" aria-label="Home runs this inning" /></div>
            </div>
          </div>
          <div class="gs-actions">
            <button type="button" class="scoring-drawer__action scoring-drawer__action--primary" :disabled="saving" @click="doEndHalf">End Half Inning</button>
            <button type="button" class="scoring-drawer__action scoring-drawer__action--neutral" :disabled="saving" @click="doAddInning">Add Inning</button>
            <button type="button" class="scoring-drawer__action scoring-drawer__action--neutral" :disabled="saving" @click="doDeleteInning">Delete Last Inning</button>
            <button type="button" class="scoring-drawer__action scoring-drawer__action--neutral" :disabled="saving" @click="doSwap">Swap Home/Visitor</button>
          </div>
        </template>
      </section>

      <!-- Batting stats -->
      <section class="panel gs-panel">
        <h3 class="gs-panel__title">Batting Stats</h3>
        <div v-if="battingRows.length" class="gs-table-scroll">
          <table class="gs-table">
            <thead>
              <tr>
                <th class="gs-table__player">Player</th>
                <th v-for="f in STAT_FIELDS" :key="f.key">{{ f.label }}</th>
                <th>AVG</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in battingRows" :key="row.id">
                <td class="gs-table__player">
                  <TeamAvatar :name="playerName(row)" size="sm" />
                  <span><b>{{ playerName(row) }}</b><small v-if="row.teamMember?.uniform_no">#{{ row.teamMember.uniform_no }}</small></span>
                </td>
                <td v-for="f in STAT_FIELDS" :key="f.key">
                  <input
                    v-if="isAdmin"
                    v-model.number="(row as any)[f.key]"
                    type="number" min="0" class="gs-stat-input"
                    :disabled="saving"
                    @change="saveBatting(row)"
                  />
                  <span v-else>{{ (row as any)[f.key] }}</span>
                </td>
                <td>{{ row.average }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="gs-empty">No lineup yet — add a lineup from the game's ⋯ menu to record batting stats.</p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.gs { max-width: 1200px; margin: 0 auto; padding: 22px 22px 60px; display: flex; flex-direction: column; gap: 16px; color: var(--text); }
.gs__condensed { }

.gs-hero {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 16px;
  padding: 20px 22px; border: 1px solid var(--border-divider); border-radius: 10px; background: var(--surface-card);
}
.gs-hero__back { width: 40px; height: 40px; border: 1px solid var(--border-divider); background: var(--surface-raised); color: var(--text); border-radius: 8px; cursor: pointer; font-size: 28px; line-height: 1; }
.gs-hero__teams { display: flex; align-items: center; justify-content: center; gap: 20px; }
.gs-hero__team { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.gs-hero__team--opp { flex-direction: row-reverse; }
.gs-hero__score { display: flex; align-items: baseline; gap: 8px; font-size: 1.8rem; font-weight: 700; }
.gs-hero__score i { color: var(--secondary); font-style: normal; }
.gs-hero__meta { display: flex; align-items: center; gap: 10px; }

.gs-panel { padding: 18px; }
.gs-panel__title { margin: 0 0 14px; font-size: 1rem; }
.gs-empty { color: var(--secondary); font-size: 0.9rem; margin: 0; }

.gs-sethome p { margin: 0 0 10px; color: var(--secondary); }
.gs-segmented { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.gs-segment { padding: 10px 18px; border: 1px solid var(--border-divider); border-radius: 8px; background: var(--surface-raised); color: var(--text); font: inherit; font-weight: 500; cursor: pointer; }
.gs-segment:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }

.gs-pad { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.gs-pad__now { display: flex; flex-direction: column; gap: 2px; }
.gs-pad__label { font-weight: 700; font-size: 1.1rem; }
.gs-pad__batting { color: var(--secondary); font-size: 0.85rem; }
.gs-pad__steppers { display: flex; gap: 24px; }
.gs-pad__stepper { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.gs-pad__stepper span { color: var(--secondary); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
.gs-actions { display: flex; flex-wrap: wrap; gap: 8px; }

.gs-table-scroll { overflow-x: auto; border: 1px solid var(--border-divider); border-radius: 8px; }
.gs-table { border-collapse: collapse; width: 100%; min-width: 720px; }
.gs-table th, .gs-table td { padding: 8px 10px; border-bottom: 1px solid var(--border-divider); font-size: 0.82rem; text-align: center; white-space: nowrap; }
.gs-table th { background: var(--surface-raised); color: var(--secondary); font-weight: 600; }
.gs-table__player { text-align: left; display: flex; align-items: center; gap: 8px; min-width: 180px; }
.gs-table__player span { display: flex; flex-direction: column; }
.gs-table__player small { color: var(--secondary); font-size: 0.72rem; }
.gs-stat-input { width: 46px; height: 30px; text-align: center; border: 1px solid var(--border-divider); border-radius: 6px; background: var(--surface-card); color: var(--text); font: inherit; }
.gs-stat-input:focus { border-color: var(--primary); outline: none; }

.gs__loading { display: grid; gap: 12px; padding: 8px 0; }
.gs__loading-title { height: 40px; width: 320px; border-radius: 8px; }
.gs__loading-row { height: 120px; border-radius: 10px; }
.gs__error { display: grid; place-items: center; gap: 10px; text-align: center; min-height: 320px; color: var(--secondary); }
.gs__error h2 { margin: 6px 0 0; color: var(--text); }

@media (max-width: 720px) {
  .gs-hero { grid-template-columns: auto 1fr; }
  .gs-hero__meta { grid-column: 1 / -1; justify-content: flex-start; }
  .gs-hero__teams { gap: 12px; }
  .gs-hero__team span { display: none; }
  .gs-pad__steppers { gap: 16px; }
}
</style>
