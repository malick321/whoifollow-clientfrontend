<script setup lang="ts">
// ShopCheckoutView
// ----------------
// Single-page checkout (the artistic replacement for the legacy 4-step wizard:
// Order → Shipping → Payment → Thanks). One scrollable page: Contact +
// Shipping + Payment on the left, a sticky Order Summary on the right.
//
// Payment mirrors the legacy flow exactly:
//   1. POST /v2/shop/create-payment-intent  → clientSecret
//   2. Stripe Elements card field → stripe.confirmCardPayment(clientSecret)
//   3. POST /v2/shop/checkout (status PAID) → creates the Order + clears the cart
// Then we route to /shop/thanks with the confirmed order.
//
// Reuses the colleague's design vocabulary (floating-input, primary/secondary
// buttons, app-banner, CSS tokens) — no new UI primitives.

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Stripe, StripeCardElement, StripeElements } from '@stripe/stripe-js'
import AppIcon from '../components/AppIcon.vue'
import { useShopCartStore } from '../stores/shopCart'
import { authEmail, isAuthenticated } from '../auth-session'
import { openLoginModal } from '../login-modal-center'
import { pushToast } from '../toast-center'
import { getStripe, hasStripeKey } from '../lib/stripe'
import {
  checkoutShop,
  createShopPaymentIntent,
  fetchShopConfig,
  findPromoCode,
  type ShopConfig
} from '../api/shop'

const router = useRouter()
const cart = useShopCartStore()

// ── Form state ─────────────────────────────────────────────────────────────
const contact = reactive({ email: '', firstName: '', lastName: '' })
const shipping = reactive({ address: '', city: '', state: '', zipCode: '', phone: '' })
const acceptedTerms = ref(false)
const showErrors = ref(false)

const config = ref<ShopConfig | null>(null)
const loading = ref(true)

// ── Promo (shared with the cart drawer via the store) ───────────────────────
const promoInput = ref('')
const promoChecking = ref(false)
const promoError = ref<string | null>(null)
const appliedPromo = computed(() => cart.appliedPromo)

async function applyPromo() {
  const name = promoInput.value.trim()
  if (!name || promoChecking.value) return
  promoChecking.value = true
  promoError.value = null
  try {
    const promo = await findPromoCode(name)
    if (promo) {
      cart.setPromo(promo)
      promoInput.value = ''
    } else {
      promoError.value = 'That promo code is invalid or has expired.'
    }
  } catch {
    promoError.value = 'Could not validate that code. Please try again.'
  } finally {
    promoChecking.value = false
  }
}
function removePromo() {
  cart.setPromo(null)
  promoError.value = null
}

// ── Totals (same formula as the server + legacy: tax% & shipping% of subtotal)
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
const subtotal = computed(() => cart.subtotalNumber)
const taxPercentage = computed(() => Number(config.value?.taxPercentage) || 0)
const shippingPercentage = computed(() => Number(config.value?.shippingCost) || 0)
const taxAmount = computed(() => round2((subtotal.value / 100) * taxPercentage.value))
const shippingAmount = computed(() => round2((subtotal.value / 100) * shippingPercentage.value))
const discount = computed(() => round2(subtotal.value * cart.discountRate))
const grandTotal = computed(() =>
  Math.max(0, round2(subtotal.value + taxAmount.value + shippingAmount.value - discount.value))
)

// ── Stripe Elements ─────────────────────────────────────────────────────────
const stripeAvailable = hasStripeKey()
let stripe: Stripe | null = null
let elements: StripeElements | null = null
let cardElement: StripeCardElement | null = null
const cardMount = ref<HTMLElement | null>(null)
const cardComplete = ref(false)
const cardError = ref<string | null>(null)
const payError = ref<string | null>(null)
const placing = ref(false)

function cardStyle() {
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark-mode')
  return {
    base: {
      color: dark ? '#e8eef6' : '#2e3137',
      fontFamily: 'inherit',
      fontSize: '15px',
      '::placeholder': { color: dark ? '#8a93a3' : '#9aa3b2' }
    },
    invalid: { color: '#e05549', iconColor: '#e05549' }
  }
}

