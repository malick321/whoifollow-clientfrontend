<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import TeamAvatar from '../TeamAvatar.vue'
import { getAuthUserChatId } from '../../auth-session'
import { formatTime, formatFileSize, isImageFile } from './chat-format'
import type { ChatMessage } from '../../api/chat'

const props = defineProps<{
  message: ChatMessage
  isTeam?: boolean
  canModerate?: boolean
  /** First message of a same-sender run → show name/avatar, round top. */
  isFirstInRun?: boolean
  /** Last message of a same-sender run → round the tail corner. */
  isLastInRun?: boolean
}>()

const emit = defineEmits<{
  (e: 'reply', message: ChatMessage): void
  (e: 'pin', message: ChatMessage): void
  (e: 'message-info', message: ChatMessage): void
  (e: 'delete-for-me', message: ChatMessage): void
  (e: 'delete-for-everyone', message: ChatMessage): void
}>()

const isOwn = computed(() => props.message.senderChatId === getAuthUserChatId())
const showSenderName = computed(
  () => props.isTeam && !isOwn.value && !props.message.isDeleted && props.isFirstInRun !== false
)
const showAvatar = computed(
  () => props.isTeam && !isOwn.value && props.isLastInRun !== false
)
const time = computed(() => formatTime(props.message.createdAt))

// Status ticks only on own, non-deleted messages.
const statusIcon = computed<'sent' | 'delivered' | 'read' | null>(() => {
  if (!isOwn.value || props.message.isDeleted) return null
  return props.message.status
})

const canDeleteForEveryone = computed(
  () => !props.message.isDeleted && (isOwn.value || !!props.canModerate)
)
// "Message Info" matters for the viewer's own messages (where ticks live).
const showMessageInfo = computed(() => isOwn.value && !props.message.isDeleted)

// ── Action menu + delete confirm ───────────────────────────────────────────
const menuOpen = ref(false)
const confirmOpen = ref(false)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
  if (menuOpen.value) confirmOpen.value = false
}

function closeMenu() {
  menuOpen.value = false
}

function onReply() {
  closeMenu()
  emit('reply', props.message)
}

function onPin() {
  closeMenu()
  emit('pin', props.message)
}

function onMessageInfo() {
  closeMenu()
  emit('message-info', props.message)
}

function openConfirm() {
  menuOpen.value = false
  confirmOpen.value = true
}

function closeConfirm() {
  confirmOpen.value = false
}

function onDeleteForMe() {
  confirmOpen.value = false
  emit('delete-for-me', props.message)
}

function onDeleteForEveryone() {
  confirmOpen.value = false
  emit('delete-for-everyone', props.message)
}

// Dismiss menu / confirm on outside interaction.
function onDocPointer() {
  if (menuOpen.value) menuOpen.value = false
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', onDocPointer)
}
onBeforeUnmount(() => {
  if (typeof document !== 'undefined') document.removeEventListener('click', onDocPointer)
})
</script>

