import { describe, expect, it } from 'vitest'
import { NO_LENGTH_MESSAGE, hasNoLength, oneHourAfter } from './shiftTimes'

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
  it('is the server’s own sentence, so a 400 for it can be told from any other refusal', () => {
    expect(NO_LENGTH_MESSAGE).toBe("The shift must end after it starts. Tick 'Ends the next day' for an overnight shift.")
  })
})
