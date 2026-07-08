// Pinia store for the Shop cart.
//
// Holds the current user's cart (lines + count + subtotal) so the count badge
// in ShopView's header stays in sync as items are added/updated from the grid,
// the product detail, and the cart drawer. All mutations go through the v2
// endpoints in src/api/shop.ts (auth required); the cart is per-user (the
// backend has NO guest cart guid). Browsing the shop works anonymously — the
// store simply stays empty until an authenticated cart action succeeds.

import { defineStore } from 'pinia'
import { isAuthenticated } from '../auth-session'
import {
  addToCart as addToCartApi,
  fetchCart as fetchCartApi,
  type AddToCartPayload,
  type ShopCart,
  type ShopCartItem,
  type ShopOrder,
  type ShopPromo
} from '../api/shop'

interface ShopCartState {
  items: ShopCartItem[]
  itemCount: number
  subtotal: string
  loading: boolean
  loaded: boolean
  error: string | null
  /** Promo applied in the cart drawer; carried into checkout. */
  appliedPromo: ShopPromo | null
  /** The most recently placed order — shown on the confirmation page. */
  lastOrder: ShopOrder | null
}

export const useShopCartStore = defineStore('shopCart', {
  state: (): ShopCartState => ({
    items: [],
    itemCount: 0,
    subtotal: '0',
    loading: false,
    loaded: false,
    error: null,
    appliedPromo: null,
    lastOrder: null
  }),

  getters: {
    /** Numeric subtotal for arithmetic (totals, promo math). */
    subtotalNumber: (state): number => Number(state.subtotal) || 0,
    isEmpty: (state): boolean => state.items.length === 0,
    /** Number of distinct cart lines/products shown in cart badges. */
    distinctItemCount: (state): number => state.items.length,
    /** Total unit quantity across all cart lines. */
    totalQuantity: (state): number => state.items.reduce((sum, item) => sum + item.qty, 0),
    /** Applied promo discount as a fraction (0–1). */
    discountRate: (state): number =>
      state.appliedPromo ? (Number(state.appliedPromo.discountPercentage) || 0) / 100 : 0
  },

  actions: {
    apply(cart: ShopCart) {
      this.items = cart.items
      this.itemCount = cart.itemCount
      this.subtotal = cart.subtotal
      this.loaded = true
      this.error = null
    },

    /** Load the cart for the current user. No-op (cleared) when signed out. */
    async load() {
      if (!isAuthenticated.value) {
        this.items = []
        this.itemCount = 0
        this.subtotal = '0'
        this.loaded = true
        return
      }
      this.loading = true
      this.error = null
      try {
        this.apply(await fetchCartApi())
      } catch (e) {
        this.error = e instanceof Error ? e.message : 'Failed to load cart.'
      } finally {
        this.loading = false
      }
    },

    /** Add / update / remove a line. Returns true on success. */
    async add(payload: AddToCartPayload): Promise<boolean> {
      if (!isAuthenticated.value) {
        this.error = 'Please sign in to add items to your cart.'
        return false
      }
      this.error = null
      try {
        this.apply(await addToCartApi(payload))
        return true
      } catch (e) {
        this.error = e instanceof Error ? e.message : 'Failed to update cart.'
        return false
      }
    },

    /** Change a line's quantity by a delta (drawer +/- controls). */
    async changeQty(item: ShopCartItem, delta: number): Promise<boolean> {
      return this.add({
        productId: item.product.id,
        sizeId: item.size?.id,
        qty: delta
      })
    },

    /** Remove a line entirely (sets the line to qty 0 via an absolute set). */
    async remove(item: ShopCartItem): Promise<boolean> {
      return this.add({
        productId: item.product.id,
        sizeId: item.size?.id,
        qty: 0,
        absolute: true
      })
    },

    /** Set / clear the applied promo (shared by the drawer + checkout). */
    setPromo(promo: ShopPromo | null) {
      this.appliedPromo = promo
    },

    /** Record the placed order for the confirmation page. */
    setLastOrder(order: ShopOrder) {
      this.lastOrder = order
    },

    /** Reset the cart to empty (after a successful order; the server has
     *  already force-deleted the cart rows). */
    clear() {
      this.items = []
      this.itemCount = 0
      this.subtotal = '0'
      this.appliedPromo = null
      this.error = null
    }
  }
})
