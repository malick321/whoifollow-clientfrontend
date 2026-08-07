<script setup lang="ts">
// GameScoringView — live scoring console for a team-event game (legacy
// run/inning model). Layout follows docs/redesign/scoring-console.html; colors
// are matchgeni tokens (scoped under `.rd`). Shows ONLY data we track
// (runs/HR per inning, line score, field positions from the lineup, batting
// stats). Bases/outs, clock and notifications from the mockup are intentionally
// omitted — the legacy model has no data for them. Wired to the v1 game/*
// endpoints (src/api/gameScoring.ts). Admin-only editing.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TeamAvatar from '../components/TeamAvatar.vue'
import { pushToast } from '../toast-center'
import { confirmDialog } from '../confirm-center'
import { fetchTeamEventOverview } from '../api/teamEventDetail'
import {
  deleteLastInning, endGame, endHalfInning, fetchGameScoring, reopenGame,
  selectHomeTeam, swapGameTeams, updateBattingStats, updatePreviousScore, updateScore,
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
  return `${battingRow.value.team_type === 1 ? 'Top' : 'Bottom'} ${ordinal(currentInning.value)}`
})
const battingName = computed(() => battingRow.value
  ? (battingRow.value.team_flag === 1 ? teamName.value : opponentName.value)
  : '')
const resultLabel = computed(() => {
  const w = game.value?.win_status
  if (w === 1) return `${teamName.value} won`
  if (w === 2) return `${opponentName.value} won`
  if (w === 0) return 'Tie game'
  return '—'
})

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
// Board score: visitor on the left, home on the right.
const visitorRuns = computed(() => runsTotal(visitorRow.value))
const homeRuns = computed(() => runsTotal(homeRow.value))
const visitorName = computed(() => (visitorRow.value?.team_flag === 1 ? teamName.value : opponentName.value))
const homeName = computed(() => (homeRow.value?.team_flag === 1 ? teamName.value : opponentName.value))

