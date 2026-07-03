<script setup lang="ts">
// MatchGeniNotificationsView
// --------------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/notifications
//
// MatchGeni sub-page listing every notification sent for this event
// (event-wide composer + per-division sends), newest first. Reuses the
// portal-wide list surface (AssociationUsers / Events / Teams): a sticky
// header (count + search + "New") above a filter toolbar, then ONE list
// card whose rows are the data. Filters: Category (select), Recipient
// (segmented), Channel (segmented) — all existing, finalized controls.
//
// "New" opens the shared event-wide composer (hosted once in
// MatchGeniEventLayout). When the composer closes, this page reloads so a
// freshly-sent notification shows up immediately.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import MultiSelectDropdown from '../components/MultiSelectDropdown.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { fetchAllNotifications } from '../api/matchGeniNotifications'
import { currentAssociation } from '../constants/associations'
import { ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import { useNotifyCenter, openNotifications } from '../matchgeni-notify-center'
import { formatCompact } from '../utils/formatNumber'
import type {
  NotificationAudienceType,
  NotificationCategory,
  NotificationChannel,
  TeamNotification
} from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() => (route.params.eventId as string | undefined) ?? '')
const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')

const notifyOpen = useNotifyCenter()

const notifications = ref<TeamNotification[]>([])
const loading = ref(true)
const search = ref('')

// ── Filters ──────────────────────────────────────────────────────
// Category + Recipient are MULTI-SELECT dropdowns (same MultiSelectDropdown
// the Teams / Events filters use) — empty = no filter (show all). Channel
// stays a segmented switch (All / In-app / Email). Dropdowns work in display
// labels; we map labels → enum values for filtering.
const categoryFilter = ref<string[]>([])
const audienceFilter = ref<string[]>([])
// Channel — single-select dropdown (label array; 0 or 1 entry). Empty = no
// filter; "Both" maps to 'all' which is also no filter (acts as the reset).
const channelFilter = ref<string[]>([])

const CATEGORY_OPTIONS: { value: NotificationCategory; label: string }[] = [
  { value: 'result', label: 'Result' },
  { value: 'schedule_change', label: 'Schedule' },
  { value: 'custom', label: 'Message' },
  { value: 'payment_reminder', label: 'Payment' },
  { value: 'registration_reminder', label: 'Registration' },
  { value: 'promotion', label: 'Promotion' }
]
const AUDIENCE_OPTIONS: { value: NotificationAudienceType; label: string }[] = [
  { value: 'teams', label: 'Teams' },
  { value: 'officials', label: 'Officials' },
  { value: 'umpires', label: 'Umpires' }
]
const CHANNEL_OPTIONS: { value: 'all' | NotificationChannel; label: string }[] = [
  { value: 'in_app', label: 'In-app' },
  { value: 'email', label: 'Email' },
  { value: 'all', label: 'Both' }
]
const CATEGORY_LABELS = CATEGORY_OPTIONS.map((o) => o.label)
const AUDIENCE_LABELS = AUDIENCE_OPTIONS.map((o) => o.label)
const CHANNEL_LABELS = CHANNEL_OPTIONS.map((o) => o.label)
const CATEGORY_BY_LABEL = new Map(CATEGORY_OPTIONS.map((o) => [o.label, o.value]))
const AUDIENCE_BY_LABEL = new Map(AUDIENCE_OPTIONS.map((o) => [o.label, o.value]))
const CHANNEL_BY_LABEL = new Map(CHANNEL_OPTIONS.map((o) => [o.label, o.value]))

/** Resolved channel filter — the picked label mapped to its value;
 *  'all' (or nothing picked) means no channel filter. */
const selectedChannel = computed<'all' | NotificationChannel>(
  () => (channelFilter.value[0] ? CHANNEL_BY_LABEL.get(channelFilter.value[0]) : 'all') ?? 'all'
)

const selectedCategories = computed(
  () => categoryFilter.value.map((l) => CATEGORY_BY_LABEL.get(l)).filter(Boolean) as NotificationCategory[]
)
const selectedAudiences = computed(
  () => audienceFilter.value.map((l) => AUDIENCE_BY_LABEL.get(l)).filter(Boolean) as NotificationAudienceType[]
)
const anyFilterActive = computed(
  () => categoryFilter.value.length > 0 || audienceFilter.value.length > 0 ||
    selectedChannel.value !== 'all' || !!search.value.trim()
)

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const cats = selectedCategories.value
  const auds = selectedAudiences.value
  return notifications.value.filter((n) => {
    const ch = selectedChannel.value
    if (cats.length && !cats.includes(n.category)) return false
    if (auds.length && !auds.includes(n.audienceType)) return false
    if (ch !== 'all' && !n.channels.includes(ch)) return false
    if (q && !(
      n.subject.toLowerCase().includes(q) ||
      n.body.toLowerCase().includes(q) ||
      n.recipientSummary.toLowerCase().includes(q)
    )) return false
    return true
  })
})

