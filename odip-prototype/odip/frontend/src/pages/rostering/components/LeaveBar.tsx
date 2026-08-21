import type { LeaveBarDto } from '@/api/types'
import { clampedDayIndex } from '../lib/roster'

export type LeaveBarProps = {
  leave: LeaveBarDto
  days: string[]
}

/** Read-only leave/unavailability bar — muted and italic so it reads as background information, not a task. */
export function LeaveBar({ leave, days }: LeaveBarProps) {
  const startCol = clampedDayIndex(leave.startDate, days) + 1
  const endCol = clampedDayIndex(leave.endDate, days) + 2

  return (
    <div
      style={{ gridColumn: `${startCol} / ${endCol}` }}
      className="flex items-center gap-1.5 rounded-sm bg-muted px-2 py-1.5 text-xs italic text-muted-foreground"
      title={leave.notes ?? leave.availabilityType}
    >
      <span className="min-w-0 flex-1 truncate">{leave.availabilityType}</span>
    </div>
  )
}
