import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPut } from '../client'
import type {
  ProviderSettingsDto,
  UpsertProviderSettingsDto,
  SupportActivityGroupDto,
} from '../types'

/**
 * The organisation's provider settings (SuperAdmin, Admin and Coordinator may read them): pass `enabled` false for any other role, which would only meet a 403.
 * `refetchOnMount: 'always'` is for Settings' three Organisation sections, which each PUT the whole row and so start from the row as it is when they open.
 */
export function useProviderSettings(enabled = true, refetchOnMount: boolean | 'always' = true) {
  return useQuery({
    queryKey: ['provider-settings'],
    // An organisation with no row gets no `data` from the API; null says "no row" without TanStack reading it as a failure.
    queryFn: () => apiGetWithDefault<ProviderSettingsDto | null>('/provider-settings', null),
    refetchOnMount,
    enabled,
  })
}

export function useUpsertProviderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpsertProviderSettingsDto) =>
      apiPut<string>('/provider-settings', data),
    onSuccess: (updatedAt, sent) => {
      // The PUT answers the row's new version, not the row: write what was sent, with that version, into the cache at once, so a second
      // save before the refetch lands starts from this one (and is still checked), and nothing on screen waits for the refetch to say it is saved.
      qc.setQueryData<ProviderSettingsDto | null>(['provider-settings'], old => ({ ...(old ?? {}), ...sent, expectedUpdatedAt: undefined, updatedAt }) as unknown as ProviderSettingsDto)
      qc.invalidateQueries({ queryKey: ['provider-settings'] })
      qc.invalidateQueries({ queryKey: ['missed-guidance-contact'] })
    },
    // A 409 means the row changed since this form loaded it: refetch, so the next save goes out with the version that is there now.
    onError: () => { qc.invalidateQueries({ queryKey: ['provider-settings'] }) },
  })
}

export function useSupportCatalogue() {
  return useQuery({
    queryKey: ['support-catalogue'],
    queryFn: () => apiGet<SupportActivityGroupDto[]>('/support-catalogue'),
  })
}
