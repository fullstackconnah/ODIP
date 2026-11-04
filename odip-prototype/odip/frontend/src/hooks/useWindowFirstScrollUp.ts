import { useEffect, type RefObject } from 'react'

/**
 * A scroller inside a page that is itself scrolled (the roster board, with the footer below the fold) hands a wheel-up to the
 * WINDOW first, so the footer leaves before the board moves; the browser would chain the other way round. Native and non-passive
 * so it can preventDefault, but only when it moves the window itself. No-op where the element does not scroll (below lg).
 * shortcut: wheel and trackpad only, keys scroll the board natively; upgrade if keyboard order matters.
 */
export function useWindowFirstScrollUp(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY >= 0 || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      if (window.scrollY <= 0 || el.scrollHeight <= el.clientHeight) return
      e.preventDefault()
      window.scrollBy({ top: e.deltaY * (e.deltaMode === 2 ? window.innerHeight : e.deltaMode === 1 ? 16 : 1), behavior: 'instant' })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}
