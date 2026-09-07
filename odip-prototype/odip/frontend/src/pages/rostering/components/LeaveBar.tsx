import type { LeaveBarDto } from '@/api/types'
import { clampedDayIndex } from '../lib/roster'

export type LeaveBarProps = {
  leave: LeaveBarDto
  days: string[]
}

/** Minutes-since-midnight as a 0–100 percentage of the full 24h day. There is no narrower
 * "visible business hours" window defined anywhere in the roster board today — every other bar
 * (TripBar, this component's own full-day branch) positions only at day granularity via
 * `gridColumn`, and RosterDayCell/ShiftChip render a shift as a whole day-cell chip with no
 * time-of-day width/left math at all — so this maps the full day rather than reusing a narrower
 * range that doesn't exist. */
function timeOfDayPercent(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return ((hours * 60 + minutes) / (24 * 60)) * 100
}

/**
 * Read-only leave/unavailability bar — muted and italic so it reads as background information,
 * not a task. `kind` distinguishes the sources StaffUnavailabilityQuery unions into this same
 * lane. ApprovedLeave and Legacy (pre-existing StaffAvailability Unavailable/Training rows)
 * render as today's solid full-day muted bar unchanged. PendingLeave renders the same full-day
 * bar with a dashed border and a "(pending)" suffix, since a shift over it only raises the soft,
 * no-reason-required STAFF_LEAVE_PENDING warning until a coordinator approves it. The label is
 * derived from `kind`, not `availabilityType`: the backend never sends the leave type on
 * LeaveBarDto for ApprovedLeave/PendingLeave (it compat-fills `availabilityType` with the
 * constant "Leave" for both), so only Legacy rows show their real `availabilityType` text (or
 * "Unavailable" when that's null). RecurringRule is different in kind, not just style: the spec
 * requires it to render as a **partial-day** bar, positioned/sized within its single occurrence
 * day in proportion to startTime/endTime, not a full-width bar with a text label. Its
 * single-weekday occurrence for the visible week arrives here as its own startDate === endDate
 * row — clampedDayIndex already clips that to exactly one grid column with no extra logic;
 * timeOfDayPercent (above) is new, since no hour-proportional positioning helper exists anywhere
 * in the roster board to reuse.
 */
export function LeaveBar({ leave, days }: LeaveBarProps) {
  const startCol = clampedDayIndex(leave.startDate, days) + 1
  const endCol = clampedDayIndex(leave.endDate, days) + 2

  if (leave.kind === 'RecurringRule' && leave.startTime && leave.endTime) {
    const leftPct = timeOfDayPercent(leave.startTime)
    // Floors the visible width so a very short window (e.g. 30 minutes, ~2% of a day) still
    // renders as a clickable/legible sliver instead of collapsing to near-nothing.
    const widthPct = Math.max(timeOfDayPercent(leave.endTime) - leftPct, 4)
    const windowLabel = `${leave.startTime.slice(0, 5)}–${leave.endTime.slice(0, 5)}`
    const title = leave.notes ?? `Unavailable ${windowLabel}`

    return (
      <div style={{ gridColumn: `${startCol} / ${endCol}` }} className="relative min-h-[1.75rem]">
        <div
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          className="absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded-sm bg-muted px-1 text-[11px] italic text-muted-foreground"
          title={title}
        >
          <span className="min-w-0 flex-1 truncate">{windowLabel}</span>
        </div>
      </div>
    )
  }

  const pending = leave.kind === 'PendingLeave'
  const baseLabel = leave.kind === 'Legacy' ? (leave.availabilityType ?? 'Unavailable') : 'Leave'
  const label = pending ? `${baseLabel} (pending)` : baseLabel

  return (
    <div
      style={{ gridColumn: `${startCol} / ${endCol}` }}
      className={`flex items-center gap-1.5 rounded-sm px-2 py-1.5 text-xs italic text-muted-foreground ${
        pending ? 'border border-dashed border-muted-foreground bg-muted/40' : 'bg-muted'
      }`}
      title={leave.notes ?? label}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  )
}
