import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MedicationsTab from './MedicationsTab'
import type { MedicationListDto } from '@/api/types/medications'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseParticipantMedications, mockUseParticipantAdministrations } = vi.hoisted(() => ({
  mockUseParticipantMedications: vi.fn(),
  mockUseParticipantAdministrations: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useParticipantMedications: mockUseParticipantMedications,
  useParticipantAdministrations: mockUseParticipantAdministrations,
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canManageMedications: true, canCreateIncidents: true }) }))

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

function medication(nextReviewDue: string): MedicationListDto {
  return {
    id: 'med-1', participantId: 'participant-1', participantName: 'Sophie Brown', name: 'Metformin', strength: '500mg',
    form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular', timesOfDay: '08:00', frequency: 'Daily',
    daysOfWeek: [], intervalDays: null, anchorDate: null, status: 'Active', isHighRisk: false, isPsychotropic: false,
    isChemicalRestraint: false, drugSchedule: 'None', supportLevel: 'FullSupport', packaging: 'OriginalPackaging',
    startDate: '2026-01-01T00:00:00', endDate: null, nextReviewDue, complianceFlags: [],
  } as unknown as MedicationListDto
}

function renderTab() {
  return render(<MemoryRouter><MedicationsTab participantId="participant-1" /></MemoryRouter>)
}

// L4-04. NextReviewDue is a DateTime? that holds a DATE, so it arrives as "2026-10-03T00:00:00". The old check read that as local midnight
// and went red at 00:00 on the due day. It is due that whole day and overdue from the day after.
describe('participant MedicationsTab "Review due" on the due day (Sydney)', () => {
  it.each([
    ['Sat 3 Oct 00:30, the start of the due day', '2026-10-02T14:30:00Z', false],
    ['Sat 3 Oct 10:30', '2026-10-03T00:30:00Z', false],
    ['Sat 3 Oct 23:30, the end of the due day', '2026-10-03T13:30:00Z', false],
    ['Sun 4 Oct 00:30, the day after', '2026-10-03T14:30:00Z', true],
  ])('%s: overdue is %s', (_label, now, overdue) => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    mockUseParticipantMedications.mockReturnValue({ data: [medication('2026-10-03T00:00:00')], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseParticipantAdministrations.mockReturnValue({ data: [] })

    renderTab()

    const label = screen.getByText('Review due 03/10/2026')
    if (overdue) expect(label).toHaveClass('text-[var(--color-destructive)]')
    else expect(label).not.toHaveClass('text-[var(--color-destructive)]')
  })
})
