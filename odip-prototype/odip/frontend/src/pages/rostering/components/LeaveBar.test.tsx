import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LeaveBar } from './LeaveBar'
import { makeLeaveBar } from '../test-fixtures-leave'

const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']

describe('LeaveBar kind handling', () => {
  it('renders the kind-derived "Leave" label regardless of availabilityType, as the existing solid muted style, with no "(pending)" suffix', () => {
    const leave = makeLeaveBar({ kind: 'ApprovedLeave', availabilityType: 'Annual' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    const label = screen.getByText('Leave')
    expect(label.parentElement).not.toHaveClass('border-dashed')
    expect(label.parentElement).toHaveClass('bg-muted')
  })

  it('renders a legacy StaffAvailability bar the same solid style as approved leave', () => {
    const leave = makeLeaveBar({ kind: 'Legacy', availabilityType: 'Training' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    const label = screen.getByText('Training')
    expect(label.parentElement).not.toHaveClass('border-dashed')
  })

  it('legacy bar falls back to "Unavailable" when availabilityType is null', () => {
    const leave = makeLeaveBar({ kind: 'Legacy', availabilityType: null })
    render(<LeaveBar leave={leave} days={DAYS} />)
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('renders a pending leave bar dashed, with a "(pending)" suffix on the label', () => {
    const leave = makeLeaveBar({ kind: 'PendingLeave', availabilityType: 'Sick' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    const label = screen.getByText('Leave (pending)')
    expect(label.parentElement).toHaveClass('border-dashed')
  })

  it('still clamps/spans the bar across the visible week the same way regardless of kind', () => {
    const leave = makeLeaveBar({ kind: 'PendingLeave', startDate: '2026-09-05', endDate: '2026-09-20' })
    render(<LeaveBar leave={leave} days={DAYS} />)
    expect(screen.getByText(/pending/i).parentElement).toHaveStyle({ gridColumn: '1 / 8' })
  })

  it('renders a recurring-rule bar as a partial-day block positioned/sized by its time window, not the full-day muted bar', () => {
    const leave = makeLeaveBar({
      kind: 'RecurringRule', availabilityType: 'Unavailable',
      startDate: '2026-09-08', endDate: '2026-09-08', startTime: '09:00:00', endTime: '12:00:00',
    })
    render(<LeaveBar leave={leave} days={DAYS} />)
    // The time window renders as the label — this is what makes it read as "a slice of the day,"
    // not the availabilityType text a full-day bar shows.
    const block = screen.getByText('09:00–12:00')
    expect(block.parentElement).toHaveStyle({ left: '37.5%', width: '12.5%' })
    // No full-day solid styling classes leak onto the partial-day markup.
    expect(block.parentElement).not.toHaveClass('bg-muted/40')
  })

  it('recurring-rule block spans exactly its one occurrence day, not the whole visible week', () => {
    const leave = makeLeaveBar({
      kind: 'RecurringRule', startDate: '2026-09-09', endDate: '2026-09-09', startTime: '13:00:00', endTime: '17:00:00',
    })
    render(<LeaveBar leave={leave} days={DAYS} />)
    // 2026-09-09 is DAYS[2] → 1-based grid column 3, spanning to column 4 (one day wide).
    expect(screen.getByText('13:00–17:00').closest('[style*="grid-column"]')).toHaveStyle({ gridColumn: '3 / 4' })
  })
})
