import { getAuthHeaders } from '../auth-session'
import { buildV2ApiUrl } from './config'

export interface CurrentUser {
  userChatId: string | null
  userId: string | null
  name: string
  avatarUrl: string | null
  isSpecialist: boolean
}

interface CurrentUserEnvelope {
  responseStatus?: {
    message?: string
  }
  data?: (Partial<CurrentUser> & {
    user?: Partial<CurrentUser> | null
  }) | null
}

async function parseEnvelope(response: Response): Promise<CurrentUserEnvelope> {
  const body = (await response.json().catch(() => ({}))) as CurrentUserEnvelope & {
    message?: string
  }

  if (!response.ok) {
    const message =
      body.responseStatus?.message || body.message || `Request failed: ${response.status}`
    throw Object.assign(new Error(message), { code: response.status })
  }

  return body
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const envelope = await parseEnvelope(
    await fetch(buildV2ApiUrl('/me'), {
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    })
  )

  const user = envelope.data?.user ?? envelope.data
  if (!user) return null

  return {
    userChatId: user.userChatId != null ? String(user.userChatId) : null,
    userId: user.userId != null ? String(user.userId) : null,
    name: user.name || 'User',
    avatarUrl: user.avatarUrl ?? null,
    isSpecialist: !!user.isSpecialist
  }
}
