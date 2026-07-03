import { postLegacyFormData, postLegacyJson } from './client'
import { getAuthUserId } from '../auth-session'
import { buildUserAvatarUrl } from './config'
import type {
  EventAttendanceListingResult,
  EventAttendanceMember,
  EventAttendanceStatus,
  SaveEventAttendancePayload,
  SaveEventAttendanceResult,
  SendAttendanceReminderResult
} from '../types'

type RawEventAttendanceEnvelope = {
  data?: {
    attendeeListing?: RawEventAttendanceRecord[] | null
    // Best-effort: some listing responses also include the current user's
    // attendee record. When present it lets us pre-highlight the Your-
    // attendance row on first modal open instead of waiting for the first save.
    loggedInUserAttendee?: RawEventAttendanceRecord | null
  } | null
}

type RawEventAttendanceRecord = {
  id?: number | string | null
  team_id?: number | string | null
  member_id?: number | string | null
  user_id?: number | string | null
  guid?: string | null
  member_status?: number | string | null
  services?: string | null
  room_count?: number | string | null
  adult_count?: number | string | null
  note?: string | null
  exactEndDate?: string | null
  exactStartDate?: string | null
  // Legacy flat shape (still returned by the save endpoint's
  // `event_attendee_all`). Kept alongside the nested shape below so one
  // adapter covers both contracts without divergence.
  fname?: string | null
  mname?: string | null
  middle_name?: string | null
  lname?: string | null
  nick_name?: string | null
  profile_avatar?: string | null
  // New nested shape returned by /event/eventAttendeeListing. Carries the
  // real user identity — the listing response has null flat fields now.
  user_profile?: {
    id?: number | string | null
    user_id?: number | string | null
    guid?: string | null
    fname?: string | null
    lname?: string | null
    middle_name?: string | null
    nick_name?: string | null
    profile_avatar?: string | null
  } | null
}

// Save endpoint response envelope. Only the fields we actually use are typed;
// the backend returns a much larger `event` object.
type RawSaveEventAttendanceEnvelope = {
  statusCode?: number | null
  message?: string | null
  data?: {
    event?: {
      event_attendee_all?: RawEventAttendanceRecord[] | null
      loggedInUserAttendee?: RawEventAttendanceRecord | null
    } | null
  } | null
}

function normalizeAttendanceStatus(value: RawEventAttendanceRecord['member_status']): EventAttendanceStatus {
  const normalized = String(value ?? '').trim()
  if (normalized === '1') return 'going'
  if (normalized === '2') return 'not_going'
  return 'maybe'
}

function buildAttendanceName(record: RawEventAttendanceRecord) {
  // Prefer the full legal name — fname [+ middle] + lname — over nicknames.
  // Nicknames are surfaced separately on EventAttendanceMember.nickName for
  // any UI that wants them, but the primary display label should read as the
  // person's actual name to match how teammates recognise each other.
  // Nested user_profile (listing endpoint) takes precedence over flat fields
  // (legacy / save endpoint); both paths feed the same formatter.
  const profile = record.user_profile
  const parts = [
    (profile?.fname ?? record.fname)?.trim(),
    (profile?.middle_name ?? record.mname ?? record.middle_name)?.trim(),
    (profile?.lname ?? record.lname)?.trim()
  ].filter(Boolean)
  if (parts.length) return parts.join(' ')
  const nickName = (profile?.nick_name ?? record.nick_name)?.trim()
  if (nickName) return nickName
  return 'Team Member'
}

