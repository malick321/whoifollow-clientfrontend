// Hero images for the mock event rows. The real backend stores a
// filename in `team_events.avatar` and serves it via the CDN — we
// import the local assets here so the mock layer can hand back
// fully-qualified URLs the way the production serializer would.
import event1Image from '../assets/events/1.png'
import event2Image from '../assets/events/2.png'
import event3Image from '../assets/events/3.png'
import event4Image from '../assets/events/4.jpg'
import event5Image from '../assets/events/5.png'
import event6Image from '../assets/events/6.png'

import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'
import { interceptApiError } from './api-error-interceptor'
import type {
  BracketFormatOption,
  Event,
  EventListParams,
  EventPartialPaymentType,
  EventPaymentTerms,
  EventRegistrationStatus,
  EventResources,
  EventResourceBucket,
  EventResourcesSelection,
  EventStatus,
  EventSummary,
  EventTeamCounts,
  EventTimezoneOption,
  EventType,
  EventYearsResponse,
  LaravelPaginator,
  SaveEventPayload,
  SportsTypeOption
} from '../types'

/** Zero-filled participation breakdown — used for fresh creates and
 *  as the default when a mock seed doesn't override the counts. */
function zeroCounts(): EventTeamCounts {
  return { pending: 0, confirmed: 0, waitlisted: 0, withdrawn: 0 }
}

/**
 * Frontend-only mock API for the association-managed events. v1
 * ships without a real backend — every function below resolves
 * with mock data after a short delay so the UI feels asynchronous.
 *
 * Wire shape matches `docs/api/association-events-api-contract.md`
 * field-for-field so swapping mock → real HTTP later is a per-
 * function body replacement. The shapes returned here mirror the
 * post-interceptor surface (the production axios interceptor strips
 * the `{ responseStatus, data }` envelope on success).
 */

const SIMULATED_LATENCY_MS = 320

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

/** Standard v2 response envelope — every `/v2` endpoint wraps its
 *  payload in `{ responseStatus, data }` per `docs/api/conventions.md`. */
interface ResponseEnvelope<T> {
  responseStatus: {
    statusCode: number
    message?: string
    text?: string
  }
  data: T
}

/** Error thrown by the wired endpoints. `.code` carries the HTTP
 *  status so callers can branch (401 → re-auth bounce, 403 / 404 →
 *  not-found, 409 → conflict copy, etc.). Network failure → `.code = 0`. */
export class EventsApiError extends Error {
  code: number
  data: unknown
  constructor(code: number, message: string, data: unknown = null) {
    super(message)
    this.code = code
    this.data = data
  }
}

/** Internal fetch helper used by the wired endpoints below. Attaches
 *  bearer token, JSON content-type when the call carries a body,
 *  unwraps the response envelope, and maps non-2xx → typed error. */
async function fetchEnvelope<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    // FormData (multipart) must NOT get a JSON Content-Type — the browser
    // sets `multipart/form-data; boundary=…` itself.
    const hasJsonBody = init.body !== undefined && !(init.body instanceof FormData)
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
    throw new EventsApiError(
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
    // 401 / 403 cross-cutting recovery — see `api-error-interceptor.ts`.
    await interceptApiError(response.status, body)
    throw new EventsApiError(response.status, message, body)
  }

  if (!body || !('data' in body)) {
    throw new EventsApiError(
      response.status,
      'Malformed response — missing "data" envelope field.'
    )
  }

  return (body as ResponseEnvelope<T>).data
}

function mockGuid(seed: number): string {
  const hex = (n: number, width: number) => n.toString(16).padStart(width, '0')
  return [
    hex(seed * 17 + 0x10000, 8),
    hex((seed * 31) & 0xffff, 4),
    hex((seed * 47) & 0xffff, 4),
    hex((seed * 59) & 0xffff, 4),
    hex(seed * 73 + 0x100000, 12)
  ].join('-')
}

const NOW = new Date()
function isoDate(daysFromNow: number): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}
function isoDateTime(daysFromNow: number, hour = 8): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

/** Static sports-type catalogue. Real backend joins from
 *  `team_sports_types`; the mock layer surfaces the same shape so
 *  the swap is a no-op for consumers. */
export const SPORTS_TYPE_CATALOGUE: SportsTypeOption[] = [
  { id: '1', name: 'Softball - Slow Pitch' },
  { id: '2', name: 'Softball - Fast Pitch' },
  { id: '3', name: 'Baseball' },
  { id: '4', name: 'Senior Softball' }
]

/** Event-type catalogue — the four canonical values both backend
 *  and frontend agree on. The `key` is what travels on the wire
 *  (in `Event.eventType`, the listing `eventType` filter, and the
 *  create/update payloads); the `label` is the human-readable form
 *  for dropdowns and chips. Order here drives the filter dropdown's
 *  visual order. Documented in `docs/system/shared-catalogues.md` —
 *  add/remove must happen in lockstep with the backend's enum. */
// `online_meeting` is intentionally omitted — in-person/online is now a
// separate toggle, so it's no longer a selectable event TYPE. The key stays
// in the `EventType` union + label resolver so legacy events that still
// carry it keep rendering.
export const EVENT_TYPES_CATALOGUE: { key: EventType; label: string }[] = [
  { key: 'tournament', label: 'Tournament' },
  { key: 'league', label: 'League' },
  { key: 'other', label: 'Other' }
]

/** Resolve a wire key to its display label. Returns the raw key
 *  capitalised when the key isn't in the catalogue (defensive — the
 *  backend should only ever emit catalogue keys but we don't want a
 *  stray value to blow up the UI). */
export function eventTypeLabel(key: EventType | null | undefined): string {
  if (!key) return ''
  const hit = EVENT_TYPES_CATALOGUE.find((t) => t.key === key)
  return hit?.label ?? key
}

/** Static bracket-format catalogue. Real backend joins from the
 *  bracket-format lookup table. The id is what gets persisted in
 *  `Event.bracketFormatId`; the name is the denormalized snapshot
 *  surfaced in `Event.bracketFormat` for display. */
export const BRACKET_FORMAT_CATALOGUE: BracketFormatOption[] = [
  { id: '1', name: 'Single Elimination' },
  { id: '2', name: 'Double Elimination' },
  { id: '3', name: 'Round Robin' },
  { id: '4', name: 'Pool Play + Bracket' },
  { id: '5', name: 'Open' }
]

/** Static IANA timezone catalogue. US-focused v1 — international
 *  expansion appends entries here. Each entry carries three labels
 *  (form / display / abbreviation) so different UI surfaces pick
 *  the appropriate one. */
