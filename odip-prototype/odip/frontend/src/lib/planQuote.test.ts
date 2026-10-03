import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FundingSourceDto, PlannedLine, PlanBlock, PlanFailureReason, PlanIssue } from '@/api/types'
import { emptyBlock } from './planBlocks'
import {
  CATEGORY_SHORT, REASON_COPY, addDays, agreementWeeks, bandLabel, categoryLabel, compareBudget, describeQuoteError, describeSaveError, flagSummary, formatServiceDate, friendlyMessage, groupLines,
  groupByReason, groupIssues, isPricingDate, isRefusal, issueWhere, parseFlags, planBudgetFor, quantityLabel, questionShort, referenceWeek, refusals, ruleWords,
} from './planQuote'

const line = (changes: Partial<PlannedLine>): PlannedLine => ({
  blockId: 'b1', kind: 'Support', itemCode: '04_104_0125_6_1', unit: 'H', qty: 4, unitPrice: 73.58, total: 294.32, serviceDate: '2026-10-12', band: 'Weekday Daytime', flags: 'None',
  shortNoticeCancellationAllowed: false, trace: { rules: ['bands:weekday-daytime'], why: 'why', catalogueVersion: '2026-27', priceBasisFrom: '2026-07-01', zone: 'National', workers: 1, participantsPresent: 1, openQuestions: [] }, ...changes,
})

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

  it('counts the weeks of an agreement, a part week as its share', () => {
    expect(agreementWeeks('2026-07-01', '2027-06-30')).toBeCloseTo(52.14, 2)
    expect(agreementWeeks('2026-10-01', '2026-10-07')).toBe(1)
    expect(agreementWeeks('2026-10-07', '2026-10-01')).toBe(0)
  })
})

describe('flags', () => {
  it('reads the engine\'s comma-joined names', () => {
    expect(parseFlags('None')).toEqual({ review: false, holidayExposure: false, provisional: false })
    expect(parseFlags('Review, HolidayExposure')).toEqual({ review: true, holidayExposure: true, provisional: false })
    expect(parseFlags('Provisional')).toEqual({ review: false, holidayExposure: false, provisional: true })
    expect(parseFlags(undefined)).toEqual({ review: false, holidayExposure: false, provisional: false })
  })
})

