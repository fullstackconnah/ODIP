import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut } from '../client'
import type {
  ProviderSettingsDto,
  UpsertProviderSettingsDto,
  SupportActivityGroupDto,
} from '../types'

export function useProviderSettings() {
  return useQuery({
    queryKey: ['provider-settings'],
    queryFn: () => apiGet<ProviderSettingsDto>('/provider-settings'),
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
