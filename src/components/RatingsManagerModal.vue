<script setup lang="ts">
// RatingsManagerModal
// -------------------
// Settings → Ratings: an association manages its own team skill tiers
// (e.g. SSUSA: AA / AAA / Major / Major+; PSA: REC / COMP). List + add /
// edit / delete, backed by `src/api/associationRatings`. The same ratings
// feed the Add/Edit Division rating picker.

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import StatusBadge from './StatusBadge.vue'
import {
  fetchAllRatings,
  createRating,
  updateRating,
  deleteRating
} from '../api/associationRatings'
import { pushToast } from '../toast-center'
import type { RatingOption, RatingInput } from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Numeric association PK — required for the live CRUD endpoints. */
  associationId?: string
  associationShortName?: string
}>(), { associationId: '', associationShortName: '' })

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

const ratings = ref<RatingOption[]>([])
const loading = ref(false)
const saving = ref(false)
const deleting = ref(false)

const mode = ref<'list' | 'edit'>('list')
const editingId = ref<string | null>(null)
const form = ref<Required<RatingInput>>({ name: '', sortOrder: 0, active: true })
const attempted = ref(false)
const confirmDeleteId = ref<string | null>(null)

const nameError = computed(() => attempted.value && !form.value.name.trim())

async function load() {
  loading.value = true
  try {
    ratings.value = await fetchAllRatings({ associationId: props.associationId, associationShortName: props.associationShortName })
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open, wasOpen) => {
  if (open && !wasOpen) { mode.value = 'list'; void load() }
})

function close() { emit('update:modelValue', false) }

function openNew() {
  editingId.value = null
  form.value = { name: '', sortOrder: ratings.value.length + 1, active: true }
  attempted.value = false
  mode.value = 'edit'
}
function openEdit(r: RatingOption) {
  editingId.value = r.id
  form.value = { name: r.name, sortOrder: r.sortOrder ?? 0, active: r.active ?? true }
  attempted.value = false
  mode.value = 'edit'
}

