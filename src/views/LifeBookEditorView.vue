<script setup lang="ts">
// LifeBookEditorView
// ------------------
// The page editor. Layout:
//   - Left rail: page thumbnails (add / reorder via ▲▼ / delete; cover + back
//     are locked). The active page is highlighted.
//   - Centre stage: the active page rendered with its template's slots —
//     interactive in edit mode (click a photo slot → PhotoPickerModal, click
//     text → inline contenteditable).
//   - Toolbar: template switcher, theme switcher, Save (PUT pages), Share
//     toggle (copies the public link), Export PDF (client-side print), and the
//     Auto-build entry (pick an event → autobuild → draft pages appear).
//
// Save semantics (§6 PUT /pages): the whole ordered page set is upserted by
// pageNumber, so reorders / template swaps / slot edits all persist in one call.
// PDF export is print-CSS based (window.print()) — zero deps; see exportPdf().

import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import SlideModal from '../components/SlideModal.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import PageTemplate from '../components/lifebook/PageTemplate.vue'
import PhotoPickerModal from '../components/lifebook/PhotoPickerModal.vue'
import TemplatePickerModal from '../components/lifebook/TemplatePickerModal.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import { THEMES, slotsForTemplate, templateMeta } from '../components/lifebook/lifebookCatalogue'
import {
  autoBuildLifeBook,
  deleteLifeBookPage,
  fetchLifeBook,
  saveLifeBookPages,
  setLifeBookShared,
  updateLifeBook,
  type LifeBook,
  type LifeBookPage
} from '../api/lifebook'
import { fetchDiscoverEvents, type DiscoverEvent } from '../api/discoverEvents'
import { getWebOrigin } from '../api/config'
import { pushToast } from '../toast-center'

const route = useRoute()
const router = useRouter()
const guid = computed(() => String(route.params.guid ?? ''))

const book = ref<LifeBook | null>(null)
const pages = ref<LifeBookPage[]>([])
const theme = ref('classic')
const activeIndex = ref(0)
const loading = ref(true)
const saving = ref(false)
const dirty = ref(false)

// Modals / panels
const photoPickerOpen = ref(false)
const photoSlotIndex = ref(0)
const templatePickerOpen = ref(false)
const autobuildOpen = ref(false)
const autobuildEventId = ref('') // resolved numeric event id (set when a suggestion is picked)
const autobuilding = ref(false)
// Event picker (search-by-name → suggestions → pick). Users don't know DB ids,
// so they type the event's NAME and choose from live suggestions; we keep the
// resolved id in `autobuildEventId` behind the scenes.
const eventQuery = ref('')
const eventSuggestions = ref<DiscoverEvent[]>([])
const eventSearching = ref(false)
let eventSearchTimer: ReturnType<typeof setTimeout> | null = null

const activePage = computed<LifeBookPage | null>(() => pages.value[activeIndex.value] ?? null)
const activeTemplateLabel = computed(() =>
  activePage.value ? templateMeta(activePage.value.template).label : ''
)
const isShared = computed(() => book.value?.isShared ?? false)
const canSwitchTemplate = computed(() => activePage.value?.type === 'content')

async function load() {
  loading.value = true
  try {
    const fetched = await fetchLifeBook(guid.value)
    book.value = fetched
    pages.value = fetched.pages.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s })) }))
    theme.value = fetched.theme
    activeIndex.value = 0
    dirty.value = false
  } catch {
    pushToast({ tone: 'warning', title: 'Could not open this book' })
    router.push({ name: 'lifebook' })
  } finally {
    loading.value = false
  }
}

onMounted(load)

function selectPage(i: number) {
  activeIndex.value = i
}

function markDirty() {
  dirty.value = true
}

// ── Slot editing ─────────────────────────────────────────────────────────────
function onPickPhoto(slotIndex: number) {
  photoSlotIndex.value = slotIndex
  photoPickerOpen.value = true
}

function onPhotoChosen(url: string) {
  const page = activePage.value
  if (!page) return
  const slot = page.slots.find((s) => s.index === photoSlotIndex.value)
  if (slot) {
    slot.photoUrl = url
    // Keep the book's cover photo in sync so the shelf tile shows it.
    if (page.type === 'cover' && book.value) book.value.coverPhotoUrl = url
    markDirty()
  }
}

