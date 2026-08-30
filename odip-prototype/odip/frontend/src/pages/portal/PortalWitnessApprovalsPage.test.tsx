import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PortalWitnessApprovalsPage from './PortalWitnessApprovalsPage'
import type { PortalWitnessRequestDto } from '@/api/types'

const { mockUsePendingWitnessRequests, mockApproveMutateAsync, mockDeclineMutateAsync } = vi.hoisted(() => ({
  mockUsePendingWitnessRequests: vi.fn(),
  mockApproveMutateAsync: vi.fn(),
  mockDeclineMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  usePendingWitnessRequests: mockUsePendingWitnessRequests,
  useApproveWitnessRequest: () => ({ mutateAsync: mockApproveMutateAsync, isPending: false }),
  useDeclineWitnessRequest: () => ({ mutateAsync: mockDeclineMutateAsync, isPending: false }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalWitnessApprovalsPage />
    </MemoryRouter>,
  )
}

function makeRequest(overrides: Partial<PortalWitnessRequestDto> = {}): PortalWitnessRequestDto {
  return {
    id: 'admin-1',
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    medicationId: 'med-1',
    medicationName: 'Insulin',
    strength: '18 units',
    doseDescription: '18 units',
    doseGiven: '18 units',
    recordedByName: 'Jordan Lee',
    administeredAt: '2026-08-24T08:05:00Z',
    witnessStatus: 'Pending',
    witnessRespondedAt: null,
    createdAt: '2026-08-24T08:05:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  mockApproveMutateAsync.mockReset()
  mockDeclineMutateAsync.mockReset()
  mockUsePendingWitnessRequests.mockReturnValue({ data: [], isLoading: false })
})

describe('PortalWitnessApprovalsPage', () => {
  it('shows a loading skeleton (not the empty state) while the request is in flight', () => {
    mockUsePendingWitnessRequests.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderPage()

    expect(screen.getByText(/loading witness requests/i)).toBeInTheDocument()
    expect(screen.queryByText(/no witness requests waiting/i)).not.toBeInTheDocument()
  })

  it('shows a distinct error state (not the empty state) when the request fails', () => {
    const refetch = vi.fn()
    mockUsePendingWitnessRequests.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderPage()

    expect(screen.getByText(/couldn't load witness requests/i)).toBeInTheDocument()
    expect(screen.queryByText(/no witness requests waiting/i)).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no pending witness requests', () => {
    renderPage()
    expect(screen.getByText(/no witness requests waiting/i)).toBeInTheDocument()
  })

  it('renders each pending request with medication, participant and recorder detail', () => {
    mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest()], isLoading: false })
    renderPage()

    expect(screen.getByText(/Insulin 18 units/)).toBeInTheDocument()
    expect(screen.getByText(/Sophie Brown/)).toBeInTheDocument()
    expect(screen.getByText(/Jordan Lee/)).toBeInTheDocument()
  })

  it('approves a request when Approve is clicked', async () => {
    const user = userEvent.setup()
    mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest()], isLoading: false })
    mockApproveMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderPage()

    await user.click(screen.getByRole('button', { name: /approve/i }))

    expect(mockApproveMutateAsync).toHaveBeenCalledWith('admin-1')
    expect(mockDeclineMutateAsync).not.toHaveBeenCalled()
  })

  it('declines a request only after confirming the dialog', async () => {
    const user = userEvent.setup()
    mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest()], isLoading: false })
    mockDeclineMutateAsync.mockResolvedValue({ success: true, data: {} })
    renderPage()

    await user.click(screen.getByRole('button', { name: /decline/i }))
    // Declining is destructive, so it's gated behind a confirm dialog rather than firing immediately.
    expect(mockDeclineMutateAsync).not.toHaveBeenCalled()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(mockDeclineMutateAsync).toHaveBeenCalledWith('admin-1')
  })
})
