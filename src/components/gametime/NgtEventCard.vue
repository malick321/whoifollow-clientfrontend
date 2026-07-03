<script setup lang="ts">
// NgtEventCard
// ------------
// The attractive, "alive" event card used across every Game Time events tab
// (Discover / My Events / Following) and the For You feed. Cover hero + a
// live/upcoming/past STATUS pill derived from the event dates (no backend
// needed), event identity, location, and a Follow toggle. Optional `reason`
// renders the For You "why you're seeing this" chip.

import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { themeMode } from '../../theme'
import type { DiscoverEvent } from '../../api/discoverEvents'

const props = defineProps<{
  event: DiscoverEvent
  followBusy?: boolean
  /** For You feed: "You follow this event", "1st Draft is playing", … */
  reason?: string
  /** 'card' (grid, default) or 'list' (compact horizontal row). */
  variant?: 'card' | 'list'
}>()

const emit = defineEmits<{ (e: 'toggle-follow', event: DiscoverEvent): void }>()

const router = useRouter()
// The card opens the SEO-friendly event detail page at /event/:slug. Prefer
// the human slug; fall back to the GUID (backend resolves either).
const detailSlug = computed(() => props.event.slug || props.event.guid || '')
const hasDetail = computed(() => !!detailSlug.value)
function openDetail() {
  if (!detailSlug.value) return
  router.push({ name: 'event-detail', params: { eventSlug: detailSlug.value } })
}

function parseDay(iso?: string): Date | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}
type StatusKind = 'live' | 'soon' | 'upcoming' | 'past'
const status = computed<{ kind: StatusKind; label: string }>(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = parseDay(props.event.startDate)
  const end = parseDay(props.event.endDate) ?? start
  if (end && end < today) return { kind: 'past', label: 'Completed' }
  if (start && end && start <= today && today <= end) return { kind: 'live', label: 'Happening now' }
  if (start && start > today) {
    const days = Math.round((start.getTime() - today.getTime()) / 86_400_000)
    if (days === 0) return { kind: 'soon', label: 'Today' }
    if (days === 1) return { kind: 'soon', label: 'Tomorrow' }
    return { kind: days <= 7 ? 'soon' : 'upcoming', label: `In ${days} days` }
  }
  return { kind: 'upcoming', label: 'Upcoming' }
})

const lightPalette = [
  { bg: '#fbe4e6', fg: '#bb5964' }, { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' }, { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' }, { bg: '#e4f7f6', fg: '#3c8e89' }
]
const darkPalette = [
  { bg: '#4a2530', fg: '#ff8a98' }, { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' }, { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' }, { bg: '#1d3a3a', fg: '#6ec9c1' }
]
const heroStyle = computed<Record<string, string>>(() => {
  const name = props.event.name || ''
  const hash = Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkPalette : lightPalette
  const choice = palette[hash % palette.length]
  return { '--avatar-bg': choice.bg, '--avatar-fg': choice.fg }
})

