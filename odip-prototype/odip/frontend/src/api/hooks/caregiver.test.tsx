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

import { useCaregiverSubmissions, useGenerateCaregiverLink, usePublicCaregiverForm, useSaveCaregiverDraft, useRevokeCaregiverLink, useAcceptCaregiverSubmission, useRejectCaregiverSubmission } from './caregiver'
import { apiGetWithDefault, apiPostRaw, apiDeleteRaw } from '../client'
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

// PARTICIPANTS-5 review (S2, N5): a refused Revoke, Accept or Reject still reloads the link state and the list, so a stale
// "Submitted" chip or row does not keep offering an action the server has already refused.
describe('caregiver hooks — a refused review or revoke reloads the submissions', () => {
  const refused = { response: { status: 409 } }

  it.each([
    ['useRevokeCaregiverLink', () => useRevokeCaregiverLink(), { participantId: 'p1' }, () => vi.mocked(apiDeleteRaw).mockRejectedValueOnce(refused)],
    ['useAcceptCaregiverSubmission', () => useAcceptCaregiverSubmission(), { id: 's1', participantId: 'p1' }, () => vi.mocked(apiPostRaw).mockRejectedValueOnce(refused)],
    ['useRejectCaregiverSubmission', () => useRejectCaregiverSubmission(), { id: 's1', note: 'n' }, () => vi.mocked(apiPostRaw).mockRejectedValueOnce(refused)],
  ] as const)('%s invalidates the submissions list after a refusal', async (_name, hook, vars, refuse) => {
    refuse()
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    // The three hooks differ only in their variables, which the table pairs with each.
    const { result } = renderHook(hook as () => { mutateAsync: (v: unknown) => Promise<unknown> }, { wrapper: wrapper(qc) })
    await expect(result.current.mutateAsync(vars)).rejects.toBe(refused)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['caregiver-submissions'] })
  })
})
