import { Link } from 'react-router-dom'
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
      {/*
        Row header: two tight lines inside one --row-h row. Line 1: the participant (a link) and, when it
        applies, the restrictive-practice marker — kept on the name line so it survives a crowded second
        line. Line 2: support ratio on the left (it truncates first), coverage on the right — the visible
        signal for the gap this row-per-participant layout exists to surface. A trip bar rendered below
        can explain an otherwise-empty week without this reading as a failure.
      */}
      <div className="sticky left-0 z-10 flex min-h-[var(--row-h)] flex-col justify-center border-b border-r border-border bg-card px-2">
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to={`/participants/${row.participantId}`}
            className="block min-w-0 truncate rounded-sm font-display text-sm font-semibold leading-4 text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={row.fullName}
          >
            {row.fullName}
          </Link>
          {row.hasRestrictivePractice && (
            <span className="shrink-0 text-muted-foreground" role="img" aria-label="Restrictive practice authorised" title="Restrictive practice authorised">
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center justify-between gap-2 text-[13px] leading-4 text-muted-foreground">
          <span className="min-w-0 truncate">{RATIO_LABELS[row.supportRatio] ?? row.supportRatio} support</span>
          {hideCoverageBadge ? null : covered ? (
            <span className="shrink-0">Fully covered</span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-[var(--color-warning-container)] px-1.5 font-medium text-[var(--color-on-warning-container)]">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {row.daysWithoutCover} day{row.daysWithoutCover === 1 ? '' : 's'} uncovered
            </span>
          )}
        </div>
      </div>

      <div
        className="grid gap-x-1 gap-y-0.5 border-b border-border px-1"
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
            chipContext="participant"
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