<template>
  <div
    class="bubble-row"
    :class="{
      'bubble-row--own': isOwn,
      'bubble-row--run': isLastInRun === false,
      'bubble-row--has-avatar': showAvatar
    }"
  >
    <span v-if="isTeam && !isOwn" class="bubble-row__avatar">
      <TeamAvatar
        v-if="showAvatar"
        :name="message.senderName"
        :image-url="message.senderAvatarUrl ?? undefined"
        size="sm"
      />
    </span>

    <div
      class="bubble"
      :class="{
        'bubble--own': isOwn,
        'bubble--deleted': message.isDeleted,
        'bubble--first': isFirstInRun !== false,
        'bubble--last': isLastInRun !== false
      }"
    >
      <!-- Action trigger (ellipsis) -->
      <div v-if="!message.isDeleted" class="bubble__menu-wrap" @click.stop>
        <button
          type="button"
          class="bubble__menu-trigger"
          aria-label="Message actions"
          @click="toggleMenu"
        >
          <AppIcon name="ellipsis" :size="16" />
        </button>

        <div v-if="menuOpen" class="bubble__menu" role="menu">
          <button type="button" class="bubble__menu-item" role="menuitem" @click="onReply">
            <AppIcon name="message" :size="16" />
            <span>Reply</span>
          </button>
          <button type="button" class="bubble__menu-item" role="menuitem" @click="onPin">
            <AppIcon name="like" :size="16" />
            <span>{{ message.isPinned ? 'Unpin' : 'Pin' }}</span>
          </button>
          <button
            v-if="showMessageInfo"
            type="button"
            class="bubble__menu-item"
            role="menuitem"
            @click="onMessageInfo"
          >
            <AppIcon name="help" :size="16" />
            <span>Message Info</span>
          </button>
          <button
            type="button"
            class="bubble__menu-item bubble__menu-item--danger"
            role="menuitem"
            @click="openConfirm"
          >
            <AppIcon name="close" :size="16" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      <span v-if="showSenderName" class="bubble__sender">{{ message.senderName }}</span>

      <span v-if="message.isPinned && !message.isDeleted" class="bubble__pin">
        <AppIcon name="like" :size="13" />
        Pinned
      </span>

      <!-- Reply preview -->
      <div v-if="message.parentMessage && !message.isDeleted" class="bubble__reply">
        <span class="bubble__reply-name">{{ message.parentMessage.senderName }}</span>
        <span class="bubble__reply-preview">{{ message.parentMessage.preview }}</span>
      </div>

      <!-- Deleted tombstone -->
      <p v-if="message.isDeleted" class="bubble__deleted">
        <AppIcon name="close" :size="13" />
        This message was deleted
      </p>

      <template v-else>
        <!-- Attachments -->
        <div v-if="message.files.length" class="bubble__files">
          <template v-for="(file, idx) in message.files" :key="idx">
            <a
              v-if="isImageFile(file.type, file.name) && (file.thumbnailUrl || file.url)"
              class="bubble__image"
              :href="file.url || undefined"
              target="_blank"
              rel="noopener"
            >
              <img :src="file.thumbnailUrl || file.url" :alt="file.name" />
            </a>
            <a
              v-else
              class="bubble__file-chip"
              :href="file.url || undefined"
              target="_blank"
              rel="noopener"
            >
              <span class="bubble__file-icon"><AppIcon name="document" :size="20" /></span>
              <span class="bubble__file-meta">
                <span class="bubble__file-name">{{ file.name }}</span>
                <span v-if="file.size" class="bubble__file-size">{{ formatFileSize(file.size) }}</span>
              </span>
            </a>
          </template>
        </div>

        <p v-if="message.content" class="bubble__content">{{ message.content }}</p>
      </template>

      <span class="bubble__footer">
        <span class="bubble__time">{{ time }}</span>
        <span
          v-if="statusIcon"
          class="bubble__status"
          :class="{ 'bubble__status--read': statusIcon === 'read' }"
        >
          {{ statusIcon === 'sent' ? '✓' : '✓✓' }}
        </span>
      </span>

      <!-- Delete confirm (two-choice) -->
      <div v-if="confirmOpen" class="bubble__confirm" @click.stop>
        <p class="bubble__confirm-title">Delete message?</p>
        <button
          v-if="canDeleteForEveryone"
          type="button"
          class="bubble__confirm-btn bubble__confirm-btn--danger"
          @click="onDeleteForEveryone"
        >
          Delete for everyone
        </button>
        <button type="button" class="bubble__confirm-btn" @click="onDeleteForMe">
          Delete for me
        </button>
        <button type="button" class="bubble__confirm-btn bubble__confirm-btn--ghost" @click="closeConfirm">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bubble-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  justify-content: flex-start;
  padding: 6px 0 0;
}

/* Tighter gap between consecutive messages from the same sender. */
.bubble-row--run {
  padding-top: 2px;
}

.bubble-row--own {
  justify-content: flex-end;
}

.bubble-row__avatar {
  flex: 0 0 auto;
  width: 28px;
}

.bubble {
  position: relative;
  max-width: min(74%, 540px);
  padding: 7px 11px 5px;
  border-radius: 14px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: 0 1px 1px rgba(36, 60, 91, 0.04);
  font-family: var(--font-body);
}

/* Tail corner: square the top-left on a run's continuation, square the
   bottom-left only on the last bubble of an incoming run (WhatsApp tail). */
.bubble--first {
  border-top-left-radius: 14px;
}
.bubble-row:not(.bubble-row--own) .bubble:not(.bubble--first) {
  border-top-left-radius: 4px;
}
.bubble-row:not(.bubble-row--own) .bubble.bubble--last {
  border-bottom-left-radius: 4px;
}

