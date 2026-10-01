import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import RegisterTab from './RegisterTab'
import type { MedicationListDto } from '@/api/types/medications'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseMedicationRegister } = vi.hoisted(() => ({ mockUseMedicationRegister: vi.fn() }))

vi.mock('@/api/hooks', () => ({ useMedicationRegister: mockUseMedicationRegister }))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canManageMedications: true }) }))

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

// L4-04, on the register: the red "Next review" date is for a review that is overdue, which starts the day AFTER the due date.
describe('Medication register "Next review" on the due day (Sydney)', () => {
  it.each([
    ['Sat 3 Oct 00:30, the start of the due day', '2026-10-02T14:30:00Z', false],
    ['Sat 3 Oct 10:30', '2026-10-03T00:30:00Z', false],
    ['Sat 3 Oct 23:30, the end of the due day', '2026-10-03T13:30:00Z', false],
    ['Sun 4 Oct 00:30, the day after', '2026-10-03T14:30:00Z', true],
  ])('%s: overdue is %s', (_label, now, overdue) => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    mockUseMedicationRegister.mockReturnValue({ data: [medication('2026-10-03T00:00:00')], isLoading: false })

    render(<MemoryRouter><RegisterTab /></MemoryRouter>)

    const date = screen.getByText('03/10/2026')
    if (overdue) expect(date).toHaveClass('text-[var(--color-destructive)]')
    else expect(date).not.toHaveClass('text-[var(--color-destructive)]')
  })
})
