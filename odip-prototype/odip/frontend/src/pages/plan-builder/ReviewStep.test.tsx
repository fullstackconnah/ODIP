import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { DraftBlock, PlanBlock, PlanIssue, PlanQuote } from '@/api/types'
import { blockProblems } from '@/lib/planBlocks'
import { draftBlock, emptyTotals, line, mondayWednesday, quote } from '@/test/fixtures/planPricing'
import { ReviewStep } from './ReviewStep'

const { state, refetch, requested } = vi.hoisted(() => ({
  state: { current: {} as Record<string, unknown> },
  refetch: vi.fn(),
  requested: vi.fn(),
}))
vi.mock('@/api/hooks', () => ({
  usePlanBlockQuote: (block: unknown, from: string, to: string, enabled: boolean) => { requested(block, from, to, enabled); return { ...state.current, refetch } },
}))

const WEEK = { from: '2026-10-12', to: '2026-10-18' }
const linesTable = () => within(screen.getByRole('region', { name: 'Lines this block produces' })).getByRole('table')

/** The brief's block priced over the agreement: eight hours a week at $73.58, and Monday 5 October (Labour Day) at the holiday item. */
const blockQuote = (changes: Partial<PlanQuote> = {}): PlanQuote => quote({
  lines: [
    line({ serviceDate: '2026-10-12' }), line({ serviceDate: '2026-10-14' }), line({ serviceDate: '2026-10-19' }),
    line({ serviceDate: '2026-10-05', itemCode: '04_102_0125_6_1', unitPrice: 163.46, total: 653.84, band: 'Public Holiday', flags: 'Review, HolidayExposure', trace: { ...line().trace, rules: ['bands:public-holiday', 'holiday:state-calendar'], holidayName: 'Labour Day', openQuestions: [8], why: 'Public Holiday (public holiday: Labour Day) on Mon 5 Oct 2026, 09:00 to 13:00.' } }),
  ],
  holidayOccurrences: [{ blockId: 'b1', date: '2026-10-05', holidayName: 'Labour Day', state: 'NSW', decision: 'Review', skipped: false, atHolidayRates: 653.84, atOrdinaryRates: 294.32, uplift: 359.52 }],
  openQuestions: [{ number: 8, text: 'Part-day and regional public holidays are maintained by the owner.' }],
  totals: { ...emptyTotals(), amount: 1530.48, supportHours: 16, lineCount: 4, byBlock: [{ blockId: 'b1', amount: 1530.48, supportHours: 16, occurrences: 4, skippedOccurrences: 0 }] },
  ...changes,
})

function setUp(props: { entry?: DraftBlock; others?: PlanBlock[]; position?: number; week?: typeof WEEK | null; planIssues?: PlanIssue[]; from?: string; to?: string; onChange?: (entry: DraftBlock) => void; onGoTo?: (step: string) => void } = {}) {
  const entry = props.entry ?? draftBlock()
  const handlers = { onChange: props.onChange ?? vi.fn(), onGoTo: props.onGoTo ?? vi.fn() }
  render(
    <MemoryRouter>
      <ReviewStep
        entry={entry} quoted={entry.block} others={props.others ?? []} position={props.position} from={props.from ?? '2026-10-01'} to={props.to ?? '2027-06-30'} week={props.week === undefined ? WEEK : props.week}
        planIssues={props.planIssues ?? []} problems={blockProblems(entry.block)} onChange={handlers.onChange} onGoTo={handlers.onGoTo as never}
      />
    </MemoryRouter>,
  )
  return handlers
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  state.current = { data: blockQuote(), isLoading: false, isError: false, error: null }
  refetch.mockReset(); requested.mockReset()
})
afterEach(() => localStorage.clear())

