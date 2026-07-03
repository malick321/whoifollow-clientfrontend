<script setup lang="ts">
// EventOfficialsView
// ------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/officials
//
// MatchGeni sub-page that lists every user granted access to this
// event with their event-scoped fullControl / permissions /
// scoring-scope. Layout follows the AssociationUsersView row pattern
// (avatar + identity + permissions + ellipsis menu) and lives inside
// a centered content column under the MatchGeniHeader sub-page bar.
//
// Top-level flow:
//   1. Mount → fetch event (resolveByGuid) for the header + parks
//      catalogue, then fetch officials list.
//   2. "Invite Official" → open EventOfficialModal in invite mode
//      (user picker step → permissions step).
//   3. Row ellipsis → "Edit Access" opens the modal in edit mode;
//      "Revoke Access" hard-deletes via revokeEventOfficial.
//
// Mock layer matches the matchgeni-officials-api-contract.md surface
// 1:1 so the backend swap is body-only inside src/api/eventOfficials.ts.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import EventOfficialAccessModal, { type EventOfficialAccessSavePayload }
  from '../components/EventOfficialAccessModal.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import {
  createEventOfficial,
  fetchEventOfficials,
  revokeEventOfficial,
  updateEventOfficial
} from '../api/eventOfficials'
import { buildDivisionsFor, buildParksFor } from '../api/officialEvents'
import { currentAssociation } from '../constants/associations'
import { EVENT_PERMISSIONS } from '../constants/eventPermissions'
import { ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import { formatCompact } from '../utils/formatNumber'
import type {
  AssociationUser,
  EventOfficial,
  EventPermissionKey,
  OfficialEvent
} from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() =>
  (route.params.eventId as string | undefined) ?? ''
)

const officials = ref<EventOfficial[]>([])
const totalCount = ref(0)
const loading = ref(true)

/** Event display fields the page header + modal need, sourced from
 *  the matchgeni access payload (`matchgeni-context`). Heavier event
 *  metadata (location / sports type / director) isn't returned by
 *  `/my-permissions` — those fall back to empty strings, which the
 *  modal's display rows handle gracefully. */
const eventDisplay = computed(() => {
  const ev = matchGeniContext.value?.event
  if (!ev) return null
  return {
    id: ev.id,
    eventName: ev.eventName,
    dateRangeLabel: ev.dateRange,
    avatarUrl: '',
    city: '',
    state: '',
    sportsTypeName: '',
    directorName: ''
  }
})

const search = ref('')

// Modal state — reuses the existing EventOfficialAccessModal for
// both invite (user=null, modal renders its built-in user picker)
// and edit (synthesize an AssociationUser + OfficialEvent from the
// row so the modal can hydrate). The `saveHandler` prop on the
// modal lets us plug in the event-officials CRUD endpoints; the
// `saved` emit fires with an OfficialEvent which we translate back
// into the EventOfficial row shape via `lastEditedRowId`.
const modalOpen = ref(false)
const modalUser = ref<AssociationUser | null>(null)
const modalEvent = ref<OfficialEvent | null>(null)
const editingRowId = ref<string | null>(null)

/** Build a synthetic AssociationUser from the row's denormalized
 *  user fields. Lossy by design — the modal only reads name / email
 *  / avatarUrl + id, never status or permissions, so we don't bother
 *  populating the rest. */
function rowToAssociationUser(row: EventOfficial): AssociationUser {
  return {
    id: row.associationUserId,
    name: row.name,
    email: row.email,
    avatarUrl: row.avatarUrl,
    status: 'active',
    fullControl: false,
    permissions: [],
    eventOfficialCount: 0
  }
}

/** Display fields the modal needs from the parent event. Sourced
 *  from `matchGeniContext.event` (`/my-permissions` payload) — the
 *  fields not present in that lean payload (avatarUrl / city /
 *  state / sportsType / director) fall back to empty strings, which
 *  the modal handles gracefully. */
type ParentEventDisplay = {
  id: string
  eventName: string
  dateRangeLabel: string
  avatarUrl: string
  city: string
  state: string
  sportsTypeName: string
  directorName: string
}

/** Build a synthetic OfficialEvent from the EventOfficial row + the
 *  parent event. The modal pre-fills its form from this shape, so
 *  the `fullControl` / `permissions` / `scoringScope` need to mirror
 *  the row exactly. Parks / divisions are passed through from the
 *  parent event when the event-detail catalogues land; until then
 *  the scope picker falls back to "All games" only. */
