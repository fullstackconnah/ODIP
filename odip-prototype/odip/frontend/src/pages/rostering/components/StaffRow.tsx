import { Link } from 'react-router-dom'
import { useDroppable } from '@dnd-kit/core'
import type { RosterStaffRowDto, ShiftDto } from '@/api/types'
import { RosterDayCell } from './RosterDayCell'
import { TripBar } from './TripBar'
import { LeaveBar } from './LeaveBar'
import { barOverlapsWeek, formatDayAccessibleName, formatHoursMeter, rosterDayColumnsTemplate } from '../lib/roster'

export type StaffRowProps = {
  row: RosterStaffRowDto
  days: string[]
  canWrite: boolean
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
  onAddShift: (staffId: string, day: string) => void
}

// Shared by the compliance-note buttons: truncates inline; on focus it pops out into a card showing the
// full note (the note was already long-form text that only ever fit as a truncated line).
const NOTE_BUTTON =
  'min-w-0 max-w-full truncate rounded-sm text-left text-[13px] leading-4 focus:absolute focus:left-0 focus:top-full focus:z-20 focus:mt-1 focus:w-64 focus:max-w-[16rem] focus:whitespace-normal focus:overflow-visible focus:rounded-sm focus:border focus:border-border focus:bg-card focus:px-2 focus:py-1 focus:leading-snug focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function StaffRow({ row, days, canWrite, onOpen, onAssignTo, onUnassign, onDelete, onAddShift }: StaffRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `staff:${row.staffId}`, disabled: !canWrite })

  const overTarget = row.rosteredHours > row.targetHours
  const meterPct = row.targetHours > 0 ? Math.min(100, (row.rosteredHours / row.targetHours) * 100) : 0

  const visibleTripBars = row.tripBars.filter(t => barOverlapsWeek(t.startDate, t.endDate, days))
  const visibleLeave = row.leave.filter(l => barOverlapsWeek(l.startDate, l.endDate, days))

  return (
    <>
      {/*
        Row header: two tight lines inside one --row-h row. Line 1 is the name, which gets the column's
        full width (long names like "Marcus Papadopoulos" must not truncate to a stub). Line 2 is the
        secondary facts: the role — or, when the row carries a compliance note, the note in its place,
        since a flag outranks a static role and the role is still on the name's tooltip — and the
        rostered/target hours. The hours meter is the 2px rule along the cell's bottom edge, so it costs
        no height. The name is a link to the staff page: it replaces the staff-name link the chips used
        to repeat in every one of this row's cells.
      */}
      <div className="sticky left-0 z-10 flex min-h-[var(--row-h)] flex-col justify-center border-b border-r border-border bg-card px-2">
        <Link
          to={`/staff/${row.staffId}`}
          className="block truncate rounded-sm font-display text-sm font-semibold leading-4 text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={`${row.fullName} — ${row.role}`}
        >
          {row.fullName}
        </Link>

        <div className="flex min-w-0 items-center justify-between gap-2 text-[13px] leading-4 text-muted-foreground">
          {row.compliance === 'Warning' ? (
            <span className="relative flex min-w-0 items-center gap-1">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
              <button type="button" aria-label={row.complianceNotes[0]} className={`${NOTE_BUTTON} text-muted-foreground focus:text-foreground`}>
                {row.complianceNotes[0]}
              </button>
            </span>
          ) : row.compliance === 'Blocked' ? (
            <span className="relative flex min-w-0 items-center">
              <button type="button" aria-label={row.complianceNotes[0] ?? 'Blocked'} className={`${NOTE_BUTTON} font-medium text-destructive`}>
                {row.complianceNotes[0] ?? 'Blocked'}
              </button>
            </span>
          ) : (
            <span className="min-w-0 truncate">{row.role}</span>
          )}
          <span className="shrink-0 tabular-nums">{formatHoursMeter(row.rosteredHours, row.targetHours)}</span>
        </div>

        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-input" aria-hidden="true">
          <div
            className={`h-full transition-[width] duration-200 ${overTarget ? 'bg-[var(--color-warning)]' : 'bg-primary'}`}
            style={{ width: `${meterPct}%` }}
          />
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`grid gap-x-1 gap-y-0.5 border-b border-border px-1 transition-colors duration-150 ${isOver ? 'bg-secondary-container/40' : ''}`}
        style={{ gridColumn: '2 / -1', gridTemplateColumns: rosterDayColumnsTemplate(days.length), gridAutoFlow: 'row dense' }}
      >
        {days.map((day, i) => (
          <RosterDayCell
            key={day}
            day={day}
            dayIndex={i}
            shifts={row.shifts.filter(s => s.serviceDate === day)}
            canWrite={canWrite}
            addLabel={`Add a shift for ${row.fullName} on ${formatDayAccessibleName(day)}`}
            onAdd={() => onAddShift(row.staffId, day)}
            onOpen={onOpen}
            onAssignTo={onAssignTo}
            onUnassign={onUnassign}
            onDelete={onDelete}
          />
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
