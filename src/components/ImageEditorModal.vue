<script setup lang="ts">
// ImageEditorModal
// ----------------
// Center-screen image picker + lightweight crop tool. Used by the
// Association Profile editor to swap the cover photo (rectangular)
// or the logo / avatar (circular) without a full file-upload
// pipeline — for v1 the saved value is a data URL that the host
// component drops into its form state.
//
// Flow:
//   1. Drop zone OR file picker accepts an image (JPEG / PNG / WEBP).
//   2. Image renders inside a frame matching the target shape:
//        - mode = 'avatar' → 1:1 circular preview
//        - mode = 'cover'  → 4:1 rectangular preview
//      Image is fit-cover by default and the user can drag it to
//      reposition. A zoom slider scales the image up to 3× so
//      they can pull a tight crop from a larger source.
//   3. Save renders the visible crop region to a canvas and emits
//      the resulting data URL.

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { lockBodyScroll, unlockBodyScroll } from '../body-scroll-lock'

const props = withDefaults(defineProps<{
  modelValue: boolean
  /** `avatar` = 1:1 circle, `cover` = 4:1 rectangle. Determines
   *  the crop frame's aspect + visual mask. */
  mode?: 'avatar' | 'cover'
  /** Title shown in the modal header. */
  title?: string
  /** Existing image URL — when present the editor opens straight
   *  in the crop view (skipping the drop zone) so the admin can
   *  re-crop the current image. */
  initialUrl?: string
  /** Optional crop-aspect choices (cover mode only). When more than one
   *  is given, a toggle is shown so the admin can pick the frame aspect
   *  (e.g. 16:9 vs 1:1). Omitted → fixed behaviour (cover = 16:9). */
  aspectOptions?: Array<'16:9' | '1:1'>
}>(), {
  mode: 'avatar',
  title: 'Edit image',
  initialUrl: '',
  aspectOptions: () => []
})

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'save', dataUrl: string): void
  /** Emitted when the admin clears the image via "Remove image" — the host
   *  should drop its stored image. */
  (event: 'remove'): void
}>()

// ---- Reactive state ------------------------------------------

const imageUrl = ref('')              // data URL or http URL of the picked image
const imageEl = ref<HTMLImageElement | null>(null)
const naturalWidth = ref(0)
const naturalHeight = ref(0)

// Frame measurements — read after mount so transform math is
// pixel-accurate. The frame's aspect is fixed by mode but its
// rendered size depends on the modal width.
const frameRef = ref<HTMLElement | null>(null)
const frameWidth = ref(0)
const frameHeight = ref(0)

// Pan + zoom state — user can drag the image around within the
// frame and bump the zoom slider 1×–3×. Translation is in CSS
// pixels relative to the frame's top-left origin; the image
// itself is positioned so its top-left lands at (translateX,
// translateY) and rendered at `scale`× its natural size.
const scale = ref(1)
// The cover-fit scale (zoom = 1×). Actual `scale` = baseScale × zoom, so the
// zoom slider is a multiplier (1–3) and zooming back out returns to the fit.
const baseScale = ref(1)
const translateX = ref(0)
const translateY = ref(0)
const dragging = ref(false)
const dragStart = ref({ x: 0, y: 0, tx: 0, ty: 0 })

const isCircle = computed(() => props.mode === 'avatar')

// Cover-mode aspect (16:9 / 1:1). Only user-selectable when >1 option given.
const currentAspect = ref<'16:9' | '1:1'>('16:9')
const hasAspectToggle = computed(() => !isCircle.value && props.aspectOptions.length > 1)
const frameStyle = computed(() => {
  const s: Record<string, string> = {}
  if (isCircle.value) return s
  // Cover frame is 16:9 by default (matches the display containers). The 1:1
  // square only applies when the aspect toggle is shown AND 1:1 is selected.
  if (hasAspectToggle.value && currentAspect.value === '1:1') {
    s.aspectRatio = '1 / 1'
    s.maxWidth = '360px'
    s.alignSelf = 'center'
  } else {
    s.aspectRatio = '16 / 9'
  }
  return s
})
// Slider position: 1 at the fit scale, up to 3× zoomed in.
const zoomValue = computed(() => (baseScale.value ? scale.value / baseScale.value : 1))

// ---- Lifecycle ------------------------------------------------

