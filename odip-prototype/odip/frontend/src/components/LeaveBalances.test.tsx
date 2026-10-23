import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LeaveBalances, formatBalance } from './LeaveBalances'

const base = { isLoading: false, isError: false, refetch: vi.fn() }
const props = { noneMessage: 'None yet.', notLinked: 'Not linked.' }

describe('formatBalance', () => {
  it('uses one decimal, a real minus and the unit in lower case', () => {
    expect(formatBalance({ category: 'a', amount: 76, unit: 'Hours' })).toBe('76.0 hours')
    expect(formatBalance({ category: 'a', amount: -3.75, unit: 'Hours' })).toBe('\u22123.8 hours')
    expect(formatBalance({ category: 'a', amount: 10, unit: 'Days' })).toBe('10.0 days')
  })
})

describe('LeaveBalances', () => {
  it('reads while loading', () => {
    render(<LeaveBalances {...props} query={{ ...base, isLoading: true }} />)
    expect(screen.getByText('Reading your balances from Employment Hero\u2026')).toBeInTheDocument()
  })

  it('shows exactly the categories EH returns, with the foot line', () => {
    render(<LeaveBalances {...props} query={{ ...base, data: { status: 'Ready', balances: [{ category: 'Annual Leave', amount: 76, unit: 'Hours' }] } }} />)
    expect(screen.getByText('Annual Leave')).toBeInTheDocument()
    expect(screen.getByText('76.0 hours')).toBeInTheDocument()
    expect(screen.getByText('From Employment Hero, as at today.')).toBeInTheDocument()
  })

  it('says none, not linked, and nothing when not connected', () => {
    const { rerender, container } = render(<LeaveBalances {...props} query={{ ...base, data: { status: 'Ready', balances: [] } }} />)
    expect(screen.getByText('None yet.')).toBeInTheDocument()
    rerender(<LeaveBalances {...props} query={{ ...base, data: { status: 'NotLinked', balances: [] } }} />)
    expect(screen.getByText('Not linked.')).toBeInTheDocument()
    rerender(<LeaveBalances {...props} query={{ ...base, data: { status: 'NotConnected', balances: [] } }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the one failure sentence with Try again, and keeps it while the retry runs', async () => {
    const refetch = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<LeaveBalances {...props} query={{ ...base, isError: true, refetch }} />)
    expect(screen.getByText("Balances aren't available right now.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    rerender(<LeaveBalances {...props} query={{ ...base, isLoading: true, isFetching: true, errorUpdateCount: 1, refetch }} />)
    expect(screen.getByText("Balances aren't available right now.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trying\u2026' })).toBeDisabled()
  })

  it('keeps the list on screen during a background refetch', () => {
    render(<LeaveBalances {...props} query={{ ...base, isFetching: true, data: { status: 'Ready', balances: [{ category: 'Sick', amount: 1, unit: 'Days' }] } }} />)
    expect(screen.getByText('1.0 days')).toBeInTheDocument()
  })
})
