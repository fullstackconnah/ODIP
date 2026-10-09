import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TONE } from '@/lib/tone'
import { AgreementBudgetBreakdown } from './AgreementBudgetBreakdown'
import { agreementLine, agreementPool, breakdown } from './fixtures'
import type { AgreementBudgetBreakdownView } from './viewModel'
import { AGREEMENT_NO_BUDGET, AGREEMENT_WARNING_ONLY, NO_FIGURE } from './wording'

// The agreement budget bar's comparison. What these tests hold:
//   - each pool the agreement touches is a heading, and each funding period of it is one sentence: "Agreement {cost} against {remaining} left in {period}", then the verdict; a pool that spans several
//     periods gets ONE line in the dock (what the agreement costs there, in how many periods it is over, by how much in all) and the sentences behind a disclosure;
//   - over and within are told apart in words as well as in tone, and over is a WARNING ONLY: nothing in the component can block anything;
//   - the commonest state, no budget recorded, links to where one is recorded and never warns;
//   - loading and failed are never drawn as an answer, and a zero is a figure while a missing figure is a dash.

const renderView = (view: AgreementBudgetBreakdownView) => render(<MemoryRouter><AgreementBudgetBreakdown view={view} /></MemoryRouter>)
const dollarsIn = (element: HTMLElement) => element.outerHTML.match(/\$[\d,]+(?:\.\d{2})?/g) ?? []

