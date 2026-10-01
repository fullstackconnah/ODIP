import { Link } from 'react-router-dom'
import { AlertTriangle, Check, ShieldAlert } from 'lucide-react'
import type { RosterParticipantRowDto, ShiftDto } from '@/api/types'
import { RosterDayCell } from './RosterDayCell'
import { TripBar } from './TripBar'
import { barOverlapsWeek, formatDayAccessibleName, RATIO_LABELS, rosterDayColumnsTemplate } from '../lib/roster'
import { plural } from '@/lib/format'

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
  const ratioLabel = RATIO_LABELS[row.supportRatio] ?? row.supportRatio
  const uncoveredLabel = `${plural(row.daysWithoutCover, 'day')} uncovered`

  return (
    <>
      {/*
        Row header: ONE line inside the --row-h row — name, then the support ratio as a chip, then the
        coverage state, in that order. The name group (participant link + the restrictive-practice marker,
        which is a safety signal and must survive) takes whatever width is left and truncates with a title;
        the ratio chip and the coverage badge are shrink-0, so neither is ever squeezed or cut, and `gap-2`
        keeps the name from touching them. Coverage is the visible signal for the gap this row-per-participant
        layout exists to surface. A trip bar rendered below can explain an otherwise-empty week without this
        reading as a failure.

        The coverage state is a COUNT BADGE at every column width: a warning icon and the number of uncovered
        days on the amber tint, or a check when the week is fully covered. The words ("6 days uncovered",
        "Fully covered") are the badge's title and aria-label, not text in the row. They used to be spelled out
        in the wide column, and that is what cost the row its identity: 110px of "6 days uncovered" plus the 31px
        ratio chip and two 8px gaps left 90px of the 247px content box for the name, so "Grace Palmer-Hughes"
        (151px, plus the 12px restrictive-practice marker and its 4px gap = 167px) read "Grace Pa…" while the
        same three words repeated down every row. The 35px count badge leaves 165px of the 247px box at the old
        264px column and 181px at RosterGrid's 280px one, so a name up to ~167px shows whole with its marker
        (a longer one truncates, with its title). Below 1500px the 195px column keeps the same badge and gives
        the name ~96px, as it always did. There is no visually-hidden (sr-only) text: those 1px clip boxes are
        what a "clipped without an ellipsis" audit reports, and role="img" + aria-label announces the same thing.
      */}
      <div className="sticky left-0 z-10 flex min-h-[var(--row-h)] items-center gap-2 border-b border-r border-border bg-card px-2">
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to={`/participants/${row.participantId}`}
            className="block min-w-0 truncate rounded-sm font-display text-sm font-semibold leading-5 text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span
            role="img"
            aria-label={`${ratioLabel} support`}
            title={`${ratioLabel} support`}
            className="inline-flex h-5 items-center rounded-sm bg-surface-container px-1.5 text-xs font-semibold tabular-nums text-foreground"
          >
            {ratioLabel}
          </span>
          {hideCoverageBadge ? null : covered ? (
            <span role="img" aria-label="Fully covered" title="Fully covered" className="inline-flex items-center text-muted-foreground">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : (
            <span
              role="img"
              aria-label={uncoveredLabel}
              title={uncoveredLabel}
              className="inline-flex h-5 items-center gap-1 rounded-sm bg-[var(--color-warning-container)] px-1.5 text-xs font-medium text-[var(--color-on-warning-container)]"
            >
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              <span className="tabular-nums">{row.daysWithoutCover}</span>
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
