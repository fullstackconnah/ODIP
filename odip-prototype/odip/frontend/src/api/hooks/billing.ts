import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut, apiClient } from '../client'
import { toTruncatableList } from './pagedList'
import type {
  FundingSourceDto,
  CreateFundingSourceDto,
  UpdateFundingSourceDto,
  ServiceBookingListDto,
  ServiceBookingDetailDto,
  CreateServiceBookingDto,
  BillableEventDto,
  CreateBillableEventDto,
  UpdateBillableEventDto,
  ClaimBatchListDto,
  ClaimBatchDetailDto,
  ValidateBillingDto,
  CreateClaimBatchDto,
  BillingValidationResultDto,
  PagedResult,
} from '../types'

/**
 * BillingController clamps every list endpoint's `pageSize` to a ceiling of 200
 * (`Math.Clamp(pageSize, 1, 200)`). The hooks below request that ceiling explicitly rather than
 * accepting the server's much smaller `pageSize = 50` default — see the UX-audit-round-2 fix for
 * PagedResult call sites that were silently dropping rows past the default page. Each resolved
 * array also carries `totalCount`/`isTruncated` (see `pagedList.ts`) for any caller that needs it.
 */
const BILLING_MAX_PAGE_SIZE = 200

// ══════════════════════════════════════════════════════════════
// FUNDING SOURCES
// ══════════════════════════════════════════════════════════════

export function useFundingSources(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['funding-sources', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<FundingSourceDto>>('/billing/funding-sources', {
        pageSize: String(BILLING_MAX_PAGE_SIZE),
        ...params,
      })
      return toTruncatableList(result)
    },
  })
}

export function useCreateFundingSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateFundingSourceDto) => apiPost<FundingSourceDto>('/billing/funding-sources', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funding-sources'] }),
  })
}

export function useUpdateFundingSource() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFundingSourceDto }) =>
      apiPut<FundingSourceDto>(`/billing/funding-sources/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['funding-sources'] }),
  })
}

// ══════════════════════════════════════════════════════════════
// SERVICE BOOKINGS
// ══════════════════════════════════════════════════════════════

export function useServiceBookings(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['service-bookings', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<ServiceBookingListDto>>('/billing/service-bookings', {
        pageSize: String(BILLING_MAX_PAGE_SIZE),
        ...params,
      })
      return toTruncatableList(result)
    },
  })
}

export function useServiceBooking(id: string | undefined) {
  return useQuery({
    queryKey: ['service-booking', id],
    queryFn: () => apiGet<ServiceBookingDetailDto>(`/billing/service-bookings/${id}`),
    enabled: !!id,
  })
}

export function useCreateServiceBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateServiceBookingDto) => apiPost<ServiceBookingDetailDto>('/billing/service-bookings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-bookings'] }),
  })
}

// ══════════════════════════════════════════════════════════════
// BILLABLE EVENTS
// ══════════════════════════════════════════════════════════════

export function useBillableEvents(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['billable-events', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<BillableEventDto>>('/billing/billable-events', {
        pageSize: String(BILLING_MAX_PAGE_SIZE),
        ...params,
      })
      return toTruncatableList(result)
    },
  })
}

export function useCreateBillableEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateBillableEventDto) => apiPost<BillableEventDto>('/billing/billable-events', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billable-events'] }),
  })
}

export function useUpdateBillableEvent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBillableEventDto }) =>
      apiPut<BillableEventDto>(`/billing/billable-events/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billable-events'] }),
  })
}

// ══════════════════════════════════════════════════════════════
// CLAIM BATCHES
// ══════════════════════════════════════════════════════════════

export function useClaimBatches(params?: Record<string, string>) {
  return useQuery({
    queryKey: ['claim-batches', params],
    queryFn: async () => {
      const result = await apiGet<PagedResult<ClaimBatchListDto>>('/billing/claim-batches', {
        pageSize: String(BILLING_MAX_PAGE_SIZE),
        ...params,
      })
      return toTruncatableList(result)
    },
  })
}

export function useClaimBatch(id: string | undefined) {
  return useQuery({
    queryKey: ['claim-batch', id],
    queryFn: () => apiGet<ClaimBatchDetailDto>(`/billing/claim-batches/${id}`),
    enabled: !!id,
  })
}

/**
 * Dry-run validation for a candidate set of billable events. This is a MUTATION, not a query —
 * it is a POST that must only run when explicitly called (e.g. from a "Validate" button), never
 * automatically on render, and its result is transient (the current dry-run preview) rather than
 * cached application state. Never mutates server data.
 */
export function useValidateClaimBatch() {
  return useMutation({
    mutationFn: (data: ValidateBillingDto) =>
      apiPost<BillingValidationResultDto[]>('/billing/claim-batches/validate', data),
  })
}

/**
 * Creates a claim batch, consuming ServiceBookingLine balance server-side. Invalidates
 * claim-batches, billable-events AND service-bookings — creating a batch consumes booking
 * balance, so stale service-booking balances would otherwise mislead the user.
 */
export function useCreateClaimBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateClaimBatchDto) => apiPost<ClaimBatchDetailDto>('/billing/claim-batches', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-batches'] })
      qc.invalidateQueries({ queryKey: ['billable-events'] })
      qc.invalidateQueries({ queryKey: ['service-bookings'] })
    },
  })
}

/**
 * Downloads the PRODA bulk payment request CSV for a claim batch and saves it via the browser.
 * Bypasses the apiGet/ApiResponse JSON envelope entirely (the endpoint returns a raw text/csv
 * file, not JSON) — fetches as a blob directly through apiClient, and uses the filename from the
 * response's Content-Disposition header when present, falling back to the DTO's fileName.
 */
export function useDownloadProdaFile() {
  return useMutation({
    mutationFn: async ({ id, fileName }: { id: string; fileName: string }) => {
      const response = await apiClient.get<Blob>(`/billing/claim-batches/${id}/proda-file`, {
        responseType: 'blob',
      })

      const disposition = response.headers['content-disposition'] as string | undefined
      const match = disposition ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition) : null
      const downloadName = match?.[1] ? decodeURIComponent(match[1]) : fileName

      const url = window.URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = downloadName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    },
  })
}
