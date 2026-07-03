import { buildV2ApiUrl } from './config'
import { getAuthHeaders } from '../auth-session'
import {
  adaptShopCart,
  adaptShopCategories,
  adaptShopCheckoutOrder,
  adaptShopConfig,
  adaptShopPaymentIntent,
  adaptShopProductDetail,
  adaptShopProducts,
  adaptShopPromo
} from './adapters/shop'
import type {
  ApiShopCartResponse,
  ApiShopCategoriesResponse,
  ApiShopCheckoutResponse,
  ApiShopConfigResponse,
  ApiShopNotifyResponse,
  ApiShopPaymentIntentResponse,
  ApiShopProductDetailResponse,
  ApiShopProductsResponse,
  ApiShopPromoResponse
} from './contracts/shop'

// ── Domain models (camelCase) for the Shop storefront ────────────────────
// Co-located with the api entry point, mirroring the discoverEvents trio.

export interface ShopProduct {
  id: string
  guid?: string
  name: string
  /** As-given price string (precision preserved); null when absent. */
  price: string | null
  salePrice: string | null
  imageUrl?: string
  categoryId?: string
  categoryName?: string
  inStock: boolean
  /** Raw `avail_status` ("1" => out of stock). */
  status?: string
  hasSizes: boolean
}

export interface ShopProductSize {
  id: string
  label: string
  inStock: boolean
}

export interface ShopCartLineRef {
  id: string
  qty: number
  sizeId?: string
}

export interface ShopProductDetail {
  id: string
  guid?: string
  name: string
  price: string | null
  salePrice: string | null
  description?: string
  imageUrl?: string
  images: string[]
  categoryId?: string
  categoryName?: string
  parentCategoryName?: string
  inStock: boolean
  status?: string
  hasSizes: boolean
  sizes: ShopProductSize[]
  /** The current user's existing cart line for this product (if any). */
  cartLine?: ShopCartLineRef
}

export interface ShopProductsPage {
  products: ShopProduct[]
  nextCursor: string | null
}

export interface ShopCategory {
  id: string
  name: string
}

export interface ShopConfig {
  shippingCost: string | null
  taxPercentage: string | null
}

export interface ShopPromo {
  id: string
  promoName: string
  discountPercentage: string | null
  allowRecurringUsage: number
}

export interface ShopCartItemSize {
  id: string
  label: string
}

export interface ShopCartItem {
  id: string
  qty: number
  size?: ShopCartItemSize
  product: ShopProduct
}

export interface ShopCart {
  items: ShopCartItem[]
  itemCount: number
  subtotal: string
}

export interface ShopProductFilters {
  /** Root category id; omit / '' for All. */
  category?: string
  search?: string
  cursor?: string
  limit?: number
}

export interface AddToCartPayload {
  productId: string
  sizeId?: string
  /** Quantity DELTA by default (server adds to the existing line); pass
   *  `absolute: true` to set the line to exactly `qty`. */
  qty: number
  absolute?: boolean
}

/** Shipping/billing address captured at checkout (single address, like legacy). */
export interface CheckoutShipping {
  address: string
  city: string
  state: string
  zipCode: string
  phone: string
}

export interface CheckoutPayload {
  /** Stripe PaymentIntent id (also used as the order's invoice id). */
  paymentIntentId: string
  /** Stripe reference (charge/PI id); defaults to paymentIntentId server-side. */
  reference?: string
  /** Last 4 of the card, for display in order history. */
  cardNumber?: string
  /** Applied promo id (server recomputes the discount). */
  promoId?: string | null
  shipping: CheckoutShipping
  /** Payment outcome; 'PAID' creates the order + clears the cart. */
  status?: string
}

/** The confirmed order returned by checkout (server-computed totals). */
export interface ShopOrder {
  id: string
  invoiceId: string
  status: string
  paymentStatus: string
  subtotal: number
  taxAmount: number
  taxPercentage: number
  shippingAmount: number
  shippingPercentage: number
  discount: number
  grandTotal: number
  noOfProducts: number
  createdAt: string | null
}

export interface PaymentIntentResult {
  clientSecret: string | null
  customerId: string | null
}

