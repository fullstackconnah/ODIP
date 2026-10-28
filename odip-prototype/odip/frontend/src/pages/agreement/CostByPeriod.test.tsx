import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PlanBlock, PlanQuote } from '@/api/types'
import { emptyBlock } from '@/lib/planBlocks'
import { formatCurrency } from '@/lib/utils'
import { emptyTotals, quote } from '@/test/fixtures/planPricing'
import { CostByPeriod } from './CostByPeriod'

const post = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiClient: { post } }))

const reply = (amount: number, changes: Partial<PlanQuote> = {}): PlanQuote =>
  quote({ totals: { ...emptyTotals(), amount, supportHours: 10, lineCount: 4 }, ...changes })
const answer = (value: unknown) => ({ data: { data: value } })
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const block = (changes: Partial<PlanBlock> = {}): PlanBlock => ({ ...emptyBlock('b1', 'NSW'), days: ['Monday', 'Wednesday'], ...changes })
const pricing = (changes: Partial<Parameters<typeof CostByPeriod>[0]['pricing']> = {}) =>
  ({ from: '2027-01-01', to: '2027-06-30', settled: [block()], settling: false, quoteReady: true, fromStore: false, ...changes })

function show(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  const wrap = (element: ReactElement) => <QueryClientProvider client={client}>{element}</QueryClientProvider>
  const view = render(wrap(ui))
  return { ...view, again: (next: ReactElement) => view.rerender(wrap(next)) }
}

const period = () => document.querySelector('section p.text-xs') as HTMLElement
const region = () => screen.getByRole('status')
const lastBody = () => post.mock.calls.at(-1)?.[1]

beforeEach(() => {
  post.mockReset()
  post.mockImplementation(async () => answer(reply(1234.5)))
})

describe('Cost by period: the periods', () => {
  it('shows the first month with its exact dates and its price', async () => {
    show(<CostByPeriod pricing={pricing()} />)

    expect(await screen.findByText('$1,234.50')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true')
    expect(period()).toHaveTextContent('Month 1 of 6 · 1–31 Jan 2027')
    expect(screen.getByText('10 h of support')).toBeInTheDocument()
    expect(lastBody()).toMatchObject({ periodFrom: '2027-01-01', periodTo: '2027-01-31', includeLines: false })
  })

  it('offers only the kinds that cut the agreement in two or more, and Custom', () => {
    show(<CostByPeriod pricing={pricing({ to: '2027-12-31' })} />)

    expect(screen.getAllByRole('radio').map(radio => radio.textContent)).toEqual(['Fortnight', 'Month', 'Quarter', 'Custom'])
  })

  it('says a part period ends with the agreement', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing({ to: '2027-02-20' })} />)
    await screen.findByText('$1,234.50')

    await user.click(screen.getByRole('button', { name: 'Next month' }))

    expect(period()).toHaveTextContent('Month 2 of 2 · 1–20 Feb 2027')
    expect(screen.getByText('Part period: it ends with the agreement on 20 Feb 2027.')).toBeInTheDocument()
  })

  it('has no control at all for an agreement a fortnight or shorter', () => {
    show(<CostByPeriod pricing={pricing({ to: '2027-01-10' })} />)

    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('The agreement is a fortnight or shorter, so its whole cost above is the only period.')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('does not price a saved agreement', () => {
    show(<CostByPeriod pricing={pricing({ fromStore: true, quoteReady: false })} />)

    expect(screen.getByText('Not shown for a saved agreement.')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('marks the ends of the stepper aria-disabled, keeps focus on the button and sends nothing for a press on it', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing({ to: '2027-02-20' })} />)
    await screen.findByText('$1,234.50')
    const previous = screen.getByRole('button', { name: 'Previous month' })
    const next = screen.getByRole('button', { name: 'Next month' })
    expect(previous).toHaveAttribute('aria-disabled', 'true')
    expect(next).not.toHaveAttribute('aria-disabled')

    await user.click(next)
    await screen.findByText('$1,234.50')
    expect(next).toHaveAttribute('aria-disabled', 'true')
    next.focus()
    const asked = post.mock.calls.length
    await user.click(next)
    await wait(400)

    expect(next).toHaveFocus()
    expect(next).not.toBeDisabled()
    expect(post.mock.calls.length).toBe(asked)
  })

  it('sends one quote when the person steps several times within the pause', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing()} />)
    await screen.findByText('$1,234.50')
    const asked = post.mock.calls.length

    const next = screen.getByRole('button', { name: 'Next month' })
    await user.click(next)
    await user.click(next)
    await user.click(next)
    await waitFor(() => expect(post.mock.calls.length).toBe(asked + 1))
    await wait(400)

    expect(post.mock.calls.length).toBe(asked + 1)
    expect(lastBody()).toMatchObject({ periodFrom: '2027-04-01', periodTo: '2027-04-30' })
  })

  it('goes to period 1 when the kind changes', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing()} />)
    await screen.findByText('$1,234.50')
    await user.click(screen.getByRole('button', { name: 'Next month' }))

    await user.click(screen.getByRole('radio', { name: 'Quarter' }))

    expect(period()).toHaveTextContent('Quarter 1 of 2 · 1 Jan – 31 Mar 2027')
  })
})

