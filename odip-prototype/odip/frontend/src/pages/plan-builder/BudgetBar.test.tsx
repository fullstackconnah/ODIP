import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { PlanBudget } from '@/api/hooks'
import type { PlanIssue } from '@/api/types'
import { budgetOf, emptyTotals } from '@/test/fixtures/planPricing'
import { agreementLine, agreementPool, breakdown } from '../budgets/components/fixtures'
import { BudgetBar } from './BudgetBar'

const budget = (): PlanBudget => budgetOf()

/** The agreement against the participant's pools, as the bar is handed it (the plan builder maps the server's answer): one pool and one period, with $3,120.00 left, and it fits. */
const FITS = breakdown()
/** The same agreement against a period with $1,000.00 left: $1,355.50 over. */
const OVER = breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: 2355.5, remaining: 1000, withinLimit: false, overBy: 1355.5 })] })] })
/** More over still: the figure in the bar moves, the announcement must not. */
const OVER_MORE = breakdown({ pools: [agreementPool({ lines: [agreementLine({ cost: 2355.5, remaining: 500, withinLimit: false, overBy: 1855.5 })] })] })

const ready = (props: Partial<Parameters<typeof BudgetBar>[0]> = {}) =>
  render(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} {...props} />)

/** The comparison the bar draws: its own region, named for what it holds. */
const check = () => screen.getByRole('region', { name: 'Agreement against the participant\'s budget' })

/** A ResizeObserver the test drives: nothing is measured until it says the size changed. */
class FakeResizeObserver {
  static all: FakeResizeObserver[] = []
  disconnected = false
  readonly targets: Element[] = []
  readonly callback: () => void
  constructor(callback: () => void) { this.callback = callback; FakeResizeObserver.all.push(this) }
  observe(target: Element) { this.targets.push(target) }
  unobserve() { /* nothing */ }
  disconnect() { this.disconnected = true }
  fire() { this.callback() }
}

