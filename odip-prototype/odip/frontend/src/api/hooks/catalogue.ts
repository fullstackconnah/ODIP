import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut } from '../client'
import type {
  ProviderSettingsDto,
  UpsertProviderSettingsDto,
  SupportActivityGroupDto,
} from '../types'

/** The organisation's provider settings (SuperAdmin, Admin and Coordinator may read them): pass `enabled` false for any other role, which would only meet a 403. */
export function useProviderSettings(enabled = true) {
  return useQuery({
    queryKey: ['provider-settings'],
    queryFn: () => apiGet<ProviderSettingsDto>('/provider-settings'),
    enabled,
  })
}

export function useUpsertProviderSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpsertProviderSettingsDto) =>
      apiPut<ProviderSettingsDto>('/provider-settings', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['provider-settings'] })
    },
  })
}

export function useSupportCatalogue() {
  return useQuery({
    queryKey: ['support-catalogue'],
    queryFn: () => apiGet<SupportActivityGroupDto[]>('/support-catalogue'),
  })
}
