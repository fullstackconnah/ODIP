import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlanBlock, PlanFailureReason, PlanIssue, PlanQuote } from '@/api/types'
import { emptyBlock } from './planBlocks'

// The backend does not always sit beside the frontend (an image build has only the frontend). A test that reads the C# is skipped THEN, where the run says so, and is never a pass that checked nothing.
const BACKEND = resolve(__dirname, '../../../backend')
const PRICING = resolve(BACKEND, 'Odip.Domain/Billing/Pricing')
const hasBackend = existsSync(PRICING)
import {
  CATEGORY_SHORT, REASON_COPY, addDays, asSentence,  categoryLabel, conflictVersionOf, describeQuoteError, describeSaveError, formatServiceDate, friendlyMessage, 
   groupIssues, isPricingDate, isRefusal, issueWhere,  periodProblem,  pricedNothing,   referenceWeek,  refusals,  shiftsNotPriced, shiftsNotPricedAtLeast, totalsCaption,
} from './planQuote'

const axiosError = (status: number, data: unknown = {}) => ({ response: { status, data } })

describe('dates', () => {
  it('writes a service date from fixed words and day arithmetic', () => {
    expect(formatServiceDate('2026-10-05')).toBe('Mon 5 Oct 2026')
    expect(formatServiceDate('2027-02-28')).toBe('Sun 28 Feb 2027')
    expect(formatServiceDate('')).toBe('')
    expect(formatServiceDate(undefined)).toBe('')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-10-05', -5)).toBe('2026-09-30')
  })

  // Review F1: a date box lets a person type a five digit year; the string comparison from <= to passed it and the server answered a 400 the screen could not read.
  it('accepts only a real day in the years the engine prices, never a five digit year or a day that is not on the calendar', () => {
    for (const good of ['2026-10-05', '2000-01-01', '2100-12-31', '2028-02-29']) expect(isPricingDate(good), good).toBe(true)
    for (const bad of ['', '20261-10-05', '1999-12-31', '2101-01-01', '2026-02-30', '2027-02-29', '2026-13-01', '26-10-05', '2026-10-05T00:00:00', 'abc']) expect(isPricingDate(bad), bad).toBe(false)
    expect(isPricingDate(undefined)).toBe(false)
    expect(isPricingDate(null)).toBe(false)
  })
})

// Code review N1: the dates the plan is priced over. Review compared the two as text, so a year of five digits was a period; nothing was asked, and nothing said so.
describe('the agreement period', () => {
  it('has no problem when both dates are days the engine prices and the end is not before the start', () => {
    expect(periodProblem('2026-10-01', '2027-06-30')).toBeNull()
    expect(periodProblem('2026-10-01', '2026-10-01')).toBeNull()      // one day is a period
  })

  it('is blank when a date is not typed', () => {
    expect(periodProblem('', '2027-06-30')).toBe('blank')
    expect(periodProblem('2026-10-01', '')).toBe('blank')
    expect(periodProblem('', '')).toBe('blank')
  })

  it('is invalid for a date that is no day, or a year outside the engine range, and reads a five digit year as invalid and not as later than everything', () => {
    expect(periodProblem('20267-01-01', '2027-06-30')).toBe('invalid')       // as text it is "later" than 2027-06-30, and as a period it would have been accepted
    expect(periodProblem('2026-10-01', '2027-02-30')).toBe('invalid')
    expect(periodProblem('1999-12-31', '2027-06-30')).toBe('invalid')
    expect(periodProblem('2026-10-01', '2101-01-01')).toBe('invalid')
    expect(periodProblem('2026-10-01T00:00:00', '2027-06-30')).toBe('invalid')
  })

  it('is reversed when the end is before the start, by the days', () => {
    expect(periodProblem('2027-06-30', '2026-10-01')).toBe('reversed')
    expect(periodProblem('2026-10-02', '2026-10-01')).toBe('reversed')
  })
})

