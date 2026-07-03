<script setup lang="ts">
// EventOfficialAccessModal
// ------------------------
// Right-edge slide-in modal for granting / editing event-scoped
// access (Full Control + per-permission toggles) for a single user
// on a single event. Reusable across two flows:
//
//   1. User events popup → "Edit Access" — pre-fills with the user's
//      current grant on the event, save updates that grant.
//   2. Event details page → "Invite / Assign Official" (future) —
//      open with no existing grant, save creates one.
//
// The structure intentionally mirrors AssociationUserModal so the
// two modals feel like siblings.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import TagsMultiSelect from './TagsMultiSelect.vue'
import TeamAvatar from './TeamAvatar.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import { EVENT_PERMISSIONS } from '../constants/eventPermissions'
import { fetchAssociationUsers } from '../api/associationUsers'
import { fetchEventResources } from '../api/events'
import { updateEventOfficialAccess } from '../api/officialEvents'
import { currentAssociation } from '../constants/associations'
import { themeMode } from '../theme'
import { pushToast } from '../toast-center'

/** Deterministic colored-tile palette for events that don't have a
 *  banner image — same six hue families used in the association
 *  events listing + UserEventsModal so an event lands on the same
 *  colour across every surface that renders it. */
const lightEventHeroPalette = [
  { bg: '#fbe4e6', fg: '#bb5964' },
  { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' },
  { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' },
  { bg: '#e4f7f6', fg: '#3c8e89' }
]
const darkEventHeroPalette = [
  { bg: '#4a2530', fg: '#ff8a98' },
  { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' },
  { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' },
  { bg: '#1d3a3a', fg: '#6ec9c1' }
]
function eventHeroStyle(name: string | null | undefined): Record<string, string> {
  const safe = name ?? ''
  const hash = Array.from(safe).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkEventHeroPalette : lightEventHeroPalette
  const choice = palette[hash % palette.length]
  return {
    '--avatar-bg': choice.bg,
    '--avatar-fg': choice.fg
  }
}

/** True when an OfficialEvent has a usable image URL string. */
function hasEventImage(imageUrl: string | null | undefined): boolean {
  return typeof imageUrl === 'string' && imageUrl.trim() !== ''
}
import type {
  AssociationUser,
  Division,
  EventPermissionKey,
  OfficialEvent,
  Park,
  ScoringScope,
  ScoringScopeMode
} from '../types'

/** Shape of the payload the optional `saveHandler` receives — same
 *  fields the default `updateEventOfficialAccess` path uses, plus the
 *  resolved user (real for edit, picked-from-search for invite). */
export interface EventOfficialAccessSavePayload {
  user: AssociationUser
  fullControl: boolean
  permissions: EventPermissionKey[]
  scoringScope: ScoringScope | null
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** The user whose access is being managed. Pass `null` to open
   *  the modal in INVITE mode — the modal renders an internal user
   *  search-and-pick step before the permission form. */
  user?: AssociationUser | null
  /** The event the access applies to. Carries the user's current
   *  Full Control + permissions which are used to pre-fill the
   *  form. For Invite flows, the parent passes an OfficialEvent
   *  with `fullControl: false` and `permissions: []`. */
  event?: OfficialEvent | null
  /** Eyebrow above the modal title — usually the association name. */
  associationName?: string
  /** Optional override for the save action. When provided, the
   *  modal calls this with the resolved user + form payload and
   *  uses its return value as the `saved` emit's argument. Use it
   *  to plug in custom write paths (e.g. the MatchGeni Officials
   *  sub-page maps add/edit to `createEventOfficial` / `updateEventOfficial`
   *  per `matchgeni-officials-api-contract.md` §3 / §5). When omitted, the modal
   *  falls back to calling `updateEventOfficialAccess(eventId, officialId, payload)`
   *  against the event-scoped PUT route in `matchgeni-officials-api-contract.md`
   *  §5 — driven off `props.event.officialId` which the user-portal
   *  surface receives from `association-users-api-contract.md` §7. */
  saveHandler?: (payload: EventOfficialAccessSavePayload) => Promise<OfficialEvent>
  /** Association slug — required only when `user === null` so the
   *  internal user picker can call `fetchAssociationUsers`. */
  associationShortName?: string
  /** Association users to exclude from the picker results — typically
   *  users that already have a grant on this event (prevents
   *  double-granting via the invite flow). */
  excludeUserIds?: string[]
}>(), {
  user: null,
  event: null,
  associationName: '',
  saveHandler: undefined,
  associationShortName: '',
  excludeUserIds: () => []
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  /** Fired after a successful save. The hydrated OfficialEvent
   *  carries the new fullControl + permissions, ready to splice
   *  into the parent's list. */
  (event: 'saved', updated: OfficialEvent): void
}>()

// --- Invite mode state -------------------------------------------
// Active when `user === null`. The modal shows a search input + a
// hit list; clicking a hit stores it in `pickedUser` and unlocks the
// permission form. `effectiveUser` blends the prop and the picked
// user so the rest of the component reads from a single source.
const pickedUser = ref<AssociationUser | null>(null)
const searchTerm = ref('')
const searchResults = ref<AssociationUser[]>([])
const searching = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

const effectiveUser = computed<AssociationUser | null>(() => props.user ?? pickedUser.value)
const isInviteMode = computed(() => props.user === null)

watch(searchTerm, (next) => {
  if (searchTimer) clearTimeout(searchTimer)
  if (!isInviteMode.value) return
  if (pickedUser.value) return
  if (!next.trim()) {
    searchResults.value = []
    return
  }
  searchTimer = setTimeout(async () => {
    // The user-search endpoint expects the ASSOCIATION'S NUMERIC PK
    // (not the slug). `currentAssociation` is populated by the router
    // guard before any portal-context modal can open, so its id is
    // always available here. The legacy `props.associationShortName`
    // (slug) is no longer used for API calls — kept on the prop only
    // for backward compat with callers; will be retired in a follow-up.
    const associationId = currentAssociation.value?.id
    if (!associationId) return
    searching.value = true
    try {
      const page = await fetchAssociationUsers(associationId, {
        search: next.trim(),
        status: 'active',
        perPage: 8
      })
      searchResults.value = page.data.filter(
        (u) => !props.excludeUserIds.includes(u.id)
      )
    } finally {
      searching.value = false
    }
  }, 300)
})

function selectPickedUser(user: AssociationUser) {
  pickedUser.value = user
  searchTerm.value = ''
  searchResults.value = []
}

function clearPickedUser() {
  pickedUser.value = null
  searchResults.value = []
  searchTerm.value = ''
}

const fullControl = ref(false)
const permissions = ref<Set<EventPermissionKey>>(new Set())
const saving = ref(false)

// Scoring scope local state. When `manage_scoring` is granted
// and Full Control is off, the modal expands a picker that lets
// the admin restrict scoring to specific parks or divisions.
// Selections are kept as ID arrays (NOT names) so they survive
// renames; the dropdown options remap names ↔ ids on the fly.
const scoringMode = ref<ScoringScopeMode>('all')
const selectedParkIds = ref<string[]>([])
const selectedDivisionIds = ref<string[]>([])

// Per-event parks + divisions catalogue. Sourced from the §9
// event-resources endpoint, fetched whenever the modal opens for
// an event. The OfficialEvent payload coming in via `props.event`
// may carry these lists for backward compat (legacy mock data) —
// we fall back to it when the endpoint hasn't responded yet so the
// picker isn't blank on first paint. See
// `docs/api/association-events-api-contract.md` §9.
const loadedParks = ref<Park[]>([])
const loadedDivisions = ref<Division[]>([])
const resourcesLoading = ref(false)

const eventParks = computed<Park[]>(() =>
  loadedParks.value.length > 0 ? loadedParks.value : (props.event?.parks ?? [])
)
const eventDivisions = computed<Division[]>(() =>
  loadedDivisions.value.length > 0 ? loadedDivisions.value : (props.event?.divisions ?? [])
)

/** Pull the parks + divisions catalogue from the §9 endpoint and
 *  cache it on the local refs. Triggered whenever the modal opens
 *  with a valid (event, association) pair. Silent on failure —
 *  the picker degrades to the props-sourced lists (often empty),
 *  which the existing UI already handles via the empty-state copy
 *  inside the multi-selects. */
async function loadEventResources() {
  const associationId = currentAssociation.value?.id
  const eventId = props.event?.id
  if (!associationId || !eventId) {
    loadedParks.value = []
    loadedDivisions.value = []
    return
  }
  resourcesLoading.value = true
  try {
    const resources = await fetchEventResources(associationId, eventId, ['parks', 'divisions'])
    loadedParks.value = resources.parks ?? []
    loadedDivisions.value = resources.divisions ?? []
  } catch {
    // Silent fallback — see comment above. The modal stays usable
    // (mode pills still toggle, save still works for "All games").
    loadedParks.value = []
    loadedDivisions.value = []
  } finally {
    resourcesLoading.value = false
  }
}

const parksAvailable = computed(() => eventParks.value.length > 0)
const divisionsAvailable = computed(() => eventDivisions.value.length > 0)

// Only manage_scoring is expandable for v1. Showing the scope
// picker hangs on two things:
//   1. The permission is granted (in the local set).
//   2. Full Control is OFF (FC implies all-games-everywhere).
//
// The mode-toggle pills (All / Parks / Divisions) are ALWAYS visible
// when those two are true — admins should be able to switch the mode
// even if the event-resources API hasn't loaded the parks / divisions
// catalogue yet. The downstream multi-select for items handles its
// own empty state separately (see `scopeError` + the inline picker
// templates) so saving stays blocked until at least one item is
// picked, but the choice between modes is never blocked just because
// the catalogue arrays are empty.
const scoringExpanded = computed(() =>
  !fullControl.value && permissions.value.has('manage_scoring')
)

// Bridge ID arrays to NAME arrays for MultiSelectDropdown (which
// works in string-label terms). The setter remaps names back to
// ids so the canonical state stays ID-based.
const parkLabels = computed(() => eventParks.value.map((p) => p.name))
const divisionLabels = computed(() => eventDivisions.value.map((d) => d.name))

const selectedParkLabels = computed<string[]>({
  get: () => {
    const byId = new Map(eventParks.value.map((p) => [p.id, p.name]))
    return selectedParkIds.value
      .map((id) => byId.get(id))
      .filter((name): name is string => Boolean(name))
  },
  set: (labels) => {
    const byName = new Map(eventParks.value.map((p) => [p.name, p.id]))
    selectedParkIds.value = labels
      .map((name) => byName.get(name))
      .filter((id): id is string => Boolean(id))
  }
})

const selectedDivisionLabels = computed<string[]>({
  get: () => {
    const byId = new Map(eventDivisions.value.map((d) => [d.id, d.name]))
    return selectedDivisionIds.value
      .map((id) => byId.get(id))
      .filter((name): name is string => Boolean(name))
  },
  set: (labels) => {
    const byName = new Map(eventDivisions.value.map((d) => [d.name, d.id]))
    selectedDivisionIds.value = labels
      .map((name) => byName.get(name))
      .filter((id): id is string => Boolean(id))
  }
})

function setScoringMode(mode: ScoringScopeMode) {
  // Mode switch is always allowed — even when the parks /
  // divisions catalogue hasn't loaded yet. The downstream item
  // multi-select shows its own empty-state copy in that case;
  // `scopeError` then blocks saving until the admin either
  // picks at least one item or switches back to "All games".
  scoringMode.value = mode
  // Switching modes clears the OTHER list — picker stays in the
  // exclusive mode the admin just chose.
  if (mode !== 'parks') selectedParkIds.value = []
  if (mode !== 'divisions') selectedDivisionIds.value = []
}

/** Validation for the scoring scope picker. Returns a human-
 *  readable error string when the admin picked "Specific parks" /
 *  "Specific divisions" but hasn't selected anything — `null`
 *  otherwise (including when scoring is off, when mode is "All
 *  games", or when the catalogue isn't loaded yet).
 *
 *  This is computed unconditionally so save flows can probe it,
 *  but the inline hint in the picker is rendered only AFTER a
 *  failed save attempt (see `scopeHintVisible` below) — admins
 *  shouldn't see a red error message just because they opened
 *  the modal in a transient empty-picker state. */
const scopeError = computed<string | null>(() => {
  if (!scoringExpanded.value) return null
  if (scoringMode.value === 'parks' && selectedParkIds.value.length === 0) {
    return 'Select one or more parks or switch back to "All games".'
  }
  if (scoringMode.value === 'divisions' && selectedDivisionIds.value.length === 0) {
    return 'Select one or more divisions or switch back to "All games".'
  }
  return null
})

/** Whether the picker's red validation hint should be visible.
 *  Flipped to true when the admin tries to Save with an empty
 *  parks/divisions selection; flipped back to false whenever the
 *  user makes progress (picks an item, switches mode, toggles
 *  scoring) so the hint doesn't linger once the issue is fixed. */
const scopeHintVisible = ref(false)
watch(scopeError, (next) => {
  // Auto-dismiss the hint the moment the error condition clears.
  if (next === null) scopeHintVisible.value = false
})

/** When Full Control turns ON, the scope picker is hidden (FC
 *  implicitly grants every game everywhere). Reset the local
 *  scope state to "all games" so the saved record is consistent
 *  with what the UI implies — the next time FC is toggled off,
 *  the picker shows All Games as the active mode rather than
 *  resurrecting stale park/division picks. */
watch(fullControl, (isOn) => {
  if (!isOn) return
  scoringMode.value = 'all'
  selectedParkIds.value = []
  selectedDivisionIds.value = []
})

const title = computed(() =>
  isInviteMode.value && !pickedUser.value
    ? 'Invite Event Official'
    : 'Edit Event Access'
)

// Subtitle now carries the association name — the eyebrow row above
// the title is suppressed for this modal so the header is a single
// title + subtitle block (less vertical chrome before the body).
const subtitle = computed(() => props.associationName)

/** Hydrate the form whenever the modal opens or the source data
 *  changes. Also resets the user-picker state in invite mode so a
 *  re-opened modal starts fresh. */
function hydrate() {
  if (props.event) {
    fullControl.value = props.event.fullControl
    permissions.value = new Set(props.event.permissions)
    const scope = props.event.scoringScope
    scoringMode.value = scope?.mode ?? 'all'
    selectedParkIds.value = scope ? [...scope.parkIds] : []
    selectedDivisionIds.value = scope ? [...scope.divisionIds] : []
  } else {
    fullControl.value = false
    permissions.value = new Set()
    scoringMode.value = 'all'
    selectedParkIds.value = []
    selectedDivisionIds.value = []
  }
  // Re-opening the modal shouldn't carry a stale red hint over
  // from the last session — the admin hasn't tried to save yet
  // in THIS session, so the validation cue stays hidden until
  // they actually attempt one.
  scopeHintVisible.value = false
  if (isInviteMode.value) {
    pickedUser.value = null
    searchTerm.value = ''
    searchResults.value = []
  }
}

// Single combined watcher over [modelValue, event.id] so opening
// the modal for a new event only triggers ONE `loadEventResources`
// call. The previous two-watcher setup (one on `modelValue`, one
// on `props.event`) both fired in the same tick when the parent
// flipped `modelValue` true AND passed a new event together — Vue
// batches the source updates but each watcher's callback ran
// independently, producing two parallel `/resources` requests.
//
// The new handler only acts when the modal is open AND either:
//   - the modal just opened this tick (prev `open` was false), or
//   - the event id changed while the modal was already open
// — so re-renders that touch unrelated props don't re-fetch.
watch(
  [() => props.modelValue, () => props.event?.id ?? null],
  ([open, eventId], prev) => {
    if (!open) return
    const prevOpen = prev?.[0] ?? false
    const prevEventId = prev?.[1] ?? null
    const justOpened = open && !prevOpen
    const eventChanged = open && prevOpen && eventId !== prevEventId
    if (!justOpened && !eventChanged) return
    hydrate()
    loadEventResources()
  }
)

function togglePermission(key: EventPermissionKey, value: boolean) {
  // Full Control overrides individual toggles — guard so a stray
  // click can't mutate the underlying selection while disabled.
  if (fullControl.value) return
  const next = new Set(permissions.value)
  if (value) next.add(key)
  else next.delete(key)
  permissions.value = next
  // Reset the scoring scope when the user revokes the scoring
  // permission so a re-grant later starts fresh from "all games"
  // instead of resurrecting stale park/division picks.
  if (key === 'manage_scoring' && !value) {
    scoringMode.value = 'all'
    selectedParkIds.value = []
    selectedDivisionIds.value = []
  }
}

function close() {
  if (saving.value) return
  emit('update:modelValue', false)
}

async function save() {
  const user = effectiveUser.value
  if (saving.value || !user || !props.event) return
  // Scope sanity check — when the admin picked "Specific parks"
  // or "Specific divisions" without selecting any items, reveal
  // the inline hint inside the picker and abort. This is the
  // only client-side validation we run: it's a hard "pick or
  // switch back" prompt and saving with empty selection would
  // either get rejected by the backend or silently produce a
  // scope that grants scoring to nothing. The hint clears
  // automatically once the admin makes progress (picks an item,
  // switches mode, or toggles scoring off).
  if (scopeError.value) {
    scopeHintVisible.value = true
    return
  }
  saving.value = true
  try {
    const scoringScope: ScoringScope | null = permissions.value.has('manage_scoring')
      ? {
          mode: scoringMode.value,
          parkIds: scoringMode.value === 'parks' ? [...selectedParkIds.value] : [],
          divisionIds: scoringMode.value === 'divisions' ? [...selectedDivisionIds.value] : []
        }
      : null
    const payload: EventOfficialAccessSavePayload = {
      user,
      fullControl: fullControl.value,
      permissions: [...permissions.value],
      scoringScope
    }
    let updated: OfficialEvent
    if (props.saveHandler) {
      updated = await props.saveHandler(payload)
    } else {
      // Fallback path: user-portal `UserEventsModal` opens the modal
      // without a save handler. The OfficialEvent the parent passed in
      // carries `officialId` (sourced from association-users-api §7),
      // which is exactly what the event-scoped write endpoint in
      // matchgeni-officials-api-contract §5 expects.
      if (!props.event.officialId) {
        throw new Error('Cannot save: event row is missing its grant id (officialId).')
      }
      updated = await updateEventOfficialAccess(
        currentAssociation.value?.id ?? '',
        props.event.id,
        props.event.officialId,
        {
          fullControl: payload.fullControl,
          permissions: payload.permissions,
          scoringScope: scoringScope ?? undefined
        }
      )
    }
    emit('saved', updated)
    emit('update:modelValue', false)
    pushToast({
      tone: 'success',
      title: 'Access updated',
      message: `${user.name}'s access on ${props.event.name} has been saved.`
    })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not save',
      message: error instanceof Error ? error.message : 'Something went wrong while saving the access.'
    })
  } finally {
    saving.value = false
  }
}

const submitLabel = computed(() => (saving.value ? 'Saving…' : 'Save Changes'))
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    :title="title"
    :subtitle="subtitle"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <!-- Section 1 — Access connection. User card on the left, event
         card on the right, an arrow in between visualising "this
         user has access TO this event". In INVITE mode the user card
         is replaced with a search-and-pick step until a user is
         chosen; the rest of the form stays gated behind that pick. -->
    <section v-if="event" class="association-user-modal__section">
      <div class="event-access-modal__connection">
        <!-- User card OR invite picker -->
        <div v-if="effectiveUser" class="event-access-modal__connection-card">
          <TeamAvatar :name="effectiveUser.name" :image-url="effectiveUser.avatarUrl" size="md" />
          <div class="event-access-modal__connection-meta">
            <strong class="event-access-modal__connection-title">{{ effectiveUser.name }}</strong>
            <span class="event-access-modal__connection-sub">{{ effectiveUser.email }}</span>
          </div>
          <button
            v-if="isInviteMode"
            type="button"
            class="event-access-modal__change-user-btn"
            @click="clearPickedUser"
          >Change</button>
        </div>
        <div v-else class="event-access-modal__connection-card event-access-modal__connection-card--picker">
          <input
            v-model="searchTerm"
            type="search"
            class="event-access-modal__user-search"
            placeholder="Search active users"
            aria-label="Search association users"
          />
          <ul v-if="searchResults.length > 0" class="event-access-modal__user-results">
            <li
              v-for="hit in searchResults"
              :key="hit.id"
              class="event-access-modal__user-result"
            >
              <button
                type="button"
                class="event-access-modal__user-result-btn"
                @click="selectPickedUser(hit)"
              >
                <TeamAvatar :name="hit.name" :image-url="hit.avatarUrl" size="sm" />
                <span class="event-access-modal__user-result-text">
                  <strong>{{ hit.name }}</strong>
                  <small>{{ hit.email }}</small>
                </span>
              </button>
            </li>
          </ul>
          <p v-else-if="searchTerm.trim() && !searching" class="event-access-modal__user-empty">
            No active members match "{{ searchTerm }}".
          </p>
          <p v-else class="event-access-modal__user-hint">
            Search active users to grant access to this event.
          </p>
        </div>

        <!-- Arrow indicator. Inline SVG so we can paint it via
             currentColor (the wrapper sets the muted secondary
             color) without shipping another asset. -->
        <span class="event-access-modal__connection-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 12h14"></path>
            <path d="M13 6l6 6-6 6"></path>
          </svg>
        </span>

        <!-- Event card. Events without a banner image fall back to
             a deterministic colored tile carrying the calendar
             glyph — same palette + icon treatment as the
             association events listing + UserEventsModal so the
             same event reads identically across every surface. -->
        <div class="event-access-modal__connection-card event-access-modal__connection-card--event">
          <img
            v-if="hasEventImage(event.imageUrl)"
            :src="event.imageUrl"
            alt=""
            aria-hidden="true"
            class="event-access-modal__connection-thumbnail"
          />
          <div
            v-else
            class="event-access-modal__connection-thumbnail event-access-modal__connection-thumbnail--initial"
            :style="eventHeroStyle(event.name)"
            aria-hidden="true"
          >
            <span class="event-access-modal__connection-thumbnail-icon" aria-hidden="true"></span>
          </div>
          <div class="event-access-modal__connection-meta">
            <span class="event-access-modal__connection-sub">{{ event.dateRange }}</span>
            <strong class="event-access-modal__connection-title">{{ event.name }}</strong>
            <span class="event-access-modal__connection-sub">{{ event.location }}</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3 — Permissions. Same Full Control + toggle grid
         layout as AssociationUserModal, just bound to the event-
         scoped permission catalog. Gated on a resolved user so the
         invite flow surfaces permissions only after a pick. -->
    <section v-if="effectiveUser" class="association-user-modal__section">
      <header class="association-user-modal__section-head">
        <h3 class="association-user-modal__section-title">Permissions</h3>
        <div class="association-user-modal__full-control">
          <span class="association-user-modal__full-control-label">Full Control</span>
          <ToggleSwitch
            :model-value="fullControl"
            aria-label="Full Control"
            @update:modelValue="fullControl = $event"
          />
        </div>
      </header>

      <!-- Full Control warning — migrated to the shared
           `.app-banner app-banner--warning` utility in
           `src/styles.css`. See `AssociationUserModal.vue` for the
           sibling banner that uses the same component on the
           association-scope modal. -->
      <div v-if="fullControl" class="app-banner app-banner--warning">
        <div class="app-banner__text">
          <span class="app-banner__sub">
            This user has full control on this event — every permission below is granted.
            Toggle Full Control off to fine-tune individual permissions.
          </span>
        </div>
      </div>

      <div class="association-user-modal__permissions-grid">
        <template v-for="permission in EVENT_PERMISSIONS" :key="permission.key">
          <!-- Manage Scoring with scope picker active: render a
               single card (`<div>`) that contains BOTH the toggle
               row AND the inline scope expansion below it. The
               outer card chrome is shared so the picker reads as
               part of the same permission, not a sibling block. -->
          <div
            v-if="permission.key === 'manage_scoring' && scoringExpanded"
            class="association-user-modal__permission association-user-modal__permission--expanded"
            :class="{ 'association-user-modal__permission--disabled': fullControl }"
          >
            <label class="association-user-modal__permission-row">
              <span class="association-user-modal__permission-copy">
                <span class="association-user-modal__permission-label">{{ permission.label }}</span>
                <span class="association-user-modal__permission-description">{{ permission.description }}</span>
              </span>
              <ToggleSwitch
                :model-value="fullControl ? true : permissions.has(permission.key)"
                :disabled="fullControl"
                :aria-label="permission.label"
                @update:modelValue="togglePermission(permission.key, $event)"
              />
            </label>

            <div class="event-access-modal__scope">
              <div
                class="event-access-modal__scope-pills"
                role="tablist"
                aria-label="Scoring scope"
              >
                <button
                  type="button"
                  role="tab"
                  :aria-selected="scoringMode === 'all' ? 'true' : 'false'"
                  class="team-lifecycle-filter-pill"
                  :class="{ 'team-lifecycle-filter-pill--active': scoringMode === 'all' }"
                  @click="setScoringMode('all')"
                >All games</button>
                <!-- The pills are ALWAYS clickable. If the parks /
                     divisions catalogue isn't loaded yet (per-user
                     events listing doesn't return them — the
                     resources API lands separately), the admin can
                     still pick a mode; the item picker below shows
                     an empty-catalogue hint until the data arrives. -->
                <button
                  type="button"
                  role="tab"
                  :aria-selected="scoringMode === 'parks' ? 'true' : 'false'"
                  class="team-lifecycle-filter-pill"
                  :class="{ 'team-lifecycle-filter-pill--active': scoringMode === 'parks' }"
                  @click="setScoringMode('parks')"
                >Specific parks</button>
                <button
                  type="button"
                  role="tab"
                  :aria-selected="scoringMode === 'divisions' ? 'true' : 'false'"
                  class="team-lifecycle-filter-pill"
                  :class="{ 'team-lifecycle-filter-pill--active': scoringMode === 'divisions' }"
                  @click="setScoringMode('divisions')"
                >Specific divisions</button>
              </div>

              <div
                v-if="scoringMode === 'parks'"
                class="event-access-modal__scope-picker"
              >
                <TagsMultiSelect
                  v-model="selectedParkLabels"
                  :options="parkLabels"
                  placeholder="Type to pick parks…"
                  aria-label="Pick parks"
                />
                <!-- Validation hint — surfaced only AFTER the admin
                     attempts to Save with an empty parks selection
                     (via `scopeHintVisible`). Disappears the moment
                     they pick something, switch mode, or toggle
                     scoring off (see `scopeError` watch). -->
                <p
                  v-if="scopeHintVisible && scoringMode === 'parks' && selectedParkIds.length === 0"
                  class="event-access-modal__scope-hint"
                >Select one or more parks or switch back to "All games".</p>
              </div>

              <div
                v-else-if="scoringMode === 'divisions'"
                class="event-access-modal__scope-picker"
              >
                <TagsMultiSelect
                  v-model="selectedDivisionLabels"
                  :options="divisionLabels"
                  placeholder="Type to pick divisions…"
                  aria-label="Pick divisions"
                />
                <p
                  v-if="scopeHintVisible && scoringMode === 'divisions' && selectedDivisionIds.length === 0"
                  class="event-access-modal__scope-hint"
                >Select one or more divisions or switch back to "All games".</p>
              </div>
            </div>
          </div>

          <!-- Standard toggle row for every other permission AND
               for scoring when the scope picker is collapsed. -->
          <label
            v-else
            class="association-user-modal__permission"
            :class="{ 'association-user-modal__permission--disabled': fullControl }"
          >
            <span class="association-user-modal__permission-copy">
              <span class="association-user-modal__permission-label">{{ permission.label }}</span>
              <span class="association-user-modal__permission-description">{{ permission.description }}</span>
            </span>
            <ToggleSwitch
              :model-value="fullControl ? true : permissions.has(permission.key)"
              :disabled="fullControl"
              :aria-label="permission.label"
              @update:modelValue="togglePermission(permission.key, $event)"
            />
          </label>
        </template>
      </div>
    </section>

    <template #footer>
      <button class="secondary-button" type="button" :disabled="saving" @click="close">
        Cancel
      </button>
      <button
        class="primary-button"
        type="button"
        :disabled="saving || !effectiveUser || !event"
        @click="save"
      >
        <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
        {{ submitLabel }}
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
/* Invite-mode picker — replaces the left "user card" with a search
   field + hit list until a user is picked. The rest of the modal's
   styling comes from styles.css (event-access-modal__*). */
.event-access-modal__connection-card--picker {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
  /* Positioning context for the absolute-anchored results list
     below — the dropdown floats over content beneath the picker
     instead of pushing siblings down as hits arrive. */
  position: relative;
}

.event-access-modal__user-search {
  width: 100%;
  height: 38px;
  padding: 0 12px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted);
  font: inherit;
  color: var(--text);
}

