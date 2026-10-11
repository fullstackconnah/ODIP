import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EditTripModal from './EditTripModal'
import type { TripDetailDto } from '@/api/types/trips'

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useUpdateTrip: () => ({ mutate, isPending: false }),
  useEventTemplates: () => ({ data: [] }),
  useStaff: () => ({ data: [] }),
}))

const trip = { id: 't1', tripName: 'Beach', startDate: '2026-11-01T00:00:00', durationDays: 3, status: 'Draft' } as TripDetailDto

async function setup() {
  const user = userEvent.setup()
  render(<EditTripModal trip={trip} onClose={() => {}} />)
  await screen.findByLabelText(/Start Date/)
  return user
}

describe('EditTripModal — what Save refuses', () => {
  it('refuses an empty start date with a field error', async () => {
    const user = await setup()
    fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Start date is required.')).toBeInTheDocument()
  })

  it('refuses a duration below one day with a field error', async () => {
    const user = await setup()
    fireEvent.change(screen.getByLabelText(/Duration/), { target: { value: '0' } })
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText('Duration must be at least 1 day.')).toBeInTheDocument()
  })

  it('saves a start date and a duration of one or more days', async () => {
    const user = await setup()
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    expect(mutate).toHaveBeenCalledWith({ id: 't1', data: expect.objectContaining({ startDate: '2026-11-01', durationDays: 3 }) }, expect.anything())
  })
})
