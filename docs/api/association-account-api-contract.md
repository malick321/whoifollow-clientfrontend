# Association Account API Contract

The association's **self-service account** surface — the editable profile
(identity, contact, address, socials, branding images) behind Settings →
{shortName} Profile. This is the home for account-level concerns; it's written
to **extend later** with WIF subscription/billing and other SaaS account
endpoints (see §5 — Future).

Backed by the `associations` table (editable subset). Platform-managed columns —
`username` / `short_name` (identifiers), `status`, `stripe_connected`, audit
timestamps, computed `lat`/`long` — are **never** editable here; they require
platform-side review.

## Endpoints

| # | Method + path | Purpose |
|---|---|---|
| 1 | `GET /v2/association/profile/{associationId}` | Hydrate the Profile modal — the editable profile + current branding image URLs. |
| 2 | `POST /v2/association/profile/{associationId}` (`_method=PUT`) | Update the profile. **`multipart/form-data`** — text fields **plus the `logo` + `cover` binary image parts**. |

## Conventions

- **Permission gate**: `fullControl` (or an account-admin permission) on the caller's `association_users` row → else `403`. (Profile edits are an owner-level action, stricter than `manage_teams`.)
- **`{associationId}`** is the numeric association PK.
- **`username` / `short_name` are NOT editable here.** They're platform identifiers managed **only by the WIF admin through the WIF admin portal** (built separately). They're never accepted on this endpoint — ignored if present.
- **Update is `multipart/form-data`, not JSON** — it carries two binary image parts (`logo`, `cover`) alongside the text fields. It's sent as **`POST` with a `_method=PUT` form field** (Laravel method spoofing — PHP can't parse `multipart/form-data` on a real `PUT`, so the verb is `POST` while the route is logically `PUT`).
- **Images** come back on read as **CDN URLs** (`logoUrl` / `coverUrl`); on write they're **binary file parts** (`logo` / `cover`). Per-image three-way: send the part → **replace**; omit it → **keep**; send `removeLogo`/`removeCover = "1"` → **clear** (omission alone can't express "clear" in multipart). See §2.
- **Coordinates are client-submitted, not geocoded.** The street field is a Google Places autocomplete; picking a suggestion fills `city`/`state`/`zipCode` **and** captures `lat`/`long`, which the client sends. Editing the street text by hand clears `lat`/`long` (re-pick to set them). The backend stores what's sent — it does **not** re-geocode.
- IDs serialize as numeric strings; form fields cross the wire as strings.

## Underlying table

| Table | Purpose |
|---|---|
| `associations` | The association master record. Editable subset only — see [`sql-schema-association.md`](../system/sql-schema-association.md). |

---

## 1. Get Association Profile

- **Endpoint**: `GET /v2/association/profile/{associationId}`
- **Purpose**: Hydrate the Profile modal.
- **Table sources**: `associations` by id.

### Response

```jsonc
{
  "responseStatus": { "message": "OK", "statusCode": 200, "text": "OK" },
  "data": {
    "id": "12",
    "logoUrl": "https://cdn.whoifollow.tech/associations/12/logo.png",
    "coverUrl": "https://cdn.whoifollow.tech/associations/12/cover.jpg",
    "associationName": "Senior Softball USA",
    "websiteUrl": "https://ssusa.org",
    "email": "info@ssusa.org",
    "mobileCode": "+1",
    "mobileNumber": "7758821234",
    "fbUrl": "https://facebook.com/ssusa",
    "instaUrl": "https://instagram.com/ssusa",
    "streetAddress": "9823 Old Eagle School Rd",
    "city": "Sacramento",
    "state": "CA",
    "zipCode": "95826",
    "lat": "38.5491",
    "long": "-121.3897",
    "notes": "Founded 1988."
  }
}
```

### Field notes

- `logoUrl` / `coverUrl` are public CDN URLs (no signature); `""` when none uploaded — the UI renders a placeholder.
- `mobileCode` is the dial code (`"+1"`); `mobileNumber` is the raw national digits (no formatting) — pairs with the shared `PhoneInput`.
- `404` if the association doesn't exist or is soft-deleted.

---

## 2. Update Association Profile

