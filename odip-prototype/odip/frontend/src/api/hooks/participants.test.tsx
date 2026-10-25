import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useBeginServices, useCreateParticipant, useDeleteParticipant, useMakeParticipantActive, usePatchParticipant, useParticipants, useSupportProfile, useUpdateSupportProfile } from './participants'
import type { PatchParticipantDto, SupportProfileDto } from '../types'

// CORE-02: usePatchParticipant is a thin TanStack Query mutation wrapper around apiPatchRaw — only
// that named export needs mocking (the rest of the module, e.g. apiPutRaw used by
// useUpdateParticipant, stays real).
const { mockApiPatchRaw, mockApiPostRaw, mockApiGet, mockApiDeleteRaw, mockApiPutRaw } = vi.hoisted(() => ({
  mockApiPutRaw: vi.fn(),
  mockApiDeleteRaw: vi.fn(),
  mockApiPatchRaw: vi.fn(),
  mockApiPostRaw: vi.fn(),
  mockApiGet: vi.fn(),
}))

vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiPatchRaw: mockApiPatchRaw, apiPostRaw: mockApiPostRaw, apiGet: mockApiGet, apiDeleteRaw: mockApiDeleteRaw, apiPutRaw: mockApiPutRaw }
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

// Creating a participant ("Save as draft" or "Complete intake" in the Intake wizard, /participants/new) changes more than the register: a draft with an open intake
// is a row on the Enquiries tab (a direct intake, in the GET /inquiries feed), and a completed intake is on the Onboarding tab. The app's 30s staleTime would
// otherwise show a tab loaded in the last 30 seconds without the new participant.
describe('useCreateParticipant', () => {
  beforeEach(() => {
    mockApiPostRaw.mockReset()
  })

  it('refreshes the register, the onboarding worklist and the enquiries feed on success', async () => {
    mockApiPostRaw.mockResolvedValue({ success: true, data: { id: 'p-new' }, message: null, errors: null })
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ firstName: 'Dana', lastName: 'Direct', isDraft: true, completeIntake: false } as never)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPostRaw).toHaveBeenCalledWith('/participants', expect.objectContaining({ firstName: 'Dana', lastName: 'Direct', isDraft: true, completeIntake: false }))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participants'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participant-onboarding-worklist'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participant-inquiries'] })
  })

  it('does not invalidate any query when the create fails', async () => {
    mockApiPostRaw.mockRejectedValue(new Error('network error'))
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCreateParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ firstName: 'Dana', lastName: 'Direct' } as never)

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

describe('useBeginServices / useMakeParticipantActive', () => {
  it.each([
    ['begin-services', useBeginServices],
    ['make-active', useMakeParticipantActive],
  ] as const)('posts %s with an empty body, and refreshes the checklist, the lists and the roster board', async (action, useAction) => {
    mockApiPostRaw.mockReset().mockResolvedValue({ success: true, data: { id: 'p7' } })
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useAction(), { wrapper: createWrapper(queryClient) })

    result.current.mutate({ id: 'p7' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiPostRaw).toHaveBeenCalledWith(`/participants/p7/${action}`, {})
    for (const key of [['onboarding', 'p7'], ['participant-onboarding-worklist'], ['participants'], ['roster-board']])
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key })
  })
})

describe('useDeleteParticipant', () => {
  it('refreshes the list and the detail page it archived from', async () => {
    mockApiDeleteRaw.mockResolvedValue({ success: true, data: true, message: null, errors: null })
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useDeleteParticipant(), { wrapper: createWrapper(queryClient) })

    result.current.mutate('p9')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApiDeleteRaw).toHaveBeenCalledWith('/participants/p9')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participants'] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['participant', 'p9'] })
  })
})

