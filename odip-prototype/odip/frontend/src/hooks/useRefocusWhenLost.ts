import { useEffect, type RefObject } from 'react'

/**
 * After a view is swapped under a focused control (a create form becomes its "done" view; a Send again button disappears because the retry
 * worked), the focused element unmounts and focus falls to the page body: a keyboard user has to Tab in from the top, and a screen reader user
 * hears nothing. Call this with a ref to the element that should take focus (a heading with `tabIndex={-1}`) and a value that changes when the
 * view does: after each change it moves focus there, but only if focus was LOST (on the body, outside the dialog, or on the dialog itself). A
 * control that still has focus, such as a Send again that failed and is still on screen, keeps it.
 *
 * With no target mounted (the form view) it does nothing, so it never takes focus from a form.
 */
export function useRefocusWhenLost(target: RefObject<HTMLElement | null>, changed: unknown): void {
  useEffect(() => {
    const element = target.current
    if (!element) return
    const scope = element.closest<HTMLElement>('[role="dialog"]') ?? document.body
    const active = document.activeElement
    const lost = !active || active === document.body || active === scope || !scope.contains(active)
    if (lost) element.focus({ preventScroll: true })
  }, [target, changed])
}
