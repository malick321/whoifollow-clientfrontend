// Association Reports API
// ------------------------
// Wired client for the association-portal Reports endpoints. One
// report ships in v1 — the per-event Event Summary, which prints
// game-by-game scores for an event grouped by division then game
// start time then game type (pool play before bracket).
//
// Contract: `docs/api/reports-api-contract.md`. The backend pre-
// sorts rows by (division asc, date+time asc, game_type asc with
// pool < bracket). The frontend re-asserts the sort defensively so
// a misordered payload still renders correctly.

import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type { EventSummaryReportRow, ReportGameType } from '../types'

// Mock-first (like the rest of the portal) — flip to true + wire the live
// branch once `GET /v2/reports/event/games-summary/{eventId}` is deployed.
// Until then the live call would 401 in the mock environment and the error
// interceptor would log the user out.
const REPORTS_LIVE = false

const SIMULATED_LATENCY_MS = 300

function delay<T>(value: T, ms = SIMULATED_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** Deterministic demo report for any event id — two divisions, pool play then
 *  bracket, a mix of completed (scored) and upcoming (null score) games. */
function buildMockReport(eventId: string): EventSummaryReportRow[] {
  const seedNum = Number(String(eventId).replace(/\D/g, '')) || 1
  const s = (n: number) => (seedNum * 7 + n * 3) % 13 // small pseudo score
  const date = '2026-04-18'
  return [
    {
      id: `${eventId}-r1`, divisionName: "Men's 50 Major+", gameName: 'Pool A · Game 1',
      gameDate: date, gameTime: '08:00:00', gameType: 'pool' as ReportGameType,
      team1RegNo: '4821', team1Name: 'Action Jackson', team1Score: s(1), team1HR: 2,
      team2RegNo: '5104', team2Name: 'River Bandits', team2Score: s(2), team2HR: 1
    },
    {
      id: `${eventId}-r2`, divisionName: "Men's 50 Major+", gameName: 'Pool A · Game 2',
      gameDate: date, gameTime: '09:30:00', gameType: 'pool' as ReportGameType,
      team1RegNo: '4990', team1Name: 'Boomerangs', team1Score: s(3), team1HR: 0,
      team2RegNo: '4821', team2Name: 'Action Jackson', team2Score: s(4), team2HR: 3
    },
    {
      id: `${eventId}-r3`, divisionName: "Men's 50 Major+", gameName: 'Bracket · Semifinal',
      gameDate: date, gameTime: '13:00:00', gameType: 'bracket' as ReportGameType,
      team1RegNo: '4821', team1Name: 'Action Jackson', team1Score: null, team1HR: null,
      team2RegNo: '4990', team2Name: 'Boomerangs', team2Score: null, team2HR: null
    },
    {
      id: `${eventId}-r4`, divisionName: "Men's 60 AAA", gameName: 'Pool B · Game 1',
      gameDate: date, gameTime: '08:00:00', gameType: 'pool' as ReportGameType,
      team1RegNo: '7012', team1Name: 'Silver Foxes', team1Score: s(5), team1HR: 1,
      team2RegNo: '7340', team2Name: 'Diamond Kings', team2Score: s(6), team2HR: 2
    },
    {
      id: `${eventId}-r5`, divisionName: "Men's 60 AAA", gameName: 'Bracket · Final',
      gameDate: date, gameTime: '14:30:00', gameType: 'bracket' as ReportGameType,
      team1RegNo: '7012', team1Name: 'Silver Foxes', team1Score: null, team1HR: null,
      team2RegNo: '7340', team2Name: 'Diamond Kings', team2Score: null, team2HR: null
    }
  ]
}

/** Standard v2 envelope. */
interface ResponseEnvelope<T> {
  responseStatus: { statusCode: number; message?: string; text?: string }
  data: T
}

/** Typed error for the wired report endpoints. `.code` carries the
 *  HTTP status so callers can branch on 401 / 403 / 404 / 409. */
export class ReportsApiError extends Error {
  code: number
  data: unknown
  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/** Internal fetch helper. Same shape used in associationUsers /
 *  events / eventOfficials / officialEvents. */
async function fetchEnvelope<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    const hasJsonBody = init.body !== undefined
    response = await fetch(buildV2ApiUrl(path), {
      ...init,
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json',
        ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {})
      }
    })
  } catch (networkErr) {
    throw new ReportsApiError(
      0,
      networkErr instanceof Error ? networkErr.message : 'Network request failed.'
    )
  }

  let body: ResponseEnvelope<T> | { responseStatus?: { message?: string } } | null = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body && 'responseStatus' in body && body.responseStatus?.message?.trim()
        ? body.responseStatus.message.trim()
        : `Request failed with status ${response.status}.`
    await interceptApiError(response.status, body)
    throw new ReportsApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new ReportsApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

/** Game-type sort precedence — `pool` rows come first, `bracket`
 *  second. Stable within the same bucket so the source order is
 *  preserved for identical date/time ties. Used by the defensive
 *  client-side re-sort (the backend pre-sorts but we don't trust
 *  it blindly). */
function gameTypeRank(t: ReportGameType): number {
  return t === 'pool' ? 0 : 1
}

/** Re-assert the contract's sort order on the rows the backend
 *  returned. The contract says rows are pre-sorted by (division
 *  → date+time → game type with pool < bracket → game name); the
 *  frontend re-applies the same ordering so a misordered payload
 *  still renders correctly. */
function sortRows(rows: EventSummaryReportRow[]): EventSummaryReportRow[] {
  return [...rows].sort((a, b) => {
    const div = a.divisionName.localeCompare(b.divisionName)
    if (div !== 0) return div
    const ad = `${a.gameDate}T${a.gameTime}`
    const bd = `${b.gameDate}T${b.gameTime}`
    if (ad < bd) return -1
    if (ad > bd) return 1
    const typeRank = gameTypeRank(a.gameType) - gameTypeRank(b.gameType)
    if (typeRank !== 0) return typeRank
    return a.gameName.localeCompare(b.gameName)
  })
}

/**
 * `GET /v2/reports/event/games-summary/{eventId}`
 * — return the Event Summary report rows for the supplied event.
 *
 * Per the contract (`docs/api/reports-api-contract.md` §1):
 *   - Path parameter is just `eventId` (the backend resolves the
 *     owning association from `team_events.owner_type` +
 *     `owner_linked_id` for the `manage_reports` permission gate).
 *   - No query parameters in v1.
 *   - Response data is a flat `EventSummaryReportRow[]`, server-
 *     sorted; we re-assert the sort client-side defensively.
 *   - Error codes: 403 (no `manage_reports`), 404 (event missing /
 *     soft-deleted), 409 (event is team-owned).
 *
 * Callers used to pass `associationId` from the days when the
 * endpoint sat under `/v2/association/reports/{associationId}/…`.
 * It's now ignored (path only carries `eventId`) but kept on the
 * signature for backward compatibility with the existing view —
 * dropping the param would be a noisier refactor for zero gain.
 */
export async function fetchEventSummaryReport(
  associationId: string,
  eventId: string
): Promise<EventSummaryReportRow[]> {
  void associationId // endpoint no longer keys on associationId
  if (!eventId) return []
  if (!REPORTS_LIVE) {
    return delay(sortRows(buildMockReport(eventId)))
  }
  const path = `/reports/event/games-summary/${encodeURIComponent(eventId)}`
  const rows = await fetchEnvelope<EventSummaryReportRow[]>(path)
  return sortRows(rows)
}
