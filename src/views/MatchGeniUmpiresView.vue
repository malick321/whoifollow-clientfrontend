<script setup lang="ts">
// MatchGeniUmpiresView
// --------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/umpires
//
// Two-column "assign umpires" workspace, modeled on the Game
// Scheduler layout:
//
//   LEFT  — the event's umpire roster: count + search + "Add Umpire"
//           + a draggable list. Each row's ellipsis has a single
//           action, "Remove Umpire" (confirmed via the shared
//           centered popup).
//   RIGHT — the park's time × field grid of scheduled games. Each
//           game cell shows its assigned umpire (if any). Assign by
//           dragging an umpire from the left list onto a game, or by
//           clicking a game to pick from the roster. So the whole job
//           — add umpires to the event AND assign them to games —
//           happens on one screen.
//
// Mock layer (`src/api/matchGeniUmpires.ts` + the scheduler mock)
// matches the future endpoint surface so the backend swap is
// body-only.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import InviteUmpireModal from '../components/InviteUmpireModal.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MatchGeniFieldGrid from '../components/MatchGeniFieldGrid.vue'
import MatchGeniGameCard from '../components/MatchGeniGameCard.vue'
import MatchGeniParkPicker from '../components/MatchGeniParkPicker.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import {
  addEventUmpire,
  fetchEventUmpires,
  fetchGameUmpireAssignments,
  removeEventUmpire,
  setGameUmpires
} from '../api/matchGeniUmpires'
import { buildFieldGridFromResources, fetchMatchGeniScheduler } from '../api/matchGeniScheduler'
import { fetchEventResources } from '../api/events'
import { currentAssociation } from '../constants/associations'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import { ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import { formatCompact } from '../utils/formatNumber'
import {
  UMPIRE_ROLES,
  type AssociationUmpire,
  type EventUmpire,
  type GameUmpireAssignment,
  type MatchGeniSchedulerPayload,
  type SchedulerGame,
  type SchedulerPark,
  type UmpireRole
} from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() => (route.params.associationShortName as string | undefined) ?? '')
const eventId = computed(() => (route.params.eventId as string | undefined) ?? '')
const associationId = computed(() => currentAssociation.value?.id ?? '')
const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')

const loading = ref(true)

// ── Roster ───────────────────────────────────────────────────────
const umpires = ref<EventUmpire[]>([])
const totalCount = ref(0)
const search = ref('')
const excludeUmpireIds = computed(() => umpires.value.map((u) => u.associationUserId))
const umpireById = computed(() => {
  const m = new Map<string, EventUmpire>()
  for (const u of umpires.value) m.set(u.id, u)
  return m
})

// ── Grid (right column) ──────────────────────────────────────────
const payload = ref<MatchGeniSchedulerPayload | null>(null)
const selectedParkId = ref<string | null>(null)
const activeDate = ref<string>('')

const allParks = computed<SchedulerPark[]>(() => payload.value?.parks ?? [])
const allGames = computed<SchedulerGame[]>(() => payload.value?.games ?? [])
const selectedPark = computed<SchedulerPark | null>(
  () => allParks.value.find((p) => p.id === selectedParkId.value) ?? null
)
const divisionNameById = computed(() => {
  const m = new Map<string, string>()
  for (const d of payload.value?.divisions ?? []) m.set(d.id, d.name)
  return m
})
const activeParkBreaks = computed(() => {
  const park = selectedPark.value
  if (!park || !park.breaks || !activeDate.value) return []
  return park.breaks.filter((b) => b.date === activeDate.value)
})

// ── Crew assignments (gameId → [{ role, umpireId }]) ─────────────
// A game can carry several umpires (plate + base + field). The grid
// highlights games by STAFFING STATE (assigned vs unassigned), not by
// division — "which games still need an umpire?" is the job here.
const crewByGameId = ref<Record<string, GameUmpireAssignment[]>>({})
const UMPIRE_ROLE_LIST = UMPIRE_ROLES
function crewFor(gameId: string): GameUmpireAssignment[] {
  return crewByGameId.value[gameId] ?? []
}
function crewCount(gameId: string): number {
  return crewFor(gameId).length
}
function umpireNameById(umpireId: string): string {
  return umpireById.value.get(umpireId)?.name ?? 'Umpire'
}
/** Abbreviate a full name to "J. Carter" (first initial + surname). */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full
  return `${parts[0].charAt(0)}. ${parts.slice(1).join(' ')}`
}
/** Tooltip text — just the first crew member ("Plate - J. Carter"); the
 *  full crew is visible in the assign popover. */
function crewSummary(gameId: string): string {
  const first = crewFor(gameId)[0]
  return first ? `${first.role} - ${shortName(umpireNameById(first.umpireId))}` : ''
}
/** The umpire id currently filling `role` on a game (or '' if open). */
function umpireForRole(gameId: string, role: UmpireRole): string {
  return crewFor(gameId).find((a) => a.role === role)?.umpireId ?? ''
}

