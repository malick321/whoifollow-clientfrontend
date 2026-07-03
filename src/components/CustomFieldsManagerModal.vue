<script setup lang="ts">
// CustomFieldsManagerModal
// ------------------------
// Settings → Custom Fields: an association admin authors the custom-field
// DEFINITIONS that render dynamically on entity forms (event / division / game
// / team / umpire / player / product — the shared entity-type catalogue). List
// + add / edit / delete, backed by `src/api/customFields`. The same definitions
// drive the dynamic controls (CustomFieldsRenderer).

import { computed, ref, watch } from 'vue'
import SlideModal from './SlideModal.vue'
import ToggleSwitch from './ToggleSwitch.vue'
import StatusBadge from './StatusBadge.vue'
import CustomFieldsRenderer from './CustomFieldsRenderer.vue'
import MultiSelectDropdown from './MultiSelectDropdown.vue'
import {
  fetchManagerCustomFieldDefinitions,
  createCustomFieldDefinition,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
  CUSTOM_FIELD_ENTITY_TYPES,
  CUSTOM_FIELD_INPUT_TYPES,
  inputTypeLabel,
  entityTypeLabel
} from '../api/customFields'
import { fetchSportTypes } from '../api/sportTypes'
import { pushToast } from '../toast-center'
import type {
  CustomFieldDefinition,
  CustomFieldDefinitionInput,
  CustomFieldEntityType,
  SportType
} from '../types'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** Numeric association PK — required for the live CRUD endpoints. */
  associationId?: string
  associationShortName?: string
}>(), { associationId: '', associationShortName: '' })

const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()

// Entity + input catalogues come from the shared source of truth in the api
// module (see docs/system/shared-catalogues.md).
const ENTITY_OPTIONS = CUSTOM_FIELD_ENTITY_TYPES
const INPUT_OPTIONS = CUSTOM_FIELD_INPUT_TYPES
const ENTITY_LABELS = ENTITY_OPTIONS.map((o) => o.label)
function inputLabel(v: CustomFieldDefinition['inputType']) { return inputTypeLabel(v) }

// Which entity the list shows. The backend REQUIRES `entityType` (keeps the
// list bounded as data grows), so this is a SERVER-SIDE filter: the dropdown
// drives one fetch per selected entity. Defaults to `event` so a single call
// fires on open. Always set — there is no "all entities" mode.
const activeTab = ref<CustomFieldEntityType>('event')

// Bridge for the single-select MultiSelectDropdown (which works in label[]).
const activeTabAsArray = computed<string[]>({
  get() {
    const hit = ENTITY_OPTIONS.find((o) => o.value === activeTab.value)
    return hit ? [hit.label] : []
  },
  set(labels) {
    // entityType is required — ignore a clear; keep the current entity selected.
    const hit = ENTITY_OPTIONS.find((o) => o.label === labels[0])
    if (hit) activeTab.value = hit.value
  }
})

const definitions = ref<CustomFieldDefinition[]>([])
const sportTypes = ref<SportType[]>([])
const loading = ref(false)
const errorMessage = ref('')
const saving = ref(false)

// 'list' = browse; 'edit' = the add/edit form within the same modal.
const mode = ref<'list' | 'edit'>('list')
const editingId = ref<string | null>(null)
const form = ref<CustomFieldDefinitionInput>(blankForm())
const optionsText = ref('')        // comma-separated entry for select options
const attempted = ref(false)

function blankForm(): CustomFieldDefinitionInput {
  return { entityType: 'event', label: '', inputType: 'boolean', options: [], required: false, sortOrder: 0, sportsTypeId: null, active: true }
}
const isSelectType = computed(() => form.value.inputType === 'single_select' || form.value.inputType === 'multi_select')

// The server already scopes to the selected entity, so the list IS the
// selected entity's definitions.
const visibleDefinitions = computed(() => definitions.value)

async function load() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [defs, sports] = await Promise.all([
      fetchManagerCustomFieldDefinitions(activeTab.value, { associationId: props.associationId, associationShortName: props.associationShortName }),
      fetchSportTypes().catch(() => [] as SportType[])
    ])
    definitions.value = defs
    sportTypes.value = sports
  } catch (e) {
    // Show a friendly message (raw error → console for debugging). A silent
    // empty list hides real failures; a raw parser error confuses admins.
    errorMessage.value = "We couldn't load custom fields. Please try again."
    definitions.value = []
    if (typeof console !== 'undefined') console.warn('[CustomFieldsManager] load failed.', e)
  } finally {
    loading.value = false
  }
}

