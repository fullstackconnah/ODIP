import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Escape-to-close + Tab focus trap + focus restore, for the roster board's slide-over panels
 * (ShiftSlideOver, ExceptionsDrawer). Mirrors Modal.tsx's a11y behaviour — these panels are
 * right-hand slide-overs rather than centered modals, so they can't reuse Modal directly, but
 * they owe it the same dialog contract (role="dialog", aria-modal, focus trap, Escape to close).
 */
export function useSlideOverA11y(open: boolean, onClose: () => void, panelRef: React.RefObject<HTMLElement | null>) {
  const triggerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current
        if (!panel) return
        const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose, panelRef])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    const panel = panelRef.current
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(firstFocusable ?? panel)?.focus()
    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [open, panelRef])
}
