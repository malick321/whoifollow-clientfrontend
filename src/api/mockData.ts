import type {
  FieldConfigPosition,
  GameLineupSubmission,
  ScoresheetCell,
  ScoresheetDetail,
  ScoresheetPlateAppearance,
  TeamParticipation
} from '../types'
import { DEFAULT_SLOW_PITCH_FIELD_POSITIONS } from '../constants/fieldConfig'

const slowPitchFieldConfig: FieldConfigPosition[] = DEFAULT_SLOW_PITCH_FIELD_POSITIONS

const mockPlayerNames = [
  'Paul Edwards',
  'Pete Morton',
  'Moses Luna',
  'Morton Wakefield',
  'Edwards King',
  'Mike Opitz',
  'Jim Shook',
  'Ray Fanning',
  'Bobby Luna',
  'Alex Ward',
  'Tony Field',
  'Chris Warbeck'
]

const mockGameResults: string[][][] = [
  [['1B', '2B'], [], ['BB'], [], ['SAC'], ['HR'], [], ['K'], ['1B']],
  [['GO'], ['BB'], [], ['SAC'], [], ['K'], [], ['1B'], []],
  [['BB'], [], ['SAC'], [], ['K'], [], ['GO'], [], ['1B']],
  [['FO'], [], ['FC'], [], ['1B'], [], ['BB'], [], ['2B']],
  [['SAC'], ['FO'], [], ['K'], [], ['GO'], [], ['BB'], []],
  [[], ['1B'], [], ['BB'], [], ['SAC'], ['FO'], [], ['1B']],
  [['GO'], [], ['1B'], [], ['BB'], [], ['FO'], ['K'], []],
  [[], ['SAC'], [], ['FO'], ['1B'], [], ['GO'], [], ['BB']],
  [['1B'], [], ['GO'], ['BB'], [], ['FO'], [], ['1B'], []],
  [[], ['FO'], ['BB'], [], ['GO'], [], ['1B'], [], ['SAC']],
  [['BB'], [], ['1B'], [], ['FO'], ['GO'], [], ['K'], []],
  [[], ['GO'], [], ['1B'], [], ['BB'], ['SAC'], [], ['FO']]
]

function appearanceNotes(result: string, inningNumber: number, appearanceIndex: number) {
  if (appearanceIndex > 0) {
    return `Second trip in inning ${inningNumber}.`
  }

  switch (result) {
    case '1B':
      return 'Single into the outfield gap.'
    case '2B':
      return 'Extra-base hit to the alley.'
    case 'HR':
      return 'Driven over the outfielders for a home run.'
    case 'BB':
      return 'Worked the count and took the walk.'
    case 'K':
      return 'Strikeout recorded to end the at-bat.'
    case 'SAC':
      return 'Sacrifice result advanced the runners.'
    case 'FC':
      return 'Reached safely on fielder choice.'
    case 'FO':
      return 'Routine fly ball handled by the defense.'
    case 'GO':
      return 'Ground ball turned into an out.'
    default:
      return 'Scored from the handwritten book entry.'
  }
}

function contactTypeForResult(result: string) {
  switch (result) {
    case '1B':
    case '2B':
    case 'HR':
      return 'Line Drive'
    case 'FO':
    case 'SAC':
      return 'Fly Ball'
    case 'GO':
    case 'FC':
      return 'Ground Ball'
    default:
      return ''
  }
}

function baserunningForResult(result: string) {
  switch (result) {
    case '1B':
      return 'Batter to 1B'
    case '2B':
      return 'Batter to 2B'
    case 'HR':
      return 'Batter scored'
    case 'BB':
      return 'Awarded 1B'
    case 'SAC':
      return 'Lead runner advanced'
    case 'FC':
      return 'Force at another base'
    default:
      return ''
  }
}

function batterEndBaseForResult(
  result: string,
  inningIndex: number,
  appearanceIndex: number
): '1B' | '2B' | '3B' | 'HP' | null {
  if (result === 'HR' || result === 'GRH') return 'HP'
  if (result === '3B') return inningIndex % 4 === 0 ? 'HP' : '3B'
  if (result === '2B') return inningIndex % 3 === 0 ? 'HP' : inningIndex % 2 === 0 ? '3B' : '2B'
  if (['1B', 'BB', 'IBB', 'HBP', 'E', 'FC', 'CI', 'OBI'].includes(result)) {
    if (appearanceIndex > 0 && inningIndex % 3 === 0) return 'HP'
    if (inningIndex % 4 === 0) return '2B'
    return '1B'
  }
  return null
}

