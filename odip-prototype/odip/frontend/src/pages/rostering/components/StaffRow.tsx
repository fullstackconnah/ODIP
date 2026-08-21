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
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-display text-sm font-semibold text-foreground" title={row.fullName}>
              {row.fullName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{row.role}</p>
          </div>
          {row.compliance === 'Warning' && (
            <span className="flex shrink-0 items-center gap-1 pt-0.5" title={row.complianceNotes[0]}>
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
              <span className="max-w-[7rem] truncate text-[11px] text-muted-foreground">{row.complianceNotes[0]}</span>
            </span>
          )}
          {row.compliance === 'Blocked' && (
            <span className="max-w-[7rem] shrink-0 truncate pt-0.5 text-[11px] font-medium text-destructive" title={row.complianceNotes[0]}>
              {row.complianceNotes[0] ?? 'Blocked'}
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
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(150px, 1fr))`, gridAutoFlow: 'row dense' }}
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
