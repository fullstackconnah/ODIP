import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ClaimDetailPage from './ClaimDetailPage'
import type { ClaimLineItemDto, TripClaimDetailDto } from '@/api/types'
import { formatDateAu } from '@/lib/utils'

const { mockUseClaim } = vi.hoisted(() => ({
  mockUseClaim: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useClaim: mockUseClaim,
  useUpdateClaim: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateClaimLineItem: () => ({ mutate: vi.fn(), isPending: false }),
}))

// ClaimDetailPage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker — that
// throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router (same
// requirement IncidentCreatePage.test.tsx documents).
function renderPage(initialEntry = '/claims/claim-1') {
  const router = createMemoryRouter(
    [
      { path: '/claims/:id', element: <ClaimDetailPage /> },
      { path: '/trips/:id', element: <div>Trip detail</div> },
      { path: '/trips', element: <div>Trips list</div> },
    ],
    { initialEntries: [initialEntry] },
  )
  return render(<RouterProvider router={router} />)
}

function baseLineItem(overrides: Partial<ClaimLineItemDto> = {}): ClaimLineItemDto {
  return {
    id: 'li-1',
    tripClaimId: 'claim-1',
    participantBookingId: 'b-1',
    participantId: null,
    participantName: 'Priya Nair',
    ndisNumber: '43100001234',
    planType: 'AgencyManaged',
    supportItemCode: '01_002_0117_1_1',
    dayType: 'Weekday',
    supportsDeliveredFrom: '2026-01-05',
    supportsDeliveredTo: '2026-01-05',
    hours: 8,
    unitPrice: 60,
    totalAmount: 480,
    gstCode: 'GST',
    claimType: 'Standard',
    cancellationReason: null,
    participantApproved: false,
    status: 'Draft',
    rejectionReason: null,
    paidAmount: null,
    ...overrides,
  }
}

function baseClaim(lineItems: ClaimLineItemDto[]): TripClaimDetailDto {
  return {
    id: 'claim-1',
    kind: 'Trip',
    tripInstanceId: 't-1',
    tripName: 'Byron Bay Winter Weekender',
    status: 'Draft',
    claimReference: 'CLM-001',
    totalAmount: 480,
    createdAt: '2026-01-01T00:00:00Z',
    totalApprovedAmount: 0,
    authorisedByStaffId: null,
    authorisedByStaffName: null,
    paidDate: null,
    notes: null,
    lineItems,
  }
}

/** Shift-completion design spec §1/§2, PR 3 — a Kind === 'Shift' claim has no tripInstanceId/
 * tripName and carries participantId/periodFrom/periodTo instead. */
function shiftClaim(lineItems: ClaimLineItemDto[], overrides: Partial<TripClaimDetailDto> = {}): TripClaimDetailDto {
  return {
    id: 'claim-2',
    kind: 'Shift',
    tripName: '',
    participantId: 'p-9',
    periodFrom: '2026-02-01',
    periodTo: '2026-02-14',
    status: 'Draft',
    claimReference: 'CLM-002',
    totalAmount: 320,
    createdAt: '2026-02-15T00:00:00Z',
    totalApprovedAmount: 0,
    authorisedByStaffId: null,
    authorisedByStaffName: null,
    paidDate: null,
    notes: null,
    lineItems,
    ...overrides,
  }
}

/** A Kind === 'Shift' line item: shiftId set, participantBookingId absent (design spec §1/§3). */
function shiftLineItem(overrides: Partial<ClaimLineItemDto> = {}): ClaimLineItemDto {
  return {
    id: 'li-2',
    tripClaimId: 'claim-2',
    shiftId: 'sh-1',
    participantId: 'p-9',
    participantName: 'Priya Nair',
    ndisNumber: '43100001234',
    planType: 'AgencyManaged',
    supportItemCode: '01_002_0117_1_1',
    dayType: 'Weekday',
    supportsDeliveredFrom: '2026-02-03',
    supportsDeliveredTo: '2026-02-03',
    hours: 8,
    unitPrice: 40,
    totalAmount: 320,
    gstCode: 'GST',
    claimType: 'Standard',
    cancellationReason: null,
    participantApproved: false,
    status: 'Draft',
    rejectionReason: null,
    paidAmount: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Landing-spotted: the page mapped 'NdiaManaged', a value the API never sends, so every line item printed the raw enum "AgencyManaged".
describe('ClaimDetailPage — plan type label', () => {
  it.each([
    ['AgencyManaged', 'Agency Managed'],
    ['PlanManaged', 'Plan Managed'],
    ['SelfManaged', 'Self Managed'],
  ] as const)('prints %s as "%s", never the raw enum the API sends', (planType, label) => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ planType })]), isLoading: false })
    renderPage()

    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.queryByText(planType)).not.toBeInTheDocument()
  })
})

