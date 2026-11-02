import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ClaimDetailPage from './ClaimDetailPage'
import type { ClaimLineItemDto, TripClaimDetailDto } from '@/api/types'
import { formatDateAu } from '@/lib/utils'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockFetchClaimFile, mockUseClaim, mockUpdateClaim, mockUpdateLineItem, mockUseClaimInvoices, mockUseSubmitPreview } = vi.hoisted(() => ({
  mockFetchClaimFile: vi.fn(),
  mockUseSubmitPreview: vi.fn(),
  mockUseClaim: vi.fn(),
  mockUseClaimInvoices: vi.fn(),
  mockUpdateClaim: vi.fn(),
  mockUpdateLineItem: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useClaim: mockUseClaim,
  useUpdateClaim: () => ({ mutate: mockUpdateClaim, isPending: false }),
  useUpdateClaimLineItem: () => ({ mutate: mockUpdateLineItem, isPending: false }),
  // The Invoices section (Xero PR1): its own query; InvoicesSection.test.tsx covers what it shows.
  useClaimInvoices: mockUseClaimInvoices,
  useVoidInvoice: () => ({ mutate: vi.fn(), isPending: false }),
  useIssueCreditNote: () => ({ mutate: vi.fn(), isPending: false }),
  // The submit confirm (SubmitClaimDialog.test.tsx covers its words): one invoice to issue by default, so Confirm is not held.
  useSubmitPreview: mockUseSubmitPreview,
}))

// The claim's own NDIA file (G9): the hub's download helper, mocked as the server's answer.
vi.mock('@/api/hooks/claimHub', () => ({ fetchClaimFile: mockFetchClaimFile, useBuildClaimFile: () => mockFetchClaimFile }))

beforeEach(() => {
  const noInvoices = { invoiceState: 'preview', invoices: [], groups: [], agencyCount: 0 }
  mockUseClaimInvoices.mockReturnValue({ data: noInvoices, isLoading: false, refetch: vi.fn().mockResolvedValue({ data: noInvoices }) })
  mockUseSubmitPreview.mockReturnValue({ data: { claims: [{ claimId: 'claim-1', toIssue: [{ groupId: 'b-1', participantName: 'Priya Nair', billToName: 'Priya Nair', total: 480, predictedNumber: 'INV-0042' }], alreadyIssued: 0, missingSettings: false }], invoiceCount: 1 }, isLoading: false })
})

