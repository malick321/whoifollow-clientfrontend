<script setup lang="ts">
// GoProView
// ---------
// "Go Pro" subscription upgrade — a faithful rebuild of the legacy
// GoPro/GoSubscribe.vue: a Stripe hosted <stripe-pricing-table> embed.
// (Kept identical to the old system for now; a native in-app checkout is a
// planned upgrade.) Contract: docs/api/go-pro-api-contract.md.
//
// Flow on mount:
//   1. Load the pricing-table web-component script.
//   2. fetchPackagesInfo() — ensures a Stripe customer + reads pro status.
//   3. If already Pro → show the current plan + renewal date.
//   4. Else openPricingTableSession() → render the pricing table.

import { onMounted, ref } from 'vue'
import { fetchPackagesInfo, openPricingTableSession } from '../api/subscription'
import {
  loadPricingTableScript,
  hasPricingTableConfig,
  getPricingTableId,
  getPublishableKey
} from '../lib/stripePricingTable'

type State = 'loading' | 'active' | 'table' | 'unavailable'

const state = ref<State>('loading')
const customerSessionSecret = ref('')
const subscriptionPlan = ref<string | null>(null)
const expiryDate = ref<string | null>(null)

const pricingTableId = getPricingTableId()
const publishableKey = getPublishableKey()

function formatDate(raw: string | null): string {
  if (!raw) return ''
  const d = new Date(raw.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

onMounted(async () => {
  // No Stripe config → keyless fallback, don't even hit the API.
  if (!hasPricingTableConfig()) {
    state.value = 'unavailable'
    return
  }

  const [scriptReady, info] = await Promise.all([
    loadPricingTableScript(),
    fetchPackagesInfo().catch(() => null)
  ])

  if (!info) {
    state.value = 'unavailable'
    return
  }

  // Already subscribed → show status instead of the pricing table.
  if (info.proStatus) {
    subscriptionPlan.value = info.subscriptionPlan
    expiryDate.value = info.expiryDate
    state.value = 'active'
    return
  }

  if (!scriptReady || !info.encryptedEmail) {
    state.value = 'unavailable'
    return
  }

  try {
    const session = await openPricingTableSession(info.encryptedEmail)
    customerSessionSecret.value = session.customerSessionSecret
    state.value = customerSessionSecret.value ? 'table' : 'unavailable'
  } catch {
    state.value = 'unavailable'
  }
})
</script>

<template>
  <div class="go-pro">
    <header class="go-pro__head">
      <span class="go-pro__eyebrow">Who I Follow</span>
      <h1 class="go-pro__title">Go Pro</h1>
      <p class="go-pro__subtitle">
        Unlock full player stats, leaderboards and premium features.
      </p>
    </header>

    <!-- Loading -->
    <div v-if="state === 'loading'" class="go-pro__card go-pro__loading">
      <span class="go-pro__spinner" aria-hidden="true"></span>
      <p>Loading your plans…</p>
    </div>

    <!-- Already Pro -->
    <div v-else-if="state === 'active'" class="go-pro__card go-pro__active">
      <div class="go-pro__badge">✦ Pro</div>
      <h2 class="go-pro__active-title">You're on {{ subscriptionPlan || 'Pro' }}.</h2>
      <p v-if="expiryDate" class="go-pro__active-meta">
        Renews on {{ formatDate(expiryDate) }}.
      </p>
      <p class="go-pro__active-hint">Thanks for supporting Who I Follow.</p>
    </div>

    <!-- Stripe hosted pricing table -->
    <div v-else-if="state === 'table'" class="go-pro__card go-pro__table">
      <stripe-pricing-table
        :pricing-table-id="pricingTableId"
        :publishable-key="publishableKey"
        :customer-session-client-secret="customerSessionSecret"
      ></stripe-pricing-table>
    </div>

    <!-- Unavailable / keyless fallback -->
    <div v-else class="go-pro__card go-pro__unavailable">
      <p>
        There's a technical issue with the payment gateway, so the upgrade
        process isn't available right now. Please try again later.
      </p>
    </div>
  </div>
</template>

<style scoped>
.go-pro {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 20px 64px;
}
.go-pro__head {
  text-align: center;
  margin-bottom: 28px;
}
.go-pro__eyebrow {
  display: block;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-light, #787f8d);
}
.go-pro__title {
  margin: 6px 0 8px;
  font-size: 2rem;
  font-weight: 700;
  color: var(--text, #2e3137);
}
.go-pro__subtitle {
  margin: 0;
  color: var(--text-light, #787f8d);
  font-size: 0.95rem;
}
.go-pro__card {
  background: var(--surface-card, #fff);
  border: 1px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-radius: 14px;
  padding: 28px;
  box-shadow: var(--shadow-soft, 0 6px 16px rgba(36, 60, 91, 0.05));
}
.go-pro__loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--text-light, #787f8d);
}
.go-pro__spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid var(--border-divider, rgba(207, 220, 234, 0.85));
  border-top-color: var(--primary, #2d8cf0);
  animation: go-pro-spin 0.7s linear infinite;
}
@keyframes go-pro-spin {
  to { transform: rotate(360deg); }
}
.go-pro__active {
  text-align: center;
}
.go-pro__badge {
  display: inline-block;
  padding: 4px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary, #2d8cf0), var(--secondary, #2f5f98));
  color: #fff;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 12px;
}
.go-pro__active-title {
  margin: 0 0 6px;
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text, #2e3137);
}
.go-pro__active-meta {
  margin: 0 0 4px;
  color: var(--text, #2e3137);
  font-weight: 500;
}
.go-pro__active-hint {
  margin: 0;
  color: var(--text-light, #787f8d);
  font-size: 0.9rem;
}
.go-pro__unavailable {
  text-align: center;
  color: var(--text-light, #787f8d);
}
</style>
