<script setup lang="ts">
// Catch-all view rendered by the router's wildcard route. Covers two cases
// at once without telling the user which is true:
//   1. The URL doesn't match any known route (genuinely not found).
//   2. The user hit a valid-looking URL but isn't allowed to see that
//      content (e.g., wrong team / stale link).
//
// This page intentionally does NOT redirect to the handoff flow — if the
// URL is nonsense, no amount of authentication will fix it.
</script>

<template>
  <div class="not-found-view">
    <div class="not-found-view__card">
      <div class="not-found-view__mark" aria-hidden="true">!</div>
      <h1 class="not-found-view__title">Oops! This page isn't available.</h1>
      <p class="not-found-view__body">
        The content you're looking for either doesn't exist or isn't accessible from your account.
      </p>
      <p class="not-found-view__body not-found-view__body--muted">
        Double-check the link, or head back to your events and try again. If you keep seeing this
        page, please reach out to your team admin.
      </p>
    </div>
  </div>
</template>
