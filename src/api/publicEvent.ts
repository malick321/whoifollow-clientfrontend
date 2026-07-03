import { buildV2ApiUrl } from './config'
import type {
  BracketStatus,
  EventHotel,
  EventSponsor,
  PublicDivision,
  PublicDivisionGame,
  PublicDivisionPool,
  PublicDivisionTeam,
  PublicEventPage,
  PublicEventPark
} from '../types'

// Public Event Page — mock aggregator
// -----------------------------------
// Assembles the read-only, unauthenticated event showcase served at
// /public/event/:slug. v1 is mock-only (deterministic by slug); the real
// endpoint (DRAFT, see `docs/api/matchgeni-public-event-api-contract.md`)
// returns the same shape from a single cacheable public GET.

const SIMULATED_LATENCY_MS = 240
const PUBLIC_EVENT_ENDPOINT_LIVE = true

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// Deterministic string hash → stable per-slug variety without randomness.
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

const CITY_TEAMS: [string, string][] = [
  ['Dallas Hawks', 'Dallas, TX'],
  ['Austin Bandits', 'Austin, TX'],
  ['Phoenix Storm', 'Phoenix, AZ'],
  ['Denver Rangers', 'Denver, CO'],
  ['Tampa Aces', 'Tampa, FL'],
  ['Reno Lions', 'Reno, NV'],
  ['Mesa Bulls', 'Mesa, AZ'],
  ['Boise Owls', 'Boise, ID'],
  ['Carson Miners', 'Carson City, NV'],
  ['Vegas Heat', 'Las Vegas, NV']
]
// Distinct division names from gender × age × rating, so 20+ divisions
// don't repeat labels.
const DIVISION_GENDERS = ["Men's", "Women's", "Coed"]
const DIVISION_AGES = [40, 45, 50, 55, 60, 65, 70, 75]
const DIVISION_RATINGS = ['Major+', 'Major', 'AAA', 'AA', 'Platinum']
function divisionName(index: number): string {
  const age = DIVISION_AGES[index % DIVISION_AGES.length]
  const rating = DIVISION_RATINGS[Math.floor(index / DIVISION_AGES.length) % DIVISION_RATINGS.length]
  // Mostly Men's; sprinkle Women's / Coed deterministically.
  const gender = index % 7 === 3 ? DIVISION_GENDERS[1] : index % 11 === 5 ? DIVISION_GENDERS[2] : DIVISION_GENDERS[0]
  return `${gender} ${age} ${rating}`
}
const BRACKET_NAMES = ['Gold', 'Silver', 'Bronze']
const BRACKET_STATUSES: BracketStatus[] = ['completed', 'in_progress', 'initiated', 'pending']
const GAME_DATES = ['2026-04-08', '2026-04-09', '2026-04-10']
const GAME_TIMES = ['09:00 AM', '10:30 AM', '12:00 PM', '01:30 PM', '03:00 PM']
const GAME_FIELDS = ['Field 1', 'Field 2', 'Field 3', 'Field 4']
const GAME_STATUSES: NonNullable<PublicDivisionGame['status']>[] = ['final', 'final', 'live', 'scheduled', 'delayed']

function buildTeams(seedBase: number, count: number): PublicDivisionTeam[] {
  return Array.from({ length: count }, (_, i) => {
    const [name, location] = CITY_TEAMS[(seedBase + i) % CITY_TEAMS.length]
    return {
      teamName: `#${i + 1} ${name}`,
      teamMeta: "Men's 50+ AA",
      location,
      seed: i + 1,
      wins: (i * 2 + 1) % 5,
      losses: (i + 2) % 4
    }
  })
}

