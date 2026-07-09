<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import SlideModal from '../SlideModal.vue'
import TeamAvatar from '../TeamAvatar.vue'
import AppIcon from '../AppIcon.vue'
import { fetchFriends, type ChatFriend } from '../../api/friends'
import { useChatStore } from '../../stores/chat'
import { pushToast } from '../../toast-center'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const store = useChatStore()

const search = ref('')
const friends = ref<ChatFriend[]>([])
const loading = ref(false)
const openingId = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

const sortedFriends = computed(() =>
  friends.value.slice().sort((a, b) => a.name.localeCompare(b.name))
)

async function loadFriends() {
  loading.value = true
  try {
    friends.value = await fetchFriends(search.value)
  } finally {
    loading.value = false
  }
}

watch(search, () => {
  if (!props.modelValue) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadFriends(), 250)
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    search.value = ''
    friends.value = []
    openingId.value = ''
    void loadFriends()
  }
)

async function start(friend: ChatFriend) {
  if (!friend.userChatId || openingId.value) return
  openingId.value = friend.userChatId
  try {
    const conversationId = await store.openIndividualConversation(friend.userChatId)
    if (!conversationId) throw new Error('Could not open chat.')
    emit('update:modelValue', false)
  } catch (error) {
    pushToast({
      tone: 'warning',
      title: 'Could not start chat',
      message: error instanceof Error ? error.message : 'Please try again.'
    })
  } finally {
    openingId.value = ''
  }
}

function close() {
  if (openingId.value) return
  emit('update:modelValue', false)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="New Chat"
    subtitle="Choose a friend to start or continue a one-to-one conversation."
    @update:model-value="(value) => emit('update:modelValue', value)"
  >
    <section class="start-chat">
      <div class="floating-input start-chat__search">
        <input
          id="start-chat-search"
          v-model="search"
          type="search"
          class="floating-input__control"
          autocomplete="off"
          placeholder=" "
        />
        <label for="start-chat-search" class="floating-input__label">Search friends</label>
        <span class="start-chat__search-icon" aria-hidden="true">
          <AppIcon name="search" :size="18" />
        </span>
      </div>

      <ul class="start-chat__list">
        <li v-if="loading" class="start-chat__hint">Loading friends...</li>
        <li v-else-if="!sortedFriends.length" class="start-chat__hint">No friends found.</li>
        <template v-else>
          <li v-for="friend in sortedFriends" :key="friend.userChatId">
            <button
              type="button"
              class="start-chat__row"
              :disabled="!!openingId"
              @click="start(friend)"
            >
              <TeamAvatar :name="friend.name" :image-url="friend.avatarUrl ?? undefined" size="sm" />
              <span class="start-chat__name">{{ friend.name }}</span>
              <span v-if="openingId === friend.userChatId" class="btn-spinner" aria-hidden="true"></span>
              <AppIcon v-else name="message" :size="18" />
            </button>
          </li>
        </template>
      </ul>
    </section>

    <template #footer>
      <button type="button" class="secondary-button" :disabled="!!openingId" @click="close">
        Close
      </button>
    </template>
  </SlideModal>
</template>

<style scoped>
.start-chat {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.start-chat__search {
  position: relative;
}

.start-chat__search .floating-input__control {
  padding-right: 42px;
}

.start-chat__search-icon {
  position: absolute;
  right: 14px;
  top: 50%;
  display: inline-flex;
  color: var(--text-light, #787f8d);
  transform: translateY(-50%);
  pointer-events: none;
}

.start-chat__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 240px;
  max-height: min(460px, 58vh);
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.start-chat__row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 8px;
  border: none;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  text-align: left;
  cursor: pointer;
}

.start-chat__row:hover:not(:disabled) {
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
}

.start-chat__row:disabled {
  cursor: wait;
  opacity: 0.72;
}

.start-chat__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  font-weight: 400;
}

.start-chat__hint {
  padding: 18px 8px;
  color: var(--text-light, #787f8d);
  font-size: 0.86rem;
  font-weight: 400;
  text-align: center;
}
</style>
