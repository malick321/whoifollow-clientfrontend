<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '../AppIcon.vue'
import TeamAvatar from '../TeamAvatar.vue'
import MessageBubble from './MessageBubble.vue'
import MessageInfoModal from './MessageInfoModal.vue'
import TypingIndicator from './TypingIndicator.vue'
import PresenceDot from './PresenceDot.vue'
import MessageComposer from './MessageComposer.vue'
import { useChatStore } from '../../stores/chat'
import { getAuthUserChatId } from '../../auth-session'
import { dayKey, formatDayLabel } from './chat-format'
import type { ChatMessage } from '../../api/chat'

const props = defineProps<{
  conversationId: string
}>()

defineEmits<{ (e: 'back'): void; (e: 'toggle-info'): void }>()

const store = useChatStore()
const { messagesByConversation, hasMoreByConversation, loadingOlderByConversation } =
  storeToRefs(store)

const scroller = ref<HTMLElement | null>(null)

const conversation = computed(() => store.conversationById(props.conversationId))
const isTeam = computed(() => conversation.value?.type === 'team')

const messages = computed<ChatMessage[]>(
  () => messagesByConversation.value[props.conversationId] ?? []
)
const hasMore = computed(() => !!hasMoreByConversation.value[props.conversationId])
const loadingOlder = computed(() => !!loadingOlderByConversation.value[props.conversationId])

// Admin in a team chat → can moderate (delete) others' messages.
const canModerate = computed(() => {
  if (!isTeam.value) return false
  const me = getAuthUserChatId()
  const self = conversation.value?.participants.find((p) => p.userChatId === me)
  return self?.role === 'admin'
})

// Group messages into day buckets for date separators, and annotate each
// message with its position in a same-sender "run" (consecutive messages from
// one sender) so the bubble can tighten gaps + show name/avatar only on the
// run's edges. A run is broken by sender change OR day change.
interface RunItem {
  message: ChatMessage
  isFirstInRun: boolean
  isLastInRun: boolean
}
interface DayGroup {
  key: string
  label: string
  items: RunItem[]
}
const dayGroups = computed<DayGroup[]>(() => {
  const groups: DayGroup[] = []
  let current: DayGroup | null = null
  const all = messages.value
  for (let i = 0; i < all.length; i += 1) {
    const m = all[i]
    const key = dayKey(m.createdAt)
    if (!current || current.key !== key) {
      current = { key, label: formatDayLabel(m.createdAt), items: [] }
      groups.push(current)
    }
    const prev = all[i - 1]
    const next = all[i + 1]
    const samePrev = !!prev && prev.senderChatId === m.senderChatId && dayKey(prev.createdAt) === key
    const sameNext = !!next && next.senderChatId === m.senderChatId && dayKey(next.createdAt) === key
    current.items.push({
      message: m,
      isFirstInRun: !samePrev,
      isLastInRun: !sameNext
    })
  }
  return groups
})

// ── Header status line ───────────────────────────────────────────────────
const typing = computed(() => store.typingIn(props.conversationId))
const otherOnline = computed(() => {
  const uid = conversation.value?.otherUser?.userChatId
  return uid ? store.isOnline(uid) : false
})
const typingLabel = computed(() => {
  const list = typing.value
  if (!list.length) return ''
  if (isTeam.value) {
    if (list.length === 1) return `${list[0].userName} is typing`
    return `${list.length} people are typing`
  }
  return 'typing'
})
const statusLine = computed(() => {
  if (typingLabel.value) return ''
  if (isTeam.value) {
    const n = conversation.value?.participants.length ?? 0
    return n ? `${n} members` : ''
  }
  return otherOnline.value ? 'Online' : 'Offline'
})

// ── Reply state ────────────────────────────────────────────────────────────
const replyTo = ref<ChatMessage | null>(null)
function onReply(m: ChatMessage) {
  replyTo.value = m
}
function onPin(m: ChatMessage) {
  void store.togglePin(m.id, !m.isPinned)
}
function onDeleteForEveryone(m: ChatMessage) {
  store.deleteMessage(props.conversationId, m.id)
}
function onDeleteForMe(m: ChatMessage) {
  store.deleteForMe(props.conversationId, m.id)
}

// ── Message Info modal ───────────────────────────────────────────────────
const infoOpen = ref(false)
const infoMessage = ref<ChatMessage | null>(null)
function onMessageInfo(m: ChatMessage) {
  infoMessage.value = m
  infoOpen.value = true
}

