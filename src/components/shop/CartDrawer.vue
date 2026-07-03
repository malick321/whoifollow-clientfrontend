<script setup lang="ts">
// CartDrawer
// ----------
// Right-hand slide-in drawer (SlideModal) showing the cart: line items with
// thumbnail, name, size, qty stepper, line total, and a remove control; a
// promo-code field; and a footer with subtotal + checkout affordance.
// Cart state + mutations live in the shopCart Pinia store; promo validation
// calls findPromoCode directly.

import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import SlideModal from '../SlideModal.vue'
import AppIcon from '../AppIcon.vue'
import NumberStepper from '../NumberStepper.vue'
import { useShopCartStore } from '../../stores/shopCart'
import { findPromoCode, type ShopCartItem } from '../../api/shop'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
}>()

const cart = useShopCartStore()
const router = useRouter()

const busyLineId = ref<string | null>(null)

// ── Promo code ───────────────────────────────────────────────────────────
// The applied promo lives in the store so it carries into the checkout page.
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
    } else {
      cart.setPromo(null)
      promoError.value = 'That promo code is invalid or has expired.'
    }
  } catch {
    promoError.value = 'Could not validate that code. Please try again.'
  } finally {
    promoChecking.value = false
  }
}

function goToCheckout() {
  if (cart.isEmpty) return
  emit('update:modelValue', false)
  router.push('/shop/checkout')
}

const discountPct = computed(() =>
  appliedPromo.value ? Number(appliedPromo.value.discountPercentage) || 0 : 0
)

const discountAmount = computed(() =>
  Math.round(cart.subtotalNumber * (discountPct.value / 100) * 100) / 100
)

const total = computed(() =>
  Math.max(0, Math.round((cart.subtotalNumber - discountAmount.value) * 100) / 100)
)

async function setQty(item: ShopCartItem, next: number) {
  const delta = next - item.qty
  if (delta === 0) return
  busyLineId.value = item.id
  try {
    await cart.changeQty(item, delta)
  } finally {
    busyLineId.value = null
  }
}

async function remove(item: ShopCartItem) {
  busyLineId.value = item.id
  try {
    await cart.remove(item)
  } finally {
    busyLineId.value = null
  }
}

function lineTotal(item: ShopCartItem): string {
  const price = Number(item.product.price) || 0
  return (price * item.qty).toFixed(2)
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    title="Your Cart"
    :subtitle="cart.itemCount ? `${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}` : 'Empty'"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="cart.isEmpty" class="cart-drawer__empty">
      <AppIcon name="cart" :size="44" tone="two-tone" />
      <p class="cart-drawer__empty-title">Your cart is empty</p>
      <p class="cart-drawer__empty-copy">Browse the shop and add items to get started.</p>
    </div>

    <ul v-else class="cart-drawer__list">
      <li v-for="item in cart.items" :key="item.id" class="cart-line">
        <div class="cart-line__media">
          <img
            v-if="item.product.imageUrl"
            :src="item.product.imageUrl"
            :alt="item.product.name"
            class="cart-line__img"
          />
          <div v-else class="cart-line__img cart-line__img--placeholder">
            <AppIcon name="shop" :size="22" tone="two-tone" />
          </div>
        </div>

        <div class="cart-line__info">
          <p class="cart-line__name">{{ item.product.name }}</p>
          <p v-if="item.size" class="cart-line__size">Size: {{ item.size.label }}</p>
          <div class="cart-line__controls">
            <NumberStepper
              :model-value="item.qty"
              :min="1"
              :max="99"
              :disabled="busyLineId === item.id"
              :aria-label="`Quantity for ${item.product.name}`"
              @update:model-value="setQty(item, $event)"
            />
            <button
              type="button"
              class="cart-line__remove"
              :disabled="busyLineId === item.id"
              @click="remove(item)"
            >
              Remove
            </button>
          </div>
        </div>

        <div class="cart-line__price">${{ lineTotal(item) }}</div>
      </li>
    </ul>

    <div v-if="!cart.isEmpty" class="cart-drawer__promo">
      <label class="cart-drawer__promo-label" for="cart-promo">Promo code</label>
      <div class="cart-drawer__promo-row">
        <input
          id="cart-promo"
          v-model="promoInput"
          type="text"
          class="cart-drawer__promo-input"
          placeholder="Enter code"
          autocomplete="off"
          @keyup.enter="applyPromo"
        />
        <button
          type="button"
          class="cart-drawer__promo-apply"
          :disabled="promoChecking || !promoInput.trim()"
          @click="applyPromo"
        >
          {{ promoChecking ? 'Checking…' : 'Apply' }}
        </button>
      </div>
      <p v-if="promoError" class="cart-drawer__promo-error">{{ promoError }}</p>
      <p v-else-if="appliedPromo" class="cart-drawer__promo-ok">
        Code “{{ appliedPromo.promoName }}” applied — {{ discountPct }}% off.
      </p>
    </div>

    <template #footer>
      <div class="cart-drawer__footer">
        <div class="cart-drawer__totals">
          <div class="cart-drawer__total-row">
            <span>Subtotal</span>
            <span>${{ cart.subtotalNumber.toFixed(2) }}</span>
          </div>
          <div v-if="discountAmount > 0" class="cart-drawer__total-row cart-drawer__total-row--discount">
            <span>Discount</span>
            <span>−${{ discountAmount.toFixed(2) }}</span>
          </div>
          <div class="cart-drawer__total-row cart-drawer__total-row--grand">
            <span>Total</span>
            <span>${{ total.toFixed(2) }}</span>
          </div>
        </div>
        <button
          type="button"
          class="cart-drawer__checkout"
          :disabled="cart.isEmpty"
          @click="goToCheckout"
        >
          Proceed to Checkout
        </button>
      </div>
    </template>
  </SlideModal>
</template>

<style scoped>
.cart-drawer__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  padding: 48px 16px;
  color: var(--text-light);
}

