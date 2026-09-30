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

  // The person this chip's one-line label names (see `context`), as plain text for the accessible name below.
  const labelText = context === 'participant' ? (isFilled ? shift.staffName : 'Unfilled') : subjectLabel
  const timeRange = formatShiftTimeRange(shift.startTime, shift.endTime)
  // The open control's accessible name, spelled out once. Everything the chip can't afford to draw at 28px
  // — the next-day note, the ratio, the override, the on-leave state — is announced from here (and from the
  // hover titles) instead of from visually-hidden spans: those are 1px clip boxes with text wider than
  // themselves, which is exactly what a "clipped without an ellipsis" audit reports. Same reading order the
  // spans gave: severity first, then time, person, ratio, override, leave.
  const openName = [
    hasFindings ? findingsSeverityLabel(shift.findings) : null,
    `${timeRange}${shift.endsNextDay ? ' (ends the next day)' : ''}`,
    labelText,
    showRatio ? `${RATIO_LABELS[shift.ratio] ?? shift.ratio} ratio` : null,
    shift.overrideReason ? `Assigned with an override: ${shift.overrideReason}` : null,
    onApprovedLeave ? 'On leave' : null,
  ].filter(Boolean).join(', ')

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
        aria-label={openName}
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
          it. It keeps its own role="img" label (and hover title), and the same severity text leads this
          control's aria-label (openName) so the safety information is announced before time/person.
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
            title={shift.endsNextDay ? `${timeRange} — ends the next day` : undefined}
          >
            {timeRange}
            {/*
              No visible "+1"/next-day glyph, deliberately: an overnight shift is self-evident from its own
              times — "10pm–6am" has an end earlier than its start, which can only mean the next day. The
              suffix restated what the range already says, so dropping it is redundancy removed, not
              information lost — do not "restore" it. It's still spelled out in full on hover (the title
              above) and for assistive tech (the control's aria-label).
            */}
          </span>
          {/* Visual separator between time and name; the accessible name (aria-label above) uses a comma. */}
          <span className="shrink-0 px-0.5 text-muted-foreground" aria-hidden="true">·</span>
          {label}
          {/*
            Priority on a chip, narrowest-first: time > name > ratio > everything else. Time is what a
            coordinator scans for and must never clip; the name yields (truncate, above); the ratio badge
            yields *entirely* — it drops from the visible layout rather than squeezing time or name, since
            a day column is never wide enough to show all three. It stays discoverable: it is part of this
            control's aria-label, visible in the slide-over, and (the case that actually matters
            operationally) an under-covered ratio surfaces as a RATIO_SHORTFALL finding, which the severity
            marker already makes visible.
          */}
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
              words shown only once the chip is wide enough (container query on the chip): below that they
              are display:none, never a clipped or half-drawn word. Assistive tech and the hover title get
              "On leave" / the full explanation from the control's aria-label and the chip's title. */}
          {onApprovedLeave && (
            <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground" title={onLeaveTitle}>
              <CalendarOff className="h-3 w-3" aria-hidden="true" />
              <span className="hidden @[15rem]:inline" title={onLeaveTitle}>On leave</span>
            </span>
          )}
        </span>
      </div>

      {canWrite && (
        // The "Actions for …" trigger is Dropdown's icon variant, which hard-codes `p-1.5 rounded-lg` (a 26px
        // square, radius 8px) and takes no className or custom trigger. This wrapper gives that one button the
        // geometry of `<Button iconOnly>` — a --control-h-sm square (24px, 36px under a coarse pointer) at
        // --radius-sm, centred icon — from outside. Delete these overrides once Dropdown's icon trigger renders
        // through Button itself.
        <span className="flex shrink-0 items-center pr-0.5 [&_button]:inline-flex [&_button]:h-[var(--control-h-sm)] [&_button]:w-[var(--control-h-sm)] [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[var(--radius-sm)] [&_button]:p-0">
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
