import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useAgreementsEnding, useApproveServiceAgreementDraft, useRenewAgreement } from '@/api/hooks/service-agreement-drafts'

// The real hooks on a real QueryClient; only the transport (the axios adapter) is replaced, as in pattern-change.test.tsx.
const originalAdapter = apiClient.defaults.adapter
afterEach(() => { apiClient.defaults.adapter = originalAdapter })

function answering(data: unknown, seen: InternalAxiosRequestConfig[]) {
  const adapter: AxiosAdapter = async config => {
    seen.push(config)
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
}

const wrapperFor = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
const ending = [{ participantId: 'p-1', participantName: 'Amy Ng', draftId: 'd-1', version: 1, agreementEndDate: '2026-10-30', daysLeft: 20, renewalVersion: null, status: 'Agreement ends in 20 days' }]


describe('useAgreementsEnding', () => {
  it('reads the organisation\'s ending list', async () => {
    const seen: InternalAxiosRequestConfig[] = []
    answering(ending, seen)
    const { result } = renderHook(() => useAgreementsEnding(), { wrapper: wrapperFor(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seen[0].url).toBe('/service-agreements/ending')
    expect(seen[0].method).toBe('get')
    expect(result.current.data).toEqual(ending)
  })

  it('asks nothing while it is not wanted', async () => {
    const seen: InternalAxiosRequestConfig[] = []
    answering(ending, seen)
    renderHook(() => useAgreementsEnding(false), { wrapper: wrapperFor(new QueryClient()) })

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(seen).toEqual([])
  })
})

describe('useRenewAgreement', () => {
  it('posts to the approved revision\'s renew with no body, and refreshes the revisions, the ending list and the alerts', async () => {
    const seen: InternalAxiosRequestConfig[] = []
    answering({ id: 'd-2', version: 2 }, seen)
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRenewAgreement(), { wrapper: wrapperFor(client) })

    result.current.mutate({ participantId: 'p-1', draftId: 'd-1' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect([seen[0].method, seen[0].url, seen[0].data]).toEqual(['post', '/participants/p-1/service-agreement-drafts/d-1/renew', undefined])
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([
      ['service-agreement-drafts', 'p-1'], ['onboarding', 'p-1'], ['participant-onboarding-worklist'], ['agreements-ending'], ['participant-alerts', 'p-1'], ['participant-alerts-aggregate'],
    ]))
  })

  it('refreshes nothing when the renewal is refused', async () => {
    apiClient.defaults.adapter = async config => Promise.reject(Object.assign(new Error('409'), { config, response: { status: 409, data: { success: false, code: 'plan-needed', errors: ['Record the new plan first: …'] } } }))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useRenewAgreement(), { wrapper: wrapperFor(client) })

    result.current.mutate({ participantId: 'p-1', draftId: 'd-1' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('useApproveServiceAgreementDraft', () => {
  it('also refreshes the ending list: an approved renewal is no longer ending', async () => {
    answering({ id: 'd-2', version: 2 }, [])
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useApproveServiceAgreementDraft(), { wrapper: wrapperFor(client) })

    result.current.mutate({ participantId: 'p-1', draftId: 'd-2', acknowledgeOverlaps: false })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toContainEqual(['agreements-ending'])
  })
})
