import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ledgerKey, useFundingLedger } from '@/api/hooks/funding-ledger'
import { useClaim, useGenerateClaim, useUpdateClaimLineItem } from '@/api/hooks/claims'
import { participantLedger } from '@/test/fixtures/ledger'
import type { TripClaimDetailDto, TripClaimListDto } from '@/api/types'

// ---------------------------------------------------------------------------
// PR193 follow-up: the trip-generate response the server really sends, and the
// cache fallback that carries its invalidation.
//
// The server answers POST /trips/{id}/claims with a TripClaimListDto, not a claim
// detail. ClaimsController.GenerateClaim is declared
// Task<ActionResult<ApiResponse<TripClaimListDto>>> and maps only
// Id / Kind / TripInstanceId / TripName / Status / ClaimReference / TotalAmount /
// CreatedAt / SubmittedDate. A Trip-kind claim omits participantId outright (the backend
// drops null fields) and that payload carries no line items at all -- so the
// named-participant branch of the invalidation cannot fire on this path, and what
// refreshes an open ledger after generating a trip claim is the FALLBACK to the ledger
// keys this client already holds.
//
// Scope of the defect this pins is the cached/mounted case: a query with a live observer
// keeps serving the figures it fetched, so a claim write that skips invalidation leaves
// that open ledger showing the spent money as still available. A component that remounts
// (a fresh navigation to the ledger) refetches on its own, which mitigates but does not
// cover it -- this is not a claim of a permanently stale screen.
//
// Same real hooks, same real QueryClient, only the axios transport adapter swapped,
// as in the sibling suite. The sibling suite claims-ledger-cache.test.tsx now mocks this
// same real shape, so these tests pin the premise and the fallback on their own rather
// than contrasting against a fiction. Fixtures are typed against the DTOs the server maps.
// ---------------------------------------------------------------------------

const LEDGER_URL_1 = '/participants/participant-1/funding/ledger'
const LEDGER_URL_2 = '/participants/participant-2/funding/ledger'
const TRIP_CLAIM_URL = '/trips/trip-1/claims'

interface Call {
  method: string
  url: string
}

const calls: Call[] = []
let adapter: AxiosAdapter

function axiosPayload(data: unknown): AxiosResponse {
  return {
    data: { data },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: {} as never },
  } as AxiosResponse
}

/** Exactly what ClaimsController.GenerateClaim returns for a Trip-kind claim: a
 * TripClaimListDto with no participantId and no line items. Typed as the DTO the
 * server maps rather than forced through a cast, so drift in that interface is a
 * compile error here instead of a fiction inside a test. */
function tripClaimListResponse(): TripClaimListDto {
  return {
    id: 'claim-1',
    kind: 'Trip',
    tripInstanceId: 'trip-1',
    tripName: 'Sydney overnight',
    status: 'Draft',
    claimReference: 'TC-4301-20261001',
    totalAmount: 400,
    createdAt: '2026-10-01T00:00:00Z',
  }
}

/** A claim detail holding one line item per named participant, as GET /claims/{id}
 * answers -- the real TripClaimDetailDto, real enum members included. */
function claimDetail(lineItemParticipants: string[]): TripClaimDetailDto {
  return {
    id: 'claim-1',
    kind: 'Trip',
    tripInstanceId: 'trip-1',
    tripName: 'Sydney overnight',
    status: 'Draft',
    claimReference: 'TC-4301-20261001',
    totalAmount: 400,
    createdAt: '2026-10-01T00:00:00Z',
    totalApprovedAmount: 100,
    authorisedByStaffId: null,
    authorisedByStaffName: null,
    paidDate: null,
    notes: null,
    lineItems: lineItemParticipants.map((participantId, index) => ({
      id: `line-${index + 1}`,
      tripClaimId: 'claim-1',
      participantBookingId: `booking-${index + 1}`,
      participantId,
      participantName: participantId,
      ndisNumber: 'NDIS-1',
      planType: 'PlanManaged',
      supportItemCode: 'CODE_01',
      dayType: 'Weekday',
      supportsDeliveredFrom: '2026-10-01T09:00:00Z',
      supportsDeliveredTo: '2026-10-01T17:00:00Z',
      hours: 8,
      unitPrice: 50,
      totalAmount: 400,
      gstCode: 'NoGST',
      claimType: 'Standard',
      cancellationReason: null,
      participantApproved: false,
      status: 'Submitted',
      rejectionReason: null,
      paidAmount: null,
    })),
  }
}

beforeEach(() => {
  calls.length = 0
  adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const url = String(config.url ?? '')
    const method = String(config.method ?? 'get').toLowerCase()
    calls.push({ method, url })
    if (method === 'get' && url === LEDGER_URL_1) return axiosPayload(participantLedger())
    if (method === 'get' && url === LEDGER_URL_2) return axiosPayload(participantLedger())
    if (method === 'get' && url === '/claims/claim-1') return axiosPayload(claimDetail(['participant-1']))
    if (method === 'post' && url === TRIP_CLAIM_URL) return axiosPayload(tripClaimListResponse())
    if (method === 'patch' && url === '/claims/claim-1/line-items/line-1') return axiosPayload(true)
    throw new Error(`test: unmocked ${method.toUpperCase()} ${url}`)
  }
  apiClient.defaults.adapter = adapter
})