watch(() => props.modelValue, (open, wasOpen) => {
  if (open && !wasOpen) {
    mode.value = 'list'
    void load()
  }
})

// Dropdown change = a new server-side entity filter → re-fetch (only while open).
watch(activeTab, () => {
  if (props.modelValue) void load()
})

function close() { emit('update:modelValue', false) }

function openNew() {
  editingId.value = null
  // Default the "Appears on" select to the active filter (or the first entity
  // when no filter is applied); the admin can still change it in the form.
  form.value = { ...blankForm(), entityType: activeTab.value ?? 'event' }
  optionsText.value = ''
  attempted.value = false
  previewValue.value = {}
  mode.value = 'edit'
}
function openEdit(def: CustomFieldDefinition) {
  editingId.value = def.id
  form.value = {
    entityType: def.entityType ?? 'event',
    label: def.label,
    inputType: def.inputType,
    options: [...def.options],
    required: def.required,
    sortOrder: def.sortOrder,
    sportsTypeId: def.sportsTypeId ?? null,
    active: def.active ?? true
  }
  optionsText.value = def.options.join(', ')
  attempted.value = false
  previewValue.value = {}
  mode.value = 'edit'
}

const formErrors = computed(() => {
  const e = new Set<string>()
  if (!form.value.label.trim()) e.add('label')
  if (isSelectType.value && parseOptions().length === 0) e.add('options')
  return e
})
function err(field: string) { return attempted.value && formErrors.value.has(field) }
function parseOptions(): string[] {
  return optionsText.value.split(',').map((s) => s.trim()).filter(Boolean)
}

// ── Live preview ──
// A throwaway definition built from the in-progress form, fed to the same
// CustomFieldsRenderer the real entity forms use, so the admin sees exactly
// how the control will look. Nothing here is posted — `previewValue` is a
// disposable local that resets each time the form opens.
const previewValue = ref<Record<string, boolean | string | string[]>>({})
const previewDefinition = computed<CustomFieldDefinition>(() => ({
  id: 'preview',
  key: 'preview',
  entityType: form.value.entityType,
  label: form.value.label.trim() || 'Your field label',
  inputType: form.value.inputType,
  options: isSelectType.value ? parseOptions() : [],
  required: form.value.required,
  sortOrder: form.value.sortOrder,
  sportsTypeId: form.value.sportsTypeId ?? null,
  active: form.value.active
}))

async function save() {
  attempted.value = true
  if (formErrors.value.size > 0) return
  saving.value = true
  try {
    const input: CustomFieldDefinitionInput = {
      ...form.value,
      options: isSelectType.value ? parseOptions() : [],
      // Sort order is maintained automatically: a new field lands after the
      // existing fields of its entity type; an edit keeps its current order.
      sortOrder: editingId.value
        ? form.value.sortOrder
        : definitions.value.filter((d) => (d.entityType ?? 'event') === form.value.entityType).length + 1
    }
    if (editingId.value) {
      await updateCustomFieldDefinition(props.associationId, editingId.value, input)
      pushToast({ tone: 'success', title: 'Custom field updated' })
    } else {
      await createCustomFieldDefinition({ associationId: props.associationId, associationShortName: props.associationShortName }, input)
      pushToast({ tone: 'success', title: 'Custom field added' })
    }
    await load()
    mode.value = 'list'
  } catch (e) {
    pushToast({ tone: 'warning', title: 'Could not save', message: e instanceof Error ? e.message : 'Please try again.' })
  } finally {
    saving.value = false
  }
}

