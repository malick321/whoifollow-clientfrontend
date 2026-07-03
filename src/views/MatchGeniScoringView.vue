<script setup lang="ts">
// MatchGeniScoringView
// --------------------
// Scoring entry surface for users with `manage_scoring`. Left
// pane = vertical game list, date-grouped with sticky headers
// (reuses `MatchGeniGameListPanel`). Right pane = placeholder
// today; the existing per-game `ScoresheetView` route handles
// the actual scoresheet so we don't embed `ScoresheetGrid` here.
//
// Game list source: the matchgeni scheduler payload (same
// `/scheduler` endpoint, mocked in v1). Reusing it keeps a
// single source of truth for the event's games + lets the
// scoring screen evolve independently of any future "live
// games" aggregate without touching the dashboard payload.

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MatchGeniGameListPanel from '../components/MatchGeniGameListPanel.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import { fetchMatchGeniScheduler } from '../api/matchGeniScheduler'
import { fetchEventResources } from '../api/events'
import { currentAssociation } from '../constants/associations'
import { ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import type {
  Division,
  MatchGeniSchedulerPayload,
  Park,
  SchedulerGame
} from '../types'

/** Filter modes on the scoring page's left-pane toolbar. The
 *  scorekeeper ALWAYS scores against a single park OR a single
 *  division — there's no "all games" mode by design: events can
 *  carry hundreds of games and surfacing the full set as a flat
 *  list defeats the purpose of the per-event filter.
 *
 *  Tab visibility is gated by the user's `scoringScope.mode`:
 *    - FC / scope=all     → both tabs (default: parks)
 *    - scope.mode=parks   → only the parks tab
 *    - scope.mode=divisions → only the divisions tab */
type ScoringFilterMode = 'parks' | 'divisions'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() =>
  (route.params.eventId as string | undefined) ?? ''
)

const loading = ref(true)
const errorMessage = ref<string | null>(null)
const payload = ref<MatchGeniSchedulerPayload | null>(null)
const selectedGameId = ref<string | null>(null)

const allGames = computed<SchedulerGame[]>(() =>
  payload.value?.games ?? []
)

const selectedGame = computed<SchedulerGame | null>(() =>
  allGames.value.find((g) => g.id === selectedGameId.value) ?? null
)

// ── Park + division catalogues from the §9 Event Resources API
// Fetched separately from the scheduler payload so the catalogue
// stays canonical (the §9 endpoint is the documented source of
// truth for an event's parks + divisions). The scheduler payload
// is consumed only for the game list itself — backend will
// eventually expose a `games?parkId=...` / `games?divisionId=...`
// endpoint so we can fetch the LIMITED game subset based on the
// scorekeeper's current selection instead of every game on the
// event. v1 mock returns all games via the scheduler payload;
// frontend filtering bridges the gap for now.
const catalogueParks = ref<Park[]>([])
const catalogueDivisions = ref<Division[]>([])

const eventParks = computed<Park[]>(() =>
  [...catalogueParks.value].sort((a, b) => a.name.localeCompare(b.name))
)
const eventDivisions = computed<Division[]>(() =>
  [...catalogueDivisions.value].sort((a, b) => a.name.localeCompare(b.name))
)

/** Lookup: divisionId → division name. Used by the game-row card
 *  to render the division header above the game label. Built off
 *  the unfiltered catalogue (NOT `filterableDivisions`) so that a
 *  user with a parks-only scope still sees a division name on
 *  cards that happen to come from divisions they don't filter by. */
const divisionNameById = computed<Map<string, string>>(() => {
  const map = new Map<string, string>()
  for (const d of catalogueDivisions.value) map.set(d.id, d.name)
  return map
})

// ── Permission scope helpers ──────────────────────────────────
// `scoringScope` decides which games the caller is ALLOWED to
// see / score. The user-controlled filter (`filterMode` below)
// narrows within that permitted set — it can't escape it.

/** Park ids the caller is permitted to score against, or `null`
 *  when there's no restriction (FC / mode='all' / mode='divisions'). */
