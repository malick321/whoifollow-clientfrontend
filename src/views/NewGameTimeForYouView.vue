<script setup lang="ts">
// NewGameTimeForYouView — the "For You" feed (New Game Time landing).
// -------------------------------------------------------------------
// A personalized, magazine-style feed built from everything the member
// follows. Instead of a flat list it reads like a sports news front page:
//   • a FEATURED hero story (the most exciting thing right now)
//   • "Live now" / "Latest results" / "Coming up" score sections (pulsing,
//     animated)  — built from the tournament scoring data
//   • editorial STORY cards for followed events, each with a generated
//     headline + a "why you're seeing this" kicker, entering with a
//     staggered rise animation.
//
// Reuses the finalized design tokens (CSS vars, radii, fonts) + the shared
// NgtActivityCard. Auth-only (the feed endpoint requires a token). Root is
// `.association-users__main` so it slots into NewGameTimeLayout column 2.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import NgtActivityCard from '../components/gametime/NgtActivityCard.vue'
import {
  fetchForYouFeed,
  followDiscoverEvent,
  unfollowDiscoverEvent,
  type DiscoverEvent,
  type FeedActivityItem
} from '../api/discoverEvents'
import { themeMode } from '../theme'
import { pushToast } from '../toast-center'
import { formatCompact } from '../utils/formatNumber'

const items = ref<DiscoverEvent[]>([])
const activity = ref<FeedActivityItem[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const search = ref('')

const PAGE_SIZE = 25
const currentPage = ref(0)
const lastPage = ref(1)
const totalCount = ref(0)

let fetchToken = 0

async function loadPage(mode: 'reset' | 'append') {
  const myToken = ++fetchToken
  const nextPage = mode === 'reset' ? 1 : currentPage.value + 1
  if (mode === 'reset') loading.value = true
  else loadingMore.value = true
  try {
    const result = await fetchForYouFeed({ search: search.value, page: nextPage, perPage: PAGE_SIZE })
    if (myToken !== fetchToken) return
    items.value = mode === 'reset' ? result.events : [...items.value, ...result.events]
    if (mode === 'reset') activity.value = result.activity
    currentPage.value = result.currentPage
    lastPage.value = result.lastPage
    totalCount.value = result.total
  } catch (error) {
    if (myToken !== fetchToken) return
    pushToast({
      tone: 'warning',
      title: 'Could not load your feed',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
    if (mode === 'reset') items.value = []
  } finally {
    if (myToken === fetchToken) {
      if (mode === 'reset') loading.value = false
      else loadingMore.value = false
    }
  }
}

const SEARCH_DEBOUNCE_MS = 500
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null
    loadPage('reset')
  }, SEARCH_DEBOUNCE_MS)
})

const loadMoreSentinelRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null
const hasMore = computed(() => currentPage.value < lastPage.value)

watch(loadMoreSentinelRef, (el, prev) => {
  if (loadMoreObserver && prev) loadMoreObserver.unobserve(prev)
  if (!el || typeof IntersectionObserver === 'undefined') return
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore.value && !loadingMore.value && !loading.value) {
            void loadPage('append')
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
  }
  loadMoreObserver.observe(el)
})

// ── Sticky toolbar — paints a solid background + shadow once pinned ───
const toolbarStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

const followBusy = ref<Set<string>>(new Set())
async function toggleFollow(evt: DiscoverEvent) {
  if (followBusy.value.has(evt.id)) return
  followBusy.value = new Set(followBusy.value).add(evt.id)
  const wasFollowing = evt.isFollowing
  try {
    if (wasFollowing) {
      await unfollowDiscoverEvent(evt.id)
      evt.isFollowing = false
      evt.followId = undefined
    } else {
      evt.followId = await followDiscoverEvent(evt.id)
      evt.isFollowing = true
    }
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: wasFollowing ? 'Could not unfollow' : 'Could not follow',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    const next = new Set(followBusy.value)
    next.delete(evt.id)
    followBusy.value = next
  }
}

