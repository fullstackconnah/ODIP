import { afterEach, describe, it, expect } from 'vitest'
import { makeShift, makeStaffRow, makeUnfilledShift } from '../test-fixtures'
import type { ShiftDto, StaffLeaveDto, StaffListDto } from '@/api/types'
import {
  assignedSentence, carriedLine, dropOutcome, keepInWindow, movedSentence, publishedSentence, publishWeekMessage, replacePromptLines, rosterAnnouncements, rosterCollision,
  staffWeekHours, swappedSentence, type DragCarry, type DropTarget,
  hoursText, leaveFromStaffRows, moveLine, pickName, pickOptionName, pickerGroups, shiftsOverlap, type PickRow,
} from './rosterDrag'

const sam: DragCarry = { staffId: 'staff-2', staffName: 'Sam Wilson' }
const onShift = (shift = makeShift({ id: 'from', staffId: 'staff-2', staffName: 'Sam Wilson' })): DragCarry => ({ ...sam, fromShift: shift })

describe('dropOutcome', () => {
  it('assigns a person from the strip to a Needs staff shift', () => {
    const open = makeUnfilledShift({ id: 'open' })
    expect(dropOutcome(sam, { kind: 'shift', shift: open })).toEqual({ kind: 'assign', shift: open })
  })

  it('moves a person carried off a puck onto Needs staff, and replaces an on-leave worker without asking', () => {
    const carry = onShift()
    const open = makeUnfilledShift({ id: 'open' })
    const onLeave = makeShift({ id: 'leave', assigneeOnApprovedLeave: true })
    expect(dropOutcome(carry, { kind: 'shift', shift: open })).toEqual({ kind: 'move', from: carry.fromShift, shift: open, mode: 'Move' })
    expect(dropOutcome(carry, { kind: 'shift', shift: onLeave })).toEqual({ kind: 'move', from: carry.fromShift, shift: onLeave, mode: 'Replace' })
  })

  it('asks on a filled puck, and offers Swap only to a person carried off a puck', () => {
    const filled = makeShift({ id: 'filled' })
    expect(dropOutcome(sam, { kind: 'shift', shift: filled })).toEqual({ kind: 'prompt', shift: filled, canSwap: false })
    expect(dropOutcome(onShift(), { kind: 'shift', shift: filled })).toEqual({ kind: 'prompt', shift: filled, canSwap: true })
  })

  it.each(['InProgress', 'PendingReview', 'Completed', 'Cancelled'] as const)('refuses a %s shift', status => {
    expect(dropOutcome(sam, { kind: 'shift', shift: makeUnfilledShift({ status }) })).toEqual({ kind: 'locked', status })
  })

  it('does nothing over nothing, over their own puck, or over a shift they already hold', () => {
    const own = makeShift({ id: 'own', staffId: 'staff-2' })
    expect(dropOutcome(sam, undefined)).toEqual({ kind: 'none' })
    expect(dropOutcome(onShift(own), { kind: 'shift', shift: own })).toEqual({ kind: 'none' })
    expect(dropOutcome(sam, { kind: 'shift', shift: own })).toEqual({ kind: 'none' })
  })

  it('opens the create form on an empty day', () => {
    expect(dropOutcome(sam, { kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-18' })).toEqual({ kind: 'create', participantId: 'p-1', day: '2026-08-18' })
  })
})

describe('carriedLine', () => {
  it("names each outcome in the brief's words", () => {
    expect(carriedLine(sam, { kind: 'assign', shift: makeUnfilledShift({ status: 'Draft' }) })).toBe('Assign')
    expect(carriedLine(sam, { kind: 'assign', shift: makeUnfilledShift({ status: 'Published' }) })).toBe('Published: notifies Sam')
    expect(carriedLine(sam, { kind: 'assign', shift: makeShift({ status: 'Draft', staffName: 'Alex Ng', assigneeOnApprovedLeave: true }) })).toBe('Replace Alex (on leave)')
    // A Published on-leave puck says what matters more: the change goes out now.
    expect(carriedLine(sam, { kind: 'assign', shift: makeShift({ status: 'Published', staffName: 'Alex Ng', assigneeOnApprovedLeave: true }) })).toBe('Published: notifies Sam')
    expect(carriedLine(sam, { kind: 'prompt', shift: makeShift({ staffName: 'Alex Ng' }), canSwap: false })).toBe('Replace Alex…')
    expect(carriedLine(sam, { kind: 'prompt', shift: makeShift(), canSwap: true })).toBe('Replace or swap…')
    expect(carriedLine(sam, { kind: 'create', participantId: 'p-1', day: '2026-08-18' })).toBe('New shift, Tue 18')
    expect(carriedLine(sam, { kind: 'locked', status: 'InProgress' })).toBe("In progress: can't change")
    expect(carriedLine(sam, { kind: 'none' })).toBeNull()
  })
})

// Finish review fix 1: a move or swap OFF a Published shift tells its worker at once too, so the carried puck, the prompt and the announcement say so.
describe('a Published source shift', () => {
  const draftHole = makeUnfilledShift({ id: 'open', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', status: 'Draft' })
  const draftFilled = makeShift({ id: 'filled', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', staffId: 'staff-9', staffName: 'Alex Ng', status: 'Draft' })
  const publishedSource = onShift(makeShift({ id: 'from', serviceDate: '2026-08-17', staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Published' }))
  const draftSource = onShift(makeShift({ id: 'from', serviceDate: '2026-08-17', staffId: 'staff-2', staffName: 'Sam Wilson', status: 'Draft' }))

  it('makes the carried line say who is told when a move off it lands on a Draft', () => {
    expect(carriedLine(publishedSource, { kind: 'move', from: publishedSource.fromShift!, shift: draftHole, mode: 'Move' })).toBe('Published: tells Sam')
    expect(carriedLine(draftSource, { kind: 'move', from: draftSource.fromShift!, shift: draftHole, mode: 'Move' })).toBe('Assign')
  })

  it('adds a prompt line for the source, and none when it is a Draft', () => {
    expect(replacePromptLines(publishedSource, draftFilled, true)).toContain("Sam's Mon 17 Aug shift is published, so the change there goes out now.")
    expect(replacePromptLines(draftSource, draftFilled, true).join(' ')).not.toMatch(/published/)
  })

  it('says it in the announcement over the target', () => {
    const active = { id: 'a', data: { current: publishedSource } } as never
    const over = { id: 'o', data: { current: { kind: 'shift', shift: draftHole } } } as never
    expect(rosterAnnouncements.onDragOver({ active, over })).toBe("Over Mia Chen, Tuesday 18 August, 9am to 3pm, needs staff. Sam's current shift is published, so dropping tells Sam at once.")
  })
})

// Finish review fix 3: the carried puck never leaves the window (it ran off the right edge on an 820px tablet).
describe('keepInWindow', () => {
  const windowRect = { top: 0, left: 0, width: 820, height: 1180, right: 820, bottom: 1180 }
  const puckAt = (left: number, top: number) => ({ left, top, width: 200, height: 44, right: left + 200, bottom: top + 44 })
  const args = (transform: { x: number; y: number }, rect = puckAt(500, 300)) =>
    ({ transform: { ...transform, scaleX: 1, scaleY: 1 }, overlayNodeRect: rect, draggingNodeRect: rect, windowRect }) as unknown as Parameters<typeof keepInWindow>[0]

  it('leaves a move inside the window alone', () => {
    expect(keepInWindow(args({ x: 50, y: -40 }))).toMatchObject({ x: 50, y: -40 })
  })

  it('stops the puck at the right, left, top and bottom edges', () => {
    expect(keepInWindow(args({ x: 300, y: 0 }))).toMatchObject({ x: 120 })      // 500 + 200 would end at 1000; it may end at 820
    expect(keepInWindow(args({ x: -600, y: 0 }))).toMatchObject({ x: -500 })
    expect(keepInWindow(args({ x: 0, y: -400 }))).toMatchObject({ y: -300 })
    expect(keepInWindow(args({ x: 0, y: 900 }))).toMatchObject({ y: 836 })
  })

  it('does nothing before anything is measured', () => {
    const unmeasured = { transform: { x: 999, y: 999, scaleX: 1, scaleY: 1 }, overlayNodeRect: null, draggingNodeRect: null, windowRect: null } as unknown as Parameters<typeof keepInWindow>[0]
    expect(keepInWindow(unmeasured)).toMatchObject({ x: 999, y: 999 })
  })
})

describe('staffWeekHours', () => {
  it("adds up each person's shifts in the week, leaving out cancelled and unfilled ones", () => {
    const hours = staffWeekHours([
      makeShift({ id: 'a', staffId: 'staff-1', durationHours: 8 }),
      makeShift({ id: 'b', staffId: 'staff-1', durationHours: 4.5 }),
      makeShift({ id: 'c', staffId: 'staff-1', durationHours: 6, status: 'Cancelled' }),
      makeShift({ id: 'd', staffId: 'staff-2', durationHours: 3 }),
      makeUnfilledShift({ id: 'e', durationHours: 7 }),
    ])
    expect(Object.fromEntries(hours)).toEqual({ 'staff-1': 12.5, 'staff-2': 3 })
  })
})

// Review Focus 3: a pointer drop beside every target does nothing; a keyboard drag (no pointer) still reaches the nearest target once it has moved.
describe('rosterCollision', () => {
  const rect = { top: 0, left: 0, bottom: 20, right: 100, width: 100, height: 20 }
  const movedOnce = { ...rect, top: 25, bottom: 45 }   // one 25px arrow step
  const args = (pointerCoordinates: { x: number; y: number } | null, collisionRect = rect) => ({
    active: { id: 'carry', rect: { current: { initial: rect, translated: null } } }, collisionRect, droppableRects: new Map([['target', rect]]),
    droppableContainers: [{ id: 'target' }], pointerCoordinates,
  }) as unknown as Parameters<typeof rosterCollision>[0]

  it('hits nothing for a pointer beside every target, and the target under the pointer', () => {
    expect(rosterCollision(args({ x: 500, y: 500 }))).toEqual([])
    expect(rosterCollision(args({ x: 50, y: 10 })).map(c => c.id)).toEqual(['target'])
  })

  it('lands a keyboard drag nowhere until it has moved, then on the nearest target', () => {   // N3
    expect(rosterCollision(args(null))).toEqual([])
    // The first pass of a lift runs before dnd-kit has measured where it started: that is not a move either.
    const unmeasured = { ...args(null, movedOnce), active: { id: 'carry', rect: { current: { initial: null, translated: null } } } } as unknown as Parameters<typeof rosterCollision>[0]
    expect(rosterCollision(unmeasured)).toEqual([])
    expect(rosterCollision(args(null, movedOnce)).map(c => c.id)).toEqual(['target'])
  })

  // dnd-kit does not clip rectangles to the scroll frame: a row scrolled up under the strip, or behind the sticky day header, is still "under" the pointer.
  describe('against what is actually on top at the pointer', () => {
    const target = document.createElement('div')
    const cover = document.createElement('div')
    const onTop = (element: Element) => Object.defineProperty(document, 'elementFromPoint', { value: () => element, configurable: true })
    const over = () => ({ ...args({ x: 50, y: 10 }), droppableContainers: [{ id: 'target', node: { current: target } }] }) as unknown as Parameters<typeof rosterCollision>[0]
    afterEach(() => { delete (document as { elementFromPoint?: unknown }).elementFromPoint })

    it('hits the target when its own element is on top', () => {
      onTop(target)
      expect(rosterCollision(over()).map(c => c.id)).toEqual(['target'])
    })

    it('hits nothing when something else covers it', () => {
      onTop(cover)
      expect(rosterCollision(over())).toEqual([])
    })
  })
})

describe('rosterAnnouncements', () => {
  const active = (carry: DragCarry) => ({ id: 'a', data: { current: carry } }) as never
  const over = (target: DropTarget) => ({ id: 'o', data: { current: target } }) as never
  const tue = makeUnfilledShift({ id: 'open', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', status: 'Draft' })
  const alexOnTue = makeShift({ ...tue, id: 'filled', staffId: 'staff-9', staffName: 'Alex Ng' })

  it('names people, days and times, never ids', () => {
    expect(rosterAnnouncements.onDragStart({ active: active(sam) })).toBe('Picked up Sam Wilson.')
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: over({ kind: 'shift', shift: tue }) })).toBe('Over Mia Chen, Tuesday 18 August, 9am to 3pm, needs staff.')
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: over({ kind: 'shift', shift: alexOnTue }) }))
      .toBe("Over Mia Chen, Tuesday 18 August, 9am to 3pm, Alex Ng's shift. Dropping asks to replace.")
    expect(rosterAnnouncements.onDragOver({ active: active(onShift()), over: over({ kind: 'shift', shift: alexOnTue }) }))
      .toBe("Over Mia Chen, Tuesday 18 August, 9am to 3pm, Alex Ng's shift. Dropping asks to replace or swap.")
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: over({ kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-18' }) }))
      .toBe('Over Mia Chen, Tuesday 18 August, empty. Dropping starts a new shift.')
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: over({ kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-18', beside: 1 }) }))
      .toBe('Over Mia Chen, Tuesday 18 August, beside 1 shift. Dropping starts a new shift.')
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: over({ kind: 'day', participantId: 'p-1', participantName: 'Mia Chen', day: '2026-08-18', beside: 2 }) }))
      .toBe('Over Mia Chen, Tuesday 18 August, beside 2 shifts. Dropping starts a new shift.')
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: over({ kind: 'shift', shift: makeShift({ status: 'Completed' }) }) })).toBe("Over a completed shift. It can't be changed.")
    expect(rosterAnnouncements.onDragOver({ active: active(sam), over: null })).toBe('Not over a shift.')
  })

  it('says Cancelled for Escape or a drop that changes nothing, and leaves a real drop to the result', () => {
    expect(rosterAnnouncements.onDragCancel({ active: active(sam), over: null })).toBe('Cancelled. Nothing changed.')
    expect(rosterAnnouncements.onDragEnd({ active: active(sam), over: null })).toBe('Cancelled. Nothing changed.')
    expect(rosterAnnouncements.onDragEnd({ active: active(sam), over: over({ kind: 'shift', shift: tue }) })).toBeUndefined()
  })
})

describe('sentences', () => {
  const tue = makeShift({ id: 'to', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', staffName: 'Alex Ng' })
  const mon = makeShift({ id: 'from', participantName: 'Jo Park', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '15:00:00', staffId: 'staff-2', staffName: 'Sam Wilson' })

  it('reads the results as the brief writes them', () => {
    expect(assignedSentence(sam, tue)).toBe('Sam Wilson assigned to Mia Chen, Tuesday 9am to 3pm. Sam has been notified.')
    expect(assignedSentence(sam, { ...tue, status: 'Draft' })).toBe('Sam Wilson assigned to Mia Chen, Tuesday 9am to 3pm.')
    expect(movedSentence(onShift(mon), tue)).toBe('Sam Wilson moved to Mia Chen, Tuesday 9am to 3pm. Monday 9am to 3pm now needs staff.')
    expect(swappedSentence(onShift(mon), tue)).toBe('Swapped: Sam is on Mia Chen, Tuesday 9am to 3pm and Alex on Jo Park, Monday 9am to 3pm.')
    expect(publishedSentence({ published: 14, notified: 9, unfilled: 3, skipped: 0 })).toBe('Published 14 shifts. 9 people notified.')
    expect(publishedSentence({ published: 1, notified: 1, unfilled: 0, skipped: 2 }))
      .toBe("Published 1 shift. 1 person notified. 2 shifts stayed in draft: a rule that can't be overridden stops them.")
  })

  it('builds the Replace/Swap prompt and the Publish week dialog', () => {
    expect(replacePromptLines(onShift(mon), tue, true)).toEqual([
      'Mia Chen, Tue 18 Aug, 9am–3pm.',
      'Replace: Sam takes it and Alex comes off.',
      "Swap: Sam takes it and Alex takes Sam's Mon 17 Aug, 9am–3pm shift with Jo Park.",
      'This shift is published, so the change goes out now.',
      "Sam's Mon 17 Aug shift is published, so the change there goes out now.",
    ])
    expect(replacePromptLines(sam, { ...tue, status: 'Draft' }, false)).toEqual(['Mia Chen, Tue 18 Aug, 9am–3pm.', 'Replace: Sam takes it and Alex comes off.'])
    expect(publishWeekMessage([makeShift({ id: '1', staffId: 'a' }), makeShift({ id: '2', staffId: 'a' }), makeShift({ id: '3', staffId: 'b' }), makeUnfilledShift({ id: '4' })]))
      .toBe('4 draft shifts go out to staff. The 2 people on them are notified. 1 still needs staff and is published as needing staff.')
  })
})

// The staff picker (spec 2026-10-15, decision C; the brief, section 4). The target: Mia's Tuesday 18 August, 9am-3pm, Needs staff.
describe('pickerGroups', () => {
  const target = makeUnfilledShift({ id: 'open', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00', status: 'Draft' })
  const person = (id: string, fullName: string, extra: Partial<StaffListDto> = {}) => ({ id, fullName, isActive: true, hasExpiredQualifications: false, ...extra }) as StaffListDto
  const on = (id: string, staffId: string, o: Partial<ShiftDto> = {}) => makeShift({
    id, staffId, staffName: 'Someone', participantId: 'p-2', participantName: 'Liam Okafor', serviceDate: '2026-08-18', startTime: '08:00:00', endTime: '17:00:00', status: 'Draft', ...o,
  })
  const keys = (rows: PickRow[]) => rows.map(r => r.key)
  const none = new Map<string, number>()

  it('puts each active person in the first group that matches, each group in the staff list order', () => {
    const staff = [person('kim', 'Kim Lee'), person('jack', "Jack O'Sullivan"), person('marcus', 'Marcus Papadopoulos'), person('alex', 'Alex Ng'), person('pat', 'Pat Done'), person('zed', 'Zed Gone', { isActive: false })]
    const jackTue = on('jack-tue', 'jack')
    const leave: StaffLeaveDto[] = [
      { staffId: 'marcus', from: '2026-08-18', to: '2026-08-18', status: 'Approved' },
      { staffId: 'alex', from: '2026-08-17', to: '2026-08-19', status: 'Pending' },
    ]
    const groups = pickerGroups(target, staff, [jackTue, on('pat-done', 'pat', { status: 'Completed' })], leave, new Map([['jack', 9]]))

    expect(keys(groups.free)).toEqual(['kim'])
    expect(keys(groups.move)).toEqual(['jack:jack-tue'])
    expect(groups.move[0]).toMatchObject({ hours: 9, leave: null, source: jackTue })
    expect(groups.leave.map(r => [r.key, r.leave])).toEqual([['marcus', 'Approved'], ['alex', 'Pending']])
    // Pat's only overlapping shift is Completed (locked) and Zed is inactive: neither is offered at all.
  })

  it('ignores a cancelled shift, and counts a shift that day that does not overlap as free', () => {
    const groups = pickerGroups(target, [person('kim', 'Kim Lee')], [on('c', 'kim', { status: 'Cancelled' }), on('eve', 'kim', { startTime: '16:00:00', endTime: '20:00:00' })], [], none)
    expect(keys(groups.free)).toEqual(['kim'])
  })

  it('leaves out the other worker of this 2:1 pair, and anyone whose only overlap is locked', () => {
    const pair = on('pair', 'sam', { participantId: 'p-1', participantName: 'Mia Chen', startTime: '09:00:00', endTime: '15:00:00' })
    const groups = pickerGroups(target, [person('sam', 'Sam Wilson'), person('pat', 'Pat Done')], [pair, on('live', 'pat', { status: 'InProgress' })], [], none)
    expect([...groups.free, ...groups.move, ...groups.leave]).toEqual([])
  })

  it('keeps a person with leave AND an overlapping shift under Move, with the leave on the row', () => {
    const groups = pickerGroups(target, [person('jack', "Jack O'Sullivan")], [on('jack-tue', 'jack')], [{ staffId: 'jack', from: '2026-08-18', to: '2026-08-18', status: 'Approved' }], none)
    expect(groups.move.map(r => [r.key, r.leave])).toEqual([['jack:jack-tue', 'Approved']])
    expect(groups.leave).toEqual([])
  })

  it('gives each overlapping shift its own Move row, earliest first', () => {
    const groups = pickerGroups(target, [person('jack', "Jack O'Sullivan")], [on('late', 'jack', { startTime: '12:00:00', endTime: '14:00:00' }), on('early', 'jack', { startTime: '08:00:00', endTime: '10:00:00' })], [], none)
    expect(keys(groups.move)).toEqual(['jack:early', 'jack:late'])
  })

  it('puts a person on leave that starts the day an overnight shift ends under Leave', () => {
    const overnight = makeUnfilledShift({ id: 'night', serviceDate: '2026-08-16', startTime: '22:00:00', endTime: '07:00:00', endsNextDay: true })
    const groups = pickerGroups(overnight, [person('kim', 'Kim Lee')], [], [{ staffId: 'kim', from: '2026-08-17', to: '2026-08-17', status: 'Approved' }], none)
    expect(groups.leave.map(r => [r.key, r.leave])).toEqual([['kim', 'Approved']])
  })

  it('leaves out the other worker of a staggered 2:1 (same participant and day, overlapping times)', () => {
    const staggered = on('stag', 'sam', { participantId: 'p-1', participantName: 'Mia Chen', startTime: '10:00:00', endTime: '14:00:00' })
    const groups = pickerGroups(target, [person('sam', 'Sam Wilson')], [staggered], [], none)
    expect([...groups.free, ...groups.move, ...groups.leave]).toEqual([])
  })
})

// Review Focus 1: overnight shifts, across the night Sydney's clocks go forward (2am Sunday 4 October 2026). Also run under vitest-sydney.
describe('shiftsOverlap', () => {
  const dawn = makeUnfilledShift({ serviceDate: '2026-10-04', startTime: '05:00:00', endTime: '09:00:00' })
  it('sees a shift from the night before that runs into this one', () => {
    expect(shiftsOverlap(makeShift({ serviceDate: '2026-10-03', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true }), dawn)).toBe(true)
  })
  it('does not count a shift that ends as this one starts', () => {
    expect(shiftsOverlap(makeShift({ serviceDate: '2026-10-03', startTime: '22:00:00', endTime: '05:00:00', endsNextDay: true }), dawn)).toBe(false)
  })
})

describe('the picker words', () => {
  const liamMon = makeShift({ id: 'b-1', participantName: 'Liam Okafor', serviceDate: '2026-08-17', startTime: '08:00:00', endTime: '17:00:00', status: 'Published' })
  const jack = { id: 's-3', fullName: "Jack O'Sullivan", isActive: true, hasExpiredQualifications: true } as StaffListDto

  it('names the plus by the day in full, the time with "to", and the participant', () => {
    expect(pickName(makeUnfilledShift({ participantName: 'Mia Chen', serviceDate: '2026-08-18', startTime: '09:00:00', endTime: '15:00:00' }))).toBe('Assign someone to Tuesday 9am to 3pm for Mia')
  })

  it("says where a Move row's person comes from", () => {
    expect(moveLine(liamMon)).toBe('Move from Mon 8am–5pm · Liam')
  })

  it("names an option in the strip puck's style, adding only what applies", () => {
    expect(pickOptionName({ key: 's-3:b-1', person: jack, hours: 15, leave: 'Pending', source: liamMon }))
      .toBe("Jack O'Sullivan, 15 of 38 hours this week, qualifications expired, leave pending, move from Monday 8am to 5pm with Liam, published: tells Jack")
    expect(pickOptionName({ key: 's-6', person: { ...jack, id: 's-6', fullName: 'Kim Lee', hasExpiredQualifications: false }, hours: 7.5, leave: null }))
      .toBe('Kim Lee, 7.5 of 38 hours this week')
    expect(hoursText(12)).toBe('12')
  })

  it("reads the Staff view's leave from its rows' leave bars, leave requests only", () => {
    const bar = (kind: string, startDate: string) => ({ kind, startDate, endDate: startDate, availabilityType: null, notes: null, startTime: null, endTime: null }) as never
    const rows = [makeStaffRow({ staffId: 's-5', leave: [bar('ApprovedLeave', '2026-08-17'), bar('PendingLeave', '2026-08-18'), bar('RecurringRule', '2026-08-19'), bar('Legacy', '2026-08-20')] })]
    expect(leaveFromStaffRows(rows)).toEqual([
      { staffId: 's-5', from: '2026-08-17', to: '2026-08-17', status: 'Approved' },
      { staffId: 's-5', from: '2026-08-18', to: '2026-08-18', status: 'Pending' },
    ])
  })
})