function onEditText(slotIndex: number, value: string) {
  const page = activePage.value
  if (!page) return
  const slot = page.slots.find((s) => s.index === slotIndex)
  if (slot && slot.text !== value) {
    slot.text = value
    markDirty()
  }
}

// ── Template switching ───────────────────────────────────────────────────────
function applyTemplate(key: string) {
  const page = activePage.value
  if (!page || page.type !== 'content') return
  page.template = key
  page.slots = slotsForTemplate(key, page.slots)
  markDirty()
}

// ── Theme switching ──────────────────────────────────────────────────────────
function setTheme(key: string) {
  theme.value = key
  if (book.value) book.value.theme = key
  markDirty()
}

// ── Page management (add / reorder / delete) ─────────────────────────────────
function renumber() {
  pages.value.forEach((p, i) => {
    p.pageNumber = i + 1
    p.isLastPage = p.type === 'back'
  })
}

function backIndex(): number {
  const i = pages.value.findIndex((p) => p.type === 'back')
  return i === -1 ? pages.value.length : i
}

function addPage() {
  const insertAt = backIndex()
  const newPage: LifeBookPage = {
    id: `tmp-${Date.now()}`,
    pageNumber: insertAt + 1,
    type: 'content',
    template: 'full',
    slots: slotsForTemplate('full'),
    isNonDeletable: false,
    isLastPage: false
  }
  pages.value.splice(insertAt, 0, newPage)
  renumber()
  activeIndex.value = insertAt
  markDirty()
}

function canMove(i: number, dir: -1 | 1): boolean {
  const target = i + dir
  if (target < 0 || target >= pages.value.length) return false
  // Cover stays first, back stays last.
  if (pages.value[i].type !== 'content') return false
  if (pages.value[target].type !== 'content') return false
  return true
}

function movePage(i: number, dir: -1 | 1) {
  if (!canMove(i, dir)) return
  const target = i + dir
  const [moved] = pages.value.splice(i, 1)
  pages.value.splice(target, 0, moved)
  renumber()
  activeIndex.value = target
  markDirty()
}

async function removePage(i: number) {
  const page = pages.value[i]
  if (page.isNonDeletable || page.type !== 'content') return
  // Persisted pages (real id) get a server delete; unsaved temp pages just drop.
  if (!page.id.startsWith('tmp-')) {
    try {
      const updated = await deleteLifeBookPage(guid.value, page.id)
      book.value = updated
      pages.value = updated.pages.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s })) }))
      activeIndex.value = Math.min(i, pages.value.length - 1)
      pushToast({ tone: 'success', title: 'Page removed' })
      return
    } catch {
      pushToast({ tone: 'warning', title: 'Could not remove the page' })
      return
    }
  }
  pages.value.splice(i, 1)
  renumber()
  activeIndex.value = Math.min(i, pages.value.length - 1)
  markDirty()
}

// ── Save (§6 PUT /pages) ─────────────────────────────────────────────────────
async function save() {
  if (saving.value) return
  saving.value = true
  try {
    renumber()
    // Persist theme on the book first (§4) so the chrome survives reload.
    if (book.value) {
      await updateLifeBook(guid.value, { theme: theme.value })
    }
    const updated = await saveLifeBookPages(
      guid.value,
      pages.value.map((p) => ({ pageNumber: p.pageNumber, template: p.template, slots: p.slots }))
    )
    book.value = updated
    pages.value = updated.pages.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s })) }))
    theme.value = updated.theme
    activeIndex.value = Math.min(activeIndex.value, pages.value.length - 1)
    dirty.value = false
    pushToast({ tone: 'success', title: 'Saved' })
  } catch {
    pushToast({ tone: 'warning', title: 'Could not save', message: 'Your changes are still here — try again.' })
  } finally {
    saving.value = false
  }
}

// ── Auto-build (§7) ──────────────────────────────────────────────────────────
function openAutobuild() {
  autobuildEventId.value = book.value?.eventId ?? ''
  eventQuery.value = ''
  eventSuggestions.value = []
  autobuildOpen.value = true
}

