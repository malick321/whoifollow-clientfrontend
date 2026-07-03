---
status: Draft
owner: shared
last_updated: 2026-06-24
---

# Chat — REST API contract (`/v2/chat`)

## Context

Powers the new WhatsApp-style chat surface (`/chat`) in `whoifollow-newfrontend` and the
realtime relay (`chat-microservice`). Optimised `/v2` replacement for the legacy
`/api/chat/*` endpoints (`ConversationController` + `ChatController`). Same persistence
(Laravel owns the data); this contract is a leaner, camelCase, cursor-paginated wire.

**Three tiers:**
1. **Frontend** — Pinia store + socket.io client + IndexedDB cache. Reads history/contacts
   over `/v2/chat`; live events over socket.
2. **`chat-microservice`** (socket.io) — realtime relay. Repointed to call `/v2/chat` for
   persistence (was `/api/chat`). Forwards the bearer token from the socket handshake.
3. **Laravel `/v2/chat`** — persistence + business rules (this contract).

Shared rules (envelope, auth header, IDs-as-strings, image URLs) — see
[`conventions.md`](./conventions.md). **No encryption** in v1 — the legacy
`encrypted_content` / `recipient_keys` / `is_encrypted` fields are dropped from the v2 wire.

## Scope decisions (locked)

- **Wire is camelCase**; DB columns stay snake_case (serializer translates). IDs are strings.
- **Conversation identity** is the numeric `id` (string on the wire). `type` is `'dm'`
  (1:1) or `'team'` (group). Team conversations carry a `team` object.
- **User identity in chat is `userChatId`** (the `users.chat_id` value) — the same id the
  socket handshake uses and the receipts/presence events key on. Every participant/sender
  is identified by `userChatId` (numeric `userId` included where the UI links to a profile).
- **Messages use cursor pagination** (newest-first, fetch older via `before`), NOT offset —
  chat history is unbounded and append-heavy.
- **Timestamps** are ISO-8601 UTC. The client formats locally.
- **Message status** is derived per-viewer: `sent` → `delivered` → `read` from the
  receipt rows (see §13).
- **Auth**: every endpoint requires a logged-in user (bearer token). Membership in the
  conversation is enforced server-side (`403` otherwise). Not association-permission gated.
- **No encryption**: `content` is always plaintext on the wire.

## Underlying tables (existing — no schema changes)

| Table | Purpose |
|---|---|
| `conversations` | Master row. `type` (`dm`/`team`), `related_id` (→ `teams.id` for team convos), `last_message_at`. |
| `conversation_participants` | Membership. `user_chat_id`, role, `last_read_at`, pinned/archived flags. |
| `messages` | `conversation_id`, `sender_chat_id`, `content`, `has_file` + file cols, `parent_message_id` (reply), `pinned`, `created_at`, `deleted_at`. |
| `message_delivery_receipts` / `message_read_receipts` | Per-recipient delivered/read timestamps. |
| `teams` | Team master (name, avatar) for `type=team` conversations. |
| `users` | Sender/participant identity (`chat_id`, name, avatar). |

---

## 1. List Conversations

- **Endpoint**: `GET /v2/chat/conversations`
- **Purpose**: The conversation list (Teams + Individuals tabs) — each with last-message
  preview + unread count.

### Query parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `type` | `'team' \| 'dm'` | — | Optional filter. Omitted = both (client splits into the two tabs). |
| `search` | string | `""` | Case-insensitive match on conversation/team name + participant name. |
| `cursor` | string | — | Opaque cursor (encodes `last_message_at` + `id`); returns the next older page. Omit for the first page. |
| `limit` | int | `30` | Max `50`. |

### Response

