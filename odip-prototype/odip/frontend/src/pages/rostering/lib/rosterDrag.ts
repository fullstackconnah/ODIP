import { createContext } from 'react'
import { closestCenter, pointerWithin, type Announcements, type CollisionDetection, type Modifier, type ScreenReaderInstructions } from '@dnd-kit/core'
import { format, parseISO } from 'date-fns'
import type { PublishWeekResultDto, RosterStaffRowDto, ShiftDto, ShiftStatus, StaffLeaveDto, StaffListDto } from '@/api/types'
import { plural } from '@/lib/format'
import { formatShiftTime } from '@/lib/utils'
import { formatDayAccessibleName, formatShiftTimeRange, isUnfilledShift } from './roster'

/**
 * Roster board drag and drop (spec and shape brief, 2026-10-14). Whatever is dragged, a PERSON is carried: from the staff strip, or lifted off a shift by its grip (`fromShift`).
 * No drag ever changes a shift's day or time.
 */
export type DragCarry = { staffId: string; staffName: string; fromShift?: ShiftDto }

/** An empty day of a participant's row: a drop there opens the create form, prefilled. */
export type DayTarget = { kind: 'day'; participantId: string; participantName: string; day: string }

/** What a carried person can land on: a shift's puck, or an empty day. */
export type DropTarget = { kind: 'shift'; shift: ShiftDto } | DayTarget

export type DropOutcome =
  | { kind: 'none' }                                                              // over nothing, their own puck, or a shift they already hold
  | { kind: 'locked'; status: ShiftStatus }
  | { kind: 'assign'; shift: ShiftDto }                                           // from the strip onto a hole (Needs staff, or its worker is on leave)
  | { kind: 'move'; from: ShiftDto; shift: ShiftDto; mode: 'Move' | 'Replace' }   // off a puck onto a hole: Move onto Needs staff, Replace an on-leave worker
  | { kind: 'prompt'; shift: ShiftDto; canSwap: boolean }                       // onto a filled puck: Replace, Swap (only when carried off a puck) or Cancel
  | { kind: 'create'; participantId: string; day: string }

/** While a drop's request is out: the target reads "Assigning {first name}…", a move's source fades, and every drag waits. */
export type PendingDrop = { targetId: string; sourceId?: string; staffName: string }
export type DropState = { disabled: boolean; pending: PendingDrop | null }

/** Shared by the page with the strip and every puck, so neither is threaded through the grid's rows. Outside a provider (the Staff view, phones) nothing is disabled or pending. */
export const DropStateContext = createContext<DropState>({ disabled: false, pending: null })

/** Decision 8: these keep their worker; only the completion endpoints move them on. */
export const LOCKED_SHIFT_STATUSES: readonly ShiftStatus[] = ['InProgress', 'PendingReview', 'Completed', 'Cancelled']

export function isLockedShift(shift: { status: ShiftStatus }): boolean {
  return LOCKED_SHIFT_STATUSES.includes(shift.status)
}

const STATUS_WORDS: Partial<Record<ShiftStatus, string>> = { InProgress: 'In progress', PendingReview: 'Pending review', Completed: 'Completed', Cancelled: 'Cancelled' }

/** "In progress", "Pending review", "Completed" or "Cancelled": how the lock, the carried puck and the announcements name a locked status. */
export function lockedWords(status: ShiftStatus): string {
  return STATUS_WORDS[status] ?? status
}

/** shortcut: mirrors RosterConflictService.DefaultWeeklyHoursThreshold (38 h); add staff summaries to the participant board if the two ever differ. */
export const WEEK_TARGET_HOURS = 38

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(' ')[0]
}

/** "12" or "7.5": hours as the strip puck and the picker print them. */
export const hoursText = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** What letting go here would do. The server still judges it: nothing here checks a rule. */
export function dropOutcome(carry: DragCarry, target: DropTarget | undefined): DropOutcome {
  if (!target) return { kind: 'none' }
  if (target.kind === 'day') return { kind: 'create', participantId: target.participantId, day: target.day }
  const { shift } = target
  if (isLockedShift(shift)) return { kind: 'locked', status: shift.status }
  if (shift.id === carry.fromShift?.id || shift.staffId === carry.staffId) return { kind: 'none' }
  // A hole: nobody, or a worker whose leave was approved after the assignment. A drop fills it at once, no prompt.
  if (isUnfilledShift(shift) || shift.assigneeOnApprovedLeave) {
    return carry.fromShift
      ? { kind: 'move', from: carry.fromShift, shift, mode: isUnfilledShift(shift) ? 'Move' : 'Replace' }
      : { kind: 'assign', shift }
  }
  return { kind: 'prompt', shift, canSwap: Boolean(carry.fromShift) }
}

