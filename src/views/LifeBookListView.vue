<script setup lang="ts">
// LifeBookListView
// ----------------
// The My Life Book home — a shelf of book covers (cover photo + title + page
// count) plus a "New Book" flow. The create panel surfaces the AUTO-BUILD
// option prominently (the flagship): pick an event and the backend seeds the
// book AND populates draft pages in one shot. Open routes to the editor;
// delete is guarded by a confirm.
//
// Data: src/api/lifebook.ts (GET/POST/DELETE /v2/lifebook/books).

import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import SlideModal from '../components/SlideModal.vue'
import AppIcon from '../components/AppIcon.vue'
import ToggleSwitch from '../components/ToggleSwitch.vue'
import BookCover from '../components/lifebook/BookCover.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import { THEMES } from '../components/lifebook/lifebookCatalogue'
import {
  createLifeBook,
  deleteLifeBook,
  fetchLifeBooks,
  type LifeBookSummary
} from '../api/lifebook'
import { fetchDiscoverEvents, type DiscoverEvent } from '../api/discoverEvents'
import { pushToast } from '../toast-center'

const router = useRouter()

const books = ref<LifeBookSummary[]>([])
const loading = ref(true)

// Create flow ----------------------------------------------------------------
const createOpen = ref(false)
const newTitle = ref('')
const newTheme = ref('classic')
const autoBuildOn = ref(true)
const newEventId = ref('') // resolved numeric event id (set when a suggestion is picked)
const creating = ref(false)
// Event picker — users type the event NAME and pick from live suggestions;
// the resolved id is kept in `newEventId` behind the scenes.
const eventQuery = ref('')
const eventSuggestions = ref<DiscoverEvent[]>([])
const eventSearching = ref(false)
let eventSearchTimer: ReturnType<typeof setTimeout> | null = null

// Per-book menu / delete ------------------------------------------------------
const menuFor = ref<string | null>(null)
const deleteTarget = ref<LifeBookSummary | null>(null)
const deleting = ref(false)

const canCreate = computed(() => newTitle.value.trim().length > 0)

async function loadBooks() {
  loading.value = true
  try {
    books.value = await fetchLifeBooks()
  } catch {
    pushToast({ tone: 'warning', title: 'Could not load your books' })
  } finally {
    loading.value = false
  }
}

onMounted(loadBooks)

function openCreate() {
  newTitle.value = ''
  newTheme.value = 'classic'
  autoBuildOn.value = true
  newEventId.value = ''
  eventQuery.value = ''
  eventSuggestions.value = []
  createOpen.value = true
}

// Debounced event-name search → suggestions. Typing invalidates any prior pick
// until the user selects a suggestion again.
function onEventQueryInput() {
  newEventId.value = ''
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
  newEventId.value = ev.id
  eventQuery.value = ev.name
  eventSuggestions.value = []
}

function clearEventSelection() {
  newEventId.value = ''
  eventQuery.value = ''
  eventSuggestions.value = []
}

async function submitCreate() {
  if (!canCreate.value || creating.value) return
  creating.value = true
  try {
    const eventId = autoBuildOn.value && newEventId.value.trim() ? newEventId.value.trim() : undefined
    const book = await createLifeBook({
      title: newTitle.value.trim(),
      theme: newTheme.value,
      eventId
    })
    createOpen.value = false
    pushToast({
      tone: 'success',
      title: 'Book created',
      message: eventId ? 'We started building it from your event.' : 'Start adding your pages.'
    })
    router.push({ name: 'lifebook-editor', params: { guid: book.guid } })
  } catch {
    pushToast({ tone: 'warning', title: 'Could not create the book' })
  } finally {
    creating.value = false
  }
}

function openBook(book: LifeBookSummary) {
  router.push({ name: 'lifebook-editor', params: { guid: book.guid } })
}

function toggleMenu(guid: string) {
  menuFor.value = menuFor.value === guid ? null : guid
}

function askDelete(book: LifeBookSummary) {
  menuFor.value = null
  deleteTarget.value = book
}