// Debounced event-name search → suggestions. Typing invalidates any prior pick
// until the user selects a suggestion again.
function onEventQueryInput() {
  autobuildEventId.value = ''
  const q = eventQuery.value.trim()
  if (eventSearchTimer) clearTimeout(eventSearchTimer)
  if (q.length < 2) {
    eventSuggestions.value = []
    eventSearching.value = false
    return
  }
  eventSearching.value = true
  eventSearchTimer = setTimeout(async () => {
    try {
      const page = await fetchDiscoverEvents({ search: q, perPage: 8 })
      eventSuggestions.value = page.events
    } catch {
      eventSuggestions.value = []
    } finally {
      eventSearching.value = false
    }
  }, 280)
}

function selectEvent(ev: DiscoverEvent) {
  autobuildEventId.value = ev.id
  eventQuery.value = ev.name
  eventSuggestions.value = []
}

function clearEventSelection() {
  autobuildEventId.value = ''
  eventQuery.value = ''
  eventSuggestions.value = []
}

async function runAutobuild() {
  if (autobuilding.value) return
  autobuilding.value = true
  try {
    const updated = await autoBuildLifeBook(guid.value, {
      eventId: autobuildEventId.value.trim() || undefined
    })
    book.value = updated
    pages.value = updated.pages.map((p) => ({ ...p, slots: p.slots.map((s) => ({ ...s })) }))
    theme.value = updated.theme
    activeIndex.value = Math.min(1, pages.value.length - 1)
    dirty.value = false
    autobuildOpen.value = false
    pushToast({ tone: 'success', title: 'Draft pages added', message: 'Review and tweak as you like.' })
  } catch {
    pushToast({ tone: 'warning', title: 'Auto-build failed' })
  } finally {
    autobuilding.value = false
  }
}

// ── Share (§9) ───────────────────────────────────────────────────────────────
function sharedLink(slug: string): string {
  return `${getWebOrigin()}/lifebook/shared/${encodeURIComponent(slug)}`
}

async function toggleShare(next: boolean) {
  if (!book.value) return
  try {
    const result = await setLifeBookShared(guid.value, next)
    book.value.isShared = result.isShared
    book.value.shareSlug = result.shareSlug
    if (result.isShared && result.shareSlug) {
      await copyLink(result.shareSlug)
      pushToast({ tone: 'success', title: 'Sharing on', message: 'Public link copied to your clipboard.' })
    } else {
      pushToast({ tone: 'success', title: 'Sharing off' })
    }
  } catch {
    pushToast({ tone: 'warning', title: 'Could not update sharing' })
  }
}

async function copyLink(slug: string | null | undefined) {
  if (!slug) return
  const url = sharedLink(slug)
  try {
    await navigator.clipboard.writeText(url)
    pushToast({ tone: 'success', title: 'Link copied', message: url })
  } catch {
    pushToast({ tone: 'warning', title: 'Copy failed', message: url })
  }
}

// ── Export PDF (client-side, print-CSS) ──────────────────────────────────────
// No PDF dependency: a `@media print` layout (below) renders every page as a
// full-bleed sheet and we trigger the browser's print dialog, where the user
// picks "Save as PDF". The printed pages mirror the on-screen book exactly
// because they reuse the same PageTemplate renderer.
const printing = ref(false)
async function exportPdf() {
  printing.value = true
  await nextTick()
  // Defer so the print-only layout has mounted before the dialog opens.
  window.setTimeout(() => {
    window.print()
    printing.value = false
  }, 60)
}

function goBack() {
  router.push({ name: 'lifebook' })
}
</script>

