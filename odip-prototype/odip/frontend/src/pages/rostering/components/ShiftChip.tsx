import { useCallback, useContext } from 'react'
import { Link } from 'react-router-dom'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { AlertOctagon, AlertTriangle, Asterisk, CalendarOff, Check, FileCheck, GripVertical, KeyRound, Lock, MoreVertical, Repeat, ShieldCheck, Siren, UserPlus } from 'lucide-react'
import type { RosterFindingDto, ShiftDto } from '@/api/types'
import { Dropdown } from '@/components/Dropdown'
import { TAP_AREA } from '@/components/tapArea'
import { formatShiftTimeRange, isUnfilledShift, RATIO_LABELS, shiftSource } from '../lib/roster'
import { plural } from '@/lib/format'
import { ON_TINT, TONE } from '@/lib/tone'
import { OVER_BUDGET_MARKER, markerForAcknowledgedCodes } from './parallel-budget-override'
import { DropStateContext, canDeleteShift, dropOutcome, firstName, isLockedShift, lockedWords, pickName, type DragCarry, type DropTarget } from '../lib/rosterDrag'

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
  /** "Make {first} the regular" / "Stop being the regular" (L2), on an agreement pattern's shift with a worker: the only patterns Start makes shifts from. It changes the pattern, not the shift, so a locked chip keeps it. */
  onSetRegular?: (shift: ShiftDto) => void
}

const LABEL_LINK =
  'min-w-0 flex-1 truncate rounded-sm text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'

/**
 * The one chip type rendered in staff rows, participant rows and the Unfilled lane. Colour is
 * reserved for "something needs attention" — a healthy chip is a neutral surface; only the finding marker,
 * the dashed/unfilled variant and one exception carry meaning. The exception: a Draft shift on this board takes
 * the warning tray plus the word "Draft", because it is waiting for the coordinator to publish it. Findings keep
 * priority over that tint: on a Draft chip the marker sits in an ON_TINT pill (card fill, the tone's ink), not a bare stroke.
 *
 * A tray holding a slot (the chip brief, 2026-10-15). The tray is a header, when and what kind (the time, the label), over a bordered box, who: the plus when nobody,
 * the person when someone, a Lock when nothing can change. The tray is always solid, because the shift exists; the box is dashed where the shift has a hole. 56px tall with a
 * mouse, 68px under a coarse pointer, where the box is the 44px touch target. The chip is its own container (`@container`), so the bonus words follow the chip's width.
 */
/** The provenance glyphs (the brief, section 5): a page with a tick, two arrows, six spokes. Each reads apart from the others, and from the chip's other marks, without colour at 12px. */
const SOURCE_ICON = { agreed: FileCheck, pattern: Repeat, adhoc: Asterisk } as const

