import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ClaimDetailPage from './ClaimDetailPage'
import type { ClaimLineItemDto, TripClaimDetailDto } from '@/api/types'
import { formatDateAu } from '@/lib/utils'

const { mockUseClaim, mockUpdateClaim } = vi.hoisted(() => ({
  mockUseClaim: vi.fn(),
  mockUpdateClaim: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useClaim: mockUseClaim,
  useUpdateClaim: () => ({ mutate: mockUpdateClaim, isPending: false }),
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

// Budget phase 2b: the NDIA's code for a rejection. A provider cannot see a participant's budget in the NDIA's portal, so a rejection with V17, V18, V27 or V28 is the only direct sign a pool is empty.
describe('ClaimDetailPage — Mark as Rejected asks for the NDIA code', () => {
  const submitted = () => ({ ...baseClaim([baseLineItem()]), status: 'Submitted' as const })
  const openRejection = async () => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Mark as Rejected' }))
    return { user, dialog: screen.getByRole('alertdialog', { name: 'Mark as rejected?' }) }
  }

  beforeEach(() => { mockUseClaim.mockReturnValue({ data: submitted(), isLoading: false }) })
  afterEach(() => mockUpdateClaim.mockReset())

  it('sends the status alone when no code is given: a rejection with no code is still a rejection', async () => {
    renderPage()
    const { user, dialog } = await openRejection()

    expect(within(dialog).getByRole('combobox', { name: 'NDIA rejection code (optional)' })).toHaveValue('')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(mockUpdateClaim).toHaveBeenCalledTimes(1)
    expect(mockUpdateClaim.mock.calls[0][0]).toEqual({ claimId: 'claim-1', data: { status: 'Rejected' } })
  })

  it.each(['V17', 'V18', 'V27', 'V28'])('sends the chosen code %s with the status, in the one request', async code => {
    renderPage()
    const { user, dialog } = await openRejection()

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'NDIA rejection code (optional)' }), code)
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(mockUpdateClaim.mock.calls[0][0]).toEqual({ claimId: 'claim-1', data: { status: 'Rejected', rejectionCode: code } })
  })

  it('sends another code as it was typed, trimmed, under Other', async () => {
    renderPage()
    const { user, dialog } = await openRejection()

    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'NDIA rejection code (optional)' }), 'Other')
    await user.type(within(dialog).getByRole('textbox', { name: 'The code the NDIA gave' }), ' E104 ')
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Rejected' }))

    expect(mockUpdateClaim.mock.calls[0][0]).toEqual({ claimId: 'claim-1', data: { status: 'Rejected', rejectionCode: 'E104' } })
  })

  it('closes the dialog when the claim is rejected, and keeps it open, saying why, when the server refuses', async () => {
    renderPage()
    const first = await openRejection()
    mockUpdateClaim.mockImplementationOnce((_vars, opts) => opts?.onError?.({ response: { data: { errors: ['The NDIA code is at most 10 characters.'] } } }))
    await first.user.click(within(first.dialog).getByRole('button', { name: 'Mark as Rejected' }))
    expect(within(first.dialog).getByRole('alert')).toHaveTextContent('The NDIA code is at most 10 characters.')

    mockUpdateClaim.mockImplementationOnce((_vars, opts) => opts?.onSuccess?.())
    await first.user.click(within(first.dialog).getByRole('button', { name: 'Mark as Rejected' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('calls off with Cancel and sends nothing', async () => {
    renderPage()
    const { user, dialog } = await openRejection()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mockUpdateClaim).not.toHaveBeenCalled()
  })

  it('leaves Mark as Submitted and Mark as Paid as plain confirmations: they have no code to ask for', async () => {
    const user = userEvent.setup()
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })   // a draft
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: 'Mark as Submitted' }))
    let dialog = screen.getByRole('alertdialog', { name: 'Mark as submitted?' })
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Submitted' }))
    expect(mockUpdateClaim.mock.calls[0][0]).toEqual({ claimId: 'claim-1', data: { status: 'Submitted' } })
    unmount()

    mockUseClaim.mockReturnValue({ data: submitted(), isLoading: false })
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Mark as Paid' }))
    dialog = screen.getByRole('alertdialog', { name: 'Mark as paid?' })
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Mark as Paid' }))
    expect(mockUpdateClaim.mock.calls[1][0]).toEqual({ claimId: 'claim-1', data: { status: 'Paid' } })
  })

  describe('on a claim the NDIA has rejected', () => {
    const rejected = (changes: Record<string, unknown> = {}) => ({ ...baseClaim([baseLineItem({ status: 'Rejected' })]), status: 'Rejected' as const, ...changes })
    const day = (instant: string) => new Date(instant).toLocaleDateString('en-AU')

    it('shows when it was rejected and the code the NDIA gave', () => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z', rejectionCode: 'V27' }), isLoading: false })
      renderPage()

      expect(screen.getByText(/NDIA code V27/)).toHaveTextContent(`${day('2026-10-08T03:00:00Z')} · NDIA code V27`)
    })

    it('says no code was recorded, rather than leaving a gap, when the claim was rejected without one', () => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z' }), isLoading: false })
      renderPage()

      expect(screen.getByText(/no NDIA code recorded/)).toHaveTextContent(`${day('2026-10-08T03:00:00Z')} · no NDIA code recorded`)
    })

    it('shows an en dash for the day of a claim rejected before the day was kept', () => {
      mockUseClaim.mockReturnValue({ data: rejected(), isLoading: false })
      renderPage()

      expect(screen.getByText(/no NDIA code recorded/)).toHaveTextContent('— · no NDIA code recorded')
    })

    it('offers nothing more to do with the status', () => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectionCode: 'V27' }), isLoading: false })
      renderPage()

      expect(screen.queryByRole('button', { name: /^Mark as/ })).not.toBeInTheDocument()
    })
  })

  it('says nothing of a rejection on a claim that is not rejected', () => {
    renderPage()

    expect(screen.queryByText(/NDIA code/)).not.toBeInTheDocument()
  })
})

// Saving the notes flashes "Saved!" for two seconds, then a timer puts the label back. That timer was a bare setTimeout: left running past the page
// it fired setSaved into a tree that was gone, and past the end of the test environment it threw "window is not defined", which fails the whole
// run even though every test passed. The notes are saved twice inside the window because the second save has to cancel the first one's timer,
// not leave it running beside its own, or that first timer would outlive the page all the same.
describe('ClaimDetailPage — the "Saved!" reset timer', () => {
  afterEach(() => {
    vi.useRealTimers()
    mockUpdateClaim.mockReset()
  })

  it('leaves nothing pending when the page unmounts inside the two seconds after saving the notes', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    mockUpdateClaim.mockImplementation((_vars, opts) => opts?.onSuccess?.())
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { unmount } = renderPage()
    const save = () => screen.getByRole('button', { name: /^(Save Notes|Saved!)$/ })

    fireEvent.click(save())
    expect(save()).toHaveTextContent('Saved!')
    act(() => { vi.advanceTimersByTime(500) })
    fireEvent.click(save())
    expect(mockUpdateClaim).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
