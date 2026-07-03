<script setup lang="ts">
// BracketDivisionSwitcher
// -----------------------
// Eyebrow-style outlined dropdown shown in the PAGE HEADER (the
// MatchGeniHeader `#title-main` slot) whenever a bracket canvas is open —
// on BOTH surfaces, the game scheduler and the division-detail page. Lets
// the user switch the division whose bracket is on the canvas without
// leaving full-screen. (`variant="header"` styles it for the dark header
// band; `variant="canvas"` remains for any frosted on-canvas use.)
//
// Stateless re: data — the host passes its already-loaded division list
// (no refetch) and the current selection; selecting emits `select` and
// the host swaps the active division (which re-renders the bracket).

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface DivisionSwitchOption {
  id: string
  name: string
  /** Optional date-range label shown under the name in the menu. */
  dateLabel?: string
}

const props = withDefaults(defineProps<{
  divisions: DivisionSwitchOption[]
  selectedId: string
  /** `canvas` (default) — frosted light chip over the dotted bracket
   *  canvas. `header` — translucent white-on-dark chip matching the
   *  header's theme-toggle button (the header band is dark in both
   *  themes), used when the switcher sits in the page header. */
  variant?: 'canvas' | 'header'
}>(), {
  divisions: () => [],
  variant: 'canvas'
})

const emit = defineEmits<{
  (event: 'select', id: string): void
}>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)

const selected = computed(() => props.divisions.find((d) => d.id === props.selectedId) ?? null)
const selectedName = computed(() => selected.value?.name ?? 'Division')
const canSwitch = computed(() => props.divisions.length > 1)

