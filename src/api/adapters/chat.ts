// Wire → domain adapters for the chat surface.
//
// The backend already returns camelCase, resolved CDN URLs and ISO dates per
// the contract, so these are thin, defensive renames. They additionally
// tolerate the snake_case fields the realtime gateway can forward on
// `offline-messages-sync` (raw Laravel rows), reading whichever key is present.

import type {
  ApiConversation,
  ApiMessage,
  ApiMessageFile,
  ApiParentMessage,
  ApiParticipant,
  ApiTeamMember
} from '../contracts/chat'
import type {
  ChatConversation,
  ChatMessage,
  ChatMessageFile,
  ChatMessageStatus,
  ChatParticipant,
  ChatTeamMember
} from '../chat'

function str(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const s = String(value)
  return s
}

function strOr(value: string | number | null | undefined, fallback = ''): string {
  return str(value) ?? fallback
}

function adaptMessageFile(raw: ApiMessageFile): ChatMessageFile {
  return {
    name: raw.name ?? '',
    type: raw.type ?? '',
    url: raw.url ?? '',
    size: raw.size ?? null,
    thumbnailUrl: raw.thumbnailUrl ?? null
  }
}

function adaptParentMessage(raw: ApiParentMessage | null | undefined): ChatMessage['parentMessage'] {
  if (!raw) return null
  return {
    id: strOr(raw.id),
    senderName: raw.senderName ?? raw.sender_name ?? '',
    preview: raw.preview ?? ''
  }
}

function normalizeStatus(value: string | null | undefined): ChatMessageStatus {
  if (value === 'read' || value === 'delivered' || value === 'sent') return value
  return 'sent'
}

export function adaptMessage(raw: ApiMessage): ChatMessage {
  const files = (raw.files ?? []).map(adaptMessageFile)
  return {
    id: strOr(raw.id),
    clientId: str(raw.clientId ?? raw.client_id) ?? null,
    conversationId: strOr(raw.conversationId ?? raw.conversation_id),
    senderChatId: strOr(raw.senderChatId ?? raw.sender_chat_id),
    senderName: raw.senderName ?? raw.sender_name ?? '',
    senderAvatarUrl: raw.senderAvatarUrl ?? null,
    content: raw.content ?? '',
    hasFile: !!(raw.hasFile ?? raw.has_file ?? files.length > 0),
    files,
    parentMessage: adaptParentMessage(raw.parentMessage ?? raw.parent_message),
    isPinned: !!raw.isPinned,
    isDeleted: !!raw.isDeleted,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    status: normalizeStatus(raw.status),
    deliveredTo: (raw.deliveredTo ?? []).map((id) => strOr(id)),
    readBy: (raw.readBy ?? []).map((id) => strOr(id))
  }
}

export function adaptParticipant(raw: ApiParticipant): ChatParticipant {
  return {
    userChatId: strOr(raw.userChatId),
    userId: str(raw.userId),
    name: raw.name ?? '',
    avatarUrl: raw.avatarUrl ?? null,
    role: raw.role === 'admin' ? 'admin' : 'member',
    lastReadAt: raw.lastReadAt ?? null
  }
}

export function adaptTeamMember(raw: ApiTeamMember): ChatTeamMember {
  const isAdmin = !!raw.isAdmin || raw.role === 'admin'
  const isFan = !!raw.isFan || raw.role === 'fan'
  return {
    memberId: str(raw.memberId),
    userChatId: strOr(raw.userChatId),
    userId: str(raw.userId),
    userIdFirebase: str(raw.userIdFirebase),
    name: raw.name ?? '',
    email: raw.email ?? null,
    avatarUrl: raw.avatarUrl ?? null,
    role: isAdmin ? 'admin' : (isFan ? 'fan' : 'member'),
    isAdmin,
    isFan,
    isPlayer: !!raw.isPlayer,
    isInvitationPending: !!raw.isInvitationPending,
    inviteId: str(raw.inviteId),
    inviteTarget: raw.inviteTarget ?? null,
    inviteTargetType: raw.inviteTargetType ?? null,
    inviteStatus: raw.inviteStatus ?? null,
    uniformNo: str(raw.uniformNo)
  }
}

export function adaptConversation(raw: ApiConversation): ChatConversation {
  const lm = raw.lastMessage
  return {
    id: strOr(raw.id),
    type: raw.type === 'team' ? 'team' : 'dm',
    title: raw.title ?? '',
    avatarUrl: raw.avatarUrl ?? null,
    team: raw.team
      ? {
          id: str(raw.team.id),
          teamId: str(raw.team.teamId),
          name: raw.team.name ?? '',
          avatarUrl: raw.team.avatarUrl ?? null
        }
      : null,
    otherUser: raw.otherUser
      ? {
          userChatId: strOr(raw.otherUser.userChatId),
          userId: str(raw.otherUser.userId),
          name: raw.otherUser.name ?? '',
          avatarUrl: raw.otherUser.avatarUrl ?? null
        }
      : null,
    lastMessage: lm
      ? {
          id: strOr(lm.id),
          senderChatId: strOr(lm.senderChatId),
          senderName: lm.senderName ?? '',
          preview: lm.preview ?? '',
          hasFile: !!lm.hasFile,
          createdAt: lm.createdAt ?? ''
        }
      : null,
    lastMessageAt: raw.lastMessageAt ?? null,
    unreadCount: raw.unreadCount ?? 0,
    isPinned: !!raw.isPinned,
    isArchived: !!raw.isArchived,
    participants: (raw.participants ?? []).map(adaptParticipant)
  }
}