async function persistCrew(gameId: string, crew: GameUmpireAssignment[]) {
  crewByGameId.value = { ...crewByGameId.value, [gameId]: crew }
  try {
    await setGameUmpires(associationId.value, eventId.value, gameId, crew)
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Assign failed:', err)
  }
}
/** Set (or clear, with `umpireId = null`) one crew role. An umpire can
 *  hold only one role per game, so assigning them clears any other
 *  role they held on that game. Crew stays ordered by role. */
function setRole(gameId: string, role: UmpireRole, umpireId: string | null) {
  let crew = crewFor(gameId).filter((a) => a.role !== role && a.umpireId !== umpireId)
  if (umpireId) crew.push({ role, umpireId })
  crew = UMPIRE_ROLE_LIST.flatMap((r) => crew.filter((a) => a.role === r))
  void persistCrew(gameId, crew)
}
function clearCrew(gameId: string) {
  void persistCrew(gameId, [])
}

// ── Drag an umpire onto a game → fill the first open role ────────
const dragUmpireId = ref<string | null>(null)
function onUmpireDragStart(event: DragEvent, umpire: EventUmpire) {
  dragUmpireId.value = umpire.id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', umpire.id)
  }
}
function onUmpireDragEnd() {
  dragUmpireId.value = null
}
function onGameDrop(game: SchedulerGame, event: DragEvent) {
  event.preventDefault()
  const id = dragUmpireId.value || event.dataTransfer?.getData('text/plain') || null
  dragUmpireId.value = null
  if (!id) return
  const crew = crewFor(game.id)
  if (crew.some((a) => a.umpireId === id)) return // already on this crew
  const openRole = UMPIRE_ROLE_LIST.find((r) => !crew.some((a) => a.role === r))
  if (!openRole) return // crew full
  setRole(game.id, openRole, id)
}

// ── Click a game → crew assign popover ───────────────────────────
const assignGame = ref<SchedulerGame | null>(null)
function onCellClick(p: { game: SchedulerGame | null }) {
  if (p.game) assignGame.value = p.game
}
function closeAssign() {
  assignGame.value = null
}
function onAssignBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) closeAssign()
}
function onRoleSelect(gameId: string, role: UmpireRole, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  setRole(gameId, role, value || null)
}
/** "Fri, May 22" from an ISO `YYYY-MM-DD` (empty when unscheduled). */
function formatGameDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
// Lock the page scroll (hide the page scrollbar) while the assign
// popover is open — it's a custom backdrop, so unlike SlideModal it
// doesn't lock body scroll on its own.
watch(assignGame, (game, prev) => {
  if (game && !prev) lockBodyScroll()
  else if (!game && prev) unlockBodyScroll()
})

// ── Per-row ellipsis menu ────────────────────────────────────────
const openMenuId = ref<string | null>(null)
function toggleMenu(id: string) {
  openMenuId.value = openMenuId.value === id ? null : id
}
function closeMenu() {
  openMenuId.value = null
}
function onDocClick(ev: MouseEvent) {
  if (!openMenuId.value) return
  const target = ev.target as HTMLElement
  if (
    !target.closest('.association-users__row-menu') &&
    !target.closest('.association-users__row-menu-btn')
  ) {
    openMenuId.value = null
  }
}

// ── Remove confirmation ──────────────────────────────────────────
const confirmRemove = ref<EventUmpire | null>(null)
const removing = ref(false)
function startRemove(row: EventUmpire) {
  closeMenu()
  confirmRemove.value = row
}
function cancelRemove() {
  if (removing.value) return
  confirmRemove.value = null
}
function onRemoveBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) cancelRemove()
}
async function performRemove() {
  const row = confirmRemove.value
  if (!row) return
  removing.value = true
  try {
    await removeEventUmpire(associationId.value, eventId.value, row.id)
    umpires.value = umpires.value.filter((u) => u.id !== row.id)
    totalCount.value = Math.max(0, totalCount.value - 1)
    // Strip the removed umpire from every local game crew.
    const next: Record<string, GameUmpireAssignment[]> = {}
    for (const gid of Object.keys(crewByGameId.value)) {
      const crew = crewByGameId.value[gid].filter((a) => a.umpireId !== row.id)
      if (crew.length > 0) next[gid] = crew
    }
    crewByGameId.value = next
    confirmRemove.value = null
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Remove umpire failed:', err)
  } finally {
    removing.value = false
  }
}

// ── Add ──────────────────────────────────────────────────────────
const addOpen = ref(false)
function openAdd() {
  closeMenu()
  addOpen.value = true
}
async function onAddUmpire(umpire: AssociationUmpire) {
  try {
    const created = await addEventUmpire(associationId.value, eventId.value, {
      associationUserId: umpire.id,
      name: umpire.name,
      email: umpire.email,
      avatarUrl: umpire.avatarUrl,
      phone: umpire.phone
    })
    umpires.value = [created, ...umpires.value]
    totalCount.value += 1
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Add umpire failed:', err)
  }
}

