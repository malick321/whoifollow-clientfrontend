<script setup lang="ts">
// PublicLegalFooter
// -----------------
// Reusable legal footer: policy links + copyright with a JS-derived year
// so it stays current. Used on the public event page and the MatchGeni
// dashboard (below the Event Locations card).

const currentYear = new Date().getFullYear()
</script>

<template>
  <footer class="pub-foot">
    <nav class="pub-foot__links">
      <a href="https://whoifollow.tech/privacy-policy" target="_blank" rel="noopener">Privacy Policy</a>
      <span class="pub-foot__sep" aria-hidden="true">|</span>
      <a href="https://whoifollow.tech/terms-and-conditions" target="_blank" rel="noopener">Terms &amp; Conditions</a>
      <span class="pub-foot__sep" aria-hidden="true">|</span>
      <a href="https://whoifollow.tech/return-refund-policy" target="_blank" rel="noopener">Return &amp; Refund Policy</a>
      <span class="pub-foot__sep" aria-hidden="true">|</span>
      <a href="https://whoifollow.tech/csae-policy" target="_blank" rel="noopener">CSAE Policy</a>
      <span class="pub-foot__sep" aria-hidden="true">|</span>
      <a href="https://whoifollow.tech/cookie-policy" target="_blank" rel="noopener">Cookie Policy</a>
    </nav>
    <p class="pub-foot__copy">© {{ currentYear }} Who I Follow Corp.</p>
  </footer>
</template>

<style scoped>
.pub-foot { padding: 4px 2px 8px; }
.pub-foot__links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  line-height: 1.5;
}
.pub-foot__links a { color: var(--secondary); text-decoration: none; }
.pub-foot__links a:hover { color: var(--primary); text-decoration: underline; }
.pub-foot__sep { color: var(--border-divider); }
.pub-foot__copy { margin: 3px 0 0; font-size: 11.5px; color: var(--secondary); }
</style>