function openExternal(url?: string) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
function mapsUrl(evt: DiscoverEvent): string {
  const { lat, lng, city, state } = evt.location
  const q = lat && lng ? `${lat},${lng}` : [city, state].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}
function locationLabel(evt: DiscoverEvent): string {
  return [evt.location.city, evt.location.state].filter(Boolean).join(', ')
}
function storyMeta(evt: DiscoverEvent): string {
  const assoc = [evt.association.name, evt.eventType].filter(Boolean).join(' · ')
  return [evt.dateRangeLabel, assoc, locationLabel(evt)].filter(Boolean).join('  •  ')
}

const lightEventHeroPalette = [
  { bg: '#fbe4e6', fg: '#bb5964' }, { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' }, { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' }, { bg: '#e4f7f6', fg: '#3c8e89' }
]
const darkEventHeroPalette = [
  { bg: '#4a2530', fg: '#ff8a98' }, { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' }, { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' }, { bg: '#1d3a3a', fg: '#6ec9c1' }
]
function eventHeroStyle(name: string): Record<string, string> {
  const hash = Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkEventHeroPalette : lightEventHeroPalette
  const choice = palette[hash % palette.length]
  return { '--avatar-bg': choice.bg, '--avatar-fg': choice.fg }
}

// ── Headline generation — turn raw game rows into punchy sports headlines ──
function gameWhen(a: FeedActivityItem): string {
  if (!a.startDate) return ''
  const [y, m, d] = a.startDate.slice(0, 10).split('-').map(Number)
  const date = y && m && d ? new Date(y, m - 1, d) : null
  const ds = date
    ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : a.startDate
  const t = (a.startTime || '').slice(0, 5)
  return t ? `${ds} · ${t}` : ds
}
function gameHeadline(a: FeedActivityItem): string {
  const one = a.teamOne
  const two = a.teamTwo
  if (a.type === 'result') {
    const aS = one.score ?? 0
    const bS = two.score ?? 0
    if (aS === bS) return `${one.name} and ${two.name} split it ${aS}–${bS}`
    const win = aS > bS ? one : two
    const lose = aS > bS ? two : one
    const hi = Math.max(aS, bS)
    const lo = Math.min(aS, bS)
    const margin = hi - lo
    const verb = margin >= 8 ? 'routed' : margin >= 4 ? 'beat' : 'edged'
    return `${win.name} ${verb} ${lose.name} ${hi}–${lo}`
  }
  if (a.type === 'live') return `${one.name} vs ${two.name} is underway`
  return `${one.name} face ${two.name}`
}

// Raw buckets by kind (feed the hero-picker; unfiltered).
const liveAll = computed(() => activity.value.filter((a) => a.type === 'live'))
const resultAll = computed(() => activity.value.filter((a) => a.type === 'result'))
const upcomingAll = computed(() => activity.value.filter((a) => a.type === 'upcoming'))

// The single most exciting item — powers the hero. Priority: live > next up
// > freshest result > the top followed event.
const featured = computed(() => {
  const live = liveAll.value[0]
  if (live)
    return {
      kind: 'live' as const,
      eyebrow: 'Live now',
      headline: gameHeadline(live),
      sub: [live.division, live.eventName].filter(Boolean).join('  •  '),
      game: live,
      event: null as DiscoverEvent | null
    }
  const up = upcomingAll.value[0]
  if (up)
    return {
      kind: 'upcoming' as const,
      eyebrow: 'Up next',
      headline: gameHeadline(up),
      sub: [gameWhen(up), up.eventName].filter(Boolean).join('  •  '),
      game: up,
      event: null as DiscoverEvent | null
    }
  const res = resultAll.value[0]
  if (res)
    return {
      kind: 'result' as const,
      eyebrow: 'Final score',
      headline: gameHeadline(res),
      sub: [res.division, res.eventName].filter(Boolean).join('  •  '),
      game: res,
      event: null as DiscoverEvent | null
    }
  const evt = items.value[0]
  if (evt)
    return {
      kind: 'event' as const,
      eyebrow: evt.feedReason || 'Featured for you',
      headline: evt.name,
      sub: [evt.dateRangeLabel, locationLabel(evt)].filter(Boolean).join('  •  '),
      game: null as FeedActivityItem | null,
      event: evt
    }
  return null
})
const featuredEventId = computed(() => featured.value?.event?.id ?? null)
const featuredGameId = computed(() => featured.value?.game?.gameId ?? null)
// Section lists exclude whatever the hero already promoted (no duplicate lead).
const liveGames = computed(() => liveAll.value.filter((a) => a.gameId !== featuredGameId.value))
const resultGames = computed(() => resultAll.value.filter((a) => a.gameId !== featuredGameId.value))
const upcomingGames = computed(() => upcomingAll.value.filter((a) => a.gameId !== featuredGameId.value))
// Stories = the followed-event list, minus whatever the hero already promoted.
const stories = computed(() => items.value.filter((e) => e.id !== featuredEventId.value))

