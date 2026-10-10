import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { ReservationDto } from '@/api/types/reservations'
import type { TripDetailDto } from '@/api/types/trips'

// UpdateReservation is a full-replace PUT. "Cancel reservation" says it "keeps the record for history", so the body must carry what the reservation holds.

const { cancelMutate, updateMutate } = vi.hoisted(() => ({ cancelMutate: vi.fn(), updateMutate: vi.fn() }))

const idle = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false }

vi.mock('@/api/hooks', () => ({
  useAccommodation: () => ({ data: [] }),
  useCreateAccommodation: () => idle,
  useCreateReservation: () => idle,
  useUpdateReservation: () => ({ ...idle, mutate: updateMutate }),
  useDeleteReservation: () => idle,
  useCancelReservation: () => ({ ...idle, mutate: cancelMutate }),
}))

import AccommodationTab from './AccommodationTab'

const trip = { startDate: '2026-10-10T00:00:00', endDate: '2026-10-14T00:00:00' } as TripDetailDto

const reservation: ReservationDto = {
  id: 'r1', tripInstanceId: 't1', tripName: 'Beach Escape', accommodationPropertyId: 'ap1', propertyName: 'Sunshine Beach Retreat',
  requestSentDate: '2026-08-20', dateBooked: '2026-09-01', dateConfirmed: '2026-09-05', checkInDate: '2026-10-10', checkOutDate: '2026-10-14',
  bedroomsReserved: 2, bedsReserved: 4, cost: 1200, confirmationReference: 'ABC123', reservationStatus: 'Confirmed', comments: 'Late arrival',
  cancellationReason: null, hasOverlapConflict: false,
}

function renderTab() {
  return render(
    <MemoryRouter>
      <AccommodationTab tripId="t1" trip={trip} accommodation={[reservation]} canWrite />
    </MemoryRouter>,
  )
}

describe('AccommodationTab — reservation writes keep what the reservation holds', () => {
  it('Cancel reservation sends the dates, reference and request date it already has', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: 'Remove reservation' }))
    await user.click(screen.getByRole('button', { name: /^Cancel reservation/ }))

    expect(cancelMutate).toHaveBeenCalledTimes(1)
    expect(cancelMutate.mock.calls[0][0]).toMatchObject({
      id: 'r1',
      data: { requestSentDate: '2026-08-20', dateBooked: '2026-09-01', dateConfirmed: '2026-09-05', confirmationReference: 'ABC123', reservationStatus: 'Cancelled' },
    })
  })

  it('Save Changes in the edit form keeps the request date, which the form has no field for', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: 'Edit reservation' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate.mock.calls[0][0].data).toMatchObject({ requestSentDate: '2026-08-20', dateBooked: '2026-09-01', dateConfirmed: '2026-09-05' })
  })
})
