<script setup lang="ts">
import TeamAvatar from './TeamAvatar.vue'

// Avatar + name + optional meta-line, rendered as a horizontal row.
// Used in the field preview's team-meta columns (both home team and
// opponent) so both sides share the exact same layout.
//
// Size variants mirror the TeamAvatar sizes so callers can dial the
// block down when it's showing secondary info (e.g. the opponent
// beside the home team).
withDefaults(defineProps<{
  name: string
  avatarUrl?: string
  meta?: string
  size?: 'sm' | 'md' | 'lg'
  variant?: 'primary' | 'secondary'
  /* When true, the TeamAvatar isn't rendered — only the name + meta
     stack. Used by the game-lineup preview's opponent row which only
     needs the team name beside the "vs" label. */
  hideAvatar?: boolean
}>(), {
  avatarUrl: '',
  meta: '',
  size: 'md',
  variant: 'primary',
  hideAvatar: false
})
</script>

<template>
  <div
    class="field-identity"
    :class="[
      `field-identity--${size}`,
      `field-identity--${variant}`
    ]"
  >
    <TeamAvatar v-if="!hideAvatar" :name="name" :image-url="avatarUrl" :size="size" />
    <div class="field-identity__copy">
      <h3 class="field-identity__name">{{ name }}</h3>
      <p v-if="meta" class="field-identity__meta">{{ meta }}</p>
    </div>
  </div>
</template>
