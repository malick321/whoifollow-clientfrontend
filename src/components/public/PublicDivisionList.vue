<script setup lang="ts">
// PublicDivisionList
// ------------------
// The event's divisions as a horizontal PILL RAIL above the content. Sits
// in-flow inside the middle column and breaks out to full width when it
// pins to the top on scroll. A collapsible icon-only search (taps to
// expand, collapses when cleared) filters the pills; left/right nav arrows
// page the strip when it overflows; selecting a pill centres it.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import type { PublicDivision } from '../../types'

const props = defineProps<{
  divisions: PublicDivision[]
  selectedId: string
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'stuck-change', stuck: boolean): void
}>()

// ── Search (collapsible) ──
const search = ref('')
const searchOpen = ref(false)
const searchInput = ref<HTMLInputElement | null>(null)
function openSearch() {
  searchOpen.value = true
  void nextTick(() => searchInput.value?.focus())
}
function onSearchBlur() {
  if (!search.value.trim()) searchOpen.value = false
}
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return props.divisions
  return props.divisions.filter((d) => d.name.toLowerCase().includes(q))
})

// ── Rail + sticky/full-bleed ──
const rootRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const stuck = ref(false)
const canPrev = ref(false)
const canNext = ref(false)
let ro: ResizeObserver | null = null

function onWindowScroll() {
  const el = rootRef.value
  if (!el) return
  const cs = getComputedStyle(document.documentElement)
  const headerH = parseInt(cs.getPropertyValue('--public-header-h')) || 64
  const isStuck = el.getBoundingClientRect().top <= headerH + 1
  if (isStuck !== stuck.value) {
    stuck.value = isStuck
    emit('stuck-change', isStuck)
  }
  applyBleed()
}

// Full-bleed when stuck — computed from the column's real left offset (the
// middle column isn't centred, so the CSS `50% - 50vw` trick would be
// lopsided). `clientWidth` excludes the scrollbar, so no right-side gap.
function applyBleed() {
  const el = rootRef.value
  if (!el) return
  if (stuck.value) {
    const parentLeft = Math.round(el.parentElement?.getBoundingClientRect().left ?? 0)
    const cw = document.documentElement.clientWidth
    // Content gutter — aligns the pills with the page's max-width container
    // (1360) so the bar reads full-width with content from the left edge.
    const gutter = Math.max(20, Math.round((cw - 1360) / 2) + 20)
    el.style.marginLeft = `-${parentLeft}px`
    el.style.marginRight = '0px'
    el.style.width = `${cw}px`
    el.style.paddingLeft = `${gutter}px`
    el.style.paddingRight = `${gutter}px`
  } else {
    el.style.marginLeft = ''
    el.style.marginRight = ''
    el.style.width = ''
    el.style.paddingLeft = ''
    el.style.paddingRight = ''
  }
}

// Publish the rail's height so the brackets card pins below it.
function publishPillsHeight() {
  const h = Math.round(rootRef.value?.offsetHeight ?? 0)
  document.documentElement.style.setProperty('--public-pills-h', `${h}px`)
}

// ── Left / right nav arrows ──
function updateArrows() {
  const el = listRef.value
  if (!el) { canPrev.value = false; canNext.value = false; return }
  canPrev.value = el.scrollLeft > 2
  canNext.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 2
}
function step(dir: 1 | -1) {
  const el = listRef.value
  if (!el) return
  el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' })
}

/** Centre the active pill horizontally without moving the page. */
function centerActive(smooth = true) {
  void nextTick(() => {
    const el = listRef.value
    const item = el?.querySelector<HTMLElement>('.pub-divrail__pill--active')
    if (!el || !item) { updateArrows(); return }
    const lr = el.getBoundingClientRect()
    const ir = item.getBoundingClientRect()
    const delta = (ir.left - lr.left) - (el.clientWidth - item.clientWidth) / 2
    el.scrollTo({ left: el.scrollLeft + delta, behavior: smooth ? 'smooth' : 'auto' })
    void nextTick(updateArrows)
  })
}
function onSelect(id: string) {
  emit('select', id)
}

watch(() => props.selectedId, () => centerActive())
watch(filtered, () => void nextTick(updateArrows))

function onResize() { publishPillsHeight(); updateArrows() }
onMounted(() => {
  if (rootRef.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(onResize)
    ro.observe(rootRef.value)
  }
  window.addEventListener('scroll', onWindowScroll, { passive: true })
  window.addEventListener('resize', onResize)
  onWindowScroll()
  publishPillsHeight()
  centerActive(false)
  void nextTick(updateArrows)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('scroll', onWindowScroll)
  window.removeEventListener('resize', onResize)
  document.documentElement.style.removeProperty('--public-pills-h')
})
</script>

