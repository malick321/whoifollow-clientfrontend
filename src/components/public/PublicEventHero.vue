<script setup lang="ts">
// PublicEventHero
// ---------------
// Cover banner for the public event page: a full-width image (or themed
// gradient when none) with the event identity overlaid, plus a tab bar.
// On the public (logged-out) page ONLY the "Schedule" tab is viewable —
// every other tab is sign-in-gated: selecting it emits `gated` so the host
// opens the login modal. A small lock marks the gated tabs.

const props = withDefaults(defineProps<{
  eventName: string
  dateRangeLabel?: string
  associationName?: string
  tournamentType?: string
  eventType?: string
  coverImageUrl?: string
  activeTab?: string
}>(), {
  activeTab: 'schedule'
})

const emit = defineEmits<{
  (event: 'select', tab: string): void
  (event: 'gated', tab: string): void
  (event: 'share'): void
}>()

interface HeroTab { id: string; label: string; gated: boolean }
// Fully public page — every tab is unlocked (no sign-in gate). Each tab
// renders real content served by a public v2 endpoint.
const tabs: HeroTab[] = [
  { id: 'schedule', label: 'About', gated: false },
  { id: 'boxscores', label: 'Boxscores', gated: false },
  { id: 'field-grid', label: 'Field Grid', gated: false },
  { id: 'teams', label: 'Teams', gated: false },
  { id: 'discussions', label: 'Discussions', gated: false }
]

const metaParts = () => [
  props.dateRangeLabel,
  props.associationName,
  props.tournamentType,
  props.eventType
].filter(Boolean) as string[]

function onTab(tab: HeroTab) {
  if (tab.gated) emit('gated', tab.id)
  else emit('select', tab.id)
}
</script>

<template>
  <section class="pub-hero" :class="{ 'pub-hero--gradient': !coverImageUrl }">
    <!-- Cover -->
    <div class="pub-hero__cover">
      <!-- Blurred, scaled copy fills the letterbox whitespace behind the
           full (contained) image. -->
      <img v-if="coverImageUrl" :src="coverImageUrl" alt="" aria-hidden="true" class="pub-hero__cover-bg" />
      <img v-if="coverImageUrl" :src="coverImageUrl" alt="" class="pub-hero__cover-img" />
      <div class="pub-hero__scrim" aria-hidden="true"></div>
      <div class="pub-hero__identity">
        <h1 class="pub-hero__name">{{ eventName }}</h1>
        <p v-if="metaParts().length" class="pub-hero__meta">
          <template v-for="(part, i) in metaParts()" :key="i">
            <span v-if="i > 0" class="pub-hero__dot" aria-hidden="true">·</span>
            <span>{{ part }}</span>
          </template>
        </p>
      </div>
    </div>

    <!-- Tab bar — tabs on the left (scrollable), Follow / Share on the right. -->
    <div class="pub-hero__tabbar">
      <div class="pub-hero__tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          class="pub-hero__tab"
          :class="{ 'pub-hero__tab--active': tab.id === activeTab }"
          :aria-selected="tab.id === activeTab"
          @click="onTab(tab)"
        >
          <span>{{ tab.label }}</span>
          <span v-if="tab.gated" class="pub-hero__lock" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12.0001 17.3501C12.9003 17.3501 13.6301 16.6203 13.6301 15.7201C13.6301 14.8199 12.9003 14.0901 12.0001 14.0901C11.0999 14.0901 10.3701 14.8199 10.3701 15.7201C10.3701 16.6203 11.0999 17.3501 12.0001 17.3501Z" />
              <path d="M16.65 9.44H7.35C7.27 9.44 7.2 9.44 7.12 9.44V8.28C7.12 5.35 7.95 3.4 12 3.4C16.33 3.4 16.88 5.51 16.88 7.35C16.88 7.74 17.19 8.05 17.58 8.05C17.97 8.05 18.28 7.74 18.28 7.35C18.28 3.8 16.17 2 12 2C6.37 2 5.72 5.58 5.72 8.28V9.53C2.92 9.88 2 11.3 2 14.79V16.65C2 20.75 3.25 22 7.35 22H16.65C20.75 22 22 20.75 22 16.65V14.79C22 10.69 20.75 9.44 16.65 9.44ZM12 18.74C10.33 18.74 8.98 17.38 8.98 15.72C8.98 14.05 10.34 12.7 12 12.7C13.66 12.7 15.02 14.06 15.02 15.72C15.02 17.39 13.67 18.74 12 18.74Z" />
            </svg>
          </span>
        </button>
      </div>

      <div class="pub-hero__actions">
        <button
          type="button"
          class="pub-hero__action app-tooltip"
          aria-label="Share event"
          data-tooltip="Share"
          @click="emit('share')"
        >
          <span class="pub-hero__action-icon pub-hero__action-icon--share" aria-hidden="true"></span>
          <span class="pub-hero__action-label">Share</span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.pub-hero {
  background: var(--surface-chrome);
  border-bottom: 1px solid var(--border-divider);
}
/* Cover band — fixed height; image fills via object-fit cover (handles
   1:1 or 16:9 uploads, cropped + centered). */