function adaptAttendanceRecord(record: RawEventAttendanceRecord): EventAttendanceMember {
  // Read nested `user_profile` first (new listing shape) with a fall-back to
  // the flat top-level fields (save endpoint + legacy contracts). One adapter
  // serves both shapes without caller branching.
  const profile = record.user_profile
  const userIdRaw = profile?.user_id ?? record.user_id
  const guidRaw = profile?.guid ?? record.guid
  return {
    id: String(
      record.id ?? guidRaw ?? userIdRaw ?? record.member_id ?? Date.now()
    ),
    teamId: record.team_id != null ? String(record.team_id) : undefined,
    memberId: record.member_id != null ? String(record.member_id) : undefined,
    userId: userIdRaw != null ? String(userIdRaw) : undefined,
    guid: guidRaw ?? undefined,
    firstName: (profile?.fname ?? record.fname)?.trim() ?? '',
    lastName: (profile?.lname ?? record.lname)?.trim() ?? '',
    nickName: (profile?.nick_name ?? record.nick_name)?.trim() ?? undefined,
    fullName: buildAttendanceName(record),
    profileAvatar: buildUserAvatarUrl(profile?.profile_avatar ?? record.profile_avatar),
    status: normalizeAttendanceStatus(record.member_status),
    services: record.services ?? null,
    roomCount: record.room_count != null ? String(record.room_count) : null,
    adultCount: record.adult_count != null ? String(record.adult_count) : null,
    exactStartDate: record.exactStartDate ?? null,
    exactEndDate: record.exactEndDate ?? null,
    note: record.note ?? null
  }
}

function extractSelfMemberId(record: RawEventAttendanceRecord | null | undefined): string | null {
  if (!record) return null
  if (record.member_id != null) return String(record.member_id)
  // Fall back to the record's own id if the backend forgot member_id but still
  // returned the wrapper — better than null for the match-against-list step.
  if (record.id != null) return String(record.id)
  return null
}

export async function fetchEventAttendance(
  eventId: string,
  teamGuid: string
): Promise<EventAttendanceListingResult> {
  // team_id is the team GUID (e.g. "02WBI5hrTUXSvyJy9iKJ"), not the numeric
  // team id — matches the contract used by /event/eventAttendeeSelect and the
  // rest of the attendance endpoints. Scoping the listing by team at the
  // backend avoids pulling every team's roster just to filter client-side.
  const response = await postLegacyJson<RawEventAttendanceEnvelope>('/event/eventAttendeeListing', {
    event_id: eventId,
    team_id: teamGuid
  })

  const rawRecords = response.data?.attendeeListing ?? []
  const members = rawRecords.map(adaptAttendanceRecord)

  // The listing endpoint doesn't return a `loggedInUserAttendee` wrapper, so
  // we resolve "me" by matching the JWT `sub` claim against each record's
  // `user_id` (preferred) or `member_id`. This lets the hero RSVP button
  // reflect the user's current status on a cold page refresh — without this
  // fallback, selfMemberId stays null until the user clicks a button.
  const authUserId = getAuthUserId()
  let selfMemberId: string | null = extractSelfMemberId(response.data?.loggedInUserAttendee)
  if (!selfMemberId && authUserId) {
    const selfRaw = rawRecords.find((record) => {
      // user_id now lives on user_profile in the listing response — fall back
      // to the flat field for legacy / save-endpoint shapes.
      const userIdRaw = record.user_profile?.user_id ?? record.user_id
      const userId = userIdRaw != null ? String(userIdRaw) : null
      const memberId = record.member_id != null ? String(record.member_id) : null
      return userId === authUserId || memberId === authUserId
    })
    if (selfRaw?.member_id != null) {
      selfMemberId = String(selfRaw.member_id)
    }
  }

  return { members, selfMemberId }
}

const STATUS_TO_CODE: Record<EventAttendanceStatus, '1' | '2' | '3'> = {
  going: '1',
  not_going: '2',
  maybe: '3'
}

