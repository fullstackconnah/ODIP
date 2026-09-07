import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PortalWitnessApprovalsPage from './PortalWitnessApprovalsPage'
import type { PortalWitnessRequestDto } from '@/api/types'

const {
  mockUsePendingWitnessRequests, mockApproveMutateAsync, mockDeclineMutateAsync,
  mockApproveIncidentMutateAsync, mockDeclineIncidentMutateAsync,
} = vi.hoisted(() => ({
  mockUsePendingWitnessRequests: vi.fn(),
  mockApproveMutateAsync: vi.fn(),
  mockDeclineMutateAsync: vi.fn(),
  mockApproveIncidentMutateAsync: vi.fn(),
  mockDeclineIncidentMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  usePendingWitnessRequests: mockUsePendingWitnessRequests,
  useApproveWitnessRequest: () => ({ mutateAsync: mockApproveMutateAsync, isPending: false }),
  useDeclineWitnessRequest: () => ({ mutateAsync: mockDeclineMutateAsync, isPending: false }),
  useApproveIncidentWitnessRequest: () => ({ mutateAsync: mockApproveIncidentMutateAsync, isPending: false }),
  useDeclineIncidentWitnessRequest: () => ({ mutateAsync: mockDeclineIncidentMutateAsync, isPending: false }),
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
    sourceType: 'Medication',
    participantId: 'participant-1',
    participantName: 'Sophie Brown',
    medicationId: 'med-1',
    medicationName: 'Insulin',
    strength: '18 units',
    doseDescription: '18 units',
    doseGiven: '18 units',
    incidentReportId: null,
    incidentTitle: null,
    incidentType: null,
    incidentSeverity: null,
    recordedByName: 'Jordan Lee',
    administeredAt: '2026-08-24T08:05:00Z',
    administeredAtTimeZone: null,
    incidentDateTime: null,
    witnessStatus: 'Pending',
    witnessRespondedAt: null,
    createdAt: '2026-08-24T08:05:00Z',
    ...overrides,
  }
}

function makeIncidentRequest(overrides: Partial<PortalWitnessRequestDto> = {}): PortalWitnessRequestDto {
  return makeRequest({
    id: 'witness-1',
    sourceType: 'Incident',
    medicationId: null,
    medicationName: null,
    strength: null,
    doseDescription: null,
    doseGiven: null,
    incidentReportId: 'incident-1',
    incidentTitle: 'Slip near pool',
    incidentType: 'PropertyDamage',
    incidentSeverity: 'Medium',
    recordedByName: 'Alex Rivera',
    administeredAt: null,
    administeredAtTimeZone: null,
    incidentDateTime: '2026-08-24T08:05:00Z',
    ...overrides,
  })
}

const mockRefetch = vi.fn()

beforeEach(() => {
  mockApproveMutateAsync.mockReset()
  mockDeclineMutateAsync.mockReset()
  mockApproveIncidentMutateAsync.mockReset()
  mockDeclineIncidentMutateAsync.mockReset()
  mockRefetch.mockReset()
  mockUsePendingWitnessRequests.mockReturnValue({ data: [], isLoading: false, refetch: mockRefetch })
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

  // PP-33: a specific backend rejection (e.g. "already responded to") shouldn't be swallowed by
  // a generic "Failed to approve/decline" string, and the list should refresh so a
  // resolved-elsewhere request disappears immediately.
  it('shows the server\'s specific message and refetches when approving fails', async () => {
    const user = userEvent.setup()
    mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest()], isLoading: false, refetch: mockRefetch })
    mockApproveMutateAsync.mockRejectedValue({
      response: { data: { message: 'This request has already been responded to.' } },
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /approve/i }))

    expect(await screen.findByText('This request has already been responded to.')).toBeInTheDocument()
    expect(mockRefetch).toHaveBeenCalled()
  })

  it('shows the server\'s specific message and refetches when declining fails', async () => {
    const user = userEvent.setup()
    mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest()], isLoading: false, refetch: mockRefetch })
    mockDeclineMutateAsync.mockRejectedValue({
      response: { data: { message: 'This request has already been responded to.' } },
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: /decline/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

    expect(await screen.findByText('This request has already been responded to.')).toBeInTheDocument()
    expect(mockRefetch).toHaveBeenCalled()
  })

  // IN-7: incident rows are discriminated by sourceType and use separate endpoints/mutations.
  describe('IN-7 incident witness requests', () => {
    it('renders an incident row with title, type, participant and reporter detail', () => {
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeIncidentRequest()], isLoading: false })
      renderPage()

      expect(screen.getByText(/Slip near pool/)).toBeInTheDocument()
      expect(screen.getByText(/Sophie Brown/)).toBeInTheDocument()
      expect(screen.getByText(/Alex Rivera/)).toBeInTheDocument()
    })

    it('routes Approve through the confirm dialog (unlike a medication row, which approves immediately)', async () => {
      const user = userEvent.setup()
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeIncidentRequest()], isLoading: false })
      renderPage()

      await user.click(screen.getByRole('button', { name: /approve/i }))

      expect(mockApproveIncidentMutateAsync).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('approves an incident witness request with an optional statement', async () => {
      const user = userEvent.setup()
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeIncidentRequest()], isLoading: false })
      mockApproveIncidentMutateAsync.mockResolvedValue({ success: true, data: {} })
      renderPage()

      await user.click(screen.getByRole('button', { name: /approve/i }))
      const dialog = screen.getByRole('dialog')
      await user.type(within(dialog).getByLabelText(/witness statement/i), 'I saw it happen.')
      await user.click(within(dialog).getByRole('button', { name: /^approve$/i }))

      expect(mockApproveIncidentMutateAsync).toHaveBeenCalledWith({ id: 'witness-1', statementText: 'I saw it happen.' })
    })

    it('approves an incident witness request with no statement (leaves it undefined)', async () => {
      const user = userEvent.setup()
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeIncidentRequest()], isLoading: false })
      mockApproveIncidentMutateAsync.mockResolvedValue({ success: true, data: {} })
      renderPage()

      await user.click(screen.getByRole('button', { name: /approve/i }))
      const dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /^approve$/i }))

      expect(mockApproveIncidentMutateAsync).toHaveBeenCalledWith({ id: 'witness-1', statementText: undefined })
    })

    it('declines an incident witness request with an optional statement', async () => {
      const user = userEvent.setup()
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeIncidentRequest()], isLoading: false })
      mockDeclineIncidentMutateAsync.mockResolvedValue({ success: true, data: {} })
      renderPage()

      await user.click(screen.getByRole('button', { name: /decline/i }))
      const dialog = screen.getByRole('dialog')
      await user.type(within(dialog).getByLabelText(/witness statement/i), 'Was not present.')
      await user.click(within(dialog).getByRole('button', { name: /^decline$/i }))

      expect(mockDeclineIncidentMutateAsync).toHaveBeenCalledWith({ id: 'witness-1', statementText: 'Was not present.' })
      expect(mockDeclineMutateAsync).not.toHaveBeenCalled()
    })

    it('does not render a statement field for a medication row\'s decline dialog', async () => {
      const user = userEvent.setup()
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest()], isLoading: false })
      renderPage()

      await user.click(screen.getByRole('button', { name: /decline/i }))

      expect(screen.queryByLabelText(/witness statement/i)).not.toBeInTheDocument()
    })

    it('sums both medication and incident rows into a combined badge-worthy list', () => {
      mockUsePendingWitnessRequests.mockReturnValue({ data: [makeRequest(), makeIncidentRequest()], isLoading: false })
      renderPage()

      expect(screen.getByText(/Insulin 18 units/)).toBeInTheDocument()
      expect(screen.getByText(/Slip near pool/)).toBeInTheDocument()
    })
  })
})
