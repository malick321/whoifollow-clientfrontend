// Wire (API) types for the new chat surface (`/v2/chat`).
// Mirrors docs/api/chat-api-contract.md (§1–§15). These describe the RAW
// camelCase response shapes the backend returns; the adapter in
// ../adapters/chat maps them to the domain models in ../chat.
//
// Every endpoint is wrapped in the standard `{ responseStatus, data }`
// envelope. IDs are strings; timestamps are ISO-8601 UTC.

export interface ApiResponseStatus {
  message?: string
  statusCode?: number
  text?: string
}

// ── Shared rows ───────────────────────────────────────────────────────────

export interface ApiTeamRef {
  id: string | null
  teamId: string | null
  name: string | null
  avatarUrl?: string | null
}

export interface ApiOtherUser {
  userChatId: string | null
  userId: string | null
  name: string | null
  avatarUrl?: string | null
}

export interface ApiLastMessage {
  id: string | null
  senderChatId: string | null
  senderName: string | null
  preview: string | null
  hasFile?: boolean | null
  createdAt: string | null
}

export interface ApiConversation {
  id: string
  type: 'team' | 'dm' | string
  title: string | null
  avatarUrl: string | null
  team: ApiTeamRef | null
  otherUser: ApiOtherUser | null
  lastMessage: ApiLastMessage | null
  lastMessageAt: string | null
  unreadCount: number | null
  isPinned: boolean | null
  isArchived: boolean | null
  // Present on the detail endpoint (§3).
  participants?: ApiParticipant[] | null
}

export interface ApiParticipant {
  userChatId: string
  userId: string | null
  name: string | null
  avatarUrl: string | null
  role: 'admin' | 'member' | string | null
  lastReadAt: string | null
}

export interface ApiMessageFile {
  name: string | null
  type: string | null
  url: string | null
  size: number | null
  thumbnailUrl?: string | null
}

export interface ApiParentMessage {
  id: string | null
  senderName: string | null
  // Snake-case fallback — the realtime gateway forwards raw Laravel rows.
  sender_name?: string | null
  preview: string | null
}

export interface ApiMessage {
  id: string
  // Snake-case fallbacks are tolerated because the realtime gateway forwards
  // raw Laravel rows on `offline-messages-sync` (which may not be fully
  // camelCased). The adapter reads whichever is present.
  clientId?: string | null
  client_id?: string | null
  conversationId?: string | null
  conversation_id?: string | null
  senderChatId?: string | null
  sender_chat_id?: string | null
  senderName?: string | null
  sender_name?: string | null
  senderAvatarUrl?: string | null
  content: string | null
  hasFile?: boolean | null
  has_file?: boolean | null
  files?: ApiMessageFile[] | null
  parentMessage?: ApiParentMessage | null
  parent_message?: ApiParentMessage | null
  isPinned?: boolean | null
  isDeleted?: boolean | null
  createdAt?: string | null
  created_at?: string | null
  status?: 'sent' | 'delivered' | 'read' | string | null
  deliveredTo?: string[] | null
  readBy?: string[] | null
}

export interface ApiSharedFile {
  messageId: string
  name: string | null
  type: string | null
  url: string | null
  size: number | null
  senderName: string | null
  createdAt: string | null
}

export interface ApiTeamMember {
  userChatId: string
  userId: string | null
  name: string | null
  avatarUrl: string | null
  role: 'admin' | 'member' | string | null
}

// ── Envelopes ─────────────────────────────────────────────────────────────

export interface ApiConversationsResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    conversations?: ApiConversation[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiConversationResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    conversation?: ApiConversation | null
  } | null
}

export interface ApiMessagesResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    messages?: ApiMessage[] | null
    nextCursor?: string | null
    hasMore?: boolean | null
  } | null
}

export interface ApiMessageResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    // The backend may return a single `message` OR a `messages[]` for the
    // multi-file split (§6) — the adapter handles both.
    message?: ApiMessage | null
    messages?: ApiMessage[] | null
  } | null
}

export interface ApiParticipantsResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    participants?: ApiParticipant[] | null
  } | null
}

export interface ApiSharedFilesResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    files?: ApiSharedFile[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiReceiptResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    updated?: number | null
  } | null
}

export interface ApiUndeliveredResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    messages?: ApiMessage[] | null
    conversationIds?: string[] | null
    allConversationIds?: string[] | null
  } | null
}

export interface ApiSearchResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    conversations?: ApiConversation[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiTeamMembersResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    members?: ApiTeamMember[] | null
  } | null
}

export interface ApiTeamDataResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    team?: ApiTeamRef | null
    members?: ApiTeamMember[] | null
  } | null
}

// ── Team management (create / detail / settings / invite) ──────────────────

export interface ApiCreateTeamResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    conversation?: ApiConversation | null
    teamId?: string | null
  } | null
}

export interface ApiTeamSettings {
  smsNotification?: boolean | null
  pushNotification?: boolean | null
  showOnBaseAvg?: boolean | null
  showTop5Avg?: boolean | null
}

export interface ApiTeamStats {
  games?: number | null
  won?: number | null
  lost?: number | null
}

export interface ApiTeamCounts {
  allEvents?: number | null
  associations?: number | null
  teammates?: number | null
  sharedFiles?: number | null
}

export interface ApiTeamGoingUser {
  userChatId?: string | null
  name?: string | null
  avatarUrl?: string | null
}

export interface ApiTeamOngoingEvent {
  id?: string | null
  name?: string | null
  status?: string | null
  startDate?: string | null
  endDate?: string | null
  location?: string | null
  goingUsers?: ApiTeamGoingUser[] | null
  goingCount?: number | null
}

export interface ApiTeamDetail {
  id?: string | null
  teamId?: string | null
  name?: string | null
  categoryLabel?: string | null
  ageGenderLabel?: string | null
  logoUrl?: string | null
  isAdmin?: boolean | null
  createdByName?: string | null
  createdAt?: string | null
  stats?: ApiTeamStats | null
  settings?: ApiTeamSettings | null
  counts?: ApiTeamCounts | null
  ongoingEvent?: ApiTeamOngoingEvent | null
}

export interface ApiTeamDetailResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    team?: ApiTeamDetail | null
  } | null
}

export interface ApiTeamSettingsResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    settings?: ApiTeamSettings | null
  } | null
}

export interface ApiTeamInviteLinkResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    url?: string | null
  } | null
}

export interface ApiTeamInviteResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    message?: string | null
  } | null
}

// ── Message info (read/delivery receipts breakdown) ────────────────────────

export interface ApiMessageInfoRecipient {
  userChatId?: string | null
  name?: string | null
  avatarUrl?: string | null
  deliveredAt?: string | null
  readAt?: string | null
}

export interface ApiMessageInfoResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    messageId?: string | null
    sentAt?: string | null
    recipients?: ApiMessageInfoRecipient[] | null
  } | null
}