.cart-drawer__empty-title {
  font-weight: 500;
  font-size: 1rem;
  color: var(--text);
  margin: 8px 0 0;
}

.cart-drawer__empty-copy {
  font-size: 0.9rem;
  margin: 0;
}

.cart-drawer__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.cart-line {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border-divider);
}

.cart-line__media {
  flex: 0 0 64px;
}

.cart-line__img {
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: var(--radius-md);
  background: var(--surface-pill);
}

.cart-line__img--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-light);
}

.cart-line__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cart-line__name {
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--text);
  margin: 0;
}

.cart-line__size {
  font-size: 0.8rem;
  color: var(--text-light);
  margin: 0;
}

.cart-line__controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 2px;
}

.cart-line__remove {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.8rem;
  color: var(--highlight);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.cart-line__remove:disabled {
  opacity: 0.5;
  cursor: default;
}

.cart-line__price {
  font-weight: 500;
  font-size: 0.95rem;
  color: var(--text);
  white-space: nowrap;
}

.cart-drawer__promo {
  padding: 18px 0 4px;
}

.cart-drawer__promo-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-light);
  margin-bottom: 6px;
}

.cart-drawer__promo-row {
  display: flex;
  gap: 8px;
}

.cart-drawer__promo-input {
  flex: 1;
  font-family: var(--font-body);
  font-size: 0.9rem;
  color: var(--text);
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  padding: 9px 12px;
}

.cart-drawer__promo-input:focus {
  outline: none;
  border-color: var(--primary);
}

.cart-drawer__promo-apply {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.85rem;
  color: var(--primary);
  background: var(--primary-light-3);
  border: 1px solid var(--primary-light-2);
  border-radius: var(--radius-md);
  padding: 9px 16px;
  cursor: pointer;
}

.cart-drawer__promo-apply:disabled {
  opacity: 0.6;
  cursor: default;
}

.cart-drawer__promo-error {
  font-size: 0.8rem;
  color: var(--highlight);
  margin: 8px 0 0;
}

.cart-drawer__promo-ok {
  font-size: 0.8rem;
  color: var(--success);
  margin: 8px 0 0;
}

.cart-drawer__footer {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

.cart-drawer__totals {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cart-drawer__total-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9rem;
  color: var(--text-light);
}

.cart-drawer__total-row--discount {
  color: var(--success);
}

.cart-drawer__total-row--grand {
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--text);
  padding-top: 6px;
  border-top: 1px solid var(--border-divider);
}

.cart-drawer__checkout {
  width: 100%;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.95rem;
  color: var(--white);
  background: var(--primary);
  border: none;
  border-radius: var(--radius-md);
  padding: 12px;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.cart-drawer__checkout:hover:not(:disabled) {
  filter: brightness(0.95);
}

.cart-drawer__checkout:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
