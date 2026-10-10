import { describe, it, expect, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('../client', () => ({
  apiGetWithDefault: vi.fn(async () => []),
  apiPostRaw: vi.fn(async () => ({ success: true, data: { token: 't', expiresAt: '2026-09-17T00:00:00Z' } })),
  apiDeleteRaw: vi.fn(async () => undefined),
}))
vi.mock('../caregiverClient', () => ({
  caregiverGet: vi.fn(async () => ({ success: true, data: { status: 'Draft', current: {}, editable: [], draft: null } })),
  caregiverPut: vi.fn(async () => undefined),
  caregiverPost: vi.fn(async () => undefined),
}))

import { useCaregiverSubmissions, useGenerateCaregiverLink, usePublicCaregiverForm, useSaveCaregiverDraft } from './caregiver'
import { apiGetWithDefault } from '../client'
import { caregiverGet, caregiverPut } from '../caregiverClient'

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('caregiver hooks', () => {
  it('useGenerateCaregiverLink invalidates the participant and the submissions list', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useGenerateCaregiverLink(), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ participantId: 'p1' })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['participant', 'p1'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['caregiver-submissions'] })
  })

  it('usePublicCaregiverForm reads through the public client', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => usePublicCaregiverForm('tok'), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.data?.status).toBe('Draft'))
    expect(caregiverGet).toHaveBeenCalledWith('/public/caregiver/tok')
  })

  it('useSaveCaregiverDraft writes through the public client', async () => {
    const qc = new QueryClient()
    const { result } = renderHook(() => useSaveCaregiverDraft('tok'), { wrapper: wrapper(qc) })
    await result.current.mutateAsync({ caregiverName: 'Jane', payload: {} })
    expect(caregiverPut).toHaveBeenCalledWith('/public/caregiver/tok/draft', { caregiverName: 'Jane', payload: {} })
  })

  it('useCaregiverSubmissions asks the server for one participant when given one', async () => {
    const qc = new QueryClient()
    renderHook(() => useCaregiverSubmissions('Draft', { participantId: 'p1' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(apiGetWithDefault).toHaveBeenCalledWith('/caregiver-submissions?status=Draft&participantId=p1', []))
  })

  it('useCaregiverSubmissions makes no request while disabled', async () => {
    vi.mocked(apiGetWithDefault).mockClear()
    const qc = new QueryClient()
    const { result } = renderHook(() => useCaregiverSubmissions('Draft', { participantId: 'p1', enabled: false }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.fetchStatus).toBe('idle'))
    expect(apiGetWithDefault).not.toHaveBeenCalled()
  })
})
