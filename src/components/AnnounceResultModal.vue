<script setup lang="ts">
// AnnounceResultModal
// -------------------
// Announce a division's final result as a list of per-UNIT podiums. A unit
// is an existing bracket OR an existing pool (its teams not decided by a
// completed/active bracket) — no new grouping. Each unit is announced
// INDEPENDENTLY and incrementally:
//   - Bracket units are READ-ONLY: a completed bracket shows AUTO winners;
//     pending/initiated/in_progress show status only; a cancelled bracket
//     shows its reason (its teams are announced via their pool). An
//     initiated/in_progress bracket offers a "Cancel bracket" action.
//   - A pool unit is set by hand — variable-depth podium (top-N by team
//     count), co-champions, or "No result".
// Centered popup using the shared switcher chrome. Mock-backed for v1 —
// see matchgeni-division-api-contract §5.

import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'
import AppIcon from './AppIcon.vue'
import TeamAvatar from './TeamAvatar.vue'
import type { BracketCancelReasonCode, SetUnitStandingsPayload, StandingPlacement, StandingUnit, StandingUnitPlay } from '../types'
import type { StandingsTeam } from '../api/matchGeniStandings'
import { unitPlayTone } from '../lib/bracketStatus'

const props = defineProps<{
  /** The division's result units (brackets + leftover-team pools). */
  units: StandingUnit[]
  /** Eligible teams per unit, keyed `${kind}:${refId}`. */
  eligibleTeams: Record<string, StandingsTeam[]>
  divisionName?: string
}>()

const emit = defineEmits<{
  (event: 'save', payload: SetUnitStandingsPayload): void
  /** Ask the host to cancel this bracket (opens the shared reason form). */
  (event: 'cancel-bracket', refId: string): void
  (event: 'close'): void
}>()

function keyOf(u: { kind: string; refId: string }): string {
  return `${u.kind}:${u.refId}`
}

interface UnitPick {
  coChampion: boolean
  first: string
  firstB: string
  second: string
  third: string
  noResult: boolean
}

// One pick set per unit (pools + manually-announced in-progress brackets).
const picks = reactive<Record<string, UnitPick>>({})
// Local "reveal the pickers" flip for an in-progress bracket the admin
// chose to announce from (vs leaving it to auto-complete). Not persisted
// until Save.
const manualOpen = reactive<Record<string, boolean>>({})

function seedUnit(u: StandingUnit) {
  const k = keyOf(u)
  if (!picks[k]) {
    const ones = u.placements.filter((p) => p.rank === 1)
    picks[k] = {
      coChampion: ones.length > 1,
      first: ones[0]?.teamName ?? '',
      firstB: ones[1]?.teamName ?? '',
      second: u.placements.find((p) => p.rank === 2)?.teamName ?? '',
      third: u.placements.find((p) => p.rank === 3)?.teamName ?? '',
      noResult: u.status === 'no_result'
    }
  }
}
function pickFor(u: StandingUnit): UnitPick {
  seedUnit(u)
  return picks[keyOf(u)]
}

const activeId = ref<string>('')
watch(
  () => props.units,
  (units) => {
    units.forEach(seedUnit)
    if (!activeId.value || !units.some((u) => keyOf(u) === activeId.value)) {
      activeId.value = units[0] ? keyOf(units[0]) : ''
    }
    void nextTick(updateTabsArrows)
  },
  { immediate: true }
)

const activeUnit = computed(() => props.units.find((u) => keyOf(u) === activeId.value) ?? null)
function teamsFor(u: StandingUnit): StandingsTeam[] {
  return props.eligibleTeams[keyOf(u)] ?? []
}
/** Variable podium depth — top-N capped by the unit's team count. */
function depthFor(u: StandingUnit): number {
  return Math.min(3, Math.max(1, u.teamCount))
}
/** Whether this unit's podium pickers are shown right now. Pools are always
 *  manual. An in-progress bracket is editable but its pickers stay hidden
 *  behind the "Announce result" reveal until the admin opts in (or it was
 *  already announced). Completed / pending / cancelled brackets never edit. */
