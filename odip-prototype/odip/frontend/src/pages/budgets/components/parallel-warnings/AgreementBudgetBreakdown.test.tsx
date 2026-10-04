import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AgreementBudgetBreakdown } from './AgreementBudgetBreakdown'
import { agreementLine, breakdown } from './fixtures'
import type { AgreementBudgetBreakdownView } from './viewModel'
import { NO_FIGURE, agreementLineSentence } from './wording'

// The agreement budget breakdown. What it must hold:
//   - committed (signed/saved) and forecast are two different figures and are never added together or shown as one;
//   - the recorded provider set-aside and the whole-plan amount are two different figures, only ONE of which is the limit, and the limit is
//     the server's choice (set-aside when recorded, else plan amount);
//   - an unquantifiable forecast is a dash with a reason, never a zero;
//   - a failed or empty check never blocks anything, and says the plan can still be saved;
//   - the privacy contract withholds every amount together, with no figure left in any attribute.

const renderBreakdown = (view: AgreementBudgetBreakdownView) =>
  render(<MemoryRouter><AgreementBudgetBreakdown view={view} /></MemoryRouter>)

const figuresIn = (element: HTMLElement) => (element.outerHTML.match(/\$[\d,]+(?:\.\d{2})?/g) ?? [])

/**
 * The fields of a line, looked up within THIS render's own container. Reading from `document` (what `screen` does) would find an earlier
 * test's still-mounted breakdown first, since these tests render several per file and the pool label repeats.
 */
function fieldsOf(view: AgreementBudgetBreakdownView, poolLabel = 'Core (flexible)') {
  const { container } = renderBreakdown(view)
  const item = within(container).getByText(poolLabel).closest('li')!
  const dl = item.querySelector('dl')!
  const fields: Record<string, string> = {}
  for (const dt of Array.from(dl.querySelectorAll('dt'))) {
    const dd = dt.nextElementSibling as HTMLElement
    // Everything a sighted user SEES: a `.sr-only` note is for assistive tech alone, and including it would double every field's text.
    const visible = Array.from(dd.querySelectorAll('*'))
      .filter(el => !el.classList.contains('sr-only'))
      .map(el => el.textContent ?? '')
      .join('')
    fields[dt.textContent ?? ''] = (visible || dd.textContent || '').trim()
  }
  return { container, item, fields }
}