```json
{
  "responseStatus": { "message": "Conversations fetched successfully.", "statusCode": 200, "text": "OK" },
  "data": {
    "conversations": [
      {
        "id": "1842",
        "type": "team",
        "title": "Red Bulls Team",
        "avatarUrl": "https://cdn.whoifollow.tech/chat/groupAvatar/redbulls.png",
        "team": { "id": "242", "teamId": "fb_abc123", "name": "Red Bulls Team" },
        "otherUser": null,
        "lastMessage": {
          "id": "99213", "senderChatId": "55", "senderName": "Sheikh Hamza Muneer",
          "preview": "Hi", "hasFile": false, "createdAt": "2026-06-22T11:57:00Z"
        },
        "lastMessageAt": "2026-06-22T11:57:00Z",
        "unreadCount": 2,
        "isPinned": false,
        "isArchived": false
      },
      {
        "id": "1903",
        "type": "dm",
        "title": "Nelson Perry",
        "avatarUrl": "https://cdn.whoifollow.tech/users/avatar/nelson.png",
        "team": null,
        "otherUser": { "userChatId": "71", "userId": "71", "name": "Nelson Perry" },
        "lastMessage": { "id": "99001", "senderChatId": "71", "senderName": "Nelson Perry", "preview": "see you there", "hasFile": false, "createdAt": "2026-06-21T18:02:00Z" },
        "lastMessageAt": "2026-06-21T18:02:00Z",
        "unreadCount": 0,
        "isPinned": true,
        "isArchived": false
      }
    ],
    "nextCursor": "eyJsbWEiOiIyMDI2LTA2LTIxVDE4OjAyOjAwWiIsImlkIjoiMTkwMyJ9"
  }
}
```

#### Field notes

- Ordered by `isPinned` desc, then `lastMessageAt` desc.
- `title` / `avatarUrl` are resolved server-side: for `team`, the team name + group avatar;
  for `dm`, the *other* participant's name + user avatar.
- `unreadCount` — messages after the viewer's `last_read_at`, NOT sent by them. Computed
  with one batched query across the page (no N+1).
- `lastMessage.preview` — plaintext, truncated server-side (~120 chars); `"📎 Photo"` /
  `"📎 File"` style placeholder when `hasFile` and no caption.
- `nextCursor` is `null` on the last page.
- Presence (online/offline) is **not** here — it arrives over the socket (`user.status`).

## 2. Get-or-Create Individual (DM) Conversation

- **Endpoint**: `POST /v2/chat/conversations/individual`
- **Body**: `{ "userChatId": "71" }` — the other user.
- **Response**: `data.conversation` (the §1 conversation shape). Creates the 1:1 if it
  doesn't exist, else returns the existing one (idempotent). `403` if the target user can't
  be messaged (blocked / not allowed).

## 3. Get Conversation

- **Endpoint**: `GET /v2/chat/conversations/{conversationId}`
- **Response**: `data.conversation` — full detail incl. `participants[]` (see §12) and, for
  team convos, the `team` block + the event/teammates summary the info panel shows.
- `404` if not found; `403` if the viewer isn't a participant.

## 4. Get Messages (cursor history)

- **Endpoint**: `GET /v2/chat/conversations/{conversationId}/messages`
- **Purpose**: Paginated message history, newest-first, infinite-scroll upward.

### Query parameters

| Name | Type | Default | Notes |
|---|---|---|---|
| `before` | string | — | Cursor (message id). Returns messages older than it. Omit for the latest page. |
| `limit` | int | `30` | Max `50`. |

### Response

```json
{
  "responseStatus": { "message": "Messages fetched successfully.", "statusCode": 200, "text": "OK" },
  "data": {
    "messages": [ /* Message (see §13), oldest→newest within the page */ ],
    "nextCursor": "99100",
    "hasMore": true
  }
}
```

- Returned **oldest→newest within the page** (the client prepends older pages).
- `nextCursor` = the id to pass as `before` for the next older page; `null` when `hasMore` is false.
- `403` if the viewer isn't a participant.

## 5. Send Message

- **Endpoint**: `POST /v2/chat/conversations/{conversationId}/messages`
- **Caller**: the `chat-microservice` (on the `send-message` socket event) — and the
  frontend's REST fallback.
- **Body**:

```jsonc
{
  "content": "Hi team!",
  "parentMessageId": "99100",        // optional — reply
  "clientId": "tmp_8f3a"             // optional — echoed back so the sender reconciles its optimistic bubble
}
```

- **Response**: `data.message` (the §13 Message), with server `id`, `createdAt`, and the
  echoed `clientId`. `responseStatus.statusCode` `201`.
- The microservice then emits `message.sent` to `conversation.{id}`.
- `403` if not a participant; `422` if `content` is empty AND no parent/file.

## 6. Send Message with Files

- **Endpoint**: `POST /v2/chat/conversations/{conversationId}/messages/with-files`
- **Body**: `content?`, `parentMessageId?`, `clientId?`, plus `files[]`. Files may be sent
  as **`multipart/form-data`** (`files[]` binary) — preferred — or base64 entries (the
  microservice path forwards base64; the REST/native path uses multipart). Each stored via
  the media pipeline; the response Message carries resolved `file` objects (§13).