<template>
  <div class="lb-editor">
    <!-- Loading -->
    <div v-if="loading" class="lb-editor__loading">
      <span class="lb-editor__spinner" aria-hidden="true" />
      <span>Opening your book…</span>
    </div>

    <template v-else-if="book">
      <!-- Toolbar -->
      <header class="lb-toolbar">
        <div class="lb-toolbar__left">
          <button type="button" class="lb-iconbtn" aria-label="Back to books" @click="goBack">
            <AppIcon name="close" :size="16" />
          </button>
          <div class="lb-toolbar__title">
            <span class="lb-toolbar__eyebrow">My Life Book</span>
            <h1 class="lb-toolbar__name">{{ book.title }}</h1>
          </div>
          <span v-if="dirty" class="lb-toolbar__dirty">Unsaved changes</span>
        </div>

        <div class="lb-toolbar__actions">
          <ThemeToggle />
          <button type="button" class="lb-btn lb-btn--ghost" @click="openAutobuild">
            <span class="lb-spark" aria-hidden="true">✦</span> Auto-build
          </button>
          <button type="button" class="lb-btn lb-btn--ghost" @click="exportPdf">Export PDF</button>
          <button type="button" class="lb-btn lb-btn--primary" :disabled="saving || !dirty" @click="save">
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </header>

      <!-- Secondary bar: theme + share -->
      <div class="lb-subbar">
        <div class="lb-subbar__group">
          <span class="lb-subbar__label">Theme</span>
          <div class="lb-theme-row">
            <button
              v-for="t in THEMES"
              :key="t.key"
              type="button"
              class="lb-theme-chip"
              :class="{ 'lb-theme-chip--active': theme === t.key }"
              :style="{ '--chip-a': t.gradient[0], '--chip-b': t.gradient[1] }"
              @click="setTheme(t.key)"
            >
              <span class="lb-theme-chip__swatch" aria-hidden="true" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <div class="lb-subbar__share">
          <span class="lb-subbar__label">Share</span>
          <ToggleSwitch
            :model-value="isShared"
            aria-label="Share publicly"
            @update:model-value="toggleShare"
          />
          <button
            v-if="isShared && book.shareSlug"
            type="button"
            class="lb-linkbtn"
            @click="copyLink(book.shareSlug)"
          >
            Copy link
          </button>
        </div>
      </div>

      <!-- Body: rail + stage -->
      <div class="lb-body">
        <!-- Page rail -->
        <aside class="lb-rail" aria-label="Pages">
          <ol class="lb-rail__list">
            <li
              v-for="(page, i) in pages"
              :key="page.id"
              class="lb-rail__item"
              :class="{ 'lb-rail__item--active': i === activeIndex }"
            >
              <button type="button" class="lb-thumb" @click="selectPage(i)">
                <span class="lb-thumb__canvas">
                  <PageTemplate :page="page" :theme="theme" :book-title="book.title" mode="readonly" />
                </span>
                <span class="lb-thumb__label">
                  <span class="lb-thumb__num">{{ i + 1 }}</span>
                  <span class="lb-thumb__type">
                    {{ page.type === 'cover' ? 'Cover' : page.type === 'back' ? 'Back' : templateMeta(page.template).label }}
                  </span>
                </span>
              </button>
              <div v-if="page.type === 'content'" class="lb-thumb__ctrls">
                <button type="button" class="lb-thumb__ctrl" :disabled="!canMove(i, -1)" aria-label="Move up" @click="movePage(i, -1)">▲</button>
                <button type="button" class="lb-thumb__ctrl" :disabled="!canMove(i, 1)" aria-label="Move down" @click="movePage(i, 1)">▼</button>
                <button type="button" class="lb-thumb__ctrl lb-thumb__ctrl--danger" aria-label="Delete page" @click="removePage(i)">
                  <AppIcon name="close" :size="13" />
                </button>
              </div>
              <span v-else class="lb-thumb__locked" title="Locked page">Locked</span>
            </li>
          </ol>
          <button type="button" class="lb-rail__add" @click="addPage">
            <span class="lb-btn__plus">+</span> Add page
          </button>
        </aside>

        <!-- Stage -->
        <section class="lb-stage">
          <div class="lb-stage__inner" v-if="activePage">
            <div class="lb-stage__sheet">
              <PageTemplate
                :page="activePage"
                :theme="theme"
                :book-title="book.title"
                mode="edit"
                @pick-photo="onPickPhoto"
                @edit-text="onEditText"
              />
            </div>

            <div class="lb-stage__bar">
              <button
                v-if="canSwitchTemplate"
                type="button"
                class="lb-btn lb-btn--ghost"
                @click="templatePickerOpen = true"
              >
                Layout · {{ activeTemplateLabel }}
              </button>
              <span v-else class="lb-stage__hint">
                {{ activePage.type === 'cover' ? 'Cover page' : 'Closing page' }} · layout locked
              </span>
              <span class="lb-stage__pagenum">Page {{ activeIndex + 1 }} of {{ pages.length }}</span>
            </div>
          </div>
        </section>
      </div>
    </template>

    <!-- Photo picker -->
    <PhotoPickerModal
      v-model="photoPickerOpen"
      :event-id="book?.eventId ?? null"
      @select="onPhotoChosen"
    />

    <!-- Template picker -->
    <TemplatePickerModal
      v-model="templatePickerOpen"
      :current="activePage?.template ?? 'full'"
      @select="applyTemplate"
    />

    <!-- Auto-build panel -->
    <SlideModal v-model="autobuildOpen" title="Auto-build" subtitle="Fill draft pages from an event">
      <div class="lb-form">
        <p class="lb-autobuild-note">
          We'll pull your event photos and lay them out across full, two-up, quad and collage
          pages between your cover and back. Leave the field blank to use your recent photos.
        </p>
        <label class="lb-field">
          <span class="lb-field__label">Event <span class="lb-field__opt">(optional)</span></span>
          <div class="lb-event-pick">
            <input
              v-model="eventQuery"
              type="text"
              class="lb-input"
              placeholder="Search your events by name"
              autocomplete="off"
              @input="onEventQueryInput"
            />
            <button
              v-if="eventQuery || autobuildEventId"
              type="button"
              class="lb-event-pick__clear"
              aria-label="Clear event"
              @click="clearEventSelection"
            >×</button>

            <ul v-if="eventSuggestions.length" class="lb-event-pick__list">
              <li
                v-for="ev in eventSuggestions"
                :key="ev.id"
                class="lb-event-pick__item"
                @click="selectEvent(ev)"
              >
                <span class="lb-event-pick__name">{{ ev.name }}</span>
                <span
                  v-if="ev.dateRangeLabel || ev.association.name"
                  class="lb-event-pick__meta"
                >{{ [ev.dateRangeLabel, ev.association.name].filter(Boolean).join(' · ') }}</span>
              </li>
            </ul>
            <p v-else-if="eventSearching" class="lb-event-pick__hint">Searching…</p>
            <p
              v-else-if="eventQuery.trim().length >= 2 && !autobuildEventId"
              class="lb-event-pick__hint"
            >No matching events.</p>
          </div>
          <span v-if="autobuildEventId" class="lb-event-pick__selected">✓ We'll use this event's photos</span>
        </label>
      </div>
      <template #footer>
        <div class="lb-footer">
          <button type="button" class="lb-btn lb-btn--ghost" @click="autobuildOpen = false">Cancel</button>
          <button type="button" class="lb-btn lb-btn--primary" :disabled="autobuilding" @click="runAutobuild">
            {{ autobuilding ? 'Building…' : 'Build pages' }}
          </button>
        </div>
      </template>
    </SlideModal>

    <!-- Print-only flipbook layout (client-side PDF via window.print()) -->
    <div v-if="book" class="lb-print" aria-hidden="true">
      <div v-for="page in pages" :key="`print-${page.id}`" class="lb-print__page">
        <PageTemplate :page="page" :theme="theme" :book-title="book.title" mode="readonly" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.lb-editor {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--body-bg);
}

