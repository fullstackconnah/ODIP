import { Plus } from 'lucide-react'
import type { ShiftDto } from '@/api/types'
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
 * Height is the board row: a cell is `--row-h` less the 1px row rule, chips are `--row-h` less 6px
 * (see ShiftChip) and centred in it, so a one-shift row is exactly `--row-h` — 34px at a fine
 * pointer, 48px under `pointer: coarse`. A day with several shifts simply grows the row.
 */
export function RosterDayCell({ day, dayIndex, shifts, canWrite, addLabel, chipContext, onAdd, onOpen, onAssignTo, onUnassign, onDelete }: RosterDayCellProps) {
  const style = { gridColumn: dayIndex + 1, gridRow: 1 }
  const base = `flex min-h-[calc(var(--row-h)_-_1px)] flex-col justify-center gap-1 rounded-sm px-0.5 py-0.5 ${isToday(day) ? 'bg-primary/5' : ''}`

  if (shifts.length === 0 && canWrite) {
    return (
      <button
        type="button"
        style={style}
        onClick={onAdd}
        aria-label={addLabel}
        className={`${base} group items-center text-transparent transition-colors duration-150 hover:bg-accent/60 hover:text-muted-foreground focus:outline-none focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    )
  }

  return (
    <div style={style} className={base}>
      {shifts.map(shift => (
        <ShiftChip
          key={shift.id}
          shift={shift}
          canWrite={canWrite}
          dashed={!shift.staffId}
          context={chipContext}
          onOpen={onOpen}
          onAssignTo={onAssignTo}
          onUnassign={onUnassign}
          onDelete={onDelete}
        />
      ))}
    </div>
  )
}
