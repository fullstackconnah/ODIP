import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Everything a keyboard user can Tab to. `input[type=hidden]` and anything inside a disabled `<fieldset>` match the
 * attribute selectors but can never take focus, so they are left out: as the first or last "focusable" they would make the
 * trap wrap at the wrong place.
 */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(el => !el.closest('fieldset[disabled]'))
}

// ── The open-layer stack ─────────────────────────────────────────────────────────────────────────────────────────────────
// Every open dialog, panel or drawer registers itself here, in the order it opened. Escape and the Tab trap act on the TOPMOST
// layer only, so a ConfirmDialog opened from a panel closes by itself and the panel underneath stays put (each used to listen
// on `document` on its own, so one Escape closed both). Scroll is locked once, by the first layer, and unlocked when the last
// one closes.

type Layer = {
  container: RefObject<HTMLElement | null>
  /** What Escape does for this layer; a no-op when the layer opted out of Escape. */
  escape: () => void
}

const layers: Layer[] = []
let scrollLocks = 0
let overflowBeforeLock = ''

function onKeyDown(event: KeyboardEvent) {
  const top = layers[layers.length - 1]
  if (!top) return

  if (event.key === 'Escape') {
    // An inner widget (an open Dropdown list, a SearchableSelect popup) that used this Escape has called preventDefault():
    // the keypress closed that, not the layer around it. The next Escape reaches the layer.
    if (event.defaultPrevented || event.isComposing) return
    top.escape()
    return
  }

  if (event.key === 'Tab') trapTab(event, top)
}

function trapTab(event: KeyboardEvent, layer: Layer) {
  const container = layer.container.current
  if (!container) return
  const focusable = focusableIn(container)
  if (focusable.length === 0) {
    event.preventDefault()
    container.focus()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement

  // Focus is not inside the layer at all (a click on the scrim of a dialog that does not close on it, the page body after the
  // opener unmounted): bring it back in, from the end the direction of travel implies.
  if (!active || !container.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
    return
  }

  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function pushLayer(layer: Layer) {
  layers.push(layer)
  if (layers.length === 1) document.addEventListener('keydown', onKeyDown)
}

function removeLayer(layer: Layer) {
  const index = layers.indexOf(layer)
  if (index !== -1) layers.splice(index, 1)
  if (layers.length === 0) document.removeEventListener('keydown', onKeyDown)
}

function acquireScrollLock() {
  if (scrollLocks++ === 0) {
    overflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
}

function releaseScrollLock() {
  if (--scrollLocks === 0) document.body.style.overflow = overflowBeforeLock
}

// ── The hook ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DialogBehaviorOptions = {
  open: boolean
  /** Called for Escape on the topmost layer. Whoever closes the layer (sets `open` false) owns the actual closing. */
  onClose: () => void
  /** The dialog element: the Tab trap's boundary and the place focus moves into. Give it `tabIndex={-1}` so it can hold focus when it has nothing focusable. */
  containerRef: RefObject<HTMLElement | null>
  /** Escape closes the layer. Default true. A layer that sets it false still sits in the stack, so Escape never reaches the layer below it. */
  closeOnEscape?: boolean
  /** Lock page scroll while this layer is open (counted: it stays locked until the last layer closes). Default true. */
  lockScroll?: boolean
  /** Where focus goes on open. Default: the first focusable element in the container, else the container itself. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Put focus back on whatever had it when the layer opened, once the layer closes. Default true. */
  returnFocus?: boolean
}

/**
 * The behaviour every modal layer owes its user, in one place: Escape to close, a Tab trap, focus moved in on open and back
 * on close, and page scroll locked while open. It is what Modal, SlideOver and the unsaved-changes dialog run on.
 *
 * It does NOT render anything or set `role` / `aria-modal`: the caller marks up the dialog. Call it with `open` true for as
 * long as the layer is on screen.
 *
 * Do not use `autoFocus` inside a layer: React focuses that element before this hook runs, so the hook would take it for
 * the opener and never return focus to the real one. Pass `initialFocusRef` instead.
 */
export function useDialogBehavior({
  open,
  onClose,
  containerRef,
  closeOnEscape = true,
  lockScroll = true,
  initialFocusRef,
  returnFocus = true,
}: DialogBehaviorOptions): void {
  // The stack holds ONE entry per open layer for its whole life, so the latest callbacks are read through a ref instead of
  // re-registering (which would move the layer to the top of the stack) every time the caller re-renders.
  const latest = useRef({ onClose, closeOnEscape })
  useLayoutEffect(() => {
    latest.current = { onClose, closeOnEscape }
  })

  useEffect(() => {
    if (!open) return
    const layer: Layer = {
      container: containerRef,
      escape: () => {
        if (latest.current.closeOnEscape) latest.current.onClose()
      },
    }
    pushLayer(layer)
    return () => removeLayer(layer)
  }, [open, containerRef])

  useEffect(() => {
    if (!open || !lockScroll) return
    acquireScrollLock()
    return releaseScrollLock
  }, [open, lockScroll])

  useEffect(() => {
    if (!open) return
    const container = containerRef.current
    const active = document.activeElement
    // Whatever has focus now (the button that opened the layer) gets it back on close. If focus is already inside the layer
    // there is no opener to speak of (see the autoFocus note above).
    const opener = active instanceof HTMLElement && !container?.contains(active) ? active : null
    const target = initialFocusRef?.current ?? (container ? focusableIn(container)[0] : undefined) ?? container
    target?.focus({ preventScroll: true })
    return () => {
      if (returnFocus && opener?.isConnected) opener.focus()
    }
  }, [open, containerRef, initialFocusRef, returnFocus])
}
