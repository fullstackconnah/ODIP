import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useMar, useRecordPrnOutcome } from './medications'
import { apiGet, apiPostRaw } from '../client'

vi.mock('../client', () => ({ apiGet: vi.fn(), apiPostRaw: vi.fn(), apiPutRaw: vi.fn() }))

it('refetches the active MAR after an outcome refusal', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.mocked(apiGet).mockResolvedValue({ entries: [], prnMedications: [] })
  const refusal = { response: { status: 409 } }
  vi.mocked(apiPostRaw).mockRejectedValue(refusal)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => ({ mar: useMar('2026-10-14'), outcome: useRecordPrnOutcome() }), { wrapper })
  await waitFor(() => expect(result.current.mar.isSuccess).toBe(true))
  expect(apiGet).toHaveBeenCalledTimes(1)
  await act(async () => {
    await expect(result.current.outcome.mutateAsync({ id: 'synthetic-dose', prnOutcome: 'Settled' })).rejects.toEqual(refusal)
  })
  await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
  unmount()
  qc.clear()
})