describe('AgreementBudgetBreakdown: the states that are not an answer', () => {
  it('says the check is under way, and states no figure', () => {
    renderView({ status: 'loading', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null })

    expect(screen.getByText('Checking the agreement against the participant’s budget…')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()   // the bar has one polite status and nothing else in it is live
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('says the check could not be read, says the plan can still be saved, and offers to ask again', async () => {
    const onRetry = vi.fn()
    renderView({ status: 'failed', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null, onRetry })

    expect(screen.getByText('The agreement could not be checked against the budget, so no comparison is shown. The plan can still be saved.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  // An advisory check that fails (a 429, a network blip) must not interrupt a person typing in a block, each time it recurs: the bar has ONE polite status and says it there, once.
  it('does not announce a failed check by itself: it is a plain note, and the bar’s one polite status says it', () => {
    renderView({ status: 'failed', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null, onRetry: vi.fn() })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-live]')).toBeNull()
  })

  it('shows the caller’s own failure sentence when it has one, and no Try again when it cannot ask again', () => {
    renderView({ status: 'failed', failureMessage: 'The pricing engine is busy.', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null })

    expect(screen.getByText('The pricing engine is busy.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says no budget is recorded, links to where one is recorded, and never warns', () => {
    renderView({
      status: 'none', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null,
      noBudgetAction: { label: 'Open the Funding tab', to: '/participants/p-1?tab=funding' },
    })

    expect(screen.getByText(AGREEMENT_NO_BUDGET)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the Funding tab' })).toHaveAttribute('href', '/participants/p-1?tab=funding')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  // The spec's sentence stays ("No budget recorded for this participant ..."), and for a plan that ended it says so, as the Funding tab shows that plan: it must not read as if none was ever recorded.
  it('says the recorded plan ended, and when, after the same words, and offers to record a new plan', () => {
    renderView({
      status: 'none', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null, noBudgetReason: 'PlanEnded', planEnd: '2026-06-30',
      noBudgetAction: { label: 'Record a new plan', to: '/participants/p-1?tab=funding' },
    })

    expect(screen.getByText('No budget recorded for this participant: the recorded plan ended on 30 Jun 2026, so there is nothing to compare the agreement against.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Record a new plan' })).toHaveAttribute('href', '/participants/p-1?tab=funding')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says no budget is recorded without a link when there is nowhere to point', () => {
    renderView({ status: 'none', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null })

    expect(screen.getByText(AGREEMENT_NO_BUDGET)).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('AgreementBudgetBreakdown: an agreement that fits', () => {
  it('says what the agreement costs against what is left in the period, and that it is within', () => {
    renderView(breakdown())

    const region = screen.getByRole('region', { name: 'Agreement against the participant\'s budget' })
    expect(within(region).getByText('Core')).toBeInTheDocument()
    expect(region).toHaveTextContent('Agreement $2,355.50 against $3,120.00 left in 1 Oct – 31 Dec 2026')
    expect(within(region).getByText('Within')).toBeInTheDocument()
    expect(region).not.toHaveTextContent('Over by')
    expect(region).not.toHaveTextContent(AGREEMENT_WARNING_ONLY)   // nothing to warn about, so no warning sentence
  })

  it('does not tint a line that fits', () => {
    renderView(breakdown())

    const line = screen.getByText('Within').closest('li')!
    expect(line.className).not.toContain(TONE.warning.solid)
  })

  it('treats a period with exactly nothing left as a figure, $0.00, and not as a missing one', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: 0, remaining: 0 })] })] }))

    expect(screen.getByRole('region')).toHaveTextContent('Agreement $0.00 against $0.00 left')
    expect(screen.getByRole('region')).not.toHaveTextContent('Not available')   // (the en dash is also the period's own range mark, so the sr-only words are what tell a missing figure apart)
  })
})

describe('AgreementBudgetBreakdown: an agreement that does not fit', () => {
  const over = () => breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: 2355.5, remaining: 1667, withinLimit: false, overBy: 688.5 })] })] })

  it('says by how much, in words, and tints the line in the warning tone', () => {
    renderView(over())

    const verdict = screen.getByText(/^Over by/)
    expect(verdict).toHaveTextContent('Over by $688.50')
    expect(verdict.closest('li')!.className).toContain('var(--color-warning-container)')
    expect(screen.getByRole('region')).toHaveTextContent('Agreement $2,355.50 against $1,667.00 left in 1 Oct – 31 Dec 2026')
  })

  // A period that is over before the agreement has less than nothing "left": "against -$1,563.21 left" is hard to parse and states two different overs. The Funding tab never prints a minus; it says "$X over".
  it('says nothing is left, and how far over the period already is, instead of printing a negative amount', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: 21363.1, remaining: -1563.21, withinLimit: false, overBy: 22926.31 })] })] }))

    const region = screen.getByRole('region')
    expect(region).toHaveTextContent('Agreement $21,363.10 in 1 Oct – 31 Dec 2026; nothing left (already $1,563.21 over)')
    expect(region).toHaveTextContent('Over by $22,926.31')   // the verdict stays
    expect(region.textContent).not.toMatch(/-\$|−\$|against/)
  })

  it('still says what is left when it is exactly nothing: a zero is a figure, not a negative', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: 100, remaining: 0, withinLimit: false, overBy: 100 })] })] }))

    expect(screen.getByRole('region')).toHaveTextContent('Agreement $100.00 against $0.00 left in 1 Oct – 31 Dec 2026')
  })

  it('says it is a warning only: the plan can still be saved and approved', () => {
    renderView(over())

    expect(screen.getByRole('region')).toHaveTextContent(`One period would be over what is left. ${AGREEMENT_WARNING_ONLY}`)
  })

  it('counts the periods that would be over, across pools', () => {
    renderView(breakdown({
      pools: [
        agreementPool({ poolLabel: 'Core', lines: [agreementLine({ withinLimit: false, overBy: 10 }), agreementLine({ periodStart: '2027-01-01', periodEnd: '2027-03-31' })] }),
        agreementPool({ poolLabel: 'Improved Daily Living Skills', lines: [agreementLine({ withinLimit: false, overBy: 20 })] }),
      ],
    }))

    expect(screen.getByRole('region')).toHaveTextContent('2 periods would be over what is left.')
  })

  it('cannot block anything: no button, no disabled control, only the sentence', () => {
    renderView(over())

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(document.querySelector('[disabled]')).toBeNull()
  })
})

