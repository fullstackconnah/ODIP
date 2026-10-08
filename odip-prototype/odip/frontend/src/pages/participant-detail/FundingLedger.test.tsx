import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LedgerBody } from './FundingLedger'
import { ClaimBudgetBlock as Block } from '@/components/ClaimBudgetBlock'
import { budgetRow, claimBudget, ledgerPeriod, ledgerPool, ledgerRow, noLedger, participantLedger, q2Rows } from '@/test/fixtures/ledger'

// The Funding tab's budget ledger (budget phase 2a): the current period's glance strip, the one sentence per pool, the period strip with its current period marked and its carry named
// as rolled over, the ledger table in its three groups with a row linking to its claim, the plan total, and the no-plan case. Every figure comes from the server: the screen adds
// nothing up, and with no plan it shows no figure at all rather than a zero.

vi.mock('@/api/hooks', () => ({
  useFundingLedger: vi.fn(),
  useFundingLedgerRows: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })),
}))

const renderLedger = (data: ReturnType<typeof participantLedger>) => render(<MemoryRouter><LedgerBody data={data} /></MemoryRouter>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-04T03:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('the glance strip and the sentence', () => {
  it('leads each pool with the current period\'s available, used and forecast, and the status chip in its own tone', () => {
    renderLedger(participantLedger())

    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.getByText('$2,500')).toBeInTheDocument()      // the current period's available
    expect(screen.getByText('$1,680')).toBeInTheDocument()      // used
    expect(screen.getByText('Forecast to 31 Dec')).toBeInTheDocument()
    expect(screen.getByText('$2,640')).toBeInTheDocument()      // the forecast, over the available
    expect(screen.getAllByText('Forecast over').length).toBeGreaterThan(0)
  })

  it('says in one plain sentence what is left of what, to when, and where the booked shifts would take it', () => {
    renderLedger(participantLedger())

    expect(screen.getByText(/^Core: \$820 left of the \$2,500 set aside this period \(to 31 Dec\)/)).toBeInTheDocument()
    expect(screen.getByText(/Booked shifts would finish \$140 over\./)).toBeInTheDocument()
  })

  it('names what was rolled over as rolled over, not confirmed', () => {
    renderLedger(participantLedger())

    // In the cell the roll-over contributes to, with the amount that governs it (F-20, F-21)...
    expect(screen.getAllByText('$2,000 set aside, plus $500 rolled over, not confirmed').length).toBeGreaterThan(0)
    // ...and in the plain-words sentence, so neither place can leave the reader guessing.
    expect(screen.getByText(/, including \$500 rolled over, not confirmed\./)).toBeInTheDocument()
  })

  it('says "of the plan\'s" when the pool has no set-aside', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ hasSetAside: false })] }))

    expect(screen.getByText(/^Core: \$820 left of the plan's \$2,500 this period/)).toBeInTheDocument()
  })

  it('says over, in the danger tone, when what is used is past what is available', () => {
    const over = ledgerPeriod({ available: 4000, remaining: -640, used: 4640, bookedAhead: 360, forecast: 5000, forecastRemaining: -1000, status: 'Over' })
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [over] })] }))

    expect(screen.getByText(/^Core: \$640 over the \$4,000 set aside this period/)).toBeInTheDocument()
    expect(screen.getAllByText('Over').length).toBeGreaterThan(0)
  })
})

describe('the period strip', () => {
  it('gives one cell per period, marking the current one, and shows limit, used and booked in each', () => {
    renderLedger(participantLedger())

    const strip = screen.getByRole('group', { name: /Funding periods of Core/ })
    expect(within(strip).getByText(/1 Oct – 31 Dec 2026/)).toBeInTheDocument()
    expect(within(strip).getByText('· current')).toBeInTheDocument()
    expect(within(strip).getByText('$1,680 used · $960 booked ahead')).toBeInTheDocument()
    // F-20: the governing amount is named in the cell, not only in the sentence above it.
    expect(within(strip).getByText('$2,000 set aside, plus $500 rolled over, not confirmed')).toBeInTheDocument()
    expect(within(strip).getByText('$2,500 available')).toBeInTheDocument()
    expect(within(strip).getAllByRole('button')).toHaveLength(4)
  })

  it('opens another period\'s rows when its cell is chosen', async () => {
    renderLedger(participantLedger())

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /1 Jul – 30 Sep 2026/ }))

    expect(screen.getByText('TC-4301-20260915 · 04_Weekday_STD · 24 h')).toBeInTheDocument()
    expect(screen.queryByText('TC-4301-20261001 · 04_Weekday_STD · 8 h')).not.toBeInTheDocument()
  })
})

