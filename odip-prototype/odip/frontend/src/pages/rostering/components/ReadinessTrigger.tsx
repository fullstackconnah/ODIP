import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Ban } from 'lucide-react'
import { readinessText } from '@/components/ReadinessNote'
import { TAP_AREA } from '@/components/tapArea'
import { TONE } from '@/lib/tone'

const MARGIN = 8
const OPEN_DELAY_MS = 200
const CLOSE_DELAY_MS = 150
const ONBOARDING = 'Services started; onboarding is still open'

export type ReadinessTriggerProps = {
  /** What is still missing, in the server's own words. */
  issues?: readonly string[] | null
  /** The organisation enforces readiness (Enforce) and refuses this participant: the word is "Blocked". */
  blocked?: boolean
  /** The participant is still onboarding. The row's Onboarding tag has no room beside this word, so its sentence moves into the name and the panel. */
  onboarding?: boolean
}

/**
 * The roster row's readiness signal: one short word ("Not ready", or "Blocked" in Enforce) that opens a peek panel with the whole reason.
 * The ReadinessNote chip it replaces here truncated on every row at the 195px column, and a `title` is not reachable on touch.
 *
 * Text only, no fill, so it cannot be mistaken for the coverage count pill beside it. Warn is the warning ink and informational; Enforce is
 * the danger ink (owner, 2026-11-02): it stops rostering, so it must read as stopped. The panel is a body portal (RailFlyout's pattern),
 * because the board frame scrolls and the cell is sticky, so a panel in the cell would be clipped.
 *
 * open = hovered || focused by keyboard || pinned. A mouse opens it after a short delay (so panels do not flash while the eye runs down the
 * rows) and closes it just after leaving; a click, tap, Enter or Space pins it; Escape, an outside press, focus moving on, a resize or a
 * scroll close it. Nothing in the panel is interactive.
 */
export function ReadinessTrigger({ issues, blocked = false, onboarding = false }: ReadinessTriggerProps) {
  const words = readinessText(issues, blocked)
  return words ? <Peek issues={issues ?? []} blocked={blocked} onboarding={onboarding} title={words.title} /> : null
}

function Peek({ issues, blocked, onboarding, title }: { issues: readonly string[]; blocked: boolean; onboarding: boolean; title: string }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [pinned, setPinned] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openTimer = useRef<number>(undefined)
  const closeTimer = useRef<number>(undefined)
  // A press focuses the button, but only keyboard focus opens the panel (a press is a click, which pins).
  const pressed = useRef(false)
  const panelId = useId()
  const open = hovered || focused || pinned

  const clearTimers = () => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
  }
  const closeAll = useCallback(() => {
    window.clearTimeout(openTimer.current)
    window.clearTimeout(closeTimer.current)
    setHovered(false)
    setFocused(false)
    setPinned(false)
  }, [])
  useEffect(() => clearTimers, [])

  const enter = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    clearTimers()
    openTimer.current = window.setTimeout(() => setHovered(true), OPEN_DELAY_MS)
  }
  const leave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    clearTimers()
    closeTimer.current = window.setTimeout(() => setHovered(false), CLOSE_DELAY_MS)
  }

  useLayoutEffect(() => {
    const panel = panelRef.current
    const trigger = triggerRef.current
    if (!open || !panel || !trigger) return
    const rect = trigger.getBoundingClientRect()
    // A fixed bottom bar (the phone nav) is not room, as Dropdown counts it.
    const nav = document.querySelector('nav[aria-label="Mobile"]')?.getBoundingClientRect()
    const floor = nav && nav.height > 0 && nav.top < window.innerHeight ? nav.top : window.innerHeight
    const below = rect.bottom + 4 + panel.offsetHeight <= floor - MARGIN || rect.top - 4 - panel.offsetHeight < MARGIN
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - MARGIN - panel.offsetWidth))
    panel.style.left = `${left}px`
    panel.style.top = `${below ? rect.bottom + 4 : rect.top - 4 - panel.offsetHeight}px`
    // It grows out of its trigger, which is what anchors it to its source.
    panel.style.transformOrigin = `${rect.left + rect.width / 2 - left}px ${below ? 'top' : 'bottom'}`
  }, [open])

  useEffect(() => {
    if (!open) return
    const inside = (target: EventTarget | null) => !!panelRef.current?.contains(target as Node) || !!triggerRef.current?.contains(target as Node)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll()
    }
    const onPointerDown = (e: globalThis.PointerEvent) => {
      if (!inside(e.target)) closeAll()
    }
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) closeAll()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    window.addEventListener('resize', closeAll)
    // Capture: the board frame scrolls inside the page, and a scroll does not bubble.
    window.addEventListener('scroll', closeAll, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('resize', closeAll)
      window.removeEventListener('scroll', closeAll, true)
    }
  }, [open, closeAll])

  const label = blocked ? `Blocked. ${title}` : title
  const accessibleName = onboarding ? `${label}. ${ONBOARDING}` : label
  const tone = blocked ? TONE.danger.ink : TONE.warning.ink
  const Icon = blocked ? Ban : AlertTriangle

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={accessibleName}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`${TAP_AREA} inline-flex h-4 shrink-0 items-center gap-1 rounded-sm text-xs font-semibold pointer-coarse:h-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone}`}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onPointerDown={() => { pressed.current = true }}
        onFocus={() => {
          if (pressed.current) pressed.current = false
          else setFocused(true)
        }}
        onBlur={() => { pressed.current = false; setFocused(false) }}
        onClick={() => {
          pressed.current = false
          clearTimers()
          // Pinning keeps a hover-open panel; the second press unpins and closes it.
          if (pinned) closeAll()
          else setPinned(true)
        }}
      >
        <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
        <span className="whitespace-nowrap underline decoration-dotted underline-offset-2 hover:decoration-solid">{blocked ? 'Blocked' : 'Not ready'}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label={blocked ? 'Not ready for rostering' : 'Not ready'}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onPointerLeave={leave}
          className="readiness-peek fixed z-[70] w-max max-w-[min(280px,calc(100vw-16px))] rounded-[var(--radius-md)] bg-[var(--color-popover)] p-3 text-xs text-[var(--color-popover-foreground)] shadow-[var(--shadow-float)]"
        >
          <p className={`flex items-center gap-1.5 font-semibold ${tone}`}>
            <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[var(--color-popover-foreground)]">{blocked ? 'Not ready for rostering' : 'Not ready'}</span>
          </p>
          {issues.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {issues.map(issue => <li key={issue} className="break-words">{issue}</li>)}
            </ul>
          )}
          {onboarding && <p className="mt-1.5 text-[var(--color-muted-foreground)]">{ONBOARDING}.</p>}
          <p className="mt-2 text-[var(--color-muted-foreground)]">
            {blocked ? 'New shifts and assignments are refused until this is done.' : 'You can still roster shifts.'}
          </p>
        </div>,
        document.body,
      )}
    </>
  )
}
