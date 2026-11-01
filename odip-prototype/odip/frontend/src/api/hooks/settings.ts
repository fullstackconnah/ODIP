import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiGetWithDefault, apiPut, apiPutRaw, apiClient } from '../client'
import type { AppSettingsDto, UpdateAppSettingsDto, UpdateSecuritySettingsDto, MyProfileDto, UpdateMyProfileDto, ApiResponse, TenantUserDto, ModuleVisibilityDto } from '../types'
import { getViewAs } from '@/lib/viewAs'

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      apiGetWithDefault<AppSettingsDto>('/settings', { qualificationWarningDays: 30, weeklyHoursWarning: 38, varianceReviewMinutes: 15, planExpiryWarningDays: 30 }),
  })
}

/** The organisation's weekly-hours warning (Settings > Rostering rules); 38 until the settings load, as the server's default. */
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

export function useUpdateSecuritySettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateSecuritySettingsDto) => apiPutRaw<AppSettingsDto>('/settings/security', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })
}

/** My account: the signed-in person's own name, mobile and email. Never the viewed user's: the server reads the id from the sign-in. */
export function useMyProfile() {
  return useQuery({ queryKey: ['my-profile'], queryFn: () => apiGet<MyProfileDto>('/profile'), retry: false })
}

export function useUpdateMyProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateMyProfileDto) => apiPut<MyProfileDto>('/profile', data),
    onSuccess: saved => {
      qc.setQueryData(['my-profile'], saved)
      // The name in the top bar and on this page's header is read from the sign-in response kept in the browser.
      try {
        const raw = localStorage.getItem('odip_user')
        if (raw) localStorage.setItem('odip_user', JSON.stringify({ ...JSON.parse(raw), fullName: `${saved.firstName} ${saved.lastName}` }))
      } catch { /* storage unavailable: the name updates at the next sign-in */ }
    },
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

/** The organisation the session is working in: the one a SuperAdmin is viewing, else the signed-in user's own. */
export function currentTenantId(): string | null {
  try {
    const user = JSON.parse(localStorage.getItem('odip_user') || '{}')
    return getViewAs('odip_viewing_tenant') ?? user.tenantId ?? null
  } catch { return null }
}

function moduleVisibilityKey() {
  return ['module-visibility', currentTenantId()] as const
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
