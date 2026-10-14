import { afterEach, describe, it, expect } from 'vitest'
import { makeShift, makeUnfilledShift } from '../test-fixtures'
import {
  assignedSentence, carriedLine, dropOutcome, movedSentence, publishedSentence, publishWeekMessage, replacePromptLines, rosterAnnouncements, rosterCollision,
  staffWeekHours, swappedSentence, type DragCarry, type DropTarget,
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
    ])
    expect(replacePromptLines(sam, { ...tue, status: 'Draft' }, false)).toEqual(['Mia Chen, Tue 18 Aug, 9am–3pm.', 'Replace: Sam takes it and Alex comes off.'])
    expect(publishWeekMessage([makeShift({ id: '1', staffId: 'a' }), makeShift({ id: '2', staffId: 'a' }), makeShift({ id: '3', staffId: 'b' }), makeUnfilledShift({ id: '4' })]))
      .toBe('4 draft shifts go out to staff. The 2 people on them are notified. 1 still needs staff and is published as needing staff.')
  })
})
