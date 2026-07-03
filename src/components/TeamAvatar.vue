<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// `name` accepts `string | null | undefined` defensively — the
// backend `/v2/association/users` payload returns `name: null` for
// pending-invite rows where the invitee hasn't accepted yet (no
// `users.id` to join against). Earlier this prop was typed
// strictly as `string`, which caused `Array.from(null)` /
// `null.trim()` to throw inside the computed hash + initial,
// blowing up the whole route's vnode tree and surfacing the
// `Cannot destructure property 'type' of 'vnode' as it is null`
// follow-on crash. The downstream computeds now coerce to a
// non-null string before any iteration / trim happens.
const props = defineProps<{
  name?: string | null
  imageUrl?: string
  size?: 'sm' | 'md' | 'lg' | 'attendee' | 'player'
}>()

/** Defensive non-null view of the `name` prop — every other
 *  computed in this component reads from here so null / undefined
 *  callers degrade gracefully to a blank-string + fallback
 *  initial rather than crashing the render. */
const safeName = computed(() => (typeof props.name === 'string' ? props.name : ''))

const imageFailed = ref(false)

watch(
  () => props.imageUrl,
  () => {
    imageFailed.value = false
  },
  { immediate: true }
)

const initial = computed(() => {
  const match = safeName.value.trim().match(/[A-Za-z]/)
  return match?.[0].toUpperCase() ?? 'T'
})

/* Two parallel palettes — six entries each, indexed by the same
 * name-hash so a given user/team keeps its color identity across a
 * mode flip (Bob's avatar reads "teal" in either theme, just lifted
 * vs. recessed). Hue families align column-by-column:
 *   index 0 — red       3 — orange
 *   index 1 — blue      4 — purple
 *   index 2 — green     5 — teal
 *
 * Light entries are pale tints + a darker fg for AA contrast.
 * Dark entries are deep tints + a brighter fg that reads on top of
 * the slate page background.
 *
 * BOTH palettes are emitted inline as CSS custom properties; the
 * `.team-avatar-mark` rule in styles.css consumes the light pair by
 * default and `html.dark-mode .team-avatar-mark` swaps to the dark
 * pair. Driving the swap off the same `html.dark-mode` class the rest
 * of the app's dark styles use (rather than a JS theme ref) keeps the
 * avatar tones in lockstep with the page in dark mode — the JS ref
 * can lag behind the host-applied class in the embedded portal, which
 * showed up as light-tinted initials circles on a dark surface. The
 * per-team color identity is preserved across the flip because both
 * pairs share one name-hash index. */
const lightPalette = [
  { bg: '#fbe4e6', fg: '#bb5964' },
  { bg: '#e7f1ff', fg: '#477bb2' },
  { bg: '#eaf8eb', fg: '#468957' },
  { bg: '#fff0df', fg: '#b57a34' },
  { bg: '#efe8ff', fg: '#7360b7' },
  { bg: '#e4f7f6', fg: '#3c8e89' }
]
const darkPalette = [
  { bg: '#4a2530', fg: '#ff8a98' },
  { bg: '#2a3a52', fg: '#7fb0e8' },
  { bg: '#243d2c', fg: '#7ad48a' },
  { bg: '#4a3320', fg: '#e8b075' },
  { bg: '#33294a', fg: '#b29bdc' },
  { bg: '#1d3a3a', fg: '#6ec9c1' }
]

const colorStyle = computed(() => {
  const hash = Array.from(safeName.value).reduce((sum, char) => sum + char.charCodeAt(0), 0)
  const idx = hash % lightPalette.length
  const light = lightPalette[idx]
  const dark = darkPalette[idx]
  return {
    '--avatar-bg': light.bg,
    '--avatar-fg': light.fg,
    '--avatar-bg-dark': dark.bg,
    '--avatar-fg-dark': dark.fg
  }
})

const resolvedImageUrl = computed(() => {
  const value = props.imageUrl?.trim()
  if (!value || imageFailed.value) return ''
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
    return value
  }

  return ''
})

function handleImageError() {
  imageFailed.value = true
}
</script>

<template>
  <span class="team-avatar-mark" :data-size="size ?? 'md'" :style="colorStyle">
    <img v-if="resolvedImageUrl" :src="resolvedImageUrl" :alt="safeName" @error="handleImageError" />
    <span v-else class="team-avatar-mark__initial">{{ initial }}</span>
  </span>
</template>
