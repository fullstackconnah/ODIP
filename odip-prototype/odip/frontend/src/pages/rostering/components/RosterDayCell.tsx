import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import type { ShiftDto } from '@/api/types'
import type { DayTarget } from '../lib/rosterDrag'
import { ShiftChip, type ShiftChipContext } from './ShiftChip'
import { isToday } from '../lib/roster'

export type RosterDayCellProps = {
  day: string
  dayIndex: number
  shifts: ShiftDto[]
  canWrite: boolean
  /** Accessible name for the add-shift button, e.g. "Add a shift for Mia Chen on Wednesday 19 August". */
  addLabel: string
  /** Which kind of row hosts this cell — forwarded to each chip so it labels the person the row doesn't already name. Defaults to a staff row. */
  chipContext?: ShiftChipContext
  /** Roster drag and drop: forwarded to each chip (grip, lock, drop target). */
  draggable?: boolean
  /** Set by a participant row while drag and drop is on: an empty writable cell is a drop target, and an occupied one shows a new-shift slot while a person is carried; a drop on either opens the create form for this participant and day. */
  dayTarget?: DayTarget
  onAdd: () => void
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
}

/**
 * One day cell within a participant or staff row — shared so both grouping modes get the same
 * add-shift affordance. An empty, writable cell renders as a real button: the primary way to add
 * a shift now that the grid never hides itself. It stays visually quiet at rest (the plus glyph
 * is transparent) and only reveals itself on hover/focus, so a full week of empty cells doesn't
 * read as a grid of shouting buttons. A cell that already has shifts, or is read-only, renders
 * the plain static cell it always has.
 *
 * Height is the board row: a cell is at least `--row-h` less the 1px row rule, so a week with no
 * shifts is 34px at a fine pointer, 48px under `pointer: coarse`. A chip is 56px (68px coarse, see
 * ShiftChip), so a day with a shift grows its row to 61px (73px), and one with several grows it more.
 */
export function RosterDayCell({ day, dayIndex, shifts, canWrite, addLabel, chipContext, draggable, dayTarget, onAdd, onOpen, onAssignTo, onUnassign, onDelete }: RosterDayCellProps) {
  const style = { gridColumn: dayIndex + 1, gridRow: 1 }
  // One target per day (the brief, section 7): the whole of an empty cell, as before; on a day that has pucks, the new-shift slot below, which exists only while a person is carried.
  // The chips stay targets of their own, so a drop on a chip keeps its outcome.
  const { setNodeRef, isOver, active } = useDroppable({
    id: `drop-day:${dayTarget?.participantId ?? ''}:${day}`,
    data: dayTarget && shifts.length > 0 ? { ...dayTarget, beside: shifts.length } : dayTarget,
    disabled: !dayTarget || !canWrite,
  })
  const base = `flex min-h-[calc(var(--row-h)_-_1px)] flex-col justify-center gap-1 rounded-sm px-0.5 py-0.5 ${isToday(day) ? 'bg-primary/5' : ''}`

  if (shifts.length === 0 && canWrite) {
    return (
      <button
        ref={setNodeRef}
        type="button"
        style={style}
        onClick={onAdd}
        aria-label={addLabel}
        // While a person is carried over it: its own hover look plus a dashed olive outline. While a person is carried anywhere: its Plus in muted ink, so the drop zones show before the pointer gets there (the chip brief, section 6).
        className={`${base} group items-center transition-colors duration-150 hover:bg-accent/60 hover:text-muted-foreground focus:outline-none focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          isOver ? 'bg-accent/60 text-muted-foreground outline-2 -outline-offset-2 outline-dashed outline-ring' : dayTarget && active ? 'text-muted-foreground' : 'text-transparent'
        }`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )
  }

  // While a person is carried, every chip here drops its menu column (ShiftChip) and the day takes exactly that room at its trailing edge, so no chip's text moves and no row grows.
  // The room is the menu's 2px pad plus a --control-h-sm button.
  const carrying = Boolean(dayTarget) && canWrite && Boolean(active)
  return (
    <div style={style} className={`${base} relative ${carrying ? 'pr-[calc(var(--control-h-sm)_+_4px)]' : ''}`}>
      {shifts.map(shift => (
        <ShiftChip
          key={shift.id}
          shift={shift}
          canWrite={canWrite}
          dashed={!shift.staffId}
          context={chipContext}
          draggable={draggable}
          onOpen={onOpen}
          onAssignTo={onAssignTo}
          onUnassign={onUnassign}
          onDelete={onDelete}
        />
      ))}
      {carrying && (
        // At rest a muted Plus, the empty cell's own glyph, with no box: a week of dashed boxes would shout. Over it, the empty day's over look: a dashed outline, not a chip's solid ring.
        <div
          ref={setNodeRef}
          data-day-slot={day}
          aria-hidden="true"
          className={`absolute inset-y-0.5 right-0.5 flex w-[calc(var(--control-h-sm)_+_2px)] items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 ${
            isOver ? 'bg-accent/60 outline-2 -outline-offset-2 outline-dashed outline-ring' : ''
          }`}
        >
          <Plus className="h-3 w-3" />
        </div>
      )}
    </div>
  )
}