describe('ClaimDetailPage — line item participant link', () => {
  it('links the participant cell to the participant detail page when participantId is set', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ participantId: 'p-9', participantName: 'Priya Nair' })]), isLoading: false })
    renderPage()

    expect(screen.getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/participants/p-9')
  })

  it('renders plain text (not a link) for the participant cell when participantId is not set', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ participantId: null, participantName: 'Priya Nair' })]), isLoading: false })
    renderPage()

    expect(screen.getByText('Priya Nair')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Priya Nair' })).not.toBeInTheDocument()
  })
})

// Shift-completion design spec §1/§2/§3, PR 3 — a Kind === 'Shift' claim has no trip at all.
describe('ClaimDetailPage — Kind === Shift claim', () => {
  it('shows a "Shift claim" indicator in the header instead of "Trip claim"', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([shiftLineItem()]), isLoading: false })
    renderPage('/claims/claim-2')

    expect(screen.getByText('Shift claim')).toBeInTheDocument()
    expect(screen.queryByText('Trip claim')).not.toBeInTheDocument()
  })

  it('shows a "Trip claim" indicator in the header for a Kind === Trip claim', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    renderPage()

    expect(screen.getByText('Trip claim')).toBeInTheDocument()
  })

  it('shows the period instead of a trip link/name, and renders with no trip at all', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([shiftLineItem()]), isLoading: false })
    renderPage('/claims/claim-2')

    // Rendered twice — once in the breadcrumb (in place of the trip link) and once in the
    // "Period" summary card (in place of the "Trip" card).
    expect(screen.getAllByText(`${formatDateAu('2026-02-01')} – ${formatDateAu('2026-02-14')}`)).toHaveLength(2)
    expect(screen.getByText('Period')).toBeInTheDocument()
    expect(screen.queryByText('Trip')).not.toBeInTheDocument()
    // No link to a specific trip (there is none for a Shift-kind claim) — the breadcrumb's own
    // root "Trips" list link is unrelated and stays.
    expect(screen.queryByRole('link', { name: /^trip$/i })).not.toBeInTheDocument()
  })

  it('shows the service date (not a from–to range) and "Shift" in place of the booking-derived actions for a shift-kind line', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([shiftLineItem()]), isLoading: false })
    renderPage('/claims/claim-2')

    expect(screen.getByText('2026-02-03')).toBeInTheDocument()
    expect(screen.queryByText('2026-02-03 – 2026-02-03')).not.toBeInTheDocument()
    expect(screen.getByText('Shift')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'No Show' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invoice' })).not.toBeInTheDocument()
  })

  it('still links the participant cell for a shift-kind line (batch 1 behaviour is unchanged)', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([shiftLineItem({ participantId: 'p-9', participantName: 'Priya Nair' })]), isLoading: false })
    renderPage('/claims/claim-2')

    expect(screen.getByRole('link', { name: 'Priya Nair' })).toHaveAttribute('href', '/participants/p-9')
  })
})

describe('ClaimDetailPage — failed request vs. missing record (PageState)', () => {
  it('names a failed request as a failure, with a retry, and does not call it "Claim not found"', () => {
    mockUseClaim.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this claim")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Claim not found')).not.toBeInTheDocument()
  })

  it('shows "Claim not found" for a 404, with nothing to retry', () => {
    mockUseClaim.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Claim not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to billing' })).toHaveAttribute('href', '/billing')
  })

  it('shows "Claim not found" for an answer with no record, and says "Loading claim…" while it loads', () => {
    mockUseClaim.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderPage()
    expect(screen.getByText('Claim not found')).toBeInTheDocument()
    unmount()

    mockUseClaim.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading claim…')
  })
})