export const EVENT_TIMEZONES: EventTimezoneOption[] = [
  { value: 'America/Los_Angeles', formLabel: '(UTC-08:00) Pacific Time',         nameLabel: 'Pacific Time',  shortLabel: 'PST' },
  { value: 'America/Denver',      formLabel: '(UTC-07:00) Mountain Time',        nameLabel: 'Mountain Time', shortLabel: 'MST' },
  { value: 'America/Phoenix',     formLabel: '(UTC-07:00) Arizona Time (no DST)', nameLabel: 'Arizona Time',  shortLabel: 'MST' },
  { value: 'America/Chicago',     formLabel: '(UTC-06:00) Central Time',         nameLabel: 'Central Time',  shortLabel: 'CST' },
  { value: 'America/New_York',    formLabel: '(UTC-05:00) Eastern Time',         nameLabel: 'Eastern Time',  shortLabel: 'EST' },
  { value: 'Pacific/Honolulu',    formLabel: '(UTC-10:00) Hawaii Time',          nameLabel: 'Hawaii Time',   shortLabel: 'HST' }
]

/** Helper — derive timezone labels from an IANA identifier. Used by
 *  the mock layer to populate `dateRangeLabel` / `dateRangeLabelShort`
 *  the same way the backend does on read. */
function timezoneLabels(iana: string): { name: string; short: string } {
  const match = EVENT_TIMEZONES.find((t) => t.value === iana)
  return match
    ? { name: match.nameLabel, short: match.shortLabel }
    : { name: iana, short: iana }
}

/** Format a date string (YYYY-MM-DD) → "Apr 19" / "Apr 19, 2026". */
function fmtMonthDay(date: string, withYear = false): string {
  if (!date) return ''
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', withYear
    ? { month: 'short', day: 'numeric', year: 'numeric' }
    : { month: 'short', day: 'numeric' })
}

/** Compose backend-style `dateRangeLabel` and `dateRangeLabelShort`. */
function buildDateRangeLabels(
  startDate: string | null,
  endDate: string | null,
  timeZone: string
): { dateRangeLabel: string; dateRangeLabelShort: string } {
  if (!startDate) {
    return { dateRangeLabel: '', dateRangeLabelShort: '' }
  }
  const labels = timezoneLabels(timeZone)
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date((endDate || startDate) + 'T00:00:00')
  const sameDay = start.getTime() === end.getTime()
  const sameYear = start.getFullYear() === end.getFullYear()
  let range: string
  if (sameDay) {
    range = fmtMonthDay(startDate, true)
  } else if (sameYear) {
    range = `${fmtMonthDay(startDate)} to ${fmtMonthDay(endDate!, true)}`
  } else {
    range = `${fmtMonthDay(startDate, true)} to ${fmtMonthDay(endDate!, true)}`
  }
  return {
    dateRangeLabel: `${range} (${labels.name})`,
    dateRangeLabelShort: `${range} (${labels.short})`
  }
}

/** Compose `startAtUtc` from local date/time/zone. Real backend uses
 *  MySQL `CONVERT_TZ` via STORED generated columns; mock approximates
 *  with the browser's Date math. Result is ISO-8601 UTC. */
function localToUtc(date: string | null, time: string | null, _tz: string, fallbackTime: string): string {
  if (!date) return ''
  const t = time || fallbackTime
  return `${date}T${t}.000Z`
}

/** Derive `registrationStatus` + the matching label per the
 *  contract. */
function buildRegistrationFields(
  allowTeamRegistration: boolean,
  registrationOpening: string | null,
  entryFeeDeadline: string | null,
  _timeZone: string
): {
  registrationStatus: EventRegistrationStatus
  registrationOpensLabel: string | null
  registrationClosesLabel: string | null
  registrationOpeningUtc: string | null
  entryFeeDeadlineUtc: string | null
} {
  if (!allowTeamRegistration) {
    return {
      registrationStatus: 'not_open',
      registrationOpensLabel: null,
      registrationClosesLabel: null,
      registrationOpeningUtc: null,
      entryFeeDeadlineUtc: null
    }
  }
  const opensMs = registrationOpening ? Date.parse(registrationOpening.replace(' ', 'T') + 'Z') : null
  const closesMs = entryFeeDeadline ? Date.parse(entryFeeDeadline + 'T23:59:59Z') : null
  const nowMs = Date.now()
  let status: EventRegistrationStatus = 'not_open'
  if (opensMs && closesMs) {
    if (nowMs < opensMs) status = 'not_open'
    else if (nowMs > closesMs) status = 'closed'
    else status = 'open'
  }
  return {
    registrationStatus: status,
    registrationOpensLabel: status === 'not_open' && registrationOpening
      ? `Opens ${fmtMonthDay(registrationOpening.slice(0, 10), true)}`
      : null,
    registrationClosesLabel: status === 'open' && entryFeeDeadline
      ? `Closes ${fmtMonthDay(entryFeeDeadline, true)}`
      : null,
    registrationOpeningUtc: registrationOpening
      ? registrationOpening.replace(' ', 'T') + 'Z'
      : null,
    entryFeeDeadlineUtc: entryFeeDeadline
      ? entryFeeDeadline + 'T23:59:59Z'
      : null
  }
}

/** Build a fully-shaped Event row from the seed input. Centralizes
 *  the derived-field computation so the mock layer mirrors the
 *  backend's read shape. */
