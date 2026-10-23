import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGetWithDefault, apiPutRaw, apiClient } from '../client'
import type { AppSettingsDto, UpdateAppSettingsDto, ApiResponse, TenantUserDto, ModuleVisibilityDto } from '../types'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      apiGetWithDefault<AppSettingsDto>('/settings', { qualificationWarningDays: 30, weeklyHoursWarning: 38 }),
  })
}

/** The organisation's weekly-hours warning (Settings > Alert windows); 38 until the settings load, as the server's default. */
export function useWeeklyHoursWarning(): number {
  return useSettings().data?.weeklyHoursWarning ?? 38
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateAppSettingsDto) => apiPutRaw<AppSettingsDto>('/settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

export function useAdminTenantUsers(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-users', tenantId],
    queryFn: () =>
      apiClient
        .get<ApiResponse<TenantUserDto[]>>(`/admin/tenants/${tenantId}/users`)
        .then(r => r.data),
    enabled: !!tenantId,
  })
}

const VISIBLE_WORKSPACES = { hiddenAccommodation: false, hiddenVehicles: false }

function moduleVisibilityKey() {
  const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
  const tenant = localStorage.getItem('odip_viewing_tenant') ?? user.tenantId ?? null
  return ['module-visibility', tenant] as const
}

export function useModuleVisibility() {
  return useQuery({
    queryKey: moduleVisibilityKey(),
    queryFn: () => apiGetWithDefault<ModuleVisibilityDto>('/settings/module-visibility', VISIBLE_WORKSPACES),
    refetchOnMount: 'always',
  })
}

export function useUpdateModuleVisibility() {
  const qc = useQueryClient()
  const key = moduleVisibilityKey()
  return useMutation({
    mutationFn: (data: ModuleVisibilityDto) => apiPutRaw<ModuleVisibilityDto>('/settings/module-visibility', data),
    onSuccess: response => {
      qc.setQueryData(key, response.data)
      return qc.invalidateQueries({ queryKey: key })
    },
  })
}