// ClaimDetailPage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker — that
// throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router (same
// requirement IncidentCreatePage.test.tsx documents).
function renderPage(initialEntry = '/claims/claim-1') {
  const router = createMemoryRouter(
    [
      { path: '/claims/:id', element: <ClaimDetailPage /> },
      { path: '/trips/:id', element: <div>Trip detail</div> },
      { path: '/trips', element: <div>Trips list</div> },
      { path: '/claims', element: <div>Claims hub</div> },
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
// VA follow-up: the claim's dates are UTC instants. Near midnight UTC they fall on the next day in Sydney, and one sent without a zone is UTC.
describe('ClaimDetailPage — instants near midnight', () => {
  afterEach(restoreZone)

  it("shows Created, Submitted and Rejected on the viewer's day", () => {
    if (!setZone('Australia/Sydney')) return
    mockUseClaim.mockReturnValue({
      data: { ...baseClaim([baseLineItem()]), status: 'Rejected', createdAt: '2026-03-01T23:30:00Z', submittedDate: '2026-03-02T23:30:00', rejectedDate: '2026-03-03T23:30:00Z', rejectionCode: 'V17' },
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('02/03/2026')).toBeInTheDocument()
    expect(screen.getByText('03/03/2026')).toBeInTheDocument()
    expect(screen.getByText(/04\/03\/2026/)).toBeInTheDocument()
  })
})

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

describe('ClaimDetailPage — Invoices section (Xero PR1)', () => {
  it('puts the Invoices card after the budget and before the notes, its h2 focusable for after a submit', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    renderPage()

    const heading = screen.getByRole('heading', { name: 'Invoices' })
    expect(heading).toHaveAttribute('tabindex', '-1')
    const notes = screen.getByRole('button', { name: 'Add notes' })
    expect(heading.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(mockUseClaimInvoices).toHaveBeenCalledWith('claim-1')
  })

  it.each(['PlanManaged', 'SelfManaged'] as const)('no longer offers a per-line Invoice download on a %s line: the Invoices card has one row per payer', planType => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ planType })]), isLoading: false })
    renderPage()

    expect(screen.queryByRole('button', { name: 'Invoice' })).not.toBeInTheDocument()
  })

  it.each(['Draft', 'Ready', 'Rejected'] as const)('offers Mark as Submitted on a %s claim (the moves CanMove allows; Rejected is the reissue path)', status => {
    mockUseClaim.mockReturnValue({ data: { ...baseClaim([baseLineItem()]), status }, isLoading: false })
    renderPage()
    expect(screen.getByRole('button', { name: 'Mark as Submitted' })).toBeInTheDocument()
  })

  it.each(['Submitted', 'Paid'] as const)('does not offer Mark as Submitted on a %s claim', status => {
    mockUseClaim.mockReturnValue({ data: { ...baseClaim([baseLineItem()]), status }, isLoading: false })
    renderPage()
    expect(screen.queryByRole('button', { name: 'Mark as Submitted' })).not.toBeInTheDocument()
  })

  it('after a submit, announces the numbers issued and moves focus to the Invoices heading (the button that opened the dialog has gone)', async () => {
    const user = userEvent.setup()
    const after = { invoiceState: 'issued', groups: [], agencyCount: 0, invoices: [{ id: 'inv-42', kind: 'Invoice', number: 42, displayNumber: 'INV-0042', status: 'Issued', groupId: 'b-1', participantName: 'Priya Nair', billToName: 'Priya Nair', payerKind: 'SelfManaged', issueDate: '2026-10-22', total: 480, paymentRecorded: false }] }
    mockUseClaimInvoices.mockReturnValue({ data: { invoiceState: 'preview', invoices: [], groups: [], agencyCount: 0 }, isLoading: false, refetch: vi.fn().mockResolvedValue({ data: after }) })
    mockUpdateClaim.mockImplementation((_vars, opts) => opts.onSuccess())
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mark as Submitted' }))
    await user.click(within(screen.getByRole('alertdialog', { name: 'Mark as submitted?' })).getByRole('button', { name: 'Mark as Submitted' }))

    expect(mockUpdateClaim.mock.calls[0][0]).toEqual({ claimId: 'claim-1', data: { status: 'Submitted' } })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getAllByRole('status').some(el => el.textContent === 'Claim submitted. Issued INV-0042.')).toBe(true)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Invoices' })).toHaveFocus())
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

  it('says a claim with no line items has none yet, not "No data"', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([]), isLoading: false })
    renderPage()
    expect(screen.getByText('No line items on this claim yet.')).toBeInTheDocument()
    expect(screen.queryByText('No data')).not.toBeInTheDocument()
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

  it('shows the day type as its label, not the raw enum', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([shiftLineItem({ dayType: 'WeekdayEvening' })]), isLoading: false })
    renderPage('/claims/claim-2')

    expect(screen.getByText('Weekday Evening')).toBeInTheDocument()
    expect(screen.queryByText('WeekdayEvening')).not.toBeInTheDocument()
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
    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips')
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

    it.each([
      ['V17', 'not enough in the plan'], ['V18', 'not enough in the plan'], ['V27', 'not enough in the funding period'], ['V28', 'not enough in the funding period'],
    ])('says what %s means in the words the dialog used when it was chosen: %s', (code, meaning) => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z', rejectionCode: code }), isLoading: false })
      renderPage()

      expect(screen.getByText(/NDIA code/)).toHaveTextContent(`NDIA code ${code} (${meaning})`)
    })

    it('prints any other code as it was typed, with no meaning made up for it', () => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z', rejectionCode: 'E104' }), isLoading: false })
      renderPage()

      expect(screen.getByText(/NDIA code E104/).textContent).toMatch(/NDIA code E104$/)
    })

    // The reason a claim was refused often arrives after its status was set, and the code is the one input that switches the warning on: a claim rejected with no code must be able to be given one.
    it('offers to record the code on a claim rejected without one, and not on a claim that has one', () => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z' }), isLoading: false })
      const first = renderPage()
      expect(screen.getByRole('button', { name: 'Record the NDIA code' })).toBeInTheDocument()
      first.unmount()

      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z', rejectionCode: 'V27' }), isLoading: false })
      renderPage()
      expect(screen.queryByRole('button', { name: 'Record the NDIA code' })).not.toBeInTheDocument()
    })

    it('records the code on its own, with no status in the request: the claim stays as it is', async () => {
      const user = userEvent.setup()
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z' }), isLoading: false })
      renderPage()

      await user.click(screen.getByRole('button', { name: 'Record the NDIA code' }))
      const dialog = screen.getByRole('alertdialog', { name: 'Record the NDIA code' })
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'NDIA rejection code' }), 'V18')
      await user.click(within(dialog).getByRole('button', { name: 'Save the code' }))

      expect(mockUpdateClaim).toHaveBeenCalledTimes(1)
      expect(mockUpdateClaim.mock.calls[0][0]).toEqual({ claimId: 'claim-1', data: { rejectionCode: 'V18' } })
    })

    it('says the server\'s refusal in the dialog and keeps it open, so the code can be tried again', async () => {
      const user = userEvent.setup()
      mockUseClaim.mockReturnValue({ data: rejected({ rejectedDate: '2026-10-08T03:00:00Z' }), isLoading: false })
      renderPage()
      mockUpdateClaim.mockImplementationOnce((_vars, opts) => opts?.onError?.({ response: { data: { errors: ['The NDIA code is at most 10 characters.'] } } }))

      await user.click(screen.getByRole('button', { name: 'Record the NDIA code' }))
      const dialog = screen.getByRole('alertdialog', { name: 'Record the NDIA code' })
      await user.selectOptions(within(dialog).getByRole('combobox', { name: 'NDIA rejection code' }), 'V27')
      await user.click(within(dialog).getByRole('button', { name: 'Save the code' }))

      expect(within(dialog).getByRole('alert')).toHaveTextContent('The NDIA code is at most 10 characters.')
    })

    it('offers only the reissue: Mark as Submitted (Xero PR1, SHAPE section 3)', () => {
      mockUseClaim.mockReturnValue({ data: rejected({ rejectionCode: 'V27' }), isLoading: false })
      renderPage()

      expect(screen.getAllByRole('button', { name: /^Mark as/ }).map(b => b.textContent?.trim())).toEqual(['Mark as Submitted'])
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
    fireEvent.click(screen.getByRole('button', { name: 'Add notes' }))
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

describe('ClaimDetailPage — existing notes', () => {
  it('keeps the editor available after clearing existing notes so the empty value can be saved', () => {
    mockUseClaim.mockReturnValue({ data: { ...baseClaim([baseLineItem()]), notes: 'Existing note' }, isLoading: false })
    renderPage()
    const notes = screen.getByLabelText('Notes')
    fireEvent.change(notes, { target: { value: '' } })
    expect(notes).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save Notes' })).toBeInTheDocument()
  })
})

// Standard 8: money goes through formatCurrency, so the fact bar shows the thousands separator the line and the footer already had.
describe('ClaimDetailPage — the total in the fact bar', () => {
  it('formats the total as AUD with a thousands separator (fact bar, line and footer)', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ totalAmount: 1234.5 })]), isLoading: false })
    renderPage()
    expect(screen.queryByText('$1234.50')).toBeNull()
    expect(screen.getAllByText('$1,234.50')).toHaveLength(3)
  })
})