function makeMockEvent(seed: {
  id: string
  associationId: string
  associationShortName: string
  eventName: string
  eventType: EventType | null
  avatarUrl?: string | null
  startDate: string
  endDate: string
  startTime?: string
  endTime?: string
  timeZone: string
  allDay?: boolean
  city: string
  state: string
  directorName: string
  directorEmail: string
  sportsTypeId: string
  eventStatus: EventStatus
  teamCounts?: EventTeamCounts
  allowTeamRegistration?: boolean
  registrationOpening?: string | null
  entryFeeDeadline?: string | null
  paymentRequired?: boolean
  entryFee?: number | null
  note?: string | null
}): Event {
  const sport = SPORTS_TYPE_CATALOGUE.find((s) => s.id === seed.sportsTypeId)
  const labels = buildDateRangeLabels(seed.startDate, seed.endDate, seed.timeZone)
  const reg = buildRegistrationFields(
    seed.allowTeamRegistration ?? false,
    seed.registrationOpening ?? null,
    seed.entryFeeDeadline ?? null,
    seed.timeZone
  )
  return {
    id: seed.id,
    guid: mockGuid(Number(seed.id)),
    teamId: null,
    associationId: seed.associationId,
    associationShortName: seed.associationShortName,

    eventName: seed.eventName,
    eventType: seed.eventType,
    avatarUrl: seed.avatarUrl ?? null,

    address: null,
    location: null,
    city: seed.city,
    state: seed.state,
    zipCode: null,
    lat: null,
    long: null,

    eventStartDate: seed.startDate,
    eventEndDate: seed.endDate,
    eventStartTime: seed.allDay ? null : (seed.startTime ?? '08:00:00'),
    eventEndTime: seed.allDay ? null : (seed.endTime ?? '20:00:00'),
    timeZone: seed.timeZone,
    allDay: seed.allDay ?? false,

    startAtUtc: localToUtc(seed.startDate, seed.allDay ? null : (seed.startTime ?? '08:00:00'), seed.timeZone, '00:00:00'),
    endAtUtc: localToUtc(seed.endDate, seed.allDay ? null : (seed.endTime ?? '20:00:00'), seed.timeZone, '23:59:59'),
    eventYear: Number(seed.startDate.slice(0, 4)),
    isPast: Date.parse(seed.endDate + 'T23:59:59Z') < Date.now(),
    dateRangeLabel: labels.dateRangeLabel,
    dateRangeLabelShort: labels.dateRangeLabelShort,

    note: seed.note ?? null,
    reminder: null,
    mediumId: null,
    mediumName: null,
    url: null,
    color: null,

    eventStatus: seed.eventStatus,

    directorName: seed.directorName,
    directorEmail: seed.directorEmail,
    directorPhone: null,
    mobCode: null,

    entryFee: seed.entryFee ?? null,
    refundPolicy: null,
    tournamentFormat: null,
    entryFeeDeadline: seed.entryFeeDeadline ?? null,
    entryFeeDeadlineUtc: reg.entryFeeDeadlineUtc,
    poolPlayGuaranteed: null,
    bracketFormatId: null,
    bracketFormat: null,
    poolPlayTime: null,
    championshipTime: null,
    bracketTime: null,
    timeInterval: null,

    sportsTypeId: seed.sportsTypeId,
    sportsTypeName: sport?.name ?? null,

    allowTeamRegistration: seed.allowTeamRegistration ?? false,
    registrationOpening: seed.registrationOpening ?? null,
    registrationOpeningUtc: reg.registrationOpeningUtc,
    registrationStatus: reg.registrationStatus,
    registrationOpensLabel: reg.registrationOpensLabel,
    registrationClosesLabel: reg.registrationClosesLabel,

    paymentRequired: seed.paymentRequired ?? false,
    paymentTerms: seed.paymentRequired ? 'full' : null,
    partialPaymentType: null,
    partialPaymentValue: null,
    allowOfflinePayment: false,
    autoConfirmOnFullPayment: !!seed.paymentRequired,
    autoConfirmOnPartialPayment: false,

    fieldConfigId: null,

    teamCounts: seed.teamCounts ?? zeroCounts(),

    createdAt: isoDateTime(-30),
    updatedAt: isoDateTime(-1),
    createdByUserId: null,
    updatedByUserId: null
  }
}