describe('the ledger table', () => {
  it('groups the rows into claimed, pending and booked ahead, each row linking to its claim or shift', () => {
    renderLedger(participantLedger())

    expect(screen.getByRole('heading', { name: 'Claimed' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Pending' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Booked ahead' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TC-4301-20261001 · 04_Weekday_STD · 8 h' })).toHaveAttribute('href', '/claims/claim-1')
    // The two booked shifts are named alike; the first is the one from 6 Oct.
    expect(screen.getAllByRole('link', { name: 'Shift 09:00–17:00 · 8 h' })[0]).toHaveAttribute('href', '/rostering?date=2026-10-06')
  })

  it('says there is nothing in a group with no rows, rather than showing an empty table', () => {
    const claimedOnly = ledgerPool({ periods: [ledgerPeriod({ rows: [ledgerRow()], rowCount: 1 })] })
    renderLedger(participantLedger({ pools: [claimedOnly] }))

    // Pending and Booked ahead are both empty, so both say so in their own words.
    expect(screen.getByText(/Claims not sent yet.*Nothing here this period\./)).toBeInTheDocument()
    expect(screen.getByText(/Rostered shifts and confirmed trip bookings.*Nothing here this period\./)).toBeInTheDocument()
    expect(screen.queryByText(/Claim lines sent to the NDIA.*Nothing here this period\./)).not.toBeInTheDocument()
  })

  it('flags past shifts whose day passed unresolved, and says they are counted as pending', () => {
    const period = ledgerPeriod({ rows: q2Rows(), rowCount: 6, pastUnresolvedCount: 2 })
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [period] })] }))

    expect(screen.getByText(/2 past shifts not completed or cancelled, counted as pending\./)).toBeInTheDocument()
  })

  it('flags trips that have started and have no claim yet, and says they are counted as pending', () => {
    const startedTrip = ledgerRow({
      id: 'st1', kind: 'TripBooking', group: 'Pending', date: '2026-10-02', amount: 1440, status: 'Confirmed', link: '/trips/trip-9', description: 'Coastal weekend · 3 days',
      note: 'The trip has started and has no claim yet, so it is counted as pending.',
    })
    const period = ledgerPeriod({ rows: [startedTrip], rowCount: 1, startedUnclaimedTripCount: 2 })
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [period] })] }))

    // Beside the figures, in the warning tone, as past shifts are (the money is in Used and the forecast, but the trip is not claimed or finished).
    expect(screen.getByText(/^2 started trips not claimed yet, counted as pending\./)).toHaveClass('text-[var(--color-on-warning-container)]')
    // And on the row itself, which still links to the trip.
    expect(screen.getByText('The trip has started and has no claim yet, so it is counted as pending.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Coastal weekend · 3 days' })).toHaveAttribute('href', '/trips/trip-9')
  })

  it('says nothing about started trips when there are none', () => {
    renderLedger(participantLedger())

    expect(screen.queryByText(/started trip/)).not.toBeInTheDocument()
  })

  it('names trips in the note under the Pending group, beside claims and shifts', () => {
    renderLedger(participantLedger())

    expect(screen.getByText(/Claims not sent yet.*trips that have started with no claim yet/)).toBeInTheDocument()
  })

  it('names a row the server could not price, so a $0 is never a mystery', () => {
    const unpriced = ledgerRow({ id: 'u1', amount: 0, note: 'No catalogue rate covers this date, so it is counted as $0.' })
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [ledgerPeriod({ rows: [unpriced], rowCount: 1 })] })] }))

    expect(screen.getByText('No catalogue rate covers this date, so it is counted as $0.')).toBeInTheDocument()
  })
})