// ── Field positions (from the lineup) — mockup 560×390 coordinate space ──
const FIELD_POS: Record<string, { x: number; y: number }> = {
  P: { x: 280, y: 262 }, C: { x: 280, y: 356 }, '1B': { x: 430, y: 244 }, '2B': { x: 372, y: 150 },
  '3B': { x: 130, y: 244 }, SS: { x: 188, y: 150 }, LF: { x: 108, y: 88 }, CF: { x: 280, y: 60 }, RF: { x: 452, y: 88 }
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

// ── Start game (legacy Select-Home-Team modal, inline in redesign) ──
const homeChoice = ref<'us' | 'opp'>('us') // which team is home
const startTime = ref(nowHM())
const timeLimit = ref('')
function startGame() {
  if (!game.value) return
  void run(() => selectHomeTeam({
    game_id: game.value!.id, team_id: game.value!.team_id, team_name: teamName.value,
    opponent_flag: homeChoice.value === 'us' ? 1 : 0, // 1 = my team home, 0 = my team visiting
    actual_start_time: startTime.value || nowHM(),
    time_limit: timeLimit.value ? Number(timeLimit.value) : null
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

// End half inning — legacy confirm shows Middle/End of Nth + the R/HR line.
async function doEndHalf() {
  if (!game.value || !battingRow.value) return
  const homeBatting = battingRow.value.team_type === 2
  const ord = ordinal(currentInning.value)
  const runs = cell(battingRow.value, currentInning.value, 2)
  const hr = cell(battingRow.value, currentInning.value, 1)
  const ok = await confirmDialog({
    title: homeBatting ? `End of ${ord} inning` : `Middle of ${ord} inning`,
    message: `${battingName.value} — ${runs} run${runs === 1 ? '' : 's'}, ${hr} HR this inning.`,
    confirmLabel: 'End half inning'
  })
  if (ok) void run(() => endHalfInning(game.value!.id), 'Half inning ended')
}
async function doDeleteInning() {
  if (game.value && await confirmDialog({ title: 'Delete last inning', message: 'Are you sure you want to delete this inning? You will not be able to revert this action.', confirmLabel: 'Delete inning', danger: true }))
    void run(() => deleteLastInning(game.value!.id), 'Inning removed')
}
async function doSwap() {
  if (game.value && await confirmDialog({ title: 'Swap home / visitor', message: `Swapping home & visitor will erase all game data. ${visitorName.value || teamName.value} will become the home team.`, confirmLabel: 'Continue', danger: true }))
    void run(() => swapGameTeams(game.value!.id), 'Teams swapped')
}
async function doEndGame() {
  if (game.value && await confirmDialog({ title: 'End game', message: 'Are you sure you want to end this game? You will not be able to revert this action.', confirmLabel: 'End game', danger: true }))
    void run(() => endGame(game.value!.id), 'Game ended')
}
async function doRestart() {
  if (game.value && await confirmDialog({ title: 'Restart game', message: 'Are you sure you want to restart this game?', confirmLabel: 'Restart game' }))
    void run(() => reopenGame(game.value!.id), 'Game reopened')
}

// ── Correct a previously-scored inning cell (legacy Update-Scores modal) ──
const editCell = ref<{ inningNo: number; gameScoreId: number | string; teamLabel: string; run: number; hr: number } | null>(null)
function openCellEdit(row: GameScoreRow, inningNo: number) {
  if (!isAdmin.value || !hasStarted.value) return
  editCell.value = {
    inningNo,
    gameScoreId: row.id,
    teamLabel: `${row.team_flag === 1 ? teamName.value : opponentName.value} · ${row.team_type === 1 ? 'Visiting team' : 'Home team'}`,
    run: cell(row, inningNo, 2),
    hr: cell(row, inningNo, 1)
  }
}
function savePreviousScore() {
  const c = editCell.value
  if (!game.value || !c) return
  void run(() => updatePreviousScore({
    game_id: game.value!.id, game_score_id: c.gameScoreId, inning_no: c.inningNo,
    run_score: Math.max(0, Number(c.run) || 0), hr_score: Math.max(0, Number(c.hr) || 0)
  }), 'Score updated')
  editCell.value = null
}

function saveBatting(row: GameLineupRow) {
  void run(() => updateBattingStats({
    id: row.id, ab: +row.ab || 0, one_b: +row.one_b || 0, two_b: +row.two_b || 0, three_b: +row.three_b || 0,
    hr: +row.hr || 0, rbi: +row.rbi || 0, r: +row.r || 0, bb: +row.bb || 0, sac: +row.sac || 0, e: +row.e || 0,
    solo_hr: Number((row as unknown as { solo_hr?: number }).solo_hr ?? 0) || 0
  }))
}
function back() { router.push({ name: 'team-event-detail', params: { teamId: teamId.value, eventId: eventId.value } }) }

onMounted(() => { void load() })
</script>

<template>
  <main class="score-console rd">
    <!-- Sticky scoreboard band. -->
    <div class="board">
      <div class="board-in">
        <div class="crumb">
          <button type="button" aria-label="Back to event" @click="back">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m0 0 6-6m-6 6 6 6" /></svg>
          </button>
          <strong>{{ game?.name || 'Game' }}</strong>
        </div>

        <div class="score">
          <div class="team">
            <TeamAvatar :name="hasStarted ? visitorName : teamName" size="sm" />
            <span class="tname">{{ hasStarted ? visitorName : teamName }}<i>Visitor</i></span>
          </div>
          <span class="runs n" :class="{ trail: hasStarted ? visitorRuns < homeRuns : teamRuns < oppRuns }">{{ hasStarted ? visitorRuns : teamRuns }}</span>
          <div class="state">
            <span v-if="isFinal" class="chip n">Final</span>
            <span v-else-if="hasStarted" class="chip a"><span class="live"></span>{{ inningLabel }}</span>
            <span v-else class="chip b">Scheduled</span>
          </div>
          <span class="runs n" :class="{ trail: hasStarted ? homeRuns < visitorRuns : oppRuns < teamRuns }">{{ hasStarted ? homeRuns : oppRuns }}</span>
          <div class="team r">
            <TeamAvatar :name="hasStarted ? homeName : opponentName" size="sm" />
            <span class="tname" style="text-align:right">{{ hasStarted ? homeName : opponentName }}<i>Home</i></span>
          </div>
        </div>

        <div class="board-right">
          <span v-if="isFinal" class="chip n">Final</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="shell" style="padding-top:18px">
      <div class="card"><div class="pad"><span class="shimmer-block" style="display:block;height:120px;border-radius:10px"></span></div></div>
    </div>

    <div v-else-if="loadError" class="shell" style="padding-top:18px">
      <div class="card"><div class="empty"><span class="ring">!</span><h3>Game unavailable</h3><p>{{ loadError }}</p><button type="button" class="btn" @click="back">Back to event</button></div></div>
    </div>

    <div v-else class="shell" style="padding-top:18px">
      <div class="cols">
        <!-- Score this half inning -->
        <div class="card">
          <header>
            <h2>Score this half inning</h2>
            <div v-if="hasStarted && !isFinal" class="sp">
              <span style="font-size:12.5px;color:var(--mu)">Batting</span>
              <span class="chip b">{{ battingName }}</span>
            </div>
          </header>

          <!-- Pre-game: select home team + start time + time limit (legacy Start Game) -->
          <div v-if="!hasStarted && isAdmin" class="sethome">
            <p>Select the home team and start the game.</p>
            <div class="seg" role="group" aria-label="Home team">
              <button type="button" :aria-pressed="homeChoice === 'us'" @click="homeChoice = 'us'">{{ teamName }} home</button>
              <button type="button" :aria-pressed="homeChoice === 'opp'" @click="homeChoice = 'opp'">{{ opponentName }} home</button>
            </div>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <div class="fld"><label>Start time</label><input v-model="startTime" type="time" aria-label="Start time" /></div>
              <div class="fld"><label>Time limit (min)</label><input v-model="timeLimit" type="number" min="0" inputmode="numeric" placeholder="e.g. 55" aria-label="Time limit in minutes" style="width:120px" /></div>
            </div>
            <div><button type="button" class="btn pri" :disabled="saving" @click="startGame">Start game</button></div>
          </div>
          <div v-else-if="!hasStarted" class="pad"><p style="margin:0;color:var(--mu-2)">Scoring hasn't started yet. A team admin selects the home team to begin.</p></div>

          <!-- Live: run / HR steppers -->
          <template v-else-if="!isFinal && isAdmin">
            <div class="atbat">
              <div class="step">
                <span class="eyebrow">Runs this inning</span>
                <div class="srow">
                  <button type="button" class="pm" :disabled="saving" aria-label="Remove a run" @click="bump(2, -1)">−</button>
                  <span class="val n">{{ padRuns }}</span>
                  <button type="button" class="pm up" :disabled="saving" aria-label="Add a run" @click="bump(2, 1)">+</button>
                </div>
                <div class="quick">
                  <button type="button" :disabled="saving" @click="bump(2, 2)">+2</button>
                  <button type="button" :disabled="saving" @click="bump(2, 3)">+3</button>
                  <button type="button" :disabled="saving" @click="bump(2, 4)">+4</button>
                </div>
              </div>
              <div class="step">
                <span class="eyebrow">Home runs</span>
                <div class="srow">
                  <button type="button" class="pm" :disabled="saving" aria-label="Remove a home run" @click="bump(1, -1)">−</button>
                  <span class="val n">{{ padHr }}</span>
                  <button type="button" class="pm up" :disabled="saving" aria-label="Add a home run" @click="bump(1, 1)">+</button>
                </div>
              </div>
            </div>
            <div class="actions">
              <button type="button" class="btn pri" :disabled="saving" @click="doEndHalf">
                End half inning
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m0 0-6-6m6 6-6 6" /></svg>
              </button>
              <button type="button" class="btn" :disabled="saving" @click="doSwap">Swap home / visitor</button>
              <button type="button" class="btn" :disabled="saving" @click="doDeleteInning">Delete last inning</button>
              <button type="button" class="btn dgr" :disabled="saving" @click="doEndGame">End game</button>
            </div>
          </template>

          <!-- Final: restart -->
          <div v-else-if="isFinal && isAdmin" class="actions" style="padding-top:16px">
            <button type="button" class="btn pri" :disabled="saving" @click="doRestart">Restart game</button>
            <span style="font-size:12.5px;color:var(--mu);align-self:center">This game is final. Restart it to make changes.</span>
          </div>

          <div v-else class="pad"><p style="margin:0;color:var(--mu-2)">Scoring is managed by a team admin.</p></div>
        </div>

        <!-- Game status (right rail) -->
        <div class="stack-v">
          <div class="card">
            <header><h2>Game status</h2></header>
            <div class="pad" style="padding-top:6px">
              <div class="keys">
                <div><span class="lb">Status</span><span class="vl">{{ statusLabel }}</span></div>
                <div v-if="hasStarted"><span class="lb">Inning</span><span class="vl">{{ isFinal ? ordinal(currentInning) : inningLabel }}</span></div>
                <div v-if="hasStarted && !isFinal"><span class="lb">Batting</span><span class="vl">{{ battingName }}</span></div>
                <div v-if="isFinal"><span class="lb">Result</span><span class="vl">{{ resultLabel }}</span></div>
              </div>
              <p v-if="!isAdmin" style="margin:12px 0 0;font-size:12.5px;color:var(--mu)">You're viewing this scoresheet in read-only mode.</p>
            </div>
          </div>
        </div>

        <!-- Line score -->
        <div class="card" style="grid-column:1/-1">
          <header><h2>Line score</h2><span v-if="hasStarted" class="cnt">{{ currentInning }} inning{{ currentInning === 1 ? '' : 's' }}</span></header>
          <div v-if="hasStarted" class="tw">
            <table class="ls">
              <thead>
                <tr>
                  <th class="l">Team</th>
                  <th v-for="n in innings" :key="n" :class="{ lv: n === currentInning }">{{ n }}</th>
                  <th class="tt">R</th><th class="tt">HR</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in lineRows" :key="r.row.id">
                  <td class="l"><div class="pcell"><TeamAvatar :name="r.name" size="sm" /><span class="nm">{{ r.name }}</span></div></td>
                  <td
                    v-for="n in innings" :key="n" class="c"
                    :class="{ has: hasCell(r.row, n), lv: n === currentInning, edit: isAdmin }"
                    :role="isAdmin ? 'button' : undefined" :tabindex="isAdmin ? 0 : undefined"
                    :title="isAdmin ? 'Edit this inning' : undefined"
                    @click="openCellEdit(r.row, n)"
                  >{{ hasCell(r.row, n) ? cell(r.row, n, 2) : '—' }}</td>
                  <td class="tt n">{{ r.runs }}</td><td class="tt n">{{ r.hr }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="pad"><p style="margin:0;color:var(--mu-2)">Scoring hasn't started — the line score appears once the first inning is scored.</p></div>
        </div>

        <!-- Field positions -->
        <div class="card" style="grid-column:1/-1">
          <header><h2>Field positions</h2><span class="cnt">{{ fieldPlayers.length }} assigned · {{ unassignedCount }} on the bench</span></header>
          <div v-if="battingRows.length" class="fieldwrap">
            <div class="fieldbox">
              <svg viewBox="0 0 560 390" role="img" aria-label="Field diagram with assigned positions">
                <path class="fd-grass" d="M280 330 A290 290 0 0 0 -10 40 L570 40 A290 290 0 0 0 280 330" />
                <path class="fd-dirt" d="M280 322 L128 170 L432 170 Z" />
                <path class="fd-line" d="M280 322 L390 212 L280 102 L170 212 Z" fill="none" />
                <circle class="fd-mound" cx="280" cy="212" r="26" />
                <g class="fd-base" fill="none">
                  <rect x="383" y="205" width="14" height="14" rx="2" transform="rotate(45 390 212)" />
                  <rect x="273" y="95" width="14" height="14" rx="2" transform="rotate(45 280 102)" />
                  <rect x="163" y="205" width="14" height="14" rx="2" transform="rotate(45 170 212)" />
                  <rect x="272" y="314" width="16" height="16" rx="2" transform="rotate(45 280 322)" />
                </g>
                <g v-for="p in fieldPlayers" :key="p.code">
                  <circle class="fd-pin" :cx="p.x" :cy="p.y" r="16" />
                  <text class="fd-code" :x="p.x" :y="p.y + 4" text-anchor="middle">{{ p.code }}</text>
                </g>
              </svg>
            </div>
            <div class="assigns">
              <span class="eyebrow" style="display:block;padding:0 16px 8px">Assignments</span>
              <div v-for="p in fieldPlayers" :key="p.code" class="arow"><b>{{ p.code }}</b><span>{{ p.name }}</span></div>
              <div class="pad" style="border-top:1px solid var(--line)">
                <span class="chip n"><b style="font-weight:600">EH</b> {{ unassignedCount }} player{{ unassignedCount === 1 ? '' : 's' }} unassigned</span>
              </div>
            </div>
          </div>
          <div v-else class="empty"><span class="ring">◆</span><h3>No lineup yet</h3><p>Add a lineup from the game's ⋯ menu to place fielders and record batting stats.</p></div>
        </div>

        <!-- Lineup / batting stats -->
        <div class="card" style="grid-column:1/-1">
          <header><h2>Lineup · {{ teamName }}</h2><span class="cnt">{{ battingRows.length }} batter{{ battingRows.length === 1 ? '' : 's' }}</span></header>
          <div v-if="battingRows.length" class="tw" style="max-height:520px">
            <table class="lu">
              <thead>
                <tr class="grp">
                  <th class="l">{{ battingRows.length }} batters</th>
                  <th colspan="8">Batting</th>
                  <th colspan="3" class="split">Base running</th>
                  <th colspan="2" class="split">Other</th>
                </tr>
                <tr class="hd">
                  <th class="l">Player</th>
                  <th v-for="c in COLS" :key="c.k" :class="{ split: c.split }">{{ c.label }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in battingRows" :key="row.id">
                  <td class="l"><div class="pcell">
                    <span v-if="row.position?.position_name" class="pos">{{ posCode(row.position.position_name) || 'EH' }}</span>
                    <span class="nm">{{ playerName(row) }}</span>
                    <span v-if="jersey(row)" class="rl">#{{ jersey(row) }}</span>
                  </div></td>
                  <td v-for="c in COLS" :key="c.k" class="n" :class="{ split: c.split, z: !c.avg && !Number((row as any)[c.k]) }">
                    <input
                      v-if="c.edit && isAdmin"
                      v-model.number="(row as any)[c.k]"
                      type="number" min="0" class="stat" :disabled="saving" @change="saveBatting(row)"
                    />
                    <template v-else>{{ c.avg ? Number((row as any)[c.k] || 0).toFixed(3) : (row as any)[c.k] }}</template>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td class="l">Game total</td>
                  <td v-for="c in COLS" :key="c.k" class="n" :class="{ split: c.split }">{{ c.avg ? Number(footTotal(c.k) || 0).toFixed(3) : footTotal(c.k) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div v-else class="empty"><span class="ring">＋</span><h3>No lineup yet</h3><p>Add a lineup from the game's ⋯ menu to record batting stats.</p></div>
        </div>
      </div>
    </div>

    <!-- Edit a previous inning's score (legacy Update Scores modal). -->
    <div v-if="editCell" class="cell-modal" @click.self="editCell = null">
      <div class="card cell-modal__box">
        <header><h2>Update scores</h2></header>
        <div class="pad">
          <p style="margin:0 0 4px;font-size:12.5px;color:var(--mu-2)">{{ editCell.teamLabel }}</p>
          <p style="margin:0 0 14px;font-size:12.5px;color:var(--mu)">Inning {{ editCell.inningNo }}</p>
          <div style="display:flex;gap:14px;flex-wrap:wrap">
            <div class="fld"><label>Runs</label><input v-model.number="editCell.run" type="number" min="0" inputmode="numeric" aria-label="Runs" style="width:120px" /></div>
            <div class="fld"><label>Home runs</label><input v-model.number="editCell.hr" type="number" min="0" inputmode="numeric" aria-label="Home runs" style="width:120px" /></div>
          </div>
        </div>
        <div class="actions" style="padding-top:0">
          <button type="button" class="btn pri" :disabled="saving" @click="savePreviousScore">Update</button>
          <button type="button" class="btn" :disabled="saving" @click="editCell = null">Cancel</button>
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
.score-console { width: 100%; margin: 0; padding: 0; min-height: calc(100vh - 56px); }
/* Board pins below the member top bar (56px desktop / 52px mobile). */
.score-console .board { top: 56px; }
@media (max-width: 720px) { .score-console .board { top: 52px; } .score-console { min-height: calc(100vh - 52px); } }

/* Field diagram colors — matchgeni tokens (light/dark aware). */
.fd-grass { fill: color-mix(in srgb, var(--success) 14%, var(--card-4)); }
.fd-dirt { fill: color-mix(in srgb, var(--warning) 20%, var(--card-4)); }
.fd-mound { fill: color-mix(in srgb, var(--warning) 30%, var(--card-4)); }
.fd-line { stroke: var(--line-3); stroke-width: 1.5; }
.fd-base { stroke: var(--line-3); stroke-width: 1.5; }
.fd-pin { fill: var(--card-2); stroke: var(--blue); stroke-width: 1.5; }
.fd-code { font-size: 11px; font-weight: 600; fill: var(--blue); }

/* Clickable line-score cells (admin score correction). */
.score-console :deep(.ls td.c.edit) { cursor: pointer; }
.score-console :deep(.ls td.c.edit:hover) { background: var(--blue-bg); color: var(--blue); }

/* Update-scores modal overlay. */
.cell-modal { position: fixed; inset: 0; z-index: 60; background: rgba(0, 0, 0, 0.5); display: grid; place-items: center; padding: 20px; }
.cell-modal__box { width: 100%; max-width: 360px; }
</style>
