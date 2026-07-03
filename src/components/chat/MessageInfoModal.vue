<script setup lang="ts">
// MessageInfoModal
// ----------------
// WhatsApp-style "Message Info" sheet for one of the viewer's OWN messages.
// Fetches the per-recipient delivery/read breakdown from
// GET /v2/chat/messages/{id}/info and splits recipients into three buckets:
//   • Read by    — readAt present
//   • Delivered  — deliveredAt present but not yet read
//   • Pending    — neither (sent, not yet delivered)
// Centered modal matching the colleague's .modal-backdrop / .modal-card
// vocabulary. Time formatting reuses chat-format.

import { computed, ref, watch } from 'vue'
import AppIcon from '../AppIcon.vue'
import TeamAvatar from '../TeamAvatar.vue'
import { fetchMessageInfo, type ChatMessage, type ChatMessageInfoRecipient } from '../../api/chat'
import { formatDayLabel, formatTime, isImageFile } from './chat-format'

const props = defineProps<{
  modelValue: boolean
  message: ChatMessage | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const loading = ref(false)
const error = ref(false)
const sentAt = ref<string | null>(null)
const recipients = ref<ChatMessageInfoRecipient[]>([])

function close() {
  emit('update:modelValue', false)
}

function onBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}

const preview = computed(() => {
  const m = props.message
  if (!m) return ''
  if (m.content) return m.content
  if (m.files.length) {
    const f = m.files[0]
    return isImageFile(f.type, f.name) ? 'Photo' : f.name || 'Attachment'
  }
  return m.hasFile ? 'Attachment' : ''
})

const readBy = computed(() => recipients.value.filter((r) => r.readAt))
const deliveredTo = computed(() => recipients.value.filter((r) => !r.readAt && r.deliveredAt))
const pending = computed(() => recipients.value.filter((r) => !r.readAt && !r.deliveredAt))

const sentLabel = computed(() => {
  const iso = sentAt.value ?? props.message?.createdAt ?? null
  if (!iso) return ''
  const day = formatDayLabel(iso)
  const time = formatTime(iso)
  return day && time ? `${day} at ${time}` : day || time
})

function receiptLabel(iso: string | null): string {
  if (!iso) return ''
  const day = formatDayLabel(iso)
  const time = formatTime(iso)
  return day === 'Today' ? time : `${day}, ${time}`
}

async function load() {
  const m = props.message
  if (!m) return
  loading.value = true
  error.value = false
  recipients.value = []
  sentAt.value = m.createdAt
  try {
    const info = await fetchMessageInfo(m.id)
    if (info) {
      sentAt.value = info.sentAt ?? m.createdAt
      recipients.value = info.recipients
    } else {
      error.value = true
    }
  } catch {
    error.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load()
  }
)
</script>