describe('AgreementBudgetBreakdown: the states that are not figures', () => {
  it('says it is checking, and shows no figure at all while it does', () => {
    const { container } = renderBreakdown(breakdown({ status: 'loading' }))

    expect(screen.getByRole('status')).toHaveTextContent('Checking the agreement against the participant')
    expect(figuresIn(container)).toEqual([])
  })

  it('a failed check is a warning, never an error, and says the plan can still be saved', () => {
    renderBreakdown(breakdown({ status: 'failed', failureMessage: 'The agreement check did not answer.' }))

    // A warning tone, not danger: nothing here is a failure of the plan, and the check has no power to refuse it.
    const callout = screen.getByRole('alert')
    expect(callout).toHaveTextContent('The agreement check did not answer.')
    expect(callout.className).toContain('var(--color-warning-container)')
    expect(callout.className).not.toContain('var(--color-destructive)')
    expect(screen.queryByText(/cannot be saved|will be refused|blocked/i)).not.toBeInTheDocument()
  })

  it('keeps its own wording for a failure nobody explained, still offering the save', () => {
    renderBreakdown(breakdown({ status: 'failed', failureMessage: undefined }))

    expect(screen.getByRole('alert')).toHaveTextContent('The plan can still be saved.')
  })

  it('says no budget recorded, links to where one is recorded, and never warns', () => {
    renderBreakdown(breakdown({ lines: [], noBudgetAction: { label: 'Record the plan budget', to: '/participants/participant-1?tab=funding' } }))

    expect(screen.getByText(/No budget recorded for this participant/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Record the plan budget' })).toHaveAttribute('href', '/participants/participant-1?tab=funding')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/warning only/i)).not.toBeInTheDocument()
    // SHAPE-BRIEF 5 makes this state a MANDATORY quiet one, so the tone is asserted and not merely described: a warning or
    // error fill on this state is a regression the words above would never catch (M13). Both container tokens are rejected,
    // and so is the danger ink, because a tint is not the only way to make a quiet state look loud.
    const quiet = screen.getByText(/No budget recorded for this participant/).closest('div')!
    expect(quiet.className).not.toContain('var(--color-warning-container)')
    expect(quiet.className).not.toContain('var(--color-error-container)')
    expect(quiet.className).not.toContain('var(--color-destructive)')
  })

  it('a failed check keeps the whole plan available: there is no control here that can refuse a save', () => {
    const { container } = renderBreakdown(breakdown({ status: 'failed' }))

    expect(container.querySelectorAll('button, a')).toHaveLength(0)
  })
})

describe('AgreementBudgetBreakdown: committed, forecast and available stay three figures', () => {
  it('names the three figures separately and never prints a sum of them', () => {
    const { fields } = fieldsOf(breakdown())   // committed 860, forecast 1040, set-aside 1200, plan 2000

    expect(fields['Signed or committed']).toBe('$860.00')
    expect(fields['Forecast of this agreement']).toBe('$1,040.00')
    expect(fields['Available: set aside for us']).toBe('$1,200.00')
    expect(fields['Whole plan amount for this pool']).toBe('$2,000.00')
    // 860 + 1040 = 1900 appears nowhere: adding them is the conflation this component exists to prevent.
    expect(Object.values(fields)).not.toContain('$1,900.00')
  })

  it('says the forecast is an estimate, so nobody reads it as signed money', () => {
    const { item, fields } = fieldsOf(breakdown())

    expect(fields['Forecast of this agreement']).toBe('$1,040.00')
    expect(item).toHaveTextContent('An estimate, not a signed figure.')
    expect(item).not.toHaveTextContent('A signed figure')
  })

  it('marks the set-aside as the limit, and labels the plan amount as the other figure', () => {
    const { item } = fieldsOf(breakdown())

    expect(item).toHaveTextContent('Available: set aside for us')
    expect(item).toHaveTextContent('Whole plan amount for this pool')
    expect(item).not.toHaveTextContent('Available: whole plan amount')   // not both, at once
  })

  it('falls back to the whole plan amount as the limit when no set-aside is recorded, and says why', () => {
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: null, limitSource: 'planAmount' }, committed: 860, forecast: 1040 })
    const { item, fields } = fieldsOf(breakdown({ lines: [line] }))

    expect(fields['Available: whole plan amount']).toContain('$2,000.00')
    expect(item).toHaveTextContent('Set aside for us')
    // The sentence is what stops a reader assuming the plan amount and the set-aside are alternatives: it names which one is the limit.
    expect(item).toHaveTextContent('No set-aside is recorded, so the whole plan amount is the limit.')
  })

  it('treats a set-aside of exactly zero as a recorded zero, not as a missing one', () => {
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: 0, limitSource: 'setAside' } })
    const { fields } = fieldsOf(breakdown({ lines: [line] }))

    expect(fields['Available: set aside for us']).toBe('$0.00')
    expect(fields['Available: set aside for us']).not.toContain(NO_FIGURE)
  })

  it('every figure in one line is that line’s own, and no line borrows another’s', () => {
    const other = agreementLine({ poolLabel: 'Improved Daily Living Skills', committed: 100, forecast: 250, withinLimit: true, overBy: null })
    const { container } = renderBreakdown(breakdown({ lines: [agreementLine(), other] }))
    const items = within(container).getAllByRole('listitem')

    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('$860.00')
    expect(items[0].textContent).not.toContain('$250.00')
    expect(items[1].textContent).toContain('$250.00')
    expect(items[1].textContent).not.toContain('$860.00')
  })
})

describe('AgreementBudgetBreakdown: within and over', () => {
  it('says it is within, in its own words, and does not take a warning tint', () => {
    const { item } = fieldsOf(breakdown())

    expect(item).toHaveTextContent(agreementLineSentence({ within: true, overBy: '', periodLabel: '1 Jul – 30 Sep 2026' }))
    expect(item.className).not.toContain('var(--color-warning-container)')
  })

  it('says how far over, with the figure, and takes the warning tint', () => {
    const line = agreementLine({ committed: 1500, forecast: 1900, withinLimit: false, overBy: 700 })
    const { item } = fieldsOf(breakdown({ lines: [line] }))

    expect(item).toHaveTextContent('Over by $700.00 for 1 Jul – 30 Sep 2026.')
    expect(item.className).toContain('var(--color-warning-container)')
  })

  it('names the period on the line, across a year boundary in full', () => {
    const line = agreementLine({ periodStart: '2026-07-01', periodEnd: '2027-06-30' })
    const { item } = fieldsOf(breakdown({ lines: [line] }))

    expect(item).toHaveTextContent('1 Jul 2026 – 30 Jun 2027')
  })

  it('says the total is a warning only, in every mode, and that nothing is blocked', () => {
    const lines = [
      agreementLine({ poolLabel: 'Core (flexible)', withinLimit: false, overBy: 700 }),
      agreementLine({ poolLabel: 'Improved Daily Living Skills', withinLimit: false, overBy: 40 }),
      agreementLine({ poolLabel: 'Another Pool', withinLimit: true }),
    ]
    const { container } = renderBreakdown(breakdown({ lines }))

    // The count sentence and the "warning only" rule are asserted on the container's text, not by role: the icon between them splits the
    // sentence across nodes, and what matters is that both halves are on screen together.
    expect(container.textContent).toMatch(/2 pools and periods\s+would be over the available funds/)
    expect(container.textContent).toContain('warning only: the agreement can still be saved and approved, in every mode')
  })

  it('agrees the noun with one over line', () => {
    renderBreakdown(breakdown({ lines: [agreementLine({ withinLimit: false, overBy: 1 })] }))

    expect(screen.getByText(/1 pool and period would be over/)).toBeInTheDocument()
  })

  it('says nothing about a total when every line is within', () => {
    const { container } = renderBreakdown(breakdown({ lines: [agreementLine()] }))

    expect(container.textContent).not.toMatch(/would be over/)
  })
})