describe('Cost by period: Custom', () => {
  it('opens on the dates last shown, clamps a wider range to the agreement and says so', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing()} />)
    await screen.findByText('$1,234.50')

    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    expect(screen.getByLabelText('From')).toHaveValue('2027-01-01')
    expect(screen.getByLabelText('To')).toHaveValue('2027-01-31')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-12-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2027-08-01' } })

    expect(screen.getByText('Priced from 1 Jan 2027, when the agreement starts, and to 30 Jun 2027, when the agreement ends.')).toBeInTheDocument()
    await waitFor(() => expect(lastBody()).toMatchObject({ periodFrom: '2027-01-01', periodTo: '2027-06-30' }))
  })

  it('asks for nothing while To is before From or a box is empty, and says why', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing()} />)
    await screen.findByText('$1,234.50')
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await screen.findByText('$1,234.50')
    const asked = post.mock.calls.length

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-12-20' } })
    expect(await screen.findByText('This is before the From date.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } })
    expect(await screen.findByText('Enter a date.')).toBeInTheDocument()
    await wait(400)

    expect(post.mock.calls.length).toBe(asked)
    expect(screen.queryByText('$1,234.50')).toBeNull()
  })
})

describe('Cost by period: never a stale figure', () => {
  it('shows updating, and no amount, the moment the blocks change, then the new figure; the block change is not announced', async () => {
    const user = userEvent.setup()
    const view = show(<CostByPeriod pricing={pricing()} />)
    await screen.findByText('$1,234.50')
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    await screen.findByText('$1,234.50')
    expect(region()).toHaveTextContent('Month 2 of 6, 1–28 Feb 2027: $1,234.50.')
    post.mockImplementation(async () => answer(reply(999.99)))

    view.again(<CostByPeriod pricing={pricing({ settled: [block({ days: ['Friday'] })], settling: true })} />)
    expect(screen.queryByText('$1,234.50')).toBeNull()
    expect(period()).toHaveTextContent('· updating…')
    expect(screen.getByRole('radiogroup').closest('section')).toHaveAttribute('aria-busy', 'true')

    view.again(<CostByPeriod pricing={pricing({ settled: [block({ days: ['Friday'] })] })} />)
    expect(await screen.findByText('$999.99')).toBeInTheDocument()
    expect(lastBody().blocks[0].days).toEqual(['Friday'])
    expect(region()).toHaveTextContent('Month 2 of 6, 1–28 Feb 2027: $1,234.50.')
    expect(region()).not.toHaveTextContent(/updating|pricing/)
  })

  it('shows updating while the budget is still being asked, and sends nothing until it is done', async () => {
    const view = show(<CostByPeriod pricing={pricing({ quoteReady: false })} />)
    expect(period()).toHaveTextContent('· pricing…')
    expect(post).not.toHaveBeenCalled()

    view.again(<CostByPeriod pricing={pricing()} />)
    expect(await screen.findByText('$1,234.50')).toBeInTheDocument()
  })
})

