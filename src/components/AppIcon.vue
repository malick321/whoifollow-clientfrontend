<script setup lang="ts">
defineProps<{
  name:
    | 'home'
    | 'task'
    | 'text'
    | 'people'
    | 'award'
    | 'ticket'
    | 'like'
    | 'help'
    | 'search'
    | 'message'
    | 'clock'
    | 'calendar'
    | 'shop'
    | 'folder'
    | 'cart'
    | 'bell'
    | 'game'
    | 'trophy'
    | 'ellipsis'
    | 'close'
    | 'document'
  size?: number
  tone?: 'default' | 'two-tone'
}>()
</script>

<template>
  <span class="app-icon" :data-tone="tone ?? 'default'">
    <svg v-if="name === 'home'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M5 10.5 12 5l7 5.5V19H5z" />
      <path class="app-icon__primary" d="M9.5 19v-5h5v5M4.5 11 12 5l7.5 6" />
    </svg>
    <svg v-else-if="name === 'task'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M6 5h12v14H6z" />
      <path class="app-icon__primary" d="M9 9h6M9 12h6M9 15h4" />
    </svg>
    <svg v-else-if="name === 'text'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M5 6h14v12H5z" />
      <path class="app-icon__primary" d="M8 9h8M8 12h8M8 15h6" />
    </svg>
    <svg v-else-if="name === 'people'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M8.5 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7 2a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z" />
      <path class="app-icon__primary" d="M3.5 19a5 5 0 0 1 10 0M13 18.5a4.2 4.2 0 0 1 7.5 0" />
    </svg>
    <svg v-else-if="name === 'award'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M9 4h6l-.8 4H9.8zm3 5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
      <path class="app-icon__primary" d="m10 16.5 2 3 2-3" />
    </svg>
    <svg v-else-if="name === 'ticket'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M5 8h14v8H5a2 2 0 0 0-2-2 2 2 0 0 0 2-2Z" />
      <path class="app-icon__primary" d="M9 8v8m6-8v8" />
    </svg>
    <svg v-else-if="name === 'like'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M4 11h4v9H4z" />
      <path class="app-icon__primary" d="M8 20h7.5a2 2 0 0 0 2-1.6l1-5.8A2 2 0 0 0 16.5 10H13l.8-3.1A2.2 2.2 0 0 0 11.7 4L8 10.2" />
    </svg>
    <svg v-else-if="name === 'help'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path class="app-icon__primary" d="M9.4 9a2.7 2.7 0 1 1 5 1.4c-.9.9-1.6 1.5-1.6 3M12 17h.01" />
    </svg>
    <svg v-else-if="name === 'search'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" />
      <path class="app-icon__primary" d="m20 20-3.5-3.5" />
    </svg>
    <svg v-else-if="name === 'message'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M5 6h14v9H9l-4 3z" />
      <path class="app-icon__primary" d="M8 10h8M8 13h5" />
    </svg>
    <svg v-else-if="name === 'clock'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path class="app-icon__primary" d="M12 7v5l3 2" />
    </svg>
    <svg v-else-if="name === 'calendar'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M5 6h14v13H5z" />
      <path class="app-icon__primary" d="M8 4v4M16 4v4M5 10h14" />
    </svg>
    <svg v-else-if="name === 'shop'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M6 8h12l-1 11H7z" />
      <path class="app-icon__primary" d="M9 8V6a3 3 0 1 1 6 0v2" />
    </svg>
    <svg v-else-if="name === 'folder'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M4 7h6l2 2h8v8H4z" />
      <path class="app-icon__primary" d="M4 10h16" />
    </svg>
    <svg v-else-if="name === 'cart'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M6 7h13l-1.5 7H8z" />
      <path class="app-icon__primary" d="M6 7 5 4H3m6 15a1 1 0 1 0 0 .01M17 19a1 1 0 1 0 0 .01" />
    </svg>
    <svg v-else-if="name === 'bell'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M6 16h12l-1-2v-3a5 5 0 1 0-10 0v3z" />
      <path class="app-icon__primary" d="M10 19a2 2 0 0 0 4 0" />
    </svg>
    <svg v-else-if="name === 'game'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-4 4l-3-2H10l-3 2a4 4 0 0 1-4-4v-1a4 4 0 0 1 4-4Z" />
      <path class="app-icon__primary" d="M8 12h4M10 10v4m5-1h.01m2-2h.01" />
    </svg>
    <svg v-else-if="name === 'trophy'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M8 4h8v3a4 4 0 0 1-8 0z" />
      <path class="app-icon__primary" d="M9 15h6M10 19h4M6 6H4a3 3 0 0 0 3 3m11-3h2a3 3 0 0 1-3 3M12 11v4" />
    </svg>
    <svg v-else-if="name === 'ellipsis'" :width="size ?? 20" :height="size ?? 20" viewBox="0 0 20 20" aria-hidden="true">
      <!-- `fill="currentColor"` so the three dots inherit from the
           parent button's `color` (typically `var(--secondary)`) —
           lets the ellipsis flip with the theme. Previously this
           was a hardcoded `#254C72` deep navy that disappeared into
           the dark-mode slate page background. -->
      <path
        d="M10 8.3335C9.08333 8.3335 8.33333 9.0835 8.33333 10.0002C8.33333 10.9168 9.08333 11.6668 10 11.6668C10.9167 11.6668 11.6667 10.9168 11.6667 10.0002C11.6667 9.0835 10.9167 8.3335 10 8.3335ZM4.16667 8.3335C3.25 8.3335 2.5 9.0835 2.5 10.0002C2.5 10.9168 3.25 11.6668 4.16667 11.6668C5.08333 11.6668 5.83333 10.9168 5.83333 10.0002C5.83333 9.0835 5.08333 8.3335 4.16667 8.3335ZM15.8333 8.3335C14.9167 8.3335 14.1667 9.0835 14.1667 10.0002C14.1667 10.9168 14.9167 11.6668 15.8333 11.6668C16.75 11.6668 17.5 10.9168 17.5 10.0002C17.5 9.0835 16.75 8.3335 15.8333 8.3335Z"
        fill="currentColor"
      />
    </svg>
    <svg v-else-if="name === 'document'" :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__secondary" d="M7 3h7l4 4v14H7z" />
      <path class="app-icon__primary" d="M14 3v5h4M9 12h6M9 16h6" />
    </svg>
    <svg v-else :width="size ?? 24" :height="size ?? 24" viewBox="0 0 24 24" aria-hidden="true">
      <path class="app-icon__primary" d="M6 6 18 18M18 6 6 18" />
    </svg>
  </span>
</template>