/* Loading ------------------------------------------------------------- */
.lb-editor__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 70vh;
  color: var(--text-light);
}
.lb-editor__spinner {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 3px solid var(--border-divider);
  border-top-color: var(--primary);
  animation: lb-spin 0.8s linear infinite;
}
@keyframes lb-spin { to { transform: rotate(360deg); } }

/* Toolbar ------------------------------------------------------------- */
.lb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 14px 24px;
  background: var(--surface-chrome);
  border-bottom: 1px solid var(--border-divider);
  position: sticky;
  top: 0;
  z-index: 6;
  backdrop-filter: blur(10px) saturate(1.4);
  box-shadow: var(--shadow-soft);
}
.lb-toolbar__left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.lb-toolbar__title { min-width: 0; }
.lb-toolbar__eyebrow {
  display: block;
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--primary);
}
.lb-toolbar__name {
  margin: 1px 0 0;
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 38ch;
}
.lb-toolbar__dirty {
  font-size: 0.72rem;
  color: var(--warning);
  background: var(--light-warning);
  padding: 3px 9px;
  border-radius: 999px;
  white-space: nowrap;
}
.lb-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.lb-iconbtn {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  cursor: pointer;
}
.lb-iconbtn:hover { border-color: var(--border-accent-hover); }
.lb-spark { color: var(--primary); }

