<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  deleteOpinionPost,
  fetchOpinionMe,
  fetchOpinionPosts,
  fetchOpinionSpecialists,
  toggleOpinionPostLike,
  updateOpinionPost,
  type OpinionComment,
  type OpinionMe,
  type OpinionPost
} from '../api/opinions'
import {
  authEmail,
  authUserAvatarUrl,
  authUserName,
  clearAuthSession,
  isAuthenticated,
  setChatIdentity
} from '../auth-session'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import TeamAvatar from '../components/TeamAvatar.vue'
import CommentList from '../components/opinions/CommentList.vue'
import PostCard from '../components/opinions/PostCard.vue'
import PostComposer from '../components/opinions/PostComposer.vue'
import PostLikersModal from '../components/opinions/PostLikersModal.vue'
import { formatRelativeTime } from '../components/opinions/relative-time'
import { pushToast } from '../toast-center'
import { confirmDialog } from '../confirm-center'

const FEED_LIMIT = 8
const SPECIALIST_LIMIT = 5

const route = useRoute()
const router = useRouter()

const posts = ref<OpinionPost[]>([])
const specialists = ref<OpinionPost[]>([])
const currentUser = ref<OpinionMe['user'] | null>(null)
const nextCursor = ref<string | null>(null)
const specialistCursor = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const loadingSpecialists = ref(true)
const loadingMoreSpecialists = ref(false)
const expandedComments = ref<Set<string>>(new Set())
const likeBusyIds = ref<Set<string>>(new Set())
const mutationBusyIds = ref<Set<string>>(new Set())
const selectedLikersPost = ref<OpinionPost | null>(null)
const specialistMenuId = ref<string | null>(null)
const editingSpecialistId = ref<string | null>(null)
const specialistDraft = ref('')
const feedSentinel = ref<HTMLElement | null>(null)
// Facebook-style: scrolling back to the top auto-loads newer posts (no button).
const topSentinel = ref<HTMLElement | null>(null)
const loadingNewer = ref(false)
let lastNewerCheck = 0

let observer: IntersectionObserver | null = null
let topObserver: IntersectionObserver | null = null

function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.trim() ?? ''
  if (!local) return ''
  return local
    .replace(/[._-]+/g, ' ')
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

const currentUserName = computed(
  () => {
    const apiName = currentUser.value?.name?.trim()
    if (apiName && apiName !== 'Unknown user') return apiName
    return authUserName.value || nameFromEmail(authEmail.value) || 'WIF User'
  }
)
const currentUserAvatarUrl = computed(
  () => currentUser.value?.avatarUrl || authUserAvatarUrl.value || null
)
const canPostAsSpecialist = computed(() => !!currentUser.value?.isSpecialist)

function redirectToLogin() {
  void router.replace({ name: 'login', query: { redirect: route.fullPath } })
}

function isUnauthorized(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === 401
}

function handleAuthError(error: unknown): boolean {
  if (!isUnauthorized(error)) return false
  clearAuthSession()
  redirectToLogin()
  return true
}

function dedupePosts(items: OpinionPost[]): OpinionPost[] {
  const seen = new Set<string>()
  return items.filter((post) => {
    if (seen.has(post.id)) return false
    seen.add(post.id)
    return true
  })
}

function setBusy(target: typeof likeBusyIds | typeof mutationBusyIds, id: string, busy: boolean) {
  const next = new Set(target.value)
  if (busy) next.add(id)
  else next.delete(id)
  target.value = next
}

async function loadCurrentUser() {
  try {
    const me = await fetchOpinionMe()
    currentUser.value = me?.user ?? null
    if (me?.user.userChatId) {
      setChatIdentity(me.user.userChatId, me.user.name, me.user.avatarUrl)
    }
  } catch (error) {
    if (handleAuthError(error)) return
    currentUser.value = null
  }
}