.bubble--own {
  background: var(--primary-light-3, #e5f1ff);
  border-color: var(--border-accent, rgba(134, 190, 250, 0.65));
}
.bubble-row--own .bubble:not(.bubble--first) {
  border-top-right-radius: 4px;
}
.bubble-row--own .bubble.bubble--last {
  border-bottom-right-radius: 4px;
}

.bubble--deleted {
  background: transparent;
  border-style: dashed;
  box-shadow: none;
}

.bubble__sender {
  display: block;
  margin-bottom: 2px;
  color: var(--secondary, #2f5f98);
  font-size: 0.76rem;
  font-weight: 500;
}

.bubble__pin {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-bottom: 2px;
  color: var(--text-light, #787f8d);
  font-size: 0.68rem;
  font-weight: 400;
}

.bubble__reply {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 5px;
  padding: 5px 8px;
  border-left: 3px solid var(--primary, #2d8cf0);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.04);
}

html.dark-mode .bubble__reply {
  background: rgba(255, 255, 255, 0.05);
}

.bubble__reply-name {
  color: var(--secondary, #2f5f98);
  font-size: 0.72rem;
  font-weight: 500;
}

.bubble__reply-preview {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-light, #787f8d);
  font-size: 0.76rem;
  font-weight: 400;
}

.bubble__deleted {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--text-light, #787f8d);
  font-size: 0.84rem;
  font-style: italic;
  font-weight: 400;
}

.bubble__files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}

.bubble__image {
  display: block;
  max-width: 260px;
  border-radius: 8px;
  overflow: hidden;
}

.bubble__image img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 320px;
  object-fit: cover;
}

.bubble__file-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.04);
  text-decoration: none;
  color: inherit;
}

html.dark-mode .bubble__file-chip {
  background: rgba(255, 255, 255, 0.05);
}

.bubble__file-icon {
  display: inline-flex;
  color: var(--secondary, #2f5f98);
}

.bubble__file-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.bubble__file-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.82rem;
  font-weight: 500;
}

.bubble__file-size {
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
}

.bubble__content {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 0.9rem;
  font-weight: 400;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.bubble__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 2px;
}

.bubble__time {
  color: var(--text-light, #787f8d);
  font-size: 0.68rem;
  font-weight: 400;
}

.bubble__status {
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
  line-height: 1;
}

.bubble__status--read {
  color: var(--primary, #2d8cf0);
}

/* ── Action menu ─────────────────────────────────────────────────────────── */
.bubble__menu-wrap {
  position: absolute;
  top: 2px;
  z-index: 3;
}

.bubble-row--own .bubble__menu-wrap {
  right: 4px;
}
.bubble-row:not(.bubble-row--own) .bubble__menu-wrap {
  right: 4px;
}

.bubble__menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  color: var(--secondary, #2f5f98);
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
  opacity: 0;
  cursor: pointer;
  transition: opacity 120ms ease;
}

.bubble:hover .bubble__menu-trigger {
  opacity: 1;
}

.bubble__menu {
  position: absolute;
  top: 26px;
  right: 0;
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 6px;
  border-radius: 10px;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.08));
}

.bubble__menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
}

.bubble__menu-item:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.bubble__menu-item--danger {
  color: #ff5b66;
}

.bubble__menu-item--danger :deep(.app-icon__primary) {
  stroke: #ff5b66;
}

/* ── Delete confirm ──────────────────────────────────────────────────────── */
.bubble__confirm {
  position: absolute;
  top: 26px;
  right: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 184px;
  padding: 10px;
  border-radius: 10px;
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: var(--shadow, 0 10px 24px rgba(36, 60, 91, 0.08));
}

.bubble__confirm-title {
  margin: 0 0 4px;
  color: var(--text, #2e3137);
  font-size: 0.82rem;
  font-weight: 500;
}

.bubble__confirm-btn {
  padding: 8px 10px;
  border: none;
  border-radius: 7px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.84rem;
  font-weight: 400;
  text-align: left;
  cursor: pointer;
}

.bubble__confirm-btn:hover {
  background: var(--secondary-light-4, #dbe3ee);
}

.bubble__confirm-btn--danger {
  color: #ff5b66;
}

.bubble__confirm-btn--ghost {
  background: transparent;
  color: var(--text-light, #787f8d);
}
</style>
