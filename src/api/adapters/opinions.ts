import type {
  ApiOpinionAuthor,
  ApiOpinionComment,
  ApiOpinionCommentsResponse,
  ApiOpinionCommentResponse,
  ApiOpinionLikeResponse,
  ApiOpinionLikersResponse,
  ApiOpinionPost,
  ApiOpinionPostResponse,
  ApiOpinionPostsResponse
} from '../contracts/opinions'
import type {
  OpinionAuthor,
  OpinionComment,
  OpinionCommentsPage,
  OpinionLikeResult,
  OpinionLikersPage,
  OpinionPost,
  OpinionPostsPage
} from '../opinions'

export function adaptOpinionAuthor(raw: ApiOpinionAuthor | null | undefined): OpinionAuthor {
  return {
    userChatId: raw?.userChatId ?? null,
    userId: raw?.userId ?? null,
    name: raw?.name ?? 'Unknown user',
    avatarUrl: raw?.avatarUrl ?? null
  }
}

export function adaptOpinionPost(raw: ApiOpinionPost): OpinionPost {
  return {
    id: String(raw.id),
    author: adaptOpinionAuthor(raw.author),
    content: raw.content ?? '',
    images: Array.isArray(raw.images) ? raw.images.filter((url) => typeof url === 'string') : [],
    likeCount: Number(raw.likeCount ?? 0),
    likedByMe: !!raw.likedByMe,
    commentCount: Number(raw.commentCount ?? 0),
    createdAt: raw.createdAt ?? '',
    isMine: !!raw.isMine
  }
}

export function adaptOpinionComment(raw: ApiOpinionComment): OpinionComment {
  return {
    id: String(raw.id),
    author: adaptOpinionAuthor(raw.author),
    content: raw.content ?? '',
    createdAt: raw.createdAt ?? ''
  }
}

export function adaptOpinionPosts(response: ApiOpinionPostsResponse): OpinionPostsPage {
  const data = response.data
  const rows = data?.posts ?? []

  return {
    posts: rows.map(adaptOpinionPost),
    nextCursor: data?.nextCursor ?? null
  }
}

export function adaptOpinionPostResponse(response: ApiOpinionPostResponse): OpinionPost | null {
  return response.data?.post ? adaptOpinionPost(response.data.post) : null
}

export function adaptOpinionLike(response: ApiOpinionLikeResponse): OpinionLikeResult {
  return {
    likeCount: Number(response.data?.likeCount ?? 0),
    likedByMe: !!response.data?.likedByMe
  }
}

export function adaptOpinionComments(response: ApiOpinionCommentsResponse): OpinionCommentsPage {
  const data = response.data
  const rows = data?.comments ?? []

  return {
    comments: rows.map(adaptOpinionComment),
    nextCursor: data?.nextCursor ?? null
  }
}

export function adaptOpinionCommentResponse(
  response: ApiOpinionCommentResponse
): OpinionComment | null {
  return response.data?.comment ? adaptOpinionComment(response.data.comment) : null
}

export function adaptOpinionLikers(response: ApiOpinionLikersResponse): OpinionLikersPage {
  const data = response.data
  const rows = data?.users ?? []

  return {
    users: rows.map(adaptOpinionAuthor),
    nextCursor: data?.nextCursor ?? null
  }
}
