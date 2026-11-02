import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CompletionReviewPage from './CompletionReviewPage'
import type { CompletionQueueItemDto, ShiftCompletionDto, PagedResult, StaffListDto } from '@/api/types'
import { emptyCompletionPackage } from '@/test/fixtures/shiftPackage'

const {
  mockUseCompletions, mockUseCompletion, mockUseStaff,
  mockApproveMutateAsync, mockReturnMutateAsync, mockApproveBatchMutateAsync, mockEditTravelMutateAsync, mockUsePricing,
} = vi.hoisted(() => ({
  mockUseCompletions: vi.fn(),
  mockUseCompletion: vi.fn((): { data: ShiftCompletionDto | undefined } => ({ data: undefined })),
  mockUseStaff: vi.fn(() => ({ data: [{ id: 'staff-1', fullName: 'Jack O\'Sullivan' }, { id: 'staff-2', fullName: 'Mei Zhang' }] as StaffListDto[] })),
  mockApproveMutateAsync: vi.fn(),
  mockReturnMutateAsync: vi.fn(),
  mockApproveBatchMutateAsync: vi.fn(),
  mockEditTravelMutateAsync: vi.fn(),
  mockUsePricing: vi.fn((): { data: { claimProviderTravel: boolean } | undefined } => ({ data: { claimProviderTravel: true } })),
}))

