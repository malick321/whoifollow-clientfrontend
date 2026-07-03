import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from '../api/config'

const fallbackResultCodesBySport = {
  '1': [
    { code: '1B', label: 'Single', category: 'hit', display_order: 10, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, is_hit: true, counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: '2B', label: 'Double', category: 'hit', display_order: 20, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 2, is_hit: true, counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: '3B', label: 'Triple', category: 'hit', display_order: 30, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 3, is_hit: true, counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'HR', label: 'Home Run', category: 'hit', display_order: 40, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 4, is_hit: true, counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'GRH', label: 'Ground Rule Home Run', category: 'hit', display_order: 50, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 4, is_hit: true, counts_as_at_bat: true, counts_as_plate_appearance: true } },

    { code: 'K', label: 'Strikeout', category: 'out', display_order: 110, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'KC', label: 'Called Strikeout', category: 'out', display_order: 120, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'GO', label: 'Ground Out', category: 'out', display_order: 130, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'FO', label: 'Fly Out', category: 'out', display_order: 140, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'LO', label: 'Line Out', category: 'out', display_order: 150, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'PO', label: 'Pop Out', category: 'out', display_order: 160, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'SAC', label: 'Sacrifice', category: 'out', display_order: 170, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: false, counts_as_plate_appearance: true } },
    { code: 'SF', label: 'Sacrifice Fly', category: 'out', display_order: 180, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: false, counts_as_plate_appearance: true } },
    { code: 'GDP', label: 'Grounded Into Double Play', category: 'out', display_order: 190, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: true, counts_as_plate_appearance: true } },

    { code: 'BB', label: 'Walk', category: 'on_base', display_order: 210, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, counts_as_at_bat: false, counts_as_plate_appearance: true } },
    { code: 'IBB', label: 'Intentional Walk', category: 'on_base', display_order: 220, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, counts_as_at_bat: false, counts_as_plate_appearance: true } },
    { code: 'HBP', label: 'Hit By Pitch', category: 'on_base', display_order: 230, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, counts_as_at_bat: false, counts_as_plate_appearance: true } },
    { code: 'E', label: 'Reached on Error', category: 'on_base', display_order: 240, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'FC', label: 'Fielder Choice', category: 'on_base', display_order: 250, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, counts_as_at_bat: true, counts_as_plate_appearance: true } },
    { code: 'CI', label: 'Catcher Interference', category: 'on_base', display_order: 260, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { bases_awarded: 1, counts_as_at_bat: false, counts_as_plate_appearance: true } },

    { code: 'SB', label: 'Stolen Base', category: 'baserunning', display_order: 310, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { counts_as_at_bat: false, counts_as_plate_appearance: false } },
    { code: 'CS', label: 'Caught Stealing', category: 'baserunning', display_order: 320, is_active: true, advances_position: 0, ends_turn: 1, is_defensive_out: true, attributes_json: { counts_as_at_bat: false, counts_as_plate_appearance: false } },
    { code: 'PB', label: 'Passed Ball', category: 'baserunning', display_order: 330, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { counts_as_at_bat: false, counts_as_plate_appearance: false } },
    { code: 'WP', label: 'Wild Pitch', category: 'baserunning', display_order: 340, is_active: true, advances_position: 1, ends_turn: 0, attributes_json: { counts_as_at_bat: false, counts_as_plate_appearance: false } },
  ],
}

function buildFallbackIndex(key) {
  const fallbackCodes = fallbackResultCodesBySport[key] ?? []
  return Object.fromEntries(fallbackCodes.map(code => [code.code, code]))
}

/**
 * Sport Result Codes Store
 *
 * Single source of truth for all result codes across every sport.
 * Loaded once per sport on first access, then cached for the session.
 *
 * Usage:
 *   const store = useResultCodesStore()
 *   await store.load(sportTypeId, gameVariant)
 *   store.byCategory(sportTypeId, 'hit')
 *   store.label(sportTypeId, '1B')  // → 'Single'
 */
