import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MedicationsTab from './MedicationsTab'
import type { AdministrationDto } from '@/api/types/medications'
import { TONE } from '@/lib/tone'

const { mockUseParticipantMedications, mockUseParticipantAdministrations, mockNavigate, permissionsOverride } = vi.hoisted(() => ({
  mockUseParticipantMedications: vi.fn(),
  mockUseParticipantAdministrations: vi.fn(),
  mockNavigate: vi.fn(),
  permissionsOverride: { canCreateIncidents: true, canManageMedications: true, isReadOnly: false },
}))

vi.mock('@/api/hooks', () => ({
  useParticipantMedications: mockUseParticipantMedications,
  useParticipantAdministrations: mockUseParticipantAdministrations,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => permissionsOverride,
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
    limitBreachAcknowledged: false, notes: null, createdAt: '2026-09-12T08:10:00Z', recordedWithoutCompetency: false, incidentId: null,
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
  Object.assign(permissionsOverride, { canCreateIncidents: true, canManageMedications: true, isReadOnly: false })
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

describe('participant-detail/MedicationsTab — loading and failure (PageState)', () => {
  it('says "Loading medication list…" while it loads', () => {
    mockUseParticipantMedications.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() })
    renderTab()

    expect(screen.getByRole('status')).toHaveTextContent('Loading medication list…')
  })

  it('does not show a failed request as an empty medication list: it names the failure and offers a retry', () => {
    mockUseParticipantMedications.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderTab()

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this medication list")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Medications' })).not.toBeInTheDocument()
  })

  it('keeps the list on screen when a background refetch fails over data it already has', () => {
    mockUseParticipantMedications.mockReturnValue({ data: [], isLoading: false, isError: true, error: { response: { status: 500 } }, refetch: vi.fn() })
    renderTab()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Medications' })).toBeInTheDocument()
  })
})

describe('participant-detail/MedicationsTab — administration outcome tones (L3-06)', () => {
  it('colours a WrongMedication dose danger like Refused and Missed, and every other outcome by its tone', () => {
    const tones = { Administered: 'success', Refused: 'danger', Withheld: 'warning', Missed: 'danger', WrongMedication: 'danger' } as const
    mockUseParticipantAdministrations.mockReturnValue({
      data: Object.keys(tones).map((status, i) => administration({ id: `admin-${i}`, status: status as AdministrationDto['status'] })),
    })
    renderTab()

    for (const [status, tone] of Object.entries(tones)) {
      for (const cls of TONE[tone].solid.split(' ')) expect(screen.getByText(status), `${status} ${cls}`).toHaveClass(cls)
    }
  })
})

// Q2 fix round: the card opens the medication form (a view for ReadOnly). SupportWorker is sent away from that route, so its card is plain content.
describe('MedicationsTab — the medication card by role', () => {
  const med = {
    id: 'med-1', participantId: 'participant-1', name: 'Metformin', strength: '500mg', form: 'Tablet', route: 'Oral', doseDescription: '1 tablet',
    type: 'Regular', timesOfDay: '08:00', status: 'Active', supportLevel: 'FullSupport', complianceFlags: [], nextReviewDue: null,
  }

  it.each([
    ['Coordinator', { canManageMedications: true, isReadOnly: false }, true],
    ['ReadOnly', { canManageMedications: false, isReadOnly: true }, true],
    ['SupportWorker', { canManageMedications: false, isReadOnly: false }, false],
  ] as const)('%s: the card links to the form: %s', (_role, perms, links) => {
    Object.assign(permissionsOverride, perms)
    mockUseParticipantMedications.mockReturnValue({ data: [med], isLoading: false })
    mockUseParticipantAdministrations.mockReturnValue({ data: [] })
    renderTab()

    expect(screen.getByText('Metformin')).toBeInTheDocument()
    const link = screen.getByText('Metformin').closest('a')
    if (links) expect(link).toHaveAttribute('href', '/medications/med-1/edit')
    else expect(link).toBeNull()
  })
})