function toggle() {
  if (canSwitch.value) open.value = !open.value
}
function choose(id: string) {
  open.value = false
  if (id !== props.selectedId) emit('select', id)
}
function onDocMouseDown(event: MouseEvent) {
  const target = event.target as Node | null
  if (open.value && rootRef.value && target && !rootRef.value.contains(target)) open.value = false
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    open.value = false
  }
}
onMounted(() => {
  document.addEventListener('mousedown', onDocMouseDown)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootRef" class="bracket-div-switch" :class="`bracket-div-switch--${variant}`">
    <button
      type="button"
      class="bracket-div-switch__trigger"
      :class="{
        'bracket-div-switch__trigger--open': open,
        'bracket-div-switch__trigger--static': !canSwitch
      }"
      :disabled="!canSwitch"
      aria-haspopup="listbox"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggle"
    >
      <span class="bracket-div-switch__eyebrow">{{ selected?.dateLabel || 'Division' }}</span>
      <span class="bracket-div-switch__current">
        <span class="bracket-div-switch__name">{{ selectedName }}</span>
        <span v-if="canSwitch" class="bracket-div-switch__chevron" aria-hidden="true"></span>
      </span>
    </button>

    <ul v-if="open" class="bracket-div-switch__menu" role="listbox">
      <li v-for="d in divisions" :key="d.id">
        <button
          type="button"
          role="option"
          :aria-selected="d.id === selectedId ? 'true' : 'false'"
          class="bracket-div-switch__option"
          :class="{ 'bracket-div-switch__option--active': d.id === selectedId }"
          @click="choose(d.id)"
        >
          <span v-if="d.dateLabel" class="bracket-div-switch__option-date">{{ d.dateLabel }}</span>
          <span class="bracket-div-switch__option-name">{{ d.name }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bracket-div-switch {
  position: relative;
  display: inline-block;
}
/* Outlined eyebrow trigger — opaque surface so it stays readable over
   the (transparent) bracket canvas. */
.bracket-div-switch__trigger {
  appearance: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 6px 12px;
  border: 1px solid rgba(135, 161, 194, 0.3);
  border-radius: 8px;
  /* Frosted glass — translucent surface + blur so the dotted canvas
     reads softly through it. */
  background: rgba(255, 255, 255, 0.65);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 4px 12px rgba(21, 37, 56, 0.12);
  cursor: pointer;
  text-align: left;
  transition: border-color 120ms ease, background-color 120ms ease;
}
html.dark-mode .bracket-div-switch__trigger {
  background: rgba(26, 32, 40, 0.55);
  border-color: rgba(255, 255, 255, 0.16);
}
.bracket-div-switch__trigger--static {
  cursor: default;
}
.bracket-div-switch__trigger:not(.bracket-div-switch__trigger--static):hover,
.bracket-div-switch__trigger--open {
  border-color: var(--primary);
}
/* Now carries the division's date range (not a fixed label) — keep it a
   small primary eyebrow but drop the uppercasing so a date reads
   naturally. */
/* Date label — neutral, not primary blue: the trigger sits in the page
   header (a tinted band) where blue-on-blue washed out. A muted slate
   reads clearly on the frosted pill in light mode; lift it in dark mode. */
.bracket-div-switch__eyebrow {
  font-size: 11px;
  font-weight: 600;
  color: var(--secondary);
  line-height: 1.1;
}
html.dark-mode .bracket-div-switch__eyebrow {
  color: rgba(255, 255, 255, 0.72);
}
.bracket-div-switch__current {
  display: flex;
  width: 100%;
  align-items: center;
  /* Name on the left, chevron pushed to the right edge. */
  justify-content: space-between;
  gap: 12px;
}
.bracket-div-switch__name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  white-space: nowrap;
}
.bracket-div-switch__chevron {
  width: 8px;
  height: 8px;
  border-right: 2px solid var(--secondary);
  border-bottom: 2px solid var(--secondary);
  transform: rotate(45deg);
  margin-top: -3px;
  flex: 0 0 auto;
  transition: transform 120ms ease;
}
.bracket-div-switch__trigger--open .bracket-div-switch__chevron {
  transform: rotate(225deg);
  margin-top: 2px;
}

/* ── Header variant ──────────────────────────────────────────────
   When the switcher sits in the page header (a dark gradient band in
   BOTH themes), the trigger matches the header's theme-toggle button:
   a translucent white chip with a faint white border + white text. The
   dark-mode-qualified selectors are paired in so they out-specify the
   base `html.dark-mode .bracket-div-switch__*` rules. */
.bracket-div-switch--header .bracket-div-switch__trigger,
html.dark-mode .bracket-div-switch--header .bracket-div-switch__trigger {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.18);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow: none;
}
.bracket-div-switch--header .bracket-div-switch__trigger:not(.bracket-div-switch__trigger--static):hover,
.bracket-div-switch--header .bracket-div-switch__trigger--open,
html.dark-mode .bracket-div-switch--header .bracket-div-switch__trigger:not(.bracket-div-switch__trigger--static):hover,
html.dark-mode .bracket-div-switch--header .bracket-div-switch__trigger--open {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.32);
}
.bracket-div-switch--header .bracket-div-switch__eyebrow,
html.dark-mode .bracket-div-switch--header .bracket-div-switch__eyebrow {
  color: rgba(255, 255, 255, 0.72);
}
.bracket-div-switch--header .bracket-div-switch__name,
html.dark-mode .bracket-div-switch--header .bracket-div-switch__name {
  color: #fff;
}
.bracket-div-switch--header .bracket-div-switch__chevron {
  border-right-color: rgba(255, 255, 255, 0.8);
  border-bottom-color: rgba(255, 255, 255, 0.8);
}

/* Menu */
.bracket-div-switch__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  min-width: 220px;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  padding: 6px;
  list-style: none;
  /* Frosted glass — matches the trigger. */
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(135, 161, 194, 0.3);
  border-radius: 10px;
  box-shadow: 0 12px 28px rgba(21, 37, 56, 0.22);
}
html.dark-mode .bracket-div-switch__menu {
  background: rgba(26, 32, 40, 0.7);
  border-color: rgba(255, 255, 255, 0.16);
}
.bracket-div-switch__option {
  appearance: none;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
}
.bracket-div-switch__option:hover {
  background: rgba(45, 140, 240, 0.08);
}
.bracket-div-switch__option--active {
  background: var(--primary-light-3, #e5f1ff);
}
html.dark-mode .bracket-div-switch__option--active {
  background: rgba(45, 140, 240, 0.16);
}
.bracket-div-switch__option-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.bracket-div-switch__option--active .bracket-div-switch__option-name {
  color: var(--primary);
}
/* Date — black (primary text color) at the same size as the trigger's
   selected-date eyebrow. */
.bracket-div-switch__option-date {
  font-size: 11px;
  color: var(--text);
}
</style>
