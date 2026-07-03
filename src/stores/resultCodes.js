import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from '../api/config'

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

    // Already loaded — skip
    if (codesBySport.value[key]) return
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
    const codes = codesBySport.value[String(sportTypeId)]
    if (!codes) return []

    return Object.values(codes)
      .filter(c => {
        if (c.category !== category) return false
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
    return codesBySport.value[String(sportTypeId)]?.[code]?.label ?? code
  }

  /**
   * Full code object — useful to read attributes_json.
   */
  function get(sportTypeId, code) {
    return codesBySport.value[String(sportTypeId)]?.[code] ?? null
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
    const codes = codesBySport.value[String(sportTypeId)]
    if (!codes) return []
    const seen = new Set()
    return Object.values(codes)
      .sort((a, b) => a.display_order - b.display_order)
      .reduce((acc, c) => {
        if (!seen.has(c.category)) { seen.add(c.category); acc.push(c.category) }
        return acc
      }, [])
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
