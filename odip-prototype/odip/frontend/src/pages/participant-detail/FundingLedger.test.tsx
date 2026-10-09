import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { LedgerBody } from './FundingLedger'
import { ClaimBudgetBlock as Block } from '@/components/ClaimBudgetBlock'
import { budgetRow, claimBudget, ledgerBucket, ledgerPeriod, ledgerPool, ledgerRow, noLedger, participantLedger, q2Rows, quarterLedgers } from '@/test/fixtures/ledger'

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

describe('which plan the figures are for', () => {
  it('names the plan by its dates above the figures', () => {
    renderLedger(participantLedger())

    expect(screen.getByText(/^Figures for the plan 1\s+Jul\s+2026\s+–\s+30\s+Jun\s+2027\.$/)).toBeInTheDocument()
  })

  it('says so when that plan has ended, and the figures stay that plan\'s', () => {
    renderLedger(participantLedger({ planIsCurrent: false, planStart: '2025-07-01', planEnd: '2026-06-30' }))

    expect(screen.getByText(/^Figures for the plan 1\s+Jul\s+2025\s+–\s+30\s+Jun\s+2026, which has ended\./)).toBeInTheDocument()
    expect(screen.getByText('Available')).toBeInTheDocument()
  })

  it('says no plan is running between an ended plan and the next, and shows none of the ended plan\'s figures', () => {
    const ended = participantLedger({ planIsCurrent: false, planStart: '2025-10-01', planEnd: '2026-09-30' })
    render(<MemoryRouter><LedgerBody data={ended} nextPlanStart="2026-10-15" /></MemoryRouter>)

    expect(screen.getByText(/No plan is running between 30\s+Sep\s+2026 and 15\s+Oct\s+2026\./)).toBeInTheDocument()
    expect(screen.queryByText('Available')).not.toBeInTheDocument()
    expect(screen.queryByText('Plan total')).not.toBeInTheDocument()
    expect(screen.queryByText(/in the last period/)).not.toBeInTheDocument()
  })

  it('keeps the figures while the plan is running, however many later plans are recorded', () => {
    render(<MemoryRouter><LedgerBody data={participantLedger()} nextPlanStart="2027-07-01" /></MemoryRouter>)

    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.queryByText(/No plan is running/)).not.toBeInTheDocument()
  })

  it('keeps an ended plan\'s figures when no later plan is recorded to start', () => {
    render(<MemoryRouter><LedgerBody data={participantLedger({ planIsCurrent: false, planEnd: '2026-09-30' })} /></MemoryRouter>)

    expect(screen.getByText('Available')).toBeInTheDocument()
    expect(screen.queryByText(/No plan is running/)).not.toBeInTheDocument()
  })
})

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

  it('counts the shifts the claim cannot price yet, names why, and says the figures leave them out', () => {
    const period = ledgerPeriod({ rows: [], rowCount: 0, unpricedShiftCount: 3, unpricedShiftReasons: ['a 1:3 group shift', 'a sleepover'] })
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: [period] })] }))

    // Beside the figures, in the warning tone: they are $0 in every figure above, so the forecast is low by whatever they will cost.
    expect(screen.getByText('3 shifts are not priced yet (a 1:3 group shift and a sleepover), so the figures above leave them out.')).toHaveClass('text-[var(--color-on-warning-container)]')
  })

  it('says nothing about unpriced shifts when every shift is priced', () => {
    renderLedger(participantLedger())

    expect(screen.queryByText(/not priced yet/)).not.toBeInTheDocument()
  })

  it('names, under the ledger, the shifts it does not count yet', () => {
    renderLedger(participantLedger())

    expect(screen.getByText(/shift claims price community access only for now, so sleepover, passive-night and group shifts are not counted yet\./)).toBeInTheDocument()
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

describe('money that fits no pool, or falls outside the plan dates', () => {
  // The plan records only a stated pool, so $7,654.32 of community access fits none: the server sends it in the bucket and says how much (it is the server's own sum).
  const noPool = ledgerBucket([
    ledgerRow({ id: 'n1', date: '2026-10-11', amount: 4500, description: 'TC-4301-20261011 · 04_Weekday_STD · 60 h', link: '/claims/claim-9' }),
    ledgerRow({ id: 'n2', kind: 'CompletedShift', group: 'Pending', date: '2026-10-12', amount: 3154.32, status: 'Completed', description: 'Shift 09:00–17:00 · 8 h', link: '/rostering?date=2026-10-12' }),
  ])
  const outside = ledgerBucket([
    ledgerRow({ id: 'o1', kind: 'FutureShift', group: 'BookedAhead', date: '2027-07-05', amount: 960, status: 'Published', description: 'Shift 09:00–17:00 · 16 h', link: '/rostering?date=2027-07-05' }),
  ])

  it('shows nothing for a bucket with nothing in it', () => {
    renderLedger(participantLedger())

    expect(screen.queryByText('Not in a recorded pool')).not.toBeInTheDocument()
    expect(screen.queryByText('Outside the plan dates')).not.toBeInTheDocument()
  })

  it('shows "Not in a recorded pool" with its amount and its rows, each linking to its claim or shift', () => {
    renderLedger(participantLedger({ notInARecordedPool: noPool }))

    const section = screen.getByRole('heading', { name: 'Not in a recorded pool' }).closest('section')!
    expect(within(section).getByText('$7,654.32')).toBeInTheDocument()           // the server's total for the bucket
    expect(within(section).getByText(/2 items/)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'TC-4301-20261011 · 04_Weekday_STD · 60 h' })).toHaveAttribute('href', '/claims/claim-9')
    expect(within(section).getByRole('link', { name: 'Shift 09:00–17:00 · 8 h' })).toHaveAttribute('href', '/rostering?date=2026-10-12')
    // The rows keep the ledger's own groups, so a reader can tell a claim from an estimate.
    expect(within(section).getByRole('heading', { name: 'Claimed' })).toBeInTheDocument()
    expect(within(section).getByRole('heading', { name: 'Pending' })).toBeInTheDocument()
    expect(within(section).queryByRole('heading', { name: 'Booked ahead' })).not.toBeInTheDocument()
  })

  it('shows "Outside the plan dates" with its amount and rows', () => {
    renderLedger(participantLedger({ outsideThePlanDates: outside }))

    const section = screen.getByRole('heading', { name: 'Outside the plan dates' }).closest('section')!
    expect(within(section).getByText('$960')).toBeInTheDocument()
    expect(within(section).getByText(/1 item\b/)).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Shift 09:00–17:00 · 16 h' })).toHaveAttribute('href', '/rostering?date=2027-07-05')
    expect(screen.queryByText('Not in a recorded pool')).not.toBeInTheDocument()
  })

  it('says plainly that neither bucket is part of any pool\'s figures', () => {
    renderLedger(participantLedger({ notInARecordedPool: noPool, outsideThePlanDates: outside }))

    const notes = screen.getAllByText(/not part of any pool's figures/)
    expect(notes).toHaveLength(2)                 // once in each bucket, in its own words
    expect(screen.getByText(/dated after the plan ends/i)).toBeInTheDocument()
  })

  it('says how many items it is not showing when the server capped the rows', () => {
    renderLedger(participantLedger({ notInARecordedPool: ledgerBucket(noPool.rows, { count: 5, amount: 9000 }) }))

    expect(screen.getByText(/3 more items are not shown here/)).toBeInTheDocument()
    expect(screen.getByText('$9,000')).toBeInTheDocument()
  })

  it('still shows them when the plan has no pool to put them in', () => {
    renderLedger(participantLedger({ pools: [], notInARecordedPool: noPool }))

    expect(screen.getByText(/This plan has no pools recorded/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Not in a recorded pool' })).toBeInTheDocument()
  })
})

describe('the plan total', () => {
  it('shows the same sums over the whole plan against the sum of the limits', () => {
    renderLedger(participantLedger())

    const total = screen.getByText('Plan total').closest('div')!
    expect(within(total).getByText(/\$8,000 across the whole plan · \$3,180 used · \$960 booked ahead · \$4,820 left/)).toBeInTheDocument()
  })

  it('says how many shifts of the plan are not priced yet, since the plan total leaves them out whichever period they are in', () => {
    // None in the current quarter (so the line beside the glance strip is quiet), some in a later one: the plan total is the one whole-plan figure, and it must not read as complete.
    renderLedger(participantLedger({ pools: [ledgerPool({ unpricedShiftCount: 3 })] }))

    const total = screen.getByText('Plan total').closest('div')!
    expect(within(total).getByText('3 shifts are not priced yet, so the figures above leave them out.')).toHaveClass('text-[var(--color-on-warning-container)]')
  })

  it('says nothing about unpriced shifts in the plan total when every shift is priced', () => {
    renderLedger(participantLedger())

    const total = screen.getByText('Plan total').closest('div')!
    expect(within(total).queryByText(/not priced yet/)).not.toBeInTheDocument()
  })
})

describe('unpriced shifts in the period that is opened', () => {
  // The line beside the glance strip is about the period the strip is about. A period opened from the strip that is not that one says its own, with its own reasons, where its rows are.
  const withUnpriced = (index: number, count: number, reasons: string[]) => {
    const periods = quarterLedgers()
    periods[index] = { ...periods[index], unpricedShiftCount: count, unpricedShiftReasons: reasons }
    return periods
  }

  it('says how many shifts of an opened period that is not the current one are not priced yet, and why', async () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: withUnpriced(2, 2, ['a sleepover']) })] }))
    expect(screen.queryByText(/not priced yet/)).not.toBeInTheDocument()   // the current quarter has none, and nothing else is opened yet

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /1 Jan – 31 Mar 2027/ }))

    const rows = screen.getByRole('region', { name: /Ledger rows for 1 Jan – 31 Mar 2027/ })
    expect(within(rows).getByText('2 shifts are not priced yet (a sleepover), so the figures above leave them out.')).toHaveClass('text-[var(--color-on-warning-container)]')
  })

  it('does not repeat the current period\'s warning in its own rows', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ periods: withUnpriced(1, 2, ['a sleepover']) })] }))

    expect(screen.getAllByText('2 shifts are not priced yet (a sleepover), so the figures above leave them out.')).toHaveLength(1)   // beside the glance strip only
  })

  it('does not repeat it either when the plan has ended and the strip is about the last period', () => {
    const ended = withUnpriced(3, 2, ['a sleepover']).map(period => ({ ...period, isCurrent: false }))
    renderLedger(participantLedger({ planIsCurrent: false, pools: [ledgerPool({ periods: ended })] }))

    expect(screen.getAllByText('2 shifts are not priced yet (a sleepover), so the figures above leave them out.')).toHaveLength(1)
  })
})