watch(
  () => props.modelValue,
  (open, wasOpen) => {
    if (open && !wasOpen) {
      lockBodyScroll()
      // Reset zoom/aspect for a clean open.
      baseScale.value = 1
      scale.value = 1
      currentAspect.value = props.aspectOptions[0] ?? '16:9'
      // Hydrate from initialUrl when re-opening on an image the
      // host already has. Empty string takes us straight to the
      // drop zone.
      imageUrl.value = props.initialUrl || ''
      void nextTick(measureFrame)
    } else if (!open && wasOpen) {
      unlockBodyScroll()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (props.modelValue) unlockBodyScroll()
})

// ---- File picker ---------------------------------------------

function readFile(file: File) {
  if (!file.type.startsWith('image/')) return
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      imageUrl.value = reader.result
    }
  }
  reader.readAsDataURL(file)
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) readFile(file)
  // Reset so picking the same file again still fires `change`.
  input.value = ''
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) readFile(file)
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
}

// ---- Image loaded → fit cover into frame ---------------------

/** Once the image's natural size is known, fit it into the frame
 *  with `cover` semantics: scale so the smaller dimension fills
 *  the frame, then center via translate. */
function onImageLoad() {
  const img = imageEl.value
  if (!img) return
  naturalWidth.value = img.naturalWidth
  naturalHeight.value = img.naturalHeight
  measureFrame()
  fitCover()
}

function measureFrame() {
  const el = frameRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  frameWidth.value = rect.width
  frameHeight.value = rect.height
}

function fitCover() {
  if (!naturalWidth.value || !naturalHeight.value) return
  if (!frameWidth.value || !frameHeight.value) return
  const frameRatio = frameWidth.value / frameHeight.value
  const imgRatio = naturalWidth.value / naturalHeight.value
  // Cover = fill the frame's smaller axis, crop the longer.
  let s: number
  if (imgRatio > frameRatio) {
    s = frameHeight.value / naturalHeight.value
  } else {
    s = frameWidth.value / naturalWidth.value
  }
  baseScale.value = s
  scale.value = s
  // Center.
  translateX.value = (frameWidth.value - naturalWidth.value * s) / 2
  translateY.value = (frameHeight.value - naturalHeight.value * s) / 2
}

/** Switch the crop-frame aspect (cover mode) and re-fit the image. */
function setAspect(aspect: '16:9' | '1:1') {
  if (currentAspect.value === aspect) return
  currentAspect.value = aspect
  void nextTick(() => { measureFrame(); fitCover() })
}

// ---- Pan + zoom -----------------------------------------------

function onMouseDown(event: MouseEvent) {
  if (!imageUrl.value) return
  event.preventDefault()
  dragging.value = true
  dragStart.value = {
    x: event.clientX,
    y: event.clientY,
    tx: translateX.value,
    ty: translateY.value
  }
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(event: MouseEvent) {
  if (!dragging.value) return
  const dx = event.clientX - dragStart.value.x
  const dy = event.clientY - dragStart.value.y
  translateX.value = dragStart.value.tx + dx
  translateY.value = dragStart.value.ty + dy
}

function onMouseUp() {
  dragging.value = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function onZoom(event: Event) {
  const zoom = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(zoom) || zoom <= 0) return
  // Slider is a multiplier on the fit scale, so 1× = fit (zooming back out
  // always returns to the original framing).
  const next = baseScale.value * zoom
  // Zoom around the frame center: convert the current center's image-space
  // position, change scale, then re-center on it.
  const cx = frameWidth.value / 2
  const cy = frameHeight.value / 2
  const imgX = (cx - translateX.value) / scale.value
  const imgY = (cy - translateY.value) / scale.value
  scale.value = next
  translateX.value = cx - imgX * next
  translateY.value = cy - imgY * next
}

// ---- Save: render the current crop region to a canvas --------

function save() {
  const img = imageEl.value
  if (!img || !imageUrl.value) return
  // Source rect on the natural image: divide the frame's
  // top-left position (-translate) by the rendered scale.
  const sx = Math.max(0, -translateX.value / scale.value)
  const sy = Math.max(0, -translateY.value / scale.value)
  const sw = frameWidth.value / scale.value
  const sh = frameHeight.value / scale.value

  // Output canvas dimensions:
  //   avatar : 480 × 480 square (the runtime UI displays it as
  //            a circle via border-radius, but the saved file is
  //            a full square so it can be reused in any shape).
  //   cover  : 1600 × 900 — full 16:9 banner at retina-friendly
  //            density.
  let targetW: number
  let targetH: number
  if (isCircle.value) {
    targetW = 480; targetH = 480
  } else if (currentAspect.value === '1:1') {
    targetW = 1080; targetH = 1080
  } else {
    targetW = 1600; targetH = 900
  }

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH)
  const dataUrl = canvas.toDataURL('image/png')
  emit('save', dataUrl)
  emit('update:modelValue', false)
}