function updatePostEverywhere(postId: string, updater: (post: OpinionPost) => OpinionPost) {
  posts.value = posts.value.map((post) => post.id === postId ? updater(post) : post)
  specialists.value = specialists.value.map((post) => post.id === postId ? updater(post) : post)
  if (selectedLikersPost.value?.id === postId) {
    selectedLikersPost.value = updater(selectedLikersPost.value)
  }
}

function replacePostEverywhere(updated: OpinionPost) {
  updatePostEverywhere(updated.id, () => updated)
}

function removePostEverywhere(postId: string) {
  posts.value = posts.value.filter((post) => post.id !== postId)
  specialists.value = specialists.value.filter((post) => post.id !== postId)
  if (selectedLikersPost.value?.id === postId) selectedLikersPost.value = null
}

async function loadPosts(reset = false) {
  if (reset) loading.value = true
  else loadingMore.value = true

  try {
    const page = await fetchOpinionPosts({
      cursor: reset ? null : nextCursor.value,
      limit: FEED_LIMIT
    })
    posts.value = reset ? page.posts : dedupePosts([...posts.value, ...page.posts])
    nextCursor.value = page.nextCursor
  } catch (error) {
    if (handleAuthError(error)) return
    if (reset) posts.value = []
    pushToast({
      tone: 'warning',
      title: 'Could not load posts',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

async function loadSpecialists(reset = false) {
  if (reset) loadingSpecialists.value = true
  else loadingMoreSpecialists.value = true

  try {
    const page = await fetchOpinionSpecialists({
      cursor: reset ? null : specialistCursor.value,
      limit: SPECIALIST_LIMIT
    })
    specialists.value = reset ? page.posts : dedupePosts([...specialists.value, ...page.posts])
    specialistCursor.value = page.nextCursor
  } catch (error) {
    if (handleAuthError(error)) return
    if (reset) specialists.value = []
    pushToast({
      tone: 'warning',
      title: 'Could not load specialists',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loadingSpecialists.value = false
    loadingMoreSpecialists.value = false
  }
}

function setupObserver() {
  observer?.disconnect()
  if (!feedSentinel.value) return

  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && nextCursor.value && !loadingMore.value && !loading.value) {
        void loadPosts(false)
      }
    },
    { rootMargin: '520px 0px' }
  )
  observer.observe(feedSentinel.value)
}

// Fetch the latest page and prepend any posts we don't already have. Throttled
// so returning to the top repeatedly doesn't hammer the API.
async function loadNewer() {
  const now = Date.now()
  if (loading.value || loadingNewer.value || now - lastNewerCheck < 6000) return
  lastNewerCheck = now
  loadingNewer.value = true
  try {
    const page = await fetchOpinionPosts({ cursor: null, limit: FEED_LIMIT })
    const existing = new Set(posts.value.map((p) => p.id))
    const fresh = page.posts.filter((p) => !existing.has(p.id))
    if (fresh.length) posts.value = dedupePosts([...fresh, ...posts.value])
  } catch (error) {
    if (handleAuthError(error)) return
    // Background refresh - stay quiet on failure.
  } finally {
    loadingNewer.value = false
  }
}

function setupTopObserver() {
  topObserver?.disconnect()
  if (!topSentinel.value) return
  topObserver = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) void loadNewer()
  })
  topObserver.observe(topSentinel.value)
}

function onPostCreated(post: OpinionPost) {
  if (post.isSpecialist) {
    specialists.value = dedupePosts([post, ...specialists.value])
    return
  }
  posts.value = dedupePosts([post, ...posts.value])
}

function commentsOpen(postId: string) {
  return expandedComments.value.has(postId)
}

function toggleComments(postId: string) {
  const next = new Set(expandedComments.value)
  if (next.has(postId)) next.delete(postId)
  else next.add(postId)
  expandedComments.value = next
}

