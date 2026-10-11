import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ActivitiesTab from './ActivitiesTab'
import type { TripDetailDto } from '@/api/types/trips'

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useGenerateSchedule: () => ({ mutate: mockGenerate, isPending: false, isError: false }),
  useDeleteScheduledActivity: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('@/components/AddActivityModal', () => ({ default: () => null }))

const trip = { id: 't1', tripName: 'Beach Weekend', status: 'Planning' } as unknown as TripDetailDto

afterEach(() => vi.clearAllMocks())

// TRIPS-3: an empty schedule used to fire POST /trips/:id/schedule/generate for every role; the server refuses it to ReadOnly and SupportWorker.
describe('ActivitiesTab — generating an empty schedule', () => {
  it('generates the schedule for a role that can write', () => {
    render(<ActivitiesTab tripId="t1" trip={trip} schedule={[]} canWrite isReadOnly={false} />)
    expect(mockGenerate).toHaveBeenCalledWith('t1')
  })

  it('sends no request for a role that cannot write, and says there is no schedule yet', () => {
    render(<ActivitiesTab tripId="t1" trip={trip} schedule={[]} canWrite={false} isReadOnly={false} />)
    expect(mockGenerate).not.toHaveBeenCalled()
    expect(screen.getByText('No schedule yet.')).toBeInTheDocument()
  })

  it('sends no request for a cancelled or archived trip', () => {
    render(<ActivitiesTab tripId="t1" trip={trip} schedule={[]} canWrite isReadOnly />)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})