// The server refuses a change to a line's figures or type once the claim has gone to the NDIA, so the page stops offering the buttons that make that change.
describe('ClaimDetailPage — No Show and Mark Confirmed belong to a draft claim', () => {
  it('offers No Show on a draft claim', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    renderPage()
    expect(screen.getByRole('button', { name: 'No Show' })).toBeInTheDocument()
  })

  it.each(['Submitted', 'Paid', 'Rejected'] as const)('offers neither No Show nor Mark Confirmed on a %s claim, and still shows who was a no show', (status) => {
    mockUseClaim.mockReturnValue({
      data: { ...baseClaim([baseLineItem(), baseLineItem({ id: 'li-3', claimType: 'Cancellation', cancellationReason: 'Unwell' })]), status },
      isLoading: false,
    })
    renderPage()
    expect(screen.queryByRole('button', { name: 'No Show' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark Confirmed' })).not.toBeInTheDocument()
    expect(screen.getByText('No Show · Unwell')).toBeInTheDocument()
  })

  it('offers Mark Confirmed on a draft claim', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ claimType: 'Cancellation', cancellationReason: 'Unwell' })]), isLoading: false })
    renderPage()
    expect(screen.getByRole('button', { name: 'Mark Confirmed' })).toBeInTheDocument()
  })

  it("says, in the Mark as Submitted confirm, that the lines can't be changed after it", async () => {
    const user = userEvent.setup()
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })   // a draft
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mark as Submitted' }))

    expect(screen.getByRole('alertdialog', { name: 'Mark as submitted?' })).toHaveTextContent("Mark this claim as submitted to the NDIA? You can't change its lines after this.")
  })

  it("shows the server's reason on the page when Mark Confirmed is refused (the claim moved on while the page was open)", async () => {
    const user = userEvent.setup()
    mockUpdateLineItem.mockImplementation((_vars, opts) => opts.onError({ response: { data: { errors: ["This claim has been submitted, so its lines can't be changed."] } } }))
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ claimType: 'Cancellation', cancellationReason: 'Unwell' })]), isLoading: false })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Mark Confirmed' }))

    expect(screen.getByRole('alert')).toHaveTextContent("This claim has been submitted, so its lines can't be changed.")
  })
})

