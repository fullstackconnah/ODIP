import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MarTab from './MarTab'

const { mockUseMar, mockUseParticipants, mockUseRecordPrnOutcome } = vi.hoisted(() => ({
  mockUseMar: vi.fn(),
  mockUseParticipants: vi.fn(),
  mockUseRecordPrnOutcome: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useMar: mockUseMar,
  useParticipants: mockUseParticipants,
  useRecordPrnOutcome: mockUseRecordPrnOutcome,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canRecordAdministrations: true, canManageMedications: true }),
}))

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
