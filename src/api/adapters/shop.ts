import type {
  ApiShopCartItem,
  ApiShopCartResponse,
  ApiShopCategoriesResponse,
  ApiShopCheckoutResponse,
  ApiShopConfigResponse,
  ApiShopPaymentIntentResponse,
  ApiShopProduct,
  ApiShopProductDetail,
  ApiShopProductDetailResponse,
  ApiShopProductsResponse,
  ApiShopPromoResponse
} from '../contracts/shop'
import type {
  PaymentIntentResult,
  ShopCart,
  ShopCartItem,
  ShopCategory,
  ShopConfig,
  ShopOrder,
  ShopProduct,
  ShopProductDetail,
  ShopProductsPage,
  ShopPromo
} from '../shop'

/** Prices arrive as string | number; keep precision by normalizing to a
 *  trimmed string (or null). No locale/currency formatting here — that is a
 *  view concern (the views prefix "$"). */
function normalizePrice(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value)
}

function adaptProductCard(raw: ApiShopProduct): ShopProduct {
  return {
    id: String(raw.id),
    guid: raw.guid ?? undefined,
    name: raw.name ?? '',
    price: normalizePrice(raw.price),
    salePrice: normalizePrice(raw.salePrice),
    imageUrl: raw.imageUrl ?? undefined,
    categoryId: raw.categoryId ?? undefined,
    categoryName: raw.categoryName ?? undefined,
    inStock: raw.inStock !== false,
    status: raw.status ?? undefined,
    hasSizes: !!raw.hasSizes
  }
}

export function adaptShopProducts(response: ApiShopProductsResponse): ShopProductsPage {
  const rows = response?.data?.products ?? []
  return {
    products: rows.map(adaptProductCard),
    nextCursor: response?.data?.nextCursor ?? null
  }
}

export function adaptShopCategories(response: ApiShopCategoriesResponse): ShopCategory[] {
  const rows = response?.data?.categories ?? []
  return rows.map((c) => ({
    id: String(c.id),
    name: c.name ?? ''
  }))
}

export function adaptShopProductDetail(
  response: ApiShopProductDetailResponse
): ShopProductDetail | null {
  const raw = response?.data?.product
  if (!raw) return null
  return adaptProductDetail(raw)
}

function adaptProductDetail(raw: ApiShopProductDetail): ShopProductDetail {
  return {
    id: String(raw.id),
    guid: raw.guid ?? undefined,
    name: raw.name ?? '',
    price: normalizePrice(raw.price),
    salePrice: normalizePrice(raw.salePrice),
    description: raw.description ?? undefined,
    imageUrl: raw.imageUrl ?? undefined,
    images: (raw.images ?? []).filter((u): u is string => !!u),
    categoryId: raw.categoryId ?? undefined,
    categoryName: raw.categoryName ?? undefined,
    parentCategoryName: raw.parentCategoryName ?? undefined,
    inStock: raw.inStock !== false,
    status: raw.status ?? undefined,
    hasSizes: !!raw.hasSizes,
    sizes: (raw.sizes ?? []).map((s) => ({
      id: String(s.id),
      label: s.label ?? '',
      inStock: s.inStock !== false
    })),
    cartLine: raw.cartLine
      ? {
          id: String(raw.cartLine.id),
          qty: raw.cartLine.qty ?? 0,
          sizeId: raw.cartLine.sizeId ?? undefined
        }
      : undefined
  }
}

export function adaptShopConfig(response: ApiShopConfigResponse): ShopConfig {
  const raw = response?.data?.config
  return {
    shippingCost: normalizePrice(raw?.shippingCost),
    taxPercentage: normalizePrice(raw?.taxPercentage)
  }
}

export function adaptShopPromo(response: ApiShopPromoResponse): ShopPromo | null {
  const raw = response?.data?.promo
  if (!raw) return null
  return {
    id: String(raw.id),
    promoName: raw.promoName ?? '',
    discountPercentage: normalizePrice(raw.discountPercentage),
    allowRecurringUsage: raw.allowRecurringUsage ?? 0
  }
}

function adaptCartItem(raw: ApiShopCartItem): ShopCartItem {
  return {
    id: String(raw.id),
    qty: raw.qty ?? 0,
    size: raw.size
      ? { id: String(raw.size.id), label: raw.size.label ?? '' }
      : undefined,
    product: adaptProductCard(raw.product)
  }
}

export function adaptShopCart(response: ApiShopCartResponse): ShopCart {
  const items = (response?.data?.items ?? []).map(adaptCartItem)
  return {
    items,
    itemCount: response?.data?.itemCount ?? items.reduce((n, i) => n + i.qty, 0),
    subtotal: normalizePrice(response?.data?.subtotal) ?? '0'
  }
}

export function adaptShopPaymentIntent(
  response: ApiShopPaymentIntentResponse
): PaymentIntentResult {
  return {
    clientSecret: response?.data?.clientSecret ?? null,
    customerId: response?.data?.customerId ?? null
  }
}

function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  return Number(value) || 0
}

export function adaptShopCheckoutOrder(response: ApiShopCheckoutResponse): ShopOrder | null {
  const raw = response?.data?.order
  if (!raw) return null
  return {
    id: String(raw.id),
    invoiceId: raw.invoiceId ?? '',
    status: raw.status ?? '',
    paymentStatus: raw.paymentStatus ?? '',
    subtotal: num(raw.subtotal),
    taxAmount: num(raw.taxAmount),
    taxPercentage: num(raw.taxPercentage),
    shippingAmount: num(raw.shippingAmount),
    shippingPercentage: num(raw.shippingPercentage),
    discount: num(raw.discount),
    grandTotal: num(raw.grandTotal),
    noOfProducts: raw.noOfProducts ?? 0,
    createdAt: raw.createdAt ?? null
  }
}
