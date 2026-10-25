import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Button } from './Button'

const COLLAPSED_ROWS = 5

/**
 * "Show all N" for a list that is long enough to bury what follows it. Pass the rendered row
 * count, the element holding the rows and a selector for one row; render `limit` rows (feed it to
 * `DataTable limit` or slice) and put `button` after the list. Under 6 rows there is no button.
 * Expanding moves focus to the first newly shown row (rows need tabIndex -1 or to be focusable);
 * collapsing leaves focus on the button it was clicked from.
 */
export function useShowAll(count: number, containerRef: RefObject<HTMLElement | null>, rowSelector: string): { limit: number; button: ReactNode } {
  const [expanded, setExpanded] = useState(false)
  const focusRow = useRef(false)
  const long = count > COLLAPSED_ROWS

  // A list that shrinks back under the threshold starts collapsed the next time it grows.
  useEffect(() => { if (!long) setExpanded(false) }, [long])

  useEffect(() => {
    if (!focusRow.current) return
    focusRow.current = false
    // Collapsing needs no move: the clicked button keeps focus.
    if (!expanded) return
    const row = containerRef.current?.querySelectorAll<HTMLElement>(rowSelector)[COLLAPSED_ROWS]
    if (!row) return
    if (!row.hasAttribute('tabindex')) row.tabIndex = -1
    row.focus()
  }, [expanded, containerRef, rowSelector])

  const toggle = () => {
    focusRow.current = true
    setExpanded(e => !e)
  }

  return {
    limit: long && !expanded ? COLLAPSED_ROWS : count,
    button: long ? (
      <Button variant="ghost" size="sm" className="mt-1 min-h-[var(--tap-min)]" aria-expanded={expanded} onClick={toggle}>
        {expanded ? 'Show fewer' : `Show all ${count}`}
      </Button>
    ) : null,
  }
}
