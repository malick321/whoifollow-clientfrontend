<script setup lang="ts">
// ShopView
// --------
// The storefront. Left category rail + top search + responsive product grid
// (cards with image / name / price; OUT OF STOCK ribbon + Notify Me when not
// in stock, Add To Cart otherwise) + a cart affordance with a count badge.
// Browsing is public; cart / notify actions require auth (we surface the
// global login modal when a signed-out user tries them).
//
// Data: src/api/shop.ts → adapters → contracts (the discoverEvents trio
// pattern). Cart state lives in the shopCart Pinia store so the badge stays
// in sync with the drawer + detail modal.

import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import AppIcon from '../components/AppIcon.vue'
import ProductCard from '../components/shop/ProductCard.vue'
import CategorySidebar from '../components/shop/CategorySidebar.vue'
import CartDrawer from '../components/shop/CartDrawer.vue'
import ProductDetailModal from '../components/shop/ProductDetailModal.vue'
import { useShopCartStore } from '../stores/shopCart'
import { isAuthenticated } from '../auth-session'
import { openLoginModal } from '../login-modal-center'
import {
  fetchShopCategories,
  fetchShopProducts,
  type ShopCategory,
  type ShopProduct
} from '../api/shop'

const cart = useShopCartStore()

const categories = ref<ShopCategory[]>([])
const categoriesLoading = ref(false)
const selectedCategory = ref('')

const products = ref<ShopProduct[]>([])
const nextCursor = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const searchInput = ref('')
const addingId = ref<string | null>(null)

const cartOpen = ref(false)
const detailOpen = ref(false)
const detailKey = ref<string | null>(null)

let searchTimer: ReturnType<typeof setTimeout> | null = null

// Infinite scroll — auto-load the next page when the sentinel nears the viewport.
const loadSentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function setupObserver() {
  observer?.disconnect()
  if (!loadSentinel.value) return
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && nextCursor.value && !loadingMore.value && !loading.value) {
        void loadProducts(false)
      }
    },
    { rootMargin: '600px 0px' }
  )
  observer.observe(loadSentinel.value)
}

async function loadCategories() {
  categoriesLoading.value = true
  try {
    categories.value = await fetchShopCategories()
  } finally {
    categoriesLoading.value = false
  }
}

async function loadProducts(reset = true) {
  if (reset) {
    loading.value = true
    nextCursor.value = null
  } else {
    loadingMore.value = true
  }
  try {
    const page = await fetchShopProducts({
      category: selectedCategory.value || undefined,
      search: searchInput.value.trim() || undefined,
      cursor: reset ? undefined : nextCursor.value || undefined,
      limit: 20
    })
    products.value = reset ? page.products : [...products.value, ...page.products]
    nextCursor.value = page.nextCursor
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

watch(selectedCategory, () => loadProducts(true))

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadProducts(true), 300)
}

function requireAuth(): boolean {
  if (isAuthenticated.value) return true
  openLoginModal()
  return false
}

async function onAdd(product: ShopProduct) {
  // Sized products must be configured in the detail panel.
  if (product.hasSizes) {
    openDetail(product)
    return
  }
  if (!requireAuth()) return
  addingId.value = product.id
  try {
    const ok = await cart.add({ productId: product.id, qty: 1 })
    if (ok) cartOpen.value = true
    else if (cart.error?.toLowerCase().includes('sign in')) openLoginModal()
  } finally {
    addingId.value = null
  }
}

function openDetail(product: ShopProduct) {
  detailKey.value = product.guid || product.id
  detailOpen.value = true
}

function onRequiresAuth() {
  openLoginModal()
}

onMounted(async () => {
  await Promise.all([loadCategories(), loadProducts(true)])
  if (isAuthenticated.value) cart.load()
  await nextTick()
  setupObserver()
})

onBeforeUnmount(() => observer?.disconnect())

// Re-attach the observer whenever the sentinel is (re)added after a page load
// or a filter reset.
watch(nextCursor, async () => {
  await nextTick()
  setupObserver()
})
</script>

<template>
  <main class="shop-view">
    <section class="shop-hero">
      <div class="shop-hero__glow" aria-hidden="true"></div>
      <div class="shop-hero__top">
        <div class="shop-hero__copy">
          <span class="shop-hero__eyebrow">WhoIFollow Shop</span>
          <h1 class="shop-hero__title">Gear up. Represent your game.</h1>
          <p class="shop-hero__tagline">Official apparel &amp; accessories, shipped to your door.</p>
        </div>
        <button type="button" class="shop-hero__cart-btn" @click="cartOpen = true">
          <AppIcon name="cart" :size="20" />
          <span class="shop-hero__cart-label">Cart</span>
          <span v-if="cart.distinctItemCount > 0" class="shop-hero__cart-badge">{{ cart.distinctItemCount }}</span>
        </button>
      </div>
      <div class="shop-hero__search">
        <AppIcon name="search" :size="18" />
        <input
          v-model="searchInput"
          type="search"
          class="shop-hero__search-input"
          placeholder="Search products…"
          autocomplete="off"
          @input="onSearchInput"
        />
      </div>
    </section>

    <div class="shop-view__body">
      <aside class="shop-view__sidebar">
        <CategorySidebar
          v-model="selectedCategory"
          :categories="categories"
          :loading="categoriesLoading"
        />
      </aside>

      <section class="shop-view__grid-wrap">
        <div v-if="loading" class="shop-view__grid">
          <div v-for="n in 8" :key="n" class="shop-view__skeleton" />
        </div>

        <div v-else-if="products.length === 0" class="shop-view__empty">
          <AppIcon name="shop" :size="52" tone="two-tone" />
          <p class="shop-view__empty-title">No products found</p>
          <p class="shop-view__empty-copy">
            There are no products to display in this category.
          </p>
        </div>

        <template v-else>
          <div class="shop-view__grid">
            <ProductCard
              v-for="product in products"
              :key="product.id"
              :product="product"
              :adding="addingId === product.id"
              @open="openDetail"
              @add="onAdd"
              @requires-auth="onRequiresAuth"
            />
          </div>

          <div v-if="nextCursor" ref="loadSentinel" class="shop-view__more">
            <span v-if="loadingMore" class="shop-view__more-loading">Loading…</span>
          </div>
        </template>
      </section>
    </div>

    <CartDrawer v-model="cartOpen" />
    <ProductDetailModal
      v-model="detailOpen"
      :product-key="detailKey"
      @requires-auth="onRequiresAuth"
      @added="cartOpen = true"
    />
  </main>