.event-access-modal__user-search::placeholder {
  color: var(--text-light);
}

.event-access-modal__user-search:focus {
  outline: none;
  border-color: var(--primary);
  background: var(--surface-card);
}

/* Suggestion dropdown — absolutely positioned just below the search
   input so it overlays whatever follows. Keeps the picker card a
   fixed height as the user types, preventing the modal body from
   reflowing on every keystroke. */
.event-access-modal__user-results {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border-divider);
  border-radius: 6px;
  background: var(--white);
  max-height: 240px;
  overflow-y: auto;
  position: absolute;
  top: calc(38px + 6px);
  left: 0;
  right: 0;
  z-index: 5;
  box-shadow: 0 8px 24px rgba(13, 30, 58, 0.12);
}

.event-access-modal__user-result + .event-access-modal__user-result {
  border-top: 1px solid var(--border-subtle, var(--border-divider));
}

.event-access-modal__user-result-btn {
  appearance: none;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.event-access-modal__user-result-btn:hover {
  background: var(--surface-muted);
}

.event-access-modal__user-result-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.event-access-modal__user-result-text strong {
  font-size: 13px;
  color: var(--text);
}

.event-access-modal__user-result-text small {
  font-size: 11px;
  color: var(--secondary);
}

.event-access-modal__user-empty,
.event-access-modal__user-hint {
  margin: 0;
  font-size: 12px;
  color: var(--secondary);
  text-align: center;
  padding: 6px 0;
}

/* "Change" pill in invite mode — sits inside the user card and lets
   the admin swap to a different user before saving the grant. */
.event-access-modal__change-user-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border-divider);
  color: var(--text);
  border-radius: 6px;
  padding: 4px 10px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.event-access-modal__change-user-btn:hover {
  background: var(--surface-muted);
}
</style>