const locationLabel = computed(() =>
  [props.event.location.city, props.event.location.state].filter(Boolean).join(', ')
)
function openExternal(url?: string) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
function openMaps() {
  const { lat, lng, city, state } = props.event.location
  const q = lat && lng ? `${lat},${lng}` : [city, state].filter(Boolean).join(', ')
  openExternal(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`)
}
</script>

<template>
  <article
    class="ngt-card"
    :class="[`ngt-card--${status.kind}`, { 'ngt-card--list': variant === 'list', 'ngt-card--clickable': hasDetail }]"
    :role="hasDetail ? 'link' : undefined"
    :tabindex="hasDetail ? 0 : undefined"
    @click="openDetail"
    @keydown.enter="openDetail">
    <div v-if="event.avatarUrl" class="ngt-card__hero">
      <img :src="event.avatarUrl" :alt="event.name" class="ngt-card__hero-img" />
    </div>
    <div v-else class="ngt-card__hero ngt-card__hero--initial" :style="heroStyle">
      <span class="ngt-card__hero-icon" aria-hidden="true"></span>
    </div>

    <span class="ngt-status" :class="`ngt-status--${status.kind}`">
      <span v-if="status.kind === 'live'" class="ngt-status__dot" aria-hidden="true"></span>
      {{ status.label }}
    </span>

    <div class="ngt-card__body">
      <span v-if="reason" class="ngt-card__reason">{{ reason }}</span>
      <span class="ngt-card__date">{{ event.dateRangeLabel || '—' }}</span>
      <h3 class="ngt-card__name" :title="event.name">{{ event.name }}</h3>
      <span v-if="event.association.name || event.eventType" class="ngt-card__meta">
        {{ event.association.name }}<template v-if="event.association.name && event.eventType"> · </template>{{ event.eventType }}
      </span>
      <button
        v-if="event.status === '2' && event.externalUrl"
        type="button"
        class="ngt-card__loc ngt-card__loc--link"
        @click.stop="openExternal(event.externalUrl)"
      >{{ event.externalUrl }}</button>
      <button
        v-else-if="locationLabel"
        type="button"
        class="ngt-card__loc ngt-card__loc--link"
        @click.stop="openMaps"
      >
        <span class="ngt-card__loc-pin" aria-hidden="true">📍</span>
        {{ locationLabel }}
      </button>
    </div>

    <div class="ngt-card__foot">
      <span v-if="event.directorName" class="ngt-card__director">
        <span class="ngt-card__director-label">Director</span> {{ event.directorName }}
      </span>
      <span v-else></span>
      <button
        type="button"
        class="ngt-card__follow"
        :class="{ 'ngt-card__follow--on': event.isFollowing }"
        :disabled="followBusy"
        :aria-pressed="event.isFollowing ? 'true' : 'false'"
        @click.stop="emit('toggle-follow', event)"
      >
        {{ event.isFollowing ? 'Following' : 'Follow' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.ngt-card {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-soft);
  transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
}
.ngt-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
  border-color: var(--border-accent-hover, var(--primary-light-2));
}
.ngt-card--clickable { cursor: pointer; }
.ngt-card--clickable:focus-visible {
  outline: 2px solid var(--primary, #2d8cf0);
  outline-offset: 2px;
}
.ngt-card__hero {
  position: relative;
  height: 116px;
  background: var(--surface-pill);
  overflow: hidden;
}
.ngt-card__hero-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ngt-card__hero--initial {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--avatar-bg);
}
.ngt-card__hero-icon {
  width: 42px; height: 42px; display: block; background-color: var(--avatar-fg);
  -webkit-mask-image: url('../../assets/calendar.svg'); mask-image: url('../../assets/calendar.svg');
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  opacity: 0.9;
}

.ngt-status {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 600;
  color: #fff;
  background: rgba(20, 26, 34, 0.72);
  backdrop-filter: blur(4px);
}
.ngt-status--live { background: #e0454f; }
.ngt-status--soon { background: var(--primary, #2d8cf0); }
.ngt-status__dot {
  width: 7px; height: 7px; border-radius: 50%; background: #fff;
  animation: ngt-pulse 1.2s ease-in-out infinite;
}
@keyframes ngt-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.7); }
}

.ngt-card__body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px 8px;
  flex: 1 1 auto;
}
.ngt-card__reason {
  align-self: flex-start;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary, #2d8cf0);
  background: var(--primary-light-3, #e5f1ff);
  border-radius: 999px;
  padding: 2px 9px;
  margin-bottom: 2px;
}
.ngt-card__date { color: var(--text-light); font-size: 0.74rem; font-weight: 500; }
.ngt-card__name {
  margin: 2px 0;
  color: var(--text);
  font-size: 0.98rem;
  font-weight: 500;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ngt-card__meta { color: var(--secondary); font-size: 0.8rem; font-weight: 500; }
.ngt-card__loc {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  color: var(--text-light);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-card__loc--link {
  appearance: none; background: none; border: none; padding: 0;
  cursor: pointer; font: inherit; text-align: left;
}
.ngt-card__loc--link:hover { color: var(--primary); }
.ngt-card__loc-pin { font-size: 0.78rem; }

.ngt-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-divider);
}
.ngt-card__director {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-light);
  font-size: 0.74rem;
}
.ngt-card__director-label { color: var(--secondary); font-weight: 500; }

.ngt-card__follow {
  flex: 0 0 auto;
  appearance: none;
  display: inline-flex;
  align-items: center;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-btn-solid);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.ngt-card__follow:hover:not(:disabled) { border-color: var(--border-accent-hover); color: var(--primary); }
.ngt-card__follow:disabled { opacity: 0.65; cursor: progress; }
.ngt-card__follow--on { background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--primary); }

/* ── List (row) variant — the compact "old view" layout ─────────── */
.ngt-card--list {
  flex-direction: row;
  align-items: stretch;
  border-radius: 12px;
}
.ngt-card--list .ngt-card__hero {
  flex: 0 0 96px;
  width: 96px;
  height: auto;
}
.ngt-card--list .ngt-status {
  top: 6px;
  left: 6px;
  padding: 2px 7px;
  font-size: 0.62rem;
}
.ngt-card--list .ngt-card__body {
  justify-content: center;
  padding: 12px 16px;
}
.ngt-card--list .ngt-card__name {
  -webkit-line-clamp: 1;
  font-size: 1.02rem;
}
.ngt-card--list .ngt-card__foot {
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  border-top: none;
  border-left: 1px solid var(--border-divider);
}
@media (max-width: 560px) {
  .ngt-card--list .ngt-card__foot .ngt-card__director { display: none; }
}
</style>
