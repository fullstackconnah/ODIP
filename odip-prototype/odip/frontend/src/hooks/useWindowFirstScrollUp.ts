import { useEffect, type RefObject } from 'react'

/**
 * A scroller inside a page that is itself scrolled (the roster board, with the footer below the fold) hands a wheel-up to the
 * WINDOW first, so the footer leaves before the board moves; the browser would chain the other way round. Native and non-passive
 * so it can preventDefault, but only when it moves the window itself. No-op where the element does not scroll (below lg).
 * A wheel notch is a whole 100px step, which is the footer's entire height: moved instantly it reads as a snap, so a notch animates the way the browser's own
 * wheel does (instant under reduced motion), while a small trackpad delta follows the fingers 1:1.
 * shortcut: wheel and trackpad only, keys scroll the board natively; upgrade if keyboard order matters. A trackpad event over 50px animates too.
 */
export function useWindowFirstScrollUp(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY >= 0 || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (window.scrollY <= 0 || el.scrollHeight <= el.clientHeight) return
      e.preventDefault()
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 50
      const reduced = typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollBy({ top: e.deltaY * (e.deltaMode === 2 ? window.innerHeight : e.deltaMode === 1 ? 16 : 1), behavior: notch && !reduced ? 'smooth' : 'instant' })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}
