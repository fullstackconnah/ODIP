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

    expect(await result.current.mutateAsync('inq-1')).toEqual({ inquiry: { id: 'inq-1' }, cancellationEmail: 'NoInvite' })
    expect(apiDeleteRaw).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking')
  })

  it('marks confirmed and sends again with POSTs', async () => {
    const { spy, wrapper } = setup()
    const confirm = renderHook(() => useConfirmIntakeBooking(), { wrapper }).result
    const resend = renderHook(() => useResendIntakeInvite(), { wrapper }).result

    await confirm.current.mutateAsync({ id: 'inq-1', confirmed: true })
    await resend.current.mutateAsync('inq-1')

    expect(apiPost).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking/confirm', { confirmed: true })
    expect(apiPost).toHaveBeenCalledWith('/inquiries/inq-1/intake-booking/send')
    expect(spy).toHaveBeenCalledWith({ queryKey: ['intake-visits'] })
  })

  it('reads the visits with its range and staff filter', async () => {
    const { wrapper } = setup()
    renderHook(() => useIntakeVisits({ from: '2026-10-12', to: '2026-10-18', staffUserId: 'dana' }), { wrapper })

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/intake-visits', { from: '2026-10-12', to: '2026-10-18', staffUserId: 'dana' }))
  })
})
