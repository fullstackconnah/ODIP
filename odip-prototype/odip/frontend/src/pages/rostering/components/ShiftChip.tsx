import { useDraggable } from '@dnd-kit/core'
import { AlertOctagon, AlertTriangle, GripVertical, MoreVertical, ShieldCheck } from 'lucide-react'
import type { RosterFindingDto, ShiftDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { formatShiftRange, RATIO_LABELS } from '../lib/roster'

/**
 * Accessible name for the severity marker — states the severity(s) present and their counts, so
 * a screen-reader user gets the same information the icon/colour distinction conveys visually.
 * Mirrors the Blocking-vs-Warning language used in FindingsList and ExceptionsDrawer.
 */
function findingsSeverityLabel(findings: RosterFindingDto[]): string {
  const blockingCount = findings.filter(f => f.severity === 'Blocking').length
  const warningCount = findings.filter(f => f.severity === 'Warning').length
  const parts: string[] = []
  if (blockingCount > 0) parts.push(`${blockingCount} blocking ${blockingCount === 1 ? 'issue' : 'issues'}`)
  if (warningCount > 0) parts.push(`${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`)
  return parts.join(', ')
}

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
  const hasBlocking = shift.findings.some(f => f.severity === 'Blocking')
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
      className={`group relative flex items-stretch gap-0.5 rounded-sm border bg-surface-container-low text-xs transition-opacity duration-150 ${
        dashed ? 'border-dashed border-border' : 'border-border'
      } ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Drag activation lives on its own handle, separate from the open button below. Both used
          to share one element with dnd-kit's listeners spread onto the same button that opens the
          shift — since the KeyboardSensor's default activator keys are Space/Enter, that silently
          turned "open this shift" into "start a keyboard drag" for anyone tabbing to the chip.
          Splitting them keeps keyboard drag working (from the handle) without hijacking Enter on
          the primary control. */}
      {canWrite && (
        <button
          type="button"
          className="flex shrink-0 cursor-grab touch-none items-center rounded-sm px-1 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
          aria-label={`Drag to move ${subjectLabel}'s shift`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      {/* The full visible card padding lives on this button (not the outer wrapper) so the
          tappable area matches what's visually presented — previously the padding sat on the
          non-interactive wrapper div, leaving a hit target of only ~96×16px against a visibly
          larger card. */}
      <button
        type="button"
        onClick={() => onOpen(shift)}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {hasFindings && (
          <span
            className="shrink-0"
            role="img"
            aria-label={findingsSeverityLabel(shift.findings)}
            title={findingsSeverityLabel(shift.findings)}
          >
            {hasBlocking ? (
              <AlertOctagon className="h-3 w-3 text-destructive" aria-hidden="true" />
            ) : (
              // Amber-700, not the --color-warning token: the token (#f59e0b) measures 1.94:1
              // against this chip's surface-container-low background, failing WCAG 1.4.11's 3:1
              // minimum for a graphical object conveying meaning. This value clears it at 4.53:1
              // while still reading as amber. Scoped to this marker only — --color-warning itself
              // is used elsewhere (progress meter, badges) and isn't part of this fix.
              <AlertTriangle className="h-3 w-3 text-[#b45309]" aria-hidden="true" />
            )}
          </span>
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
        {shift.overrideReason && (
          <span
            className="shrink-0 text-muted-foreground"
            role="img"
            aria-label={`Assigned with an override: ${shift.overrideReason}`}
            title={`Assigned with an override: ${shift.overrideReason}`}
          >
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </button>

      {canWrite && (
        <span className="flex shrink-0 items-center pr-1">
          <Dropdown
            variant="icon"
            icon={<MoreVertical className="h-3.5 w-3.5" />}
            label={`Actions for ${subjectLabel}'s shift`}
            items={menuItems}
            onSelect={handleMenuSelect}
          />
        </span>
      )}
    </div>
  )
}
