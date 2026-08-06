<script setup lang="ts">
// GameScoringView — live scoring console for a team-event game (legacy
// run/inning model). Design follows the "live scoring console" mockup, recolored
// to the matchgeni design tokens; shows ONLY data we track (runs/HR per inning,
// line score, field positions from the lineup, batting stats). Wired to the v1
// game/* endpoints (src/api/gameScoring.ts). Admin-only editing.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TeamAvatar from '../components/TeamAvatar.vue'
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

// ── Derived ──────────────────────────────────────────────────────
const game = computed(() => data.value?.game ?? null)
const scores = computed<GameScoreRow[]>(() => game.value?.gameScores ?? [])
const hasStarted = computed(() => scores.value.length >= 2)
const isFinal = computed(() => (game.value?.status ?? 0) === 2)
const battingRow = computed(() => scores.value.find((s) => s.batting_flag === 1) ?? null)
const visitorRow = computed(() => scores.value.find((s) => s.team_type === 1) ?? null)
const homeRow = computed(() => scores.value.find((s) => s.team_type === 2) ?? null)
const currentInning = computed(() => Math.max(1, ...scores.value.map((s) => s.end_inning_flag || 1)))
const innings = computed(() => Array.from({ length: currentInning.value }, (_, i) => i + 1))

function cell(row: GameScoreRow | null, inningNo: number, inningType: number): number {
  const hit = row?.gameInnings?.find((i) => i.inning_no === inningNo && i.inning_type === inningType)
  return hit ? Number(hit.score) : 0
}
function hasCell(row: GameScoreRow | null, inningNo: number): boolean {
  return !!row?.gameInnings?.some((i) => i.inning_no === inningNo && i.inning_type === 2)
}
function runsTotal(row: GameScoreRow | null): number {
  return (row?.gameInnings ?? []).filter((i) => i.inning_type === 2).reduce((a, i) => a + Number(i.score), 0)
}
function hrTotal(row: GameScoreRow | null): number {
  return (row?.gameInnings ?? []).filter((i) => i.inning_type === 1).reduce((a, i) => a + Number(i.score), 0)
}

const teamRuns = computed(() => (hasStarted.value ? runsTotal(scores.value.find((s) => s.team_flag === 1) ?? null) : data.value?.teamRuns ?? 0))
const oppRuns = computed(() => (hasStarted.value ? runsTotal(scores.value.find((s) => s.team_flag === 2) ?? null) : data.value?.opponentRuns ?? 0))
const teamName = computed(() => data.value?.teamName || 'Team')
const opponentName = computed(() => data.value?.opponentName || 'Opponent')

const statusLabel = computed(() => (isFinal.value ? 'Final' : hasStarted.value ? 'Live' : 'Scheduled'))
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
const inningLabel = computed(() => {
  if (!hasStarted.value || !battingRow.value) return ''
  return `${battingRow.value.team_type === 1 ? 'Top' : 'Bot'} ${ordinal(currentInning.value)}`
})
const battingName = computed(() => battingRow.value
  ? (battingRow.value.team_flag === 1 ? teamName.value : opponentName.value)
  : '')

// Line-score display rows (visitor first).
const lineRows = computed(() => {
  if (!hasStarted.value) return []
  return [visitorRow.value, homeRow.value].filter(Boolean).map((row) => ({
    row: row as GameScoreRow,
    name: (row as GameScoreRow).team_flag === 1 ? teamName.value : opponentName.value,
    side: (row as GameScoreRow).team_type === 2 ? 'Home' : 'Visitor',
    runs: runsTotal(row as GameScoreRow),
    hr: hrTotal(row as GameScoreRow)
  }))
})