function fieldZoneForResult(result: string, playerIndex: number, inningIndex: number) {
  const zones = ['Left Center', 'Middle Infield', 'Right Center', 'Left Line', '5-6 Hole']
  if (['BB', 'K'].includes(result)) return ''
  return zones[(playerIndex + inningIndex) % zones.length]
}

function fieldersForResult(result: string, playerIndex: number) {
  const fielders = ['P-1B', 'SS-1B', 'LF', 'CF', '3B-1B']
  if (['BB', 'K', 'HR'].includes(result)) return ''
  return fielders[playerIndex % fielders.length]
}

const submittedGameLineup: GameLineupSubmission = {
  id: 'gls-g1-dudley',
  status: 'approved',
  approvalMode: 'manual',
  sourceType: 'copied_from_event_lineup',
  submittedAt: '2025-04-19 09:40 AM',
  approvedAt: '2025-04-19 09:40 AM',
  rejectionReason: null,
  notes: 'Approved automatically for the game lineup workflow.',
  players: [
    { id: 'glp-1', eventLineupId: '1', playerName: 'John Smith', jerseyNumber: '4', battingOrder: 1, positionCode: 'P', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'team_member' },
    { id: 'glp-2', eventLineupId: '2', playerName: 'David Marcus', jerseyNumber: '11', battingOrder: 2, positionCode: 'SS', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'team_member' },
    { id: 'glp-3', eventLineupId: '3', playerName: 'Anthony Simons', jerseyNumber: '18', battingOrder: 3, positionCode: 'LF', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'team_member' },
    { id: 'glp-4', eventLineupId: '4', playerName: 'Tim Kool', jerseyNumber: '21', battingOrder: 4, positionCode: '1B', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'team_member' },
    { id: 'glp-5', eventLineupId: '6', playerName: 'Michael Johnson', jerseyNumber: '31', battingOrder: 5, positionCode: 'C', isStarter: false, isBench: false, isSubstitute: false, isActive: false, exitedInning: 6, substitutesForId: null, playerSourceType: 'team_member' },
    { id: 'glp-6', eventLineupId: '5', playerName: 'Bretly Martins', jerseyNumber: '25', battingOrder: 6, positionCode: 'RF', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'team_member' },
    { id: 'glp-7', playerName: 'Paul Edwards', jerseyNumber: '32', battingOrder: 7, positionCode: 'LC', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'manual' },
    { id: 'glp-8', playerName: 'Mike Opitz', jerseyNumber: '34', battingOrder: 8, positionCode: 'RC', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'manual' },
    { id: 'glp-9', playerName: 'Jim Shook', jerseyNumber: '36', battingOrder: 9, positionCode: '2B', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'manual' },
    { id: 'glp-10', playerName: 'Ray King', jerseyNumber: '40', battingOrder: 10, positionCode: '3B', isStarter: true, isBench: false, isSubstitute: false, isActive: true, playerSourceType: 'manual' },
    { id: 'glp-11', playerName: 'Bobby Luna', jerseyNumber: '44', battingOrder: 5, positionCode: 'C', isStarter: true, isBench: false, isSubstitute: true, isActive: true, enteredInning: 6, substitutesForId: 'glp-5', playerSourceType: 'manual' }
  ]
}