async function mountCard() {
  if (!stripeAvailable) return
  stripe = await getStripe()
  if (!stripe || !cardMount.value) return
  elements = stripe.elements()
  cardElement = elements.create('card', { style: cardStyle() })
  cardElement.mount(cardMount.value)
  cardElement.on('change', (e) => {
    cardComplete.value = e.complete
    cardError.value = e.error?.message ?? null
  })
}

// ── Validation ───────────────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const errors = computed(() => {
  const e = new Set<string>()
  if (!EMAIL_RE.test(contact.email.trim())) e.add('email')
  if (!contact.firstName.trim()) e.add('firstName')
  if (!contact.lastName.trim()) e.add('lastName')
  if (!shipping.address.trim()) e.add('address')
  if (!shipping.city.trim()) e.add('city')
  if (!shipping.state.trim()) e.add('state')
  if (!shipping.zipCode.trim()) e.add('zipCode')
  if (!shipping.phone.trim()) e.add('phone')
  return e
})
function err(field: string): boolean {
  return showErrors.value && errors.value.has(field)
}
const canPlace = computed(
  () =>
    stripeAvailable &&
    !cart.isEmpty &&
    errors.value.size === 0 &&
    acceptedTerms.value &&
    cardComplete.value &&
    !placing.value
)

async function placeOrder() {
  showErrors.value = true
  payError.value = null
  if (!canPlace.value) {
    if (!acceptedTerms.value) payError.value = 'Please accept the terms to continue.'
    return
  }
  placing.value = true
  try {
    const { clientSecret } = await createShopPaymentIntent(grandTotal.value)
    if (!clientSecret || !stripe || !cardElement) {
      throw new Error('Payment could not be initialised. Please try again.')
    }

    const result = await stripe.confirmCardPayment(clientSecret, {
      payment_method: {
        card: cardElement,
        billing_details: {
          name: `${contact.firstName} ${contact.lastName}`.trim(),
          email: contact.email.trim(),
          phone: shipping.phone.trim(),
          address: {
            line1: shipping.address.trim(),
            city: shipping.city.trim(),
            state: shipping.state.trim(),
            postal_code: shipping.zipCode.trim()
          }
        }
      }
    })

    if (result.error) throw new Error(result.error.message || 'Your card could not be charged.')
    const pi = result.paymentIntent
    if (!pi || pi.status !== 'succeeded') throw new Error('Payment was not completed.')

    const order = await checkoutShop({
      paymentIntentId: pi.id,
      reference: pi.id,
      promoId: cart.appliedPromo?.id ?? null,
      shipping: { ...shipping }
    })

    cart.setLastOrder(order)
    cart.clear()
    pushToast({ tone: 'success', title: 'Order placed', message: `Order #${order.id} is confirmed.` })
    router.push('/shop/thanks')
  } catch (e) {
    payError.value = e instanceof Error ? e.message : 'Could not place your order.'
  } finally {
    placing.value = false
  }
}

onMounted(async () => {
  if (!isAuthenticated.value) {
    openLoginModal()
    router.replace('/shop')
    return
  }
  contact.email = authEmail.value || ''
  try {
    await Promise.all([cart.load(), fetchShopConfig().then((c) => (config.value = c))])
  } finally {
    loading.value = false
  }
  await mountCard()
})

onBeforeUnmount(() => {
  cardElement?.destroy()
})
</script>

