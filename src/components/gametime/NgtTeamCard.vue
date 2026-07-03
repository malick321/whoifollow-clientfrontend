<script setup lang="ts">
// NgtTeamCard
// -----------
// The attractive team card used across the Game Time teams tabs (Discover /
// My Teams / Following). Colored header band + team logo, WIF-approved badge,
// division/rating/sport meta, location, optional record tiles + teammate
// cluster (My Teams), and a Follow toggle. Mirrors NgtEventCard's look.

import { computed } from 'vue'
import TeamAvatar from '../TeamAvatar.vue'
import { themeMode } from '../../theme'
import type { DiscoverTeam } from '../../api/discoverTeams'

const props = defineProps<{
  team: DiscoverTeam
  followBusy?: boolean
  /** My Teams: you're already on the team, so hide the Follow toggle. */
  hideFollow?: boolean
  /** 'card' (grid, default) or 'list' (compact horizontal row). */
  variant?: 'card' | 'list'
}>()

const emit = defineEmits<{ (e: 'toggle-follow', team: DiscoverTeam): void }>()

const lightPalette = ['#e7f1ff', '#eaf8eb', '#fff0df', '#efe8ff', '#e4f7f6', '#fbe4e6']
const darkPalette = ['#2a3a52', '#243d2c', '#4a3320', '#33294a', '#1d3a3a', '#4a2530']
const bandColor = computed(() => {
  const name = props.team.name || ''
  const hash = Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0)
  const palette = themeMode.value === 'dark' ? darkPalette : lightPalette
  return palette[hash % palette.length]
})

const metaLine = computed(() =>
  [props.team.ageGroup, props.team.rating, props.team.gender].filter(Boolean).join(' · ')
)
const locationLabel = computed(() =>
  [props.team.city, props.team.state].filter(Boolean).join(', ')
)
const hasRecord = computed(() => props.team.totalGames !== undefined)
const members = computed(() => props.team.members ?? [])
</script>

<template>
  <article class="ngt-tcard" :class="{ 'ngt-tcard--list': variant === 'list' }">
    <div class="ngt-tcard__band" :style="{ background: bandColor }">
      <TeamAvatar :name="team.name" :image-url="team.avatarUrl" size="lg" />
      <span v-if="team.wifApproved" class="ngt-tcard__verified" title="WIF Approved">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
    </div>

    <div class="ngt-tcard__body">
      <h3 class="ngt-tcard__name" :title="team.name">{{ team.name }}</h3>
      <span v-if="metaLine" class="ngt-tcard__meta">{{ metaLine }}</span>
      <span v-if="team.sportType" class="ngt-tcard__sport">{{ team.sportType }}</span>
      <span v-if="locationLabel" class="ngt-tcard__loc">
        <span class="ngt-tcard__pin" aria-hidden="true">📍</span> {{ locationLabel }}
      </span>

      <div v-if="hasRecord" class="ngt-tcard__record">
        <div class="ngt-tcard__stat"><span>{{ team.totalGames ?? 0 }}</span><small>Games</small></div>
        <div class="ngt-tcard__stat"><span>{{ team.won ?? 0 }}</span><small>Won</small></div>
        <div class="ngt-tcard__stat"><span>{{ team.lost ?? 0 }}</span><small>Lost</small></div>
      </div>
    </div>

    <div class="ngt-tcard__foot">
      <span v-if="members.length" class="ngt-tcard__members">
        <TeamAvatar
          v-for="m in members.slice(0, 4)"
          :key="m.name"
          :name="m.name"
          :image-url="m.avatarUrl ?? undefined"
          size="sm"
        />
        <span v-if="(team.memberCount ?? members.length) > 4" class="ngt-tcard__members-more">
          +{{ (team.memberCount ?? members.length) - 4 }}
        </span>
      </span>
      <span v-else></span>
      <button
        v-if="!hideFollow"
        type="button"
        class="ngt-tcard__follow"
        :class="{ 'ngt-tcard__follow--on': team.isFollowing }"
        :disabled="followBusy"
        :aria-pressed="team.isFollowing ? 'true' : 'false'"
        @click="emit('toggle-follow', team)"
      >
        {{ team.isFollowing ? 'Following' : 'Follow' }}
      </button>
    </div>
  </article>
</template>

<style scoped>
.ngt-tcard {
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 16px;
  overflow: hidden;
  box-shadow: var(--shadow-soft);
  transition: transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease;
}
.ngt-tcard:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow);
  border-color: var(--border-accent-hover, var(--primary-light-2));
}
.ngt-tcard__band {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 0 16px;
}
.ngt-tcard__verified {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--primary, #2d8cf0);
  color: #fff;
}
.ngt-tcard__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px 14px 10px;
  flex: 1 1 auto;
}
.ngt-tcard__name {
  margin: 0;
  color: var(--text);
  font-size: 0.98rem;
  font-weight: 500;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-tcard__meta { color: var(--secondary); font-size: 0.8rem; font-weight: 500; }
.ngt-tcard__sport { color: var(--text-light); font-size: 0.78rem; }
.ngt-tcard__loc {
  color: var(--text-light);
  font-size: 0.8rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-tcard__pin { font-size: 0.78rem; }
.ngt-tcard__record {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.ngt-tcard__stat {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 7px 4px;
  border-radius: 8px;
  background: var(--surface-pill);
}
.ngt-tcard__stat span { color: var(--text); font-size: 1rem; font-weight: 600; }
.ngt-tcard__stat small { color: var(--text-light); font-size: 0.66rem; }

.ngt-tcard__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 14px;
  border-top: 1px solid var(--border-divider);
}
.ngt-tcard__members { display: inline-flex; align-items: center; }
.ngt-tcard__members > :not(:first-child) { margin-left: -8px; }
.ngt-tcard__members-more {
  margin-left: 4px;
  color: var(--text-light);
  font-size: 0.72rem;
  font-weight: 500;
}
.ngt-tcard__follow {
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
.ngt-tcard__follow:hover:not(:disabled) { border-color: var(--border-accent-hover); color: var(--primary); }
.ngt-tcard__follow:disabled { opacity: 0.65; cursor: progress; }
.ngt-tcard__follow--on { background: var(--primary-light-3); border-color: var(--primary-light-2); color: var(--primary); }

/* ── List (row) variant ─────────────────────────────────────────── */
.ngt-tcard--list {
  flex-direction: row;
  align-items: stretch;
  border-radius: 12px;
}
.ngt-tcard--list .ngt-tcard__band {
  flex: 0 0 92px;
  width: 92px;
  padding: 0;
}
.ngt-tcard--list .ngt-tcard__body {
  justify-content: center;
  padding: 12px 16px;
}
.ngt-tcard--list .ngt-tcard__record { display: none; }
.ngt-tcard--list .ngt-tcard__foot {
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  gap: 8px;
  border-top: none;
  border-left: 1px solid var(--border-divider);
}
</style>