const permittedParkIds = computed<Set<string> | null>(() => {
  const access = matchGeniContext.value?.access
  if (!access || access.fullControl) return null
  const scope = access.scoringScope
  if (!scope || scope.mode !== 'parks') return null
  return new Set(scope.parkIds)
})

/** Division ids the caller is permitted to score against, or
 *  `null` when there's no restriction. */
const permittedDivisionIds = computed<Set<string> | null>(() => {
  const access = matchGeniContext.value?.access
  if (!access || access.fullControl) return null
  const scope = access.scoringScope
  if (!scope || scope.mode !== 'divisions') return null
  return new Set(scope.divisionIds)
})

/** Which filter tabs to show in the toolbar. The "All games" tab
 *  was removed by design — see the type comment above. A
 *  parks-scoped user only sees "By park"; a divisions-scoped
 *  user only sees "By division"; FC / scope=all sees both. */
const availableFilterModes = computed<ScoringFilterMode[]>(() => {
  const access = matchGeniContext.value?.access
  if (!access || access.fullControl) return ['parks', 'divisions']
  const scope = access.scoringScope
  if (!scope || scope.mode === 'all') return ['parks', 'divisions']
  if (scope.mode === 'parks') return ['parks']
  if (scope.mode === 'divisions') return ['divisions']
  return []
})

// ── Filter state ──────────────────────────────────────────────
// Single-select per tab. The scorekeeper picks ONE park OR ONE
// division at a time so the backend only needs to surface that
// subset's games — supports events with hundreds of games
// without forcing a full-event payload onto the wire. Persisted
// per-event via localStorage; key:
// `matchgeni-scoring-filter-{eventId}`.
const filterMode = ref<ScoringFilterMode>('parks')
const selectedParkId = ref<string | null>(null)
const selectedDivisionId = ref<string | null>(null)

function storageKey(): string | null {
  if (!eventId.value) return null
  return `matchgeni-scoring-filter-${eventId.value}`
}

interface PersistedFilter {
  mode: ScoringFilterMode
  parkId: string | null
  divisionId: string | null
}

function loadPersistedFilter(): PersistedFilter | null {
  const key = storageKey()
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedFilter>
    if (parsed && (parsed.mode === 'parks' || parsed.mode === 'divisions')) {
      return {
        mode: parsed.mode,
        parkId: typeof parsed.parkId === 'string' ? parsed.parkId : null,
        divisionId: typeof parsed.divisionId === 'string' ? parsed.divisionId : null
      }
    }
  } catch {
    // Corrupt JSON or storage disabled — drop through to default.
  }
  return null
}

function persistFilter() {
  const key = storageKey()
  if (!key) return
  try {
    const payload: PersistedFilter = {
      mode: filterMode.value,
      parkId: selectedParkId.value,
      divisionId: selectedDivisionId.value
    }
    localStorage.setItem(key, JSON.stringify(payload))
  } catch {
    // Storage disabled / quota exceeded — silently drop.
  }
}

/** Seed the filter state on first load. Order of preference:
 *    1. Persisted value (last session's choice) — validated
 *       against the currently-allowed modes + the available
 *       catalogue (a persisted park id no longer in the catalogue
 *       falls through to the default).
 *    2. Otherwise pick the first allowed mode + its first
 *       catalogue item. By auto-selecting the first item we
 *       keep the backend request shape consistent ("give me
 *       games for park X") instead of ever asking for the full
 *       event-wide set. */
