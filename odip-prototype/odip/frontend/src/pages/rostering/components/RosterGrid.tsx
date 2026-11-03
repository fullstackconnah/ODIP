import { useRef, type ReactNode, type RefObject } from 'react'
import type { RosterBoardDto, ShiftDto } from '@/api/types'
import { UnfilledLane } from './UnfilledLane'
import { StaffRow } from './StaffRow'
import { ParticipantRow } from './ParticipantRow'
import { formatDayHeader, isToday, ROSTER_DAY_COL_MIN, ROSTER_STICKY_COL_WIDTH, rosterDayColumnsTemplate } from '../lib/roster'

export type RosterGridProps = {
  board: RosterBoardDto
  canWrite: boolean
  unfilledOnly: boolean
  /** True when the whole (unfiltered) week has zero shifts — suppresses the per-row coverage badge, since every row being uncovered on an empty week is tautological noise the hint above the grid already covers. */
  weekHasNoShifts: boolean
  onOpenShift: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  /** Make or Stop the regular, from the chip menu (2026-10-16): on a pattern shift with a worker, for writers. Threaded like onUnassign. */
  onSetRegular?: (shift: ShiftDto) => void
  onDeleteShift: (shift: ShiftDto) => void
  onAddParticipantShift: (participantId: string, participantName: string, day: string) => void
  onAddStaffShift: (staffId: string, day: string) => void
  /** Roster drag and drop: the Participant view's rows get grips and drop targets. */
  draggable?: boolean
  /** The staff strip: rendered inside the sticky band, above the day header, so it stays in view through a drag. */
  strip?: ReactNode
}

/**
 * The sticky first column's width is a CSS variable set on the frame (BOARD_FRAME), not a constant, so
 * it can be wider where the screen has the room. Below 1500px it is lib/roster's ROSTER_STICKY_COL_WIDTH
 * (195px) — the fallback in the var(), i.e. exactly what the board had before, at every width it fits.
 * From 1500px it is 280px.
 *
 * Why 280: a participant row header is one line — name (plus the 12px restrictive-practice marker and its 4px
 * gap), ratio chip, coverage badge — and the row's identity is the name, so the width is sized to show the
 * longest fixture name whole. The coverage badge is a compact count (warning icon + one digit: a week has at
 * most 7 uncovered days) at every width, 35px; the ratio chip is 31px; two 8px gaps. That is 82px of chrome
 * beside the name. "Grace Palmer-Hughes" is 151px, 167px with its marker, so the content box (column - 1px
 * rule - 16px padding) needs 249px, i.e. a 266px column at the very least. 280px leaves ~14px spare (263px
 * of content, 181px for the name group); a longer name truncates, with its title. (It was 264px while the
 * coverage state was spelled out: "6 days uncovered" is a 110px pill, which left the name 90px and cut it to
 * "Grace Pa…".) Sizing by the badge and not by the wording is deliberate: widening to fit the words would
 * take 344px, and every pixel comes out of the seven day columns, where the shift chips already truncate.
 *
 * Why 1500: a week strip needs its 7 x 127px tracks plus 24px of gaps and 8px of padding = 921px, so the
 * board's true minimum is column + 921 + 2px frame border (280 -> 1203px). The board gets the viewport
 * less the 232px sidebar and 2 x 20px gutters (272px), plus ~17px for a classic scrollbar: 1203 + 272 +
 * 17 = 1492 — hence 1500. Below that the 195px column (1116px, fits from 1390px) stays. At 1920 the day
 * columns end up 191px wide, 2px less than with 264px.
 */
const STICKY_COL = `var(--roster-sticky-col, ${ROSTER_STICKY_COL_WIDTH}px)`
const GRID_TEMPLATE = { gridTemplateColumns: `${STICKY_COL} repeat(7, minmax(${ROSTER_DAY_COL_MIN}, 1fr))` }

/**
 * The week is the page (roster declutter, 2026-11-03): the WINDOW scrolls, never the board. The body frame has no height cap and scrolls sideways only (the Column Rule: a table wider than its box scrolls
 * sideways inside its own box). A sticky header only sticks to its nearest scroller and any overflow-x ancestor is one, so the day header is split off into its own band that sticks under the app bar,
 * with the staff strip above it; the two scrollers share one scrollLeft (Frames). `min-[1500px]:[--roster-sticky-col:280px]` is the wide-screen column width (see STICKY_COL), set on the root so both read it.
 */
