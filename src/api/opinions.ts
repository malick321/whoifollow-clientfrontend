import { getAuthHeaders } from '../auth-session'
import { adaptOpinionComments, adaptOpinionCommentResponse, adaptOpinionLike, adaptOpinionLikers, adaptOpinionPostResponse, adaptOpinionPosts } from './adapters/opinions'
import { buildV2ApiUrl } from './config'
import { fetchCurrentUser } from './me'
import type {
  ApiOpinionCommentResponse,
  ApiOpinionCommentsResponse,
  ApiOpinionLikeResponse,
  ApiOpinionLikersResponse,
  ApiOpinionPostResponse,
  ApiOpinionPostsResponse
} from './contracts/opinions'

export interface OpinionAuthor {
  userChatId: string | null
  userId: string | null
  name: string
  avatarUrl: string | null
}

export interface OpinionPost {
  id: string
  author: OpinionAuthor
  content: string
  images: string[]
  likeCount: number
  likedByMe: boolean
  commentCount: number
  createdAt: string
  isMine: boolean
  isSpecialist: boolean
}

export interface OpinionComment {
  id: string
  author: OpinionAuthor
  content: string
  createdAt: string
}

export interface OpinionPostsPage {
  posts: OpinionPost[]
  nextCursor: string | null
}

export interface OpinionCommentsPage {
  comments: OpinionComment[]
  nextCursor: string | null
}

export interface OpinionLikersPage {
  users: OpinionAuthor[]
  nextCursor: string | null
}

export interface OpinionLikeResult {
  likeCount: number
  likedByMe: boolean
}

export interface OpinionMe {
  user: OpinionAuthor & {
    isSpecialist: boolean
  }
}

export interface CursorPageParams {
  cursor?: string | null
  limit?: number
}

export interface CreateOpinionPostPayload {
  content?: string
  images?: File[]
  isSpecialist?: boolean
}

function buildCursorQuery(params: CursorPageParams = {}): string {
  const query = new URLSearchParams()
  if (params.cursor) query.set('cursor', params.cursor)
  if (params.limit) query.set('limit', String(params.limit))
  const value = query.toString()
  return value ? `?${value}` : ''
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    responseStatus?: { message?: string }
    message?: string
  }

  if (!response.ok) {
    const message = body.responseStatus?.message || body.message || `Request failed: ${response.status}`
    throw Object.assign(new Error(message), { code: response.status })
  }

  return body as T
}

export async function fetchOpinionPosts(params: CursorPageParams = {}): Promise<OpinionPostsPage> {
  const response = await fetch(buildV2ApiUrl(`/opinions/posts${buildCursorQuery(params)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  return adaptOpinionPosts(await parseEnvelope<ApiOpinionPostsResponse>(response))
}

export async function fetchOpinionMe(): Promise<OpinionMe | null> {
  const user = await fetchCurrentUser()
  return user ? { user } : null
}

export async function createOpinionPost(payload: CreateOpinionPostPayload): Promise<OpinionPost> {
  const formData = new FormData()
  if (payload.content !== undefined) formData.set('content', payload.content)
  if (payload.isSpecialist) formData.set('expStatus', '1')
  payload.images?.forEach((file) => formData.append('images[]', file))

  const response = await fetch(buildV2ApiUrl('/opinions/posts'), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    },
    body: formData
  })

  const post = adaptOpinionPostResponse(await parseEnvelope<ApiOpinionPostResponse>(response))
  if (!post) throw new Error('Post response did not include a post.')
  return post
}

export async function updateOpinionPost(postId: string, content: string): Promise<OpinionPost> {
  const response = await fetch(buildV2ApiUrl(`/opinions/posts/${encodeURIComponent(postId)}`), {
    method: 'PATCH',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  })

  const post = adaptOpinionPostResponse(await parseEnvelope<ApiOpinionPostResponse>(response))
  if (!post) throw new Error('Post response did not include a post.')
  return post
}

export async function deleteOpinionPost(postId: string): Promise<void> {
  await parseEnvelope(await fetch(buildV2ApiUrl(`/opinions/posts/${encodeURIComponent(postId)}`), {
    method: 'DELETE',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  }))
}

export async function toggleOpinionPostLike(postId: string): Promise<OpinionLikeResult> {
  const response = await fetch(buildV2ApiUrl(`/opinions/posts/${encodeURIComponent(postId)}/like`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  return adaptOpinionLike(await parseEnvelope<ApiOpinionLikeResponse>(response))
}

export async function fetchOpinionPostLikers(
  postId: string,
  params: CursorPageParams = {}
): Promise<OpinionLikersPage> {
  const response = await fetch(
    buildV2ApiUrl(`/opinions/posts/${encodeURIComponent(postId)}/likers${buildCursorQuery(params)}`),
    {
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    }
  )

  return adaptOpinionLikers(await parseEnvelope<ApiOpinionLikersResponse>(response))
}

export async function fetchOpinionPostComments(
  postId: string,
  params: CursorPageParams = {}
): Promise<OpinionCommentsPage> {
  const response = await fetch(
    buildV2ApiUrl(`/opinions/posts/${encodeURIComponent(postId)}/comments${buildCursorQuery(params)}`),
    {
      headers: {
        ...getAuthHeaders(),
        Accept: 'application/json'
      }
    }
  )

  return adaptOpinionComments(await parseEnvelope<ApiOpinionCommentsResponse>(response))
}

export async function createOpinionPostComment(
  postId: string,
  content: string
): Promise<OpinionComment> {
  const response = await fetch(buildV2ApiUrl(`/opinions/posts/${encodeURIComponent(postId)}/comments`), {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content })
  })

  const comment = adaptOpinionCommentResponse(await parseEnvelope<ApiOpinionCommentResponse>(response))
  if (!comment) throw new Error('Comment response did not include a comment.')
  return comment
}

export async function fetchOpinionSpecialists(
  params: CursorPageParams = {}
): Promise<OpinionPostsPage> {
  const response = await fetch(buildV2ApiUrl(`/opinions/specialists${buildCursorQuery(params)}`), {
    headers: {
      ...getAuthHeaders(),
      Accept: 'application/json'
    }
  })

  return adaptOpinionPosts(await parseEnvelope<ApiOpinionPostsResponse>(response))
}