describe('an ordinary week', () => {
  it('is the first run of seven days from the start of the agreement that no block meets a public holiday in', () => {
    // 1 Oct 2026 is a Thursday: the first seven days hold Monday 5 October (Labour Day in NSW), so the next seven stand in.
    expect(referenceWeek('2026-10-01', '2026-12-31', ['2026-10-05'])).toEqual({ from: '2026-10-08', to: '2026-10-14' })
    expect(referenceWeek('2026-10-01', '2026-12-31', [])).toEqual({ from: '2026-10-01', to: '2026-10-07' })
    expect(referenceWeek('2026-10-01', '2026-12-31', ['2026-10-14', '2026-10-05'])).toEqual({ from: '2026-10-15', to: '2026-10-21' })
  })

  it('falls back to the first seven days when every week meets a holiday, and has none for an agreement shorter than a week', () => {
    expect(referenceWeek('2026-10-01', '2026-10-14', ['2026-10-05', '2026-10-12'])).toEqual({ from: '2026-10-01', to: '2026-10-07' })
    expect(referenceWeek('2026-10-01', '2026-10-06', [])).toBeNull()
    expect(referenceWeek('2026-10-01', '2026-10-07', [])).toEqual({ from: '2026-10-01', to: '2026-10-07' })
    expect(referenceWeek('', '2026-10-07', [])).toBeNull()
  })
})

describe('what each refusal means', () => {
  it('has words and a way forward for every reason the engine can give', () => {
    const source = resolve(__dirname, '../../../backend/Odip.Domain/Billing/Pricing/PlanQuote.cs')
    const named = ['InvalidInput', 'RegistrationGroupNotHeld', 'StaLegacyNotSupported', 'NoItem', 'CatalogueNotFound', 'CatalogueAmbiguous', 'ZoneNotEligible', 'CatalogueNotPriced', 'UnexpectedUnit',
      'SleepoverNotAvailable', 'SleepoverNotQualifying', 'TransportNotAvailable', 'AccommodationNotAvailable', 'TravelNotClaimable', 'SleepoverClockChange', 'NamedDateNotInCalendar', 'BlocksOverlap', 'SupportInSkippedHour']
    // Where the backend sits beside the frontend, the C# enum is the list: a new reason fails here until somebody has written its words.
    const reasons = existsSync(source)
      ? [...readFileSync(source, 'utf-8').match(/enum PlanFailureReason\s*\{([\s\S]*?)\n\}/)![1].matchAll(/^\s+([A-Z][A-Za-z]+)\s*=\s*\d+/gm)].map(match => match[1])
      : named
    expect(reasons.length).toBe(named.length)
    for (const reason of reasons) {
      const copy = REASON_COPY[reason as PlanFailureReason]
      expect(copy, reason).toBeDefined()
      expect(copy.title.length, reason).toBeGreaterThan(5)
      expect(copy.advice.length, reason).toBeGreaterThan(20)
    }
  })

  it('stops a save only for the three reasons that mean nothing was priced from the block', () => {
    expect(isRefusal('InvalidInput')).toBe(true)
    expect(isRefusal('RegistrationGroupNotHeld')).toBe(true)
    expect(isRefusal('StaLegacyNotSupported')).toBe(true)
    expect(isRefusal('NoItem')).toBe(false)
    expect(isRefusal('CatalogueNotFound')).toBe(false)
    expect(isRefusal('BlocksOverlap')).toBe(false)
    expect(refusals([
      { blockId: 'b1', reason: 'NoItem', message: 'm', count: 1 }, { blockId: 'b2', reason: 'InvalidInput', message: 'bad', count: 1 },
    ]).map(issue => issue.reason)).toEqual(['InvalidInput'])
  })

  // Review F17: the three reasons were asserted by hand. The service that refuses a save names them in SaveRefusals, so the screen's list is read from there and cannot drift from it.
  it.skipIf(!hasBackend)('agrees with the backend on which reasons stop a save: the screen holds Save back for exactly the reasons SaveRefusals refuses', () => {
    const service = readFileSync(resolve(BACKEND, 'Odip.Infrastructure/Services/ServiceAgreementDraftService.cs'), 'utf-8')
    const declared = /SaveRefusals\s*=\s*\{([^}]*)\}/.exec(service)?.[1]
    expect(declared, 'SaveRefusals is no longer declared as an array in ServiceAgreementDraftService').toBeDefined()
    const server = [...(declared as string).matchAll(/PlanFailureReason\.([A-Za-z]+)/g)].map(match => match[1]).sort()
    const enumBody = readFileSync(resolve(PRICING, 'PlanQuote.cs'), 'utf-8').match(/enum PlanFailureReason\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const everyReason = [...enumBody.matchAll(/^\s+([A-Z][A-Za-z]+)\s*=\s*\d+/gm)].map(match => match[1])

    expect(server).toHaveLength(3)
    expect(everyReason.filter(reason => isRefusal(reason as PlanFailureReason)).sort()).toEqual(server)
  })

  it('calls a block by its place in the plan, not by the id the screen gave it', () => {
    const blocks: PlanBlock[] = [emptyBlock('b7', 'NSW'), emptyBlock('b9', 'NSW')]
    expect(friendlyMessage("Block 'b9': choose at least one day. Block 'b7' overlaps Block 'b9'.", blocks)).toBe('Block 2: choose at least one day. Block 1 overlaps Block 2.')
    expect(friendlyMessage("Block 'zz': a thing", blocks)).toBe("Block 'zz': a thing")
  })

  it('does the same for the pair in an overlap, in the engine\'s own words', () => {
    const blocks: PlanBlock[] = [emptyBlock('b7', 'NSW'), emptyBlock('b9', 'NSW'), emptyBlock('b12', 'NSW')]
    expect(friendlyMessage("Blocks 'b9' and 'b12' are on at the same time on the same day, so the same participant's time would be priced twice.", blocks))
      .toBe("Blocks 2 and 3 are on at the same time on the same day, so the same participant's time would be priced twice.")
    expect(friendlyMessage("Blocks 'b7' and 'gone' are on at the same time.", blocks)).toBe("Blocks 'b7' and 'gone' are on at the same time.")
  })

  // The engine writes its dates as ISO beside the screen's en-AU ones, in one sentence (design review 11).
  it('writes the engine\'s dates the way the screen does, and leaves what is not a date alone', () => {
    expect(friendlyMessage('The overrides run to 2027-04-25. Prices from 2026-07-01 hold.', [])).toBe('The overrides run to Sun 25 Apr 2027. Prices from Wed 1 Jul 2026 hold.')
    expect(friendlyMessage('No such day: 2026-02-30. Version 2026-27, item 04_104_0125_6_1.', [])).toBe('No such day: 2026-02-30. Version 2026-27, item 04_104_0125_6_1.')
  })

  it('does not tell a block that starts at five in the morning to finish by midnight: the advice says what the catalogue lacks and the way out, without a time that is not the block\'s', () => {
    const advice = REASON_COPY.NoItem.advice
    expect(advice).not.toMatch(/midnight/i)
    expect(advice).toContain('left out of every total')
    expect(advice).toContain('between 00:00 and 06:00 on a weekday')
  })
})