async function toggleLike(post: OpinionPost) {
  if (likeBusyIds.value.has(post.id)) return

  const previous = {
    likedByMe: post.likedByMe,
    likeCount: post.likeCount
  }

  setBusy(likeBusyIds, post.id, true)
  updatePostEverywhere(post.id, (item) => ({
    ...item,
    likedByMe: !item.likedByMe,
    likeCount: Math.max(0, item.likeCount + (item.likedByMe ? -1 : 1))
  }))

  try {
    const result = await toggleOpinionPostLike(post.id)
    updatePostEverywhere(post.id, (item) => ({
      ...item,
      likedByMe: result.likedByMe,
      likeCount: result.likeCount
    }))
  } catch (error) {
    updatePostEverywhere(post.id, (item) => ({
      ...item,
      likedByMe: previous.likedByMe,
      likeCount: previous.likeCount
    }))
    pushToast({
      tone: 'warning',
      title: 'Could not update like',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setBusy(likeBusyIds, post.id, false)
  }
}

async function savePost(post: OpinionPost, content: string) {
  setBusy(mutationBusyIds, post.id, true)
  try {
    replacePostEverywhere(await updateOpinionPost(post.id, content))
    pushToast({ tone: 'success', title: 'Post updated' })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not update post',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setBusy(mutationBusyIds, post.id, false)
  }
}

async function removePost(post: OpinionPost) {
  setBusy(mutationBusyIds, post.id, true)
  try {
    await deleteOpinionPost(post.id)
    removePostEverywhere(post.id)
    pushToast({ tone: 'success', title: 'Post deleted' })
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not delete post',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    setBusy(mutationBusyIds, post.id, false)
  }
}

function onCommentCreated(postId: string, _comment: OpinionComment) {
  updatePostEverywhere(postId, (post) => ({
    ...post,
    commentCount: post.commentCount + 1
  }))
}

function closeSpecialistMenu() {
  specialistMenuId.value = null
}

function toggleSpecialistMenu(postId: string) {
  specialistMenuId.value = specialistMenuId.value === postId ? null : postId
}

function startSpecialistEdit(post: OpinionPost) {
  specialistDraft.value = post.content
  editingSpecialistId.value = post.id
  specialistMenuId.value = null
}

function cancelSpecialistEdit() {
  editingSpecialistId.value = null
  specialistDraft.value = ''
}

async function saveSpecialistEdit(post: OpinionPost) {
  const content = specialistDraft.value.trim()
  if (!content || content === post.content) {
    cancelSpecialistEdit()
    return
  }
  editingSpecialistId.value = null
  await savePost(post, content)
}

async function removeSpecialistPost(post: OpinionPost) {
  specialistMenuId.value = null
  if (!(await confirmDialog({
    title: 'Delete this post?',
    message: 'This specialist post will be permanently removed.',
    confirmLabel: 'Delete',
    danger: true
  }))) return
  await removePost(post)
}

onMounted(async () => {
  if (!isAuthenticated.value) {
    redirectToLogin()
    return
  }
  document.addEventListener('click', closeSpecialistMenu)
  await loadCurrentUser()
  if (!isAuthenticated.value) return
  await Promise.all([loadPosts(true), loadSpecialists(true)])
  await nextTick()
  setupObserver()
  // Skip the initial (already-intersecting) fire so we don't refetch right
  // after the first load; it fires again only when the user scrolls back up.
  lastNewerCheck = Date.now()
  setupTopObserver()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  topObserver?.disconnect()
  document.removeEventListener('click', closeSpecialistMenu)
})

watch(nextCursor, async () => {
  await nextTick()
  setupObserver()
})

watch(isAuthenticated, (authenticated) => {
  if (!authenticated) redirectToLogin()
})
</script>

<template>
  <section class="opinions-page">
    <aside class="opinions-page__left" aria-label="Opinions navigation">
      <section class="opinions-profile">
        <div class="opinions-profile__cover"></div>
        <div class="opinions-profile__body">
          <TeamAvatar :name="currentUserName" :image-url="currentUserAvatarUrl ?? undefined" size="lg" />
          <h2>{{ currentUserName }}</h2>
          <p>Sharing opinions with the community</p>
        </div>
      </section>

      <nav class="opinions-nav">
        <a class="opinions-nav__item opinions-nav__item--active" href="/opinions">
          <AppIcon name="text" :size="18" />
          <span>Feed</span>
        </a>
        <a class="opinions-nav__item" href="/friends">
          <AppIcon name="people" :size="18" />
          <span>Friends</span>
        </a>
      </nav>
    </aside>

    <main class="opinions-page__feed">
      <header class="opinions-page__header">
        <div>
          <p>Opinions</p>
          <h1>Feed</h1>
        </div>
      </header>

      <PostComposer
        :current-user-name="currentUserName"
        :current-user-avatar-url="currentUserAvatarUrl"
        :can-post-as-specialist="canPostAsSpecialist"
        @created="onPostCreated"
      />

      <!-- Scrolling back to the top auto-loads newer posts (no refresh button). -->
      <div ref="topSentinel" class="opinions-feed__top-sentinel" aria-hidden="true"></div>
      <p v-if="loadingNewer" class="opinions-feed__newer">Checking for new posts…</p>

      <div v-if="loading" class="opinions-feed-skeleton">
        <div v-for="item in 4" :key="item" class="opinions-skeleton-card">
          <div class="opinions-skeleton-card__head">
            <span class="opinions-skeleton-card__avatar"></span>
            <div class="opinions-skeleton-card__lines">
              <span></span>
              <span></span>
            </div>
          </div>
          <span class="opinions-skeleton-card__text"></span>
          <span class="opinions-skeleton-card__text opinions-skeleton-card__text--short"></span>
          <span class="opinions-skeleton-card__media"></span>
        </div>
      </div>

      <div v-else-if="!posts.length" class="opinions-empty">
        <span class="opinions-empty__mark"><AppIcon name="text" :size="26" /></span>
        <h2>No posts yet</h2>
        <p>Be the first to share what's on your mind.</p>
      </div>

      <div v-else class="opinions-feed">
        <PostCard
          v-for="post in posts"
          :key="post.id"
          :post="post"
          :comments-open="commentsOpen(post.id)"
          :like-busy="likeBusyIds.has(post.id)"
          :mutation-busy="mutationBusyIds.has(post.id)"
          @like="toggleLike(post)"
          @toggle-comments="toggleComments(post.id)"
          @show-likers="selectedLikersPost = post"
          @update="savePost(post, $event)"
          @delete="removePost(post)"
        >
          <CommentList
            v-if="commentsOpen(post.id)"
            :post-id="post.id"
            :current-user-name="currentUserName"
            :current-user-avatar-url="currentUserAvatarUrl"
            @created="onCommentCreated(post.id, $event)"
          />
        </PostCard>
      </div>

      <div v-if="nextCursor" ref="feedSentinel" class="opinions-feed__sentinel">
        {{ loadingMore ? 'Loading more posts' : '' }}
      </div>
    </main>

    <aside class="opinions-page__right" aria-label="Specialists">
      <header class="opinions-specialists__header">
        <div>
          <p>Specialists</p>
          <h2>Latest</h2>
        </div>
        <span class="opinions-specialists__badge"><AppIcon name="award" :size="20" /></span>
      </header>

      <div v-if="loadingSpecialists" class="opinions-specialists__loading">
        <div v-for="item in 4" :key="item" class="opinions-specialist-skeleton">
          <div class="opinions-specialist-skeleton__head">
            <span class="opinions-specialist-skeleton__avatar"></span>
            <span class="opinions-specialist-skeleton__line"></span>
          </div>
          <span class="opinions-specialist-skeleton__text"></span>
        </div>
      </div>

      <div v-else-if="!specialists.length" class="opinions-specialists__empty">
        <span class="opinions-specialists__empty-mark"><AppIcon name="award" :size="22" /></span>
        <p>No specialist posts yet</p>
      </div>

      <div v-else class="opinions-specialists__list">
        <article v-for="post in specialists" :key="post.id" class="opinions-specialist-card">
          <header>
            <TeamAvatar :name="post.author.name" :image-url="post.author.avatarUrl ?? undefined" size="sm" />
            <div>
              <h3>{{ post.author.name }}</h3>
              <time :datetime="post.createdAt">{{ formatRelativeTime(post.createdAt) }}</time>
            </div>
            <div v-if="post.isMine" class="opinions-specialist-card__menu" @click.stop>
              <button
                type="button"
                class="opinions-specialist-card__menu-btn"
                :class="{ 'is-active': specialistMenuId === post.id }"
                aria-label="Specialist post menu"
                :aria-expanded="specialistMenuId === post.id ? 'true' : 'false'"
                @click="toggleSpecialistMenu(post.id)"
              >
                <AppIcon name="ellipsis" :size="16" />
              </button>
              <div v-if="specialistMenuId === post.id" class="opinions-specialist-card__popover">
                <button type="button" @click="startSpecialistEdit(post)">
                  <AppIcon name="text" :size="15" />
                  <span>Edit post</span>
                </button>
                <button type="button" class="is-danger" @click="removeSpecialistPost(post)">
                  <AppIcon name="close" :size="15" />
                  <span>Delete post</span>
                </button>
              </div>
            </div>
            <span class="opinions-specialist-card__tag"><AppIcon name="award" :size="13" /></span>
          </header>
          <div v-if="editingSpecialistId === post.id" class="opinions-specialist-card__editor">
            <textarea v-model="specialistDraft" rows="3" :disabled="mutationBusyIds.has(post.id)"></textarea>
            <div>
              <button type="button" :disabled="mutationBusyIds.has(post.id)" @click="cancelSpecialistEdit">Cancel</button>
              <button type="button" :disabled="mutationBusyIds.has(post.id) || !specialistDraft.trim()" @click="saveSpecialistEdit(post)">Save</button>
            </div>
          </div>
          <p v-else-if="post.content">{{ post.content }}</p>
          <div v-if="post.images[0]" class="opinions-specialist-card__media">
            <img :src="post.images[0]" alt="Specialist post image" loading="lazy" />
          </div>
          <footer class="opinions-specialist-card__actions">
            <button
              type="button"
              class="opinions-specialist-card__action"
              :class="{ 'is-liked': post.likedByMe }"
              :disabled="likeBusyIds.has(post.id)"
              :aria-pressed="post.likedByMe ? 'true' : 'false'"
              @click="toggleLike(post)"
            >
              <AppIcon name="like" :size="14" />
              <span>{{ post.likedByMe ? 'Liked' : 'Like' }}</span>
              <b v-if="post.likeCount">{{ post.likeCount }}</b>
            </button>
            <button
              type="button"
              class="opinions-specialist-card__action"
              :class="{ 'is-active': commentsOpen(post.id) }"
              @click="toggleComments(post.id)"
            >
              <AppIcon name="message" :size="14" />
              <span>Comment</span>
              <b v-if="post.commentCount">{{ post.commentCount }}</b>
            </button>
          </footer>
          <CommentList
            v-if="commentsOpen(post.id)"
            :post-id="post.id"
            :current-user-name="currentUser?.name || 'You'"
            :current-user-avatar-url="currentUser?.avatarUrl ?? null"
            @created="onCommentCreated(post.id, $event)"
          />
        </article>
      </div>

      <button
        v-if="specialistCursor"
        type="button"
        class="opinions-specialists__more"
        :disabled="loadingMoreSpecialists"
        @click="loadSpecialists(false)"
      >
        {{ loadingMoreSpecialists ? 'Loading' : 'Load more' }}
      </button>
    </aside>

    <PostLikersModal
      :model-value="!!selectedLikersPost"
      :post-id="selectedLikersPost?.id ?? null"
      :like-count="selectedLikersPost?.likeCount ?? 0"
      @update:modelValue="selectedLikersPost = $event ? selectedLikersPost : null"
    />
  </section>
</template>

<style scoped>
.opinions-page {
  display: grid;
  grid-template-columns: minmax(180px, 220px) minmax(0, 680px) minmax(240px, 300px);
  gap: 18px;
  align-items: start;
  width: min(100%, 1280px);
  margin: 0 auto;
  padding: 24px 18px 42px;
}

.opinions-page__left,
.opinions-page__right {
  position: sticky;
  top: 18px;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}

.opinions-page__feed {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
}

.opinions-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.opinions-page__header p,
.opinions-specialists__header p {
  margin: 0 0 4px;
  color: var(--primary);
  font-size: 0.76rem;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: uppercase;
}

.opinions-page__header h1,
.opinions-specialists__header h2 {
  margin: 0;
  color: var(--text);
  font-size: 1.55rem;
  font-weight: 500;
  letter-spacing: 0;
}

.opinions-page__refresh,
.opinions-specialists__more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 14px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-btn-solid);
  color: var(--secondary);
  font-family: var(--font-body);
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.opinions-page__refresh:hover:not(:disabled),
.opinions-specialists__more:hover:not(:disabled) {
  background: var(--surface-pill);
  color: var(--primary);
}

.opinions-page__refresh:disabled,
.opinions-specialists__more:disabled {
  cursor: wait;
  opacity: 0.62;
}

.opinions-profile,
.opinions-nav {
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
}

.opinions-profile {
  overflow: hidden;
}

.opinions-profile__cover {
  height: 64px;
  background: var(--surface-pill);
  border-bottom: 1px solid var(--border-divider);
}

.opinions-profile__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 0 14px 16px;
  text-align: center;
}

