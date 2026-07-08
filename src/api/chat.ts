// `/v2/chat` REST client + domain models for the new WhatsApp-style chat.
//
// Mirrors docs/api/chat-api-contract.md. Every function uses fetch +
// buildV2ApiUrl(`/chat/...`) + getAuthHeaders, unwraps the `{responseStatus,
// data}` envelope, and runs the relevant adapter. The realtime layer (socket)
// lives in src/stores/chat.ts; this file is the history/contacts/receipt HTTP
// surface (and the REST fallback for sending).

import { buildV2ApiUrl } from './config'
import { fetchCurrentUser } from './me'
import { getAuthHeaders } from '../auth-session'
import {
  adaptConversation,
  adaptMessage,
  adaptParticipant,
  adaptTeamMember
} from './adapters/chat'
import type {
  ApiConversationResponse,
  ApiConversationsResponse,
  ApiCreateTeamResponse,
  ApiMessageInfoResponse,
  ApiMessageResponse,
  ApiMessagesResponse,
  ApiParticipantsResponse,
  ApiReceiptResponse,
  ApiSearchResponse,
  ApiSharedFile,
  ApiSharedFilesResponse,
  ApiTeamDataResponse,
  ApiTeamDetail,
  ApiTeamDetailResponse,
  ApiTeamInviteLinkResponse,
  ApiTeamMembersResponse,
  ApiTeamSettings,
  ApiTeamSettingsResponse,
  ApiUndeliveredResponse
} from './contracts/chat'

// ── Domain models (camelCase) ──────────────────────────────────────────────

export type ChatConversationType = 'dm' | 'team'
export type ChatMessageStatus = 'sent' | 'delivered' | 'read'
export type ChatParticipantRole = 'admin' | 'member'

export interface ChatMessageFile {
  name: string
  type: string
  url: string
  size: number | null
  thumbnailUrl: string | null
}

export interface ChatParentMessage {
  id: string
  senderName: string
  preview: string
}

export interface ChatMessage {
  id: string
  /** Echoed temp id for optimistic-send reconciliation; null on server-origin rows. */
  clientId: string | null
  conversationId: string
  senderChatId: string
  senderName: string
  senderAvatarUrl: string | null
  content: string
  hasFile: boolean
  files: ChatMessageFile[]
  parentMessage: ChatParentMessage | null
  isPinned: boolean
  isDeleted: boolean
  createdAt: string
  /** Per-viewer status for the VIEWER's own messages (drives ✓/✓✓). */
  status: ChatMessageStatus
  deliveredTo: string[]
  readBy: string[]
}

export interface ChatTeamRef {
  id: string | null
  teamId: string | null
  name: string
  avatarUrl: string | null
}

export interface ChatOtherUser {
  userChatId: string
  userId: string | null
  name: string
  avatarUrl: string | null
}

export interface ChatLastMessage {
  id: string
  senderChatId: string
  senderName: string
  preview: string
  hasFile: boolean
  createdAt: string
}

export interface ChatParticipant {
  userChatId: string
  userId: string | null
  name: string
  avatarUrl: string | null
  role: ChatParticipantRole
  lastReadAt: string | null
}

export interface ChatConversation {
  id: string
  type: ChatConversationType
  title: string
  avatarUrl: string | null
  team: ChatTeamRef | null
  otherUser: ChatOtherUser | null
  lastMessage: ChatLastMessage | null
  lastMessageAt: string | null
  unreadCount: number
  isPinned: boolean
  isArchived: boolean
  participants: ChatParticipant[]
}

export interface ChatSharedFile {
  messageId: string
  name: string
  type: string
  url: string
  size: number | null
  senderName: string
  createdAt: string
}

export interface ChatTeamMember {
  userChatId: string
  userId: string | null
  name: string
  avatarUrl: string | null
  role: ChatParticipantRole
}

export interface ChatConversationsPage {
  conversations: ChatConversation[]
  nextCursor: string | null
}

