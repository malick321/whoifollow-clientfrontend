<script setup lang="ts">
// PageTemplate
// ------------
// Renders ONE life-book page — its template's slot layout — in either EDIT or
// READONLY mode. The single renderer is reused by the editor (interactive
// slots: click a photo slot → photo picker; click text → inline edit) and the
// public flipbook / PDF print layout (static).
//
// Template keys + slot shapes come from the shared catalogue
// (lifebookCatalogue.ts) which the backend agrees on. The page surface is a
// paper-ish sheet with a soft drop shadow + subtle inner bevel so it reads as a
// physical leaf, not a form. The active theme tints the chrome (cover bar,
// caption rules, page accents).

import { computed } from 'vue'
import type { LifeBookPage, LifeBookSlot } from '../../api/lifebook'
import { themeMeta } from './lifebookCatalogue'

const props = withDefaults(
  defineProps<{
    page: LifeBookPage
    theme: string
    /** Book title — only the cover template uses it. */
    bookTitle?: string
    mode?: 'edit' | 'readonly'
  }>(),
  { bookTitle: '', mode: 'readonly' }
)

const emit = defineEmits<{
  (e: 'pick-photo', slotIndex: number): void
  (e: 'edit-text', slotIndex: number, value: string): void
}>()

const isEdit = computed(() => props.mode === 'edit')
const theme = computed(() => themeMeta(props.theme))

function slotAt(index: number): LifeBookSlot | undefined {
  return props.page.slots.find((s) => s.index === index)
}

function onPhotoClick(index: number) {
  if (isEdit.value) emit('pick-photo', index)
}

function onTextInput(index: number, event: Event) {
  const el = event.target as HTMLElement
  emit('edit-text', index, el.innerText)
}

// Cover/back read their text/title from dedicated slots.
const coverTitle = computed(() => {
  const titleSlot = props.page.slots.find((s) => s.kind === 'text' && s.index === 1)
  return titleSlot?.text || props.bookTitle || 'My Life Book'
})
const coverSubtitle = computed(() => slotAt(1)?.caption || '')
const coverPhoto = computed(() => props.page.slots.find((s) => s.kind === 'photo')?.photoUrl ?? null)
const backText = computed(
  () => props.page.slots.find((s) => s.kind === 'text')?.text || ''
)
</script>

<template>
  <div
    class="lb-page"
    :class="[`lb-page--${page.template}`, `lb-theme--${theme.key}`, { 'lb-page--edit': isEdit }]"
    :style="{
      '--lb-accent': theme.accent,
      '--lb-grad-a': theme.gradient[0],
      '--lb-grad-b': theme.gradient[1]
    }"
  >
    <!-- ── COVER ─────────────────────────────────────────────────── -->
    <div v-if="page.template === 'cover'" class="lb-cover">
      <button
        v-if="isEdit"
        type="button"
        class="lb-cover__photo lb-slot"
        :class="{ 'lb-slot--empty': !coverPhoto }"
        @click="onPhotoClick(0)"
      >
        <img v-if="coverPhoto" :src="coverPhoto" alt="" class="lb-img" />
        <span v-else class="lb-slot__placeholder">
          <span class="lb-slot__plus">+</span>
          Cover photo
        </span>
      </button>
      <div v-else class="lb-cover__photo" :class="{ 'lb-slot--empty': !coverPhoto }">
        <img v-if="coverPhoto" :src="coverPhoto" alt="" class="lb-img" />
      </div>

      <div class="lb-cover__scrim"></div>
      <div class="lb-cover__plate">
        <span class="lb-cover__eyebrow">My Life Book</span>
        <h1
          class="lb-cover__title"
          :contenteditable="isEdit"
          spellcheck="false"
          @blur="(e) => onTextInput(1, e)"
        >{{ coverTitle }}</h1>
        <p
          v-if="isEdit || coverSubtitle"
          class="lb-cover__subtitle"
          :contenteditable="isEdit"
          :data-placeholder="isEdit ? 'Add a subtitle…' : ''"
          spellcheck="false"
          @blur="(e) => emit('edit-text', 1, (e.target as HTMLElement).innerText)"
        >{{ coverSubtitle }}</p>
      </div>
    </div>

    <!-- ── BACK ──────────────────────────────────────────────────── -->
    <div v-else-if="page.template === 'back'" class="lb-back">
      <span class="lb-back__mark" aria-hidden="true"></span>
      <p
        class="lb-back__note"
        :contenteditable="isEdit"
        :data-placeholder="isEdit ? 'A closing note…' : ''"
        spellcheck="false"
        @blur="(e) => emit('edit-text', 0, (e.target as HTMLElement).innerText)"
      >{{ backText }}</p>
      <span class="lb-back__fin">fin.</span>
    </div>

    <!-- ── TEXT ──────────────────────────────────────────────────── -->
    <div v-else-if="page.template === 'text'" class="lb-text">
      <p
        class="lb-text__body"
        :contenteditable="isEdit"
        :data-placeholder="isEdit ? 'Tell the story of this moment…' : ''"
        spellcheck="false"
        @blur="(e) => emit('edit-text', 0, (e.target as HTMLElement).innerText)"
      >{{ slotAt(0)?.text || '' }}</p>
    </div>

    <!-- ── PHOTO + CAPTION ───────────────────────────────────────── -->
    <div v-else-if="page.template === 'photo-caption'" class="lb-photocap">
      <component
        :is="isEdit ? 'button' : 'div'"
        :type="isEdit ? 'button' : undefined"
        class="lb-slot lb-photocap__photo"
        :class="{ 'lb-slot--empty': !slotAt(0)?.photoUrl }"
        @click="onPhotoClick(0)"
      >
        <img v-if="slotAt(0)?.photoUrl" :src="slotAt(0)?.photoUrl ?? ''" alt="" class="lb-img" />
        <span v-else-if="isEdit" class="lb-slot__placeholder">
          <span class="lb-slot__plus">+</span>Add photo
        </span>
      </component>
      <p
        class="lb-photocap__caption"
        :contenteditable="isEdit"
        :data-placeholder="isEdit ? 'Write a caption…' : ''"
        spellcheck="false"
        @blur="(e) => emit('edit-text', 1, (e.target as HTMLElement).innerText)"
      >{{ slotAt(1)?.text || '' }}</p>
    </div>

    <!-- ── PHOTO GRIDS (full / grid-2 / grid-4 / collage-3) ──────── -->
    <div v-else class="lb-grid" :class="`lb-grid--${page.template}`">
      <component
        :is="isEdit ? 'button' : 'div'"
        v-for="slot in page.slots.filter((s) => s.kind === 'photo')"
        :key="slot.index"
        :type="isEdit ? 'button' : undefined"
        class="lb-slot lb-grid__cell"
        :class="{ 'lb-slot--empty': !slot.photoUrl, [`lb-grid__cell--${slot.index}`]: true }"
        @click="onPhotoClick(slot.index)"
      >
        <img v-if="slot.photoUrl" :src="slot.photoUrl" alt="" class="lb-img" />
        <span v-else-if="isEdit" class="lb-slot__placeholder">
          <span class="lb-slot__plus">+</span>Add photo
        </span>
      </component>
    </div>
  </div>
