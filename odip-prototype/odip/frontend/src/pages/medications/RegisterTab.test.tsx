import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import RegisterTab from './RegisterTab'
import type { MedicationListDto } from '@/api/types/medications'

const { mockUseMedicationRegister, perms } = vi.hoisted(() => ({
  mockUseMedicationRegister: vi.fn(),
  perms: { canManageMedications: true, isReadOnly: false },
}))

vi.mock('@/api/hooks', () => ({ useMedicationRegister: mockUseMedicationRegister }))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => perms }))

afterEach(() => {
  Object.assign(perms, { canManageMedications: true, isReadOnly: false })
  vi.clearAllMocks()
})

const med = {
  id: 'med-1', participantId: 'participant-1', participantName: 'Sophie Brown', name: 'Metformin', strength: '500mg',
  form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular', timesOfDay: '08:00', frequency: 'Daily',
  daysOfWeek: [], status: 'Active', complianceFlags: [], startDate: '2026-01-01T00:00:00', endDate: null, nextReviewDue: null,
} as unknown as MedicationListDto

function renderTab() {
  mockUseMedicationRegister.mockReturnValue({ data: [med], isLoading: false })
  render(
    <MemoryRouter initialEntries={['/medications']}>
      <Routes>
        <Route path="/medications" element={<RegisterTab />} />
        <Route path="/medications/:id/edit" element={<div>Edit medication page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// PARTICIPANTS-4: the edit page is for the roles that manage medications; a row click took a SupportWorker there, to be sent away.
describe('RegisterTab — row click by role', () => {
  it('opens the edit page for a role that manages medications', async () => {
    renderTab()
    await userEvent.click(screen.getByText('Metformin'))
    expect(screen.getByText('Edit medication page')).toBeInTheDocument()
  })

  it('opens the form (as a view) for ReadOnly', async () => {
    Object.assign(perms, { canManageMedications: false, isReadOnly: true })
    renderTab()
    await userEvent.click(screen.getByText('Metformin'))
    expect(screen.getByText('Edit medication page')).toBeInTheDocument()
  })

  it('stays on the register for a role that does not', async () => {
    perms.canManageMedications = false
    renderTab()
    await userEvent.click(screen.getByText('Metformin'))
    expect(screen.queryByText('Edit medication page')).not.toBeInTheDocument()
    expect(screen.getByText('Metformin')).toBeInTheDocument()
  })
})

// PARTICIPANTS-1: a medication belongs to a participant, and /medications/new without one is a dead end, so the register offers no "New medication".
describe('Medication register', () => {
  it('offers no participant-less "New medication" link, and says where medications are added', () => {
    mockUseMedicationRegister.mockReturnValue({ data: [], isLoading: false })
    render(<MemoryRouter><RegisterTab /></MemoryRouter>)

    expect(screen.queryByRole('link', { name: /new medication/i })).toBeNull()
    expect(screen.getByText("Medications are added from a participant's Medications tab.")).toBeInTheDocument()
  })
})