describe('ReviewStep lines', () => {
  it('shows the lines the block produces, each with code, band, hours and cost in an ordinary week, unit price and what it comes to over the agreement', () => {
    setUp()

    const rows = within(linesTable()).getAllByRole('row')
    const daytime = rows.find(row => within(row).queryByText('04_104_0125_6_1'))!
    expect(daytime).toHaveTextContent('Weekday daytime')
    expect(daytime).toHaveTextContent('8 h')                  // Monday and Wednesday in the ordinary week
    expect(daytime).toHaveTextContent('$73.58')
    expect(daytime).toHaveTextContent('$588.64')              // a week
    expect(daytime).toHaveTextContent('$882.96')              // three occurrences over the agreement
    expect(daytime).toHaveTextContent('3 shifts')
    const holiday = rows.find(row => within(row).queryByText('04_102_0125_6_1'))!
    expect(holiday).toHaveTextContent('Public holiday')
    expect(holiday).toHaveTextContent('$163.46')
    expect(holiday).toHaveTextContent('$653.84')
    expect(within(holiday).getByText('Review')).toBeInTheDocument()
    expect(within(holiday).getByText('Holiday rate')).toBeInTheDocument()
  })

  it('adds the week and the agreement up from the server\'s totals', () => {
    setUp()
    expect(screen.getByText(/8 h and \$588\.64 in an ordinary week/)).toBeInTheDocument()
    expect(screen.getByText('$1,530.48')).toBeInTheDocument()
  })

  it('asks the server about this block alone over the agreement period, and only once it can be priced', () => {
    setUp()
    expect(requested).toHaveBeenCalledWith(draftBlock().block, '2026-10-01', '2027-06-30', true)
  })

  it('opens the reasoning behind a line: the sentence, each rule in plain words and the catalogue row the price came from', async () => {
    const user = userEvent.setup()
    setUp()

    const button = screen.getByRole('button', { name: 'Why 04_104_0125_6_1, Weekday daytime' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await user.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByRole('region', { name: 'Why this price' })
    expect(panel).toHaveTextContent('Weekday Daytime (Mon-Fri 06:00-20:00) on Mon 12 Oct 2026')
    expect(within(panel).getByText('Weekday daytime price (Mon–Fri 06:00–20:00)')).toBeInTheDocument()
    expect(within(panel).getByText('Priced from the catalogue row valid on the date of the service')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Price basiscatalogue 2026-27, the price row from Wed 1 Jul 2026')
    expect(panel).toHaveTextContent('NDIS maximum$73.58 before the group arithmetic (1:1)')

    await user.click(button)
    expect(screen.queryByRole('region', { name: 'Why this price' })).not.toBeInTheDocument()
  })

  it('says what a line rests on when it depends on an open question, in plain words', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('button', { name: 'Why 04_102_0125_6_1, Public holiday' }))

    const panel = screen.getByRole('region', { name: 'Why this price' })
    expect(panel).toHaveTextContent('Rests on a part-day holiday, or Boxing Day or Anzac Day missing from the calendar.')
    expect(panel).toHaveTextContent('Public holidayLabour Day')
  })

  it('lists a line the engine could not price as "No item", with the reason, and a dash for its price', () => {
    state.current = { data: blockQuote({ lines: [line({ itemCode: undefined, unpriced: 'NoItem', unitPrice: 0, total: 0, band: 'Weekday Night', qty: 1, flags: 'Review', isPriced: false })] }), isLoading: false, isError: false }
    setUp()

    const row = within(linesTable()).getAllByRole('row')[1]
    expect(row).toHaveTextContent('No item')
    expect(within(row).getByText('Not priced')).toBeInTheDocument()
    expect(row).not.toHaveTextContent('$73.58')
  })

  it('has no weekly figure to give an agreement shorter than a week, and says so', () => {
    setUp({ week: null, to: '2026-10-04' })
    expect(screen.getByText(/shorter than a week, so there is no weekly figure/)).toBeInTheDocument()
  })

  // Review F9: the week came from the budget, which has not answered yet (or failed), so a twelve month agreement was told it was shorter than a week.
  it('works the ordinary week out itself while the budget has not answered, and never calls a long agreement shorter than a week', () => {
    setUp({ week: null })

    expect(screen.queryByText(/shorter than a week/)).not.toBeInTheDocument()
    expect(screen.getByText(/8 h and \$588\.64 in an ordinary week/)).toBeInTheDocument()   // Monday 12 and Wednesday 14 October: the first week with no holiday in it
    const daytime = within(linesTable()).getAllByRole('row').find(row => within(row).queryByText('04_104_0125_6_1'))!
    expect(daytime).toHaveTextContent('$588.64')
  })

  it("prefers the plan's own ordinary week when the budget has given one", () => {
    setUp({ week: { from: '2026-10-19', to: '2026-10-25' } })
    const daytime = within(linesTable()).getAllByRole('row').find(row => within(row).queryByText('04_104_0125_6_1'))!
    expect(daytime).toHaveTextContent('4 h')       // only Monday 19 October is in that week
  })
})

describe('ReviewStep public holidays', () => {
  it('shows each shift that meets one with what the holiday adds, and says what happens to it now', () => {
    setUp()

    const section = screen.getByRole('region', { name: 'Public holidays' })
    expect(section).toHaveTextContent('1 shift falls on a public holiday, adding $359.52 over ordinary days.')
    expect(section).toHaveTextContent('Mon 5 Oct 2026')
    expect(section).toHaveTextContent('Labour Day (NSW)')
    expect(section).toHaveTextContent('$653.84')
    expect(section).toHaveTextContent('$294.32')
    expect(section).toHaveTextContent('+$359.52')
    expect(section).toHaveTextContent('Needs a decision')
  })

  it('offers Decide later, Charge and Skip, and says what each does; Skip says the whole shift goes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    setUp({ onChange })

    const group = screen.getByRole('radiogroup', { name: 'When a shift falls on a public holiday' })
    expect(within(group).getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Decide later', 'Charge the holiday rate', 'Skip the shift'])
    expect(screen.getByText(/flagged, so a person decides before this agreement is approved/)).toBeInTheDocument()

    await user.click(within(group).getByRole('radio', { name: 'Skip the shift' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].block.onPublicHoliday).toBe('Skip')
    expect(onChange.mock.calls[0][0].requirements).toEqual(draftBlock().requirements)
  })

  it('says the whole shift is skipped, not only the holiday part, beside the Skip choice', () => {
    setUp({ entry: draftBlock(mondayWednesday('b1', { onPublicHoliday: 'Skip' })) })
    expect(screen.getByText(/The whole shift is skipped, not only the part that falls on the holiday/)).toBeInTheDocument()
  })

  it('shows a skipped shift as skipped and a charged one as charged', () => {
    const decided = blockQuote({ holidayOccurrences: [
      { blockId: 'b1', date: '2026-10-05', holidayName: 'Labour Day', decision: 'Skip', skipped: true },
      { blockId: 'b1', date: '2026-12-25', holidayName: 'Christmas Day', decision: 'Charge', skipped: false, atHolidayRates: 653.84, atOrdinaryRates: 294.32, uplift: 359.52 },
    ] })
    state.current = { data: decided, isLoading: false, isError: false }
    setUp()

    const section = screen.getByRole('region', { name: 'Public holidays' })
    expect(section).toHaveTextContent('Skipped')
    expect(section).toHaveTextContent('Charged')
  })

  it('has no holiday section for a block that meets none', () => {
    state.current = { data: blockQuote({ holidayOccurrences: [] }), isLoading: false, isError: false }
    setUp()
    expect(screen.queryByRole('region', { name: 'Public holidays' })).not.toBeInTheDocument()
  })
})

describe('ReviewStep what needs a person', () => {
  it('puts each issue in plain words with what to do about it and a way to the step that fixes it', async () => {
    const user = userEvent.setup()
    const onGoTo = vi.fn()
    const issue: PlanIssue = { blockId: 'b1', reason: 'NoItem', message: "Block 'b1': the catalogue has no community access item for Weekday Night (00:00 to 06:00).", count: 24, firstDate: '2026-10-13' }
    state.current = { data: blockQuote({ issues: [issue] }), isLoading: false, isError: false }
    setUp({ onGoTo })

    const section = screen.getByRole('region', { name: 'To look at' })
    expect(section).toHaveTextContent('Part of this block has no price item')
    expect(section).toHaveTextContent('Block 1: the catalogue has no community access item for Weekday Night')   // the block named by its place, not its id
    expect(section).toHaveTextContent('24 shifts, the first on Tue 13 Oct 2026')
    expect(section).toHaveTextContent('keep the block clear of those hours, or use personal care.')
    await user.click(within(section).getByRole('button', { name: 'Go to Days and times' }))
    expect(onGoTo).toHaveBeenCalledWith('times')
  })

  // One issue for each block, reason and message, counting the shifts (see PlanOverview.test.tsx): two items missing from the catalogue are two issues counting the same 40 shifts.
  it('lists a catalogue gap once, not once for every item it misses, with the shifts it touches and the first of them', () => {
    const issues: PlanIssue[] = ['Community access, Weekday Daytime', 'Community access, Weekday Evening'].map(need => ({
      blockId: 'b1', reason: 'CatalogueNotFound', message: `No catalogue row for ${need} is valid for part of the period. Import the catalogue for that period.`, count: 40, firstDate: '2027-07-01',
    }))
    state.current = { data: blockQuote({ issues }), isLoading: false, isError: false }
    setUp()

    const section = screen.getByRole('region', { name: 'To look at' })
    expect(within(section).getAllByText('No catalogue prices for part of the agreement')).toHaveLength(1)
    expect(section).toHaveTextContent('40 shifts, the first on Thu 1 Jul 2027')
  })

  it('adds what the whole plan said about this block (an overlap needs the other blocks to be seen), once', () => {
    const overlap: PlanIssue = { blockId: 'b1', reason: 'BlocksOverlap', message: "Block 'b1' and Block 'b2' are on at the same time.", count: 3 }
    state.current = { data: blockQuote({ issues: [overlap] }), isLoading: false, isError: false }
    setUp({ planIssues: [overlap, { ...overlap, blockId: 'b9' }] })

    expect(within(screen.getByRole('region', { name: 'To look at' })).getAllByText('Two blocks are on at the same time')).toHaveLength(1)
  })

  it('names the blocks by their places in the plan: the block being reviewed is where it sits, not after the others', () => {
    const overlap: PlanIssue = { blockId: 'b1', reason: 'BlocksOverlap', message: "Blocks 'b1' and 'b3' are on at the same time on the same day. Block 'b1' is the first.", count: 3, firstDate: '2026-10-12' }
    state.current = { data: blockQuote({ issues: [overlap] }), isLoading: false, isError: false }
    setUp({ others: [mondayWednesday('b2', { days: ['Saturday'] }), mondayWednesday('b3')], position: 0 })

    expect(within(screen.getByRole('region', { name: 'To look at' })).getByText(/Blocks 1 and 3 are on at the same time on the same day\. Block 1 is the first\./)).toBeInTheDocument()
  })

  it('puts a block that is being added last, so the others keep the numbers the overview gave them', () => {
    const overlap: PlanIssue = { blockId: 'b3', reason: 'BlocksOverlap', message: "Blocks 'b1' and 'b3' are on at the same time on the same day.", count: 1 }
    state.current = { data: blockQuote({ issues: [overlap] }), isLoading: false, isError: false }
    setUp({ entry: draftBlock(mondayWednesday('b3')), others: [mondayWednesday('b1'), mondayWednesday('b2', { days: ['Saturday'] })] })

    expect(within(screen.getByRole('region', { name: 'To look at' })).getByText(/Blocks 1 and 3 are on at the same time on the same day\./)).toBeInTheDocument()
  })

  it('calls a refusal an error, not a warning', () => {
    state.current = { data: blockQuote({ issues: [{ blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs group 0125.", count: 1 }] }), isLoading: false, isError: false }
    setUp()

    expect(screen.getByRole('region', { name: 'To look at' }).querySelector('[role="alert"]')).toHaveTextContent('Your organisation does not hold this registration group')
  })

  it('lists the questions this block waits on, closed until opened', () => {
    setUp()
    const details = screen.getByText('Questions this block waits on (1)').closest('details')!
    expect(details).not.toHaveAttribute('open')
    expect(details).toHaveTextContent('Question 8. Part-day and regional public holidays are maintained by the owner.')
  })

  // Design review 2 and 3: the registration notice is the plan's standing caveat and the overview says it once, as a quiet line; here it was a full-width Callout above the lines of every block.
  it('leaves the registration notice to the overview, and carries the notices that are about prices, without interrupting', () => {
    state.current = { data: blockQuote({ notices: [
      { code: 'registration-groups-not-confirmed', message: 'Not confirmed.', openQuestion: 1 },
      { code: 'holiday-calendar-missing', message: 'The calendar has no rows after 2027-04-25 for NSW.', openQuestion: 8 },
    ] }), isLoading: false, isError: false }
    setUp()

    expect(screen.queryByRole('link', { name: 'Confirm in Settings' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Registration groups are not confirmed/)).not.toBeInTheDocument()
    const callout = screen.getByText('The public holiday calendar has gaps').closest('div[class*="rounded-lg"]') as HTMLElement
    expect(callout).toHaveTextContent('after Sun 25 Apr 2027')
    expect(callout).not.toHaveAttribute('role')
  })
})

describe('ReviewStep states', () => {
  it('says it is pricing while the first answer is on its way', () => {
    state.current = { data: undefined, isLoading: true, isError: false }
    setUp()

    expect(screen.getByRole('status')).toHaveTextContent('Pricing this block…')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('says why it could not price, in words, and offers to try again only when that can help', async () => {
    const user = userEvent.setup()
    state.current = { data: undefined, isLoading: false, isError: true, error: { response: { status: 429, data: {} } } }
    setUp()

    expect(screen.getByRole('alert')).toHaveTextContent('The pricing service is busy')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says a plan with too many lines to list is too big, and offers no retry', () => {
    state.current = { data: undefined, isLoading: false, isError: true, error: { response: { status: 400, data: { errors: ['The quote has 61,000 lines, more than the 60,000 one answer carries: ask for the totals only (includeLines: false), shorten the period, or price fewer blocks.'] } } } }
    setUp()

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('This plan has too many lines to list')
    expect(alert).toHaveTextContent('Shorten the agreement period')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  // Review F1: the framework's validation answer (errors as an object by field) threw inside render and took the unsaved block with it.
  it('reads the framework\'s validation answer without throwing, and says it in words', () => {
    state.current = { data: undefined, isLoading: false, isError: true, error: { response: { status: 400, data: { title: 'One or more validation errors occurred.', status: 400, errors: { 'blocks[0].block.sleepoverActiveHours': ['The JSON value could not be converted to System.Decimal. Path: $.blocks[0]...'] } } } } }

    expect(() => setUp()).not.toThrow()

    expect(screen.getByRole('alert')).toHaveTextContent('A box in the plan is empty or is not a number.')
    expect(screen.getByRole('alert')).toHaveTextContent('This plan cannot be priced yet')
  })

  it('keeps showing the last answer when a newer one fails', () => {
    state.current = { data: blockQuote(), isLoading: false, isError: true, error: new Error('Network Error') }
    setUp()

    expect(linesTable()).toBeInTheDocument()
    expect(screen.queryByText('The plan could not be priced')).not.toBeInTheDocument()
  })

  it('does not ask the server about a block that is not complete, and says what to fix, with a way to the step', async () => {
    const user = userEvent.setup()
    const onGoTo = vi.fn()
    state.current = { data: undefined, isLoading: false, isError: false }
    setUp({ entry: draftBlock(mondayWednesday('b1', { days: [] })), onGoTo })

    expect(screen.getByText('This block cannot be priced yet')).toBeInTheDocument()
    expect(requested).toHaveBeenCalledWith(null, '2026-10-01', '2027-06-30', false)
    await user.click(screen.getByRole('button', { name: 'Go to Days and times' }))
    expect(onGoTo).toHaveBeenCalledWith('times')
  })

  it('asks for the agreement dates when there are none, and prices nothing', () => {
    state.current = { data: undefined, isLoading: false, isError: false }
    setUp({ from: '', to: '' })

    expect(screen.getByText('Enter the agreement dates to price this block')).toBeInTheDocument()
    expect(requested).toHaveBeenCalledWith(null, '', '', false)
  })

  it('draws the block on the week beside the others, in the strong colour', () => {
    setUp({ others: [mondayWednesday('b2', { days: ['Saturday'] })] })

    const picture = screen.getByRole('img')
    expect(picture.getAttribute('aria-label')).toContain('Saturday: 09:00–13:00')
    expect(picture.querySelectorAll('[data-highlight="true"]')).toHaveLength(2)    // Monday and Wednesday of this block
  })
})

const precedes = (first: Element, second: Element) => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
const gap: PlanIssue = { blockId: 'b1', reason: 'NoItem', message: "Block 'b1': the catalogue has no item for Weekday Night.", count: 24, firstDate: '2026-10-13' }
/** A line the engine could not price, on Tuesday 13 October: five hours of a night with no catalogue item. */
const unpricedNight = (changes: Partial<ReturnType<typeof line>> = {}) => line({ itemCode: undefined, unpriced: 'NoItem', unitPrice: 0, total: 0, band: 'Weekday Night', qty: 5, serviceDate: '2026-10-13', flags: 'Review', isPriced: false, ...changes })

// Design review 3: Review is where the stepper builds to, and it ordered the lines, then the holidays, then what was wrong, a thousand pixels below the row it was about.
describe('ReviewStep in the order a coordinator needs it', () => {
  it('puts what has to be looked at before the lines, the lines before the holidays, and the questions last', () => {
    state.current = { data: blockQuote({ issues: [gap] }), isLoading: false, isError: false }
    setUp()

    expect(screen.getAllByRole('heading', { level: 4 }).map(heading => heading.textContent)).toEqual(['To look at', 'Lines this block produces', 'Public holidays'])
    const lookAt = screen.getByRole('region', { name: 'To look at' })
    const lines = screen.getByRole('region', { name: 'Lines this block produces' })
    const holidays = screen.getByRole('region', { name: 'Public holidays' })
    const questions = screen.getByText(/Questions this block waits on/)
    expect(precedes(screen.getByRole('img'), lookAt)).toBe(true)          // the strip, then ...
    expect(precedes(lookAt, lines)).toBe(true)
    expect(precedes(lines, holidays)).toBe(true)
    expect(precedes(holidays, questions)).toBe(true)
  })

  it('has no To look at when there is nothing to look at', () => {
    setUp()

    expect(screen.queryByRole('region', { name: 'To look at' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 4 }).map(heading => heading.textContent)).toEqual(['Lines this block produces', 'Public holidays'])
  })

  it('puts the block\'s total in bold directly under the table', () => {
    setUp()

    const total = screen.getByText('$1,530.48')
    expect(total).toHaveClass('font-bold')
    expect(total.closest('p')).toHaveTextContent('$1,530.48 over the agreement, 4 shifts.')
    expect(precedes(within(screen.getByRole('region', { name: 'Lines this block produces' })).getByRole('table'), total)).toBe(true)
  })

  // Review F16: after "Skip the shift" the old lines stayed up, undimmed, until the new answer landed, with the caption beside them already changed and nothing said to a screen reader.
  it('dims the lines and says they are updating while a newer answer is on its way, once and politely', () => {
    state.current = { data: blockQuote(), isLoading: false, isError: false, isFetching: true, isPlaceholderData: true }
    setUp()

    expect(screen.getByRole('region', { name: /Lines this block produces/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText(/updating…/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Updating prices')
    expect(linesTable().closest('.opacity-60')).not.toBeNull()
  })

  it('says nothing of updating when the answer on screen is the answer for this block, even while it is checked again in the background', () => {
    state.current = { data: blockQuote(), isLoading: false, isError: false, isFetching: true, isPlaceholderData: false }
    setUp()

    expect(screen.queryByText(/updating/)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(linesTable().closest('.opacity-60')).toBeNull()
  })
})

// Design review 1 and review F10: a total that leaves work out says so, and hours are counted the way the engine and the budget bar count them: the priced ones.
describe('ReviewStep and what is not priced', () => {
  it('shows an en dash, never $0.00, as the price, the week and the agreement total of a line with no price, and still counts its shifts', () => {
    state.current = { data: blockQuote({ lines: [unpricedNight({ qty: 1, serviceDate: '2026-10-12' })], issues: [gap] }), isLoading: false, isError: false }
    setUp()

    const row = within(linesTable()).getAllByRole('row')[1]
    expect(row).toHaveTextContent('No item')
    expect(row).not.toHaveTextContent('$0.00')
    expect(row).toHaveTextContent('1 shift')
    expect(within(row).getAllByText('–').length).toBeGreaterThanOrEqual(3)     // the unit price, a week, the agreement
  })

  it('counts the hours that are priced beside the dollars that pay for them, and the hours that are not, apart', () => {
    state.current = { data: blockQuote({ lines: [...blockQuote().lines, unpricedNight()], issues: [gap] }), isLoading: false, isError: false }
    setUp()

    const week = screen.getByText(/8 h and \$588\.64 in an ordinary week/)
    expect(week.closest('p')).toHaveTextContent('8 h and $588.64 in an ordinary week · 5 h not priced.')
    expect(week.closest('p')).not.toHaveTextContent('13 h')
  })

  it('has no figure at all for a block that nothing is priced from, and says how many hours are left out', () => {
    state.current = { data: blockQuote({ lines: [unpricedNight()], issues: [gap], totals: { ...emptyTotals(), amount: 0, byBlock: [{ blockId: 'b1', amount: 0, supportHours: 0, occurrences: 24, skippedOccurrences: 0 }] }, holidayOccurrences: [] }), isLoading: false, isError: false }
    setUp()

    const total = screen.getByText('–', { selector: 'span.font-bold' })
    expect(total.closest('p')).toHaveTextContent('– over the agreement, 24 shifts.')
    expect(screen.getByText(/5 h in an ordinary week are not priced\./)).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('says in shifts what is left out of the total beside it, as the budget bar does', () => {
    state.current = { data: blockQuote({ issues: [gap, { ...gap, message: 'Block \'b1\': no item for Weekday Evening.' }] }), isLoading: false, isError: false }
    setUp()

    expect(screen.getByText('24 shifts with a part not priced · 1 public holiday shift to decide.')).toBeInTheDocument()
  })
})

// Design review 4: the reasoning opened after the table, nowhere near its row, and nothing moved.
describe('ReviewStep: Why opens where it is asked', () => {
  const daytime = () => screen.getByRole('button', { name: 'Why 04_104_0125_6_1, Weekday daytime' })
  const holiday = () => screen.getByRole('button', { name: 'Why 04_102_0125_6_1, Public holiday' })

  it('has the panel in the page before it is opened, hidden, so that the aria-controls of every Why points at something', () => {
    setUp()

    expect(document.getElementById('plan-why-panel')).toHaveAttribute('hidden')
    for (const button of screen.getAllByRole('button', { name: /^Why / })) expect(button).toHaveAttribute('aria-controls', 'plan-why-panel')
    expect(screen.queryByRole('region', { name: 'Why this price' })).not.toBeInTheDocument()     // hidden is out of the accessibility tree
  })

  it('moves focus to the panel when it opens, and shows the open Why as pressed', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(daytime())

    expect(screen.getByRole('region', { name: 'Why this price' })).toHaveFocus()
    expect(daytime()).toHaveClass('bg-[var(--color-primary)]')
    expect(holiday()).not.toHaveClass('bg-[var(--color-primary)]')
    expect(daytime()).toHaveAttribute('aria-expanded', 'true')
  })

  it('switches to the reasoning of another line, and Close goes back to the line it was opened for', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(daytime())
    await user.click(holiday())
    const panel = screen.getByRole('region', { name: 'Why this price' })
    expect(panel).toHaveTextContent('Public Holiday (public holiday: Labour Day)')
    expect(panel).toHaveFocus()
    expect(daytime()).not.toHaveClass('bg-[var(--color-primary)]')

    await user.click(within(panel).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('region', { name: 'Why this price' })).not.toBeInTheDocument()
    expect(holiday()).toHaveFocus()
  })
})

// Design review 3 and review F15: nine holiday cards were 1,700px of the same three figures, with the decision after all of them; and the screen has one choice for the block, not one for each
// holiday, and no Move.
describe('ReviewStep holidays as a decision with its dates under it', () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ blockId: 'b1', date: `2027-0${(i % 9) + 1}-04`, holidayName: `Holiday ${i + 1}`, decision: 'Review' as const, skipped: false, atHolidayRates: 490.38, atOrdinaryRates: 147.16, uplift: 343.22 }))

  it('shuts the dates when there are more than two, with the choice and what it does above them', () => {
    state.current = { data: blockQuote({ holidayOccurrences: nine }), isLoading: false, isError: false }
    setUp()

    const dates = screen.getByText('Dates and what each adds (9)').closest('details') as HTMLDetailsElement
    expect(dates).not.toHaveAttribute('open')
    const choice = screen.getByRole('radiogroup', { name: 'When a shift falls on a public holiday' })
    expect(precedes(choice, dates)).toBe(true)
    expect(precedes(screen.getByText(/Priced at the holiday rate and flagged/), dates)).toBe(true)
    expect(screen.getByRole('region', { name: 'Public holidays' })).toHaveTextContent('9 shifts fall on a public holiday, adding $3,088.98 over ordinary days.')
  })

  it('leaves the dates open when there are one or two', () => {
    state.current = { data: blockQuote({ holidayOccurrences: nine.slice(0, 2) }), isLoading: false, isError: false }
    setUp()

    expect(screen.getByText('Dates and what each adds (2)').closest('details')).toHaveAttribute('open')
  })

  it('leaves the one date open', () => {
    setUp()
    expect(screen.getByText('Dates and what each adds (1)').closest('details')).toHaveAttribute('open')
  })

  it('says it is one choice for the block, that there is no choice to move a shift, and what to do instead', () => {
    setUp()

    const hint = screen.getByText(/one choice for every shift of the block that falls on a public holiday/)
    expect(hint).toHaveTextContent('There is no choice to move a shift to another day: to move one, change the block\'s days under Days and times.')
  })
})
