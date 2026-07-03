<script setup lang="ts">
// AssociationPlayersView
// ----------------------
// Placeholder page for /association/:associationShortName/portal/players.
import AssociationSidebar from '../components/AssociationSidebar.vue'
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="players" />
    <section class="association-users__main">
      <div class="association-placeholder">
        <h1 class="association-placeholder__title">Players</h1>
        <p class="association-placeholder__copy">
          Approve and reject player registrations — coming soon.
        </p>
      </div>
    </section>
  </main>
</template>
