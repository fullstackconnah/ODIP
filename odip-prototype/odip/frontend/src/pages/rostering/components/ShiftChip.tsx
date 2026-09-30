import { Link } from 'react-router-dom'
import { useDraggable } from '@dnd-kit/core'
import { AlertOctagon, AlertTriangle, CalendarOff, GripVertical, MoreVertical, ShieldCheck } from 'lucide-react'
import type { RosterFindingDto, ShiftDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { formatShiftTimeRange, RATIO_LABELS } from '../lib/roster'

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

/** Which kind of board row hosts a chip — decides which person its one-line label names. */
export type ShiftChipContext = 'staff' | 'participant'

export type ShiftChipProps = {
  shift: ShiftDto
  canWrite: boolean
  /** Unfilled-lane chips render dashed, since they represent a need rather than a booked shift. */
  dashed?: boolean
  /**
   * The row this chip sits in. A chip's label is the person the row header does NOT already name, so
   * nothing is repeated: in a staff row (and the Unfilled lane) — the default — the label is the
   * participant being supported; in a participant row it is the covering staff member, or "Unfilled".
   */
  context?: ShiftChipContext
  onOpen: (shift: ShiftDto) => void
  onAssignTo: (shift: ShiftDto) => void
  onUnassign: (shift: ShiftDto) => void
  onDelete: (shift: ShiftDto) => void
}

const LABEL_LINK =
  'min-w-0 flex-1 truncate rounded-sm text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

/**
 * The one chip type rendered in staff rows, participant rows and the Unfilled lane. Colour is
 * reserved for "something is wrong" — a healthy chip is a neutral surface; only the warning dot and
 * the dashed/unfilled variant carry meaning.
 *
 * One line, `--row-h` minus 6px tall (28px at a fine pointer; grows with the row under
 * `pointer: coarse`): `time · name`, with the time never clipping and the name yielding first.
 */
export function ShiftChip({ shift, canWrite, dashed, context = 'staff', onOpen, onAssignTo, onUnassign, onDelete }: ShiftChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
    data: { shift },
    disabled: !canWrite,
  })

  const hasFindings = shift.findings.length > 0
  const hasBlocking = shift.findings.some(f => f.severity === 'Blocking')
  const showRatio = shift.ratio !== 'OneToOne'
  // The shift always belongs to this participant, so their name labels the drag handle and the
  // actions menu whichever row hosts the chip.
  const subjectLabel = shift.participantName
  // Filled = a specific staff member covers this shift.
  const isFilled = Boolean(shift.staffId && shift.staffName)
  // A filled shift whose assignee's leave was approved AFTER the assignment was made — the chip
  // still has a staffId, but that staff member won't actually be there, so this needs to read as
  // a hole (dashed, like an unfilled chip) rather than a normal covered shift.
  const onApprovedLeave = isFilled && shift.assigneeOnApprovedLeave
  const onLeaveTitle = `${shift.staffName} has approved leave covering this shift — this slot needs a new assignee.`

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

  /** Manual Enter/Space handling — see the comment on the div below for why this isn't a native
   *  <button>: a real <button> can't validly contain the nested participant/staff <a> links. */
  function handleOpenKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(shift)
    }
  }

  // A link to the person's own page, or plain "Unfilled" text in a participant row when nobody covers
  // the shift (a staff-row chip is never unfilled: it exists because that staff member holds it).
  // stopPropagation keeps a name click from also bubbling up to the open-shift div.
  const label = context === 'participant'
    ? isFilled
      ? (
        <Link
          to={`/staff/${shift.staffId}`}
          onClick={e => e.stopPropagation()}
          className={LABEL_LINK}
          title={shift.staffName ?? undefined}
        >
          {shift.staffName}
        </Link>
      )
      : <span className="min-w-0 flex-1 truncate italic text-muted-foreground">Unfilled</span>
    : (
      <Link
        to={`/participants/${shift.participantId}`}
        onClick={e => e.stopPropagation()}
        className={LABEL_LINK}
        title={subjectLabel}
      >
        {subjectLabel}
      </Link>
    )

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 } : undefined}
      // On-leave gets the explanation on the whole chip too: on a narrow day column the inline marker
      // below is the first thing to clip, so the hover text must not depend on it being visible.
      title={onApprovedLeave ? onLeaveTitle : undefined}
      className={`group @container relative flex h-[calc(var(--row-h)_-_6px)] items-stretch rounded-sm border bg-surface-container-low text-[13px] transition-opacity duration-150 ${
        dashed || onApprovedLeave ? 'border-dashed border-border' : 'border-border'
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
          className="flex shrink-0 cursor-grab touch-none items-center rounded-sm px-0.5 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
          aria-label={`Drag to move ${subjectLabel}'s shift`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      {/* The whole visible chip body is the open control, so the tappable area matches what's drawn.

          role="button" + manual key handling instead of a native <button>: this control nests the
          participant/staff name as an <a> (via react-router Link) so the name can navigate on its own
          — a <button> can't validly contain interactive descendants, but a div can. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(shift)}
        onKeyDown={handleOpenKeyDown}
        // relative, no overflow-hidden here: the severity marker below needs to sit over the top edge
        // of this control without being clipped by it, so the clip boundary lives one level down, on
        // the content wrapper.
        className="relative flex min-w-0 flex-1 items-center rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/*
          Out of the flex flow entirely — absolutely positioned over the chip's top edge,
          pointer-events-none so it never intercepts the click. It's a safety signal, not decoration,
          so it stays, but as a plain flex child it would cost the time ~16px it can't spare. It's a
          sibling of the content wrapper (not inside it) so the wrapper's overflow-hidden doesn't clip
          it. Still a DOM descendant of this control, so it still concatenates into the accessible name;
          kept first in JSX so the safety information comes before time/person.
        */}
        {hasFindings && (
          <span
            className="pointer-events-none absolute -top-1 right-1 z-10"
            role="img"
            aria-label={findingsSeverityLabel(shift.findings)}
            title={findingsSeverityLabel(shift.findings)}
          >
            {hasBlocking ? (
              <AlertOctagon className="h-3 w-3 text-destructive" aria-hidden="true" />
            ) : (
              // Amber-700, not the --color-warning token: the token (#f59e0b) measures 1.94:1
              // against this chip's surface-container-low background, failing WCAG 1.4.11's 3:1
              // minimum for a graphical object conveying meaning. --color-on-warning-container
              // (#92400e) clears it comfortably while still reading as amber.
              <AlertTriangle className="h-3 w-3 text-[var(--color-on-warning-container)]" aria-hidden="true" />
            )}
          </span>
        )}

        {/*
          Content wrapper: one line — `time · name`. overflow-hidden: on a narrow day column the name can
          be squeezed to nothing and the fixed-width tail (override icon, on-leave marker) can still
          exceed the box; without a clip boundary here that excess would render over the actions menu
          beside it instead of just yielding.
        */}
        <span className="flex min-w-0 flex-1 items-center overflow-hidden rounded-sm px-0.5">
          <span
            className="shrink-0 font-medium tabular-nums text-foreground"
            title={shift.endsNextDay ? `${formatShiftTimeRange(shift.startTime, shift.endTime)} — ends the next day` : undefined}
          >
            {formatShiftTimeRange(shift.startTime, shift.endTime)}
            {/*
              No visible "+1"/next-day glyph, deliberately: an overnight shift is self-evident from its own
              times — "10pm–6am" has an end earlier than its start, which can only mean the next day. The
              suffix restated what the range already says, so dropping it is redundancy removed, not
              information lost — do not "restore" it. It's still spelled out in full on hover (the title
              above) and for assistive tech (below).
            */}
            {shift.endsNextDay && <span className="sr-only"> (ends the next day)</span>}
          </span>
          {/* Visual separator between time and name; spoken as a comma instead of "middle dot". */}
          <span className="shrink-0 px-0.5 text-muted-foreground" aria-hidden="true">·</span>
          <span className="sr-only">, </span>
          {label}
          {/*
            Priority on a chip, narrowest-first: time > name > ratio > everything else. Time is what a
            coordinator scans for and must never clip; the name yields (truncate, above); the ratio badge
            yields *entirely* — it drops from the visible layout rather than squeezing time or name, since
            a day column is never wide enough to show all three. It stays discoverable: sr-only here so it
            still contributes to this control's accessible name, visible in the slide-over, and (the case
            that actually matters operationally) an under-covered ratio surfaces as a RATIO_SHORTFALL
            finding, which the severity marker already makes visible.
          */}
          {showRatio && (
            <span className="sr-only">, {RATIO_LABELS[shift.ratio] ?? shift.ratio} ratio</span>
          )}
          {shift.overrideReason && (
            <span
              className="ml-1 shrink-0 text-muted-foreground"
              role="img"
              aria-label={`Assigned with an override: ${shift.overrideReason}`}
              title={`Assigned with an override: ${shift.overrideReason}`}
            >
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
          {/* On-leave marker — a filled chip whose assignee's leave got approved after the fact. The
              dashed border makes the hole visible at a glance; this names why. Icon at rest, with the
              words appearing once the chip is wide enough (container query on the chip) — the text is
              always in the DOM for assistive tech. */}
          {onApprovedLeave && (
            <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground" title={onLeaveTitle}>
              <CalendarOff className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only @[15rem]:not-sr-only" title={onLeaveTitle}>On leave</span>
            </span>
          )}
        </span>
      </div>

      {canWrite && (
        <span className="flex shrink-0 items-center pr-0.5">
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
