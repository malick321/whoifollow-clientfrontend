<script setup lang="ts">
// MultiSelectDropdown
// -------------------
// Pill-trigger multi-select with a searchable popover. Used for the
// Age Group / Rating / Gender / State filters on the Teams page.
//
// Trigger reads:  "Placeholder"        when nothing selected
//                 "First Value"        when exactly one selected
//                 "First Value  +N"    when N+1 selected (N >= 1)
//
// Popover:
//   - Optional text search at the top (filters the option list).
//   - Each option is a checkbox row — click anywhere on the row
//     toggles selection. Multiple values stay selected; the popover
//     does NOT auto-close so admins can stack picks quickly.
//   - Click outside or press Escape to close.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** Currently-selected values. Empty array = nothing selected.
   *  Named `modelValue` so consumers can use Vue 3 `v-model` natively. */
  modelValue: string[]
  /** Full option list. */
  options: readonly string[]
  /** Placeholder text shown when nothing is selected. */
  placeholder: string
  /** Render a search input above the option list. Default true. */
  searchable?: boolean
  /** Single-select mode — clicking an option REPLACES the current
   *  selection (always exactly 1 value) and closes the popover.
   *  Hides the clear button. Useful for filters that always carry
   *  a value (e.g. status). Default false. */
  single?: boolean
  /** Optional aria-label for the trigger button. Falls back to placeholder. */
  ariaLabel?: string
}>(), {
  searchable: true,
  single: false,
  ariaLabel: ''
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: string[]): void
}>()

const open = ref(false)
const searchTerm = ref('')
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLElement | null>(null)
/** Viewport-anchored position for the popover. Recomputed every
 *  time the popover opens AND on scroll/resize while open so the
 *  panel stays glued to the trigger even when the user scrolls
 *  the page or rotates the device. `position: fixed` is used
 *  (instead of absolute) so the popover escapes any ancestor
 *  with `overflow: auto` / `overflow: hidden` — the Teams page
 *  filter row uses `overflow-x: auto` on mobile to scroll the
 *  pill strip horizontally, and an absolutely-positioned popover
 *  inside that container would be clipped. */
const popoverStyle = ref<{ top: string; left: string; minWidth: string }>({
  top: '0px',
  left: '0px',
  minWidth: '220px'
})

const isApplied = computed(() => props.modelValue.length > 0)

const filteredOptions = computed(() => {
  const q = searchTerm.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((option) => option.toLowerCase().includes(q))
})

const triggerLabel = computed(() => {
  if (props.modelValue.length === 0) return props.placeholder
  return props.modelValue[0]
})

const overflowCount = computed(() => {
  if (props.single) return 0
  return Math.max(0, props.modelValue.length - 1)
})

/** Re-measure the trigger and write the popover's viewport
 *  coordinates into `popoverStyle`. Anchors the popover 6px below
 *  the trigger and clamps to a minimum 220px width or the
 *  trigger's own width — whichever is wider. */
function updatePopoverPosition() {
  const el = triggerRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const width = Math.max(220, Math.round(rect.width))
  // Keep the popover from overflowing the viewport on the right
  // edge — slide it left if it would extend past the window.
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth
  let left = rect.left
  if (left + width + 8 > viewportWidth) {
    left = Math.max(8, viewportWidth - width - 8)
  }
  popoverStyle.value = {
    top: `${rect.bottom + 6}px`,
    left: `${left}px`,
    minWidth: `${width}px`
  }
}

function toggleOpen() {
  open.value = !open.value
  if (open.value) {
    // Reset the search filter on every fresh open so the admin
    // sees the full list right away.
    searchTerm.value = ''
    // Compute initial position before paint so the popover
    // appears already glued to the trigger.
    void Promise.resolve().then(updatePopoverPosition)
  }
}

