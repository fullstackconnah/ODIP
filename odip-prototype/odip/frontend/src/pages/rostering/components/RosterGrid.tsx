import type { RosterBoardDto, ShiftDto } from '@/api/types'
import { UnfilledLane } from './UnfilledLane'
import { StaffRow } from './StaffRow'
import { ParticipantRow } from './ParticipantRow'
import { formatDayHeader, isToday, ROSTER_GRID_TEMPLATE_COLUMNS, rosterDayColumnsTemplate } from '../lib/roster'

export type RosterGridProps = {
  board: RosterBoardDto
  canWrite: boolean
  unfilledOnly: boolean
  /** True when the whole (unfiltered) week has zero shifts — suppresses the per-row coverage badge, since every row being uncovered on an empty week is tautological noise the hint above the grid already covers. */
  weekHasNoShifts: boolean
  onOpenShift: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDeleteShift: (shift: ShiftDto) => void
  onAddParticipantShift: (participantId: string, participantName: string, day: string) => void
  onAddStaffShift: (staffId: string, day: string) => void
}

const GRID_TEMPLATE = { gridTemplateColumns: ROSTER_GRID_TEMPLATE_COLUMNS }

/**
 * Always renders the full grid, participant × day or staff × day — a week with no shifts still
 * shows every row with empty cells, since the empty grid is itself the add-a-shift affordance.
 * Never swap this out for an empty state; guidance for a first-time/empty week belongs in a
 * dismissible hint the caller renders above this component.
 */
export function RosterGrid({ board, canWrite, unfilledOnly, weekHasNoShifts, onOpenShift, onAssignTo, onUnassign, onDeleteShift, onAddParticipantShift, onAddStaffShift }: RosterGridProps) {
  const { days } = board

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <div className="grid" style={GRID_TEMPLATE}>
        {/* Header row */}
        <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-container-low" />
        {days.map(day => {
          const { weekday, day: dayNum } = formatDayHeader(day)
          return (
            <div
              key={day}
              className={`sticky top-0 z-20 flex items-baseline gap-1.5 border-b border-border bg-surface-container-low px-3 py-2 ${isToday(day) ? 'bg-primary/5' : ''}`}
            >
              <span className="text-sm font-semibold text-foreground">{weekday}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{dayNum}</span>
            </div>
          )
        })}

        {board.groupBy === 'Participant' ? (
          board.participantRows.map(row => (
            <ParticipantRow
              key={row.participantId}
              row={row}
              days={days}
              canWrite={canWrite}
              onOpen={onOpenShift}
              onAssignTo={onAssignTo}
              onUnassign={onUnassign}
              onDelete={onDeleteShift}
              onAddShift={onAddParticipantShift}
              hideCoverageBadge={weekHasNoShifts}
            />
          ))
        ) : (
          <>
            <UnfilledLane
              days={days}
              shifts={board.unfilled}
              canWrite={canWrite}
              onOpen={onOpenShift}
              onAssignTo={onAssignTo}
              onDelete={onDeleteShift}
            />

            {!unfilledOnly && board.staffRows.map(row => (
              <StaffRow
                key={row.staffId}
                row={row}
                days={days}
                canWrite={canWrite}
                onOpen={onOpenShift}
                onAssignTo={onAssignTo}
                onUnassign={onUnassign}
                onDelete={onDeleteShift}
                onAddShift={onAddStaffShift}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Loading state — a skeleton grid whose rows match the real row height, no spinner. The column
 * template mirrors RosterGrid exactly so the layout doesn't jump once real data arrives.
 */
export function RosterGridSkeleton({ days }: { days: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border" aria-hidden="true">
      <div className="grid" style={GRID_TEMPLATE}>
        <div className="sticky left-0 top-0 z-30 border-b border-r border-border bg-surface-container-low" />
        {days.map(day => (
          <div key={day} className="sticky top-0 z-20 border-b border-border bg-surface-container-low px-3 py-2">
            <div className="h-4 w-16 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}

        {Array.from({ length: 5 }, (_, rowIdx) => (
          <div key={rowIdx} className="contents">
            <div className="sticky left-0 z-10 flex flex-col gap-2 border-b border-r border-border bg-card px-4 py-2.5">
              <div className="h-3.5 w-28 animate-pulse rounded-sm bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded-sm bg-muted" />
              <div className="h-1 w-full animate-pulse rounded-sm bg-muted" />
            </div>
            <div className="col-span-7 grid gap-1 border-b border-border p-1" style={{ gridTemplateColumns: rosterDayColumnsTemplate(7) }}>
              {days.map(day => (
                <div key={day} className="min-h-[2.25rem] rounded-sm p-0.5">
                  {rowIdx % 3 === 0 && <div className="h-6 w-full animate-pulse rounded-sm bg-muted" />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
