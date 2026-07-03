<script setup lang="ts">
import { computed } from 'vue'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import PresenceDot from './PresenceDot.vue'
import UnreadBadge from './UnreadBadge.vue'
import { formatListTimestamp } from './chat-format'
import type { ChatConversation } from '../../api/chat'

const props = defineProps<{
  conversation: ChatConversation
  active?: boolean
  online?: boolean
  /** This conversation is behind a per-chat PIN lock. */
  locked?: boolean
}>()

defineEmits<{ (e: 'select'): void }>()

const preview = computed(() => {
  const last = props.conversation.lastMessage
  if (!last) return ''
  if (last.hasFile && !last.preview) return 'Attachment'
  return last.preview || ''
})

const previewHasFile = computed(
  () => !!props.conversation.lastMessage?.hasFile && !props.conversation.lastMessage?.preview
)

const timestamp = computed(() =>
  formatListTimestamp(props.conversation.lastMessageAt ?? props.conversation.lastMessage?.createdAt)
)

const showPresence = computed(() => props.conversation.type === 'dm')
</script>

<template>
  <button
    type="button"
    class="conv-row"
    :class="{ 'conv-row--active': active }"
    @click="$emit('select')"
  >
    <span class="conv-row__avatar">
      <TeamAvatar
        :name="conversation.title"
        :image-url="conversation.avatarUrl ?? undefined"
        size="md"
      />
      <PresenceDot v-if="showPresence" class="conv-row__presence" :online="online" />
    </span>

    <span class="conv-row__body">
      <span class="conv-row__top">
        <span class="conv-row__name" :title="conversation.title">{{ conversation.title }}</span>
        <span v-if="timestamp" class="conv-row__time">{{ timestamp }}</span>
      </span>
      <span class="conv-row__bottom">
        <span class="conv-row__preview">
          <template v-if="locked">
            <svg class="conv-row__preview-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span class="conv-row__preview-text">Locked chat</span>
          </template>
          <template v-else>
            <AppIcon v-if="previewHasFile" class="conv-row__preview-icon" name="document" :size="14" />
            <span class="conv-row__preview-text">{{ preview }}</span>
          </template>
        </span>
        <UnreadBadge v-if="!locked" :count="conversation.unreadCount" />
      </span>
    </span>
  </button>
</template>

<style scoped>
.conv-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  border-radius: var(--radius-md, 5px);
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-body);
  transition: background-color 120ms ease;
}

.conv-row:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.conv-row--active {
  background: var(--primary-light-3, #e5f1ff);
}

.conv-row--active .conv-row__name {
  color: var(--secondary, #2f5f98);
}

.conv-row__avatar {
  position: relative;
  flex: 0 0 auto;
}

.conv-row__presence {
  position: absolute;
  right: -1px;
  bottom: -1px;
}

.conv-row__body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.conv-row__top,
.conv-row__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
}

.conv-row__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.92rem;
  font-weight: 500;
}

.conv-row__time {
  flex: 0 0 auto;
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
}

.conv-row__preview {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-light, #787f8d);
}

.conv-row__preview-icon {
  flex: 0 0 auto;
  color: var(--text-light, #787f8d);
}

.conv-row__preview-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.82rem;
  font-weight: 400;
}
</style>