.pub-hero__cover {
  position: relative;
  height: 240px;
  overflow: hidden;
  background: linear-gradient(120deg, var(--primary, #2d8cf0), var(--secondary, #2f5f98));
}
/* Blurred backdrop — same image, scaled up + blurred to fill the
   letterbox area around the full image. */
.pub-hero__cover-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transform: scale(1.12);
  filter: blur(22px) brightness(0.85);
  z-index: 0;
}
/* Foreground — the FULL image, shown at full height (contained, centered)
   so it's never cropped. */
.pub-hero__cover-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: center;
  z-index: 1;
}
/* Bottom scrim so the overlaid identity text stays readable on any image. */
.pub-hero__scrim {
  position: absolute;
  inset: 0;
  z-index: 2;
  background: linear-gradient(to top, rgba(8, 18, 33, 0.78) 0%, rgba(8, 18, 33, 0.25) 45%, rgba(8, 18, 33, 0) 75%);
}
.pub-hero__identity {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  padding: 18px 24px;
  max-width: 1360px;
  margin: 0 auto;
}
.pub-hero__name {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 1.15;
  color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 2px 14px rgba(0, 0, 0, 0.6);
}
.pub-hero__meta {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 1px 10px rgba(0, 0, 0, 0.6);
}
.pub-hero__dot { margin: 0 7px; opacity: 0.7; }

/* Tab bar — tabs (left, scrollable) + actions (right). */
.pub-hero__tabbar {
  display: flex;
  align-items: center;
  gap: 12px;
  max-width: 1360px;
  margin: 0 auto;
  padding: 10px 20px;
}
.pub-hero__tabs {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}
.pub-hero__tabs::-webkit-scrollbar { display: none; }
.pub-hero__actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
/* Follow / Share — ghost buttons (same treatment as the theme toggle). */
.pub-hero__action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}
.pub-hero__action:hover { background: var(--surface-muted, #f1f5f9); border-color: var(--border-accent-hover, rgba(45, 140, 240, 0.45)); }
.pub-hero__action-icon {
  width: 15px;
  height: 15px;
  background-color: currentColor;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}
.pub-hero__action-icon--share { -webkit-mask-image: url('../../assets/share.svg'); mask-image: url('../../assets/share.svg'); }
.pub-hero__tab {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 0 16px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.pub-hero__tab:hover:not(.pub-hero__tab--active) {
  background: rgba(45, 140, 240, 0.06);
}
.pub-hero__tab--active {
  background: var(--primary, #2d8cf0);
  border-color: var(--primary, #2d8cf0);
  color: var(--white, #fff);
}
html.dark-mode .pub-hero__tab--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}
.pub-hero__lock { display: inline-flex; opacity: 0.6; }

@media (max-width: 720px) {
  .pub-hero__cover { height: 240px; }
  /* On phones, fill the banner (cover) — 1:1 or 16:9 both crop cleanly, no
     letterbox, so the blurred backdrop isn't needed. */
  .pub-hero__cover-img { object-fit: cover; }
  .pub-hero__cover-bg { display: none; }
  .pub-hero__identity { padding: 12px 14px; }
  .pub-hero__name { font-size: 20px; }
  .pub-hero__meta { font-size: 12px; white-space: normal; }
  .pub-hero__tabbar { padding: 10px 12px; }
  /* Follow / Share collapse to icon-only on narrow bars. */
  .pub-hero__action { padding: 0 9px; gap: 0; }
  .pub-hero__action-label { display: none; }
}
</style>
