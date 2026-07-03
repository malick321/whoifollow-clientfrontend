<script setup lang="ts">
// MatchGeniDiscussionsView
// ------------------------
// /association/:associationShortName/portal/events/:eventId/matchgeni/discussions
//
// MatchGeni sub-page listing the event's discussion topics. Behaviour mirrors
// EventOfficialsView: centered content column under the MatchGeniHeader
// sub-page bar, a sticky toolbar (count + search + "New Discussion"), a list
// card of rows, a per-row ellipsis menu, a loading skeleton + empty state,
// and a create modal. Mock-first via `src/api/matchGeniDiscussions.ts`.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import MatchGeniHeader from '../components/MatchGeniHeader.vue'
import SlideModal from '../components/SlideModal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import {
  createDiscussion,
  deleteDiscussion,
  discussionAudienceLabel,
  fetchEventDiscussions
} from '../api/matchGeniDiscussions'
import { currentAssociation } from '../constants/associations'
import { canEnterMatchGeni, ensureMatchGeniAccess, matchGeniContext } from '../matchgeni-context'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'
import type { DiscussionAudience, EventDiscussion } from '../types'

const route = useRoute()
const router = useRouter()

const associationShortName = computed(() =>
  (route.params.associationShortName as string | undefined) ?? ''
)
const eventId = computed(() => (route.params.eventId as string | undefined) ?? '')
const associationId = computed(() => currentAssociation.value?.id ?? '')
const eventName = computed(() => matchGeniContext.value?.event?.eventName ?? '')

const discussions = ref<EventDiscussion[]>([])
const loading = ref(true)
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return discussions.value
  return discussions.value.filter((d) =>
    d.title.toLowerCase().includes(q) ||
    d.excerpt.toLowerCase().includes(q) ||
    d.authorName.toLowerCase().includes(q)
  )
})

// ── Sticky toolbar drop-shadow (mirrors EventOfficialsView) ──────
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

let fetchToken = 0
async function load() {
  const myToken = ++fetchToken
  loading.value = true
  try {
    // Entry gate only — Discussions is available to anyone with matchgeni
    // access (no per-page permission key), matching the rail item.
    const ok = await ensureMatchGeniAccess(
      router,
      associationId.value,
      eventId.value,
      associationShortName.value
    )
    if (myToken !== fetchToken) return
    if (!ok) {
      discussions.value = []
      return
    }
    const list = await fetchEventDiscussions(associationId.value, eventId.value)
    if (myToken !== fetchToken) return
    discussions.value = list
  } catch (err) {
    if (typeof console !== 'undefined') console.error('Load discussions failed:', err)
    if (myToken === fetchToken) discussions.value = []
  } finally {
    if (myToken === fetchToken) loading.value = false
  }
}

watch([associationShortName, eventId], load)

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
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
  document.removeEventListener('mousedown', onDocClick)
  if (stickyObserver) stickyObserver.disconnect()
})

// ── Per-row ellipsis menu ────────────────────────────────────────
const openMenuId = ref<string | null>(null)
function toggleMenu(id: string) { openMenuId.value = openMenuId.value === id ? null : id }
function closeMenu() { openMenuId.value = null }
function onDocClick(ev: MouseEvent) {
  if (!openMenuId.value) return
  const target = ev.target as HTMLElement
  if (!target.closest('.association-users__row-menu') && !target.closest('.association-users__row-menu-btn')) {
    openMenuId.value = null
  }
}

async function onDelete(row: EventDiscussion) {
  closeMenu()
  const ok = window.confirm(`Delete the discussion "${row.title}"?`)
  if (!ok) return
  try {
    await deleteDiscussion(associationId.value, eventId.value, row.id)
    discussions.value = discussions.value.filter((d) => d.id !== row.id)
    pushToast({ tone: 'success', title: 'Discussion deleted', message: `"${row.title}" was removed.` })
  } catch {
    pushToast({ tone: 'warning', title: 'Could not delete', message: 'Please try again.' })
  }
}

