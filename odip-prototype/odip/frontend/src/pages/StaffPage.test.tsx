import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import StaffPage from './StaffPage'
import type { StaffListDto } from '@/api/types/staff'

const { mockUseStaff, mockDeleteMutate, mockUpdateMutate } = vi.hoisted(() => ({
  mockUseStaff: vi.fn(),
  mockDeleteMutate: vi.fn(),
  mockUpdateMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useStaff: mockUseStaff,
  useDeleteStaff: () => ({ mutate: mockDeleteMutate, isPending: false }),
  useUpdateStaff: () => ({ mutate: mockUpdateMutate, isPending: false }),
}))

function setUserRole(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role }))
}

function makeStaff(overrides: Partial<StaffListDto> = {}): StaffListDto {
  return {
    id: 's1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', username: 'alex',
    role: 'SupportWorker', position: 'SupportWorker', email: 'alex@example.com', mobile: null,
    region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true,
    firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null,
    medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
    hasExpiredQualifications: false, notes: null,
    ...overrides,
  } as StaffListDto
}

function renderPage() {
  return render(
    <MemoryRouter>
      <StaffPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockUseStaff.mockReset()
  mockDeleteMutate.mockReset()
  mockUpdateMutate.mockReset()
  mockUseStaff.mockReturnValue({
    data: [
      makeStaff({ id: 's1', fullName: 'Alex Rivera', position: 'Coordinator', region: 'North' }),
      makeStaff({ id: 's2', fullName: 'Sam Lee', position: 'SupportWorker', region: 'South' }),
    ],
    isLoading: false,
  })
  setUserRole('Admin')
})

afterEach(() => {
  localStorage.clear()
})

// PP-45 — a search box, threaded client-side (the backend's GetAll has no text-search param),
// filters the staff table by name/position/region.
describe('StaffPage — PP-45 search', () => {
  it('renders a search input and filters the table to matching staff', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'sam')

    expect(screen.queryByText('Alex Rivera')).not.toBeInTheDocument()
    expect(screen.getByText('Sam Lee')).toBeInTheDocument()
  })

  it('also matches on position/region, not just name', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'coordinator')

    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
    expect(screen.queryByText('Sam Lee')).not.toBeInTheDocument()
  })

  it('shows a "no match" empty state with a Clear search action when nothing matches', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByPlaceholderText(/search staff/i), 'zzz-no-match')

    expect(screen.getByText(/no staff match your search/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear search/i }))
    expect(screen.getByText('Alex Rivera')).toBeInTheDocument()
  })
})

// PP-46 — the Active -> Inactive transition on the status dropdown is staged behind a
// ConfirmDialog; Active (re-activation) still fires immediately.
describe('StaffPage — PP-46 deactivate confirm', () => {
  it('does not call the mutation until the Inactive transition is confirmed', async () => {
    const user = userEvent.setup()
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^active$/i }))
    await user.click(await screen.findByRole('option', { name: /inactive/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: /mark staff member as inactive/i })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /mark inactive/i }))
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', data: expect.objectContaining({ isActive: false }) }),
      expect.anything(),
    )
  })

  it('cancelling the dialog does not call the mutation', async () => {
    const user = userEvent.setup()
    renderPage()

    const row = screen.getByText('Alex Rivera').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^active$/i }))
    await user.click(await screen.findByRole('option', { name: /inactive/i }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(mockUpdateMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('an Inactive -> Active transition fires immediately with no confirm dialog', async () => {
    const user = userEvent.setup()
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's3', fullName: 'Jamie Fox', isActive: false })],
      isLoading: false,
    })
    renderPage()

    const row = screen.getByText('Jamie Fox').closest('tr') as HTMLElement
    await user.click(within(row).getByRole('button', { name: /^inactive$/i }))
    await user.click(await screen.findByRole('option', { name: /^active$/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockUpdateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's3', data: expect.objectContaining({ isActive: true }) }),
    )
  })
})

// PP-47 — the worker-screening "current" Check icon needs an accessible label, matching the
// labelled StatusBadge used for the expired case.
describe('StaffPage — PP-47 worker screening icon label', () => {
  it('labels the current worker-screening icon', () => {
    mockUseStaff.mockReturnValue({
      data: [makeStaff({ id: 's1', fullName: 'Alex Rivera', workerScreeningExpiryDate: '2099-01-01' })],
      isLoading: false,
    })
    renderPage()

    expect(screen.getByLabelText('Worker screening current')).toBeInTheDocument()
  })
})
