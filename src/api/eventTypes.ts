// eventTypes
// ----------
// Active event-type names used by the New Game Time → My Events "Type" filter.
//
// These are a fixed, rarely-changing reference list (the backend's
// `config('eventTypes.eventTypes')` active entries), so they're hardcoded here
// rather than fetched — avoids an extra (auth-gated) round trip on every My
// Events load. Mirrors the backend's active set: status === 1 in
// config/eventTypes.php (Birthday Party / Olympics are inactive and omitted).
// The events `eventType` column stores these names verbatim.

/** The active event-type names, in display order. */
export const EVENT_TYPES = ['League', 'Online Meeting', 'Other', 'Tournament'] as const

/** Returns the active event-type names. Kept async + named `fetchEventTypes`
 *  so callers don't change if this ever moves back to a live lookup. */
export async function fetchEventTypes(): Promise<string[]> {
  return [...EVENT_TYPES]
}
