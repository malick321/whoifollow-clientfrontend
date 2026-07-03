// Wire (API) types for the Shop storefront (`/v2/shop/*`).
// Mirrors docs/api/shop-api-contract.md. These describe the RAW response
// shape; the adapter maps them to the camelCase domain models in ../shop.
//
// Prices are kept AS-GIVEN on the wire (string | number) to preserve the
// server's precision — the adapter normalizes to string for display.

export interface ApiShopProduct {
  id: string
  guid: string | null
  name: string | null
  price: string | number | null
  salePrice: string | number | null
  imageUrl: string | null
  categoryId: string | null
  categoryName: string | null
  inStock: boolean | null
  status: string | null
  hasSizes: boolean | null
}

export interface ApiShopProductSize {
  id: string
  label: string | null
  inStock: boolean | null
}

export interface ApiShopCartLine {
  id: string
  qty: number | null
  sizeId: string | null
}

export interface ApiShopProductDetail {
  id: string
  guid: string | null
  name: string | null
  price: string | number | null
  salePrice: string | number | null
  description: string | null
  imageUrl: string | null
  images: string[] | null
  categoryId: string | null
  categoryName: string | null
  parentCategoryName: string | null
  inStock: boolean | null
  status: string | null
  hasSizes: boolean | null
  sizes: ApiShopProductSize[] | null
  cartLine: ApiShopCartLine | null
}

export interface ApiShopCategory {
  id: string
  name: string | null
}

export interface ApiShopConfig {
  shippingCost: string | number | null
  taxPercentage: string | number | null
}

export interface ApiShopPromo {
  id: string
  promoName: string | null
  discountPercentage: string | number | null
  allowRecurringUsage: number | null
}

export interface ApiShopCartSize {
  id: string
  label: string | null
}

export interface ApiShopCartItem {
  id: string
  qty: number | null
  size: ApiShopCartSize | null
  product: ApiShopProduct
}

// ── Envelope responses ───────────────────────────────────────────────────

interface ApiResponseStatus {
  message?: string
  statusCode?: number
  text?: string
}

export interface ApiShopProductsResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    products?: ApiShopProduct[] | null
    nextCursor?: string | null
  } | null
}

export interface ApiShopCategoriesResponse {
  responseStatus?: ApiResponseStatus
  data?: { categories?: ApiShopCategory[] | null } | null
}

export interface ApiShopProductDetailResponse {
  responseStatus?: ApiResponseStatus
  data?: { product?: ApiShopProductDetail | null } | null
}

export interface ApiShopConfigResponse {
  responseStatus?: ApiResponseStatus
  data?: { config?: ApiShopConfig | null } | null
}

export interface ApiShopPromoResponse {
  responseStatus?: ApiResponseStatus
  data?: { promo?: ApiShopPromo | null } | null
}

export interface ApiShopCartResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    items?: ApiShopCartItem[] | null
    itemCount?: number | null
    subtotal?: string | number | null
  } | null
}

export interface ApiShopNotifyResponse {
  responseStatus?: ApiResponseStatus
  data?: { notified?: boolean } | null
}

export interface ApiShopPaymentIntentResponse {
  responseStatus?: ApiResponseStatus
  data?: {
    clientSecret?: string | null
    customerId?: string | null
  } | null
}

export interface ApiShopOrder {
  id: string
  invoiceId: string | null
  status: string | null
  paymentStatus: string | null
  subtotal: string | number | null
  taxAmount: string | number | null
  taxPercentage: string | number | null
  shippingAmount: string | number | null
  shippingPercentage: string | number | null
  discount: string | number | null
  grandTotal: string | number | null
  noOfProducts: number | null
  createdAt: string | null
}

export interface ApiShopCheckoutResponse {
  responseStatus?: ApiResponseStatus
  data?: { order?: ApiShopOrder | null } | null
}
