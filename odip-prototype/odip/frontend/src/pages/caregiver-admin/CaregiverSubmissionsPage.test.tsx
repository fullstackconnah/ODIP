import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import CaregiverSubmissionsPage from './CaregiverSubmissionsPage'
import type { CaregiverSubmissionListItemDto } from '@/api/types/caregiver'

const { mockUseCaregiverSubmissions, mockNavigate } = vi.hoisted(() => ({
  mockUseCaregiverSubmissions: vi.fn(),
  mockNavigate: vi.fn(),
}))

vi.mock('@/api/hooks/caregiver', () => ({
  useCaregiverSubmissions: mockUseCaregiverSubmissions,
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function makeSubmission(overrides: Partial<CaregiverSubmissionListItemDto> = {}): CaregiverSubmissionListItemDto {
  return {
    id: 'sub-1', participantId: 'p1', participantName: 'Sophie Brown', status: 'Submitted',
    caregiverName: 'Jane Doe', createdAt: '2026-08-01T00:00:00Z', expiresAt: '2026-09-17T00:00:00Z',
    submittedAt: '2026-08-02T00:00:00Z',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<CaregiverSubmissionsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseCaregiverSubmissions.mockReset()
  mockNavigate.mockReset()
  mockUseCaregiverSubmissions.mockReturnValue({ data: [makeSubmission()], isLoading: false })
})

describe('CaregiverSubmissionsPage', () => {
  it('defaults the status filter to Submitted', () => {
    renderPage()

    expect(mockUseCaregiverSubmissions).toHaveBeenCalledWith('Submitted')
  })

  it('renders a row per submission with participant, caregiver, status, submitted and expiry', () => {
    renderPage()

    expect(screen.getByText('Sophie Brown')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    // "Submitted" also names the status-filter pill and the sortable column header's own label
    // span — the status badge is the only one of the three rendered inside a table cell.
    expect(screen.getByText('Submitted', { selector: 'td span' })).toBeInTheDocument()
  })

  it('shows a dash for caregiverName when null', () => {
    mockUseCaregiverSubmissions.mockReturnValue({ data: [makeSubmission({ caregiverName: null })], isLoading: false })
    renderPage()

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('switching the status pill re-queries with the new status', async () => {
    const user = userEvent.setup()
    renderPage()

    // The pill's own accessible name is the currently-selected status label, which collides
    // with the sortable "Submitted" column header's own button — the pill renders first in
    // document order (it's above the table), so it's the first match.
    const [pill] = screen.getAllByRole('button', { name: 'Submitted' })
    await user.click(pill)
    await user.click(screen.getByRole('option', { name: 'Draft' }))

    expect(mockUseCaregiverSubmissions).toHaveBeenLastCalledWith('Draft')
  })

  it('the Review action navigates to /caregiver-submissions/:id', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: /review/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/caregiver-submissions/sub-1')
  })

  it('renders an empty state naming the current filter when there are no rows', () => {
    mockUseCaregiverSubmissions.mockReturnValue({ data: [], isLoading: false })
    renderPage()

    expect(screen.getByText(/no submitted caregiver forms/i)).toBeInTheDocument()
  })
})