describe('the lines of an agreement', () => {
  const lines = [
    line({ serviceDate: '2026-10-12', total: 294.32 }), line({ serviceDate: '2026-10-14', total: 294.32 }),
    line({ serviceDate: '2026-10-19', total: 294.32 }), line({ serviceDate: '2026-10-21', total: 294.32 }),
    line({ serviceDate: '2026-10-05', itemCode: '04_102_0125_6_1', unitPrice: 163.46, total: 653.84, band: 'Public Holiday', flags: 'Review, HolidayExposure', trace: { ...line({}).trace, openQuestions: [8] } }),
  ]

  it('sums an item\'s occurrences into one row, with what it is in the ordinary week beside what it is over the agreement', () => {
    const groups = groupLines(lines, { from: '2026-10-12', to: '2026-10-18' })

    expect(groups.map(group => [group.itemCode, group.band, group.occurrences, group.periodQty, group.periodTotal, group.weeklyQty, group.weeklyTotal])).toEqual([
      ['04_102_0125_6_1', 'Public Holiday', 1, 4, 653.84, 0, 0],
      ['04_104_0125_6_1', 'Weekday Daytime', 4, 16, 1177.28, 8, 588.64],
    ])
    expect(groups[0].flags).toEqual({ review: true, holidayExposure: true, provisional: false })
    expect(groups[0].openQuestions).toEqual([8])
    expect(groups[1].sample.serviceDate).toBe('2026-10-12')
  })

  it('has no weekly figure at all when the agreement has no ordinary week', () => {
    const groups = groupLines(lines, null)
    expect(groups.every(group => group.weeklyQty === null && group.weeklyTotal === null)).toBe(true)
  })

  it('adds the occurrences\' own totals and never multiplies quantity by price (40 minutes at 73.58 is 49.05, not 49.06)', () => {
    const forty = [line({ qty: 0.6667, total: 49.05, serviceDate: '2026-10-12' }), line({ qty: 0.6667, total: 49.05, serviceDate: '2026-10-14' }), line({ qty: 0.6667, total: 49.05, serviceDate: '2026-10-19' })]
    const [group] = groupLines(forty, { from: '2026-10-12', to: '2026-10-18' })
    expect(group.periodTotal).toBe(147.15)
    expect(group.weeklyTotal).toBe(98.1)
    expect(group.periodQty).toBeCloseTo(2.0001, 4)
  })

  it('keeps lines at different prices or from different catalogue rows apart, so a price change is its own row', () => {
    const december = line({ serviceDate: '2026-12-07', unitPrice: 74.58, total: 298.32, trace: { ...line({}).trace, priceBasisFrom: '2026-12-01', catalogueVersion: '2026-27 (2026-12-01)' } })
    expect(groupLines([line({}), december], null).map(group => group.unitPrice)).toEqual([73.58, 74.58])
  })

  it('lists a line the engine could not price as its own row, with the reason', () => {
    const night = line({ itemCode: undefined, unpriced: 'NoItem', unitPrice: 0, total: 0, band: 'Weekday Night', qty: 6 })
    const [group] = groupLines([night, night], null)
    expect(group).toMatchObject({ itemCode: undefined, unpriced: 'NoItem', occurrences: 2, periodTotal: 0 })
  })

  it('puts the support first, then its companions in the order a coordinator reads them', () => {
    const rows = [
      line({ kind: 'ActivityTransport', band: 'Activity-based transport', itemCode: '04_590_0125_6_1', unit: 'E' }), line({ kind: 'Sleepover', band: 'Sleepover', itemCode: '01_010_0107_1_1', unit: 'E' }),
      line({}), line({ kind: 'ProviderTravelTime', band: 'Provider travel' }),
    ]
    expect(groupLines(rows, null).map(group => group.kind)).toEqual(['Support', 'Sleepover', 'ProviderTravelTime', 'ActivityTransport'])
  })

  it('says a quantity in words: hours, sleepovers, nights, each, and nothing for a dollar line', () => {
    expect(quantityLabel('Support', 'H', 8)).toBe('8 h')
    expect(quantityLabel('Support', 'H', 0.6667)).toBe('0.67 h')
    expect(quantityLabel('Sleepover', 'E', 2)).toBe('2 sleepovers')
    expect(quantityLabel('Sleepover', 'E', 1)).toBe('1 sleepover')
    expect(quantityLabel('ParticipantAccommodation', 'D', 1)).toBe('1 night')
    expect(quantityLabel('CentreCapital', 'E', 3)).toBe('3 each')
    expect(quantityLabel('ActivityTransport', 'E', 12.4)).toBe('—')
    expect(bandLabel('Weekday Daytime')).toBe('Weekday daytime')
    expect(bandLabel('Saturday')).toBe('Saturday')
  })
})