.opinions-profile__body :deep(.team-avatar-mark) {
  margin-top: -26px;
  border: 3px solid var(--surface-opaque);
  box-shadow: var(--shadow-soft);
}

.opinions-profile h2 {
  max-width: 100%;
  overflow: hidden;
  margin: 6px 0 0;
  color: var(--text);
  font-size: 1rem;
  font-weight: 500;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opinions-profile p {
  margin: 0;
  color: var(--text-light);
  font-size: 0.8rem;
  line-height: 1.4;
}

.opinions-nav {
  display: flex;
  flex-direction: column;
  padding: 6px;
}

.opinions-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 0 12px;
  border-radius: 10px;
  color: var(--secondary);
  font-size: 0.9rem;
  font-weight: 500;
  text-decoration: none;
  transition: background 140ms ease, color 140ms ease;
}

.opinions-nav__item:hover {
  background: var(--surface-pill);
  color: var(--primary);
}

.opinions-nav__item--active {
  background: var(--primary-light-3);
  color: var(--primary);
  font-weight: 500;
  box-shadow: inset 3px 0 0 var(--primary);
}

.opinions-feed {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.opinions-feed__sentinel {
  min-height: 42px;
  display: grid;
  place-items: center;
  color: var(--text-light);
  font-size: 0.86rem;
}

.opinions-feed__top-sentinel {
  height: 1px;
  margin-top: -1px;
}
.opinions-feed__newer {
  margin: 0;
  text-align: center;
  color: var(--text-light);
  font-size: 0.82rem;
  padding: 4px 0;
}

.opinions-feed-skeleton,
.opinions-specialists__loading {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.opinions-feed-skeleton [class*='__avatar'],
.opinions-feed-skeleton [class*='__line'],
.opinions-feed-skeleton [class*='__lines'] span,
.opinions-feed-skeleton [class*='__text'],
.opinions-feed-skeleton [class*='__media'],
.opinions-specialists__loading [class*='__avatar'],
.opinions-specialists__loading [class*='__line'],
.opinions-specialists__loading [class*='__text'] {
  display: block;
  border-radius: 8px;
  background: linear-gradient(90deg, var(--shimmer-start), var(--shimmer-mid), var(--shimmer-end));
  background-size: 220% 100%;
  animation: opinions-shimmer 1.2s ease-in-out infinite;
}

.opinions-skeleton-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
}

.opinions-skeleton-card__head {
  display: flex;
  align-items: center;
  gap: 11px;
}

.opinions-skeleton-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 999px !important;
  flex: none;
}

