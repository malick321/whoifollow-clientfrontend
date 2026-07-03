<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { OpinionPost } from '../../api/opinions'
import AppIcon from '../AppIcon.vue'
import TeamAvatar from '../TeamAvatar.vue'
import { formatAbsoluteTime, formatRelativeTime } from './relative-time'
import { confirmDialog } from '../../confirm-center'

const props = withDefaults(defineProps<{
  post: OpinionPost
  commentsOpen?: boolean
  likeBusy?: boolean
  mutationBusy?: boolean
  compact?: boolean
}>(), {
  commentsOpen: false,
  likeBusy: false,
  mutationBusy: false,
  compact: false
})

const emit = defineEmits<{
  (event: 'like'): void
  (event: 'toggle-comments'): void
  (event: 'show-likers'): void
  (event: 'update', content: string): void
  (event: 'delete'): void
}>()

const menuOpen = ref(false)
const editing = ref(false)
const draft = ref(props.post.content)
const menuRef = ref<HTMLElement | null>(null)

watch(
  () => props.post.content,
  (content) => {
    if (!editing.value) draft.value = content
  }
)

const likeLabel = computed(() => (props.post.likedByMe ? 'Unlike post' : 'Like post'))
const relativeTime = computed(() => formatRelativeTime(props.post.createdAt))
const absoluteTime = computed(() => formatAbsoluteTime(props.post.createdAt))
const imageCount = computed(() => props.post.images.length)
const visibleImages = computed(() => props.post.images.slice(0, 4))

function onDocumentClick(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    menuOpen.value = false
  }
}

watch(menuOpen, (open) => {
  if (typeof document === 'undefined') return
  if (open) document.addEventListener('click', onDocumentClick)
  else document.removeEventListener('click', onDocumentClick)
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('click', onDocumentClick)
})

function startEdit() {
  draft.value = props.post.content
  editing.value = true
  menuOpen.value = false
}

function cancelEdit() {
  draft.value = props.post.content
  editing.value = false
}

function saveEdit() {
  const value = draft.value.trim()
  if (!value || value === props.post.content) {
    cancelEdit()
    return
  }
  editing.value = false
  emit('update', value)
}

async function deletePost() {
  menuOpen.value = false
  if (!(await confirmDialog({
    title: 'Delete this post?',
    message: 'This post will be permanently removed.',
    confirmLabel: 'Delete',
    danger: true
  }))) return
  emit('delete')
}
</script>

