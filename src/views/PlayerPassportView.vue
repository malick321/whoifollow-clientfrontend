<script setup lang="ts">
// PlayerPassportView — the premium consumer surface.
// -------------------------------------------------------------------
// A player's verified, career-spanning batting profile: hero identity,
// scope tabs (Career / season), headline stat cards, the slash line,
// full batting line, game log, season splits, and a leaderboard. Freemium
// gating is driven entirely by the API's `access` block — locked metrics
// come back null and get a blur + upgrade overlay. In DEV a Free⇄Pro toggle
// lets you preview the paid experience (?preview=pro).
//
// Routes: /players/:playerId  and  /my/stats (resolves the logged-in user).
// Data: src/api/playerPassport.ts. Contract: docs/api/player-passport-api-contract.md.

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TeamAvatar from '../components/TeamAvatar.vue'
import { getAuthUserId } from '../auth-session'
import { pushToast } from '../toast-center'
import {
  fetchLeaderboard,
  fetchPlayerGameLog,
  fetchPlayerProfile,
  fetchPlayerSplits,
  fetchPlayerStats,
  type GameLogResult,
  type LeaderboardResult,
  type PlayerProfile,
  type PlayerStatsResult,
  type SplitsResult
} from '../api/playerPassport'

const route = useRoute()
const router = useRouter()
const isDev = import.meta.env.DEV

const playerId = computed<string>(() => {
  if (route.name === 'my-stats') return getAuthUserId() ?? ''
  return String(route.params.playerId ?? '')
})

const previewPro = ref(false)
const loading = ref(true)
const notFound = ref(false)

const profile = ref<PlayerProfile | null>(null)
const statsResult = ref<PlayerStatsResult | null>(null)
const gameLog = ref<GameLogResult | null>(null)
const splits = ref<SplitsResult | null>(null)
const leaderboard = ref<LeaderboardResult | null>(null)

// Scope: 'career' or a specific year.
const scope = ref<'career' | number>('career')
const seasons = computed<number[]>(() => {
  const first = profile.value?.firstGameDate?.slice(0, 4)
  const last = profile.value?.lastGameDate?.slice(0, 4)
  if (!first || !last) return []
  const a = Number(first)
  const b = Number(last)
  const out: number[] = []
  for (let y = b; y >= a; y--) out.push(y)
  return out
})

const tier = computed(() => statsResult.value?.access.tier ?? 'free')
const isPro = computed(() => tier.value === 'pro')
const stats = computed(() => statsResult.value?.stats ?? null)

const primaryTeam = computed(() => profile.value?.teams?.[0] ?? null)

async function loadProfile() {
  if (!playerId.value) {
    notFound.value = true
    loading.value = false
    return
  }
  try {
    profile.value = await fetchPlayerProfile(playerId.value, previewPro.value)
    notFound.value = false
  } catch {
    notFound.value = true
  }
}

async function loadScopeData() {
  const pid = playerId.value
  if (!pid) return
  const season = scope.value === 'career' ? undefined : scope.value
  const scopeName = scope.value === 'career' ? 'career' : 'season'
  try {
    statsResult.value = await fetchPlayerStats(pid, { scope: scopeName, season, previewPro: previewPro.value })
    gameLog.value = await fetchPlayerGameLog(pid, { season, perPage: 50, previewPro: previewPro.value })
    if (primaryTeam.value) {
      leaderboard.value = await fetchLeaderboard({
        stat: 'avg',
        scope: `team:${primaryTeam.value.id}`,
        season,
        previewPro: previewPro.value
      })
    }
  } catch (e) {
    pushToast({ tone: 'warning', title: 'Could not load stats', message: e instanceof Error ? e.message : 'Try again.' })
  }
}

async function loadSplits() {
  const pid = playerId.value
  if (!pid) return
  try {
    splits.value = await fetchPlayerSplits(pid, previewPro.value)
  } catch {
    splits.value = null // 403 for free viewers — the panel renders its locked state
  }
}

async function loadAll() {
  loading.value = true
  await loadProfile()
  if (!notFound.value) {
    await Promise.all([loadScopeData(), loadSplits()])
  }
  loading.value = false
}

function goPro() {
  if (isDev) {
    previewPro.value = true
    return
  }
  // Route to the shared Go Pro upgrade page (Stripe pricing table).
  router.push('/go-pro')
}