<template>
  <main class="checkout">
    <header class="checkout__head">
      <button type="button" class="checkout__back" @click="router.push('/shop')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span>Back to shop</span>
      </button>
      <h1 class="checkout__title">Checkout</h1>
      <p class="checkout__subtitle">Review your details and complete your purchase securely.</p>
    </header>

    <!-- Empty cart -->
    <div v-if="!loading && cart.isEmpty" class="checkout__empty">
      <AppIcon name="cart" :size="52" tone="two-tone" />
      <p class="checkout__empty-title">Your cart is empty</p>
      <p class="checkout__empty-copy">Add a few items before heading to checkout.</p>
      <button type="button" class="primary-button" @click="router.push('/shop')">Browse the shop</button>
    </div>

    <div v-else class="checkout__grid">
      <!-- ── Left: forms ─────────────────────────────────────────── -->
      <div class="checkout__forms">
        <!-- Contact -->
        <section class="checkout-card">
          <div class="checkout-card__head">
            <span class="checkout-card__step">1</span>
            <h2 class="checkout-card__title">Contact</h2>
          </div>
          <div class="checkout-card__body">
            <div class="floating-input" :class="{ 'floating-input--invalid': err('email') }">
              <input id="co-email" v-model="contact.email" type="email" class="floating-input__control" placeholder=" " />
              <label for="co-email" class="floating-input__label">Email</label>
              <span v-if="err('email')" class="floating-input__error-corner">Required</span>
            </div>
            <div class="checkout__row2">
              <div class="floating-input" :class="{ 'floating-input--invalid': err('firstName') }">
                <input id="co-first" v-model="contact.firstName" type="text" maxlength="40" class="floating-input__control" placeholder=" " />
                <label for="co-first" class="floating-input__label">First name</label>
              </div>
              <div class="floating-input" :class="{ 'floating-input--invalid': err('lastName') }">
                <input id="co-last" v-model="contact.lastName" type="text" maxlength="40" class="floating-input__control" placeholder=" " />
                <label for="co-last" class="floating-input__label">Last name</label>
              </div>
            </div>
          </div>
        </section>

        <!-- Shipping -->
        <section class="checkout-card">
          <div class="checkout-card__head">
            <span class="checkout-card__step">2</span>
            <h2 class="checkout-card__title">Shipping address</h2>
          </div>
          <div class="checkout-card__body">
            <div class="floating-input" :class="{ 'floating-input--invalid': err('address') }">
              <input id="co-addr" v-model="shipping.address" type="text" maxlength="160" class="floating-input__control" placeholder=" " />
              <label for="co-addr" class="floating-input__label">Street address</label>
            </div>
            <div class="checkout__row2">
              <div class="floating-input" :class="{ 'floating-input--invalid': err('city') }">
                <input id="co-city" v-model="shipping.city" type="text" maxlength="80" class="floating-input__control" placeholder=" " />
                <label for="co-city" class="floating-input__label">City</label>
              </div>
              <div class="floating-input" :class="{ 'floating-input--invalid': err('state') }">
                <input id="co-state" v-model="shipping.state" type="text" maxlength="60" class="floating-input__control" placeholder=" " />
                <label for="co-state" class="floating-input__label">State</label>
              </div>
            </div>
            <div class="checkout__row2">
              <div class="floating-input" :class="{ 'floating-input--invalid': err('zipCode') }">
                <input id="co-zip" v-model="shipping.zipCode" type="text" maxlength="16" class="floating-input__control" placeholder=" " />
                <label for="co-zip" class="floating-input__label">Zip code</label>
              </div>
              <div class="floating-input" :class="{ 'floating-input--invalid': err('phone') }">
                <input id="co-phone" v-model="shipping.phone" type="tel" maxlength="24" class="floating-input__control" placeholder=" " />
                <label for="co-phone" class="floating-input__label">Phone</label>
              </div>
            </div>
          </div>
        </section>

        <!-- Payment -->
        <section class="checkout-card">
          <div class="checkout-card__head">
            <span class="checkout-card__step">3</span>
            <h2 class="checkout-card__title">Payment</h2>
            <span class="checkout-card__secure">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
              </svg>
              Secured by Stripe
            </span>
          </div>
          <div class="checkout-card__body">
            <div v-if="!stripeAvailable" class="app-banner app-banner--warning">
              <div class="app-banner__text">
                <strong class="app-banner__title">Card payments are not configured yet</strong>
                <span class="app-banner__sub">Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in the frontend <code>.env</code> and restart the dev server to enable checkout.</span>
              </div>
            </div>
            <template v-else>
              <label class="checkout__card-label">Card details</label>
              <div ref="cardMount" class="checkout__card-field" :class="{ 'checkout__card-field--error': cardError }"></div>
              <p v-if="cardError" class="checkout__field-error">{{ cardError }}</p>
            </template>
          </div>
        </section>
      </div>

      <!-- ── Right: sticky order summary ──────────────────────────── -->
      <aside class="checkout__summary">
        <div class="summary-card">
          <h2 class="summary-card__title">Order summary</h2>

          <ul class="summary-card__items">
            <li v-for="item in cart.items" :key="item.id" class="summary-item">
              <span class="summary-item__media">
                <img v-if="item.product.imageUrl" :src="item.product.imageUrl" :alt="item.product.name" />
                <span v-else class="summary-item__placeholder"><AppIcon name="shop" :size="16" tone="two-tone" /></span>
                <span class="summary-item__qty">{{ item.qty }}</span>
              </span>
              <span class="summary-item__info">
                <span class="summary-item__name">{{ item.product.name }}</span>
                <span v-if="item.size" class="summary-item__size">Size: {{ item.size.label }}</span>
              </span>
              <span class="summary-item__price">${{ ((Number(item.product.price) || 0) * item.qty).toFixed(2) }}</span>
            </li>
          </ul>

          <!-- Promo -->
          <div class="summary-card__promo">
            <template v-if="appliedPromo">
              <div class="summary-card__promo-applied">
                <span><AppIcon name="ticket" :size="14" /> {{ appliedPromo.promoName }} · {{ Number(appliedPromo.discountPercentage) || 0 }}% off</span>
                <button type="button" class="summary-card__promo-remove" @click="removePromo">Remove</button>
              </div>
            </template>
            <template v-else>
              <div class="summary-card__promo-row">
                <input
                  v-model="promoInput"
                  type="text"
                  class="summary-card__promo-input"
                  placeholder="Promo code"
                  autocomplete="off"
                  @keyup.enter="applyPromo"
                />
                <button
                  type="button"
                  class="summary-card__promo-apply"
                  :disabled="promoChecking || !promoInput.trim()"
                  @click="applyPromo"
                >
                  {{ promoChecking ? '…' : 'Apply' }}
                </button>
              </div>
              <p v-if="promoError" class="checkout__field-error">{{ promoError }}</p>
            </template>
          </div>

          <dl class="summary-card__totals">
            <div><dt>Subtotal</dt><dd>${{ subtotal.toFixed(2) }}</dd></div>
            <div v-if="discount > 0" class="summary-card__totals-discount">
              <dt>Discount</dt><dd>−${{ discount.toFixed(2) }}</dd>
            </div>
            <div><dt>Tax<span v-if="taxPercentage"> ({{ taxPercentage }}%)</span></dt><dd>${{ taxAmount.toFixed(2) }}</dd></div>
            <div><dt>Shipping<span v-if="shippingPercentage"> ({{ shippingPercentage }}%)</span></dt><dd>${{ shippingAmount.toFixed(2) }}</dd></div>
            <div class="summary-card__totals-grand"><dt>Total</dt><dd>${{ grandTotal.toFixed(2) }}</dd></div>
          </dl>

          <label class="summary-card__terms">
            <input v-model="acceptedTerms" type="checkbox" />
            <span>I accept the terms &amp; conditions for this order.</span>
          </label>

          <p v-if="payError" class="checkout__pay-error">{{ payError }}</p>

          <button
            type="button"
            class="primary-button summary-card__place"
            :disabled="!canPlace"
            @click="placeOrder"
          >
            <span v-if="placing" class="btn-spinner" aria-hidden="true"></span>
            {{ placing ? 'Processing…' : `Place order · $${grandTotal.toFixed(2)}` }}
          </button>
          <p class="summary-card__reassure">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            Payments are encrypted &amp; processed by Stripe.
          </p>
        </div>
      </aside>
    </div>
  </main>