afterEach(() => {
  apiClient.defaults.adapter = undefined
  vi.restoreAllMocks()
})

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  })
}

function wrapperFor(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

const gets = (url: string) => calls.filter((c) => c.method === 'get' && c.url === url).length

/** Mount a real useFundingLedger observer and hold it mounted for the rest of the
 * test: an active observer is what makes a missing invalidation observable at all. */
async function mountLedger(qc: QueryClient, participantId: 'participant-1' | 'participant-2') {
  const ledger = renderHook(() => useFundingLedger(participantId), { wrapper: wrapperFor(qc) })
  await waitFor(() => expect(ledger.result.current.isSuccess).toBe(true))
  expect(qc.getQueryData(ledgerKey(participantId))).toBeDefined()
  return ledger
}

/** Records the invalidation keys the client sees while still letting them take
 * effect, so a test can assert on the key set and still observe the refetches. */
function recordInvalidations(qc: QueryClient) {
  const keys: unknown[][] = []
  const real = qc.invalidateQueries.bind(qc)
  vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters?: { queryKey?: readonly unknown[] }) => {
    if (filters?.queryKey) keys.push([...filters.queryKey])
    return real(filters as never)
  })
  return keys
}

describe("trip-generate ledger refresh, against the server's real response shape", () => {
  it('the generated trip claim really names no participant', () => {
    // Guards the premise of the rest of this file: if the server ever starts
    // answering this payload with participants, the fallback stops being the thing
    // under test and these expectations need revisiting.
    const created = tripClaimListResponse()
    // Read it off the DTO as typed: the summary has a nullable participantId and
    // no line-items member at all (TripClaimListDto), so nothing here names anyone.
    expect(created.participantId).toBeUndefined()
    expect(Object.keys(created)).not.toContain('lineItems')
  })

  it('useGenerateClaim still refetches a mounted ledger when the response names nobody', async () => {
    const qc = makeClient()
    await mountLedger(qc, 'participant-1')
    expect(gets(LEDGER_URL_1)).toBe(1)

    const mutation = renderHook(() => useGenerateClaim(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync({ tripId: 'trip-1' })
    expect(calls.some((c) => c.method === 'post' && c.url === TRIP_CLAIM_URL)).toBe(true)

    // No participant id came back, so only the fallback can produce this refetch.
    await waitFor(() => expect(gets(LEDGER_URL_1)).toBe(2), { timeout: 2000 })
  })

  it('useGenerateClaim falls back to the open ledgers, not to an invented id', async () => {
    const qc = makeClient()
    await mountLedger(qc, 'participant-1')
    await mountLedger(qc, 'participant-2')
    const keys = recordInvalidations(qc)

    const mutation = renderHook(() => useGenerateClaim(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync({ tripId: 'trip-1' })

    // Every refreshed key is a ledger this client genuinely holds: the participants
    // come from the cache, never from the response and never from a guess.
    const ledgerKeys = keys.filter((key) => key[0] === 'participant-funding' && key[2] === 'ledger')
    expect(ledgerKeys).toEqual(
      expect.arrayContaining([
        ['participant-funding', 'participant-1', 'ledger'],
        ['participant-funding', 'participant-2', 'ledger'],
      ]),
    )
    // Its pre-existing invalidation is preserved.
    expect(keys).toEqual(expect.arrayContaining([['trip-claims', 'trip-1']]))
  })

  it('useGenerateClaim does not widen the refresh to the whole funding namespace', async () => {
    // The funding namespace also holds the plan record. A claim
    // write moves no plan figure, so the refresh must not be a bare-prefix
    // ['participant-funding'] invalidation that drags those along.
    const qc = makeClient()
    await mountLedger(qc, 'participant-1')
    const keys = recordInvalidations(qc)

    const mutation = renderHook(() => useGenerateClaim(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync({ tripId: 'trip-1' })

    expect(keys.some((key) => key.length === 1 && key[0] === 'participant-funding')).toBe(false)
  })

  it("a line-item edit moves the edited item's participant ledger only", async () => {
    // The participant is read off the claim detail the hook already holds, and
    // UpdateClaimLineItemDto has no participant field: an edit can change this item's
    // money, never whose it is. No moved-participant behaviour is asserted because the
    // payload cannot express one.
    const qc = makeClient()
    const wrapper = wrapperFor(qc)
    await mountLedger(qc, 'participant-1')
    await mountLedger(qc, 'participant-2')

    // Load the claim through the production hook, as the claim screen does, so the
    // line item's participant is known from the same source the hook reads.
    const claim = renderHook(() => useClaim('claim-1'), { wrapper })
    await waitFor(() => expect(claim.result.current.isSuccess).toBe(true))

    const mutation = renderHook(() => useUpdateClaimLineItem(), { wrapper })
    await mutation.result.current.mutateAsync({ claimId: 'claim-1', itemId: 'line-1', data: { hours: 4 } })
    expect(calls.some((c) => c.method === 'patch' && c.url === '/claims/claim-1/line-items/line-1')).toBe(true)

    await waitFor(() => expect(gets(LEDGER_URL_1)).toBe(2), { timeout: 2000 })
    expect(gets(LEDGER_URL_2)).toBe(1)
  })
})