<template>
  <Transition name="msg-info-fade">
    <div
      v-if="modelValue"
      class="msg-info-backdrop"
      role="presentation"
      @click="onBackdropClick"
    >
      <div class="msg-info-card" role="dialog" aria-modal="true" aria-label="Message info">
        <header class="msg-info__header">
          <h2 class="msg-info__title">Message info</h2>
          <button type="button" class="msg-info__close" aria-label="Close" @click="close">
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <div class="msg-info__body">
          <!-- Message preview -->
          <div class="msg-info__preview">
            <p v-if="preview" class="msg-info__preview-text">{{ preview }}</p>
            <p v-else class="msg-info__preview-text msg-info__preview-text--muted">No text</p>
            <span v-if="sentLabel" class="msg-info__sent">{{ sentLabel }}</span>
          </div>

          <p v-if="loading" class="msg-info__state">Loading…</p>
          <p v-else-if="error" class="msg-info__state">Couldn’t load message info.</p>

          <template v-else>
            <section v-if="readBy.length" class="msg-info__section">
              <h3 class="msg-info__section-title msg-info__section-title--read">
                <span class="msg-info__tick msg-info__tick--read">✓✓</span>
                Read by
              </h3>
              <ul class="msg-info__list">
                <li v-for="r in readBy" :key="`r-${r.userChatId}`" class="msg-info__row">
                  <TeamAvatar :name="r.name" :image-url="r.avatarUrl ?? undefined" size="sm" />
                  <span class="msg-info__name">{{ r.name }}</span>
                  <span class="msg-info__time">{{ receiptLabel(r.readAt) }}</span>
                </li>
              </ul>
            </section>

            <section v-if="deliveredTo.length" class="msg-info__section">
              <h3 class="msg-info__section-title">
                <span class="msg-info__tick">✓✓</span>
                Delivered to
              </h3>
              <ul class="msg-info__list">
                <li v-for="r in deliveredTo" :key="`d-${r.userChatId}`" class="msg-info__row">
                  <TeamAvatar :name="r.name" :image-url="r.avatarUrl ?? undefined" size="sm" />
                  <span class="msg-info__name">{{ r.name }}</span>
                  <span class="msg-info__time">{{ receiptLabel(r.deliveredAt) }}</span>
                </li>
              </ul>
            </section>

            <section v-if="pending.length" class="msg-info__section">
              <h3 class="msg-info__section-title">
                <span class="msg-info__tick">✓</span>
                Pending
              </h3>
              <ul class="msg-info__list">
                <li v-for="r in pending" :key="`p-${r.userChatId}`" class="msg-info__row">
                  <TeamAvatar :name="r.name" :image-url="r.avatarUrl ?? undefined" size="sm" />
                  <span class="msg-info__name">{{ r.name }}</span>
                  <span class="msg-info__time msg-info__time--muted">Not delivered</span>
                </li>
              </ul>
            </section>

            <p v-if="!recipients.length" class="msg-info__state">No recipients.</p>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.msg-info-backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(36, 60, 91, 0.24);
  backdrop-filter: blur(4px);
}

.msg-info-card {
  display: flex;
  flex-direction: column;
  width: min(420px, 100%);
  max-height: min(640px, calc(100vh - 60px));
  border-radius: var(--radius-lg, 5px);
  background: var(--surface-opaque, rgba(255, 255, 255, 0.98));
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  box-shadow: 0 20px 40px rgba(21, 37, 56, 0.16);
  overflow: hidden;
  font-family: var(--font-body);
}

.msg-info__header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.msg-info__title {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 1rem;
  font-weight: 500;
}

.msg-info__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--secondary, #2f5f98);
  cursor: pointer;
}

.msg-info__close:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.msg-info__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px 18px;
}

.msg-info__preview {
  padding: 12px 14px;
  border-radius: 10px;
  border-top-right-radius: 4px;
  background: var(--primary-light-3, #e5f1ff);
  border: 1px solid var(--border-accent, rgba(134, 190, 250, 0.65));
}

.msg-info__preview-text {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 0.9rem;
  font-weight: 400;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.msg-info__preview-text--muted {
  color: var(--text-light, #787f8d);
  font-style: italic;
}

.msg-info__sent {
  display: block;
  margin-top: 6px;
  color: var(--text-light, #787f8d);
  font-size: 0.72rem;
  font-weight: 400;
}

.msg-info__state {
  margin: 18px 0 4px;
  color: var(--text-light, #787f8d);
  font-size: 0.85rem;
  font-weight: 400;
  text-align: center;
}

.msg-info__section {
  margin-top: 18px;
}

.msg-info__section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  color: var(--text-light, #787f8d);
  font-size: 0.74rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.msg-info__tick {
  font-size: 0.82rem;
  line-height: 1;
  color: var(--text-light, #787f8d);
}

.msg-info__section-title--read .msg-info__tick--read {
  color: var(--primary, #2d8cf0);
}

.msg-info__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.msg-info__row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 8px;
}

.msg-info__row:hover {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.msg-info__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text, #2e3137);
  font-size: 0.88rem;
  font-weight: 400;
}

.msg-info__time {
  flex: 0 0 auto;
  color: var(--text-light, #787f8d);
  font-size: 0.74rem;
  font-weight: 400;
}

.msg-info__time--muted {
  font-style: italic;
}

.msg-info-fade-enter-active,
.msg-info-fade-leave-active {
  transition: opacity 180ms ease;
}

.msg-info-fade-enter-from,
.msg-info-fade-leave-to {
  opacity: 0;
}
</style>