<template>
  <article class="opinion-card" :class="{ 'opinion-card--compact': compact }">
    <header class="opinion-card__header">
      <TeamAvatar :name="post.author.name" :image-url="post.author.avatarUrl ?? undefined" size="attendee" />
      <div class="opinion-card__identity">
        <h3>{{ post.author.name }}</h3>
        <time v-if="post.createdAt" :datetime="post.createdAt" :title="absoluteTime">{{ relativeTime }}</time>
      </div>

      <div v-if="post.isMine && !compact" ref="menuRef" class="opinion-card__menu">
        <button
          type="button"
          class="opinion-card__icon-btn"
          :class="{ 'is-active': menuOpen }"
          aria-label="Post menu"
          :aria-expanded="menuOpen ? 'true' : 'false'"
          @click="menuOpen = !menuOpen"
        >
          <AppIcon name="ellipsis" :size="18" />
        </button>
        <Transition name="opinion-card-menu">
          <div v-if="menuOpen" class="opinion-card__menu-popover">
            <button type="button" @click="startEdit">
              <AppIcon name="text" :size="16" />
              <span>Edit post</span>
            </button>
            <button type="button" class="is-danger" @click="deletePost">
              <AppIcon name="close" :size="16" />
              <span>Delete post</span>
            </button>
          </div>
        </Transition>
      </div>
    </header>

    <div v-if="editing" class="opinion-card__editor">
      <textarea v-model="draft" rows="4" :disabled="mutationBusy"></textarea>
      <div class="opinion-card__editor-actions">
        <button type="button" class="opinion-card__ghost" :disabled="mutationBusy" @click="cancelEdit">
          Cancel
        </button>
        <button type="button" class="opinion-card__primary" :disabled="mutationBusy || !draft.trim()" @click="saveEdit">
          Save changes
        </button>
      </div>
    </div>
    <p v-else-if="post.content" class="opinion-card__content">{{ post.content }}</p>

    <div
      v-if="imageCount"
      class="opinion-card__images"
      :data-count="Math.min(imageCount, 4)"
    >
      <figure
        v-for="(image, index) in visibleImages"
        :key="`${post.id}-${image}-${index}`"
        class="opinion-card__image"
      >
        <img :src="image" :alt="`Post image ${index + 1}`" loading="lazy" />
        <span v-if="index === 3 && imageCount > 4" class="opinion-card__image-more">
          +{{ imageCount - 4 }}
        </span>
      </figure>
    </div>

    <div v-if="!compact && (post.likeCount || post.commentCount)" class="opinion-card__meta">
      <button
        v-if="post.likeCount"
        type="button"
        class="opinion-card__meta-likes"
        @click="emit('show-likers')"
      >
        <span class="opinion-card__meta-heart"><AppIcon name="like" :size="13" /></span>
        {{ post.likeCount }}
      </button>
      <span v-else></span>
      <button
        v-if="post.commentCount"
        type="button"
        class="opinion-card__meta-comments"
        @click="emit('toggle-comments')"
      >
        {{ post.commentCount }} {{ post.commentCount === 1 ? 'comment' : 'comments' }}
      </button>
    </div>

    <footer v-if="!compact" class="opinion-card__actions">
      <button
        type="button"
        class="opinion-card__action"
        :class="{ 'opinion-card__action--liked': post.likedByMe }"
        :aria-label="likeLabel"
        :aria-pressed="post.likedByMe ? 'true' : 'false'"
        :disabled="likeBusy"
        @click="emit('like')"
      >
        <span class="opinion-card__action-glyph"><AppIcon name="like" :size="18" /></span>
        <span>{{ post.likedByMe ? 'Liked' : 'Like' }}</span>
      </button>
      <button
        type="button"
        class="opinion-card__action"
        :class="{ 'opinion-card__action--active': commentsOpen }"
        @click="emit('toggle-comments')"
      >
        <AppIcon name="message" :size="18" />
        <span>Comment</span>
      </button>
    </footer>

    <slot />
  </article>
</template>

<style scoped>
.opinion-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--border-divider);
  border-radius: 16px;
  background: var(--surface-card);
  box-shadow: var(--shadow-soft);
  transition: box-shadow 180ms ease, border-color 180ms ease;
}

.opinion-card:hover {
  box-shadow: var(--shadow);
  border-color: var(--border-accent);
}

.opinion-card--compact {
  gap: 10px;
  padding: 12px;
  border-radius: 12px;
}

.opinion-card__header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 11px;
  align-items: center;
}

.opinion-card__identity {
  min-width: 0;
}

.opinion-card__identity h3 {
  overflow: hidden;
  margin: 0;
  color: var(--text);
  font-size: 0.96rem;
  font-weight: 500;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.opinion-card__identity time {
  display: block;
  margin-top: 1px;
  color: var(--text-light);
  font-size: 0.78rem;
  cursor: default;
}

.opinion-card__menu {
  position: relative;
}

.opinion-card__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-light);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.opinion-card__icon-btn:hover,
.opinion-card__icon-btn.is-active {
  background: var(--surface-pill);
  color: var(--primary);
}

.opinion-card__menu-popover {
  position: absolute;
  top: 40px;
  right: 0;
  z-index: 5;
  min-width: 168px;
  overflow: hidden;
  padding: 6px;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-opaque);
  box-shadow: var(--shadow);
}

.opinion-card__menu-popover button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.opinion-card__menu-popover button:hover {
  background: var(--surface-pill);
}

.opinion-card__menu-popover button.is-danger {
  color: var(--highlight);
}

.opinion-card__menu-popover button.is-danger:hover {
  background: var(--danger-light);
}

.opinion-card-menu-enter-active,
.opinion-card-menu-leave-active {
  transition: opacity 130ms ease, transform 130ms ease;
  transform-origin: top right;
}

.opinion-card-menu-enter-from,
.opinion-card-menu-leave-to {
  opacity: 0;
  transform: scale(0.96) translateY(-4px);
}

.opinion-card__content {
  margin: 0;
  color: var(--text);
  font-size: 0.95rem;
  font-weight: 400;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}