// Review (design 1): a total that leaves work out has to say so beside the figure, in the unit a coordinator thinks in (shifts, not lines of items times shifts).
describe('what is left out of a plan\'s totals', () => {
  const issue = (blockId: string, reason: PlanFailureReason, count: number): PlanIssue => ({ blockId, reason, message: `${reason} ${blockId}`, count })
  const answer = (changes: Partial<PlanQuote> = {}): Pick<PlanQuote, 'issues' | 'holidayOccurrences' | 'totals'> => ({
    issues: [], holidayOccurrences: [], totals: { amount: 0, supportHours: 0, lineCount: 0, unpricedLines: 0, reviewLines: 0, provisionalLines: 0, holidayOccurrences: 0, holidayUplift: 0, byCategory: [], byBlock: [] }, ...changes,
  })
  const holiday = (decision: 'Review' | 'Charge' | 'Skip', skipped = false) => ({ blockId: 'b1', date: '2026-10-05', holidayName: 'Labour Day', decision, skipped })

  it('counts the shifts that have a part nobody priced, once however many items of the block are missing', () => {
    // One block with two unpriced items on the same 24 shifts is 24 shifts, not 48; two blocks add up.
    const issues = [issue('b1', 'NoItem', 24), issue('b1', 'CatalogueNotFound', 24), issue('b2', 'CatalogueNotFound', 13)]

    expect(shiftsNotPriced(issues)).toBe(24 + 13)
    expect(shiftsNotPriced([])).toBe(0)
  })

  // Code review N10: a block with two issues counts its largest, and the others may touch shifts that one did not: a lower bound, which "186 shifts" printed as the count.
  it('says a count is at least that when a block has more than one issue, and exact when every block has one', () => {
    expect(shiftsNotPricedAtLeast([issue('b1', 'NoItem', 24)])).toBe(false)
    expect(shiftsNotPricedAtLeast([issue('b1', 'NoItem', 24), issue('b2', 'CatalogueNotFound', 13)])).toBe(false)      // two blocks, one issue each: both exact
    expect(shiftsNotPricedAtLeast([issue('b1', 'NoItem', 24), issue('b1', 'CatalogueNotFound', 24)])).toBe(true)
    expect(shiftsNotPricedAtLeast([issue('b1', 'NoItem', 24), { ...issue('b1', 'NoItem', 7), message: 'another message' }])).toBe(true)
    expect(shiftsNotPricedAtLeast([issue('b1', 'RegistrationGroupNotHeld', 1), issue('b1', 'NoItem', 2)])).toBe(false)     // a refusal is not a part left out
    expect(shiftsNotPricedAtLeast([])).toBe(false)
  })

  it('prints "at least" in the caption when the count is a lower bound, and the plain count when it is exact', () => {
    expect(totalsCaption(answer({ issues: [issue('b1', 'NoItem', 186), issue('b1', 'CatalogueNotFound', 186)] })).text).toBe('at least 186 shifts with a part not priced')
    expect(totalsCaption(answer({ issues: [issue('b1', 'NoItem', 1), issue('b1', 'CatalogueNotFound', 1)] })).text).toBe('at least 1 shift with a part not priced')
    expect(totalsCaption(answer({ issues: [issue('b1', 'NoItem', 186)] })).text).toBe('186 shifts with a part not priced')
  })

  it('writes the caption with a capital where it starts a line', () => {
    expect(asSentence('at least 10 shifts with a part not priced')).toBe('At least 10 shifts with a part not priced')
    expect(asSentence('some lines use provisional rates')).toBe('Some lines use provisional rates')
    expect(asSentence('186 shifts with a part not priced')).toBe('186 shifts with a part not priced')
    expect(asSentence('')).toBe('')
  })

  it('does not count a refusal, a flag that is only for review, or an overlap as a part that was not priced', () => {
    const issues = [issue('b1', 'RegistrationGroupNotHeld', 1), issue('b1', 'SleepoverNotQualifying', 5), issue('b1', 'SleepoverClockChange', 1), issue('b1', 'NamedDateNotInCalendar', 2), issue('b1', 'BlocksOverlap', 3)]

    expect(shiftsNotPriced(issues)).toBe(0)
  })

  it('says it all in one line in shifts with their nouns, and what it says is true of the plan', () => {
    const caption = totalsCaption(answer({
      issues: [issue('b1', 'NoItem', 186), issue('b2', 'RegistrationGroupNotHeld', 1)],
      holidayOccurrences: [holiday('Review'), holiday('Review'), holiday('Charge'), holiday('Review', true)],
      totals: { ...answer().totals, provisionalLines: 468, reviewLines: 219, unpricedLines: 186 },
    }))

    expect(caption.text).toBe('186 shifts with a part not priced · 1 block cannot be priced · 2 public holiday shifts to decide · some lines use provisional rates')
    expect(caption.notFullyPriced).toBe(true)
  })

  it('uses the singular, and says nothing about what is not so', () => {
    expect(totalsCaption(answer({ issues: [issue('b1', 'NoItem', 1)], holidayOccurrences: [holiday('Review')] })).text).toBe('1 shift with a part not priced · 1 public holiday shift to decide')
    expect(totalsCaption(answer({ totals: { ...answer().totals, provisionalLines: 2 } }))).toEqual({ text: 'some lines use provisional rates', notFullyPriced: false })
    expect(totalsCaption(answer())).toEqual({ text: '', notFullyPriced: false })
  })

  it('is not fully priced for a refused block as well as for a part that was left out, and for a holiday to decide it is still fully priced', () => {
    expect(totalsCaption(answer({ issues: [issue('b1', 'RegistrationGroupNotHeld', 1)] })).notFullyPriced).toBe(true)
    expect(totalsCaption(answer({ issues: [issue('b1', 'CatalogueNotFound', 3)] })).notFullyPriced).toBe(true)
    expect(totalsCaption(answer({ holidayOccurrences: [holiday('Review')] })).notFullyPriced).toBe(false)
  })
})