// ── Load ─────────────────────────────────────────────────────────
let fetchToken = 0
async function loadRoster() {
  const page = await fetchEventUmpires(associationId.value, eventId.value, {
    search: search.value,
    sort: 'name',
    order: 'asc',
    per_page: 100
  })
  umpires.value = page.data
  totalCount.value = page.total
}
async function load() {
  const myToken = ++fetchToken
  loading.value = true
  try {
    const ok = await ensureMatchGeniAccess(
      router,
      associationId.value,
      eventId.value,
      associationShortName.value,
      'manage_umpires',
      'Umpires'
    )
    if (myToken !== fetchToken) return
    if (!ok) {
      umpires.value = []
      totalCount.value = 0
      payload.value = null
      return
    }

    // Grid data — live parks (games synthesized to fit) with a mock
    // fallback; roster + assignments in parallel.
    const resources = await fetchEventResources(associationId.value, eventId.value, ['parks']).catch(() => null)
    const resParks = resources?.parks ?? []
    const gridPayload = resParks.length > 0
      ? buildFieldGridFromResources(resParks)
      : await fetchMatchGeniScheduler(associationShortName.value, eventId.value)

    const [, assignments] = await Promise.all([
      loadRoster(),
      fetchGameUmpireAssignments(associationId.value, eventId.value)
    ])
    if (myToken !== fetchToken) return

    payload.value = gridPayload
    crewByGameId.value = assignments
    if (!selectedParkId.value && allParks.value.length > 0) {
      selectedParkId.value = allParks.value[0].id
    }
    if (selectedPark.value && selectedPark.value.days.length > 0) {
      activeDate.value = selectedPark.value.days[0].date
    }
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Load umpires page failed:', err)
  } finally {
    if (myToken === fetchToken) loading.value = false
  }
}

const SEARCH_DEBOUNCE_MS = 350
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { searchTimer = null; void loadRoster() }, SEARCH_DEBOUNCE_MS)
})

watch(selectedPark, (next) => {
  if (next && next.days.length > 0) {
    const stillValid = next.days.some((d) => d.date === activeDate.value)
    if (!stillValid) activeDate.value = next.days[0].date
  }
})

watch([associationShortName, eventId], load)

// ── Park-bar height publisher ────────────────────────────────────
// The embedded MatchGeniFieldGrid chain-sticks its date strip + field
// bar below this view's park-bar. That offset (`--matchgeni-field-grid
// -top`) must equal the matchgeni header + the ACTUAL park-bar height,
// or the date strip pins too high and the taller park bar overlaps it
// on scroll. Same ResizeObserver + Math.floor pattern the scheduler /
// field-grid pages use to publish their toolbar height.
const gridHeadRef = ref<HTMLElement | null>(null)
let gridHeadResizeObserver: ResizeObserver | null = null
function publishGridHeadHeight() {
  const el = gridHeadRef.value
  if (!el) return
  const h = el.getBoundingClientRect().height
  document.documentElement.style.setProperty('--umpire-grid-head-height', `${Math.floor(h)}px`)
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  if (typeof ResizeObserver !== 'undefined' && gridHeadRef.value) {
    gridHeadResizeObserver = new ResizeObserver(() => publishGridHeadHeight())
    gridHeadResizeObserver.observe(gridHeadRef.value)
  }
  void nextTick(publishGridHeadHeight)
  window.addEventListener('resize', publishGridHeadHeight)
  load()
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  gridHeadResizeObserver?.disconnect()
  window.removeEventListener('resize', publishGridHeadHeight)
  // Release the scroll lock if we unmount with the popup still open.
  if (assignGame.value) unlockBodyScroll()
})
// Re-measure when the grid head mounts/relays out after load.
watch(loading, async (isLoading) => {
  if (!isLoading) {
    await nextTick()
    publishGridHeadHeight()
  }
})
</script>