export interface ChatMessagesPage {
  messages: ChatMessage[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ChatSharedFilesPage {
  files: ChatSharedFile[]
  nextCursor: string | null
}

export interface ChatUndelivered {
  messages: ChatMessage[]
  conversationIds: string[]
  allConversationIds: string[]
}

export interface ChatMessageInfoRecipient {
  userChatId: string
  name: string
  avatarUrl: string | null
  deliveredAt: string | null
  readAt: string | null
}

export interface ChatMessageInfo {
  messageId: string
  sentAt: string | null
  recipients: ChatMessageInfoRecipient[]
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

function jsonHeaders(): Record<string, string> {
  return {
    ...getAuthHeaders(),
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
}

function getHeaders(): Record<string, string> {
  return {
    ...getAuthHeaders(),
    Accept: 'application/json'
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json().catch(() => ({}))) as T
}

function adaptSharedFile(raw: ApiSharedFile): ChatSharedFile {
  return {
    messageId: String(raw.messageId),
    name: raw.name ?? '',
    type: raw.type ?? '',
    url: raw.url ?? '',
    size: raw.size ?? null,
    senderName: raw.senderName ?? '',
    createdAt: raw.createdAt ?? ''
  }
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    sp.set(key, String(value))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

// ── 1. List Conversations ────────────────────────────────────────────────────

export async function fetchConversations(opts: {
  cursor?: string
  type?: ChatConversationType
  search?: string
  limit?: number
} = {}): Promise<ChatConversationsPage> {
  const qs = buildQuery({
    cursor: opts.cursor,
    type: opts.type,
    search: opts.search,
    limit: opts.limit
  })
  const response = await fetch(buildV2ApiUrl(`/chat/conversations${qs}`), { headers: getHeaders() })
  const env = await readJson<ApiConversationsResponse>(response)
  return {
    conversations: (env?.data?.conversations ?? []).map(adaptConversation),
    nextCursor: env?.data?.nextCursor ?? null
  }
}

// ── 2. Get-or-create individual (DM) conversation ─────────────────────────────

export async function getOrCreateIndividualConversation(
  userChatId: string
): Promise<ChatConversation | null> {
  const response = await fetch(buildV2ApiUrl('/chat/conversations/individual'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ userChatId })
  })
  const env = await readJson<ApiConversationResponse>(response)
  const conv = env?.data?.conversation
  return conv ? adaptConversation(conv) : null
}

// ── 3. Get conversation (detail) ──────────────────────────────────────────────

export async function fetchConversation(id: string): Promise<ChatConversation | null> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiConversationResponse>(response)
  const conv = env?.data?.conversation
  return conv ? adaptConversation(conv) : null
}

// ── 4. Get messages (cursor history) ──────────────────────────────────────────

export async function fetchMessages(
  id: string,
  opts: { before?: string; limit?: number } = {}
): Promise<ChatMessagesPage> {
  const qs = buildQuery({ before: opts.before, limit: opts.limit })
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/messages${qs}`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiMessagesResponse>(response)
  return {
    messages: (env?.data?.messages ?? []).map(adaptMessage),
    nextCursor: env?.data?.nextCursor ?? null,
    hasMore: !!env?.data?.hasMore
  }
}

// ── 5. Send message (REST fallback) ───────────────────────────────────────────

export async function sendMessageRest(
  id: string,
  body: { content: string; parentMessageId?: string; clientId?: string }
): Promise<ChatMessage[]> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/messages`),
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: body.content,
        parentMessageId: body.parentMessageId,
        clientId: body.clientId
      })
    }
  )
  const env = await readJson<ApiMessageResponse>(response)
  const rows = env?.data?.messages ?? (env?.data?.message ? [env.data.message] : [])
  return rows.map(adaptMessage)
}

// ── 6. Send files (REST multipart) ───────────────────────────────────────────

