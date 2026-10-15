import { describe, expect, it } from 'vitest'
import { NO_LENGTH_CODE, NO_LENGTH_MESSAGE, hasNoLength, isNoLengthRefusal, oneHourAfter } from './shiftTimes'

// The phase 3 review (N5) and the design review (D6): a new shift must open with a length, and a pair of times with no length is a rule of the End time field, said where the person is looking.

describe('hasNoLength', () => {
  it('is true when the end is at or before the start and the shift does not end the next day', () => {
    expect(hasNoLength('09:00', '09:00', false)).toBe(true)
    expect(hasNoLength('22:00', '06:00', false)).toBe(true)
  })

  it('is false when the end is after the start', () => {
    expect(hasNoLength('09:00', '09:01', false)).toBe(false)
    expect(hasNoLength('09:00', '17:00', false)).toBe(false)
  })

  it('is false for an overnight shift: ticking "Ends the next day" gives it a length', () => {
    expect(hasNoLength('22:00', '06:00', true)).toBe(false)
    expect(hasNoLength('09:00', '09:00', true)).toBe(false)
  })

  it('is false while a time is still empty: that is a missing answer, not a shift with no length', () => {
    expect(hasNoLength('', '10:00', false)).toBe(false)
    expect(hasNoLength('09:00', '', false)).toBe(false)
    expect(hasNoLength('', '', false)).toBe(false)
  })
})

describe('oneHourAfter', () => {
  it('is an hour later, so a new shift opens with a length (09:00 gives 10:00)', () => {
    expect(oneHourAfter('09:00')).toBe('10:00')
    expect(oneHourAfter('09:30')).toBe('10:30')
    expect(oneHourAfter('00:15')).toBe('01:15')
  })

  it('stops at the end of the day rather than wrapping to a time before the start', () => {
    expect(oneHourAfter('23:00')).toBe('23:59')
    expect(oneHourAfter('23:45')).toBe('23:59')
  })

  it('leaves what it cannot read as it is', () => {
    expect(oneHourAfter('')).toBe('')
  })
})

describe('NO_LENGTH_MESSAGE', () => {
  it('is the server’s own sentence, kept as the fallback for telling a 400 for it from any other refusal', () => {
    expect(NO_LENGTH_MESSAGE).toBe("The shift must end after it starts. Tick 'Ends the next day' for an overnight shift.")
  })
})

// The server's 400 for no length carries a code (RosteringController, ShiftNoLengthCode); the panels recognise it by that, so the wording is free to change.
describe('isNoLengthRefusal', () => {
  const failed = (data: { errors?: string[]; code?: string }, status = 400) => ({ response: { status, data: { success: false, ...data } } })

  it('is the server’s code', () => {
    expect(NO_LENGTH_CODE).toBe('shift-no-length')
    expect(isNoLengthRefusal(failed({ code: 'shift-no-length', errors: ['Pick an end that is after the start.'] }))).toBe(true)   // whatever the words are
  })

  it('falls back to the sentence when the answer carries no code (an older server, a mock)', () => {
    expect(isNoLengthRefusal(failed({ errors: [NO_LENGTH_MESSAGE] }))).toBe(true)
  })

  it('is not any other refusal, nor a failure with no answer', () => {
    expect(isNoLengthRefusal(failed({ code: 'draft-version-conflict', errors: ['A newer revision exists.'] }, 409))).toBe(false)
    expect(isNoLengthRefusal(failed({ errors: ['Participant is not ready for booking or rostering.'] }))).toBe(false)
    expect(isNoLengthRefusal(new Error('Network Error'))).toBe(false)
    expect(isNoLengthRefusal(null)).toBe(false)
  })
})