describe('AgreementBudgetBreakdown: several pools and periods', () => {
  it('lists a pool once, with each of its periods in the order given', () => {
    renderView(breakdown({
      pools: [
        agreementPool({ poolLabel: 'Core', lines: [agreementLine(), agreementLine({ periodStart: '2027-01-01', periodEnd: '2027-03-31', cost: 1000, remaining: 5000 })] }),
        agreementPool({ poolLabel: 'Improved Daily Living Skills', lines: [agreementLine({ cost: 300, remaining: 400 })] }),
      ],
    }))

    expect(screen.getAllByText('Core')).toHaveLength(1)
    const lines = screen.getAllByRole('listitem')
    expect(lines[0]).toHaveTextContent('1 Oct – 31 Dec 2026')
    expect(lines[1]).toHaveTextContent('1 Jan – 31 Mar 2027')
    expect(lines[2]).toHaveTextContent('Agreement $300.00 against $400.00')
    expect(screen.getByText('Improved Daily Living Skills')).toBeInTheDocument()
  })

  it('names the pool for a screen reader on every line, since the lines are read apart from their heading', () => {
    renderView(breakdown())

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Core, Agreement')
  })
})

// The bar is docked at the foot of the screen, so a pool that spans several funding periods (a plan funded monthly is twelve) must not fill it: the dock gets ONE line for the pool (what the agreement
// costs there, in how many periods it would be over, by how much in all), and the sentence for every period sits behind a disclosure that is still in the page.
describe('AgreementBudgetBreakdown: a pool with several periods', () => {
  const month = (n: number, extra: Partial<Parameters<typeof agreementLine>[0]> = {}) =>
    agreementLine({ periodStart: `2026-${String(n).padStart(2, '0')}-01`, periodEnd: `2026-${String(n).padStart(2, '0')}-28`, cost: 100, remaining: 5000, ...extra })

  it('gives a pool of one period its sentence and no disclosure: the dock stays as small as it can', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [month(1)] })] }))

    expect(document.querySelector('details')).toBeNull()
    expect(screen.getByRole('region')).toHaveTextContent('Agreement $100.00 against $5,000.00 left in')
    expect(screen.getByRole('region')).not.toHaveTextContent('across')
  })

  it('gives a pool of several periods one line that says it is within in all of them', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [1, 2, 3, 4].map(n => month(n)) })] }))

    const pool = screen.getByRole('group', { name: 'Core' })
    expect(pool).toHaveTextContent('Agreement $400.00 across 4 periods')
    expect(pool).toHaveTextContent('Within in all 4 periods')
    expect(pool).not.toHaveTextContent('Over')
  })

  it('says in how many periods it is over, and by how much in all (the server’s sum), in words and not by colour alone', () => {
    const lines = [month(1, { withinLimit: false, overBy: 7000.5, remaining: -6900.5 }), month(2, { withinLimit: false, overBy: 100, remaining: 0 }), month(3), month(4)]
    renderView(breakdown({ pools: [agreementPool({ lines })] }))

    const pool = screen.getByRole('group', { name: 'Core' })
    expect(pool).toHaveTextContent('Over in 2 of 4 periods, $7,100.50 in all')
    expect(pool).toHaveTextContent('Agreement $400.00 across 4 periods')
  })

  it('keeps every period’s sentence behind a native disclosure that is closed, named by what it holds, and still in the page', async () => {
    const user = userEvent.setup()
    renderView(breakdown({ pools: [agreementPool({ lines: [1, 2, 3].map(n => month(n)) })] }))

    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details).not.toHaveAttribute('open')
    const summary = within(details).getByText('Each of the 3 periods')
    expect(summary.tagName).toBe('SUMMARY')
    expect(within(details).getAllByRole('listitem')).toHaveLength(3)
    await user.click(summary)
    expect(details).toHaveAttribute('open')
  })

  it('counts the periods that would be over across every pool, hidden behind a disclosure or not, in the sentence at the foot', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [1, 2, 3].map(n => month(n)).concat([month(4, { withinLimit: false, overBy: 70, remaining: 30 }), month(5, { withinLimit: false, overBy: 20, remaining: 80 })]) })] }))

    expect(screen.getByRole('region')).toHaveTextContent('2 periods would be over what is left.')
  })

  it('treats each pool on its own: one with several periods and one with a single period', () => {
    renderView(breakdown({
      pools: [
        agreementPool({ poolLabel: 'Core', lines: [1, 2, 3, 4].map(n => month(n)) }),
        agreementPool({ poolLabel: 'Improved Daily Living Skills', lines: [month(1)] }),
      ],
    }))

    expect(document.querySelectorAll('details')).toHaveLength(1)
    expect(screen.getByRole('group', { name: 'Improved Daily Living Skills' })).toHaveTextContent('Agreement $100.00 against $5,000.00 left in')
  })

  it('withholds the amounts of the one line from a viewer who may not see them, as it does everywhere', () => {
    const lines = [month(1, { withinLimit: false, overBy: 70, remaining: 30 }), month(2)]
    const { container } = renderView(breakdown({ figures: { visible: false, reason: 'Budget figures are for coordinators and administrators.' }, pools: [agreementPool({ lines, cost: 200, overBy: 70 })] }))

    expect(dollarsIn(container)).toEqual([])
    expect(screen.getByRole('group', { name: 'Core' })).toHaveTextContent('Over in 1 of 2 periods')
  })
})