// ── Sticky toolbar drop-shadow (shared pattern) ──────────────────
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

let fetchToken = 0
async function load() {
  const myToken = ++fetchToken
  loading.value = true
  try {
    // Entry gate only — Notifications is available to anyone with matchgeni
    // access (no per-page permission key), matching the rail.
    const ok = await ensureMatchGeniAccess(
      router,
      currentAssociation.value?.id ?? '',
      eventId.value,
      associationShortName.value
    )
    if (myToken !== fetchToken) return
    if (!ok) {
      notifications.value = []
      return
    }
    const list = await fetchAllNotifications()
    if (myToken !== fetchToken) return
    notifications.value = list
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Load notifications failed:', err)
    if (myToken === fetchToken) notifications.value = []
  } finally {
    if (myToken === fetchToken) loading.value = false
  }
}

watch([associationShortName, eventId], load)
// Reload when the composer closes (a send may have just landed).
watch(notifyOpen, (open, was) => {
  if (was && !open) void load()
})

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => { toolbarStuck.value = !entry.isIntersecting },
      { threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  void load()
})

onBeforeUnmount(() => {
  if (stickyObserver) stickyObserver.disconnect()
})

function openComposer() {
  openNotifications()
}

// ── Display helpers ──────────────────────────────────────────────
const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  result: 'Result', schedule_change: 'Schedule', custom: 'Message',
  payment_reminder: 'Payment', registration_reminder: 'Registration', promotion: 'Promotion'
}
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'
const CATEGORY_TONE: Record<NotificationCategory, BadgeTone> = {
  result: 'success', schedule_change: 'warning', custom: 'neutral',
  payment_reminder: 'danger', registration_reminder: 'info', promotion: 'secondary'
}
const AUDIENCE_LABEL: Record<NotificationAudienceType, string> = {
  teams: 'Teams', officials: 'Officials', umpires: 'Umpires'
}
function channelsLabel(list: NotificationChannel[]): string {
  return list.map((c) => (c === 'in_app' ? 'In-app' : 'Email')).join(' · ')
}
function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
</script>

<template>
  <main class="mg-notifications">
    <MatchGeniHeader
      variant="sub-page"
      title="Notifications"
      :subtitle="eventName"
      :event-id="eventId"
    />

    <section class="mg-notifications__shell">
      <!-- Sentinel above the sticky stack — toggles the stuck shadow once the
           whole header+toolbar stack pins to the top. -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>

      <div
        class="association-teams__sticky-stack mg-notifications__stack"
        :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
      >
        <header class="association-users__header">
          <p class="association-users__count">
            <strong :title="`${notifications.length} notifications`">{{ formatCompact(notifications.length) }}</strong>
            <span>notifications</span>
          </p>
          <div class="association-teams__header-actions">
            <label class="association-users__search">
              <AppIcon name="search" :size="14" />
              <input
                v-model="search"
                type="search"
                placeholder="Search notifications"
                class="association-users__search-input"
              />
            </label>
            <button class="association-users__invite-btn" type="button" @click="openComposer">
              <span class="mg-notifications__add-icon" aria-hidden="true"></span>
              <span>New</span>
            </button>
          </div>
        </header>

        <!-- Filter toolbar — the card "header" sitting above the list rows.
             Category + Recipient are multi-select dropdowns (empty = all);
             Channel is a segmented switch. -->
        <div class="association-users__toolbar association-teams__toolbar mg-notifications__toolbar">
          <MultiSelectDropdown
            v-model="categoryFilter"
            :options="CATEGORY_LABELS"
            placeholder="Category"
            :searchable="false"
            aria-label="Filter by category"
          />
          <MultiSelectDropdown
            v-model="audienceFilter"
            :options="AUDIENCE_LABELS"
            placeholder="Recipient"
            :searchable="false"
            aria-label="Filter by recipient"
          />
          <MultiSelectDropdown
            v-model="channelFilter"
            :options="CHANNEL_LABELS"
            placeholder="Channel"
            :searchable="false"
            single
            aria-label="Filter by channel"
          />
        </div>
      </div>

      <!-- Skeleton rows -->
      <div v-if="loading" class="association-users__list" aria-busy="true">
        <div v-for="i in 6" :key="`skeleton-${i}`" class="association-users__row mg-notif-row">
          <div class="mg-notif-row__main">
            <span class="shimmer-block mg-notif-row__skel-subject"></span>
            <span class="shimmer-block mg-notif-row__skel-meta"></span>
          </div>
          <span class="shimmer-block mg-notif-row__skel-time"></span>
        </div>
      </div>

      <div v-else-if="filtered.length === 0" class="association-users__empty mg-notifications__empty">
        <p v-if="anyFilterActive">No notifications match your filters.</p>
        <template v-else>
          <p>No notifications sent yet.</p>
          <button class="association-users__invite-btn" type="button" @click="openComposer">
            <span aria-hidden="true">+</span>
            <span>New notification</span>
          </button>
        </template>
      </div>

      <div v-else class="association-users__list">
        <div v-for="n in filtered" :key="n.id" class="association-users__row mg-notif-row">
          <div class="mg-notif-row__main">
            <div class="mg-notif-row__top">
              <StatusBadge :label="CATEGORY_LABEL[n.category]" :tone="CATEGORY_TONE[n.category]" />
              <span class="mg-notif-row__subject">{{ n.subject }}</span>
            </div>
            <p v-if="n.body" class="mg-notif-row__body">{{ n.body }}</p>
            <p class="mg-notif-row__meta">
              {{ AUDIENCE_LABEL[n.audienceType] }}
              · {{ channelsLabel(n.channels) }}
              · {{ n.recipientSummary }}
            </p>
          </div>
          <span class="mg-notif-row__time">{{ relativeTime(n.createdAt) }}</span>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.mg-notifications {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Centered content column under the MatchGeni header — same shell width the
   other portal list pages use. */
/* Add icon — masked `add.svg`, painted in the button's label colour
   (`--white` = white in light, dark in dark mode, matching the label). */
.mg-notifications__add-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: var(--white, #ffffff);
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
  mask: url('../assets/add.svg') center / contain no-repeat;
}

.mg-notifications__shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 12px 24px 20px;
  width: 100%;
  display: flex;
  flex-direction: column;
  /* `gap: 0` (like `.association-users__main`) so the filter toolbar's
     rounded-bottom-0 card joins the list card flush — no gap at the top.
     The count header carries its own `margin-bottom` for separation. */
  gap: 0;
}

