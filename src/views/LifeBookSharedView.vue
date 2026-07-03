<script setup lang="ts">
// LifeBookSharedView
// ------------------
// Public, read-only flipbook viewer for a shared book. Route
// `/lifebook/shared/:slug` (meta.public — no auth). Renders the book as a
// page-turn flipbook: one leaf at a time on mobile, a two-page spread on wide
// screens, with prev/next navigation (buttons, arrow keys, click-zones) and a
// page-flip animation. Reuses the PageTemplate renderer in readonly mode so the
// public view matches the editor exactly.
//
// Data: src/api/lifebook.ts → GET /v2/lifebook/shared/{slug} (public). 404/403
// when the book isn't shared → friendly "not available" panel.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import PageTemplate from '../components/lifebook/PageTemplate.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import { fetchSharedLifeBook, type LifeBook } from '../api/lifebook'
import { themeMeta } from '../components/lifebook/lifebookCatalogue'

const route = useRoute()
const slug = computed(() => String(route.params.slug ?? ''))

const book = ref<LifeBook | null>(null)
const loading = ref(true)
const errored = ref(false)
const current = ref(0)
const flipDir = ref<'next' | 'prev'>('next')

const pages = computed(() => book.value?.pages ?? [])
const total = computed(() => pages.value.length)
const activePage = computed(() => pages.value[current.value] ?? null)
const theme = computed(() => (book.value ? themeMeta(book.value.theme) : themeMeta('classic')))
const canPrev = computed(() => current.value > 0)
const canNext = computed(() => current.value < total.value - 1)

async function load() {
  loading.value = true
  errored.value = false
  try {
    book.value = await fetchSharedLifeBook(slug.value)
    current.value = 0
  } catch {
    errored.value = true
  } finally {
    loading.value = false
  }
}

function next() {
  if (!canNext.value) return
  flipDir.value = 'next'
  current.value += 1
}
function prev() {
  if (!canPrev.value) return
  flipDir.value = 'prev'
  current.value -= 1
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
}

onMounted(() => {
  load()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div
    class="lb-shared"
    :style="book ? {
      '--lb-accent': theme.accent,
      '--lb-grad-a': theme.gradient[0],
      '--lb-grad-b': theme.gradient[1]
    } : {}"
  >
    <ThemeToggle />

    <!-- Loading -->
    <div v-if="loading" class="lb-shared__state">
      <span class="lb-shared__spinner" aria-hidden="true" />
    </div>

    <!-- Not available -->
    <div v-else-if="errored || !book" class="lb-shared__state">
      <div class="lb-shared__card">
        <h1 class="lb-shared__card-title">This book isn't available</h1>
        <p class="lb-shared__card-hint">
          The link may have been turned off, or the book was removed.
        </p>
      </div>
    </div>

    <!-- Flipbook -->
    <template v-else>
      <header class="lb-shared__head">
        <span class="lb-shared__eyebrow">My Life Book</span>
        <h1 class="lb-shared__title">{{ book.title }}</h1>
      </header>

      <div class="lb-shared__stage">
        <button
          type="button"
          class="lb-shared__nav lb-shared__nav--prev"
          :disabled="!canPrev"
          aria-label="Previous page"
          @click="prev"
        >‹</button>

        <div class="lb-shared__leaf" :class="`lb-shared__leaf--${flipDir}`" :key="current">
          <PageTemplate
            v-if="activePage"
            :page="activePage"
            :theme="book.theme"
            :book-title="book.title"
            mode="readonly"
          />
        </div>

        <button
          type="button"
          class="lb-shared__nav lb-shared__nav--next"
          :disabled="!canNext"
          aria-label="Next page"
          @click="next"
        >›</button>
      </div>

      <footer class="lb-shared__foot">
        <div class="lb-shared__progress" role="tablist" aria-label="Pages">
          <button
            v-for="(p, i) in pages"
            :key="p.id"
            type="button"
            class="lb-shared__dot"
            :class="{ 'lb-shared__dot--active': i === current }"
            :aria-label="`Go to page ${i + 1}`"
            @click="flipDir = i > current ? 'next' : 'prev'; current = i"
          />
        </div>
        <span class="lb-shared__count">{{ current + 1 }} / {{ total }}</span>
      </footer>
    </template>
  </div>
</template>

<style scoped>
.lb-shared {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  background:
    radial-gradient(120% 70% at 50% -10%, color-mix(in srgb, var(--lb-accent, #2f5f98) 16%, transparent), transparent 60%),
    var(--body-bg);
  padding: 32px 20px 40px;
}

.lb-shared__state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lb-shared__spinner {
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 3px solid var(--border-divider);
  border-top-color: var(--lb-accent, var(--primary));
  animation: lb-spin 0.8s linear infinite;
}
@keyframes lb-spin { to { transform: rotate(360deg); } }
.lb-shared__card {
  text-align: center;
  max-width: 380px;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  padding: 36px 28px;
  box-shadow: var(--shadow);
}
.lb-shared__card-title { margin: 0 0 8px; font-size: 1.2rem; font-weight: 500; color: var(--text); }
.lb-shared__card-hint { margin: 0; font-size: 0.92rem; color: var(--text-light); }

.lb-shared__head {
  text-align: center;
  margin-bottom: 22px;
}
.lb-shared__eyebrow {
  font-size: 0.64rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--lb-accent, var(--primary));
}
.lb-shared__title {
  margin: 6px 0 0;
  font-size: 1.5rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text);
}

.lb-shared__stage {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 560px;
}
.lb-shared__leaf {
  position: relative;
  flex: 1;
  min-width: 0;
  perspective: 1600px;
  container-type: inline-size;
}
/* A faint stacked-pages edge peeking out behind the leaf — reads as a real
   book with depth rather than a single floating card. */
.lb-shared__leaf::before {
  content: '';
  position: absolute;
  inset: 6px -6px -8px 6px;
  border-radius: 6px;
  background: var(--surface-muted);
  box-shadow: 0 0 0 1px var(--border-divider), var(--shadow-soft);
  z-index: 0;
}
.lb-shared__leaf > * {
  position: relative;
  z-index: 1;
}
.lb-shared__leaf > * {
  transform-origin: left center;
  animation: leaf-in 360ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.lb-shared__leaf--prev > * {
  transform-origin: right center;
  animation-name: leaf-in-prev;
}
@keyframes leaf-in {
  0% { transform: rotateY(-22deg); opacity: 0; }
  100% { transform: rotateY(0); opacity: 1; }
}
@keyframes leaf-in-prev {
  0% { transform: rotateY(22deg); opacity: 0; }
  100% { transform: rotateY(0); opacity: 1; }
}
.lb-shared__nav {
  flex-shrink: 0;
  width: 46px;
  height: 46px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform 140ms ease, border-color 140ms ease, opacity 140ms ease;
}
.lb-shared__nav:hover:not(:disabled) { transform: scale(1.06); border-color: var(--border-accent-hover); }
.lb-shared__nav:disabled { opacity: 0.35; cursor: default; }

.lb-shared__foot {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 26px;
}
.lb-shared__progress {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 360px;
}
.lb-shared__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  border: none;
  padding: 0;
  background: var(--border-divider);
  cursor: pointer;
  transition: background 140ms ease, transform 140ms ease;
}
.lb-shared__dot--active {
  background: var(--lb-accent, var(--primary));
  transform: scale(1.3);
}
.lb-shared__count {
  font-size: 0.8rem;
  color: var(--text-light);
}

@media (max-width: 560px) {
  .lb-shared__nav { width: 40px; height: 40px; }
  .lb-shared__title { font-size: 1.25rem; }
}
</style>