.opinions-skeleton-card__lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
}

.opinions-skeleton-card__lines span:first-child {
  width: 42%;
  height: 11px;
}

.opinions-skeleton-card__lines span:last-child {
  width: 26%;
  height: 9px;
}

.opinions-skeleton-card__text {
  height: 11px;
}

.opinions-skeleton-card__text--short {
  width: 70%;
}

.opinions-skeleton-card__media {
  height: 180px;
  border-radius: 12px !important;
  margin-top: 4px;
}

.opinions-specialist-skeleton {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
}

.opinions-specialist-skeleton__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.opinions-specialist-skeleton__avatar {
  width: 30px;
  height: 30px;
  border-radius: 999px !important;
  flex: none;
}

.opinions-specialist-skeleton__line {
  width: 55%;
  height: 10px;
}

.opinions-specialist-skeleton__text {
  height: 36px;
}

.opinions-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 44px 22px;
  border: 1px dashed var(--border-divider);
  border-radius: 14px;
  color: var(--text-light);
  background: var(--surface-card);
  text-align: center;
}

.opinions-empty__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  margin-bottom: 4px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--primary);
}

.opinions-empty h2 {
  margin: 0;
  color: var(--text);
  font-size: 1.05rem;
  font-weight: 500;
}

.opinions-empty p {
  margin: 0;
  font-size: 0.88rem;
}