// The engine keeps ONE issue for each block, reason and message, with the shifts it met it on (the message has no date: "Either is free of dates, so one gap in fifty weeks is one issue").
// The same shift can carry several items, one message each, so two issues of one reason in one block count the same shifts, and merging them takes the larger count, not the sum.
// Code review N6 and design D8: a plan that prices to nothing is shown with en dashes, not $0.00.
describe('a quote that priced nothing', () => {
  const totals = (changes: Partial<PlanQuote['totals']>): PlanQuote['totals'] => ({ amount: 0, supportHours: 0, lineCount: 0, unpricedLines: 0, reviewLines: 0, provisionalLines: 0, holidayOccurrences: 0, holidayUplift: 0, byCategory: [], byBlock: [], ...changes })

  it('is nothing priced when no line has a price: all of them are unpriced, or there are none', () => {
    expect(pricedNothing({ totals: totals({ lineCount: 6, unpricedLines: 6 }) })).toBe(true)
    expect(pricedNothing({ totals: totals({}) })).toBe(true)                     // every block refused: no line at all
  })

  it('is not nothing as soon as one line is priced, however many are not', () => {
    expect(pricedNothing({ totals: totals({ amount: 73.58, lineCount: 6, unpricedLines: 5 }) })).toBe(false)
    expect(pricedNothing({ totals: totals({ amount: 30610.28, lineCount: 208 }) })).toBe(false)
  })
})