// The claim page had no Back: the house icon Back sits before the title, falling back to the trips list.
describe('ClaimDetailPage — Back', () => {
  it('is the icon Back before the title, a real link whose fallback is /trips', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    renderPage()

    const back = screen.getByRole('link', { name: 'Back to trips' })
    expect(back).toHaveAttribute('href', '/trips')
    expect(back.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe("ClaimDetailPage: the claim's own NDIA file (G9)", () => {
  it('builds it from the claim, then opens it in Claims', async () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    mockFetchClaimFile.mockResolvedValue({ batchId: 'b-5', fileName: 'BPR261030005.csv' })
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Build NDIA file' }))
    expect(mockFetchClaimFile).toHaveBeenCalledWith('get', '/claims/claim-1/bpr-csv', undefined, 'CLM-001.csv', expect.any(String))
    expect(await screen.findByText('Claims hub')).toBeInTheDocument()
  })

  it("shows the server's 409 where it happened and stays on the claim", async () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem()]), isLoading: false })
    mockFetchClaimFile.mockRejectedValue(new Error("This claim was sent in BPR261028001.csv. Import that file's results in Claims before lodging it again."))
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Build NDIA file' }))
    expect(await screen.findByText(/This claim was sent in BPR261028001.csv/)).toBeInTheDocument()
    expect(screen.queryByText('Claims hub')).toBeNull()
  })

  it('has no NDIA file button when no line is NDIA-managed', () => {
    mockUseClaim.mockReturnValue({ data: baseClaim([baseLineItem({ planType: 'PlanManaged' })]), isLoading: false })
    renderPage()
    expect(screen.queryByRole('button', { name: 'Build NDIA file' })).toBeNull()
    expect(screen.queryByText('BPR CSV')).toBeNull()
  })
})

describe('ClaimDetailPage, shift billing PR4 words', () => {
  const NOTE = /Part of a shift on this claim was rejected/
  const sleepover = () => shiftLineItem({ id: 'li-s', shiftId: 'sh-1', unit: 'E', hours: 1, dayType: 'Weekday', supportItemCode: '01_010_0107_1_1' })
  const partlyRejected = () => [
    shiftLineItem({ id: 'li-a', shiftId: 'sh-2', status: 'Rejected', rejectionReason: 'V17' }),
    shiftLineItem({ id: 'li-b', shiftId: 'sh-2', status: 'Submitted' }),
  ]

  it('reads a sleepover line as Sleepover and 1 night, and an hourly line as its day type and hours', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([sleepover(), shiftLineItem({ id: 'li-h', shiftId: 'sh-3', unit: 'H', hours: 8, dayType: 'WeekdayNight' })]), isLoading: false })
    renderPage('/claims/claim-2')

    expect(screen.getByText('Sleepover')).toBeInTheDocument()
    expect(screen.getByText('1 night')).toBeInTheDocument()
    expect(screen.getByText('Weekday Night')).toBeInTheDocument()
    expect(screen.getByText('8h')).toBeInTheDocument()
  })

  it('shows the take-back note once for a part-rejected shift, however many shifts qualify', () => {
    const second = [shiftLineItem({ id: 'li-c', shiftId: 'sh-4', status: 'Rejected' }), shiftLineItem({ id: 'li-d', shiftId: 'sh-4', status: 'Paid' })]
    mockUseClaim.mockReturnValue({ data: shiftClaim([...partlyRejected(), ...second], { status: 'PartiallyPaid' }), isLoading: false })
    renderPage('/claims/claim-2')

    expect(screen.getAllByText(NOTE)).toHaveLength(1)
    expect(screen.getByText(/change that line's status back and include it in the next file/)).toBeInTheDocument()
  })

  it('shows no note when no shift is part-rejected', () => {
    mockUseClaim.mockReturnValue({ data: shiftClaim([shiftLineItem({ shiftId: 'sh-5', status: 'Submitted' })], { status: 'Submitted' }), isLoading: false })
    renderPage('/claims/claim-2')
    expect(screen.queryByText(NOTE)).toBeNull()
  })

  it.each(['Rejected', 'Cancelled'] as const)('shows no note on a %s claim', status => {
    mockUseClaim.mockReturnValue({ data: shiftClaim(partlyRejected(), { status }), isLoading: false })
    renderPage('/claims/claim-2')
    expect(screen.queryByText(NOTE)).toBeNull()
  })
})