.opinions-specialists__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 28px 18px;
  border: 1px dashed var(--border-divider);
  border-radius: 12px;
  color: var(--text-light);
  background: var(--surface-card);
  text-align: center;
  font-size: 0.86rem;
}

.opinions-specialists__empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--primary);
}

.opinions-specialists__empty p {
  margin: 0;
}

.opinions-specialists__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--primary);
}

.opinions-specialists__header h2 {
  font-size: 1.1rem;
}

.opinions-specialists__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--primary);
  border: 1px solid var(--border-divider);
}

.opinions-specialists__badge :deep(.app-icon__primary),
.opinions-specialists__badge :deep(.app-icon__secondary) {
  stroke: var(--primary);
  fill: rgba(45, 140, 240, 0.14);
}

.opinions-specialists__list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opinions-specialist-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 13px;
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
  transition: box-shadow 160ms ease, transform 160ms ease, border-color 160ms ease;
}

.opinions-specialist-card:hover {
  box-shadow: var(--shadow);
  border-color: var(--border-accent);
  transform: translateY(-1px);
}

.opinions-specialist-card header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.opinions-specialist-card__menu {
  position: relative;
}

.opinions-specialist-card__menu-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
}

.opinions-specialist-card__menu-btn:hover,
.opinions-specialist-card__menu-btn.is-active {
  background: var(--surface-pill);
  color: var(--primary);
}

