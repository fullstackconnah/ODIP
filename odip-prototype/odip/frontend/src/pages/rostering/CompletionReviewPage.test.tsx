import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CompletionReviewPage from './CompletionReviewPage'
import type { CompletionQueueItemDto, ShiftCompletionDto, PagedResult, StaffListDto } from '@/api/types'
import { emptyCompletionPackage } from '@/test/fixtures/shiftPackage'

const {
  mockUseCompletions, mockUseCompletion, mockUseStaff,
  mockApproveMutateAsync, mockReturnMutateAsync, mockApproveBatchMutateAsync,
} = vi.hoisted(() => ({
  mockUseCompletions: vi.fn(),
  mockUseCompletion: vi.fn((): { data: ShiftCompletionDto | undefined } => ({ data: undefined })),
  mockUseStaff: vi.fn(() => ({ data: [{ id: 'staff-1', fullName: 'Jack O\'Sullivan' }, { id: 'staff-2', fullName: 'Mei Zhang' }] as StaffListDto[] })),
  mockApproveMutateAsync: vi.fn(),
  mockReturnMutateAsync: vi.fn(),
  mockApproveBatchMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useCompletions: mockUseCompletions,
  useCompletion: mockUseCompletion,
  useStaff: mockUseStaff,
  useApproveCompletion: () => ({ mutateAsync: mockApproveMutateAsync, isPending: false }),
  useReturnCompletion: () => ({ mutateAsync: mockReturnMutateAsync, isPending: false }),
  useApproveCompletionsBatch: () => ({ mutateAsync: mockApproveBatchMutateAsync, isPending: false }),
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
})

describe('CompletionReviewPage', () => {
  it('defaults the status filter to PendingReview', () => {
    renderPage()
    expect(mockUseCompletions).toHaveBeenCalledWith(expect.objectContaining({ status: 'PendingReview' }), 1, 50)
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

    await user.click(screen.getByRole('button', { name: /^approve$/i }))
    const dialog = screen.getByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^approve$/i }))

    expect(mockApproveMutateAsync).toHaveBeenCalledWith('shift-1')
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

    await user.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(screen.getByText(/incidents during this shift/i)).toBeInTheDocument()
    expect(screen.getByText(/missed evening medication dose/i)).toBeInTheDocument()
  })

  it('requires a reason before confirming a Return, then submits the full request body', async () => {
    const user = userEvent.setup()
    mockUseCompletions.mockReturnValue({ data: makePaged([makeQueueItem({ shiftId: 'shift-1' })]), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    await user.click(screen.getByRole('button', { name: /^return$/i }))
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

    expect(screen.queryByRole('button', { name: /^approve$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^return$/i })).not.toBeInTheDocument()
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

    expect(screen.getByText(/75 shifts · page 1 of 2/i)).toBeInTheDocument()
    const nextButton = screen.getByRole('button', { name: /next/i })
    expect(nextButton).not.toBeDisabled()
    await user.click(nextButton)

    expect(mockUseCompletions).toHaveBeenCalledWith(expect.objectContaining({ status: 'PendingReview' }), 2, 50)
  })
})
