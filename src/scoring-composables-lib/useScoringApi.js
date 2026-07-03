import axios from 'axios'
import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from '../api/config'

/**
 * All API calls for the game scoring module.
 * Centralizes the /api/v2/ paths and response unwrapping.
 *
 * Usage:
 *   const api = useScoringApi()
 *   const lineup = await api.getLineup(gameId, teamId)
 */
export function useScoringApi() {
  const BASE = buildV2ApiUrl('')

  // ─── Lineup ─────────────────────────────────────────────────────────────────

  async function getLineupSubmission(tournamentGameId, teamId) {
    const { data } = await axios.get(
      `${BASE}/games/${tournamentGameId}/teams/${teamId}/lineup`,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function saveLineupSubmission(tournamentGameId, teamId, payload) {
    const { data } = await axios.post(
      `${BASE}/games/${tournamentGameId}/teams/${teamId}/lineup`,
      payload,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function updateLineupPlayer(lineupPlayerId, payload) {
    const { data } = await axios.patch(
      `${BASE}/lineup-players/${lineupPlayerId}`,
      payload,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  // ─── Batting appearances ──────────────────────────────────────────────────

  async function getAppearances(tournamentGameId, teamId) {
    const { data } = await axios.get(
      `${BASE}/games/${tournamentGameId}/teams/${teamId}/appearances`,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function saveAppearance(tournamentGameId, teamId, payload) {
    const { data } = await axios.post(
      `${BASE}/games/${tournamentGameId}/teams/${teamId}/appearances`,
      payload,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function updateAppearance(appearanceId, payload) {
    const { data } = await axios.patch(
      `${BASE}/appearances/${appearanceId}`,
      payload,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  // ─── Batting stats (cached totals) ───────────────────────────────────────

  async function getBattingStats(tournamentGameId, teamId) {
    const { data } = await axios.get(
      `${BASE}/games/${tournamentGameId}/teams/${teamId}/batting-stats`,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  // ─── Scoresheet upload ────────────────────────────────────────────────────

  async function uploadScoresheet(tournamentGameId, teamId, file, onProgress) {
    const form = new FormData()
    form.append('scoresheet', file)
    form.append('team_id', teamId)

    const { data } = await axios.post(
      `${BASE}/games/${tournamentGameId}/scoresheet-uploads`,
      form,
      {
        headers: { ...getAuthHeaders(), 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress) onProgress(Math.round((e.loaded * 100) / e.total))
        },
      }
    )
    return data.data
  }

  async function getScoresheetUploadStatus(uploadId) {
    const { data } = await axios.get(
      `${BASE}/scoresheet-uploads/${uploadId}`,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function getExtractedRows(uploadId) {
    const { data } = await axios.get(
      `${BASE}/scoresheet-uploads/${uploadId}/extracted-rows`,
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function resolveMatchResult(matchResultId, resolution, payload = {}) {
    const { data } = await axios.patch(
      `${BASE}/scoresheet-match-results/${matchResultId}/resolve`,
      { resolution, ...payload },
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  async function mergeScoresheet(uploadId) {
    const { data } = await axios.post(
      `${BASE}/scoresheet-uploads/${uploadId}/merge`,
      {},
      { headers: getAuthHeaders() }
    )
    return data.data
  }

  return {
    getLineupSubmission,
    saveLineupSubmission,
    updateLineupPlayer,
    getAppearances,
    saveAppearance,
    updateAppearance,
    getBattingStats,
    uploadScoresheet,
    getScoresheetUploadStatus,
    getExtractedRows,
    resolveMatchResult,
    mergeScoresheet,
  }
}