vi.mock('@/api/hooks', () => ({
  useCompletions: mockUseCompletions,
  useCompletion: mockUseCompletion,
  useStaff: mockUseStaff,
  useApproveCompletion: () => ({ mutateAsync: mockApproveMutateAsync, isPending: false }),
  useReturnCompletion: () => ({ mutateAsync: mockReturnMutateAsync, isPending: false }),
  useApproveCompletionsBatch: () => ({ mutateAsync: mockApproveBatchMutateAsync, isPending: false }),
  useEditCompletionTravel: () => ({ mutateAsync: mockEditTravelMutateAsync, isPending: false }),
  usePlanPricingSettings: mockUsePricing,
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function makeQueueItem(overrides: Partial<CompletionQueueItemDto> = {}): CompletionQueueItemDto {
  return {
    shiftId: 'shift-1',
    completionId: 'sc-1',
    participantName: 'Liam Okafor',
    staffName: "Jack O'Sullivan",
    serviceDate: '2026-09-08',
    rosteredStart: '2026-09-08T08:00:00Z',
    rosteredEnd: '2026-09-08T16:00:00Z',
    actualStart: '2026-09-08T07:58:00Z',
    actualEnd: '2026-09-08T16:05:00Z',
    varianceMinutesStart: -2,
    varianceMinutesEnd: 5,
    status: 'PendingReview',
    timeZoneId: 'Australia/Brisbane',
    isOutlierVariance: false,
    varianceReviewMinutes: 15,
    returnCount: 0,
    dosesWithoutOutcome: 0,
    breakMinutes: 0,
    startWasManual: false,
    timesAdjusted: false,
    incidentCount: 0,
    ...overrides,
  }
}

function makePaged(items: CompletionQueueItemDto[], overrides: Partial<PagedResult<CompletionQueueItemDto>> = {}): PagedResult<CompletionQueueItemDto> {
  return {
    items,
    totalCount: items.length,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    hasNext: false,
    hasPrevious: false,
    ...overrides,
  }
}

function makeCompletionDetail(overrides: Partial<ShiftCompletionDto> = {}): ShiftCompletionDto {
  return {
    id: 'sc-1',
    shiftId: 'shift-1',
    actualStart: '2026-09-08T07:58:00Z',
    actualEnd: '2026-09-08T16:05:00Z',
    timeZoneId: 'Australia/Brisbane',
    geolocationDeclined: false,
    startWasManual: false,
    submittedByUserId: 'staff-1',
    submittedByName: "Jack O'Sullivan",
    startedAt: '2026-09-08T07:58:00Z',
    submittedAt: '2026-09-08T16:05:00Z',
    reviewedByUserId: null,
    reviewedByName: null,
    reviewedAt: null,
    reviewOutcome: null,
    returnReason: null,
    varianceMinutesStart: -2,
    varianceMinutesEnd: 5,
    isOutlierVariance: false,
    varianceReviewMinutes: 15,
    shiftReturnCount: 0,
    incidents: [],
    ...emptyCompletionPackage(),
    ...overrides,
  }
}

function renderPage(qc: QueryClient = new QueryClient()) {
  return render(<QueryClientProvider client={qc}><CompletionReviewPage /></QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  setUserRole('Coordinator')
  mockUseCompletions.mockReturnValue({ data: makePaged([]), isLoading: false, isError: false, refetch: vi.fn() })
  mockUseCompletion.mockReturnValue({ data: undefined })
  mockApproveMutateAsync.mockReset().mockResolvedValue(makeCompletionDetail())
  mockReturnMutateAsync.mockReset().mockResolvedValue(makeCompletionDetail())
  mockApproveBatchMutateAsync.mockReset().mockResolvedValue([])
  mockEditTravelMutateAsync.mockReset().mockResolvedValue(makeCompletionDetail())
  mockUsePricing.mockReturnValue({ data: { claimProviderTravel: true } })
})

describe('CompletionReviewPage', () => {
  it('defaults the status filter to PendingReview', () => {
    renderPage()
    expect(mockUseCompletions).toHaveBeenCalledWith(expect.objectContaining({ status: 'PendingReview' }), 1, 50)
  })

  it('names the staff filter for a screen reader', () => {
    renderPage()
    expect(screen.getByRole('combobox', { name: 'Filter by staff' })).toBeInTheDocument()
  })

  it('renders queue rows with participant, staff and a variance badge', () => {
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem()]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Liam Okafor')).toBeInTheDocument()
    expect(screen.getByText("Jack O'Sullivan")).toBeInTheDocument()
    expect(screen.getByText(/-2 min/)).toBeInTheDocument()
    expect(screen.getByText(/\+5 min/)).toBeInTheDocument()
  })

  it('shows an empty state when no rows match the filters', () => {
    mockUseCompletions.mockReturnValue({ data: makePaged([]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText(/no completions match these filters/i)).toBeInTheDocument()
  })

  it('approves a shift via the confirm dialog', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ shiftId: 'shift-1' })]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^approve$/i }))

    expect(mockApproveMutateAsync).toHaveBeenCalledWith('shift-1')
  })

  it('writes the shift date in the long house format in the action labels and the dialog, and numeric in the table', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ serviceDate: '2026-09-08' })]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByRole('button', { name: "Approve Jack O'Sullivan with Liam Okafor on Tue 8 Sep 2026" })).toBeInTheDocument()
    expect(screen.getAllByText('08/09/2026').length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /^return jack o'sullivan/i }))
    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain('shift on Tue\u00a08\u00a0Sep\u00a02026 to')
    expect(dialog.textContent).not.toContain('08/09/2026')
  })

  it('shows the incidents list above the approve/return actions when the lazily-fetched detail has incidents', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ shiftId: 'shift-1' })]), isLoading: false, isError: false, refetch: vi.fn() })
    mockUseCompletion.mockReturnValue({
      data: makeCompletionDetail({
        incidents: [{ id: 'inc-1', title: 'Missed evening medication dose', severity: 'Medium', status: 'UnderReview', incidentDateTime: '2026-09-08T20:00:00Z' }],
      }),
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))

    expect(screen.getByText(/incidents during this shift/i)).toBeInTheDocument()
    expect(screen.getByText(/missed evening medication dose/i)).toBeInTheDocument()
  })

  it('marks a completion sent from offline in the approve dialog, with when it reached Bunya Support; an online one has no marker', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ shiftId: 'shift-1' })]), isLoading: false, isError: false, refetch: vi.fn() })
    mockUseCompletion.mockReturnValue({ data: makeCompletionDetail({ sentFromOffline: true, submittedAt: '2026-09-08T04:41:00Z' }) })
    const { unmount } = renderPage()
    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))
    expect(screen.getByText('Sent from offline')).toBeInTheDocument()
    expect(screen.getByText('Reached Bunya Support 2:41 pm')).toBeInTheDocument()
    unmount()

    mockUseCompletion.mockReturnValue({ data: makeCompletionDetail({ sentFromOffline: false }) })
    renderPage()
    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))
    expect(screen.queryByText('Sent from offline')).not.toBeInTheDocument()
  })

  it('requires a reason before confirming a Return, then submits the full request body', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ shiftId: 'shift-1' })]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^return jack o'sullivan with liam okafor on /i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^return$/i }))

    expect(mockReturnMutateAsync).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/reason is required/i)

    await user.type(within(dialog).getByRole('textbox'), 'Actual times look off by an hour.')
    await user.click(within(dialog).getByRole('button', { name: /^return$/i }))

    expect(mockReturnMutateAsync).toHaveBeenCalledWith({
      shiftId: 'shift-1',
      data: { reason: 'Actual times look off by an hour.' },
    })
  })

  it('batch-approves selected rows and reports per-row results', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({
      data: makePaged([makeQueueItem({ shiftId: 'shift-1' }), makeQueueItem({ shiftId: 'shift-2', participantName: 'Grace Palmer-Hughes' })]),
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    mockApproveBatchMutateAsync.mockResolvedValue([
      { shiftId: 'shift-1', approved: true, code: null, message: null },
      { shiftId: 'shift-2', approved: false, code: 'SHIFT_NOT_PENDING_REVIEW', message: 'This shift is not pending review.' },
    ])
    renderPage()

    await user.click(screen.getByLabelText('Select row shift-1'))
    await user.click(screen.getByLabelText('Select row shift-2'))
    await user.click(screen.getByRole('button', { name: /approve selected \(2\)/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /approve all/i }))

    expect(mockApproveBatchMutateAsync).toHaveBeenCalledWith(['shift-1', 'shift-2'])
    expect(await screen.findByText(/1 approved, 1 failed/i)).toBeInTheDocument()
    expect(screen.getByText(/this shift is not pending review/i)).toBeInTheDocument()
  })

  it('hides approve/return/batch actions and shows a read-only note for ReadOnly', () => {
    setUserRole('ReadOnly')
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem()]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^return/i })).not.toBeInTheDocument()
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument()
  })

  it('shows an incidents indicator once the shift completion detail is already cached', () => {
    const qc = new QueryClient()
    qc.setQueryData(['rostering-completion', 'shift-1'], makeCompletionDetail({
      incidents: [{ id: 'inc-1', title: 'Fall in the bathroom', severity: 'High', status: 'UnderReview', incidentDateTime: '2026-09-08T10:00:00Z' }],
    }))
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ shiftId: 'shift-1' })]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage(qc)

    expect(screen.getByText(/1 incident/i)).toBeInTheDocument()
  })

  it('paginates using the PagedResult total, moving to page 2 on Next', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({
      data: makePaged([makeQueueItem()], { totalCount: 75, totalPages: 2, hasNext: true, hasPrevious: false }),
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    const nextButton = screen.getByRole('button', { name: 'Next page' })
    expect(nextButton).not.toBeDisabled()
    await user.click(nextButton)

    expect(mockUseCompletions).toHaveBeenCalledWith(expect.objectContaining({ status: 'PendingReview' }), 2, 50)
  })

  it('keeps the selected rows when the page changes, through the table pager', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockImplementation((_filters: unknown, page: number) => ({
      data: makePaged([makeQueueItem({ shiftId: `shift-p${page}` })], { totalCount: 75, totalPages: 2, page, hasNext: page === 1, hasPrevious: page === 2 }),
      isLoading: false, isError: false, refetch: vi.fn(),
    }))
    renderPage()

    await user.click(screen.getByLabelText('Select row shift-p1'))
    expect(screen.getByRole('button', { name: /approve selected \(1\)/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next page' }))

    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /approve selected \(1\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).not.toBeDisabled()
  })
})

// A failed load is the house error banner (a danger Callout, announced at once, with its retry), not an EmptyState that reads as "nothing here".
describe('CompletionReviewPage — a failed load', () => {
  it('shows the error banner with Try again, not an empty state', async () => {
    const refetch = vi.fn()
    mockUseCompletions.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderPage()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/couldn't load shift completions/i)
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })
})

describe('CompletionReviewPage: what the worker confirmed at Finish', () => {
  it('flags only the rows whose times the worker moved, beside the variance badge', () => {
    mockUseCompletions.mockReturnValue({
      data: makePaged([makeQueueItem({ timesAdjusted: true }), makeQueueItem({ shiftId: 'shift-2', completionId: 'sc-2', participantName: 'Mia Chen' })]),
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getAllByText('Times adjusted by the worker')).toHaveLength(1)
  })

  it('shows the stamped and moved times, the reason, the kilometres and the report answer in the review dialog', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ timesAdjusted: true })]), isLoading: false, isError: false, refetch: vi.fn() })
    mockUseCompletion.mockReturnValue({
      data: makeCompletionDetail({
        actualStart: '2026-09-07T21:55:00Z', originalActualStart: '2026-09-07T22:02:00Z', timesAdjusted: true,
        timeAdjustmentReason: 'Arrived early to help with breakfast.', kilometres: 12.5, anythingToReport: true,
      }),
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Start 8:02\s?am, changed to 7:55\s?am\./i)).toBeInTheDocument()
    expect(within(dialog).getByText('Reason: Arrived early to help with breakfast.')).toBeInTheDocument()
    expect(within(dialog).getByText('12.5 km driven with the participant')).toBeInTheDocument()
    expect(within(dialog).getByText('The worker said there was something to report.')).toBeInTheDocument()
  })

  it('says nothing extra for a completion the worker did not change', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem()]), isLoading: false, isError: false, refetch: vi.fn() })
    mockUseCompletion.mockReturnValue({ data: makeCompletionDetail() })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))

    expect(screen.queryByText(/changed to/)).not.toBeInTheDocument()
    expect(screen.queryByText(/km driven/)).not.toBeInTheDocument()
  })
})

