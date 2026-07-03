export interface ApiOpinionResponseStatus {
  message?: string
  statusCode?: number
  text?: string
}

export interface ApiOpinionAuthor {
  userChatId: string | null
  userId: string | null
  name: string | null
  avatarUrl: string | null
}

export interface ApiOpinionPost {
  id: string
  author: ApiOpinionAuthor | null
  content: string | null
  images: string[] | null
  likeCount: number | null
  likedByMe: boolean | null
  commentCount: number | null
  createdAt: string | null
  isMine: boolean | null
}

export interface ApiOpinionComment {
  id: string
  author: ApiOpinionAuthor | null
  content: string | null
  createdAt: string | null
}

export interface ApiOpinionPostsResponse {
  responseStatus?: ApiOpinionResponseStatus
  data?: {
    posts?: ApiOpinionPost[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiOpinionPostResponse {
  responseStatus?: ApiOpinionResponseStatus
  data?: {
    post?: ApiOpinionPost | null
  } | null
}

export interface ApiOpinionLikeResponse {
  responseStatus?: ApiOpinionResponseStatus
  data?: {
    likeCount?: number | null
    likedByMe?: boolean | null
  } | null
}

export interface ApiOpinionCommentsResponse {
  responseStatus?: ApiOpinionResponseStatus
  data?: {
    comments?: ApiOpinionComment[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiOpinionCommentResponse {
  responseStatus?: ApiOpinionResponseStatus
  data?: {
    comment?: ApiOpinionComment | null
  } | null
}

export interface ApiOpinionLikersResponse {
  responseStatus?: ApiOpinionResponseStatus
  data?: {
    users?: ApiOpinionAuthor[] | null
    nextCursor?: string | null
  } | null
}