onMounted(() => {
  void loadPage('reset')
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        toolbarStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
})
onBeforeUnmount(() => {
  if (loadMoreObserver) loadMoreObserver.disconnect()
  if (stickyObserver) stickyObserver.disconnect()
})
</script>

<template>
  <section class="association-users__main ngt-foryou">
    <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
    <div
      class="association-teams__sticky-stack"
      :class="{ 'association-teams__sticky-stack--stuck': toolbarStuck }"
    >
      <header class="association-users__header">
        <p class="association-users__count">
          <strong :title="`${totalCount} updates`">{{ formatCompact(totalCount) }}</strong>
          <span>in your feed</span>
        </p>
        <div class="association-teams__header-actions">
          <label class="association-users__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search your feed"
              class="association-users__search-input"
            />
          </label>
        </div>
      </header>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="ngt-foryou__skeleton">
      <div class="shimmer-block ngt-foryou__skel-hero"></div>
      <div class="ngt-foryou__skel-grid">
        <div v-for="i in 3" :key="'sk-' + i" class="shimmer-block ngt-foryou__skel-card"></div>
      </div>
    </div>

    <!-- Empty state — drive the follow loop -->
    <div
      v-else-if="!items.length && !activity.length"
      class="association-users__empty ngt-feed__empty"
    >
      <p v-if="search.trim()">Nothing in your feed matches "{{ search }}".</p>
      <template v-else>
        <p class="ngt-feed__empty-title">Your feed is empty</p>
        <p class="ngt-feed__empty-info">
          Follow events, teams, and associations — their games, results, and upcoming action all
          show up here.
        </p>
        <router-link class="ngt-feed__empty-cta" :to="{ name: 'newgametime-discover-events' }">
          Discover events to follow
        </router-link>
      </template>
    </div>

    <template v-else>
      <!-- ─── FEATURED HERO ─────────────────────────────────────────── -->
      <article v-if="featured" class="ngt-hero ngt-rise" :class="`ngt-hero--${featured.kind}`">
        <div class="ngt-hero__glow" aria-hidden="true"></div>
        <span class="ngt-hero__eyebrow">
          <span v-if="featured.kind === 'live'" class="ngt-hero__pulse" aria-hidden="true"></span>
          {{ featured.eyebrow }}
        </span>
        <h1 class="ngt-hero__headline">{{ featured.headline }}</h1>

        <!-- Live game gets a big scoreboard row -->
        <div v-if="featured.game && featured.kind === 'live'" class="ngt-hero__score">
          <span class="ngt-hero__score-team">{{ featured.game.teamOne.name }}</span>
          <span class="ngt-hero__score-nums">
            {{ featured.game.teamOne.score ?? 0 }}<span class="ngt-hero__score-dash">–</span>{{ featured.game.teamTwo.score ?? 0 }}
          </span>
          <span class="ngt-hero__score-team ngt-hero__score-team--right">{{ featured.game.teamTwo.name }}</span>
        </div>

        <p v-if="featured.sub" class="ngt-hero__sub">{{ featured.sub }}</p>

        <button
          v-if="featured.event"
          type="button"
          class="ngt-hero__cta"
          :class="{ 'ngt-hero__cta--on': featured.event.isFollowing }"
          :disabled="followBusy.has(featured.event.id)"
          @click="toggleFollow(featured.event)"
        >
          {{ featured.event.isFollowing ? '✓ Following' : '+ Follow this event' }}
        </button>
      </article>

      <!-- ─── LIVE NOW ──────────────────────────────────────────────── -->
      <section v-if="liveGames.length" class="ngt-sec ngt-sec--live ngt-rise">
        <h2 class="ngt-sec__title">
          <span class="ngt-sec__live-dot" aria-hidden="true"></span> Live now
          <span class="ngt-sec__pill">{{ liveGames.length }}</span>
        </h2>
        <div class="ngt-sec__grid">
          <NgtActivityCard v-for="a in liveGames" :key="a.gameId" :item="a" />
        </div>
      </section>

      <!-- ─── LATEST RESULTS ────────────────────────────────────────── -->
      <section v-if="resultGames.length" class="ngt-sec ngt-rise">
        <h2 class="ngt-sec__title"><span class="ngt-sec__emoji">🏆</span> Latest results</h2>
        <div class="ngt-sec__grid">
          <NgtActivityCard v-for="a in resultGames" :key="a.gameId" :item="a" />
        </div>
      </section>

      <!-- ─── COMING UP ─────────────────────────────────────────────── -->
      <section v-if="upcomingGames.length" class="ngt-sec ngt-rise">
        <h2 class="ngt-sec__title"><span class="ngt-sec__emoji">📅</span> Coming up</h2>
        <div class="ngt-sec__grid">
          <NgtActivityCard v-for="a in upcomingGames" :key="a.gameId" :item="a" />
        </div>
      </section>

      <!-- ─── EVENT STORIES ─────────────────────────────────────────── -->
      <section v-if="stories.length" class="ngt-sec">
        <h2 class="ngt-sec__title"><span class="ngt-sec__emoji">📣</span> In your world</h2>
        <div class="ngt-stories">
          <article
            v-for="(evt, i) in stories"
            :key="evt.id"
            class="ngt-story ngt-rise"
            :style="{ '--i': i % 12 }"
          >
            <div class="ngt-story__thumb">
              <img
                v-if="evt.avatarUrl"
                :src="evt.avatarUrl"
                :alt="evt.name"
                class="ngt-story__thumb-img"
              />
              <div v-else class="ngt-story__thumb-initial" :style="eventHeroStyle(evt.name)" aria-hidden="true">
                <span class="ngt-story__thumb-icon"></span>
              </div>
            </div>

            <div class="ngt-story__body">
              <span v-if="evt.feedReason" class="ngt-story__kicker">{{ evt.feedReason }}</span>
              <h3 class="ngt-story__headline">{{ evt.name }}</h3>
              <p class="ngt-story__meta">{{ storyMeta(evt) }}</p>

              <div class="ngt-story__foot">
                <button
                  v-if="evt.status === '2' && evt.externalUrl"
                  type="button"
                  class="ngt-story__link"
                  @click="openExternal(evt.externalUrl)"
                >View results ↗</button>
                <button
                  v-else-if="locationLabel(evt)"
                  type="button"
                  class="ngt-story__link"
                  @click="openExternal(mapsUrl(evt))"
                >
                  <span class="association-teams__row-icon association-teams__row-icon--location" aria-hidden="true"></span>
                  {{ locationLabel(evt) }}
                </button>
                <span v-else></span>

                <button
                  type="button"
                  class="ngt-story__follow"
                  :class="{ 'ngt-story__follow--on': evt.isFollowing }"
                  :disabled="followBusy.has(evt.id)"
                  :aria-pressed="evt.isFollowing ? 'true' : 'false'"
                  @click="toggleFollow(evt)"
                >
                  {{ evt.isFollowing ? 'Following' : 'Follow' }}
                </button>
              </div>
            </div>
          </article>
        </div>

        <div
          v-if="!loading && hasMore"
          ref="loadMoreSentinelRef"
          class="association-users__load-more"
          aria-hidden="true"
        >
          <span class="association-users__load-more-spinner"></span>
          <span>Loading more…</span>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.ngt-foryou {
  display: flex;
  flex-direction: column;
}

