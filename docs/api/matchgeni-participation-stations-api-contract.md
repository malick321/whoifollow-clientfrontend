---
status: Future phase (design only — NOT built, NOT scheduled)
owner: shared
last_updated: 2026-06-20
---

# MatchGeni Participation Stations — Check-in & Attendance (flip-model QR)

> ⚠️ **Future phase. Nothing here is built or mocked.** This is a captured
> design so the security model is locked in *before* anyone implements it. No
> frontend (`src/`) code, no mock layer, and no endpoints exist yet. Treat this
> as a spec to review, not a contract to wire.

## Context

On event day an association runs **check-in stations** at the venue (front
gate, a field, the registration tent) to record which teams have **arrived**
and, optionally, which rostered **players are present** (attendance). This must
work without letting just *anyone* mark a team present.

The design follows the **flip model** decided in discussion:

- The team's **registration card QR is identity-only** and read-only — safe to
  show in team chat, on a printed card, on the public team page. It can be
  copied/screenshotted, so it must **never** be a write trigger. (That QR — a
  `/r/{association_team_guid}` resolver returning current status — belongs in
  the **teams** contract, not here.)
- The **station screen** displays a **short-lived, server-signed, rotating QR**.
  The **authenticated** manager / lineup player scans *it* with their logged-in
  app. Identity comes from the **scanner's session**; "here, now, this event"
  comes from the **rotating token**. A screenshot from chat is worthless because
  there is no static team QR in the write path.

For shared rules — response envelope, pagination, auth header, error codes,
permission encoding — see [`conventions.md`](./conventions.md). Wire is
camelCase; v2 envelope `{ responseStatus, data }`.

## Why the flip model (threat recap)

