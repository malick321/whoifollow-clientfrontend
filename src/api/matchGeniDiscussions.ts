import type {
  CreateDiscussionPayload,
  DiscussionAudience,
  EventDiscussion
} from '../types'

// MatchGeni Event Discussions API — mock
// --------------------------------------
// Topic/thread list for an event's Discussions page. Officials / umpires /
// admins start topics (gated by the event's "who can initiate" setting,
// future); everyone with matchgeni access can read. Mock-first (`delay()` +
// in-memory store + `*_ENDPOINT_LIVE = false`), mirroring the other MatchGeni
// mocks. Replies live behind a topic-detail view (future) — the list only
// needs the thread head + `replyCount` + last-activity timestamp.

const SIMULATED_LATENCY_MS = 240
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DISCUSSIONS_ENDPOINT_LIVE = false

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

const DISCUSSIONS_BY_EVENT = new Map<string, EventDiscussion[]>()
let discussionSeq = 0

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString()
}

const SEED: Omit<EventDiscussion, 'id'>[] = [
  {
    title: 'Lineup card drop-off — where + when?',
    excerpt: 'Managers, please drop your lineup cards at the scorer’s table 15 minutes before first pitch.',
    audience: 'teams', authorName: 'Dana Kim', replyCount: 6,
    createdAt: minutesAgo(40), lastActivityAt: minutesAgo(8), status: 'open'
  },
  {
    title: 'Tie-breaker interpretation — Pool B',
    excerpt: 'We had a 3-way tie in Pool B. Confirming we apply head-to-head first, then run differential.',
    audience: 'officials', authorName: 'Pat Lee', replyCount: 11,
    createdAt: minutesAgo(120), lastActivityAt: minutesAgo(22), status: 'open'
  },
  {
    title: 'Umpire rotation for Sunday brackets',
    excerpt: 'Posting the proposed rotation for Sunday — shout if you have a conflict with the 8 AM slot.',
    audience: 'umpires', authorName: 'Robin Vale', replyCount: 4,
    createdAt: minutesAgo(200), lastActivityAt: minutesAgo(45), status: 'open'
  },
  {
    title: 'Parking + gate entry for teams',
    excerpt: 'Lot B is closest to fields 1–4. Team vans can unload at the north gate before 7:30 AM.',
    audience: 'all', authorName: 'Sam Ortiz', replyCount: 2,
    createdAt: minutesAgo(320), lastActivityAt: minutesAgo(70), status: 'open'
  },
  {
    title: 'Rain plan — who decides + when?',
    excerpt: 'If weather rolls in, the TD makes the call by 7 AM and we post here + push a notification.',
    audience: 'all', authorName: 'Jordan Fox', replyCount: 9,
    createdAt: minutesAgo(480), lastActivityAt: minutesAgo(95), status: 'open'
  },
  {
    title: 'Scorebook app login for new officials',
    excerpt: 'A couple of new officials can’t log into the scorebook — sharing the reset steps here.',
    audience: 'officials', authorName: 'Dana Kim', replyCount: 5,
    createdAt: minutesAgo(600), lastActivityAt: minutesAgo(140), status: 'resolved'
  },
  {
    title: 'Field 3 mound height',
    excerpt: 'Field 3 mound felt low this morning — grounds crew is checking before the next game.',
    audience: 'umpires', authorName: 'Alex Day', replyCount: 3,
    createdAt: minutesAgo(720), lastActivityAt: minutesAgo(180), status: 'resolved'
  },
  {
    title: 'Welcome + weekend overview',
    excerpt: 'Welcome everyone! Here’s the high-level schedule and a few reminders before we get going.',
    audience: 'all', authorName: 'Morgan Reed', replyCount: 14,
    createdAt: minutesAgo(1440), lastActivityAt: minutesAgo(300), status: 'open'
  },
  {
    title: 'Protest procedure refresher',
    excerpt: 'Quick refresher on how protests are filed and resolved on-site this weekend.',
    audience: 'officials', authorName: 'Pat Lee', replyCount: 7,
    createdAt: minutesAgo(1700), lastActivityAt: minutesAgo(420), status: 'open'
  },
  {
    title: 'Team check-in cutoff times',
    excerpt: 'Reminder: all teams must complete check-in by 8:30 AM on Day 1 to avoid a forfeit.',
    audience: 'teams', authorName: 'Sam Ortiz', replyCount: 1,
    createdAt: minutesAgo(2100), lastActivityAt: minutesAgo(560), status: 'open'
  },
  {
    title: 'Lost & found at the main tent',
    excerpt: 'Found a few gloves and a water bottle — they’re at the main tent if anyone’s missing gear.',
    audience: 'all', authorName: 'Lee Cruz', replyCount: 0,
    createdAt: minutesAgo(2600), lastActivityAt: minutesAgo(2600), status: 'open'
  },
  {
    title: 'Bracket seeding questions',
    excerpt: 'Collecting seeding questions here so we can answer them in one place before brackets post.',
    audience: 'teams', authorName: 'Jordan Fox', replyCount: 8,
    createdAt: minutesAgo(3200), lastActivityAt: minutesAgo(900), status: 'resolved'
  },
  {
    title: 'Concessions hours',
    excerpt: 'Concessions open 7 AM–6 PM both days; cash + card accepted at the north stand.',
    audience: 'all', authorName: 'Morgan Reed', replyCount: 2,
    createdAt: minutesAgo(4000), lastActivityAt: minutesAgo(1300), status: 'open'
  },
  {
    title: 'Official availability — Day 2',
    excerpt: 'Please confirm your Day 2 availability so we can finalize assignments tonight.',
    audience: 'officials', authorName: 'Robin Vale', replyCount: 10,
    createdAt: minutesAgo(5000), lastActivityAt: minutesAgo(1600), status: 'open'
  },
  {
    title: 'Equipment inspection window',
    excerpt: 'Bat + helmet inspections happen at the north gate from 7–8 AM. Bring everything you plan to use.',
    audience: 'teams', authorName: 'Alex Day', replyCount: 3,
    createdAt: minutesAgo(6200), lastActivityAt: minutesAgo(2200), status: 'open'
  },
  {
    title: 'Post-event survey',
    excerpt: 'We’ll share a short feedback survey after the final — your input shapes next year’s event.',
    audience: 'all', authorName: 'Dana Kim', replyCount: 1,
    createdAt: minutesAgo(7200), lastActivityAt: minutesAgo(3000), status: 'open'
  }
]
let seeded = false
function ensureSeeded(eventId: string) {
  if (seeded) return
  seeded = true
  const list = SEED.map((d) => {
    discussionSeq += 1
    return { ...d, id: `disc-${discussionSeq}` }
  })
  DISCUSSIONS_BY_EVENT.set(eventId, list)
}

