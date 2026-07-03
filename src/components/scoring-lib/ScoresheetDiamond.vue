<template>
  <!--
    ScoresheetDiamond
    Renders a baseball diamond cell with base paths highlighted
    based on the result code. Matches the physical scoresheet visual.
  -->
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${size} ${size}`"
    :aria-label="resultCode ? `Result: ${label}` : 'Empty'"
    role="img"
  >
    <!-- Background fill for the diamond area -->
    <rect
      :width="size"
      :height="size"
      :fill="bgColor"
      rx="2"
    />

    <polygon
      :points="`${cx},${cy - half} ${cx + half},${cy} ${cx},${cy + half} ${cx - half},${cy}`"
      :fill="diamondFill"
    />

    <!-- Base paths (the four lines connecting bases) -->
    <!-- Home → First -->
    <line
      :x1="cx" :y1="cy + half"
      :x2="cx + half" :y2="cy"
      :stroke="isFirstOrMore ? activeStroke : inactiveStroke"
      :stroke-width="isFirstOrMore ? 2.5 : 1.5"
      stroke-linecap="round"
    />
    <!-- First → Second -->
    <line
      :x1="cx + half" :y1="cy"
      :x2="cx" :y2="cy - half"
      :stroke="isSecondOrMore ? activeStroke : inactiveStroke"
      :stroke-width="isSecondOrMore ? 2.5 : 1.5"
      stroke-linecap="round"
    />
    <!-- Second → Third -->
    <line
      :x1="cx" :y1="cy - half"
      :x2="cx - half" :y2="cy"
      :stroke="isThirdOrMore ? activeStroke : inactiveStroke"
      :stroke-width="isThirdOrMore ? 2.5 : 1.5"
      stroke-linecap="round"
    />
    <!-- Third → Home -->
    <line
      :x1="cx - half" :y1="cy"
      :x2="cx" :y2="cy + half"
      :stroke="isHomeRun ? activeStroke : inactiveStroke"
      :stroke-width="isHomeRun ? 2.5 : 1.5"
      stroke-linecap="round"
    />

    <!-- Base dots -->
    <circle :cx="cx"        :cy="cy + half" r="2.5" :fill="dotColor" />  <!-- Home  -->
    <circle :cx="cx + half" :cy="cy"        r="2.5" :fill="isFirstOrMore  ? activeStroke : inactiveStroke" />  <!-- 1B -->
    <circle :cx="cx"        :cy="cy - half" r="2.5" :fill="isSecondOrMore ? activeStroke : inactiveStroke" />  <!-- 2B -->
    <circle :cx="cx - half" :cy="cy"        r="2.5" :fill="isThirdOrMore  ? activeStroke : inactiveStroke" />  <!-- 3B -->

    <!-- Result code label in center -->
    <text
      v-if="resultCode"
      :x="cx"
      :y="cy + 1"
      text-anchor="middle"
      dominant-baseline="middle"
      :font-size="labelSize"
      font-weight="700"
      font-family="system-ui, sans-serif"
      :fill="textColor"
    >
      {{ resultCode }}
    </text>

    <g v-if="resultCode && rbi > 0">
      <rect
        :x="size - 20"
        :y="size - 14"
        width="18"
        height="12"
        rx="4"
        fill="#FFD45A"
      />
      <text
        :x="size - 11"
        :y="size - 6"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="8"
        font-weight="700"
        font-family="system-ui, sans-serif"
        fill="#6A4B00"
      >
        {{ rbi }}
      </text>
    </g>
  </svg>
</template>

<script setup>
import { computed } from 'vue'
import { useResultCodesStore } from '../../scoring-stores/resultCodes.js'

const props = defineProps({
  resultCode: {
    type: String,
    default: null,
  },
  sportTypeId: {
    type: Number,
    required: true,
  },
  rbi: {
    type: Number,
    default: 0,
  },
  /** Overall size in px — diamond scales within this square */
  size: {
    type: Number,
    default: 44,
  },
  /** Whether this cell is in the current active inning */
  isActive: {
    type: Boolean,
    default: false,
  },
})

const resultCodesStore = useResultCodesStore()

// ─── Geometry ────────────────────────────────────────────────────────────────

const cx     = computed(() => props.size / 2)
const cy     = computed(() => props.size / 2)
const half   = computed(() => props.size * 0.36)          // distance from center to base
const labelSize = computed(() => Math.max(8, props.size * 0.22))

// ─── Colors ───────────────────────────────────────────────────────────────────

const inactiveStroke = '#B9C6D3'
const defaultActiveStroke = '#17C653'
const dotColor = '#B9C6D3'

const bgColor = computed(() => {
  if (!props.resultCode) return 'transparent'
  return 'transparent'
})

const categoryTheme = computed(() => {
  switch (effectiveCategory.value) {
    case 'hit':
      return { fill: '#EAF3FF', text: '#2F5F98', stroke: '#188EF5' }
    case 'out':
      return { fill: '#FBE7EA', text: '#B84055', stroke: '#E06A7C' }
    case 'on_base':
      return { fill: '#EAF8EB', text: '#17C653', stroke: '#17C653' }
    case 'baserunning':
      return { fill: '#FFF3E5', text: '#9D7A16', stroke: '#D7A63D' }
    default:
      return { fill: 'transparent', text: '#333333', stroke: defaultActiveStroke }
  }
})

const activeStroke = computed(() => categoryTheme.value.stroke)

const textColor = computed(() => {
  if (!props.resultCode) return 'transparent'
  return categoryTheme.value.text
})

const effectiveCategory = computed(() => {
  if (codeObj.value?.category) return codeObj.value.category

  switch (normalizedResultCode.value) {
    case '1B':
    case '2B':
    case '3B':
    case 'HR':
    case 'GRH':
      return 'hit'
    case 'K':
    case 'KC':
    case 'GO':
    case 'FO':
    case 'LO':
    case 'PO':
    case 'SAC':
    case 'SF':
    case 'GDP':
    case 'LDP':
    case 'FDP':
    case 'TP':
    case 'BUNT':
      return 'out'
    case 'BB':
    case 'IBB':
    case 'HBP':
    case 'E':
    case 'FC':
    case 'CI':
    case 'DS':
    case 'OBI':
    case 'ROE':
      return 'on_base'
    case 'SB':
    case 'CS':
    case 'PB':
    case 'WP':
    case 'POFF':
    case 'BK':
    case 'OBR':
    case 'OBS':
    case 'IFR':
      return 'baserunning'
    default:
      return null
  }
})

const diamondFill = computed(() => {
  if (!props.resultCode) return 'transparent'
  return categoryTheme.value.fill
})

// ─── Base path activation ────────────────────────────────────────────────────

const codeObj = computed(() =>
  props.resultCode ? resultCodesStore.get(props.sportTypeId, props.resultCode) : null
)

const normalizedResultCode = computed(() => (props.resultCode ?? '').trim().toUpperCase())

const basesAwarded = computed(() => {
  const configuredBases = codeObj.value?.attributes_json?.bases_awarded
  if (typeof configuredBases === 'number') return configuredBases

  switch (normalizedResultCode.value) {
    case '1B':
      return 1
    case '2B':
      return 2
    case '3B':
      return 3
    case 'HR':
      return 4
    default:
      return 0
  }
})

const isFirstOrMore  = computed(() => basesAwarded.value >= 1)
const isSecondOrMore = computed(() => basesAwarded.value >= 2)
const isThirdOrMore  = computed(() => basesAwarded.value >= 3)
const isHomeRun      = computed(() => basesAwarded.value >= 4)

const label = computed(() =>
  resultCodesStore.label(props.sportTypeId, props.resultCode)
)
</script>




