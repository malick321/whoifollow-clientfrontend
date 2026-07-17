<script setup lang="ts">
// ProductCard
// -----------
// One product in the storefront grid: image, name, price, and either an
// "Add To Cart" action (in stock) or an OUT OF STOCK ribbon + NotifyMeButton.
// Clicking the card body opens the product detail (parent handles routing /
// modal via the `open` event). Add-to-cart is delegated to the parent so the
// cart store + sign-in prompt live in one place.

import AppIcon from '../AppIcon.vue'
import NotifyMeButton from './NotifyMeButton.vue'
import type { ShopProduct } from '../../api/shop'

defineProps<{
  product: ShopProduct
  /** True while this card's add-to-cart request is in flight. */
  adding?: boolean
}>()

const emit = defineEmits<{
  (event: 'open', product: ShopProduct): void
  (event: 'add', product: ShopProduct): void
  (event: 'requires-auth'): void
}>()
</script>

<template>
  <article class="product-card" @click="emit('open', product)">
    <div class="product-card__media">
      <span v-if="!product.inStock" class="product-card__ribbon">OUT OF STOCK</span>
      <img
        v-if="product.imageUrl"
        :src="product.imageUrl"
        :alt="product.name"
        class="product-card__img"
        loading="lazy"
      />
      <div v-else class="product-card__img product-card__img--placeholder">
        <AppIcon name="shop" :size="40" tone="two-tone" />
      </div>
    </div>

    <div class="product-card__body">
      <h3 class="product-card__name" :title="product.name">{{ product.name }}</h3>
      <p class="product-card__price">
        <template v-if="product.salePrice">
          <span class="product-card__price-sale">${{ product.salePrice }}</span>
          <span class="product-card__price-was">${{ product.price }}</span>
        </template>
        <template v-else>
          <span>${{ product.price ?? '—' }}</span>
        </template>
      </p>

      <div class="product-card__action">
        <button
          v-if="product.inStock"
          type="button"
          class="product-card__cart-btn"
          :disabled="adding"
          @click.stop="emit('add', product)"
        >
          <AppIcon name="cart" :size="16" />
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
  </article>
</template>

<style scoped>
.product-card {
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-soft);
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.product-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow);
  border-color: var(--primary-light);
}

.product-card__media {
  position: relative;
  aspect-ratio: 1 / 1;
  background: var(--surface-pill);
}

.product-card__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.product-card__img--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-light);
}

.product-card__ribbon {
  position: absolute;
  top: 12px;
  left: -34px;
  transform: rotate(-45deg);
  width: 140px;
  text-align: center;
  background: var(--highlight);
  color: var(--white);
  font-size: 0.62rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  padding: 4px 0;
  z-index: 1;
  box-shadow: var(--shadow-soft);
}

.product-card__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  flex: 1;
}

.product-card__name {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.95rem;
  color: var(--text);
  margin: 0;
  line-height: 1.3;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.product-card__price {
  margin: 0;
  font-weight: 500;
  font-size: 1.05rem;
  color: var(--primary);
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.product-card__price-sale {
  color: var(--highlight);
}

.product-card__price-was {
  color: var(--text-light);
  font-size: 0.85rem;
  text-decoration: line-through;
}

.product-card__action {
  margin-top: auto;
}

.product-card__cart-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.85rem;
  color: var(--white);
  background: var(--primary);
  border: 1px solid var(--primary);
  border-radius: var(--radius-md);
  padding: 9px 14px;
  cursor: pointer;
  transition: filter 0.15s ease;
}

.product-card__cart-btn:hover:not(:disabled) {
  filter: brightness(0.95);
}

.product-card__cart-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

@media (max-width: 520px) {
  .product-card:hover {
    transform: none;
  }

  .product-card {
    border-radius: 10px;
  }

  .product-card__media {
    aspect-ratio: auto;
    height: 112px;
    display: grid;
    place-items: center;
    overflow: hidden;
  }

  .product-card__img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    padding: 6px;
  }

  .product-card__img--placeholder {
    padding: 0;
  }

  .product-card__body {
    gap: 6px;
    padding: 10px;
  }

  .product-card__name {
    font-size: 0.8rem;
    line-height: 1.25;
  }

  .product-card__price {
    font-size: 0.86rem;
  }

  .product-card__cart-btn {
    min-height: 32px;
    padding: 7px 8px;
    font-size: 0.74rem;
  }
}

@media (max-width: 360px) {
  .product-card__media {
    height: 96px;
  }

  .product-card__cart-btn {
    gap: 4px;
  }
}
</style>
