<script setup lang="ts">
// PublicEventHeader
// -----------------
// Top bar for the PUBLIC event page. Mirrors the association-portal
// topbar's visual language (brand left, theme toggle right) but is a
// 3-column bar whose CENTER shows the event identity, and whose right
// side offers a "Sign in" button (the page is unauthenticated) instead
// of the user-avatar menu. `LoginModal` is mounted globally in App.vue,
// so `openLoginModal()` works here too.

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import wifIconUrl from '../../assets/wif-icon-only.svg'
import { openLoginModal } from '../../login-modal-center'
import { themeMode, toggleTheme } from '../../theme'

// (App-store badges moved to the left-column app-promo card on the Schedule
// tab — PublicAppPromoCard.)

// Publish the (sticky) header's real height as a global CSS var so the
// sticky divisions pill-rail (in PublicDivisionList) pins right below it —
// the header grows to two rows on mobile, so a hardcoded offset would
// overlap. Updated via ResizeObserver + resize.
const headerRef = ref<HTMLElement | null>(null)
let ro: ResizeObserver | null = null
function publishHeight() {
  const h = headerRef.value?.offsetHeight ?? 64
  document.documentElement.style.setProperty('--public-header-h', `${Math.round(h)}px`)
}
onMounted(() => {
  publishHeight()
  if (headerRef.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(publishHeight)
    ro.observe(headerRef.value)
  }
  window.addEventListener('resize', publishHeight)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', publishHeight)
  document.documentElement.style.removeProperty('--public-header-h')
})

const props = defineProps<{
  eventName: string
  dateRangeLabel?: string
  associationName?: string
  tournamentType?: string
  eventType?: string
  /** Reveal the centered event name/meta — only true once the divisions
   *  pill rail pins (the hero scrolls away). Hidden by default. */
  showIdentity?: boolean
  /** Hide the "Sign in" button — set on the detail page (`/event/:slug`),
   *  which is marketing-free. */
  hideSignIn?: boolean
}>()

// Same meta as the hero: dates · association · sport · event type.
const subParts = computed(() =>
  [props.dateRangeLabel, props.associationName, props.tournamentType, props.eventType].filter(Boolean) as string[]
)
</script>

<template>
  <header ref="headerRef" class="public-header" :class="{ 'public-header--flush': showIdentity }">
    <div class="public-header__left">
      <a href="/" class="public-header__brand" aria-label="Who I Follow">
        <img :src="wifIconUrl" alt="" class="public-header__brand-img" />
      </a>
    </div>

    <!-- Center — event identity (revealed only once the divisions pin). -->
    <div class="public-header__identity" :class="{ 'public-header__identity--shown': showIdentity }">
      <h1 class="public-header__title">{{ eventName }}</h1>
      <p v-if="subParts.length" class="public-header__sub">
        <template v-for="(part, i) in subParts" :key="i">
          <span v-if="i > 0" class="public-header__dot" aria-hidden="true">·</span>
          <span>{{ part }}</span>
        </template>
      </p>
    </div>

    <div class="public-header__actions">
      <button
        type="button"
        class="topbar-theme-toggle"
        :class="{ 'topbar-theme-toggle--dark': themeMode === 'dark' }"
        :aria-label="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
        :title="`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`"
        @click="toggleTheme"
      >
        <svg v-if="themeMode !== 'dark'" class="topbar-theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" fill="currentColor" />
          <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="1.8" x2="12" y2="4.8" />
            <line x1="12" y1="19.2" x2="12" y2="22.2" />
            <line x1="1.8" y1="12" x2="4.8" y2="12" />
            <line x1="19.2" y1="12" x2="22.2" y2="12" />
            <line x1="4.0" y1="4.0" x2="6.2" y2="6.2" />
            <line x1="17.8" y1="17.8" x2="20.0" y2="20.0" />
            <line x1="4.0" y1="20.0" x2="6.2" y2="17.8" />
            <line x1="17.8" y1="6.2" x2="20.0" y2="4.0" />
          </g>
        </svg>
        <svg v-else class="topbar-theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" />
        </svg>
      </button>

      <!-- Follow + Share now live in the hero tab bar (PublicEventHero). -->
      <button v-if="!hideSignIn" type="button" class="public-header__signin" @click="openLoginModal()">Sign in</button>
    </div>
  </header>
</template>

