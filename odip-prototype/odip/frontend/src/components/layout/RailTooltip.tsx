import { useEffect, useState, type FocusEvent, type PointerEvent } from 'react'
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
 * The timers and the warm-up memory of the rail's one tooltip. A plain object rather than refs, so the handlers it hands out can be
 * spread onto items while rendering. A mouse waits 500ms on the first item and 0ms on the next while one shows (or within 300ms of
 * one hiding); a keyboard focus shows at once; touch never does.
 */
class RailTipController {
  private showing = false
  private lastHidden = 0
  private showTimer: ReturnType<typeof setTimeout> | undefined
  private hideTimer: ReturnType<typeof setTimeout> | undefined

  private readonly setTip: (tip: Tip | null) => void

  constructor(setTip: (tip: Tip | null) => void) {
    this.setTip = setTip
  }

  hide = () => {
    clearTimeout(this.showTimer)
    clearTimeout(this.hideTimer)
    if (this.showing) this.lastHidden = Date.now()
    this.showing = false
    this.setTip(null)
  }

  /** Leaving an item or the tooltip: gone after a short grace, so the pointer can cross onto the tooltip (WCAG 1.4.13). */
  hideSoon = () => {
    clearTimeout(this.showTimer)
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(this.hide, HIDE_GRACE_MS)
  }

  keep = () => clearTimeout(this.hideTimer)

  private cancel() {
    clearTimeout(this.showTimer)
    clearTimeout(this.hideTimer)
  }

  private show(el: HTMLElement, label: string, count: number) {
    // The item can unmount while the 500ms timer is pending; a detached rect is all zeros and would strand the tip at the corner.
    if (!el.isConnected) return
    const rect = el.getBoundingClientRect()
    const left = (el.closest('aside')?.getBoundingClientRect().right ?? rect.right) + MARGIN
    const top = Math.min(Math.max(rect.top + rect.height / 2 - HEIGHT / 2, MARGIN), window.innerHeight - MARGIN - HEIGHT)
    this.showing = true
    this.setTip({ label, count, left, top })
  }

  bind = (label: string, count: number): RailTipProps => ({
    onPointerEnter: e => {
      if ((e.pointerType !== 'mouse' && e.pointerType !== 'pen') || !hoverCapable()) return
      this.cancel()
      const el = e.currentTarget
      const warm = this.showing || Date.now() - this.lastHidden < WARM_MS
      if (warm) this.show(el, label, count)
      else this.showTimer = setTimeout(() => this.show(el, label, count), SHOW_DELAY_MS)
    },
    onPointerLeave: this.hideSoon,
    onFocus: e => {
      if (!focusVisible(e.currentTarget)) return
      this.cancel()
      this.show(e.currentTarget, label, count)
    },
    onBlur: this.hide,
  })
}

/**
 * One tooltip for the whole rail, portaled to the body, placed beside the rail's right edge and centred on the item. It stays while
 * the pointer is on it, and Escape, scrolling, a resize or `hide()` remove it.
 */
export function useRailTooltip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [ctl] = useState(() => new RailTipController(setTip))

  useEffect(() => ctl.hide, [ctl])

  useEffect(() => {
    if (!tip) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ctl.hide()
    }
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', ctl.hide)
    document.addEventListener('scroll', ctl.hide, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', ctl.hide)
      document.removeEventListener('scroll', ctl.hide, true)
    }
  }, [tip, ctl])

  const tooltip = tip && createPortal(
    <div
      data-testid="rail-tooltip"
      aria-hidden="true"
      onPointerEnter={ctl.keep}
      onPointerLeave={ctl.hideSoon}
      style={{ left: tip.left, top: tip.top }}
      className="rail-tooltip fixed z-[70] inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-foreground)] px-2.5 text-[13px] font-medium leading-none text-[var(--color-background)] shadow-[var(--shadow-float)]"
    >
      {tip.label}
      <NavCountBadge count={tip.count} />
    </div>,
    document.body,
  )

  return { bind: ctl.bind, hide: ctl.hide, tooltip }
}