describe('issues read as one thing, not one per item', () => {
  const gap = (blockId: string, item: string, count: number, firstDate?: string): PlanIssue => ({
    blockId, reason: 'CatalogueNotFound', message: `No catalogue row for ${item} is valid for part of the period. Import the catalogue for that period.`, count, ...(firstDate ? { firstDate } : {}),
  })

  it('merges the items of one block that the same shifts are missing into one issue, counting those shifts once', () => {
    // Two items missing on the same 26 shifts is 26 shifts, not 52. Where they touch different shifts the larger count is a lower bound, never an overstatement.
    const grouped = groupIssues([gap('b1', 'Community access, weekday daytime', 26, '2027-07-05'), gap('b1', 'Provider travel time', 26, '2027-07-05'), gap('b1', 'Transport', 10, '2027-07-12')])

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toEqual({ blockId: 'b1', reason: 'CatalogueNotFound', message: 'No catalogue row for Community access, weekday daytime is valid for part of the period. Import the catalogue for that period.', count: 26, firstDate: '2027-07-05' })
  })

  it('keeps the message and the first day of the earliest, wherever it comes in the list', () => {
    const grouped = groupIssues([gap('b1', 'Later item', 3, '2027-08-01'), gap('b1', 'Earlier item', 2, '2027-07-01')])

    expect(grouped.map(issue => [issue.message.includes('Earlier item'), issue.count, issue.firstDate])).toEqual([[true, 3, '2027-07-01']])
  })

  it('keeps one issue for each block, and the blocks in the order they came', () => {
    const grouped = groupIssues([gap('b2', 'A', 4, '2027-07-03'), gap('b1', 'A', 7, '2027-07-02'), gap('b2', 'B', 9, '2027-07-01'), gap('b1', 'B', 2, '2027-07-09')])

    expect(grouped.map(issue => [issue.blockId, issue.count, issue.firstDate])).toEqual([['b2', 9, '2027-07-01'], ['b1', 7, '2027-07-02']])
  })

  it('does not run two different problems together: a rule broken in two fields, or a block that overlaps two others', () => {
    const invalid = (message: string): PlanIssue => ({ blockId: 'b1', reason: 'InvalidInput', message, count: 1 })
    const overlap = (other: string, count: number): PlanIssue => ({ blockId: 'b1', reason: 'BlocksOverlap', message: `Block 'b1' and Block '${other}' are on at the same time.`, count, firstDate: '2026-10-12' })

    expect(groupIssues([invalid('Pick a day.'), invalid('The end is before the start.'), invalid('Pick a day.')]).map(issue => [issue.message, issue.count])).toEqual([['Pick a day.', 1], ['The end is before the start.', 1]])
    expect(groupIssues([overlap('b2', 4), overlap('b3', 6), overlap('b2', 4)]).map(issue => [issue.message, issue.count])).toEqual([["Block 'b1' and Block 'b2' are on at the same time.", 4], ["Block 'b1' and Block 'b3' are on at the same time.", 6]])
  })

  it('keeps an issue with no date as it is, and takes the date from whichever issue has one', () => {
    const undated: PlanIssue = { blockId: 'b1', reason: 'NamedDateNotInCalendar', message: 'a day in this block', count: 2 }

    expect(groupIssues([undated])).toEqual([undated])
    expect(groupIssues([undated, { ...undated, firstDate: '2026-12-26', count: 1 }])).toEqual([{ ...undated, count: 2, firstDate: '2026-12-26' }])
  })

  it('does not change what it is given', () => {
    const given = [gap('b1', 'A', 2, '2027-07-02'), gap('b1', 'B', 1, '2027-07-01')]
    const copy = JSON.parse(JSON.stringify(given))

    groupIssues(given)
    expect(given).toEqual(copy)
  })

  it('says where an issue was met in words: how many shifts and the first day, or only the day', () => {
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 24, firstDate: '2026-10-13' })).toBe('24 shifts, the first on Tue 13 Oct 2026')
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 1, firstDate: '2026-10-13' })).toBe('Tue 13 Oct 2026')
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 3 })).toBe('3 shifts')
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 1 })).toBe('')
  })
})

