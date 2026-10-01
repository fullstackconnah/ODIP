import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { usePatchParticipant, useParticipants } from './participants'
import type { PatchParticipantDto } from '../types'

// CORE-02: usePatchParticipant is a thin TanStack Query mutation wrapper around apiPatchRaw — only
// that named export needs mocking (the rest of the module, e.g. apiPutRaw used by
// useUpdateParticipant, stays real).
const { mockApiPatchRaw, mockApiGet } = vi.hoisted(() => ({
  mockApiPatchRaw: vi.fn(),
  mockApiGet: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiPatchRaw: mockApiPatchRaw, apiGet: mockApiGet }
})

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('usePatchParticipant', () => {
  beforeEach(() => {
    mockApiPatchRaw.mockReset()
  })

  it('PATCHes /participants/{id} with exactly the caller-supplied PatchParticipantDto', async () => {
    mockApiPatchRaw.mockResolvedValue({ success: true, data: { id: 'p1' }, message: null, errors: null })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => usePatchParticipant(), { wrapper: createWrapper(queryClient) })

    const data: PatchParticipantDto = { personalDetails: { firstName: 'Sophie', lastName: 'Brown' } }
    result.current.mutate({ id: 'p1', data })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPatchRaw).toHaveBeenCalledWith('/participants/p1', data)
    expect(mockApiPatchRaw).toHaveBeenCalledTimes(1)
  })

  it('invalidates both the participants list query and the single participant query on success', async () => {
    mockApiPatchRaw.mockResolvedValue({ success: true, data: { id: 'p42' }, message: null, errors: null })
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePatchParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ id: 'p42', data: { keyIdentifiers: { weightKg: 60 } } })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participants'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participant', 'p42'] })
  })

  it('does not invalidate any query when the PATCH fails', async () => {
    mockApiPatchRaw.mockRejectedValue(new Error('network error'))
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => usePatchParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ id: 'p1', data: {} })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

// UX-audit-round-2: ParticipantsController clamps pageSize to a ceiling of 200 and defaults to 50
// when the caller omits it. useParticipants must request the ceiling explicitly rather than
// silently accepting the server's smaller default (which used to cap the list at 50 rows with no
// signal that more participants existed). The resolved array also carries `totalCount`/
// `isTruncated` (see pagedList.ts) so a caller like ParticipantPicker can tell the user when even
// the 200-row ceiling didn't cover every participant.
describe('useParticipants', () => {
  beforeEach(() => {
    mockApiGet.mockReset()
  })

  it('requests the server pageSize ceiling (200) rather than the default', async () => {
    mockApiGet.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 200, totalPages: 0, hasNext: false, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useParticipants({ isDraft: 'false' }), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiGet).toHaveBeenCalledWith('/participants', { pageSize: '200', isDraft: 'false' })
  })

  it('resolves to the flat items array so existing call sites keep destructuring an array', async () => {
    const items = [{ id: 'p1' }, { id: 'p2' }]
    mockApiGet.mockResolvedValue({ items, totalCount: 2, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useParticipants(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(Array.isArray(result.current.data)).toBe(true)
    expect([...(result.current.data ?? [])]).toEqual(items)
  })

  it('marks the array isTruncated when the tenant has more participants than the returned page', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}` }))
    mockApiGet.mockResolvedValue({ items, totalCount: 340, page: 1, pageSize: 200, totalPages: 2, hasNext: true, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useParticipants(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(true)
    expect(result.current.data?.totalCount).toBe(340)
    expect(result.current.data?.length).toBe(200)
  })

  it('marks the array not truncated when every participant fits on one page', async () => {
    const items = [{ id: 'p1' }, { id: 'p2' }]
    mockApiGet.mockResolvedValue({ items, totalCount: 2, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useParticipants(), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.isTruncated).toBe(false)
    expect(result.current.data?.totalCount).toBe(2)
  })

  // WARN mode: each list item may carry what is still missing for that participant (omitted when nothing is). The hook flattens the
  // page but must hand each item over untouched, so the roster board's shift panel and the trip booking modal can show it.
  it('hands every item over untouched: readinessIssues survives, and is simply absent where the server omitted it', async () => {
    const items = [
      { id: 'p1', fullName: 'Mia Chen', readinessIssues: ['Intake not complete', 'No signed service agreement'] },
      { id: 'p2', fullName: 'Noah Reid' },
    ]
    mockApiGet.mockResolvedValue({ items, totalCount: 2, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false })
    const queryClient = new QueryClient()
    const { result } = renderHook(() => useParticipants({ isDraft: 'false' }), { wrapper: createWrapper(queryClient) })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [mia, noah] = result.current.data ?? []
    expect(mia.readinessIssues).toEqual(['Intake not complete', 'No signed service agreement'])
    expect(noah).not.toHaveProperty('readinessIssues')
    expect([...(result.current.data ?? [])]).toEqual(items)
  })
})
