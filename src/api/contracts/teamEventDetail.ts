export type EventAttendanceStatus = 'going' | 'not_going' | 'maybe' | 'not_responded'

export interface TeamEventAttendanceMember {
  userId: string
  name: string
  avatarUrl: string | null
  role: string
  uniformNo: string | null
  status: EventAttendanceStatus
}

export interface TeamEventAttendance {
  counts: {
    going: number
    notGoing: number
    maybe: number
    notResponded: number
  }
  currentStatus: EventAttendanceStatus
  members: TeamEventAttendanceMember[]
}

export interface TeamEventOverview {
  id: string
  name: string
  avatarUrl: string | null
  /** True when the current user is a team admin (gates admin-only actions). */
  isAdmin: boolean
  eventType: string | null
  association: string | null
  dates: {
    startDate: string | null
    endDate: string | null
    startTime: string | null
    endTime: string | null
    allDay: boolean
    timezone: string | null
    label: string
  }
  record: { games: number; won: number; lost: number }
  team: { id: string; name: string; logoUrl: string | null }
  director: { name: string | null; email: string | null; phone: string | null }
  location: {
    type: 'in_person' | 'online'
    label: string | null
    address: string | null
    city: string | null
    state: string | null
    zipCode: string | null
    lat: number | null
    lng: number | null
    onlineUrl: string | null
  }
  attendance: TeamEventAttendance
}

export interface EventBoxscore {
  id: string
  guid: string | null
  name: string
  status: 'scheduled' | 'ongoing' | 'final'
  dateLabel: string | null
  timeLabel: string | null
  venue: string | null
  team: { name: string; score: number; logoUrl: string | null }
  opponent: { name: string; score: number }
}

export interface EventBattingStats {
  games: number
  onbase: string
  average: string
  ab: number
  h: number
  oneB: number
  twoB: number
  threeB: number
  hr: number
  rbi: number
  runs: number
  bb: number
  sac: number
  errors: number
}

export interface EventPlayerStat extends EventBattingStats {
  userId: string
  name: string
  avatarUrl: string | null
  role: string
}

export interface EventTeamGameStat extends EventBattingStats {
  gameId: string
  dateLabel: string | null
  opponentName: string
  result: 'won' | 'lost' | null
}

export interface EventTeamStats {
  games: EventTeamGameStat[]
  total: EventBattingStats | null
}
