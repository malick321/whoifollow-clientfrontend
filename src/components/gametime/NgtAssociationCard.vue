<script setup lang="ts">
// NgtAssociationCard
// ------------------
// Rich association card for the Game Time → Associations tabs. Replaces the
// old tabular row: a cover banner (or a per-name gradient fallback) with the
// logo overlapping it, name + full name + location, an optional blurb, a
// stat trio (followers · teams · upcoming events), quick website/social
// links, and the Follow toggle. Reuses the finalized design tokens only.

import { computed } from 'vue'
import TeamAvatar from '../TeamAvatar.vue'
import { themeMode } from '../../theme'
import { formatCompact } from '../../utils/formatNumber'
import type { DiscoverAssociation } from '../../api/discoverAssociations'

const props = defineProps<{
  association: DiscoverAssociation
  followBusy?: boolean
}>()

const emit = defineEmits<{ (e: 'toggle-follow', assoc: DiscoverAssociation): void }>()

const lightPalette = [
  ['#e7f1ff', '#cfe2ff'], ['#eaf8eb', '#cdeecf'], ['#fff0df', '#ffe0bd'],
  ['#efe8ff', '#ddd0ff'], ['#e4f7f6', '#c9efec'], ['#fbe4e6', '#f6ccd0']
]
const darkPalette = [
  ['#2a3a52', '#1f2c40'], ['#243d2c', '#1a2e20'], ['#4a3320', '#372414'],
  ['#33294a', '#241a38'], ['#1d3a3a', '#132a2a'], ['#4a2530', '#361922']
]
const bandGradient = computed(() => {
  const name = props.association.name || ''
  const hash = Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkPalette : lightPalette
  const [a, b] = palette[hash % palette.length]
  return `linear-gradient(135deg, ${a}, ${b})`
})

const location = computed(() =>
  [props.association.city, props.association.state].filter(Boolean).join(', ')
)
const subtitle = computed(() => {
  const a = props.association
  // Prefer a distinct full name; fall back to the short/acronym.
  if (a.fullName && a.fullName !== a.name) return a.fullName
  if (a.shortName && a.shortName !== a.name) return a.shortName
  return ''
})

function open(url?: string) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <article class="ngt-acard">
    <!-- Cover banner (image or gradient fallback) + overlapping logo -->
    <div class="ngt-acard__cover" :style="association.coverUrl ? undefined : { backgroundImage: bandGradient }">
      <img
        v-if="association.coverUrl"
        :src="association.coverUrl"
        :alt="`${association.name} cover`"
        class="ngt-acard__cover-img"
      />
      <span v-if="association.upcomingEventCount > 0" class="ngt-acard__flag">
        {{ association.upcomingEventCount }} upcoming
      </span>
    </div>

    <div class="ngt-acard__logo">
      <TeamAvatar :name="association.name" :image-url="association.logoUrl" size="lg" />
    </div>

    <div class="ngt-acard__body">
      <h3 class="ngt-acard__name" :title="association.name">{{ association.name }}</h3>
      <span v-if="subtitle" class="ngt-acard__sub">{{ subtitle }}</span>
      <span v-if="location" class="ngt-acard__loc">
        <span class="ngt-acard__pin" aria-hidden="true">📍</span> {{ location }}
      </span>

      <p v-if="association.description" class="ngt-acard__blurb">{{ association.description }}</p>

      <!-- Stat trio -->
      <div class="ngt-acard__stats">
        <div class="ngt-acard__stat">
          <span class="ngt-acard__stat-value">{{ formatCompact(association.followerCount) }}</span>
          <span class="ngt-acard__stat-label">Followers</span>
        </div>
        <div class="ngt-acard__stat">
          <span class="ngt-acard__stat-value">{{ formatCompact(association.teamCount) }}</span>
          <span class="ngt-acard__stat-label">Teams</span>
        </div>
        <div class="ngt-acard__stat" :class="{ 'ngt-acard__stat--hot': association.upcomingEventCount > 0 }">
          <span class="ngt-acard__stat-value">{{ formatCompact(association.upcomingEventCount) }}</span>
          <span class="ngt-acard__stat-label">Events</span>
        </div>
      </div>
    </div>

    <div class="ngt-acard__foot">
      <div class="ngt-acard__links">
        <button
          v-if="association.websiteUrl"
          type="button"
          class="ngt-acard__link"
          title="Website"
          aria-label="Website"
          @click="open(association.websiteUrl)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
        </button>
        <button
          v-if="association.facebookUrl"
          type="button"
          class="ngt-acard__link"
          title="Facebook"
          aria-label="Facebook"
          @click="open(association.facebookUrl)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M14 9h3l.4-3H14V4.2c0-.8.2-1.3 1.4-1.3H17V.2C16.6.1 15.6 0 14.5 0 12 0 10.3 1.5 10.3 4.3V6H7.5v3h2.8v9H14V9z" />
          </svg>
        </button>
        <button
          v-if="association.instagramUrl"
          type="button"
          class="ngt-acard__link"
          title="Instagram"
          aria-label="Instagram"
          @click="open(association.instagramUrl)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="3.5" /><circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        class="ngt-acard__follow"
        :class="{ 'ngt-acard__follow--on': association.isFollowing }"
        :disabled="followBusy"
        :aria-pressed="association.isFollowing ? 'true' : 'false'"
        @click="emit('toggle-follow', association)"
      >
        {{ association.isFollowing ? 'Following' : 'Follow' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.ngt-acard {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-soft);
  transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
}
.ngt-acard:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
  border-color: var(--border-accent-hover, var(--primary-light-2));
}

