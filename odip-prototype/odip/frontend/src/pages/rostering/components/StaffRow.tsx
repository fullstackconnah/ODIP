import { useDroppable } from '@dnd-kit/core'
import type { RosterStaffRowDto, ShiftDto } from '@/api/types'
import { ShiftChip } from './ShiftChip'
import { TripBar } from './TripBar'
import { LeaveBar } from './LeaveBar'
import { barOverlapsWeek, formatHoursMeter, isToday } from '../lib/roster'

export type StaffRowProps = {
  row: RosterStaffRowDto
  days: string[]
  canWrite: boolean
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
}

export function StaffRow({ row, days, canWrite, onOpen, onAssignTo, onUnassign, onDelete }: StaffRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `staff:${row.staffId}`, disabled: !canWrite })

  const overTarget = row.rosteredHours > row.targetHours
  const meterPct = row.targetHours > 0 ? Math.min(100, (row.rosteredHours / row.targetHours) * 100) : 0

  const visibleTripBars = row.tripBars.filter(t => barOverlapsWeek(t.startDate, t.endDate, days))
  const visibleLeave = row.leave.filter(l => barOverlapsWeek(l.startDate, l.endDate, days))

  return (
    <>
      <div className="sticky left-0 z-10 flex flex-col gap-1.5 border-b border-r border-border bg-card px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-foreground" title={row.fullName}>
            {row.fullName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{row.role}</p>
        </div>

        {/* Reserved compliance-note line, always rendered (empty for 'Ok' rows) so every row
            takes the same height whether or not it carries a note — this used to sit beside the
            name in a `justify-between` row and steal its width, which is why names like "Isabella
            Ferraro" or "Marcus Papadopoulos" were truncating to unreadable stubs. The name above
            now has the column's full width to itself; the note moved here as its own line and
            keeps the same truncate + focus-popout disclosure as before. */}
        <div className="flex h-4 min-w-0 items-center gap-1">
          {row.compliance === 'Warning' && (
            <span className="relative flex min-w-0 items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
              <button
                type="button"
                aria-label={row.complianceNotes[0]}
                className="min-w-0 max-w-full truncate rounded-sm text-left text-[11px] text-muted-foreground focus:absolute focus:left-0 focus:top-full focus:z-20 focus:mt-1 focus:w-64 focus:max-w-[16rem] focus:whitespace-normal focus:overflow-visible focus:rounded-sm focus:border focus:border-border focus:bg-card focus:px-2 focus:py-1 focus:text-foreground focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.complianceNotes[0]}
              </button>
            </span>
          )}
          {row.compliance === 'Blocked' && (
            <span className="relative flex min-w-0 items-center">
              <button
                type="button"
                aria-label={row.complianceNotes[0] ?? 'Blocked'}
                className="min-w-0 max-w-full truncate rounded-sm text-left text-[11px] font-medium text-destructive focus:absolute focus:left-0 focus:top-full focus:z-20 focus:mt-1 focus:w-64 focus:max-w-[16rem] focus:whitespace-normal focus:overflow-visible focus:rounded-sm focus:border focus:border-border focus:bg-card focus:px-2 focus:py-1 focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {row.complianceNotes[0] ?? 'Blocked'}
              </button>
            </span>
          )}
        </div>
        <div>
          <div className="h-1 w-full overflow-hidden rounded-sm bg-input">
            <div
              className={`h-full rounded-sm transition-[width] duration-200 ${overTarget ? 'bg-[var(--color-warning)]' : 'bg-primary'}`}
              style={{ width: `${meterPct}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">{formatHoursMeter(row.rosteredHours, row.targetHours)}</p>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`grid gap-1 border-b border-border p-1 transition-colors duration-150 ${isOver ? 'bg-secondary-container/40' : ''}`}
        style={{ gridColumn: '2 / -1', gridTemplateColumns: `repeat(${days.length}, minmax(150px, 1fr))`, gridAutoFlow: 'row dense' }}
      >
        {days.map((day, i) => (
          <div key={day} style={{ gridColumn: i + 1, gridRow: 1 }} className={`flex min-h-[2.25rem] flex-col gap-1 rounded-sm p-0.5 ${isToday(day) ? 'bg-primary/5' : ''}`}>
            {row.shifts
              .filter(s => s.serviceDate === day)
              .map(shift => (
                <ShiftChip
                  key={shift.id}
                  shift={shift}
                  canWrite={canWrite}
                  onOpen={onOpen}
                  onAssignTo={onAssignTo}
                  onUnassign={onUnassign}
                  onDelete={onDelete}
                />
              ))}
          </div>
        ))}

        {visibleTripBars.map(trip => (
          <TripBar key={trip.tripInstanceId} tripBar={trip} days={days} />
        ))}
        {visibleLeave.map((leave, i) => (
          <LeaveBar key={`${leave.startDate}-${i}`} leave={leave} days={days} />
        ))}
      </div>
    </>
  )
}
