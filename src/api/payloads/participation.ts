import type { TeamParticipation } from '../../types'

export function buildParticipationLineupPayload(lineup: TeamParticipation['lineup']) {
  return {
    lineup: lineup.map((player, index) => ({
      id: Number(player.id) || null,
      team_member_id: player.teamMemberId ? Number(player.teamMemberId) || player.teamMemberId : null,
      user_id: player.userId ? Number(player.userId) || player.userId : null,
      batting_order: index + 1,
      jersey_number: player.jerseyNumber || null,
      player_name: player.name,
      position_code: player.position || null,
      status: player.status
    }))
  }
}