/* Subbar -------------------------------------------------------------- */
.lb-subbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 24px;
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-divider);
  flex-wrap: wrap;
}
.lb-subbar__group,
.lb-subbar__share {
  display: flex;
  align-items: center;
  gap: 12px;
}
.lb-subbar__label {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-light);
}
.lb-linkbtn {
  border: none;
  background: none;
  color: var(--primary);
  font-size: 0.84rem;
  cursor: pointer;
  padding: 0;
}
.lb-linkbtn:hover { text-decoration: underline; }

/* Body ---------------------------------------------------------------- */
.lb-body {
  flex: 1;
  display: grid;
  grid-template-columns: 230px 1fr;
  min-height: 0;
}

/* Rail ---------------------------------------------------------------- */
.lb-rail {
  border-right: 1px solid var(--border-divider);
  background: var(--surface-card);
  padding: 16px 12px 22px;
  overflow-y: auto;
}
.lb-rail__list {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.lb-rail__item {
  border-radius: var(--radius-md);
  padding: 8px;
  border: 1px solid transparent;
  transition: border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
}
.lb-rail__item:hover {
  background: var(--surface-raised);
}
.lb-rail__item--active {
  border-color: var(--primary);
  background: var(--surface-raised);
  box-shadow: 0 0 0 1px var(--primary) inset, var(--shadow-soft);
}
.lb-thumb {
  display: block;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}
.lb-thumb__canvas {
  display: block;
  width: 100%;
  pointer-events: none;
}
.lb-thumb__label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
}
.lb-thumb__num {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--surface-pill);
  font-size: 0.66rem;
  color: var(--text-light);
}
.lb-thumb__type {
  font-size: 0.76rem;
  color: var(--text);
}
.lb-thumb__ctrls {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
}
.lb-thumb__ctrl {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text-light);
  font-size: 0.7rem;
  cursor: pointer;
}
.lb-thumb__ctrl:hover:not(:disabled) { border-color: var(--border-accent-hover); color: var(--text); }
.lb-thumb__ctrl:disabled { opacity: 0.35; cursor: default; }
.lb-thumb__ctrl--danger { margin-left: auto; }
.lb-thumb__ctrl--danger:hover { color: var(--highlight); border-color: var(--highlight); }
.lb-thumb__locked {
  display: inline-block;
  margin-top: 8px;
  font-size: 0.66rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-light);
  opacity: 0.7;
}
.lb-rail__add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 10px;
  border-radius: var(--radius-md);
  border: 1px dashed var(--border-accent);
  background: var(--surface-card);
  color: var(--primary);
  font-size: 0.86rem;
  cursor: pointer;
}
.lb-rail__add:hover { background: var(--primary-light-3); }

/* Stage --------------------------------------------------------------- */
.lb-stage {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 48px 24px;
  overflow-y: auto;
  /* A soft "desk" backdrop so the white sheet reads as a physical leaf
     resting on a surface, not floating on the page. */
  background:
    radial-gradient(140% 80% at 50% -10%, color-mix(in srgb, var(--primary) 7%, transparent), transparent 60%),
    var(--body-bg);
}
.lb-stage__inner {
  width: 100%;
  max-width: 540px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.lb-stage__sheet {
  container-type: inline-size;
  transition: transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.lb-stage__sheet:hover {
  transform: translateY(-2px);
}
.lb-stage__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.lb-stage__hint,
.lb-stage__pagenum {
  font-size: 0.8rem;
  color: var(--text-light);
}

/* Form (shared with autobuild panel) ---------------------------------- */
.lb-form { display: flex; flex-direction: column; gap: 18px; }
.lb-autobuild-note {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--text-light);
}
.lb-field { display: flex; flex-direction: column; gap: 8px; }
.lb-field__label { font-size: 0.82rem; color: var(--text); }
.lb-field__opt { color: var(--text-light); }
.lb-input {
  font-family: var(--font-body);
  font-size: 0.92rem;
  padding: 11px 13px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-divider);
  background: var(--surface-card);
  color: var(--text);
  outline: none;
}
.lb-input:focus { border-color: var(--primary); box-shadow: 0 0 0 3px var(--primary-light-3); }

