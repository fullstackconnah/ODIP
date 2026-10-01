import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ReportTab from './ReportTab'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseAdministrationsReport } = vi.hoisted(() => ({ mockUseAdministrationsReport: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useAdministrationsReport: mockUseAdministrationsReport,
  useParticipants: () => ({ data: [{ id: 'p1', fullName: 'Jamie Smith' }] }),
}))

afterEach(() => {
  restoreZone()
  vi.clearAllMocks()
})

function administration(overrides: Record<string, unknown>) {
  return {
    id: 'a1', participantMedicationId: 'm1', participantId: 'p1', participantName: 'Jamie Smith', medicationName: 'Paracetamol',
    doseDescription: '2 tablets', tripInstanceId: null, scheduledAt: null, administeredAt: null, administeredAtTimeZone: null,
    status: 'Missed', doseGiven: null, recordedByName: 'Alex Rivera', recordedByUserId: null, witnessName: null, witnessStaffId: null,
    witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null, reason: 'Asleep', prnReason: null, prnOutcome: null,
    prnOutcomeAt: null, limitBreachAcknowledged: false, notes: null, createdAt: '2026-10-03T12:00:00Z', incidentId: null, ...overrides,
  }
}

function renderReport(items: unknown[]) {
  mockUseAdministrationsReport.mockReturnValue({
    data: { items, totalCount: items.length, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false },
    isLoading: false,
  })
  return render(<ReportTab />)
}

// The "When Given" cell falls back to the dose SLOT for a dose that was never given. The slot is a provider-local wall-clock value (the 8 pm
// the MAR showed); it was read as a UTC instant and converted, so Sydney printed 06:00 am the next day for a missed 8 pm dose.
describe.each(['Australia/Sydney', 'UTC', 'America/New_York'])('Administration report, "When Given" in %s', zone => {
  it('shows the slot as written for a dose that was never given', () => {
    if (!setZone(zone)) return
    renderReport([administration({ scheduledAt: '2026-10-03T20:00:00' })])

    expect(screen.getByText(/^03\/10\/26,?\s+08:00\s?(pm|PM)$/)).toBeInTheDocument()
  })

  it('still shows a given dose as the instant it happened, in the zone it was recorded in', () => {
    if (!setZone(zone)) return
    renderReport([administration({
      status: 'Administered', scheduledAt: '2026-10-03T20:00:00', administeredAt: '2026-10-03T10:05:00Z', administeredAtTimeZone: 'Australia/Sydney',
    })])

    expect(screen.getByText(/^03\/10\/26,?\s+08:05\s?(pm|PM)$/)).toBeInTheDocument()
  })
})