async function confirmDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  const guid = deleteTarget.value.guid
  try {
    await deleteLifeBook(guid)
    books.value = books.value.filter((b) => b.guid !== guid)
    pushToast({ tone: 'success', title: 'Book deleted' })
    deleteTarget.value = null
  } catch {
    pushToast({ tone: 'warning', title: 'Could not delete the book' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="lifebook-list" @click="menuFor = null">
    <header class="lifebook-list__head">
      <div>
        <span class="lifebook-list__eyebrow">My Life Book</span>
        <h1 class="lifebook-list__title">Your story, page by page</h1>
        <p class="lifebook-list__sub">
          Build a beautiful photo book of your sports life — auto-build from an event, then make it yours.
        </p>
      </div>
      <div class="lifebook-list__head-actions">
        <ThemeToggle />
        <button type="button" class="lb-btn lb-btn--primary lifebook-list__new" @click="openCreate">
          <span class="lb-btn__plus">+</span> New Book
        </button>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="loading" class="book-shelf">
      <span v-for="n in 4" :key="n" class="book-skeleton" />
    </div>

    <!-- Empty -->
    <div v-else-if="books.length === 0" class="lifebook-empty">
      <div class="lifebook-empty__art" aria-hidden="true">
        <span class="lifebook-empty__book lifebook-empty__book--a" />
        <span class="lifebook-empty__book lifebook-empty__book--b" />
        <span class="lifebook-empty__book lifebook-empty__book--c" />
      </div>
      <h2 class="lifebook-empty__title">Your shelf is empty</h2>
      <p class="lifebook-empty__hint">
        Create your first book and we'll help you fill it from an event in seconds.
      </p>
      <button type="button" class="lb-btn lb-btn--primary" @click="openCreate">
        <span class="lb-btn__plus">+</span> New Book
      </button>
    </div>

    <!-- Shelf -->
    <div v-else class="book-shelf">
      <div v-for="book in books" :key="book.guid" class="book-shelf__item">
        <button type="button" class="book-shelf__open" @click="openBook(book)">
          <BookCover :book="book" />
        </button>
        <div class="book-shelf__menu-anchor">
          <button
            type="button"
            class="book-shelf__menu-btn"
            aria-label="Book actions"
            @click.stop="toggleMenu(book.guid)"
          >
            <AppIcon name="ellipsis" :size="18" />
          </button>
          <div v-if="menuFor === book.guid" class="book-shelf__menu" @click.stop>
            <button type="button" class="book-shelf__menu-item" @click="openBook(book)">Open</button>
            <button
              type="button"
              class="book-shelf__menu-item book-shelf__menu-item--danger"
              @click="askDelete(book)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create panel -->
    <SlideModal
      v-model="createOpen"
      title="New book"
      subtitle="Name it, pick a look, then build"
    >
      <div class="lb-form">
        <label class="lb-field">
          <span class="lb-field__label">Title</span>
          <input
            v-model="newTitle"
            type="text"
            class="lb-input"
            placeholder="e.g. Summer Championship 2026"
            @keyup.enter="submitCreate"
          />
        </label>

        <div class="lb-field">
          <span class="lb-field__label">Theme</span>
          <div class="lb-theme-row">
            <button
              v-for="t in THEMES"
              :key="t.key"
              type="button"
              class="lb-theme-chip"
              :class="{ 'lb-theme-chip--active': newTheme === t.key }"
              :style="{ '--chip-a': t.gradient[0], '--chip-b': t.gradient[1] }"
              @click="newTheme = t.key"
            >
              <span class="lb-theme-chip__swatch" aria-hidden="true" />
              {{ t.label }}
            </button>
          </div>
        </div>

        <div class="lb-autobuild" :class="{ 'lb-autobuild--on': autoBuildOn }">
          <div class="lb-autobuild__head">
            <div class="lb-autobuild__copy">
              <span class="lb-autobuild__badge">Flagship</span>
              <span class="lb-autobuild__title">Auto-build from an event</span>
              <span class="lb-autobuild__hint">
                We'll pull your event photos and lay out draft pages for you to tweak.
              </span>
            </div>
            <ToggleSwitch v-model="autoBuildOn" aria-label="Auto-build from an event" />
          </div>
          <label v-if="autoBuildOn" class="lb-field lb-autobuild__field">
            <span class="lb-field__label">Event <span class="lb-field__opt">(optional)</span></span>
            <div class="lb-event-pick">
              <input
                v-model="eventQuery"
                type="text"
                class="lb-input"
                placeholder="Search your events by name — or leave blank to use recent photos"
                autocomplete="off"
                @input="onEventQueryInput"
              />
              <button
                v-if="eventQuery || newEventId"
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
                v-else-if="eventQuery.trim().length >= 2 && !newEventId"
                class="lb-event-pick__hint"
              >No matching events.</p>
            </div>
            <span v-if="newEventId" class="lb-event-pick__selected">✓ We'll build from this event's photos</span>
          </label>
        </div>
      </div>

      <template #footer>
        <div class="lb-footer">
          <button type="button" class="lb-btn lb-btn--ghost" @click="createOpen = false">Cancel</button>
          <button
            type="button"
            class="lb-btn lb-btn--primary"
            :disabled="!canCreate || creating"
            @click="submitCreate"
          >
            {{ creating ? 'Creating…' : 'Create book' }}
          </button>
        </div>
      </template>
    </SlideModal>

    <!-- Delete confirm -->
    <SlideModal
      :model-value="deleteTarget !== null"
      title="Delete book"
      :subtitle="deleteTarget?.title"
      @update:model-value="(v) => { if (!v) deleteTarget = null }"
    >
      <p class="lb-confirm">
        This permanently removes <strong>{{ deleteTarget?.title }}</strong> and all of its pages.
        This can't be undone.
      </p>
      <template #footer>
        <div class="lb-footer">
          <button type="button" class="lb-btn lb-btn--ghost" @click="deleteTarget = null">Cancel</button>
          <button
            type="button"
            class="lb-btn lb-btn--danger"
            :disabled="deleting"
            @click="confirmDelete"
          >
            {{ deleting ? 'Deleting…' : 'Delete book' }}
          </button>
        </div>
      </template>
    </SlideModal>
  </div>
</template>

<style scoped>
.lifebook-list {
  max-width: 1180px;
  margin: 0 auto;
  padding: 32px 28px 64px;
}
.lifebook-list__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 36px;
}
.lifebook-list__head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.lifebook-list__eyebrow {
  font-size: 0.7rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--primary);
}
.lifebook-list__title {
  margin: 6px 0 8px;
  font-size: 1.9rem;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--text);
}
.lifebook-list__sub {
  margin: 0;
  max-width: 56ch;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--text-light);
}