/** The carried puck's second line (the brief, section 10): it names the outcome before the drop. Null over nothing. */
export function carriedLine(carry: DragCarry, outcome: DropOutcome): string | null {
  switch (outcome.kind) {
    case 'locked': return `${lockedWords(outcome.status)}: can't change`
    case 'create': return `New shift, ${format(parseISO(outcome.day), 'EEE d')}`
    case 'prompt': return outcome.canSwap ? 'Replace or swap…' : `Replace ${firstName(outcome.shift.staffName)}…`
    case 'assign':
    case 'move':
      // The one time a shift's own state changes the outcome: a Published shift tells the worker at once.
      if (outcome.shift.status === 'Published') return `Published: notifies ${firstName(carry.staffName)}`
      // Leaving a Published shift tells its worker at once too (finish review fix 1), even when the target is a Draft.
      if (outcome.kind === 'move' && outcome.from.status === 'Published') return `Published: tells ${firstName(carry.staffName)}`
      // A hole that is not Published: nobody on it, or a worker on leave (the brief, section 10: "Replace {Alex} (on leave)").
      return isUnfilledShift(outcome.shift) ? 'Assign' : `Replace ${firstName(outcome.shift.staffName)} (on leave)`
    default: return null
  }
}

/** Hours each person holds in the loaded week: every non-cancelled shift of the RAW board, never the filtered one, so a filter never moves a total. */
export function staffWeekHours(shifts: ShiftDto[]): Map<string, number> {
  const hours = new Map<string, number>()
  for (const s of shifts) {
    if (!s.staffId || s.status === 'Cancelled') continue
    hours.set(s.staffId, (hours.get(s.staffId) ?? 0) + s.durationHours)
  }
  return hours
}

/**
 * A pointer drag hits only what is under the pointer, so a drop beside every target does nothing (closestCenter snapped it to the nearest puck). dnd-kit's rectangles are not clipped
 * to the board's scroll frame, so a row scrolled up under the strip, or under the sticky day header, still has its rectangle there: keep only the target whose own element is on top
 * at the pointer (the DragOverlay is pointer-events-none, so it is never that element). A keyboard drag has no pointer, so it takes the nearest target, but only once it has moved:
 * lifting and pressing Space at once lands nowhere, rather than on whichever shift is nearest (a drop can now tell a worker).
 */
export const rosterCollision: CollisionDetection = args => {
  const { pointerCoordinates, droppableContainers, active, collisionRect } = args
  if (!pointerCoordinates) {
    const start = active.rect.current.initial
    // Not measured yet (the lift's first pass) counts as not moved: otherwise the nearest shift is "over" for a frame and the live region says so instead of "Picked up".
    return !start || (start.top === collisionRect.top && start.left === collisionRect.left) ? [] : closestCenter(args)
  }
  const hits = pointerWithin(args)
  if (typeof document.elementFromPoint !== 'function') return hits   // jsdom has none
  const top = document.elementFromPoint(pointerCoordinates.x, pointerCoordinates.y)
  return hits.filter(hit => {
    const node = droppableContainers.find(container => container.id === hit.id)?.node.current
    return Boolean(top && node?.contains(top))
  })
}

/**
 * Keeps the carried puck inside the window (finish review fix 3: on an 820px tablet it ran off the right edge). The same clamp as @dnd-kit/modifiers' restrictToWindowEdges, which
 * is not installed; it measures the overlay itself, which sizes to its content, so a puck wider than the strip puck it came from still stops at the edge.
 */
export const keepInWindow: Modifier = ({ transform, overlayNodeRect, draggingNodeRect, windowRect }) => {
  const rect = overlayNodeRect ?? draggingNodeRect
  if (!rect || !windowRect) return transform
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
  return {
    ...transform,
    x: clamp(transform.x, windowRect.left - rect.left, windowRect.left + windowRect.width - rect.left - rect.width),
    y: clamp(transform.y, windowRect.top - rect.top, windowRect.top + windowRect.height - rect.top - rect.height),
  }
}