<style scoped>
.public-header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: grid;
  /* Brand + actions size to content (auto); the center identity takes the
     remaining flexible space with `min-width: 0` so its title/sub-line
     ELLIPSIS instead of growing and overlapping the side columns. */
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  height: 64px;
  padding: 0 20px;
  /* Matches the association-portal topbar surface — white in light mode,
     dark surface in dark mode (both via the theme token). */
  background: var(--surface-chrome);
  border-bottom: 1px solid var(--border-divider);
  /* Same shadow treatment as the sticky pill rail in the centre column. */
  box-shadow: 0 6px 12px -6px rgba(36, 60, 91, 0.22);
}
html.dark-mode .public-header { box-shadow: 0 6px 12px -6px rgba(0, 0, 0, 0.5); }
/* Once the divisions pill rail pins right below the header, drop the
   header's own border + shadow so the two read as one chrome surface. */
.public-header--flush,
html.dark-mode .public-header--flush {
  border-bottom-color: transparent;
  box-shadow: none;
}
.public-header__left {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}
.public-header__brand {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
}
.public-header__store {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  border-radius: 7px;
  transition: opacity 120ms ease;
}
.public-header__store:hover { opacity: 0.85; }
.public-header__store-img {
  height: 34px;
  width: auto;
  display: block;
}
.public-header__brand-img {
  height: 30px;
  width: auto;
  display: block;
}
.public-header__identity {
  min-width: 0;
  text-align: center;
  /* Hidden until the divisions pin (host toggles `--shown`). */
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition: opacity 160ms ease, transform 160ms ease;
}
.public-header__identity--shown {
  opacity: 1;
  transform: none;
  pointer-events: auto;
}
.public-header__title {
  margin: 0;
  font-size: 17px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.public-header__sub {
  margin: 2px 0 0;
  font-size: 12px;
  /* Same colour as the event name (title) in both themes. */
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.public-header__dot {
  margin: 0 6px;
  opacity: 0.6;
}
.public-header__actions {
  justify-self: end;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
/* Ghost/secondary header buttons (Follow + Share) — label + masked glyph,
   tinting with the text colour so they read in both themes. Same
   surface/border treatment as the theme-toggle button. */
.public-header__ghost-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.public-header__ghost-btn:hover {
  background: var(--surface-muted, #f4f7fb);
  border-color: var(--border-accent-hover, rgba(45, 140, 240, 0.45));
}
.public-header__ghost-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.35);
}
.public-header__share-icon,
.public-header__follow-icon {
  width: 16px;
  height: 16px;
  display: block;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.public-header__share-icon {
  -webkit-mask-image: url('../../assets/share.svg');
  mask-image: url('../../assets/share.svg');
}
.public-header__follow-icon {
  -webkit-mask-image: url('../../assets/notification.svg');
  mask-image: url('../../assets/notification.svg');
}

.public-header__signin {
  appearance: none;
  border: none;
  /* Solid primary fill (theme token), no gradient. Hover dims via filter
     so we don't need a separate (and previously broken) dark-mode hover
     color. */
  background: var(--primary, #2d8cf0);
  color: var(--white, #fff);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: 8px;
  cursor: pointer;
  /* Never wrap the label to a second line. */
  white-space: nowrap;
  flex: 0 0 auto;
  transition: filter 120ms ease, box-shadow 120ms ease;
}
.public-header__signin:hover {
  filter: brightness(0.94);
  box-shadow: 0 4px 12px rgba(45, 140, 240, 0.3);
}

/* When a fullscreen modal opens, the document reserves the old scrollbar
   width as right padding (so the page doesn't jump). The sticky header
   lives in that padded flow, so it would otherwise shrink and leave a gap
   on the right; extend it across the reserved strip to keep it flush. */
:global(html.modal-open) .public-header {
  width: calc(100% + var(--modal-scrollbar-width, 0px));
}

/* Tablet landscape — header space tightens; shrink the app-store badges
   and the brand cluster gap so they don't crowd the centered title. */
@media (max-width: 1024px) {
  .public-header__left { gap: 10px; }
  .public-header__store-img { height: 28px; }
}
@media (max-width: 880px) {
  .public-header__left { gap: 8px; }
  .public-header__store-img { height: 24px; }
}

/* Mobile — single compact row (brand · centered identity · actions). The
   header is uncluttered now (badges + follow/share moved out), so the
   centered event identity reveals on scroll just like desktop. */
@media (max-width: 720px) {
  .public-header {
    height: 56px;
    padding: 0 12px;
    gap: 8px;
  }
  .public-header__title { font-size: 14px; }
  .public-header__sub { font-size: 11px; }
  .public-header__brand-img { height: 26px; }
  .public-header__signin { padding: 7px 12px; }
}
</style>