- **Endpoint**: `POST /v2/association/profile/{associationId}`
- **Purpose**: Save the profile, including new branding images.
- **Content type**: **`multipart/form-data`** sent as **`POST` with `_method=PUT`** (method spoofing — PHP can't parse multipart on a real `PUT`). The text fields are sent in full on every save. JSON is not used because the body carries binary image parts.
- **Table sources**: UPDATE `associations`.

### Request body

> **This is `multipart/form-data`, NOT a JSON request.** The block below is written as key → value purely for readability — on the wire each entry is a separate form-data part. `logo` and `cover` are **binary file parts** (not strings), and the request is sent as **`POST` with a `_method=PUT` field**.

```jsonc
{
  "_method": "PUT",                       // method spoofing (see field notes)
  "associationName": "Senior Softball USA",
  "email": "info@ssusa.org",
  "mobileCode": "+1",
  "mobileNumber": "7758821234",
  "websiteUrl": "https://ssusa.org",
  "fbUrl": "https://facebook.com/ssusa",
  "instaUrl": "https://instagram.com/ssusa",
  "streetAddress": "9823 Old Eagle School Rd",
  "city": "Sacramento",
  "state": "CA",
  "zipCode": "95826",
  "lat": "38.5491",                       // from the Places pick
  "long": "-121.3897",
  "notes": "Founded 1988.",
  "logo": "«binary image file»",          // optional — present = REPLACE the logo
  "cover": "«binary image file»",         // optional — present = REPLACE the cover
  "removeLogo": "0",                      // "1" = CLEAR the existing logo
  "removeCover": "0"                      // "1" = CLEAR the existing cover
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `_method` | text | yes | `PUT` — Laravel method spoofing (the route is logically `PUT`; sent over `POST` because PHP can't parse multipart on `PUT`). |
| `associationName` | text | yes | Display name. Max 255. |
| `email` | text | yes | Contact email, validated. |
| `mobileCode` | text | no | Dial code, e.g. `+1`. |
| `mobileNumber` | text | no | Raw national digits (no formatting). |
| `websiteUrl` / `fbUrl` / `instaUrl` | text | no | URLs; validated when non-empty. |
| `streetAddress` | text | no | Street line (from the Places pick, or typed). |
| `city` / `state` / `zipCode` | text | no | Filled by the Places pick but freely editable; `state` is a free-text field (no enum). |
| `lat` / `long` | text | no | Coordinates **captured from the Places pick** and sent by the client. Empty when no address was picked; cleared when the street is typed by hand. The backend stores them verbatim (no geocoding). |
| `notes` | text | no | Free text. |
| `logo` | **file (binary)** | no | New logo image (cropped 1:1 client-side). **Present → replace.** Omit → keep current. |
| `cover` | **file (binary)** | no | New cover image (cropped 16:9 client-side). **Present → replace.** Omit → keep current. |
| `removeLogo` | text (`"0"`/`"1"`) | no | `"1"` → **clear** the existing logo (use when removing without uploading a replacement). |
| `removeCover` | text (`"0"`/`"1"`) | no | `"1"` → **clear** the existing cover. |

> **Per-image three-way** (each image independently): file part **present → replace**; **absent → keep**; `remove* = "1"` → **clear**. The explicit clear flag exists because, in multipart, an omitted part can't be told apart from "delete this image."

### Server-derived / forced (never in the body)

- `username` / `short_name`, `status`, `stripe_connected`, `created_at` / `updated_at`, `deleted_at` ← platform-managed (the `username`/`short_name` only via the **WIF admin portal**); ignored if present.
- `logo` / `cover` files are stored to the CDN; the response returns the resulting `logoUrl` / `coverUrl`.
- `lat` / `long` are **taken from the body** (client-submitted), not geocoded.

### Response

`200` with the saved profile (same shape as §1, with refreshed image URLs). `responseStatus.message`: **"Profile updated"**.

### Field notes

- `403` without `fullControl`; `404` for an unknown association; `422` on a missing required field (name/email) or an invalid email/URL.
- Image parts validated for type (`image/*`) + size server-side → `422` on violation.

---

## 3. `AssociationProfile` shape (reference)

Mirrors `AssociationProfile` in `src/types.ts`.

```ts
interface AssociationProfile {
  id: string                 // read-only (association PK)
  logoUrl: string            // CDN URL (read); uploaded as the `logo` file (write)
  coverUrl: string           // CDN URL (read); uploaded as the `cover` file (write)
  associationName: string
  websiteUrl: string
  email: string
  mobileCode: string         // dial code, e.g. "+1"
  mobileNumber: string       // raw national digits
  fbUrl: string
  instaUrl: string
  streetAddress: string
  city: string
  state: string
  zipCode: string
  lat: string                // from the Places pick (client-submitted), "" when none
  long: string
  notes: string
}
```

## 4. Frontend client (this repo)

- `fetchAssociationProfile(associationId)` / `saveAssociationProfile(profile)` in `src/api/associationProfile.ts` (mock-first).
- UI: `src/components/AssociationProfileModal.vue` — Settings → "{shortName} Profile". Phone uses the shared `PhoneInput`; the street field is a Google Places autocomplete (`searchPlacePredictions` + `fetchPlaceById`) that fills city / state (free-text) / zip **and captures `lat`/`long`** (cleared when the street is hand-edited); logo + cover are cropped via `ImageEditorModal` (1:1 / 16:9) and uploaded as the `logo` / `cover` binary parts.

## 5. Future (this contract will grow)

This doc is the anchor for the association's **account/SaaS** surface. Planned additions, documented here as they ship:

- **Subscription / billing with WIF** — the association's plan, seat/usage limits, invoices, and the WIF-side `platform_fee` settlement view (distinct from the per-charge [payables](./association-payables-api-contract.md)).
- **Stripe Connect account management** — connect / disconnect / onboarding-status (today a mock in Settings; see the Settings Stripe row).
- **Account lifecycle** — deactivation / transfer-of-ownership requests (platform-reviewed).
