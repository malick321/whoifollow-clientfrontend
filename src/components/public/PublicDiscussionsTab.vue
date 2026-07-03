<script setup lang="ts">
// PublicDiscussionsTab
// --------------------
// Discussions tab on the public event page. Placeholder for now — just the
// heading + an empty state (threads/data land in a later pass). Uses the
// shared `.pub-panel__section` card + `.pub-panel__heading` so it matches
// the other tabs' framing.
import AppIcon from '../AppIcon.vue'
</script>

<template>
  <div class="pub-panel">
    <section class="pub-panel__section pub-tab-empty">
      <h2 class="pub-panel__heading">Discussions</h2>
      <div class="pub-tab-empty__body">
        <AppIcon name="message" :size="28" />
        <p class="pub-tab-empty__title">No discussions yet</p>
        <p class="pub-tab-empty__sub">Fan and team conversations for this event will show up here.</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pub-panel { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.pub-panel__section {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.06);
}
.pub-panel__heading { margin: 0 0 12px; font-size: 16px; font-weight: 600; color: var(--text); }
.pub-tab-empty__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 32px 16px;
  color: var(--secondary);
}
.pub-tab-empty__title { margin: 6px 0 0; font-size: 14px; font-weight: 500; color: var(--text); }
.pub-tab-empty__sub { margin: 0; font-size: 13px; color: var(--secondary); max-width: 320px; }
</style>