// ── Field positions (from the lineup) ────────────────────────────
const FIELD_POS: Record<string, { x: number; y: number }> = {
  P: { x: 320, y: 205 }, C: { x: 321, y: 282 }, '1B': { x: 430, y: 140 }, '2B': { x: 384, y: 92 },
  '3B': { x: 214, y: 140 }, SS: { x: 258, y: 92 }, LF: { x: 118, y: 58 }, CF: { x: 320, y: 40 }, RF: { x: 522, y: 58 }
}
const NAME_TO_CODE: Record<string, string> = {
  PITCHER: 'P', CATCHER: 'C', 'FIRST BASE': '1B', FIRSTBASE: '1B', 'SECOND BASE': '2B', 'THIRD BASE': '3B',
  SHORTSTOP: 'SS', 'SHORT STOP': 'SS', 'LEFT FIELD': 'LF', 'CENTER FIELD': 'CF', 'CENTRE FIELD': 'CF',
  'RIGHT FIELD': 'RF', 'LEFT FIELDER': 'LF', 'CENTER FIELDER': 'CF', 'RIGHT FIELDER': 'RF'
}
function posCode(name?: string | null): string | null {
  if (!name) return null
  const n = name.trim().toUpperCase()
  if (FIELD_POS[n]) return n
  return NAME_TO_CODE[n] ?? null
}
function playerName(row: GameLineupRow): string {
  return row.user?.name || `${row.user_profile?.fname ?? ''} ${row.user_profile?.lname ?? ''}`.trim() || 'Player'
}
const fieldPlayers = computed(() => {
  const taken = new Set<string>()
  const placed: { code: string; x: number; y: number; name: string }[] = []
  for (const code of Object.keys(FIELD_POS)) {
    const p = battingRows.value.find((r) => posCode(r.position?.position_name) === code && !taken.has(String(r.id)))
    if (p) { taken.add(String(p.id)); placed.push({ code, ...FIELD_POS[code], name: playerName(p) }) }
  }
  return placed
})
const unassignedCount = computed(() => battingRows.value.length - fieldPlayers.value.length)

// ── Batting stats table ──────────────────────────────────────────
type ColKey = 'on_base_avg' | 'average' | 'ab' | 'h' | 'one_b' | 'two_b' | 'three_b' | 'hr' | 'rbi' | 'r' | 'bb' | 'sac' | 'e'
interface Col { k: ColKey; label: string; edit: boolean; avg?: boolean; split?: boolean }
const COLS: Col[] = [
  { k: 'on_base_avg', label: 'OB%', edit: false, avg: true }, { k: 'average', label: 'AVG', edit: false, avg: true },
  { k: 'ab', label: 'AB', edit: true }, { k: 'h', label: 'H', edit: false },
  { k: 'one_b', label: '1B', edit: true }, { k: 'two_b', label: '2B', edit: true },
  { k: 'three_b', label: '3B', edit: true }, { k: 'hr', label: 'HR', edit: true },
  { k: 'rbi', label: 'RBI', edit: true, split: true }, { k: 'r', label: 'R', edit: true }, { k: 'bb', label: 'BB', edit: true },
  { k: 'sac', label: 'SAC', edit: true, split: true }, { k: 'e', label: 'E', edit: true }
]
function jersey(row: GameLineupRow): string | null { return row.teamMember?.uniform_no || null }
function footTotal(k: ColKey): string {
  const s = data.value?.stats_sums
  if (!s) return '0'
  const v = (s as unknown as Record<string, unknown>)[k]
  return v === undefined || v === null ? '0' : String(v)
}

// ── Load / mutate ────────────────────────────────────────────────
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
  if (scoring) { data.value = scoring; battingRows.value = scoring.gameLineUps.map((r) => ({ ...r })) }
}
async function run(fn: () => Promise<unknown>, msg?: string) {
  if (saving.value) return
  saving.value = true
  try {
    await fn(); await refresh()
    if (msg) pushToast({ tone: 'success', title: msg })
  } catch (error) {
    pushToast({ tone: 'warning', title: 'Action failed', message: error instanceof Error ? error.message : 'Please try again.' })
  } finally { saving.value = false }
}

function nowHM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function setHomeTeam(weAreHome: boolean) {
  if (!game.value) return
  void run(() => selectHomeTeam({
    game_id: game.value!.id, team_id: game.value!.team_id, team_name: teamName.value,
    opponent_flag: weAreHome ? 1 : 0, actual_start_time: nowHM()
  }), 'Game started')
}
function bump(inningType: number, delta: number) {
  if (!game.value || !battingRow.value) return
  const cur = cell(battingRow.value, currentInning.value, inningType)
  void run(() => updateScore({
    game_id: game.value!.id, team_type: battingRow.value!.team_type,
    inning_no: currentInning.value, score: Math.max(0, cur + delta), inning_type: inningType
  }))
}
const padRuns = computed(() => cell(battingRow.value, currentInning.value, 2))
const padHr = computed(() => cell(battingRow.value, currentInning.value, 1))

