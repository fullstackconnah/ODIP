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
    expect(alert).toHaveTextContent('Over budget')   // the one word the rest of the budget screens use (design review L3)
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

describe('BudgetWarnings — lines about several participants (phase 3 review C5)', () => {
  const sophie = warning({ participantName: 'Sophie Brown', message: 'This booking takes Core (flexible) to $1,440.00 of $1,000.00.' })
  const noah = warning({ participantName: 'Noah Reid', message: 'This booking takes Core (flexible) to $2,000.00 of $1,500.00.' })

  it('starts each line with the participant it is about when the lines are about more than one', () => {
    render(<BudgetWarnings warnings={[sophie, noah]} note="This is a warning only. The bookings are confirmed." />)

    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'Sophie Brown: This booking takes Core (flexible) to $1,440.00 of $1,000.00.',
      'Noah Reid: This booking takes Core (flexible) to $2,000.00 of $1,500.00.',
    ])
  })

  it('leaves the name off when every line is about the same participant: the closing note names them already', () => {
    render(<BudgetWarnings warnings={[sophie, { ...sophie, poolName: 'Daily Activities', message: 'This booking takes Daily Activities to $900.00 of $500.00.' }]} note="This is a warning only. Sophie Brown’s booking is confirmed." />)

    expect(screen.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'This booking takes Core (flexible) to $1,440.00 of $1,000.00.',
      'This booking takes Daily Activities to $900.00 of $500.00.',
    ])
  })

  it('lists two lines that share a pool and a period, without a duplicate-key warning from React', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<BudgetWarnings warnings={[sophie, noah]} note="n" />)

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key/)
    error.mockRestore()
  })
})
