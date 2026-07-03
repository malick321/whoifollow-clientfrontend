<script setup lang="ts">
// PublicEventDetailsCard
// ----------------------
// White card of icon rows summarising the event (followers, sport/type,
// director + contact, entry fee, deadline, umpires, time limit, seed,
// format) with a "See more" toggle that reveals the longer description.
// Mirrors the shared mock, themed to our design system.

import { computed, ref } from 'vue'
import type { PublicEventDetails } from '../../types'

const props = defineProps<{
  details: PublicEventDetails
}>()

const expanded = ref(false)
// "See more" reveals the longer free-text event fields.
const hasMore = computed(() => {
  const d = props.details
  return !!(d.tournamentFormat || d.refundPolicy || d.reminder || d.eventNotes)
})
</script>

<template>
  <section class="pub-details">
    <ul class="pub-details__list">
      <li class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--followers" aria-hidden="true"></span>
        <span class="pub-details__value pub-details__value--accent">{{ details.followersLabel }}</span>
      </li>

      <li class="pub-details__row pub-details__row--stack">
        <span class="pub-details__icon pub-details__icon--director" aria-hidden="true"></span>
        <span class="pub-details__copy">
          <span class="pub-details__value"><span class="pub-details__label">Director:</span> {{ details.directorName }}</span>
          <span v-if="details.directorPhone" class="pub-details__sub">{{ details.directorPhone }}</span>
          <span v-if="details.directorEmail" class="pub-details__sub">{{ details.directorEmail }}</span>
        </span>
      </li>

      <li class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--money" aria-hidden="true"></span>
        <span class="pub-details__value"><span class="pub-details__label">Entry Fee</span> {{ details.entryFeeLabel }}</span>
      </li>
      <li class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--calendar" aria-hidden="true"></span>
        <span class="pub-details__value"><span class="pub-details__label">Entry Deadline</span> {{ details.entryDeadlineLabel }}</span>
      </li>

      <li v-if="details.umpires.length" class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--umpires" aria-hidden="true"></span>
        <span class="pub-details__value"><span class="pub-details__label">Umpires</span> {{ details.umpires.join(', ') }}</span>
      </li>
      <li class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--time" aria-hidden="true"></span>
        <span class="pub-details__value"><span class="pub-details__label">Time Limit</span> {{ details.timeLimit }}</span>
      </li>
      <li class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--seed" aria-hidden="true"></span>
        <span class="pub-details__value"><span class="pub-details__label">Seed</span> {{ details.seedCriteria }}</span>
      </li>
      <li class="pub-details__row">
        <span class="pub-details__icon pub-details__icon--format" aria-hidden="true"></span>
        <span class="pub-details__value"><span class="pub-details__label">Format</span> {{ details.format }}</span>
      </li>

      <template v-if="expanded">
        <li v-if="details.tournamentFormat" class="pub-details__row pub-details__row--stack">
          <span class="pub-details__icon pub-details__icon--tformat" aria-hidden="true"></span>
          <span class="pub-details__copy">
            <span class="pub-details__label">Tournament Format</span>
            <span class="pub-details__sub">{{ details.tournamentFormat }}</span>
          </span>
        </li>
        <li v-if="details.refundPolicy" class="pub-details__row pub-details__row--stack">
          <span class="pub-details__icon pub-details__icon--refund" aria-hidden="true"></span>
          <span class="pub-details__copy">
            <span class="pub-details__label">Refund Policy</span>
            <span class="pub-details__sub">{{ details.refundPolicy }}</span>
          </span>
        </li>
        <li v-if="details.reminder" class="pub-details__row pub-details__row--stack">
          <span class="pub-details__icon pub-details__icon--reminder" aria-hidden="true"></span>
          <span class="pub-details__copy">
            <span class="pub-details__label">Reminder</span>
            <span class="pub-details__sub">{{ details.reminder }}</span>
          </span>
        </li>
        <li v-if="details.eventNotes" class="pub-details__row pub-details__row--stack">
          <span class="pub-details__icon pub-details__icon--notes" aria-hidden="true"></span>
          <span class="pub-details__copy">
            <span class="pub-details__label">Event Notes</span>
            <span class="pub-details__sub">{{ details.eventNotes }}</span>
          </span>
        </li>
      </template>
    </ul>

    <button
      v-if="hasMore"
      type="button"
      class="pub-details__more"
      @click="expanded = !expanded"
    >{{ expanded ? 'See less' : 'See more' }}</button>
  </section>
