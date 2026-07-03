<script setup lang="ts">
// AssociationFollowersView
// ------------------------
// /association/:associationShortName/portal/followers.
// Mirrors the Teams page sticky-header pattern: the count + search
// bar pin to the top of the viewport once the user scrolls past
// them. Each row carries an avatar + name + follow date.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AssociationSidebar from '../components/AssociationSidebar.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import { fetchAssociationFollowers } from '../api/associationFollowers'
import { formatCompact } from '../utils/formatNumber'
import { pushToast } from '../toast-center'
import type { AssociationFollower } from '../types'

const route = useRoute()
const associationShortName = computed(
  () => (route.params.associationShortName as string | undefined) ?? ''
)

// State
const followers = ref<AssociationFollower[]>([])
const loading = ref(true)
const search = ref('')

// Sticky header drop-shadow when pinned.
const headerStuck = ref(false)
const stickySentinelRef = ref<HTMLElement | null>(null)
let stickyObserver: IntersectionObserver | null = null

onMounted(() => {
  if (typeof IntersectionObserver !== 'undefined' && stickySentinelRef.value) {
    stickyObserver = new IntersectionObserver(
      ([entry]) => {
        headerStuck.value = !entry.isIntersecting
      },
      { rootMargin: '0px', threshold: 0 }
    )
    stickyObserver.observe(stickySentinelRef.value)
  }
  void load()
})

onBeforeUnmount(() => {
  if (stickyObserver) stickyObserver.disconnect()
})

async function load() {
  loading.value = true
  try {
    followers.value = await fetchAssociationFollowers(associationShortName.value)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load followers',
      message: error instanceof Error ? error.message : 'Please refresh and try again.'
    })
    followers.value = []
  } finally {
    loading.value = false
  }
}

watch(associationShortName, () => {
  if (associationShortName.value) void load()
})

const filteredFollowers = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return followers.value
  return followers.value.filter((follower) =>
    follower.name.toLowerCase().includes(q)
  )
})

const totalCount = computed(() => followers.value.length)

// Continuous scroll
const pageSize = 25
const visibleLimit = ref(pageSize)
const loadMoreSentinelRef = ref<HTMLElement | null>(null)
let loadMoreObserver: IntersectionObserver | null = null

watch(search, () => {
  visibleLimit.value = pageSize
})

const paginatedFollowers = computed(() =>
  filteredFollowers.value.slice(0, visibleLimit.value)
)

const hasMore = computed(() => visibleLimit.value < filteredFollowers.value.length)

watch(loadMoreSentinelRef, (el, prev) => {
  if (loadMoreObserver && prev) loadMoreObserver.unobserve(prev)
  if (!el || typeof IntersectionObserver === 'undefined') return
  if (!loadMoreObserver) {
    loadMoreObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasMore.value) {
            visibleLimit.value = Math.min(
              visibleLimit.value + pageSize,
              filteredFollowers.value.length
            )
          }
        }
      },
      { rootMargin: '200px 0px', threshold: 0 }
    )
  }
  loadMoreObserver.observe(el)
})

function formatFollowedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: '2-digit', year: 'numeric' })
}
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="followers" />
    <section class="association-users__main">
      <!-- Sticky stack — pins the count + search row to the top of
           the viewport once the user scrolls past it, picking up
           the unified white-bar look. Same pattern as the Teams
           page. -->
      <div ref="stickySentinelRef" class="association-users__sticky-sentinel" aria-hidden="true"></div>
      <div
        class="association-teams__sticky-stack"
        :class="{ 'association-teams__sticky-stack--stuck': headerStuck }"
      >
        <header class="association-users__header">
          <p class="association-users__count">
            <strong :title="`${totalCount} followers`">{{ formatCompact(totalCount) }}</strong>
            <span>followers</span>
          </p>
          <label class="association-users__search">
            <AppIcon name="search" :size="14" />
            <input
              v-model="search"
              type="search"
              placeholder="Search followers"
              class="association-users__search-input"
            />
          </label>
        </header>
      </div>

      <!-- Loading skeleton -->
      <div v-if="loading" class="association-followers__list">
        <div
          v-for="i in 8"
          :key="`skeleton-${i}`"
          class="association-followers__row association-followers__row--skeleton"
        >
          <span class="shimmer-circle association-followers__skeleton-avatar"></span>
          <div class="association-followers__skeleton-stack">
            <span class="shimmer-block association-followers__skeleton-name"></span>
            <span class="shimmer-block association-followers__skeleton-date"></span>
          </div>
        </div>
      </div>

      <div v-else-if="filteredFollowers.length === 0" class="association-users__empty">
        <p v-if="search.trim()">No followers match "{{ search }}".</p>
        <p v-else>No followers yet.</p>
      </div>

      <div v-else class="association-followers__list">
        <div
          v-for="follower in paginatedFollowers"
          :key="follower.id"
          class="association-followers__row"
        >
          <TeamAvatar :name="follower.name" :image-url="follower.avatarUrl" size="md" />
          <div class="association-followers__copy">
            <strong class="association-followers__name">{{ follower.name }}</strong>
            <span class="association-followers__date">Following since {{ formatFollowedAt(follower.followedAt) }}</span>
          </div>
        </div>
      </div>

      <!-- Continuous scroll sentinel -->
      <div
        v-if="!loading && hasMore"
        ref="loadMoreSentinelRef"
        class="association-users__load-more"
        aria-hidden="true"
      >
        <span class="association-users__load-more-spinner"></span>
        <span>Loading more followers…</span>
      </div>
    </section>
  </main>
</template>
