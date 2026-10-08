import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BudgetWarnings } from './BudgetWarnings'
import type { BudgetWarningDto } from '@/api/types'

const warning = (over: Partial<BudgetWarningDto> = {}): BudgetWarningDto => ({
  poolName: 'Core (flexible)', periodStart: '2026-10-01', periodEnd: '2026-12-31', available: 1000, used: 0, forecast: 3840, added: 3840, overBy: 2840, count: 8,
  message: 'These 8 shifts take Core (flexible) to $3,840.00 of $1,000.00 for 1 Oct–31 Dec 2026.', ...over,
})

describe('BudgetWarnings', () => {
  it('draws nothing at all when there is nothing to warn about: no all-clear without data, and no empty box', () => {
    const { container } = render(<BudgetWarnings warnings={[]} note="A warning only." />)

    expect(container).toBeEmptyDOMElement()
  })

  it('prints the server\u2019s own sentence for each pool and period, as a warning, with the caller\u2019s note that nothing was blocked', () => {
    render(<BudgetWarnings warnings={[warning(), warning({ poolName: 'Daily Activities', message: 'These 2 shifts take Daily Activities to $900.00 of $500.00 for 1 Oct–31 Dec 2026.' })]} note="This is a warning only. The shifts were made." />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Past the budget')
    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'These 8 shifts take Core (flexible) to $3,840.00 of $1,000.00 for 1 Oct–31 Dec 2026.',
      'These 2 shifts take Daily Activities to $900.00 of $500.00 for 1 Oct–31 Dec 2026.',
    ])
    expect(screen.getByText('This is a warning only. The shifts were made.')).toBeInTheDocument()
  })

  it('does not announce itself when it sits inside content that is read in order', () => {
    render(<BudgetWarnings warnings={[warning()]} note="A warning only." announce={false} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/These 8 shifts take Core/)).toBeInTheDocument()
  })

  it('does no arithmetic and prints no figure of its own', () => {
    render(<BudgetWarnings warnings={[warning({ message: 'The server\u2019s words.' })]} note="n" />)

    expect(document.body.textContent).not.toMatch(/\$\d/)
  })

  it('offers a Dismiss button only when the caller can close it', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    const { rerender } = render(<BudgetWarnings warnings={[warning()]} note="A warning only." />)
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()

    rerender(<BudgetWarnings warnings={[warning()]} note="A warning only." onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
