import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ClaimDetailPage from './ClaimDetailPage'
import type { ClaimLineItemDto, TripClaimDetailDto } from '@/api/types'

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
    tripInstanceId: 't-1',
    tripName: 'Byron Bay Winter Weekender',
    status: 'Draft',
    claimReference: 'CLM-001',
    totalAmount: 480,
    createdAt: '2026-01-01T00:00:00Z',
    submittedDate: null,
    totalApprovedAmount: 0,
    authorisedByStaffId: null,
    authorisedByStaffName: null,
    paidDate: null,
    notes: null,
    lineItems,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
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