export const mockParticipation: TeamParticipation = {
  eventId: 'midwest-championship',
  eventName: '2025 Midwest Championship',
  eventDate: 'Fri Apr 13 to Sat Apr 17, 2025 (Pacific Time)',
  // Near-future ISO dates so the weather visibility window (eventStart − 5
  // days through eventEnd) is open when running the app locally against
  // the mock. Set to today + 2 through today + 4 so today always falls
  // inside the window. Adjust if testing a specific date scenario.
  eventStartDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
  eventEndDate: new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10),
  division: "Men's 75+ Major",
  feeStatus: 'registered',
  associationStatus: 'pending',
  participationStatus: 'pending_approval',
  teamName: 'Dudley Lightning 65',
  teamRating: '1300',
  teamAgeGroup: "Men's 65+",
  teamCity: 'Glendale',
  teamState: 'AZ',
  manager: {
    name: 'John Smith',
    email: 'john.smith@wifsoftball.com',
    phone: '(480) 555-0114',
    linkedUserId: 'u-mgr-1'
  },
  teamMembers: [
    { id: 'tm-1', name: 'John Smith', jerseyNumber: '4', defaultPosition: 'P', status: 'active', isPlayer: true },
    { id: 'tm-2', name: 'David Marcus', jerseyNumber: '11', defaultPosition: 'SS', status: 'active', isPlayer: true },
    { id: 'tm-3', name: 'Anthony Simons', jerseyNumber: '18', defaultPosition: 'CF', status: 'active', isPlayer: true },
    { id: 'tm-4', name: 'Tim Kool', jerseyNumber: '21', defaultPosition: '1B', status: 'active', isPlayer: true },
    { id: 'tm-5', name: 'Bretly Martins', jerseyNumber: '25', defaultPosition: 'RF', status: 'active', isPlayer: true },
    { id: 'tm-6', name: 'Michael Johnson', jerseyNumber: '31', defaultPosition: 'C', status: 'active', isPlayer: true },
    { id: 'tm-7', name: 'Paul Edwards', jerseyNumber: '32', defaultPosition: 'LC', status: 'active', isPlayer: true },
    { id: 'tm-8', name: 'Mike Opitz', jerseyNumber: '34', defaultPosition: 'RC', status: 'active', isPlayer: true },
    { id: 'tm-9', name: 'Jim Shook', jerseyNumber: '36', defaultPosition: '2B', status: 'active', isPlayer: true },
    { id: 'tm-10', name: 'Ray King', jerseyNumber: '40', defaultPosition: '3B', status: 'active', isPlayer: true },
    { id: 'tm-11', name: 'Bobby Luna', jerseyNumber: '44', defaultPosition: 'EH', status: 'bench', isPlayer: true },
    { id: 'tm-12', name: 'Chris Warbeck', jerseyNumber: '47', defaultPosition: 'LF', status: 'bench', isPlayer: true }
  ],
  fieldConfigName: 'Slow Pitch 10 Player',
  fieldConfigPositions: slowPitchFieldConfig,
  eventOverview: {
    // Structured lineup summary (mirrors the new backend shape). First
    // ten are starters, last two are bench — matches the teamMembers
    // array above for visual consistency in dev.
    lineupSummary: [
      { userId: 'u-1', jerseyNumber: '7',  name: 'John Smith',      position: 'P',  isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-2', jerseyNumber: '12', name: 'David Macus',     position: 'C',  isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-3', jerseyNumber: '3',  name: 'Anthony Simons',  position: '1B', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-4', jerseyNumber: '21', name: 'Tim Kool',        position: '2B', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-5', jerseyNumber: '9',  name: 'Bretly Martins',  position: '3B', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-6', jerseyNumber: '15', name: 'Micheal Johnson', position: 'SS', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-7', jerseyNumber: '22', name: 'Tim Kool',        position: 'LF', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-8', jerseyNumber: '8',  name: 'John Smith',      position: 'LC', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-9', jerseyNumber: '24', name: 'David Macus',     position: 'RC', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-10', jerseyNumber: '2', name: 'Tim Smith',       position: 'RF', isStarter: true,  isActive: true,  isBench: false },
      { userId: 'u-11', jerseyNumber: '44', name: 'Bobby Luna',     position: 'EH', isStarter: false, isActive: false, isBench: true },
      { userId: 'u-12', jerseyNumber: '47', name: 'Chris Warbeck',  position: 'LF', isStarter: false, isActive: false, isBench: true }
    ],
    venueText: 'Century Sports Complex Bullhead City, AZ',
    forecast: [
      { label: 'Oct 01', icon: 'partly-cloudy', high: 64, low: 43 },
      { label: 'Oct 02', icon: 'partly-cloudy', high: 64, low: 43 },
      { label: 'Oct 03', icon: 'partly-cloudy', high: 64, low: 43 },
      { label: 'Oct 04', icon: 'partly-cloudy', high: 64, low: 43 },
      { label: 'Oct 05', icon: 'rain', high: 64, low: 43 }
    ],
    attendeeCount: 17
  },
  divisionOverview: {
    tieBreakerText: 'Seed Head to Head, W/L, Runs Differential',
    formatText: "Format 3 games Round Robin to seed Men's 60+ platinum Double Elimination bracket.",
    podium: [
      { rankLabel: 'Winner', teamName: 'Dudley Lightning 65', note: 'KPI', runsDifferential: '+12', bracketRecord: '2-1' },
      { rankLabel: '2nd', teamName: 'Vegas Boyz', note: 'KPI', runsDifferential: '+4', bracketRecord: '1-1' },
      { rankLabel: '3rd', teamName: 'Desert Storm', note: 'KPI', runsDifferential: '-1', bracketRecord: '0-2' }
    ],
    standings: [
      {
        seed: 1,
        wins: 3,
        losses: 2,
        teamName: '#1: Vegas Boyz',
        teamMeta: '60 Older - Major',
        location: 'Pheonix, AZ'
      },
      {
        seed: 2,
        wins: 2,
        losses: 2,
        teamName: '#4: Dudley Lightning 65',
        teamMeta: '65 Older - Major',
        location: 'Mesa, AZ'
      },
      {
        seed: 3,
        wins: 1,
        losses: 3,
        teamName: '#7: Desert Storm',
        teamMeta: '60 Older - AAA',
        location: 'Scottsdale, AZ'
      }
    ]
  },
  lineup: [
    { id: '1', battingOrder: 1, teamMemberId: 'tm-1', jerseyNumber: '4', name: 'John Smith', position: 'P', status: 'active', playerSourceType: 'team_member' },
    { id: '2', battingOrder: 2, teamMemberId: 'tm-2', jerseyNumber: '11', name: 'David Marcus', position: 'SS', status: 'active', playerSourceType: 'team_member' },
    { id: '3', battingOrder: 3, teamMemberId: 'tm-3', jerseyNumber: '18', name: 'Anthony Simons', position: 'CF', status: 'active', playerSourceType: 'team_member' },
    { id: '4', battingOrder: 4, teamMemberId: 'tm-4', jerseyNumber: '21', name: 'Tim Kool', position: '1B', status: 'active', playerSourceType: 'team_member' },
    { id: '5', battingOrder: 5, teamMemberId: 'tm-5', jerseyNumber: '25', name: 'Bretly Martins', position: 'RF', status: 'active', playerSourceType: 'team_member' },
    { id: '6', battingOrder: 6, teamMemberId: 'tm-6', jerseyNumber: '31', name: 'Michael Johnson', position: 'C', status: 'active', playerSourceType: 'team_member' },
    { id: '7', battingOrder: 7, teamMemberId: 'tm-7', jerseyNumber: '32', name: 'Paul Edwards', position: 'LC', status: 'active', playerSourceType: 'team_member' },
    { id: '8', battingOrder: 8, teamMemberId: 'tm-8', jerseyNumber: '34', name: 'Mike Opitz', position: 'RC', status: 'active', playerSourceType: 'team_member' },
    { id: '9', battingOrder: 9, teamMemberId: 'tm-9', jerseyNumber: '36', name: 'Jim Shook', position: '2B', status: 'active', playerSourceType: 'team_member' },
    { id: '10', battingOrder: 10, teamMemberId: 'tm-10', jerseyNumber: '40', name: 'Ray King', position: '3B', status: 'active', playerSourceType: 'team_member' },
    { id: '11', battingOrder: 11, teamMemberId: 'tm-11', jerseyNumber: '44', name: 'Bobby Luna', position: 'EH', status: 'bench', playerSourceType: 'team_member' }
  ],
  games: [
    {
      id: 'g1',
      bracketLabel: 'Pool 1',
      gameTime: 'Fri Apr 19, 11:00 AM',
      dateLabel: 'Fri, April 19, 2024',
      timeLabel: '11:00 AM',
      field: 'Field 1',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'Vegas Boyz',
      opponentSeed: '#1',
      teamSeed: '#4',
      scoreFor: 2,
      scoreAgainst: 5,
      status: 'final',
      badgeCount: 1,
      lineupSubmitted: true,
      scoresheetStatus: 'mapped'
    },
    {
      id: 'g2',
      bracketLabel: 'Pool 1',
      gameTime: 'Fri Apr 19, 09:30 AM',
      dateLabel: 'Fri, April 19, 2024',
      timeLabel: '09:30 AM',
      field: 'Field 1',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'Vegas Boyz',
      opponentSeed: '#1',
      teamSeed: '#4',
      scoreFor: 0,
      scoreAgainst: 0,
      status: 'live',
      statusNote: 'Live',
      badgeCount: 1,
      lineupSubmitted: true,
      scoresheetStatus: 'review'
    },
    {
      id: 'g3',
      bracketLabel: 'Delayed',
      gameTime: 'Fri Apr 19, 01:15 PM',
      dateLabel: 'Fri, April 19, 2024',
      timeLabel: '01:15 PM',
      field: 'Field 3',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'Arizona Heat',
      opponentSeed: '#3',
      teamSeed: '#4',
      scoreFor: 6,
      scoreAgainst: 6,
      status: 'live',
      statusNote: 'Delayed',
      badgeCount: 3,
      lineupSubmitted: true,
      scoresheetStatus: 'review'
    },
    {
      id: 'g7',
      bracketLabel: 'G1',
      gameTime: 'Sat Apr 20, 11:00 AM',
      dateLabel: 'Sat, April 20, 2024',
      timeLabel: '11:00 AM',
      field: 'Field 2',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'TBD',
      opponentSeed: '#1',
      teamSeed: '#4',
      status: 'scheduled',
      statusNote: 'Match yet to begin',
      lineupSubmitted: false,
      scoresheetStatus: 'idle'
    },
    {
      id: 'g4',
      bracketLabel: 'G4',
      gameTime: 'Sat Apr 20, 09:00 AM',
      dateLabel: 'Sat, April 20, 2024',
      timeLabel: '09:00 AM',
      field: 'Field 1',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'Vegas Boyz',
      opponentSeed: '#1',
      teamSeed: '#4',
      status: 'scheduled',
      statusNote: 'Match yet to begin',
      lineupSubmitted: false,
      scoresheetStatus: 'idle'
    },
    {
      id: 'g5',
      bracketLabel: 'Championship',
      gameTime: 'Sat Apr 20, 01:00 PM',
      dateLabel: 'Sat, April 20, 2024',
      timeLabel: '01:00 PM',
      field: 'Field 2',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'Desert Storm',
      opponentSeed: '#7',
      teamSeed: '#4',
      status: 'scheduled',
      statusNote: 'Match yet to begin',
      lineupSubmitted: false,
      scoresheetStatus: 'idle'
    },
    {
      id: 'g6',
      bracketLabel: 'Championship - IF',
      gameTime: 'Sat Apr 20, 03:30 PM',
      dateLabel: 'Sat, April 20, 2024',
      timeLabel: '03:30 PM',
      field: 'Field 2',
      facilityLabel: 'Homefield Baseball Complex',
      divisionLabel: "Men's 65/70+ Silver Division - The Proton Stage",
      opponent: 'Arizona Heat',
      opponentSeed: '#3',
      teamSeed: '#4',
      status: 'scheduled',
      statusNote: 'Match yet to begin',
      lineupSubmitted: false,
      scoresheetStatus: 'idle'
    }
  ]
}