onMounted(loadAll)
watch(previewPro, loadAll)
watch(playerId, loadAll)
watch(scope, loadScopeData)

// Locked helpers (a value is locked when the API nulled it).
const slashLocked = computed(() => !!stats.value && stats.value.obp === null)
const battingLocked = computed(() => !!stats.value && stats.value.atBats === null)
const splitsLocked = computed(() => !isPro.value)
const gameLogTailLocked = computed(() => (gameLog.value?.access.lockedMetrics ?? []).includes('gameLogHistory'))

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'P'
}
function fmtDate(d: string): string {
  if (!d) return ''
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  const dt = y && m && day ? new Date(y, m - 1, day) : null
  return dt ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : d
}
function scopeLabel(): string {
  return scope.value === 'career' ? 'Career' : String(scope.value)
}
</script>

<template>
  <section class="pp">
    <!-- DEV: Free ⇄ Pro preview toggle -->
    <div v-if="isDev" class="pp-demobar">
      <span>Preview</span>
      <div class="pp-seg">
        <button :class="{ on: !previewPro }" @click="previewPro = false">Free view</button>
        <button :class="{ on: previewPro }" @click="previewPro = true">Player Pro ✦</button>
      </div>
    </div>

    <div v-if="loading" class="pp-loading">
      <span class="pp-spin" aria-hidden="true"></span> Loading passport…
    </div>

    <div v-else-if="notFound" class="pp-empty">
      <p class="pp-empty__t">No passport yet</p>
      <p class="pp-empty__d">This player has no verified game data yet. Stats appear once an association scorer logs their at-bats.</p>
    </div>

    <template v-else-if="profile">
      <!-- HERO -->
      <div class="pp-hero">
        <div class="pp-hero__glow" aria-hidden="true"></div>
        <div class="pp-hero__row">
          <TeamAvatar :name="profile.name" :image-url="profile.avatarUrl" size="lg" />
          <div class="pp-hero__id">
            <h1 class="pp-hero__name">
              {{ profile.name }}
              <span v-if="isPro" class="pp-ribbon">PLAYER PRO</span>
            </h1>
            <div class="pp-chips">
              <span v-if="profile.primaryPosition" class="pp-chip">{{ profile.primaryPosition }}</span>
              <span v-for="t in profile.teams" :key="t.id" class="pp-chip">{{ t.name }}</span>
              <span v-if="primaryTeam?.ageGroup" class="pp-chip">{{ primaryTeam.ageGroup }}</span>
              <span v-if="primaryTeam?.sportType" class="pp-chip">{{ primaryTeam.sportType }}</span>
            </div>
            <div class="pp-verified">✔ Verified stats — entered by the association scorer</div>
            <div class="pp-since">
              {{ profile.headline.seasonsPlayed }} season{{ profile.headline.seasonsPlayed === 1 ? '' : 's' }} ·
              {{ profile.headline.careerGames }} career games
              <template v-if="profile.firstGameDate"> · since {{ fmtDate(profile.firstGameDate) }}</template>
            </div>
          </div>
        </div>
      </div>

      <!-- Upsell (free only) -->
      <div v-if="!isPro" class="pp-upsell">
        <div>
          <p class="pp-upsell__h">Unlock your full Player Passport</p>
          <p class="pp-upsell__p">Career totals, OBP / SLG / OPS, every game you've played, season-by-season splits, and a shareable card.</p>
        </div>
        <div class="pp-upsell__cta">
          <div class="pp-price">$29<small>/yr</small></div>
          <button class="pp-btn-pro" @click="goPro">Go Player Pro ✦</button>
        </div>
      </div>

      <!-- Scope tabs -->
      <div class="pp-scopes">
        <button :class="{ on: scope === 'career' }" @click="scope = 'career'">Career</button>
        <button v-for="y in seasons" :key="y" :class="{ on: scope === y }" @click="scope = y">{{ y }}</button>
      </div>

      <!-- Headline cards -->
      <div v-if="stats" class="pp-cards">
        <div class="pp-stat pp-stat--hero"><div class="v">{{ stats.avg ?? '—' }}</div><div class="l">AVG</div></div>
        <div class="pp-stat"><div class="v">{{ stats.homeRuns ?? '—' }}</div><div class="l">HR</div></div>
        <div class="pp-stat"><div class="v">{{ stats.rbi ?? '—' }}</div><div class="l">RBI</div></div>
        <div class="pp-stat"><div class="v">{{ stats.hits ?? '—' }}</div><div class="l">Hits</div></div>
        <div class="pp-stat"><div class="v">{{ stats.games ?? '—' }}</div><div class="l">Games</div></div>
      </div>

      <!-- Slash line -->
      <div class="pp-panel">
        <h2 class="pp-panel__h">Slash line <span class="pp-panel__scope">· {{ scopeLabel() }}</span></h2>
        <div class="pp-lockwrap" :class="{ locked: slashLocked }">
          <div class="pp-slash">
            <div class="cell"><div class="v">{{ stats?.avg ?? '.???' }}</div><div class="l">AVG</div></div>
            <div class="cell"><div class="v">{{ stats?.obp ?? '.???' }}</div><div class="l">OBP</div></div>
            <div class="cell"><div class="v">{{ stats?.slg ?? '.???' }}</div><div class="l">SLG</div></div>
            <div class="cell ops"><div class="v">{{ stats?.ops ?? '.???' }}</div><div class="l">OPS</div></div>
          </div>
          <div v-if="slashLocked" class="pp-lockcover">
            <div class="ico">🔒</div>
            <div class="t">Advanced metrics are a Pro feature</div>
            <div class="d">OBP, SLG and OPS tell the real story of a hitter.</div>
            <button class="pp-btn-pro" @click="goPro">Unlock with Player Pro ✦</button>
          </div>
        </div>
      </div>

      <!-- Full batting line -->
      <div class="pp-panel">
        <h2 class="pp-panel__h">Full batting line</h2>
        <div class="pp-lockwrap" :class="{ locked: battingLocked }">
          <div class="pp-grid9">
            <div class="c"><div class="v">{{ stats?.plateAppearances ?? '—' }}</div><div class="l">PA</div></div>
            <div class="c"><div class="v">{{ stats?.atBats ?? '—' }}</div><div class="l">AB</div></div>
            <div class="c"><div class="v">{{ stats?.runs ?? '—' }}</div><div class="l">R</div></div>
            <div class="c"><div class="v">{{ stats?.hits ?? '—' }}</div><div class="l">H</div></div>
            <div class="c"><div class="v">{{ stats?.doubles ?? '—' }}</div><div class="l">2B</div></div>
            <div class="c"><div class="v">{{ stats?.triples ?? '—' }}</div><div class="l">3B</div></div>
            <div class="c"><div class="v">{{ stats?.walks ?? '—' }}</div><div class="l">BB</div></div>
            <div class="c"><div class="v">{{ stats?.strikeouts ?? '—' }}</div><div class="l">K</div></div>
            <div class="c"><div class="v">{{ stats?.totalBases ?? '—' }}</div><div class="l">TB</div></div>
          </div>
          <div v-if="battingLocked" class="pp-lockcover">
            <div class="ico">🔒</div>
            <div class="t">Full batting line is a Pro feature</div>
            <div class="d">Every plate appearance, broken down.</div>
            <button class="pp-btn-pro" @click="goPro">Unlock with Player Pro ✦</button>
          </div>
        </div>
      </div>

      <!-- Game log -->
      <div class="pp-panel">
        <h2 class="pp-panel__h">
          Game log
          <span v-if="gameLog" class="pp-panel__scope">· {{ isPro ? gameLog.total + ' games' : 'showing ' + gameLog.rows.length + ' of ' + gameLog.total }}</span>
        </h2>
        <div class="pp-tablewrap">
          <table class="pp-table">
            <thead>
              <tr><th class="left">Date</th><th class="left">Opponent</th><th>Result</th><th>AB</th><th>R</th><th>H</th><th>RBI</th><th>HR</th><th>BB</th><th>K</th><th>AVG</th></tr>
            </thead>
            <tbody>
              <tr v-for="g in gameLog?.rows ?? []" :key="g.gameId">
                <td class="left">{{ fmtDate(g.date) }}</td>
                <td class="left">{{ g.opponent.name ?? '—' }}</td>
                <td><span class="pp-res" :class="g.result">{{ g.result }}<template v-if="g.teamScore != null"> {{ g.teamScore }}-{{ g.opponentScore }}</template></span></td>
                <td>{{ g.line.ab }}</td><td>{{ g.line.r }}</td><td>{{ g.line.h }}</td><td>{{ g.line.rbi }}</td>
                <td><span v-if="g.line.hr" class="pp-hrbadge">{{ g.line.hr }}</span><span v-else>0</span></td>
                <td>{{ g.line.bb }}</td><td>{{ g.line.k }}</td><td><b>{{ g.line.avg }}</b></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="gameLogTailLocked" class="pp-loglock">
          <button class="pp-btn-pro" @click="goPro">See all {{ gameLog?.total }} games ✦</button>
        </div>
      </div>

      <!-- Season splits -->
      <div class="pp-panel">
        <h2 class="pp-panel__h">Season splits</h2>
        <div class="pp-lockwrap" :class="{ locked: splitsLocked }">
          <div class="pp-tablewrap">
            <table class="pp-table">
              <thead>
                <tr><th class="left">Season</th><th>G</th><th>AVG</th><th>OBP</th><th>SLG</th><th>OPS</th><th>H</th><th>HR</th><th>RBI</th></tr>
              </thead>
              <tbody>
                <tr v-for="s in (splitsLocked ? [{ season: 2026, games: 8, avg: '.###', obp: '.###', slg: '.###', ops: '.###', hits: 0, homeRuns: 0, rbi: 0 }] : splits?.splits ?? [])" :key="s.season">
                  <td class="left"><b>{{ s.season }}</b></td>
                  <td>{{ s.games }}</td><td><b>{{ s.avg }}</b></td><td>{{ s.obp }}</td><td>{{ s.slg }}</td><td>{{ s.ops }}</td>
                  <td>{{ s.hits }}</td><td>{{ s.homeRuns }}</td><td>{{ s.rbi }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="splitsLocked" class="pp-lockcover">
            <div class="ico">🔒</div>
            <div class="t">Season-by-season splits are a Pro feature</div>
            <div class="d">Track how you improve year over year.</div>
            <button class="pp-btn-pro" @click="goPro">Unlock with Player Pro ✦</button>
          </div>
        </div>
      </div>

      <!-- Leaderboard -->
      <div v-if="leaderboard && leaderboard.rows.length" class="pp-panel">
        <h2 class="pp-panel__h">
          🏆 Team leaderboard · Batting AVG <span class="pp-panel__scope">· {{ scopeLabel() }}</span>
        </h2>
        <div class="pp-lb">
          <div
            v-for="r in leaderboard.rows"
            :key="r.player.id"
            class="pp-lb__row"
            :class="{ me: leaderboard.viewerRank && r.player.id === playerId }"
          >
            <div class="pp-lb__rank">{{ r.rank }}</div>
            <div class="pp-lb__av">{{ initials(r.player.name) }}</div>
            <div class="pp-lb__name">{{ r.player.name }}</div>
            <div class="pp-lb__team">{{ r.team.name }}</div>
            <div class="pp-lb__val">{{ r.value }}</div>
          </div>
        </div>
        <div v-if="(leaderboard.access.lockedMetrics ?? []).includes('leaderboardTail')" class="pp-loglock">
          <button class="pp-btn-pro" @click="goPro">See full leaderboard ✦</button>
        </div>
      </div>

      <p class="pp-foot">Verified stats computed from the association scoring ledger.</p>
    </template>
  </section>
</template>

<style scoped>
.pp { max-width: 920px; margin: 0 auto; padding: 8px 4px 60px; }

/* dev preview bar */
.pp-demobar { display: flex; align-items: center; gap: 12px; justify-content: flex-end; margin-bottom: 14px; color: var(--text-light); font-size: 0.78rem; }
.pp-seg { display: inline-flex; background: var(--surface-pill); border-radius: 999px; padding: 3px; }
.pp-seg button { appearance: none; border: 0; background: transparent; color: var(--text-light); font: inherit; font-size: 0.8rem; font-weight: 600; padding: 6px 15px; border-radius: 999px; cursor: pointer; }
.pp-seg button.on { background: var(--primary); color: #fff; }

.pp-loading, .pp-empty { text-align: center; padding: 60px 20px; color: var(--text-light); }
.pp-spin { display: inline-block; width: 16px; height: 16px; border: 2px solid var(--border-divider); border-top-color: var(--primary); border-radius: 50%; animation: pp-spin 0.7s linear infinite; vertical-align: -3px; margin-right: 6px; }
@keyframes pp-spin { to { transform: rotate(360deg); } }
.pp-empty__t { font-size: 1.1rem; font-weight: 600; color: var(--text); margin-bottom: 6px; }
.pp-empty__d { max-width: 420px; margin: 0 auto; }

/* hero */
.pp-hero { position: relative; overflow: hidden; border-radius: 18px; padding: 22px; margin-bottom: 16px; color: #fff;
  background: radial-gradient(120% 160% at 100% 0%, #3a9bff 0%, transparent 55%), linear-gradient(135deg, #123a6b, #0d1b2a); }
.pp-hero__glow { position: absolute; top: -60%; right: -10%; width: 55%; height: 220%; transform: rotate(8deg);
  background: linear-gradient(115deg, transparent, rgba(255,255,255,.12), transparent); animation: pp-sheen 6s ease-in-out infinite; pointer-events: none; }
@keyframes pp-sheen { 0%,100% { opacity: 0; transform: translateX(20%) rotate(8deg); } 50% { opacity: 1; transform: translateX(-10%) rotate(8deg); } }
.pp-hero__row { display: flex; gap: 18px; align-items: center; }
.pp-hero__row :deep(.team-avatar-mark) { width: 84px; height: 84px; font-size: 1.9rem; box-shadow: 0 0 0 4px rgba(255,255,255,.15); }
.pp-hero__name { font-size: 1.55rem; font-weight: 700; margin: 0; letter-spacing: -.01em; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.pp-ribbon { background: linear-gradient(135deg,#f7c948,#f0a500); color: #3a2a00; font-weight: 700; font-size: .62rem; letter-spacing: .06em; padding: 3px 9px; border-radius: 6px; }
.pp-chips { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
.pp-chip { background: rgba(255,255,255,.14); border: 1px solid rgba(255,255,255,.16); border-radius: 999px; padding: 3px 11px; font-size: .74rem; font-weight: 500; color: #eaf2ff; }
.pp-verified { color: #8fe3b0; font-size: .72rem; font-weight: 600; margin-top: 9px; }
.pp-since { color: #9fb2c8; font-size: .74rem; margin-top: 6px; }

/* upsell */
.pp-upsell { background: linear-gradient(135deg,#123a6b,#0d1b2a); color: #fff; border-radius: 16px; padding: 18px 20px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.pp-upsell__h { font-size: 1.05rem; font-weight: 700; margin: 0 0 4px; }
.pp-upsell__p { color: #9fb2c8; font-size: .8rem; margin: 0; max-width: 440px; }
.pp-upsell__cta { text-align: center; }
.pp-price { font-size: 1.4rem; font-weight: 800; }
.pp-price small { font-size: .7rem; font-weight: 500; color: #9fb2c8; }

/* scope tabs */
.pp-scopes { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.pp-scopes button { appearance: none; border: 1px solid var(--border-divider); background: var(--surface-card); color: var(--text-light); font: inherit; font-size: .82rem; font-weight: 600; padding: 8px 18px; border-radius: 999px; cursor: pointer; transition: .15s; }
.pp-scopes button.on { background: var(--primary); border-color: var(--primary); color: #fff; }

/* headline cards */
.pp-cards { display: grid; grid-template-columns: repeat(5,1fr); gap: 12px; margin-bottom: 16px; }
.pp-stat { background: var(--surface-card); border: 1px solid var(--border-divider); border-radius: 14px; padding: 14px; text-align: center; box-shadow: var(--shadow-soft); }
.pp-stat .v { font-size: 1.6rem; font-weight: 700; letter-spacing: -.02em; line-height: 1; color: var(--text); }
.pp-stat .l { font-size: .66rem; color: var(--text-light); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-top: 6px; }
.pp-stat--hero .v { color: var(--primary); }

/* panels */
.pp-panel { background: var(--surface-card); border: 1px solid var(--border-divider); border-radius: 16px; padding: 18px; margin-bottom: 16px; box-shadow: var(--shadow-soft); }
.pp-panel__h { font-size: .82rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text-light); margin: 0 0 14px; font-weight: 700; }
.pp-panel__scope { color: var(--primary); }

.pp-slash { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
.pp-slash .cell { text-align: center; padding: 10px; border-radius: 12px; background: var(--surface-pill); }
.pp-slash .cell .v { font-size: 1.45rem; font-weight: 700; letter-spacing: -.01em; color: var(--text); }
.pp-slash .cell .l { font-size: .64rem; color: var(--text-light); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-top: 3px; }
.pp-slash .cell.ops { background: var(--primary-light-3); }
.pp-slash .cell.ops .v { color: var(--primary); }

.pp-grid9 { display: grid; grid-template-columns: repeat(9,1fr); gap: 8px; }
.pp-grid9 .c { text-align: center; padding: 9px 4px; border-radius: 9px; background: var(--surface-pill); }
.pp-grid9 .c .v { font-size: 1.02rem; font-weight: 700; color: var(--text); }
.pp-grid9 .c .l { font-size: .58rem; color: var(--text-light); font-weight: 600; text-transform: uppercase; margin-top: 2px; }

/* tables */
.pp-tablewrap { overflow-x: auto; }
.pp-table { width: 100%; border-collapse: collapse; font-size: .8rem; min-width: 560px; }
.pp-table th, .pp-table td { padding: 8px 6px; text-align: center; border-bottom: 1px solid var(--border-divider); white-space: nowrap; color: var(--text); }
.pp-table th { font-size: .62rem; text-transform: uppercase; letter-spacing: .04em; color: var(--text-light); font-weight: 700; }
.pp-table .left { text-align: left; }
.pp-res { font-weight: 700; font-size: .7rem; padding: 1px 7px; border-radius: 5px; }
.pp-res.W { background: rgba(40,167,110,.14); color: var(--success, #28a76e); }
.pp-res.L { background: rgba(224,69,79,.14); color: var(--red, #e0454f); }
.pp-res.T { background: var(--surface-pill); color: var(--text-light); }
.pp-hrbadge { display: inline-block; background: #fff3d6; color: #a9761b; font-weight: 700; border-radius: 5px; padding: 0 5px; font-size: .68rem; }

/* leaderboard */
.pp-lb__row { display: flex; align-items: center; gap: 12px; padding: 9px 6px; border-bottom: 1px solid var(--border-divider); }
.pp-lb__row.me { background: var(--primary-light-3); border-radius: 10px; }
.pp-lb__row.me .pp-lb__name { color: var(--primary); font-weight: 700; }
.pp-lb__rank { width: 22px; text-align: center; font-weight: 700; color: var(--text-light); }
.pp-lb__av { width: 30px; height: 30px; border-radius: 50%; background: var(--surface-pill); display: flex; align-items: center; justify-content: center; font-size: .72rem; font-weight: 700; color: var(--text-light); }
.pp-lb__name { flex: 1; font-weight: 500; font-size: .86rem; color: var(--text); }
.pp-lb__team { color: var(--text-light); font-size: .72rem; }
.pp-lb__val { font-weight: 700; font-size: .95rem; color: var(--text); }

/* lock overlay */
.pp-lockwrap { position: relative; }
.pp-lockwrap.locked > *:not(.pp-lockcover) { filter: blur(6px); opacity: .55; pointer-events: none; user-select: none; }
.pp-lockcover { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; text-align: center; padding: 12px; }
.pp-lockcover .ico { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg,#f7c948,#f0a500); display: flex; align-items: center; justify-content: center; }
.pp-lockcover .t { font-weight: 700; font-size: .9rem; color: var(--text); }
.pp-lockcover .d { font-size: .76rem; color: var(--text-light); max-width: 320px; }
.pp-loglock { text-align: center; padding: 12px 0 2px; }

.pp-btn-pro { appearance: none; border: 0; border-radius: 999px; padding: 9px 20px; font: inherit; font-weight: 700; font-size: .82rem; background: linear-gradient(135deg,#f7c948,#f0a500); color: #3a2a00; cursor: pointer; }
.pp-foot { text-align: center; font-size: .72rem; color: var(--text-light); margin-top: 8px; }

@media (max-width: 700px) {
  .pp-cards { grid-template-columns: repeat(3,1fr); }
  .pp-grid9 { grid-template-columns: repeat(5,1fr); }
  .pp-slash { grid-template-columns: repeat(2,1fr); }
}

@media (max-width: 520px) {
  .pp {
    padding: 8px 10px calc(32px + var(--member-bottom-nav-height, 64px));
  }

  .pp-demobar {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .pp-hero {
    border-radius: 12px;
    padding: 18px;
  }

  .pp-hero__row {
    align-items: flex-start;
  }

  .pp-hero__row :deep(.team-avatar-mark) {
    width: 64px;
    height: 64px;
    font-size: 1.45rem;
  }

  .pp-hero__name {
    font-size: 1.25rem;
  }

  .pp-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .pp-panel {
    padding: 14px;
    border-radius: 12px;
  }

  .pp-grid9 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
