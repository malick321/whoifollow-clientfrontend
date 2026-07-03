<template>
  <Transition name="modal">
    <div
      v-if="modelValue"
      class="modal-shell"
      role="dialog"
      aria-modal="true"
      :aria-label="`Plate appearance for ${playerName}, inning ${inningNumber}`"
      @mousedown.self="onBackdropClick"
    >
      <div class="modal-scrim" />

      <div class="modal-panel">
          <div class="modal-header">
            <div class="modal-player-heading">
              <div class="modal-player-jersey" aria-hidden="true">
                <img :src="jerseyIcon" alt="" class="modal-player-jersey__icon" />
                <span class="modal-player-jersey__number">{{ jerseyNumber || '-' }}</span>
              </div>
              <div>
                <p class="modal-title">{{ playerName }}</p>
                <p class="modal-subtitle">Inning {{ inningNumber }} - Appearance {{ appearanceNumber }}</p>
              </div>
            </div>
            <button class="modal-close" aria-label="Close" @click="close">✕</button>
          </div>

          <div v-if="formReady" class="modal-body">
            <div v-if="codeGroups.length" class="modal-section">
              <div class="modal-tab-row">
                <button
                  v-for="group in codeGroups"
                  :key="group.category"
                  class="modal-tab"
                  :class="{ 'modal-tab--active': activeCategory === group.category }"
                  @click="selectCategory(group.category)"
                >
                  {{ group.label }}
                </button>
              </div>

              <div v-if="activeGroup" class="modal-chip-row">
                <button
                  v-for="code in activeGroup.codes"
                  :key="code.code"
                  class="modal-chip"
                  :class="{ 'modal-chip--active': form.resultCode === code.code }"
                  :style="chipStyle(activeGroup.category, form.resultCode === code.code)"
                  :title="code.label"
                  @click="selectResultCode(code.code)"
                >
                  {{ code.code }}
                </button>
              </div>
            </div>

            <div v-if="showPitchType" class="modal-section">
              <p class="modal-section-label">Pitch Type</p>
              <div class="modal-chip-row">
                <button
                  v-for="pt in pitchTypes"
                  :key="pt.code"
                  class="modal-chip modal-chip--neutral"
                  :class="{ 'modal-chip--active-neutral': form.pitchType === pt.code }"
                  @click="togglePitchType(pt.code)"
                >
                  {{ pt.code }}
                </button>
              </div>
            </div>

            <div v-if="showWhichOut" class="modal-section">
              <p class="modal-section-label">Which Out</p>
              <div class="modal-step-row">
                <button
                  v-for="n in [1, 2, 3]"
                  :key="n"
                  class="modal-step-button"
                  :class="{ 'modal-step-button--active': form.whichOut === n }"
                  @click="form.whichOut = form.whichOut === n ? null : n"
                >
                  {{ n }}
                </button>
              </div>
            </div>

            <div class="modal-section">
              <p class="modal-section-label">RBI</p>
              <div class="modal-step-row">
                <button
                  v-for="n in [0, 1, 2, 3, 4]"
                  :key="n"
                  class="modal-rbi-button"
                  :class="{ 'modal-rbi-button--active': form.rbi === n }"
                  @click="form.rbi = n"
                >
                  {{ n }}
                </button>
              </div>
            </div>

            <div class="modal-section">
              <p class="modal-section-label">Bases Reached</p>
              <div class="modal-chip-row">
                <button
                  v-for="base in baseReachedOptions"
                  :key="base.value"
                  class="modal-chip modal-chip--base"
                  :class="{ 'modal-chip--base-active': form.batterEndBase === base.value }"
                  @click="form.batterEndBase = base.value"
                >
                  {{ base.label }}
                </button>
              </div>
            </div>

            <div class="modal-preview">
              <ScoresheetDiamond :result-code="form.resultCode" :rbi="form.rbi" :size="56" :sport-type-id="sportTypeId" />
              <p class="modal-preview-label">Preview</p>
              <p v-if="generatedDescription" class="modal-preview-description">{{ generatedDescription }}</p>
            </div>
          </div>

          <div v-else class="modal-body modal-body--loading" aria-label="Loading plate appearance">
            <div class="modal-skeleton-section">
              <div class="modal-skeleton-tabs">
                <span v-for="index in 4" :key="`tab-${index}`" class="modal-skeleton-pill shimmer-block"></span>
              </div>
              <div class="modal-skeleton-chips">
                <span v-for="index in 12" :key="`chip-${index}`" class="modal-skeleton-chip shimmer-block"></span>
              </div>
            </div>

            <div class="modal-skeleton-section">
              <span class="modal-skeleton-label shimmer-block"></span>
              <div class="modal-skeleton-steps">
                <span v-for="index in 5" :key="`rbi-${index}`" class="modal-skeleton-step shimmer-block"></span>
              </div>
            </div>

            <div class="modal-skeleton-section">
              <span class="modal-skeleton-label shimmer-block"></span>
              <div class="modal-skeleton-steps">
                <span v-for="index in 4" :key="`base-${index}`" class="modal-skeleton-base shimmer-block"></span>
              </div>
            </div>

            <div class="modal-skeleton-preview">
              <span class="modal-skeleton-diamond shimmer-block"></span>
              <span class="modal-skeleton-label modal-skeleton-label--short shimmer-block"></span>
            </div>

            <div class="modal-skeleton-section">
              <span class="modal-skeleton-label shimmer-block"></span>
              <span class="modal-skeleton-input shimmer-block"></span>
            </div>
          </div>

          <div v-if="formReady" class="modal-footer">
            <button
              v-if="existingAppearance?.id"
              class="modal-footer-button modal-footer-button--danger"
              @click="deleteAppearance"
            >
              <span v-if="deleting">Deleting...</span>
              <span v-else>Delete</span>
            </button>
            <button
              v-else
              class="modal-footer-button modal-footer-button--danger"
              :disabled="saving"
              :class="{ 'modal-footer-button--disabled': saving }"
              @click="clearForm"
            >
              Clear
            </button>
            <button
              v-if="appearanceCount > 0"
              class="modal-footer-button modal-footer-button--secondary"
              :disabled="saving || deleting"
              :class="{ 'modal-footer-button--disabled': saving || deleting }"
              @click="openNextAppearance"
            >
              Next Plate Appearance
            </button>
            <button
              :disabled="!canSave"
              class="modal-footer-button modal-footer-button--primary"
              :class="{ 'modal-footer-button--disabled': !canSave }"
              @click="save"
            >
              <span v-if="saving">Saving...</span>
              <span v-else>Save At-Bat</span>
            </button>
          </div>
          <div v-else class="modal-footer modal-footer--loading">
            <span v-for="index in 3" :key="`footer-${index}`" class="modal-skeleton-footer-button shimmer-block"></span>
          </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useResultCodesStore } from '../../scoring-stores/resultCodes.js'