- **Response**: `data.message` (or `data.messages[]` if the backend splits multi-file into
  multiple messages — the client handles both). `201`.

## 7. Receipts

| Endpoint | Purpose |
|---|---|
| `POST /v2/chat/messages/{messageId}/mark-delivered` | Mark one message delivered for the caller. Body: `{ deliveredAt? }`. |
| `POST /v2/chat/bulk-mark-delivered` | Bulk on reconnect. Body: `{ messageIds: string[], deliveredAt? }`. |
| `POST /v2/chat/messages/{messageId}/read` | Mark one read for the caller. |
| `POST /v2/chat/messages/batch-read` | Body: `{ messageIds: string[] }`. |
| `POST /v2/chat/conversations/{conversationId}/read-batch` | Mark a set read within a conversation + advance `last_read_at`. Body: `{ messageIds: string[] }`. |

All return `{ data: { updated: <count> } }`. The microservice broadcasts the matching
`message.delivered` / `message.read(.batch)` socket events after persistence.

## 8. Undelivered Messages (offline sync)

- **Endpoint**: `GET /v2/chat/undelivered-messages`
- **Caller**: the microservice on (re)connect (`syncOfflineMessages`).
- **Response**:

```json
{ "data": {
  "messages": [ /* §13 Messages not yet delivered to the caller, across all their conversations */ ],
  "conversationIds": ["1842","1903"],
  "allConversationIds": ["1842","1903","2001"]
} }
```

- `allConversationIds` = every conversation the user belongs to (the microservice pre-joins
  all rooms). `conversationIds` = those with undelivered messages.

## 9. Delete / Pin

| Endpoint | Purpose |
|---|---|
| `DELETE /v2/chat/messages/{messageId}` | Soft-delete (only the sender, or a team admin). Microservice broadcasts `message.deleted`. `data` omitted. |
| `POST /v2/chat/messages/{messageId}/pin` | Toggle pin within the conversation. Body: `{ pinned: true }`. Returns the updated Message. |

## 10. Shared Files / Participants / Membership / Search

| Endpoint | Purpose |
|---|---|
| `GET /v2/chat/conversations/{id}/shared-files` | The info-panel "Shared Files" list — paginated `{ files: [{ messageId, name, type, url, size, senderName, createdAt }], nextCursor }`. |
| `GET /v2/chat/conversations/{id}/participants` | `data.participants[]` (§12). |
| `GET /v2/chat/conversations/{id}/membership` | `{ data: { isMember: true } }` — used by the microservice's room-join guard. |
| `GET /v2/chat/conversations/search` | `?q=` — search conversations + (optionally) messages; returns matching conversations (§1 shape) + message hits. |

## 11. Team (group) management

Team conversations mirror a `teams` row. These migrate the legacy `ChatController` team
endpoints to `/v2/chat/teams/...` — same behavior, camelCase + envelope. The realtime layer
is unaffected (these are admin actions, not message traffic).

| Endpoint | Replaces | Purpose |
|---|---|---|
| `GET /v2/chat/teams/{teamId}/members` | `getTeamMembers` | Member roster (for the info panel + add/remove). |
| `GET /v2/chat/teams/{teamId}` | `getTeamData` | Team info (name, avatar, event/stats summary). |
| `POST /v2/chat/teams/{teamId}` | `updateTeamInfo` / `storeTeamInfo` | Create/update team chat info. |
| `POST /v2/chat/teams/{teamId}/members` | `storeNewAddedTeamMember(s)` | Add member(s). |
| `DELETE /v2/chat/teams/{teamId}/members/{userChatId}` | `removeTeamMember` | Remove a member. |
| `POST /v2/chat/teams/{teamId}/avatar` | `storeGroupAvatar` | Upload group avatar (multipart). |
| `POST /v2/chat/teams/{teamId}/leave` | `leaveTeam` | Current user leaves. |
| `POST /v2/chat/teams/{teamId}/archive` | `archiveTeam` | Archive the team chat. |