async function save() {
  attempted.value = true
  if (!form.value.name.trim()) return
  saving.value = true
  try {
    if (editingId.value) {
      await updateRating(props.associationId, editingId.value, { ...form.value })
      pushToast({ tone: 'success', title: 'Rating updated' })
    } else {
      await createRating({ associationId: props.associationId, associationShortName: props.associationShortName }, { ...form.value })
      pushToast({ tone: 'success', title: 'Rating added' })
    }
    await load()
    mode.value = 'list'
  } catch (e) {
    pushToast({ tone: 'warning', title: 'Could not save', message: e instanceof Error ? e.message : 'Please try again.' })
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  const id = confirmDeleteId.value
  if (!id || deleting.value) return
  deleting.value = true
  try {
    await deleteRating(props.associationId, id)
    pushToast({ tone: 'success', title: 'Rating removed' })
    await load()
    mode.value = 'list'
  } catch (e) {
    pushToast({ tone: 'warning', title: 'Could not remove', message: e instanceof Error ? e.message : 'It may be in use by a division.' })
  } finally {
    deleting.value = false
    confirmDeleteId.value = null
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Ratings"
    :eyebrow="associationShortName"
    subtitle="Manage the skill tiers for your association's registered teams."
    size="default"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- List -->
    <div v-if="mode === 'list'" class="rm">
      <div class="rm__toolbar">
        <span class="rm__count">{{ ratings.length }} rating{{ ratings.length === 1 ? '' : 's' }}</span>
        <button type="button" class="association-users__invite-btn" @click="openNew">+ Add rating</button>
      </div>
      <ul v-if="loading" class="rm__list" aria-hidden="true">
        <li v-for="n in 5" :key="n" class="rm__row">
          <div class="rm__row-main">
            <span class="shimmer-block rm__sk rm__sk--badge"></span>
            <span class="shimmer-block rm__sk rm__sk--name"></span>
          </div>
          <span class="shimmer-block rm__sk rm__sk--btn"></span>
        </li>
      </ul>
      <p v-else-if="ratings.length === 0" class="rm__muted">No ratings yet. Add the skill tiers your association uses.</p>
      <ul v-else class="rm__list">
        <li v-for="r in ratings" :key="r.id" class="rm__row">
          <div class="rm__row-main">
            <StatusBadge :label="r.active === false ? 'Inactive' : 'Active'" :tone="r.active === false ? 'danger' : 'success'" />
            <strong>{{ r.name }}</strong>
          </div>
          <div class="rm__row-actions">
            <button type="button" class="secondary-button rm__sm" @click="openEdit(r)">Edit</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Add / Edit -->
    <div v-else class="rm rm__form">
      <div class="floating-input" :class="{ 'floating-input--invalid': nameError }">
        <input id="rm-name" v-model="form.name" type="text" maxlength="60" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!form.name }" placeholder=" " />
        <label for="rm-name" class="floating-input__label" :class="{ 'floating-input__label--floated': !!form.name }">Rating label</label>
        <span v-if="nameError" class="floating-input__error-corner">Required</span>
      </div>
      <div class="floating-input rm__narrow">
        <input id="rm-sort" v-model.number="form.sortOrder" type="number" min="0" step="1" class="floating-input__control floating-input__control--has-value" />
        <label for="rm-sort" class="floating-input__label floating-input__label--floated">Sort order</label>
      </div>
      <div class="rm__setting">
        <span class="rm__setting-label">Active (shows in the rating picker)</span>
        <ToggleSwitch v-model="form.active" aria-label="Active" />
      </div>
    </div>

    <template #footer>
      <template v-if="mode === 'list'">
        <button type="button" class="secondary-button" @click="close">Close</button>
      </template>
      <template v-else>
        <button type="button" class="secondary-button" :disabled="saving" @click="mode = 'list'">Back</button>
        <button v-if="editingId" type="button" class="danger-light-button" :disabled="saving" @click="confirmDeleteId = editingId">Delete</button>
        <span class="rm__foot-spacer"></span>
        <button type="button" class="primary-button" :disabled="saving" @click="save">
          <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
          {{ saving ? 'Saving…' : (editingId ? 'Save rating' : 'Add rating') }}
        </button>
      </template>
    </template>
  </SlideModal>

  <Transition name="slide-modal-backdrop">
    <div v-if="confirmDeleteId" class="association-switcher-backdrop" role="presentation" @click.self="confirmDeleteId = null">
      <div class="association-switcher-panel association-confirm-panel" role="alertdialog" aria-modal="true">
        <header class="association-switcher-panel__header">
          <h2 class="association-switcher-panel__title">Remove rating?</h2>
        </header>
        <div class="association-confirm-panel__body">
          <p class="association-confirm-panel__copy">If this rating is used by any division it's retired (hidden) and its data kept; an unused rating is removed permanently.</p>
        </div>
        <footer class="association-confirm-panel__footer">
          <button class="secondary-button" type="button" :disabled="deleting" @click="confirmDeleteId = null">Cancel</button>
          <button class="danger-light-button" type="button" :disabled="deleting" @click="confirmDelete">
            <span v-if="deleting" class="btn-spinner" aria-hidden="true"></span>
            {{ deleting ? 'Removing…' : 'Yes, remove' }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.rm { display: flex; flex-direction: column; gap: 14px; }
.rm__toolbar { display: flex; align-items: center; justify-content: space-between; }
.rm__count { font-size: 0.9rem; color: var(--secondary); }
.rm__muted { color: var(--secondary); font-size: 0.9rem; margin: 8px 0; }
.rm__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.rm__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--border-divider); }
.rm__row:first-child { border-top: none; }
.rm__row-main { display: flex; align-items: center; gap: 8px; }
.rm__row-main strong { font-size: 0.95rem; color: var(--text); }
.rm__row-actions { display: flex; gap: 8px; flex: 0 0 auto; }
/* Loading shimmer rows — sized to mirror the real row layout. */
.rm__sk { display: inline-block; border-radius: 6px; }
.rm__sk--badge { width: 56px; height: 20px; border-radius: 999px; }
.rm__sk--name { width: 120px; height: 14px; }
.rm__sk--btn { width: 56px; height: 30px; border-radius: 8px; }
.rm__sm { height: 32px; padding: 0 12px; font-size: 0.82rem; }
.rm__narrow { max-width: 160px; }
.rm__setting { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-top: 1px solid var(--border-divider); }
.rm__setting-label { font-size: 0.9rem; font-weight: 600; color: var(--text); }
.rm__foot-spacer { flex: 1 1 auto; }
</style>
