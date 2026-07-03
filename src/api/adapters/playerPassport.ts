import type {
  ApiAccess,
  ApiGameLogResponse,
  ApiLeaderboardResponse,
  ApiPlayerProfileResponse,
  ApiPlayerStats,
  ApiPlayerStatsResponse,
  ApiSplitsResponse
} from '../contracts/playerPassport'
import type {
  GameLogResult,
  LeaderboardResult,
  PlayerAccess,
  PlayerProfile,
  PlayerStats,
  PlayerStatsResult,
  SplitsResult
} from '../playerPassport'

function adaptAccess(a: ApiAccess | undefined | null): PlayerAccess {
  return {
    tier: a?.tier === 'pro' ? 'pro' : 'free',
    isSelf: !!a?.isSelf,
    lockedMetrics: a?.lockedMetrics ?? []
  }
}

function adaptStats(s: ApiPlayerStats): PlayerStats {
  return {
    games: s.games ?? null,
    plateAppearances: s.plateAppearances ?? null,
    atBats: s.atBats ?? null,
    runs: s.runs ?? null,
    hits: s.hits ?? null,
    singles: s.singles ?? null,
    doubles: s.doubles ?? null,
    triples: s.triples ?? null,
    homeRuns: s.homeRuns ?? null,
    rbi: s.rbi ?? null,
    walks: s.walks ?? null,
    strikeouts: s.strikeouts ?? null,
    totalBases: s.totalBases ?? null,
    avg: s.avg ?? null,
    obp: s.obp ?? null,
    slg: s.slg ?? null,
    ops: s.ops ?? null,
    qualified: !!s.qualified
  }
}

export function adaptPlayerProfile(res: ApiPlayerProfileResponse): PlayerProfile {
  const d = res?.data
  const p = d?.player
  return {
    id: String(p?.id ?? ''),
    name: p?.name ?? 'Player',
    avatarUrl: p?.avatarUrl ?? undefined,
    primaryPosition: p?.primaryPosition ?? undefined,
    teams: (p?.teams ?? []).map((t) => ({
      id: String(t.id),
      name: t.name ?? '',
      avatarUrl: t.avatarUrl ?? undefined,
      sportType: t.sportType ?? undefined,
      ageGroup: t.ageGroup ?? undefined,
      gender: t.gender ?? undefined
    })),
    memberSince: p?.memberSince ?? undefined,
    firstGameDate: p?.firstGameDate ?? undefined,
    lastGameDate: p?.lastGameDate ?? undefined,
    headline: {
      seasonsPlayed: d?.headline?.seasonsPlayed ?? 0,
      careerGames: d?.headline?.careerGames ?? 0,
      careerAvg: d?.headline?.careerAvg ?? '0.000',
      careerHomeRuns: d?.headline?.careerHomeRuns ?? 0,
      careerRbi: d?.headline?.careerRbi ?? 0
    },
    access: adaptAccess(d?.access)
  }
}

export function adaptPlayerStats(res: ApiPlayerStatsResponse): PlayerStatsResult {
  const d = res?.data
  return {
    scope: (d?.scope as 'career' | 'season') ?? 'career',
    season: d?.season ?? null,
    player: {
      id: String(d?.player?.id ?? ''),
      name: d?.player?.name ?? 'Player',
      avatarUrl: d?.player?.avatarUrl ?? undefined
    },
    stats: adaptStats(d?.stats ?? ({} as ApiPlayerStats)),
    access: adaptAccess(d?.access)
  }
}

export function adaptGameLog(res: ApiGameLogResponse): GameLogResult {
  const g = res?.data?.games
  return {
    rows: (g?.data ?? []).map((r) => ({
      gameId: String(r.gameId),
      date: r.date ?? '',
      eventName: r.eventName ?? undefined,
      division: r.division ?? undefined,
      opponent: { id: r.opponent?.id ?? undefined, name: r.opponent?.name ?? undefined },
      result: (r.result as 'W' | 'L' | 'T') ?? 'T',
      teamScore: r.teamScore ?? undefined,
      opponentScore: r.opponentScore ?? undefined,
      line: {
        ab: r.line?.ab ?? 0,
        r: r.line?.r ?? 0,
        h: r.line?.h ?? 0,
        rbi: r.line?.rbi ?? 0,
        hr: r.line?.hr ?? 0,
        bb: r.line?.bb ?? 0,
        k: r.line?.k ?? 0,
        avg: r.line?.avg ?? '0.000'
      },
      live: !!r.live
    })),
    currentPage: g?.current_page ?? 1,
    perPage: g?.per_page ?? 25,
    total: g?.total ?? 0,
    lastPage: g?.last_page ?? 1,
    access: adaptAccess(res?.data?.access)
  }
}

export function adaptSplits(res: ApiSplitsResponse): SplitsResult {
  return {
    splits: (res?.data?.splits ?? []).map((s) => ({
      season: s.season,
      games: s.games ?? 0,
      avg: s.avg ?? '0.000',
      obp: s.obp ?? '0.000',
      slg: s.slg ?? '0.000',
      ops: s.ops ?? '0.000',
      hits: s.hits ?? 0,
      homeRuns: s.homeRuns ?? 0,
      rbi: s.rbi ?? 0,
      qualified: !!s.qualified
    })),
    access: adaptAccess(res?.data?.access)
  }
}

export function adaptLeaderboard(res: ApiLeaderboardResponse): LeaderboardResult {
  const d = res?.data
  return {
    stat: d?.stat ?? 'avg',
    scope: d?.scope ?? '',
    season: d?.season ?? null,
    qualifier: { metric: d?.qualifier?.metric ?? 'plateAppearances', min: d?.qualifier?.min ?? 0 },
    rows: (d?.rows ?? []).map((r) => ({
      rank: r.rank,
      player: {
        id: String(r.player?.id ?? ''),
        name: r.player?.name ?? 'Player',
        avatarUrl: r.player?.avatarUrl ?? undefined
      },
      team: { id: r.team?.id ?? undefined, name: r.team?.name ?? undefined },
      value: r.value ?? '—',
      games: r.games ?? 0
    })),
    viewerRank: d?.viewerRank ? { rank: d.viewerRank.rank, value: d.viewerRank.value } : null,
    access: adaptAccess(d?.access)
  }
}
