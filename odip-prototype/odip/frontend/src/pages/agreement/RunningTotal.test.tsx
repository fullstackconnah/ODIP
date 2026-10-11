import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AgreementBudgetBreakdownView } from '../budgets/components/viewModel'
import { budgetOf } from '@/test/fixtures/planPricing'
import { RunningTotal } from './RunningTotal'

const pool = (overBy: number | null) => ({ poolLabel: 'Core', cost: 5000, overBy, alreadyOverBy: null, lines: [] })
const ready = (pools: ReturnType<typeof pool>[]): AgreementBudgetBreakdownView =>
  ({ status: 'ready', figures: { visible: true }, pools, notInARecordedPool: null, outsideThePlan: null }) as AgreementBudgetBreakdownView

const base = { status: 'ready' as const, answer: budgetOf(), refreshing: false, leftOut: 0, onRetry: vi.fn() }

describe('RunningTotal', () => {
  it('says the week, the agreement and that it is within budget', () => {
    render(<RunningTotal {...base} budgetView={ready([pool(null)])} />)
    expect(screen.getByRole('status')).toHaveTextContent('$588.64 a week · $30,610.28 for the agreement · within budget')
  })

  it('adds up what the pools are over by', () => {
    render(<RunningTotal {...base} budgetView={ready([pool(1000), pool(355)])} />)
    expect(screen.getByRole('status')).toHaveTextContent('over by $1,355.00')
  })

  it('says there is no budget recorded rather than within budget, and names a check that could not be made', () => {
    const { rerender } = render(<RunningTotal {...base} budgetView={{ ...ready([]), status: 'none' } as AgreementBudgetBreakdownView} />)
    expect(screen.getByRole('status')).toHaveTextContent('no budget recorded')
    rerender(<RunningTotal {...base} budgetView={{ ...ready([]), status: 'failed' } as AgreementBudgetBreakdownView} />)
    expect(screen.getByRole('status')).toHaveTextContent('budget not checked')
  })

  it('asks for a shift when there is nothing to price, and offers Retry when pricing failed', () => {
    const { rerender } = render(<RunningTotal {...base} status="idle" answer={undefined} budgetView={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Add a shift to see the total')
    rerender(<RunningTotal {...base} status="error" answer={undefined} budgetView={null} error={{ response: { status: 500 } }} />)
    expect(screen.getByText(/Couldn't price/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('marks an answer that is being replaced, and the shifts it leaves out', () => {
    render(<RunningTotal {...base} refreshing leftOut={2} budgetView={null} />)
    expect(screen.getByText(/updating/)).toBeInTheDocument()
    expect(screen.getByText(/2 shifts left out/)).toBeInTheDocument()
  })
})
