# Shop API Contract (`/v2/shop`)

Optimised storefront, translating the legacy `Api\ShopController`
(`shop/`, `shop/products`, `shop/viewProduct`, `shop/notifyMe`,
`shop/findPromoCode`, `shop/fetchShopConfiguration`, `shop/addToCart`,
`shop/userCart`). Backend: `App\Http\Controllers\Api\V2\ShopController`.

All responses use the standard envelope `{ responseStatus, data }`. IDs are
strings on the wire. Prices are passed AS-GIVEN (string|number) to preserve
precision. Image URLs are fully-resolved, opaque CDN/S3 URLs — never parse or
concatenate them.

## Conventions

- **Stock**: a product is OUT OF STOCK when its raw `avail_status == 1`
  (mirrors legacy `avail_status == '1'`). `inStock` reflects this; `status`
  carries the raw value.
- **Categories**: the sidebar lists ROOT categories (`parent_id = 0`).
  Products attach to CHILD categories; filtering by a root id matches all of
  its children (legacy semantics).
- **Auth**: browse endpoints (products / categories / detail / config) are
  PUBLIC and auth-aware (the detail's `cartLine` resolves when a bearer token
  is present). Cart + notify + promo require auth. The cart is strictly
  per-`user_id` — there is NO guest cart guid in the schema, so there is no
  guest cart to merge (the legacy `updateGuid` regenerates PRODUCT guids, not
  cart guids).

## Endpoints

### `GET /v2/shop/products?category=&search=&cursor=&limit=` — public

`category` = root category id (omit for All). Cursor pagination by descending
id. Returns `{ products: Product[], nextCursor: string|null }`.

`Product`: `{ id, guid, name, price, salePrice, imageUrl, categoryId,
categoryName, inStock, status, hasSizes }`.

### `GET /v2/shop/categories` — public

`{ categories: [{ id, name }] }` (root categories, alpha-sorted).

### `GET /v2/shop/products/{id}` — public, auth-aware

`{id}` accepts a numeric id OR the product guid. Returns
`{ product: ProductDetail }`:
`{ id, guid, name, price, salePrice, description, imageUrl, images[],
categoryId, categoryName, parentCategoryName, inStock, status, hasSizes,
sizes: [{ id, label, inStock }], cartLine: { id, qty, sizeId } | null }`.

`images` includes the main image first, then gallery images.

### `POST /v2/shop/products/{id}/notify-me` — auth

Registers the user on the product's `to_notify` list (idempotent).
`{ notified: true }`.

### `GET /v2/shop/config` — public

`{ config: { shippingCost, taxPercentage } }`.

### `GET /v2/shop/promo?promoName=` — auth

Validates an active promo. 404 when invalid, 409 when single-use already used.
`{ promo: { id, promoName, discountPercentage, allowRecurringUsage } }`.

### `GET /v2/shop/cart` — auth

`{ items: CartItem[], itemCount, subtotal }`.
`CartItem`: `{ id, qty, size: { id, label } | null, product: Product }`.

### `POST /v2/shop/cart` — auth

Body: `{ productId, sizeId?, qty, absolute? }`. `qty` is a DELTA by default
(server adds to the existing line, matching legacy); pass `absolute: true` to
set exactly (qty 0 + absolute removes the line). Sized products require
`sizeId`. Out-of-stock products are rejected (409) and any existing line is
removed. Returns the refreshed cart payload.
