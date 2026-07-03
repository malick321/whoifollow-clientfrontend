import type { BracketCancellation, BracketCancelReasonCode } from '../types'

// MatchGeni Brackets — cancellation mock
// --------------------------------------
// A bracket that can't finish as scheduled (rain / field conditions / time
// curfew / other) is **cancelled** with a tracked reason. A cancelled
// bracket can't produce winners, so the announce flow routes its teams to
// their pool instead (see `matchGeniStandings.buildUnits`).
//
// v1 is mock-only: cancellations live in an in-memory store keyed by
// `${divisionId}:${bracketId}` so they persist for the session. The real
// endpoint (DRAFT, see `matchgeni-division-api-contract.md` §5) flips
// `tournament_brackets.status = 'cancelled'` and records the reason
// (`cancel_reason_code` / `cancel_reason_note` / `cancelled_at` /
// `cancelled_by`).

const SIMULATED_LATENCY_MS = 200

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// `${divisionId}:${bracketId}` → cancellation record.
const STORE = new Map<string, BracketCancellation>()

function key(divisionId: string, bracketId: string): string {
  return `${divisionId}:${bracketId}`
}

/** All cancellations for a division as a `{ [bracketId]: BracketCancellation }`
 *  snapshot — the caller hydrates its reactive state from this. */
export function bracketCancellations(divisionId: string): Record<string, BracketCancellation> {
  const out: Record<string, BracketCancellation> = {}
  const prefix = `${divisionId}:`
  for (const [k, v] of STORE) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
  }
  return out
}

/** Cancel a bracket (rain / other). Persists the reason for the session. */
export async function cancelBracket(
  divisionId: string,
  bracketId: string,
  reason: { reasonCode: BracketCancelReasonCode; note?: string }
): Promise<BracketCancellation> {
  const record: BracketCancellation = {
    reasonCode: reason.reasonCode,
    note: reason.note?.trim() || undefined,
    // Stamped by the backend in production; omitted in the mock to keep the
    // module pure (no Date.now()).
    cancelledAt: undefined,
    cancelledBy: undefined
  }
  STORE.set(key(divisionId, bracketId), record)
  return delay(record)
}

/** Un-cancel a bracket (re-open) — optional helper / undo. */
export async function clearBracketCancellation(
  divisionId: string,
  bracketId: string
): Promise<void> {
  STORE.delete(key(divisionId, bracketId))
  return delay(undefined)
}