function rowToOfficialEvent(row: EventOfficial | null, parent: ParentEventDisplay): OfficialEvent {
  // Seed parks + divisions from the shared deterministic pools used
  // by the officialEvents mock so the modal's "Specific parks" /
  // "Specific divisions" scope picker has real entities to offer.
  // Production backend will populate these via JOINs on `event_parks`
  // / `event_divisions` against the parent event.
  const eventIndex = Number(parent.id) || 0
  return {
    id: parent.id,
    imageUrl: parent.avatarUrl,
    dateRange: parent.dateRangeLabel,
    name: parent.eventName,
    location: [parent.city, parent.state].filter(Boolean).join(', '),
    subtitle: parent.sportsTypeName,
    director: parent.directorName,
    fullControl: row?.fullControl ?? false,
    permissions: row?.permissions ?? [],
    scoringScope: row?.scoringScope ?? undefined,
    parks: buildParksFor(eventIndex),
    divisions: buildDivisionsFor(eventIndex)
  }
}

function openInvite() {
  closeMenu()
  if (!eventDisplay.value) return
  editingRowId.value = null
  modalUser.value = null
  modalEvent.value = rowToOfficialEvent(null, eventDisplay.value)
  modalOpen.value = true
}

function openEdit(row: EventOfficial) {
  closeMenu()
  if (!eventDisplay.value) return
  editingRowId.value = row.id
  modalUser.value = rowToAssociationUser(row)
  modalEvent.value = rowToOfficialEvent(row, eventDisplay.value)
  modalOpen.value = true
}

/** Save handler the modal calls — routes through the event-officials
 *  CRUD endpoints. On edit we use `updateEventOfficial`; on invite
 *  we use `createEventOfficial` (the picked user comes from
 *  `payload.user`). Returns an `OfficialEvent` shape so the modal's
 *  `saved` emit fires with the type its consumers expect. */
async function handleSave(payload: EventOfficialAccessSavePayload): Promise<OfficialEvent> {
  if (!eventDisplay.value) throw new Error('Event not loaded.')
  if (editingRowId.value) {
    const updated = await updateEventOfficial(
      currentAssociation.value?.id ?? '',
      eventDisplay.value.id,
      editingRowId.value,
      {
        fullControl: payload.fullControl,
        permissions: payload.permissions,
        scoringScope: payload.scoringScope
      }
    )
    spliceOfficial(updated)
  } else {
    const created = await createEventOfficial(
      currentAssociation.value?.id ?? '',
      eventDisplay.value.id,
      {
        associationUserId: payload.user.id,
        name: payload.user.name,
        email: payload.user.email,
        avatarUrl: payload.user.avatarUrl,
        fullControl: payload.fullControl,
        permissions: payload.permissions,
        scoringScope: payload.scoringScope
      }
    )
    spliceOfficial(created)
  }
  // Modal's `saved` emit expects an OfficialEvent; we hand back a
  // synthetic copy so the modal can close cleanly. The view already
  // updated its local list inside `spliceOfficial` above.
  return rowToOfficialEvent(
    {
      ...(editingRowId.value
        ? officials.value.find((o) => o.id === editingRowId.value)!
        : officials.value[0]),
      fullControl: payload.fullControl,
      permissions: payload.permissions,
      scoringScope: payload.scoringScope
    },
    eventDisplay.value
  )
}

function spliceOfficial(saved: EventOfficial) {
  const index = officials.value.findIndex((o) => o.id === saved.id)
  if (index === -1) {
    officials.value = [saved, ...officials.value]
    totalCount.value += 1
  } else {
    officials.value = [
      ...officials.value.slice(0, index),
      saved,
      ...officials.value.slice(index + 1)
    ]
  }
}

async function onRevoke(row: EventOfficial) {
  if (!eventDisplay.value) return
  closeMenu()
  const ok = window.confirm(`Revoke ${row.name}'s access to ${eventDisplay.value.eventName}?`)
  if (!ok) return
  try {
    await revokeEventOfficial(
      currentAssociation.value?.id ?? '',
      eventDisplay.value.id,
      row.id
    )
    officials.value = officials.value.filter((o) => o.id !== row.id)
    totalCount.value = Math.max(0, totalCount.value - 1)
  } catch (err) {
    // Silent for now; toast UX is being revisited.
    if (typeof console !== 'undefined') console.error('Revoke failed:', err)
  }
}