</template>

<style scoped>
/* The page sheet — paper-ish surface, soft shadow, gentle inner bevel. The
   3:4 portrait leaf reads as a real book page. Tokens drive the light/dark
   flip; the active theme tints accents via the inline --lb-* vars. */
.lb-page {
  position: relative;
  aspect-ratio: 3 / 4;
  width: 100%;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--white) 96%, var(--lb-accent) 4%), var(--white));
  border-radius: 6px;
  overflow: hidden;
  box-shadow:
    0 1px 0 var(--inset-highlight) inset,
    0 22px 50px rgba(36, 60, 91, 0.18),
    0 3px 10px rgba(36, 60, 91, 0.10);
  color: var(--text);
  font-family: var(--font-body);
}
html.dark-mode .lb-page {
  box-shadow:
    0 1px 0 var(--inset-highlight) inset,
    0 22px 50px rgba(0, 0, 0, 0.58),
    0 3px 10px rgba(0, 0, 0, 0.45);
}
/* Faint paper grain via a layered radial — keeps the sheet from reading flat.
   A hairline gutter shadow down the left edge sells the "bound leaf" feel. */
.lb-page::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(36, 60, 91, 0.07), transparent 4%),
    radial-gradient(120% 80% at 0% 0%, rgba(255, 255, 255, 0.18), transparent 55%);
  mix-blend-mode: soft-light;
}
html.dark-mode .lb-page::after {
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.28), transparent 4%),
    radial-gradient(120% 80% at 0% 0%, rgba(255, 255, 255, 0.05), transparent 55%);
}

.lb-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ── Slots ───────────────────────────────────────────────────── */
.lb-slot {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  overflow: hidden;
  font: inherit;
  color: inherit;
}
.lb-page--edit button.lb-slot {
  cursor: pointer;
}
.lb-slot--empty {
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--lb-accent) 5%, var(--surface-raised)),
      color-mix(in srgb, var(--lb-accent) 5%, var(--surface-raised)) 12px,
      transparent 12px,
      transparent 24px
    ),
    var(--surface-muted);
  box-shadow: 0 0 0 1px var(--border-divider) inset;
  transition: box-shadow 160ms ease, background-color 160ms ease;
}
.lb-page--edit button.lb-slot:hover {
  box-shadow: 0 0 0 2px var(--lb-accent) inset;
}
.lb-page--edit button.lb-slot:hover .lb-slot__plus {
  transform: scale(1.08) translateY(-1px);
  background: color-mix(in srgb, var(--lb-accent) 22%, transparent);
}
.lb-page--edit button.lb-slot:hover .lb-slot__placeholder {
  color: var(--text);
}
.lb-slot__placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-light);
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  transition: color 160ms ease;
}
.lb-slot__plus {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--lb-accent) 14%, transparent);
  color: var(--lb-accent);
  font-size: 1.3rem;
  line-height: 1;
  transition: transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 180ms ease;
}