describe('booked trip days the catalogue cannot price', () => {
  const gappedTrip = ledgerRow({
    id: 't1', kind: 'TripBooking', group: 'BookedAhead', date: '2026-10-23', amount: 1152, status: 'Confirmed', link: '/trips/trip-1',
    description: 'Coastal weekend · 3 days', unpricedTripDayCount: 1,
    note: 'No catalogue rate covers Sunday 25 Oct 2026 (8 h), so that part of the trip is counted as $0.',
  })
  const gapped = ledgerPeriod({ rows: [gappedTrip], rowCount: 1, bookedAhead: 1152, forecast: 1152, unpricedTripDayCount: 1 })

  it('says in the pool sentence that the forecast is low by exactly those days', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [gapped] })] }))

    expect(screen.getByRole('heading', { name: /^Core/ })).toBeInTheDocument()
    expect(screen.getByText(/^Core: \$820 left.*1 booked trip day no catalogue rate covers, so they are counted at \$0/)).toBeInTheDocument()
  })

  it('shows the gap beside the figures, in the warning tone', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [gapped] })] }))

    // Said in the pool sentence AND as its own warning line: the one place a reader may look must never miss it.
    expect(screen.getAllByText(/1 booked trip day no catalogue rate covers/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/^1 booked trip day no catalogue rate covers/)).toHaveClass('text-[var(--color-on-warning-container)]')
  })

  it('names the gap on the booking row itself, with its dates and hours', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [gapped] })] }))

    expect(screen.getByText('No catalogue rate covers Sunday 25 Oct 2026 (8 h), so that part of the trip is counted as $0.')).toBeInTheDocument()
    // The money is exactly what the catalogue priced, with no rate invented for the missing day.
    expect(screen.getByText('$1,152')).toBeInTheDocument()
  })

  it('says nothing at all when every booked day has a rate', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [ledgerPeriod()] })] }))

    expect(screen.queryByText(/no catalogue rate covers/)).not.toBeInTheDocument()
  })
})

describe('the plan total', () => {
  it('shows the same sums over the whole plan against the sum of the limits', () => {
    renderLedger(participantLedger())

    const total = screen.getByText('Plan total').closest('div')!
    expect(within(total).getByText(/\$8,000 across the whole plan · \$3,180 used · \$960 booked ahead · \$4,820 left/)).toBeInTheDocument()
  })
})

describe('no plan, no figure', () => {
  it('says there is nothing to spend against yet and shows no figure at all, never a zero balance', () => {
    renderLedger(noLedger())

    expect(screen.getByText('No budget figures yet')).toBeInTheDocument()
    expect(screen.getByText(/No plan has started/)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('$0')
    expect(screen.queryByText('Plan total')).not.toBeInTheDocument()
  })

  it('says a current plan with no pools is empty rather than absent', () => {
    renderLedger(participantLedger({ planId: 'plan-1', pools: [] }))

    expect(screen.getByText(/This plan has no pools recorded/)).toBeInTheDocument()
  })
})

describe('the claim budget block', () => {
  it('says what a claim uses of a pool and what is left after', () => {
    render(<MemoryRouter><Block budget={claimBudget()} /></MemoryRouter>)

    expect(screen.getByText('Uses $480 of Core (flexible) (1 Oct – 31 Dec 2026); $820 left after.')).toBeInTheDocument()
  })

  it('warns, in the warning tone, and never blocks, when the claim takes the period over', () => {
    render(<MemoryRouter><Block budget={claimBudget([budgetRow({ available: 400, usedBefore: 0, thisClaim: 480, usedAfter: 480, leftAfter: -80, statusAfter: 'Over' })])} /></MemoryRouter>)

    expect(screen.getByText('Uses $480 of Core (flexible) (1 Oct – 31 Dec 2026); $80 over after.')).toHaveClass('text-[var(--color-on-warning-container)]')
    expect(screen.getByText(/never stops a claim being generated/)).toBeInTheDocument()
  })

  it('shows nothing at all when the server left the block out: no plan means no figure, not a zero', () => {
    const { container } = render(<MemoryRouter><Block budget={undefined} /></MemoryRouter>)

    expect(container).toBeEmptyDOMElement()
  })

  it('names each participant of a trip claim and says a part in no pool uses none of the budget', () => {
    render(<MemoryRouter><Block budget={{ participants: [
      { participantId: 'p1', participantName: 'Sophie Brown', rows: [budgetRow()] },
      { participantId: 'p2', participantName: 'Alex Nguyen', rows: [budgetRow({ placement: 'NotInAPool', poolName: 'Not in a recorded pool', thisClaim: 75, available: undefined, usedBefore: undefined, usedAfter: undefined, leftAfter: undefined, statusAfter: undefined })] },
    ] }} /></MemoryRouter>)

    expect(screen.getByText('Sophie Brown')).toBeInTheDocument()
    expect(screen.getByText('Alex Nguyen')).toBeInTheDocument()
    expect(screen.getByText('$75 is not in a recorded pool, so it uses none of the budget.')).toBeInTheDocument()
  })
})
