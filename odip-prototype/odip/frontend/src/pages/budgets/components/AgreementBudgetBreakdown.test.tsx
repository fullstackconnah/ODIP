import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TONE } from '@/lib/tone'
import { AgreementBudgetBreakdown, MAX_LINES_SHOWN } from './AgreementBudgetBreakdown'
import { agreementLine, agreementPool, breakdown } from './fixtures'
import type { AgreementBudgetBreakdownView } from './viewModel'
import { AGREEMENT_NO_BUDGET, AGREEMENT_WARNING_ONLY, NO_FIGURE } from './wording'

// The agreement budget bar's comparison. What these tests hold:
//   - each pool the agreement touches is a heading, and each funding period of it is one sentence: "Agreement {cost} against {remaining} left in {period}", then the verdict;
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

    expect(screen.getByRole('alert')).toHaveTextContent('The agreement could not be checked against the budget, so no comparison is shown. The plan can still be saved.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('shows the caller’s own failure sentence when it has one, and no Try again when it cannot ask again', () => {
    renderView({ status: 'failed', failureMessage: 'The pricing engine is busy.', figures: { visible: true }, pools: [], notInARecordedPool: null, outsideThePlan: null })

    expect(screen.getByRole('alert')).toHaveTextContent('The pricing engine is busy.')
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

// The bar is docked at the foot of the screen, so a pool funded monthly (a year of agreement is twelve periods) must not fill it: the first periods are drawn, the rest sit behind a disclosure
// that says how many there are and how many of them are over, and every one of them is still there to open.
describe('AgreementBudgetBreakdown: a pool with many periods', () => {
  const month = (n: number, extra: Partial<Parameters<typeof agreementLine>[0]> = {}) =>
    agreementLine({ periodStart: `2026-${String(n).padStart(2, '0')}-01`, periodEnd: `2026-${String(n).padStart(2, '0')}-28`, cost: 100, remaining: 5000, ...extra })

  it('draws no more than three periods of a pool, and no disclosure at all for a pool with three or fewer', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [month(1), month(2), month(3)] })] }))

    expect(MAX_LINES_SHOWN).toBe(3)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(document.querySelector('details')).toBeNull()
  })

  it('puts the rest behind a disclosure that counts them: all within', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [1, 2, 3, 4, 5].map(n => month(n)) })] }))

    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details).not.toHaveAttribute('open')
    expect(within(details).getByText('2 more periods, all within')).toBeInTheDocument()
    expect(within(details).getAllByRole('listitem')).toHaveLength(2)    // still in the page, behind the disclosure
    expect(within(screen.getByRole('region')).getAllByRole('listitem')).toHaveLength(5)
  })

  it('says how many of the hidden periods are over, so an over period is never out of sight unannounced', () => {
    renderView(breakdown({ pools: [agreementPool({ lines: [1, 2, 3].map(n => month(n)).concat([month(4, { withinLimit: false, overBy: 70, remaining: 30 }), month(5, { withinLimit: false, overBy: 20, remaining: 80 }), month(6)]) })] }))

    const details = document.querySelector('details') as HTMLDetailsElement
    expect(within(details).getByText('3 more periods, 2 over')).toBeInTheDocument()
    // The summary above the pools counts every over period, hidden or not.
    expect(screen.getByRole('region')).toHaveTextContent('2 periods would be over what is left.')
  })

  it('opens with the keyboard like any native disclosure: the summary is the control, named by what it holds', async () => {
    const user = userEvent.setup()
    renderView(breakdown({ pools: [agreementPool({ lines: [1, 2, 3, 4].map(n => month(n)) })] }))

    const summary = screen.getByText('1 more period, all within')
    expect(summary.tagName).toBe('SUMMARY')
    await user.click(summary)
    expect(document.querySelector('details')).toHaveAttribute('open')
  })

  it('counts each pool\'s periods apart: one with few and one with many', () => {
    renderView(breakdown({
      pools: [
        agreementPool({ poolLabel: 'Core', lines: [1, 2, 3, 4].map(n => month(n)) }),
        agreementPool({ poolLabel: 'Improved Daily Living Skills', lines: [month(1), month(2)] }),
      ],
    }))

    expect(document.querySelectorAll('details')).toHaveLength(1)
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