/* Cover banner */
.ngt-acard__cover {
  position: relative;
  height: 88px;
  background-size: cover;
  background-position: center;
}
.ngt-acard__cover-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ngt-acard__flag {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  backdrop-filter: blur(2px);
}

/* Logo overlapping the banner */
.ngt-acard__logo {
  margin: -30px 0 0 16px;
  width: max-content;
  border-radius: 50%;
  padding: 3px;
  background: var(--surface-card);
  box-shadow: 0 0 0 1px var(--border-divider);
}

.ngt-acard__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 16px 12px;
  flex: 1 1 auto;
}
.ngt-acard__name {
  margin: 0;
  color: var(--text);
  font-size: 1.02rem;
  font-weight: 500;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-acard__sub {
  color: var(--secondary);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-acard__loc {
  color: var(--text-light);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-acard__pin { font-size: 0.76rem; }
.ngt-acard__blurb {
  margin: 6px 0 0;
  color: var(--text-light);
  font-size: 0.82rem;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.ngt-acard__stats {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.ngt-acard__stat {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 8px 4px;
  border-radius: 9px;
  background: var(--surface-pill);
}
.ngt-acard__stat--hot {
  background: var(--primary-light-3, #e5f1ff);
}
.ngt-acard__stat-value { color: var(--text); font-size: 1.02rem; font-weight: 600; }
.ngt-acard__stat--hot .ngt-acard__stat-value { color: var(--primary, #2d8cf0); }
.ngt-acard__stat-label { color: var(--text-light); font-size: 0.66rem; }

.ngt-acard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid var(--border-divider);
}
.ngt-acard__links { display: inline-flex; align-items: center; gap: 6px; }
.ngt-acard__link {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.ngt-acard__link:hover { color: var(--primary); border-color: var(--border-accent-hover); }
.ngt-acard__follow {
  flex: 0 0 auto;
  appearance: none;
  height: 32px;
  padding: 0 18px;
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
.ngt-acard__follow:hover:not(:disabled) { border-color: var(--border-accent-hover); color: var(--primary); }
.ngt-acard__follow:disabled { opacity: 0.65; cursor: progress; }
.ngt-acard__follow--on { background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--primary); }
</style>