.opinions-specialist-card__popover {
  position: absolute;
  top: 32px;
  right: 0;
  z-index: 6;
  min-width: 150px;
  padding: 6px;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-opaque);
  box-shadow: var(--shadow);
}

.opinions-specialist-card__popover button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.82rem;
  text-align: left;
  cursor: pointer;
}

.opinions-specialist-card__popover button:hover {
  background: var(--surface-pill);
}

.opinions-specialist-card__popover button.is-danger {
  color: var(--highlight);
}

.opinions-specialist-card__popover button.is-danger:hover {
  background: var(--danger-light);
}

.opinions-specialist-card__tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--primary-light-3);
  color: var(--primary);
}

.opinions-specialist-card h3 {
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: 0.86rem;
  font-weight: 500;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opinions-specialist-card time {
  display: block;
  color: var(--text-light);
  font-size: 0.74rem;
}

.opinions-specialist-card p {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 0.84rem;
  line-height: 1.38;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
}

.opinions-specialist-card__editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.opinions-specialist-card__editor textarea {
  width: 100%;
  min-width: 0;
  resize: vertical;
  border: 1px solid var(--border-divider);
  border-radius: 10px;
  background: var(--surface-opaque);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.84rem;
  line-height: 1.4;
  padding: 9px 10px;
}

.opinions-specialist-card__editor div {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.opinions-specialist-card__editor button {
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-card);
  color: var(--secondary);
  font-family: var(--font-body);
  font-size: 0.78rem;
  cursor: pointer;
}

.opinions-specialist-card__editor button:last-child {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

.opinions-specialist-card__editor button:disabled {
  cursor: wait;
  opacity: 0.62;
}

.opinions-specialist-card img {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  object-fit: cover;
  background: var(--surface-raised);
}

.opinions-specialist-card__actions {
  display: flex;
  gap: 8px;
  color: var(--text-light);
  font-size: 0.8rem;
}

.opinions-specialist-card__action {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 32px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md, 6px);
  background: var(--surface-card);
  color: var(--secondary);
  font-family: var(--font-body);
  font-size: 0.8rem;
  cursor: pointer;
}

.opinions-specialist-card__action:hover:not(:disabled),
.opinions-specialist-card__action.is-active {
  border-color: var(--border-accent-hover, var(--primary-light-2));
  color: var(--primary);
  background: var(--surface-pill);
}

.opinions-specialist-card__action.is-liked {
  border-color: var(--primary-light-2);
  color: var(--primary);
}

.opinions-specialist-card__action b {
  font-size: 0.74rem;
  font-weight: 600;
}

.opinions-specialist-card__action:disabled {
  cursor: wait;
  opacity: 0.65;
}

.opinions-specialists__more {
  width: 100%;
}

@keyframes opinions-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}