// ── New Discussion composer ──────────────────────────────────────
const composerOpen = ref(false)
const draftTitle = ref('')
const draftAudience = ref<DiscussionAudience>('all')
const draftBody = ref('')
const attempted = ref(false)
const saving = ref(false)
const AUDIENCE_OPTIONS: { value: DiscussionAudience; label: string }[] = [
  { value: 'all', label: 'Everyone' },
  { value: 'teams', label: 'Teams' },
  { value: 'officials', label: 'Officials' },
  { value: 'umpires', label: 'Umpires' }
]
const canStart = computed(() => draftTitle.value.trim().length > 0 && draftBody.value.trim().length > 0)

function openComposer() {
  draftTitle.value = ''
  draftAudience.value = 'all'
  draftBody.value = ''
  attempted.value = false
  saving.value = false
  composerOpen.value = true
}
async function startDiscussion() {
  attempted.value = true
  if (!canStart.value || saving.value) return
  saving.value = true
  try {
    const record = await createDiscussion(associationId.value, eventId.value, {
      title: draftTitle.value,
      body: draftBody.value,
      audience: draftAudience.value
    })
    discussions.value = [record, ...discussions.value]
    composerOpen.value = false
    pushToast({ tone: 'success', title: 'Discussion started', message: `"${record.title}" is now open.` })
  } catch {
    pushToast({ tone: 'warning', title: 'Could not start discussion', message: 'Please try again.' })
  } finally {
    saving.value = false
  }
}

