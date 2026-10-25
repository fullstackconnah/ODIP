import { useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import { NotRecordedFold } from './NotRecordedFold'

/**
 * A fixed list (ADL, health conditions, consents) has one row per type whether or not anything is recorded, so most rows are
 * "not recorded". The frame shows the answered rows with a count line for the rest; an editor can reveal the others to fill them in
 * (the button focuses the first newly shown row). With nothing answered, an editor gets a fold holding every row and a viewer one
 * plain line. `rows` are in DOM order, so the first unanswered one is the first row that appears on reveal.
 */
export function FixedListFrame<T>({
  title, rows, isAnswered, unit, addLabel, canAdd, rowSelector, children,
}: {
  title: string
  rows: T[]
  isAnswered: (row: T) => boolean
  unit: 'not assessed' | 'not recorded'
  addLabel: string
  canAdd: boolean
  /** Selects the rendered rows inside the frame, in the same order as `rows`. */
  rowSelector: string
  /** Renders the rows it is given; `visible` is the answered ones, or all of them once revealed. */
  children: (visible: T[]) => ReactNode
}) {
  const [revealed, setRevealed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const answered = rows.filter(isAnswered)
  const missing = rows.length - answered.length
  const count = missing > 0 ? (
    <p className="text-[13px] text-[var(--color-muted-foreground)]">{missing} of {rows.length} {unit}</p>
  ) : null

  if (rows.length > 0 && answered.length === 0) {
    if (!canAdd) return <p className="text-[13px] text-[var(--color-muted-foreground)]">Not recorded: {title}</p>
    return <NotRecordedFold summary={title}>{children(rows)}{count}</NotRecordedFold>
  }

  function toggle() {
    const next = !revealed
    setRevealed(next)
    if (!next) return
    // After the rows render: the first row that was hidden is the first unanswered one.
    requestAnimationFrame(() => {
      const row = ref.current?.querySelectorAll<HTMLElement>(rowSelector)[rows.findIndex(r => !isAnswered(r))]
      if (!row) return
      const target = row.querySelector<HTMLElement>('button, a, input, select, textarea') ?? row
      if (target === row) row.tabIndex = -1
      target.focus()
    })
  }

  return (
    <div ref={ref} className="space-y-2">
      {children(revealed ? rows : answered)}
      {count}
      {canAdd && missing > 0 && (
        <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={revealed}>
          {revealed ? 'Show answered only' : addLabel}
        </Button>
      )}
    </div>
  )
}