describe('CompletionReviewPage: shifts sent back before (review CR-B Must 1)', () => {
  it('says on the queue row how many times the shift was returned, and only when it was', () => {
    mockUseCompletions.mockReturnValue({
      data: makePaged([makeQueueItem({ returnCount: 2 }), makeQueueItem({ shiftId: 'shift-2', completionId: 'sc-2', participantName: 'Mia Chen' })]),
      isLoading: false, isError: false, refetch: vi.fn(),
    })
    renderPage()

    expect(screen.getAllByText('Returned 2 times')).toHaveLength(1)
  })

  it('says it in the review dialog too', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ returnCount: 1 })]), isLoading: false, isError: false, refetch: vi.fn() })
    mockUseCompletion.mockReturnValue({ data: makeCompletionDetail({ shiftReturnCount: 1 }) })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))

    expect(within(screen.getByRole('alertdialog')).getByText('Returned to the worker 1 time before.')).toBeInTheDocument()
  })
})

describe('CompletionReviewPage: provider travel (travel PR-B)', () => {
  const travelled = (over: Partial<ShiftCompletionDto> = {}) => makeCompletionDetail({
    preShiftTravelMinutes: 25, preShiftTravelKilometres: 12.3, postShiftTravelMinutes: 20, postShiftTravelKilometres: 10, ...over,
  })
  async function openApprove(detail: ShiftCompletionDto) {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem()]), isLoading: false, isError: false, refetch: vi.fn() })
    mockUseCompletion.mockReturnValue({ data: detail })
    renderPage()
    await user.click(screen.getByRole('button', { name: /^approve jack o'sullivan with liam okafor on /i }))
    return { user, dialog: screen.getByRole('alertdialog') }
  }

  it('says both trips in the review dialog, and leaves a trip out when both of its values are empty', async () => {
    const { dialog } = await openApprove(travelled({ postShiftTravelMinutes: null, postShiftTravelKilometres: null }))
    expect(within(dialog).getByText('Trip to the participant: 25 min, 12.3 km')).toBeInTheDocument()
    expect(within(dialog).queryByText(/Trip after the shift/)).not.toBeInTheDocument()
  })

  it('saves all four values from Edit travel, then closes the editor and returns focus to the button', async () => {
    const { user, dialog } = await openApprove(travelled())
    await user.click(within(dialog).getByRole('button', { name: 'Edit travel' }))
    const after = within(within(dialog).getByRole('group', { name: 'Trip after the shift' }))
    await user.clear(after.getByLabelText('Minutes'))
    await user.type(after.getByLabelText('Minutes'), '35')
    await user.clear(after.getByLabelText('Kilometres'))
    await user.click(within(dialog).getByRole('button', { name: 'Save travel' }))
    expect(mockEditTravelMutateAsync).toHaveBeenCalledWith({
      shiftId: 'shift-1',
      data: { preShiftTravelMinutes: 25, preShiftTravelKilometres: 12.3, postShiftTravelMinutes: 35, postShiftTravelKilometres: null },
    })
    expect(within(dialog).queryByRole('group', { name: 'Trip after the shift' })).not.toBeInTheDocument()
    // Focus returns on a setTimeout(0) after the editor closes.
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Edit travel' })).toHaveFocus())
  })

  it("shows the server's sentence in a warning when the shift is already on a claim, and keeps the editor open", async () => {
    mockEditTravelMutateAsync.mockRejectedValue({ response: { status: 409, data: { message: 'This shift is on claim CLM-1. Change its travel on the claim, or cancel the claim first.', code: 'SHIFT_TRAVEL_ON_CLAIM' } } })
    const { user, dialog } = await openApprove(travelled())
    await user.click(within(dialog).getByRole('button', { name: 'Edit travel' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save travel' }))
    expect(await within(dialog).findByText(/This shift is on claim CLM-1/)).toBeInTheDocument()
    expect(within(dialog).getByRole('group', { name: 'Trip to the participant' })).toBeInTheDocument()
  })

  it('Cancel leaves the values alone and returns focus to the button', async () => {
    const { user, dialog } = await openApprove(travelled())
    await user.click(within(dialog).getByRole('button', { name: 'Edit travel' }))
    await user.click(within(dialog).getByRole('button', { name: 'Cancel travel edit' }))
    expect(mockEditTravelMutateAsync).not.toHaveBeenCalled()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Edit travel' })).toHaveFocus())
  })

  it('offers no Edit travel when the organisation does not claim travel, or the settings have not loaded', async () => {
    mockUsePricing.mockReturnValue({ data: { claimProviderTravel: false } })
    const { dialog } = await openApprove(travelled())
    expect(within(dialog).queryByRole('button', { name: 'Edit travel' })).not.toBeInTheDocument()
  })

  it('offers no Edit travel while the settings have not loaded', async () => {
    mockUsePricing.mockReturnValue({ data: undefined })
    const { dialog } = await openApprove(travelled())
    expect(within(dialog).queryByRole('button', { name: 'Edit travel' })).not.toBeInTheDocument()
  })

  it('holds Approve, with a hint, while the travel editor is open, and frees it after Cancel or Save', async () => {
    const { user, dialog } = await openApprove(travelled())
    const approve = () => within(dialog).getByRole('button', { name: 'Approve' })
    expect(approve()).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Edit travel' }))
    expect(approve()).toBeDisabled()
    expect(within(dialog).getByText('Save or cancel the travel change first.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel travel edit' }))
    expect(approve()).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Edit travel' }))
    expect(approve()).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Save travel' }))
    await waitFor(() => expect(approve()).toBeEnabled())
  })

  it('refuses a malformed number with "Enter a number" instead of saving it as empty', async () => {
    const { user, dialog } = await openApprove(travelled())
    await user.click(within(dialog).getByRole('button', { name: 'Edit travel' }))
    const minutes = within(within(dialog).getByRole('group', { name: 'Trip to the participant' })).getByLabelText('Minutes')
    Object.defineProperty(minutes, 'validity', { value: { badInput: true }, configurable: true })
    fireEvent.change(minutes, { target: { value: '' } })
    expect(within(dialog).getByText('Enter a number')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save travel' })).toBeDisabled()
    Object.defineProperty(minutes, 'validity', { value: { badInput: false }, configurable: true })
    fireEvent.change(minutes, { target: { value: '30' } })
    expect(within(dialog).queryByText('Enter a number')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save travel' })).toBeEnabled()
  })

  it('tells the coordinator the worker re-enters travel when a shift is returned', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem()]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()
    await user.click(screen.getByRole('button', { name: /^return jack o'sullivan with liam okafor on /i }))
    expect(within(screen.getByRole('alertdialog')).getByText(/The worker enters the shift details again, travel included\./)).toBeInTheDocument()
  })
})