<template>
  <main class="umpire-board">
    <MatchGeniHeader
      variant="sub-page"
      title="Umpires"
      :subtitle="eventName"
      :event-id="eventId"
      :loading="loading"
    />

    <div class="umpire-board__cols">
      <!-- LEFT — roster -->
      <aside class="umpire-board__left">
        <!-- Roster skeleton — count + add pill, search bar, shimmer rows. -->
        <template v-if="loading">
          <div class="umpire-board__roster-head">
            <span class="shimmer-block umpire-skel__count"></span>
            <span class="shimmer-block umpire-skel__add"></span>
          </div>
          <span class="shimmer-block umpire-skel__search"></span>
          <span class="shimmer-block umpire-skel__hint"></span>
          <div class="umpire-board__roster">
            <div v-for="i in 10" :key="`uskel-${i}`" class="umpire-skel__row">
              <span class="shimmer-circle umpire-skel__avatar"></span>
              <div class="umpire-skel__lines">
                <span class="shimmer-block umpire-skel__line umpire-skel__line--name"></span>
                <span class="shimmer-block umpire-skel__line umpire-skel__line--meta"></span>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
        <header class="umpire-board__roster-head">
          <p class="umpire-board__count">
            <strong :title="`${totalCount} umpires`">{{ formatCompact(totalCount) }}</strong>
            <span>umpires</span>
          </p>
          <button class="association-users__invite-btn umpire-board__add-btn" type="button" @click="openAdd">
            <span class="umpire-board__add-icon" aria-hidden="true"></span>
            <span>Add</span>
          </button>
        </header>
        <label class="umpire-board__search">
          <AppIcon name="search" :size="14" />
          <input v-model="search" type="search" placeholder="Search umpires" class="umpire-board__search-input" />
        </label>

        <p class="umpire-board__hint">Drag an umpire onto a game to assign — or click a game to pick one.</p>

        <div class="umpire-board__roster">
          <div v-if="umpires.length === 0" class="umpire-board__roster-empty">
            <p v-if="search.trim()">No umpires match "{{ search }}".</p>
            <p v-else>No umpires yet. Click "Add Umpire" to add one.</p>
          </div>
          <article
            v-for="u in umpires"
            :key="u.id"
            class="umpire-board__umpire"
            :class="{ 'umpire-board__umpire--dragging': dragUmpireId === u.id }"
            draggable="true"
            @dragstart="onUmpireDragStart($event, u)"
            @dragend="onUmpireDragEnd"
          >
            <span class="umpire-board__grip" aria-hidden="true"></span>
            <TeamAvatar :name="u.name" :image-url="u.avatarUrl" size="sm" />
            <div class="umpire-board__umpire-text">
              <strong class="umpire-board__umpire-name">{{ u.name }}</strong>
              <span class="umpire-board__umpire-meta">{{ u.email }}</span>
            </div>
            <span
              class="umpire-board__umpire-count"
              :title="`${u.gamesAssigned} game${u.gamesAssigned === 1 ? '' : 's'} assigned`"
            >{{ u.gamesAssigned }}</span>
            <div class="association-users__row-actions umpire-board__umpire-actions">
              <button
                type="button"
                class="association-users__row-menu-btn"
                :aria-label="`Actions for ${u.name}`"
                @click.stop="toggleMenu(u.id)"
              >
                <AppIcon name="ellipsis" :size="16" />
              </button>
              <div v-if="openMenuId === u.id" class="association-users__row-menu" role="menu">
                <button
                  type="button"
                  class="association-users__row-menu-item association-users__row-menu-item--danger"
                  role="menuitem"
                  @click="startRemove(u)"
                >Remove Umpire</button>
              </div>
            </div>
          </article>
        </div>
        </template>
      </aside>

      <!-- RIGHT — park grid -->
      <section class="umpire-board__right">
        <!-- Grid skeleton — park bar + date strip + field bar + rows. -->
        <template v-if="loading">
          <div class="umpire-board__grid-head">
            <span class="shimmer-circle umpire-skel__park-icon"></span>
            <span class="shimmer-block umpire-skel__park"></span>
          </div>
          <div class="umpire-skel__date-strip">
            <span class="shimmer-circle umpire-skel__date-arrow"></span>
            <div class="umpire-skel__date-list">
              <span v-for="d in 5" :key="`dskel-${d}`" class="shimmer-block umpire-skel__date-cell"></span>
            </div>
            <span class="shimmer-circle umpire-skel__date-arrow"></span>
          </div>
          <div class="umpire-skel__grid">
            <div class="umpire-skel__grid-row umpire-skel__grid-row--head">
              <span class="shimmer-block umpire-skel__th"></span>
              <span v-for="n in 4" :key="`thskel-${n}`" class="shimmer-block umpire-skel__th"></span>
            </div>
            <div v-for="row in 8" :key="`grow-${row}`" class="umpire-skel__grid-row">
              <span class="shimmer-block umpire-skel__time"></span>
              <span v-for="n in 4" :key="`cskel-${row}-${n}`" class="shimmer-block umpire-skel__cell"></span>
            </div>
          </div>
        </template>

        <template v-else>
        <header ref="gridHeadRef" class="umpire-board__grid-head">
          <span class="umpire-board__park-icon" aria-hidden="true"></span>
          <MatchGeniParkPicker
            id="umpire-park-picker"
            v-model="selectedParkId"
            :parks="allParks"
            class="umpire-board__park-picker"
          />
        </header>

        <div v-if="!loading && allParks.length === 0" class="umpire-board__grid-empty">
          <p>No parks set up for this event yet, so there are no scheduled games to assign umpires to.</p>
        </div>

        <MatchGeniFieldGrid
          v-else
          :park="selectedPark"
          :games="allGames"
          v-model:active-date="activeDate"
          cell-interaction="click"
          :park-breaks="activeParkBreaks"
          class="umpire-board__grid"
          @cell-click="onCellClick"
        >
          <template #cell="{ game, size, durationMinutes }">
            <div
              class="umpire-cell"
              :class="{
                'umpire-cell--droppable': !!dragUmpireId,
                'umpire-cell--assigned': crewCount(game.id) > 0,
                'umpire-cell--unassigned': crewCount(game.id) === 0
              }"
              @dragover.prevent
              @drop="onGameDrop(game, $event)"
            >
              <MatchGeniGameCard
                :game="game"
                :division-name="divisionNameById.get(game.divisionId) ?? ''"
                :size="(size as 'full' | 'compact' | 'mini')"
                :duration-minutes="durationMinutes"
              />
              <span
                v-if="crewCount(game.id) > 0"
                class="umpire-cell__badge app-tooltip app-tooltip--top"
                :data-tooltip="crewSummary(game.id)"
              >
                <span class="umpire-cell__badge-whistle" aria-hidden="true"></span>
                {{ crewCount(game.id) }} umpire{{ crewCount(game.id) === 1 ? '' : 's' }}
              </span>
            </div>
          </template>
          <template #empty-cell><span /></template>
        </MatchGeniFieldGrid>
        </template>
      </section>
    </div>

    <!-- Add Umpire — registered-umpire picker. -->
    <InviteUmpireModal
      v-model="addOpen"
      :association-id="associationId"
      :exclude-umpire-ids="excludeUmpireIds"
      @add="onAddUmpire"
    />

    <!-- Assign-umpire popover (click a game). -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="assignGame"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onAssignBackdrop"
      >
        <div class="association-switcher-panel umpire-assign" role="dialog" aria-modal="true" aria-label="Assign umpire">
          <header class="association-switcher-panel__header">
            <h2 class="association-switcher-panel__title">Assign Umpire</h2>
            <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="closeAssign">
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="umpire-assign__body">
            <!-- Game summary — eyebrow (game · division), matchup, then
                 time/date + field/park. -->
            <div class="umpire-assign__game-info">
              <span class="umpire-assign__eyebrow">
                {{ assignGame.label }}{{ divisionNameById.get(assignGame.divisionId) ? ` - ${divisionNameById.get(assignGame.divisionId)}` : '' }}
              </span>
              <div class="umpire-assign__matchup">
                <div class="umpire-assign__team">
                  <TeamAvatar :name="assignGame.team1Label || 'TBD'" size="md" />
                  <span class="umpire-assign__team-name">{{ assignGame.team1Label || 'TBD' }}</span>
                </div>
                <span class="umpire-assign__vs">VS</span>
                <div class="umpire-assign__team umpire-assign__team--right">
                  <span class="umpire-assign__team-name">{{ assignGame.team2Label || 'TBD' }}</span>
                  <TeamAvatar :name="assignGame.team2Label || 'TBD'" size="md" />
                </div>
              </div>
              <div class="umpire-assign__meta">
                <div class="umpire-assign__meta-row">
                  <span class="umpire-assign__meta-icon umpire-assign__meta-icon--time" aria-hidden="true"></span>
                  <span>{{ [assignGame.scheduledTime, formatGameDate(assignGame.scheduledDate)].filter(Boolean).join(' · ') || 'Not scheduled' }}</span>
                </div>
                <div class="umpire-assign__meta-row">
                  <span class="umpire-assign__meta-icon umpire-assign__meta-icon--field" aria-hidden="true"></span>
                  <span>{{ [assignGame.scheduledFieldLabel, selectedPark?.name].filter(Boolean).join(' - ') || '—' }}</span>
                </div>
              </div>
            </div>

            <div v-if="umpires.length === 0" class="umpire-assign__empty">
              No umpires on the roster yet. Add one from the left, then assign.
            </div>
            <div v-else class="umpire-assign__roles">
              <div
                v-for="role in UMPIRE_ROLE_LIST"
                :key="role"
                class="floating-input umpire-assign__role"
              >
                <select
                  :id="`ump-role-${role.replace(/\s+/g, '-')}`"
                  class="floating-input__control floating-input__control--select"
                  :value="umpireForRole(assignGame.id, role)"
                  @change="onRoleSelect(assignGame.id, role, $event)"
                >
                  <option value="">— Unassigned —</option>
                  <option v-for="u in umpires" :key="u.id" :value="u.id">{{ u.name }}</option>
                </select>
                <label
                  :for="`ump-role-${role.replace(/\s+/g, '-')}`"
                  class="floating-input__label floating-input__label--floated"
                >{{ role }}</label>
              </div>
            </div>
          </div>
          <footer class="umpire-assign__footer">
            <button
              type="button"
              class="secondary-button"
              :disabled="crewCount(assignGame.id) === 0"
              @click="clearCrew(assignGame.id)"
            >Clear</button>
            <button type="button" class="primary-button" @click="closeAssign">Save</button>
          </footer>
        </div>
      </div>
    </Transition>

    <!-- Remove confirmation. -->
    <Transition name="slide-modal-backdrop">
      <div
        v-if="confirmRemove"
        class="association-switcher-backdrop"
        role="presentation"
        @click="onRemoveBackdrop"
      >
        <div
          class="association-switcher-panel association-confirm-panel"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="remove-umpire-title"
        >
          <header class="association-switcher-panel__header">
            <h2 id="remove-umpire-title" class="association-switcher-panel__title">Remove Umpire</h2>
            <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="cancelRemove">
              <AppIcon name="close" :size="16" />
            </button>
          </header>
          <div class="association-confirm-panel__body">
            <p class="association-confirm-panel__copy">
              Remove <strong>{{ confirmRemove.name }}</strong> from this event's umpire roster?
              Any games assigned to them will be left without an umpire.
            </p>
          </div>
          <footer class="association-confirm-panel__footer">
            <button class="secondary-button" type="button" :disabled="removing" @click="cancelRemove">Cancel</button>
            <button class="danger-light-button" type="button" :disabled="removing" @click="performRemove">
              {{ removing ? 'Removing…' : 'Yes, remove' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
.umpire-board {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  /* Field-grid chain-sticky offset — header + the sticky grid-head
     (park picker) row, so the grid's date strip pins right beneath it.
     `--umpire-grid-head-height` is published live via ResizeObserver
     (see `publishGridHeadHeight`) so the offset tracks the bar's real
     rendered height instead of a guess that leaves the date strip
     sliding behind the park bar on scroll. */
  --matchgeni-field-grid-top: calc(
    var(--matchgeni-header-height, 56px)
    + var(--umpire-grid-head-height, 51px)
  );
}

.umpire-board__cols {
  /* Edge-to-edge two-column grid — same shape as the Game
     Scheduler: a fixed-width sticky left pane hugging the viewport
     edge + the grid surface filling the rest. No outer padding /
     gap; the right border on the left pane is the only divider. */
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
  gap: 0;
  padding: 0;
  align-items: start;
  position: relative;
  overflow-x: clip;
}

/* ── Left roster column ── */
/* Sticky-pinned + full-height (viewport minus the matchgeni header),
   stretched edge-to-edge. The pane itself is `overflow: hidden`; the
   roster list inside owns the scroll (mirrors the scheduler source
   column). */
.umpire-board__left {
  position: sticky;
  top: var(--matchgeni-header-height, 56px);
  height: calc(100vh - var(--matchgeni-header-height, 56px));
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--white);
  border: 0;
  border-right: 1px solid var(--border-divider);
  border-radius: 0;
  padding: 14px;
  overflow: hidden;
}
html.dark-mode .umpire-board__left {
  background: var(--surface-card);
}
.umpire-board__roster-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.umpire-board__count {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  color: var(--secondary);
}
.umpire-board__count strong {
  font-size: 16px;
  color: var(--text);
}
.umpire-board__add-btn { /* inherits .association-users__invite-btn */ }
/* Add icon — masked `add.svg`, painted in the button's label colour
   (`--white` = white in light, dark in dark mode, matching the label). */
.umpire-board__add-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: var(--white, #ffffff);
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
  mask: url('../assets/add.svg') center / contain no-repeat;
}
.umpire-board__search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 36px;
  border-radius: 6px;
  background: var(--surface-muted, #eff3f8);
  color: var(--secondary);
}
html.dark-mode .umpire-board__search {
  background: rgba(255, 255, 255, 0.06);
}
.umpire-board__search-input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  color: var(--text);
}
.umpire-board__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--secondary);
}
.umpire-board__roster {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.umpire-board__roster-empty {
  padding: 28px 8px;
  text-align: center;
  font-size: 13px;
  color: var(--secondary);
}
.umpire-board__umpire {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  background: var(--white);
  cursor: grab;
  user-select: none;
}
html.dark-mode .umpire-board__umpire {
  background: rgba(255, 255, 255, 0.03);
}
.umpire-board__umpire:active { cursor: grabbing; }
.umpire-board__umpire--dragging { opacity: 0.45; }
.umpire-board__grip {
  flex: 0 0 auto;
  width: 10px;
  height: 16px;
  background-image: radial-gradient(currentColor 1px, transparent 1.5px);
  background-size: 5px 5px;
  background-position: 0 2px;
  color: var(--secondary);
  opacity: 0.7;
}
.umpire-board__umpire-text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.umpire-board__umpire-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.umpire-board__umpire-meta {
  font-size: 11px;
  color: var(--secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Games-assigned count badge — sits before the ellipsis. */
.umpire-board__umpire-count {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-muted, #eef3fb);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
  font-size: 12px;
  font-weight: 600;
}
html.dark-mode .umpire-board__umpire-count {
  background: rgba(255, 255, 255, 0.06);
}
.umpire-board__umpire-actions { flex: 0 0 auto; }

/* ── Right grid column ── */
/* Stretches to fill the rest of the row + at least the viewport
   height below the header so the grid surface reaches the bottom
   edge like the scheduler's grid shell. No card chrome — flush with
   the left pane's right border. */
.umpire-board__right {
  min-width: 0;
  background: var(--white);
  border: 0;
  border-radius: 0;
  min-height: calc(100vh - var(--matchgeni-header-height, 56px));
}
html.dark-mode .umpire-board__right {
  background: var(--surface-card);
}
/* Park-picker bar — sticky under the matchgeni header so it stays
   put while the grid scrolls (same as the scheduler park-head). */
.umpire-board__grid-head {
  position: sticky;
  top: var(--matchgeni-header-height, 56px);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--white);
  border-bottom: 1px solid var(--border-divider);
}
html.dark-mode .umpire-board__grid-head {
  background: var(--surface-card);
}
.umpire-board__park-icon {
  display: inline-block;
  width: 26px;
  height: 26px;
  flex: 0 0 auto;
  background-color: #254c72;
  -webkit-mask: url('../assets/park-twotone.svg') center / contain no-repeat;
  mask: url('../assets/park-twotone.svg') center / contain no-repeat;
}
html.dark-mode .umpire-board__park-icon { background-color: #7fb0e8; }
.umpire-board__park-picker {
  width: 100%;
  max-width: 360px;
  flex: 0 0 auto;
}
.umpire-board__grid-empty {
  padding: 60px 24px;
  text-align: center;
  color: var(--secondary);
}

/* Drop the locked-game 3px primary left edge on this surface — the
   field grid paints it on "final/locked" games, but on the umpires
   board the only meaningful cell accent is the green assigned ring, so
   restore the card's default 1px divider border instead. */
.umpire-board__grid :deep(.field-grid__cal-game--locked .matchgeni-game-card) {
  border-left: 1px solid var(--border-divider);
}

/* ── Umpire cell overlay ── */
/* Highlight by STAFFING STATE, not division: assigned games get a
   green accent + crew badge; unassigned games recede (muted) so the
   eye lands on what still needs an umpire. */
.umpire-cell {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 8px;
  transition: box-shadow 120ms ease, opacity 120ms ease;
}
/* Assigned — green accent ring around the cell. Painted as an
   `::after` overlay (not an inset box-shadow) so it sits ABOVE the
   game card filling the cell; otherwise the card's opaque surface +
   the grid's border lines cover the ring's bottom edge in light mode
   (dark mode's brighter tint bled through, which is why it looked
   complete there). The pseudo follows the cell's border-radius, so all
   four rounded sides draw evenly in both themes. */
.umpire-cell--assigned::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid var(--success, #22a06b);
  border-radius: 6px;
  pointer-events: none;
}
/* Unassigned — slightly muted so staffed games stand out. */
.umpire-cell--unassigned {
  opacity: 0.72;
}
/* While dragging an umpire, every cell reads as a drop target
   (dashed primary) and un-mutes so the operator can aim. */
.umpire-cell--droppable {
  outline: 2px dashed var(--primary);
  outline-offset: -2px;
  opacity: 1;
}
.umpire-cell__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  max-width: 100%;
  white-space: nowrap;
  /* `overflow: visible` so the `.app-tooltip` pseudo-element can paint
     above the badge instead of being clipped. The label ("N umpires")
     is short, so no ellipsis is needed. */
  overflow: visible;
  background: var(--success-light, #e3f6ea);
  color: #16763a;
}
html.dark-mode .umpire-cell__badge {
  background: rgba(34, 160, 107, 0.18);
  color: #7ad48a;
}
/* Crew tooltip as a vertical list — render the `\n`-joined crew on
   separate lines (the global app-tooltip forces `nowrap`), left-aligned
   so role/name pairs read down the column instead of one wide row. */
.umpire-cell__badge.app-tooltip::after {
  white-space: pre-line;
  text-align: left;
}
.umpire-cell__badge-whistle {
  width: 10px;
  height: 10px;
  flex: 0 0 auto;
  background-color: currentColor;
  -webkit-mask: url('../assets/umpire-line.svg') center / contain no-repeat;
  mask: url('../assets/umpire-line.svg') center / contain no-repeat;
}

/* ── Assign popover ── */
.umpire-assign {
  width: min(420px, 100%);
}
.umpire-assign__body {
  padding: 14px 16px;
  max-height: 50vh;
  overflow-y: auto;
}
/* Eyebrow — "<game> - <division>" row at the top of the game card. */
.umpire-assign__eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
/* Game summary card at the top of the popover body. */
.umpire-assign__game-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  margin-bottom: 14px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: #f4f7fb;
}
html.dark-mode .umpire-assign__game-info {
  background: rgba(255, 255, 255, 0.04);
}
/* Second row — time on the left, field on the right. */
.umpire-assign__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid var(--border-divider);
}
/* Versus matchup — team (avatar + name) · VS badge · team, full row. */
.umpire-assign__matchup {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 0 2px;
}
.umpire-assign__team {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.umpire-assign__team--right {
  justify-content: flex-end;
  text-align: right;
}
.umpire-assign__team-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Center VS chip — gaming-style versus badge. */
.umpire-assign__vs {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--primary);
  background: var(--primary-light-3, #e5f1ff);
}
html.dark-mode .umpire-assign__vs {
  background: rgba(45, 140, 240, 0.16);
}
.umpire-assign__meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text);
}
.umpire-assign__meta-icon {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  background-color: var(--text);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}
.umpire-assign__meta-icon--time {
  -webkit-mask-image: url('../assets/time.svg');
  mask-image: url('../assets/time.svg');
}
.umpire-assign__meta-icon--field {
  -webkit-mask-image: url('../assets/field-line.svg');
  mask-image: url('../assets/field-line.svg');
}