describe('BudgetBar', () => {
  it('says what an ordinary week and the whole agreement come to, and the agreement by budget category', () => {
    ready()

    const bar = screen.getByRole('region', { name: 'Running budget' })
    expect(within(bar).getByText('An ordinary week')).toBeInTheDocument()
    expect(bar).toHaveTextContent('8 h · $588.64')
    expect(bar).toHaveTextContent('$30,610.28 416 h of support')
    const categories = within(bar).getByRole('list', { name: 'By budget category' })
    expect(within(categories).getByText('Community participation $30,610.28')).toHaveAttribute('title', 'Assistance with Social, Economic and Community Participation')
  })

  it('compares the agreement with what the participant’s pool has left, in the pool and the period it falls in', () => {
    ready()

    expect(screen.getByText('Participant budget')).toBeInTheDocument()
    expect(check()).toHaveTextContent('Agreement $2,355.50 against $3,120.00 left in 1 Oct – 31 Dec 2026')
    expect(check()).toHaveTextContent('Within')
    expect(check()).not.toHaveTextContent('Over by')
    expect(screen.queryByText('Over budget')).not.toBeInTheDocument()
  })

  it('compares per pool and per period: each is a line of its own', () => {
    ready({
      budgetCheck: breakdown({
        pools: [
          agreementPool({ poolLabel: 'Core', lines: [agreementLine(), agreementLine({ periodStart: '2027-01-01', periodEnd: '2027-03-31', cost: 1000, remaining: 400, withinLimit: false, overBy: 600 })] }),
          agreementPool({ poolLabel: 'Improved Daily Living Skills', lines: [agreementLine({ cost: 300, remaining: 900 })] }),
        ],
      }),
    })

    const lines = within(check()).getAllByRole('listitem')
    expect(lines).toHaveLength(3)
    expect(screen.getByText('Improved Daily Living Skills')).toBeInTheDocument()
    expect(lines[0]).toHaveTextContent('Agreement $2,355.50 against $3,120.00 left in 1 Oct – 31 Dec 2026')
    expect(lines[1]).toHaveTextContent('Agreement $1,000.00 against $400.00 left in 1 Jan – 31 Mar 2027')
    expect(lines[1]).toHaveTextContent('Over by $600.00')
    expect(lines[2]).toHaveTextContent('Agreement $300.00 against $900.00 left')
    expect(check().textContent?.match(/Within/g)).toHaveLength(2)
  })

  it('warns when the agreement is over what a pool has left, in words, and says it never stops a save or an approval', () => {
    ready({ budgetCheck: OVER })

    const line = within(check()).getByRole('listitem')
    expect(line).toHaveTextContent('Agreement $2,355.50 against $1,000.00 left in 1 Oct – 31 Dec 2026')
    expect(line).toHaveTextContent('Over by $1,355.50')
    expect(check()).toHaveTextContent('This is a warning only: it never stops a save or an approval.')
    expect(check()).not.toHaveTextContent('would be over what is left')   // the verdict above it already says so
    expect(screen.getByText('Over budget')).toBeInTheDocument()   // and on the one-line form a phone shows
    // The line takes the warning tint and says "Over by" in words (colour is never the only cue); the figures are not live regions, so nothing speaks on every recalculation.
    expect(line).toHaveClass('bg-[var(--color-warning-container)]')
    expect(line.closest('[role="status"]')).toBeNull()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('has no control that could refuse a save: being over is a sentence and a chip, never a disabled Save', () => {
    ready({ budgetCheck: OVER, unsaved: { onSave: vi.fn(), saving: false } })

    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  // Code review N11: at ae279094 the over-budget line was a status; design 8 took the live regions off the figures, and a screen reader that adds the block that tips the plan over was told nothing.
  describe('the agreement crossing what a pool has left', () => {
    const over = { budgetCheck: OVER }
    const under = { budgetCheck: FITS }

    it('has one polite status, visually hidden, that says so when the agreement is over and is empty when it is not', () => {
      const { rerender } = ready(under)
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('')

      rerender(<BudgetBar status="ready" budget={budget()} {...over} />)
      expect(screen.getByRole('status')).toHaveTextContent('Over the participant\'s budget.')
      expect(screen.getByRole('status').querySelector('p')).toHaveClass('sr-only')
      expect(screen.getAllByRole('status')).toHaveLength(1)
    })

    it('says it when it crosses, and says nothing new while the amount over changes, so it does not speak on every recalculation', () => {
      const { rerender } = ready(under)
      rerender(<BudgetBar status="ready" budget={budget()} {...over} />)
      const sentence = screen.getByRole('status').textContent

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={OVER_MORE} />)    // more over: the figure in the bar moves, the announcement does not
      expect(screen.getByRole('status').textContent).toBe(sentence)
      expect(screen.getByRole('status').textContent).not.toMatch(/\$|\d/)
    })

    it('puts the status in the page empty before it is filled, so that the change is announced', () => {
      const { rerender } = ready(under)
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('')

      rerender(<BudgetBar status="ready" budget={budget()} {...over} />)
      expect(screen.getByRole('status')).toBe(region)             // the same node: filled in place, not inserted already holding its text
      expect(region).toHaveTextContent('Over the participant\'s budget.')
    })

    it('says nothing about being over while the check is loading, failed or has no budget to compare, because nothing is over', () => {
      const { rerender } = ready(over)
      expect(screen.getByRole('status')).toHaveTextContent('Over the participant\'s budget.')

      for (const status of ['loading', 'failed', 'none'] as const) {
        rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={breakdown({ status, pools: [] })} />)
        expect(screen.getByRole('status').textContent, status).not.toContain('Over the participant')
      }
    })

    // A check that fails is advisory, so it must not interrupt a person typing in a block (it is not an alert): the bar's one polite status says it once instead.
    it('says the budget could not be checked in that same status, once, and does not repeat it while it stays failed', () => {
      const { rerender } = ready({ budgetCheck: breakdown({ status: 'failed', pools: [], onRetry: vi.fn() }) })
      const region = screen.getByRole('status')
      expect(region).toHaveTextContent('The budget could not be checked.')
      expect(region.querySelector('p')).toHaveClass('sr-only')
      expect(screen.getAllByRole('status')).toHaveLength(1)
      const sentence = region.textContent

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={breakdown({ status: 'failed', pools: [], onRetry: vi.fn() })} />)
      expect(screen.getByRole('status')).toBe(region)
      expect(screen.getByRole('status').textContent).toBe(sentence)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} />)   // asked again and answered: the sentence goes
      expect(screen.getByRole('status').textContent).toBe('')
    })
  })

  // Round 3, L3: "You have unsaved changes." was a status in the save row, a plain paragraph since round 2, and the bar's Not saved chip is text: nothing told a screen reader the plan had become unsaved.
  describe('the plan becoming unsaved', () => {
    const unsaved = (saving = false) => ({ onSave: vi.fn(), saving })

    it('is said once, politely, in the one status the bar has, when it happens: filled in place, not inserted holding its text', () => {
      const { rerender } = ready()
      const region = screen.getByRole('status')
      expect(region.textContent).toBe('')

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} unsaved={unsaved()} />)

      expect(screen.getByRole('status')).toBe(region)
      expect(region).toHaveTextContent('The plan has changes that are not saved.')
      expect(screen.getAllByRole('status')).toHaveLength(1)
      expect(region.querySelector('p.sr-only:last-child')).toHaveTextContent('The plan has changes that are not saved.') // visually hidden: the chip beside the figure is the sighted cue
    })

    it('does not say it again on every change after that: the sentence is the same, so nothing is put into the region', () => {
      const { rerender } = ready({ unsaved: unsaved() })
      const before = screen.getByRole('status').innerHTML

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} unsaved={unsaved()} refreshing />)       // typing: a new quote is on its way, the figures move
      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} unsaved={unsaved()} />)

      expect(screen.getByRole('status').innerHTML).toBe(before)
    })

    it('lets go of it when the plan is saved, and the answer of the save takes its place', () => {
      const { rerender } = ready({ unsaved: unsaved() })
      expect(screen.getByRole('status')).toHaveTextContent('The plan has changes that are not saved.')

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} saved="Saved as version 5." />)

      expect(screen.getByRole('status')).toHaveTextContent('Saved as version 5.')
      expect(screen.getByRole('status')).not.toHaveTextContent('not saved')
    })
  })

  // Round 3, L1: the reason a plan cannot be saved is an alert in the dock, beside the Save it switches off.
  it('says why it is blocked, as an alert in the dock, and says nothing without a reason', () => {
    const { rerender } = ready({ blocked: true, blockedReason: 'Block 1 cannot be priced yet, so the plan cannot be saved.', unsaved: { onSave: vi.fn(), saving: false } })
    const dock = screen.getByRole('region', { name: 'Running budget' }).parentElement as HTMLElement
    expect(within(dock).getByText('Block 1 cannot be priced yet, so the plan cannot be saved.').closest('[role="alert"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // Design review D3: the amber cell said "You can still save the draft" while the Callout said the plan cannot be saved and Save draft was off. The sentence now says only what is always true:
  // the budget never stops a save or an approval, so it cannot contradict a plan that cannot be saved for another reason.
  it('does not promise the draft can be saved while a block is refused: it says only that the budget does not stop it', () => {
    const { rerender } = ready({ budgetCheck: OVER })
    expect(check()).toHaveTextContent('it never stops a save or an approval')

    rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={OVER} blocked />)
    expect(check()).toHaveTextContent('it never stops a save or an approval')
    expect(check()).not.toHaveTextContent(/can still be saved|save the draft/)
  })

  it('says no budget is recorded, links to the Funding tab, and shows the totals on their own, with nothing warned', () => {
    const none = breakdown({ status: 'none', pools: [], noBudgetAction: { label: 'Open the Funding tab', to: '/participants/p-1?tab=funding' } })
    render(<MemoryRouter><BudgetBar status="ready" budget={budget()} budgetCheck={none} /></MemoryRouter>)

    expect(screen.getByText('No budget recorded for this participant, so there is nothing to compare the agreement against.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the Funding tab' })).toHaveAttribute('href', '/participants/p-1?tab=funding')
    expect(screen.queryByText('Over budget')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveTextContent('$30,610.28')   // the totals stand alone
    expect(screen.queryByText(/Over by/)).not.toBeInTheDocument()
  })

  it('says the check could not be made, and offers to ask again, while the plan can still be saved', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    ready({ budgetCheck: breakdown({ status: 'failed', pools: [], onRetry }), unsaved: { onSave: vi.fn(), saving: false } })

    expect(screen.getByText('The agreement could not be checked against the budget, so no comparison is shown. The plan can still be saved.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()   // an advisory check that fails does not interrupt: the polite status says it
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  // Below 1280px the bar is one line and the Details are shut. With no budget recorded, or a check that failed, it said nothing there, and silence reads as "fits": the brief wants the bar to say a
  // budget is missing. Neutral chips (a warning tone is for being over), and nothing for Within, which stays quiet.
  describe('the one-line form says when there is nothing to compare, or the comparison failed', () => {
    const none = (extra: Partial<Parameters<typeof breakdown>[0]> = {}) =>
      breakdown({ status: 'none', pools: [], noBudgetAction: { label: 'Open the Funding tab', to: '/participants/p-1?tab=funding' }, ...extra })
    const renderBar = (budgetCheck: ReturnType<typeof breakdown> | null, props: Partial<Parameters<typeof BudgetBar>[0]> = {}) =>
      render(<MemoryRouter><BudgetBar status="ready" budget={budget()} budgetCheck={budgetCheck} {...props} /></MemoryRouter>)
    const oneLine = () => screen.getByText(/in all$/).closest('div')!.parentElement!

    it('has a No budget recorded chip beside the figure, in a neutral tone', () => {
      renderBar(none())

      const chip = within(oneLine()).getByText('No budget recorded')
      expect(chip.tagName).toBe('SPAN')
      expect(chip.className).not.toContain('var(--color-warning-container)')
    })

    it('says Plan ended when the recorded plan has ended', () => {
      renderBar(none({ noBudgetReason: 'PlanEnded', planEnd: '2026-06-30' }))

      expect(within(oneLine()).getByText('Plan ended')).toBeInTheDocument()
      expect(within(oneLine()).queryByText('No budget recorded')).not.toBeInTheDocument()
    })

    it('has a Budget not checked chip when the check failed', () => {
      renderBar(breakdown({ status: 'failed', pools: [], onRetry: vi.fn() }))

      expect(within(oneLine()).getByText('Budget not checked')).toBeInTheDocument()
    })

    it('has neither while the check is under way, and none beside a comparison that fits or one that is over', () => {
      const { rerender } = renderBar(breakdown({ status: 'loading', pools: [] }))
      for (const check of [breakdown({ status: 'loading', pools: [] }), FITS, OVER, null]) {
        rerender(<MemoryRouter><BudgetBar status="ready" budget={budget()} budgetCheck={check} /></MemoryRouter>)
        expect(screen.queryByText('No budget recorded'), String(check?.status)).not.toBeInTheDocument()
        expect(screen.queryByText('Plan ended')).not.toBeInTheDocument()
        expect(screen.queryByText('Budget not checked')).not.toBeInTheDocument()
      }
    })

    it('has none for a plan that prices to nothing: there is nothing to compare, and the Details say so', () => {
      const base = budget()
      renderBar(none(), { budget: { period: { ...base.period, totals: { ...emptyTotals(), lineCount: 6, unpricedLines: 6 } }, weekly: null, week: null } })

      expect(screen.queryByText('No budget recorded')).not.toBeInTheDocument()
    })

    it('keeps the Not saved chip and its Save beside them', () => {
      renderBar(none(), { unsaved: { onSave: vi.fn(), saving: false } })

      expect(within(oneLine()).getByText('Not saved')).toBeInTheDocument()
      expect(within(oneLine()).getByText('No budget recorded')).toBeInTheDocument()
    })
  })

  // The dock covers a laptop screen while somebody edits blocks, and the budget column's sentence used to take whatever width it wanted and squeeze the figures beside it.
  it('caps the width of the budget column so a long sentence wraps there instead of squeezing the figures beside it', () => {
    ready()

    expect(document.getElementById('plan-budget-details')!.className).toContain('xl:grid-cols-[minmax(11rem,auto)_1fr_minmax(14rem,26rem)]')
  })

  it('says the check is under way, and states no comparison, until its answer arrives', () => {
    ready({ budgetCheck: breakdown({ status: 'loading', pools: [] }) })

    expect(screen.getByText(/Checking the agreement against the participant/)).toBeInTheDocument()
    expect(screen.queryByText(/Agreement \$/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')   // said to a screen reader as busy, not as a second live region
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('is busy, and keeps the last answer on screen, while a newer check replaces it', () => {
    ready({ budgetCheck: { ...FITS, refreshing: true } })

    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')
    expect(check()).toHaveTextContent('Agreement $2,355.50 against $3,120.00 left')
  })

  it('has no Participant budget column at all when there is nothing to compare yet', () => {
    ready({ budgetCheck: null })

    expect(screen.queryByText('Participant budget')).not.toBeInTheDocument()
  })

  it('names the plans it cannot give a week for, and what is flagged, and what it left out', () => {
    const noWeek = budget()
    const holiday = { blockId: 'b1', date: '2026-10-05', holidayName: 'Labour Day', decision: 'Review' as const, skipped: false }
    ready({
      budget: { ...noWeek, weekly: null, week: null, period: { ...noWeek.period, holidayOccurrences: [holiday, { ...holiday, date: '2026-12-25', holidayName: 'Christmas Day' }], totals: { ...noWeek.period.totals, provisionalLines: 3 } } },
      incompleteBlocks: 1, refreshing: true,
    })

    expect(screen.getByText('The agreement is shorter than a week.')).toBeInTheDocument()
    expect(screen.getByText('2 public holiday shifts to decide · some lines use provisional rates.')).toBeInTheDocument()
    expect(screen.getByText('1 block left out of these figures until it is complete.')).toBeInTheDocument()
    expect(screen.getAllByText(/updating…/)).toHaveLength(2)   // in the one line, and in Details
    expect(screen.queryByText('Not fully priced')).not.toBeInTheDocument()   // a decision still to make is not work left out
  })

  // Design 1: the total is what a coordinator quotes to a family, so a total that leaves work out says so beside the figure, in shifts, and on the one-line form a phone shows.
  describe('a total that leaves work out', () => {
    const issue = (reason: PlanIssue['reason'], count: number, blockId = 'b1'): PlanIssue => ({ blockId, reason, message: `${reason} ${blockId}`, count, firstDate: '2026-10-13' })
    const withIssues = (...issues: PlanIssue[]): PlanBudget => {
      const base = budget()
      return { ...base, period: { ...base.period, issues, totals: { ...base.period.totals, lineCount: 744, unpricedLines: 372, reviewLines: 219, provisionalLines: 0 } } }
    }

    it('counts the shifts with a part not priced, once, never the lines (shifts times items) the engine counts', () => {
      ready({ budget: withIssues(issue('NoItem', 186), issue('CatalogueNotFound', 186), issue('CatalogueNotFound', 40, 'b2')) })

      expect(screen.getByText('At least 226 shifts with a part not priced.')).toBeInTheDocument()      // block 1 has two issues, so its 186 is the largest and not the count
      expect(screen.queryByText(/372|219/)).not.toBeInTheDocument()
    })

    it('says Not fully priced on the one-line form, beside the figure a phone shows', () => {
      ready({ budget: withIssues(issue('CatalogueNotFound', 4)) })

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all')
      expect(line.parentElement).toHaveTextContent('Not fully priced')
      expect(line.parentElement).not.toHaveTextContent('Over budget')
    })

    it('counts a block that cannot be priced at all, and says the total is not complete', () => {
      ready({ budget: withIssues(issue('RegistrationGroupNotHeld', 1, 'b2')) })

      expect(screen.getByText('1 block cannot be priced.')).toBeInTheDocument()
      expect(screen.getByText('Not fully priced')).toBeInTheDocument()
    })

    it('says nothing of it when every shift is priced', () => {
      ready()

      expect(screen.queryByText('Not fully priced')).not.toBeInTheDocument()
      expect(screen.queryByText(/not priced/)).not.toBeInTheDocument()
    })
  })

  it('has one line, and a Details toggle that opens the rest, for a phone', async () => {
    const user = userEvent.setup()
    ready()

    const details = screen.getByRole('button', { name: /Details/ })
    expect(details).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('plan-budget-details')).toHaveClass('hidden', 'xl:grid')   // the one-line form is for everything below 1280px, a tablet included
    expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all')).toBeInTheDocument()

    await user.click(details)
    expect(details).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById('plan-budget-details')).not.toHaveClass('hidden')
  })

  it('says it is pricing, never a zero, while the first answer is on its way', () => {
    render(<BudgetBar status="loading" />)

    expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getAllByText('Pricing the plan…')).toHaveLength(2)                 // the one line, and the details; aria-busy says it to a screen reader
    expect(screen.getByRole('status').textContent).toBe('')                            // nothing is announced by it: a status that is inserted holding its text is not reliably spoken
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
  })

  it('asks for a block while there is nothing to price', () => {
    render(<BudgetBar status="idle" />)
    expect(screen.getByText('Add a block to see the weekly hours and cost, and what the agreement comes to.')).toBeInTheDocument()
  })

  // Design 5: the error and Try again are not inside the Details a phone keeps shut, where they were display:none and never announced.
  it('says why a plan could not be priced, announced, with a way to try again only when trying again can help', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(<BudgetBar status="error" error={{ response: { status: 429, data: {} } }} onRetry={onRetry} />)

    expect(screen.getByRole('alert')).toHaveTextContent('The pricing service is busy.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<BudgetBar status="error" error={{ response: { status: 400, data: { errors: ['The agreement period ends before it starts.'] } } }} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('The agreement period ends before it starts.')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  // Design review 6: "Add to plan" does not save, the save row is a long scroll below the blocks, and the one-line bar a phone shows was silent about it.
  describe('a plan that is not saved', () => {
    it('says Not saved on the one-line form with a Save that saves, named by its own visible word so it is not the save row\'s Save draft', async () => {
      const user = userEvent.setup()
      const onSave = vi.fn()
      ready({ unsaved: { onSave, saving: false } })

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(within(line).getByText('Not saved')).toBeInTheDocument()
      await user.click(within(line).getByRole('button', { name: 'Save' }))
      expect(onSave).toHaveBeenCalledTimes(1)
    })

    it('holds Save back while it saves, and when the plan cannot be saved as it is', () => {
      const { rerender } = ready({ unsaved: { onSave: vi.fn(), saving: true } })
      expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} unsaved={{ onSave: vi.fn(), saving: false }} blocked />)
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('says nothing of saving when there is nothing to save', () => {
      ready()
      expect(screen.queryByText('Not saved')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  it('shows the error outside the collapsible details, and only once', () => {
    render(<BudgetBar status="error" error={{ response: { status: 429, data: {} } }} onRetry={vi.fn()} />)

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getByRole('alert').closest('#plan-budget-details')).toBeNull()
    expect(document.getElementById('plan-budget-details')).toBeNull()
  })

  // Review F1: the framework's validation answer (errors as an object by field) threw inside render and emptied the page.
  it('reads the framework\'s validation answer without throwing, and says it in words', () => {
    const error = { response: { status: 400, data: { title: 'One or more validation errors occurred.', status: 400, errors: { 'blocks[0].block.sleepoverActiveHours': ['The JSON value could not be converted to System.Decimal. Path: $.blocks[0]...'] } } } }

    expect(() => render(<BudgetBar status="error" error={error} onRetry={vi.fn()} />)).not.toThrow()

    expect(screen.getByRole('alert')).toHaveTextContent('A box in the plan is empty or is not a number.')
  })

  // Code review N6 and design D8: a plan that prices to nothing printed "0 h · $0.00 a week", "$0.00" and the whole plan budget as left, beside a chip that said it was not fully priced. An en dash is the figure
  // of something that is not known; the overview, Review and the PDF already say it so.
  describe('a plan that prices to nothing', () => {
    const issue: PlanIssue = { blockId: 'b1', reason: 'RegistrationGroupNotHeld', message: "Block 'b1': needs registration group 0125.", count: 1 }
    const nothing = (): PlanBudget => {
      const base = budget()
      return { ...base, period: { ...base.period, issues: [issue], totals: { ...emptyTotals() } }, weekly: { ...base.weekly!, totals: emptyTotals() } }
    }

    it('shows an en dash for every headline, no $0.00, and no categories to list', () => {
      ready({ budget: nothing() })

      const bar = screen.getByRole('region', { name: 'Running budget' })
      expect(bar).not.toHaveTextContent('$0.00')
      expect(screen.getByText('An ordinary week').nextElementSibling).toHaveTextContent('– h · –')
      expect(screen.getByText('The agreement period').nextElementSibling).toHaveTextContent(/^–/)
      expect(screen.queryByRole('list', { name: 'By budget category' })).not.toBeInTheDocument()
    })

    it('says so in the one line a tablet reads', () => {
      ready({ budget: nothing() })

      expect(screen.getByText('– h · – a week · – in all')).toBeInTheDocument()
      expect(screen.getByText('– h · – a week · – in all').parentElement).toHaveTextContent('Not fully priced')
    })

    it('does not compare the agreement with the participant’s budget, and says there is nothing to compare', () => {
      ready({ budget: nothing(), budgetCheck: OVER })

      expect(screen.getByText('Participant budget')).toBeInTheDocument()
      expect(screen.getByText('Nothing is priced yet, so there is nothing to compare.')).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: 'Agreement against the participant\'s budget' })).not.toBeInTheDocument()
      expect(screen.queryByText(/left/)).not.toBeInTheDocument()
      expect(screen.queryByText('Over budget')).not.toBeInTheDocument()
      expect(screen.getByRole('status').textContent).toBe('')    // and says nothing is over
    })

    it('is the same when every line is there and not one has a price, and when the agreement is shorter than a week', () => {
      const base = budget()
      ready({ budget: { period: { ...base.period, totals: { ...emptyTotals(), lineCount: 6, unpricedLines: 6 } }, weekly: null, week: null } })

      expect(screen.getByText('– in all')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Running budget' })).not.toHaveTextContent('$0.00')
      expect(screen.getByText('The agreement is shorter than a week.')).toBeInTheDocument()
    })

    it('still prints a priced plan as money, whatever it leaves out', () => {
      const base = budget()
      ready({ budget: { ...base, period: { ...base.period, totals: { ...base.period.totals, lineCount: 208, unpricedLines: 100 } } } })

      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all')).toBeInTheDocument()
    })
  })

  // Code review N1: with no dates (or a date that is no day, or an end before the start) the query is off, nothing is in flight, and the bar said "Pricing the plan…" and was busy for as long as it took the
  // person to find the date boxes.
  describe('a plan with no dates to price it over', () => {
    const note = 'Enter the agreement dates to price the plan'

    it('says what is missing, as idle: not "Pricing the plan…", not busy, and no figure', () => {
      render(<BudgetBar status="idle" idleNote={note} budgetCheck={FITS} />)

      const bar = screen.getByRole('region', { name: 'Running budget' })
      expect(bar).toHaveAttribute('aria-busy', 'false')
      expect(screen.getAllByText(new RegExp(note))).toHaveLength(2) // the one line, and Details
      expect(within(bar).queryByText(/Pricing the plan/)).not.toBeInTheDocument()
      expect(bar).not.toHaveTextContent('$')
      expect(screen.queryByText('Add a block to see the budget')).not.toBeInTheDocument()
    })

    it('says an agreement that ends before it starts in its own words', () => {
      render(<BudgetBar status="idle" idleNote="The agreement ends before it starts, so the plan cannot be priced" />)

      expect(screen.getByText('The agreement ends before it starts, so the plan cannot be priced')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'false')
    })
  })

  // Code review N5: the one line a tablet reads (everything below 1280px) held the previous plan's total with no cue that a newer one was on its way, and the left-out count was inside the Details.
  describe('the one line, while the figure is provisional', () => {
    it('says it is updating, and busy, while a newer answer is on its way, and not otherwise', () => {
      const { rerender } = ready({ refreshing: true })
      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(line).toHaveTextContent('· updating…')
      expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'true')

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} />)
      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement).not.toHaveTextContent('updating')
      expect(screen.getByRole('region', { name: 'Running budget' })).toHaveAttribute('aria-busy', 'false')
    })

    it('says how many blocks it leaves out, in the one line', () => {
      ready({ incompleteBlocks: 2 })

      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement).toHaveTextContent('· 2 blocks left out')
    })

    it('is quiet when the figure is the answer', () => {
      ready()

      const line = screen.getByText('8 h · $588.64 a week · $30,610.28 in all').parentElement as HTMLElement
      expect(line).not.toHaveTextContent(/updating|left out/)
    })
  })

  // Round 3, M1 (WCAG 2.4.11 Focus Not Obscured): the dock is the bar and whatever notice is above it, 57 to 123 px as a bar and up to 40vh more with a notice, and the plan builder keeps focus clear of
  // it with a margin that has to be its real height.
  describe('the height of the dock it reports', () => {
    afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); FakeResizeObserver.all = [] })
    /** The dock is 120 px, and 420 px with the notice in it (jsdom has no layout). */
    const measure = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.textContent?.includes('The draft was not saved') ? 420 : 120 } as DOMRect
    })
    const dockOf = () => screen.getByRole('region', { name: 'Running budget' }).parentElement as HTMLElement

    it('says how tall it is when it is drawn, and again each time its size changes, and 0 when it goes', () => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver)
      measure()
      const onDockHeight = vi.fn()
      const { rerender, unmount } = ready({ onDockHeight })
      expect(onDockHeight).toHaveBeenLastCalledWith(120)
      expect(FakeResizeObserver.all).toHaveLength(1)

      rerender(<BudgetBar status="ready" budget={budget()} budgetCheck={FITS} onDockHeight={onDockHeight} notice={<p>The draft was not saved</p>} />)
      FakeResizeObserver.all[0].fire()                      // the notice made the dock taller
      expect(onDockHeight).toHaveBeenLastCalledWith(420)

      unmount()
      expect(onDockHeight).toHaveBeenLastCalledWith(0)
      expect(FakeResizeObserver.all[0].disconnected).toBe(true)
    })

    it('measures the dock itself, the wrapper around the region and the notice, and not only the figures', () => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver)
      measure()
      ready({ onDockHeight: vi.fn(), notice: <p>The draft was not saved</p> })

      expect(dockOf()).toHaveTextContent('The draft was not saved')
      expect(dockOf()).toContainElement(screen.getByRole('region', { name: 'Running budget' }))
    })

    it('reports once and does not fail where there is no ResizeObserver', () => {
      vi.stubGlobal('ResizeObserver', undefined)
      measure()
      const onDockHeight = vi.fn()
      const { unmount } = ready({ onDockHeight })

      expect(onDockHeight).toHaveBeenCalledTimes(1)
      unmount()
      expect(onDockHeight).toHaveBeenLastCalledWith(0)
    })
  })

  // Round 3, L2: when only the reference week prices to nothing (an agreement that starts before the first catalogue date) the week printed "0 h . $0.00 a week" beside an agreement that is priced.
  describe('a week that prices to nothing in an agreement that does not', () => {
    const noPricedWeek = (): PlanBudget => {
      const base = budget()
      return { ...base, weekly: { ...base.weekly!, totals: { ...emptyTotals(), lineCount: 2, unpricedLines: 2 } } }
    }

    it('shows an en dash for the week, in the one line and in Details, and money for the agreement', () => {
      ready({ budget: noPricedWeek() })

      expect(screen.getByText('– h · – a week · $30,610.28 in all')).toBeInTheDocument()
      expect(screen.getByText('An ordinary week').nextElementSibling).toHaveTextContent('– h · –')
      expect(screen.getByText('The agreement period').nextElementSibling).toHaveTextContent('$30,610.28')
      expect(screen.getByRole('region', { name: 'Running budget' })).not.toHaveTextContent('$0.00')
    })

    it('still prints a week that has a price as money', () => {
      ready()

      expect(screen.getByText('8 h · $588.64 a week · $30,610.28 in all')).toBeInTheDocument()
    })
  })
})