describe('why, in plain words', () => {
  it('writes each rule the engine records as a sentence', () => {
    expect(ruleWords('price:catalogue-by-service-date')).toBe('Priced from the catalogue row valid on the date of the service')
    expect(ruleWords('bands:weekday-evening')).toBe('Weekday evening price (Mon–Fri 20:00–24:00)')
    expect(ruleWords('bands:public-holiday')).toBe('Public holiday price, the whole day')
    expect(ruleWords('travel:time-cap-30')).toBe('Provider travel time capped at 30 minutes each way for this zone')
    expect(ruleWords('crossing:A')).toContain('crossing policy A')
    expect(ruleWords('group:floor(price*workers/participants)')).toContain('rounded down to the cent')
    expect(ruleWords('unpriced:no-item')).toBe('Not priced: no item')
    expect(ruleWords('bands:something-new')).toBe('Something new price')
    expect(ruleWords('totally:unknown')).toBe('totally:unknown')
  })

  it('has words for every rule id the pricing engine can write', () => {
    const source = resolve(__dirname, '../../../backend/Odip.Domain/Billing/Pricing')
    if (!existsSync(source)) return   // the backend does not sit beside the frontend here (an image build): nothing to read
    const text = ['OccurrencePricer.cs', 'PlanPricingEngine.cs'].map(file => readFileSync(resolve(source, file), 'utf-8')).join('\n')
    const ids = [...new Set([...text.matchAll(/"([a-z][a-z0-9-]*:[a-z][^"{}\s]*)"/g)].map(match => match[1]))].filter(id => !/^(bands|unpriced):$/.test(id))
    expect(ids.length).toBeGreaterThan(15)
    expect(ids.filter(id => ruleWords(id) === id), 'a rule id with no words').toEqual([])
  })

  it('says the open questions a line rests on', () => {
    expect(questionShort(6)).toBe('travel time caps and per-kilometre rates are 2025-26 values')
    expect(questionShort(99)).toBe('open question 99')
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

  it('counts what is flagged in a plan', () => {
    expect(flagSummary({ reviewLines: 2, provisionalLines: 3, unpricedLines: 1 })).toBe('1 line not priced, 2 lines to review, 3 provisional')
    expect(flagSummary({ reviewLines: 1, provisionalLines: 0, unpricedLines: 0 })).toBe('1 line to review')
    expect(flagSummary({ reviewLines: 0, provisionalLines: 0, unpricedLines: 0 })).toBe('')
  })
})

describe('issues read as one thing, not one per date', () => {
  const gap = (blockId: string, date: string, count = 1, item = 'Community access'): PlanIssue => ({
    blockId, reason: 'CatalogueNotFound', message: `No catalogue row for ${item} is valid on ${date}. Import the catalogue for that period.`, count, firstDate: date,
  })

  it('adds a catalogue gap met on a hundred dates up to one issue, with the message and the date of the earliest', () => {
    const dates = Array.from({ length: 100 }, (_, i) => addDays('2027-07-01', i))
    // The engine gives them in date order here, but the earliest is the earliest wherever it comes.
    const grouped = groupIssues([...dates.slice(50), ...dates.slice(0, 50)].map(date => gap('b1', date)))

    expect(grouped).toHaveLength(1)
    expect(grouped[0]).toEqual({ blockId: 'b1', reason: 'CatalogueNotFound', message: 'No catalogue row for Community access is valid on 2027-07-01. Import the catalogue for that period.', count: 100, firstDate: '2027-07-01' })
  })

  it('keeps one issue for each block, and the blocks in the order they came', () => {
    const grouped = groupIssues([gap('b2', '2027-07-03'), gap('b1', '2027-07-02'), gap('b2', '2027-07-01'), gap('b1', '2027-07-09', 2)])

    expect(grouped.map(issue => [issue.blockId, issue.count, issue.firstDate])).toEqual([['b2', 2, '2027-07-01'], ['b1', 3, '2027-07-02']])
  })

  it('does not run two different problems together: a rule broken in two fields, or a block that overlaps two others', () => {
    const invalid = (message: string): PlanIssue => ({ blockId: 'b1', reason: 'InvalidInput', message, count: 1 })
    const overlap = (other: string): PlanIssue => ({ blockId: 'b1', reason: 'BlocksOverlap', message: `Block 'b1' and Block '${other}' are on at the same time.`, count: 4, firstDate: '2026-10-12' })

    expect(groupIssues([invalid('Pick a day.'), invalid('The end is before the start.'), invalid('Pick a day.')]).map(issue => [issue.message, issue.count])).toEqual([['Pick a day.', 2], ['The end is before the start.', 1]])
    expect(groupIssues([overlap('b2'), overlap('b3'), overlap('b2')]).map(issue => [issue.message, issue.count])).toEqual([["Block 'b1' and Block 'b2' are on at the same time.", 8], ["Block 'b1' and Block 'b3' are on at the same time.", 4]])
  })

  it('keeps an issue with no date as it is, and takes the date from whichever issue has one', () => {
    const undated: PlanIssue = { blockId: 'b1', reason: 'NamedDateNotInCalendar', message: 'a day in this block', count: 2 }

    expect(groupIssues([undated])).toEqual([undated])
    expect(groupIssues([undated, { ...undated, firstDate: '2026-12-26', count: 1 }])).toEqual([{ ...undated, count: 3, firstDate: '2026-12-26' }])
  })

  it('does not change what it is given', () => {
    const given = [gap('b1', '2027-07-02'), gap('b1', '2027-07-01')]
    const copy = JSON.parse(JSON.stringify(given))

    groupIssues(given)
    groupByReason(given)
    expect(given).toEqual(copy)
  })

  it('has a way to say only the reason once for a block, whatever the messages said', () => {
    const grouped = groupByReason([
      gap('b1', '2027-07-01', 1, 'Community access'), gap('b1', '2027-07-02', 1, 'Group activities'),
      { blockId: 'b1', reason: 'BlocksOverlap', message: 'with b2', count: 2 }, { blockId: 'b1', reason: 'BlocksOverlap', message: 'with b3', count: 1 },
    ])

    expect(grouped.map(issue => [issue.reason, issue.count])).toEqual([['CatalogueNotFound', 2], ['BlocksOverlap', 3]])
  })

  it('says where an issue was met in words: how many shifts and the first day, or only the day', () => {
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 24, firstDate: '2026-10-13' })).toBe('24 shifts, the first on Tue 13 Oct 2026')
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 1, firstDate: '2026-10-13' })).toBe('Tue 13 Oct 2026')
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 3 })).toBe('3 shifts')
    expect(issueWhere({ blockId: 'b1', reason: 'NoItem', message: 'm', count: 1 })).toBe('')
  })
})