export async function sendFilesRest(
  id: string,
  body: { files: File[]; content?: string; parentMessageId?: string; clientId?: string }
): Promise<ChatMessage[]> {
  const form = new FormData()
  if (body.content !== undefined) form.append('content', body.content)
  if (body.parentMessageId) form.append('parentMessageId', body.parentMessageId)
  if (body.clientId) form.append('clientId', body.clientId)
  for (const file of body.files) {
    form.append('files[]', file, file.name)
  }

  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/messages/with-files`),
    {
      method: 'POST',
      headers: getHeaders(),
      body: form
    }
  )
  const env = await readJson<ApiMessageResponse>(response)
  if (!response.ok) {
    throw new Error(env?.responseStatus?.message || `Failed to upload files (${response.status})`)
  }
  const rows = env?.data?.messages ?? (env?.data?.message ? [env.data.message] : [])
  return rows.map(adaptMessage)
}

// ── 7. Receipts ───────────────────────────────────────────────────────────────

export interface ChatUploadIntentInputFile {
  name: string
  type: string
  size: number
  thumbnail?: {
    name: string
    type: string
    size: number
  } | null
}

export interface ChatUploadTarget {
  messageId?: string
  name: string
  type: string
  size: number
  method: 'PUT'
  uploadUrl: string
  headers: Record<string, string>
  expiresAt: string
  thumbnail?: ChatUploadTarget | null
}

export interface ChatUploadIntent {
  uploadSessionId: string
  uploadToken: string
  expiresAt: string
  uploads: ChatUploadTarget[]
}

interface ApiChatUploadIntentResponse {
  responseStatus?: { message?: string; statusCode?: number; text?: string }
  data?: ChatUploadIntent | null
}

export async function createChatUploadIntent(
  id: string,
  body: {
    files: ChatUploadIntentInputFile[]
    content?: string
    parentMessageId?: string
    clientId?: string
  }
): Promise<ChatUploadIntent> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/messages/upload-intents`),
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        content: body.content,
        parentMessageId: body.parentMessageId,
        clientId: body.clientId,
        files: body.files
      })
    }
  )
  const env = await readJson<ApiChatUploadIntentResponse>(response)
  if (!response.ok || !env?.data) {
    throw new Error(env?.responseStatus?.message || `Failed to prepare upload (${response.status})`)
  }
  return env.data
}

export async function completeChatUpload(
  id: string,
  body: { uploadSessionId: string; uploadToken: string; messageIds: string[] }
): Promise<ChatMessage[]> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/messages/complete-upload`),
    {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        uploadSessionId: body.uploadSessionId,
        uploadToken: body.uploadToken,
        messageIds: body.messageIds
      })
    }
  )
  const env = await readJson<ApiMessageResponse>(response)
  if (!response.ok) {
    throw new Error(env?.responseStatus?.message || `Failed to complete upload (${response.status})`)
  }
  const rows = env?.data?.messages ?? (env?.data?.message ? [env.data.message] : [])
  return rows.map(adaptMessage)
}

export async function markDelivered(messageId: string, deliveredAt?: string): Promise<number> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/messages/${encodeURIComponent(messageId)}/mark-delivered`),
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ deliveredAt }) }
  )
  const env = await readJson<ApiReceiptResponse>(response)
  return env?.data?.updated ?? 0
}

export async function bulkMarkDelivered(messageIds: string[], deliveredAt?: string): Promise<number> {
  const response = await fetch(buildV2ApiUrl('/chat/bulk-mark-delivered'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ messageIds, deliveredAt })
  })
  const env = await readJson<ApiReceiptResponse>(response)
  return env?.data?.updated ?? 0
}

export async function markRead(messageId: string): Promise<number> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/messages/${encodeURIComponent(messageId)}/read`),
    { method: 'POST', headers: jsonHeaders(), body: '{}' }
  )
  const env = await readJson<ApiReceiptResponse>(response)
  return env?.data?.updated ?? 0
}

export async function batchRead(messageIds: string[]): Promise<number> {
  const response = await fetch(buildV2ApiUrl('/chat/messages/batch-read'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ messageIds })
  })
  const env = await readJson<ApiReceiptResponse>(response)
  return env?.data?.updated ?? 0
}

export async function readBatch(conversationId: string, messageIds: string[]): Promise<number> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(conversationId)}/read-batch`),
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ messageIds }) }
  )
  const env = await readJson<ApiReceiptResponse>(response)
  return env?.data?.updated ?? 0
}

// ── 7b. Message info (per-recipient delivery / read breakdown) ────────────────

export async function fetchMessageInfo(messageId: string): Promise<ChatMessageInfo | null> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/messages/${encodeURIComponent(messageId)}/info`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiMessageInfoResponse>(response)
  const d = env?.data
  if (!d) return null
  return {
    messageId: String(d.messageId ?? messageId),
    sentAt: d.sentAt ?? null,
    recipients: (d.recipients ?? []).map((r) => ({
      userChatId: String(r.userChatId ?? ''),
      name: r.name ?? '',
      avatarUrl: r.avatarUrl ?? null,
      deliveredAt: r.deliveredAt ?? null,
      readAt: r.readAt ?? null
    }))
  }
}

// ── 8. Undelivered messages (offline sync) ────────────────────────────────────

export async function fetchUndelivered(): Promise<ChatUndelivered> {
  const response = await fetch(buildV2ApiUrl('/chat/undelivered-messages'), { headers: getHeaders() })
  const env = await readJson<ApiUndeliveredResponse>(response)
  return {
    messages: (env?.data?.messages ?? []).map(adaptMessage),
    conversationIds: (env?.data?.conversationIds ?? []).map(String),
    allConversationIds: (env?.data?.allConversationIds ?? []).map(String)
  }
}

// ── 9. Delete / Pin ────────────────────────────────────────────────────────────

export async function deleteMessageRest(messageId: string): Promise<void> {
  await fetch(buildV2ApiUrl(`/chat/messages/${encodeURIComponent(messageId)}`), {
    method: 'DELETE',
    headers: getHeaders()
  })
}

export async function togglePin(messageId: string, pinned: boolean): Promise<ChatMessage | null> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/messages/${encodeURIComponent(messageId)}/pin`),
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ pinned }) }
  )
  const env = await readJson<ApiMessageResponse>(response)
  const msg = env?.data?.message
  return msg ? adaptMessage(msg) : null
}

