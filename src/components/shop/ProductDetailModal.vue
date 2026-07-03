<script setup lang="ts">
// ProductDetailModal
// ------------------
// Slide-in detail panel for a single product: image gallery, price,
// description, size selector (when the product has sizes), quantity stepper,
// and an Add To Cart / Notify Me action. Loads the full ProductDetail by id
// or guid when opened. Add-to-cart goes through the shopCart store.

import { ref, watch, computed } from 'vue'
import SlideModal from '../SlideModal.vue'
import AppIcon from '../AppIcon.vue'
import NumberStepper from '../NumberStepper.vue'
import NotifyMeButton from './NotifyMeButton.vue'
import { fetchShopProduct, type ShopProductDetail } from '../../api/shop'
import { useShopCartStore } from '../../stores/shopCart'

const props = defineProps<{
  modelValue: boolean
  /** id or guid of the product to load. */
  productKey: string | null
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'requires-auth'): void
  (event: 'added'): void
}>()

const cart = useShopCartStore()

const loading = ref(false)
const product = ref<ShopProductDetail | null>(null)
const activeImage = ref<string | null>(null)
const selectedSizeId = ref<string | null>(null)
const qty = ref(1)
const adding = ref(false)
const sizeError = ref(false)

const price = computed(() => product.value?.salePrice || product.value?.price || null)

watch(
  () => [props.modelValue, props.productKey] as const,
  async ([open, key]) => {
    if (!open || !key) return
    loading.value = true
    product.value = null
    selectedSizeId.value = null
    qty.value = 1
    sizeError.value = false
    try {
      const detail = await fetchShopProduct(key)
      product.value = detail
      activeImage.value = detail?.imageUrl ?? detail?.images?.[0] ?? null
      if (detail?.cartLine?.sizeId) selectedSizeId.value = detail.cartLine.sizeId
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

async function add() {
  if (!product.value || adding.value) return
  if (product.value.hasSizes && !selectedSizeId.value) {
    sizeError.value = true
    return
  }
  adding.value = true
  try {
    const ok = await cart.add({
      productId: product.value.id,
      sizeId: selectedSizeId.value ?? undefined,
      qty: qty.value
    })
    if (ok) {
      emit('added')
      emit('update:modelValue', false)
    } else if (cart.error?.toLowerCase().includes('sign in')) {
      emit('requires-auth')
    }
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <SlideModal
    :model-value="modelValue"
    size="wide"
    :title="product?.name || 'Product'"
    :subtitle="product?.categoryName || ''"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="loading" class="product-detail__loading">Loading…</div>

    <div v-else-if="product" class="product-detail">
      <div class="product-detail__gallery">
        <div class="product-detail__hero">
          <span v-if="!product.inStock" class="product-detail__ribbon">OUT OF STOCK</span>
          <img v-if="activeImage" :src="activeImage" :alt="product.name" class="product-detail__hero-img" />
          <div v-else class="product-detail__hero-img product-detail__hero-img--placeholder">
            <AppIcon name="shop" :size="56" tone="two-tone" />
          </div>
        </div>
        <div v-if="product.images.length > 1" class="product-detail__thumbs">
          <button
            v-for="(img, i) in product.images"
            :key="i"
            type="button"
            class="product-detail__thumb"
            :class="{ 'product-detail__thumb--active': img === activeImage }"
            @click="activeImage = img"
          >
            <img :src="img" :alt="`${product.name} ${i + 1}`" />
          </button>
        </div>
      </div>

      <div class="product-detail__info">
        <p class="product-detail__price">
          <template v-if="product.salePrice">
            <span class="product-detail__price-sale">${{ product.salePrice }}</span>
            <span class="product-detail__price-was">${{ product.price }}</span>
          </template>
          <template v-else>${{ price ?? '—' }}</template>
        </p>

        <p v-if="product.description" class="product-detail__desc">{{ product.description }}</p>

        <div v-if="product.hasSizes && product.sizes.length" class="product-detail__sizes">
          <span class="product-detail__field-label">Size</span>
          <div class="product-detail__size-row">
            <button
              v-for="size in product.sizes"
              :key="size.id"
              type="button"
              class="product-detail__size"
              :class="{ 'product-detail__size--active': selectedSizeId === size.id }"
              :disabled="!size.inStock"
              @click="selectedSizeId = size.id; sizeError = false"
            >
              {{ size.label }}
            </button>
          </div>
          <p v-if="sizeError" class="product-detail__size-error">Please select a size.</p>
        </div>

        <div v-if="product.inStock" class="product-detail__qty">
          <span class="product-detail__field-label">Quantity</span>
          <NumberStepper v-model="qty" :min="1" :max="99" aria-label="Quantity" />
        </div>

        <div class="product-detail__action">
          <button
            v-if="product.inStock"
            type="button"
            class="product-detail__add"
            :disabled="adding"
            @click="add"
          >
            <AppIcon name="cart" :size="18" />
            <span>{{ adding ? 'Adding…' : 'Add To Cart' }}</span>
          </button>
          <NotifyMeButton
            v-else
            :product-id="product.id"
            block
            @requires-auth="emit('requires-auth')"
          />
        </div>
      </div>
    </div>

    <div v-else class="product-detail__loading">Product not found.</div>
  </SlideModal>
</template>

<style scoped>
.product-detail__loading {
  padding: 48px 16px;
  text-align: center;
  color: var(--text-light);
  font-size: 0.95rem;
}

.product-detail {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 28px;
}

@media (max-width: 720px) {
  .product-detail {
    grid-template-columns: 1fr;
  }
}

.product-detail__hero {
  position: relative;
  aspect-ratio: 1 / 1;
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.product-detail__hero-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.product-detail__hero-img--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-light);
}

.product-detail__ribbon {
  position: absolute;
  top: 14px;
  left: -36px;
  transform: rotate(-45deg);
  width: 150px;
  text-align: center;
  background: var(--highlight);
  color: var(--white);
  font-size: 0.66rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  padding: 5px 0;
  z-index: 1;
}

.product-detail__thumbs {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.product-detail__thumb {
  width: 56px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  overflow: hidden;
  cursor: pointer;
  background: var(--surface-pill);
}

.product-detail__thumb--active {
  border-color: var(--primary);
}

.product-detail__thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.product-detail__info {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.product-detail__price {
  margin: 0;
  font-weight: 500;
  font-size: 1.5rem;
  color: var(--primary);
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.product-detail__price-sale {
  color: var(--highlight);
}

.product-detail__price-was {
  color: var(--text-light);
  font-size: 1rem;
  text-decoration: line-through;
}

.product-detail__desc {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.6;
  color: var(--text-light);
}

.product-detail__field-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-light);
  margin-bottom: 8px;
}

.product-detail__size-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.product-detail__size {
  min-width: 46px;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.85rem;
  color: var(--text);
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-md);
  padding: 8px 14px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.product-detail__size:hover:not(:disabled) {
  border-color: var(--primary);
}

.product-detail__size--active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light-3);
}

.product-detail__size:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  text-decoration: line-through;
}

.product-detail__size-error {
  font-size: 0.8rem;
  color: var(--highlight);
  margin: 8px 0 0;
}

.product-detail__action {
  margin-top: 4px;
}

.product-detail__add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
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

.product-detail__add:hover:not(:disabled) {
  filter: brightness(0.95);
}

.product-detail__add:disabled {
  opacity: 0.7;
  cursor: default;
}
</style>
