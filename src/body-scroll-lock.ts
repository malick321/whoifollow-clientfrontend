/**
 * Ref-counted body scroll lock.
 *
 * Modals call `lockBodyScroll()` when they open and `unlockBodyScroll()`
 * when they close. Internally we maintain a counter so that if two modals
 * happen to overlap (e.g. a confirmation popover launched from inside a
 * larger popup), the first unlock call does NOT release the lock while
 * the outer modal is still up. Only the final unlock removes the class.
 *
 * Pairs with the `body.modal-open { overflow: hidden }` rule in
 * `src/styles.css`.
 */

const MODAL_OPEN_CLASS = 'modal-open'
let lockDepth = 0

/** Add the body scroll lock. Safe to call repeatedly — each call must be
 *  matched by a corresponding `unlockBodyScroll()`. */
export function lockBodyScroll(): void {
  if (typeof document === 'undefined') return
  lockDepth += 1
  if (lockDepth === 1) {
    // Reserve the previous scrollbar width as padding on the document
    // root so the layout doesn't visibly shift when the scrollbar
    // disappears. Computed before we add the lock class to make sure
    // we're measuring the page in its scrollable state.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    if (scrollbarWidth > 0) {
      document.documentElement.style.setProperty('--modal-scrollbar-width', `${scrollbarWidth}px`)
    }
    document.body.classList.add(MODAL_OPEN_CLASS)
    document.documentElement.classList.add(MODAL_OPEN_CLASS)
  }
}

/** Release one lock. No-op if the counter is already at zero (defensive
 *  — helps when a component's close-path fires twice). */
export function unlockBodyScroll(): void {
  if (typeof document === 'undefined') return
  if (lockDepth === 0) return
  lockDepth -= 1
  if (lockDepth === 0) {
    document.body.classList.remove(MODAL_OPEN_CLASS)
    document.documentElement.classList.remove(MODAL_OPEN_CLASS)
    document.documentElement.style.removeProperty('--modal-scrollbar-width')
  }
}