import ScoresheetDiamond from './ScoresheetDiamond.vue'
import jerseyIcon from '../../assets/jersy.svg'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  lineupPlayerId: { type: Number, required: true },
  playerName: { type: String, required: true },
  jerseyNumber: { type: String, default: '' },
  inningNumber: { type: Number, required: true },
  appearanceCount: { type: Number, default: 0 },
  appearanceNumber: { type: Number, default: 1 },
  sportTypeId: { type: Number, required: true },
  gameVariant: { type: String, default: null },
  existingAppearance: { type: Object, default: null },
  saving: { type: Boolean, default: false },
  deleting: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'save', 'delete', 'next-appearance', 'cancel'])
const resultCodesStore = useResultCodesStore()

const defaultForm = () => ({
  resultCode: null,
  batterEndBase: null,
  pitchType: null,
  whichOut: null,
  rbi: 0,
})

const form = ref(defaultForm())
const activeCategory = ref('hit')
const formReady = ref(false)

function populateFromExisting() {
  if (!props.existingAppearance) return
  const pa = props.existingAppearance
  form.value = {
    resultCode: pa.result_code ?? null,
    batterEndBase: pa.batter_end_base ?? null,
    pitchType: pa.pitch_type ?? null,
    whichOut: pa.which_out ?? null,
    rbi: pa.rbi ?? 0,
  }
}

async function hydrateForm() {
  if (!props.modelValue) {
    formReady.value = false
    return
  }

  formReady.value = false
  await resultCodesStore.load(props.sportTypeId, props.gameVariant)
  if (props.existingAppearance) populateFromExisting()
  else clearForm()
  formReady.value = true
}

