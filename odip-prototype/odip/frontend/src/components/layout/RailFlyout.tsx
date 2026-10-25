import { useEffect, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const MARGIN = 8

/**
 * The icon rail's group menu (SHAPE 5): a non-modal disclosure like NotificationBell's desktop popover, in a body portal so the
 * nav's overflow and the aside's clip cannot cut it. The links are ordinary links in a labelled group (no menu roles). It opens
 * beside the rail, level with its trigger, and flips up or caps its height to stay on screen.
 *
 * Closing mirrors the bell: Escape (focus back to the trigger), a click outside, focus moving to a control elsewhere, a resize or
 * a scroll of the rail. `onClose(true)` also returns focus to the trigger. Tab off either end of the list closes it and carries on
 * from the trigger, because the portal sits at the end of the document and the natural order would skip the rest of the rail.
 */
export function RailFlyout({ id, label, trigger, onClose, children }: {
  id: string
  label: string
  trigger: HTMLElement
  onClose: (focusTrigger: boolean) => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const headerId = useId()

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const rect = trigger.getBoundingClientRect()
    panel.style.left = `${(trigger.closest('aside')?.getBoundingClientRect().right ?? rect.right) + MARGIN}px`
    panel.style.maxHeight = `${window.innerHeight - 2 * MARGIN}px`
    panel.style.top = `${Math.max(MARGIN, Math.min(rect.top - 6, window.innerHeight - MARGIN - panel.offsetHeight))}px`
  }, [trigger])

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('a')?.focus()
  }, [])

  useEffect(() => {
    const inside = (target: EventTarget | null) => !!panelRef.current?.contains(target as Node) || trigger.contains(target as Node)
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose(true)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (inside(e.target)) return
      onClose(false)
      // A click on a real control keeps its focus; a click on nothing focusable would drop it on the body, so it returns to the trigger.
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) trigger.focus()
      })
    }
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) onClose(false)
    }
    const close = () => onClose(false)
    const nav = trigger.closest('nav')
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('resize', close)
    nav?.addEventListener('scroll', close)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('resize', close)
      nav?.removeEventListener('scroll', close)
    }
  }, [trigger, onClose])

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const links = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a'))
    const at = links.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Tab') {
      if (e.shiftKey && at === 0) {
        e.preventDefault()
        onClose(true)
      } else if (!e.shiftKey && at === links.length - 1) {
        e.preventDefault()
        const controls = Array.from(trigger.closest('aside')?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
        onClose(false)
        controls[controls.indexOf(trigger) + 1]?.focus()
      }
      return
    }
    const step = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : null
    if (step === null) return
    e.preventDefault()
    links[(step + links.length) % links.length]?.focus()
  }

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="group"
      aria-labelledby={headerId}
      onKeyDown={onPanelKeyDown}
      className="rail-flyout fixed z-[70] w-56 overflow-y-auto rounded-md bg-[var(--color-popover)] p-1.5 text-[var(--color-popover-foreground)] shadow-[var(--shadow-float)]"
    >
      <p id={headerId} className="px-3 pb-1.5 pt-1 text-xs font-semibold text-[var(--color-muted-foreground)]">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>,
    document.body,
  )
}