// Per-row ellipsis menu — single open at a time.
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

// Sticky toolbar drop-shadow — toggled when the header is pinned
// to the top of the viewport (i.e. the user has scrolled past it).
// Same sentinel + IntersectionObserver pattern as
// AssociationUsersView so the visual treatment matches.
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

let fetchToken = 0
async function load() {
  const myToken = ++fetchToken
  loading.value = true
  try {
    // Step 1 — verify the caller can be on this matchgeni sub-page.
    // Shared helper handles the `/my-permissions` fetch, the
    // matchgeni-context cache (skipping the round-trip when we
    // navigated here from the dashboard for the same event), and
    // the 403 / 404 / 409 → toast + redirect plumbing.
    const ok = await ensureMatchGeniAccess(
      router,
      currentAssociation.value?.id ?? '',
      eventId.value,
      associationShortName.value,
      'manage_officials',
      'Officials'
    )
    if (myToken !== fetchToken) return
    if (!ok) {
      // Helper redirected — leave the view in a quiet state.
      officials.value = []
      totalCount.value = 0
      return
    }

    // Step 2 — pull the officials list. Event display fields
    // (eventName for the header subtitle) come from the
    // `matchGeniContext` populated in step 1; no fetchEvent hop.
    const page = await fetchEventOfficials(
      currentAssociation.value?.id ?? '',
      eventId.value,
      { search: search.value, sort: 'name', order: 'asc', per_page: 100 }
    )
    if (myToken !== fetchToken) return
    officials.value = page.data
    totalCount.value = page.total
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Load officials failed:', err)
    if (myToken === fetchToken) {
      officials.value = []
      totalCount.value = 0
    }
  } finally {
    if (myToken === fetchToken) loading.value = false
  }
}

// Debounced search.
const SEARCH_DEBOUNCE_MS = 400
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    load()
  }, SEARCH_DEBOUNCE_MS)
})

watch([associationShortName, eventId], load)

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        toolbarStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px 0px 0px 0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  load()
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  if (stickyObserver) stickyObserver.disconnect()
})

// Display helpers
const PERM_LABEL_BY_KEY = new Map(EVENT_PERMISSIONS.map((p) => [p.key, p.label]))
function permLabel(key: EventPermissionKey): string {
  return PERM_LABEL_BY_KEY.get(key) ?? key
}

/** Warning-tone scoring chip — shown whenever the row holds
 *  `manage_scoring`. Label folds the scope into the chip so the
 *  admin sees both the grant + its reach at a glance. Returns null
 *  when fullControl is on (the row already shows a single Full
 *  Control chip) or when the user simply doesn't hold the permission. */
function scopeSummary(row: EventOfficial): string | null {
  if (row.fullControl) return null
  if (!row.permissions.includes('manage_scoring')) return null
  const scope = row.scoringScope
  if (!scope || scope.mode === 'all') return 'Scoring: All games'
  if (scope.mode === 'parks') {
    return `Scoring: ${scope.parkIds.length} park${scope.parkIds.length === 1 ? '' : 's'}`
  }
  return `Scoring: ${scope.divisionIds.length} division${scope.divisionIds.length === 1 ? '' : 's'}`
}

/** Filter `manage_scoring` out of the chip list — its info is surfaced
 *  by `scopeSummary` above as a warning-tone chip so the two don't
 *  duplicate each other. */
function permissionKeysForRow(row: EventOfficial): EventPermissionKey[] {
  return row.permissions.filter((k) => k !== 'manage_scoring')
}

const excludeUserIds = computed(() => officials.value.map((o) => o.associationUserId))
</script>