function buildDivision(slug: string, index: number): PublicDivision {
  const seed = hashString(`${slug}:${index}`)
  const id = `pub_div_${index}`
  const name = divisionName(index)
  const teamCount = 6 + (seed % 5) // 6..10

  // Pools A / B split.
  const poolAMax = Math.ceil(teamCount / 2)
  const all = buildTeams(seed % CITY_TEAMS.length, teamCount)
  const pools: PublicDivisionPool[] = [
    { id: `${id}_pa`, name: 'Pool A', teams: all.slice(0, poolAMax) },
    { id: `${id}_pb`, name: 'Pool B', teams: all.slice(poolAMax) }
  ].filter((p) => p.teams.length > 0)

  // 1–3 brackets with varied statuses, each fed by a slice of the teams.
  const bracketCount = 1 + (seed % 3)
  const perBracket = Math.max(2, Math.ceil(teamCount / bracketCount))
  const brackets = Array.from({ length: bracketCount }, (_, b) => {
    const slice = all.slice(b * perBracket, b * perBracket + perBracket)
    return {
      id: `${id}_bk_${b}`,
      name: `${BRACKET_NAMES[b] ?? `Bracket ${b + 1}`} Bracket`,
      format: 'Double Elimination',
      status: BRACKET_STATUSES[(seed + b) % BRACKET_STATUSES.length],
      teamCount: slice.length,
      teams: slice.map((t) => ({ teamName: t.teamName, imageUrl: t.imageUrl }))
    }
  })

  // A handful of pool-play games across the dates.
  const gameCount = Math.max(10, Math.ceil(teamCount / 2))
  const games: PublicDivisionGame[] = Array.from({ length: gameCount }, (_, g) => {
    const t1 = all[g % all.length]
    const t2 = all[(g + 1 + (g % Math.max(1, all.length - 1))) % all.length]
    const status = GAME_STATUSES[(seed + g) % GAME_STATUSES.length]
    const scored = status === 'final' || status === 'live'
    return {
      id: `${id}_g_${g}`,
      label: `Pool ${g + 1}`,
      team1: t1.teamName,
      team2: t2.teamName,
      date: GAME_DATES[g % GAME_DATES.length],
      time: GAME_TIMES[g % GAME_TIMES.length],
      field: GAME_FIELDS[g % GAME_FIELDS.length],
      park: 'Centennial Park',
      status,
      team1Score: scored ? 3 + ((g * 2) % 5) : undefined,
      team2Score: scored ? 1 + ((g * 3) % 4) : undefined
    }
  })

  // Pool-play summary (mirrors the admin division-detail Pool Play header).
  const anyLive = games.some((g) => g.status === 'live')
  const allFinal = games.length > 0 && games.every((g) => g.status === 'final')
  const poolStatus: PublicDivision['poolStatus'] = allFinal ? 'completed' : anyLive ? 'in_progress' : 'scheduled'

  return {
    id,
    name,
    dateRangeLabel: 'Apr 8 – Apr 10, 2026',
    teamCount,
    brackets,
    pools,
    games,
    poolStatus,
    poolPlayText: '3 games Round Robin',
    tieBreaker: 'Head to Head, W/L, Runs Differential'
  }
}

function mockSponsors(): EventSponsor[] {
  const logo = (s: string) => `https://cdn.simpleicons.org/${s}`
  return [
    { id: '1', eventId: 'pub', name: 'Nike', websiteUrl: 'https://nike.com/', imageUrl: logo('nike'), status: 1 },
    { id: '2', eventId: 'pub', name: 'Adidas', websiteUrl: 'https://adidas.com/', imageUrl: logo('adidas'), status: 1 },
    { id: '3', eventId: 'pub', name: 'New Balance', websiteUrl: 'https://newbalance.com/', imageUrl: logo('newbalance'), status: 1 },
    { id: '4', eventId: 'pub', name: 'Puma', websiteUrl: 'https://puma.com/', imageUrl: logo('puma'), status: 1 }
  ]
}
// Coordinates centre on Carson City, NV with small offsets so the Map
// Explorer pins spread out. Backend ships real lat/lng later.
function mockParks(): PublicEventPark[] {
  return [
    {
      id: '1', name: 'Centennial Park', location: 'Carson City, NV', address: '851 E William St, Carson City, NV 89701', position: { lat: 39.1638, lng: -119.7674 },
      fieldsInUse: ['Field 1', 'Field 2', 'Field 3'],
      scheduleWindows: [
        { days: 'Tue, Apr 7, 2026', window: '9:00 AM – 8:00 PM' },
        { days: 'Wed, Apr 8 – Sun, Apr 12, 2026', window: '8:00 AM – 8:00 PM' }
      ]
    },
    {
      id: '2', name: 'Riverside Sports Complex', location: 'Carson City, NV', address: '1300 Riverside Dr, Carson City, NV 89703', position: { lat: 39.1521, lng: -119.7401 },
      fieldsInUse: ['Field A', 'Field B'],
      scheduleWindows: [
        { days: 'Wed, Apr 8 – Sun, Apr 12, 2026', window: '8:00 AM – 6:00 PM' }
      ]
    },
    {
      id: '3', name: 'Eagle Valley Fields', location: 'Carson City, NV', address: '2300 Eagle Valley Rd, Carson City, NV 89703', position: { lat: 39.1789, lng: -119.7508 },
      fieldsInUse: ['Field 1', 'Field 2', 'Field 4', 'Field 5'],
      scheduleWindows: [
        { days: 'Thu, Apr 9 – Sat, Apr 11, 2026', window: '9:00 AM – 7:00 PM' }
      ]
    }
  ]
}
function mockHotels(): EventHotel[] {
  return [
    { id: '1', eventId: 'pub', name: 'Marriott Downtown', address: '88 Center St, Carson City, NV', distanceLabel: '0.6 mi', status: 1, position: { lat: 39.1601, lng: -119.7662 } },
    { id: '2', eventId: 'pub', name: 'Hilton Garden Inn', address: '5400 Heritage Way, Carson City, NV', distanceLabel: '1.1 mi', status: 1, position: { lat: 39.1455, lng: -119.7549 } },
    { id: '3', eventId: 'pub', name: 'Hampton Inn & Suites', address: '12 Stadium Rd, Carson City, NV', distanceLabel: '1.8 mi', status: 1, position: { lat: 39.1722, lng: -119.7780 } }
  ]
}

