import { useCallback, useContext } from 'react'
import { Link } from 'react-router-dom'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { AlertOctagon, AlertTriangle, Asterisk, CalendarOff, Check, FileCheck, GripVertical, KeyRound, Lock, MoreVertical, Repeat, ShieldCheck, Siren, UserPlus } from 'lucide-react'
import type { RosterFindingDto, ShiftDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { TAP_AREA } from '@/components/tapArea'
import { formatShiftTimeRange, isUnfilledShift, RATIO_LABELS, shiftSource } from '../lib/roster'
import { plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import { OVER_BUDGET_MARKER, markerForAcknowledgedCodes } from './parallel-budget-override'
import { DropStateContext, dropOutcome, firstName, isLockedShift, lockedWords, pickName, type DragCarry, type DropTarget } from '../lib/rosterDrag'

/**
 * Accessible name for the severity marker — states the severity(s) present and their counts, so
 * a screen-reader user gets the same information the icon/colour distinction conveys visually.
 * Mirrors the Blocking-vs-Warning language used in FindingsList and ExceptionsDrawer.
 */
function findingsSeverityLabel(findings: RosterFindingDto[]): string {
  const blockingCount = findings.filter(f => f.severity === 'Blocking').length
  const warningCount = findings.filter(f => f.severity === 'Warning').length
  const parts: string[] = []
  if (blockingCount > 0) parts.push(plural(blockingCount, 'blocking issue'))
  if (warningCount > 0) parts.push(plural(warningCount, 'warning'))
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
   * participant being supported; in a participant row it is the covering staff member, or "Needs staff".
   */
  context?: ShiftChipContext
  /**
   * Roster drag and drop, the Participant view from md up (2026-10-14): a grip that carries this shift's PERSON on a filled, unlocked chip (never the shift: no drag changes a day or a
   * time), a Lock in that column on a locked one, and the chip as a drop target. Off in the Staff view and on phones, which keep click and the menus.
   */
  draggable?: boolean
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
 * At least `--row-h` minus 6px tall (28px at a fine pointer; under `pointer: coarse` at least 44px, the touch target size, where row-h less 6px would be 42px). Where the chip is 14rem or
 * wider it is one line, `time · name`, with the time never clipping and the name yielding first. Narrower (a day column is 123-130px
 * at the board's native widths) the name sits UNDER the time on its own line, because on one line the time, the drag handle and the
 * actions trigger left the name 0-5px: a one-letter link. The chip is its own container (`@container`), so this follows the chip's
 * width, not the window's.
 */
/** The provenance glyphs (the brief, section 5): a page with a tick, two arrows, six spokes. Each reads apart from the others, and from the chip's other marks, without colour at 12px. */
const SOURCE_ICON = { agreed: FileCheck, pattern: Repeat, adhoc: Asterisk } as const

export function ShiftChip({ shift, canWrite, dashed, context = 'staff', draggable = false, onOpen, onAssignTo, onUnassign, onDelete }: ShiftChipProps) {
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

  // Roster drag and drop: the grip lifts this shift's person; the chip is a drop target, locked ones included, so a drag over one can say why it is refused.
  const { disabled: dragsOff, pending, pick, pickingId } = useContext(DropStateContext)
  const locked = isLockedShift(shift)
  const canLift = draggable && canWrite && isFilled && !locked
  const carry: DragCarry = { staffId: shift.staffId ?? '', staffName: shift.staffName ?? '', fromShift: shift }
  const { attributes, listeners, setNodeRef: setDragNode, isDragging } = useDraggable({ id: `shift:${shift.id}`, data: carry, disabled: !canLift || dragsOff })
  const target: DropTarget = { kind: 'shift', shift }
  const { setNodeRef: setDropNode, isOver, active } = useDroppable({ id: `drop-shift:${shift.id}`, data: target, disabled: !draggable || !canWrite })
  // One stable ref for both: an inline arrow would detach and re-attach the drag and drop nodes on every render.
  const setNodeRef = useCallback((node: HTMLElement | null) => { setDragNode(node); setDropNode(node) }, [setDragNode, setDropNode])
  // Only while something is carried over this chip: the ring marks a drop that does something, and a locked chip refuses the cursor.
  const overKind = isOver && active ? dropOutcome(active.data.current as DragCarry, target).kind : null
  const busy = pending?.targetId === shift.id
  // While a person is carried, the menu column becomes the day's new-shift slot (RosterDayCell): menus cannot be used mid-drag anyway.
  const carrying = draggable && Boolean(active)
  const fading = pending?.sourceId === shift.id
  const lockTitle = `${lockedWords(shift.status)}: can't be changed here`
  // The plus (spec 2026-10-15, decision C): every Needs staff chip a writer may change, in both views and on phones, wherever the page can open a picker.
  const canPick = Boolean(pick) && canWrite && isUnfilledShift(shift) && !locked
  const picking = pickingId === shift.id
  const pickLabel = pickName(shift)
  // Where the shift came from (spec 2026-10-15, decision B), derived: Agreed, Pattern or Ad hoc. Neutral ink for all three: colour on a chip means something is wrong.
  const source = shiftSource(shift)
  const SourceIcon = SOURCE_ICON[source.kind]
  // The accessible name and the hover title end with the shift's state (the brief, section 8): Draft or Published, or why it is locked.
  const statusWords = locked ? lockTitle : shift.status

  // Budget phase 3: a shift saved past its budget on purpose carries a marker, read from the codes the SERVER stored (never from the reason's words). It stands in for the generic override mark: one shield, not two.
  const budgetMarker = markerForAcknowledgedCodes(shift.acknowledgedFindingCodes)
  const budgetReviewWords = budgetMarker === 'emergency' ? (shift.budgetReview?.state === 'Reviewed' ? 'Reviewed' : 'Admin review pending') : null
  const budgetMarkerName = budgetMarker ? [OVER_BUDGET_MARKER[budgetMarker], budgetReviewWords].filter(Boolean).join(', ') : null
  const budgetMarkerTitle = budgetMarkerName ? `${budgetMarkerName}${shift.overrideReason ? ` — ${shift.overrideReason}` : ''}` : null
  // What the marker looks like (design review H1): each state has its own silhouette and glyph as well as its tone, so they read apart without colour, and none is the generic override shield. A round alarm for an
  // emergency waiting on its review, a round tick once it is reviewed, a rounded-square key for an Admin override (the Admin's own act, with no review to wait for).
  const budgetDisc = budgetMarker === 'adminOverride'
    ? { Icon: KeyRound, shape: 'rounded-[6px]', fill: TONE.info.solid, ink: TONE.info.ink }
    : shift.budgetReview?.state === 'Reviewed'
      ? { Icon: Check, shape: 'rounded-full', fill: TONE.success.solid, ink: TONE.success.ink }
      : { Icon: Siren, shape: 'rounded-full', fill: TONE.warning.solid, ink: TONE.warning.ink }

  // The words of every marker that applies, on the chip itself, one to a line: on leave, the over-budget marker, the severity marker. The disc and the severity icon are pointer-events-none (they must never take a click),
  // so hit testing skips them and their own titles can never show; the pointer lands on the chip, and this is what it shows. Their aria-labels, and the control's accessible name, are unchanged.
  const chipTitle = [onApprovedLeave ? onLeaveTitle : null, budgetMarkerTitle, hasFindings ? findingsSeverityLabel(shift.findings) : null, statusWords].filter(Boolean).join('\n')

  const menuItems = [
    { value: 'edit', label: 'Edit' },
    // The owner's words (the brief, section 5): Replace and Remove name the person, which keeps Remove apart from Delete and says who is meant in the Staff view.
    { value: 'assign', label: dashed || !shift.staffId ? 'Assign to…' : `Replace ${firstName(shift.staffName)}…`, disabled: canPick && dragsOff },
    ...(shift.staffId ? [{ value: 'unassign', label: `Remove ${firstName(shift.staffName)}` }] : []),
    { value: 'delete', label: 'Delete' },
  ]

  function handleMenuSelect(value: string) {
    if (value === 'edit') onOpen(shift)
    // An unfilled chip assigns through the picker, as its plus does: one way to assign on one chip (SHAPE departure 13). A filled chip's "Replace {first name}…" keeps the panel.
    else if (value === 'assign') { if (!canPick) onAssignTo(shift); else if (!dragsOff) pick?.(shift) }
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
  const labelText = busy ? `Assigning ${firstName(pending?.staffName)}…` : context === 'participant' ? (isFilled ? shift.staffName : 'Needs staff') : subjectLabel
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
    // The label's visible word is in the name too (WCAG 2.5.3): Ad hoc's title already starts with it.
    source.kind === 'adhoc' ? null : source.word,
    source.title,
    showRatio ? `${RATIO_LABELS[shift.ratio] ?? shift.ratio} ratio` : null,
    budgetMarkerName ?? (shift.overrideReason ? `Assigned with an override: ${shift.overrideReason}` : null),
    onApprovedLeave ? 'On leave' : null,
    statusWords,
  ].filter(Boolean).join(', ')

  // A link to the person's own page, or plain "Unfilled" text in a participant row when nobody covers
  // the shift (a staff-row chip is never unfilled: it exists because that staff member holds it).
  // stopPropagation keeps a name click from also bubbling up to the open-shift div.
  const label = busy
    ? <span className="min-w-0 flex-1 truncate italic text-muted-foreground">{labelText}</span>
    : context === 'participant'
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
      : <span className="min-w-0 flex-1 truncate italic text-muted-foreground">Needs staff</span>
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
      data-shift-chip={shift.id}
      // On-leave gets the explanation on the whole chip too: on a narrow day column the inline marker
      // below is the first thing to clip, so the hover text must not depend on it being visible.
      title={chipTitle}
      aria-busy={busy || undefined}
      className={`group @container relative flex min-h-[calc(var(--row-h)_-_6px)] pointer-coarse:min-h-11 items-stretch rounded-sm border bg-surface-container-low text-[13px] transition-opacity duration-150 ${
        dashed || onApprovedLeave ? 'border-dashed border-border' : 'border-border'
      } ${isDragging || fading ? 'opacity-50' : ''} ${overKind === 'assign' || overKind === 'move' || overKind === 'prompt' || picking ? 'ring-2 ring-ring' : ''} ${
        overKind === 'locked' ? 'cursor-not-allowed' : ''
      } ${budgetMarker ? (hasFindings ? 'mb-2' : 'mt-2') : ''}`}
    >
      {/* Drag activation lives on its own handle, separate from the open button below. Both used
          to share one element with dnd-kit's listeners spread onto the same button that opens the
          shift — since the KeyboardSensor's default activator keys are Space/Enter, that silently
          turned "open this shift" into "start a keyboard drag" for anyone tabbing to the chip.
          Splitting them keeps keyboard drag working (from the handle) without hijacking Enter on
          the primary control. */}
      {canPick && busy ? (
        // The plus is gone while its write is out, but its column stays (phones and the Staff view too), so the text does not jump.
        <span className="w-[18px] shrink-0 pointer-coarse:w-11" aria-hidden="true" />
      ) : canPick ? (
        // The chip's leading column is the person slot (the brief, section 3): the grip when there is a person to move, this plus when there is nobody, the Lock when nothing can change.
        // A ghost icon button the full height of the chip: 18px on a fine pointer, a real 44px square under a coarse one (no TAP_AREA pad: it would cover the open control).
        <button
          type="button"
          data-shift-plus={shift.id}
          aria-label={pickLabel}
          title={pickLabel}
          aria-haspopup="dialog"
          aria-expanded={picking}
          aria-disabled={dragsOff || undefined}
          onClick={() => { if (!dragsOff) pick?.(shift) }}
          className={`flex w-[18px] shrink-0 items-center justify-center rounded-sm text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring pointer-coarse:-my-px pointer-coarse:w-11 ${
            dragsOff ? 'opacity-40' : 'hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)] aria-expanded:bg-[var(--color-accent)] aria-expanded:text-[var(--color-primary)]'
          }`}
        >
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : canWrite && draggable && (
        canLift ? (
          <button
            type="button"
            // A 44px hit area under a coarse pointer (post-merge review N6): a touch on the grip lifts at once, so this narrow target decides drag versus scroll. TAP_AREA pads it
            // 13px past each side; the coarse-only margin keeps that pad inside the chip and off the time beside it. A mouse gets neither.
            className={`${TAP_AREA} flex shrink-0 cursor-grab touch-none items-center rounded-sm px-0.5 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing pointer-coarse:mx-[13px]`}
            aria-label={`Drag to move ${shift.staffName} to another shift or day`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : locked ? (
          <span className="flex w-[18px] shrink-0 items-center justify-center text-muted-foreground pointer-coarse:mx-[13px]" title={lockTitle}>
            <Lock className="h-3 w-3" aria-hidden="true" />
          </span>
        ) : (
          // Nobody to move, so no grip, but the column stays so times line up down a day.
          <span className="w-[18px] shrink-0 pointer-coarse:mx-[13px]" aria-hidden="true" />
        )
      )}

      {/* The whole visible chip body is the open control, so the tappable area matches what's drawn.

          role="button" + manual key handling instead of a native <button>: this control nests the
          participant/staff name as an <a> (via react-router Link) so the name can navigate on its own
          — a <button> can't validly contain interactive descendants, but a div can. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={openName}
        data-shift-open={shift.id}
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
          Content wrapper: `time · name` on one line from 14rem, the name under the time below it. overflow-hidden: on a narrow day column the name can
          be squeezed to nothing and the fixed-width tail (override icon, on-leave marker) can still
          exceed the box; without a clip boundary here that excess would render over the actions menu
          beside it instead of just yielding.
        */}
        <span className={`flex min-w-0 flex-1 flex-col justify-center overflow-hidden rounded-sm @[14rem]:flex-row @[14rem]:items-center ${canPick || (canWrite && draggable) ? '' : 'px-0.5'}`}>
          <span className="flex min-w-0 items-center gap-0.5">
            <span
              className={`shrink-0 font-medium tabular-nums ${shift.status === 'Cancelled' ? 'text-muted-foreground line-through' : 'text-foreground'}`}
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
            {/* The kind, after the time, which never gives way. The glyph and the word are each whole or not drawn at all, never a sliver. The box is one clipped line that wraps,
                with a zero-width first item holding that line, so anything that does not fit wraps onto the hidden second line (ReadinessNote's technique). */}
            <span className="flex h-4 min-w-0 flex-1 flex-wrap items-center gap-y-4 overflow-hidden text-xs text-muted-foreground" title={source.title} data-shift-source={source.kind}>
              <span className="h-4 w-0" aria-hidden="true" />
              <SourceIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="shrink-0 pl-0.5">{source.word}</span>
            </span>
          </span>
          {/* Visual separator between time and name on the one-line layout; the accessible name (aria-label above) uses a comma. Gone
              while the name is under the time: a dot ending the first line reads as a typo. */}
          <span className="hidden shrink-0 px-0.5 text-muted-foreground @[14rem]:inline" aria-hidden="true">·</span>
          {/* The name and its markers are one row of their own, so under the time they stay one line and never become a third. */}
          <span className="flex min-w-0 items-center @[14rem]:flex-1">
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
            {budgetMarker && budgetMarkerTitle ? (
              // The words are a bonus on a chip wide enough for them (container query on the chip); below that they are display:none, never a clipped word. The marker itself is the disc on the chip's corner, below.
              <span className={`ml-1 hidden shrink-0 text-xs font-semibold @[18rem]:inline ${budgetDisc.ink}`} aria-hidden="true">
                {OVER_BUDGET_MARKER[budgetMarker]}
              </span>
            ) : shift.overrideReason && (
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
        </span>
      </div>

      {/* The over-budget marker (design review H1): a 20 px disc on the chip's corner, not a 12 px shield in the name row. It is out of the flow, so the label never gives way to it, and it is
          pointer-events-none like the severity marker, so it never takes a click from the chip or the menu. It takes the top corner; a chip that already carries a severity marker at the top
          takes the bottom one, so the two never sit on each other. The part of the disc that hangs off the chip needs room to hang in: the chip leaves 8 px of margin on that side, because the first row sits
          right under the board's sticky day header (z-20), which cut the top of the disc when it hung over nothing. It keeps its role="img", its words in the accessible name and the hover title, and its data attribute. */}
      {budgetMarker && budgetMarkerTitle && (
        <span
          className={`pointer-events-none absolute z-10 flex h-5 w-5 items-center justify-center ring-2 ring-[var(--color-card)] ${hasFindings ? '-bottom-2' : '-top-2'} -right-1 ${budgetDisc.shape} ${budgetDisc.fill}`}
          role="img"
          aria-label={budgetMarkerName ?? undefined}
          title={budgetMarkerTitle}
          data-budget-marker={budgetMarker}
        >
          <budgetDisc.Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}

      {/* Not while a drop on this shift is out: no action can run during the write, and "Assigning {name}…" needs the room. */}
      {canWrite && !busy && !carrying && (
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