@media (max-width: 1120px) {
  .opinions-page {
    grid-template-columns: minmax(170px, 210px) minmax(0, 1fr);
  }

  .opinions-page__right {
    position: static;
    grid-column: 2;
  }
}

@media (max-width: 820px) {
  .opinions-page {
    grid-template-columns: 1fr;
    padding: 18px 12px 32px;
  }

  .opinions-page__left,
  .opinions-page__right {
    position: static;
  }

  .opinions-page__right {
    grid-column: auto;
  }

  .opinions-nav {
    flex-direction: row;
  }

  .opinions-nav__item {
    flex: 1 1 0;
    justify-content: center;
  }
}

@media (max-width: 720px) {
  .opinions-page {
    gap: 12px;
    padding: 14px 10px calc(28px + var(--member-bottom-nav-height, 64px));
  }

  .opinions-profile {
    display: none;
  }

  .opinions-nav {
    position: sticky;
    top: var(--member-topbar-height, 56px);
    z-index: 5;
    overflow-x: auto;
    border-radius: 10px;
    scrollbar-width: none;
  }

  .opinions-nav::-webkit-scrollbar {
    display: none;
  }

  .opinions-nav__item {
    flex: 0 0 auto;
    min-width: 118px;
  }

  .opinions-page__right {
    margin-top: 6px;
  }

  .opinions-specialist-card:hover {
    transform: none;
  }

  .opinions-page__feed :deep(.opinion-composer__previews) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .opinions-page__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .opinions-page__refresh {
    width: 100%;
  }

  .opinions-specialist-card {
    border-radius: 12px;
    padding: 11px;
  }

  .opinions-specialist-card header {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .opinions-specialist-card__tag {
    display: none;
  }
}
</style>