<template>
  <main class="event-officials">
    <MatchGeniHeader
      variant="sub-page"
      title="Event Officials"
      :subtitle="eventDisplay?.eventName ?? ''"
      :event-id="eventId"
    />

    <section class="event-officials__shell">
      <!-- Sticky stack — same pattern AssociationUsersView /
           AssociationEventsView use: a sentinel above the header
           lets an IntersectionObserver toggle the `--stuck` modifier
           the moment the toolbar pins to the viewport top. The
           "stuck" state acquires a white background + drop-shadow
           so the rows scrolling underneath don't bleed through. -->
      <div ref="stickySentinelRef" class="event-officials__sticky-sentinel" aria-hidden="true"></div>
      <header
        class="event-officials__header"
        :class="{ 'event-officials__header--stuck': toolbarStuck }"
      >
        <p class="event-officials__count">
          <strong :title="`${totalCount} officials`">{{ formatCompact(totalCount) }}</strong>
          <span>officials</span>
        </p>
        <div class="event-officials__header-actions">
          <label class="event-officials__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search officials"
              class="event-officials__search-input"
            />
          </label>
          <button class="association-users__invite-btn event-officials__invite-btn" type="button" @click="openInvite">
            <span class="event-officials__invite-icon" aria-hidden="true"></span>
            <span>Invite</span>
          </button>
        </div>
      </header>

      <!-- Skeleton rows — same row grid as the live list so the
           page paints in place. Reuses the global `.shimmer-block` /
           `.shimmer-circle` + `.association-users__skeleton-*`
           classes already used by the Association Users view. -->
      <div v-if="loading" class="event-officials__list association-users__list" aria-busy="true">
        <div
          v-for="i in 6"
          :key="`skeleton-${i}`"
          class="association-users__row event-officials__row association-users__row--skeleton"
        >
          <div class="association-users__row-identity">
            <span class="shimmer-circle association-users__skeleton-avatar"></span>
            <div class="association-users__skeleton-stack">
              <span class="shimmer-block association-users__skeleton-name"></span>
              <span class="shimmer-block association-users__skeleton-email"></span>
            </div>
          </div>
          <div class="association-users__row-permissions">
            <span class="shimmer-block association-users__skeleton-pill"></span>
            <span class="shimmer-block association-users__skeleton-pill"></span>
          </div>
          <span class="shimmer-block association-users__skeleton-pill association-users__skeleton-pill--action"></span>
        </div>
      </div>

      <div v-else-if="officials.length === 0" class="event-officials__empty">
        <p v-if="search.trim()">No officials match "{{ search }}".</p>
        <p v-else>No officials assigned yet. Click "Invite Official" to add the first one.</p>
      </div>

      <div v-else class="event-officials__list association-users__list">
        <div
          v-for="row in officials"
          :key="row.id"
          class="association-users__row event-officials__row"
        >
          <div class="association-users__row-identity">
            <TeamAvatar :name="row.name" :image-url="row.avatarUrl" size="md" />
            <div class="association-users__row-copy">
              <div class="association-users__row-name-line">
                <strong class="association-users__row-name">{{ row.name }}</strong>
              </div>
              <span class="event-officials__row-email">{{ row.email }}</span>
            </div>
          </div>

          <!-- Permission summary reuses the AssociationUsersView chip
               styling so the row reads as a sibling of the user list.
               Full Control short-circuits to a single chip with the
               `--full` modifier; otherwise individual permission chips
               render in granted order. The scoring-scope summary still
               carries its own tone since it's event-specific. -->
          <div class="association-users__row-permissions">
            <template v-if="row.fullControl">
              <span class="association-users__row-permission-chip association-users__row-permission-chip--full">
                Full Control · all permissions
              </span>
            </template>
            <template v-else>
              <span
                v-for="key in permissionKeysForRow(row)"
                :key="key"
                class="association-users__row-permission-chip"
              >{{ permLabel(key) }}</span>
              <span
                v-if="row.permissions.length === 0"
                class="association-users__row-permission-empty"
              >No permissions assigned</span>
            </template>
            <span v-if="scopeSummary(row)" class="association-users__row-event-chip">
              {{ scopeSummary(row) }}
            </span>
          </div>

          <div class="association-users__row-actions">
            <button
              type="button"
              class="association-users__row-menu-btn"
              :aria-label="`Actions for ${row.name}`"
              :aria-expanded="openMenuId === row.id ? 'true' : 'false'"
              @click.stop="toggleMenu(row.id)"
            >
              <AppIcon name="ellipsis" :size="16" />
            </button>
            <div v-if="openMenuId === row.id" class="association-users__row-menu" role="menu">
              <button
                type="button"
                class="association-users__row-menu-item"
                role="menuitem"
                @click="openEdit(row)"
              >Edit Access</button>
              <button
                type="button"
                class="association-users__row-menu-item association-users__row-menu-item--danger"
                role="menuitem"
                @click="onRevoke(row)"
              >Revoke Access</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <EventOfficialAccessModal
      :model-value="modalOpen"
      :user="modalUser"
      :event="modalEvent"
      :association-name="currentAssociation?.associationName || ''"
      :association-short-name="associationShortName"
      :exclude-user-ids="excludeUserIds"
      :save-handler="handleSave"
      @update:modelValue="modalOpen = $event"
    />
  </main>
