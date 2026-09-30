import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MedicationsTab from './MedicationsTab'
import type { AdministrationDto } from '@/api/types/medications'

const { mockUseParticipantMedications, mockUseParticipantAdministrations, mockNavigate, permissionsOverride } = vi.hoisted(() => ({
  mockUseParticipantMedications: vi.fn(),
  mockUseParticipantAdministrations: vi.fn(),
  mockNavigate: vi.fn(),
  permissionsOverride: { canCreateIncidents: true },
}))

vi.mock('@/api/hooks', () => ({
  useParticipantMedications: mockUseParticipantMedications,
  useParticipantAdministrations: mockUseParticipantAdministrations,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canManageMedications: true, canCreateIncidents: permissionsOverride.canCreateIncidents }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

function administration(overrides: Partial<AdministrationDto> = {}): AdministrationDto {
  return {
    id: 'admin-1', participantMedicationId: 'med-1', participantId: 'participant-1', participantName: 'Sophie Brown',
    medicationName: 'Metformin', doseDescription: '1 tablet', tripInstanceId: null,
    scheduledAt: '2026-09-12T08:00:00Z', administeredAt: '2026-09-12T08:05:00Z', administeredAtTimeZone: 'Australia/Brisbane',
    status: 'Missed', doseGiven: null, recordedByName: 'Alex Rivera', recordedByUserId: 'staff-1',
    witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
    reason: 'Participant was asleep.', prnReason: null, prnOutcome: null, prnOutcomeAt: null,
    limitBreachAcknowledged: false, notes: null, createdAt: '2026-09-12T08:10:00Z', incidentId: null,
    ...overrides,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <MedicationsTab participantId="participant-1" />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  permissionsOverride.canCreateIncidents = true
  mockNavigate.mockReset()
  mockUseParticipantMedications.mockReturnValue({ data: [], isLoading: false })
})

describe('participant-detail/MedicationsTab — connection map: incident link/file action on administration-history rows', () => {
  it('shows "Incident filed" linking to the incident when a trigger-outcome row already has one', () => {
    mockUseParticipantAdministrations.mockReturnValue({ data: [administration({ incidentId: 'inc-7' })] })
    renderTab()

    expect(screen.getByRole('link', { name: 'Incident filed' })).toHaveAttribute('href', '/incidents/inc-7')
    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })

  it('shows a "File incident" action, navigating with the built MAR prefill, when no incident is linked yet', async () => {
    const user = userEvent.setup()
    mockUseParticipantAdministrations.mockReturnValue({ data: [administration({ status: 'Refused' })] })
    renderTab()

    await user.click(screen.getByRole('button', { name: 'File incident' }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: expect.objectContaining({
        source: 'mar-administration',
        outcome: 'Refused',
        medicationAdministrationId: 'admin-1',
        participantId: 'participant-1',
      }),
    })
  })

  it('paints a Withheld dose with the warning tokens (amber-100/800 are exactly those), not raw Tailwind amber', () => {
    mockUseParticipantAdministrations.mockReturnValue({ data: [administration({ status: 'Withheld' })] })
    renderTab()

    const badge = screen.getByText('Withheld')
    expect(badge).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    expect(badge.className).not.toMatch(/amber-/)
  })

  it('shows neither link nor action for an Administered row', () => {
    mockUseParticipantAdministrations.mockReturnValue({ data: [administration({ status: 'Administered' })] })
    renderTab()

    expect(screen.queryByRole('link', { name: 'Incident filed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })

  it('hides the "File incident" action for a role without incident access', () => {
    permissionsOverride.canCreateIncidents = false
    mockUseParticipantAdministrations.mockReturnValue({ data: [administration({ status: 'WrongMedication' })] })
    renderTab()

    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })
})