describe('the budget categories', () => {
  it('names the budget categories short enough for a bar and keeps the engine\'s name for one it does not know', () => {
    expect(Object.values(CATEGORY_SHORT).length).toBe(4)
    expect(categoryLabel({ paceCategory: 4, name: 'Assistance with Social, Economic and Community Participation' })).toBe('Community participation')
    expect(categoryLabel({ paceCategory: 99, name: 'A new category' })).toBe('A new category')
  })
})

describe('when a request fails', () => {
  it('tells a busy service, an answer too big to list, a refusal and a dropped connection apart', () => {
    expect(describeQuoteError(axiosError(429))).toMatchObject({ title: 'The pricing service is busy', retryable: true })
    const big = describeQuoteError(axiosError(400, { errors: ['The quote has 61,000 lines, more than the 60,000 one answer carries: ask for the totals only (includeLines: false), shorten the period, or price fewer blocks.'] }))
    expect(big).toMatchObject({ title: 'This plan has too many lines to list', retryable: false })
    expect(big.detail).toContain('Shorten the agreement period')
    expect(describeQuoteError(axiosError(400, { errors: ['The agreement period ends before it starts.'] }))).toEqual({ title: 'This plan cannot be priced yet', detail: 'The agreement period ends before it starts.', retryable: false })
    expect(describeQuoteError(axiosError(403)).title).toBe('You cannot price plans')
    expect(describeQuoteError(axiosError(413)).title).toBe('The plan is too large to send')
    expect(describeQuoteError(new Error('Network Error'))).toMatchObject({ title: 'The plan could not be priced', retryable: true })
  })

  it('shows every reason a save was refused, and a friendly line for the limits', () => {
    expect(describeSaveError(axiosError(400, { errors: ["Block 'b1': choose at least one day.", 'Block \'b2\': workers must be between 1 and 10.'] }))).toEqual({
      title: 'The draft was not saved', messages: ["Block 'b1': choose at least one day.", "Block 'b2': workers must be between 1 and 10."],
    })
    expect(describeSaveError(axiosError(429)).title).toBe('The server is busy')
    expect(describeSaveError(axiosError(403)).messages[0]).toContain('Admins and Coordinators')
    expect(describeSaveError(axiosError(413)).title).toBe('The plan is too large to save')
    expect(describeSaveError(axiosError(404, { errors: ['Participant not found.'] })).messages).toEqual(['Participant not found.'])
    expect(describeSaveError(axiosError(500)).messages[0]).toContain('nothing you entered is lost')
    expect(describeSaveError(axiosError(400)).messages).toEqual(['The server refused the draft.'])
  })

  // Review F1: ASP.NET's model-binding 400 is a ValidationProblemDetails whose `errors` is an OBJECT keyed by field, not a list. Spreading it threw inside render and lost the unsaved plan.
  const problemDetails = (errors: unknown) => axiosError(400, { type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title: 'One or more validation errors occurred.', status: 400, traceId: '00-abc-def-00', errors })
  const CLEARED_BOX = 'A box in the plan is empty or is not a number. Check the days, times and numbers on each step.'

  it('reads the framework\'s validation answer without throwing, in plain words, for a quote and for a save', () => {
    const error = problemDetails({
      'blocks[0].block.sleepoverActiveHours': ['The JSON value could not be converted to System.Decimal. Path: $.blocks[0].block.sleepoverActiveHours | LineNumber: 0 | BytePositionInLine: 480.'],
      PlanStartDate: ['The agreement period ends before it starts.'],
    })

    expect(() => describeQuoteError(error)).not.toThrow()
    expect(() => describeSaveError(error)).not.toThrow()
    expect(describeQuoteError(error)).toEqual({ title: 'This plan cannot be priced yet', detail: CLEARED_BOX, retryable: false })
    expect(describeSaveError(error)).toEqual({ title: 'The draft was not saved', messages: [CLEARED_BOX, 'The agreement period ends before it starts.'] })
  })

  it('finds the newer version in a 409 that says somebody else saved first, and nothing in any other failure', () => {
    const conflict = (data: unknown, status = 409) => axiosError(status, data)
    expect(conflictVersionOf(conflict({ success: false, code: 'draft-version-conflict', data: { currentVersion: 5 }, errors: ['Version 5 …'] }))).toBe(5)
    expect(conflictVersionOf(conflict({ success: false, code: 'draft-version-conflict', data: { currentVersion: 0 } }))).toBe(0)
    expect(conflictVersionOf(conflict({ success: false, errors: ['Something else.'] }))).toBeNull()                                     // another 409
    expect(conflictVersionOf(conflict({ success: false, code: 'draft-version-conflict', data: { currentVersion: 'five' } }))).toBeNull()
    expect(conflictVersionOf(conflict({ success: false, code: 'draft-version-conflict', data: { currentVersion: 2.5 } }))).toBeNull()
    expect(conflictVersionOf(conflict({ success: false, code: 'draft-version-conflict' }))).toBeNull()
    expect(conflictVersionOf(conflict({ code: 'draft-version-conflict', data: { currentVersion: 5 } }, 400))).toBeNull()
    expect(conflictVersionOf(new Error('Network Error'))).toBeNull()
    expect(conflictVersionOf(undefined)).toBeNull()
  })

  it('reads every other shape a failed call can have: a field with one message, no errors at all, null, a string body, nothing', () => {
    expect(describeSaveError(problemDetails({ Representative: 'The field Representative must be a string with a maximum length of 500.' })).messages).toEqual(['The field Representative must be a string with a maximum length of 500.'])
    for (const errors of [null, undefined, 'a string', 42, {}, [], { a: [] }]) {
      expect(() => describeQuoteError(problemDetails(errors))).not.toThrow()
      expect(describeSaveError(problemDetails(errors)).messages.length).toBeGreaterThan(0)
    }
    expect(describeQuoteError(axiosError(400, '<html>Bad gateway</html>')).title).toBe('This plan cannot be priced yet')
    expect(describeSaveError({ response: { status: 400 } }).messages).toEqual(['The server refused the draft.'])
    expect(describeSaveError(undefined).title).toBe('The draft was not saved')
  })
})