.opinion-card__editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.opinion-card__editor textarea {
  width: 100%;
  min-width: 0;
  resize: vertical;
  border: 1px solid var(--border-divider);
  border-radius: 12px;
  background: var(--surface-opaque);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 0.92rem;
  line-height: 1.5;
  padding: 11px 12px;
}

.opinion-card__editor textarea:focus {
  border-color: var(--border-accent-hover);
  outline: none;
}

.opinion-card__editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.opinion-card__ghost,
.opinion-card__primary {
  min-height: 36px;
  padding: 0 14px;
  border-radius: 999px;
  font-family: var(--font-body);
  font-size: 0.86rem;
  font-weight: 500;
  cursor: pointer;
}

.opinion-card__ghost {
  border: 1px solid var(--border-divider);
  background: transparent;
  color: var(--secondary);
}

.opinion-card__ghost:hover:not(:disabled) {
  background: var(--surface-pill);
}

.opinion-card__primary {
  border: 0;
  background: var(--primary);
  color: #fff;
}

.opinion-card__primary:hover:not(:disabled) {
  filter: brightness(1.04);
}

.opinion-card__primary:disabled {
  box-shadow: none;
}

.opinion-card__images {
  display: grid;
  gap: 4px;
  overflow: hidden;
  border-radius: 12px;
}

.opinion-card__images[data-count='1'] {
  grid-template-columns: 1fr;
}

.opinion-card__images[data-count='2'] {
  grid-template-columns: repeat(2, 1fr);
}

/* 3 images — one tall hero on the left, two stacked on the right. */
.opinion-card__images[data-count='3'] {
  grid-template-columns: repeat(2, 1fr);
  grid-template-rows: repeat(2, 1fr);
}

.opinion-card__images[data-count='3'] .opinion-card__image:first-child {
  grid-row: span 2;
}

.opinion-card__images[data-count='4'] {
  grid-template-columns: repeat(2, 1fr);
}

.opinion-card__image {
  position: relative;
  display: block;
  margin: 0;
  background: var(--surface-raised);
  overflow: hidden;
}

.opinion-card__image img {
  width: 100%;
  height: 100%;
  min-height: 170px;
  max-height: 360px;
  display: block;
  object-fit: cover;
  transition: transform 220ms ease;
}

.opinion-card__images[data-count='1'] .opinion-card__image img {
  max-height: 500px;
}

.opinion-card__images[data-count='3'] .opinion-card__image img,
.opinion-card__images[data-count='4'] .opinion-card__image img {
  min-height: 150px;
}

.opinion-card__image:hover img {
  transform: scale(1.02);
}

.opinion-card__image-more {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(15, 20, 25, 0.55);
  color: #fff;
  font-size: 1.2rem;
  font-weight: 500;
}

.opinion-card__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 18px;
}

.opinion-card__meta-likes,
.opinion-card__meta-comments {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: var(--text-light);
  font-family: var(--font-body);
  font-size: 0.82rem;
  font-weight: 400;
  cursor: pointer;
}

.opinion-card__meta-likes:hover,
.opinion-card__meta-comments:hover {
  color: var(--primary);
  text-decoration: underline;
}

.opinion-card__meta-heart {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
}

.opinion-card__meta-heart :deep(.app-icon__primary),
.opinion-card__meta-heart :deep(.app-icon__secondary) {
  stroke: #fff;
  fill: #fff;
}

.opinion-card__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--border-divider);
  padding-top: 8px;
}

.opinion-card__action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  gap: 8px;
  min-height: 38px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text-light);
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.opinion-card__action-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.opinion-card__action:hover {
  background: var(--surface-pill);
  color: var(--primary);
}

.opinion-card__action--active {
  color: var(--primary);
  background: var(--surface-pill);
}

.opinion-card__action--liked {
  color: var(--primary);
  background: var(--primary-light-3);
}

.opinion-card__action--liked .opinion-card__action-glyph {
  transform: scale(1.12);
}

.opinion-card__action--liked :deep(.app-icon__primary) {
  fill: var(--primary);
  stroke: var(--primary);
}

.opinion-card__action--liked :deep(.app-icon__secondary) {
  fill: var(--primary);
  stroke: var(--primary);
}

.opinion-card__action:disabled,
.opinion-card__ghost:disabled,
.opinion-card__primary:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

@media (max-width: 560px) {
  .opinion-card__image img {
    min-height: 130px;
  }
}
</style>