const confirmDeleteId = ref<string | null>(null)
const deleting = ref(false)
async function confirmDelete() {
  const id = confirmDeleteId.value
  if (!id || deleting.value) return
  deleting.value = true
  try {
    await deleteCustomFieldDefinition(props.associationId, id)
    pushToast({ tone: 'success', title: 'Custom field removed' })
    await load()
    mode.value = 'list'
  } catch (e) {
    pushToast({ tone: 'warning', title: 'Could not remove', message: e instanceof Error ? e.message : 'Please try again.' })
  } finally {
    deleting.value = false
    confirmDeleteId.value = null
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Custom fields"
    :eyebrow="associationShortName"
    subtitle="Define extra fields that appear on your event, division, game, team, umpire, player and product forms."
    size="wide"
    @update:model-value="(v) => emit('update:modelValue', v)"
  >
    <!-- ── List ── -->
    <div v-if="mode === 'list'" class="cfm">
      <div class="cfm__toolbar">
        <div class="cfm__toolbar-filters">
          <MultiSelectDropdown
            v-model="activeTabAsArray"
            :options="ENTITY_LABELS"
            placeholder="Appears on"
            single
            :searchable="false"
            aria-label="Filter by entity"
          />
        </div>
        <button type="button" class="association-users__invite-btn" @click="openNew">+ Add field</button>
      </div>

      <ul v-if="loading" class="cfm__list" aria-hidden="true">
        <li v-for="n in 5" :key="n" class="cfm__row">
          <div class="cfm__row-main">
            <div class="cfm__row-title">
              <span class="shimmer-block cfm__sk cfm__sk--badge"></span>
              <span class="shimmer-block cfm__sk cfm__sk--name"></span>
            </div>
            <span class="shimmer-block cfm__sk cfm__sk--meta"></span>
          </div>
          <span class="shimmer-block cfm__sk cfm__sk--btn"></span>
        </li>
      </ul>
      <p v-else-if="errorMessage" class="cfm__muted cfm__error">{{ errorMessage }}</p>
      <p v-else-if="visibleDefinitions.length === 0" class="cfm__muted">
        {{ activeTab ? `No custom fields for ${activeTab}s yet.` : 'No custom fields yet.' }} Add one to surface it on the add/edit workflow.
      </p>

      <ul v-else class="cfm__list">
        <li v-for="def in visibleDefinitions" :key="def.id" class="cfm__row">
          <div class="cfm__row-main">
            <div class="cfm__row-title">
              <StatusBadge :label="def.active === false ? 'Inactive' : 'Active'" :tone="def.active === false ? 'danger' : 'success'" />
              <strong>{{ def.label }}</strong>
            </div>
            <div class="cfm__row-meta">
              <template v-if="activeTab === null">{{ entityTypeLabel(def.entityType) }} · </template>{{ inputLabel(def.inputType) }}<template v-if="def.required"> · required</template><template v-if="def.options.length"> · {{ def.options.join(' / ') }}</template>
            </div>
          </div>
          <div class="cfm__row-actions">
            <button type="button" class="secondary-button cfm__sm" @click="openEdit(def)">Edit</button>
          </div>
        </li>
      </ul>
    </div>

    <!-- ── Add / Edit form ── -->
    <div v-else class="cfm cfm__form">
      <div class="floating-input">
        <select id="cfm-entity" v-model="form.entityType" :disabled="!!editingId" class="floating-input__control floating-input__control--select floating-input__control--has-value" :class="{ 'floating-input__control--disabled': !!editingId }">
          <option v-for="o in ENTITY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <label for="cfm-entity" class="floating-input__label floating-input__label--floated">Appears on</label>
      </div>

      <div class="floating-input">
        <select id="cfm-input" v-model="form.inputType" :disabled="!!editingId" class="floating-input__control floating-input__control--select floating-input__control--has-value" :class="{ 'floating-input__control--disabled': !!editingId }">
          <option v-for="o in INPUT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <label for="cfm-input" class="floating-input__label floating-input__label--floated">Field type</label>
      </div>

      <div class="floating-input" :class="{ 'floating-input--invalid': err('label') }">
        <input id="cfm-label" v-model="form.label" type="text" maxlength="120" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!form.label }" placeholder=" " />
        <label for="cfm-label" class="floating-input__label" :class="{ 'floating-input__label--floated': !!form.label }">Label</label>
        <span v-if="err('label')" class="floating-input__error-corner">Required</span>
      </div>

      <div v-if="isSelectType" class="floating-input" :class="{ 'floating-input--invalid': err('options') }">
        <input id="cfm-options" v-model="optionsText" type="text" class="floating-input__control" :class="{ 'floating-input__control--has-value': !!optionsText }" placeholder=" " />
        <label for="cfm-options" class="floating-input__label" :class="{ 'floating-input__label--floated': !!optionsText }">Choices (comma-separated)</label>
        <span v-if="err('options')" class="floating-input__error-corner">Required</span>
      </div>

      <div class="floating-input">
        <select id="cfm-sport" v-model="form.sportsTypeId" class="floating-input__control floating-input__control--select floating-input__control--has-value">
          <option :value="null">All sports</option>
          <option v-for="s in sportTypes" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <label for="cfm-sport" class="floating-input__label floating-input__label--floated">Sport scope</label>
      </div>

      <div class="cfm__setting">
        <span class="cfm__setting-label">Required</span>
        <ToggleSwitch v-model="form.required" aria-label="Required" />
      </div>
      <div class="cfm__setting">
        <span class="cfm__setting-label">Active (shows on the form)</span>
        <ToggleSwitch v-model="form.active" aria-label="Active" />
      </div>

      <!-- Live preview — renders the in-progress field with the SAME control
           the real entity forms use, so the admin can see what they're
           building. Read-only / disposable: nothing here is posted. -->
      <hr class="cfm__divider" />
      <div class="cfm__preview">
        <span class="cfm__preview-heading">Preview</span>
        <CustomFieldsRenderer
          :definitions="[previewDefinition]"
          v-model="previewValue"
        />
      </div>
    </div>

    <template #footer>
      <template v-if="mode === 'list'">
        <button type="button" class="secondary-button" @click="close">Close</button>
      </template>
      <template v-else>
        <button type="button" class="secondary-button" :disabled="saving" @click="mode = 'list'">Back</button>
        <button v-if="editingId" type="button" class="danger-light-button" :disabled="saving" @click="confirmDeleteId = editingId">Delete</button>
        <span class="cfm__foot-spacer"></span>
        <button type="button" class="primary-button" :disabled="saving" @click="save">
          <span v-if="saving" class="btn-spinner" aria-hidden="true"></span>
          {{ saving ? 'Saving…' : (editingId ? 'Save field' : 'Add field') }}
        </button>
      </template>
    </template>
  </SlideModal>

  <!-- Delete confirm -->
  <Transition name="slide-modal-backdrop">
    <div v-if="confirmDeleteId" class="association-switcher-backdrop" role="presentation" @click.self="confirmDeleteId = null">
      <div class="association-switcher-panel association-confirm-panel" role="alertdialog" aria-modal="true">
        <header class="association-switcher-panel__header">
          <h2 class="association-switcher-panel__title">Remove custom field?</h2>
        </header>
        <div class="association-confirm-panel__body">
          <p class="association-confirm-panel__copy">This field will no longer appear when adding or editing. Anything already filled in on past entries stays safe.</p>
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
.cfm { display: flex; flex-direction: column; gap: 16px; }
.cfm__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.cfm__toolbar-filters { display: flex; align-items: center; gap: 12px; }
.cfm__muted { color: var(--secondary); font-size: 0.9rem; margin: 8px 0; }
.cfm__error { color: var(--danger, #d64545); }
.cfm__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.cfm__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; margin: 0 -12px; border-radius: 8px; border-top: 1px solid var(--border-divider); transition: background-color 120ms ease; }
.cfm__row:first-child { border-top: none; }
.cfm__row:hover { background: var(--surface-pill); border-top-color: transparent; }
.cfm__row:hover + .cfm__row { border-top-color: transparent; }
.cfm__row-title { display: flex; align-items: center; gap: 8px; }
.cfm__row-title strong { font-size: 0.95rem; color: var(--text); }
.cfm__row-meta { font-size: 0.8rem; color: var(--secondary); margin-top: 2px; }
.cfm__row-actions { display: flex; gap: 8px; flex: 0 0 auto; }
.cfm__sm { height: 32px; padding: 0 12px; font-size: 0.82rem; }
/* Loading shimmer rows — sized to mirror the real two-line row layout. */
.cfm__sk { display: inline-block; border-radius: 6px; }
.cfm__sk--badge { width: 56px; height: 20px; border-radius: 999px; }
.cfm__sk--name { width: 140px; height: 14px; }
.cfm__sk--meta { display: block; width: 200px; height: 11px; margin-top: 8px; }
.cfm__sk--btn { width: 60px; height: 32px; border-radius: 8px; }
.cfm__form { gap: 14px; width: 100%; max-width: 440px; margin: 0 auto; }
.cfm__form .floating-input__control--disabled { opacity: 0.6; cursor: not-allowed; }
.cfm__setting { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.cfm__setting-label { font-size: 0.9rem; font-weight: 600; color: var(--text); }
.cfm__divider { border: 0; border-top: 1px solid var(--border-divider); margin: 6px 0; width: 100%; }
.cfm__preview { display: flex; flex-direction: column; gap: 16px; }
.cfm__preview-heading { font-size: 0.8rem; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--secondary); }
.cfm__foot-spacer { flex: 1 1 auto; }
</style>
