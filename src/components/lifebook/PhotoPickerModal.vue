<script setup lang="ts">
// PhotoPickerModal
// ----------------
// The editor's photo picker. Two ways in:
//   1. "Your photos" tab — lists the user's available photos (§8
//      GET /v2/lifebook/photos) in a grid, cursor-paginated with a "Load more"
//      affordance. Clicking a photo fills the active slot and closes.
//   2. "Upload" tab — pick image file(s) from the device. Each is uploaded
//      (POST /v2/lifebook/upload → durable CDN URL) and the FIRST one fills the
//      active slot, exactly like picking an existing photo. Any additional
//      uploads are surfaced as freshly-uploaded tiles the user can also pick.
//
// Built on the shared SlideModal. Photos are scoped to the book's event when
// `eventId` is set.

import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import {
  fetchLifeBookPhotos,
  uploadLifeBookPhoto,
  type LifeBookPhoto
} from '../../api/lifebook'
import { pushToast } from '../../toast-center'

const props = defineProps<{
  modelValue: boolean
  eventId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'select', url: string): void
}>()

type Tab = 'library' | 'upload'
const tab = ref<Tab>('library')

const photos = ref<LifeBookPhoto[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const loadedOnce = ref(false)

// Device upload state ---------------------------------------------------------
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadProgress = ref({ done: 0, total: 0 })
// URLs uploaded this session — shown as pickable tiles in the Upload tab so the
// user can re-pick a just-uploaded image for a different slot without re-uploading.
const uploaded = ref<string[]>([])

const progressLabel = computed(() =>
  uploadProgress.value.total > 1
    ? `Uploading ${uploadProgress.value.done + 1} of ${uploadProgress.value.total}…`
    : 'Uploading…'
)

async function load(reset: boolean) {
  if (reset) {
    loading.value = true
    photos.value = []
    nextCursor.value = null
  } else {
    if (!nextCursor.value) return
    loadingMore.value = true
  }
  try {
    const page = await fetchLifeBookPhotos({
      eventId: props.eventId ?? undefined,
      cursor: reset ? undefined : nextCursor.value ?? undefined
    })
    photos.value = reset ? page.photos : [...photos.value, ...page.photos]
    nextCursor.value = page.nextCursor
    loadedOnce.value = true
  } catch {
    pushToast({ tone: 'warning', title: 'Could not load photos', message: 'Please try again.' })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      tab.value = 'library'
      load(true)
    }
  }
)

function choose(url: string) {
  emit('select', url)
  emit('update:modelValue', false)
}

// ── Device upload ────────────────────────────────────────────────────────────
function openFilePicker() {
  fileInput.value?.click()
}

async function onFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // Reset the input so picking the same file again still fires `change`.
  input.value = ''
  if (files.length === 0 || uploading.value) return

  uploading.value = true
  uploadProgress.value = { done: 0, total: files.length }
  let firstUrl: string | null = null
  let failures = 0

  for (const file of files) {
    try {
      const url = await uploadLifeBookPhoto(file)
      if (!firstUrl) firstUrl = url
      // Newest first so the just-uploaded image is easy to spot.
      uploaded.value = [url, ...uploaded.value]
    } catch {
      failures += 1
    } finally {
      uploadProgress.value = { ...uploadProgress.value, done: uploadProgress.value.done + 1 }
    }
  }

  uploading.value = false
  uploadProgress.value = { done: 0, total: 0 }

  if (failures > 0) {
    pushToast({
      tone: 'warning',
      title: failures === files.length ? 'Upload failed' : 'Some photos failed',
      message:
        failures === files.length
          ? 'Please check the file and try again.'
          : `${files.length - failures} of ${files.length} uploaded.`
    })
  }

  // Fill the active slot with the first successful upload — same flow as
  // picking an existing photo (selects + closes the drawer).
  if (firstUrl) choose(firstUrl)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Add a photo"
    subtitle="From your posts, event media, or your device"
    size="wide"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- Tabs -->
    <div class="photo-tabs" role="tablist" aria-label="Photo source">
      <button
        type="button"
        class="photo-tab"
        :class="{ 'photo-tab--active': tab === 'library' }"
        role="tab"
        :aria-selected="tab === 'library'"
        @click="tab = 'library'"
      >
        Your photos
      </button>
      <button
        type="button"
        class="photo-tab"
        :class="{ 'photo-tab--active': tab === 'upload' }"
        role="tab"
        :aria-selected="tab === 'upload'"
        @click="tab = 'upload'"
      >
        Upload from device
      </button>
    </div>

    <!-- Library tab -->
    <template v-if="tab === 'library'">
      <div v-if="loading" class="photo-grid photo-grid--loading">
        <span v-for="n in 9" :key="n" class="photo-skeleton" />
      </div>

      <div v-else-if="loadedOnce && photos.length === 0" class="photo-empty">
        <p class="photo-empty__title">No photos yet</p>
        <p class="photo-empty__hint">
          Photos from your posts and event galleries will show up here — or
          <button type="button" class="photo-empty__link" @click="tab = 'upload'">upload from your device</button>.
        </p>
      </div>

      <template v-else>
        <div class="photo-grid">
          <button
            v-for="(photo, i) in photos"
            :key="`${photo.url}-${i}`"
            type="button"
            class="photo-tile"
            @click="choose(photo.url)"
          >
            <img :src="photo.thumbnailUrl" alt="" loading="lazy" />
            <span class="photo-tile__pick">Use</span>
          </button>
        </div>
        <div v-if="nextCursor" class="photo-more">
          <button type="button" class="lb-btn lb-btn--ghost" :disabled="loadingMore" @click="load(false)">
            {{ loadingMore ? 'Loading…' : 'Load more' }}
          </button>
        </div>
      </template>
    </template>

    <!-- Upload tab -->
    <template v-else>
      <!-- Dropzone-style affordance + hidden file input. -->
      <button
        type="button"
        class="photo-drop"
        :class="{ 'photo-drop--busy': uploading }"
        :disabled="uploading"
        @click="openFilePicker"
      >
        <span v-if="!uploading" class="photo-drop__icon" aria-hidden="true">↑</span>
        <span v-else class="photo-drop__spinner" aria-hidden="true" />
        <span class="photo-drop__title">{{ uploading ? progressLabel : 'Choose photos' }}</span>
        <span class="photo-drop__hint">
          {{ uploading ? 'Hang tight — this only takes a moment.' : 'JPG or PNG, up to 10MB each. Pick one or several.' }}
        </span>
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="photo-file-input"
        @change="onFilesPicked"
      />

      <!-- Freshly-uploaded tiles — pick one to fill the slot. -->
      <template v-if="uploaded.length">
        <p class="photo-uploaded__label">Just uploaded</p>
        <div class="photo-grid">
          <button
            v-for="(url, i) in uploaded"
            :key="`up-${url}-${i}`"
            type="button"
            class="photo-tile"
            @click="choose(url)"
          >
            <img :src="url" alt="" loading="lazy" />
            <span class="photo-tile__pick">Use</span>
          </button>
        </div>
      </template>
    </template>
  </SlideModal>
