import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import BookingsTab from './BookingsTab'
import type { TripDetailDto } from '@/api/types/trips'
import type { BookingListDto } from '@/api/types/bookings'
import type { ParticipantListDto } from '@/api/types/participants'
import { TAP_AREA } from '@/components/tapArea'

// PF-10.6 — primary Client Overview PDF surface (Trip-detail roster). Only
// useDownloadClientOverviewPdf is asserted on directly here; the other hooks this file imports
// from '@/api/hooks' are stubbed inertly since this suite is about the new per-row action, not
// booking CRUD (which has no dedicated existing test file of its own to defer to, but is out of
// scope for PF-10.6).
const { mockDownloadMutate, mockUseDownloadClientOverviewPdf, mockUseCreateBooking } = vi.hoisted(() => ({
  mockDownloadMutate: vi.fn(),
  mockUseCreateBooking: vi.fn(),
  mockUseDownloadClientOverviewPdf: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false })),
}))

vi.mock('@/api/hooks', () => ({
  useCreateBooking: mockUseCreateBooking,
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

function renderTab(bookings: BookingListDto[] = [makeBooking()], participants: ParticipantListDto[] = []) {
  return render(
    <MemoryRouter>
      <BookingsTab tripId="trip-1" trip={trip} bookings={bookings} participants={participants} canWrite isReadOnly={false} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseCreateBooking.mockReset()
  mockUseCreateBooking.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false })
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

// ── Participant readiness (WARN mode) in the Add Booking modal ───────────────────────────────────────────────────────
// In Warn mode the server books a participant who is not fully ready and reports what is missing; in Enforce mode it refuses with
// a 400 "Participant is not ready for booking or rostering." The modal shows the first as a quiet line under the picker (it never
// disables Add Booking) and the second as the real message, never the generic line, with everything the user entered kept.
const NOT_READY_MESSAGE = 'Participant is not ready for booking or rostering.'
const GENERIC_BOOKING_ERROR = 'Failed to create booking. Please try again.'
const ISSUES = ['Intake not complete', 'No signed service agreement']
const WARNING = 'Not ready: Intake not complete · No signed service agreement'

function makeParticipant(overrides: Partial<ParticipantListDto> = {}): ParticipantListDto {
  return {
    id: 'p-ready', firstName: 'Noah', lastName: 'Reid', preferredName: null, fullName: 'Noah Reid', maskedNdisNumber: null,
    planType: 'SelfManaged', region: null, isRepeatClient: false, isActive: true, mobilityAidWheelchair: false,
    mobilityAidWalker: false, mobilitySupportOptions: [], isHighSupport: false, isIntensiveSupport: false,
    overnightSupport: 'None', overnightRatio: 'OneToOne', requiresHiLoBed: false, requiresHoist: false,
    requiresShowerChair: false, requiresCommode: false, requiresStandingMachine: false, supportRatio: 'OneToOne',
    serviceStreams: 'None', hasActiveMedications: false, isDraft: false,
    ...overrides,
  }
}

const readyParticipant = makeParticipant()
const notReadyParticipant = makeParticipant({ id: 'p-notready', firstName: 'Mia', lastName: 'Chen', fullName: 'Mia Chen', readinessIssues: ISSUES })

/** Opens the Add Participant modal and picks a participant by name. */
async function openModalAndPick(user: ReturnType<typeof userEvent.setup>, name?: string) {
  await user.click(screen.getByRole('button', { name: /add participant/i }))
  if (!name) return
  await user.click(screen.getByRole('combobox', { name: /participant/i }))
  await user.click(screen.getByRole('option', { name }))
}

/** A create hook that fails the way TanStack's does: `mutate` records the call, then `isError` and `error` flip on. */
function useFailingCreateBooking(mutate: ReturnType<typeof vi.fn>, failure: unknown) {
  const [error, setError] = useState<unknown>(null)
  return {
    mutate: (payload: unknown, opts: unknown) => { mutate(payload, opts); setError(failure) },
    isPending: false,
    isError: error !== null,
    error,
  }
}

describe('BookingsTab — Add Booking: readiness warning', () => {
  it('shows nothing under the picker until a participant is chosen, and nothing for one who is ready', async () => {
    const user = userEvent.setup()
    renderTab([], [readyParticipant, notReadyParticipant])

    await openModalAndPick(user)
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /participant/i }))
    await user.click(screen.getByRole('option', { name: 'Noah Reid' }))
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()
  })

  it('shows the quiet warning under the picker once a not-ready participant is chosen, follows a change of participant, and never disables Add Booking', async () => {
    const user = userEvent.setup()
    renderTab([], [readyParticipant, notReadyParticipant])

    await openModalAndPick(user, 'Mia Chen')

    const note = screen.getByText(WARNING)
    expect(note.closest('[title]')).toHaveAttribute('title', WARNING)
    expect(note.closest('[role="alert"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add Booking' })).toBeEnabled()
    // Directly under the picker: after it, ahead of the Booking Status field.
    const picker = screen.getByRole('combobox', { name: /participant/i })
    expect(Boolean(picker.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    expect(Boolean(note.compareDocumentPosition(screen.getByText('Booking Status')) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)

    await user.click(screen.getByRole('combobox', { name: /participant/i }))
    await user.click(screen.getByRole('option', { name: 'Noah Reid' }))
    expect(screen.queryByText(/not ready/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Booking' })).toBeEnabled()
  })

  it('still books a not-ready participant, sending the full body and no readiness field', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockUseCreateBooking.mockReturnValue({ mutate, isPending: false, isError: false })
    renderTab([], [readyParticipant, notReadyParticipant])

    await openModalAndPick(user, 'Mia Chen')
    await user.type(screen.getByPlaceholderText('Optional notes...'), 'Needs the hoist')
    await user.click(screen.getByRole('button', { name: 'Add Booking' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      {
        tripInstanceId: 'trip-1',
        participantId: 'p-notready',
        bookingStatus: 'Enquiry',
        wheelchairRequired: false,
        highSupportRequired: false,
        nightSupportRequired: false,
        hasRestrictivePracticeFlag: false,
        supportRatioOverride: 'OneToOne',
        bookingNotes: 'Needs the hoist',
        insuranceStatus: 'None',
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(mutate.mock.calls[0][0]).not.toHaveProperty('readinessIssues')
  })
})

describe('BookingsTab — Add Booking: the server\'s refusal reaches the user', () => {
  it('shows the server\'s own message, not the generic line, and keeps the modal and everything entered', async () => {
    const user = userEvent.setup()
    const mutate = vi.fn()
    mockUseCreateBooking.mockImplementation(() => useFailingCreateBooking(mutate, {
      response: { status: 400, data: { success: false, errors: [NOT_READY_MESSAGE] } },
    }))
    renderTab([], [readyParticipant, notReadyParticipant])

    await openModalAndPick(user, 'Mia Chen')
    await user.type(screen.getByPlaceholderText('Optional notes...'), 'Needs the hoist')
    await user.click(screen.getByLabelText('Wheelchair'))
    await user.click(screen.getByRole('button', { name: 'Add Booking' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(
      {
        tripInstanceId: 'trip-1',
        participantId: 'p-notready',
        bookingStatus: 'Enquiry',
        wheelchairRequired: true,
        highSupportRequired: false,
        nightSupportRequired: false,
        hasRestrictivePracticeFlag: false,
        supportRatioOverride: 'OneToOne',
        bookingNotes: 'Needs the hoist',
        insuranceStatus: 'None',
      },
      expect.anything(),
    )
    const message = await screen.findByText(NOT_READY_MESSAGE)
    expect(message.closest('[role="alert"]')).not.toBeNull()
    expect(screen.queryByText(GENERIC_BOOKING_ERROR)).not.toBeInTheDocument()
    // The modal is still open with the participant, the notes and the checkbox exactly as entered.
    expect(screen.getByRole('heading', { name: 'Add Participant to Trip' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /participant/i })).toHaveValue('Mia Chen')
    expect(screen.getByPlaceholderText('Optional notes...')).toHaveValue('Needs the hoist')
    expect(screen.getByLabelText('Wheelchair')).toBeChecked()
    expect(screen.getByRole('button', { name: 'Add Booking' })).toBeEnabled()
  })

  it.each([
    ['a network failure with no response', new Error('Network Error')],
    ['a 500 with an empty body', { response: { status: 500, data: {} } }],
  ])('falls back to the generic line for %s', async (_label, failure) => {
    const user = userEvent.setup()
    mockUseCreateBooking.mockImplementation(() => useFailingCreateBooking(vi.fn(), failure))
    renderTab([], [readyParticipant])

    await openModalAndPick(user, 'Noah Reid')
    await user.click(screen.getByRole('button', { name: 'Add Booking' }))

    expect(await screen.findByText(GENERIC_BOOKING_ERROR)).toBeInTheDocument()
    expect(screen.queryByText(NOT_READY_MESSAGE)).not.toBeInTheDocument()
  })
})