describe('Cost by period: the service', () => {
  it('says the service is busy while a 429 is tried again, then shows the figure', async () => {
    post.mockRejectedValueOnce({ response: { status: 429, headers: { 'retry-after': '0' }, data: {} } })
    show(<CostByPeriod pricing={pricing()} />)

    expect(await screen.findByText(/the pricing service is busy, trying again…/)).toBeInTheDocument()
    expect(await screen.findByText('$1,234.50')).toBeInTheDocument()
  })

  it('offers Try again after a failure, and asks again when it is pressed', async () => {
    const user = userEvent.setup()
    post.mockRejectedValueOnce({ response: { status: 500, data: {} } })
    show(<CostByPeriod pricing={pricing()} />)
    expect(await screen.findByText("Couldn't price this period.")).toBeInTheDocument()
    expect(region()).toHaveTextContent('')

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('$1,234.50')).toBeInTheDocument()
    expect(post).toHaveBeenCalledTimes(2)
    expect(region()).toHaveTextContent('Month 1 of 6, 1–31 Jan 2027: $1,234.50.')
  })

  it('says nothing is priced rather than showing a $0.00 price', async () => {
    post.mockImplementation(async () => answer(quote()))
    show(<CostByPeriod pricing={pricing()} />)

    expect(await screen.findByText('Nothing in this period is priced.')).toBeInTheDocument()
    expect(screen.queryByText('$0.00')).toBeNull()
  })
})

// The mock engine is the real engine's shape and rules (its prices are illustrative), so what a fortnight across a public holiday costs is checked against it. Read in the test, never at module
// level: it is not in the frontend's Docker build context, so the suite skips itself there.
const PRICING = join(dirname(fileURLToPath(import.meta.url)), '../../../../mock-api/planPricing.js')
describe.skipIf(!existsSync(PRICING))('Cost by period against the mock pricing engine', () => {
  type Engine = { quote: (request: unknown, settings: unknown) => PlanQuote; defaultSettings: () => unknown }
  let engine: Engine
  // Australia Day 2027 is Tuesday 26 January. Charge prices the day at the holiday rate (Review does too but flags it, Skip drops the day).
  const weekdays = block({ days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], start: '09:00:00', end: '12:00:00', onPublicHoliday: 'Charge' })
  const agreement = { from: '2027-01-25', to: '2027-06-30' }
  const ask = (periodFrom: string, periodTo: string) => engine.quote({ blocks: [weekdays], periodFrom, periodTo, includeLines: false }, engine.defaultSettings())

  beforeEach(() => {
    engine = createRequire(import.meta.url)(PRICING) as Engine
    post.mockImplementation(async (_url: string, body: unknown) => answer(engine.quote(body, engine.defaultSettings())))
  })

  it('prices a fortnight across the holiday above twice the ordinary week', async () => {
    const user = userEvent.setup()
    show(<CostByPeriod pricing={pricing({ ...agreement, settled: [weekdays] })} />)

    await user.click(screen.getByRole('radio', { name: 'Fortnight' }))
    const fortnight = ask('2027-01-25', '2027-02-07')
    const week = ask('2027-02-01', '2027-02-07')
    expect(await screen.findByText(formatCurrency(fortnight.totals.amount))).toBeInTheDocument()

    expect(lastBody()).toMatchObject({ periodFrom: '2027-01-25', periodTo: '2027-02-07', includeLines: false })
    expect(fortnight.totals.amount).toBeCloseTo(2 * week.totals.amount + 3 * (163.46 - 73.58), 2)
  })

  it('shows for a Custom range equal to the agreement the same figure as the whole agreement', async () => {
    show(<CostByPeriod pricing={pricing({ ...agreement, settled: [weekdays] })} />)
    await screen.findByText(formatCurrency(ask('2027-01-25', '2027-02-24').totals.amount))

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Custom' }))
    fireEvent.change(screen.getByLabelText('To'), { target: { value: agreement.to } })

    expect(await screen.findByText(formatCurrency(ask(agreement.from, agreement.to).totals.amount))).toBeInTheDocument()
    expect(lastBody()).toMatchObject({ periodFrom: agreement.from, periodTo: agreement.to })
  })
})