// ── 10. Shared files / participants / search ──────────────────────────────────

export async function fetchSharedFiles(id: string, cursor?: string): Promise<ChatSharedFilesPage> {
  const qs = buildQuery({ cursor })
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/shared-files${qs}`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiSharedFilesResponse>(response)
  return {
    files: (env?.data?.files ?? []).map(adaptSharedFile),
    nextCursor: env?.data?.nextCursor ?? null
  }
}

export async function fetchParticipants(id: string): Promise<ChatParticipant[]> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/conversations/${encodeURIComponent(id)}/participants`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiParticipantsResponse>(response)
  return (env?.data?.participants ?? []).map(adaptParticipant)
}

export interface ChatMe {
  userChatId: string
  userId: string | null
  name: string
  avatarUrl: string | null
}

/** Current user's chat identity (GET /v2/me). Called on connect when the
 *  userChatId wasn't captured at login, so own/other alignment + the socket
 *  handshake resolve regardless of session age. Returns null if unauthenticated. */
export async function fetchMe(): Promise<ChatMe | null> {
  const d = await fetchCurrentUser()
  if (!d?.userChatId) return null
  return {
    userChatId: String(d.userChatId),
    userId: d.userId != null ? String(d.userId) : null,
    name: d.name ?? 'User',
    avatarUrl: d.avatarUrl ?? null
  }
}

export async function searchConversations(q: string): Promise<ChatConversationsPage> {
  const qs = buildQuery({ q })
  const response = await fetch(buildV2ApiUrl(`/chat/conversations/search${qs}`), {
    headers: getHeaders()
  })
  const env = await readJson<ApiSearchResponse>(response)
  return {
    conversations: (env?.data?.conversations ?? []).map(adaptConversation),
    nextCursor: env?.data?.nextCursor ?? null
  }
}

// ── 11. Team (group) management ───────────────────────────────────────────────

export async function fetchTeamMembers(teamId: string): Promise<ChatTeamMember[]> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/members`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiTeamMembersResponse>(response)
  return (env?.data?.members ?? []).map(adaptTeamMember)
}

export interface ChatTeamData {
  team: ChatTeamRef | null
  members: ChatTeamMember[]
}

export async function fetchTeamData(teamId: string): Promise<ChatTeamData> {
  const response = await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}`), {
    headers: getHeaders()
  })
  const env = await readJson<ApiTeamDataResponse>(response)
  const team = env?.data?.team ?? null
  return {
    team: team
      ? {
          id: team.id ?? null,
          teamId: team.teamId ?? null,
          name: team.name ?? '',
          avatarUrl: team.avatarUrl ?? null
        }
      : null,
    members: (env?.data?.members ?? []).map(adaptTeamMember)
  }
}

export async function updateTeam(
  teamId: string,
  body: { name?: string; [key: string]: unknown }
): Promise<ChatTeamData> {
  const response = await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body)
  })
  const env = await readJson<ApiTeamDataResponse>(response)
  const team = env?.data?.team ?? null
  return {
    team: team
      ? {
          id: team.id ?? null,
          teamId: team.teamId ?? null,
          name: team.name ?? '',
          avatarUrl: team.avatarUrl ?? null
        }
      : null,
    members: (env?.data?.members ?? []).map(adaptTeamMember)
  }
}