/* Pin the shared sticky stack under the matchgeni header (the global
   `.association-teams__sticky-stack` uses `top: 0`, tuned for the
   association layout — here the header is the sticky chrome above us). */
.mg-notifications__stack {
  top: var(--matchgeni-header-height, 56px);
}
/* When stuck, the pinned bar gets a full L/R/top border (officials-style)
   on top of the shared white-card + drop-shadow. Square corners (no
   rounding) while sticky — it reads as a flat band connecting down into the
   list (no bottom border). */
.mg-notifications__stack.association-teams__sticky-stack--stuck {
  border: 1px solid var(--border-divider);
  border-bottom: 0;
  border-radius: 0;
}
/* Dark mode: the shared `--stuck` shadow is a blue-slate tint that reads
   bluish on the dark surface — swap it for the app's neutral dark drop-
   shadow (same colour used by the poolplay / scheduler stuck bars). */
html.dark-mode .mg-notifications__stack.association-teams__sticky-stack--stuck {
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45);
}

/* Filter toolbar — left-aligned groups that wrap on narrow widths (the
   shared toolbar defaults to space-between for a single trailing control).
   Keep it static; the stack wrapper owns the stickiness. */
.mg-notifications__toolbar {
  position: static;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
}

/* Match the Officials page count sizing (the shared `.association-users__count`
   uses a large 1.5rem number; Officials reads 16px / 14px). */
.mg-notifications__shell :deep(.association-users__count) { font-size: 14px; }
.mg-notifications__shell :deep(.association-users__count strong) { font-size: 16px; }

/* ── Notification row — reuses `.association-users__row` chrome (padding,
   border, hover) but a 2-column grid: content + timestamp. ── */
.mg-notif-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 16px;
}
.mg-notif-row__main { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.mg-notif-row__top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mg-notif-row__subject {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mg-notif-row__body {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-muted);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.mg-notif-row__meta { margin: 0; font-size: 0.78rem; color: var(--secondary); }
.mg-notif-row__time { font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; padding-top: 2px; }

/* Skeleton bars inside the row grid. */
.mg-notif-row__skel-subject { display: block; width: 55%; height: 14px; border-radius: 6px; }
.mg-notif-row__skel-meta { display: block; width: 38%; height: 11px; border-radius: 6px; }
.mg-notif-row__skel-time { width: 48px; height: 11px; border-radius: 6px; }

.mg-notifications__empty { color: var(--secondary); }

@media (max-width: 720px) {
  /* Full-bleed on mobile — drop the side gutter so the list + stuck bar
     span edge to edge; the header (which has no padding of its own) gets
     a 16px inset so its text doesn't hit the screen edge (the toolbar +
     rows already carry their own horizontal padding). */
  .mg-notifications__shell { padding: 14px 0; }
  .mg-notifications__shell :deep(.association-users__header) { padding-inline: 16px; }
  /* No rounding / side borders — read as a full-width band. */
  .mg-notifications__shell :deep(.association-users__list) {
    border-left: 0;
    border-right: 0;
    border-radius: 0;
  }
  .mg-notifications__stack.association-teams__sticky-stack--stuck {
    border-left: 0;
    border-right: 0;
    border-radius: 0;
  }
  .association-users__search-input { width: 140px; }
  .mg-notif-row { grid-template-columns: minmax(0, 1fr); }
  .mg-notif-row__time { padding-top: 0; }
}
</style>
