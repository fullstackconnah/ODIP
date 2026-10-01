import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CaregiverSubmissionReviewPage from './CaregiverSubmissionReviewPage'
import type { CaregiverSubmissionDetailDto } from '@/api/types/caregiver'

const {
  mockUseCaregiverSubmission, mockUseAcceptCaregiverSubmission, mockUseRejectCaregiverSubmission,
  mockUsePermissions, mockNavigate, mockAcceptMutateAsync, mockRejectMutateAsync,
} = vi.hoisted(() => ({
  mockUseCaregiverSubmission: vi.fn(),
  mockUseAcceptCaregiverSubmission: vi.fn(),
  mockUseRejectCaregiverSubmission: vi.fn(),
  mockUsePermissions: vi.fn(),
  mockNavigate: vi.fn(),
  mockAcceptMutateAsync: vi.fn(),
  mockRejectMutateAsync: vi.fn(),
}))

vi.mock('@/api/hooks/caregiver', () => ({
  useCaregiverSubmission: mockUseCaregiverSubmission,
  useAcceptCaregiverSubmission: mockUseAcceptCaregiverSubmission,
  useRejectCaregiverSubmission: mockUseRejectCaregiverSubmission,
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: mockUsePermissions }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeSubmission(overrides: Partial<CaregiverSubmissionDetailDto> = {}): CaregiverSubmissionDetailDto {
  return {
    id: 'sub-1', participantId: 'p1', participantName: 'Sophie Brown', status: 'Submitted',
    caregiverName: 'Jane Doe', caregiverRelationship: 'Mother', createdAt: '2026-08-01T00:00:00Z',
    expiresAt: '2026-09-17T00:00:00Z', submittedAt: '2026-08-02T00:00:00Z', reviewedAt: null,
    rejectionNote: null,
    current: { firstName: 'Sophie', likesDislikes: 'Reading' },
    payload: { aboutMe: { likesDislikes: 'Gardening' } },
    ...overrides,
  }
}

function renderPage(id = 'sub-1') {
  return render(
    <MemoryRouter initialEntries={[`/caregiver-submissions/${id}`]}>
      <Routes>
        <Route path="/caregiver-submissions/:id" element={<CaregiverSubmissionReviewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseCaregiverSubmission.mockReset()
  mockUseAcceptCaregiverSubmission.mockReset()
  mockUseRejectCaregiverSubmission.mockReset()
  mockUsePermissions.mockReset()
  mockNavigate.mockReset()
  mockAcceptMutateAsync.mockReset()
  mockRejectMutateAsync.mockReset()

  mockUseCaregiverSubmission.mockReturnValue({ data: makeSubmission(), isLoading: false })
  mockUseAcceptCaregiverSubmission.mockReturnValue({ mutateAsync: mockAcceptMutateAsync, isPending: false })
  mockUseRejectCaregiverSubmission.mockReturnValue({ mutateAsync: mockRejectMutateAsync, isPending: false })
  mockUsePermissions.mockReturnValue({ canWriteParticipantDetails: true })
})

describe('CaregiverSubmissionReviewPage', () => {
  it('renders caregiver name, relationship, and submitted-at', () => {
    renderPage()

    expect(screen.getByText('Sophie Brown')).toBeInTheDocument()
    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument()
    expect(screen.getByText(/Mother/)).toBeInTheDocument()
  })

  it('lists only changed rows from computeCaregiverDiff, grouped by group', () => {
    renderPage()

    // Only personalInterests changed (aboutMe group) — firstName is unchanged and absent.
    expect(screen.getByText('Reading')).toBeInTheDocument()
    expect(screen.getByText('Gardening')).toBeInTheDocument()
    expect(screen.queryByText('Sophie')).not.toBeInTheDocument()
  })

  it('shows a "no changes" message when the diff is empty', () => {
    mockUseCaregiverSubmission.mockReturnValue({
      data: makeSubmission({ current: { firstName: 'Sophie', lastName: 'Brown' }, payload: { personalDetails: { firstName: 'Sophie', lastName: 'Brown' } } }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText(/without changing any values/i)).toBeInTheDocument()
  })

  it('hides Accept/Reject when status is not Submitted', () => {
    mockUseCaregiverSubmission.mockReturnValue({ data: makeSubmission({ status: 'Accepted' }), isLoading: false })
    renderPage()

    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('hides Accept/Reject for a role without canWriteParticipantDetails', () => {
    mockUsePermissions.mockReturnValue({ canWriteParticipantDetails: false })
    renderPage()

    expect(screen.queryByRole('button', { name: /^accept$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
  })

  it('Accept requires confirmation before calling the mutation, then navigates back to the list', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /^accept$/i }))
    // The mutation must not fire on the first click alone — a confirm step sits in between.
    expect(mockAcceptMutateAsync).not.toHaveBeenCalled()

    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/accept this submission/i)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /^accept$/i }))

    expect(mockAcceptMutateAsync).toHaveBeenCalledWith({ id: 'sub-1', participantId: 'p1' })
    expect(mockNavigate).toHaveBeenCalledWith('/caregiver-submissions')
  })

  it("Reject's button is disabled until the note is non-empty, then calls the mutation", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /reject/i }))
    const confirmRejectButton = screen.getByRole('button', { name: /reject and reopen link/i })
    expect(confirmRejectButton).toBeDisabled()

    const noteField = screen.getByLabelText(/what should the caregiver fix/i)
    await user.type(noteField, 'Please update the phone number.')
    expect(confirmRejectButton).toBeEnabled()

    await user.click(confirmRejectButton)

    expect(mockRejectMutateAsync).toHaveBeenCalledWith({ id: 'sub-1', note: 'Please update the phone number.' })
    expect(mockNavigate).toHaveBeenCalledWith('/caregiver-submissions')
  })
})

describe('CaregiverSubmissionReviewPage — failed request vs. missing record (PageState)', () => {
  it('names a failed request as a failure, with a retry, and does not call it "Submission not found"', () => {
    mockUseCaregiverSubmission.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this submission")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Submission not found')).not.toBeInTheDocument()
  })

  it('shows "Submission not found" for a 404, with nothing to retry', () => {
    mockUseCaregiverSubmission.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText('Submission not found')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to caregiver submissions' })).toHaveAttribute('href', '/caregiver-submissions')
  })

  it('shows "Submission not found" for an answer with no record, and says "Loading submission…" while it loads', () => {
    mockUseCaregiverSubmission.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() })
    const { unmount } = renderPage()
    expect(screen.getByText('Submission not found')).toBeInTheDocument()
    unmount()

    mockUseCaregiverSubmission.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderPage()
    expect(screen.getByRole('status')).toHaveTextContent('Loading submission…')
  })
})
