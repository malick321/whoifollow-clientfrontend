<script setup lang="ts">
// TagsMultiSelect
// ---------------
// Single-control multi-select with inline pill chips for the
// selected values. Pattern is identical to the GitHub-style
// "topic" input: type to search, click a suggestion (or press
// Enter) to add it as a chip; click the chip's × to remove.
// Backspace on an empty query removes the last chip.
//
// API mirrors `MultiSelectDropdown` so it's a drop-in
// replacement on the value/options/placeholder axes — but the
// UX is different: that one is trigger-pill + popover, this one
// is everything-inside-the-control.

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** Selected labels. Empty array = nothing selected. */
  modelValue: string[]
  /** Full option catalogue. */
  options: readonly string[]
  /** Placeholder shown in the input when nothing is selected. */
  placeholder: string
  /** Optional aria-label for the input. */
  ariaLabel?: string
}>(), {
  ariaLabel: ''
})

const emit = defineEmits<{
  (event: 'update:modelValue', modelValue: string[]): void
}>()

const query = ref('')
const focused = ref(false)
const activeIndex = ref(0)
const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLInputElement | null>(null)

// The suggestions panel is positioned with `fixed` coordinates derived
// from the control's bounding rect, so it escapes the overflow-clipping
// of any scrolling ancestor (e.g. a modal body / form column) instead of
// being cut off behind a sticky footer. Recomputed whenever it opens and
// on scroll / resize while open.
const panelStyle = ref<Record<string, string>>({})
function updatePanelPosition() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  panelStyle.value = {
    top: `${Math.round(r.bottom + 4)}px`,
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(r.width)}px`,
    right: 'auto'
  }
}

/** Suggestions = options not yet selected, filtered by the
 *  current query (case-insensitive substring). */
const filteredSuggestions = computed(() => {
  const q = query.value.trim().toLowerCase()
  const taken = new Set(props.modelValue)
  return props.options
    .filter((o) => !taken.has(o))
    .filter((o) => !q || o.toLowerCase().includes(q))
})

/** Whether the suggestions panel should render. We show it only
 *  when the control is focused AND there are suggestions. The
 *  user typing or arrowing focuses the input, so the panel is
 *  effectively keyboard- and click-driven. */
const suggestionsOpen = computed(
  () => focused.value && filteredSuggestions.value.length > 0
)

watch(filteredSuggestions, () => {
  // Reset the active index whenever the suggestion list mutates
  // so we never leave a stale highlight on a row that's gone.
  if (activeIndex.value >= filteredSuggestions.value.length) {
    activeIndex.value = 0
  }
})

// Track the control's position while the panel is open so the fixed
// panel stays glued to the input as the page / modal scrolls.
watch(suggestionsOpen, (open) => {
  if (open) {
    void nextTick(updatePanelPosition)
    window.addEventListener('scroll', updatePanelPosition, true)
    window.addEventListener('resize', updatePanelPosition)
  } else {
    window.removeEventListener('scroll', updatePanelPosition, true)
    window.removeEventListener('resize', updatePanelPosition)
  }
})

function addTag(tag: string) {
  if (!props.options.includes(tag)) return
  if (props.modelValue.includes(tag)) return
  emit('update:modelValue', [...props.modelValue, tag])
  query.value = ''
  activeIndex.value = 0
  // Force the panel open after a pick — without this an in-flight
  // blur (e.g. browser flicker between mousedown / click) can drop
  // `focused` to false and the suggestions panel disappears even
  // though the cursor is still inside the control. We also refocus
  // the input on next tick so the user can keep stacking picks
  // without a second click.
  focused.value = true
  void nextTick(() => inputRef.value?.focus())
}

function removeTag(tag: string) {
  emit('update:modelValue', props.modelValue.filter((v) => v !== tag))
  void nextTick(() => inputRef.value?.focus())
}

function onEnter(event: KeyboardEvent) {
  if (!suggestionsOpen.value) return
  event.preventDefault()
  const target = filteredSuggestions.value[activeIndex.value]
  if (target) addTag(target)
}

function onBackspace() {
  // Backspace removes the last chip ONLY when the input is
  // empty. With text in the field, the default behaviour
  // (delete a character) wins.
  if (query.value.length > 0) return
  if (props.modelValue.length === 0) return
  emit('update:modelValue', props.modelValue.slice(0, -1))
}

function onArrowDown() {
  if (!suggestionsOpen.value) return
  activeIndex.value = Math.min(
    activeIndex.value + 1,
    filteredSuggestions.value.length - 1
  )
}

function onArrowUp() {
  if (!suggestionsOpen.value) return
  activeIndex.value = Math.max(activeIndex.value - 1, 0)
}

function onEscape() {
  query.value = ''
  inputRef.value?.blur()
}

/** Click anywhere on the control body focuses the input — gives
 *  the whole pill-bag a single hit area. */
function focusInput() {
  inputRef.value?.focus()
}

/** Outside-click closes the suggestions (acts like blur but
 *  keeps focus management from forcing the panel shut on every
 *  internal mousedown). */
function onDocClick(event: MouseEvent) {
  if (!focused.value) return
  const target = event.target as HTMLElement | null
  if (rootRef.value && target && !rootRef.value.contains(target)) {
    focused.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', updatePanelPosition, true)
  window.removeEventListener('resize', updatePanelPosition)
})
</script>

<template>
  <div
    ref="rootRef"
    class="tags-input"
    :class="{ 'tags-input--focused': focused }"
    @click="focusInput"
  >
    <span
      v-for="tag in modelValue"
      :key="tag"
      class="tags-input__tag"
    >
      {{ tag }}
      <button
        type="button"
        class="tags-input__tag-remove"
        :aria-label="`Remove ${tag}`"
        @click.stop="removeTag(tag)"
        @mousedown.prevent
      >×</button>
    </span>

    <input
      ref="inputRef"
      v-model="query"
      type="text"
      class="tags-input__field"
      :placeholder="modelValue.length === 0 ? placeholder : ''"
      :aria-label="ariaLabel || placeholder"
      autocomplete="off"
      @focus="focused = true"
      @input="focused = true"
      @keydown.enter="onEnter"
      @keydown.backspace="onBackspace"
      @keydown.escape="onEscape"
      @keydown.down.prevent="onArrowDown"
      @keydown.up.prevent="onArrowUp"
    />

    <ul
      v-if="suggestionsOpen"
      class="tags-input__suggestions"
      :style="panelStyle"
      role="listbox"
    >
      <li
        v-for="(opt, i) in filteredSuggestions"
        :key="opt"
        role="option"
        :aria-selected="i === activeIndex ? 'true' : 'false'"
        class="tags-input__suggestion"
        :class="{ 'tags-input__suggestion--active': i === activeIndex }"
        @mousedown.stop.prevent="addTag(opt)"
      >{{ opt }}</li>
    </ul>
  </div>
</template>