/** Topics for an event, newest activity first. */
export async function fetchEventDiscussions(
  _associationId: string,
  eventId: string
): Promise<EventDiscussion[]> {
  ensureSeeded(eventId)
  const list = (DISCUSSIONS_BY_EVENT.get(eventId) ?? []).map((d) => ({ ...d }))
  list.sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0))
  return delay(list)
}

/** Start a new discussion topic. Stamps + stores it, returns the record. */
export async function createDiscussion(
  _associationId: string,
  eventId: string,
  payload: CreateDiscussionPayload,
  authorName = 'You'
): Promise<EventDiscussion> {
  ensureSeeded(eventId)
  discussionSeq += 1
  const now = new Date().toISOString()
  const record: EventDiscussion = {
    id: `disc-${discussionSeq}`,
    title: payload.title.trim(),
    excerpt: payload.body.trim(),
    audience: payload.audience,
    authorName,
    replyCount: 0,
    createdAt: now,
    lastActivityAt: now,
    status: 'open'
  }
  const list = DISCUSSIONS_BY_EVENT.get(eventId) ?? []
  DISCUSSIONS_BY_EVENT.set(eventId, [record, ...list])
  return delay(record)
}

/** Delete a discussion topic. */
export async function deleteDiscussion(
  _associationId: string,
  eventId: string,
  discussionId: string
): Promise<void> {
  const list = DISCUSSIONS_BY_EVENT.get(eventId) ?? []
  DISCUSSIONS_BY_EVENT.set(eventId, list.filter((d) => d.id !== discussionId))
  return delay(undefined)
}

export function discussionAudienceLabel(a: DiscussionAudience): string {
  return a === 'all' ? 'Everyone' : a === 'teams' ? 'Teams' : a === 'officials' ? 'Officials' : 'Umpires'
}
