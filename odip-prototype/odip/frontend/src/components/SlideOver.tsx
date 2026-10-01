import { useCallback, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { X } from 'lucide-react'
import { useDialogBehavior } from '@/hooks/useDialogBehavior'
import { cn } from '@/lib/utils'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

export type SlideOverProps = {
  open: boolean
  onClose: () => void
  /** The panel's name: the h2, and the dialog's accessible name. */
  title: ReactNode
  /** One muted line under the title; it becomes the dialog's accessible description. */
  description?: ReactNode
  /** Actions for the sticky strip under the scrolling body (Cancel, Save, a destructive action). Omit it for a read-only panel. */
  footer?: ReactNode
  /** The edge the panel is attached to. Only the right edge exists. (The nav drawer, the one left-hand layer, runs on useDialogBehavior itself: its element is also the permanent sidebar.) */
  side?: 'right'
  /** `md` = max-w-md (28rem), `lg` = max-w-lg (32rem). Full width below that. */
  size?: 'md' | 'lg'
  /**
   * A veto over every way the panel closes ITSELF: Escape, a click on the scrim, the header's close button. Return `false` (or a
   * promise of `false`) to keep it open; anything else lets it close. It is not consulted when the caller closes the panel by
   * setting `open` to false, so a successful save that calls `onClose` itself never hits it, and neither does a footer Cancel
   * that calls `onClose` (an explicit discard).
   */
  beforeClose?: () => boolean | Promise<boolean>
  /**
   * The form inside has unsaved edits. Escape, the scrim and the close button then ask "Discard changes?" first instead of
   * closing; "Keep editing" returns to the form. It runs after `beforeClose` (which can still veto outright).
   */
  dirty?: boolean
  /** Where focus lands on open. Default: the first focusable element (the close button comes first in the DOM). */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Layout classes for the scrolling body, merged over its defaults (`flex-1 overflow-y-auto p-[var(--card-pad)]`). */
  bodyClassName?: string
  /** Layout classes for the footer strip, merged over its defaults (`shrink-0 border-t border-border p-[var(--card-pad)]`). */
  footerClassName?: string
  children: ReactNode
}

const SIZE = {
  md: 'max-w-md',
  lg: 'max-w-lg',
} as const

/**
 * A panel docked to the right edge over a scrim: the pattern for creating or editing a record without leaving the list.
 * It is a modal dialog (role="dialog", aria-modal, labelled by its title) with focus moved in on open and back to the opener
 * on close, a Tab trap, Escape to close, and page scroll locked: all of it from `useDialogBehavior`, so a ConfirmDialog opened
 * from inside the panel closes alone and leaves the panel (and its focus) where it was.
 *
 * Layers: scrim z-40, panel z-50 (a Modal opened over it is also z-50 and later in the DOM, so it paints above). Below lg the
 * fixed bottom nav (AppLayout, z-50, `--mobile-nav-h` tall) is also z-50 and later in the DOM than the page, so a full-height
 * panel had its footer (Cancel, Save) underneath it: the panel stops above the nav there, as the wizard footer does
 * (`h-[calc(100%-var(--mobile-nav-h))]`, full height from lg). The panel slides in from the edge; under
 * `prefers-reduced-motion` it just appears (index.css).
 */
export function SlideOver({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  beforeClose,
  dirty = false,
  initialFocusRef,
  bodyClassName,
  footerClassName,
  children,
}: SlideOverProps) {
  const titleId = useId()
  const descriptionId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  // A panel kept mounted and closed from outside (open -> false) while the discard prompt was up must not greet the next
  // open with a stale prompt. Resetting during render, on the prop change, is React's own pattern for this (no effect).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) setConfirmingDiscard(false)
  }
  // A beforeClose that returns a promise can be asked twice (Escape, then the scrim) before the first answer arrives.
  const vetoPending = useRef(false)

  const finishClosing = useCallback(() => {
    if (dirty) setConfirmingDiscard(true)
    else onClose()
  }, [dirty, onClose])

  const requestClose = useCallback(() => {
    if (vetoPending.current) return
    const verdict = beforeClose?.()
    if (verdict instanceof Promise) {
      vetoPending.current = true
      verdict
        .then(allowed => { if (allowed !== false) finishClosing() })
        .catch(() => { /* a veto that throws is a veto */ })
        .finally(() => { vetoPending.current = false })
      return
    }
    if (verdict === false) return
    finishClosing()
  }, [beforeClose, finishClosing])

  useDialogBehavior({ open, onClose: requestClose, containerRef: panelRef, initialFocusRef })

  if (!open) return null

  return (
    <>
      <div className="slide-over-scrim fixed inset-0 z-40 bg-black/40" onClick={requestClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`slide-over-panel fixed right-0 top-0 z-50 flex h-[calc(100%-var(--mobile-nav-h))] lg:h-full w-full ${SIZE[size]} flex-col overflow-hidden border-l border-border bg-card shadow-xl focus:outline-none`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border p-[var(--card-pad)]">
          {description ? (
            <div>
              <h2 id={titleId} className="font-display text-base font-semibold text-foreground">{title}</h2>
              <p id={descriptionId} className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            </div>
          ) : (
            <h2 id={titleId} className="font-display text-base font-semibold text-foreground">{title}</h2>
          )}
          {/* Button iconOnly carries TAP_AREA: the visual square stays small, the hit area reaches 44px on touch. */}
          <Button variant="ghost" iconOnly onClick={requestClose} aria-label="Close panel">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className={cn('flex-1 overflow-y-auto p-[var(--card-pad)]', bodyClassName)}>{children}</div>

        {footer && <div className={cn('shrink-0 border-t border-border p-[var(--card-pad)]', footerClassName)}>{footer}</div>}
      </div>

      <ConfirmDialog
        open={confirmingDiscard}
        onCancel={() => setConfirmingDiscard(false)}
        onConfirm={() => {
          setConfirmingDiscard(false)
          onClose()
        }}
        title="Discard changes?"
        message="You have unsaved changes. If you close this panel now, they will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
      />
    </>
  )
}