</template>

<style scoped>
.event-officials {
  min-height: 100vh;
  /* No background — inherits the surrounding workspace surface
     (the body bg). Setting one here would just duplicate it. */
  display: flex;
  flex-direction: column;
}

/* Centered content column under the MatchGeni header — matches the
   layout the user wanted ("show the data in the center of the
   screen similar to the association users screen"). Tight vertical
   rhythm: the header reads as a normal page-level toolbar at rest,
   not a card, so we don't want extra top padding or a wide gap to
   the row list below. */
.event-officials__shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 12px 24px 20px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Invisible sentinel — sits in normal flow just above the sticky
   header. Once it leaves the viewport (user scrolls past it), the
   IntersectionObserver flips `toolbarStuck` and the header below
   acquires the "stuck" treatment. */
.event-officials__sticky-sentinel {
  width: 100%;
  height: 1px;
}

/* At rest the header is chromeless — content sits directly on the
   page background so its left/right edges align with the row card
   below. Vertical breathing room comes from the shell's flex `gap`,
   not from the header's own padding, so the row above (MatchGeni
   bar) and the list card below stay tightly stacked.

   When stuck (`--stuck`), the header acquires the standard white-
   card chrome + drop-shadow so the rows scrolling underneath don't
   bleed through. Padding flips on at the same moment so the
   contents don't hug the card edge while pinned. */
.event-officials__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0;
  position: sticky;
  top: 72px;
  z-index: 5;
  transition:
    background-color 180ms ease,
    box-shadow 180ms ease,
    border-color 180ms ease,
    padding 180ms ease;
  background: transparent;
  border: 1px solid transparent;
}

.event-officials__header--stuck {
  background: var(--white);
  border-color: var(--border-divider);
  box-shadow: 0 6px 14px rgba(36, 60, 91, 0.12);
  padding: 12px 18px;
}

.event-officials__count {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  color: var(--secondary);
}

.event-officials__count strong {
  font-size: 16px;
  color: var(--text);
}

.event-officials__header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.event-officials__search {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 36px;
  border-radius: 6px;
  background: var(--surface-muted, #eff3f8);
  color: var(--secondary);
}
html.dark-mode .event-officials__search {
  background: rgba(255, 255, 255, 0.06);
}

.event-officials__search-input {
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  color: var(--text);
  width: 200px;
}

/* Visual fill + hover come from the shared `.association-users__invite-btn`
   class — same solid `var(--primary)` styling the users-page Invite
   button uses. No gradient, dark-mode-aware. */
.event-officials__invite-btn {
  /* Inherits from .association-users__invite-btn */
}
/* Add icon — masked `add.svg`, painted in the button's label colour
   (`--white` = white in light, dark in dark mode, matching the label). */
.event-officials__invite-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: var(--white, #ffffff);
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
  mask: url('../assets/add.svg') center / contain no-repeat;
}

.event-officials__list {
  background: var(--white);
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  /* No `overflow: hidden` — it clips the absolutely-positioned per-row
     actions dropdown (`.association-users__row-menu`, which opens
     downward) when opened on the last / near-last rows, hiding the
     options. Matches the shared `.association-users__list`, which omits
     it for the same reason. The only side-effect is the last row's
     hover-tint extending a hair into the 8px bottom corners — negligible
     and worth keeping the menu usable. */
}

/* Override the shared .association-users__row grid so the rows
   inside this centered shell fit nicely. */
.event-officials__row.association-users__row {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
  padding: 14px 18px;
}

.event-officials__row-email {
  font-size: 12px;
  color: var(--secondary);
  margin-top: 2px;
}

/* Empty state — centered card, same shell as the live list so the
   page doesn't shift when officials get added. */
.event-officials__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px 24px;
  text-align: center;
  background: var(--white);
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}

@media (max-width: 720px) {
  .event-officials__shell {
    padding: 14px;
  }
  .event-officials__header {
    flex-wrap: wrap;
  }
  .event-officials__search-input {
    width: 140px;
  }
}
</style>
