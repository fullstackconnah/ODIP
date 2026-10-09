import { describe, it, expect } from 'vitest'
import { bookingBudgetNote, bookingBudgetNotice, mergeBookingBudgetNotices } from './bookingBudget'
import type { BudgetWarningDto } from '@/api/types'
import { SERVER_PERIOD } from '@/test/fixtures/budgets'

// The phase 3 review, C5: ticking six participants of a trip and confirming them shows the warnings of the four that are over, and a line that does not say whose pool it is cannot be acted on.

const warning = (over: Partial<BudgetWarningDto> = {}): BudgetWarningDto => ({
  poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 1000, used: 0, forecast: 1440, added: 1440, overBy: 440, count: 1,
  message: `This booking takes Core (flexible) to $1,440.00 of $1,000.00 for ${SERVER_PERIOD}, $440.00 over.`, ...over,
})

describe('bookingBudgetNotice', () => {
  it('is nothing when the response carries no warning', () => {
    expect(bookingBudgetNotice({ data: { participantName: 'Sophie Brown', budgetWarnings: [] } })).toBeNull()
    expect(bookingBudgetNotice({ data: { participantName: 'Sophie Brown' } })).toBeNull()
    expect(bookingBudgetNotice(null)).toBeNull()
  })

  it('puts the booking’s participant on a warning that names nobody, so a line is never anonymous once it is merged with others', () => {
    const notice = bookingBudgetNotice({ data: { participantName: 'Sophie Brown', budgetWarnings: [warning()] } })

    expect(notice?.warnings[0].participantName).toBe('Sophie Brown')
    expect(notice?.who).toBe('Sophie Brown')
  })

  it('keeps the name the server sent on the warning itself', () => {
    const notice = bookingBudgetNotice({ data: { participantName: 'Sophie Brown', budgetWarnings: [warning({ participantName: 'Noah Reid' })] } })

    expect(notice?.warnings[0].participantName).toBe('Noah Reid')
  })
})

describe('mergeBookingBudgetNotices', () => {
  it('keeps every line with the participant it is about, and says how many bookings there were', () => {
    const merged = mergeBookingBudgetNotices([
      bookingBudgetNotice({ data: { participantName: 'Sophie Brown', budgetWarnings: [warning()] } }),
      null,
      bookingBudgetNotice({ data: { participantName: 'Noah Reid', budgetWarnings: [warning({ poolName: 'Daily Activities' })] } }),
    ])

    expect(merged?.who).toBeNull()
    expect(merged?.bookings).toBe(2)
    expect(merged?.warnings.map(w => [w.participantName, w.poolName])).toEqual([['Sophie Brown', 'Core (flexible)'], ['Noah Reid', 'Daily Activities']])
  })

  it('is nothing when none of the bookings came back with a warning', () => {
    expect(mergeBookingBudgetNotices([null, null])).toBeNull()
  })

  it('keeps the one participant when only one booking has a warning', () => {
    const merged = mergeBookingBudgetNotices([null, bookingBudgetNotice({ data: { participantName: 'Sophie Brown', budgetWarnings: [warning()] } })])

    expect(merged?.who).toBe('Sophie Brown')
    expect(bookingBudgetNote(merged!)).toBe('This is a warning only. Sophie Brown’s booking is confirmed.')
  })
})