watch(
  () => [
    props.modelValue,
    props.existingAppearance?.id ?? null,
    props.lineupPlayerId,
    props.inningNumber,
    props.appearanceNumber,
    props.sportTypeId,
    props.gameVariant
  ],
  () => {
    void hydrateForm()
  },
  { immediate: true }
)

const CATEGORY_LABELS = {
  hit: 'Hits',
  out: 'Outs',
  on_base: 'On Base',
  baserunning: 'Baserunning',
}

const CATEGORY_THEME = {
  hit: { border: '#b7d5f7', color: '#2f5f98', bg: '#ffffff', activeBg: '#2d8cf0', activeColor: '#ffffff' },
  out: { border: '#efc1c8', color: '#b84055', bg: '#ffffff', activeBg: '#d55a70', activeColor: '#ffffff' },
  on_base: { border: '#b6ebc7', color: '#17C653', bg: '#ffffff', activeBg: '#17C653', activeColor: '#ffffff' },
  baserunning: { border: '#f4dc9a', color: '#9d7a16', bg: '#ffffff', activeBg: '#ffd45a', activeColor: '#4b3d06' },
}

const codeGroups = computed(() => {
  const order = ['hit', 'out', 'on_base', 'baserunning']
  return order
    .map((category) => ({
      category,
      label: CATEGORY_LABELS[category] ?? category,
      codes: resultCodesStore.byCategory(props.sportTypeId, category, props.gameVariant),
    }))
    .filter((g) => g.codes.length > 0)
})

const activeGroup = computed(() => {
  if (!codeGroups.value.length) return null
  return codeGroups.value.find((group) => group.category === activeCategory.value) ?? codeGroups.value[0]
})

const pitchTypes = [
  { code: 'FB', label: 'Fastball' },
  { code: 'CB', label: 'Curveball' },
  { code: 'SL', label: 'Slider' },
  { code: 'CH', label: 'Changeup' },
  { code: 'CT', label: 'Cutter' },
  { code: 'SP', label: 'Splitter' },
  { code: 'KN', label: 'Knuckleball' },
  { code: 'OT', label: 'Other' },
]

const baseReachedOptions = [
  { value: '1B', label: '1B' },
  { value: '2B', label: '2B' },
  { value: '3B', label: '3B' },
  { value: 'HP', label: 'Scored' },
]

const showPitchType = computed(() => props.gameVariant !== 'slow_pitch')
const selectedCode = computed(() =>
  form.value.resultCode ? resultCodesStore.get(props.sportTypeId, form.value.resultCode) : null
)
const showWhichOut = computed(() => selectedCode.value?.ends_turn === 1)
const canSave = computed(() => !!form.value.resultCode)
const generatedDescription = computed(() => {
  if (!form.value.resultCode) return ''

  const label = resultCodesStore.label(props.sportTypeId, form.value.resultCode)
  const parts = [label]

  if (form.value.whichOut) {
    parts.push(`for the ${ordinal(form.value.whichOut)} out`)
  }

  if (form.value.batterEndBase && form.value.batterEndBase !== 'HP') {
    parts.push(`batter reached ${baseLabel(form.value.batterEndBase)}`)
  }

  if (form.value.batterEndBase === 'HP') {
    parts.push('batter scored')
  }

  if (form.value.rbi > 0) {
    parts.push(`${form.value.rbi} ${form.value.rbi === 1 ? 'RBI' : 'RBIs'}`)
  }

  return `${parts.join(', ')}.`
})

function ordinal(value) {
  if (value === 1) return 'first'
  if (value === 2) return 'second'
  if (value === 3) return 'third'
  return String(value)
}

function baseLabel(value) {
  if (value === '1B') return 'first base'
  if (value === '2B') return 'second base'
  if (value === '3B') return 'third base'
  return value
}

watch(
  codeGroups,
  (groups) => {
    if (!groups.length) return
    if (!groups.some((group) => group.category === activeCategory.value)) {
      activeCategory.value = groups[0].category
    }
  },
  { immediate: true }
)

