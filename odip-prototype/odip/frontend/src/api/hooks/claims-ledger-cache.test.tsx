import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { ledgerKey, useFundingLedger } from '@/api/hooks/funding-ledger'
import {
  useClaim,
  useGenerateClaim,
  useGenerateShiftClaim,
  useUpdateClaim,
  useUpdateClaimLineItem,
  useDeleteClaim,
} from '@/api/hooks/claims'
import { participantLedger } from '@/test/fixtures/ledger'
import type { TripClaimDetailDto } from '@/api/types'

// ---------------------------------------------------------------------------
// PR193 / budget phase 2a: a successful claim write must invalidate the cached
// budget ledger of every participant whose money it moves.
//
// What is under test
// ------------------
//   * The REAL hooks in src/api/hooks/claims.ts -- every claim mutation that
//     changes a participant's ledger amounts or states, on both surfaces:
//     the trip surface (generate / update / update-line-item / delete) and the
//     shift surface (claim-from-shifts).
//   * The REAL QueryClient and QueryClientProvider.
//
// What is mocked, and only this
// ----------------------------
//   * The TRANSPORT BOUNDARY: the axios adapter on the real `apiClient`
//     singleton from src/api/client.ts. Neither `@/api/client` nor `apiGet` /
//     `apiPost` is stubbed, so every hook above runs its genuine production
//     path -- its real query keys and its real onSuccess invalidation set. No
//     hook is replaced by a mock, which would test nothing.
//
// The contract
// ------------
//   The ledger lives at ['participant-funding', <id>, 'ledger'] (funding-ledger.ts).
//   Before PR193's fix every claim mutation invalidated only the claims / rostering
//   keys, so an ACTIVE, MOUNTED useFundingLedger observer kept serving pre-claim
//   money figures for that participant: an open ledger showing what the claim just
//   spent as still available.
// ---------------------------------------------------------------------------

const LEDGER_URL = '/participants/participant-1/funding/ledger'
const LEDGER_URL_2 = '/participants/participant-2/funding/ledger'
const SHIFT_CLAIM_URL = '/participants/participant-1/claims/from-shifts'
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

/** A claim detail naming exactly the participants it covers, mirroring
 * TripClaimDetailDto: `participantId` for a Shift-kind claim, one participant per
 * booking on the line items for a Trip-kind claim. */
function tripClaim(lineItemParticipants: string[]): TripClaimDetailDto {
  return {
    participantId: 'trip-sponsor',
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
      planType: 'PLAN_CAPACITIES',
      supportItemCode: 'CODE',
      dayType: 'Weekday',
      supportsDeliveredFrom: '2026-04-01T09:00:00Z',
      supportsDeliveredTo: '2026-04-01T17:00:00Z',
      hours: 8,
      unitPrice: 50,
      totalAmount: 400,
      gstCode: 'GST_FREE',
      claimType: 'SUPPORTED',
      cancellationReason: null,
      participantApproved: false,
      status: 'PENDING',
      rejectionReason: null,
      paidAmount: null,
    })),
  } as unknown as TripClaimDetailDto
}