const mockEvents: Event[] = [
  makeMockEvent({
    id: '2001',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Bart Adams March Madness II',
    eventType: 'tournament',
    avatarUrl: event1Image,
    startDate: isoDate(40),
    endDate: isoDate(42),
    timeZone: 'America/Los_Angeles',
    city: 'Polk County',
    state: 'FL',
    directorName: 'Glen Hennessy',
    directorEmail: 'glen@ssusa.org',
    sportsTypeId: '1',
    eventStatus: 'published',
    teamCounts: { pending: 4, confirmed: 17, waitlisted: 2, withdrawn: 1 },
    allowTeamRegistration: true,
    registrationOpening: isoDate(-20) + ' 09:00:00',
    entryFeeDeadline: isoDate(30),
    paymentRequired: true,
    entryFee: 350,
    note: 'Slow-pitch round robin + double-elimination bracket.'
  }),
  makeMockEvent({
    id: '2002',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: "Spring Classic – Men's 50+",
    eventType: 'tournament',
    avatarUrl: event2Image,
    startDate: isoDate(28),
    endDate: isoDate(30),
    timeZone: 'America/New_York',
    city: 'Orlando',
    state: 'FL',
    directorName: 'Maria Ortega',
    directorEmail: 'maria@ssusa.org',
    sportsTypeId: '4',
    eventStatus: 'published',
    teamCounts: { pending: 6, confirmed: 28, waitlisted: 3, withdrawn: 1 },
    allowTeamRegistration: true,
    registrationOpening: isoDate(-10) + ' 09:00:00',
    entryFeeDeadline: isoDate(20),
    paymentRequired: true,
    entryFee: 425
  }),
  makeMockEvent({
    id: '2003',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Southwest Championship of Pakistan',
    eventType: 'tournament',
    avatarUrl: event3Image,
    startDate: isoDate(70),
    endDate: isoDate(74),
    timeZone: 'America/Los_Angeles',
    city: 'Sacramento',
    state: 'CA',
    directorName: 'David Carrillo',
    directorEmail: 'david@ssusa.org',
    sportsTypeId: '1',
    eventStatus: 'published',
    allowTeamRegistration: true,
    registrationOpening: isoDate(10) + ' 09:00:00',
    entryFeeDeadline: isoDate(60)
  }),
  makeMockEvent({
    id: '2004',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Fast Pitch Showcase',
    eventType: 'other',
    avatarUrl: event4Image,
    startDate: isoDate(55),
    endDate: isoDate(57),
    timeZone: 'America/Chicago',
    city: 'Dallas',
    state: 'TX',
    directorName: 'Linda Marsh',
    directorEmail: 'linda@ssusa.org',
    sportsTypeId: '2',
    eventStatus: 'published',
    teamCounts: { pending: 3, confirmed: 12, waitlisted: 1, withdrawn: 0 },
    allowTeamRegistration: true,
    registrationOpening: isoDate(-5) + ' 08:00:00',
    entryFeeDeadline: isoDate(45),
    paymentRequired: true,
    entryFee: 275
  }),
  makeMockEvent({
    id: '2005',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Independence Day Memorial',
    eventType: 'tournament',
    avatarUrl: event5Image,
    startDate: isoDate(90),
    endDate: isoDate(92),
    timeZone: 'America/Denver',
    city: 'Phoenix',
    state: 'AZ',
    directorName: 'Tom Whitfield',
    directorEmail: 'tom@ssusa.org',
    sportsTypeId: '1',
    eventStatus: 'draft'
  }),
  makeMockEvent({
    id: '2007',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Coastal Senior Slam',
    eventType: 'tournament',
    avatarUrl: event6Image,
    startDate: isoDate(-30),
    endDate: isoDate(-28),
    timeZone: 'America/Los_Angeles',
    city: 'San Diego',
    state: 'CA',
    directorName: 'Frank Yeo',
    directorEmail: 'frank@ssusa.org',
    sportsTypeId: '4',
    eventStatus: 'completed',
    teamCounts: { pending: 0, confirmed: 28, waitlisted: 2, withdrawn: 2 },
    allowTeamRegistration: true,
    registrationOpening: isoDate(-90) + ' 09:00:00',
    entryFeeDeadline: isoDate(-40),
    paymentRequired: true,
    entryFee: 400
  }),
  makeMockEvent({
    id: '2008',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Winter Classic – Slow Pitch',
    eventType: 'tournament',
    avatarUrl: event1Image,
    startDate: isoDate(-60),
    endDate: isoDate(-58),
    timeZone: 'America/Los_Angeles',
    city: 'Las Vegas',
    state: 'NV',
    directorName: 'Lisa Brown',
    directorEmail: 'lisa@ssusa.org',
    sportsTypeId: '1',
    eventStatus: 'completed',
    teamCounts: { pending: 0, confirmed: 25, waitlisted: 1, withdrawn: 2 }
  }),
  makeMockEvent({
    id: '2009',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Memorial Day Tribute',
    eventType: 'tournament',
    avatarUrl: event2Image,
    startDate: isoDate(20),
    endDate: isoDate(22),
    timeZone: 'America/Chicago',
    city: 'Houston',
    state: 'TX',
    directorName: 'Eric Pace',
    directorEmail: 'eric@ssusa.org',
    sportsTypeId: '1',
    eventStatus: 'cancelled',
    note: 'Tournament cancelled due to venue conflict.'
  }),
  makeMockEvent({
    id: '2010',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Summer Slam Open',
    eventType: 'tournament',
    avatarUrl: event3Image,
    startDate: isoDate(150),
    endDate: isoDate(152),
    timeZone: 'America/Los_Angeles',
    city: 'Portland',
    state: 'OR',
    directorName: 'Anita Reyes',
    directorEmail: 'anita@ssusa.org',
    sportsTypeId: '1',
    eventStatus: 'published',
    teamCounts: { pending: 1, confirmed: 3, waitlisted: 0, withdrawn: 0 },
    allowTeamRegistration: true,
    registrationOpening: isoDate(60) + ' 09:00:00',
    entryFeeDeadline: isoDate(140)
  }),
  makeMockEvent({
    id: '2011',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: "Women's National Championship",
    eventType: 'league',
    avatarUrl: event4Image,
    startDate: isoDate(200),
    endDate: isoDate(204),
    timeZone: 'America/New_York',
    city: 'Charlotte',
    state: 'NC',
    directorName: 'Karen Cole',
    directorEmail: 'karen@ssusa.org',
    sportsTypeId: '2',
    eventStatus: 'published',
    allowTeamRegistration: true,
    registrationOpening: isoDate(100) + ' 09:00:00',
    entryFeeDeadline: isoDate(180),
    paymentRequired: true,
    entryFee: 600
  }),
  makeMockEvent({
    id: '2012',
    associationId: '1001',
    associationShortName: 'ssusa',
    eventName: 'Veterans Cup',
    eventType: 'tournament',
    avatarUrl: event5Image,
    startDate: isoDate(180),
    endDate: isoDate(182),
    timeZone: 'America/Phoenix',
    city: 'Tucson',
    state: 'AZ',
    directorName: '',
    directorEmail: '',
    sportsTypeId: '4',
    eventStatus: 'draft'
  })
]

let nextEventId = 3000

function applyFilters(events: Event[], params: EventListParams): Event[] {
  const search = (params.search || '').trim().toLowerCase()
  const eventType = params.eventType
  const eventStatus = params.eventStatus
  const year = params.year
  const pastEvents = params.pastEvents === true
  const sportsTypeId = params.sportsTypeId

  const nowMs = Date.now()
  return events.filter((e) => {
    // Year filter — match against event's local year.
    if (year !== undefined && year !== 'all' && e.eventYear !== year) return false
    // Past events vs upcoming/in-flight.
    const endMs = Date.parse(e.endAtUtc)
    const isPast = !Number.isNaN(endMs) && endMs < nowMs
    if (pastEvents && !isPast) return false
    if (!pastEvents && isPast) return false
    // Event type — single-value catalogue-key match.
    if (eventType && e.eventType !== eventType) return false
    // Lifecycle status — single-value exact match.
    if (eventStatus && e.eventStatus !== eventStatus) return false
    // Sport type.
    if (sportsTypeId && e.sportsTypeId !== sportsTypeId) return false
    // Search (name / type / city / state / director).
    if (!search) return true
    return (
      e.eventName.toLowerCase().includes(search) ||
      (e.eventType || '').toLowerCase().includes(search) ||
      (e.city || '').toLowerCase().includes(search) ||
      (e.state || '').toLowerCase().includes(search) ||
      (e.directorName || '').toLowerCase().includes(search)
    )
  })
}

function applySort(events: Event[], params: EventListParams): Event[] {
  const sort = params.sort || 'eventStartDate'
  const order = params.order || (params.pastEvents ? 'desc' : 'asc')
  const dir = order === 'asc' ? 1 : -1
  const sorted = [...events].sort((a, b) => {
    switch (sort) {
      case 'eventName': return a.eventName.localeCompare(b.eventName) * dir
      case 'createdAt': return a.createdAt.localeCompare(b.createdAt) * dir
      case 'eventStartDate':
      default:
        return (a.eventStartDate || '').localeCompare(b.eventStartDate || '') * dir
    }
  })
  return sorted
}

/**
 * `GET /v2/association/events/{associationId}` — list events.
 *
 * `associationShortName` is the slug in v1 (mock); the real backend
 * resolves slug → DB id at the route level so this signature is
 * stable across the mock-→-real swap.
 */
