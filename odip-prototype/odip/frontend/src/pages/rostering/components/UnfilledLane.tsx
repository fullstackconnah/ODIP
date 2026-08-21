import { useDroppable } from '@dnd-kit/core'
import type { ShiftDto } from '@/api/types'
import { ShiftChip } from './ShiftChip'
import { isToday } from '../lib/roster'

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
      <div className="sticky left-0 z-10 flex items-center border-b border-r border-border bg-surface-container px-4 py-2 text-sm font-semibold text-foreground">
        Unfilled
        {shifts.length > 0 && (
          <span className="ml-2 rounded-sm bg-secondary-container px-1.5 py-0.5 text-[10px] font-medium text-foreground">
            {shifts.length}
          </span>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={`grid gap-1 border-b border-border bg-surface-container p-1 transition-colors duration-150 ${isOver ? 'bg-secondary-container/40' : ''}`}
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(150px, 1fr))` }}
      >
        {days.map((day, i) => (
          <div key={day} style={{ gridColumn: i + 1, gridRow: 1 }} className={`flex min-h-[2.25rem] flex-col gap-1 rounded-sm p-0.5 ${isToday(day) ? 'bg-primary/5' : ''}`}>
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
