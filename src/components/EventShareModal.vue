<script setup lang="ts">
// EventShareModal
// ----------------
// Shared "share event" popup. Surfaces the PUBLIC (unauthenticated)
// `/public/event/<slug>` URL with a copy-to-clipboard button.
// Hosted by every view that needs a Share affordance:
//   - `AssociationEventsView` — row-menu "Share" item.
//   - `MatchGeniHeader` — header Share button (standalone on
//     desktop, popover item on mobile).
//
// Opening pattern: parent passes `:event="{ guid, eventName }"` to
// open, then `null` (or omits) to close. The component emits
// `close` on backdrop click / × button so the parent flips its
// state back to `null`.

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import AppIcon from './AppIcon.vue'
import wifLogoUrl from '../assets/wif-icon-only.png'
import { buildPublicEventDetailUrl } from '../api/config'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

interface ShareEvent {
  guid: string
  eventName: string
  /** Public event slug — the human-readable identifier the public URL
   *  is keyed by (`/public/event/<slug>`). Optional; when absent we
   *  derive it from the event name so the shared link reads cleanly
   *  instead of exposing the raw GUID. */
  slug?: string
}

/** Turn an event name into a URL-safe slug: lowercase, non-alphanumerics
 *  → hyphens, collapsed + trimmed. e.g. "Southwest Championship!" →
 *  "southwest-championship". */
function slugifyEventName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const props = defineProps<{
  event: ShareEvent | null
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const shareCopyState = ref<'idle' | 'copied' | 'error'>('idle')

// Prefer an explicit slug; otherwise derive a readable one from the event
// name (never expose the raw GUID in the public link). Falls back to the
// guid only if there's no name to slugify.
const shareSlug = computed(() => {
  const e = props.event
  if (!e) return ''
  if (e.slug) return e.slug
  const fromName = slugifyEventName(e.eventName || '')
  return fromName || e.guid
})
const shareUrl = computed(() =>
  shareSlug.value ? buildPublicEventDetailUrl(shareSlug.value) : ''
)

// QR code — a scannable encoding of the public URL so someone nearby can
// point a phone camera at the screen and land on the event page. Rendered
// to a data-URL entirely client-side (no third-party call), regenerated
// whenever the URL changes.
const qrDataUrl = ref('')

// Cache the decoded logo so we only load it once.
let logoImg: HTMLImageElement | null = null
function loadLogo(): Promise<HTMLImageElement | null> {
  if (logoImg) return Promise.resolve(logoImg)
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => { logoImg = img; resolve(img) }
    img.onerror = () => resolve(null)
    img.src = wifLogoUrl
  })
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

async function regenerateQr() {
  if (!shareUrl.value) {
    qrDataUrl.value = ''
    return
  }
  try {
    // Always dark modules on a white plate — inverted (light-on-dark) QRs
    // aren't reliably scannable, so we keep the high-contrast code in both
    // themes. High error-correction so the centred logo doesn't break it.
    const moduleColor = '#0f172a'
    const bgColor = '#ffffff'
    const size = 320
    const canvas = document.createElement('canvas')
    await QRCode.toCanvas(canvas, shareUrl.value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'H',
      color: { dark: moduleColor, light: bgColor }
    })
    // Composite the WIF logo in the centre, on a rounded pad in the QR's
    // background colour. Preserve the logo's aspect ratio (it's not square)
    // so it doesn't stretch.
    const ctx = canvas.getContext('2d')
    const logo = await loadLogo()
    if (ctx && logo) {
      const w = canvas.width
      const maxLogo = Math.round(w * 0.2)
      const nw = logo.naturalWidth || maxLogo
      const nh = logo.naturalHeight || maxLogo
      const scale = Math.min(maxLogo / nw, maxLogo / nh)
      const dw = Math.round(nw * scale)
      const dh = Math.round(nh * scale)
      const pad = Math.round(maxLogo * 0.2)
      const boxW = dw + pad * 2
      const boxH = dh + pad * 2
      const bx = Math.round((w - boxW) / 2)
      const by = Math.round((w - boxH) / 2)
      ctx.fillStyle = bgColor
      roundRectPath(ctx, bx, by, boxW, boxH, Math.round(Math.min(boxW, boxH) * 0.24))
      ctx.fill()
      ctx.drawImage(logo, bx + pad, by + pad, dw, dh)
    }
    qrDataUrl.value = canvas.toDataURL('image/png')
  } catch {
    qrDataUrl.value = ''
  }
}

// Reset the copy chip whenever the event changes (re-opening for a
// different event shouldn't show a stale "Copied" label). Also
// toggle the body-scroll lock so the background page doesn't
// scroll under the modal — consumers don't have to wire this
// themselves. Regenerate the QR for the (new) URL.
watch(() => props.event, (next, prev) => {
  shareCopyState.value = 'idle'
  void regenerateQr()
  if (next && !prev) lockBodyScroll()
  else if (!next && prev) unlockBodyScroll()
})

