<script setup lang="ts">
import { ref, watch } from 'vue'
import { fetchOpinionPostLikers, type OpinionAuthor } from '../../api/opinions'
import { pushToast } from '../../toast-center'
import AppIcon from '../AppIcon.vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'

const props = defineProps<{
  modelValue: boolean
  postId: string | null
  likeCount: number
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

const users = ref<OpinionAuthor[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)

async function load(reset = false) {
  if (!props.postId) return
  if (reset) {
    users.value = []
    nextCursor.value = null
    loading.value = true
  } else {
    loadingMore.value = true
  }

  try {
    const page = await fetchOpinionPostLikers(props.postId, {
      cursor: reset ? null : nextCursor.value,
      limit: 30
    })
    users.value = reset ? page.users : [...users.value, ...page.users]
    nextCursor.value = page.nextCursor
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not load likes',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

watch(
  () => [props.modelValue, props.postId] as const,
  ([open]) => {
    if (open) void load(true)
  }
)
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Likes"
    :subtitle="`${likeCount} ${likeCount === 1 ? 'person' : 'people'}`"
    @update:modelValue="emit('update:modelValue', $event)"
  >
    <div class="opinion-likers">
      <div v-if="loading" class="opinion-likers__loading">
        <span v-for="item in 6" :key="item"></span>
      </div>

      <div v-else-if="!users.length" class="opinion-likers__empty">
        <span class="opinion-likers__empty-mark"><AppIcon name="like" :size="22" /></span>
        <p>No likes yet</p>
        <span>Be the first to react to this post.</span>
      </div>

      <div v-else class="opinion-likers__list">
        <article v-for="user in users" :key="user.userId ?? user.name" class="opinion-likers__user">
          <TeamAvatar :name="user.name" :image-url="user.avatarUrl ?? undefined" size="attendee" />
          <div class="opinion-likers__user-text">
            <h3>{{ user.name }}</h3>
            <span>liked this</span>
          </div>
          <span class="opinion-likers__heart"><AppIcon name="like" :size="13" /></span>
        </article>
      </div>

      <button
        v-if="nextCursor"
        type="button"
        class="opinion-likers__more"
        :disabled="loadingMore"
        @click="load(false)"
      >
        {{ loadingMore ? 'Loading' : 'Load more' }}
      </button>
    </div>
  </SlideModal>
</template>

<style scoped>
.opinion-likers {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.opinion-likers__list,
.opinion-likers__loading {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opinion-likers__user {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 12px;
  background: transparent;
  transition: background 140ms ease;
}

.opinion-likers__user:hover {
  background: var(--surface-pill);
}

.opinion-likers__user-text {
  min-width: 0;
}

.opinion-likers__user h3 {
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: 0.94rem;
  font-weight: 500;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opinion-likers__user-text span {
  display: block;
  margin-top: 1px;
  color: var(--text-light);
  font-size: 0.78rem;
}

.opinion-likers__heart {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
}

.opinion-likers__heart :deep(.app-icon__primary),
.opinion-likers__heart :deep(.app-icon__secondary) {
  stroke: #fff;
  fill: #fff;
}

.opinion-likers__loading span {
  height: 60px;
  border-radius: 12px;
  background: linear-gradient(90deg, var(--shimmer-start), var(--shimmer-mid), var(--shimmer-end));
  background-size: 220% 100%;
  animation: opinion-likers-shimmer 1.2s ease-in-out infinite;
}

.opinion-likers__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 40px 24px;
  color: var(--text-light);
  text-align: center;
}

.opinion-likers__empty-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 4px;
  border-radius: 999px;
  background: var(--surface-pill);
  color: var(--primary);
}

.opinion-likers__empty p {
  margin: 0;
  color: var(--text);
  font-size: 0.96rem;
  font-weight: 500;
}

.opinion-likers__empty span {
  font-size: 0.84rem;
}

.opinion-likers__more {
  align-self: center;
  min-height: 38px;
  padding: 0 18px;
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  background: var(--surface-btn-solid);
  color: var(--secondary);
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
}

.opinion-likers__more:hover:not(:disabled) {
  background: var(--surface-pill);
}

.opinion-likers__more:disabled {
  cursor: wait;
  opacity: 0.65;
}

@keyframes opinion-likers-shimmer {
  from {
    background-position: 120% 0;
  }
  to {
    background-position: -120% 0;
  }
}
</style>
