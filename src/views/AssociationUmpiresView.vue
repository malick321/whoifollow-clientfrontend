<script setup lang="ts">
// AssociationUmpiresView
// ----------------------
// Placeholder page for /association/:associationShortName/portal/umpires.
import AssociationSidebar from '../components/AssociationSidebar.vue'
</script>

<template>
  <main class="association-users">
    <AssociationSidebar active-key="umpires" />
    <section class="association-users__main">
      <div class="association-placeholder">
        <h1 class="association-placeholder__title">Umpires</h1>
        <p class="association-placeholder__copy">
          Approve and reject umpire registrations — coming soon.
        </p>
      </div>
    </section>
  </main>
</template>
