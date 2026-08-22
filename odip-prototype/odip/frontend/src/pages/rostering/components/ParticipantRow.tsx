import { AlertTriangle, ShieldAlert } from 'lucide-react'
import type { RosterParticipantRowDto, ShiftDto } from '@/api/types'
import { RosterDayCell } from './RosterDayCell'
import { TripBar } from './TripBar'
import { barOverlapsWeek, formatDayAccessibleName, RATIO_LABELS, rosterDayColumnsTemplate } from '../lib/roster'

export type ParticipantRowProps = {
  row: RosterParticipantRowDto
  days: string[]
  canWrite: boolean
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
  onAddShift: (participantId: string, participantName: string, day: string) => void
  /** True when the whole board has zero shifts this week — every row would show the same "N days uncovered" badge, which is tautological noise the hint above the grid already covers, so suppress it here rather than repeat it once per row. */
  hideCoverageBadge: boolean
}

/**
 * The default board row — one per active participant, with or without shifts. An empty row is a
 * visible coverage gap, which is the point (see the pass-2 spec). Unfilled shifts (staffId null)
 * live inline on the day they fall on, rendered dashed by RosterDayCell/ShiftChip — there is no
 * separate Unfilled lane here, that stays a staff-view concept.
 */
export function ParticipantRow({ row, days, canWrite, onOpen, onAssignTo, onUnassign, onDelete, onAddShift, hideCoverageBadge }: ParticipantRowProps) {
  const visibleTripBars = row.tripBars.filter(t => barOverlapsWeek(t.startDate, t.endDate, days))
  const covered = row.daysWithoutCover === 0

  return (
    <>
      <div className="sticky left-0 z-10 flex flex-col gap-1.5 border-b border-r border-border bg-card px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-display text-sm font-semibold text-foreground" title={row.fullName}>
            {row.fullName}
          </p>
          <p className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
            {RATIO_LABELS[row.supportRatio] ?? row.supportRatio} support
            {row.hasRestrictivePractice && (
              <span role="img" aria-label="Restrictive practice authorised" title="Restrictive practice authorised">
                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
              </span>
            )}
          </p>
        </div>

        {/* Coverage indicator derived from daysWithoutCover — the visible signal for the gap
            this row-per-participant layout exists to surface. A trip bar rendered below can
            explain an otherwise-empty week without this reading as a failure. */}
        <div className="flex h-4 min-w-0 items-center">
          {hideCoverageBadge ? null : covered ? (
            <span className="text-[11px] text-muted-foreground">Fully covered</span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#b45309]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {row.daysWithoutCover} day{row.daysWithoutCover === 1 ? '' : 's'} uncovered
            </span>
          )}
        </div>
      </div>

      <div
        className="grid gap-1 border-b border-border p-1"
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
            onAdd={() => onAddShift(row.participantId, row.fullName, day)}
            onOpen={onOpen}
            onAssignTo={onAssignTo}
            onUnassign={onUnassign}
            onDelete={onDelete}
          />
        ))}

        {visibleTripBars.map(trip => (
          <TripBar key={trip.tripInstanceId} tripBar={trip} days={days} />
        ))}
      </div>
    </>
  )
}