/** ISO datetime a few days out — drives the live registration countdown. */
function deadlineFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  d.setHours(23, 59, 0, 0)
  return d.toISOString()
}

function buildPublicEvent(slug: string): PublicEventPage {
  const seed = hashString(slug)
  const divisionCount = 20 + (seed % 5) // 20..24
  const divisions = Array.from({ length: divisionCount }, (_, i) => buildDivision(slug, i))
  const closeDays = 4 + (seed % 6) // 4..9 days out

  return {
    slug,
    eventName: 'Southwest Championship of Pakistan',
    associationName: 'SSUSA',
    tournamentType: 'Softball (Slow Pitch)',
    eventType: 'Tournament',
    dateRangeLabel: 'Tue, Apr 7 – Sun, Apr 12, 2026',
    location: 'Carson City, NV',
    // Demo cover (remote, deterministic per slug). Absent → gradient hero.
    coverImageUrl: `https://picsum.photos/seed/${encodeURIComponent(slug)}-cover/1600/500`,
    registration: {
      open: true,
      deadline: deadlineFromNow(closeDays),
      deadlineLabel: 'Friday, April 12, 2026 at 11:59PM Central Time',
      feeLabel: '$500',
      spotsLeft: 12 + (seed % 20),
      registerUrl: '#register'
    },
    details: {
      followersLabel: '3.3K people following',
      sportType: 'SSUSA - Softball (Slow Pitch) Tournament',
      directorName: 'Tom Whitesides',
      directorPhone: '+1 (908) 132-4567',
      directorEmail: 'info@user.com',
      entryFeeLabel: '$500',
      entryDeadlineLabel: 'Fri, Apr 14, 2026',
      umpires: ['Jerry Smith', 'Bret Pavlicek', 'Martin John', 'Ameda Williams'],
      timeLimit: 'RR = 65 + open inn, Bracket = 70 + open inn, Championship = 80 + open inn',
      seedCriteria: 'Head to Head, W/L, Runs Differential',
      format: "3 games Round Robin to seed, then a Men's 60+ Platinum Double Elimination bracket.",
      description:
        'Join the Southwest Championship — a multi-day slow-pitch tournament featuring round-robin pool play seeding into double-elimination brackets across multiple age and rating divisions.',
      tournamentFormat:
        'Pool play on day one (3 games) to set seeding, then a double-elimination championship bracket. Higher seeds get the home dugout; ties broken by head-to-head, then run differential.',
      refundPolicy:
        'Full refund up to 14 days before the event. 50% refund within 14 days. No refunds once brackets are posted, except for weather cancellations.',
      reminder:
        'Bring two game balls per team and a copy of your roster. Check in at the tournament tent 45 minutes before your first game.',
      eventNotes:
        'Parking is free at the main lot. Coolers are welcome; no glass containers. Restrooms and concessions are on-site at each park.'
    },
    divisions,
    sponsors: mockSponsors(),
    hotels: mockHotels(),
    parks: mockParks()
  }
}

/** Fetch the public event page for a slug (= event GUID). Read-only,
 *  unauthenticated. Hits `GET /v2/public/events/{slug}`; on any failure it
 *  falls back to the deterministic mock so the page never hard-crashes. */
export async function fetchPublicEventBySlug(slug: string): Promise<PublicEventPage> {
  const key = slug || 'event'
  if (!PUBLIC_EVENT_ENDPOINT_LIVE) {
    return delay(buildPublicEvent(key))
  }
  try {
    const res = await fetch(buildV2ApiUrl(`/public/events/${encodeURIComponent(key)}`), {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return buildPublicEvent(key)
    const envelope = (await res.json()) as { data?: Partial<PublicEventPage> | null }
    const data = envelope?.data
    if (!data) return buildPublicEvent(key)
    // The backend already returns the PublicEventPage shape (camelCase, ISO
    // dates, pre-formatted labels). Defensively fill the arrays the view
    // iterates so a sparse payload can't throw.
    return {
      ...data,
      slug: data.slug ?? key,
      eventName: data.eventName ?? 'Event',
      associationName: data.associationName ?? '',
      tournamentType: data.tournamentType ?? '',
      dateRangeLabel: data.dateRangeLabel ?? '',
      registration: data.registration ?? { open: false, deadline: '', deadlineLabel: '', feeLabel: '' },
      details: data.details ?? ({} as PublicEventPage['details']),
      divisions: data.divisions ?? [],
      sponsors: data.sponsors ?? [],
      hotels: data.hotels ?? [],
      parks: data.parks ?? []
    } as PublicEventPage
  } catch {
    return buildPublicEvent(key)
  }
}