</template>

<style scoped>
.checkout {
  max-width: 1160px;
  margin: 0 auto;
  padding: 28px 20px 64px;
  font-family: var(--font-body);
}

.checkout__head {
  margin-bottom: 24px;
}
.checkout__back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  padding: 0;
  margin-bottom: 12px;
  color: var(--text-light);
  font-family: var(--font-body);
  font-size: 0.85rem;
  cursor: pointer;
}
.checkout__back:hover {
  color: var(--primary);
}
.checkout__title {
  margin: 0;
  font-size: 1.7rem;
  font-weight: 500;
  color: var(--text);
}
.checkout__subtitle {
  margin: 4px 0 0;
  color: var(--text-light);
  font-size: 0.92rem;
}

.checkout__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  padding: 72px 16px;
  color: var(--text-light);
}
.checkout__empty-title {
  margin: 10px 0 0;
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text);
}
.checkout__empty-copy {
  margin: 0 0 12px;
  font-size: 0.9rem;
}

.checkout__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 24px;
  align-items: start;
}
@media (max-width: 920px) {
  .checkout__grid {
    grid-template-columns: 1fr;
  }
}

.checkout__forms {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.checkout-card {
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
}
.checkout-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-divider);
}
.checkout-card__step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  background: var(--primary-light-3);
  color: var(--primary);
  font-size: 0.85rem;
  font-weight: 600;
}
.checkout-card__title {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 500;
  color: var(--text);
}
.checkout-card__secure {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-light);
  font-size: 0.76rem;
}
.checkout-card__body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}
.checkout__row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 520px) {
  .checkout__row2 {
    grid-template-columns: 1fr;
  }
}

