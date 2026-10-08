import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { useFundingLedger } from '@/api/hooks/funding-ledger'
import { useClaim } from '@/api/hooks/claims'
import { useUpdateBudgetSettings } from '@/api/hooks/funding'
import {
  useApproveCompletion,
  useApproveCompletionsBatch,
  useCreateShift,
  useDeleteShift,
  useGeneratePattern,
  useUpdateShift,
} from '@/api/hooks/rostering'
import { useCancelBooking, useCreateBooking, useDeleteBooking, usePatchBooking, useUpdateBooking } from '@/api/hooks/bookings'
import { usePatchTrip, useUpdateTrip } from '@/api/hooks/trips'
import { useApproveServiceAgreementDraft } from '@/api/hooks/service-agreement-drafts'
import { participantLedger } from '@/test/fixtures/ledger'

// ---------------------------------------------------------------------------
// The 2026-10-08 review, L5-05: a cached ledger (and the budget block on a claim page) was refreshed after claim and plan writes only. A shift or a trip booking changes what the
// server works out on the next read of it (a completed shift moves from booked ahead to pending, a confirmed booking is booked ahead, a cancelled one is nothing), and the "approaching"
// percentage changes every status, so each of those writes has to mark the ledgers this client holds, and the claim pages, as stale.
//
// The REAL hooks run on a REAL QueryClient; only the transport boundary (the axios adapter on the real client) is replaced, as in claims-ledger-cache.test.tsx. A mounted ledger observer is
// what makes a missing invalidation visible: without it the cached figures are served untouched.
// ---------------------------------------------------------------------------

const LEDGER_URL = '/participants/participant-1/funding/ledger'
const LEDGER_URL_2 = '/participants/participant-2/funding/ledger'
const CLAIM_URL = '/claims/claim-1'

interface Call {
  method: string
  url: string
}

const calls: Call[] = []

function axiosPayload(data: unknown): AxiosResponse {
  return { data: { data }, status: 200, statusText: 'OK', headers: {}, config: { headers: {} as never } } as AxiosResponse
}

beforeEach(() => {
  calls.length = 0
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const url = String(config.url ?? '')
    const method = String(config.method ?? 'get').toLowerCase()
    calls.push({ method, url })
    if (method === 'get' && (url === LEDGER_URL || url === LEDGER_URL_2)) return axiosPayload(participantLedger())
    if (method === 'get' && url === CLAIM_URL) return axiosPayload({ id: 'claim-1', kind: 'Trip', lineItems: [] })
    if (method === 'get') throw new Error(`test: unmocked GET ${url}`)
    return axiosPayload(true)   // every write answers success: what is under test is what the hook does with it
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = undefined
  vi.restoreAllMocks()
})

const makeClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } } })

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

const gets = (url: string) => calls.filter(c => c.method === 'get' && c.url === url).length

/** Two participants' ledgers and one claim page held open, as an office screen might hold them. */
async function mountPages(qc: QueryClient) {
  const wrapper = wrapperFor(qc)
  const first = renderHook(() => useFundingLedger('participant-1'), { wrapper })
  const second = renderHook(() => useFundingLedger('participant-2'), { wrapper })
  const claim = renderHook(() => useClaim('claim-1'), { wrapper })
  await waitFor(() => expect(first.result.current.isSuccess && second.result.current.isSuccess && claim.result.current.isSuccess).toBe(true))
  expect([gets(LEDGER_URL), gets(LEDGER_URL_2), gets(CLAIM_URL)]).toEqual([1, 1, 1])
}

type Writer = { mutateAsync: (variables: never) => Promise<unknown> }

interface Case {
  name: string
  use: () => Writer
  variables: unknown
  method: string
  url: string
  /** The invalidation the hook already did before: it must still do it. */
  keeps: unknown[]
  /** A write that names the participant it moves money for refreshes that ledger and no other. */
  named?: string
}