/**
 * `GET /v2/association/events/{associationId}` — paginated event list
 * with filters. The path parameter is the ASSOCIATION's NUMERIC PK
 * (from `currentAssociation.value.id`), NOT the URL slug — backend
 * keys this endpoint on the BIGINT id. The caller is responsible for
 * passing the right value.
 *
 * Query parameters per the contract (`association-events-api-contract.md`):
 *   - `year` (int | 'all')         — local-year filter
 *   - `pastEvents` (bool)          — flips between upcoming and past
 *   - `eventType` (catalogue key)  — single-select (tournament / online_meeting / league / other)
 *   - `eventStatus` (status key)   — single-select (draft / published / completed / cancelled)
 *   - `sportsTypeId` (string)      — joined sport-type id
 *   - `search` (string)            — name / type / city / state / director substring
 *   - `sort` ('eventStartDate' | 'eventName' | 'createdAt')
 *   - `order` ('asc' | 'desc')
 *   - `page` (int)                 — 1-indexed Laravel paginator page
 *   - `per_page` (int, snake_case) — page size (per conventions.md)
 *
 * Returns the standard Laravel paginator wrapping `EventSummary[]`.
 */
export async function fetchEvents(
  associationId: string,
  params: EventListParams = {}
): Promise<LaravelPaginator<EventSummary>> {
  const query = new URLSearchParams()
  if (params.year !== undefined && params.year !== null) {
    query.set('year', String(params.year))
  }
  if (params.pastEvents === true) {
    query.set('pastEvents', 'true')
  }
  if (params.eventType) {
    query.set('eventType', params.eventType)
  }
  if (params.eventStatus) {
    query.set('eventStatus', params.eventStatus)
  }
  if (params.sportsTypeId) {
    query.set('sportsTypeId', params.sportsTypeId)
  }
  if (params.search && params.search.trim()) {
    query.set('search', params.search.trim())
  }
  if (params.sort) {
    query.set('sort', params.sort)
  }
  if (params.order) {
    query.set('order', params.order)
  }
  if (typeof params.page === 'number') {
    query.set('page', String(Math.max(1, params.page)))
  }
  if (typeof params.per_page === 'number') {
    query.set('per_page', String(Math.min(100, Math.max(1, params.per_page))))
  }

  const qs = query.toString()
  const path = `/association/events/${encodeURIComponent(associationId)}${qs ? `?${qs}` : ''}`
  const result = await fetchEnvelope<LaravelPaginator<EventSummary>>(path)
  // Cache each returned summary by GUID so downstream pages that
  // need event identity by GUID (e.g. MatchGeni dashboard's header)
  // can resolve without an extra HTTP round-trip — and crucially,
  // can still resolve even before the backend's fetch-by-guid /
  // get-one endpoints ship. See `fetchEventByGuid` below.
  for (const summary of result.data) {
    if (summary.guid) {
      eventSummaryCacheByGuid.set(summary.guid, summary)
    }
  }
  return result
}

/** In-memory cache of `EventSummary` rows keyed by GUID. Populated by
 *  the listing endpoint each time it runs; read by `fetchEventByGuid`
 *  as a fallback when the backend's full-fetch endpoint isn't ready
 *  yet (or when the row isn't in the mock seed data). Cleared
 *  implicitly only when the module reloads — same lifetime as the
 *  rest of the in-memory mock state. */
const eventSummaryCacheByGuid = new Map<string, EventSummary>()

/** Project a full `Event` down to the slim `EventSummary` shape the
 *  list endpoint returns. In production this projection lives in the
 *  backend serializer; here it mirrors the same surface so consumers
 *  see identical data after the mock → real swap. */
export function toEventSummary(evt: Event): EventSummary {
  return {
    id: evt.id,
    guid: evt.guid,
    slug: evt.slug,
    eventName: evt.eventName,
    eventType: evt.eventType,
    avatarUrl: evt.avatarUrl,
    eventStatus: evt.eventStatus,
    dateRangeLabel: evt.dateRangeLabel,
    sportsTypeName: evt.sportsTypeName,
    city: evt.city,
    state: evt.state,
    directorName: evt.directorName,
    teamCounts: evt.teamCounts,
    entryFee: evt.entryFee,
    entryFeeDeadline: evt.entryFeeDeadline,
    paymentRequired: evt.paymentRequired,
    allowTeamRegistration: evt.allowTeamRegistration,
    registrationStatus: evt.registrationStatus,
    registrationOpensLabel: evt.registrationOpensLabel,
    registrationClosesLabel: evt.registrationClosesLabel
  }
}

/**
 * `GET /v2/association/events/{associationId}/years` — distinct event
 * years that have at least one event, plus the server-derived
 * `defaultYear` the listing UI should pre-select on first paint.
 * Path parameter is the numeric `associationId` (NOT the slug).
 */
export async function fetchEventYears(
  associationId: string
): Promise<EventYearsResponse> {
  const path = `/association/events/${encodeURIComponent(associationId)}/years`
  return fetchEnvelope<EventYearsResponse>(path)
}

/**
 * `GET /v2/association/events/{associationId}/{eventId}` — single
 * event read.
 */
/**
 * `GET /v2/association/events/{associationId}/{eventId}` (§3 Get One Event)
 * — the full `Event` row, used to hydrate the Edit flow. `associationId`
 * is the association's NUMERIC PK (not the slug); `eventId` is the event's
 * numeric id. Live — `data` is the full `Event` per the contract, so the
 * envelope's `data` maps straight onto the type (no adapter).
 */
