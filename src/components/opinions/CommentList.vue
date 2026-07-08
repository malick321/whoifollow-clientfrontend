<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  createOpinionPostComment,
  fetchOpinionPostComments,
  type OpinionComment
} from '../../api/opinions'
import { getAuthUserChatId, getAuthUserId, getAuthUserName } from '../../auth-session'
import { pushToast } from '../../toast-center'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import { formatRelativeTime } from './relative-time'

const props = defineProps<{
  postId: string
  currentUserName: string
  currentUserAvatarUrl?: string | null
}>()

const emit = defineEmits<{
  (event: 'created', comment: OpinionComment): void
}>()

const comments = ref<OpinionComment[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const saving = ref(false)
const content = ref('')

function newestPageToDisplay(commentsPage: OpinionComment[]) {
  return [...commentsPage].reverse()
}

async function loadInitial() {
  loading.value = true
  try {
    const page = await fetchOpinionPostComments(props.postId, { limit: 3 })
    comments.value = newestPageToDisplay(page.comments)
    nextCursor.value = page.nextCursor
  } catch (error) {
    comments.value = []
    nextCursor.value = null
    pushToast({
      tone: 'warning',
      title: 'Could not load comments',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loading.value = false
  }
}

async function loadPrevious() {
  if (!nextCursor.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const page = await fetchOpinionPostComments(props.postId, {
      cursor: nextCursor.value,
      limit: 10
    })
    comments.value = [...newestPageToDisplay(page.comments), ...comments.value]
    nextCursor.value = page.nextCursor
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load previous comments',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loadingMore.value = false
  }
}

async function submit() {
  const value = content.value.trim()
  if (!value || saving.value) return

  const tempComment: OpinionComment = {
    id: `temp-${Date.now()}`,
    author: {
      userChatId: getAuthUserChatId() || null,
      userId: getAuthUserId(),
      name: getAuthUserName() || props.currentUserName,
      avatarUrl: props.currentUserAvatarUrl ?? null
    },
    content: value,
    createdAt: new Date().toISOString()
  }

  content.value = ''
  comments.value = [...comments.value, tempComment]
  saving.value = true

  try {
    const saved = await createOpinionPostComment(props.postId, value)
    comments.value = comments.value.map((comment) => comment.id === tempComment.id ? saved : comment)
    emit('created', saved)
  } catch (error) {
    comments.value = comments.value.filter((comment) => comment.id !== tempComment.id)
    content.value = value
    pushToast({
      tone: 'warning',
      title: 'Could not add comment',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    saving.value = false
  }
}

onMounted(loadInitial)

watch(
  () => props.postId,
  () => {
    void loadInitial()
  }
)
</script>

<template>
  <section class="opinion-comments">
    <button
      v-if="nextCursor"
      type="button"
      class="opinion-comments__previous"
      :disabled="loadingMore"
      @click="loadPrevious"
    >
      {{ loadingMore ? 'Loading comments…' : 'View previous comments' }}
    </button>

    <div v-if="loading" class="opinion-comments__loading">
      <span v-for="item in 3" :key="item"></span>
    </div>

    <div v-else class="opinion-comments__list">
      <article v-for="comment in comments" :key="comment.id" class="opinion-comments__item">
        <TeamAvatar :name="comment.author.name" :image-url="comment.author.avatarUrl ?? undefined" size="sm" />
        <div class="opinion-comments__body">
          <div class="opinion-comments__bubble">
            <strong>{{ comment.author.name }}</strong>
            <p>{{ comment.content }}</p>
          </div>
          <time v-if="comment.createdAt" :datetime="comment.createdAt">{{ formatRelativeTime(comment.createdAt) }}</time>
        </div>
      </article>
    </div>

    <form class="opinion-comments__form" @submit.prevent="submit">
      <TeamAvatar :name="currentUserName" :image-url="currentUserAvatarUrl ?? undefined" size="sm" />
      <div class="opinion-comments__field">
        <input v-model="content" type="text" placeholder="Write a comment…" :disabled="saving" />
        <button type="submit" aria-label="Post comment" :disabled="!content.trim() || saving">
          <AppIcon name="message" :size="16" />
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.opinion-comments {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 4px;
  border-top: 1px solid var(--border-divider);
  padding-top: 14px;
}

.opinion-comments__previous {
  align-self: flex-start;
  border: 0;
  background: transparent;
  color: var(--primary);
  font-family: var(--font-body);
  font-size: 0.84rem;
  font-weight: 500;
  cursor: pointer;
}

.opinion-comments__previous:hover {
  text-decoration: underline;
}

.opinion-comments__previous:disabled {
  cursor: wait;
  opacity: 0.65;
}

.opinion-comments__loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opinion-comments__loading span {
  height: 44px;
  border-radius: 16px;
  background: linear-gradient(90deg, var(--shimmer-start), var(--shimmer-mid), var(--shimmer-end));
  background-size: 220% 100%;
  animation: opinion-comment-shimmer 1.2s ease-in-out infinite;
}

.opinion-comments__list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.opinion-comments__item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  align-items: start;
}

.opinion-comments__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
}

.opinion-comments__bubble {
  min-width: 0;
  max-width: 100%;
  padding: 8px 13px;
  border-radius: 4px 16px 16px 16px;
  background: var(--surface-raised);
  border: 1px solid var(--border-divider);
}

.opinion-comments__bubble strong {
  display: block;
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 500;
}

.opinion-comments__bubble p {
  margin: 2px 0 0;
  color: var(--text);
  font-size: 0.88rem;
  font-weight: 400;
  line-height: 1.42;
  white-space: pre-wrap;
  word-break: break-word;
}

.opinion-comments__body time {
  padding-left: 6px;
  color: var(--text-light);
  font-size: 0.72rem;
}

.opinion-comments__form {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  align-items: center;
}

.opinion-comments__field {
  position: relative;
  display: flex;
  min-width: 0;
  align-items: center;
}

.opinion-comments__field input {
  min-width: 0;
  width: 100%;
  height: 40px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-raised);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.88rem;
  padding: 0 46px 0 15px;
  transition: border-color 140ms ease, background 140ms ease;
}

.opinion-comments__field input::placeholder {
  color: var(--text-light);
}

.opinion-comments__field input:focus {
  border-color: var(--border-accent-hover);
  background: var(--surface-opaque);
  outline: none;
}

.opinion-comments__field button {
  position: absolute;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  transition: filter 140ms ease, opacity 140ms ease, box-shadow 140ms ease;
}

.opinion-comments__field button :deep(.app-icon__primary),
.opinion-comments__field button :deep(.app-icon__secondary) {
  stroke: #fff;
}

.opinion-comments__field button:hover:not(:disabled) {
  filter: brightness(1.06);
}

.opinion-comments__field button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  box-shadow: none;
}

@keyframes opinion-comment-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}
</style>