const cases: Case[] = [
  { name: 'a shift is created', use: useCreateShift, variables: { participantId: 'participant-1' }, method: 'post', url: '/rostering/shifts', keeps: ['roster-board'], named: 'participant-1' },
  { name: 'a shift is updated', use: useUpdateShift, variables: { id: 'shift-1', data: {} }, method: 'put', url: '/rostering/shifts/shift-1', keeps: ['roster-board'] },
  { name: 'a shift is cancelled', use: useDeleteShift, variables: 'shift-1', method: 'delete', url: '/rostering/shifts/shift-1', keeps: ['roster-board'] },
  { name: 'a completion is approved', use: useApproveCompletion, variables: 'shift-1', method: 'post', url: '/rostering/shifts/shift-1/completion/approve', keeps: ['rostering-completions'] },
  { name: 'completions are approved in a batch', use: useApproveCompletionsBatch, variables: ['shift-1', 'shift-2'], method: 'post', url: '/rostering/completions/approve-batch', keeps: ['rostering-completions'] },
  { name: 'shifts are made from a pattern', use: useGeneratePattern, variables: { id: 'pattern-1', from: '2026-10-05', to: '2026-10-30' }, method: 'post', url: '/rostering/patterns/pattern-1/generate', keeps: ['roster-patterns'] },
  { name: 'an agreement is approved for rostering', use: useApproveServiceAgreementDraft, variables: { participantId: 'participant-1', draftId: 'draft-1', acknowledgeOverlaps: false }, method: 'post', url: '/participants/participant-1/', keeps: ['roster-board'], named: 'participant-1' },
  { name: 'a trip booking is made (confirmed)', use: useCreateBooking, variables: { tripInstanceId: 'trip-1', participantId: 'participant-1' }, method: 'post', url: '/bookings', keeps: ['bookings'], named: 'participant-1' },
  { name: 'a trip booking is changed (confirmed)', use: useUpdateBooking, variables: { id: 'booking-1', data: {} }, method: 'put', url: '/bookings/booking-1', keeps: ['bookings'] },
  { name: 'a trip booking is patched (confirmed)', use: usePatchBooking, variables: { id: 'booking-1', data: { bookingStatus: 'Confirmed' } }, method: 'patch', url: '/bookings/booking-1', keeps: ['bookings'] },
  { name: 'a trip booking is cancelled', use: useCancelBooking, variables: { id: 'booking-1', data: {} }, method: 'put', url: '/bookings/booking-1', keeps: ['bookings'] },
  { name: 'a trip booking is deleted', use: useDeleteBooking, variables: 'booking-1', method: 'delete', url: '/bookings/booking-1', keeps: ['bookings'] },
  { name: 'a trip is updated (status, dates)', use: useUpdateTrip, variables: { id: 'trip-1', data: { status: 'Completed' } }, method: 'put', url: '/trips/trip-1', keeps: ['trips'] },
  { name: 'a trip is patched (status)', use: usePatchTrip, variables: { id: 'trip-1', data: { status: 'InProgress' } }, method: 'patch', url: '/trips/trip-1', keeps: ['trips'] },
  { name: 'the budget settings are saved (the approaching percent)', use: useUpdateBudgetSettings, variables: { mode: 'Warn', approachingPercent: 70 }, method: 'put', url: '/funding/settings', keeps: [] },
]

describe('a write that moves a participant\'s money refreshes the ledgers this client holds and the claim pages', () => {
  it.each(cases)('$name', async ({ use, variables, method, url, keeps, named }) => {
    const qc = makeClient()
    await mountPages(qc)
    const invalidated: unknown[][] = []
    const real = qc.invalidateQueries.bind(qc)
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters?: { queryKey?: readonly unknown[] }) => {
      if (filters?.queryKey) invalidated.push([...filters.queryKey])
      return real(filters as never)
    })

    const mutation = renderHook(() => use(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync(variables as never)

    expect(calls.some(c => c.method === method && c.url.startsWith(url))).toBe(true)
    // The claim page is read again (its budget block is the ledger's answer as of its last read), and so are the open ledgers: all of them for a write that does not say whose money it
    // moves, only the named participant's for one that does.
    await waitFor(() => expect(gets(LEDGER_URL)).toBe(2), { timeout: 2000 })
    await waitFor(() => expect(gets(CLAIM_URL)).toBe(2), { timeout: 2000 })
    expect(invalidated).toEqual(expect.arrayContaining([['participant-funding', 'participant-1', 'ledger'], ['claim']]))
    if (named) {
      expect(invalidated).not.toContainEqual(['participant-funding', 'participant-2', 'ledger'])
      expect(gets(LEDGER_URL_2)).toBe(1)
    } else {
      await waitFor(() => expect(gets(LEDGER_URL_2)).toBe(2), { timeout: 2000 })
      expect(invalidated).toContainEqual(['participant-funding', 'participant-2', 'ledger'])
    }
    if (keeps.length > 0) expect(invalidated).toEqual(expect.arrayContaining([keeps]))
  })

  it('does nothing to any other participant\'s cache when no ledger is held', async () => {
    const qc = makeClient()
    const mutation = renderHook(() => useCreateShift(), { wrapper: wrapperFor(qc) })

    await mutation.result.current.mutateAsync({ participantId: 'participant-1' } as never)

    expect(calls.filter(c => c.method === 'get')).toEqual([])   // nothing was held, so nothing is read: the refresh walks the cache and invents no key
  })
})