.checkout__card-label {
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--secondary);
}
.checkout__card-field {
  padding: 14px 14px;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  background: var(--surface-pill);
  transition: border-color 0.15s ease;
}
.checkout__card-field:focus-within {
  border-color: var(--primary);
}
.checkout__card-field--error {
  border-color: #e05549;
}
.checkout__field-error {
  margin: 6px 0 0;
  font-size: 0.78rem;
  color: #e05549;
}
.checkout__pay-error {
  margin: 0 0 10px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  background: rgba(224, 85, 73, 0.1);
  color: #e05549;
  font-size: 0.82rem;
}

/* ── Sticky summary ─────────────────────────────────────────────── */
.checkout__summary {
  position: sticky;
  top: 16px;
}
@media (max-width: 920px) {
  .checkout__summary {
    position: static;
  }
}
.summary-card {
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 20px;
}
.summary-card__title {
  margin: 0 0 14px;
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--text);
}
.summary-card__items {
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 280px;
  overflow-y: auto;
}
.summary-item {
  display: flex;
  align-items: center;
  gap: 12px;
}
.summary-item__media {
  position: relative;
  flex: 0 0 48px;
}
.summary-item__media img,
.summary-item__placeholder {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-md);
  object-fit: cover;
  background: var(--surface-pill);
}
.summary-item__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-light);
}
.summary-item__qty {
  position: absolute;
  top: -7px;
  right: -7px;
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--white);
  background: var(--secondary);
  border-radius: 999px;
}
.summary-item__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.summary-item__name {
  font-size: 0.86rem;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-item__size {
  font-size: 0.76rem;
  color: var(--text-light);
}
.summary-item__price {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
}

.summary-card__promo {
  padding: 12px 0;
  border-top: 1px solid var(--border-divider);
}
.summary-card__promo-row {
  display: flex;
  gap: 8px;
}
.summary-card__promo-input {
  flex: 1;
  font-family: var(--font-body);
  font-size: 0.88rem;
  color: var(--text);
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  padding: 9px 12px;
}
.summary-card__promo-input:focus {
  outline: none;
  border-color: var(--primary);
}
.summary-card__promo-apply {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.84rem;
  color: var(--primary);
  background: var(--primary-light-3);
  border: 1px solid var(--primary-light-2);
  border-radius: var(--radius-md);
  padding: 9px 16px;
  cursor: pointer;
}
.summary-card__promo-apply:disabled {
  opacity: 0.6;
  cursor: default;
}
.summary-card__promo-applied {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.82rem;
  color: var(--success);
}
.summary-card__promo-remove {
  border: none;
  background: none;
  color: var(--text-light);
  font-size: 0.78rem;
  cursor: pointer;
  padding: 0;
}
.summary-card__promo-remove:hover {
  color: var(--highlight);
}

.summary-card__totals {
  margin: 0;
  padding: 12px 0;
  border-top: 1px solid var(--border-divider);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.summary-card__totals > div {
  display: flex;
  justify-content: space-between;
}
.summary-card__totals dt,
.summary-card__totals dd {
  margin: 0;
  font-size: 0.88rem;
  color: var(--text-light);
}
.summary-card__totals-discount dt,
.summary-card__totals-discount dd {
  color: var(--success);
}
.summary-card__totals-grand {
  margin-top: 4px;
  padding-top: 9px;
  border-top: 1px solid var(--border-divider);
}
.summary-card__totals-grand dt,
.summary-card__totals-grand dd {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
}

.summary-card__terms {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 6px 0 14px;
  font-size: 0.82rem;
  color: var(--text-light);
  cursor: pointer;
}
.summary-card__terms input {
  margin-top: 2px;
}

.summary-card__place {
  width: 100%;
  justify-content: center;
}
.summary-card__reassure {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 10px 0 0;
  font-size: 0.74rem;
  color: var(--text-light);
}
</style>