export async function fetchEvent(
  associationId: string,
  eventId: string
): Promise<Event> {
  // get-one ships `stripeConnected` (camelCase boolean, same key as the
  // my-associations response), so `data` maps straight onto `Event`.
  return await fetchEnvelope<Event>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}`
  )
}

/**
 * `GET /v2/association/events/{associationId}/by-guid/{eventGuid}` —
 * resolve an event by its globally-unique guid. MatchGeni routes
 * use the guid in the URL so saved links stay stable even if the
 * underlying numeric id changes (e.g. during a database migration).
 * Real backend will collapse this into the standard get-event
 * endpoint via a guid-or-id-aware lookup; the wire signature here
 * keeps the resolution explicit for the mock.
 */
export async function fetchEventByGuid(
  associationShortName: string,
  eventGuid: string
): Promise<Event> {
  void associationShortName
  const match = mockEvents.find((e) => e.guid === eventGuid)
  if (match) {
    return delay({ ...match })
  }
  // Fallback: the backend listing endpoint is wired but a dedicated
  // fetch-by-guid endpoint hasn't shipped yet. The listing populates
  // `eventSummaryCacheByGuid` on every call, so if the user opened
  // MatchGeni from the listing page (the only entrypoint today) the
  // summary is already in memory — promote it to a stub Event with
  // safe defaults for the fields MatchGeni's header needs (id, guid,
  // eventName, eventStatus, dateRangeLabel) and null/sensible defaults
  // for the rest. Swap this branch out once the real get-by-guid
  // endpoint lands.
  const summary = eventSummaryCacheByGuid.get(eventGuid)
  if (summary) {
    const stub = eventSummaryToStubEvent(summary)
    return delay(stub)
  }
  await delay(null)
  throw new EventsApiError(404, 'Event not found.')
}

/** Build a minimally-shaped `Event` from an `EventSummary`. Fields not
 *  present on the summary surface get null / sensible defaults — only
 *  the identity + display fields MatchGeni reads (eventName, guid, id,
 *  eventStatus, dateRangeLabel) are guaranteed accurate. Strictly a
 *  bridge for the period before the backend's fetch-by-guid endpoint
 *  ships. */
function eventSummaryToStubEvent(summary: EventSummary): Event {
  return {
    id: summary.id,
    guid: summary.guid,
    teamId: null,
    associationId: '',
    associationShortName: '',

    eventName: summary.eventName,
    eventType: summary.eventType,
    avatarUrl: summary.avatarUrl,

    address: null,
    location: null,
    city: summary.city,
    state: summary.state,
    zipCode: null,
    lat: null,
    long: null,

    eventStartDate: null,
    eventEndDate: null,
    eventStartTime: null,
    eventEndTime: null,
    timeZone: 'America/Los_Angeles',
    allDay: false,

    startAtUtc: '',
    endAtUtc: '',
    eventYear: new Date().getFullYear(),
    isPast: false,
    dateRangeLabel: summary.dateRangeLabel,
    dateRangeLabelShort: summary.dateRangeLabel,

    note: null,
    reminder: null,
    mediumId: null,
    mediumName: null,
    url: null,
    color: null,

    eventStatus: summary.eventStatus,

    directorName: summary.directorName,
    directorEmail: '',
    directorPhone: null,
    mobCode: null,

    entryFee: summary.entryFee,
    refundPolicy: null,
    tournamentFormat: null,
    entryFeeDeadline: summary.entryFeeDeadline,
    entryFeeDeadlineUtc: null,
    poolPlayGuaranteed: null,
    bracketFormatId: null,
    bracketFormat: null,
    poolPlayTime: null,
    championshipTime: null,
    bracketTime: null,
    timeInterval: null,

    sportsTypeId: null,
    sportsTypeName: summary.sportsTypeName,

    allowTeamRegistration: summary.allowTeamRegistration,
    registrationOpening: null,
    registrationOpeningUtc: null,
    registrationStatus: summary.registrationStatus,
    registrationOpensLabel: summary.registrationOpensLabel,
    registrationClosesLabel: summary.registrationClosesLabel,

    paymentRequired: summary.paymentRequired,
    paymentTerms: null,
    partialPaymentType: null,
    partialPaymentValue: null,
    allowOfflinePayment: false,
    autoConfirmOnFullPayment: false,
    autoConfirmOnPartialPayment: false,

    fieldConfigId: null,

    teamCounts: summary.teamCounts,

    createdAt: '',
    updatedAt: '',
    createdByUserId: null,
    updatedByUserId: null
  }
}

// ── Create / Update (multipart) ──────────────────────────────────────────
// The write endpoints take `multipart/form-data` (the cover image rides as a
// binary `avatar[0]` part) and are fully live — no mock branch.

/** Cover-image change for a write. Omit the whole object to keep the existing
 *  image; `{ blob }` replaces it; `{ blob: null }` clears it. */
export interface EventAvatarUpload {
  blob: Blob | null
  filename?: string
}

// DB stores these enums as TINYINT codes (per the schema), so we send the
// numeric code on the wire rather than the string name — the backend casts
// and stores directly with no name→code lookup.
const PAYMENT_TERMS_CODE: Record<string, string> = { full: '0', partial: '1' }
const PARTIAL_TYPE_CODE: Record<string, string> = { fixed_amount: '0', percentage: '1' }

/** Serialize a `SaveEventPayload` into multipart form fields per the
 *  association-events contract §4/§5. Booleans + tinyint flags → "1"/"0";
 *  `paymentTerms`/`partialPaymentType` → numeric codes; `eventType` → its
 *  display LABEL (what the DB persists); `seedCriteria` → a JSON string;
 *  null/blank fields are omitted. */
function eventPayloadToFormData(payload: SaveEventPayload, avatar?: EventAvatarUpload): FormData {
  const fd = new FormData()
  const put = (key: string, value: string | null | undefined) => {
    if (value != null && value !== '') fd.append(key, value)
  }
  const bool = (v: boolean) => (v ? '1' : '0')
  const numStr = (v: number | null) => (v == null ? null : String(v))

  put('eventName', payload.eventName)
  // Send the catalogue KEY ("tournament"), not the display label. The backend
  // stores + returns the key verbatim; the form maps key → dropdown on read.
  put('eventType', payload.eventType ?? null)
  put('locationType', payload.locationType ?? null)

  put('address', payload.address)
  put('location', payload.location)
  put('city', payload.city)
  put('state', payload.state)
  put('zipCode', payload.zipCode)
  put('lat', payload.lat)
  put('long', payload.long)

  put('mediumId', payload.mediumId)
  put('medium', payload.mediumName)          // DB/contract field is `medium`
  put('url', payload.url)

  put('eventStartDate', payload.eventStartDate)
  put('eventEndDate', payload.eventEndDate)
  put('eventStartTime', payload.eventStartTime)
  put('eventEndTime', payload.eventEndTime)
  put('timeZone', payload.timeZone)
  fd.append('allDay', bool(payload.allDay))

  put('note', payload.note)
  put('reminder', payload.reminder)
  put('color', payload.color)
  put('eventStatus', payload.eventStatus)

  put('directorName', payload.directorName)
  put('directorEmail', payload.directorEmail)
  put('directorPhone', payload.directorPhone)
  put('mobCode', payload.mobCode)

  put('entryFee', numStr(payload.entryFee))
  put('refundPolicy', payload.refundPolicy)
  put('tournamentFormat', payload.tournamentFormat)
  put('entryFeeDeadline', payload.entryFeeDeadline)
  put('poolPlayGuaranteed', payload.poolPlayGuaranteed)
  put('bracketFormatId', payload.bracketFormatId)
  put('poolPlayTime', payload.poolPlayTime)
  put('championshipTime', payload.championshipTime)
  put('bracketTime', payload.bracketTime)
  put('timeInterval', payload.timeInterval)
  put('sportsTypeId', payload.sportsTypeId)
  put('fieldConfigId', payload.fieldConfigId)

  fd.append('seedCriteria', JSON.stringify(payload.seedCriteria ?? []))
  fd.append('customFields', JSON.stringify(payload.customFields ?? []))

  fd.append('allowTeamRegistration', bool(payload.allowTeamRegistration))
  put('registrationOpening', payload.registrationOpening)
  fd.append('paymentRequired', bool(payload.paymentRequired))
  put('paymentTerms', payload.paymentTerms ? PAYMENT_TERMS_CODE[payload.paymentTerms] : null)
  put('partialPaymentType', payload.partialPaymentType ? PARTIAL_TYPE_CODE[payload.partialPaymentType] : null)
  put('partialPaymentValue', numStr(payload.partialPaymentValue))
  fd.append('allowOfflinePayment', bool(payload.allowOfflinePayment))
  fd.append('autoConfirmOnFullPayment', bool(payload.autoConfirmOnFullPayment))
  fd.append('autoConfirmOnPartialPayment', bool(payload.autoConfirmOnPartialPayment))

  // Cover image: a new blob replaces, an explicit null clears, omitting keeps.
  if (avatar) {
    if (avatar.blob) fd.append('avatar[0]', avatar.blob, avatar.filename ?? 'cover.jpg')
    else fd.append('avatar', '')
  }
  return fd
}

/**
 * `POST /v2/association/events/{associationId}` — create event.
 * Mock skips most validation; the real backend enforces every rule
 * in the contract.
 */
export async function createEvent(
  associationId: string,
  payload: SaveEventPayload,
  avatar?: EventAvatarUpload
): Promise<Event> {
  // `{associationId}` = the numeric association PK; the backend derives
  // association_id / association (name) / owner_type=1 / owner_linked_id
  // from it + the authorized membership. None are sent in the body.
  return fetchEnvelope<Event>(
    `/association/events/${encodeURIComponent(associationId)}`,
    { method: 'POST', body: eventPayloadToFormData(payload, avatar) }
  )
}

/**
 * `PUT /v2/association/events/{associationId}/{eventId}` — full
 * replace. Enforces the lifecycle transition state machine.
 */
export async function updateEvent(
  associationId: string,
  eventId: string,
  payload: SaveEventPayload,
  avatar?: EventAvatarUpload
): Promise<Event> {
  const fd = eventPayloadToFormData(payload, avatar)
  // PHP/Laravel doesn't parse multipart bodies on PUT — POST with method
  // spoofing (`_method=PUT`) so the file part + fields arrive intact.
  fd.append('_method', 'PUT')
  return fetchEnvelope<Event>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}`,
    { method: 'POST', body: fd }
  )
}