describe('AgreementBudgetBreakdown: the set-aside and the plan amount are independent figures', () => {
  // Owner decision 1 says which figure is the LIMIT, not which figure exists. The server may record a set-aside and still take
  // the limit from the whole plan amount, so the other figure must be drawn from its OWN value. Branching on which figure
  // supplied the limit printed a recorded amount as the missing-figure dash, so a known figure read as unknown (QA-1).
  it('shows a recorded set-aside as its own figure even when the plan amount is the limit', () => {
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: 500, limitSource: 'planAmount' } })
    const { fields } = fieldsOf(breakdown({ lines: [line] }))

    // The figure the server actually sent. Before the fix this field was the en dash.
    expect(fields['Set aside for us']).toBe('$500.00')
    expect(fields['Set aside for us']).not.toContain(NO_FIGURE)
    // The limit line is unchanged: the server's decision about which figure is the limit is still obeyed. toContain, because this
    // field also carries the sentence naming which figure is the limit, exactly as the pre-existing fallback test asserts it.
    expect(fields['Available: whole plan amount']).toContain('$2,000.00')
  })

  it('does not claim no set-aside is recorded while showing one', () => {
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: 500, limitSource: 'planAmount' } })
    const { item } = fieldsOf(breakdown({ lines: [line] }))

    expect(item).toHaveTextContent('A set-aside is recorded, and the whole plan amount is the limit.')
    expect(item).not.toHaveTextContent('No set-aside is recorded')
  })

  it('still says no set-aside is recorded when there genuinely is none', () => {
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: null, limitSource: 'planAmount' } })
    const { item, fields } = fieldsOf(breakdown({ lines: [line] }))

    expect(item).toHaveTextContent('No set-aside is recorded, so the whole plan amount is the limit.')
    expect(fields['Set aside for us']).toBe(NO_FIGURE)
  })

  it('a set-aside of exactly zero beside the plan-amount limit is a recorded $0.00, not a dash', () => {
    // null is "not recorded" and 0 is "recorded as nothing". Only the value decides which is which.
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: 0, limitSource: 'planAmount' } })
    const { fields } = fieldsOf(breakdown({ lines: [line] }))

    expect(fields['Set aside for us']).toBe('$0.00')
    expect(fields['Available: whole plan amount']).toContain('$2,000.00')
  })

  it('the mirror case still holds: a recorded plan amount beside the set-aside limit is shown', () => {
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: 1200, limitSource: 'setAside' } })
    const { fields } = fieldsOf(breakdown({ lines: [line] }))

    expect(fields['Available: set aside for us']).toBe('$1,200.00')
    expect(fields['Whole plan amount for this pool']).toBe('$2,000.00')
  })

  it('withholds both allowance figures together when the viewer may not see money', () => {
    const hidden = { visible: false as const, reason: 'This role may act on the agreement but not see what it costs against the budget.' }
    const line = agreementLine({ allowance: { planAmount: 2000, setAside: 500, limitSource: 'planAmount' } })
    const { container } = renderBreakdown(breakdown({ lines: [line], figures: hidden }))

    // The privacy contract is checked BEFORE the nullness branch, so a withheld figure can never become a dash either.
    expect(container.textContent).toContain('Not shown')
    expect(figuresIn(container)).toEqual([])
    expect(container.innerHTML).not.toContain('500.00')
    expect(container.innerHTML).not.toContain('2,000.00')
  })
})