// ── Display helpers ──────────────────────────────────────────────
type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'secondary'
const AUDIENCE_TONE: Record<DiscussionAudience, BadgeTone> = {
  all: 'neutral', teams: 'primary', officials: 'info', umpires: 'secondary'
}
function audienceLabel(a: DiscussionAudience): string { return discussionAudienceLabel(a) }
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
  <main class="mg-discussions">
    <MatchGeniHeader
      variant="sub-page"
      title="Discussions"
      :subtitle="eventName"
      :event-id="eventId"
    />

    <section class="mg-discussions__shell">
      <!-- Sentinel above the sticky stack — toggles the stuck shadow once the
           header pins to the top (same pattern as Notifications). -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>

      <!-- Header reuses the shared Officials/Notifications structure
           (`.association-teams__sticky-stack` + `.association-users__header`)
           so the count / search / New-button placement matches Notifications
           at every breakpoint. -->
      <div
        class="association-teams__sticky-stack mg-discussions__stack"
        :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
      >
        <header class="association-users__header">
          <p class="association-users__count">
            <strong :title="`${discussions.length} discussions`">{{ formatCompact(discussions.length) }}</strong>
            <span>discussions</span>
          </p>
          <div class="association-teams__header-actions">
            <label class="association-users__search">
              <AppIcon name="search" :size="14" />
              <input
                v-model="search"
                type="search"
                placeholder="Search discussions"
                class="association-users__search-input"
              />
            </label>
            <button
              v-if="canEnterMatchGeni"
              class="association-users__invite-btn"
              type="button"
              @click="openComposer"
            >
              <span class="mg-discussions__add-icon" aria-hidden="true"></span>
              <span>New</span>
            </button>
          </div>
        </header>
      </div>

      <!-- Skeleton -->
      <div v-if="loading" class="association-users__list" aria-busy="true">
        <div v-for="i in 6" :key="`skeleton-${i}`" class="association-users__row mg-discussions__row">
          <div class="association-users__row-identity">
            <span class="shimmer-circle association-users__skeleton-avatar"></span>
            <div class="association-users__skeleton-stack">
              <span class="shimmer-block association-users__skeleton-name"></span>
              <span class="shimmer-block association-users__skeleton-email"></span>
            </div>
          </div>
          <span class="shimmer-block association-users__skeleton-pill"></span>
          <span class="shimmer-block association-users__skeleton-pill association-users__skeleton-pill--action"></span>
        </div>
      </div>

      <div v-else-if="filtered.length === 0" class="association-users__empty mg-discussions__empty">
        <p v-if="search.trim()">No discussions match "{{ search }}".</p>
        <template v-else>
          <p>No discussions yet.</p>
          <button v-if="canEnterMatchGeni" class="association-users__invite-btn" type="button" @click="openComposer">
            <span aria-hidden="true">+</span>
            <span>Start a discussion</span>
          </button>
        </template>
      </div>

      <div v-else class="association-users__list">
        <div v-for="d in filtered" :key="d.id" class="association-users__row mg-discussions__row">
          <div class="association-users__row-identity">
            <TeamAvatar :name="d.authorName" :image-url="d.authorAvatarUrl" size="md" />
            <div class="mg-discussions__copy">
              <strong class="mg-discussions__title">
                {{ d.title }}
                <span v-if="d.status === 'resolved'" class="mg-discussions__resolved">Resolved</span>
              </strong>
              <span class="mg-discussions__excerpt">{{ d.excerpt }}</span>
              <span class="mg-discussions__byline">{{ d.authorName }}</span>
            </div>
          </div>

          <div class="mg-discussions__meta">
            <StatusBadge :label="audienceLabel(d.audience)" :tone="AUDIENCE_TONE[d.audience]" />
            <span class="mg-discussions__replies">{{ d.replyCount }} {{ d.replyCount === 1 ? 'reply' : 'replies' }}</span>
            <span class="mg-discussions__time">{{ relativeTime(d.lastActivityAt) }}</span>
          </div>

          <div class="association-users__row-actions">
            <button
              type="button"
              class="association-users__row-menu-btn"
              :aria-label="`Actions for ${d.title}`"
              :aria-expanded="openMenuId === d.id ? 'true' : 'false'"
              @click.stop="toggleMenu(d.id)"
            >
              <AppIcon name="ellipsis" :size="16" />
            </button>
            <div v-if="openMenuId === d.id" class="association-users__row-menu" role="menu">
              <button
                type="button"
                class="association-users__row-menu-item association-users__row-menu-item--danger"
                role="menuitem"
                @click="onDelete(d)"
              >Delete discussion</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- New Discussion composer -->
    <SlideModal
      :model-value="composerOpen"
      title="New Discussion"
      size="default"
      @update:model-value="composerOpen = $event"
    >
      <div class="mg-discussions__form">
        <div class="floating-input" :class="{ 'floating-input--invalid': attempted && !draftTitle.trim() }">
          <input id="disc-title" v-model="draftTitle" type="text" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!draftTitle }" placeholder=" " />
          <label for="disc-title" class="floating-input__label">Title</label>
          <span v-if="attempted && !draftTitle.trim()" class="floating-input__error-corner">Required</span>
        </div>

        <div class="floating-input">
          <select
            id="disc-audience"
            v-model="draftAudience"
            class="floating-input__control floating-input__control--select floating-input__control--has-value"
          >
            <option v-for="o in AUDIENCE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <label for="disc-audience" class="floating-input__label floating-input__label--floated">Visible to</label>
        </div>

        <div class="floating-input" :class="{ 'floating-input--invalid': attempted && !draftBody.trim() }">
          <textarea id="disc-body" v-model="draftBody" class="floating-input__control mg-discussions__textarea" :class="{ 'floating-input__control--has-value': !!draftBody }" rows="6" placeholder=" "></textarea>
          <label for="disc-body" class="floating-input__label">Message</label>
          <span v-if="attempted && !draftBody.trim()" class="floating-input__error-corner">Required</span>
        </div>
      </div>

      <template #footer>
        <button type="button" class="secondary-button" @click="composerOpen = false">Cancel</button>
        <button type="button" class="primary-button" :disabled="!canStart || saving" @click="startDiscussion">
          {{ saving ? 'Starting…' : 'Start Discussion' }}
        </button>
      </template>
    </SlideModal>
  </main>
</template>