function pickersVisible(u: StandingUnit): boolean {
  if (!u.editable) return false
  if (u.kind === 'pool') return true
  return manualOpen[keyOf(u)] === true || u.status === 'announced' || u.status === 'no_result'
}
/** Reveal the manual pickers for an in-progress bracket. */
function announceManually(u: StandingUnit) {
  manualOpen[keyOf(u)] = true
}
/** Offer the manual "Announce result" action — an in-progress bracket that
 *  isn't already showing its pickers. */
function canAnnounceManually(u: StandingUnit): boolean {
  return u.kind === 'bracket' && u.editable && u.playStatus === 'in_progress' && !pickersVisible(u)
}
/** A bracket can be cancelled while it's seeded but unfinished. */
function canCancel(u: StandingUnit): boolean {
  return u.kind === 'bracket' && (u.playStatus === 'initiated' || u.playStatus === 'in_progress')
}

const PLAY_LABEL: Record<StandingUnitPlay, string> = {
  not_started: 'Not started',
  initiated: 'Initiated',
  in_progress: 'In progress',
  complete: 'Complete',
  cancelled: 'Cancelled'
}
function playLabel(p: StandingUnitPlay): string {
  return PLAY_LABEL[p]
}
/** Secondary line for a podium row — gender/age/rating · location. */
function placementMeta(p: StandingPlacement): string {
  return [p.teamMeta, p.location].filter(Boolean).join(' · ')
}

const REASON_LABEL: Record<BracketCancelReasonCode, string> = {
  rain: 'Rain',
  field_conditions: 'Field conditions',
  time_curfew: 'Time / curfew',
  other: 'Other'
}
/** "Rain — note" / "Field conditions" for a cancelled bracket. */
function cancellationText(u: StandingUnit): string {
  const c = u.cancellation
  if (!c) return 'Cancelled'
  const label = REASON_LABEL[c.reasonCode]
  return c.note ? `${label} — ${c.note}` : label
}

function selectUnit(id: string, event: MouseEvent) {
  activeId.value = id
  ;(event.currentTarget as HTMLElement | null)?.scrollIntoView({
    block: 'nearest',
    inline: 'center',
    behavior: 'smooth'
  })
}

// Edge "cut" shadows on the tab strip.
const tabsRef = ref<HTMLElement | null>(null)
const tabsCanPrev = ref(false)
const tabsCanNext = ref(false)
function updateTabsArrows() {
  const el = tabsRef.value
  if (!el) {
    tabsCanPrev.value = false
    tabsCanNext.value = false
    return
  }
  tabsCanPrev.value = el.scrollLeft > 2
  tabsCanNext.value = el.scrollLeft < el.scrollWidth - el.clientWidth - 2
}
onMounted(() => void nextTick(updateTabsArrows))

function unitValid(u: StandingUnit): boolean {
  const p = pickFor(u)
  if (p.noResult) return true
  return p.coChampion ? !!p.first && !!p.firstB && p.first !== p.firstB : !!p.first
}

function teamObj(u: StandingUnit, name: string): { teamId?: string; teamName: string } {
  const t = teamsFor(u).find((x) => x.teamName === name)
  return t ? { teamId: t.teamId, teamName: t.teamName } : { teamName: name }
}

const canSaveActive = computed(() => {
  const u = activeUnit.value
  return !!u && pickersVisible(u) && unitValid(u)
})

function save() {
  const u = activeUnit.value
  if (!u || !canSaveActive.value) return
  const p = pickFor(u)
  const placements: SetUnitStandingsPayload['placements'] = []
  if (!p.noResult) {
    if (p.coChampion) {
      placements.push({ rank: 1, ...teamObj(u, p.first), coChampion: true })
      placements.push({ rank: 1, ...teamObj(u, p.firstB), coChampion: true })
    } else {
      const depth = depthFor(u)
      if (p.first) placements.push({ rank: 1, ...teamObj(u, p.first) })
      if (depth >= 2 && p.second) placements.push({ rank: 2, ...teamObj(u, p.second) })
      if (depth >= 3 && p.third) placements.push({ rank: 3, ...teamObj(u, p.third) })
    }
  }
  emit('save', {
    kind: u.kind,
    refId: u.refId,
    noResult: p.noResult,
    placements
  })
}

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) emit('close')
}

