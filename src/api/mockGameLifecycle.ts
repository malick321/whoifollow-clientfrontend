// Mock game-lifecycle fetcher
// ----------------------------
// V1 stand-in for the production game-lifecycle audit-log endpoint
// (`/v2/matchgeni/games/:gameId/lifecycle` — not yet shipped on the
// backend). Returns the EXACT `GameLifecycleEntry[]` shape the
// production API will return so consumers (the `GameLifecycleLogModal`
// timeline) treat the mock and the real API identically — when
// backend ships, swap this import for the real fetcher and delete.
//
// Determinism: every output is hashed off the `gameId` so reloading
// the demo surfaces the SAME audit-log entries for the same game in
// the same order. The lifecycle progression is generated based on
// the game's current `status`:
//   - scheduled → empty log (game hasn't started yet)
//   - live      → start + (maybe) a delay/resume pair + some
//                 add_inning rows up to the current top inning
//   - delayed   → same as live, plus a trailing mark_delayed row
//                 that doesn't have a matching resume yet
//   - final     → same as live, plus an end_game row, plus (if
//                 locked) a lock row
//
// Reason strings + actor names + timestamps are all derived from
// the same hash so the timeline reads as a plausible single game's
// history without any per-render randomness.

import type {
  GameLifecycleActionType,
  GameLifecycleEntry,
  SchedulerGame
} from '../types'

const SIMULATED_LATENCY_MS = 140

const MOCK_ACTOR_POOL = [
  'B. Carter', 'N. Reed', 'F. Lopez', 'G. Patel',
  'C. Wright', 'E. Harris', 'V. Singh', 'O. Khan',
  'A. Smith', 'J. Johnson'
]

const MOCK_DELAY_REASONS = [
  'Rain delay',
  'Lightning in area',
  'Field maintenance',
  'Equipment failure',
  'Late team arrival',
  'Heat advisory pause'
]

/** djb2-ish string hash → unsigned 32-bit. Used to seed all the
 *  deterministic picks below so re-reading the same `gameId`
 *  always returns the same lifecycle history. */
function hashString(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0
  }
  return h
}

function pickActor(hash: number, offset: number): string {
  const idx = ((hash >>> (offset * 3)) + offset * 7) % MOCK_ACTOR_POOL.length
  return MOCK_ACTOR_POOL[idx] ?? 'Unknown'
}

function pickDelayReason(hash: number): string {
  const idx = (hash >>> 11) % MOCK_DELAY_REASONS.length
  return MOCK_DELAY_REASONS[idx] ?? 'Unspecified'
}

/** Build an ISO timestamp `minutesAgo` minutes before "now". The
 *  log entries are stamped going BACKWARDS from now so the most
 *  recent action sits at the bottom of the chronological list (or
 *  at the top once the timeline reverses for display). */
function isoMinutesAgo(minutesAgo: number): string {
  const ms = Date.now() - minutesAgo * 60_000
  return new Date(ms).toISOString()
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), SIMULATED_LATENCY_MS))
}

/** Construct the synthetic lifecycle log for one game. Public
 *  signature matches the production `fetchGameLifecycle(gameId)`
 *  call this will be replaced with. */