function seedFilterFromAccess() {
  const allowedModes = new Set(availableFilterModes.value)
  const persisted = loadPersistedFilter()
  if (persisted && allowedModes.has(persisted.mode)) {
    const stillValid =
      persisted.mode === 'parks'
        ? persisted.parkId !== null
          && filterableParks.value.some((p) => p.id === persisted.parkId)
        : persisted.divisionId !== null
          && filterableDivisions.value.some((d) => d.id === persisted.divisionId)
    if (stillValid) {
      filterMode.value = persisted.mode
      selectedParkId.value = persisted.parkId
      selectedDivisionId.value = persisted.divisionId
      return
    }
  }

  // No usable persisted state — default to the first allowed
  // mode's first catalogue item.
  if (allowedModes.has('parks') && filterableParks.value.length > 0) {
    filterMode.value = 'parks'
    selectedParkId.value = filterableParks.value[0].id
    selectedDivisionId.value = null
    persistFilter()
    return
  }
  if (allowedModes.has('divisions') && filterableDivisions.value.length > 0) {
    filterMode.value = 'divisions'
    selectedDivisionId.value = filterableDivisions.value[0].id
    selectedParkId.value = null
    persistFilter()
    return
  }
  // No allowed mode + catalogue combo — leave state empty; the
  // template will render the "no games match" empty state.
  selectedParkId.value = null
  selectedDivisionId.value = null
}

function onModeChange(next: ScoringFilterMode) {
  if (!availableFilterModes.value.includes(next)) return
  filterMode.value = next
  // Auto-pick the first catalogue item in the new tab if nothing
  // is selected yet — keeps the page in "show me one subset"
  // mode rather than dropping the user onto a blank list with a
  // dropdown they have to discover.
  if (next === 'parks' && !selectedParkId.value && filterableParks.value.length > 0) {
    selectedParkId.value = filterableParks.value[0].id
  } else if (next === 'divisions' && !selectedDivisionId.value && filterableDivisions.value.length > 0) {
    selectedDivisionId.value = filterableDivisions.value[0].id
  }
  persistFilter()
}

// ── Visible games — single-select filter applied ──────────────
// The user picks ONE park OR ONE division — never both, never all.
// Backend would eventually surface a "games by park" /
// "games by division" endpoint so only the matching subset comes
// over the wire; until then we filter the scheduler payload's
// games array on the frontend. When nothing is selected (edge
// case — empty catalogue), the visible list is empty.
const visibleGames = computed<SchedulerGame[]>(() => {
  const games = allGames.value
  if (filterMode.value === 'parks' && selectedParkId.value) {
    const pick = selectedParkId.value
    return games.filter((g) => g.parkId === pick)
  }
  if (filterMode.value === 'divisions' && selectedDivisionId.value) {
    const pick = selectedDivisionId.value
    return games.filter((g) => g.divisionId === pick)
  }
  return []
})

/** Park options shown in the parks dropdown — restricted to the
 *  caller's permission scope when applicable. FC / scope=all
 *  callers see the full catalogue; a parks-scoped caller sees
 *  only their permitted parks. */
const filterableParks = computed<Park[]>(() => {
  if (permittedParkIds.value) {
    const allowed = permittedParkIds.value
    return eventParks.value.filter((p) => allowed.has(p.id))
  }
  return eventParks.value
})

/** Division options shown in the divisions dropdown — same
 *  permission-scope narrowing as `filterableParks` above. */
const filterableDivisions = computed<Division[]>(() => {
  if (permittedDivisionIds.value) {
    const allowed = permittedDivisionIds.value
    return eventDivisions.value.filter((d) => allowed.has(d.id))
  }
  return eventDivisions.value
})

const filterModeLabel: Record<ScoringFilterMode, string> = {
  parks: 'By park',
  divisions: 'By division'
}

// ── Bridge ID ↔ label for MultiSelectDropdown (single mode) ───
// `MultiSelectDropdown` works in display-label strings. In
// `single` mode it carries the current selection as a 1-element
// array (`[label]`) or empty (`[]`). The bridges below convert
// between the canonical id refs and that label-array shape +
// trigger persistence on writes.

const parkLabelOptions = computed<string[]>(() =>
  filterableParks.value.map((p) => p.name)
)
const divisionLabelOptions = computed<string[]>(() =>
  filterableDivisions.value.map((d) => d.name)
)

const selectedParkLabels = computed<string[]>({
  get: () => {
    const match = filterableParks.value.find((p) => p.id === selectedParkId.value)
    return match ? [match.name] : []
  },
  set: (labels: string[]) => {
    // `single` mode emits a 1-element array or empty.
    const label = labels[0] ?? null
    const match = label
      ? filterableParks.value.find((p) => p.name === label)
      : null
    selectedParkId.value = match?.id ?? null
    persistFilter()
  }
})

