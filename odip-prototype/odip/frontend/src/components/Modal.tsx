import { useEffect, useRef, useId, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type ModalProps = {
  open: boolean
  onClose: () => void
  title: string | ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children: ReactNode
  className?: string
  /** Whether clicking the backdrop closes the modal. Defaults to `true`. Set to `false` for a
   * modal tracking unsaved/dirty input, so an accidental outside click doesn't discard it. */
  closeOnBackdrop?: boolean
  /** ARIA role for the dialog element. Use `'alertdialog'` for a modal that blocks on a
   * decision (e.g. a confirm prompt) — it gets the same labelledby/describedby wiring as the
   * default `'dialog'` role. Defaults to `'dialog'`. */
  role?: 'dialog' | 'alertdialog'
}

const SIZE_MAP = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ open, onClose, title, size = 'md', footer, children, className, closeOnBackdrop = true, role = 'dialog' }: ModalProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<Element | null>(null)

  // Escape to close + Tab focus trap
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current
        if (!dialog) return
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
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
  }, [open, onClose])

  // Lock background scroll
  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Move focus into the dialog on open, return it to the trigger on close
  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    const dialog = dialogRef.current
    const firstFocusable = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
    ;(firstFocusable ?? dialog)?.focus()
    return () => {
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeOnBackdrop ? onClose : undefined}>
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`bg-[var(--color-card)] rounded-[var(--radius-lg)] border border-[var(--color-border)] p-4 w-full ${SIZE_MAP[size]} max-h-[90vh] mx-2 overflow-y-auto ${className ?? ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 id={titleId} className="text-lg font-semibold">{title}</h3>
          {/* type="button": the dialog renders inline, so when it is opened from inside a <form> (the Profile
              wizard's embedded Contacts editor) an untyped close button would SUBMIT that form. */}
          <button type="button" onClick={onClose} className="p-1 hover:bg-[var(--color-accent)] rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div id={descriptionId}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-3 mt-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