function close() {
  open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    // Track scroll/resize while open so the popover follows the
    // trigger if the user rotates, scrolls a sticky parent, etc.
    window.addEventListener('scroll', updatePopoverPosition, true)
    window.addEventListener('resize', updatePopoverPosition)
  } else {
    window.removeEventListener('scroll', updatePopoverPosition, true)
    window.removeEventListener('resize', updatePopoverPosition)
  }
})

function isSelected(option: string): boolean {
  return props.modelValue.includes(option)
}

function toggleOption(option: string) {
  if (props.single) {
    // Single-select replaces the selection and closes the popover.
    // Re-clicking the already-selected row is a no-op so the user
    // never ends up with an empty status.
    if (!isSelected(option)) emit('update:modelValue', [option])
    close()
    return
  }
  const next = isSelected(option)
    ? props.modelValue.filter((v) => v !== option)
    : [...props.modelValue, option]
  emit('update:modelValue', next)
}

function clearAll() {
  emit('update:modelValue', [])
}

function onDocClick(event: MouseEvent) {
  if (!open.value) return
  const target = event.target as HTMLElement | null
  if (rootRef.value && target && !rootRef.value.contains(target)) {
    close()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) {
    event.stopPropagation()
    close()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', updatePopoverPosition, true)
  window.removeEventListener('resize', updatePopoverPosition)
})

watch(
  () => props.options,
  () => {
    // If options change to a smaller set, drop any selected values
    // that are no longer valid so the count stays accurate.
    const valid = props.modelValue.filter((v) => props.options.includes(v))
    if (valid.length !== props.modelValue.length) {
      emit('update:modelValue', valid)
    }
  }
)
</script>

<template>
  <div ref="rootRef" class="multi-select" :class="{ 'multi-select--open': open }">
    <button
      ref="triggerRef"
      type="button"
      class="multi-select__trigger"
      :class="{ 'multi-select__trigger--applied': isApplied }"
      :aria-label="ariaLabel || placeholder"
      :aria-expanded="open ? 'true' : 'false'"
      @click="toggleOpen"
    >
      <span class="multi-select__trigger-text">{{ triggerLabel }}</span>
      <span
        v-if="overflowCount > 0"
        class="multi-select__trigger-overflow"
        :aria-label="`${overflowCount} more selected`"
      >+{{ overflowCount }}</span>
      <span class="multi-select__trigger-chevron" aria-hidden="true"></span>
    </button>

    <div
      v-if="open"
      class="multi-select__popover"
      role="listbox"
      aria-multiselectable="true"
      :style="popoverStyle"
    >
      <div v-if="searchable" class="multi-select__search">
        <input
          v-model="searchTerm"
          type="search"
          class="multi-select__search-input"
          :placeholder="`Search ${placeholder.toLowerCase()}…`"
          aria-label="Search options"
        />
      </div>

      <div class="multi-select__options">
        <div v-if="filteredOptions.length === 0" class="multi-select__empty">
          No matches.
        </div>
        <label
          v-for="option in filteredOptions"
          :key="option"
          class="multi-select__option"
          :class="{
            'multi-select__option--selected': isSelected(option),
            'multi-select__option--single': single
          }"
          role="option"
          :aria-selected="isSelected(option) ? 'true' : 'false'"
        >
          <!-- Checkbox is the visual hit target in multi-select mode.
               In single mode the row itself is the click target and
               the checkbox is hidden — selection reads from the
               `--selected` modifier (heavier font weight) instead. -->
          <input
            v-if="!single"
            type="checkbox"
            class="multi-select__option-checkbox"
            :checked="isSelected(option)"
            @change="toggleOption(option)"
          />
          <input
            v-else
            type="radio"
            class="multi-select__option-checkbox multi-select__option-checkbox--hidden"
            :checked="isSelected(option)"
            @change="toggleOption(option)"
          />
          <span class="multi-select__option-label">{{ option }}</span>
        </label>
      </div>

      <div v-if="!single && modelValue.length > 0" class="multi-select__footer">
        <button type="button" class="multi-select__clear" @click="clearAll">
          Clear Selection ({{ modelValue.length }})
        </button>
      </div>
    </div>
  </div>
</template>
