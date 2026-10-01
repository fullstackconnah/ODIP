import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import VehiclesPage from './VehiclesPage'
import { TONE } from '@/lib/tone'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseVehicles } = vi.hoisted(() => ({ mockUseVehicles: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useVehicles: mockUseVehicles,
  useDeleteVehicle: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateVehicle: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ canWrite: true }) }))

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  vi.clearAllMocks()
})

// L4-04. The service and registration dates are DateOnly ("2026-10-03"). A thing due TODAY is not overdue until the day is over, which is
// what the Qualifications page already says ("Expires today"). The old check read the date as UTC midnight (10:00 in Sydney), so the card
// went red mid-morning on the due day.
describe('VehiclesPage service / registration dates on the due day (Sydney)', () => {
  it.each([
    ['Sat 3 Oct 00:30, the start of the due day', '2026-10-02T14:30:00Z', 'warning'],
    ['Sat 3 Oct 10:30, when the old check flipped', '2026-10-03T00:30:00Z', 'warning'],
    ['Sat 3 Oct 23:30, the end of the due day', '2026-10-03T13:30:00Z', 'warning'],
    ['Sun 4 Oct 00:30, the day after', '2026-10-03T14:30:00Z', 'overdue'],
  ] as const)('%s reads %s', (_label, now, expected) => {
    if (!setZone('Australia/Sydney')) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))
    mockUseVehicles.mockReturnValue({
      data: [{
        id: 'v-1', vehicleName: 'Coaster 1', registration: 'ABC123', vehicleType: 'Bus', isInternal: true, isActive: true,
        totalSeats: 12, wheelchairPositions: 2, serviceDueDate: '2026-10-03', registrationDueDate: null,
      }],
      isLoading: false,
    })

    render(<MemoryRouter><VehiclesPage /></MemoryRouter>)

    const cell = screen.getByText('03/10/2026')
    expect(cell).toHaveClass(expected === 'overdue' ? TONE.danger.ink : TONE.warning.ink)
    expect(cell).not.toHaveClass(expected === 'overdue' ? TONE.warning.ink : TONE.danger.ink)
  })
})
