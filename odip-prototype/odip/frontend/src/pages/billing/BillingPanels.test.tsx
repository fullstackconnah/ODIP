import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FundingSourceFormPanel from './FundingSourceFormPanel'
import ServiceBookingFormPanel from './ServiceBookingFormPanel'
import BillableEventFormPanel from './BillableEventFormPanel'
import type { BillableEventDto, FundingSourceDto } from '@/api/types'

vi.mock('@/api/hooks', () => ({
  useParticipants: () => ({ data: [{ id: 'participant-1', fullName: 'Mia Chen' }] }),
  useFundingSources: () => ({ data: [] }),
  useServiceBookings: () => ({ data: [] }),
  useCreateFundingSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateFundingSource: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateServiceBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateBillableEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateBillableEvent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const fundingSource: FundingSourceDto = {
  id: 'fs-1',
  participantId: 'participant-1',
  participantName: 'Mia Chen',
  routeType: 'AgencyManaged',
  budgetCategory: 'Core',
  ndisPlanNumber: '43-1234567',
  planStartDate: '2026-01-01',
  planEndDate: '2026-12-31',
  budget: 12000,
  payerName: null,
  payerEmail: null,
  isActive: true,
}

function makeEvent(overrides: Partial<BillableEventDto> = {}): BillableEventDto {
  return {
    id: 'be-1',
    participantId: 'participant-1',
    participantName: 'Mia Chen',
    fundingSourceId: 'fs-1',
    serviceBookingId: null,
    stream: 'Ndis',
    sourceEntityType: null,
    sourceEntityId: null,
    supportItemNumber: '01_002_0117_1_1',
    supportsDeliveredFrom: '2026-09-01T00:00:00Z',
    supportsDeliveredTo: '2026-09-01T00:00:00Z',
    dayType: 'Weekday',
    quantity: null,
    hours: 2,
    unitPrice: 68.5,
    totalAmount: 137,
    gstCode: 'P2',
    claimType: 'Standard',
    cancellationReasonCode: null,
    participantApproved: false,
    claimReference: '',
    status: 'Draft',
    rejectionReason: null,
    createdAt: '2026-09-02T00:00:00Z',
    ...overrides,
  } as BillableEventDto
}

describe('FundingSourceFormPanel as a dialog', () => {
  it('is a modal dialog named "New Funding Source" or "Edit Funding Source", closed when isOpen is false', () => {
    const { rerender } = render(<FundingSourceFormPanel isOpen={false} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    rerender(<FundingSourceFormPanel isOpen onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New Funding Source' })).toHaveAttribute('aria-modal', 'true')
    rerender(<FundingSourceFormPanel key="edit" isOpen onClose={() => {}} fundingSource={fundingSource} />)
    expect(screen.getByRole('dialog', { name: 'Edit Funding Source' })).toBeInTheDocument()
  })

  it('traps focus inside: Close panel first, and Tab wraps from the last control back to it', async () => {
    const user = userEvent.setup()
    render(<FundingSourceFormPanel isOpen onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Create Funding Source' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
  })

  it('Escape closes an untouched panel and asks first after an edit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<FundingSourceFormPanel isOpen onClose={onClose} fundingSource={fundingSource} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    onClose.mockClear()
    render(<FundingSourceFormPanel isOpen onClose={onClose} fundingSource={fundingSource} />)
    await user.type(screen.getByLabelText('NDIS Plan Number'), '9')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('ServiceBookingFormPanel as a dialog', () => {
  it('is a modal dialog named "New Service Booking"', () => {
    render(<ServiceBookingFormPanel isOpen onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New Service Booking' })).toHaveAttribute('aria-modal', 'true')
  })

  it('Escape closes an untouched panel and asks first after an edit; Keep editing keeps the text', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { unmount } = render(<ServiceBookingFormPanel isOpen onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    onClose.mockClear()
    render(<ServiceBookingFormPanel isOpen onClose={onClose} />)
    await user.type(screen.getByLabelText(/PRODA Booking Reference/), 'SB-1')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText(/PRODA Booking Reference/)).toHaveValue('SB-1')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BillableEventFormPanel as a dialog', () => {
  it('is a modal dialog named "New Billable Event" or "Edit Billable Event"', () => {
    const { unmount } = render(<BillableEventFormPanel isOpen onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'New Billable Event' })).toHaveAttribute('aria-modal', 'true')
    unmount()
    render(<BillableEventFormPanel isOpen onClose={() => {}} event={makeEvent()} />)
    expect(screen.getByRole('dialog', { name: 'Edit Billable Event' })).toBeInTheDocument()
  })

  it('Escape asks first after an edit', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BillableEventFormPanel isOpen onClose={onClose} event={makeEvent()} />)
    await user.type(screen.getByLabelText(/Support Item Number/), '9')
    await user.keyboard('{Escape}')
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a claimed event is read-only: the notice shows, the fields are disabled, and Escape closes it straight away', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<BillableEventFormPanel isOpen onClose={onClose} event={makeEvent({ status: 'Claimed' })} />)
    expect(screen.getByText(/has already\s+been claimed/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Support Item Number/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save Changes' })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
