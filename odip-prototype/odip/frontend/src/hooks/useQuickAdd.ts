import { useEffect, useRef, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * The participant Overview's Quick add tiles link to a section with `?add=1`: the section that owns the add reads it ONCE on mount, opens its add, and removes
 * `add` with `replace`, so Back, a refresh and a shared link never reopen it. A role without the write gate (`enabled` false) just drops the param.
 * `ready` holds the open until what the add depends on has loaded (the Funding tab needs to know whether a plan exists).
 * Focus goes to the section's own Add button (`focusRef`) just before the open, so the dialog returns focus there on close: the Overview tile is gone by then.
 */
export function useQuickAdd(open: () => void, { enabled, ready = true, focusRef }: { enabled: boolean; ready?: boolean; focusRef?: RefObject<HTMLElement | null> }) {
  const [params, setParams] = useSearchParams()
  const pending = useRef(params.get('add') === '1')
  useEffect(() => {
    if (!pending.current) return
    setParams(prev => { const next = new URLSearchParams(prev); next.delete('add'); return next }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])
  useEffect(() => {
    if (!pending.current || !ready) return
    pending.current = false
    if (!enabled) return
    focusRef?.current?.focus({ preventScroll: true })
    open()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `open` is a fresh closure every render; only the gates decide when it runs
  }, [enabled, ready])
}