function close() {
  emit('update:modelValue', false)
}

function clearImage() {
  imageUrl.value = ''
  scale.value = 1
  baseScale.value = 1
  translateX.value = 0
  translateY.value = 0
}

/** "Remove image" — clear, tell the host to drop its stored image, close. */
function removeImage() {
  clearImage()
  emit('remove')
  emit('update:modelValue', false)
}

function onBackdrop(event: MouseEvent) {
  if (event.target === event.currentTarget) close()
}

const transformStyle = computed(() => ({
  transform: `translate(${translateX.value}px, ${translateY.value}px) scale(${scale.value})`,
  transformOrigin: '0 0'
}))
</script>

<template>
  <Transition name="slide-modal-backdrop">
    <div
      v-if="modelValue"
      class="image-editor-backdrop"
      role="presentation"
      @click="onBackdrop"
    >
      <div
        class="image-editor-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header class="image-editor-panel__header">
          <h2 class="image-editor-panel__title">{{ title }}</h2>
          <button
            type="button"
            class="image-editor-panel__close"
            aria-label="Close"
            @click="close"
          >
            <AppIcon name="close" :size="16" />
          </button>
        </header>

        <div class="image-editor-panel__body">
          <!-- Empty state — drop zone + file picker. The whole card
               is a <label> so clicking anywhere on it opens the
               native file picker. -->
          <label
            v-if="!imageUrl"
            class="image-editor-dropzone"
            @dragover="onDragOver"
            @drop="onDrop"
          >
            <div class="image-editor-dropzone__icon" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </div>
            <p class="image-editor-dropzone__copy">
              Drop an image here or
              <span class="image-editor-dropzone__browse">browse</span>
              from your device.
            </p>
            <p class="image-editor-dropzone__hint">
              JPG, PNG or WebP, up to 5 MB recommended.
            </p>
            <input
              type="file"
              accept="image/*"
              class="image-editor-dropzone__input"
              @change="onFileChange"
            />
          </label>

          <!-- Crop / preview state. -->
          <div v-else class="image-editor-stage">
            <div
              ref="frameRef"
              class="image-editor-frame"
              :class="`image-editor-frame--${isCircle ? 'circle' : 'cover'}`"
              :style="frameStyle"
              @mousedown="onMouseDown"
            >
              <img
                ref="imageEl"
                :src="imageUrl"
                alt=""
                class="image-editor-frame__img"
                :style="transformStyle"
                draggable="false"
                @load="onImageLoad"
              />
            </div>

            <div class="image-editor-stage__controls">
              <div v-if="hasAspectToggle" class="image-editor-stage__aspect" role="group" aria-label="Crop aspect">
                <button
                  v-for="a in aspectOptions"
                  :key="a"
                  type="button"
                  class="image-editor-stage__aspect-btn"
                  :class="{ 'image-editor-stage__aspect-btn--active': currentAspect === a }"
                  @click="setAspect(a)"
                >{{ a }}</button>
              </div>
              <label class="image-editor-stage__zoom">
                <span>Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.01"
                  :value="zoomValue"
                  @input="onZoom"
                />
              </label>
              <label class="image-editor-stage__pick">
                <span>Choose another</span>
                <input
                  type="file"
                  accept="image/*"
                  class="image-editor-dropzone__input"
                  @change="onFileChange"
                />
              </label>
            </div>
            <p class="image-editor-stage__hint">
              Drag the image to reposition it inside the frame, then save.
            </p>
          </div>
        </div>

        <footer class="image-editor-panel__footer">
          <button
            v-if="imageUrl"
            type="button"
            class="image-editor-panel__danger"
            @click="removeImage"
          >Remove image</button>
          <div class="image-editor-panel__footer-spacer"></div>
          <button class="secondary-button" type="button" @click="close">
            Cancel
          </button>
          <button
            class="ledger-action-button"
            type="button"
            :disabled="!imageUrl"
            @click="save"
          >Save</button>
        </footer>
      </div>
    </div>
  </Transition>
</template>