</template>

<style scoped>
.shop-view {
  max-width: 1240px;
  margin: 0 auto;
  padding: 24px 20px 48px;
  font-family: var(--font-body);
}

/* ── Hero band ──────────────────────────────────────────────────── */
.shop-hero {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-xl, 20px);
  padding: 30px 28px 26px;
  margin-bottom: 26px;
  background: var(--surface-card);
  color: var(--text);
  border: 1px solid var(--border-divider);
  box-shadow: var(--shadow-soft);
}
.shop-hero__glow {
  display: none;
}
.shop-hero__top {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.shop-hero__eyebrow {
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.85;
}
.shop-hero__title {
  margin: 6px 0 0;
  font-size: 1.7rem;
  font-weight: 600;
  line-height: 1.15;
}
.shop-hero__tagline {
  margin: 6px 0 0;
  font-size: 0.95rem;
  opacity: 0.9;
}
.shop-hero__cart-btn {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--secondary);
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
  border-radius: 999px;
  padding: 10px 18px;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.shop-hero__cart-btn:hover {
  background: var(--surface-raised);
}
.shop-hero__cart-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 600;
  color: #fff;
  background: var(--primary);
  border-radius: 999px;
  box-shadow: var(--shadow-soft);
}
.shop-hero__search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 22px;
  background: var(--surface-card);
  border-radius: var(--radius-lg);
  padding: 0 14px;
  color: var(--text-light);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.16);
}
.shop-hero__search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-family: var(--font-body);
  font-size: 0.95rem;
  color: var(--text);
  padding: 13px 0;
}
.shop-hero__search-input:focus {
  outline: none;
}
@media (max-width: 600px) {
  .shop-hero__top {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  .shop-hero__cart-btn {
    align-self: flex-end;
  }
  .shop-hero__title {
    font-size: 1.42rem;
  }
}

.shop-view__body {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

@media (max-width: 860px) {
  .shop-view__body {
    grid-template-columns: 1fr;
  }

  .shop-view__grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}

.shop-view__sidebar {
  position: sticky;
  top: 16px;
}

@media (max-width: 860px) {
  .shop-view__sidebar {
    position: static;
  }
}

.shop-view__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 18px;
}

.shop-view__skeleton {
  aspect-ratio: 3 / 4;
  background: var(--surface-pill);
  border: 1px solid var(--border-divider);
  border-radius: var(--radius-lg);
  animation: shop-pulse 1.4s ease-in-out infinite;
}

@keyframes shop-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.shop-view__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  padding: 64px 16px;
  color: var(--text-light);
}

.shop-view__empty-title {
  font-weight: 500;
  font-size: 1.05rem;
  color: var(--text);
  margin: 10px 0 0;
}

.shop-view__empty-copy {
  font-size: 0.9rem;
  margin: 0;
}

.shop-view__more {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 44px;
  margin-top: 28px;
}
.shop-view__more-loading {
  color: var(--text-light);
  font-size: 0.86rem;
}

.shop-view__more-btn {
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--primary);
  background: var(--surface-card);
  border: 1px solid var(--primary-light-2);
  border-radius: var(--radius-md);
  padding: 11px 28px;
  cursor: pointer;
}

.shop-view__more-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

@media (max-width: 720px) {
  .shop-view {
    padding: 12px 10px calc(36px + var(--member-bottom-nav-height, 64px));
  }

  .shop-hero {
    padding: 14px;
    margin-bottom: 12px;
    border-radius: 10px;
  }

  .shop-hero__top {
    align-items: flex-start;
    flex-direction: row;
  }

  .shop-hero__copy {
    min-width: 0;
  }

  .shop-hero__eyebrow {
    font-size: 0.66rem;
  }

  .shop-hero__title {
    font-size: 1.08rem;
  }

  .shop-hero__tagline {
    font-size: 0.78rem;
  }

  .shop-hero__cart-btn {
    min-height: 34px;
    padding: 0 11px;
    font-size: 0.8rem;
  }

  .shop-hero__search {
    margin-top: 12px;
    border-radius: 8px;
    box-shadow: none;
  }

  .shop-hero__search-input {
    padding: 10px 0;
    font-size: 0.82rem;
  }

  .shop-view__body {
    gap: 10px;
  }

  .shop-view__grid {
    gap: 10px;
  }
}

@media (max-width: 360px) {
  .shop-view__grid {
    gap: 8px;
  }
}
</style>