const spokenRange = (s: ShiftDto) => `${formatShiftTime(s.startTime)} to ${formatShiftTime(s.endTime)}`
/** "Mia Chen, Tuesday 9am to 3pm" */
const shiftSpeech = (s: ShiftDto) => `${s.participantName}, ${format(parseISO(s.serviceDate), 'EEEE')} ${spokenRange(s)}`
const shortDay = (iso: string) => format(parseISO(iso), 'EEE d MMM')
const CANCELLED = 'Cancelled. Nothing changed.'

export const ROSTER_SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: "To pick up a staff member, press Space or Enter. Use the arrow keys to move over a shift or an empty day. Press Space or Enter to drop, or Escape to cancel. Each shift's Actions menu can assign too.",
}

const carryOf = (active: { data: { current?: unknown } }) => active.data.current as DragCarry
const targetOf = (over: { data: { current?: unknown } } | null) => over?.data.current as DropTarget | undefined

function overSentence(carry: DragCarry, target: DropTarget | undefined): string {
  if (!target) return 'Not over a shift.'
  if (target.kind === 'day') return `Over ${target.participantName}, ${formatDayAccessibleName(target.day)}, empty. Dropping starts a new shift.`
  const { shift } = target
  if (isLockedShift(shift)) return `Over a ${lockedWords(shift.status).toLowerCase()} shift. It can't be changed.`
  const where = `Over ${shift.participantName}, ${formatDayAccessibleName(shift.serviceDate)}, ${spokenRange(shift)}`
  const outcome = dropOutcome(carry, target)
  if (outcome.kind === 'move' && outcome.from.status === 'Published')
    return `${where}, needs staff. ${firstName(carry.staffName)}'s current shift is published, so dropping tells ${firstName(carry.staffName)} at once.`
  if (outcome.kind === 'assign' || outcome.kind === 'move') return `${where}, needs staff.`
  // Gap 8: the strip's prompt has no Swap, so the sentence offers none.
  if (outcome.kind === 'prompt') return `${where}, ${shift.staffName}'s shift. Dropping asks to replace${outcome.canSwap ? ' or swap' : ''}.`
  return `${where}, ${shift.staffName}'s shift.`
}

/** dnd-kit's announcements in people's words (its defaults read ids). The result of a drop is said later, by the page's AnnouncementRegion, once the server has answered. */
export const rosterAnnouncements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${carryOf(active).staffName}.`,
  onDragOver: ({ active, over }) => overSentence(carryOf(active), targetOf(over)),
  onDragEnd: ({ active, over }) => {
    const { kind } = dropOutcome(carryOf(active), targetOf(over))
    return kind === 'none' || kind === 'locked' ? CANCELLED : undefined
  },
  onDragCancel: () => CANCELLED,
}

/** "Sam Wilson assigned to Mia Chen, Tuesday 9am to 3pm. Sam has been notified." (the last sentence only on a Published shift) */
export function assignedSentence(carry: DragCarry, shift: ShiftDto): string {
  return `${carry.staffName} assigned to ${shiftSpeech(shift)}.${shift.status === 'Published' ? ` ${firstName(carry.staffName)} has been notified.` : ''}`
}

/** "Sam Wilson moved to Mia Chen, Tuesday 9am to 3pm. Monday 9am to 3pm now needs staff." */
export function movedSentence(carry: DragCarry, to: ShiftDto): string {
  const from = carry.fromShift
  return `${carry.staffName} moved to ${shiftSpeech(to)}.${from ? ` ${format(parseISO(from.serviceDate), 'EEEE')} ${spokenRange(from)} now needs staff.` : ''}`
}

/** "Swapped: Sam is on Mia Chen, Tuesday 9am to 3pm and Alex on Jo Park, Monday 9am to 3pm." `to` is the target as the board drew it, with the worker who goes back. */
export function swappedSentence(carry: DragCarry, to: ShiftDto): string {
  const from = carry.fromShift
  return `Swapped: ${firstName(carry.staffName)} is on ${shiftSpeech(to)}${from ? ` and ${firstName(to.staffName)} on ${shiftSpeech(from)}` : ''}.`
}

/** "Published 14 shifts. 9 people notified." and, when a blocking problem kept some back (gap 2), how many stayed in draft. */
export function publishedSentence(result: PublishWeekResultDto): string {
  const kept = result.skipped > 0
    ? ` ${plural(result.skipped, 'shift')} stayed in draft: a rule that can't be overridden stops ${result.skipped === 1 ? 'it' : 'them'}.`
    : ''
  return `Published ${plural(result.published, 'shift')}. ${plural(result.notified, 'person', 'people')} notified.${kept}`
}

