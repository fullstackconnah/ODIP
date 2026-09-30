import type { RosterBoardDto, ShiftDto } from '@/api/types'
import { UnfilledLane } from './UnfilledLane'
import { StaffRow } from './StaffRow'
import { ParticipantRow } from './ParticipantRow'
import { formatDayHeader, isToday, ROSTER_GRID_TEMPLATE_COLUMNS, ROSTER_STICKY_COL_WIDTH, rosterDayColumnsTemplate } from '../lib/roster'

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
 * The board's scroll frame. From md up it is height-capped so the board scrolls INSIDE it and the day
 * header row genuinely stays pinned: a sticky header only sticks to its nearest scroller, and this
 * wrapper used to be one with no height limit, so `top-0` never engaged. The sticky first column pins
 * horizontally in the same frame. 11.5rem is the page chrome above the board (app bar, header, toolbar)
 * plus the bottom gutter; the 20rem floor keeps a short window usable.
 */
const BOARD_FRAME = 'overflow-auto scroll-pt-9 rounded-[var(--radius-md)] border border-border md:max-h-[max(20rem,calc(100dvh_-_11.5rem))]'
// Keeps a keyboard-focused chip from scrolling to rest underneath the pinned first column.
const BOARD_FRAME_STYLE = { scrollPaddingLeft: ROSTER_STICKY_COL_WIDTH }

// Opaque tints on purpose: the header row is sticky, so anything scrolling underneath must not show
// through it. (`bg-primary/5` alone is translucent, and stacked with bg-surface-container-low the two
// fought over the same property.)
const HEADER_BG = 'bg-surface-container-low'
const HEADER_BG_TODAY = 'bg-[color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface-container-low))]'

/**
 * Always renders the full grid, participant × day or staff × day — a week with no shifts still
 * shows every row with empty cells, since the empty grid is itself the add-a-shift affordance.
 * Never swap this out for an empty state; guidance for a first-time/empty week belongs in a
 * dismissible hint the caller renders above this component.
 */
export function RosterGrid({ board, canWrite, unfilledOnly, weekHasNoShifts, onOpenShift, onAssignTo, onUnassign, onDeleteShift, onAddParticipantShift, onAddStaffShift }: RosterGridProps) {
  const { days } = board

  return (
    <div className={BOARD_FRAME} style={BOARD_FRAME_STYLE}>
      <div className="grid" style={GRID_TEMPLATE}>
        {/* Header row */}
        <div className={`sticky left-0 top-0 z-30 border-b border-r border-border ${HEADER_BG}`} />
        {days.map(day => {
          const { weekday, day: dayNum } = formatDayHeader(day)
          return (
            <div
              key={day}
              className={`sticky top-0 z-20 flex items-baseline gap-1.5 border-b border-border px-3 py-1.5 ${isToday(day) ? HEADER_BG_TODAY : HEADER_BG}`}
            >
              <span className="text-sm font-semibold leading-5 text-foreground">{weekday}</span>
              <span className="text-[13px] tabular-nums text-muted-foreground">{dayNum}</span>
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
    <div className={BOARD_FRAME} style={BOARD_FRAME_STYLE} aria-hidden="true">
      <div className="grid" style={GRID_TEMPLATE}>
        <div className={`sticky left-0 top-0 z-30 border-b border-r border-border ${HEADER_BG}`} />
        {days.map(day => (
          <div key={day} className={`sticky top-0 z-20 flex items-center border-b border-border px-3 py-1.5 ${HEADER_BG}`}>
            <div className="h-5 w-16 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}

        {Array.from({ length: 5 }, (_, rowIdx) => (
          <div key={rowIdx} className="contents">
            <div className="sticky left-0 z-10 flex min-h-[var(--row-h)] flex-col justify-center gap-1 border-b border-r border-border bg-card px-2">
              <div className="h-3.5 w-28 animate-pulse rounded-sm bg-muted" />
              <div className="h-3 w-16 animate-pulse rounded-sm bg-muted" />
            </div>
            <div className="col-span-7 grid gap-x-1 border-b border-border px-1" style={{ gridTemplateColumns: rosterDayColumnsTemplate(7) }}>
              {days.map(day => (
                <div key={day} className="flex min-h-[calc(var(--row-h)_-_1px)] items-center rounded-sm px-0.5 py-0.5">
                  {rowIdx % 3 === 0 && <div className="h-[calc(var(--row-h)_-_6px)] w-full animate-pulse rounded-sm bg-muted" />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
