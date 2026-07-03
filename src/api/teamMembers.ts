import { postLegacyFormData } from './client'
import { buildUserAvatarUrl } from './config'
import type { TeamMemberOption } from '../types'

/**
 * Legacy endpoint contract for /api/chat/getTeamMembers.
 * Only the fields we actually consume are typed; the backend returns much more.
 */
type ApiTeamMemberRecord = {
  id: number | string | null
  team_id?: number | string | null
  user_id?: number | string | null
  uniform_no?: string | null
  status?: number | null
  isPlayer?: number | boolean | null
  isArchived?: number | null
  member?: {
    id?: number | string | null
    name?: string | null
  } | null
  user_profile?: {
    fname?: string | null
    lname?: string | null
    profile_avatar?: string | null
  } | null
}

type ApiTeamMembersEnvelope = {
  data?: ApiTeamMemberRecord[] | null
  message?: string | null
  statusCode?: number | null
}

function buildDisplayName(record: ApiTeamMemberRecord): string {
  const first = record.user_profile?.fname?.trim() ?? ''
  const last = record.user_profile?.lname?.trim() ?? ''
  const composed = [first, last].filter(Boolean).join(' ')
  if (composed) return composed
  const memberName = record.member?.name?.trim() ?? ''
  if (memberName) return memberName
  return 'Unnamed player'
}

function adaptTeamMember(record: ApiTeamMemberRecord): TeamMemberOption | null {
  if (record.id == null) return null
  // The isPlayer flag from the API can be a boolean or a 0/1 integer. Coerce
  // to a boolean so downstream filters don't accidentally treat 0 as truthy.
  const isPlayer = record.isPlayer === 1 || record.isPlayer === true
  return {
    id: String(record.id),
    userId: record.user_id != null ? String(record.user_id) : null,
    name: buildDisplayName(record),
    jerseyNumber: record.uniform_no ?? '',
    defaultPosition: 'EH',
    status: record.status === 1 ? 'active' : 'bench',
    isPlayer,
    // profile_avatar from this endpoint comes back as a full CDN URL already
    // (pre-signed). buildUserAvatarUrl passes absolute URLs through unchanged,
    // so this is safe regardless of shape.
    imageUrl: buildUserAvatarUrl(record.user_profile?.profile_avatar ?? undefined)
  }
}

/**
 * Fetch the full roster of members for a team from the legacy chat API.
 * `teamGuid` is submitted as the `teamId` form field — it's the team's GUID
 * (e.g. "02WBI5hrTUXSvyJy9iKJ"), not the numeric team id.
 *
 * Returns the adapted list, or `[]` on any failure so the caller can render
 * an empty dropdown and continue without blocking the participation view.
 */
export async function fetchTeamMembers(teamGuid: string): Promise<TeamMemberOption[]> {
  if (!teamGuid) return []
  try {
    const response = await postLegacyFormData<ApiTeamMembersEnvelope>(
      '/chat/getTeamMembers',
      { teamId: teamGuid }
    )
    const records = Array.isArray(response?.data) ? response.data : []
    return records
      .filter((record) => record.isArchived !== 1)
      .map(adaptTeamMember)
      .filter((member): member is TeamMemberOption => member !== null)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[teamMembers] fetchTeamMembers failed — returning empty list', error)
    return []
  }
}