/* ── Photo grids ─────────────────────────────────────────────── */
.lb-grid {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  gap: 10px;
  padding: 16px;
}
.lb-grid--full {
  padding: 14px;
}
.lb-grid--grid-2 {
  grid-template-columns: 1fr 1fr;
}
.lb-grid--grid-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.lb-grid--collage-3 {
  grid-template-columns: 1.4fr 1fr;
  grid-template-rows: 1fr 1fr;
}
.lb-grid--collage-3 .lb-grid__cell--0 {
  grid-row: 1 / 3;
}
.lb-grid__cell {
  border-radius: 4px;
}

/* ── Photo + caption ─────────────────────────────────────────── */
.lb-photocap {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-rows: 1fr auto;
  padding: 16px;
  gap: 14px;
}
.lb-photocap__photo {
  border-radius: 3px;
}
.lb-photocap__caption {
  margin: 0;
  padding: 0 4px 6px;
  font-size: 0.92rem;
  line-height: 1.5;
  color: var(--text-light);
  border-top: 1px solid color-mix(in srgb, var(--lb-accent) 30%, var(--border-divider));
  padding-top: 12px;
  outline: none;
}

/* ── Text page ───────────────────────────────────────────────── */
.lb-text {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14% 12%;
}
.lb-text__body {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.8;
  color: var(--text);
  text-align: center;
  outline: none;
  width: 100%;
}

/* ── Cover ───────────────────────────────────────────────────── */
.lb-cover {
  position: relative;
  width: 100%;
  height: 100%;
}
.lb-cover__photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  padding: 0;
  background: linear-gradient(150deg, var(--lb-grad-a), var(--lb-grad-b));
}
.lb-cover__photo.lb-slot--empty {
  background: linear-gradient(150deg, var(--lb-grad-a), var(--lb-grad-b));
  box-shadow: none;
}
.lb-cover__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.08) 0%, transparent 34%, rgba(0, 0, 0, 0.42) 72%, rgba(0, 0, 0, 0.7) 100%);
  pointer-events: none;
}
.lb-cover__plate {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10% 9% 11%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #fff;
  z-index: 1;
}
.lb-cover__eyebrow {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  text-transform: uppercase;
  letter-spacing: 0.28em;
  font-size: 0.62rem;
  opacity: 0.88;
}
/* Hairline accent rule before the eyebrow — a small premium flourish. */
.lb-cover__eyebrow::before {
  content: '';
  width: 22px;
  height: 1px;
  background: currentColor;
  opacity: 0.7;
}
.lb-cover__title {
  margin: 0;
  font-size: clamp(1.4rem, 5cqw, 2.4rem);
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: -0.01em;
  outline: none;
  text-shadow: 0 1px 14px rgba(0, 0, 0, 0.35);
}
.lb-cover__subtitle {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 400;
  opacity: 0.9;
  outline: none;
}
/* Theme-specific cover typography character (weights stay ≤ 500). */
.lb-theme--mono .lb-cover__title {
  font-family: 'Courier New', monospace;
  letter-spacing: -0.02em;
}
.lb-theme--bold .lb-cover__title {
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.lb-theme--classic .lb-cover__eyebrow {
  letter-spacing: 0.34em;
}

/* ── Back page ───────────────────────────────────────────────── */
.lb-back {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 16% 14%;
  text-align: center;
}
.lb-back__mark {
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: linear-gradient(150deg, var(--lb-grad-a), var(--lb-grad-b));
  opacity: 0.9;
}
.lb-back__note {
  margin: 0;
  font-size: 1rem;
  line-height: 1.8;
  color: var(--text-light);
  outline: none;
  width: 100%;
}
.lb-back__fin {
  font-size: 0.74rem;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  color: var(--lb-accent);
}

/* Placeholder text for empty contenteditable regions. */
[contenteditable][data-placeholder]:empty::before {
  content: attr(data-placeholder);
  color: var(--text-light);
  opacity: 0.7;
  pointer-events: none;
}
.lb-cover__title[contenteditable]:focus,
.lb-cover__subtitle[contenteditable]:focus,
.lb-text__body[contenteditable]:focus,
.lb-back__note[contenteditable]:focus,
.lb-photocap__caption[contenteditable]:focus {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--lb-accent) 55%, transparent);
  border-radius: 3px;
}
</style>