/**
 * `POST /v2/association/events/{associationId}/{eventId}/cancel` —
 * soft-cancel. Server flips `event_status` to `'cancelled'` and
 * optionally records the cancellation `reason` in the audit log.
 *
 * Path params:
 *   - `associationId` — ASSOCIATION's numeric PK (from
 *     `currentAssociation.value.id`), NOT the URL slug.
 *   - `eventId`       — the `team_events.id` for the target event.
 *
 * Body:
 *   - `status` (EventStatus) — the target lifecycle state.
 *   - `reason` (string) — REQUIRED when `status === 'cancelled'`
 *     (recorded in the cancellation audit log); omitted otherwise.
 *
 * Returns the updated `Event` row. 409 on an illegal transition
 * (state-machine violation), 422 on a missing cancel reason.
 */
export async function changeEventStatus(
  associationId: string,
  eventId: string,
  status: EventStatus,
  options: { reason?: string } = {}
): Promise<Event> {
  const body: Record<string, unknown> = { status }
  if (options.reason !== undefined) body.reason = options.reason
  return fetchEnvelope<Event>(
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/status`,
    {
      method: 'POST',
      body: JSON.stringify(body)
    }
  )
}

/**
 * `GET /v2/association/events/{associationId}/{eventId}/resources`
 * — fetch the lightweight parks + divisions catalogue for an event,
 * used to populate dropdown surfaces (currently: the
 * `EventOfficialAccessModal` scoring-scope picker). Per the contract
 * (`association-events-api-contract.md` §9):
 *
 *   - `type` is REQUIRED — pass an explicit list of buckets
 *     (`['parks']`, `['parks', 'hotels']`, …) or the `'all'` shorthand.
 *     It serializes comma-separated on the wire (`?type=parks,hotels`);
 *     there is no default (an omitted / empty / unknown `type` is a
 *     `422`). The legacy `'both'` value was dropped — request
 *     `['parks', 'divisions']` explicitly. (`sponsors` / `hotels` are
 *     mock-only until the backend serves them — see the split below.)
 *   - Response payload omits the bucket keys the caller didn't ask
 *     for — callers treat `parks` / `divisions` / `sponsors` / `hotels`
 *     as possibly-undefined and default to `[]`.
 *   - Sorted server-side by `LOWER(name) ASC`; no client-side sort.
 *   - 403 on missing permissions, 404 when the event doesn't exist /
 *     is soft-deleted / belongs to another association, 409 when the
 *     event is team-owned (`owner_type ≠ 1`), 422 for an invalid `type`.
 */
export async function fetchEventResources(
  associationId: string,
  eventId: string,
  type: EventResourcesSelection
): Promise<EventResources> {
  if (!associationId || !eventId) return {}

  // All buckets (parks / divisions / sponsors / hotels) are served live by
  // the §9 endpoint. `'all'` is the backend's exclusive shorthand for every
  // bucket; otherwise send the deduped comma-separated list. Encode each
  // token so the comma stays a literal separator on the wire.
  let typeParam: string
  if (type === 'all') {
    typeParam = 'all'
  } else {
    const buckets: EventResourceBucket[] = [...new Set(type)]
    if (buckets.length === 0) return {}
    typeParam = buckets.map((b) => encodeURIComponent(b)).join(',')
  }
  const path =
    `/association/events/${encodeURIComponent(associationId)}/${encodeURIComponent(eventId)}/resources` +
    `?type=${typeParam}`
  return fetchEnvelope<EventResources>(path)
}

/**
 * High-level lifecycle transition helper. Every status milestone
 * (publish / complete / cancel) flows through the single consolidated
 * `POST …/status` endpoint (`changeEventStatus`) — `PUT` is reserved
 * strictly for content edits, never lifecycle moves. Cancellation
 * carries the required `reason`; the others send none.
 *
 * Allowed transitions are enforced server-side via `isAllowedTransition`
 * (same table documented in `association-events-api-contract.md` §6) —
 * illegal transitions throw `EventsApiError` with code 409.
 *
 * `associationShortName` is retained in the signature for call-site
 * stability (the consolidated endpoint keys off the numeric
 * `associationId` only).
 */
export async function transitionEventStatus(
  associationId: string,
  associationShortName: string,
  eventId: string,
  target: EventStatus,
  options: { reason?: string } = {}
): Promise<Event> {
  void associationShortName
  return changeEventStatus(associationId, eventId, target, options)
}

/**
 * `DELETE /v2/association/events/{associationId}/{eventId}` — soft
 * delete. v1 only allows deleting `cancelled` events.
 */
export async function deleteEvent(
  associationShortName: string,
  eventId: string
): Promise<void> {
  void associationShortName
  const index = mockEvents.findIndex((e) => e.id === eventId)
  if (index === -1) {
    await delay(null)
    throw new EventsApiError(404, 'Event not found.')
  }
  if (mockEvents[index].eventStatus !== 'cancelled') {
    await delay(null)
    throw new EventsApiError(409, 'Only cancelled events can be deleted.', {
      field: 'eventStatus'
    })
  }
  mockEvents.splice(index, 1)
  await delay(null)
}

/** Build the full Event row from a save payload, populating the
 *  server-managed / derived fields the real backend would compute. */
function buildEventFromPayload(
  id: string,
  associationShortName: string,
  payload: SaveEventPayload,
  serverFields: { teamCounts: EventTeamCounts; createdAt: string; updatedAt: string }
): Event {
  const sport = SPORTS_TYPE_CATALOGUE.find((s) => s.id === payload.sportsTypeId)
  const bracket = BRACKET_FORMAT_CATALOGUE.find((b) => b.id === payload.bracketFormatId)
  const labels = buildDateRangeLabels(payload.eventStartDate, payload.eventEndDate, payload.timeZone)
  const reg = buildRegistrationFields(
    payload.allowTeamRegistration,
    payload.registrationOpening,
    payload.entryFeeDeadline,
    payload.timeZone
  )
  return {
    id,
    guid: mockGuid(Number(id) || Date.now()),
    teamId: null,
    associationId: associationShortName,
    associationShortName,

    eventName: payload.eventName,
    eventType: payload.eventType,
    avatarUrl: payload.avatar
      ? `https://cdn.whoifollow.com/events/${payload.avatar}`
      : null,

    address: payload.address,
    location: payload.location,
    city: payload.city,
    state: payload.state,
    zipCode: payload.zipCode,
    lat: payload.lat,
    long: payload.long,

    eventStartDate: payload.eventStartDate,
    eventEndDate: payload.eventEndDate,
    eventStartTime: payload.allDay ? null : payload.eventStartTime,
    eventEndTime: payload.allDay ? null : payload.eventEndTime,
    timeZone: payload.timeZone,
    allDay: payload.allDay,

    startAtUtc: localToUtc(payload.eventStartDate, payload.eventStartTime, payload.timeZone, '00:00:00'),
    endAtUtc: localToUtc(payload.eventEndDate, payload.eventEndTime, payload.timeZone, '23:59:59'),
    eventYear: Number((payload.eventStartDate || '').slice(0, 4)) || new Date().getFullYear(),
    isPast: payload.eventEndDate
      ? Date.parse(payload.eventEndDate + 'T23:59:59Z') < Date.now()
      : false,
    dateRangeLabel: labels.dateRangeLabel,
    dateRangeLabelShort: labels.dateRangeLabelShort,

    note: payload.note,
    reminder: payload.reminder,
    mediumId: payload.mediumId,
    mediumName: payload.mediumName,
    url: payload.url,
    color: payload.color,

    eventStatus: payload.eventStatus,

    directorName: payload.directorName,
    directorEmail: payload.directorEmail,
    directorPhone: payload.directorPhone,
    mobCode: payload.mobCode,

    entryFee: payload.entryFee,
    refundPolicy: payload.refundPolicy,
    tournamentFormat: payload.tournamentFormat,
    entryFeeDeadline: payload.entryFeeDeadline,
    entryFeeDeadlineUtc: reg.entryFeeDeadlineUtc,
    poolPlayGuaranteed: payload.poolPlayGuaranteed,
    bracketFormatId: payload.bracketFormatId,
    bracketFormat: bracket?.name ?? null,
    poolPlayTime: payload.poolPlayTime,
    championshipTime: payload.championshipTime,
    bracketTime: payload.bracketTime,
    timeInterval: payload.timeInterval,

    sportsTypeId: payload.sportsTypeId,
    sportsTypeName: sport?.name ?? null,

    allowTeamRegistration: payload.allowTeamRegistration,
    registrationOpening: payload.registrationOpening,
    registrationOpeningUtc: reg.registrationOpeningUtc,
    registrationStatus: reg.registrationStatus,
    registrationOpensLabel: reg.registrationOpensLabel,
    registrationClosesLabel: reg.registrationClosesLabel,

    paymentRequired: payload.paymentRequired,
    paymentTerms: payload.paymentTerms,
    partialPaymentType: payload.partialPaymentType,
    partialPaymentValue: payload.partialPaymentValue,
    allowOfflinePayment: payload.allowOfflinePayment,
    autoConfirmOnFullPayment: payload.autoConfirmOnFullPayment,
    autoConfirmOnPartialPayment: payload.autoConfirmOnPartialPayment,

    fieldConfigId: payload.fieldConfigId,

    teamCounts: serverFields.teamCounts,

    createdAt: serverFields.createdAt,
    updatedAt: serverFields.updatedAt,
    createdByUserId: null,
    updatedByUserId: null
  }
}

/** Lifecycle transition state machine — same rules client-side and
 *  server-side per `EventStatus`. */
export function isAllowedTransition(from: EventStatus, to: EventStatus): boolean {
  if (from === to) return true
  switch (from) {
    case 'draft': return to === 'published' || to === 'cancelled'
    case 'published': return to === 'completed' || to === 'cancelled'
    case 'completed':
    case 'cancelled':
    default:
      return false
  }
}

/** Static status catalogue. Used by the form modal's status picker. */
export const EVENT_STATUSES: EventStatus[] = ['draft', 'published', 'completed', 'cancelled']

/** Payment-terms options for the form. */
export const PAYMENT_TERMS_OPTIONS: { value: EventPaymentTerms; label: string }[] = [
  { value: 'full', label: 'Full payment' },
  { value: 'partial', label: 'Partial payment' }
]

/** Partial-payment-type options for the form (visible only when
 *  paymentTerms='partial'). */
export const PARTIAL_PAYMENT_TYPE_OPTIONS: { value: EventPartialPaymentType; label: string }[] = [
  { value: 'fixed_amount', label: 'Fixed amount ($)' },
  { value: 'percentage', label: 'Percentage (%)' }
]
