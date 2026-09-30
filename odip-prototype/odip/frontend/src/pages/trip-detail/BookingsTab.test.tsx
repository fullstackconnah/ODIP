import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import { TAP_AREA } from '@/components/tapArea'

// PF-10.6 — primary Client Overview PDF surface (Trip-detail roster). Only
// useDownloadClientOverviewPdf is asserted on directly here; the other hooks this file imports
// from '@/api/hooks' are stubbed inertly since this suite is about the new per-row action, not
// booking CRUD (which has no dedicated existing test file of its own to defer to, but is out of
// scope for PF-10.6).
const { mockDownloadMutate, mockUseDownloadClientOverviewPdf } = vi.hoisted(() => ({
  mockDownloadMutate: vi.fn(),
  mockUseDownloadClientOverviewPdf: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
}))

vi.mock('@/api/hooks', () => ({
  useCreateBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useUpdateBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePatchBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDeleteBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCancelBooking: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useDownloadClientOverviewPdf: mockUseDownloadClientOverviewPdf,
  PAYMENT_STATUS_ITEMS: [
    { value: 'NotInvoiced', label: 'Not Invoiced' },
    { value: 'Invoiced', label: 'Invoiced' },
  ],
  PAYMENT_STATUS_COLORS: { NotInvoiced: 'bg-neutral-100 text-neutral-600', Invoiced: 'bg-blue-100 text-blue-700' },
}))

const trip = { id: 'trip-1', maxParticipants: 10, staffAssignedCount: 0 } as unknown as TripDetailDto

function makeBooking(overrides: Partial<BookingListDto> = {}): BookingListDto {
  return {
    id: 'booking-1', tripInstanceId: 'trip-1', tripName: 'Spring Coastal Trip',
    participantId: 'participant-1', participantName: 'Sophie Brown',
    bookingStatus: 'Confirmed', bookingDate: '2026-10-12', wheelchairRequired: false,
    highSupportRequired: false, nightSupportRequired: false, hasRestrictivePracticeFlag: false,
    supportRatioOverride: null, actionRequired: false, insuranceStatus: 'None', paymentStatus: 'NotInvoiced',
    ...overrides,
  }
}

function renderTab(bookings: BookingListDto[] = [makeBooking()]) {
  return render(
    <MemoryRouter>
      <BookingsTab tripId="trip-1" trip={trip} bookings={bookings} participants={[]} canWrite isReadOnly={false} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockDownloadMutate.mockReset()
  mockUseDownloadClientOverviewPdf.mockReturnValue({ mutate: mockDownloadMutate, isPending: false, isError: false })
})

describe('BookingsTab — PF-10.6 Client Overview PDF per-row action', () => {
  it('renders a Client Overview PDF action for each booking row', () => {
    renderTab()

    expect(screen.getByRole('button', { name: /client overview pdf/i })).toBeInTheDocument()
  })

  it('calls the client overview mutation with the participant id, the trip id, and a filename when clicked', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /client overview pdf/i }))

    expect(mockDownloadMutate).toHaveBeenCalledWith(
      { id: 'participant-1', tripId: 'trip-1', fileName: expect.stringContaining('.pdf') },
      expect.anything(),
    )
  })
})

// Density polish (touch): the actions cell holds four 22px hand-rolled icon controls in a gap-2 row. DataTable pads every
// link in a cell to 44px on touch, so the "View participant" link alone reached 11px past its box and overlapped its
// still-22px neighbours by 3px each (found by the broad coarse sweep). All four now share TAP_ICON_SQUARE: 22px on a mouse
// as before, the 36px --control-h-sm square with a 44px hit area on touch, and the row's 8px gap makes the pads touch and
// never overlap.
describe('BookingsTab — touch targets in the row actions', () => {
  const controls = () => [
    screen.getByTitle('Edit booking'),
    screen.getByTitle('Client Overview PDF'),
    screen.getByTitle('View participant'),
    screen.getByTitle('Remove from trip'),
  ]

  it('gives all four row action controls the same 44px touch shape, so none overlaps a neighbour', () => {
    renderTab()

    const [edit, pdf, view, remove] = controls()
    expect(view.tagName).toBe('A')
    for (const c of [edit, pdf, view, remove]) {
      expect(c).toHaveClass(...TAP_AREA.split(' '))
      expect(c).toHaveClass('pointer-coarse:inline-flex', 'pointer-coarse:size-[var(--control-h-sm)]', 'pointer-coarse:items-center', 'pointer-coarse:justify-center', 'pointer-coarse:p-0')
    }
  })

  it('keeps the mouse look: p-1 around a 14px icon (22px), rounded, the same hover fills', () => {
    renderTab()

    const [edit, pdf, view, remove] = controls()
    for (const c of [edit, pdf, view, remove]) {
      expect(c).toHaveClass('p-1', 'rounded', 'transition-colors')
      expect(c.querySelector('svg')).toHaveClass('w-3.5', 'h-3.5')
    }
    expect(edit).toHaveClass('hover:bg-[var(--color-surface-container)]')
    expect(remove).toHaveClass('hover:bg-[var(--color-error-container)]/60')
    expect(pdf).toHaveClass('disabled:opacity-50')
  })

  it('spaces them 8px apart, the gap that lets two 36px squares with 4px pads touch without overlapping', () => {
    renderTab()

    const cluster = screen.getByTitle('Edit booking').parentElement as HTMLElement
    expect(cluster).toHaveClass('flex', 'items-center', 'justify-center', 'gap-2')
    expect(cluster).toContainElement(screen.getByTitle('Remove from trip'))
  })

  it('still runs each action: the PDF download, and the participant link goes to their record', async () => {
    const user = userEvent.setup()
    renderTab()

    expect(screen.getByTitle('View participant')).toHaveAttribute('href', '/participants/participant-1')
    await user.click(screen.getByTitle('Client Overview PDF'))
    expect(mockDownloadMutate).toHaveBeenCalledTimes(1)
  })
})