function doEndHalf() { if (game.value) void run(() => endHalfInning(game.value!.id), 'Half inning ended') }
function doAddInning() { if (game.value) void run(() => addInning(game.value!.id), 'Inning added') }
async function doDeleteInning() {
  if (game.value && await confirmDialog({ title: 'Undo last inning?', message: 'The most recent inning will be removed.', confirmLabel: 'Undo', danger: true }))
    void run(() => deleteLastInning(game.value!.id), 'Inning removed')
}
async function doSwap() {
  if (game.value && await confirmDialog({ title: 'Swap home / visitor?', message: 'This resets all innings and scores for this game.', confirmLabel: 'Swap', danger: true }))
    void run(() => swapGameTeams(game.value!.id), 'Teams swapped')
}
async function doEndGame() {
  if (game.value && await confirmDialog({ title: 'End game?', message: 'The final score will be locked in.', confirmLabel: 'End game' }))
    void run(() => endGame(game.value!.id), 'Game ended')
}
function doReopen() { if (game.value) void run(() => reopenGame(game.value!.id), 'Game reopened') }

function saveBatting(row: GameLineupRow) {
  void run(() => updateBattingStats({
    id: row.id, ab: +row.ab || 0, one_b: +row.one_b || 0, two_b: +row.two_b || 0, three_b: +row.three_b || 0,
    hr: +row.hr || 0, rbi: +row.rbi || 0, r: +row.r || 0, bb: +row.bb || 0, sac: +row.sac || 0, e: +row.e || 0
  }))
}
function back() { router.push({ name: 'team-event-detail', params: { teamId: teamId.value, eventId: eventId.value } }) }

onMounted(() => { void load() })
onBeforeUnmount(() => {})
</script>