</template>

<style scoped>
/* Tabs ----------------------------------------------------------------- */
.photo-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  margin-bottom: 18px;
  border-radius: 999px;
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
}
.photo-tab {
  border: none;
  background: transparent;
  color: var(--text-light);
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 0.84rem;
  padding: 7px 16px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}
.photo-tab--active {
  background: var(--surface-card);
  color: var(--text);
  box-shadow: var(--shadow-soft);
}

.photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
}
.photo-tile {
  position: relative;
  aspect-ratio: 1 / 1;
  border: none;
  padding: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-raised);
  box-shadow: 0 0 0 1px var(--border-divider) inset;
  transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 180ms ease;
}
.photo-tile:hover {
  transform: translateY(-2px);
  box-shadow: 0 0 0 1px var(--border-accent-hover) inset, var(--shadow-soft);
}
.photo-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 220ms ease;
}
.photo-tile:hover img {
  transform: scale(1.06);
}
.photo-tile__pick {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--primary) 34%, transparent);
  color: #fff;
  font-size: 0.82rem;
  letter-spacing: 0.04em;
  opacity: 0;
  transition: opacity 160ms ease;
  backdrop-filter: blur(1px);
}
.photo-tile:hover .photo-tile__pick,
.photo-tile:focus-visible .photo-tile__pick {
  opacity: 1;
}
.photo-skeleton {
  aspect-ratio: 1 / 1;
  border-radius: var(--radius-md);
  background: linear-gradient(100deg, var(--shimmer-start), var(--shimmer-mid), var(--shimmer-end));
  background-size: 200% 100%;
  animation: photo-shimmer 1.4s ease-in-out infinite;
}
@keyframes photo-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.photo-empty {
  text-align: center;
  padding: 48px 20px;
}
.photo-empty__title {
  margin: 0 0 6px;
  font-size: 1rem;
  color: var(--text);
}
.photo-empty__hint {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-light);
}
.photo-empty__link {
  border: none;
  background: none;
  padding: 0;
  color: var(--primary);
  font: inherit;
  cursor: pointer;
}
.photo-empty__link:hover { text-decoration: underline; }
.photo-more {
  display: flex;
  justify-content: center;
  margin-top: 18px;
}

/* Upload tab ----------------------------------------------------------- */
.photo-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.photo-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 40px 24px;
  border-radius: var(--radius-lg);
  border: 1.5px dashed var(--border-accent);
  background:
    radial-gradient(120% 80% at 50% 0%, color-mix(in srgb, var(--primary) 8%, transparent), transparent 60%),
    var(--surface-raised);
  color: var(--text);
  cursor: pointer;
  transition: border-color 160ms ease, background 160ms ease, transform 120ms ease;
}
.photo-drop:hover:not(:disabled) {
  border-color: var(--primary);
  transform: translateY(-1px);
}
.photo-drop:disabled { cursor: default; }
.photo-drop--busy { border-style: solid; }
.photo-drop__icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--primary) 14%, transparent);
  color: var(--primary);
  font-size: 1.4rem;
  line-height: 1;
}
.photo-drop__spinner {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  border: 3px solid var(--border-divider);
  border-top-color: var(--primary);
  animation: photo-spin 0.8s linear infinite;
}
@keyframes photo-spin { to { transform: rotate(360deg); } }
.photo-drop__title {
  font-size: 0.96rem;
  color: var(--text);
}
.photo-drop__hint {
  font-size: 0.82rem;
  color: var(--text-light);
}
.photo-uploaded__label {
  margin: 22px 0 10px;
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-light);
}

.lb-btn {
  font-family: var(--font-body);
  font-weight: 400;
  font-size: 0.88rem;
  padding: 9px 18px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, transform 120ms ease;
}
.lb-btn--ghost {
  background: var(--surface-btn-solid);
  border: 1px solid var(--border-divider);
  color: var(--text);
}
.lb-btn--ghost:hover:not(:disabled) {
  border-color: var(--border-accent-hover);
}
.lb-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
