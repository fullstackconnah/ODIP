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
    setUp({ week: null })
    expect(screen.getByText(/shorter than a week, so there is no weekly figure/)).toBeInTheDocument()
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
    expect(section).toHaveTextContent('Finish by midnight, start after 06:00, or use personal care.')
    await user.click(within(section).getByRole('button', { name: 'Go to Days and times' }))
    expect(onGoTo).toHaveBeenCalledWith('times')
  })

  it('lists a catalogue gap once, not once for every date it meets, with the shifts it touches and the first of them', () => {
    const issues: PlanIssue[] = Array.from({ length: 40 }, (_, i) => {
      const date = new Date(Date.UTC(2027, 6, 1 + i)).toISOString().slice(0, 10)
      return { blockId: 'b1', reason: 'CatalogueNotFound', message: `No catalogue row for Community access is valid on ${date}. Import the catalogue for that period.`, count: 1, firstDate: date }
    })
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

  it('carries the plan notices, with the way to confirm the registration groups', () => {
    state.current = { data: blockQuote({ notices: [{ code: 'registration-groups-not-confirmed', message: 'Not confirmed.', openQuestion: 1 }] }), isLoading: false, isError: false }
    setUp()
    expect(screen.getByRole('link', { name: 'Confirm in Settings' })).toHaveAttribute('href', '/settings?tab=pricing')
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
