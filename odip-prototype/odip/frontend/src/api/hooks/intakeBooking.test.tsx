import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('../client', () => ({
  apiGet: vi.fn(async () => []),
  apiPost: vi.fn(async () => ({ id: 'inq-1' })),
  apiPut: vi.fn(async () => ({ id: 'inq-1' })),
  apiDeleteRaw: vi.fn(async () => ({ success: true, data: { inquiry: { id: 'inq-1' }, cancellationEmail: 'NoInvite' } })),
}))

import { useCancelIntakeBooking, useConfirmIntakeBooking, useIntakeVisits, useResendIntakeInvite, useSetIntakeBooking } from './inquiries'
import { apiDeleteRaw, apiGet, apiPost, apiPut } from '../client'

function setup() {
  const qc = new QueryClient()
  const spy = vi.spyOn(qc, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return { spy, wrapper }
}

describe('intake booking hooks', () => {
  it('books with a PUT carrying the whole body, then refreshes the enquiries and the visits', async () => {
    const { spy, wrapper } = setup()
    const { result } = renderHook(() => useSetIntakeBooking(), { wrapper })

    await result.current.mutateAsync({
      id: 'inq-1',
      data: { startsAt: '2026-10-15T23:00:00Z', durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code', contactEmail: 'noah@example.com' },
    })

    expect(apiPut).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking', {
      startsAt: '2026-10-15T23:00:00Z', durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code', contactEmail: 'noah@example.com',
    })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['participant-inquiries'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['intake-visits'] })
  })

  it('cancels with a DELETE and hands back what became of the email', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(() => useCancelIntakeBooking(), { wrapper })

    expect(await result.current.mutateAsync({ id: 'inq-1', expectedUpdatedAt: 'v1' })).toEqual({ inquiry: { id: 'inq-1' }, cancellationEmail: 'NoInvite' })
    expect(apiDeleteRaw).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking?expectedUpdatedAt=v1')
  })

  // The page focuses the row's Book intake straight after a cancel; the row must have lost its booking by then, not after the refetch.
  it('clears the cancelled row\'s booking in the enquiry list at once, keeping its other fields', async () => {
    const qc = new QueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    qc.setQueryData(['participant-inquiries'], [
      { id: 'inq-1', firstName: 'Noah', participantIsDraft: true, intakeStartsAt: '2030-10-15T23:00:00Z', intakeStaffFirstName: 'Sam', intakeInviteSentAt: '2030-10-14T00:00:00Z' },
      { id: 'inq-2', firstName: 'Ava', intakeStartsAt: '2030-10-16T23:00:00Z' },
    ])
    const { result } = renderHook(() => useCancelIntakeBooking(), { wrapper })

    await result.current.mutateAsync({ id: 'inq-1', expectedUpdatedAt: 'v1' })

    const rows = qc.getQueryData<Record<string, unknown>[]>(['participant-inquiries'])!
    expect(rows[0]).toMatchObject({ id: 'inq-1', firstName: 'Noah', participantIsDraft: true, intakeStartsAt: null, intakeStaffFirstName: null, intakeInviteSentAt: null })
    expect(rows[1]).toMatchObject({ id: 'inq-2', intakeStartsAt: '2030-10-16T23:00:00Z' })
  })

  it('marks confirmed and sends again with POSTs', async () => {
    const { spy, wrapper } = setup()
    const confirm = renderHook(() => useConfirmIntakeBooking(), { wrapper }).result
    const resend = renderHook(() => useResendIntakeInvite(), { wrapper }).result

    await confirm.current.mutateAsync({ id: 'inq-1', confirmed: true, expectedUpdatedAt: 'v1' })
    await resend.current.mutateAsync({ id: 'inq-1', expectedUpdatedAt: 'v1' })

    expect(apiPost).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking/confirm', { confirmed: true, expectedUpdatedAt: 'v1' })
    expect(apiPost).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking/send', { expectedUpdatedAt: 'v1' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['intake-visits'] })
  })

  // A 409 from a stale panel says the list it was opened from is old: the lists reload, so closing and reopening the panel shows the colleague's change.
  it('refreshes the enquiries and the visits when a write is refused', async () => {
    const { spy, wrapper } = setup()
    vi.mocked(apiPut).mockRejectedValueOnce(new Error('409'))
    const { result } = renderHook(() => useSetIntakeBooking(), { wrapper })

    await expect(result.current.mutateAsync({ id: 'inq-1', data: { startsAt: '2026-10-15T23:00:00Z', durationMinutes: 90, location: 'x', staffUserId: 'sam', notes: null } })).rejects.toThrow('409')

    expect(spy).toHaveBeenCalledWith({ queryKey: ['participant-inquiries'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['intake-visits'] })
  })

  it('reads the visits with its range and staff filter', async () => {
    const { wrapper } = setup()
    renderHook(() => useIntakeVisits({ from: '2026-10-12', to: '2026-10-18', staffUserId: 'dana' }), { wrapper })

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/intake-visits', { from: '2026-10-12', to: '2026-10-18', staffUserId: 'dana' }))
  })
})