const ROOT = 'min-[1500px]:[--roster-sticky-col:280px]'
// 3rem is the app bar (AppLayout), 9rem = that + the band (strip 52 + header 34, rounded up): a keyboard-focused chip never rests under the band.
const BAND = 'sticky top-[calc(3rem+var(--safe-top))] z-20 bg-[var(--color-background)]'
const HEAD_FRAME = 'overflow-x-auto overflow-y-hidden [scrollbar-width:none] rounded-t-[var(--radius-md)] border border-b-0 border-border'
const BODY_FRAME = 'overflow-x-auto overflow-y-hidden rounded-b-[var(--radius-md)] border border-t-0 border-border [&_:is(button,a,[tabindex])]:scroll-mt-36'
// Keeps a keyboard-focused chip from scrolling to rest underneath the pinned first column.
const BOARD_FRAME_STYLE = { scrollPaddingLeft: STICKY_COL }

type Scroller = RefObject<HTMLDivElement | null>
/** Copies one scroller's scrollLeft to the other only when they differ, so the pair never loops. */
const follow = (from: Scroller, to: Scroller) => {
  const a = from.current
  const b = to.current
  if (a && b && a.scrollLeft !== b.scrollLeft) b.scrollLeft = a.scrollLeft
}

/** The sticky band (strip + day header) over the uncapped body, shared by the board and its skeleton. */
function Frames({ strip, header, hidden, children }: { strip?: ReactNode; header: ReactNode; hidden?: boolean; children: ReactNode }) {
  const headRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <div className={ROOT} aria-hidden={hidden || undefined}>
      <div className={BAND}>
        {strip}
        <div ref={headRef} onScroll={() => follow(headRef, bodyRef)} className={HEAD_FRAME} style={BOARD_FRAME_STYLE}>
          <div className="grid" style={GRID_TEMPLATE}>{header}</div>
        </div>
      </div>
      <div ref={bodyRef} onScroll={() => follow(bodyRef, headRef)} className={BODY_FRAME} style={BOARD_FRAME_STYLE}>
        <div className="grid" style={GRID_TEMPLATE}>{children}</div>
      </div>
    </div>
  )
}

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
export function RosterGrid({ board, canWrite, unfilledOnly, weekHasNoShifts, onOpenShift, onAssignTo, onUnassign, onSetRegular, onDeleteShift, onAddParticipantShift, onAddStaffShift, draggable, strip }: RosterGridProps) {
  const { days } = board

  const header = (
    <>
      <div className={`sticky left-0 z-30 border-b border-r border-border ${HEADER_BG}`} />
      {/* The rows' own strip (gap-x-1 px-1), so each day's header sits exactly over that day's cells. */}
      <div className={`grid gap-x-1 border-b border-border px-1 ${HEADER_BG}`} style={{ gridColumn: '2 / -1', gridTemplateColumns: rosterDayColumnsTemplate(7) }}>
        {days.map(day => {
          const { weekday, day: dayNum } = formatDayHeader(day)
          return (
            <div key={day} className={`flex items-baseline gap-1.5 rounded-sm px-2 py-1.5 ${isToday(day) ? HEADER_BG_TODAY : ''}`}>
              <span className="text-sm font-semibold leading-5 text-foreground">{weekday}</span>
              <span className="text-[13px] tabular-nums text-muted-foreground">{dayNum}</span>
            </div>
          )
        })}
      </div>
    </>
  )

  return (
    <Frames strip={strip} header={header}>
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
              onSetRegular={onSetRegular}
              onDelete={onDeleteShift}
              onAddShift={onAddParticipantShift}
              hideCoverageBadge={weekHasNoShifts}
              draggable={draggable}
              pendingAgreement={board.pendingAgreements?.find(p => p.participantId === row.participantId)}
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
                onSetRegular={onSetRegular}
                onDelete={onDeleteShift}
                onAddShift={onAddStaffShift}
              />
            ))}
          </>
        )}
    </Frames>
  )
}

/**
 * Loading state — a skeleton grid whose rows match the real row height, no spinner. The column
 * template mirrors RosterGrid exactly so the layout doesn't jump once real data arrives.
 */
export function RosterGridSkeleton({ days }: { days: string[] }) {
  return (
    <Frames hidden header={(
      <>
        <div className={`sticky left-0 z-30 border-b border-r border-border ${HEADER_BG}`} />
        <div className={`grid gap-x-1 border-b border-border px-1 ${HEADER_BG}`} style={{ gridColumn: '2 / -1', gridTemplateColumns: rosterDayColumnsTemplate(7) }}>
          {days.map(day => (
            <div key={day} className="flex items-center px-2 py-1.5">
              <div className="h-5 w-16 animate-pulse rounded-sm bg-muted" />
            </div>
          ))}
        </div>
      </>
    )}>

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
    </Frames>
  )
}