<template>
  <main class="sc">
    <!-- Sticky scoreboard band -->
    <div class="sc-board">
      <div class="sc-board__in">
        <div class="sc-board__crumb">
          <button type="button" class="sc-board__back" aria-label="Back to event" @click="back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m0 0 6-6m-6 6 6 6" /></svg>
          </button>
          <span class="sc-board__game">{{ game?.name || 'Game' }}</span>
        </div>

        <div class="sc-board__score">
          <div class="sc-board__team">
            <TeamAvatar :name="teamName" size="sm" />
            <span class="sc-board__tname">{{ teamName }}<i>Us</i></span>
          </div>
          <span class="sc-board__runs" :class="{ 'is-lead': teamRuns > oppRuns }">{{ teamRuns }}</span>
          <div class="sc-board__state">
            <span v-if="inningLabel" class="sc-board__inning">{{ inningLabel }}</span>
            <span class="sc-board__status" :class="`is-${statusLabel.toLowerCase()}`">{{ statusLabel }}</span>
          </div>
          <span class="sc-board__runs" :class="{ 'is-lead': oppRuns > teamRuns }">{{ oppRuns }}</span>
          <div class="sc-board__team sc-board__team--r">
            <TeamAvatar :name="opponentName" size="sm" />
            <span class="sc-board__tname sc-board__tname--r">{{ opponentName }}<i>Opp</i></span>
          </div>
        </div>

        <div class="sc-board__right">
          <button v-if="isAdmin && hasStarted && !isFinal" type="button" class="sc-btn sc-btn--danger" :disabled="saving" @click="doEndGame">End game</button>
          <button v-if="isAdmin && isFinal" type="button" class="sc-btn" :disabled="saving" @click="doReopen">Reopen</button>
        </div>
      </div>
    </div>

    <div v-if="loading" class="sc-wrap">
      <div class="sc-card"><span class="shimmer-block sc-sk sc-sk--title"></span></div>
      <div class="sc-card"><span class="shimmer-block sc-sk sc-sk--row"></span></div>
    </div>

    <div v-else-if="loadError" class="sc-wrap">
      <div class="sc-card sc-empty"><h2>Game unavailable</h2><p>{{ loadError }}</p><button type="button" class="sc-btn" @click="back">Back to event</button></div>
    </div>

    <div v-else class="sc-wrap">
      <!-- Score this half inning -->
      <section v-if="isAdmin && !isFinal" class="sc-card">
        <header class="sc-card__head">
          <h2>Score this half inning</h2>
          <span v-if="hasStarted" class="sc-pill">Batting · {{ battingName }}</span>
        </header>

        <div v-if="!hasStarted" class="sc-sethome">
          <p>Who is the home team?</p>
          <div class="sc-seg">
            <button type="button" :disabled="saving" @click="setHomeTeam(true)">{{ teamName }} home</button>
            <button type="button" :disabled="saving" @click="setHomeTeam(false)">{{ opponentName }} home</button>
          </div>
        </div>

        <template v-else>
          <div class="sc-pad">
            <div class="sc-step">
              <span class="eyebrow">Runs · inning {{ currentInning }}</span>
              <div class="sc-step__row">
                <button type="button" class="sc-pm" :disabled="saving" aria-label="Remove a run" @click="bump(2, -1)">−</button>
                <span class="sc-val">{{ padRuns }}</span>
                <button type="button" class="sc-pm sc-pm--up" :disabled="saving" aria-label="Add a run" @click="bump(2, 1)">+</button>
              </div>
              <div class="sc-quick">
                <button type="button" :disabled="saving" @click="bump(2, 2)">+2</button>
                <button type="button" :disabled="saving" @click="bump(2, 3)">+3</button>
                <button type="button" :disabled="saving" @click="bump(2, 4)">+4</button>
              </div>
            </div>
            <div class="sc-step">
              <span class="eyebrow">Home runs</span>
              <div class="sc-step__row">
                <button type="button" class="sc-pm" :disabled="saving" aria-label="Remove a home run" @click="bump(1, -1)">−</button>
                <span class="sc-val">{{ padHr }}</span>
                <button type="button" class="sc-pm sc-pm--up" :disabled="saving" aria-label="Add a home run" @click="bump(1, 1)">+</button>
              </div>
            </div>
          </div>
          <div class="sc-actions">
            <button type="button" class="sc-btn sc-btn--primary" :disabled="saving" @click="doEndHalf">
              End half inning
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m0 0-6-6m6 6-6 6" /></svg>
            </button>
            <button type="button" class="sc-btn" :disabled="saving" @click="doAddInning">Add inning</button>
            <button type="button" class="sc-btn" :disabled="saving" @click="doDeleteInning">Undo last inning</button>
            <button type="button" class="sc-btn sc-btn--danger" :disabled="saving" @click="doSwap">Swap home / visitor</button>
          </div>
        </template>
      </section>

      <!-- Line score -->
      <section class="sc-card">
        <header class="sc-card__head"><h2>Line score</h2></header>
        <div v-if="hasStarted" class="sc-ls-scroll">
          <table class="sc-ls">
            <thead>
              <tr>
                <th class="sc-ls__tm">Team</th>
                <th v-for="n in innings" :key="n" :class="{ 'is-live': n === currentInning }">{{ n }}</th>
                <th class="sc-ls__tot">R</th><th class="sc-ls__tot">HR</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in lineRows" :key="r.row.id">
                <td class="sc-ls__tm"><TeamAvatar :name="r.name" size="sm" /> <span>{{ r.name }}</span></td>
                <td v-for="n in innings" :key="n" :class="{ 'is-live': n === currentInning, 'is-empty': !hasCell(r.row, n) }">
                  {{ hasCell(r.row, n) ? cell(r.row, n, 2) : '—' }}
                </td>
                <td class="sc-ls__tot">{{ r.runs }}</td><td class="sc-ls__tot">{{ r.hr }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="sc-note">Scoring hasn't started.{{ isAdmin ? ' Set the home team above to begin.' : '' }}</p>
      </section>

      <!-- Field positions -->
      <section class="sc-card">
        <header class="sc-card__head"><h2>Field positions</h2></header>
        <div class="sc-field">
          <svg viewBox="0 0 640 300" class="sc-field__svg" role="img" aria-label="Field diagram with assigned positions">
            <path class="sc-field__grass" d="M320 278 A250 250 0 0 0 70 28 L570 28 A250 250 0 0 0 320 278" />
            <path class="sc-field__infield" d="M320 268 L120 72 L520 72 Z" />
            <circle class="sc-field__mound" cx="320" cy="150" r="20" />
            <g>
              <g v-for="p in fieldPlayers" :key="p.code">
                <circle class="sc-field__pin" :cx="p.x" :cy="p.y" r="15" />
                <text class="sc-field__code" :x="p.x" :y="p.y + 4" text-anchor="middle">{{ p.code }}</text>
              </g>
            </g>
          </svg>
          <div class="sc-legend">
            <span v-for="p in fieldPlayers" :key="p.code" class="sc-chip"><b>{{ p.code }}</b>{{ p.name }}</span>
            <span v-if="unassignedCount > 0" class="sc-chip sc-chip--muted"><b>EH</b>{{ unassignedCount }} unassigned</span>
            <span v-if="!battingRows.length" class="sc-note">No lineup set — add one from the game's ⋯ menu.</span>
          </div>
        </div>
      </section>

      <!-- Lineup / batting stats -->
      <section class="sc-card">
        <header class="sc-card__head"><h2>Lineup · {{ teamName }}</h2><span class="sc-count">{{ battingRows.length }} batters</span></header>
        <div v-if="battingRows.length" class="sc-lu-scroll">
          <table class="sc-lu">
            <thead>
              <tr class="sc-lu__grp">
                <th class="sc-lu__nm"></th>
                <th colspan="8">Batting</th>
                <th colspan="3" class="sc-split">Base running</th>
                <th colspan="2" class="sc-split">Other</th>
              </tr>
              <tr>
                <th class="sc-lu__nm">Player</th>
                <th v-for="c in COLS" :key="c.k" :class="{ 'sc-split': c.split }">{{ c.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in battingRows" :key="row.id">
                <td class="sc-lu__nm">
                  <span v-if="row.position?.position_name" class="sc-pos">{{ posCode(row.position.position_name) || 'EH' }}</span>
                  <span class="sc-lu__name">{{ playerName(row) }}</span>
                  <small v-if="jersey(row)">#{{ jersey(row) }}</small>
                </td>
                <td v-for="c in COLS" :key="c.k" :class="{ 'sc-split': c.split, 'is-z': !Number((row as any)[c.k]) }">
                  <input
                    v-if="c.edit && isAdmin"
                    v-model.number="(row as any)[c.k]"
                    type="number" min="0" class="sc-stat" :disabled="saving" @change="saveBatting(row)"
                  />
                  <template v-else>{{ c.avg ? Number((row as any)[c.k] || 0).toFixed(3) : (row as any)[c.k] }}</template>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="sc-lu__nm">Game total</td>
                <td v-for="c in COLS" :key="c.k" :class="{ 'sc-split': c.split }">
                  {{ c.avg ? Number(footTotal(c.k) || 0).toFixed(3) : footTotal(c.k) }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p v-else class="sc-note">No lineup yet — add a lineup from the game's ⋯ menu to record batting stats.</p>
      </section>
    </div>
  </main>
</template>

<style scoped>
.sc { color: var(--text); }

/* Scoreboard band — sticky below the member top bar. */
.sc-board { position: sticky; top: 56px; z-index: 30; background: var(--surface-chrome); border-bottom: 1px solid var(--border-divider); box-shadow: 0 4px 14px rgba(0,0,0,0.05); }
.sc-board__in { max-width: 1320px; margin: 0 auto; padding: 10px 20px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; }
.sc-board__crumb { display: flex; align-items: center; gap: 10px; min-width: 0; }
.sc-board__back { width: 34px; height: 34px; border: 1px solid var(--border-divider); background: var(--surface-raised); color: var(--text); border-radius: 8px; display: grid; place-items: center; cursor: pointer; }
.sc-board__game { font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-board__score { display: flex; align-items: center; justify-content: center; gap: 16px; }
.sc-board__team { display: flex; align-items: center; gap: 9px; min-width: 0; }
.sc-board__team--r { flex-direction: row-reverse; }
.sc-board__tname { font-size: 0.85rem; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.sc-board__tname i { display: block; font-style: normal; font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--secondary); }
.sc-board__tname--r { text-align: right; }
.sc-board__runs { font-size: 2.1rem; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--secondary); line-height: 1; }
.sc-board__runs.is-lead { color: var(--text); }
.sc-board__state { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.sc-board__inning { background: var(--primary); color: #fff; border-radius: 6px; padding: 3px 10px; font-size: 0.78rem; font-weight: 600; white-space: nowrap; }
.sc-board__status { font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--secondary); }
.sc-board__status.is-live { color: var(--success); }
.sc-board__status.is-final { color: var(--text); }
.sc-board__right { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }

.sc-wrap { max-width: 1320px; margin: 0 auto; padding: 18px 20px 60px; display: flex; flex-direction: column; gap: 16px; }

.sc-card { background: var(--surface-card); border: 1px solid var(--border-divider); border-radius: 10px; }
.sc-card__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border-divider); }
.sc-card__head h2 { margin: 0; font-size: 0.95rem; }
.sc-count { color: var(--secondary); font-size: 0.8rem; }
.sc-pill { display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, var(--primary) 14%, transparent); color: var(--primary); border-radius: 20px; padding: 3px 10px; font-size: 0.78rem; font-weight: 500; }

.sc-btn { height: 38px; padding: 0 14px; border: 1px solid var(--border-divider); background: var(--surface-card); color: var(--text); border-radius: 8px; font: inherit; font-size: 0.85rem; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.sc-btn:hover:not(:disabled) { border-color: var(--primary); }
.sc-btn:disabled { opacity: 0.55; cursor: default; }
.sc-btn--primary { background: var(--primary); border-color: var(--primary); color: #fff; }
.sc-btn--primary:hover:not(:disabled) { filter: brightness(0.95); }
.sc-btn--danger { color: var(--highlight); border-color: color-mix(in srgb, var(--highlight) 40%, var(--border-divider)); }
.sc-btn--danger:hover:not(:disabled) { border-color: var(--highlight); }

.sc-sethome { padding: 16px; }
.sc-sethome p { margin: 0 0 10px; color: var(--secondary); }
.sc-seg { display: inline-flex; gap: 8px; flex-wrap: wrap; }
.sc-seg button { padding: 10px 18px; border: 1px solid var(--border-divider); border-radius: 8px; background: var(--surface-raised); color: var(--text); font: inherit; font-weight: 500; cursor: pointer; }
.sc-seg button:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }

.sc-pad { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; padding: 16px; }
.sc-step { background: var(--surface-raised); border-radius: 8px; padding: 12px; }
.sc-step .eyebrow { display: block; margin-bottom: 8px; }
.sc-step__row { display: flex; align-items: center; gap: 10px; }
.sc-val { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 44px; text-align: center; }
.sc-pm { width: 40px; height: 40px; border: 1px solid var(--border-divider); background: var(--surface-card); color: var(--text); border-radius: 8px; font-size: 1.4rem; line-height: 1; display: grid; place-items: center; cursor: pointer; }
.sc-pm:hover:not(:disabled) { border-color: var(--primary); }
.sc-pm--up { background: var(--primary); border-color: var(--primary); color: #fff; }
.sc-quick { display: flex; gap: 6px; margin-top: 9px; }
.sc-quick button { border: 1px solid var(--border-divider); background: var(--surface-card); border-radius: 6px; padding: 4px 9px; font-size: 0.78rem; font-weight: 500; color: var(--secondary); cursor: pointer; }
.sc-quick button:hover:not(:disabled) { color: var(--primary); border-color: var(--primary); }
.sc-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 16px 16px; }

.sc-ls-scroll, .sc-lu-scroll { overflow-x: auto; }
.sc-ls { width: 100%; border-collapse: collapse; }
.sc-ls th, .sc-ls td { padding: 0 4px; height: 38px; text-align: center; font-variant-numeric: tabular-nums; font-size: 0.85rem; border-right: 1px solid var(--border-divider); min-width: 40px; }
.sc-ls thead th { font-size: 0.72rem; font-weight: 600; color: var(--secondary); background: var(--surface-raised); border-bottom: 1px solid var(--border-divider); }
.sc-ls__tm { text-align: left !important; padding-left: 16px !important; min-width: 200px; display: flex; align-items: center; gap: 9px; }
.sc-ls tbody .sc-ls__tm { height: 44px; font-weight: 500; }
.sc-ls__tot { background: var(--surface-raised); font-weight: 600; }
.sc-ls .is-live { background: color-mix(in srgb, var(--primary) 10%, transparent); color: var(--primary); }
.sc-ls .is-empty { color: var(--text-light); }
.sc-ls tbody tr + tr td { border-top: 1px solid var(--border-divider); }

.sc-field { display: grid; gap: 12px; padding: 12px 16px 16px; }
.sc-field__svg { width: 100%; height: auto; max-height: 300px; }
.sc-field__grass { fill: color-mix(in srgb, var(--success) 12%, var(--surface-raised)); }
.sc-field__infield { fill: color-mix(in srgb, var(--warning) 20%, var(--surface-raised)); }
.sc-field__mound { fill: color-mix(in srgb, var(--warning) 30%, var(--surface-raised)); }
.sc-field__pin { fill: var(--surface-card); stroke: var(--primary); stroke-width: 1.5; }
.sc-field__code { font-size: 10px; font-weight: 600; fill: var(--primary); }
.sc-legend { display: flex; flex-wrap: wrap; gap: 6px; }
.sc-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-divider); border-radius: 20px; padding: 2px 10px 2px 3px; font-size: 0.78rem; background: var(--surface-card); }
.sc-chip b { font-size: 0.66rem; background: var(--primary); color: #fff; border-radius: 10px; padding: 1px 6px; }
.sc-chip--muted b { background: var(--surface-raised); color: var(--secondary); border: 1px solid var(--border-divider); }

.sc-lu { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; font-size: 0.82rem; }
.sc-lu thead th { position: sticky; top: 0; z-index: 2; background: var(--surface-raised); font-size: 0.72rem; font-weight: 600; color: var(--secondary); height: 30px; padding: 0 9px; text-align: right; border-bottom: 1px solid var(--border-divider); white-space: nowrap; }
.sc-lu__grp th { text-align: left; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.64rem; color: var(--text-light); }
.sc-lu__nm { position: sticky; left: 0; z-index: 1; background: var(--surface-card); text-align: left !important; min-width: 210px; padding: 0 12px 0 16px !important; border-right: 1px solid var(--border-divider); }
.sc-lu thead .sc-lu__nm { z-index: 3; background: var(--surface-raised); }
.sc-lu td { height: 38px; padding: 0 9px; text-align: right; border-bottom: 1px solid var(--border-divider); }
.sc-lu td.is-z { color: var(--text-light); }
.sc-lu tbody tr:hover td { background: var(--surface-raised); }
.sc-lu tbody .sc-lu__nm { display: flex; align-items: center; gap: 8px; height: 44px; }
.sc-lu__name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-lu__nm small { color: var(--secondary); }
.sc-pos { font-size: 0.64rem; font-weight: 600; border: 1px solid var(--border-divider); border-radius: 4px; padding: 1px 5px; color: var(--secondary); }
.sc-split { border-left: 1px solid var(--border-divider); }
.sc-stat { width: 44px; height: 28px; text-align: right; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--text); font: inherit; font-variant-numeric: tabular-nums; }
.sc-stat:hover { border-color: var(--border-divider); }
.sc-stat:focus { border-color: var(--primary); outline: none; background: var(--surface-card); }
.sc-lu tfoot td { position: sticky; bottom: 0; background: var(--surface-raised); font-weight: 600; height: 40px; border-top: 1px solid var(--border-divider); }
.sc-lu tfoot .sc-lu__nm { background: var(--surface-raised); }

.sc-note { color: var(--secondary); font-size: 0.88rem; margin: 0; padding: 16px; }
.sc-empty { display: grid; place-items: center; gap: 10px; text-align: center; padding: 40px 20px; }
.sc-empty h2 { margin: 0; }
.sc-empty p { margin: 0; color: var(--secondary); }
.sc-sk { display: block; }
.sc-sk--title { height: 40px; border-radius: 8px; margin: 16px; }
.sc-sk--row { height: 160px; border-radius: 8px; margin: 16px; }

@media (max-width: 720px) {
  .sc-board { top: 52px; }
  .sc-board__in { grid-template-columns: auto 1fr; gap: 10px; }
  .sc-board__right { grid-column: 2; }
  .sc-board__crumb { grid-column: 1; }
  .sc-board__score { grid-column: 1 / -1; grid-row: 2; justify-content: space-between; }
  .sc-board__tname { max-width: 90px; }
  .sc-board__runs { font-size: 1.7rem; }
  .sc-pad { grid-template-columns: 1fr; }
}
</style>
