import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CompletionReviewPage from './CompletionReviewPage'
import type { CompletionQueueItemDto, PagedResult } from '@/api/types'

const { mockUseCompletions, mockApproveBatch, idle } = vi.hoisted(() => ({
  mockUseCompletions: vi.fn(), mockApproveBatch: vi.fn(), idle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@/api/hooks', () => ({
  useCompletions: mockUseCompletions,
  useCompletion: () => ({ data: undefined }),
  useStaff: () => ({ data: [] }),
  useApproveCompletion: idle,
  useReturnCompletion: idle,
  useApproveCompletionsBatch: () => ({ mutateAsync: mockApproveBatch, isPending: false }),
  useEditCompletionTravel: idle,
  useDecideExtraTime: () => ({ ...idle(), variables: undefined }),
  useSetBreakKind: idle,
  usePlanPricingSettings: () => ({ data: { claimProviderTravel: true } }),
}))

const row = (o: Partial<CompletionQueueItemDto> = {}): CompletionQueueItemDto => ({
  shiftId: 'shift-1', completionId: 'sc-1', participantName: 'Liam Okafor', staffName: "Jack O'Sullivan", serviceDate: '2026-09-08',
  rosteredStart: '2026-09-08T08:00:00Z', rosteredEnd: '2026-09-08T16:00:00Z', actualStart: '2026-09-08T07:58:00Z', actualEnd: '2026-09-08T16:05:00Z',
  varianceMinutesStart: -2, varianceMinutesEnd: 5, status: 'PendingReview', timeZoneId: 'Australia/Brisbane', isOutlierVariance: false, varianceReviewMinutes: 15,
  returnCount: 0, dosesWithoutOutcome: 0, breakMinutes: 0, startWasManual: false, timesAdjusted: false, offRoster: false, incidentCount: 0, missingDetails: [], ...o,
} as CompletionQueueItemDto)

const paged = (items: CompletionQueueItemDto[]): PagedResult<CompletionQueueItemDto> =>
  ({ items, totalCount: items.length, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false })

const show = (...items: CompletionQueueItemDto[]) => {
  mockUseCompletions.mockReturnValue({ data: paged(items), isLoading: false, isError: false, refetch: vi.fn() })
  return render(<QueryClientProvider client={new QueryClient()}><CompletionReviewPage /></QueryClientProvider>)
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockApproveBatch.mockReset()
})

describe('CompletionReviewPage - shifts waiting on details', () => {
  it('flags the row, names what is missing and disables Approve with the reason as its description', () => {
    show(row({ missingDetails: ['kilometres', 'tripTo', 'handover'] }))

    expect(screen.getByText('Needs details')).toBeInTheDocument()
    const line = screen.getByText(/Waiting on Jack to add: kilometres, trip to Liam and handover\./)
    const approve = screen.getByRole('button', { name: /^approve jack o'sullivan/i })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAttribute('aria-describedby', line.id)
    expect(screen.getByRole('button', { name: /^return jack o'sullivan/i })).toBeEnabled()
  })

  it('leaves a clean row alone', () => {
    show(row())

    expect(screen.queryByText('Needs details')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^approve jack o'sullivan/i })).toBeEnabled()
  })

  it('says how many a batch left out for missing details, apart from failures', async () => {
    const user = userEvent.setup()
    show(row({ shiftId: 'shift-1' }), row({ shiftId: 'shift-2', missingDetails: ['notes'] }))
    mockApproveBatch.mockResolvedValue([
      { shiftId: 'shift-1', approved: true, code: null, message: null },
      { shiftId: 'shift-2', approved: false, code: 'SHIFT_DETAILS_MISSING', message: 'This shift is waiting on the worker to add its details.' },
    ])

    await user.click(screen.getByLabelText('Select row shift-1'))
    await user.click(screen.getByLabelText('Select row shift-2'))
    await user.click(screen.getByRole('button', { name: /approve selected \(2\)/i }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /approve all/i }))

    expect(await screen.findByText('1 approved, 1 left out: details missing.')).toBeInTheDocument()
  })
})
