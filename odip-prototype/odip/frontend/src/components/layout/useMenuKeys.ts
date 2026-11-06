import { useEffect, useId, useRef } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'

const ITEM = '[role^="menuitem"]:not(:disabled)'

/**
 * The header action menus (TenantSwitcher, UserSwitcher): outside press and Escape close, and the WAI-ARIA menu keys with
 * roving tabindex. Rows are `role="menuitemradio"` / `"menuitem"` and start at tabIndex -1; the focused one becomes 0.
 * Enter and Space on a row are the button's own click, so the caller's pick handler runs unchanged.
 */
export function useMenuKeys(open: boolean, setOpen: (open: boolean) => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const headingId = useId()
  const openAt = useRef<'checked' | 'last'>('checked')

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])
  const focusEntry = () => {
    const list = items()
    const entry = openAt.current === 'last' ? list[list.length - 1] : list.find(i => i.getAttribute('aria-checked') === 'true') ?? list[0]
    entry?.focus()
  }

  useEffect(() => {
    if (open) focusEntry()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    // On document, so it works when a click left focus elsewhere (NotificationBell does the same).
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  return {
    rootRef,
    triggerRef,
    menuRef,
    menuId,
    headingId,
    /** The trigger's onClick: opens on the checked (or first) item, closes when open. */
    toggle: () => {
      openAt.current = 'checked'
      setOpen(!open)
    },
    onTriggerKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      openAt.current = e.key === 'ArrowUp' ? 'last' : 'checked'
      if (open) focusEntry()
      else setOpen(true)
    },
    onMenuKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        // Focus goes back to the trigger first, so Tab then moves on from it rather than from a row that is about to unmount.
        triggerRef.current?.focus()
        setOpen(false)
        return
      }
      const list = items()
      const at = list.indexOf(document.activeElement as HTMLElement)
      const next =
        e.key === 'ArrowDown' ? (at + 1) % list.length
        : e.key === 'ArrowUp' ? (at <= 0 ? list.length - 1 : at - 1)
        : e.key === 'Home' ? 0
        : e.key === 'End' ? list.length - 1
        : -1
      if (next < 0 || list.length === 0) return
      e.preventDefault()
      list[next].focus()
    },
    onMenuFocus: (e: FocusEvent) => {
      for (const i of items()) i.tabIndex = i === e.target ? 0 : -1
    },
  }
}