> Detailed request/response per team endpoint is captured alongside the controller as it's
> built (they're thin translations of the existing `ChatController` methods). The messaging
> surface (§1–§10) is the locked, fully-specified core.

---

## 12. `ChatParticipant` shape

```ts
interface ChatParticipant {
  userChatId: string
  userId: string | null      // numeric user id when linkable to a profile
  name: string
  avatarUrl: string | null   // resolved CDN url
  role: 'admin' | 'member'
  lastReadAt: string | null  // ISO UTC — drives "read up to here"
}
```

## 13. `ChatMessage` shape

```ts
interface ChatMessageFile {
  name: string
  type: string               // mime
  url: string                // resolved CDN url
  size: number | null
  thumbnailUrl?: string | null
}

interface ChatMessage {
  id: string
  clientId: string | null    // echoed temp id for optimistic-send reconciliation
  conversationId: string
  senderChatId: string
  senderName: string
  senderAvatarUrl: string | null
  content: string            // plaintext (no encryption in v1)
  hasFile: boolean
  files: ChatMessageFile[]   // [] when none
  parentMessage: {           // null when not a reply
    id: string
    senderName: string
    preview: string
  } | null
  isPinned: boolean
  isDeleted: boolean         // soft-deleted → render "This message was deleted"
  createdAt: string          // ISO UTC
  // Per-viewer derived status + aggregate receipts (for the ✓/✓✓ ticks).
  status: 'sent' | 'delivered' | 'read'   // for messages the VIEWER sent
  deliveredTo: string[]      // userChatIds that have a delivery receipt
  readBy: string[]           // userChatIds that have a read receipt
}
```

- `status` is computed **for the current viewer's own messages**: `read` if every other
  participant has read, else `delivered` if every other has a delivery receipt, else `sent`.
  (For 1:1 it's the single recipient; for teams it's "all others".)
- `files` is always an array. Legacy single-file rows map to a one-element array.

---

## 14. Cross-cutting rules

| Rule | Notes |
|---|---|
| Wire is camelCase; IDs are strings; timestamps ISO-8601 UTC. | Per conventions. |
| No encryption in v1. | `content` is plaintext; legacy `encrypted_content` / `is_encrypted` / `recipient_keys` dropped from the v2 wire. |
| Membership enforced on every conversation/message endpoint. | `403` when the caller isn't a participant. |
| Avatars are resolved CDN URLs, opaque to the client. | Team avatars `chat/groupAvatar/`; user avatars `users/avatar/`. |
| Presence + typing are socket-only. | Never in REST — `user.status` / `typing` events from the microservice. |
| Cursor pagination for messages + conversations. | Opaque cursors; `nextCursor: null` ends the list. |
| Soft-delete only. | Deleted messages return `isDeleted: true` (tombstone), not removed from history. |

## 15. Realtime ↔ REST mapping (microservice repoint)

The `chat-microservice` keeps its socket events; only its HTTP target changes from
`/api/chat` → `/v2/chat`:

| Socket event | Persists via |
|---|---|
| `send-message` | `POST /v2/chat/conversations/{id}/messages` |
| `send-message-with-files` | `POST /v2/chat/conversations/{id}/messages/with-files` |
| `mark-delivered` | `POST /v2/chat/messages/{id}/mark-delivered` |
| `bulk-mark-delivered` | `POST /v2/chat/bulk-mark-delivered` |
| `mark-read` | `POST /v2/chat/messages/{id}/read` |
| `mark-read-batch` | `POST /v2/chat/conversations/{id}/read-batch` |
| `delete-message` | `DELETE /v2/chat/messages/{id}` |
| connect (offline sync) | `GET /v2/chat/undelivered-messages` |
| room-join guard | `GET /v2/chat/conversations/{id}/membership` |

## 16. Frontend integration

| File | Role |
|---|---|
| `src/api/chat.ts` | `/v2/chat` client (conversations, messages, receipts, search, shared files). |
| `src/api/adapters/chat.ts` | Wire → `ChatConversation` / `ChatMessage` domain models. |
| `src/api/contracts/chat.ts` | Wire types. |
| `src/stores/chat.ts` (Pinia) | Socket.io client + connection/presence + event handlers + state. |
| `src/lib/chat-db.ts` | IndexedDB cache (conversations + messages) — instant render, offline, optimistic send. |
| `src/views/ChatView.vue` + `src/components/chat/*` | Conversation list + thread + composer + info panel. |

## 17. Out of scope (v1)

- Encryption (E2EE) — hooks intentionally dropped.
- Voice/video calls.
- Message reactions / forwarding (fast-follow).