lockBodyScroll()
onBeforeUnmount(() => unlockBodyScroll())
</script>

<template>
  <Teleport to="body">
  <Transition name="slide-modal-backdrop" appear>
    <div class="association-switcher-backdrop" role="presentation" @click="onBackdrop">
      <div class="association-switcher-panel announce-result" role="dialog" aria-modal="true" aria-label="Announce result">
        <header class="association-switcher-panel__header">
          <div class="announce-result__titles">
            <span v-if="divisionName" class="announce-result__eyebrow">{{ divisionName }}</span>
            <h2 class="association-switcher-panel__title">Announce Result</h2>
          </div>
          <button type="button" class="association-switcher-panel__close" aria-label="Close" @click="emit('close')">
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <!-- Per-unit list — one tab per bracket / pool; each unit is
             announced independently. -->
        <div class="announce-result__body announce-result__body--scroll">
          <div
            v-if="units.length > 1"
            class="announce-result__group-tabs-wrap"
            :class="{
              'announce-result__group-tabs-wrap--fade-start': tabsCanPrev,
              'announce-result__group-tabs-wrap--fade-end': tabsCanNext
            }"
          >
            <div ref="tabsRef" class="announce-result__group-tabs" role="tablist" @scroll="updateTabsArrows">
              <button
                v-for="u in units"
                :key="`tab-${keyOf(u)}`"
                type="button"
                role="tab"
                class="announce-result__group-tab"
                :class="{ 'announce-result__group-tab--active': activeId === keyOf(u) }"
                :aria-selected="activeId === keyOf(u)"
                @click="selectUnit(keyOf(u), $event)"
              >
                <span class="announce-result__tab-dot" :data-tone="unitPlayTone(u.playStatus)" aria-hidden="true"></span>
                {{ u.name }}
              </button>
            </div>
          </div>

          <div
            v-for="u in units"
            v-show="activeId === keyOf(u)"
            :key="keyOf(u)"
            class="announce-result__group"
          >
            <!-- Unit meta — play status (toned pill) + team count. -->
            <div class="announce-result__unit-meta">
              <span class="announce-result__status-pill" :data-tone="unitPlayTone(u.playStatus)">{{ playLabel(u.playStatus) }}</span>
              <span class="announce-result__unit-count">{{ u.teamCount }} team{{ u.teamCount === 1 ? '' : 's' }}</span>
            </div>

            <!-- Read-only / action modes (no pickers showing yet). -->
            <template v-if="!pickersVisible(u)">
              <!-- Completed → auto podium. -->
              <template v-if="u.playStatus === 'complete'">
                <ul class="announce-result__auto-list">
                  <li
                    v-for="p in u.placements"
                    :key="`${p.rank}-${p.teamName}`"
                    class="announce-result__auto-row"
                    :class="{ 'announce-result__auto-row--champion': p.rank === 1 }"
                  >
                    <span class="announce-result__auto-rank">
                      <span v-if="p.rank === 1" class="announce-result__cup" aria-hidden="true"></span>
                      <span v-else class="announce-result__rank" :data-rank="p.rank">{{ p.rankLabel }}</span>
                    </span>
                    <TeamAvatar :name="p.teamName" :image-url="p.imageUrl" :size="p.rank === 1 ? 'md' : 'sm'" />
                    <span class="announce-result__auto-copy">
                      <span class="announce-result__auto-team">{{ p.teamName }}</span>
                      <span v-if="placementMeta(p)" class="announce-result__auto-meta">{{ placementMeta(p) }}</span>
                    </span>
                  </li>
                </ul>
                <p class="announce-result__hint">Winners are set automatically from the completed bracket.</p>
              </template>
              <!-- Cancelled → informational; teams announced under their pool. -->
              <template v-else-if="u.playStatus === 'cancelled'">
                <p class="announce-result__hint">
                  <strong>{{ cancellationText(u) }}</strong>
                </p>
                <p class="announce-result__hint">
                  This bracket was cancelled — its teams are announced under their pool.
                </p>
              </template>
              <!-- In progress → can be announced from the bracket OR cancelled. -->
              <template v-else-if="u.playStatus === 'in_progress'">
                <p class="announce-result__hint">
                  Once this bracket reaches a callable stage you can announce its winners.
                  If play was stopped (e.g. rain), cancel it to announce from the pool instead.
                </p>
                <div class="announce-result__actions">
                  <button
                    v-if="canAnnounceManually(u)"
                    type="button"
                    class="primary-button"
                    @click="announceManually(u)"
                  >
                    Announce result
                  </button>
                  <button
                    v-if="canCancel(u)"
                    type="button"
                    class="secondary-button"
                    @click="emit('cancel-bracket', u.refId)"
                  >
                    Cancel bracket
                  </button>
                </div>
              </template>
              <!-- Pending / initiated → nothing to call yet. -->
              <template v-else>
                <p class="announce-result__hint">
                  No result yet — winners appear automatically once this bracket completes.
                </p>
                <button
                  v-if="canCancel(u)"
                  type="button"
                  class="secondary-button announce-result__cancel-bracket"
                  @click="emit('cancel-bracket', u.refId)"
                >
                  Cancel bracket
                </button>
              </template>
            </template>

            <!-- Pickers — pool units, or an in-progress bracket being
                 announced from the bracket. -->
            <template v-else>
              <button
                type="button"
                class="toggle-switch announce-result__head-toggle"
                :class="{ 'toggle-switch--on': pickFor(u).noResult }"
                role="switch"
                :aria-checked="pickFor(u).noResult"
                @click="pickFor(u).noResult = !pickFor(u).noResult"
              >
                <span class="toggle-switch__label">No result</span>
                <span class="toggle-switch__track"><span class="toggle-switch__knob"></span></span>
              </button>

              <template v-if="!pickFor(u).noResult">
                <button
                  v-if="u.teamCount >= 2"
                  type="button"
                  class="toggle-switch announce-result__row-toggle"
                  :class="{ 'toggle-switch--on': pickFor(u).coChampion }"
                  role="switch"
                  :aria-checked="pickFor(u).coChampion"
                  @click="pickFor(u).coChampion = !pickFor(u).coChampion"
                >
                  <span class="toggle-switch__label">Co-champions</span>
                  <span class="toggle-switch__track"><span class="toggle-switch__knob"></span></span>
                </button>

                <template v-if="pickFor(u).coChampion">
                  <div class="announce-result__row">
                    <span class="announce-result__cup" aria-label="Champion" title="Champion"></span>
                    <div class="floating-input announce-result__pick">
                      <select v-model="pickFor(u).first" class="floating-input__control floating-input__control--select">
                        <option value="">— Select team —</option>
                        <option v-for="t in teamsFor(u)" :key="`${keyOf(u)}-a-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                      </select>
                    </div>
                  </div>
                  <div class="announce-result__row">
                    <span class="announce-result__cup" aria-label="Champion" title="Champion"></span>
                    <div class="floating-input announce-result__pick">
                      <select v-model="pickFor(u).firstB" class="floating-input__control floating-input__control--select">
                        <option value="">— Select team —</option>
                        <option v-for="t in teamsFor(u)" :key="`${keyOf(u)}-b-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                      </select>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div class="announce-result__row">
                    <span class="announce-result__cup" aria-label="1st" title="1st"></span>
                    <div class="floating-input announce-result__pick">
                      <select v-model="pickFor(u).first" class="floating-input__control floating-input__control--select">
                        <option value="">— Select team —</option>
                        <option v-for="t in teamsFor(u)" :key="`${keyOf(u)}-1-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                      </select>
                    </div>
                  </div>
                  <div v-if="depthFor(u) >= 2" class="announce-result__row">
                    <span class="announce-result__rank" data-rank="2">2nd</span>
                    <div class="floating-input announce-result__pick">
                      <select v-model="pickFor(u).second" class="floating-input__control floating-input__control--select">
                        <option value="">— Select team —</option>
                        <option v-for="t in teamsFor(u)" :key="`${keyOf(u)}-2-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                      </select>
                    </div>
                  </div>
                  <div v-if="depthFor(u) >= 3" class="announce-result__row">
                    <span class="announce-result__rank" data-rank="3">3rd</span>
                    <div class="floating-input announce-result__pick">
                      <select v-model="pickFor(u).third" class="floating-input__control floating-input__control--select">
                        <option value="">— Select team —</option>
                        <option v-for="t in teamsFor(u)" :key="`${keyOf(u)}-3-${t.teamName}`" :value="t.teamName">{{ t.teamName }}</option>
                      </select>
                    </div>
                  </div>
                </template>
              </template>
              <!-- Brackets being announced can still be cancelled instead
                   (rain → pool); pools never show this. -->
              <button
                v-if="canCancel(u)"
                type="button"
                class="secondary-button announce-result__cancel-inline"
                @click="emit('cancel-bracket', u.refId)"
              >Cancel bracket instead</button>
            </template>
          </div>
          <p v-if="units.length === 0" class="announce-result__empty">No result units in this division yet.</p>
        </div>

        <footer class="announce-result__footer">
          <button type="button" class="secondary-button" @click="emit('close')">Close</button>
          <button
            v-if="activeUnit && pickersVisible(activeUnit)"
            type="button"
            class="primary-button"
            :disabled="!canSaveActive"
            @click="save"
          >Save result</button>
        </footer>
      </div>
    </div>
  </Transition>
  </Teleport>