/** The Replace/Swap prompt's body (the brief, section 10), a sentence a line. */
export function replacePromptLines(carry: DragCarry, shift: ShiftDto, canSwap: boolean): string[] {
  const them = firstName(shift.staffName)
  const you = firstName(carry.staffName)
  const from = carry.fromShift
  return [
    `${shift.participantName}, ${shortDay(shift.serviceDate)}, ${formatShiftTimeRange(shift.startTime, shift.endTime)}.`,
    `Replace: ${you} takes it and ${them} comes off.`,
    ...(canSwap && from
      ? [`Swap: ${you} takes it and ${them} takes ${you}'s ${shortDay(from.serviceDate)}, ${formatShiftTimeRange(from.startTime, from.endTime)} shift with ${from.participantName}.`]
      : []),
    ...(shift.status === 'Published' ? ['This shift is published, so the change goes out now.'] : []),
    // The shift the person is carried off changes too (Replace leaves it empty, Swap puts the other worker on it): say so when it is already out.
    ...(from?.status === 'Published' ? [`${you}'s ${shortDay(from.serviceDate)} shift is published, so the change there goes out now.`] : []),
  ]
}

/** Publish week's confirm body, counted from the board's Draft shifts: "14 draft shifts go out to staff. The 9 people on them are notified. 3 still need staff and are published as needing staff." */
export function publishWeekMessage(drafts: ShiftDto[]): string {
  const people = new Set(drafts.flatMap(s => (s.staffId ? [s.staffId] : []))).size
  const unfilled = drafts.filter(isUnfilledShift).length
  return [
    `${plural(drafts.length, 'draft shift')} ${drafts.length === 1 ? 'goes' : 'go'} out to staff.`,
    people > 0 ? `The ${plural(people, 'person', 'people')} on them ${people === 1 ? 'is' : 'are'} notified.` : null,
    unfilled > 0 ? `${unfilled} still ${unfilled === 1 ? 'needs' : 'need'} staff and ${unfilled === 1 ? 'is' : 'are'} published as needing staff.` : null,
  ].filter(Boolean).join(' ')
}

// ── The staff picker (spec 2026-10-15, decision C; the brief, section 4). Nothing here checks a rule: the server judges the pick. ──

/** One row of the picker: a person, and on a Move row the shift they would come off. `key` is unique in the list: the person's id, or `{person id}:{source shift id}`. */
export type PickRow = { key: string; person: StaffListDto; hours: number; leave: 'Approved' | 'Pending' | null; source?: ShiftDto }
export type PickGroups = { free: PickRow[]; move: PickRow[]; leave: PickRow[] }

/** A shift's start and end in minutes on the wall clock with no zone. A day is always 1440 minutes, so a clock change never moves an overlap (Review Focus 1). */
function shiftMinutes(s: Pick<ShiftDto, 'serviceDate' | 'startTime' | 'endTime' | 'endsNextDay'>): [number, number] {
  const day = Date.UTC(+s.serviceDate.slice(0, 4), +s.serviceDate.slice(5, 7) - 1, +s.serviceDate.slice(8, 10)) / 60_000
  const at = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5)
  return [day + at(s.startTime), day + at(s.endTime) + (s.endsNextDay ? 1440 : 0)]
}

export function shiftsOverlap(a: ShiftDto, b: ShiftDto): boolean {
  const [aStart, aEnd] = shiftMinutes(a)
  const [bStart, bEnd] = shiftMinutes(b)
  return aStart < bEnd && bStart < aEnd
}