/* ── Entrance animation (staggered rise) ─────────────────────────── */
@keyframes ngt-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.ngt-rise {
  animation: ngt-rise 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: calc(var(--i, 0) * 55ms);
}
@media (prefers-reduced-motion: reduce) {
  .ngt-rise { animation: none; }
}

/* ── FEATURED HERO ───────────────────────────────────────────────── */
.ngt-hero {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 26px 28px 28px;
  margin-bottom: 22px;
  border: 1px solid var(--border-divider);
  border-radius: 18px;
  background:
    radial-gradient(120% 140% at 0% 0%, var(--primary-light-3, #e5f1ff) 0%, transparent 55%),
    var(--surface-card);
  box-shadow: var(--shadow-soft);
}
.ngt-hero--live {
  border-color: rgba(224, 69, 79, 0.45);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(224, 69, 79, 0.18) 0%, transparent 55%),
    var(--surface-card);
}
.ngt-hero--result {
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(40, 167, 110, 0.16) 0%, transparent 55%),
    var(--surface-card);
}
/* Slow drifting sheen for an "alive" feel */
.ngt-hero__glow {
  position: absolute;
  top: -60%;
  right: -20%;
  width: 60%;
  height: 220%;
  background: linear-gradient(115deg, transparent, rgba(255, 255, 255, 0.14), transparent);
  transform: rotate(8deg);
  animation: ngt-sheen 6s ease-in-out infinite;
  pointer-events: none;
}
@keyframes ngt-sheen {
  0%, 100% { opacity: 0; transform: translateX(20%) rotate(8deg); }
  50% { opacity: 1; transform: translateX(-10%) rotate(8deg); }
}
.ngt-hero__eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  align-self: flex-start;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--primary, #2d8cf0);
}
.ngt-hero--live .ngt-hero__eyebrow { color: #e0454f; }
.ngt-hero--result .ngt-hero__eyebrow { color: var(--success, #28a76e); }
.ngt-hero__pulse {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #e0454f;
  box-shadow: 0 0 0 0 rgba(224, 69, 79, 0.6);
  animation: ngt-hero-pulse 1.4s ease-out infinite;
}
@keyframes ngt-hero-pulse {
  0% { box-shadow: 0 0 0 0 rgba(224, 69, 79, 0.55); }
  70% { box-shadow: 0 0 0 10px rgba(224, 69, 79, 0); }
  100% { box-shadow: 0 0 0 0 rgba(224, 69, 79, 0); }
}
.ngt-hero__headline {
  margin: 0;
  color: var(--text);
  font-size: 1.55rem;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}
.ngt-hero__score {
  display: flex;
  align-items: baseline;
  gap: 14px;
  margin-top: 2px;
  flex-wrap: wrap;
}
.ngt-hero__score-team {
  color: var(--text-light);
  font-size: 0.92rem;
  font-weight: 500;
}
.ngt-hero__score-nums {
  color: var(--text);
  font-size: 1.9rem;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.ngt-hero__score-dash { color: var(--text-light); margin: 0 6px; font-weight: 500; }
.ngt-hero__sub {
  margin: 0;
  color: var(--text-light);
  font-size: 0.9rem;
}
.ngt-hero__cta {
  align-self: flex-start;
  margin-top: 8px;
  appearance: none;
  height: 38px;
  padding: 0 20px;
  border: none;
  border-radius: 999px;
  background: var(--primary, #2d8cf0);
  color: #fff;
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}
.ngt-hero__cta:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
.ngt-hero__cta:disabled { opacity: 0.7; cursor: progress; }
.ngt-hero__cta--on { background: var(--primary-light-3); color: var(--primary); }

/* ── SECTIONS ────────────────────────────────────────────────────── */
.ngt-sec { margin-bottom: 26px; }
.ngt-sec__title {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0 0 13px;
  color: var(--text);
  font-size: 1.05rem;
  font-weight: 600;
}
.ngt-sec__emoji { font-size: 1.02rem; }
.ngt-sec__pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--text-light);
  font-size: 0.72rem;
  font-weight: 600;
}
.ngt-sec__live-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #e0454f;
  box-shadow: 0 0 0 0 rgba(224, 69, 79, 0.6);
  animation: ngt-hero-pulse 1.4s ease-out infinite;
}
.ngt-sec__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

/* ── EVENT STORY CARDS (editorial) ───────────────────────────────── */
.ngt-stories {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ngt-story {
  display: grid;
  grid-template-columns: 128px minmax(0, 1fr);
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
  transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
}
.ngt-story:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
  border-color: var(--border-accent-hover, var(--primary-light-2));
}
.ngt-story__thumb {
  width: 128px;
  height: 128px;
  border-radius: 11px;
  overflow: hidden;
  background: var(--surface-pill);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ngt-story__thumb-img { width: 100%; height: 100%; object-fit: cover; }
.ngt-story__thumb-initial {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--avatar-bg);
}
.ngt-story__thumb-icon {
  width: 42px;
  height: 42px;
  display: block;
  background-color: var(--avatar-fg);
  -webkit-mask-image: url('../assets/calendar.svg'); mask-image: url('../assets/calendar.svg');
  -webkit-mask-position: center; mask-position: center;
  -webkit-mask-size: contain; mask-size: contain;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
}
.ngt-story__body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  align-self: center;
}
.ngt-story__kicker {
  align-self: flex-start;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--primary, #2d8cf0);
  background: var(--primary-light-3, #e5f1ff);
  border-radius: 999px;
  padding: 2px 10px;
}
.ngt-story__headline {
  margin: 0;
  color: var(--text);
  font-size: 1.08rem;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: -0.005em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ngt-story__meta {
  margin: 0;
  color: var(--text-light);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-story__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 6px;
}
.ngt-story__link {
  appearance: none;
  background: none;
  border: none;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: var(--text-light);
  font: inherit;
  font-size: 0.8rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-story__link:hover { color: var(--primary); }
.ngt-story__follow {
  flex: 0 0 auto;
  appearance: none;
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
.ngt-story__follow:hover:not(:disabled) { border-color: var(--border-accent-hover); color: var(--primary); }
.ngt-story__follow:disabled { opacity: 0.65; cursor: progress; }
.ngt-story__follow--on { background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--primary); }

/* ── Skeleton ─────────────────────────────────────────────────────── */
.ngt-foryou__skeleton { display: flex; flex-direction: column; gap: 22px; }
.ngt-foryou__skel-hero { height: 150px; border-radius: 18px; }
.ngt-foryou__skel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}
.ngt-foryou__skel-card { height: 120px; border-radius: 14px; }

/* ── Empty state ──────────────────────────────────────────────────── */
.ngt-feed__empty { text-align: center; padding: 56px 24px; }
.ngt-feed__empty-title { font-size: 1.05rem; font-weight: 500; color: var(--text); margin-bottom: 6px; }
.ngt-feed__empty-info { color: var(--text-light); margin-bottom: 16px; }
.ngt-feed__empty-cta {
  display: inline-flex; align-items: center; height: 38px; padding: 0 18px;
  border-radius: 6px; background: var(--primary, #2d8cf0); color: #fff;
  font-weight: 500; text-decoration: none;
}
.ngt-feed__empty-cta:hover { filter: brightness(1.05); }

@media (max-width: 560px) {
  .ngt-hero { padding: 20px; }
  .ngt-hero__headline { font-size: 1.3rem; }
  .ngt-story { grid-template-columns: 84px minmax(0, 1fr); gap: 12px; }
  .ngt-story__thumb { width: 84px; height: 84px; }
}
</style>