const selectedDivisionLabels = computed<string[]>({
  get: () => {
    const match = filterableDivisions.value.find((d) => d.id === selectedDivisionId.value)
    return match ? [match.name] : []
  },
  set: (labels: string[]) => {
    const label = labels[0] ?? null
    const match = label
      ? filterableDivisions.value.find((d) => d.name === label)
      : null
    selectedDivisionId.value = match?.id ?? null
    persistFilter()
  }
})

/** Format a `YYYY-MM-DD` ISO date as "Tue, Feb 10, 2026" for the
 *  selected-game detail block on the right pane. Same `T00:00:00`
 *  local-time parse pattern the scheduler view uses. */
function formatGameDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

async function load() {
  loading.value = true
  errorMessage.value = null
  try {
    // Run the access gate first — the resources + scheduler
    // fetches don't matter if the user can't be on this page.
    // The shared `ensureMatchGeniAccess` helper handles 403 /
    // 404 / 409 redirects to not-found, so a denied caller
    // never lands here with stale data.
    const accessOk = await ensureMatchGeniAccess(
      router,
      currentAssociation.value?.id ?? '',
      eventId.value,
      associationShortName.value,
      'manage_scoring',
      'Game Scoring'
    )
    if (!accessOk) return

    // Resources (parks + divisions catalogue) come from the §9
    // endpoint. Games come from the scheduler payload for v1;
    // backend will eventually serve `/games?parkId=…` /
    // `/games?divisionId=…` so only the selection's games come
    // over the wire. Both fetched in parallel.
    //
    // The resources fetch is wrapped in its own try/catch so a
    // not-yet-shipped backend (or transient 5xx) falls back to
    // the scheduler payload's `parks` / `divisions` arrays —
    // both shapes are `{ id, name }` so the catalogue is
    // structurally interchangeable for v1. Once §9 ships, the
    // fallback path stays dead but harmless.
    const associationId = currentAssociation.value?.id ?? ''
    const resourcesPromise = fetchEventResources(associationId, eventId.value, ['parks', 'divisions'])
      .catch((err) => {
        if (typeof console !== 'undefined') {
          // eslint-disable-next-line no-console
          console.warn('[scoring] fetchEventResources failed; falling back to scheduler payload.', err)
        }
        return {} as { parks?: Park[]; divisions?: Division[] }
      })
    const [resources, schedulerPayload] = await Promise.all([
      resourcesPromise,
      fetchMatchGeniScheduler(associationShortName.value, eventId.value)
    ])
    payload.value = schedulerPayload
    // Resources catalogue: prefer the §9 endpoint, fall back to
    // the scheduler payload's parks/divisions arrays when the
    // resources call returned no data (backend not ready or
    // empty response).
    catalogueParks.value =
      resources.parks && resources.parks.length > 0
        ? resources.parks
        : schedulerPayload.parks.map((p) => ({ id: p.id, name: p.name }))
    catalogueDivisions.value =
      resources.divisions && resources.divisions.length > 0
        ? resources.divisions
        : schedulerPayload.divisions.map((d) => ({ id: d.id, name: d.name }))

    // Seed the filter state once both catalogue + access context
    // are settled. The seed function consults persisted state
    // first, then falls back to the first allowed mode's first
    // catalogue item. See `seedFilterFromAccess` for the full
    // precedence chain.
    seedFilterFromAccess()
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Scoring load failed:', err)
    errorMessage.value = err instanceof Error ? err.message : 'Could not load the scorebook.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([associationShortName, eventId], load)

function onSelectGame(gameId: string) {
  selectedGameId.value = gameId
}
</script>

<template>
  <main class="matchgeni">
    <MatchGeniHeader
      variant="sub-page"
      title="Game Scoring"
      :subtitle="matchGeniContext?.event.eventName ?? ''"
      :event-id="eventId"
      :loading="loading"
    />

    <!-- Loading skeleton — mirrors the real two-pane layout so
         the page doesn't jump when the fetches resolve. Left
         pane gets the toolbar (mode tabs + dropdown) + a
         date-grouped shimmer list; right pane gets the empty-
         state-sized centered shimmer block. -->
    <div v-if="loading" class="scoring scoring--loading" aria-busy="true">
      <section class="scoring__source">
        <div class="scoring__toolbar">
          <div class="scoring__mode-tabs">
            <div class="shimmer-block scoring__skeleton-tab"></div>
            <div class="shimmer-block scoring__skeleton-tab"></div>
          </div>
          <div class="scoring__picker">
            <div class="shimmer-block scoring__skeleton-picker"></div>
          </div>
        </div>
        <div class="scoring__skeleton-list">
          <div class="shimmer-block scoring__skeleton-date-header"></div>
          <div
            v-for="n in 4"
            :key="`card-${n}`"
            class="shimmer-block scoring__skeleton-card"
          ></div>
          <div class="shimmer-block scoring__skeleton-date-header"></div>
          <div
            v-for="n in 2"
            :key="`card2-${n}`"
            class="shimmer-block scoring__skeleton-card"
          ></div>
        </div>
      </section>
      <section class="scoring__detail">
        <div class="scoring__detail-empty">
          <div class="shimmer-block scoring__skeleton-detail-title"></div>
          <div class="shimmer-block scoring__skeleton-detail-line"></div>
          <div class="shimmer-block scoring__skeleton-detail-line scoring__skeleton-detail-line--short"></div>
        </div>
      </section>
    </div>

    <div v-else-if="errorMessage" class="matchgeni__content">
      <section class="matchgeni-placeholder">
        <h2 class="matchgeni-placeholder__title">Could not load</h2>
        <p class="matchgeni-placeholder__copy">{{ errorMessage }}</p>
        <button type="button" class="primary-button" @click="load">Retry</button>
      </section>
    </div>

    <div v-else class="scoring">
      <!-- LEFT — date-grouped game list. Selection is local
           state for now; future iterations can navigate to the
           per-game scoresheet route from here. -->
      <section class="scoring__source">
        <MatchGeniGameListPanel
          :games="visibleGames"
          group-by="date"
          unscheduled-placement="bottom"
          :selected-game-id="selectedGameId"
          empty-message="No games match the current filter."
        >
          <!-- Scope toolbar — mode tabs + (when relevant) a
               multi-select chip row for park / division picks.
               Mode tabs are gated by `availableFilterModes` so a
               parks-scoped user doesn't see a meaningless
               "Divisions" tab. Selection state persists per-event
               in localStorage via `persistFilter()`. -->
          <template #header-toolbar>
            <!-- Toolbar is a single horizontal row:
                   [ Parks | Divisions ] toggle  ·  [▼ dropdown ]
                 Toggle only renders when BOTH modes are
                 available (FC or scope=all). For a parks- or
                 divisions-scoped user the toggle is hidden and
                 the matching dropdown takes the full toolbar
                 width — they only have one mode to act on, so
                 the toggle would be a useless single-button. -->
            <div class="scoring__toolbar">
              <div
                v-if="availableFilterModes.length > 1"
                class="scoring__mode-toggle"
                role="tablist"
                aria-label="Game filter mode"
              >
                <button
                  v-for="mode in availableFilterModes"
                  :key="mode"
                  type="button"
                  role="tab"
                  class="scoring__mode-toggle-btn"
                  :class="{ 'scoring__mode-toggle-btn--active': filterMode === mode }"
                  :aria-selected="filterMode === mode"
                  @click="onModeChange(mode)"
                >{{ filterModeLabel[mode] }}</button>
              </div>

              <!-- Park / division single-select dropdown. Sits to
                   the right of the toggle on FC / scope=all users;
                   fills the full toolbar width when the toggle is
                   hidden (scope=parks / scope=divisions). The
                   catalogue is already scope-narrowed by
                   `filterableParks` / `filterableDivisions`. -->
              <div
                v-if="filterMode === 'parks' && parkLabelOptions.length > 0"
                class="scoring__picker"
                :class="{ 'scoring__picker--solo': availableFilterModes.length === 1 }"
              >
                <MultiSelectDropdown
                  v-model="selectedParkLabels"
                  :options="parkLabelOptions"
                  placeholder="Pick a park"
                  :searchable="parkLabelOptions.length > 6"
                  :single="true"
                  aria-label="Park filter"
                />
              </div>
              <div
                v-if="filterMode === 'divisions' && divisionLabelOptions.length > 0"
                class="scoring__picker"
                :class="{ 'scoring__picker--solo': availableFilterModes.length === 1 }"
              >
                <MultiSelectDropdown
                  v-model="selectedDivisionLabels"
                  :options="divisionLabelOptions"
                  placeholder="Pick a division"
                  :searchable="divisionLabelOptions.length > 6"
                  :single="true"
                  aria-label="Division filter"
                />
              </div>
            </div>
          </template>

          <template #game-row="{ game, isSelected }">
            <button
              type="button"
              class="scoring__game-row"
              :class="{ 'scoring__game-row--selected': isSelected }"
              @click="onSelectGame(game.id)"
            >
              <span
                v-if="filterMode !== 'divisions' && divisionNameById.get(game.divisionId)"
                class="scoring__game-division"
              >{{ divisionNameById.get(game.divisionId) }}</span>
              <span class="scoring__game-label">{{ game.label }}</span>
              <div class="scoring__game-teams">
                <span v-if="game.team1Label" class="scoring__game-team">{{ game.team1Label }}</span>
                <span v-if="game.team2Label" class="scoring__game-team">{{ game.team2Label }}</span>
              </div>
              <div v-if="game.scheduledTime || game.scheduledFieldLabel" class="scoring__game-meta">
                <span v-if="game.scheduledTime">{{ game.scheduledTime }}</span>
                <span v-if="game.scheduledFieldLabel">· {{ game.scheduledFieldLabel }}</span>
              </div>
            </button>
          </template>
        </MatchGeniGameListPanel>
      </section>

      <!-- RIGHT — selected-game placeholder. Wired-up scoring
           lives at the existing `/event/participation/.../game/...`
           scoresheet route; the dashboard scoring surface keeps a
           lightweight inline preview here until a richer
           inline-scoring flow is designed. -->
      <section class="scoring__detail">
        <div v-if="!selectedGame" class="scoring__detail-empty">
          <h2 class="scoring__detail-title">Pick a game</h2>
          <p class="scoring__detail-copy">
            Select a game from the list on the left to see its
            scoring details. Live games appear under the matching
            date group.
          </p>
        </div>
        <div v-else class="scoring__detail-card">
          <header class="scoring__detail-header">
            <span class="scoring__detail-game-label">{{ selectedGame.label }}</span>
            <span class="scoring__detail-game-date">
              {{ formatGameDate(selectedGame.scheduledDate) }}
              <template v-if="selectedGame.scheduledTime"> · {{ selectedGame.scheduledTime }}</template>
            </span>
          </header>
          <div class="scoring__detail-teams">
            <span v-if="selectedGame.team1Label">{{ selectedGame.team1Label }}</span>
            <span v-if="selectedGame.team2Label">{{ selectedGame.team2Label }}</span>
          </div>
          <div v-if="selectedGame.scheduledFieldLabel" class="scoring__detail-field">
            {{ selectedGame.scheduledFieldLabel }}
          </div>
          <p class="scoring__detail-todo">
            Inning-by-inning scoring + image upload land here in a
            follow-up. The existing per-game scoresheet view is
            still reachable via the participation flow.
          </p>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.scoring {
  display: grid;
  /* Two columns at desktop — narrower fixed game list on the
     left, scoring detail on the right. Mirrors the scheduler's
     `source / grid-shell` proportions so admins switching
     between scheduler + scorebook get a consistent shape. */
  grid-template-columns: 380px minmax(0, 1fr);
  gap: 0;
  padding: 0;
  align-items: start;
}

.scoring__source {
  display: flex;
  flex-direction: column;
  background: var(--white);
  border: 0;
  border-right: 1px solid var(--border-divider);
  border-radius: 0;
  padding: 0;
  min-width: 0;
  /* Sticky-to-viewport sidebar, same pattern the scheduler's
     left column uses so the game list stays anchored while the
     right pane scrolls. `-1px` overlap-guarantee on the top so
     sub-pixel rounding can't leave a hairline gap between the
     matchgeni header above and the sidebar's top edge. */
  position: sticky;
  top: calc(var(--matchgeni-header-height, 56px) - 1px);
  height: calc(100vh - var(--matchgeni-header-height, 56px) + 1px);
  overflow: hidden;
  align-self: start;
  /* Sticky offset for the panel's date headers — no toolbar
     above them in this view. */
  --game-list-sticky-top: 0px;
}

/* Toolbar above the game list — single horizontal row hosting
   the mode toggle on the left + the single-select dropdown on
   the right. Sits inside the `MatchGeniGameListPanel`'s
   `#header-toolbar` slot (outside the scroll container) so it
   doesn't scroll with the cards below. */
.scoring__toolbar {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-divider);
  background: var(--white);
}
html.dark-mode .scoring__toolbar {
  background: var(--surface-card);
}

/* Mode toggle — segmented control. Single pill container with
   two inner buttons; active button gets a primary-tinted fill
   that slides between halves. Only rendered when both modes are
   available (FC / scope=all); scope-restricted callers see
   only their permitted mode's dropdown taking full width. */
.scoring__mode-toggle {
  display: flex;
  align-items: stretch;
  padding: 3px;
  background: #e4ebf5;
  border: 1px solid #c9d4e4;
  border-radius: 999px;
  width: 100%;
}
.scoring__mode-toggle-btn {
  flex: 1 1 0;
  text-align: center;
}
html.dark-mode .scoring__mode-toggle {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}
.scoring__mode-toggle-btn {
  appearance: none;
  background: none;
  border: none;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--secondary);
  cursor: pointer;
  border-radius: 999px;
  transition: background-color 120ms ease, color 120ms ease;
  white-space: nowrap;
}
.scoring__mode-toggle-btn:hover:not(.scoring__mode-toggle-btn--active) {
  color: var(--text);
}
.scoring__mode-toggle-btn--active {
  background: #ffffff;
  color: var(--text);
  font-weight: 600;
  border: 1px solid #b8c4d6;
  box-shadow: 0 1px 3px rgba(13, 30, 58, 0.12);
}
html.dark-mode .scoring__mode-toggle-btn--active {
  background: rgba(45, 140, 240, 0.28);
  color: #ffffff;
  border-color: transparent;
  box-shadow: none;
}

