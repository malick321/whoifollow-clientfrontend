<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import AppIcon from '../AppIcon.vue'
import ConversationListItem from './ConversationListItem.vue'
import ChatLockSetupModal from './ChatLockSetupModal.vue'
import { useChatStore } from '../../stores/chat'
import { useChatLockStore } from '../../stores/chatLock'

const store = useChatStore()
const lock = useChatLockStore()
const { conversations, activeConversationId, loadingConversations } = storeToRefs(store)

const search = ref('')
const activeFilter = ref<'all' | 'unread' | 'groups' | 'archived'>('all')
const lockSetupOpen = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(search, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void store.loadConversations({ search: value.trim() || undefined })
  }, 300)
})

const filterItems = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
  { key: 'archived', label: 'Archived' }
] as const

const sortedConversations = computed(() => {
  return conversations.value
    .slice()
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      const at = a.lastMessageAt ?? ''
      const bt = b.lastMessageAt ?? ''
      return bt.localeCompare(at)
    })
})

// WhatsApp-style: ONE unified list, then local filter chips.
const visibleConversations = computed(() => {
  const rows = sortedConversations.value.filter((c) =>
    activeFilter.value === 'archived' ? c.isArchived : !c.isArchived
  )
  if (activeFilter.value === 'unread') {
    return rows.filter((c) => (c.unreadCount || 0) > 0)
  }
  if (activeFilter.value === 'groups') {
    return rows.filter((c) => c.type === 'team')
  }
  return rows
})

const emptyCopy = computed(() => {
  if (activeFilter.value === 'unread') return 'No unread chats.'
  if (activeFilter.value === 'groups') return 'No group chats yet.'
  if (activeFilter.value === 'archived') return 'No archived chats.'
  return 'No conversations yet.'
})

function isOnline(conversationId: string): boolean {
  const conv = store.conversationById(conversationId)
  const uid = conv?.otherUser?.userChatId
  return uid ? store.isOnline(uid) : false
}

function select(id: string) {
  void store.openConversation(id)
}

defineEmits<{ (e: 'add-team'): void; (e: 'start-chat'): void }>()
</script>

<template>
  <aside class="conv-list">
    <header class="conv-list__head">
      <div class="conv-list__title-row">
        <h2 class="conv-list__title">Chats</h2>
        <div class="conv-list__title-actions">
          <button
            type="button"
            class="conv-list__new"
            :class="{ 'conv-list__new--on': lock.enabled }"
            :aria-label="lock.enabled ? 'Chat lock settings' : 'Set up chat lock'"
            :title="lock.enabled ? 'Chat lock is on' : 'Lock your chats'"
            @click="lockSetupOpen = true"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
          </button>
          <button
            type="button"
            class="conv-list__new"
            aria-label="New individual chat"
            title="New chat"
            @click="$emit('start-chat')"
          >
            <AppIcon name="message" :size="18" />
          </button>
          <button
            type="button"
            class="conv-list__new"
            aria-label="Add team"
            title="Add team"
            @click="$emit('add-team')"
          >
            <AppIcon name="people" :size="18" />
          </button>
        </div>
      </div>

      <div class="conv-list__search">
        <AppIcon name="search" :size="18" />
        <input
          v-model="search"
          type="search"
          class="conv-list__search-input"
          placeholder="Search or start a new chat"
          aria-label="Search conversations"
        />
      </div>

      <div class="conv-list__filters" aria-label="Conversation filters">
        <button
          v-for="item in filterItems"
          :key="item.key"
          type="button"
          class="conv-filter"
          :class="{ 'conv-filter--active': activeFilter === item.key }"
          :aria-pressed="activeFilter === item.key ? 'true' : 'false'"
          @click="activeFilter = item.key"
        >
          {{ item.label }}
        </button>
        <button
          type="button"
          class="conv-filter conv-filter--add"
          aria-label="New chat"
          title="New chat"
          @click="$emit('start-chat')"
        >
          +
        </button>
      </div>
    </header>

    <div class="conv-list__scroll">
      <ConversationListItem
        v-for="conv in visibleConversations"
        :key="conv.id"
        :conversation="conv"
        :active="conv.id === activeConversationId"
        :online="isOnline(conv.id)"
        :locked="lock.isConversationLocked(conv.id)"
        @select="select(conv.id)"
      />

      <p v-if="!visibleConversations.length && !loadingConversations" class="conv-list__empty">
        {{ emptyCopy }}
      </p>
      <p v-else-if="loadingConversations && !visibleConversations.length" class="conv-list__empty">
        Loading…
      </p>
    </div>

    <ChatLockSetupModal v-model="lockSetupOpen" />
  </aside>
</template>

<style scoped>
.conv-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--surface-card, #fff);
  border-right: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.conv-list__head {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
}

.conv-list__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.conv-list__title {
  margin: 0;
  color: var(--text, #2e3137);
  font-size: 1.15rem;
  font-weight: 500;
}

.conv-list__new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--secondary, #2f5f98);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.conv-list__new:hover {
  background: var(--primary, #2d8cf0);
  color: #fff;
}

.conv-list__title-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.conv-list__new--on {
  background: var(--primary-light-3, #eef4fd);
  color: var(--primary, #2d8cf0);
}

.conv-list__search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  min-height: 38px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 999px;
  background: var(--surface-pill, rgba(248, 250, 253, 0.94));
  color: var(--text-light, #787f8d);
}

.conv-list__search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.88rem;
  font-weight: 400;
  outline: none;
}

.conv-list__search-input::placeholder {
  color: var(--text-light, #787f8d);
}

.conv-list__filters {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 1px;
  scrollbar-width: none;
}

.conv-list__filters::-webkit-scrollbar {
  display: none;
}

.conv-filter {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 999px;
  background: var(--surface-card, #fff);
  color: var(--text, #2e3137);
  font-family: var(--font-body);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.conv-filter:hover {
  border-color: var(--primary, #2d8cf0);
  color: var(--primary, #2d8cf0);
}

.conv-filter--active {
  background: var(--primary-light-3, #eef4fd);
  border-color: var(--primary, #2d8cf0);
  color: var(--primary, #2d8cf0);
}

.conv-filter--add {
  width: 30px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.1rem;
  line-height: 1;
}

.conv-list__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.conv-list__empty {
  margin: 24px 12px;
  text-align: center;
  color: var(--text-light, #787f8d);
  font-size: 0.85rem;
  font-weight: 400;
}
</style>