// Safety net — if the parent unmounts the host while the modal
// is open (e.g. route change), make sure scroll lock releases.
onBeforeUnmount(() => {
  if (props.event) unlockBodyScroll()
})

function close() {
  emit('close')
}

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}

/** Legacy textarea + execCommand path — works in iframes and
 *  non-secure contexts where `navigator.clipboard` is either
 *  missing or rejects. Returns true on success. */
function copyViaTextareaFallback(text: string): boolean {
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    // Off-screen + readonly so it never steals focus from the
    // visible URL field and never blocks scroll.
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '0'
    textarea.style.left = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function copyShareUrl() {
  if (!shareUrl.value) return
  let success = false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(shareUrl.value)
      success = true
    } catch {
      success = false
    }
  }

  if (!success) {
    success = copyViaTextareaFallback(shareUrl.value)
  }

  if (success) {
    shareCopyState.value = 'copied'
    setTimeout(() => {
      if (shareCopyState.value === 'copied') shareCopyState.value = 'idle'
    }, 1800)
  } else {
    shareCopyState.value = 'error'
  }
}
</script>

<template>
  <Transition name="slide-modal-backdrop">
    <div
      v-if="event"
      class="association-switcher-backdrop"
      role="presentation"
      @click="onBackdrop"
    >
      <div
        class="association-switcher-panel association-confirm-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-share-title"
      >
        <header class="association-switcher-panel__header">
          <h2 id="event-share-title" class="association-switcher-panel__title">
            Share Event
          </h2>
          <button
            type="button"
            class="association-switcher-panel__close"
            aria-label="Close"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>
        <div class="association-confirm-panel__body">
          <p class="association-confirm-panel__copy">
            Anyone with this link can view
            <strong>{{ event.eventName }}</strong> on the public site —
            no Who I Follow account needed.
          </p>
          <!-- QR code — scan with a phone camera to open the public event
               page instantly. Encodes the same share URL below. -->
          <figure v-if="qrDataUrl" class="event-share-qr">
            <img :src="qrDataUrl" class="event-share-qr__img" alt="QR code linking to the public event page" />
            <figcaption class="event-share-qr__caption">Scan to open on your phone</figcaption>
          </figure>
          <div class="association-share-url">
            <input
              type="text"
              readonly
              class="association-share-url__field"
              :value="shareUrl"
              aria-label="Public share URL"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <button
              type="button"
              class="primary-button association-share-url__copy"
              :class="{
                'association-share-url__copy--copied': shareCopyState === 'copied',
                'association-share-url__copy--error': shareCopyState === 'error'
              }"
              @click="copyShareUrl"
            >
              {{
                shareCopyState === 'copied' ? 'Copied' :
                shareCopyState === 'error'  ? 'Press Ctrl+C' :
                'Copy'
              }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* `.association-share-url*` styles relocated from
   `AssociationEventsView.vue`'s scoped block when the share modal
   was extracted into this shared component. Class names kept as-is
   so the global `.association-switcher-panel` / `.association-
   confirm-panel` chrome composition stays unchanged — only the
   share-URL composite control's rules needed to move with the
   markup. */
/* QR code — centered card with the scannable code on a white plate
   (kept white in dark mode so scanners read the high-contrast modules). */
.event-share-qr {
  margin: 16px 0 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.event-share-qr__img {
  width: 220px;
  height: 220px;
  display: block;
  padding: 10px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid var(--border-divider);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
}
.event-share-qr__caption {
  font-size: 0.78rem;
  color: var(--secondary);
}

.association-share-url {
  display: flex;
  align-items: stretch;
  margin-top: 16px;
  width: 100%;
  height: 40px;
  border-radius: 6px;
  border: 1px solid var(--border-divider);
  background: var(--surface-muted, #f4f7fb);
  overflow: hidden;
  /* Focus-within lights the whole wrapper when the input is
     focused — keyboard users get the same affordance as the
     hover-on-button path. */
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.association-share-url:focus-within {
  border-color: var(--primary, #2d8cf0);
  box-shadow: 0 0 0 3px rgba(45, 140, 240, 0.18);
}
.association-share-url__field {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  padding: 0 12px;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 0.85rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  outline: none;
}
.association-share-url__copy {
  /* Override the shared .primary-button defaults so it tucks
     flush inside the wrapper: no background, no border, no
     rounded edges, no external box-shadow — just a tappable
     text column at the right edge of the composite control.
     The primary-tinted label is enough affordance. */
  flex: 0 0 auto;
  min-width: 72px;
  height: 100%;
  padding: 0 14px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--primary, #2d8cf0);
  font-weight: 600;
  box-shadow: none;
  cursor: pointer;
  transition: color 160ms ease;
}
.association-share-url__copy:hover {
  color: var(--primary-dark, #1d6fcc);
  background: transparent;
}
.association-share-url__copy--copied {
  /* Swap to success-green text while the affirmation is up. */
  color: var(--success, #2ea043);
}
.association-share-url__copy--copied:hover {
  color: var(--success, #2ea043);
}
.association-share-url__copy--error {
  color: var(--secondary);
}
</style>
