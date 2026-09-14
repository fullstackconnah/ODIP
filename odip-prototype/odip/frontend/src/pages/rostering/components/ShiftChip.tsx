import { Link } from 'react-router-dom'
import { useDraggable } from '@dnd-kit/core'
import { AlertOctagon, AlertTriangle, GripVertical, MoreVertical, ShieldCheck } from 'lucide-react'
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
  // Filled = a specific staff member covers this shift — that's the one extra fact this chip
  // doesn't already show via its row context (a participant row already names the participant;
  // a staff row already names the staff member), so it's surfaced here as a second, smaller link.
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

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 30 } : undefined}
      className={`group relative flex items-stretch gap-0.5 rounded-sm border bg-surface-container-low text-xs transition-opacity duration-150 ${
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
          className="flex shrink-0 cursor-grab touch-none items-center rounded-sm px-1 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing"
          aria-label={`Drag to move ${subjectLabel}'s shift`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}

      {/* The full visible card padding lives on this control (not the outer wrapper) so the
          tappable area matches what's visually presented — previously the padding sat on the
          non-interactive wrapper div, leaving a hit target of only ~96×16px against a visibly
          larger card.

          role="button" + manual key handling instead of a native <button>: this control now
          nests the participant/staff name as an <a> (via react-router Link) so each name can
          navigate on its own — a <button> can't validly contain interactive descendants, but a
          div can. Each nested Link stops propagation on click so clicking a name navigates
          there instead of also opening this shift's slide-over. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(shift)}
        onKeyDown={handleOpenKeyDown}
        // relative, no overflow-hidden here: the severity marker below needs to sit in the
        // sliver of space above this control's own content without being clipped by it, so the
        // clip boundary lives one level down, on the content wrapper — see that span's comment.
        className="relative flex min-w-0 flex-1 items-center rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/*
          Out of the flex flow entirely — absolutely positioned, nudged just above this button's
          own content box, pointer-events-none so it never intercepts the click. This is what
          lets the severity marker stay (it's a safety signal, not decoration — see below)
          without competing with time for the same ~60-90px of narrow-column width; as a plain
          flex child it was costing time ~17-20px it doesn't have to spare. It's a sibling of the
          content wrapper (not inside it) specifically so the wrapper's overflow-hidden — needed
          to clip long content cleanly — doesn't also clip this marker's negative offset. Still a
          DOM descendant of this button, so it still concatenates into the accessible name; kept
          first in JSX so that order still puts the safety information before time/person,
          matching its former visual priority.
        */}
        {hasFindings && (
          <span
            className="pointer-events-none absolute -top-1 right-1 z-10"
            role="img"
            aria-label={findingsSeverityLabel(shift.findings)}
            title={findingsSeverityLabel(shift.findings)}
          >
            {hasBlocking ? (
              <AlertOctagon className="h-2.5 w-2.5 text-destructive" aria-hidden="true" />
            ) : (
              // Amber-700, not the --color-warning token: the token (#f59e0b) measures 1.94:1
              // against this chip's surface-container-low background, failing WCAG 1.4.11's 3:1
              // minimum for a graphical object conveying meaning. This value clears it at 4.53:1
              // while still reading as amber. Scoped to this marker only — --color-warning itself
              // is used elsewhere (progress meter, badges) and isn't part of this fix.
              <AlertTriangle className="h-2.5 w-2.5 text-[#b45309]" aria-hidden="true" />
            )}
          </span>
        )}

        {/*
          The full visible card padding lives here (moved down from the button one level, which
          keeps the button's own rendered box — and so its tappable hit area — identical, since
          this wrapper is the button's only child and sizes it). Horizontal padding is halved
          (px-2 -> px-1) and the inter-item gap dropped in favour of a single small margin on the
          override icon only — vertical padding (py-1.5) is untouched, since the 28px-tall hit
          area only has ~4px of headroom over WCAG 2.5.8's 24px floor, while the horizontal axis
          had 64px to spare (measured 65px wide) — reclaims space for time without risking the
          one axis that was actually tight. overflow-hidden: on a narrow day column, name can be
          fully truncated and the remaining fixed-width content (time, plus an override icon when
          present) can still exceed the box. Without a clip boundary here, that excess would
          render outside and visually collide with the menu button next to it (icon-on-top-of-
          text) instead of just squeezing the name tighter — this clips it cleanly instead.
        */}
        <span className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-sm px-1 py-1">
          <span className="flex min-w-0 items-center">
            <span
              className="shrink-0 font-medium tabular-nums text-foreground"
              title={shift.endsNextDay ? `${formatShiftTimeRange(shift.startTime, shift.endTime)} — ends the next day` : undefined}
            >
              {formatShiftTimeRange(shift.startTime, shift.endTime)}
              {/*
                No visible "+1"/next-day glyph, deliberately, not just because it wouldn't fit
                (though it doesn't: this control's own box is 65px, fixed by the day-column width,
                and even a compact superscript form of range+suffix needed 74px). The real reason
                is that an overnight shift is self-evident from its own times — "10pm–6am" has an
                end earlier than its start, which can only mean the next day. The suffix was
                restating what the range already says; a shift spanning past 24h into a *second*
                next day would be the genuinely ambiguous case, and isn't a real roster shape here.
                So dropping it is redundancy removed, not information lost — do not "restore" it.
                It's still spelled out in full on hover (the title above) and for assistive tech
                (below), for anyone who wants it stated explicitly rather than inferred.
              */}
              {shift.endsNextDay && <span className="sr-only"> (ends the next day)</span>}
            </span>
            {/*
              No gap/margin between time and name — the two are already visually distinct (bold
              foreground vs muted, different weight), and name yields to 0 width in exactly the
              narrow cases where every pixel here goes to keeping time from clipping, so a gap
              here would only ever cost time width without buying legibility back.

              A Link, not plain text: clicking the participant's name should take you to their
              participants page rather than opening this shift's slide-over — stopPropagation
              keeps the click from also bubbling up to the open-shift div above.
            */}
            <Link
              to={`/participants/${shift.participantId}`}
              onClick={e => e.stopPropagation()}
              className="min-w-0 flex-1 truncate text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded-sm"
              title={subjectLabel}
            >
              {subjectLabel}
            </Link>
            {/*
              Priority on a chip, narrowest-first: time > person > ratio > everything else. Time is
              what a coordinator scans for and must never clip; the person's name already yields
              (truncate, above); the ratio badge yields *entirely* at the chip's normal narrow
              width — it drops from the visible layout rather than squeezing time or name, since a
              day column is never wide enough to show all three. It stays discoverable: sr-only
              here so it still contributes to this control's accessible name, visible in the
              slide-over, and (the case that actually matters operationally) an under-covered ratio
              surfaces as a RATIO_SHORTFALL finding, which the severity marker already makes
              visible.
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
          </span>
          {/* Second line, only when a specific staff member covers this shift — the one useful
              fact the row header alone doesn't already tell you. Same stopPropagation reasoning
              as the participant Link above. */}
          {isFilled && (
            <Link
              to={`/staff/${shift.staffId}`}
              onClick={e => e.stopPropagation()}
              className="truncate text-[10px] leading-tight text-muted-foreground/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring rounded-sm"
              title={shift.staffName ?? undefined}
            >
              {shift.staffName}
            </Link>
          )}
          {/* On-leave mini-label — a filled chip whose assignee's leave got approved after the
              fact. The staff link above still names them (so it's clear whose leave created the
              hole); this line is what makes the hole itself visible at a glance. */}
          {onApprovedLeave && (
            <span
              className="block truncate text-[10px] font-semibold leading-tight text-muted-foreground"
              title={onLeaveTitle}
            >
              On leave
            </span>
          )}
        </span>
      </div>

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
