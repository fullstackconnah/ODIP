import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BillingPage from './BillingPage'

// The three tabs' tables are out of scope here (every list is empty): what these tests pin is the empty
// states' calls to action, which are real Buttons now rather than EmptyState's hand-rolled 44px link.
let canWrite = true
let participants: { id: string; fullName: string }[] = []

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite }),
}))

vi.mock('@/api/hooks', () => ({
  useFundingSources: () => ({ data: [], isLoading: false }),
  useUpdateFundingSource: () => ({ mutate: vi.fn(), isPending: false }),
  useServiceBookings: () => ({ data: [], isLoading: false }),
  useBillableEvents: () => ({ data: [], isLoading: false }),
  useParticipants: () => ({ data: participants }),
}))

// The slide-over panels bring their own form hooks; a marker is enough to see a button opened one.
vi.mock('./billing/FundingSourceFormPanel', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Funding source panel</div> : null),
}))
vi.mock('./billing/ServiceBookingFormPanel', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Service booking panel</div> : null),
}))
vi.mock('./billing/ServiceBookingDetailModal', () => ({ default: () => null }))
vi.mock('./billing/BillableEventFormPanel', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div>Billable event panel</div> : null),
}))

function renderPage() {
  return render(<MemoryRouter><BillingPage /></MemoryRouter>)
}

beforeEach(() => {
  canWrite = true
  participants = []
})

describe('BillingPage — empty-state calls to action', () => {
  it('draws "Add funding source" as a Button at --control-h (32px, 44px on a coarse pointer), not a hand-rolled 44px link', () => {
    const { container } = renderPage()

    expect(screen.getByText('No funding sources yet')).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'Add funding source' })
    expect(add).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
    // EmptyState's own action slot is where that min-h-[44px] button comes from; it is left unused.
    expect(container.querySelector('.min-h-\\[44px\\]')).toBeNull()
  })

  it('opens the funding source panel from the empty state, as the slot button did', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Add funding source' }))

    expect(screen.getByText('Funding source panel')).toBeInTheDocument()
  })

  it('offers a read-only user the explanation but no call to action', () => {
    canWrite = false
    renderPage()

    expect(screen.getByText('No funding sources yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add funding source' })).not.toBeInTheDocument()
  })

  it('keeps the empty state\'s spacing: 20px between description and button, 40px below it', () => {
    renderPage()

    const add = screen.getByRole('button', { name: 'Add funding source' })
    const wrapper = add.parentElement as HTMLElement
    // gap-5 = the slot's gap-3 + mt-2; pb-10 = the slot's py-10 bottom, with the EmptyState's own pb-0!.
    expect(wrapper).toHaveClass('flex', 'flex-col', 'items-center', 'gap-5', 'pb-10')
    expect(screen.getByText('No funding sources yet').parentElement).toHaveClass('pb-0!')
  })

  it('offers "Clear filters" as a Button when a filter hides everything, and clears the filter with it', async () => {
    const user = userEvent.setup()
    participants = [{ id: 'p1', fullName: 'Mia Chen' }]
    renderPage()

    await user.click(screen.getByRole('button', { name: 'All Participants' }))
    await user.click(screen.getByRole('option', { name: 'Mia Chen' }))

    expect(screen.getByText('No funding sources match your filters')).toBeInTheDocument()
    const clear = screen.getByRole('button', { name: 'Clear filters' })
    expect(clear).toHaveClass('h-[var(--control-h)]')

    await user.click(clear)
    expect(screen.getByText('No funding sources yet')).toBeInTheDocument()
  })

  it('draws "Add service booking" as a Button and opens its panel', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Service Bookings' }))
    const add = screen.getByRole('button', { name: 'Add service booking' })
    expect(add).toHaveClass('h-[var(--control-h)]')

    await user.click(add)
    expect(screen.getByText('Service booking panel')).toBeInTheDocument()
  })

  it('draws "Add billable event" as a Button and opens its panel', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: 'Billable Events' }))
    const add = screen.getByRole('button', { name: 'Add billable event' })
    expect(add).toHaveClass('h-[var(--control-h)]')

    await user.click(add)
    expect(screen.getByText('Billable event panel')).toBeInTheDocument()
  })
})