<template>
  <div ref="rootRef" class="pub-divrail" :class="{ 'pub-divrail--stuck': stuck }">
    <!-- Collapsible search — icon-only until tapped. -->
    <button
      v-if="!searchOpen"
      type="button"
      class="pub-divrail__search-btn app-tooltip"
      aria-label="Search divisions"
      data-tooltip="Search"
      @click="openSearch"
    >
      <AppIcon name="search" :size="16" />
    </button>
    <label v-else class="pub-divrail__search">
      <AppIcon name="search" :size="14" />
      <input
        ref="searchInput"
        v-model="search"
        type="search"
        :placeholder="`Search ${divisions.length} divisions`"
        :aria-label="`Search ${divisions.length} divisions`"
        @blur="onSearchBlur"
      />
    </label>

    <!-- Prev arrow -->
    <button
      v-show="canPrev"
      type="button"
      class="pub-divrail__nav"
      aria-label="Scroll divisions left"
      @click="step(-1)"
    >
      <span class="pub-divrail__nav-chev pub-divrail__nav-chev--prev" aria-hidden="true"></span>
    </button>

    <ul v-if="filtered.length" ref="listRef" class="pub-divrail__list" role="tablist" @scroll="updateArrows">
      <li
        v-for="d in filtered"
        :key="d.id"
        class="pub-divrail__pill"
        :class="{ 'pub-divrail__pill--active': d.id === selectedId }"
        role="tab"
        tabindex="0"
        :aria-selected="d.id === selectedId"
        @click="onSelect(d.id)"
        @keydown.enter="onSelect(d.id)"
        @keydown.space.prevent="onSelect(d.id)"
      >{{ d.name }}</li>
    </ul>
    <p v-else class="pub-divrail__empty">No divisions match “{{ search.trim() }}”.</p>

    <!-- Next arrow -->
    <button
      v-show="canNext"
      type="button"
      class="pub-divrail__nav"
      aria-label="Scroll divisions right"
      @click="step(1)"
    >
      <span class="pub-divrail__nav-chev pub-divrail__nav-chev--next" aria-hidden="true"></span>
    </button>
  </div>
</template>

<style scoped>
.pub-divrail {
  position: sticky;
  top: var(--public-header-h, 64px);
  z-index: 30;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  /* In-column above the brackets; transparent in flow. */
  margin-bottom: 12px;
  padding: 4px 0;
  background: transparent;
  transition: box-shadow 140ms ease, background-color 140ms ease;
}
/* When pinned, break out to full viewport width (margins/width/padding set
   in JS off the column's real offset) with a chromed bar + shadow. */
.pub-divrail--stuck {
  padding-top: 10px;
  padding-bottom: 10px;
  background: var(--surface-chrome);
  border-bottom: 1px solid var(--border-divider);
  box-shadow: 0 6px 12px -6px rgba(36, 60, 91, 0.22);
}
html.dark-mode .pub-divrail--stuck { box-shadow: 0 6px 12px -6px rgba(0, 0, 0, 0.5); }

/* Search — icon-only button, expands to a field. */
.pub-divrail__search-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card, #fff);
  color: var(--secondary);
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.pub-divrail__search-btn:hover { background: var(--surface-muted, #f1f5f9); border-color: var(--primary); color: var(--primary); }
.pub-divrail__search {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
  max-width: 45%;
  padding: 0 12px;
  height: 34px;
  border-radius: 8px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  color: var(--secondary);
}
html.dark-mode .pub-divrail__search { background: rgba(255, 255, 255, 0.04); }
.pub-divrail__search input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--text);
}

/* Left/right nav arrows — shown only when the strip overflows. */
.pub-divrail__nav {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--border-divider);
  background: var(--surface-card, #fff);
  color: var(--secondary);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.pub-divrail__nav:hover { background: var(--primary-light-3, #e5f1ff); color: var(--primary); }
.pub-divrail__nav-chev {
  width: 16px;
  height: 16px;
  display: block;
  background-color: currentColor;
  -webkit-mask: url('../../assets/arrow-left.svg') center / contain no-repeat;
  mask: url('../../assets/arrow-left.svg') center / contain no-repeat;
}
.pub-divrail__nav-chev--next { transform: rotate(180deg); }

/* Horizontal pill strip (scrollbar hidden). */
.pub-divrail__list {
  flex: 1 1 auto;
  min-width: 0;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
  scroll-snap-type: x proximity;
}
.pub-divrail__list::-webkit-scrollbar { display: none; }
.pub-divrail__pill {
  flex: 0 0 auto;
  scroll-snap-align: start;
  padding: 8px 14px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}
.pub-divrail__pill:hover:not(.pub-divrail__pill--active) { background: rgba(45, 140, 240, 0.06); }
.pub-divrail__pill--active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}
html.dark-mode .pub-divrail__pill--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}
.pub-divrail__empty { flex: 1 1 auto; margin: 0; font-size: 13px; color: var(--secondary); }

/* Mobile — no nav arrows (swipe the pill strip instead). */
@media (max-width: 720px) {
  .pub-divrail__nav { display: none !important; }
}
</style>