describe('AgreementBudgetBreakdown: what falls outside the pools', () => {
  it('says how much has no recorded pool, and how much is delivered outside the plan’s dates, and never drops either', () => {
    renderView(breakdown({ notInARecordedPool: 588.64, outsideThePlan: 294.32 }))

    expect(screen.getByRole('region')).toHaveTextContent('$588.64 of the agreement is in no pool the plan records, so it is not compared.')
    expect(screen.getByRole('region')).toHaveTextContent('$294.32 of the agreement is delivered outside the plan’s dates, so it is not compared.')
  })

  it('says nothing about them when there is none', () => {
    renderView(breakdown({ notInARecordedPool: 0, outsideThePlan: null }))

    expect(screen.getByRole('region')).not.toHaveTextContent('no pool the plan records')
    expect(screen.getByRole('region')).not.toHaveTextContent('outside the plan')
  })

  it('says there is nothing to compare when the agreement is priced against no pool at all', () => {
    renderView(breakdown({ pools: [] }))

    expect(screen.getByRole('region')).toHaveTextContent('Nothing in the agreement is priced against a pool yet, so there is nothing to compare.')
  })

  it('does not say that when the whole agreement is in a bucket: the bucket is the explanation', () => {
    renderView(breakdown({ pools: [], notInARecordedPool: 100 }))

    expect(screen.getByRole('region')).not.toHaveTextContent('Nothing in the agreement is priced')
    expect(screen.getByRole('region')).toHaveTextContent('$100.00 of the agreement is in no pool the plan records')
  })
})

describe('AgreementBudgetBreakdown: the privacy contract and unknown figures', () => {
  it('withholds every amount from a viewer who may not see them, in the text and in every attribute', () => {
    const hidden = breakdown({
      figures: { visible: false, reason: 'Budget figures are for coordinators and administrators.' },
      pools: [agreementPool({ lines: [agreementLine({ cost: 123456.78, remaining: 90, withinLimit: false, overBy: 123366.78 })] })],
      notInARecordedPool: 4321.09,
    })
    const { container } = renderView(hidden)

    expect(dollarsIn(container)).toEqual([])
    expect(container.innerHTML).not.toContain('123456')
    expect(container.innerHTML).not.toContain('4321')
    expect(screen.getByRole('region')).toHaveTextContent('Over by an amount not shown here')
  })

  it('draws an unknown figure as a dash that a screen reader hears as not available, never $0.00', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: null })] })] }))

    const line = screen.getByRole('listitem')
    expect(line).toHaveTextContent(NO_FIGURE)
    expect(line).toHaveTextContent('Not available.')
    expect(dollarsIn(line).filter(d => d === '$0.00')).toEqual([])
  })
})

describe('AgreementBudgetBreakdown: a newer answer on its way', () => {
  it('marks the region busy and says so, while the last answer stays on screen', () => {
    renderView(breakdown({ refreshing: true }))

    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('region')).toHaveTextContent('Updating…')
    expect(screen.getByRole('region')).toHaveTextContent('Agreement $2,355.50')
  })

  it('is not busy when nothing is on its way', () => {
    renderView(breakdown())

    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('region')).not.toHaveTextContent('Updating…')
  })
})