/** Leave covering the day: approved wins over pending. */
function leaveOn(leave: StaffLeaveDto[], staffId: string, day: string): PickRow['leave'] {
  const covering = leave.filter(l => l.staffId === staffId && l.from <= day && day <= l.to)
  return covering.some(l => l.status === 'Approved') ? 'Approved' : covering.length > 0 ? 'Pending' : null
}

/**
 * Who goes in which group for a Needs staff shift (the brief, section 4). Each active person lands in the FIRST group that matches:
 * 1. Move: they hold a non-cancelled, unlocked shift whose time overlaps this one. Each such shift is its own row.
 *    Left out entirely: a person whose only overlapping shifts are locked, or who is on the other chip of this 2:1 pair (same participant, day and times).
 * 2. Leave: approved or pending leave covers the day.
 * 3. Free: everyone else, a non-overlapping shift that day included.
 * Each group keeps the staff list's order (by last name), and a person's Move rows go by start time. Shown Free, then Move, then Leave.
 */
export function pickerGroups(target: ShiftDto, staff: StaffListDto[], shifts: ShiftDto[], leave: StaffLeaveDto[], hours: Map<string, number>): PickGroups {
  const groups: PickGroups = { free: [], move: [], leave: [] }
  const isPair = (s: ShiftDto) => s.participantId === target.participantId && s.serviceDate === target.serviceDate && s.startTime === target.startTime && s.endTime === target.endTime
  for (const person of staff) {
    if (!person.isActive) continue
    const row = { person, hours: hours.get(person.id) ?? 0, leave: leaveOn(leave, person.id, target.serviceDate) }
    const overlapping = shifts
      .filter(s => s.staffId === person.id && s.id !== target.id && s.status !== 'Cancelled' && shiftsOverlap(s, target))
      .sort((a, b) => shiftMinutes(a)[0] - shiftMinutes(b)[0])
    const sources = overlapping.filter(s => !isLockedShift(s) && !isPair(s))
    if (sources.length > 0) groups.move.push(...sources.map(source => ({ ...row, key: `${person.id}:${source.id}`, source })))
    else if (overlapping.length === 0) (row.leave ? groups.leave : groups.free).push({ ...row, key: person.id })
  }
  return groups
}

/** The plus's accessible name and title: "Assign someone to Tuesday 9am to 3pm for Mia". */
export function pickName(shift: ShiftDto): string {
  return `Assign someone to ${format(parseISO(shift.serviceDate), 'EEEE')} ${spokenRange(shift)} for ${firstName(shift.participantName)}`
}

/** A Move row's second line: "Move from Mon 8am–5pm · Liam". */
export function moveLine(source: ShiftDto): string {
  return `Move from ${format(parseISO(source.serviceDate), 'EEE')} ${formatShiftTimeRange(source.startTime, source.endTime)} · ${firstName(source.participantName)}`
}

/** An option's accessible name, in the strip puck's style (StaffStrip): "Jack O'Sullivan, 15 of 38 hours this week, move from Monday 8am to 5pm with Liam, published: tells Jack". */
export function pickOptionName(row: PickRow): string {
  const { person, source } = row
  return [
    `${person.fullName}, ${hoursText(row.hours)} of ${WEEK_TARGET_HOURS} hours this week`,
    person.hasExpiredQualifications ? 'qualifications expired' : null,
    row.leave === 'Approved' ? 'on leave' : row.leave === 'Pending' ? 'leave pending' : null,
    source ? `move from ${format(parseISO(source.serviceDate), 'EEEE')} ${spokenRange(source)} with ${firstName(source.participantName)}` : null,
    source?.status === 'Published' ? `published: tells ${firstName(person.fullName)}` : null,
  ].filter(Boolean).join(', ')
}

/** The Staff view's leave for the picker: its rows' leave bars that are leave requests (the participant board sends `staffLeave` instead). */
export function leaveFromStaffRows(rows: RosterStaffRowDto[]): StaffLeaveDto[] {
  return rows.flatMap(row => row.leave
    .filter(bar => bar.kind === 'ApprovedLeave' || bar.kind === 'PendingLeave')
    .map(bar => ({ staffId: row.staffId, from: bar.startDate, to: bar.endDate, status: bar.kind === 'ApprovedLeave' ? 'Approved' as const : 'Pending' as const })))
}
