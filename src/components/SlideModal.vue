<script setup lang="ts">
// SlideModal
// ----------
// Reusable side-panel modal that slides in from the right. The codebase's
// other modals (LoginModal / EventLineupModal / GameLineupSubmissionModal /
// TravelArrangementsModal / PlateAppearanceModal) are all CENTER modals;
// this is a deliberately different shape used by the association portal's
// Add / Edit User flow where the panel needs to feel like an inspector
// drawer, not a dialog.
//
// Behaviour:
//   - Backdrop fades in (200ms) on open, fades out on close.
//   - Panel slides in from the right edge (300ms ease-out cubic-bezier),
//     slides out the same way on close.
//   - Body scroll on the page behind is locked while open via the
//     existing src/body-scroll-lock helper.
//   - Closes on backdrop click, X button, or Escape key.
//   - Header (title + optional subtitle + close button), body slot, and
//     footer slot. Body scrolls internally; footer is pinned with a top
//     border so it always reads as "actionable bar at the bottom".
//
// Layout:
//   - Desktop: 680px panel width pinned to the right.
//   - Mobile (≤ 720px): full-viewport-width panel.

import { onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  subtitle?: string
  /** Optional uppercase eyebrow rendered above the title — used to
   *  show contextual labels (e.g. the parent association name) in the
   *  same caps style as the participation portal's section labels. */
  eyebrow?: string
  /** Opt-out of the body's default inner padding. Lets the slot
   *  content reach edge-to-edge of the panel — useful when the
   *  caller renders its own per-section padding (e.g. a full-width
   *  table that should span the panel without leftover gutter). */
  flushBody?: boolean
  /** Panel width tier. `default` = 680px (forms); `wide` = 1080px;
   *  `full` = up to 1360px / 96vw (large visual surfaces like the
   *  bracket preview). Mobile (≤720px) is always full-viewport. */
  size?: 'default' | 'wide' | 'full'
  /** Hide the header close button — for callers that render their
   *  own close affordance (e.g. the bracket preview floats one over
   *  the canvas). Escape + backdrop-click still close. */
  hideClose?: boolean
  /** Drop the header row entirely — for callers that render all
   *  context (title / actions / close) inside the body (e.g. the
   *  bracket preview's on-canvas overlays). */
  hideHeader?: boolean
}>(), {
  subtitle: '',
  eyebrow: '',
  flushBody: false,
  size: 'default',
  hideClose: false,
  hideHeader: false
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

const panelRef = ref<HTMLElement | null>(null)

function close() {
  emit('update:modelValue', false)
}

function onBackdropClick(event: MouseEvent) {
  // Only close when the click landed on the backdrop itself — clicks
  // bubbling up from inside the panel shouldn't close.
  if (event.target === event.currentTarget) close()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.modelValue) {
    event.stopPropagation()
    close()
  }
}

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    // Body scroll lock — page behind the modal stays put while open.
    // Same convention as EventLineupModal / TravelArrangementsModal.
    if (open && !wasOpen) lockBodyScroll()
    else if (!open && wasOpen) unlockBodyScroll()
  }
)

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKeydown)
}

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
  }
  // Defensive: if the modal unmounts while still open (parent v-if flip,
  // route change, etc.) release the body scroll lock so the next page
  // is scrollable again.
  if (props.modelValue) unlockBodyScroll()
})
</script>

<template>
  <Transition name="slide-modal-backdrop">
    <div
      v-if="modelValue"
      class="slide-modal-backdrop"
      role="presentation"
      @click="onBackdropClick"
    >
      <Transition name="slide-modal-panel" appear>
        <aside
          v-if="modelValue"
          ref="panelRef"
          class="slide-modal-panel"
          :class="size !== 'default' ? `slide-modal-panel--${size}` : ''"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
        >
          <header v-if="!hideHeader" class="slide-modal-panel__header">
            <div class="slide-modal-panel__title-block">
              <!-- Consumers can override the default eyebrow / title /
                   subtitle layout by passing content via the
                   `title-block` slot — used by callers that need to
                   render shimmer placeholders in the header during
                   data fetches. -->
              <slot name="title-block">
                <span v-if="eyebrow" class="slide-modal-panel__eyebrow">{{ eyebrow }}</span>
                <h2 class="slide-modal-panel__title">{{ title }}</h2>
                <p v-if="subtitle" class="slide-modal-panel__subtitle">{{ subtitle }}</p>
              </slot>
            </div>
            <!-- Right-side header cluster — close X on top + an
                 optional `#header-actions` slot below for callers
                 that want a primary CTA / overflow menu pinned
                 against the header's right edge (used by the
                 matchgeni game-details drawer for its lifecycle
                 controls). The cluster stays vertically aligned
                 to the title block's right edge regardless of
                 how tall the title block grows. -->
            <div class="slide-modal-panel__header-right">
              <button
                v-if="!hideClose"
                type="button"
                class="slide-modal-panel__close"
                aria-label="Close"
                @click="close"
              >
                <AppIcon name="close" :size="16" />
              </button>
              <div
                v-if="$slots['header-actions']"
                class="slide-modal-panel__header-actions"
              >
                <slot name="header-actions" />
              </div>
            </div>
          </header>

          <div
            class="slide-modal-panel__body"
            :class="{ 'slide-modal-panel__body--flush': flushBody }"
          >
            <slot />
          </div>

          <footer v-if="$slots.footer" class="slide-modal-panel__footer">
            <slot name="footer" />
          </footer>
        </aside>
      </Transition>
    </div>
  </Transition>
</template>