export async function mockFetchGameLifecycle(
  game: SchedulerGame
): Promise<GameLifecycleEntry[]> {
  const entries: GameLifecycleEntry[] = []
  const hash = hashString(game.id)
  const status = game.status ?? 'scheduled'

  // Game still scheduled — no lifecycle history yet.
  if (status === 'scheduled') {
    return delay(entries)
  }

  // How long ago the game started, in minutes. 90–180 min covers a
  // typical slow-pitch double-header range.
  const startMinutesAgo = 90 + (hash % 90)

  let runningId = 1
  function pushEntry(partial: Partial<GameLifecycleEntry> & {
    actionType: GameLifecycleActionType
    actorName: string
    minutesAgo: number
  }): void {
    const occurredAt = isoMinutesAgo(partial.minutesAgo)
    entries.push({
      id: String(runningId++),
      gameId: game.id,
      actionType: partial.actionType,
      actorUserId: null,
      actorName: partial.actorName,
      occurredAt,
      fromStatus: partial.fromStatus ?? null,
      toStatus: partial.toStatus ?? null,
      reason: partial.reason ?? null,
      inningNumber: partial.inningNumber ?? null,
      metadata: partial.metadata ?? {},
      createdAt: occurredAt,
      updatedAt: occurredAt
    })
  }

  // ── 1. Start ────────────────────────────────────────────────────
  pushEntry({
    actionType: 'start',
    actorName: pickActor(hash, 0),
    minutesAgo: startMinutesAgo,
    fromStatus: 'scheduled',
    toStatus: 'live'
  })

  // ── 2. Lineup submissions (one per side) ────────────────────────
  // Lineup confirmations happen shortly after start — the home team
  // first (per common slow-pitch protocol), then visitor.
  pushEntry({
    actionType: 'lineup_submit',
    actorName: pickActor(hash, 1),
    minutesAgo: startMinutesAgo - 3,
    metadata: { side: 'home' }
  })
  pushEntry({
    actionType: 'lineup_submit',
    actorName: pickActor(hash, 2),
    minutesAgo: startMinutesAgo - 6,
    metadata: { side: 'visitor' }
  })

  // 1-in-5 games show an early home/visitor swap — operator
  // realized the sides were flipped right after start and
  // corrected it. Adds variety to the timeline + exercises the
  // `swap_sides` action-type rendering.
  if ((hash >> 9) % 5 === 0) {
    pushEntry({
      actionType: 'swap_sides',
      actorName: pickActor(hash, 22),
      minutesAgo: startMinutesAgo - 7
    })
  }

  // ── 3. Inning progression ──────────────────────────────────────
  // Each inning takes ~12-18 minutes. We add inning rows up to a
  // count derived from how long the game has been running. The
  // live game's "current inning" is roughly elapsed / 15.
  const elapsedMinutes = startMinutesAgo
  const totalInnings = Math.min(
    9,
    Math.max(1, Math.floor((elapsedMinutes - 10) / 15))
  )
  for (let i = 1; i <= totalInnings; i++) {
    const inningOpenedMinutesAgo = startMinutesAgo - 6 - i * 15
    if (inningOpenedMinutesAgo < 0) break
    pushEntry({
      actionType: 'add_inning',
      actorName: pickActor(hash, 3 + i),
      minutesAgo: inningOpenedMinutesAgo,
      inningNumber: i
    })
  }

  // 1-in-4 games show a delete_inning entry — operator opened an
  // extra inning by mistake and immediately removed it. Targets
  // an inning beyond the current `totalInnings` so the active log
  // stays consistent (e.g. log shows inning 6 opened then deleted,
  // current real inning count is still 5).
  if (totalInnings >= 2 && (hash >> 13) % 4 === 0) {
    const ghostInning = totalInnings + 1
    const ghostMinutesAgo = startMinutesAgo - 6 - ghostInning * 15 + 3
    if (ghostMinutesAgo > 0) {
      pushEntry({
        actionType: 'add_inning',
        actorName: pickActor(hash, 30),
        minutesAgo: ghostMinutesAgo,
        inningNumber: ghostInning
      })
      pushEntry({
        actionType: 'delete_inning',
        actorName: pickActor(hash, 31),
        minutesAgo: ghostMinutesAgo - 2,
        inningNumber: ghostInning,
        reason: 'Opened by mistake'
      })
    }
  }

  // ── 4. Delayed games — trailing mark_delayed row ───────────────
  // Insert AFTER all the innings so the delay reads as "the game
  // paused mid-stream". For `live` games we may insert a resolved
  // delay/resume PAIR earlier in the timeline.
  if (status === 'live' && (hash >> 17) % 3 === 0) {
    // 1-in-3 live games show a historical (resolved) delay/resume
    // pair in their log so the timeline reads "we paused, then
    // came back" without affecting the current state.
    const delayMinutesAgo = Math.floor(startMinutesAgo / 2) + 5
    const resumeMinutesAgo = delayMinutesAgo - 8
    pushEntry({
      actionType: 'mark_delayed',
      actorName: pickActor(hash, 13),
      minutesAgo: delayMinutesAgo,
      fromStatus: 'live',
      toStatus: 'delayed',
      reason: pickDelayReason(hash)
    })
    pushEntry({
      actionType: 'resume',
      actorName: pickActor(hash, 14),
      minutesAgo: resumeMinutesAgo,
      fromStatus: 'delayed',
      toStatus: 'live'
    })
  }

  if (status === 'delayed') {
    pushEntry({
      actionType: 'mark_delayed',
      actorName: pickActor(hash, 13),
      minutesAgo: 5,
      fromStatus: 'live',
      toStatus: 'delayed',
      reason: game.delayReason ?? pickDelayReason(hash)
    })
  }

  // ── 5. Final games — end_game (and lock if locked) ─────────────
  if (status === 'final') {
    // 1-in-6 final games went through an end → reopen → end cycle
    // — operator confirmed final, then realized a scoring error
    // needed correction, reopened, re-confirmed. Shows the
    // `reopen_game` action-type in the log + demonstrates that
    // `end_game` can fire twice for the same game.
    if ((hash >> 19) % 6 === 0) {
      pushEntry({
        actionType: 'end_game',
        actorName: pickActor(hash, 18),
        minutesAgo: 22,
        fromStatus: 'live',
        toStatus: 'final'
      })
      pushEntry({
        actionType: 'reopen_game',
        actorName: pickActor(hash, 19),
        minutesAgo: 18,
        fromStatus: 'final',
        toStatus: 'live',
        reason: 'Inning 4 score correction needed'
      })
    }
    pushEntry({
      actionType: 'end_game',
      actorName: pickActor(hash, 20),
      minutesAgo: 8,
      fromStatus: 'live',
      toStatus: 'final'
    })
    if (game.locked) {
      pushEntry({
        actionType: 'lock',
        actorName: pickActor(hash, 21),
        minutesAgo: 2
      })
    }
  }

  // Newest first — reverse the chronological insert order so the
  // timeline reads top-down "most recent → oldest" like the team
  // lifecycle log does.
  return delay(entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)))
}