<style scoped>
.mg-discussions {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Add icon — masked `add.svg`, painted in the button's label colour
   (`--white` = white in light, dark in dark mode, matching the label). */
.mg-discussions__add-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  background-color: var(--white, #ffffff);
  -webkit-mask: url('../assets/add.svg') center / contain no-repeat;
  mask: url('../assets/add.svg') center / contain no-repeat;
}

.mg-discussions__shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 12px 24px 20px;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mg-discussions__sticky-sentinel { width: 100%; height: 1px; }

/* Sticky header stack — identical structure to the Notifications / Officials
   pages (`.association-teams__sticky-stack` + `.association-users__header`)
   so the count / search / New-button placement matches Notifications at every
   breakpoint. Pinned under the matchgeni header; transparent at rest, then a
   bordered rounded bar when stuck (bg + shadow come from the shared
   `--stuck` rule). */
.mg-discussions__stack {
  top: var(--matchgeni-header-height, 56px);
  border: 1px solid transparent;
  transition: background-color 180ms ease, box-shadow 180ms ease, border-color 180ms ease, padding 180ms ease;
}
/* Square corners (no rounding) + the shared `--stuck` drop-shadow while
   sticky. */
.mg-discussions__stack.association-teams__sticky-stack--stuck {
  border-color: var(--border-divider);
  border-radius: 0;
  padding: 10px 14px;
}
/* Dark mode: the shared `--stuck` shadow is a blue-slate tint that reads
   bluish on the dark surface — swap it for the app's neutral dark drop-
   shadow (same colour used by the poolplay / scheduler stuck bars). */
html.dark-mode .mg-discussions__stack.association-teams__sticky-stack--stuck {
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45);
}
/* The shared header's default 16px bottom margin would leave a gap inside the
   pinned bar — the shell's `gap` owns header↔list spacing instead. */
.mg-discussions__stack :deep(.association-users__header) { margin-bottom: 0; }

/* Match the Officials count sizing (16 / 14, not the global 1.5rem). */
.mg-discussions__shell :deep(.association-users__count) { font-size: 14px; }
.mg-discussions__shell :deep(.association-users__count strong) { font-size: 16px; }

/* Row grid: identity (avatar + title/excerpt) | meta | actions. */
.mg-discussions__row.association-users__row {
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
}

.mg-discussions__copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mg-discussions__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mg-discussions__resolved {
  flex: 0 0 auto;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--secondary);
  background: var(--surface-muted, #eef3f8);
  border-radius: 999px;
  padding: 2px 8px;
}
html.dark-mode .mg-discussions__resolved { background: rgba(255, 255, 255, 0.08); }
.mg-discussions__excerpt {
  font-size: 0.82rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mg-discussions__byline { font-size: 0.75rem; color: var(--secondary); margin-top: 2px; }

.mg-discussions__meta {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex: 0 0 auto;
}
.mg-discussions__replies { font-size: 0.8rem; color: var(--text); }
.mg-discussions__time { font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; }

.mg-discussions__empty { color: var(--secondary); }

/* Composer form */
.mg-discussions__form { display: flex; flex-direction: column; gap: 16px; }
.mg-discussions__textarea { resize: vertical; min-height: 120px; line-height: 1.45; }

@media (max-width: 720px) {
  /* Full-bleed on mobile — drop the side gutter so the header + list span
     edge to edge; the shared header (no padding of its own) gets a 16px
     inset so its content doesn't hit the screen edge (rows already carry
     their own horizontal padding). Mirrors the Notifications page. */
  .mg-discussions__shell { padding: 14px 0; }
  .mg-discussions__shell :deep(.association-users__header) { padding-inline: 16px; }
  /* No rounding / side borders when the header pins — read as a full-width
     band rather than a floating rounded card. */
  .mg-discussions__stack.association-teams__sticky-stack--stuck {
    border-left: 0;
    border-right: 0;
    border-radius: 0;
    padding: 10px 16px;
  }
  .mg-discussions__shell :deep(.association-users__list) {
    border-left: 0;
    border-right: 0;
    border-radius: 0;
  }
  .association-users__search-input { width: 140px; }
  /* Stack the meta under the identity on narrow widths. */
  .mg-discussions__row.association-users__row { grid-template-columns: minmax(0, 1fr) auto; }
  .mg-discussions__meta { display: none; }
}
</style>
