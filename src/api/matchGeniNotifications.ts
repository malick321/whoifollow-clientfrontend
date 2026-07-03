import type {
  NotificationCategory,
  NotificationChannel,
  NotificationRecipient,
  NotificationTemplate,
  SendNotificationPayload,
  TeamNotification
} from '../types'

// MatchGeni Team Notifications API — mock
// ---------------------------------------
// Admin → team messaging for a division (results, reminders, schedule
// changes, custom). Mock-first (`delay()` + in-memory store +
// `*_ENDPOINT_LIVE = false`), mirroring the other MatchGeni mocks. The real
// backend resolves recipient contacts (manager email / linked user) by
// joining `association_teams`; the mock just records the team names.
// Endpoints drafted in `docs/api/matchgeni-notifications-api-contract.md`.

const SIMULATED_LATENCY_MS = 240
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const NOTIFICATIONS_ENDPOINT_LIVE = false

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

// Sent notifications keyed by division id (newest first), persisted in
// memory so the History tab reflects this session's sends.
const NOTIFICATIONS_BY_DIVISION = new Map<string, TeamNotification[]>()
let notificationSeq = 0

// ── Demo seed ────────────────────────────────────────────────────
// Pre-populate the store with a handful of already-sent notifications so the
// dedicated Notifications page shows realistic history on first load (instead
// of an empty state). The real backend returns these from the event's
// `GET …/notifications` endpoint. `''` is the event-wide composer's key.
function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString()
}

// Deterministic demo divisions (mirror the dashboard's division ids/names).
const SEED_DIVISIONS: { id: string; name: string; teams: number }[] = [
  { id: '1260', name: '50 Major', teams: 10 },
  { id: '1261', name: '55 Gold', teams: 8 },
  { id: '1262', name: '55/60 Platinum', teams: 12 },
  { id: '1263', name: '60 Silver', teams: 9 },
  { id: '1264', name: '60/65 Platinum', teams: 11 },
  { id: '1265', name: '65/70 Major', teams: 7 }
]
const SEED_TEAMS = ['Reno Aces', 'Dallas Bandits', 'Tampa Storm', 'Austin Hawks', 'Mesa Lions', 'Boise Rangers']

// A spread of subject/body copy per category so the seeded history reads
// naturally rather than as obvious filler.
const SEED_COPY: Record<NotificationCategory, { subject: string; body: string }[]> = {
  result: [
    { subject: 'Results posted', body: 'Pool play results are in — check the standings to see your bracket seeding.' },
    { subject: 'Final standings updated', body: 'Final standings for the division have been posted. Congratulations to the winners!' },
    { subject: 'Bracket results live', body: 'Today’s bracket results are now live in the app.' }
  ],
  schedule_change: [
    { subject: 'Schedule update — Saturday games', body: 'Saturday’s 9:00 AM games at Centennial Park have shifted to 9:30 AM. Please check your updated times.' },
    { subject: 'Field reassignment', body: 'Your next game has moved to Field 4. Please head over a few minutes early.' },
    { subject: 'Rain delay — 45 minutes', body: 'Games are delayed 45 minutes due to weather. We’ll post updated start times shortly.' }
  ],
  custom: [
    { subject: 'Welcome to Missouri Open', body: 'Thanks for joining us this weekend — here’s everything you need to know before your first game.' },
    { subject: 'Parking + check-in info', body: 'Parking is available at Lot B. Check in at the main tent when you arrive.' },
    { subject: 'Officials briefing — 8:00 AM Friday', body: 'Please gather at the main tent at 8:00 AM Friday for the pre-event briefing.' }
  ],
  payment_reminder: [
    { subject: 'Payment reminder — Missouri Open', body: 'A balance is still outstanding for your team. Please complete payment to confirm your spot.' },
    { subject: 'Final payment due Friday', body: 'This is a final reminder that your team balance is due Friday.' }
  ],
  registration_reminder: [
    { subject: 'Complete your registration', body: 'Your registration is not yet complete — please finish it to secure your place.' },
    { subject: 'Roster deadline approaching', body: 'Please finalize your roster before the deadline this Wednesday.' }
  ],
  promotion: [
    { subject: 'A note from the organizers', body: 'Visit our partner booths this weekend for exclusive offers and giveaways.' },
    { subject: 'Next event — early-bird pricing', body: 'Early-bird registration for the Fall Classic is open now at a discounted rate.' }
  ]
}
const CATEGORY_CYCLE: NotificationCategory[] = [
  'schedule_change', 'result', 'custom', 'payment_reminder', 'result',
  'schedule_change', 'registration_reminder', 'promotion', 'custom', 'result'
]