beforeEach(() => {
  calls.length = 0

  // --- transport-boundary mock only ---------------------------------------
  adapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const url = String(config.url ?? '')
    const method = String(config.method ?? 'get').toLowerCase()
    calls.push({ method, url })

    if (method === 'get' && url === LEDGER_URL) return axiosPayload(participantLedger())
    if (method === 'get' && url === LEDGER_URL_2) return axiosPayload(participantLedger())
    if (method === 'get' && url === '/claims/claim-1') return axiosPayload(tripClaim(['participant-1']))
    if (method === 'post' && url === SHIFT_CLAIM_URL) return axiosPayload({ claims: [], total: 0 })
    if (method === 'post' && url === TRIP_CLAIM_URL) return axiosPayload(tripClaim(['participant-1']))
    if (method === 'put' && url === '/claims/claim-1') return axiosPayload(true)
    if (method === 'patch' && url === '/claims/claim-1/line-items/line-1') return axiosPayload(true)
    if (method === 'delete' && url === '/claims/claim-1') return axiosPayload(true)
    throw new Error(`test: unmocked ${method.toUpperCase()} ${url}`)
  }

  // apiClient is the real singleton from src/api/client.ts; only its adapter is
  // replaced, so baseURL / withCredentials / interceptors stay production.
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

const ledgerGets = (url: string) => calls.filter((c) => c.method === 'get' && c.url === url).length

/** Mount a real useFundingLedger observer and hold it mounted for the rest of the
 * test. An active observer is what makes a missing invalidation observable at
 * all: an unmounted query would refetch on remount for reasons unrelated to
 * invalidation, hiding the gap. */
async function mountLedger(qc: QueryClient, participantId: 'participant-1' | 'participant-2' = 'participant-1') {
  const wrapper = wrapperFor(qc)
  const ledger = renderHook(() => useFundingLedger(participantId), { wrapper })
  await waitFor(() => expect(ledger.result.current.isSuccess).toBe(true))
  expect(qc.getQueryData(ledgerKey(participantId))).toBeDefined()
  return ledger
}

describe('claim mutations invalidate the cached budget ledger', () => {
  it('SHIFT surface: useGenerateShiftClaim refetches a mounted ledger observer', async () => {
    const qc = makeClient()
    await mountLedger(qc)
    expect(ledgerGets(LEDGER_URL)).toBe(1)

    const mutation = renderHook(() => useGenerateShiftClaim(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync({
      participantId: 'participant-1',
      data: { from: '2026-04-01T09:00:00Z', to: '2026-04-01T17:00:00Z' },
    })
    expect(calls.some((c) => c.method === 'post' && c.url === SHIFT_CLAIM_URL)).toBe(true)

    await waitFor(() => expect(ledgerGets(LEDGER_URL)).toBe(2), { timeout: 2000 })
  })

  it('SHIFT surface: useGenerateShiftClaim still invalidates every claims/rostering key', async () => {
    // The pre-existing invalidations are the point of the mutation for the
    // "is this shift still claimable" question; the ledger addition must not
    // displace them.
    const qc = makeClient()
    const invalidated: unknown[][] = []
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters?: { queryKey?: readonly unknown[] }) => {
      if (filters?.queryKey) invalidated.push([...filters.queryKey])
      return Promise.resolve()
    })

    const mutation = renderHook(() => useGenerateShiftClaim(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync({
      participantId: 'participant-1',
      data: { from: '2026-04-01T09:00:00Z', to: '2026-04-01T17:00:00Z' },
    })

    expect(invalidated).toEqual(
      expect.arrayContaining([
        ['participant-claims', 'participant-1'],
        ['claims'],
        ['trip-claims'],
        ['rostering-completions'],
        ['roster-board'],
        ['participant-funding', 'participant-1', 'ledger'],
      ]),
    )
  })

  it('TRIP surface: useGenerateClaim refetches the ledgers of the participants it books', async () => {
    const qc = makeClient()
    // The generated claim names participant-1 on a line item, so only their
    // ledger may be refetched -- participant-2's open ledger is not part of this
    // claim and must not be pulled.
    await mountLedger(qc, 'participant-1')
    await mountLedger(qc, 'participant-2')
    expect(ledgerGets(LEDGER_URL)).toBe(1)
    expect(ledgerGets(LEDGER_URL_2)).toBe(1)

    // Read the mutation's invalidation set without suppressing it: wrap the real
    // QueryClient method instead of replacing it.
    const invalidated: unknown[][] = []
    const real = qc.invalidateQueries.bind(qc)
    vi.spyOn(qc, 'invalidateQueries').mockImplementation((filters?: { queryKey?: readonly unknown[] }) => {
      if (filters?.queryKey) invalidated.push([...filters.queryKey])
      return real(filters as never)
    })

    const mutation = renderHook(() => useGenerateClaim(), { wrapper: wrapperFor(qc) })
    await mutation.result.current.mutateAsync({ tripId: 'trip-1' })

    await waitFor(() => expect(ledgerGets(LEDGER_URL)).toBe(2), { timeout: 2000 })
    expect(ledgerGets(LEDGER_URL_2)).toBe(1)
    // Its pre-existing invalidation is preserved, and it is narrowed to the trip.
    expect(invalidated).toEqual(expect.arrayContaining([['trip-claims', 'trip-1']]))
  })

  it('TRIP surface: useUpdateClaim refetches a mounted ledger observer', async () => {
    // Authorising / approving / paying moves every participant the claim covers,
    // and those ids come from the claim detail this client already holds -- so
    // the observer must first have that claim loaded.
    const qc = makeClient()
    const wrapper = wrapperFor(qc)
    await mountLedger(qc)

    const claim = renderHook(() => useClaim('claim-1'), { wrapper })
    await waitFor(() => expect(claim.result.current.isSuccess).toBe(true))
    expect(ledgerGets(LEDGER_URL)).toBe(1)

    const mutation = renderHook(() => useUpdateClaim(), { wrapper })
    await mutation.result.current.mutateAsync({ claimId: 'claim-1', data: { status: 'Approved' } })
    expect(calls.some((c) => c.method === 'put' && c.url === '/claims/claim-1')).toBe(true)

    await waitFor(() => expect(ledgerGets(LEDGER_URL)).toBe(2), { timeout: 2000 })
  })

  it('TRIP surface: useUpdateClaimLineItem refetches only the line item participant ledger', async () => {
    const qc = makeClient()
    const wrapper = wrapperFor(qc)
    await mountLedger(qc, 'participant-1')
    await mountLedger(qc, 'participant-2')

    const claim = renderHook(() => useClaim('claim-1'), { wrapper })
    await waitFor(() => expect(claim.result.current.isSuccess).toBe(true))

    const mutation = renderHook(() => useUpdateClaimLineItem(), { wrapper })
    await mutation.result.current.mutateAsync({ claimId: 'claim-1', itemId: 'line-1', data: { hours: 4 } })
    expect(calls.some((c) => c.method === 'patch' && c.url === '/claims/claim-1/line-items/line-1')).toBe(true)

    // line-1 belongs to participant-1; participant-2's ledger is untouched.
    await waitFor(() => expect(ledgerGets(LEDGER_URL)).toBe(2), { timeout: 2000 })
    expect(ledgerGets(LEDGER_URL_2)).toBe(1)
  })

  it('TRIP surface: useDeleteClaim refetches a mounted ledger observer', async () => {
    // Deleting a claim takes its rows and amounts back out of the ledger.
    const qc = makeClient()
    const wrapper = wrapperFor(qc)
    await mountLedger(qc)

    const claim = renderHook(() => useClaim('claim-1'), { wrapper })
    await waitFor(() => expect(claim.result.current.isSuccess).toBe(true))

    const mutation = renderHook(() => useDeleteClaim(), { wrapper })
    await mutation.result.current.mutateAsync('claim-1')
    expect(calls.some((c) => c.method === 'delete' && c.url === '/claims/claim-1')).toBe(true)

    await waitFor(() => expect(ledgerGets(LEDGER_URL)).toBe(2), { timeout: 2000 })
  })

  it('NEGATIVE CONTROL: a FAILED claim mutation leaves the cached ledger alone', async () => {
    // Only a successful write moves money. A rejected mutation must not churn the
    // observer's cache -- and onSuccess must not run at all.
    const qc = makeClient()
    await mountLedger(qc)
    expect(ledgerGets(LEDGER_URL)).toBe(1)

    const failing = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      const url = String(config.url ?? '')
      const method = String(config.method ?? 'get').toLowerCase()
      calls.push({ method, url })
      if (method === 'get' && url === LEDGER_URL) return axiosPayload(participantLedger())
      throw Object.assign(new Error('probe: server rejected the claim'), { isAxiosError: true, response: { status: 500 } })
    }
    apiClient.defaults.adapter = failing

    const mutation = renderHook(() => useGenerateShiftClaim(), { wrapper: wrapperFor(qc) })
    let rejected: unknown = null
    await act(async () => {
      await mutation.result.current
        .mutateAsync({
          participantId: 'participant-1',
          data: { from: '2026-04-01T09:00:00Z', to: '2026-04-01T17:00:00Z' },
        })
        .catch((error: unknown) => {
          rejected = error
        })
    })
    // The write was genuinely rejected, so onSuccess -- where every ledger
    // invalidation lives -- never ran.
    expect(rejected).toBeTruthy()

    // Give any (wrong) invalidation a chance to land before concluding none did.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(ledgerGets(LEDGER_URL)).toBe(1)
  })

  it('CONTROL: the harness can observe a refetch when the ledger key is invalidated', async () => {
    // Proves a failure above is a product defect and not a broken probe.
    const qc = makeClient()
    await mountLedger(qc)
    expect(ledgerGets(LEDGER_URL)).toBe(1)

    await qc.invalidateQueries({ queryKey: ledgerKey('participant-1') })
    await waitFor(() => expect(ledgerGets(LEDGER_URL)).toBe(2), { timeout: 2000 })
  })
})