/* Event picker (search-by-name → suggestions) */
.lb-event-pick { position: relative; display: flex; flex-direction: column; }
.lb-event-pick .lb-input { width: 100%; padding-right: 34px; }
.lb-event-pick__clear {
  position: absolute;
  top: 0;
  right: 0;
  height: 42px;
  width: 34px;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-light);
  font-size: 20px;
  line-height: 1;
}
.lb-event-pick__clear:hover { color: var(--text); }
.lb-event-pick__list {
  list-style: none;
  margin: 6px 0 0;
  padding: 4px;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  max-height: 240px;
  overflow-y: auto;
}
.lb-event-pick__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
}
.lb-event-pick__item:hover { background: var(--primary-light-3); }
.lb-event-pick__name { font-size: 0.85rem; font-weight: 500; color: var(--text); }
.lb-event-pick__meta { font-size: 0.72rem; color: var(--text-light); }
.lb-event-pick__hint { margin: 6px 2px 0; font-size: 0.78rem; color: var(--text-light); }
.lb-event-pick__selected { margin-top: 6px; font-size: 0.78rem; color: var(--primary); }

/* Theme chips (shared) ------------------------------------------------ */
.lb-theme-row { display: flex; flex-wrap: wrap; gap: 8px; }
.lb-theme-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px 6px 7px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-pill);
  color: var(--text);
  font-size: 0.8rem;
  cursor: pointer;
  transition: border-color 140ms ease;
}
.lb-theme-chip:hover { border-color: var(--border-accent-hover); }
.lb-theme-chip--active { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary) inset; }
.lb-theme-chip__swatch {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: linear-gradient(150deg, var(--chip-a), var(--chip-b));
  box-shadow: 0 0 0 1px var(--inset-highlight) inset;
}

/* Buttons (shared) ---------------------------------------------------- */
.lb-footer { display: flex; justify-content: flex-end; gap: 10px; width: 100%; }
.lb-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 0.88rem;
  padding: 9px 16px;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 160ms ease, border-color 160ms ease, transform 120ms ease, opacity 160ms ease;
}
.lb-btn:disabled { opacity: 0.5; cursor: default; }
.lb-btn__plus { font-size: 1.05rem; line-height: 1; }
.lb-btn--primary { background: var(--primary); color: #fff; }
.lb-btn--primary:hover:not(:disabled) { transform: translateY(-1px); }
.lb-btn--ghost { background: var(--surface-btn-solid); border-color: var(--border-divider); color: var(--text); }
.lb-btn--ghost:hover:not(:disabled) { border-color: var(--border-accent-hover); }

/* Print layout (hidden on screen; the only thing printed) ------------- */
.lb-print { display: none; }

@media print {
  .lb-toolbar,
  .lb-subbar,
  .lb-rail,
  .lb-stage { display: none !important; }
  .lb-editor { background: #fff; }
  .lb-print {
    display: block;
  }
  .lb-print__page {
    width: 100%;
    page-break-after: always;
    break-after: page;
    padding: 0;
  }
  .lb-print__page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  @page {
    margin: 12mm;
    size: portrait;
  }
}

@media (max-width: 840px) {
  .lb-body { grid-template-columns: 1fr; }
  .lb-rail {
    border-right: none;
    border-bottom: 1px solid var(--border-divider);
    max-height: 200px;
  }
  .lb-rail__list { flex-direction: row; overflow-x: auto; }
  .lb-rail__item { min-width: 120px; }
}
</style>