export async function saveEventAttendance(payload: SaveEventAttendancePayload): Promise<SaveEventAttendanceResult> {
  // Travel-arrangements payload (optional). Each field falls back to an
  // empty string when the caller didn't supply it — the legacy endpoint
  // expects all six keys to be present in the form body whether or not
  // the user opted into travel info, so the empty default preserves
  // status-only-save behaviour for Not Going / Maybe and for the very
  // first Going save before the user fills in the travel form.
  //
  // `services` arrives as an array (e.g. ['Hotel', 'Bnb']) and is sent
  // as a comma-separated string ('Hotel,Bnb') — the format the BE has
  // accepted since the feature shipped.
  const services = (payload.services ?? []).join(',')
  const roomCount = payload.roomCount != null ? String(payload.roomCount) : ''
  const adultCount = payload.adultCount != null ? String(payload.adultCount) : ''
  const exactStartDate = payload.exactStartDate ?? ''
  const exactEndDate = payload.exactEndDate ?? ''
  const note = payload.note ?? ''

  const fields: Record<string, string> = {
    event_id: payload.eventId,
    team_id: payload.teamGuid,
    member_status: STATUS_TO_CODE[payload.status],
    services,
    room_count: roomCount,
    adult_count: adultCount,
    exactStartDate,
    exactEndDate,
    note
  }
  // Only include member_id when an admin is marking someone else. Sending an
  // empty string here makes the backend try to match a member with id "" and
  // can fall through to a 500, so strictly omit.
  if (payload.memberId) {
    fields.member_id = payload.memberId
  }

  const response = await postLegacyFormData<RawSaveEventAttendanceEnvelope>(
    '/event/eventAttendeeSelect',
    fields
  )

  if (response.statusCode != null && response.statusCode !== 200) {
    throw new Error(response.message?.trim() || 'Failed to update attendance')
  }

  const members = (response.data?.event?.event_attendee_all ?? []).map(adaptAttendanceRecord)
  const selfMemberId = extractSelfMemberId(response.data?.event?.loggedInUserAttendee)

  return { members, selfMemberId }
}

/**
 * Raw envelope shape for the legacy `/event/sendRemainderToTeammates`
 * endpoint. Counts come back as numbers; the user list is a flat array
 * of `{ user_id, fname, lname, email }` keyed snake_case fields. We
 * translate to the typed `SendAttendanceReminderResult` shape inside
 * `sendAttendanceReminder` so callers don't have to deal with raw
 * snake_case keys.
 */
type RawSendAttendanceReminderEnvelope = {
  data?: {
    total_teammates?: number | string | null
    responded_users?: number | string | null
    not_responded_users?: Array<{
      user_id?: number | string | null
      fname?: string | null
      lname?: string | null
      email?: string | null
    }> | null
    emails_sent?: number | string | null
  } | null
  message?: string | null
  statusCode?: number | null
}

/**
 * Triggers a reminder email to every teammate who hasn't responded to
 * an event invite. Admin-only; the UI hides the action for non-admins,
 * but the backend also enforces it.
 *
 * @param eventId numeric event id (the legacy endpoint expects it as a
 *   form-data string field).
 * @returns Counts plus the list of users mailed, mapped to camelCase.
 */
export async function sendAttendanceReminder(eventId: string | number): Promise<SendAttendanceReminderResult> {
  const response = await postLegacyFormData<RawSendAttendanceReminderEnvelope>(
    '/event/sendRemainderToTeammates',
    { event_id: String(eventId) }
  )

  // Dev-mode diagnostic — the count fields have come back zero in some
  // environments even when the frontend's Not Responded tab clearly
  // shows pending teammates. Logging the raw envelope here lets a
  // dev (or the user with DevTools open) see exactly what the backend
  // returned so we can tell whether it's a backend / data-consistency
  // issue (real `emails_sent: 0`) or a parsing mismatch (different
  // field names than the contract). No-op in production builds.
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log('[sendAttendanceReminder] raw response:', response)
  }

  if (response.statusCode != null && response.statusCode !== 200) {
    throw new Error(response.message?.trim() || 'Failed to send reminder')
  }

  const raw = response.data ?? {}
  const totalTeammates = Number(raw.total_teammates ?? 0) || 0
  const respondedUsers = Number(raw.responded_users ?? 0) || 0
  const emailsSent = Number(raw.emails_sent ?? 0) || 0
  const notRespondedUsers = (raw.not_responded_users ?? []).map((entry) => ({
    userId: Number(entry?.user_id ?? 0) || 0,
    firstName: entry?.fname ?? '',
    lastName: entry?.lname ?? '',
    email: entry?.email ?? ''
  }))

  return {
    totalTeammates,
    respondedUsers,
    notRespondedUsers,
    emailsSent,
    message: response.message?.trim() || undefined
  }
}
