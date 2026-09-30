import { useDroppable } from '@dnd-kit/core'
import type { ShiftDto } from '@/api/types'
import { ShiftChip } from './ShiftChip'
import { isToday, rosterDayColumnsTemplate } from '../lib/roster'

export type UnfilledLaneProps = {
  days: string[]
  shifts: ShiftDto[]
  canWrite: boolean
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
}

/**
 * Pinned as the first row of the grid — shifts with staffId === null, so a coordinator sees
 * what needs filling before anything else. Chips are dashed and show what the shift requires
 * (participant, time, ratio) since there's no staff name to lead with.
 */
export function UnfilledLane({ days, shifts, canWrite, onOpen, onAssignTo, onDelete }: UnfilledLaneProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'unassign-target', disabled: !canWrite })

  return (
    <>
      <div className="sticky left-0 z-10 flex min-h-[var(--row-h)] items-center border-b border-r border-border bg-surface-container px-2 text-sm font-semibold text-foreground">
        Unfilled
        {shifts.length > 0 && (
          <span className="ml-2 rounded-sm bg-secondary-container px-1.5 py-0.5 text-xs font-medium text-foreground">
            {shifts.length}
          </span>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`grid gap-x-1 gap-y-0.5 border-b border-border px-1 transition-colors duration-150 ${isOver ? 'bg-secondary-container/40' : 'bg-surface-container'}`}
        style={{ gridColumn: '2 / -1', gridTemplateColumns: rosterDayColumnsTemplate(days.length) }}
      >
        {days.map((day, i) => (
          <div key={day} style={{ gridColumn: i + 1, gridRow: 1 }} className={`flex min-h-[calc(var(--row-h)_-_1px)] flex-col justify-center gap-1 rounded-sm px-0.5 py-0.5 ${isToday(day) ? 'bg-primary/5' : ''}`}>
            {shifts
              .filter(s => s.serviceDate === day)
              .map(shift => (
                <ShiftChip
                  key={shift.id}
                  shift={shift}
                  canWrite={canWrite}
                  dashed
                  onOpen={onOpen}
                  onAssignTo={onAssignTo}
                  onUnassign={() => {}}
                  onDelete={onDelete}
                />
              ))}
          </div>
        ))}
      </div>
    </>
  )
}
