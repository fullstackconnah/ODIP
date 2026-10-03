import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DraftApprovalPreviewDto } from '../types'

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet, apiPost }
})

import { useApprovalPreview, useApproveServiceAgreementDraft } from './service-agreement-drafts'

const wrapper = (client: QueryClient) => function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const preview = (changes: Partial<DraftApprovalPreviewDto> = {}): DraftApprovalPreviewDto => ({
  canApprove: true, alreadyApproved: false, reasons: [], patternsToCreate: 5, patternsToEnd: 0, shiftsToCreate: 40, oldShiftsRemaining: { open: 0, assigned: 0 }, overlappingPatterns: [], ...changes,
})

beforeEach(() => { apiGet.mockReset(); apiPost.mockReset() })

describe('useApprovalPreview', () => {
  it('reads what approving would do from the preview endpoint of that revision, and nothing is posted', async () => {
    apiGet.mockResolvedValue(preview({ horizonEnd: '2026-12-05' }))
    const { result } = renderHook(() => useApprovalPreview('p1', 'd1'), { wrapper: wrapper(new QueryClient()) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(apiGet).toHaveBeenCalledWith('/participants/p1/service-agreement-drafts/d1/approval-preview')
    expect(apiPost).not.toHaveBeenCalled()
    expect(result.current.data?.horizonEnd).toBe('2026-12-05')
  })

  it('asks nothing until it is wanted (the confirm dialog is open) or for a revision that is not there', () => {
    const client = new QueryClient()
    renderHook(() => useApprovalPreview('p1', 'd1', false), { wrapper: wrapper(client) })
    renderHook(() => useApprovalPreview('p1', undefined), { wrapper: wrapper(client) })
    renderHook(() => useApprovalPreview(undefined, 'd1'), { wrapper: wrapper(client) })

    expect(apiGet).not.toHaveBeenCalled()
  })

  it('is read again each time it is opened: what approving would do depends on the roster as it is now', async () => {
    apiGet.mockResolvedValue(preview())
    const client = new QueryClient()
    const first = renderHook(() => useApprovalPreview('p1', 'd1'), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true))
    first.unmount()

    renderHook(() => useApprovalPreview('p1', 'd1'), { wrapper: wrapper(client) })

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2))
  })
})

describe('useApproveServiceAgreementDraft', () => {
  it('posts the acknowledgement, every time, to the approve endpoint of that revision', async () => {
    apiPost.mockResolvedValue({ id: 'd1', version: 2 })
    const { result } = renderHook(() => useApproveServiceAgreementDraft(), { wrapper: wrapper(new QueryClient()) })

    await act(async () => { await result.current.mutateAsync({ participantId: 'p1', draftId: 'd1', acknowledgeOverlaps: true }) })
    await act(async () => { await result.current.mutateAsync({ participantId: 'p1', draftId: 'd2', acknowledgeOverlaps: false }) })

    expect(apiPost).toHaveBeenNthCalledWith(1, '/participants/p1/service-agreement-drafts/d1/approve', { acknowledgeOverlaps: true })
    expect(apiPost).toHaveBeenNthCalledWith(2, '/participants/p1/service-agreement-drafts/d2/approve', { acknowledgeOverlaps: false })
  })

  it('refreshes everything an approval changed: the revisions, the patterns, the board and the participant\'s rostering', async () => {
    apiPost.mockResolvedValue({ id: 'd1', version: 2 })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useApproveServiceAgreementDraft(), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync({ participantId: 'p1', draftId: 'd1', acknowledgeOverlaps: false }) })

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([
      ['service-agreement-drafts', 'p1'], ['service-agreement-draft', 'p1'], ['roster-board'], ['roster-patterns'], ['participant-rostering', 'p1'],
    ]))
  })

  it('refreshes only the revisions and the preview when it is refused (a newer revision may exist), and leaves the roster alone', async () => {
    apiPost.mockRejectedValue({ response: { status: 409, data: { success: false, code: 'draft-superseded', errors: ['A newer revision of this agreement draft exists. Approve the latest revision instead.'] } } })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useApproveServiceAgreementDraft(), { wrapper: wrapper(client) })

    await act(async () => { await result.current.mutateAsync({ participantId: 'p1', draftId: 'd1', acknowledgeOverlaps: false }).catch(() => undefined) })

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toEqual(expect.arrayContaining([['service-agreement-drafts', 'p1'], ['service-agreement-draft-approval-preview', 'p1', 'd1']]))
    expect(keys).not.toContainEqual(['roster-board'])
    expect(keys).not.toContainEqual(['roster-patterns'])
  })
})
