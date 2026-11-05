import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { participantExportFailure, purgeFailure, useParticipantExport, usePurgeParticipant, RETENTION_DUE_KEY } from './data-retention'
import type { RetentionDueDto } from '../types'

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiPost: post, apiClient: Object.assign(Object.create(actual.apiClient), { get }) }
})

const answered = (status: number, data: unknown) =>
  new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, { status, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse)
const said = (status: number, sentence: string) => answered(status, { success: false, errors: [sentence] })
const wholeZip = () => { const bytes = new Uint8Array(2048); bytes.set([0x50, 0x4b, 0x05, 0x06], 2048 - 22); return bytes }

let clicked: string[] = []
beforeEach(() => {
  clicked = []
  window.URL.createObjectURL = vi.fn(() => 'blob:participant')
  window.URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download) })
})
afterEach(() => { vi.restoreAllMocks(); get.mockReset(); post.mockReset() })

const wrap = (client: QueryClient) => ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)

describe('useParticipantExport', () => {
  it('saves the ZIP under the name the server gave', async () => {
    get.mockResolvedValue({ data: new Blob([wholeZip()]), headers: { 'content-disposition': 'attachment; filename="bunya-support-participant-harold-whitby-2026-11-06.zip"' } })
    const { result } = renderHook(() => useParticipantExport(), { wrapper: wrap(new QueryClient()) })
    result.current.mutate({ participantId: 'p1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(get).toHaveBeenCalledWith('/data-export/participants/p1', { responseType: 'blob' })
    expect(clicked).toEqual(['bunya-support-participant-harold-whitby-2026-11-06.zip'])
  })

  it('a 404 says the record has gone and refetches the due list', async () => {
    get.mockRejectedValue(answered(404, new Blob(['{}'])))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => useParticipantExport(), { wrapper: wrap(client) })
    result.current.mutate({ participantId: 'p1' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toMatchObject({ title: 'That record is no longer here', body: 'It may already have been purged. The list is refreshed.', retry: false })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: RETENTION_DUE_KEY })
    expect(clicked).toEqual([])
  })

  it('a body that is not a whole ZIP is never saved', async () => {
    get.mockResolvedValue({ data: new Blob([new Uint8Array(2048)]), headers: {} })
    const { result } = renderHook(() => useParticipantExport(), { wrapper: wrap(new QueryClient()) })
    result.current.mutate({ participantId: 'p1' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(clicked).toEqual([])
  })
})

describe('participantExportFailure', () => {
  it('reuses the data export words for a 429 and says the download stopped for anything else', async () => {
    expect(await participantExportFailure(answered(429, new Blob(['{}'])))).toMatchObject({ title: 'An export is already running', retry: true })
    expect(await participantExportFailure(new AxiosError('Network Error', 'ERR_NETWORK'))).toEqual({
      title: "The download didn't finish",
      body: 'The download stopped before the file was complete, so nothing was saved. Try again.',
      retry: true,
    })
  })
})

describe('usePurgeParticipant', () => {
  it('takes the row out of the cached list on success and refetches the list and the tasks', async () => {
    post.mockResolvedValue({ id: 'r1', participantId: 'p1' })
    const client = new QueryClient()
    const row = (id: string) => ({ participantId: id }) as RetentionDueDto
    client.setQueryData(RETENTION_DUE_KEY, [row('p1'), row('p2')])
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { result } = renderHook(() => usePurgeParticipant(), { wrapper: wrap(client) })
    result.current.mutate({ participantId: 'p1', lastName: 'Campbell', reason: 'Seven years' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(post).toHaveBeenCalledWith('/data-retention/p1/purge', { lastName: 'Campbell', reason: 'Seven years' })
    expect(client.getQueryData<RetentionDueDto[]>(RETENTION_DUE_KEY)?.map((r) => r.participantId)).toEqual(['p2'])
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks'] })
  })
})

describe('purgeFailure', () => {
  it('409 NotDue holds the confirm and refreshes the list', () => {
    expect(purgeFailure(said(409, "This record isn't due for purge."))).toEqual({
      message: "This record isn't due for purge. It may have been restored or have newer activity, so its 7 years start again. The list is refreshed.",
      refresh: true,
      final: true,
    })
  })

  it('409 CouldNotFinish keeps the server sentence and the confirm', () => {
    const sentence = "The purge couldn't finish. Nothing was deleted. Try again."
    expect(purgeFailure(said(409, sentence))).toEqual({ message: sentence, refresh: false, final: false })
  })

  it('400 maps the two field sentences to their fields', () => {
    expect(purgeFailure(said(400, "The last name doesn't match."))).toMatchObject({ field: 'lastName' })
    expect(purgeFailure(said(400, 'Give a reason for the purge.'))).toMatchObject({ field: 'reason' })
    expect(purgeFailure(said(400, 'Keep the reason to 500 characters or fewer.'))).toEqual({ message: 'Keep the reason to 500 characters or fewer.', refresh: false, final: false })
  })

  it('404 and no response refresh the list', () => {
    expect(purgeFailure(said(404, 'Participant not found'))).toEqual({ message: 'This record is no longer here. It may already have been purged.', refresh: true, final: true })
    expect(purgeFailure(new AxiosError('Network Error', 'ERR_NETWORK'))).toEqual({ message: "Couldn't confirm the purge. Check the list before trying again.", refresh: true, final: false })
  })
})
