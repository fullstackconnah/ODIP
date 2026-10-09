import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DraftApprovalPreviewDto } from '../types'

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiGet, apiPost }
})

import { apiClient } from '../client'
import { APPROVE_TIMEOUT_MS, fileNameFromDisposition, useApprovalPreview, useApproveServiceAgreementDraft, useDownloadServiceAgreementDraftPdf } from './service-agreement-drafts'

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

    // With the approval's own time limit: the dialog holds every way out while it is on its way, and the shared client has no timeout, so a dropped connection must not hold it for ever.
    expect(apiPost).toHaveBeenNthCalledWith(1, '/participants/p1/service-agreement-drafts/d1/approve', { acknowledgeOverlaps: true }, { timeout: 30_000 })
    expect(apiPost).toHaveBeenNthCalledWith(2, '/participants/p1/service-agreement-drafts/d2/approve', { acknowledgeOverlaps: false }, { timeout: 30_000 })
    expect(APPROVE_TIMEOUT_MS).toBe(30_000)
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

// What the server sends for "Service agreement - José Núñez - 2026-10-12.pdf": an ASCII filename for clients that cannot read more, and the RFC 5987 filename* with the letters.
const JOSE = "attachment; filename=\"Service agreement - Jos_ N__ez - 2026-10-12.pdf\"; filename*=UTF-8''Service%20agreement%20-%20Jos%C3%A9%20N%C3%BA%C3%B1ez%20-%202026-10-12.pdf"

describe('fileNameFromDisposition', () => {
  it('prefers the RFC 5987 filename* so the letters of the name arrive (José Núñez, Nguyễn Thị Hoa, Zoë OBrien)', () => {
    expect(fileNameFromDisposition(JOSE)).toBe('Service agreement - José Núñez - 2026-10-12.pdf')
    expect(fileNameFromDisposition("attachment; filename=\"Service agreement - Nguy_n Th_ Hoa - 2026-10-12.pdf\"; filename*=UTF-8''Service%20agreement%20-%20Nguy%E1%BB%85n%20Th%E1%BB%8B%20Hoa%20-%202026-10-12.pdf"))
      .toBe('Service agreement - Nguyễn Thị Hoa - 2026-10-12.pdf')
    expect(fileNameFromDisposition("attachment; filename=\"Service agreement - Zo_ OBrien - 2026-10-12.pdf\"; filename*=UTF-8''Service%20agreement%20-%20Zo%C3%AB%20OBrien%20-%202026-10-12.pdf"))
      .toBe('Service agreement - Zoë OBrien - 2026-10-12.pdf')
  })

  it('does not mind the order of the two, the case of the words or a language tag', () => {
    expect(fileNameFromDisposition("attachment; FILENAME*=utf-8'en'Jos%C3%A9.pdf; filename=\"Jos_.pdf\"")).toBe('José.pdf')
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''Jos%C3%A9.pdf")).toBe('José.pdf')
  })

  it('reads the plain filename, quoted or not, when there is no filename*', () => {
    expect(fileNameFromDisposition('attachment; filename="Service agreement - Ann Lee - 2026-10-12.pdf"')).toBe('Service agreement - Ann Lee - 2026-10-12.pdf')
    expect(fileNameFromDisposition('attachment; filename=agreement.pdf')).toBe('agreement.pdf')
  })

  it('leaves a percent sign in a plain filename alone and falls back to it when filename* cannot be decoded', () => {
    expect(fileNameFromDisposition('attachment; filename="100% sure.pdf"')).toBe('100% sure.pdf')
    expect(fileNameFromDisposition("attachment; filename=\"Jos_.pdf\"; filename*=UTF-8''Jos%C3%.pdf")).toBe('Jos_.pdf')
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''Jos%C3%.pdf")).toBeNull()
  })

  it('has no name for a header without one', () => {
    expect(fileNameFromDisposition(undefined)).toBeNull()
    expect(fileNameFromDisposition('')).toBeNull()
    expect(fileNameFromDisposition('attachment')).toBeNull()
  })
})

describe('useDownloadServiceAgreementDraftPdf', () => {
  afterEach(() => { vi.restoreAllMocks() })

  const saved = (header: string | undefined) => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['%PDF-']), headers: header === undefined ? {} : { 'content-disposition': header } })
    window.URL.createObjectURL = vi.fn(() => 'blob:agreement')
    window.URL.revokeObjectURL = vi.fn()
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    return names
  }

  it('saves the file under the name with its letters, from filename*', async () => {
    const names = saved(JOSE)
    const { result } = renderHook(() => useDownloadServiceAgreementDraftPdf(), { wrapper: wrapper(new QueryClient()) })

    await act(async () => { await result.current.mutateAsync({ participantId: 'p1', id: 'd1' }) })

    expect(apiClient.get).toHaveBeenCalledWith('/participants/p1/service-agreement-drafts/d1/pdf', { responseType: 'blob' })
    expect(names).toEqual(['Service agreement - José Núñez - 2026-10-12.pdf'])
  })

  it('saves it as service-agreement-draft-v{id}.pdf when the server named nothing', async () => {
    const names = saved(undefined)
    const { result } = renderHook(() => useDownloadServiceAgreementDraftPdf(), { wrapper: wrapper(new QueryClient()) })

    await act(async () => { await result.current.mutateAsync({ participantId: 'p1', id: 'd1' }) })

    expect(names).toEqual(['service-agreement-draft-vd1.pdf'])
  })
})
