import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MarTab from './MarTab'

const { mockUseMar, mockUseParticipants, mockUseRecordPrnOutcome, mockNavigate, permissionsOverride } = vi.hoisted(() => ({
  mockUseMar: vi.fn(),
  mockUseParticipants: vi.fn(),
  mockUseRecordPrnOutcome: vi.fn(),
  mockNavigate: vi.fn(),
  permissionsOverride: { canCreateIncidents: true },
}))

vi.mock('@/api/hooks', () => ({
  useMar: mockUseMar,
  useParticipants: mockUseParticipants,
  useRecordPrnOutcome: mockUseRecordPrnOutcome,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({
    canRecordAdministrations: true, canManageMedications: true, canCreateIncidents: permissionsOverride.canCreateIncidents,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('./RecordAdministrationModal', () => ({ RecordAdministrationModal: () => null }))
vi.mock('./MissedMedicationGuidance', () => ({ MissedMedicationGuidance: () => null }))

function scheduledEntry(overrides: Record<string, unknown> = {}) {
  return {
    medicationId: 'med-1',
    participantId: 'participant-1',
    participantName: 'Priya Nair',
    medicationName: 'Paracetamol',
    strength: '500mg',
    doseDescription: '1 tablet',
    form: 'Tablet',
    route: 'Oral',
    packaging: 'OriginalPackaging',
    pharmacyName: null,
    pharmacyPhone: null,
    scheduledTime: '08:00',
    scheduledAt: '2026-09-13T08:00:00Z',
    isHighRisk: false,
    supportLevel: 'FullSupport',
    isOverdue: false,
    administration: null,
    ...overrides,
  }
}

function prnEntry(overrides: Record<string, unknown> = {}) {
  return {
    medicationId: 'med-2',
    participantId: 'participant-2',
    participantName: 'Noah Blake',
    name: 'Ibuprofen',
    strength: '200mg',
    doseDescription: '1 tablet',
    prnIndication: 'Pain',
    prnMaxDosesPer24h: 4,
    prnMinIntervalMinutes: 240,
    packaging: 'OriginalPackaging',
    pharmacyName: null,
    pharmacyPhone: null,
    dosesInLast24h: 0,
    lastDoseAt: null,
    outcomePendingAdministrationId: null,
    ...overrides,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <MarTab />
    </MemoryRouter>,
  )
}

describe('MarTab — cross-domain links', () => {
  it('links a scheduled entry\'s participant name to their Medications tab', () => {
    mockUseMar.mockReturnValue({ data: { entries: [scheduledEntry()], prnMedications: [] }, isLoading: false })
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })

    renderTab()

    expect(screen.getByRole('link', { name: 'Priya Nair' })).toHaveAttribute(
      'href',
      '/participants/participant-1?tab=medications',
    )
  })

  it('links a PRN entry\'s participant name to their Medications tab', () => {
    mockUseMar.mockReturnValue({ data: { entries: [], prnMedications: [prnEntry()] }, isLoading: false })
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })

    renderTab()

    expect(screen.getByRole('link', { name: 'Noah Blake' })).toHaveAttribute(
      'href',
      '/participants/participant-2?tab=medications',
    )
  })
})

function administeredEntry(status: string, overrides: Record<string, unknown> = {}) {
  return scheduledEntry({
    administration: {
      id: 'admin-1', status, incidentId: null,
      administeredAt: '2026-09-13T08:05:00Z', administeredAtTimeZone: 'Australia/Brisbane', recordedByName: 'Alex Rivera',
      participantId: 'participant-1', participantName: 'Priya Nair', medicationName: 'Paracetamol', doseDescription: '1 tablet',
      reason: 'Participant declined', notes: null, tripInstanceId: null, scheduledAt: '2026-09-13T08:00:00Z',
      ...overrides,
    },
  })
}

describe('MarTab — connection map: incident link/file action on scheduled rows', () => {
  beforeEach(() => {
    permissionsOverride.canCreateIncidents = true
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })
    mockNavigate.mockReset()
  })

  it('shows "Incident filed" linking to the incident when a trigger-outcome row already has one', () => {
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Refused', { incidentId: 'inc-9' })], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    expect(screen.getByRole('link', { name: 'Incident filed' })).toHaveAttribute('href', '/incidents/inc-9')
    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })

  it('shows a "File incident" action, navigating with the built MAR prefill, when no incident is linked yet', async () => {
    const user = userEvent.setup()
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Missed')], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    await user.click(screen.getByRole('button', { name: 'File incident' }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: expect.objectContaining({
        source: 'mar-administration',
        outcome: 'Missed',
        medicationAdministrationId: 'admin-1',
        strength: '500mg',
      }),
    })
  })

  it('shows neither link nor action for an Administered row', () => {
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Administered')], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    expect(screen.queryByRole('link', { name: 'Incident filed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })

  it('hides the "File incident" action for a role without incident access', () => {
    permissionsOverride.canCreateIncidents = false
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Missed')], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })
})
