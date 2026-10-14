import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { usePatternChange } from '@/api/hooks/service-agreement-drafts'
import type { PatternChangeDto } from '@/api/types'

// The real hook on a real QueryClient; only the transport (the axios adapter) is replaced, as in contact-staff-refresh.test.tsx.
const originalAdapter = apiClient.defaults.adapter
afterEach(() => { apiClient.defaults.adapter = originalAdapter })

function answering(data: object, seen: InternalAxiosRequestConfig[]) {
  const adapter: AxiosAdapter = async config => {
    seen.push(config)
    return { data: { success: true, data }, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse
  }
  apiClient.defaults.adapter = adapter
}

const wrapperFor = (client: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>

const change: PatternChangeDto = {
  patternId: 'pattern-1', dayOfWeek: 'Monday', startTime: '09:00', endTime: '14:00', endsNextDay: false, ratio: 'OneToOne', nightType: 'None', allDays: false, fromDate: '2026-10-19', preview: true,
}
const result = { version: 3, agreementStartDate: '2026-10-19', agreementEndDate: '2026-12-20', oldTotal: 7358, newTotal: 7725.9, difference: 367.9, needsReview: false }


describe('usePatternChange', () => {
  it('posts the whole change to the source revision, and a preview refreshes nothing', async () => {
    const seen: InternalAxiosRequestConfig[] = []
    answering(result, seen)
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result: hook } = renderHook(() => usePatternChange(), { wrapper: wrapperFor(client) })

    hook.current.mutate({ participantId: 'participant-1', draftId: 'draft-2', data: change })

    await waitFor(() => expect(hook.current.isSuccess).toBe(true))
    expect(seen[0].method).toBe('post')
    expect(seen[0].url).toBe('/participants/participant-1/service-agreement-drafts/draft-2/pattern-change')
    expect(JSON.parse(seen[0].data as string)).toEqual(change)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('a saved revision refreshes the agreement, the onboarding checklist and the worklist', async () => {
    answering({ ...result, draftId: 'draft-3' }, [])
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result: hook } = renderHook(() => usePatternChange(), { wrapper: wrapperFor(client) })

    hook.current.mutate({ participantId: 'participant-1', draftId: 'draft-2', data: { ...change, preview: false } })

    await waitFor(() => expect(hook.current.isSuccess).toBe(true))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['service-agreement-drafts', 'participant-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['onboarding', 'participant-1'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['participant-onboarding-worklist'] })
  })
})
