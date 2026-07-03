---
status: Draft
owner: shared
last_updated: 2026-06-07
---

# MatchGeni Team Notifications — REST API contract

> **DRAFT — not yet implemented.** The frontend ships **mock-first**: the
> client + types below live in `src/api/matchGeniNotifications.ts` +
> `src/types.ts` and back the **"Notify teams"** composer
> (`src/components/SendNotificationModal.vue`) with in-memory data
> (`NOTIFICATIONS_ENDPOINT_LIVE = false`). The endpoints, payloads, and the
> `team_notifications` / `team_notification_recipients` **SQL schema are
> finalised jointly with the user** before any backend work. Treat
> everything here as a proposal to react to, not a settled contract.

## Context

Lets an association admin **message a division's teams** — result posted,
schedule change, payment / registration reminders, promotions, or an ad-hoc
custom note. Entry point is **division-wide** (the "Notify teams" button in
the division-detail pools bar), gated by `manage_divisions` write access
(`canMatchGeniWrite('manage_divisions')`).

**Scope (core, this pass):** compose + send + per-division history, two
channels (**in-app + email**), audience = **whole team vs manager only**.
Recipients are expressed as **scope tokens** (see below) — all teams, a whole
division, a pool, or individual teams — so the common cases never enumerate a
team list. The same composer is **reused in "targeted" mode** from other
flows (a schedule change / result upload) by passing preset recipient scopes
+ a preset category. **Deferred:** per-event auto/prompt/off settings,
lifecycle auto-send hooks (delay / result / field-change), per-game
scoring-drawer entry, SMS, and a real in-app inbox.

All endpoints are rooted under
`/v2/association/events/{associationId}/{eventId}/divisions/{divisionId}/...`
(proposed). For shared rules — response envelope, auth header, error codes —
see [`conventions.md`](./conventions.md). **Wire format is camelCase.** ID
literals below use prefixed stubs (`notif_…`, `team_…`) for doc readability
only; production serializes the bare `BIGINT UNSIGNED` PK as a numeric string.

## Recipient scopes (important)

Recipients are sent as a list of **scope tokens** (`NotificationRecipient`,
`src/types.ts`) rather than an enumerated team list — so selecting "all teams"
or "a whole division" costs nothing client-side (no team fetch):

```ts
type NotificationRecipientKind = 'all_event' | 'division' | 'pool' | 'team'
interface NotificationRecipient {
  kind: NotificationRecipientKind
  label: string          // chip display
  divisionId?: string    // division / pool / team
  poolId?: string        // pool
  teamName?: string       // team
  count?: number          // display hint (division → teamCount, team → 1, …)
}
```

The **backend expands each scope** to the underlying teams and resolves
contacts via `association_teams`:
- `all_event` → every team in the event.
- `division` → every team in that division.
- `pool` → every team in that pool.
- `team` → that one team (keyed by name in the mock; prefer `teamId` once the
  standings payload exposes one).

Then, per `audience`:
- `team` → in-app fan-out to every linked team member + the manager; email to
  the team's contact email.
- `manager` → only `managerEmail` / `manager_linked_user_id`.

**Recommendation:** add `teamId` to the standings response so `team` scopes
key on a stable id rather than a display name; and expose pool ids on the
standings payload so `pool` scopes round-trip cleanly.

## Endpoints

### 1. List notification templates

`GET …/notification-templates`

Default per-category message catalogue (subject + tokenised body). The body
carries `{teamName} {eventName} {divisionName} {amountDue} {validUntil}`
placeholders the client substitutes from the division/event context;
`{teamName}` is left for the backend to personalise per recipient.

```jsonc
{
  "templates": [
    { "category": "custom", "label": "Custom message", "subject": "", "body": "" },
    { "category": "result", "label": "Result posted",
      "subject": "Results posted — {divisionName}",
      "body": "Hi {teamName}, results for {divisionName} at {eventName} have been posted…" }
    // schedule_change, payment_reminder, registration_reminder, promotion …
  ]
}
```

### 2. Send a notification

`POST …/notifications`

```jsonc
// Request
{
  "category": "schedule_change",          // NotificationCategory
  "audience": "team",                      // 'team' | 'manager'
  "channels": ["in_app", "email"],         // NotificationChannel[]
  "subject": "Schedule update — Men's 40 Major+",
  "body": "Your Saturday games have moved…",
  "recipients": [                           // NotificationRecipient[] scopes
    { "kind": "division", "label": "Men's 40 Major+", "divisionId": "12", "count": 12 },
    { "kind": "team", "label": "Sharks", "divisionId": "9", "teamName": "Sharks", "count": 1 }
  ]
}
```

```jsonc
// Response 201 — the stored record
{
  "id": "notif_8123",
  "category": "schedule_change",
  "audience": "team",
  "channels": ["in_app", "email"],
  "subject": "Schedule update — Men's 40 Major+",
  "body": "Your Saturday games have moved…",
  "recipients": [ /* the scopes above */ ],
  "recipientSummary": "13 teams · 2 groups",  // human-readable
  "recipientCount": 13,
  "createdAt": "2026-06-07T15:30:00Z",
  "createdBy": "user_44",
  "status": "sent"                         // 'sent' | 'queued' | 'failed'
}
```

Validation: ≥1 recipient scope, ≥1 channel, non-empty `subject`. `403`
without `manage_divisions`. Email delivery is async — `status` may be
`queued` until the mailer confirms; the mock always stamps `sent`.

### 3. List sent notifications (history)

`GET …/notifications`

Returns this division's sends, **newest first** — `TeamNotification[]`
(same shape as the send response). Powers the composer's **History** tab.

## Frontend contract (shipped, mock)

`src/api/matchGeniNotifications.ts`:

| Fn | Maps to |
|----|---------|
| `notificationTemplates()` | `GET …/notification-templates` |
| `sendTeamNotification(associationId, eventId, divisionId, payload)` | `POST …/notifications` |
| `fetchNotificationHistory(divisionId)` | `GET …/notifications` |

Types in `src/types.ts`: `NotificationChannel`, `NotificationAudience`,
`NotificationCategory`, `NotificationDeliveryStatus`, `NotificationTemplate`,
`TeamNotification`, `SendNotificationPayload`.

## SQL schema

See the DRAFT `team_notifications` + `team_notification_recipients` section
in [`../system/sql-schema-notifications.md`](../system/sql-schema-notifications.md#team_notifications--team_notification_recipients).
