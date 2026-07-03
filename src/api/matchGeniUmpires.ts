import type {
  AddEventUmpirePayload,
  AssociationUmpire,
  EventUmpire,
  EventUmpiresListParams,
  GameUmpireAssignment
} from '../types'

// MatchGeni Event Umpires API (mock)
// ----------------------------------
// Backs the Event Umpires roster page. v1 ships without a real
// backend, so these return deterministic mock data after a short
// delay. Future endpoints:
//
//   - fetchEventUmpires      → GET    /…/{eventId}/umpires
//   - addEventUmpire         → POST   /…/{eventId}/umpires
//   - removeEventUmpire      → DELETE /…/{eventId}/umpires/{umpireId}
//   - fetchAssociationUmpires→ GET    /…/{associationId}/umpires  (the
//        association's REGISTERED umpire pool — the "Add Umpire" picker
//        draws from this, NOT the general association-users list)
//
// Umpires are a flat per-event roster (no permissions / scoping like
// officials). `gamesAssigned` is a compute-on-read count of
// `tournament_games.umpire_id` matches. Swapping mock → real is a
// body-only change here; the page consumes the typed shapes as-is.

const SIMULATED_LATENCY_MS = 240

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

export interface EventUmpiresPage {
  data: EventUmpire[]
  total: number
}

const MOCK_NAMES = [
  'James Carter', 'Maria Lopez', 'David Chen', 'Sarah Johnson',
  'Robert Wells', 'Linda Park', 'Michael Reyes', 'Karen Doyle',
  'Anthony Brooks', 'Patricia Nunez'
]

// ── Association umpire registry (the pool to add from) ───────────
const ASSOC_UMPIRES_BY_ASSOC: Record<string, AssociationUmpire[]> = {}

function seedAssociationUmpires(associationId: string): AssociationUmpire[] {
  const key = associationId || 'assoc'
  if (!ASSOC_UMPIRES_BY_ASSOC[key]) {
    ASSOC_UMPIRES_BY_ASSOC[key] = MOCK_NAMES.map((name, idx) => {
      const handle = name.toLowerCase().replace(/[^a-z]+/g, '.')
      return {
        id: `${key}-aump-${idx}`,
        name,
        email: `${handle}@umpires.example`,
        avatarUrl: '',
        phone: idx % 2 === 0 ? `(555) 0${idx}0-12${idx}${idx}` : undefined
      }
    })
  }
  return ASSOC_UMPIRES_BY_ASSOC[key]
}

// ── Per-event roster (references registry ids) ───────────────────
const MOCK_UMPIRES_BY_EVENT: Record<string, EventUmpire[]> = {}

function seedEventUmpires(associationId: string, eventId: string): EventUmpire[] {
  if (!MOCK_UMPIRES_BY_EVENT[eventId]) {
    const registry = seedAssociationUmpires(associationId)
    // Start the roster with the first few registered umpires so the
    // "Add Umpire" picker (registry minus roster) still has options.
    MOCK_UMPIRES_BY_EVENT[eventId] = registry.slice(0, 5).map((r, idx) => ({
      id: `${eventId}-ump-${idx}`,
      eventId,
      // Links the roster row to its association-registry record so the
      // picker can exclude already-added umpires.
      associationUserId: r.id,
      userId: r.id,
      name: r.name,
      email: r.email,
      avatarUrl: r.avatarUrl,
      phone: r.phone,
      gamesAssigned: (idx * 3) % 11,
      createdAt: new Date(Date.now() - idx * 86_400_000).toISOString()
    }))
  }
  return MOCK_UMPIRES_BY_EVENT[eventId]
}

/** List the association's registered umpires (the "Add Umpire" pool). */
export async function fetchAssociationUmpires(
  associationId: string,
  params: { search?: string } = {}
): Promise<AssociationUmpire[]> {
  let rows = seedAssociationUmpires(associationId).map((u) => ({ ...u }))
  const q = params.search?.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return delay(rows)
}

/** List the event's umpire roster (optionally filtered by `search`). */
export async function fetchEventUmpires(
  associationId: string,
  eventId: string,
  params: EventUmpiresListParams = {}
): Promise<EventUmpiresPage> {
  let rows = seedEventUmpires(associationId, eventId).map((u) => ({ ...u }))
  const q = params.search?.trim().toLowerCase()
  if (q) {
    rows = rows.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    )
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return delay({ data: rows, total: rows.length })
}

/** Add a registered association umpire to the event's roster. */
export async function addEventUmpire(
  associationId: string,
  eventId: string,
  payload: AddEventUmpirePayload
): Promise<EventUmpire> {
  const list = seedEventUmpires(associationId, eventId)
  const umpire: EventUmpire = {
    id: `${eventId}-ump-${Date.now()}`,
    eventId,
    associationUserId: payload.associationUserId,
    userId: payload.associationUserId,
    name: payload.name,
    email: payload.email,
    avatarUrl: payload.avatarUrl ?? '',
    phone: payload.phone,
    gamesAssigned: 0,
    createdAt: new Date().toISOString()
  }
  list.unshift(umpire)
  return delay({ ...umpire })
}

// ── Game → umpire crew assignments ───────────────────────────────
// Maps a scheduled game id to its umpire crew — a list of
// { role, umpireId } (the future `tournament_game_umpires` junction).
// A game can carry several umpires (plate + base umpires). v1 keeps
// this in-memory per event.
const ASSIGNMENTS_BY_EVENT: Record<string, Record<string, GameUmpireAssignment[]>> = {}

function eventAssignments(eventId: string): Record<string, GameUmpireAssignment[]> {
  return ASSIGNMENTS_BY_EVENT[eventId] ?? (ASSIGNMENTS_BY_EVENT[eventId] = {})
}

/** Fetch the event's game→crew map ({ [gameId]: GameUmpireAssignment[] }). */
export async function fetchGameUmpireAssignments(
  _associationId: string,
  eventId: string
): Promise<Record<string, GameUmpireAssignment[]>> {
  const src = ASSIGNMENTS_BY_EVENT[eventId] ?? {}
  const out: Record<string, GameUmpireAssignment[]> = {}
  for (const gameId of Object.keys(src)) out[gameId] = src[gameId].map((a) => ({ ...a }))
  return delay(out)
}

/** Replace a game's full umpire crew. `[]` clears it. */
export async function setGameUmpires(
  _associationId: string,
  eventId: string,
  gameId: string,
  crew: GameUmpireAssignment[]
): Promise<void> {
  const map = eventAssignments(eventId)
  if (crew.length > 0) map[gameId] = crew.map((a) => ({ ...a }))
  else delete map[gameId]
  return delay(undefined)
}

/** Remove an umpire from the event's roster. */
export async function removeEventUmpire(
  _associationId: string,
  eventId: string,
  umpireId: string
): Promise<void> {
  const list = MOCK_UMPIRES_BY_EVENT[eventId]
  if (list) {
    const idx = list.findIndex((u) => u.id === umpireId)
    if (idx !== -1) list.splice(idx, 1)
  }
  // Strip the removed umpire from every game crew (and drop now-empty
  // crews).
  const map = ASSIGNMENTS_BY_EVENT[eventId]
  if (map) {
    for (const gameId of Object.keys(map)) {
      map[gameId] = map[gameId].filter((a) => a.umpireId !== umpireId)
      if (map[gameId].length === 0) delete map[gameId]
    }
  }
  return delay(undefined)
}