// Budget phase 2b: the NDIA's own word that a pool has run out. A provider cannot see a participant's budget in the NDIA's portal, so a claim refused with V17, V18, V27 or V28 is the only direct sign.
describe('the NDIA rejecting a claim for want of funds', () => {
  const rejection = { date: '2026-10-08', code: 'V27', claimId: 'claim-9', claimReference: 'CLM-0009' }

  it('says it on the pool the claim belongs to, with the day and the code, and links to the claim', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ ndiaRejection: rejection })] }))

    const note = screen.getByText(/NDIA rejected a claim on/)
    expect(note).toHaveTextContent('NDIA rejected a claim on 8 Oct 2026: not enough funds (V27). Claim CLM-0009')
    expect(within(note).getByRole('link', { name: 'Claim CLM-0009' })).toHaveAttribute('href', '/claims/claim-9')
  })

  it('is in words and in the danger tone with a mark that is not colour, and carries no money', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ ndiaRejection: rejection })] }))

    const note = screen.getByText(/NDIA rejected a claim on/).closest('p')!
    expect(note).toHaveClass('bg-[var(--color-error-container)]')
    expect(note.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(note.textContent).not.toMatch(/\$/)
  })

  it('says it once per pool that has it, and not on a pool that has not', () => {
    renderLedger(participantLedger({
      pools: [ledgerPool({ id: 'pool-a', name: 'Core', ndiaRejection: rejection }), ledgerPool({ id: 'pool-b', name: 'Improved Daily Living Skills' })],
    }))

    expect(screen.getAllByText(/NDIA rejected a claim on/)).toHaveLength(1)
  })

  // ODIP's arithmetic says fine and the NDIA has just refused a claim for want of funds: the one case this feature exists to catch. The note used to be the last and smallest thing in the card, under
  // an On track chip three times over.
  it('puts the note directly under the pool title, above the figures, so it is the first thing said about the pool', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ ndiaRejection: rejection })] }))

    const note = screen.getByText(/NDIA rejected a claim on/).closest('p')!
    expect(note.compareDocumentPosition(screen.getByText('Available')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(screen.getByText(content => content.includes(' this period (to '))) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('wears a danger pill in the title row beside the status chip, in the label the alert has', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ ndiaRejection: rejection })] }))

    const pill = screen.getByText('NDIA says the funds ran out')
    const row = pill.parentElement!
    expect(pill).toHaveClass('bg-[var(--color-error-container)]')
    expect(within(row).getByText('Forecast over')).toBeInTheDocument()   // ODIP's own word stays (the fixture's pool is forecast to go over): it is ODIP's arithmetic, and the NDIA's is beside it
  })

  it('says whose figures they are when the NDIA has spoken: ODIP\'s own', () => {
    renderLedger(participantLedger({ pools: [ledgerPool({ ndiaRejection: rejection })] }))

    expect(screen.getByText(/^Core, by ODIP's figures: /)).toBeInTheDocument()
  })

  it('has neither the pill nor that lead-in on a pool the NDIA has said nothing about', () => {
    renderLedger(participantLedger())

    expect(screen.queryByText('NDIA says the funds ran out')).not.toBeInTheDocument()
    expect(screen.queryByText(/by ODIP's figures/)).not.toBeInTheDocument()
  })

  it('prints the status word once in the glance strip: the chip was beside the same word', () => {
    renderLedger(participantLedger())

    // The glance strip's label (the ledger table below has a Status column header of its own); the label sits in a div under the cell.
    const label = screen.getAllByText('Status').find(element => element.closest('div')?.className.includes('order-2'))!
    const cell = label.closest('div')!.parentElement!
    expect(cell.textContent?.match(/Forecast over/g)).toHaveLength(1)
  })

  it('says nothing of the NDIA when the server sent no rejection for the pool', () => {
    renderLedger(participantLedger())

    expect(document.body).not.toHaveTextContent('NDIA rejected')
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
