import { Link } from 'react-router-dom'
import { Check, Hourglass, ShieldAlert, UserPlus } from 'lucide-react'
import type { PendingAgreementDto, RosterParticipantRowDto, ShiftDto } from '@/api/types'
import { RosterDayCell } from './RosterDayCell'
import { ReadinessTrigger } from './ReadinessTrigger'
import { TripBar } from './TripBar'
import { barOverlapsWeek, formatDayAccessibleName, isUnfilledShift, participantWeekHref, RATIO_LABELS, rosterDayColumnsTemplate } from '../lib/roster'
import { plural } from '@/lib/format'

export type ParticipantRowProps = {
  row: RosterParticipantRowDto
  days: string[]
  canWrite: boolean
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  /** Make or Stop the regular, from the chip menu (2026-10-16): on a pattern shift with a worker, for writers. Threaded like onUnassign. */
  onSetRegular?: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
  onAddShift: (participantId: string, participantName: string, day: string) => void
  /** True when the whole board has zero shifts this week — the hint above the grid already covers this empty state, so suppress the repeated row badge. */
  hideCoverageBadge: boolean
  /** Roster drag and drop (the Participant view, md up, writers): grips, locks and drop targets on this row's pucks, and its empty days as drop targets. */
  draggable?: boolean
  /** This participant's newest agreement waits for an approval for rostering (the board's pendingAgreements): the row says so with its Hourglass. */
  pendingAgreement?: PendingAgreementDto
}

/**
 * The default board row — one per active participant, with or without shifts. An empty row is a
 * visible coverage gap, which is the point (see the pass-2 spec). Unfilled shifts (staffId null)
 * live inline on the day they fall on, rendered dashed by RosterDayCell/ShiftChip — there is no
 * separate Unfilled lane here, that stays a staff-view concept.
 */
export function ParticipantRow({ row, days, canWrite, onOpen, onAssignTo, onUnassign, onSetRegular, onDelete, onAddShift, hideCoverageBadge, draggable, pendingAgreement }: ParticipantRowProps) {
  const visibleTripBars = row.tripBars.filter(t => barOverlapsWeek(t.startDate, t.endDate, days))
  const unassignedCount = row.shifts.filter(isUnfilledShift).length
  const covered = unassignedCount === 0
  const ratioLabel = RATIO_LABELS[row.supportRatio] ?? row.supportRatio
  const uncoveredLabel = plural(unassignedCount, 'unassigned shift')
  // Same test as the trigger itself: any listed issue, or Enforce.
  const hasTrigger = row.notReadyForRostering === true || (row.readinessIssues?.length ?? 0) > 0

  return (
    <>
      {/*
        Row header: two tight lines inside the --row-h row, as StaffRow does (leading-4 name, h-4 chips: 32px in a 34px row).
        Line 1 is the name, which gets the column's full width and truncates with a title, then the restrictive-practice
        marker (a safety signal, so it must survive) and the pending-agreement hourglass, both shrink-0 glyphs.
        Line 2 is the readiness trigger on the left (ReadinessTrigger: one whole word, "Not ready" or "Blocked", that opens a peek
        panel with the full reason, so it never truncates) and, pushed right, the Onboarding tag, the support ratio and the coverage
        state. The tag is drawn only while the row is ready: beside the trigger it would not fit 195px, so its sentence moves into the
        trigger's name and panel. The ratio and badge never shrink, so they form one right-aligned column down the board. Coverage is the
        visible signal for the gap this row-per-participant layout exists to surface; a trip bar rendered below can explain an
        otherwise-empty week without this reading as a failure. It is a COUNT BADGE (a person-plus, the glyph of the "Needs staff"
        pucks in the row, and the number of unassigned shifts, or a check when fully covered); the words are its title and aria-label,
        with no sr-only text (a 1px clip box reads as clipped text in an audit). On touch the trigger's 44px tap pad needs room: the
        header gets gap-y-3 between its lines and pb-3 below, only on a row that has a trigger.
      */}
      <div className={`sticky left-0 z-10 flex min-h-[var(--row-h)] flex-col justify-center border-b border-r border-border bg-card px-2 pointer-coarse:gap-y-3${hasTrigger ? ' pointer-coarse:pb-3' : ''}`}>
        <div className="flex min-w-0 items-center gap-1">
          <Link
            to={participantWeekHref(row.participantId, days[0])}
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
          {pendingAgreement && (
            // Its shifts are not on the board yet (spec 2026-10-15). A glyph only: at 195px the words would cost the name its room, so they are its title and accessible name, as the coverage
            // badge does. The notice above prints them, with the same Hourglass. Neutral: an unapproved revision is a Draft.
            <span
              className="shrink-0 text-muted-foreground"
              role="img"
              aria-label={`Agreement v${pendingAgreement.version} not approved: its shifts appear once it's approved for rostering`}
              title={`Agreement v${pendingAgreement.version} not approved: its shifts appear once it's approved for rostering`}
            >
              <Hourglass className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <ReadinessTrigger issues={row.readinessIssues} blocked={row.notReadyForRostering} onboarding={row.inOnboarding} />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {row.inOnboarding && !hasTrigger && (
              <span title="Services started; onboarding is still open" className="inline-flex h-4 items-center rounded-sm bg-[var(--color-secondary-container)] px-1.5 text-xs font-medium text-[var(--color-secondary)]">
                <span>Onboarding</span>
              </span>
            )}
            <span
              role="img"
              aria-label={`${ratioLabel} support`}
              title={`${ratioLabel} support`}
              className="inline-flex h-4 items-center rounded-sm shrink-0 bg-surface-container px-1.5 text-xs font-semibold tabular-nums text-foreground"
            >
              {ratioLabel}
            </span>
            {hideCoverageBadge ? null : (
              <span className="inline-flex w-11 shrink-0 justify-end">
              {covered ? (
              <span role="img" aria-label="Fully covered" title="Fully covered" className="inline-flex shrink-0 items-center text-muted-foreground">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            ) : (
              <span
                role="img"
                aria-label={uncoveredLabel}
                title={uncoveredLabel}
                className="inline-flex h-4 shrink-0 items-center gap-1 rounded-sm bg-[var(--color-warning-container)] px-1.5 text-xs font-medium text-[var(--color-on-warning-container)]"
              >
                <UserPlus className="h-3 w-3" aria-hidden="true" />
                <span className="tabular-nums">{unassignedCount}</span>
              </span>
            )}
              </span>
            )}
          </div>
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
            draggable={draggable}
            dayTarget={draggable ? { kind: 'day', participantId: row.participantId, participantName: row.fullName, day } : undefined}
            onAdd={() => onAddShift(row.participantId, row.fullName, day)}
            onOpen={onOpen}
            onAssignTo={onAssignTo}
            onUnassign={onUnassign}
            onSetRegular={onSetRegular}
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