</template>

<style scoped>
.pub-details {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.pub-details__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pub-details__row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: start;
  gap: 10px;
  font-size: 13.5px;
  color: var(--text);
  line-height: 1.4;
}
.pub-details__row--stack { align-items: start; }
/* Brand theme icons — single-tone masks tinted `--primary` (same pattern
   the MatchGeni surfaces use: `background-color: currentColor/--primary`
   + `mask-image: url('../assets/<icon>.svg')`). */
.pub-details__icon {
  width: 18px;
  height: 18px;
  display: block;
  margin-top: 1px;
  background-color: var(--secondary);
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.pub-details__icon--followers  { -webkit-mask-image: url('../../assets/notification.svg');  mask-image: url('../../assets/notification.svg'); }
.pub-details__icon--association { -webkit-mask-image: url('../../assets/association.svg');   mask-image: url('../../assets/association.svg'); }
.pub-details__icon--director    { -webkit-mask-image: url('../../assets/umpire.svg');         mask-image: url('../../assets/umpire.svg'); }
.pub-details__icon--money       { -webkit-mask-image: url('../../assets/money.svg');         mask-image: url('../../assets/money.svg'); }
.pub-details__icon--calendar    { -webkit-mask-image: url('../../assets/calendar.svg');      mask-image: url('../../assets/calendar.svg'); }
.pub-details__icon--umpires     { -webkit-mask-image: url('../../assets/umpire.svg');        mask-image: url('../../assets/umpire.svg'); }
.pub-details__icon--time        { -webkit-mask-image: url('../../assets/stopwatch.svg');     mask-image: url('../../assets/stopwatch.svg'); }
.pub-details__icon--seed        { -webkit-mask-image: url('../../assets/seed-criteria.svg'); mask-image: url('../../assets/seed-criteria.svg'); }
.pub-details__icon--format      { -webkit-mask-image: url('../../assets/game.svg');          mask-image: url('../../assets/game.svg'); }
.pub-details__icon--desc        { -webkit-mask-image: url('../../assets/report.svg');        mask-image: url('../../assets/report.svg'); }
.pub-details__icon--tformat     { -webkit-mask-image: url('../../assets/game.svg');          mask-image: url('../../assets/game.svg'); }
.pub-details__icon--refund      { -webkit-mask-image: url('../../assets/money.svg');         mask-image: url('../../assets/money.svg'); }
.pub-details__icon--reminder    { -webkit-mask-image: url('../../assets/notification.svg');  mask-image: url('../../assets/notification.svg'); }
.pub-details__icon--notes       { -webkit-mask-image: url('../../assets/report.svg');        mask-image: url('../../assets/report.svg'); }
.pub-details__copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.pub-details__value { min-width: 0; }
.pub-details__value--accent { color: var(--secondary); font-weight: 600; }
.pub-details__label {
  color: var(--secondary);
  font-weight: 600;
}
.pub-details__sub {
  font-size: 12.5px;
  color: var(--text);
}
.pub-details__row--desc .pub-details__value {
  color: var(--secondary);
  font-size: 13px;
}
.pub-details__more {
  appearance: none;
  border: none;
  background: none;
  margin-top: 14px;
  padding: 0;
  color: var(--primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.pub-details__more:hover { text-decoration: underline; }
</style>
