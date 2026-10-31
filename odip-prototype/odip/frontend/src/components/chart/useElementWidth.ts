import { useLayoutEffect, useState } from 'react'

/** The element's content width. A chart card swaps its subtree between loading and loaded, so this follows the element (a callback ref), not one ref object. */
export function useElementWidth() {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])
  return [width, setEl] as const
}
