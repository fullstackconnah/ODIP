import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'

// The interaction every chart that picks one of N points shares: one focus stop, the step keys, a hover or pinned readout and an optional commit. Lifted from BudgetTrackChart
// (which keeps its own copy); the roster fill chart is the first user.

const STEPS: Record<string, (from: number, count: number) => number> = {
  ArrowRight: from => from + 1, ArrowDown: from => from + 1, PageDown: from => from + 4,
  ArrowLeft: from => from - 1, ArrowUp: from => from - 1, PageUp: from => from - 4,
  Home: () => 0, End: (_, count) => count - 1,
}

export type ChartPointsOptions = {
  count: number
  /** Where keyboard focus starts: the point the chart is already "on". */
  restIndex: number
  /** The point nearest a pointer, by x in columns and by y in rows. */
  nearest: (e: { clientX: number; clientY: number }) => number
  /** Enter, Space or a click on a point. On touch it takes a second tap on the pinned point. */
  onCommit?: (index: number) => void
  label: string
  sentenceId: string
  /** The sentence a screen reader hears when the keyboard lands on a point. */
  describe: (index: number) => string
}

export function useChartPoints({ count, restIndex, nearest, onCommit, label, sentenceId, describe }: ChartPointsOptions) {
  const plotRef = useRef<HTMLDivElement>(null)
  const pointerFocus = useRef(false)
  const lastPointer = useRef('mouse')
  const pinnedBefore = useRef<number | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const [hidden, setHidden] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [message, setMessage] = useState('')
  const shown = active !== null && !hidden && active < count ? active : null

  // A tap's readout stays until a tap outside the plot, or the plot scrolls out of view.
  useEffect(() => {
    if (!pinned) return
    const el = plotRef.current
    const clear = () => { setActive(null); setPinned(false) }
    const onDown = (e: Event) => { if (!el?.contains(e.target as Node)) clear() }
    document.addEventListener('pointerdown', onDown)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) clear() })
    if (el) observer?.observe(el)
    return () => { document.removeEventListener('pointerdown', onDown); observer?.disconnect() }
  }, [pinned])

  const move = (i: number) => {
    setActive(i)
    setHidden(false)
    setMessage(describe(i))
  }
  const clear = () => { setActive(null); setPinned(false) }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      if (shown !== null) { e.preventDefault(); e.stopPropagation(); setHidden(true) }
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCommit?.(active ?? restIndex)
      return
    }
    const step = STEPS[e.key]
    if (!step) return
    e.preventDefault()
    move(Math.min(Math.max(step(active ?? restIndex, count), 0), count - 1))
  }
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    pointerFocus.current = true
    lastPointer.current = e.pointerType
    pinnedBefore.current = pinned ? active : null
    setActive(nearest(e))
    setHidden(false)
    if (e.pointerType === 'touch') setPinned(true)
  }
  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (!onCommit) return
    const i = nearest(e)
    if (lastPointer.current !== 'touch' || pinnedBefore.current === i) onCommit(i)
  }

  return {
    active, shown, pinned, message,
    plotProps: {
      ref: plotRef,
      role: 'group' as const,
      'aria-roledescription': 'chart',
      'aria-label': label,
      'aria-describedby': sentenceId,
      tabIndex: 0,
      onKeyDown,
      onFocus: () => { if (!pointerFocus.current) move(active ?? restIndex); pointerFocus.current = false },
      onBlur: clear,
      onPointerDown,
      onPointerMove: (e: PointerEvent<HTMLDivElement>) => { if (e.pointerType !== 'touch') { setActive(nearest(e)); setHidden(false) } },
      onPointerLeave: (e: PointerEvent<HTMLDivElement>) => { if (e.pointerType !== 'touch') setActive(null) },
      onClick,
    },
  }
}
