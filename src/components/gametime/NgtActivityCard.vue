<script setup lang="ts">
// NgtActivityCard
// ---------------
// A single "For You" game-activity item: LIVE (with live scores), a RESULT
// (final score, winner emphasised), or an UPCOMING game ("your team plays").
// Built from the tournament scoring data (see DiscoverEventsController@feed).

import { computed } from 'vue'
import type { FeedActivityItem } from '../../api/discoverEvents'

const props = defineProps<{ item: FeedActivityItem }>()

const badge = computed(() => {
  if (props.item.type === 'live') return 'Live'
  if (props.item.type === 'result') return 'Final'
  return 'Upcoming'
})
const showScores = computed(() => props.item.type === 'live' || props.item.type === 'result')

// For a finished game, the higher score is the winner (emphasised).
const winnerId = computed(() => {
  if (props.item.type !== 'result') return null
  const a = props.item.teamOne.score
  const b = props.item.teamTwo.score
  if (a === null || b === null || a === b) return null
  return a > b ? props.item.teamOne.id : props.item.teamTwo.id
})

const timeLabel = computed(() => {
  const { startDate, startTime } = props.item
  if (!startDate) return ''
  const [y, m, d] = startDate.slice(0, 10).split('-').map(Number)
  const date = y && m && d ? new Date(y, m - 1, d) : null
  const dateStr = date
    ? date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : startDate
  const t = (startTime || '').slice(0, 5)
  return t ? `${dateStr} · ${t}` : dateStr
})
</script>

<template>
  <article class="ngt-act" :class="`ngt-act--${item.type}`">
    <div class="ngt-act__head">
      <span class="ngt-act__badge" :class="`ngt-act__badge--${item.type}`">
        <span v-if="item.type === 'live'" class="ngt-act__dot" aria-hidden="true"></span>
        {{ badge }}
      </span>
      <span class="ngt-act__reason">{{ item.reason }}</span>
    </div>

    <div class="ngt-act__match">
      <div class="ngt-act__team" :class="{ 'ngt-act__team--mine': item.teamOne.mine, 'ngt-act__team--win': winnerId === item.teamOne.id }">
        <span class="ngt-act__team-name">{{ item.teamOne.name }}</span>
        <span v-if="showScores" class="ngt-act__score">{{ item.teamOne.score ?? 0 }}</span>
      </div>
      <span class="ngt-act__vs">{{ showScores ? '–' : 'vs' }}</span>
      <div class="ngt-act__team ngt-act__team--right" :class="{ 'ngt-act__team--mine': item.teamTwo.mine, 'ngt-act__team--win': winnerId === item.teamTwo.id }">
        <span v-if="showScores" class="ngt-act__score">{{ item.teamTwo.score ?? 0 }}</span>
        <span class="ngt-act__team-name">{{ item.teamTwo.name }}</span>
      </div>
    </div>

    <div class="ngt-act__meta">
      <span v-if="item.type === 'upcoming' && timeLabel" class="ngt-act__when">{{ timeLabel }}</span>
      <span v-if="item.division">{{ item.division }}</span>
      <span v-if="item.division && item.eventName" aria-hidden="true"> · </span>
      <span v-if="item.eventName" class="ngt-act__event">{{ item.eventName }}</span>
    </div>
  </article>
</template>

<style scoped>
.ngt-act {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 16px;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  box-shadow: var(--shadow-soft);
}
.ngt-act--live { border-color: rgba(224, 69, 79, 0.5); }

.ngt-act__head { display: flex; align-items: center; gap: 10px; }
.ngt-act__badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: #fff;
  background: var(--text-light);
}
.ngt-act__badge--live { background: #e0454f; }
.ngt-act__badge--result { background: var(--secondary, #2f5f98); }
.ngt-act__badge--upcoming { background: var(--primary, #2d8cf0); }
.ngt-act__dot {
  width: 7px; height: 7px; border-radius: 50%; background: #fff;
  animation: ngt-act-pulse 1.2s ease-in-out infinite;
}
@keyframes ngt-act-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(0.7); }
}
.ngt-act__reason {
  color: var(--text);
  font-size: 0.86rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ngt-act__match {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}
.ngt-act__team {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ngt-act__team--right { justify-content: flex-end; }
.ngt-act__team-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 400;
}
.ngt-act__team--mine .ngt-act__team-name { color: var(--primary, #2d8cf0); font-weight: 500; }
.ngt-act__team--win .ngt-act__team-name { font-weight: 600; }
.ngt-act__score {
  flex: 0 0 auto;
  min-width: 26px;
  text-align: center;
  color: var(--text);
  font-size: 1.15rem;
  font-weight: 600;
}
.ngt-act__team--win .ngt-act__score { color: var(--success, #28a76e); }
.ngt-act__vs {
  color: var(--text-light);
  font-size: 0.82rem;
  font-weight: 500;
}

.ngt-act__meta {
  color: var(--text-light);
  font-size: 0.76rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ngt-act__when { color: var(--secondary, #2f5f98); font-weight: 500; }
</style>