/** Build a recipient spec for a seed record, cycling through scope shapes
 *  (all-event / a division / a few teams / all officials / all umpires). */
function seedRecipients(audience: NotificationAudienceTypeLocal, i: number): NotificationRecipient[] {
  if (audience === 'officials') return [{ kind: 'all_officials', label: 'All officials', count: 9 }]
  if (audience === 'umpires') return [{ kind: 'all_umpires', label: 'All umpires', count: 5 }]
  const shape = i % 3
  if (shape === 0) return [{ kind: 'all_event', label: 'All teams', count: 115 }]
  if (shape === 1) {
    const d = SEED_DIVISIONS[i % SEED_DIVISIONS.length]
    return [{ kind: 'division', label: d.name, divisionId: d.id, count: d.teams }]
  }
  const d = SEED_DIVISIONS[i % SEED_DIVISIONS.length]
  const n = (i % 3) + 2
  return Array.from({ length: n }, (_, k) => {
    const name = `${SEED_TEAMS[(i + k) % SEED_TEAMS.length]} ${k + 1}`
    return { kind: 'team' as const, label: name, divisionId: d.id, teamName: name, count: 1 }
  })
}
type NotificationAudienceTypeLocal = 'teams' | 'officials' | 'umpires'

const SEED_COUNT = 26
let seeded = false
function ensureSeeded() {
  if (seeded) return
  seeded = true
  // Roughly: most sends target teams, with periodic officials / umpires blasts.
  for (let i = 0; i < SEED_COUNT; i++) {
    const audience: NotificationAudienceTypeLocal =
      i % 7 === 3 ? 'officials' : i % 7 === 6 ? 'umpires' : 'teams'
    const category = audience === 'teams'
      ? CATEGORY_CYCLE[i % CATEGORY_CYCLE.length]
      : (i % 2 === 0 ? 'custom' : 'schedule_change')
    const copyList = SEED_COPY[category]
    const copy = copyList[i % copyList.length]
    const recipients = seedRecipients(audience, i)
    const divisionId = recipients[0]?.kind === 'division' ? (recipients[0].divisionId ?? '') : ''
    const channels: NotificationChannelLocal[] =
      category === 'payment_reminder' || category === 'registration_reminder'
        ? ['email']
        : i % 4 === 0 ? ['in_app', 'email'] : ['in_app']
    // Spread timestamps from ~30 min ago back across ~12 days (increasing gaps).
    const createdAt = minutesAgo(30 + i * 90 + (i > 8 ? (i - 8) * 240 : 0))
    const record: TeamNotification = {
      id: `seed-${i + 1}`,
      audienceType: audience,
      category,
      audience: category === 'payment_reminder' && audience === 'teams' ? 'manager' : 'team',
      channels,
      subject: audience === 'teams' && recipients[0]?.kind === 'division'
        ? `${copy.subject} — ${recipients[0].label}`
        : copy.subject,
      body: copy.body,
      recipients,
      recipientSummary: recipientSummaryOf(recipients),
      recipientCount: recipientCountOf(recipients),
      createdAt,
      status: 'sent'
    }
    const list = NOTIFICATIONS_BY_DIVISION.get(divisionId) ?? []
    NOTIFICATIONS_BY_DIVISION.set(divisionId, [...list, record])
  }
}
type NotificationChannelLocal = NotificationChannel

/** Default per-category templates. Body carries `{tokens}` the composer
 *  substitutes from the division/event context. */