// PP-S2 D9: every support-profile topic card PUTs the WHOLE record (the PUT nulls any field left out), so the body is built when the
// mutation runs from the cache, and each save writes its full body back into the cache before the refetch.
describe('useUpdateSupportProfile', () => {
  const notFound = () => Object.assign(new Error('Support profile not found'), { response: { status: 404 } })
  const profile: SupportProfileDto = {
    id: 'sp1', participantId: 'p1', communicationNotes: 'Uses Auslan', behaviourSupportNotes: 'Quiet room', restrictivePracticeDetails: 'legacy',
    manualHandlingNotes: 'Two person', medicationHealthSummary: 'Daily tablets', emergencyConsiderations: null, travelSpecificNotes: null, reviewDate: '2026-03-01T00:00:00',
  }
  const ok = { success: true, data: { id: 'sp1', participantId: 'p1' }, message: null, errors: null }
  function setup() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const hook = renderHook(() => ({ query: useSupportProfile('p1'), save: useUpdateSupportProfile() }), { wrapper: createWrapper(queryClient) })
    return { queryClient, ...hook }
  }
  const save = (r: ReturnType<typeof setup>['result'], fields: object) => r.current.save.mutateAsync({ id: 'p1', fields })

  beforeEach(() => {
    mockApiPutRaw.mockReset()
    mockApiGet.mockReset()
    mockApiPutRaw.mockResolvedValue(ok)
  })

  it('carries every other topic when two cards are saved back to back and the GET stays 404', async () => {
    mockApiGet.mockRejectedValue(notFound())
    const { result, queryClient } = setup()
    await waitFor(() => expect(result.current.query.isError).toBe(true))

    await save(result, { emergencyConsiderations: 'X' })
    await save(result, { travelSpecificNotes: 'Y' })

    expect(mockApiPutRaw).toHaveBeenNthCalledWith(1, '/participants/p1/support-profile', expect.objectContaining({ emergencyConsiderations: 'X' }))
    expect(mockApiPutRaw.mock.calls[1][1]).toEqual({ emergencyConsiderations: 'X', travelSpecificNotes: 'Y' })
    expect(queryClient.getQueryData<SupportProfileDto>(['support-profile', 'p1'])?.id).toBe('sp1')
  })

  it('keeps both cards text when the second is saved while the first PUT is still in flight', async () => {
    mockApiGet.mockResolvedValueOnce(profile).mockRejectedValue(notFound())
    const { result } = setup()
    await waitFor(() => expect(result.current.query.data).toBeDefined())
    let release!: () => void
    mockApiPutRaw.mockImplementationOnce(() => new Promise((res) => { release = () => res(ok) }))

    const first = save(result, { emergencyConsiderations: 'X' })
    const second = save(result, { travelSpecificNotes: 'Y' })
    await waitFor(() => expect(mockApiPutRaw).toHaveBeenCalledTimes(1))
    release()
    await Promise.all([first, second])

    expect(mockApiPutRaw).toHaveBeenCalledTimes(2)
    expect(mockApiPutRaw.mock.calls[1][1]).toMatchObject({ emergencyConsiderations: 'X', travelSpecificNotes: 'Y', communicationNotes: 'Uses Auslan', reviewDate: '2026-03-01' })
  })

  it('sends the whole record, leaving no loaded topic out', async () => {
    mockApiGet.mockResolvedValue(profile)
    const { result } = setup()
    await waitFor(() => expect(result.current.query.data).toBeDefined())

    await save(result, { manualHandlingNotes: 'Hoist' })

    expect(mockApiPutRaw.mock.calls[0][1]).toEqual({
      communicationNotes: 'Uses Auslan', behaviourSupportNotes: 'Quiet room', manualHandlingNotes: 'Hoist', medicationHealthSummary: 'Daily tablets',
      emergencyConsiderations: undefined, travelSpecificNotes: undefined, reviewDate: '2026-03-01',
    })
  })

  it('refuses to save, and sends no PUT, while the profile is still loading', async () => {
    mockApiGet.mockReturnValue(new Promise(() => {}))
    const { result } = setup()

    await expect(save(result, { emergencyConsiderations: 'X' })).rejects.toThrow('Support profile has not loaded')
    expect(mockApiPutRaw).not.toHaveBeenCalled()
  })

  it('creates the profile on a first save when the GET is 404', async () => {
    mockApiGet.mockRejectedValue(notFound())
    const { result } = setup()
    await waitFor(() => expect(result.current.query.isError).toBe(true))

    await save(result, { communicationNotes: 'Pictures' })

    expect(mockApiPutRaw.mock.calls[0][1]).toEqual({ communicationNotes: 'Pictures' })
  })

  it('still saves from the cached record after a background refetch failed', async () => {
    mockApiGet.mockResolvedValueOnce(profile)
    const { result, queryClient } = setup()
    await waitFor(() => expect(result.current.query.data).toBeDefined())
    mockApiGet.mockRejectedValue(new Error('boom'))
    await queryClient.refetchQueries({ queryKey: ['support-profile', 'p1'] })
    expect(queryClient.getQueryState(['support-profile', 'p1'])?.status).toBe('error')
    expect(queryClient.getQueryData(['support-profile', 'p1'])).toBeDefined()

    await save(result, { emergencyConsiderations: 'X' })

    expect(mockApiPutRaw.mock.calls[0][1]).toMatchObject({ emergencyConsiderations: 'X', communicationNotes: 'Uses Auslan' })
  })
})