watch(
  selectedCode,
  (code) => {
    if (code?.category) activeCategory.value = code.category
    if (!code) {
      form.value.batterEndBase = null
      return
    }

    const resultCode = form.value.resultCode
    if (['HR', 'GRH'].includes(resultCode ?? '')) {
      form.value.batterEndBase = 'HP'
    } else if (['3B'].includes(resultCode ?? '')) {
      form.value.batterEndBase = '3B'
    } else if (['2B'].includes(resultCode ?? '')) {
      form.value.batterEndBase = '2B'
    } else if (['1B', 'BB', 'IBB', 'HBP', 'E', 'FC', 'CI', 'OBI'].includes(resultCode ?? '')) {
      form.value.batterEndBase = form.value.batterEndBase ?? '1B'
    } else {
      form.value.batterEndBase = null
    }
  },
  { immediate: true }
)

function chipStyle(category, active) {
  const theme = CATEGORY_THEME[category] ?? CATEGORY_THEME.hit
  return {
    borderColor: theme.border,
    color: active ? theme.activeColor : theme.color,
    background: active ? theme.activeBg : theme.bg,
  }
}

function selectResultCode(code) {
  form.value.resultCode = form.value.resultCode === code ? null : code
  if (!showWhichOut.value) form.value.whichOut = null
}

function selectCategory(category) {
  activeCategory.value = category
  const group = codeGroups.value.find((entry) => entry.category === category)
  const firstCode = group?.codes[0]?.code ?? null
  form.value.resultCode = firstCode
  form.value.whichOut = null
}

function togglePitchType(code) {
  form.value.pitchType = form.value.pitchType === code ? null : code
}

function clearForm() {
  form.value = defaultForm()
  if (codeGroups.value.length) activeCategory.value = codeGroups.value[0].category
}

function openNextAppearance() {
  clearForm()
  emit('next-appearance')
}

function deleteAppearance() {
  if (!props.existingAppearance?.id || props.saving || props.deleting) return
  emit('delete', props.existingAppearance.id)
}

function close() {
  emit('update:modelValue', false)
  emit('cancel')
}

function onBackdropClick() {
  close()
}

function save() {
  if (!canSave.value || props.saving || props.deleting) return
  const codeObj = selectedCode.value
  emit('save', {
    lineup_player_id: props.lineupPlayerId,
    inning_number: props.inningNumber,
    result_code: form.value.resultCode,
    result_detail: generatedDescription.value || null,
    batter_end_base: form.value.batterEndBase,
    rbi: form.value.rbi,
    which_out: form.value.whichOut,
    pitch_type: form.value.pitchType,
    appearance_number: props.appearanceNumber,
    counts_as_at_bat: codeObj?.attributes_json?.counts_as_at_bat ?? true,
    counts_as_plate_appearance: codeObj?.attributes_json?.counts_as_plate_appearance ?? true,
    is_on_base: codeObj?.advances_position === 1,
    run_scored: form.value.batterEndBase === 'HP',
    is_earned_run: null,
  })
}
</script>

<style scoped>
.modal-shell {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-scrim {
  position: absolute;
  inset: 0;
  background: rgba(36, 60, 91, 0.24);
  backdrop-filter: blur(4px);
}

.modal-panel {
  position: relative;
  z-index: 1;
  width: min(100%, 420px);
  max-height: calc(100vh - 32px);
  overflow: hidden;
  border: 1px solid var(--secondary-light-4);
  border-radius: 11px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(247, 250, 253, 0.98));
  box-shadow: 0 24px 60px rgba(36, 60, 91, 0.18);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  background: var(--white);
  border-bottom: 1px solid var(--secondary-light-4);
}

.modal-player-heading {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 12px;
}

.modal-player-jersey {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
}

.modal-player-jersey__icon {
  width: 100%;
  height: 100%;
  display: block;
}

.modal-player-jersey__number {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
}