.umpire-assign__empty {
  font-size: 13px;
  color: var(--secondary);
  padding: 12px 0;
}
/* One floating-label dropdown per crew role (role = floated label). */
.umpire-assign__roles {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.umpire-assign__role {
  width: 100%;
}
.umpire-assign__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-divider);
}
/* Solid primary fill (the global `.primary-button` is a gradient) so
   the Save button matches the portal's solid primary CTA in both
   themes. */
.umpire-assign__footer .primary-button {
  background: var(--primary);
}
.umpire-assign__footer .primary-button:hover {
  filter: brightness(1.06);
}

/* ── Loading skeletons ── */
.umpire-skel__count { width: 90px; height: 18px; border-radius: 5px; }
.umpire-skel__add { width: 110px; height: 36px; border-radius: 6px; flex: 0 0 auto; }
.umpire-skel__search { display: block; width: 100%; height: 36px; border-radius: 6px; }
.umpire-skel__hint { display: block; width: 80%; height: 12px; border-radius: 5px; }
.umpire-skel__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
}
.umpire-skel__avatar { width: 28px; height: 28px; border-radius: 999px; flex: 0 0 auto; }
.umpire-skel__lines { flex: 1 1 auto; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.umpire-skel__line { display: block; height: 11px; border-radius: 5px; }
.umpire-skel__line--name { width: 60%; height: 13px; }
.umpire-skel__line--meta { width: 85%; }

/* Right grid skeleton — park bar pill, date strip, field × time grid. */
.umpire-skel__park-icon { width: 26px; height: 26px; flex: 0 0 auto; }
.umpire-skel__park { width: 100%; max-width: 320px; height: 38px; border-radius: 8px; }
.umpire-skel__date-strip {
  display: grid;
  grid-template-columns: 30px 1fr 30px;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border-divider);
}
.umpire-skel__date-arrow { width: 30px; height: 30px; border-radius: 999px; }
.umpire-skel__date-list { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; }
.umpire-skel__date-cell { height: 44px; border-radius: 6px; }
.umpire-skel__grid { display: flex; flex-direction: column; }
.umpire-skel__grid-row { display: grid; grid-template-columns: 100px repeat(4, minmax(0, 1fr)); }
.umpire-skel__th {
  height: 40px;
  border-right: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  border-radius: 0;
}
.umpire-skel__time,
.umpire-skel__cell {
  height: 88px;
  border-right: 1px solid var(--border-divider);
  border-bottom: 1px solid var(--border-divider);
  border-radius: 0;
}