export const useResultCodesStore = defineStore('resultCodes', () => {
  // State — keyed by sportTypeId for multi-sport support
  const codesBySport = ref({})
  const loading = ref({})
  const errors = ref({})

  // ─── Actions ────────────────────────────────────────────────────────────────

  /**
   * Load result codes for a given sport + variant.
   * Safe to call multiple times — only fetches once per sportTypeId.
   *
   * @param {number} sportTypeId
   * @param {string|null} gameVariant  e.g. 'fast_pitch' | 'slow_pitch' | null
   */
  async function load(sportTypeId, gameVariant = null) {
    const key = String(sportTypeId)
    const existingCodes = codesBySport.value[key]

    // Already loaded — skip
    if (existingCodes && Object.keys(existingCodes).length > 0) return
    // In-flight — skip
    if (loading.value[key]) return

    loading.value[key] = true
    errors.value[key] = null

    try {
      const params = {}
      if (gameVariant) params.game_variant = gameVariant

      const { data } = await axios.get(
        buildV2ApiUrl(`/sports/${sportTypeId}/result-codes`),
        { params, headers: getAuthHeaders() }
      )

      // Index by code for O(1) lookups
      codesBySport.value[key] = Object.fromEntries(
        data.data.map(code => [code.code, code])
      )
    } catch (err) {
      errors.value[key] = err?.response?.data?.message ?? 'Failed to load result codes'
      const fallbackIndex = buildFallbackIndex(key)
      if (Object.keys(fallbackIndex).length > 0) {
        codesBySport.value[key] = fallbackIndex
      }
    } finally {
      loading.value[key] = false
    }
  }

  /**
   * Force a reload — useful after admin updates result codes.
   */
  function invalidate(sportTypeId) {
    const key = String(sportTypeId)
    delete codesBySport.value[key]
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  /**
   * Get codes for a sport grouped by category, sorted by display_order.
   * Optionally filter out fast_pitch_only codes for slow pitch games.
   *
   * @param {number}      sportTypeId
   * @param {string}      category      'hit' | 'out' | 'on_base' | 'baserunning'
   * @param {string|null} gameVariant
   * @returns {Array}
   */
  function byCategory(sportTypeId, category, gameVariant = null) {
    const key = String(sportTypeId)
    const codes = codesBySport.value[key] && Object.keys(codesBySport.value[key]).length > 0
      ? codesBySport.value[key]
      : buildFallbackIndex(key)
    if (!codes) return []
    const normalizedCategory = normalizeCategory(category)

    return Object.values(codes)
      .filter(c => {
        if (normalizeCategory(c.category) !== normalizedCategory) return false
        if (!c.is_active) return false
        // Exclude fast-pitch-only codes for slow pitch
        if (gameVariant === 'slow_pitch' && c.attributes_json?.fast_pitch_only) return false
        return true
      })
      .sort((a, b) => a.display_order - b.display_order)
  }

  /**
   * Human-readable label for a code.
   * Falls back to the code itself if not loaded.
   */
  function label(sportTypeId, code) {
    const key = String(sportTypeId)
    const codes = codesBySport.value[key] && Object.keys(codesBySport.value[key]).length > 0
      ? codesBySport.value[key]
      : buildFallbackIndex(key)
    return codes?.[code]?.label ?? code
  }

  /**
   * Full code object — useful to read attributes_json.
   */
  function get(sportTypeId, code) {
    const key = String(sportTypeId)
    const codes = codesBySport.value[key] && Object.keys(codesBySport.value[key]).length > 0
      ? codesBySport.value[key]
      : buildFallbackIndex(key)
    return codes?.[code] ?? null
  }

  /**
   * Whether a code counts as an official at-bat.
   */
  function countsAsAtBat(sportTypeId, code) {
    return get(sportTypeId, code)?.attributes_json?.counts_as_at_bat ?? true
  }

  /**
   * Whether a code counts as a plate appearance.
   */
  function countsAsPlateAppearance(sportTypeId, code) {
    return get(sportTypeId, code)?.attributes_json?.counts_as_plate_appearance ?? true
  }

  /**
   * Whether the batter reached base on this code.
   */
  function isOnBase(sportTypeId, code) {
    return get(sportTypeId, code)?.advances_position === 1
  }

  /**
   * Whether this code records a hit.
   */
  function isHit(sportTypeId, code) {
    return get(sportTypeId, code)?.attributes_json?.is_hit ?? false
  }

  /**
   * All categories available for a sport (in a stable order).
   */
  function categories(sportTypeId) {
    const key = String(sportTypeId)
    const codes = codesBySport.value[key] && Object.keys(codesBySport.value[key]).length > 0
      ? codesBySport.value[key]
      : buildFallbackIndex(key)
    if (!codes) return []
    const seen = new Set()
    const preferredOrder = ['hit', 'out', 'on_base', 'baserunning']
    return Object.values(codes)
      .sort((a, b) => a.display_order - b.display_order)
      .reduce((acc, c) => {
        const normalized = normalizeCategory(c.category)
        if (!seen.has(normalized)) { seen.add(normalized); acc.push(normalized) }
        return acc
      }, [])
      .sort((left, right) => {
        const leftIndex = preferredOrder.indexOf(left)
        const rightIndex = preferredOrder.indexOf(right)
        if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right)
        if (leftIndex === -1) return 1
        if (rightIndex === -1) return -1
        return leftIndex - rightIndex
      })
  }

  const isLoading = computed(() => (sportTypeId) => !!loading.value[String(sportTypeId)])
  const hasError  = computed(() => (sportTypeId) => !!errors.value[String(sportTypeId)])
  const errorMsg  = computed(() => (sportTypeId) => errors.value[String(sportTypeId)] ?? null)

  return {
    // State
    codesBySport,
    // Actions
    load,
    invalidate,
    // Getters
    byCategory,
    label,
    get,
    countsAsAtBat,
    countsAsPlateAppearance,
    isOnBase,
    isHit,
    categories,
    isLoading,
    hasError,
    errorMsg,
  }
})
  function normalizeCategory(category) {
    const value = String(category ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (value === 'hit' || value === 'hits') return 'hit'
    if (value === 'out' || value === 'outs') return 'out'
    if (value === 'on_base' || value === 'onbase' || value === 'reached_base') return 'on_base'
    if (value === 'baserunning' || value === 'base_running' || value === 'basepath') return 'baserunning'
    return value
  }