/* Picker container — wraps the `MultiSelectDropdown` so it sits
   to the RIGHT of the toggle on FC users, and fills the FULL
   toolbar width on scope-restricted users (toggle hidden). The
   `--solo` modifier flips the inner dropdown's width from auto
   to 100% so the trigger pill stretches across the row. */
.scoring__picker {
  flex: 1 1 auto;
  min-width: 0;
}
.scoring__picker--solo {
  /* No-op container — the `:deep()` rule below stretches the
     dropdown trigger to fill. */
}
/* Stretch the MultiSelectDropdown's pill trigger so it fills
   the available toolbar width — by default it sizes to its
   content. `:deep()` reaches past the dropdown's scoped style
   hash since it's a child component. */
.scoring__picker :deep(.multi-select) {
  display: block;
  width: 100%;
}
.scoring__picker :deep(.multi-select__trigger) {
  width: 100%;
  justify-content: space-between;
}

.scoring__detail {
  padding: 24px;
  min-width: 0;
}

.scoring__detail-empty {
  padding: 32px 24px;
  text-align: center;
  color: var(--secondary);
  max-width: 480px;
  margin: 80px auto 0;
}

.scoring__detail-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.scoring__detail-copy {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.scoring__detail-card {
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scoring__detail-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.scoring__detail-game-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.scoring__detail-game-date {
  font-size: 13px;
  color: var(--secondary);
}

.scoring__detail-teams {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
}

.scoring__detail-field {
  font-size: 13px;
  color: var(--secondary);
}

.scoring__detail-todo {
  margin: 8px 0 0;
  padding: 12px;
  background: var(--surface-muted, #eef3fb);
  border-radius: 8px;
  font-size: 13px;
  color: var(--secondary);
  line-height: 1.4;
}
html.dark-mode .scoring__detail-todo {
  background: rgba(255, 255, 255, 0.04);
}

/* Game row — left-pane list item rendered via the
   `MatchGeniGameListPanel` slot. Card-y appearance with a
   primary-tinted selected state. */
.scoring__game-row {
  appearance: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.scoring__game-row:hover {
  background: var(--primary-light-3, #e5f1ff);
}
.scoring__game-row--selected {
  border-color: var(--primary);
  background: var(--primary-light-3, #e5f1ff);
}
html.dark-mode .scoring__game-row:hover,
html.dark-mode .scoring__game-row--selected {
  background: rgba(45, 140, 240, 0.12);
}
/* Division header — first row on each game card. Reuses the
   primary-tinted uppercase treatment the game label used to
   carry so the division reads as the dominant grouping context
   ("which division does this game belong to") above the game
   identity. */
.scoring__game-division {
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scoring__game-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--secondary);
  text-transform: none;
  letter-spacing: 0;
}
.scoring__game-teams {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.scoring__game-team {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
/* Time / field / park meta row inside each game card. Explicit
   `color: var(--secondary)` on the spans (in addition to the
   container) so future edits to the surrounding row tone can't
   accidentally darken this supporting metadata to text-color
   weight. */
.scoring__game-meta {
  font-size: 12px;
  color: var(--secondary);
  display: flex;
  gap: 6px;
}
.scoring__game-meta span {
  color: var(--secondary);
}

/* ─── Loading skeleton ──────────────────────────────────────── */

/* Skeleton reuses the same `.scoring` two-column grid as the
   loaded view so the page doesn't jump when the data lands.
   `pointer-events: none` blocks accidental clicks while the
   shimmer is up. */
.scoring--loading {
  pointer-events: none;
}

/* Left-pane skeleton — toolbar placeholders + a stack of card
   shimmers interleaved with date-header shimmers, mirroring the
   `MatchGeniGameListPanel`'s real output. */
.scoring__skeleton-tab {
  width: 64px;
  height: 18px;
  border-radius: 4px;
}
.scoring__skeleton-picker {
  /* Same height + radius as the loaded `MultiSelectDropdown`
     trigger pill so the toolbar's overall height stays
     consistent across loading + loaded states. */
  width: 100%;
  max-width: 220px;
  height: 32px;
  border-radius: 999px;
}
.scoring__skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}
.scoring__skeleton-date-header {
  /* Matches the real `.game-list-panel__date-header` width and
     dimensions — full-row 14px tall band so the sticky-header
     band in the loaded view drops in without a layout jump. */
  width: 60%;
  height: 18px;
  border-radius: 4px;
  margin-top: 8px;
}
.scoring__skeleton-date-header:first-child {
  margin-top: 0;
}
.scoring__skeleton-card {
  /* Matches the loaded `.scoring__game-row` footprint — three
     short text rows + the surrounding padding. */
  width: 100%;
  height: 78px;
  border-radius: 8px;
}

/* Right-pane skeleton — centered empty-state block that mirrors
   the "Pick a game" placeholder, sized so it lands roughly where
   the real copy renders. */
.scoring__skeleton-detail-title {
  width: 180px;
  height: 22px;
  border-radius: 4px;
  margin: 0 auto 12px;
}
.scoring__skeleton-detail-line {
  width: 100%;
  max-width: 360px;
  height: 14px;
  border-radius: 4px;
  margin: 6px auto;
}
.scoring__skeleton-detail-line--short {
  width: 70%;
  max-width: 240px;
}

@media (max-width: 1080px) {
  .scoring {
    grid-template-columns: 1fr;
  }
  .scoring__source {
    position: static;
    top: auto;
    height: auto;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--border-divider);
  }
}
</style>