export async function addTeamMembers(
  teamId: string,
  userChatIds: string[]
): Promise<ChatTeamMember[]> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/members`),
    { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ userChatIds }) }
  )
  const env = await readJson<ApiTeamMembersResponse>(response)
  return (env?.data?.members ?? []).map(adaptTeamMember)
}

export async function removeTeamMember(teamId: string, userChatId: string): Promise<void> {
  await fetch(
    buildV2ApiUrl(
      `/chat/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userChatId)}`
    ),
    { method: 'DELETE', headers: getHeaders() }
  )
}

export async function leaveTeam(teamId: string): Promise<void> {
  await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/leave`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: '{}'
  })
}

export async function archiveTeam(teamId: string): Promise<void> {
  await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/archive`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: '{}'
  })
}

// ── 12. Team creation / detail / settings / invites ───────────────────────────

export type ChatTeamCategory = 'work' | 'sports'
export type ChatTeamGender = 'male' | 'female' | 'coed'
/** Role on the invite forms — Teammate (player-eligible) or Fan. */
export type ChatInviteRole = 'teammate' | 'fan'

export interface CreateTeamPayload {
  name: string
  category: ChatTeamCategory
  sportsTypeId?: string
  city?: string
  state?: string
  gender?: ChatTeamGender
  ageGroup?: string
  memberUserChatIds?: string[]
  logo?: File | null
}

export interface CreateTeamResult {
  conversation: ChatConversation | null
  teamId: string | null
}

/** Create a new team conversation. Multipart so the optional logo file rides
 *  along. Returns the freshly-created conversation (so the caller can open it)
 *  + the team id. */
export async function createTeam(payload: CreateTeamPayload): Promise<CreateTeamResult> {
  const form = new FormData()
  form.append('name', payload.name)
  form.append('category', payload.category)
  if (payload.sportsTypeId) form.append('sportsTypeId', payload.sportsTypeId)
  if (payload.city) form.append('city', payload.city)
  if (payload.state) form.append('state', payload.state)
  if (payload.gender) form.append('gender', payload.gender)
  if (payload.ageGroup) form.append('ageGroup', payload.ageGroup)
  for (const id of payload.memberUserChatIds ?? []) {
    form.append('memberUserChatIds[]', id)
  }
  if (payload.logo) form.append('logo', payload.logo)

  const response = await fetch(buildV2ApiUrl('/chat/teams'), {
    method: 'POST',
    headers: getHeaders(),
    body: form
  })
  const env = await readJson<ApiCreateTeamResponse>(response)
  const conv = env?.data?.conversation
  return {
    conversation: conv ? adaptConversation(conv) : null,
    teamId: env?.data?.teamId ?? null
  }
}

export interface ChatTeamSettings {
  smsNotification: boolean
  pushNotification: boolean
  showOnBaseAvg: boolean
  showTop5Avg: boolean
}

export interface ChatTeamGoingUser {
  userChatId: string
  name: string
  avatarUrl: string | null
}

export interface ChatTeamOngoingEvent {
  id: string
  name: string
  status: string
  startDate: string | null
  endDate: string | null
  location: string
  goingUsers: ChatTeamGoingUser[]
  goingCount: number
}

export interface ChatTeamDetail {
  id: string
  teamId: string
  name: string
  categoryLabel: string
  ageGenderLabel: string
  logoUrl: string | null
  isAdmin: boolean
  createdByName: string
  createdAt: string | null
  stats: { games: number; won: number; lost: number }
  settings: ChatTeamSettings
  counts: { allEvents: number; associations: number; teammates: number; sharedFiles: number }
  ongoingEvent: ChatTeamOngoingEvent | null
}

function adaptTeamSettings(raw: ApiTeamSettings | null | undefined): ChatTeamSettings {
  return {
    smsNotification: !!raw?.smsNotification,
    pushNotification: !!raw?.pushNotification,
    showOnBaseAvg: !!raw?.showOnBaseAvg,
    showTop5Avg: !!raw?.showTop5Avg
  }
}

function adaptTeamDetail(raw: ApiTeamDetail): ChatTeamDetail {
  const event = raw.ongoingEvent
  return {
    id: String(raw.id ?? ''),
    teamId: String(raw.teamId ?? raw.id ?? ''),
    name: raw.name ?? '',
    categoryLabel: raw.categoryLabel ?? '',
    ageGenderLabel: raw.ageGenderLabel ?? '',
    logoUrl: raw.logoUrl ?? null,
    isAdmin: !!raw.isAdmin,
    createdByName: raw.createdByName ?? '',
    createdAt: raw.createdAt ?? null,
    stats: {
      games: raw.stats?.games ?? 0,
      won: raw.stats?.won ?? 0,
      lost: raw.stats?.lost ?? 0
    },
    settings: adaptTeamSettings(raw.settings),
    counts: {
      allEvents: raw.counts?.allEvents ?? 0,
      associations: raw.counts?.associations ?? 0,
      teammates: raw.counts?.teammates ?? 0,
      sharedFiles: raw.counts?.sharedFiles ?? 0
    },
    ongoingEvent: event
      ? {
          id: String(event.id ?? ''),
          name: event.name ?? '',
          status: event.status ?? '',
          startDate: event.startDate ?? null,
          endDate: event.endDate ?? null,
          location: event.location ?? '',
          goingUsers: (event.goingUsers ?? []).map((u) => ({
            userChatId: String(u.userChatId ?? ''),
            name: u.name ?? '',
            avatarUrl: u.avatarUrl ?? null
          })),
          goingCount: event.goingCount ?? (event.goingUsers?.length ?? 0)
        }
      : null
  }
}

/** Full team detail for the chat info panel (header stats, settings, counts,
 *  ongoing event). Returns `null` when the team can't be resolved. */
export async function fetchTeamDetail(teamId: string): Promise<ChatTeamDetail | null> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/detail`),
    { headers: getHeaders() }
  )
  const env = await readJson<ApiTeamDetailResponse>(response)
  // The endpoint returns the team fields FLAT under `data` (no `team` wrapper);
  // tolerate both shapes so the header/stats populate.
  const team = (env?.data as { team?: unknown })?.team ?? env?.data
  return team ? adaptTeamDetail(team as Parameters<typeof adaptTeamDetail>[0]) : null
}