describe('AgreementBudgetBreakdown: what could not be computed', () => {
  it('a null forecast is a dash with "Not available" for a screen reader, never $0.00', () => {
    const { item, fields } = fieldsOf(breakdown({ lines: [agreementLine({ committed: 860, forecast: null })] }))

    expect(fields['Forecast of this agreement']).toBe(NO_FIGURE)
    expect(item).toHaveTextContent('Not available.')      // the screen-reader sentence is real text in the DOM
    expect(item).not.toHaveTextContent('over by $0')
  })

  it('says up front that a dash is a missing figure and not a zero', () => {
    renderBreakdown(breakdown({ lines: [agreementLine({ forecast: null })] }))

    expect(screen.getByText(/A dash is a figure the server could not give: it is not zero\./)).toBeInTheDocument()
  })

  it('a null committed figure does not turn the line into an over line on its own', () => {
    const { item } = fieldsOf(breakdown({ lines: [agreementLine({ committed: null, forecast: 500, withinLimit: true, overBy: null })] }))

    expect(item).toHaveTextContent('Within the limit')
    expect(item.className).not.toContain('var(--color-warning-container)')
  })

  it('a null plan amount beside a recorded set-aside is a dash for the plan line, and the set-aside still stands', () => {
    const line = agreementLine({ allowance: { planAmount: null, setAside: 1200, limitSource: 'setAside' } })
    const { fields } = fieldsOf(breakdown({ lines: [line] }))

    expect(fields['Whole plan amount for this pool']).toBe(NO_FIGURE)
    expect(fields['Available: set aside for us']).toBe('$1,200.00')
  })
})

describe('AgreementBudgetBreakdown: the privacy contract', () => {
  const hidden = { visible: false as const, reason: 'This role may act on the agreement but not see what it costs against the budget.' }

  it('withholds every amount, with no figure anywhere in the markup', () => {
    const line = agreementLine({ committed: 987_654.32, forecast: 1_234_567.89, withinLimit: false, overBy: 111_111.11 })
    const { container } = renderBreakdown(breakdown({ lines: [line], figures: hidden }))

    expect(figuresIn(container)).toEqual([])
    // No unpunctuated trace of the amounts either, in the text or in any attribute.
    const text = container.textContent ?? ''
    for (const trace of ['987654', '1234567', '111111', '987_654', '1,234,567']) {
      expect(container.innerHTML, trace).not.toContain(trace)
      expect(text, trace).not.toContain(trace)
    }
  })

  it('still shows the pool, the period, the labels and the over/within verdict', () => {
    const line = agreementLine({ withinLimit: false, overBy: 700 })
    const { item } = fieldsOf(breakdown({ lines: [line], figures: hidden }))

    expect(item).toHaveTextContent('Core (flexible)')
    expect(item).toHaveTextContent('1 Jul – 30 Sep 2026')
    expect(item).toHaveTextContent('Over by an amount not shown here')
  })

  it('says Not shown in every figure field, and quotes no figure in the reason', () => {
    const { item, fields } = fieldsOf(breakdown({ figures: hidden, lines: [agreementLine()] }))

    expect(fields['Signed or committed']).toBe('Not shown')
    expect(fields['Forecast of this agreement']).toBe('Not shown')
    expect(fields['Available: set aside for us']).toBe('Not shown')
    expect(fields['Whole plan amount for this pool']).toBe('Not shown')
    expect(item).toHaveTextContent(hidden.reason)   // the reason is a screen-reader sentence, not part of the visible field
  })

  it('does not claim a total it cannot count without figures, and prints no figure it does not have', () => {
    // A hidden over-line is still an over-line for the caller, but the component must not print a figure it does not have.
    const { container } = renderBreakdown(breakdown({ figures: hidden, lines: [agreementLine({ withinLimit: false, overBy: 700 })] }))

    expect(container).toHaveTextContent('1 pool and period would be over')
    expect(figuresIn(container)).toEqual([])
  })
})

describe('AgreementBudgetBreakdown: refreshing', () => {
  it('keeps the figures it has and marks the section busy while a newer answer comes', () => {
    const { container } = renderBreakdown(breakdown({ lines: [agreementLine()], refreshing: true }))

    expect(screen.getByRole('region', { name: 'Agreement against the participant budget' })).toHaveAttribute('aria-busy', 'true')
    expect(figuresIn(container)).toContain('$860.00')
    expect(screen.getByText(/Updating…/)).toBeInTheDocument()
  })
})

describe('AgreementBudgetBreakdown: the no-budget action as a callback', () => {
  it('calls the caller’s handler instead of routing', async () => {
    const onSelect = vi.fn()
    renderBreakdown(breakdown({ lines: [], noBudgetAction: { label: 'Open the funding tab', onSelect } }))

    const button = screen.getByRole('button', { name: 'Open the funding tab' })
    await userEvent.tab()
    expect(button).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
