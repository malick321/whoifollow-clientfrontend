<script setup lang="ts">
// PublicEventRegisterCard
// -----------------------
// Two-panel card on the public event page: a light "Time Left to
// Register" panel with a live D/H/M countdown + the close date, and a
// navy "Ready to Compete?" CTA panel with the Register Team button.
// Mirrors the shared mock, themed to our design system.

import { computed, toRef } from 'vue'
import { useCountdown } from '../../lib/useCountdown'
import type { PublicEventRegistration } from '../../types'

const props = defineProps<{
  registration: PublicEventRegistration
}>()

const countdown = useCountdown(toRef(props.registration, 'deadline'))
const closed = computed(() => !props.registration.open || countdown.value.expired)

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
const boxes = computed(() => [
  { value: pad(countdown.value.days), label: 'Days' },
  { value: pad(countdown.value.hours), label: 'Hours' },
  { value: pad(countdown.value.minutes), label: 'Minutes' }
])
</script>

<template>
  <section class="pub-register" :class="{ 'pub-register--closed': closed }">
    <!-- Countdown panel -->
    <div class="pub-register__count">
      <h2 class="pub-register__count-title">{{ closed ? 'Registration Closed' : 'Time Left to Register' }}</h2>
      <div v-if="!closed" class="pub-register__boxes">
        <div v-for="b in boxes" :key="b.label" class="pub-register__box">
          <span class="pub-register__box-value">{{ b.value }}</span>
          <span class="pub-register__box-label">{{ b.label }}</span>
        </div>
      </div>
      <p class="pub-register__close-line">
        <template v-if="closed">Registration for this event has closed.</template>
        <template v-else>Registration closes on <strong>{{ registration.deadlineLabel }}</strong></template>
      </p>
    </div>

    <!-- CTA panel -->
    <div class="pub-register__cta">
      <h3 class="pub-register__cta-title">Ready to Compete?</h3>
      <p class="pub-register__cta-copy">
        Complete your team registration before the deadline to secure your place in the event.
      </p>
      <a
        v-if="!closed"
        class="pub-register__btn"
        :href="registration.registerUrl || '#register'"
      >
        <svg class="pub-register__btn-lock" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12.0001 17.3501C12.9003 17.3501 13.6301 16.6203 13.6301 15.7201C13.6301 14.8199 12.9003 14.0901 12.0001 14.0901C11.0999 14.0901 10.3701 14.8199 10.3701 15.7201C10.3701 16.6203 11.0999 17.3501 12.0001 17.3501Z" />
          <path d="M16.65 9.44H7.35C7.27 9.44 7.2 9.44 7.12 9.44V8.28C7.12 5.35 7.95 3.4 12 3.4C16.33 3.4 16.88 5.51 16.88 7.35C16.88 7.74 17.19 8.05 17.58 8.05C17.97 8.05 18.28 7.74 18.28 7.35C18.28 3.8 16.17 2 12 2C6.37 2 5.72 5.58 5.72 8.28V9.53C2.92 9.88 2 11.3 2 14.79V16.65C2 20.75 3.25 22 7.35 22H16.65C20.75 22 22 20.75 22 16.65V14.79C22 10.69 20.75 9.44 16.65 9.44ZM12 18.74C10.33 18.74 8.98 17.38 8.98 15.72C8.98 14.05 10.34 12.7 12 12.7C13.66 12.7 15.02 14.06 15.02 15.72C15.02 17.39 13.67 18.74 12 18.74Z" />
        </svg>
        <span>Register Team</span>
      </a>
      <span v-else class="pub-register__btn pub-register__btn--disabled" aria-disabled="true">Registration Closed</span>
    </div>
  </section>
</template>

<style scoped>
.pub-register {
  display: grid;
  grid-template-columns: 1fr minmax(0, 0.95fr);
  border-radius: 14px;
  overflow: hidden;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
/* Countdown (light) panel — content vertically centred so it lines up
   with the taller CTA panel beside it. */
.pub-register__count {
  padding: 18px;
  background: var(--surface-raised, #eef2f7);
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.pub-register__count-title {
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}
.pub-register__boxes {
  display: flex;
  gap: 10px;
}
.pub-register__box {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 4px;
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 10px;
}
.pub-register__box-value {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  line-height: 1;
}
.pub-register__box-label {
  font-size: 11px;
  color: var(--secondary);
}
.pub-register__close-line {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: var(--secondary);
  line-height: 1.45;
}
.pub-register__close-line strong { color: var(--text); }

/* CTA (navy) panel */
.pub-register__cta {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background:
    radial-gradient(circle at top right, rgba(79, 163, 255, 0.18), transparent 40%),
    linear-gradient(180deg, #1b2a44 0%, #16243b 100%);
  color: #fff;
}
.pub-register__cta-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
}
.pub-register__cta-copy {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.82);
}
/* Gold accent CTA — echoes the mock's yellow on navy while staying a
   single intentional accent. */
.pub-register__btn {
  align-self: flex-start;
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 18px;
  border-radius: 8px;
  /* Light mode: solid amber fill. */
  background: var(--warning, #ffd45a);
  border: 1px solid var(--warning, #ffd45a);
  color: #1b2a44;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, filter 120ms ease;
}
.pub-register__btn:hover { filter: brightness(0.94); }
/* Dark mode: amber outline instead of a solid fill. */
.pub-register__btn-lock { flex: 0 0 auto; display: block; }
html.dark-mode .pub-register__btn {
  background: transparent;
  color: var(--warning, #ffd768);
  border-color: var(--warning, #ffd768);
}
html.dark-mode .pub-register__btn:hover { filter: none; background: rgba(255, 215, 104, 0.12); }
.pub-register__btn--disabled {
  background: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.7);
  cursor: not-allowed;
}

@media (max-width: 520px) {
  .pub-register { grid-template-columns: 1fr; }
}
</style>
