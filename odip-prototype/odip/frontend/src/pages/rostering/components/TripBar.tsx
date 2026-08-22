import { Link } from 'react-router-dom'
import { Map } from 'lucide-react'
import type { TripBarDto } from '@/api/types'
import { clampedDayIndex } from '../lib/roster'

export type TripBarProps = {
  tripBar: TripBarDto
  days: string[]
}

/**
 * Trip staffing rendered read-only on the roster board — visibly a different material from a
 * shift chip (filled secondary surface, no border, a map glyph) so a coordinator never mistakes
 * it for something editable here. Not draggable, no menu; the only interaction is navigating to
 * the trip itself.
 */
export function TripBar({ tripBar, days }: TripBarProps) {
  const startCol = clampedDayIndex(tripBar.startDate, days) + 1
  const endCol = clampedDayIndex(tripBar.endDate, days) + 2

  return (
    <Link
      to={`/trips/${tripBar.tripInstanceId}`}
      style={{ gridColumn: `${startCol} / ${endCol}` }}
      className="flex items-center gap-1.5 rounded-sm bg-secondary-container px-2 py-1.5 text-xs text-foreground transition-colors duration-150 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={`${tripBar.tripName} (${tripBar.tripCode})`}
    >
      <Map className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium">{tripBar.tripName}</span>
      {tripBar.isDriver && <span className="shrink-0 text-[10px] opacity-70">Driver</span>}
    </Link>
  )
}
