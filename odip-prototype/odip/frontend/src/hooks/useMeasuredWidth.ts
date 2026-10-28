import { useLayoutEffect, useState, type RefObject } from 'react'

/** The element's content width, kept current with a ResizeObserver; undefined until measured. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number | undefined {
  const [width, setWidth] = useState<number>()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}