.book-shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 36px 28px;
}
.book-shelf__item {
  position: relative;
}
.book-shelf__open {
  display: block;
  width: 100%;
  border: none;
  background: none;
  padding: 0;
  cursor: pointer;
}
.book-shelf__menu-anchor {
  position: absolute;
  top: 8px;
  right: 8px;
}
.book-shelf__menu-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: none;
  cursor: pointer;
  color: #fff;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(6px);
  opacity: 0;
  transition: opacity 160ms ease;
}
.book-shelf__item:hover .book-shelf__menu-btn,
.book-shelf__menu-btn:focus-visible {
  opacity: 1;
}
.book-shelf__menu {
  position: absolute;
  top: 36px;
  right: 0;
  min-width: 130px;
  background: var(--surface-opaque);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: 5px;
  z-index: 5;
}
.book-shelf__menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  padding: 8px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.88rem;
  color: var(--text);
}
.book-shelf__menu-item:hover {
  background: var(--surface-raised);
}
.book-shelf__menu-item--danger {
  color: var(--highlight);
}

.book-skeleton {
  aspect-ratio: 3 / 4;
  border-radius: 6px;
  background: linear-gradient(100deg, var(--shimmer-start), var(--shimmer-mid), var(--shimmer-end));
  background-size: 200% 100%;
  animation: shelf-shimmer 1.4s ease-in-out infinite;
}
@keyframes shelf-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Empty state ---------------------------------------------------------- */
.lifebook-empty {
  text-align: center;
  padding: 64px 20px;
  max-width: 460px;
  margin: 0 auto;
}
.lifebook-empty__art {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 10px;
  height: 96px;
  margin-bottom: 24px;
}
.lifebook-empty__book {
  width: 46px;
  border-radius: 3px 5px 5px 3px;
  box-shadow: var(--shadow-soft);
}
.lifebook-empty__book--a { height: 72px; background: linear-gradient(150deg, #2f5f98, #6f92bb); transform: rotate(-4deg); }
.lifebook-empty__book--b { height: 92px; background: linear-gradient(150deg, #2d8cf0, #29cf59); }
.lifebook-empty__book--c { height: 64px; background: linear-gradient(150deg, #ff5a68, #ffd45a); transform: rotate(5deg); }
.lifebook-empty__title {
  margin: 0 0 8px;
  font-size: 1.3rem;
  font-weight: 500;
  color: var(--text);
}
.lifebook-empty__hint {
  margin: 0 0 22px;
  font-size: 0.95rem;
  color: var(--text-light);
}

/* Form ----------------------------------------------------------------- */
.lb-form {
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.lb-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lb-field__label {
  font-size: 0.82rem;
  color: var(--text);
}
.lb-field__opt {
  color: var(--text-light);
}
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
.lb-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-light-3);
}
.lb-theme-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.lb-theme-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 13px 7px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-divider);
  background: var(--surface-pill);
  color: var(--text);
  font-size: 0.84rem;
  cursor: pointer;
  transition: border-color 140ms ease;
}
.lb-theme-chip--active {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary) inset;
}
.lb-theme-chip__swatch {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: linear-gradient(150deg, var(--chip-a), var(--chip-b));
}

.lb-autobuild {
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  padding: 16px;
  background: var(--surface-raised);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.lb-autobuild--on {
  border-color: var(--border-accent-hover);
  box-shadow: var(--shadow-soft);
}
.lb-autobuild__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.lb-autobuild__copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lb-autobuild__badge {
  align-self: flex-start;
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #fff;
  background: linear-gradient(120deg, var(--primary), var(--success));
  padding: 2px 8px;
  border-radius: 999px;
  margin-bottom: 2px;
}
.lb-autobuild__title {
  font-size: 0.96rem;
  color: var(--text);
}
.lb-autobuild__hint {
  font-size: 0.82rem;
  color: var(--text-light);
  line-height: 1.45;
}
.lb-autobuild__field {
  margin-top: 14px;
}

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

.lb-confirm {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-light);
}
.lb-confirm strong {
  color: var(--text);
  font-weight: 500;
}

/* Buttons -------------------------------------------------------------- */
.lb-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
.lb-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 0.9rem;
  padding: 10px 18px;
  border-radius: var(--radius-md);
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 160ms ease, border-color 160ms ease, transform 120ms ease, opacity 160ms ease;
}
.lb-btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.lb-btn__plus {
  font-size: 1.1rem;
  line-height: 1;
}
.lb-btn--primary {
  background: var(--primary);
  color: #fff;
}
.lb-btn--primary:hover:not(:disabled) {
  transform: translateY(-1px);
}
.lb-btn--ghost {
  background: var(--surface-btn-solid);
  border-color: var(--border-divider);
  color: var(--text);
}
.lb-btn--ghost:hover:not(:disabled) {
  border-color: var(--border-accent-hover);
}
.lb-btn--danger {
  background: var(--highlight);
  color: #fff;
}

@media (max-width: 720px) {
  .lifebook-list { padding: 20px 16px calc(48px + var(--member-bottom-nav-height, 64px)); }
  .lifebook-list__head { flex-direction: column; align-items: flex-start; }
  .book-shelf { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 28px 18px; }
}

@media (max-width: 420px) {
  .lifebook-list {
    padding-right: 12px;
    padding-left: 12px;
  }

  .book-shelf {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 24px 12px;
  }
}
</style>