.modal-title {
  margin: 0;
  color: var(--text);
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.modal-subtitle {
  margin: 4px 0 0;
  color: var(--secondary);
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: #254c72;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}

.modal-body {
  display: grid;
  gap: 18px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  padding: 18px;
}

.modal-body--loading {
  overflow: hidden;
}

.modal-skeleton-section {
  display: grid;
  gap: 10px;
}

.modal-skeleton-tabs,
.modal-skeleton-chips,
.modal-skeleton-steps {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}

.modal-skeleton-pill {
  width: 72px;
  height: 36px;
  border-radius: 5px;
}

.modal-skeleton-chip {
  width: 50px;
  height: 36px;
  border-radius: 5px;
}

.modal-skeleton-label {
  width: 116px;
  height: 12px;
  justify-self: center;
  border-radius: 999px;
}

.modal-skeleton-label--short {
  width: 72px;
}

.modal-skeleton-step {
  width: 36px;
  height: 36px;
  border-radius: 5px;
}

.modal-skeleton-base {
  width: 56px;
  height: 36px;
  border-radius: 5px;
}

.modal-skeleton-preview {
  display: grid;
  justify-items: center;
  gap: 10px;
  padding: 6px 0 2px;
}

.modal-skeleton-diamond {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  transform: rotate(45deg);
}

.modal-skeleton-input {
  width: 100%;
  height: 45px;
  border-radius: 8px;
}

.modal-section {
  display: grid;
  gap: 10px;
}

.modal-section-label {
  margin: 0;
  color: var(--secondary);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  text-align: center;
}

.modal-chip-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
}

.modal-tab-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.modal-tab {
  min-height: 36px;
  padding: 0 14px;
  border: 0.5px solid #cfd7e0;
  border-radius: 5px;
  background: #f0f2f5;
  color: #254c72;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease, color 120ms ease, transform 120ms ease;
}

.modal-tab--active {
  border-color: var(--primary);
  background: var(--primary-light-3);
  color: var(--secondary);
}

.modal-chip {
  min-width: 50px;
  min-height: 36px;
  padding: 0 13px;
  border: 0.5px solid #cfd7e0;
  border-radius: 5px;
  background: #f0f2f5;
  color: #254c72;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.modal-chip:hover,
.modal-step-button:hover,
.modal-rbi-button:hover,
.modal-footer-button:hover,
.modal-close:hover {
  transform: translateY(-1px);
}

.modal-chip--neutral {
  border-color: #cfd7e0;
  background: #f0f2f5;
  color: #254c72;
}

.modal-chip--active-neutral {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

.modal-chip--base {
  min-width: 56px;
  border-color: #cfd7e0;
  color: #254c72;
}

.modal-chip--base-active {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

.modal-step-row {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.modal-step-button,
.modal-rbi-button {
  width: 36px;
  height: 36px;
  border: 0.5px solid #cfd7e0;
  border-radius: 5px;
  background: #f0f2f5;
  color: #254c72;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.modal-step-button--active {
  background: #f16c7f;
  border-color: #f16c7f;
  box-shadow: 0 10px 18px rgba(241, 108, 127, 0.22);
  color: var(--white);
}

.modal-rbi-button--active {
  background: #ffd45a;
  border-color: #ffd45a;
  box-shadow: 0 10px 18px rgba(255, 212, 90, 0.24);
  color: #4b3d06;
}

.modal-preview {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 6px 0 2px;
}

.modal-preview-label {
  margin: 0;
  color: var(--secondary);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.modal-preview-description {
  margin: 0;
  color: #333333;
  font-size: 0.84rem;
  text-align: center;
}

.modal-input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--secondary-light-3);
  border-radius: 12px;
  background: var(--white);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.95rem;
}

.modal-footer {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 18px 18px;
  border-top: 1px solid var(--secondary-light-4);
  background: rgba(247, 250, 253, 0.96);
}

.modal-footer--loading {
  pointer-events: none;
}

.modal-skeleton-footer-button {
  height: 36px;
  border-radius: 5px;
}

.modal-footer-button {
  min-height: 36px;
  border-radius: 5px;
  border: 1px solid var(--secondary-light-3);
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.modal-footer-button--secondary {
  border-color: #cfd7e0;
  background: #f0f2f5;
  color: #254c72;
}

.modal-footer-button--danger {
  border-color: #ff5b66;
  background: #ffd7d7;
  color: #ff5b66;
}

.modal-footer-button--primary {
  border-color: var(--primary);
  background: var(--primary);
  box-shadow: none;
  color: var(--white);
}

.modal-footer-button--disabled {
  border-color: #d8dee7;
  background: #d8dee7;
  box-shadow: none;
  color: #7d8794;
  cursor: not-allowed;
  transform: none;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .modal-panel,
.modal-leave-active .modal-panel {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-panel,
.modal-leave-to .modal-panel {
  transform: scale(0.96);
  opacity: 0;
}

@media (max-width: 520px) {
  .modal-footer {
    grid-template-columns: 1fr;
  }
}
</style>
