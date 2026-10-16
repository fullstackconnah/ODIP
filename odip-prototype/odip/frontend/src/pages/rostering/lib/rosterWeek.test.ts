import { describe, it, expect } from 'vitest'
import type { BudgetWarningDto, StartWeekResultDto } from '@/api/types'
import { makeShift } from '../test-fixtures'
import {
  alreadyInWeekLine, bannerBlockedLine, bannerTitle, leaveMessage, regularConfirm, regularDone, startBudgetWarnings, startResultBody, startResultTitle,
} from './rosterWeek'

const result = (o: Partial<StartWeekResultDto> = {}): StartWeekResultDto => ({ weekStart: '2026-10-13', created: 0, assignedToRegulars: 0, regularAway: 0, skipped: [], ...o })
const person = (fullName: string, i = 0) => ({ participantId: `p-${i}`, fullName })

describe('the Start, banner and guard copy (2026-10-16)', () => {
  it('alreadyInWeekLine', () => {
    expect(alreadyInWeekLine(2)).toBe('2 shifts already in this week stay as they are.')
    expect(alreadyInWeekLine(1)).toBe('1 shift already in this week stays as it is.')
  })

  it('bannerTitle', () => {
    expect(bannerTitle(1)).toBe('1 shift not visible to staff yet')
    expect(bannerTitle(128)).toBe('128 shifts not visible to staff yet')
  })

  it('bannerBlockedLine: nothing when none is blocked; some, all, singular and plural', () => {
    expect(bannerBlockedLine(12, 0)).toBeNull()
    expect(bannerBlockedLine(12, 2)).toBe("2 of them can't be published until the worker changes: a rule that can't be overridden blocks them.")
    expect(bannerBlockedLine(12, 1)).toBe("1 of them can't be published until the worker changes: a rule that can't be overridden blocks it.")
    expect(bannerBlockedLine(3, 3)).toBe("They can't be published until the worker changes: a rule that can't be overridden blocks them.")
    expect(bannerBlockedLine(1, 1)).toBe("It can't be published until the worker changes: a rule that can't be overridden blocks it.")
  })

  it('leaveMessage', () => {
    expect(leaveMessage(4, '17–23 Aug')).toBe("4 shifts in 17–23 Aug aren't visible to staff yet. They stay saved as drafts until you publish the week.")
    expect(leaveMessage(1, '17–23 Aug')).toBe("1 shift in 17–23 Aug isn't visible to staff yet. It stays saved as a draft until you publish the week.")
  })

  it('startResultTitle', () => {
    expect(startResultTitle('13–19 Oct', result({ created: 5 }))).toBe('Started 13–19 Oct: 5 shifts added')
    expect(startResultTitle('13–19 Oct', result({ created: 1 }))).toBe('Started 13–19 Oct: 1 shift added')
    expect(startResultTitle('13–19 Oct', result())).toBe('Started 13–19 Oct')
  })

  it('startResultBody: only the sentences that are not zero', () => {
    expect(startResultBody(result({ created: 5, assignedToRegulars: 3, regularAway: 1, skipped: [person('Noah Test')] }))).toBe(
      '3 have their regular on them. 1 is open because the regular is away. 1 needs staff: no regular is set. Skipped 1 participant not ready for rostering: Noah Test.')
    expect(startResultBody(result({ created: 1, assignedToRegulars: 1 }))).toBe('1 has its regular on it.')
    expect(startResultBody(result({ created: 2, regularAway: 2 }))).toBe('2 are open because the regular is away.')
    expect(startResultBody(result({ created: 2 }))).toBe('2 need staff: no regular is set.')
    expect(startResultBody(result({ skipped: [person('A', 1), person('B', 2), person('C', 3)] }))).toBe('Skipped 3 participants not ready for rostering: A, B and C.')
    expect(startResultBody(result({ skipped: [person('', 1), person('', 2)] }))).toBe('Skipped 2 participants not ready for rostering.')
    expect(startResultBody(result())).toBe('No approved agreement has a shift in this week.')
    expect(startResultBody(result({ skipped: [person('Noah Test')] }))).toBe('Skipped 1 participant not ready for rostering: Noah Test.')
  })

  it('startBudgetWarnings: one flat list, each line naming its participant', () => {
    const w = { poolName: 'Core', message: 'over' } as BudgetWarningDto
    const lines = startBudgetWarnings(result({ budgetWarnings: [{ ...person('Mia Chen', 1), warnings: [w] }, { ...person('Noah Test', 2), warnings: [w] }] }))
    expect(lines.map(l => l.participantName)).toEqual(['Mia Chen', 'Noah Test'])
    expect(startBudgetWarnings(result())).toEqual([])
    expect(startBudgetWarnings(result({ budgetWarnings: [person('Mia Chen')] }))).toEqual([])
  })

  describe('the regular', () => {
    const shift = makeShift({ participantName: 'Mia Chen', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '15:00:00', staffId: 'kim', staffName: 'Kim Lee', shiftPatternId: 'pat-1' })
    const make = "Kim goes on Mia Chen's Monday 9am–3pm shift in every week you start from now on, unless they're away. Weeks already started don't change, this one included."

    it('Make: the slot, every week started from now, and who it replaces', () => {
      expect(regularConfirm(shift)).toEqual({ title: 'Make Kim the regular?', lines: [make], confirmLabel: 'Make Kim the regular' })
      expect(regularConfirm(shift, 'Sam Wilson').lines).toEqual([make, 'Sam stops being the regular.'])
    })

    it('Stop: its own words', () => {
      expect(regularConfirm({ ...shift, isRegular: true })).toEqual({
        title: 'Stop Kim being the regular?',
        lines: ["From the next week you start, Mia Chen's Monday 9am–3pm shift is made open, with nobody on it. Weeks already started keep Kim."],
        confirmLabel: 'Stop being the regular',
      })
    })

    it('regularDone', () => {
      expect(regularDone(shift)).toBe("Kim is now the regular for Mia Chen's Monday shift.")
      expect(regularDone({ ...shift, isRegular: true })).toBe("Mia Chen's Monday shift has no regular now.")
    })
  })
})