</template>

<style scoped>
.announce-result { width: min(460px, 100%); }
.announce-result__titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.announce-result__eyebrow {
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--secondary);
}
.announce-result__body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.announce-result__body--scroll {
  /* FIXED height (not max-height) — the step-2 content is bounded (a
     couple of bracket/pool groups, each a 3-row podium), so the popup
     keeps a consistent size regardless of how much data is present;
     anything taller scrolls internally instead of growing the popup. */
  height: min(60vh, 460px);
  overflow-y: auto;
  /* No container padding — the nav rail runs edge-to-edge (for its cut
     shadows) and the content + rail ends carry their own insets. */
  padding: 0;
  gap: 0;
}
.announce-result__lead {
  margin: 0;
  font-size: 13px;
  color: var(--text);
}
/* Segmented-pill picker — three tiles in one row, mirroring the
   scheduler break form's "Applies to" field. Native radio hidden; the
   tile chrome (primary-tinted fill + inset border) carries the
   selected state. */
.announce-result__choices {
  display: flex;
  gap: 8px;
}
.announce-result__choice {
  flex: 1 1 0;
}
.announce-result__choice {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border-divider);
  border-radius: 8px;
  background: var(--surface-card);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}
.announce-result__choice:hover {
  border-color: var(--primary-light-2, #b9d4f4);
  background: var(--primary-light-3);
}
html.dark-mode .announce-result__choice {
  background: rgba(255, 255, 255, 0.03);
}
html.dark-mode .announce-result__choice:hover {
  background: rgba(45, 140, 240, 0.10);
  border-color: rgba(45, 140, 240, 0.45);
}
.announce-result__choice--active {
  border-color: var(--primary);
  background: var(--primary-light-3);
  box-shadow: inset 0 0 0 1px var(--primary);
}
html.dark-mode .announce-result__choice--active {
  background: rgba(45, 140, 240, 0.15);
  border-color: var(--primary);
}
.announce-result__choice--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.announce-result__choice--disabled:hover {
  border-color: var(--border-divider);
  background: var(--surface-card);
}
html.dark-mode .announce-result__choice--disabled:hover {
  background: rgba(255, 255, 255, 0.03);
}
/* Native radio hidden — pill chrome carries the visual state; the input
   stays in the DOM for keyboard/focus + binding. */
.announce-result__choice-radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.announce-result__choice-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.2;
}
.announce-result__choice--active .announce-result__choice-label {
  color: var(--primary);
}
html.dark-mode .announce-result__choice--active .announce-result__choice-label {
  color: #7fb0e8;
}
.announce-result__choice-hint {
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.2;
}
/* Group tabs — one tab per bracket / pool; the active group's pickers
   show below. Reuses the finalized MatchGeni pill-tab style
   (`.mg-div-detail__tab`). */
