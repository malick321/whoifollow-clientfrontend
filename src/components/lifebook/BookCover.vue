<script setup lang="ts">
// BookCover
// ---------
// The clickable spine-and-cover tile used in the books grid. Renders the book's
// cover photo (or a themed gradient fallback), title, and page count, styled as
// a real hardcover standing on a shelf — a subtle spine on the left edge, a
// soft page-block on the right, and a lift-on-hover. Reuses design tokens; the
// theme accent tints the spine + fallback gradient.

import { computed } from 'vue'
import type { LifeBookSummary } from '../../api/lifebook'
import { themeMeta } from './lifebookCatalogue'

const props = defineProps<{ book: LifeBookSummary }>()

const theme = computed(() => themeMeta(props.book.theme))
const pageLabel = computed(() => {
  const n = props.book.pageCount
  return `${n} ${n === 1 ? 'page' : 'pages'}`
})
</script>

<template>
  <article
    class="book-cover"
    :style="{
      '--lb-accent': theme.accent,
      '--lb-grad-a': theme.gradient[0],
      '--lb-grad-b': theme.gradient[1]
    }"
  >
    <div class="book-cover__spine" aria-hidden="true"></div>
    <div class="book-cover__face" :class="{ 'book-cover__face--empty': !book.coverPhotoUrl }">
      <img v-if="book.coverPhotoUrl" :src="book.coverPhotoUrl" alt="" class="book-cover__img" />
      <div class="book-cover__scrim" aria-hidden="true"></div>
      <span v-if="book.isShared" class="book-cover__shared">Shared</span>
      <div class="book-cover__plate">
        <span class="book-cover__eyebrow">My Life Book</span>
        <h3 class="book-cover__title">{{ book.title }}</h3>
        <span class="book-cover__pages">{{ pageLabel }}</span>
      </div>
    </div>
    <div class="book-cover__pageblock" aria-hidden="true"></div>
  </article>
</template>

<style scoped>
.book-cover {
  position: relative;
  aspect-ratio: 3 / 4;
  width: 100%;
  border-radius: 6px;
  transition: transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 200ms ease;
  filter: drop-shadow(0 16px 30px rgba(36, 60, 91, 0.18));
}
html.dark-mode .book-cover {
  filter: drop-shadow(0 16px 30px rgba(0, 0, 0, 0.55));
}
.book-cover:hover {
  transform: translateY(-8px) rotate(-0.5deg);
  filter: drop-shadow(0 24px 42px rgba(36, 60, 91, 0.26));
}
html.dark-mode .book-cover:hover {
  filter: drop-shadow(0 24px 42px rgba(0, 0, 0, 0.65));
}
.book-cover__spine {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 12px;
  border-radius: 6px 2px 2px 6px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--lb-accent) 70%, #000 30%), var(--lb-accent));
  box-shadow: inset -2px 0 4px rgba(0, 0, 0, 0.25);
  z-index: 2;
}
.book-cover__pageblock {
  position: absolute;
  right: -4px;
  top: 5px;
  bottom: 5px;
  width: 6px;
  border-radius: 0 3px 3px 0;
  background: repeating-linear-gradient(
    180deg,
    var(--white),
    var(--white) 2px,
    var(--border-divider) 2px,
    var(--border-divider) 3px
  );
  z-index: 0;
}
.book-cover__face {
  position: absolute;
  inset: 0 0 0 8px;
  border-radius: 3px 6px 6px 3px;
  overflow: hidden;
  background: linear-gradient(150deg, var(--lb-grad-a), var(--lb-grad-b));
  z-index: 1;
}
/* A diagonal sheen that sweeps across on hover — sells the hardcover feel. */
.book-cover__face::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.22) 48%, transparent 62%);
  transform: translateX(-120%);
  transition: transform 600ms cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
  z-index: 3;
}
.book-cover:hover .book-cover__face::after {
  transform: translateX(120%);
}
.book-cover__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.book-cover__scrim {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.04) 0%, transparent 36%, rgba(0, 0, 0, 0.64) 100%);
}
.book-cover__shared {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(6px);
}
.book-cover__plate {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #fff;
}
.book-cover__eyebrow {
  font-size: 0.56rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  opacity: 0.8;
}
.book-cover__title {
  margin: 0;
  font-size: 1.12rem;
  font-weight: 500;
  line-height: 1.18;
  letter-spacing: -0.01em;
  text-shadow: 0 1px 10px rgba(0, 0, 0, 0.3);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.book-cover__pages {
  font-size: 0.74rem;
  opacity: 0.85;
}
</style>