/** Patch one or more team settings toggles. Returns the reconciled settings. */
export async function updateTeamSettings(
  teamId: string,
  partial: Partial<ChatTeamSettings>
): Promise<ChatTeamSettings> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/settings`),
    { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(partial) }
  )
  const env = await readJson<ApiTeamSettingsResponse>(response)
  return adaptTeamSettings(env?.data?.settings)
}

/** Get (mint) a shareable invite link for the team. */
export async function getTeamInviteLink(teamId: string): Promise<string> {
  const response = await fetch(
    buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/invite/link`),
    { method: 'POST', headers: jsonHeaders(), body: '{}' }
  )
  const env = await readJson<ApiTeamInviteLinkResponse>(response)
  return env?.data?.url ?? ''
}

export interface InviteTeamContactPayload {
  countryCode?: string
  mobile?: string
  email?: string
  role: ChatInviteRole
  markAsPlayer: boolean
}

/** Invite a contact to the team by mobile number or email. */
export async function inviteTeamContact(
  teamId: string,
  payload: InviteTeamContactPayload
): Promise<void> {
  await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/invite/contact`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  })
}

export interface InviteTeamFriendsPayload {
  userChatIds: string[]
  role: ChatInviteRole
  markAsPlayer: boolean
}

/** Add existing friends to the team directly. */
export async function inviteTeamFriends(
  teamId: string,
  payload: InviteTeamFriendsPayload
): Promise<void> {
  await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/invite/friends`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  })
}

export interface EditTeamDetailsPayload {
  name?: string
  category?: ChatTeamCategory
  sportsTypeId?: string
  city?: string
  state?: string
  gender?: ChatTeamGender
  ageGroup?: string
}

/** Edit core team details (name / category / division). Reuses the existing
 *  `POST /chat/teams/{teamId}` update endpoint. */
export async function editTeamDetails(
  teamId: string,
  payload: EditTeamDetailsPayload
): Promise<ChatTeamData> {
  return updateTeam(teamId, payload as { name?: string; [key: string]: unknown })
}

/** Replace the team's avatar/logo. Multipart. */
export async function changeTeamLogo(teamId: string, file: File): Promise<string | null> {
  const form = new FormData()
  form.append('avatar', file)
  const response = await fetch(
    buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/avatar`),
    { method: 'POST', headers: getHeaders(), body: form }
  )
  const env = await readJson<ApiTeamInviteLinkResponse>(response)
  return env?.data?.url ?? null
}

/** Report a team (abuse / inappropriate content). */
export async function reportTeam(teamId: string, reason = ''): Promise<void> {
  await fetch(buildV2ApiUrl(`/chat/teams/${encodeURIComponent(teamId)}/report`), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ reason })
  })
}