@media (max-width: 1024px) {
  /* Stack: roster on top (natural height, no internal scroll cap),
     grid below. The pane drops its sticky full-height behavior. */
  .umpire-board__cols {
    grid-template-columns: minmax(0, 1fr);
  }
  .umpire-board__left {
    position: static;
    height: auto;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--border-divider);
  }
  .umpire-board__roster {
    max-height: 340px;
  }
  .umpire-board__right {
    min-height: 0;
  }
}

/* ≤720px — roster becomes a horizontal card strip: scroll sideways
   through umpires instead of a tall vertical list (drag-to-assign is a
   desktop affordance, so the grip is hidden and the grid's click-to-
   assign is the touch path). */
@media (max-width: 720px) {
  .umpire-board__roster {
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    max-height: none;
    gap: 8px;
    padding-bottom: 4px;
    scrollbar-width: none;
  }
  .umpire-board__roster::-webkit-scrollbar { display: none; }
  .umpire-board__umpire {
    flex: 0 0 230px;
    cursor: pointer;
  }
  .umpire-board__grip { display: none; }
  /* Hide the park glyph on mobile — the dropdown alone is enough, and
     it stretches end-to-end in the reclaimed space. */
  .umpire-board__park-icon { display: none; }
  .umpire-board__park-picker {
    max-width: none;
    flex: 1 1 auto;
  }
}
</style>
