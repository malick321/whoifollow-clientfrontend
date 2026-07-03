<script setup lang="ts">
// ShopOrderConfirmationView
// -------------------------
// The "thank you" page shown after a successful checkout (replaces the legacy
// /Thanks). Reads the placed order from the shopCart store (set by
// ShopCheckoutView). If opened directly with no order in memory, bounce back to
// the shop.

import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useShopCartStore } from '../stores/shopCart'

const router = useRouter()
const cart = useShopCartStore()
const order = computed(() => cart.lastOrder)

function money(n: number): string {
  return `$${(Number(n) || 0).toFixed(2)}`
}

onMounted(() => {
  if (!cart.lastOrder) router.replace('/shop')
})
</script>

<template>
  <main class="thanks">
    <div v-if="order" class="thanks__card">
      <span class="thanks__check">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
      <h1 class="thanks__title">Thank you for your order!</h1>
      <p class="thanks__sub">
        Your payment was successful and your order is confirmed. A receipt has been sent to your email.
      </p>

      <div class="thanks__meta">
        <div><span>Order</span><strong>#{{ order.id }}</strong></div>
        <div><span>Items</span><strong>{{ order.noOfProducts }}</strong></div>
        <div><span>Status</span><strong class="thanks__status">{{ order.status || 'confirmed' }}</strong></div>
      </div>

      <dl class="thanks__totals">
        <div><dt>Subtotal</dt><dd>{{ money(order.subtotal) }}</dd></div>
        <div v-if="order.discount > 0" class="thanks__totals-discount">
          <dt>Discount</dt><dd>−{{ money(order.discount) }}</dd>
        </div>
        <div><dt>Tax</dt><dd>{{ money(order.taxAmount) }}</dd></div>
        <div><dt>Shipping</dt><dd>{{ money(order.shippingAmount) }}</dd></div>
        <div class="thanks__totals-grand"><dt>Total paid</dt><dd>{{ money(order.grandTotal) }}</dd></div>
      </dl>

      <div class="thanks__actions">
        <button type="button" class="primary-button" @click="router.push('/shop')">Continue shopping</button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.thanks {
  max-width: 560px;
  margin: 0 auto;
  padding: 48px 20px 64px;
  font-family: var(--font-body);
}
.thanks__card {
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 36px 28px;
  text-align: center;
}
.thanks__check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 999px;
  background: var(--success-light, rgba(40, 167, 110, 0.14));
  color: var(--success, #28a76e);
  margin-bottom: 14px;
}
.thanks__title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 500;
  color: var(--text);
}
.thanks__sub {
  margin: 8px auto 22px;
  max-width: 420px;
  color: var(--text-light);
  font-size: 0.92rem;
  line-height: 1.5;
}
.thanks__meta {
  display: flex;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 22px;
}
.thanks__meta > div {
  flex: 1 1 0;
  min-width: 110px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 12px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  background: var(--surface-pill);
}
.thanks__meta span {
  font-size: 0.74rem;
  color: var(--text-light);
}
.thanks__meta strong {
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--text);
}
.thanks__status {
  text-transform: capitalize;
  color: var(--success, #28a76e) !important;
}
.thanks__totals {
  margin: 0 0 24px;
  padding: 16px 18px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: left;
}
.thanks__totals > div {
  display: flex;
  justify-content: space-between;
}
.thanks__totals dt,
.thanks__totals dd {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-light);
}
.thanks__totals-discount dt,
.thanks__totals-discount dd {
  color: var(--success);
}
.thanks__totals-grand {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border-divider);
}
.thanks__totals-grand dt,
.thanks__totals-grand dd {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
}
.thanks__actions {
  display: flex;
  justify-content: center;
}
</style>