export function ShiftChip({ shift, canWrite, dashed, context = 'staff', draggable = false, onOpen, onAssignTo, onUnassign, onDelete, onSetRegular }: ShiftChipProps) {
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
  const { disabled: dragsOff, pending, pick, swap, pickingId, publish, publishingIds } = useContext(DropStateContext)
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
  // A Draft shift with nobody on it is not a draft on screen (owner, 2026-10-28): it is a Needs staff card, and turns into a draft once someone is put on it. The status is unchanged; this is display only.
  const unstaffedDraft = shift.status === 'Draft' && !isFilled
  // The accessible name and the hover title end with the shift's state (the brief, section 8): Draft or Published, or why it is locked; Needs staff for an unstaffed Draft.
  const statusWords = locked ? lockTitle : unstaffedDraft ? 'Needs staff' : shift.status

  // Draft (card roster-draft-publish): the tray takes the warning tint and says the word where it fits, so an unpublished shift stands out. Only the tray tints: the box keeps the card fill, so a problem's dashed edge, its marker and the name read as on any chip.
  const isDraft = shift.status === 'Draft' && isFilled
  const publishing = publishingIds?.has(shift.id) ?? false

  // Budget phase 3: a shift saved past its budget on purpose carries a marker, read from the codes the SERVER stored (never from the reason's words). It stands in for the generic override mark: one shield, not two.
  const budgetMarker = markerForAcknowledgedCodes(shift.acknowledgedFindingCodes)
  const budgetReviewWords = budgetMarker === 'emergency' ? (shift.budgetReview?.state === 'Reviewed' ? 'Reviewed' : 'Admin review pending') : null
  const budgetMarkerName = budgetMarker ? [OVER_BUDGET_MARKER[budgetMarker], budgetReviewWords].filter(Boolean).join(', ') : null
  const budgetMarkerTitle = budgetMarkerName ? `${budgetMarkerName}${shift.overrideReason ? ` — ${shift.overrideReason}` : ''}` : null
  // A marked chip grows a row for the marker's WORDS (see the marker line in the box below). Only a marked chip does, so every other chip on the board is exactly what it was: same rows, same height.
  const markedChip = Boolean(budgetMarker)

  // What the marker looks like (design review H1): each state has its own silhouette and glyph as well as its tone, so they read apart without colour, and none is the generic override shield. A round alarm for an
  // emergency waiting on its review, a round tick once it is reviewed, a rounded-square key for an Admin override (the Admin's own act, with no review to wait for).
  const budgetDisc = budgetMarker === 'adminOverride'
    ? { Icon: KeyRound, shape: 'rounded-[6px]', fill: TONE.info.solid, ink: TONE.info.ink }
    : shift.budgetReview?.state === 'Reviewed'
      ? { Icon: Check, shape: 'rounded-full', fill: TONE.success.solid, ink: TONE.success.ink }
      : { Icon: Siren, shape: 'rounded-full', fill: TONE.warning.solid, ink: TONE.warning.ink }

  // The words of every marker that applies, on the chip itself, one to a line: on leave, the over-budget marker, the severity marker. The disc and the severity icon are pointer-events-none (they must never take a click),
  // so hit testing skips them and their own titles can never show; the pointer lands on the chip, and this is what it shows. Their aria-labels, and the control's accessible name, are unchanged.
  // The regular in words only (the brief, 5.3: no mark): why an open shift's regular isn't on it, and who the regular is.
  const awayLine = shift.regularAwayReason ? `Regular away: ${shift.regularAwayReason}` : null
  const chipTitle = [onApprovedLeave ? onLeaveTitle : null, awayLine, shift.isRegular ? `${shift.staffName} is the regular` : null, budgetMarkerTitle, hasFindings ? findingsSeverityLabel(shift.findings) : null, statusWords].filter(Boolean).join('\n')

  const menuItems = [
    { value: 'edit', label: 'Edit' },
    // Publish (card roster-draft-publish): a Draft shift, for the writers the menu is already for. It waits while its own write is out.
    ...(shift.status === 'Draft' && publish ? [{ value: 'publish', label: publishing ? 'Publishing…' : 'Publish', disabled: publishing || dragsOff }] : []),
    // The owner's words (the brief, section 5): Replace and Remove name the person, which keeps Remove apart from Delete and says who is meant in the Staff view.
    { value: 'assign', label: dashed || !shift.staffId ? 'Assign to…' : `Replace ${firstName(shift.staffName)}…`, disabled: canPick && dragsOff },
    // Swap (the lead's decision 1): an assigned, unlocked chip, wherever the page can open the swap picker. It waits while a write is out, as every drag and plus does.
    ...(swap && isFilled && !locked ? [{ value: 'swap', label: `Swap ${firstName(shift.staffName)} with…`, disabled: dragsOff }] : []),
    // Agreement patterns only: Start never makes a Patterns-page pattern's shifts, so the confirm's "every week you start" would be untrue there (its regular is the Patterns page's own field).
    ...(onSetRegular && shift.shiftPatternId && shift.fromAgreement && shift.staffId ? [{ value: 'regular', label: shift.isRegular ? 'Stop being the regular' : `Make ${firstName(shift.staffName)} the regular` }] : []),
    ...(shift.staffId ? [{ value: 'unassign', label: `Remove ${firstName(shift.staffName)}` }] : []),
    ...(canDeleteShift(shift) ? [{ value: 'delete', label: 'Delete' }] : []),
  ]

  function handleMenuSelect(value: string) {
    if (value === 'edit') onOpen(shift)
    else if (value === 'publish') { if (!dragsOff) publish?.(shift) }
    // An unfilled chip assigns through the picker, as its plus does: one way to assign on one chip (SHAPE departure 13). A filled chip's "Replace {first name}…" keeps the panel.
    else if (value === 'assign') { if (!canPick) onAssignTo(shift); else if (!dragsOff) pick?.(shift) }
    else if (value === 'swap') { if (!dragsOff) swap?.(shift) }
    else if (value === 'unassign') onUnassign(shift)
    else if (value === 'regular') onSetRegular?.(shift)
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
    shift.isRegular ? `${firstName(shift.staffName)} is the regular` : null,
    awayLine,
    // The label's visible word is in the name too (WCAG 2.5.3): Ad hoc's title already starts with it.
    source.kind === 'adhoc' ? null : source.word,
    source.title,
    showRatio ? `${RATIO_LABELS[shift.ratio] ?? shift.ratio} ratio` : null,
    budgetMarkerName ?? (shift.overrideReason ? `Assigned with an override: ${shift.overrideReason}` : null),
    onApprovedLeave ? 'On leave' : null,
    statusWords,
  ].filter(Boolean).join(', ')

  // The Participant view's plus fills the empty box but for the menu (the chip brief, section 4); the Unfilled lane's keeps the lead cell, since its name cell names the participant.
  // An away chip's plus keeps the lead cell, as on the Unfilled lane, so its box can say why it is open (the brief, 5.4).
  const spanPlus = canPick && context === 'participant' && !shift.regularAwayReason
  // Why this open shift needs someone (the brief, 5.4): the reason is in the titles, the name and the shift panel. No colour: the dashed box already says it needs someone.
  const awayFlag = (
    <span data-regular-away className="inline-flex min-w-0 flex-1 items-center gap-1 text-xs font-semibold text-muted-foreground" title={awayLine ?? undefined}>
      <CalendarOff className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate @[11rem]:hidden">Away</span>
      <span className="hidden truncate @[11rem]:inline">Regular away</span>
    </span>
  )
  const hasLead = canPick || (canWrite && draggable)
  const hasMenu = canWrite && !busy && !carrying

  // A link to the person's own page, or plain "Needs staff" text in a participant row when nobody covers
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
      // A writer's plus fills this box in the Participant view (the chip brief, section 4): words beside it would be a visible label its name lacks, and the row header names the participant.
      : shift.regularAwayReason ? awayFlag : spanPlus ? null : <span className="min-w-0 flex-1 truncate italic text-muted-foreground">Needs staff</span>
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
      // The tray: the header row over the --control-h box row; a marked chip adds one row for its marker words.
      // Three columns, lead, name and menu. The open control and its box share the rows and columns (subgrid), so the grip, plus and menu still sit in the box's cells.
      // A 2px pad and a 2px row gap make 56px with a mouse and 68px under a coarse pointer; a marked chip grows only for its marker line.
      className={`group @container relative grid grid-cols-[auto_minmax(0,1fr)_auto] ${markedChip ? 'grid-rows-[auto_var(--control-h)_auto]' : 'grid-rows-[auto_var(--control-h)]'} gap-y-0.5 rounded-sm border border-border ${isDraft ? TONE.warning.soft : 'bg-surface-container-low'} p-0.5 text-[13px] transition-opacity duration-150 ${
        isDragging || fading ? 'opacity-50' : ''
      } ${overKind === 'locked' ? 'cursor-not-allowed' : ''} ${hasFindings || budgetMarker ? 'my-2' : ''}`}
    >
      {/* Drag activation lives on its own handle, separate from the open button below. Both used
          to share one element with dnd-kit's listeners spread onto the same button that opens the
          shift — since the KeyboardSensor's default activator keys are Space/Enter, that silently
          turned "open this shift" into "start a keyboard drag" for anyone tabbing to the chip.
          Splitting them keeps keyboard drag working (from the handle) without hijacking Enter on
          the primary control. */}
      {canPick && busy ? (
        // The plus is gone while its write is out, but its column stays (phones and the Staff view too), so the text does not jump.
        <span className="col-start-1 row-start-2 w-[18px] shrink-0 pointer-coarse:w-11" aria-hidden="true" />
      ) : canPick ? (
        // The box's lead cell is the person slot (the brief, section 3): the grip when there is a person to move, this plus when there is nobody, the Lock when nothing can change.
        // In the Participant view it spans the lead and name cells, so the whole empty box is the target, and pads its leading side by the menu's width to centre its glyph in the box.
        // On the Unfilled lane it keeps the lead cell beside the participant's name: 18px with a mouse, a 44px square under a coarse pointer (no TAP_AREA pad: it would cover the open control).
        <button
          type="button"
          data-shift-plus={shift.id}
          aria-label={pickLabel}
          title={pickLabel}
          aria-haspopup="dialog"
          aria-expanded={picking}
          aria-disabled={dragsOff || undefined}
          onClick={() => { if (!dragsOff) pick?.(shift) }}
          className={`relative z-[1] row-start-2 flex items-center justify-center rounded-[calc(var(--radius-sm)_-_2px)] text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            spanPlus ? `col-[1/span_2] ${carrying ? '' : 'pl-[calc(var(--control-h-sm)_+_4px)]'}` : 'col-start-1 w-[18px] shrink-0 pointer-coarse:w-11'
          } ${dragsOff ? 'opacity-40' : 'hover:bg-[var(--color-accent)] hover:text-[var(--color-primary)] aria-expanded:bg-[var(--color-accent)] aria-expanded:text-[var(--color-primary)]'}`}
        >
          <UserPlus className={spanPlus ? 'h-4 w-4 pointer-coarse:h-6 pointer-coarse:w-6' : 'h-3.5 w-3.5'} aria-hidden="true" />
        </button>
      ) : canWrite && draggable && (
        canLift ? (
          <button
            type="button"
            // A 44px hit area under a coarse pointer (post-merge review N6): a touch on the grip lifts at once, so this narrow target decides drag versus scroll. TAP_AREA pads it
            // 13px past each side; the coarse-only margin keeps that pad inside the box and off the name beside it. A mouse gets neither.
            className={`${TAP_AREA} z-[1] col-start-1 row-start-2 ml-0.5 flex shrink-0 cursor-grab touch-none items-center rounded-sm px-0.5 text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:cursor-grabbing pointer-coarse:mx-[13px]`}
            aria-label={`Drag to move ${shift.staffName} to another shift or day`}
            {...listeners}
            {...attributes}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : locked ? (
          <span className="relative z-[1] col-start-1 row-start-2 ml-0.5 flex w-[18px] shrink-0 items-center justify-center text-muted-foreground pointer-coarse:mx-[13px]" title={lockTitle}>
            <Lock className="h-3 w-3" aria-hidden="true" />
          </span>
        ) : (
          // Nobody to move, so no grip, but the column stays so names line up down a day.
          <span className="col-start-1 row-start-2 ml-0.5 w-[18px] shrink-0 pointer-coarse:mx-[13px]" aria-hidden="true" />
        )
      )}

      {/* The whole visible chip body is the open control, so the tappable area matches what's drawn: both rows, all three columns.

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
        className={`col-span-full ${markedChip ? 'row-[1/span_3]' : 'row-[1/span_2]'} grid grid-cols-subgrid grid-rows-subgrid rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
      >
        {/* The header: one 16px line of 12px text, 4px in from the tray's inner edge. The time has the chip's whole width and never gives way; the kind is right-aligned after it. */}
        {/* A Draft chip's marker is a 20px badge reaching 12px into the tray, so the header keeps clear of it. */}
        <span className={`col-span-full flex h-4 min-w-0 items-center gap-0.5 ${isDraft && hasFindings ? 'pl-0.5 pr-3' : 'px-0.5'} text-xs`}>
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
          {/* The kind, which gives way before the time. The glyph and the word are each whole or not drawn at all, never a sliver, and the word goes first. The box is one clipped line
              that wraps, with a zero-width first item holding that line, so anything that does not fit wraps onto the hidden second line (ReadinessNote's technique). */}
          <span className="flex h-4 min-w-0 flex-1 flex-wrap items-center justify-end gap-y-4 overflow-hidden text-muted-foreground" title={source.title} data-shift-source={source.kind}>
            <span className="h-4 w-0" aria-hidden="true" />
            {/* Draft leads the kind, so on a narrow chip the kind's word goes first, then its glyph, then this: the tint is the cue that is never dropped. */}
            {isDraft && <span className={`shrink-0 pr-1 font-semibold ${TONE.warning.ink}`}>Draft</span>}
            <SourceIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="shrink-0 pl-0.5">{source.word}</span>
          </span>
        </span>

        {/* The box: who. Solid when someone is on the shift, dashed when it has a hole (nobody, or a worker on approved leave). The ring of a drop that does something, and of an open picker, lands here, not on the tray.
            overflow-hidden on the name cell: on a narrow day column the name can be squeezed to nothing and the fixed-width tail (override icon, on-leave marker) still has to yield, not spill over the menu. */}
        <span
          data-shift-box
          className={`col-span-full ${markedChip ? 'row-start-2' : ''} grid grid-cols-subgrid items-center rounded-[calc(var(--radius-sm)_-_2px)] border border-border bg-card ${dashed || onApprovedLeave ? 'border-dashed' : ''} ${
            overKind === 'assign' || overKind === 'move' || overKind === 'prompt' || picking ? 'ring-2 ring-ring' : ''
          }`}
        >
          <span className={`col-start-2 flex min-w-0 items-center overflow-hidden ${hasLead ? 'pl-0.5' : 'pl-1.5'} ${hasMenu ? '' : 'pr-1.5'}`}>
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
            {!budgetMarker && shift.overrideReason && (
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
                dashed box makes the hole visible at a glance; this names why. Icon at rest, with the
                words shown only once the chip is wide enough (container query on the chip): below that they
                are display:none, never a clipped or half-drawn word. Assistive tech and the hover title get
                "On leave" / the full explanation from the control's aria-label and the chip's title. */}
            {onApprovedLeave && (
              <span className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground" title={onLeaveTitle}>
                <CalendarOff className="h-3 w-3" aria-hidden="true" />
                <span className="hidden @[15rem]:inline" title={onLeaveTitle}>On leave</span>
              </span>
            )}
            {awayLine && context !== 'participant' && (
              <span data-regular-away className="ml-1 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground" title={awayLine}>
                <CalendarOff className="h-3 w-3" aria-hidden="true" />
                <span className="hidden @[15rem]:inline">Regular away</span>
              </span>
            )}
          </span>
        </span>
        {budgetMarker && (
          /* The spec calls for the marker WORDS on the chip, including at 130px. The marker line has the chip's full width, so natural line breaks keep both words intact without overflowing the tray.
             It's a child of the open control, but the control's explicit aria-label remains the single accessible name (the browser does not add descendants to an aria-labeled control). */
          <span
            data-budget-marker-words
            className={`col-span-full row-start-3 min-w-0 whitespace-normal break-words px-0.5 text-xs font-semibold leading-4 ${budgetDisc.ink}`}
          >
            {OVER_BUDGET_MARKER[budgetMarker]}
          </span>
        )}
      </div>

      {/*
        The severity marker hangs off the tray's top-right corner (the chip brief, section 2.2): a 12px box from 9px above the tray to 3px into it (offsets count from inside its 1px border), clear of the header line, and 2px clear of the next
        day's chip. The chip takes my-2 for it (symmetric, so it stays centred in its row), so the board's sticky day header never cuts it. pointer-events-none so it never intercepts the click. It's a safety signal, not decoration, so it keeps
        its own role="img" label (and hover title), and the same severity text leads the open control's aria-label (openName) so it is announced before time/person.
      */}
      {hasFindings && (
        <span
          // A Draft chip's marker is a badge (card fill, the tone's ink, a ring) so it outranks the amber tray; 20px, hung 8px above the tray, inside the chip's my-2.
          className={`pointer-events-none absolute z-10 flex ${isDraft ? `-top-[9px] -right-2 h-5 w-5 items-center justify-center rounded-full ring-1 ring-current ${hasBlocking ? ON_TINT.danger : ON_TINT.warning}` : '-top-[10px] -right-1.5 h-3 w-3'}`}
          role="img"
          aria-label={findingsSeverityLabel(shift.findings)}
          title={findingsSeverityLabel(shift.findings)}
        >
          {hasBlocking ? (
            <AlertOctagon className={isDraft ? 'h-3.5 w-3.5' : 'h-3 w-3 text-destructive'} aria-hidden="true" />
          ) : (
            // Amber-700, not the --color-warning token: the token (#f59e0b) measures 1.94:1
            // against this chip's surface-container-low background, failing WCAG 1.4.11's 3:1
            // minimum for a graphical object conveying meaning. --color-on-warning-container
            // (#92400e) clears it comfortably while still reading as amber.
            <AlertTriangle className={isDraft ? 'h-3.5 w-3.5' : 'h-3 w-3 text-[var(--color-on-warning-container)]'} aria-hidden="true" />
          )}
        </span>
      )}

      {/* The over-budget marker (design review H1): a 20 px disc on the chip's corner, not a 12 px shield in the name row. It is out of the flow, so the label never gives way to it, and it is
          pointer-events-none like the severity marker, so it never takes a click from the chip or the menu. It takes the bottom corner on every chip (the chip brief's tray, 2026-10-15): on the top
          one it sat on the header line, where the time must never clip. The part that hangs off the chip needs room to hang in, so the chip leaves 8 px of margin below. It keeps its role="img", its words in the accessible name and the hover title, and its data attribute. */}
      {budgetMarker && budgetMarkerTitle && (
        <span
          className={`pointer-events-none absolute z-10 flex h-5 w-5 items-center justify-center ring-2 ring-[var(--color-card)] -bottom-2 -right-1 ${budgetDisc.shape} ${budgetDisc.fill}`}
          role="img"
          aria-label={budgetMarkerName ?? undefined}
          title={budgetMarkerTitle}
          data-budget-marker={budgetMarker}
        >
          <budgetDisc.Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      )}

      {/* Not while a drop on this shift is out: no action can run during the write, and "Assigning {name}…" needs the room. */}
      {hasMenu && (
        // The "Actions for …" trigger is Dropdown's icon variant, which hard-codes `p-1.5 rounded-lg` (a 26px
        // square, radius 8px) and takes no className or custom trigger. This wrapper gives that one button the
        // geometry of `<Button iconOnly>` — a --control-h-sm square (24px, 36px under a coarse pointer) at
        // --radius-sm, centred icon — from outside. Delete these overrides once Dropdown's icon trigger renders
        // through Button itself. It is the box's trailing cell, 4px in from the box's edge.
        <span className="relative z-[1] col-start-3 row-start-2 flex shrink-0 items-center pr-1 [&_button]:inline-flex [&_button]:h-[var(--control-h-sm)] [&_button]:w-[var(--control-h-sm)] [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[var(--radius-sm)] [&_button]:p-0">
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