export function notificationTemplates(): NotificationTemplate[] {
  return [
    {
      category: 'custom',
      label: 'Custom message',
      subject: '',
      body: ''
    },
    {
      category: 'result',
      label: 'Result posted',
      subject: 'Results posted — {divisionName}',
      body: 'Hi {teamName}, results for {divisionName} at {eventName} have been posted. Check the app for the latest standings.'
    },
    {
      category: 'schedule_change',
      label: 'Schedule change',
      subject: 'Schedule update — {divisionName}',
      body: 'Hi {teamName}, there has been a schedule change for {divisionName} at {eventName}. Please review your updated game times in the app.'
    },
    {
      category: 'payment_reminder',
      label: 'Payment reminder',
      subject: 'Payment reminder — {eventName}',
      body: 'Hi {teamName}, this is a reminder that your balance of {amountDue} for {eventName} is due. Please complete your payment to confirm your spot.'
    },
    {
      category: 'registration_reminder',
      label: 'Registration reminder',
      subject: 'Complete your registration — {eventName}',
      body: 'Hi {teamName}, your registration for {eventName} is not yet complete. Please finish it before {validUntil} to secure your place.'
    },
    {
      category: 'promotion',
      label: 'Promotion',
      subject: 'A note from the organizers — {eventName}',
      body: 'Hi {teamName}, '
    }
  ]
}

/** Best-known recipient count across a set of scopes (the backend computes
 *  the authoritative number; the mock sums the per-scope `count` hints). */
export function recipientCountOf(recipients: NotificationRecipient[]): number {
  return recipients.reduce((sum, r) => sum + (r.count ?? (r.kind === 'team' ? 1 : 0)), 0)
}

/** Human-readable summary of a recipient selection (for the History list). */
export function recipientSummaryOf(recipients: NotificationRecipient[]): string {
  if (recipients.some((r) => r.kind === 'all_event')) return 'All teams'
  if (recipients.some((r) => r.kind === 'all_officials')) return 'All officials'
  if (recipients.some((r) => r.kind === 'all_umpires')) return 'All umpires'
  const count = recipientCountOf(recipients)
  // Person audiences (officials / umpires) count people; team scopes count teams.
  const isPeople = recipients.every((r) => r.kind === 'official' || r.kind === 'umpire')
  const noun = isPeople
    ? (count === 1 ? 'recipient' : 'recipients')
    : (count === 1 ? 'team' : 'teams')
  if (recipients.length === 1) return `${recipients[0].label} · ${count} ${noun}`
  return `${count} ${noun} · ${recipients.length} groups`
}

/** Send a notification to a set of recipient scopes. Mock — stamps the
 *  record, stores it (newest first), returns it. */
export async function sendTeamNotification(
  _associationId: string,
  _eventId: string,
  divisionId: string,
  payload: SendNotificationPayload
): Promise<TeamNotification> {
  notificationSeq += 1
  const recipients = payload.recipients.map((r) => ({ ...r }))
  const record: TeamNotification = {
    id: `notif-${notificationSeq}`,
    audienceType: payload.audienceType,
    category: payload.category,
    audience: payload.audience,
    channels: [...payload.channels],
    subject: payload.subject.trim(),
    body: payload.body.trim(),
    recipients,
    recipientSummary: recipientSummaryOf(recipients),
    recipientCount: recipientCountOf(recipients),
    createdAt: new Date().toISOString(),
    status: 'sent'
  }
  const list = NOTIFICATIONS_BY_DIVISION.get(divisionId) ?? []
  NOTIFICATIONS_BY_DIVISION.set(divisionId, [record, ...list])
  return delay(record)
}

/** Recent sends for a division (newest first). */
export async function fetchNotificationHistory(divisionId: string): Promise<TeamNotification[]> {
  ensureSeeded()
  return delay((NOTIFICATIONS_BY_DIVISION.get(divisionId) ?? []).map((n) => ({ ...n })))
}

/** Every notification sent across the whole event (all divisions + the
 *  event-wide composer), newest first. Powers the dedicated Notifications
 *  page's history list. The real backend returns this from a single
 *  `GET …/notifications` endpoint scoped to the event. */
export async function fetchAllNotifications(): Promise<TeamNotification[]> {
  ensureSeeded()
  const all: TeamNotification[] = []
  for (const list of NOTIFICATIONS_BY_DIVISION.values()) {
    for (const n of list) all.push({ ...n })
  }
  all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  return delay(all)
}
