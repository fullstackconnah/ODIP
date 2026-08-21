import { useDraggable } from '@dnd-kit/core'
import { MoreVertical } from 'lucide-react'
import type { ShiftDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { formatShiftRange, RATIO_LABELS } from '../lib/roster'

export type ShiftChipProps = {
  shift: ShiftDto
  canWrite: boolean
  /** Unfilled-lane chips render dashed, since they represent a need rather than a booked shift. */
  dashed?: boolean
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
}

/**
 * The one chip type rendered both in staff rows and the Unfilled lane. Colour is reserved for
 * "something is wrong" — a healthy chip is a neutral surface; only the warning dot and the
 * dashed/unfilled variant carry meaning.
 */
export function ShiftChip({ shift, canWrite, dashed, onOpen, onAssignTo, onUnassign, onDelete }: ShiftChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
    data: { shift },
    disabled: !canWrite,
  })

  const hasFindings = shift.findings.length > 0
  const showRatio = shift.ratio !== 'OneToOne'
  const subjectLabel = shift.participantName

  const menuItems = [
    { value: 'edit', label: 'Edit' },
    { value: 'assign', label: dashed || !shift.staffId ? 'Assign to…' : 'Reassign to…' },
    ...(shift.staffId ? [{ value: 'unassign', label: 'Unassign' }] : []),
    { value: 'delete', label: 'Delete' },
  ]

  function handleMenuSelect(value: string) {
    if (value === 'edit') onOpen(shift)
    else if (value === 'assign') onAssignTo(shift)
    else if (value === 'unassign') onUnassign(shift)
    else if (value === 'delete') onDelete(shift)
  }

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 } : undefined}
      className={`group relative flex items-center gap-1.5 rounded-sm border bg-surface-container-low px-2 py-1.5 text-xs transition-opacity duration-150 ${
        dashed ? 'border-dashed border-border' : 'border-border'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      <button
        type="button"
        onClick={() => onOpen(shift)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        {...(canWrite ? listeners : {})}
        {...(canWrite ? attributes : {})}
      >
        {hasFindings && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]"
            aria-hidden="true"
            title={`${shift.findings.length} finding${shift.findings.length === 1 ? '' : 's'}`}
          />
        )}
        <span className="shrink-0 font-medium tabular-nums text-foreground">
          {formatShiftRange(shift.startTime, shift.endTime, shift.endsNextDay)}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={subjectLabel}>
          {subjectLabel}
        </span>
        {showRatio && (
          <span className="shrink-0 rounded-sm bg-secondary-container px-1 py-0.5 text-[10px] font-medium text-foreground">
            {RATIO_LABELS[shift.ratio] ?? shift.ratio}
          </span>
        )}
      </button>

      {canWrite && (
        <Dropdown
          variant="icon"
          icon={<MoreVertical className="h-3.5 w-3.5" />}
          label={`Actions for ${subjectLabel}'s shift`}
          items={menuItems}
          onSelect={handleMenuSelect}
        />
      )}
    </div>
  )
}