export const mockScoresheet: ScoresheetDetail = {
  gameId: 'g1',
  eventName: mockParticipation.eventName,
  teamName: 'Dudley Lightning 65',
  teamAvatarUrl: undefined,
  opponent: 'Vegas Boyz',
  opponentAvatarUrl: undefined,
  teamSeed: '#4',
  opponentSeed: '#1',
  teamSide: 'V',
  opponentSide: 'H',
  bracketLabel: 'Pool 1',
  division: mockParticipation.division,
  gameTime: 'Fri Apr 19, 11:00 AM',
  actualStartTime: undefined,
  timeLimit: '65 min',
  venueField: 'Field 1',
  venuePark: 'Homefield',
  venueCity: 'Bullhead City',
  venueState: 'AZ',
  teamLineScores: [1, 0, 2, 1, 0, 3, 0, 1, 2],
  opponentLineScores: [0, 1, 0, 2, 1, 0, 1, 0, 0],
  teamHomeRuns: 1,
  opponentHomeRuns: 0,
  currentInning: null,
  currentBattingTeamSide: undefined,
  gameStatusCode: undefined,
  gameStatusLabel: undefined,
  isDelayed: false,
  delayReason: undefined,
  isLive: false,
  manager: mockParticipation.manager,
  uploadStatus: 'review',
  sourceImageName: 'qroKKUrXS5PaPbrylWgWkOJx1PAby6Dz18sEWijL.jpg',
  extractionConfidence: 92,
  notes: 'Uploaded image is ready for mapping review before team stats publish.',
  gameLineupSubmitted: true,
  fieldConfigName: 'Slow Pitch 10 Player',
  fieldConfigPositions: slowPitchFieldConfig,
  gameLineupSubmission: submittedGameLineup,
  lineupOptions: structuredClone(mockParticipation.lineup),
  reviewItems: [
    {
      id: 'r1',
      title: 'Upload captured',
      detail: 'Handwritten sheet is attached and OCR is staged for review.',
      tone: 'success'
    },
    {
      id: 'r2',
      title: '2 player names need confirmation',
      detail: 'Pete and Morton were matched with medium confidence from handwriting.',
      tone: 'warning'
    },
    {
      id: 'r3',
      title: '3 plays need field-path confirmation',
      detail: 'Balls in play for innings 2, 4, and 6 are missing defender detail.',
      tone: 'info'
    }
  ],
  players: Array.from({ length: 12 }, (_, index) => {
    const cells: ScoresheetCell[] = Array.from({ length: 9 }, (_, inningIndex) => {
      const inningNumber = inningIndex + 1
      const inningResults = mockGameResults[index]?.[inningIndex] ?? []
      const appearances: ScoresheetPlateAppearance[] = inningResults.map((result, appearanceIndex) => ({
        id: `p${index + 1}-i${inningNumber}-a${appearanceIndex + 1}`,
        sequence: appearanceIndex + 1,
        result,
        batterEndBase: batterEndBaseForResult(result, inningIndex, appearanceIndex),
        contactType: contactTypeForResult(result),
        rbi: ['HR', '2B', '1B'].includes(result) && inningIndex % 3 === 0 ? 1 : 0,
        outsOnPlay: ['GO', 'FO', 'K', 'SAC'].includes(result) ? 1 : 0,
        baserunning: baserunningForResult(result),
        fieldZone: fieldZoneForResult(result, index, inningIndex),
        fieldersInvolved: fieldersForResult(result, index),
        notes: appearanceNotes(result, inningNumber, appearanceIndex)
      }))

      return {
        inning: inningNumber,
        reviewState: inningResults.length === 0 ? 'empty' : inningIndex < 5 ? 'verified' : 'review',
        appearances
      }
    })

    const allAppearances = cells.flatMap((cell) => cell.appearances)
    const runs = allAppearances.filter((appearance) => appearance.batterEndBase === 'HP').length
    const hits = allAppearances.filter((appearance) => ['1B', '2B', '3B', 'HR'].includes(appearance.result)).length
    const rbi = allAppearances.reduce((sum, appearance) => sum + (appearance.rbi ?? 0), 0)

    return {
      id: `p${index + 1}`,
      battingOrder: index + 1,
      jerseyNumber: `${index + 4}`,
      playerName: mockPlayerNames[index] ?? `Player ${index + 1}`,
      mappedLineupId: mockParticipation.lineup[index % mockParticipation.lineup.length]?.id,
      mappedLineupName: mockParticipation.lineup[index % mockParticipation.lineup.length]?.name,
      mappingState: index < 7 ? 'matched' : index < 10 ? 'review' : 'unmapped',
      innings: Array.from({ length: 9 }, (_, inningIndex) => ({
        inning: inningIndex + 1,
        runs: '',
        outcome: ''
      })),
      cells,
      runs,
      hits,
      rbi
    }
  })
}
