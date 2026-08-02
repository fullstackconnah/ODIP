import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPutRaw, apiPatchRaw, apiDeleteRaw } from '../client'
import type {
  TripClaimListDto,
  TripClaimDetailDto,
  GenerateClaimRequestDto,
  ClaimPreviewRequestDto,
  ClaimPreviewResponseDto,
  UpdateClaimDto,
  UpdateClaimLineItemDto,
} from '../types'

export function useTripClaims(tripId: string | undefined) {
  return useQuery({
    queryKey: ['trip-claims', tripId],
    queryFn: () => apiGet<TripClaimListDto[]>(`/trips/${tripId}/claims`),
    enabled: !!tripId,
  })
}

export function useClaim(claimId: string | undefined) {
  return useQuery({
    queryKey: ['claim', claimId],
    queryFn: () => apiGet<TripClaimDetailDto>(`/claims/${claimId}`),
    enabled: !!claimId,
  })
}

export function useGenerateClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data?: GenerateClaimRequestDto }) =>
      apiPost<TripClaimDetailDto>(`/trips/${tripId}/claims`, data ?? {}),
    onSuccess: (_, { tripId }) => {
      qc.invalidateQueries({ queryKey: ['trip-claims', tripId] })
    },
  })
}

export function usePreviewClaim() {
  return useMutation({
    mutationFn: ({ tripId, data }: { tripId: string; data: ClaimPreviewRequestDto }) =>
      apiPost<ClaimPreviewResponseDto>(`/trips/${tripId}/claims/preview`, data),
  })
}

export function useUpdateClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, data }: { claimId: string; data: UpdateClaimDto }) =>
      apiPutRaw<boolean>(`/claims/${claimId}`, data),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
    },
  })
}

export function useUpdateClaimLineItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ claimId, itemId, data }: { claimId: string; itemId: string; data: UpdateClaimLineItemDto }) =>
      apiPatchRaw<boolean>(`/claims/${claimId}/line-items/${itemId}`, data),
    onSuccess: (_, { claimId }) => {
      qc.invalidateQueries({ queryKey: ['claim', claimId] })
    },
  })
}

export function useDeleteClaim() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (claimId: string) => apiDeleteRaw<boolean>(`/claims/${claimId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-claims'] })
    },
  })
}