function buildProductsQuery(filters: ShopProductFilters): string {
  const params = new URLSearchParams()
  if (filters.category) params.set('category', filters.category)
  if (filters.search) params.set('search', filters.search)
  if (filters.cursor) params.set('cursor', filters.cursor)
  if (filters.limit) params.set('limit', String(filters.limit))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

const jsonHeaders = () => ({
  ...getAuthHeaders(),
  Accept: 'application/json',
  'Content-Type': 'application/json'
})

/** Fetch a page of products (All / by-category / search). Public + auth-aware. */
export async function fetchShopProducts(
  filters: ShopProductFilters = {}
): Promise<ShopProductsPage> {
  const response = await fetch(buildV2ApiUrl(`/shop/products${buildProductsQuery(filters)}`), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiShopProductsResponse
  return adaptShopProducts(envelope)
}

/** Fetch the sidebar categories (root categories). Public. */
export async function fetchShopCategories(): Promise<ShopCategory[]> {
  const response = await fetch(buildV2ApiUrl('/shop/categories'), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiShopCategoriesResponse
  return adaptShopCategories(envelope)
}

/** Fetch product detail by id or guid. Public + auth-aware (cart line). */
export async function fetchShopProduct(idOrGuid: string): Promise<ShopProductDetail | null> {
  const response = await fetch(
    buildV2ApiUrl(`/shop/products/${encodeURIComponent(idOrGuid)}`),
    { headers: { ...getAuthHeaders(), Accept: 'application/json' } }
  )
  const envelope = (await response.json()) as ApiShopProductDetailResponse
  return adaptShopProductDetail(envelope)
}

/** Register the current user to be notified when a product is back in stock.
 *  Auth required. */
export async function notifyMe(idOrGuid: string): Promise<boolean> {
  const response = await fetch(
    buildV2ApiUrl(`/shop/products/${encodeURIComponent(idOrGuid)}/notify-me`),
    { method: 'POST', headers: jsonHeaders() }
  )
  const envelope = (await response.json()) as ApiShopNotifyResponse
  return !!envelope?.data?.notified
}

/** Fetch the shop configuration (shipping + tax). Public. */
export async function fetchShopConfig(): Promise<ShopConfig> {
  const response = await fetch(buildV2ApiUrl('/shop/config'), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiShopConfigResponse
  return adaptShopConfig(envelope)
}

/** Validate a promo code. Auth required. Returns null when invalid/used. */
export async function findPromoCode(promoName: string): Promise<ShopPromo | null> {
  const params = new URLSearchParams({ promoName })
  const response = await fetch(buildV2ApiUrl(`/shop/promo?${params.toString()}`), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiShopPromoResponse
  return adaptShopPromo(envelope)
}

/** Fetch the current user's cart. Auth required. */
export async function fetchCart(): Promise<ShopCart> {
  const response = await fetch(buildV2ApiUrl('/shop/cart'), {
    headers: { ...getAuthHeaders(), Accept: 'application/json' }
  })
  const envelope = (await response.json()) as ApiShopCartResponse
  return adaptShopCart(envelope)
}

/** Add / update / remove a cart line. Auth required. Returns the refreshed
 *  cart. By default `qty` is a delta; pass `absolute: true` to set exactly. */
export async function addToCart(payload: AddToCartPayload): Promise<ShopCart> {
  const response = await fetch(buildV2ApiUrl('/shop/cart'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload)
  })
  const envelope = (await response.json()) as ApiShopCartResponse
  return adaptShopCart(envelope)
}

/** Create a Stripe PaymentIntent for `amount` (major units, e.g. 71.50).
 *  Auth required. Returns the clientSecret to confirm with Stripe.js. */
export async function createShopPaymentIntent(
  amount: number,
  currency = 'usd'
): Promise<PaymentIntentResult> {
  const response = await fetch(buildV2ApiUrl('/shop/create-payment-intent'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ amount, currency })
  })
  if (!response.ok) {
    const env = (await response.json().catch(() => ({}))) as ApiShopPaymentIntentResponse
    throw new Error(env?.responseStatus?.message || 'Could not start the payment.')
  }
  const envelope = (await response.json()) as ApiShopPaymentIntentResponse
  return adaptShopPaymentIntent(envelope)
}

/** Place the order from the user's cart after Stripe confirms payment. Auth
 *  required. Mirrors the legacy `charge`: creates the order + clears the cart.
 *  Throws with the server message on failure. */
export async function checkoutShop(payload: CheckoutPayload): Promise<ShopOrder> {
  const response = await fetch(buildV2ApiUrl('/shop/checkout'), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ status: 'PAID', ...payload })
  })
  const envelope = (await response.json().catch(() => ({}))) as ApiShopCheckoutResponse
  if (!response.ok) {
    throw new Error(envelope?.responseStatus?.message || 'Could not place your order.')
  }
  const order = adaptShopCheckoutOrder(envelope)
  if (!order) throw new Error('Order confirmation was missing from the response.')
  return order
}