| Attempt | Outcome |
|---|---|
| Teammate (not in lineup) sees the team card QR in chat, shows it to a scanner | Nothing — the team card is **identity/read-only**; it is not the write path. |
| Someone screenshots the **station** QR to use later / elsewhere | Fails — token is single-use, expires in seconds, and carries the `eventId` (can't cross events). |
| Non-lineup user scans the live station QR with their app | Rejected at the write step — `403 "not on this team's lineup for this event."` |
| Authorized operator scans a *team* card to mark arrival | Allowed **only** when team-level check-in is operator-driven AND the operator confirms presenter vs roster (human-in-the-loop). Preferred path is the flip model above, which removes the copyable-credential problem entirely. |

**Invariant:** *possession of any QR never equals authority to act.* Writes are
authorized by (a) the rotating token proving station+event+freshness, AND (b)
the scanner's authenticated session proving identity + lineup/manager role.

## Underlying tables (suggested — to be finalized at build time)

| Table | Purpose |
|---|---|
| `participation_stations` | One row per opened station session: `id`, `station_guid`, `event_id`, `gate_label`, `opened_by_user_id`, `opened_at`, `closed_at`, `status` (`open`/`closed`). The per-event binding lives here. |
| `participation_checkins` | One row per check-in/attendance event: `id`, `event_id`, `station_id`, `association_team_id`, `team_id`, `actor_user_id`, `subject_user_id` (NULL for team-level; set for player self-attendance), `kind` (`team_arrival` / `player_attendance`), `occurred_at`, `lat`/`lng` (optional), `metadata_json`. Append-only + audited. |

Rotating **tokens are NOT stored** (stateless, server-signed) in the
recommended model — see §4. A `jti`/nonce replay-cache (short-TTL, e.g. Redis)
enforces single-use.

## Concepts

- **Station session** — opened by an authorized official *for one event* (and
  optional gate/field). Establishes the `eventId` binding; closing it
  immediately invalidates every token it ever issued.
- **Rotating token** — a compact, server-signed blob the station screen renders
  as a QR and refreshes every ~20–30s. Carries the event, station, an expiry,
  and a single-use nonce.
- **Scan-and-write** — the authenticated manager/player's app reads a token and
  POSTs it; the backend validates the token, then authorizes the actor, then
  writes.

## Roles & permissions

- **Open/close a station + operator-confirmed team check-in** → requires
  `manage_scoring` (or a future `manage_attendance`) on the caller's
  `association_users` / `event_officials` row. Same model as the rest of
  MatchGeni — see [`matchgeni-access-api-contract.md`](./matchgeni-access-api-contract.md).
- **Self check-in (scan the station QR)** → any authenticated user, but the
  **write is gated** by their relationship to the team *for that event*:
  - team **manager** (`association_teams.manager_linked_user_id`) → may record
    `team_arrival`.
  - player in the event's **submitted lineup** → may record their own
    `player_attendance` (`subject_user_id = actor`).
  - anyone else → `403`.

---

## 1. Open a station session

- **Endpoint**: `POST /v2/association/events/{associationId}/{eventId}/stations`
- **Auth**: operator with `manage_scoring` / `manage_attendance`.
- **Body**: `{ "gateLabel": "Front gate" }` (optional).
- **Effect**: creates a `participation_stations` row bound to `eventId`; returns
  the station identity the screen uses to start requesting tokens.
- **Response** `201`:
  ```jsonc
  { "data": { "stationId": "st_88", "eventId": 123, "gateLabel": "Front gate", "status": "open" } }
  ```

## 2. Issue / rotate a station token

- **Endpoint**: `GET /v2/stations/{stationId}/token`
- **Auth**: the operator's station session.
- **Effect**: returns a fresh signed token (the station calls this on a ~20–30s
  timer and re-renders the QR). Stateless — nothing persisted except the nonce
  in the replay cache.
- **Token payload** (signed JWT/HMAC — illustrative):
  ```jsonc
  {
    "sid": "st_88",       // station
    "eid": 123,           // EVENT — the per-event binding, signed in
    "gate": "front",
    "exp": 1718900000,    // ~30s out
    "n":   "a9f3c1…"      // single-use nonce
  }
  ```
- The QR encodes a deep link, e.g. `https://app.whoifollow.tech/checkin?t=<token>`.
- **Response** `200`: `{ "data": { "token": "<jwt>", "expiresInSeconds": 30 } }`.

> **Minting options.** (a) **Server-issued** (recommended): station fetches each
> token online; closing the session kills all tokens; fully revocable. (b)
> **Station TOTP** (offline-tolerant): station holds a per-session secret and
> renders `HMAC(secret, timeWindow)` without connectivity — but the *scanner's*
> write still needs the server. Default to (a).

## 3. Scan-and-write (check in / mark attendance)

- **Endpoint**: `POST /v2/checkin`
- **Auth**: the **scanning user's** session (this is what proves identity).
- **Body**: `{ "token": "<from the station QR>", "kind": "team_arrival" | "player_attendance" }`.
- **Backend steps (the whole security model):**
  1. **Validate token** — signature OK, `exp` not passed, `n` not already
     consumed (mark consumed → single-use), station session still `open`.
     ⇒ proves *scanned at station `sid`, for event `eid`, right now*.
  2. **Resolve context** — `eventId` / `stationId` from the token (never from
     the client body).
  3. **Authorize actor** — from the session `actorUserId`: manager of the team
     for `eventId` → may `team_arrival`; lineup player → may `player_attendance`
     for themselves; else `403`.
  4. **Eligibility cross-check** — the team's association registration is
     `active` (not `suspended`/`expired`); surface a clear, non-blocking warning
     otherwise so the operator can decide.
  5. **Write** — append a `participation_checkins` row, **idempotent** (one
     `team_arrival` per team per event; one `player_attendance` per player per
     event), stamped `actorUserId` + `stationId` + `occurred_at`.
- **Response** `200`:
  ```jsonc
  { "data": { "kind": "team_arrival", "eventId": 123, "teamId": "t_382",
              "team": "Action Jackson", "status": "active", "checkedInAt": "…",
              "duplicate": false } }
  ```
- **Errors**: `401` (no session) · `403` (not manager/lineup) · `409`
  (token expired / replayed / station closed) · `422` (malformed).

## 4. Close a station session

- **Endpoint**: `PATCH /v2/stations/{stationId}` → `{ "status": "closed" }`
- **Effect**: sets `closed_at`; all outstanding tokens immediately fail at §3
  step 1 (station no longer `open`).

## 5. Read attendance for an event

- **Endpoint**: `GET /v2/association/events/{associationId}/{eventId}/checkins`
- **Purpose**: powers the live "18 / 24 teams arrived" dashboard + per-team /
  per-player attendance views.
- Returns the `participation_checkins` for the event (filterable by `kind` /
  `stationId` / team), with team identity hydrated.

## Hardening summary

- **QR = identity only; writes need session + fresh station token.** The one
  invariant everything else rests on.
- **Single-use + short TTL** nonce → screenshots/replays die in seconds.
- **`eventId` signed into the token** → a code can't cross events.
- **Idempotent writes** → spamming a scan is a no-op.
- **Fully audited** (`actorUserId` + station + time) → every mark is traceable
  and reversible (an `undo` is a soft-delete on the checkin row).
- **Optional geofence** (`lat`/`lng` on the write) → reject far-from-venue
  self-check-ins.
- **Optional human-in-the-loop** for operator-driven team check-in: the scan
  *proposes*, the operator app shows team + manager + roster, the operator
  *confirms*.

## Dependencies (must exist before build)

- An **operator/station surface** (a screen that opens a session + renders the
  rotating QR) and the **scanner path** in the member app. Without these, the QR
  is decorative — do not build the endpoints in isolation.
- The **submitted-lineup** source for an event (the authorization predicate for
  `player_attendance`) — see the game-lineup / participation contracts.
- The teams **identity resolver** (`/r/{association_team_guid}`, read-only
  status) — separate, lives in the teams contract; referenced here only to make
  the identity-vs-authority split explicit.

## Out of scope (this phase)

- The read-only team-card QR/resolver (teams contract).
- Payments / dues gating at the gate.
- Offline write queueing on the scanner.
- Cross-association / multi-event station sessions (one session = one event).