// ── Scroll handling ──────────────────────────────────────────────────────
function isNearBottom(): boolean {
  const el = scroller.value
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

function scrollToBottom() {
  void nextTick(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

let infiniteGuard = false
async function onScroll() {
  const el = scroller.value
  if (!el) return
  if (el.scrollTop < 80 && hasMore.value && !loadingOlder.value && !infiniteGuard) {
    infiniteGuard = true
    const prevHeight = el.scrollHeight
    await store.loadOlder(props.conversationId)
    // Preserve viewport position after prepending older messages.
    void nextTick(() => {
      const cur = scroller.value
      if (cur) cur.scrollTop = cur.scrollHeight - prevHeight
      infiniteGuard = false
    })
  }
}

// Auto-scroll on new messages when the viewer is already near the bottom (or
// it's the viewer's own message). Also (re)mark read when new items arrive.
let lastCount = 0
let lastId = ''
watch(
  messages,
  (list) => {
    const newest = list[list.length - 1]
    const grew = list.length > lastCount
    const own = newest?.senderChatId === getAuthUserChatId()
    if (grew && (own || isNearBottom())) {
      scrollToBottom()
    }
    if (newest && newest.id !== lastId) {
      store.markConversationRead(props.conversationId)
    }
    lastCount = list.length
    lastId = newest?.id ?? ''
  },
  { deep: false }
)

// On (re)open: jump to bottom + mark read.
watch(
  () => props.conversationId,
  () => {
    replyTo.value = null
    lastCount = messages.value.length
    lastId = messages.value[messages.value.length - 1]?.id ?? ''
    scrollToBottom()
    store.markConversationRead(props.conversationId)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  store.closeConversation(props.conversationId)
})
</script>

<template>
  <section class="thread">
    <header class="thread__header">
      <button type="button" class="thread__back" aria-label="Back" @click="$emit('back')">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M15 5l-7 7 7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <span class="thread__avatar">
        <TeamAvatar
          :name="conversation?.title ?? ''"
          :image-url="conversation?.avatarUrl ?? undefined"
          size="md"
        />
        <PresenceDot v-if="!isTeam" class="thread__presence" :online="otherOnline" />
      </span>

      <div class="thread__heading">
        <span class="thread__title">{{ conversation?.title }}</span>
        <span class="thread__status">
          <TypingIndicator v-if="typingLabel" :label="typingLabel" />
          <span v-else-if="statusLine" class="thread__status-text">{{ statusLine }}</span>
        </span>
      </div>

      <button
        type="button"
        class="thread__info-btn"
        aria-label="Conversation info"
        @click="$emit('toggle-info')"
      >
        <AppIcon name="ellipsis" :size="20" />
      </button>
    </header>

    <div ref="scroller" class="thread__scroll" @scroll="onScroll">
      <div v-if="loadingOlder" class="thread__loading">Loading earlier messages…</div>
      <div v-else-if="!hasMore && messages.length" class="thread__started">
        Conversation started on {{ formatDayLabel(messages[0].createdAt) }}
      </div>

      <template v-for="group in dayGroups" :key="group.key">
        <div class="thread__day-sep">
          <span class="thread__day-label">{{ group.label }}</span>
        </div>
        <MessageBubble
          v-for="item in group.items"
          :key="item.message.clientId ?? item.message.id"
          :message="item.message"
          :is-team="isTeam"
          :can-moderate="canModerate"
          :is-first-in-run="item.isFirstInRun"
          :is-last-in-run="item.isLastInRun"
          @reply="onReply"
          @pin="onPin"
          @message-info="onMessageInfo"
          @delete-for-me="onDeleteForMe"
          @delete-for-everyone="onDeleteForEveryone"
        />
      </template>

      <div v-if="!messages.length" class="thread__empty">
        <span class="thread__empty-icon"><AppIcon name="message" :size="32" /></span>
        <p class="thread__empty-text">No messages yet</p>
        <p class="thread__empty-sub">Say hello to start the conversation.</p>
      </div>
    </div>

    <MessageInfoModal v-model="infoOpen" :message="infoMessage" />

    <MessageComposer
      :conversation-id="conversationId"
      :recipient-name="conversation?.title"
      :reply-to="replyTo"
      @cancel-reply="replyTo = null"
      @sent="replyTo = null"
    />
  </section>
</template>

<style scoped>
.thread {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-card, #fff);
}

.thread__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.thread__back {
  display: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--secondary, #2f5f98);
  cursor: pointer;
}

.thread__avatar {
  position: relative;
  flex: 0 0 auto;
}

.thread__presence {
  position: absolute;
  right: -1px;
  bottom: -1px;
}

.thread__heading {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.thread__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.98rem;
  font-weight: 500;
}

.thread__status {
  min-height: 16px;
}

.thread__status-text {
  color: var(--text-light, #787f8d);
  font-size: 0.78rem;
  font-weight: 400;
}

.thread__info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--secondary, #2f5f98);
  cursor: pointer;
}

.thread__info-btn:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.thread__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
}

.thread__loading,
.thread__started {
  margin: 4px auto 12px;
  color: var(--text-light, #787f8d);
  font-size: 0.76rem;
  font-weight: 400;
  text-align: center;
}

.thread__day-sep {
  display: flex;
  justify-content: center;
  margin: 12px 0;
}

.thread__day-label {
  padding: 3px 12px;
  border-radius: 999px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 500;
}

.thread__empty {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  text-align: center;
}

.thread__empty-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--secondary, #2f5f98);
}

.thread__empty-text {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 0.95rem;
  font-weight: 500;
}

.thread__empty-sub {
  margin: 0;
  color: var(--text-light, #787f8d);
  font-size: 0.85rem;
  font-weight: 400;
}

@media (max-width: 840px) {
  .thread__back {
    display: inline-flex;
  }
}
</style>
