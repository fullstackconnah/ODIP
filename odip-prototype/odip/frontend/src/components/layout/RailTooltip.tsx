import { useCallback, useEffect, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { NavCountBadge } from '@/components/layout/NavCountBadge'

/** The icon rail's labels (SHAPE 4.4): a visual duplicate of each item's accessible name, so it is `aria-hidden` and never `aria-describedby`. */
type Tip = { label: string; count: number; left: number; top: number }

export type RailTipProps = {
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void
  onPointerLeave: () => void
  onFocus: (e: FocusEvent<HTMLElement>) => void
  onBlur: () => void
}

const SHOW_DELAY_MS = 500
const WARM_MS = 300
const HIDE_GRACE_MS = 100
const HEIGHT = 28 // h-7
const MARGIN = 8

const hoverCapable = () =>
  typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover) and (pointer: fine)').matches

function focusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible')
  } catch {
    return true // an engine without the selector: show it rather than hide the name from keyboard users
  }
}

/**
 * One tooltip for the whole rail, portaled to the body. A mouse waits 500ms on the first item and 0ms on the next while one shows
 * (or within 300ms of one hiding); a keyboard focus shows at once; touch never does. It stays while the pointer is on it
 * (WCAG 1.4.13), and Escape, scrolling, a resize or `hide()` remove it.
 */
export function useRailTooltip(asideRef: RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<Tip | null>(null)
  const showing = useRef(false)
  const lastHidden = useRef(0)
  const showTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const cancel = () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
  }
  const hide = useCallback(() => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    if (showing.current) lastHidden.current = Date.now()
    showing.current = false
    setTip(null)
  }, [])
  const hideSoon = () => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(hide, HIDE_GRACE_MS)
  }
  const show = (el: HTMLElement, label: string, count: number) => {
    const rect = el.getBoundingClientRect()
    const left = (asideRef.current?.getBoundingClientRect().right ?? rect.right) + MARGIN
    const top = Math.min(Math.max(rect.top + rect.height / 2 - HEIGHT / 2, MARGIN), window.innerHeight - MARGIN - HEIGHT)
    showing.current = true
    setTip({ label, count, left, top })
  }

  useEffect(() => {
    if (!tip) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', hide)
    document.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', hide)
      document.removeEventListener('scroll', hide, true)
    }
  }, [tip, hide])

  const bind = (label: string, count: number): RailTipProps => ({
    onPointerEnter: e => {
      if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') || !hoverCapable()) return
      cancel()
      const el = e.currentTarget
      const warm = showing.current || Date.now() - lastHidden.current < WARM_MS
      if (warm) show(el, label, count)
      else showTimer.current = setTimeout(() => show(el, label, count), SHOW_DELAY_MS)
    },
    onPointerLeave: hideSoon,
    onFocus: e => {
      if (!focusVisible(e.currentTarget)) return
      cancel()
      show(e.currentTarget, label, count)
    },
    onBlur: hide,
  })

  const tooltip = tip && createPortal(
    <div
      data-testid="rail-tooltip"
      aria-hidden="true"
      onPointerEnter={() => clearTimeout(hideTimer.current)}
      onPointerLeave={hideSoon}
      style={{ left: tip.left, top: tip.top }}
      className="rail-tooltip fixed z-[70] inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-foreground)] px-2.5 text-[13px] font-medium leading-none text-[var(--color-background)] shadow-[var(--shadow-float)]"
    >
      {tip.label}
      <NavCountBadge count={tip.count} />
    </div>,
    document.body,
  )

  return { bind, hide, tooltip }
}