/* Edge "cut" shadows on the tab strip — same concept as the bracket
   rail (left when scrolled off the start, right when more remains). */
.announce-result__group-tabs-wrap {
  position: relative;
  /* Same surface as the dashboard division-list bracket card. */
  background: var(--surface-raised, #f4f8fd);
  /* Bottom divider — same border as the popup header. */
  border-bottom: 1px solid var(--border-divider);
}
.announce-result__group-tabs-wrap::before,
.announce-result__group-tabs-wrap::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 28px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
  /* Oval intensity — full strength through the vertical centre, easing
     off toward the top + bottom ends. */
  -webkit-mask: linear-gradient(to bottom, transparent, #000 40%, #000 60%, transparent);
  mask: linear-gradient(to bottom, transparent, #000 40%, #000 60%, transparent);
}
.announce-result__group-tabs-wrap::before {
  left: 0;
  box-shadow: inset 14px 0 12px -12px rgba(20, 40, 80, 0.6);
}
.announce-result__group-tabs-wrap::after {
  right: 0;
  box-shadow: inset -14px 0 12px -12px rgba(20, 40, 80, 0.6);
}
html.dark-mode .announce-result__group-tabs-wrap::before {
  box-shadow: inset 14px 0 14px -12px rgba(0, 0, 0, 0.85);
}
html.dark-mode .announce-result__group-tabs-wrap::after {
  box-shadow: inset -14px 0 14px -12px rgba(0, 0, 0, 0.85);
}
.announce-result__group-tabs-wrap--fade-start::before { opacity: 1; }
.announce-result__group-tabs-wrap--fade-end::after { opacity: 1; }
.announce-result__group-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  /* Edge-to-edge rail; the first/last pill inset (and snap padding)
     align the strip with the content's 16px inset. */
  padding: 10px 16px;
  scroll-padding-inline: 16px;
  /* Scroll the pills sideways instead of wrapping to a second row when
     there are many brackets/pools. */
  overflow-x: auto;
  scrollbar-width: none;
}
.announce-result__group-tabs::-webkit-scrollbar { display: none; }
.announce-result__group-tab {
  appearance: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  flex: 0 0 auto;
  padding: 0 16px;
  min-height: 36px;
  background: var(--white);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  cursor: pointer;
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}
.announce-result__group-tab:hover:not(.announce-result__group-tab--active) {
  background: rgba(45, 140, 240, 0.06);
}
.announce-result__group-tab--active {
  background: var(--primary, #2d8cf0);
  border-color: var(--primary, #2d8cf0);
  color: var(--white, #ffffff);
}
html.dark-mode .announce-result__group-tab {
  background: var(--surface-card);
}
html.dark-mode .announce-result__group-tab--active {
  background: var(--surface-card);
  border-color: var(--primary);
  color: var(--primary);
}
.announce-result__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Equal inset on all sides (the rail above is edge-to-edge). */
  padding: 16px;
}
/* Tab status dot — the unit's bracket-state tone (shared palette), shown
   for every unit. Its colour is fixed by the tone and does NOT change on
   the active tab. */
.announce-result__tab-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--secondary);
}
.announce-result__tab-dot[data-tone='neutral'] { background: var(--secondary); }
.announce-result__tab-dot[data-tone='warning'] { background: #d69e2e; }
.announce-result__tab-dot[data-tone='success'] { background: #22a06b; }
.announce-result__tab-dot[data-tone='primary'] { background: var(--primary, #2d8cf0); }
.announce-result__tab-dot[data-tone='danger'] { background: var(--danger, #e5484d); }
/* Unit meta — play-status chip + team count. */
.announce-result__unit-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
/* Play status — a toned pill. Tints follow the shared bracket-state
   palette (src/lib/bracketStatus.ts): pending=neutral, initiated=warning,
   in_progress=success, complete=primary, cancelled=danger. */
.announce-result__status-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: #eef2f7;
  color: #5f7186;
}
.announce-result__status-pill[data-tone='neutral'] { background: #eef2f7; color: #5f7186; }
.announce-result__status-pill[data-tone='warning'] { background: var(--light-warning); color: #8c6500; }
.announce-result__status-pill[data-tone='success'] { background: var(--success-light); color: #16763a; }
.announce-result__status-pill[data-tone='primary'] { background: var(--primary-light-3); color: var(--primary); }
.announce-result__status-pill[data-tone='danger'] { background: var(--danger-light); color: #aa2b37; }
html.dark-mode .announce-result__status-pill[data-tone='neutral'] { background: rgba(255, 255, 255, 0.06); color: var(--secondary); }
html.dark-mode .announce-result__status-pill[data-tone='warning'] { color: #f7a120; }
html.dark-mode .announce-result__status-pill[data-tone='success'] { color: #7ad48a; }
html.dark-mode .announce-result__status-pill[data-tone='primary'] { color: #7fb0e8; }
html.dark-mode .announce-result__status-pill[data-tone='danger'] { color: var(--highlight, #ff6b78); }
.announce-result__unit-count {
  font-size: 12px;
  color: var(--secondary);
}
/* Auto (read-only) bracket podium. */
.announce-result__auto-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.announce-result__auto-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text);
}
/* Rank cell — fixed width so the trophy / 2nd / 3rd badges line up and the
   avatars below them share a left edge. */
.announce-result__auto-rank {
  flex: 0 0 auto;
  width: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
}
.announce-result__auto-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.announce-result__auto-team {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.announce-result__auto-meta {
  min-width: 0;
  font-size: 11px;
  color: var(--secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Champion row — larger avatar + bolder name. */
.announce-result__auto-row--champion .announce-result__auto-team {
  font-size: 14px;
  font-weight: 700;
}
.announce-result__hint {
  margin: 0;
  font-size: 12px;
  color: var(--secondary);
  line-height: 1.45;
}
.announce-result__cancel-bracket {
  align-self: flex-start;
}
/* Action row for an in-progress bracket: Announce result + Cancel bracket. */
.announce-result__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
/* "Cancel bracket instead" under the pickers — a quiet escape hatch. */
.announce-result__cancel-inline {
  align-self: flex-start;
  margin-top: 4px;
}
.announce-result__group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.announce-result__group-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--secondary);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Head toggle (No result) — shared `.toggle-switch` chrome, pinned to
   the right of the group head with a compact label. */
.announce-result__head-toggle {
  justify-content: space-between;
  width: 100%;
}
.announce-result__head-toggle .toggle-switch__label {
  font-size: 14px;
  font-weight: 400;
  color: var(--text);
}
/* Row toggle (Co-champions) — full-width row beneath the head. */
.announce-result__row-toggle {
  justify-content: space-between;
  width: 100%;
}
.announce-result__row-toggle .toggle-switch__label {
  font-size: 14px;
  font-weight: 400;
  color: var(--text);
}
.announce-result__row {
  display: grid;
  /* Fixed rank cell (trophy / 2nd / 3rd badge) so the team dropdowns
     line up across rows; the dropdown flexes to fill the rest. */
  grid-template-columns: 36px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}
/* Rank badge (2nd / 3rd) + champion trophy (1st) — same treatment as
   the division-detail Winners panel. */
.announce-result__rank {
  justify-self: start;
  min-width: 30px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--surface-muted, #eef2f7);
  color: var(--secondary);
}
.announce-result__rank[data-rank='2'] { background: #e7ebf1; color: #5f7186; }
.announce-result__rank[data-rank='3'] { background: #f3e1d2; color: #9a5a2b; }
html.dark-mode .announce-result__rank[data-rank='2'] { background: #2c3340; color: #b6c2d2; }
html.dark-mode .announce-result__rank[data-rank='3'] { background: #43301f; color: #d6a06f; }
/* Champion trophy for 1st — same `cup.svg` as the Winners panel. */
.announce-result__cup {
  justify-self: start;
  min-width: 30px;
  height: 18px;
  background: center / 18px 18px no-repeat url('../assets/cup.svg');
}
.announce-result__pick { min-width: 0; }
.announce-result__empty {
  margin: 0;
  padding: 6px 16px 16px;
  font-size: 13px;
  color: var(--secondary);
}
.announce-result__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-divider);
}
.announce-result__footer .primary-button { background: var(--primary); }
.announce-result__footer .primary-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
