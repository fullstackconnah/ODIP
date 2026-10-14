import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { InAppNotificationDto, InboxDto } from '../types'

const { mockApiGet, mockApiPost } = vi.hoisted(() => ({ mockApiGet: vi.fn(), mockApiPost: vi.fn() }))

vi.mock('../client', () => ({ apiGet: mockApiGet, apiGetWithDefault: vi.fn(), apiPost: mockApiPost, apiPut: vi.fn() }))

import { INBOX_KEY, useInbox, useMarkAllInboxRead, useMarkInboxRead } from './notifications'

const wrapper = (qc: QueryClient) => ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const item = (id: string, read = false): InAppNotificationDto => ({
  id, title: `Item ${id}`, linkTo: '/portal', createdAt: '2026-10-13T23:00:00Z', ...(read ? { readAt: '2026-10-13T23:30:00Z' } : {}),
})
const inbox = (items: InAppNotificationDto[], hasMore = false): InboxDto => ({ items, unreadCount: items.filter(i => !i.readAt).length, hasMore })
const cached = (qc: QueryClient) => qc.getQueryData<InboxDto>(INBOX_KEY)

beforeEach(() => {
  mockApiGet.mockReset()
  mockApiPost.mockReset()
})

describe('useInbox', () => {
  it('asks for the newest 30, and polls every 60 s', async () => {
    mockApiGet.mockResolvedValue(inbox([item('a')]))
    const qc = client()
    const { result } = renderHook(() => useInbox(), { wrapper: wrapper(qc) })

    await waitFor(() => expect(result.current.data?.unreadCount).toBe(1))
    expect(mockApiGet).toHaveBeenCalledWith('/notifications/inbox', { take: 30 })
    expect(qc.getQueryCache().find({ queryKey: INBOX_KEY })?.observers[0]?.options.refetchInterval).toBe(60_000)
  })
})

describe('useMarkInboxRead', () => {
  it('posts to the item, and takes its dot and one unread off at once', async () => {
    const qc = client()
    qc.setQueryData(INBOX_KEY, inbox([item('a'), item('b')]))
    mockApiPost.mockReturnValue(new Promise(() => {})) // still in flight: the change below is the optimistic one
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper: wrapper(qc) })

    act(() => result.current.mutate('a'))

    await waitFor(() => expect(cached(qc)?.unreadCount).toBe(1))
    expect(cached(qc)?.items[0].readAt).toBeDefined()
    expect(cached(qc)?.items[1].readAt).toBeUndefined()
    expect(mockApiPost).toHaveBeenCalledWith('/notifications/inbox/a/read')
  })

  it('changes nothing for an item already read', async () => {
    const qc = client()
    qc.setQueryData(INBOX_KEY, inbox([item('a', true), item('b')]))
    mockApiPost.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useMarkInboxRead(), { wrapper: wrapper(qc) })

    act(() => result.current.mutate('a'))

    await waitFor(() => expect(mockApiPost).toHaveBeenCalled())
    expect(cached(qc)?.unreadCount).toBe(1)
  })
})

describe('useMarkAllInboxRead', () => {
  it('posts read-all, and clears every dot and the count at once', async () => {
    const qc = client()
    qc.setQueryData(INBOX_KEY, inbox([item('a'), item('b', true), item('c')], true))
    mockApiPost.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useMarkAllInboxRead(), { wrapper: wrapper(qc) })

    act(() => result.current.mutate())

    await waitFor(() => expect(cached(qc)?.unreadCount).toBe(0))
    expect(cached(qc)?.items.every(n => n.readAt)).toBe(true)
    expect(cached(qc)?.hasMore).toBe(true)
    expect(mockApiPost).toHaveBeenCalledWith('/notifications/inbox/read-all')
  })

  it('puts the dots back when the server refuses', async () => {
    const qc = client()
    const before = inbox([item('a'), item('b', true)])
    qc.setQueryData(INBOX_KEY, before)
    mockApiPost.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useMarkAllInboxRead(), { wrapper: wrapper(qc) })

    act(() => result.current.mutate())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(cached(qc)).toEqual(before)
  })

  /** Review Focus 5: the 60 s poll can be in the air when the button is pressed. Its stale answer must not bring the dots back. */
  it('markAll: a poll already in flight when it is pressed cannot bring the dots back', async () => {
    const qc = client()
    mockApiGet.mockResolvedValueOnce(inbox([item('a'), item('b')]))
    const { result } = renderHook(() => ({ inbox: useInbox(), markAll: useMarkAllInboxRead() }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.inbox.data?.unreadCount).toBe(2))

    let answerPoll!: (value: InboxDto) => void
    mockApiGet.mockReturnValueOnce(new Promise<InboxDto>(resolve => { answerPoll = resolve }))
    act(() => { void result.current.inbox.refetch() })   // the poll leaves, unanswered
    let answerPost!: () => void
    mockApiPost.mockReturnValue(new Promise<void>(resolve => { answerPost = resolve }))

    act(() => result.current.markAll.mutate())
    await waitFor(() => expect(result.current.inbox.data?.unreadCount).toBe(0))

    await act(async () => { answerPoll(inbox([item('a'), item('b')])) })   // the stale answer lands while the POST is out
    expect(result.current.inbox.data?.unreadCount).toBe(0)

    mockApiGet.mockResolvedValue(inbox([item('a', true), item('b', true)]))  // the server after read-all
    await act(async () => { answerPost() })
    await waitFor(() => expect(result.current.markAll.isSuccess).toBe(true))
    await waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(3))         // the refetch on settle
    expect(result.current.inbox.data?.unreadCount).toBe(0)
  })
})