describe('the plan budget', () => {
  it('compares a plan with its budget: within, over by how much, or unknown when none is recorded', () => {
    expect(compareBudget(30000, 40000)).toEqual({ status: 'within', budget: 40000, used: 30000, remaining: 10000, percent: 75 })
    expect(compareBudget(41234.56, 40000)).toEqual({ status: 'over', budget: 40000, used: 41234.56, remaining: -1234.56, percent: 103 })
    expect(compareBudget(40000, 40000).status).toBe('within')   // exactly the budget is not over it
    for (const none of [null, undefined, 0]) expect(compareBudget(100, none)).toEqual({ status: 'unknown', budget: null, used: 100, remaining: null, percent: null })
  })

  it('reads the plan budget off the participant\'s active NDIS funding sources that meet the agreement, and says nothing when none records one', () => {
    const source = (changes: Partial<FundingSourceDto>): FundingSourceDto => ({
      id: 'f', participantId: 'p', participantName: null, routeType: 'PlanManaged', budgetCategory: 'Core - Social & Community Participation', ndisPlanNumber: null, planStartDate: '2026-07-01', planEndDate: '2027-06-30',
      budget: 20000, payerName: null, payerEmail: null, isActive: true, ...changes,
    })
    expect(planBudgetFor([source({}), source({ id: 'g', routeType: 'AgencyManaged', budget: 5000.5 })], '2026-10-01', '2027-03-31')).toEqual({ total: 25000.5, count: 2 })
    expect(planBudgetFor([source({ isActive: false }), source({ routeType: 'Private' }), source({ budget: null }), source({ planEndDate: '2026-09-30' }), source({ planStartDate: '2027-04-01' })], '2026-10-01', '2027-03-31')).toBeNull()
    expect(planBudgetFor([source({ planStartDate: null, planEndDate: null })], '2026-10-01', '2027-03-31')).toEqual({ total: 20000, count: 1 })
    expect(planBudgetFor(undefined, '2026-10-01', '2027-03-31')).toBeNull()
  })

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
