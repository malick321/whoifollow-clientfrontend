<script setup lang="ts">
import { computed } from 'vue'
import { themeMode, toggleTheme } from '../theme'

// Toggle flips to the OPPOSITE mode on click — the aria-label reads
// "Switch to dark mode" while we're currently on light (and vice versa).
const nextModeLabel = computed(() =>
  themeMode.value === 'dark' ? 'light mode' : 'dark mode'
)
const isDark = computed(() => themeMode.value === 'dark')
</script>

<template>
  <!-- Floating pill anchored at the bottom-left of the viewport. Shows a
       sun icon in light mode (tap to switch to dark) and a moon in dark
       mode (tap to switch back). Mounted globally in App.vue so it stays
       anchored regardless of route — same z-stack as the toast center
       but one layer below so toasts can overlay it during simultaneous
       transitions. -->
  <button
    type="button"
    class="theme-toggle"
    :class="{ 'theme-toggle--dark': isDark }"
    :aria-label="`Switch to ${nextModeLabel}`"
    :title="`Switch to ${nextModeLabel}`"
    @click="toggleTheme"
  >
    <!-- Inline SVG — avoids adding new asset files and inherits currentColor
         so the icon picks up the pill's text colour in both themes. -->
    <svg
      v-if="isDark"
      class="theme-toggle__icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        fill="currentColor"
      />
    </svg>
    <svg
      v-else
      class="theme-toggle__icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.2" y1="4.2" x2="6.3" y2="6.3" />
        <line x1="17.7" y1="17.7" x2="19.8" y2="19.8" />
        <line x1="4.2" y1="19.8" x2="6.3" y2="17.7" />
        <line x1="17.7" y1="6.3" x2="19.8" y2="4.2" />
      </g>
    </svg>
    <span class="theme-toggle__label">
      {{ isDark ? 'Dark' : 'Light' }}
    </span>
  </button>
</template>

<style scoped>
/* Floating toggle. At rest the button is a 40×40 circle showing
   only the sun/moon icon. On hover (or keyboard focus) it expands
   into a pill and fades in the "Light" / "Dark" label. The clip
   from `overflow: hidden` keeps the label hidden inside the
   collapsed circle so it doesn't bleed into the icon. */
.theme-toggle {
  position: fixed;
  bottom: 20px;
  left: 20px;
  /* One layer below the toast stack (typically z-60) so success toasts
     can overlay the toggle if they fire at the same moment. */
  z-index: 55;
  display: inline-flex;
  align-items: center;
  /* `flex-start` + a fixed left padding of 11px keeps the icon
     anchored at the same x in both collapsed (40×40 circle) and
     expanded (pill) states. With width 40 and 11px left padding,
     the remaining 29px content area places the 18px icon flush at
     the start; the visual gap to the right edge is also 11px, so
     the icon reads as centered inside the circle. Only the button's
     right edge moves during hover expansion. */
  justify-content: flex-start;
  gap: 8px;
  width: 40px;
  height: 40px;
  padding: 0 0 0 11px;
  overflow: hidden;
  border: 1px solid var(--secondary-light-3, #c5d1df);
  border-radius: 50%;
  background: var(--white, #ffffff);
  color: var(--text, #2e3137);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
  /* Width + padding-right + border-radius drive the
     collapse-to-pill animation; padding-LEFT is constant so the icon
     stays put. 200ms matches the root html/body transition in
     styles.css. */
  transition:
    width 200ms ease,
    padding 200ms ease,
    border-radius 200ms ease,
    background-color 200ms ease,
    border-color 200ms ease,
    color 200ms ease,
    box-shadow 200ms ease,
    transform 120ms ease;
}

.theme-toggle:hover,
.theme-toggle:focus-visible {
  width: 86px;
  padding: 0 14px 0 11px;
  border-radius: 999px;
  transform: translateY(-1px);
  box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.08));
}

.theme-toggle:active {
  transform: translateY(0);
}

.theme-toggle:focus-visible {
  outline: 2px solid var(--primary, #2d8cf0);
  outline-offset: 2px;
}

.theme-toggle__icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  color: var(--secondary, #2f5f98);
}

.theme-toggle--dark .theme-toggle__icon {
  color: var(--primary, #4fa3ff);
}

.theme-toggle__label {
  line-height: 1;
  letter-spacing: 0.02em;
  white-space: nowrap;
  /* Collapsed by default — fades in slightly behind the width
     expansion so the text doesn't pop in before the pill makes
     room for it. */
  opacity: 0;
  transition: opacity 120ms ease 80ms;
}

.theme-toggle:hover .theme-toggle__label,
.theme-toggle:focus-visible .theme-toggle__label {
  opacity: 1;
}
</style>
