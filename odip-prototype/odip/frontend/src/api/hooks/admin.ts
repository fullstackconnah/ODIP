import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiPost, apiPut } from '../client'
import type {
  ApiResponse,
  PagedResult,
  TenantSummaryDto,
  TenantDto,
  CreateTenantWithSetupDto,
  UpdateTenantDto,
  AdminUserDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
  ProviderSettingsDto,
} from '../types'

// ── Tenant Hooks ──────────────────────────────────────────────

export function useAdminTenantsSummary() {
  return useQuery({
    queryKey: ['admin-tenants'],
    queryFn: () =>
      apiClient
        .get<ApiResponse<TenantSummaryDto[]>>('/admin/tenants')
        .then(r => r.data.data ?? []),
  })
}

export function useCreateTenantWithSetup() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateTenantWithSetupDto) =>
      apiPost<TenantSummaryDto>('/admin/tenants/with-setup', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-tenants'] }),
  })
}

export function useUpdateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTenantDto }) =>
      apiPut<TenantDto>(`/admin/tenants/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-tenants'] }),
  })
}

// ── Tenant Detail Hooks ───────────────────────────────────────

export function useAdminTenantProviderSettings(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-tenant-provider-settings', tenantId],
    queryFn: () =>
      apiClient
        .get<ApiResponse<ProviderSettingsDto>>(`/admin/tenants/${tenantId}/provider-settings`)
        .then(r => r.data.data),
    enabled: !!tenantId,
  })
}

// ── User Hooks ────────────────────────────────────────────────

interface AdminUsersParams {
  tenantId?: string
  role?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export function useAdminUsers(params: AdminUsersParams = {}) {
  return useQuery({
    queryKey: ['admin-users', params],
    queryFn: () =>
      apiClient
        .get<ApiResponse<PagedResult<AdminUserDto>>>('/admin/users', { params })
        .then(r => r.data.data),
  })
}

export function useCreateAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAdminUserDto) =>
      apiPost<AdminUserDto>('/admin/users', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-tenants'] })
      qc.invalidateQueries({ queryKey: ['admin-tenant-users'] })
    },
  })
}

export function useUpdateAdminUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAdminUserDto }) =>
      apiPut<AdminUserDto>(`/admin/users/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      qc.invalidateQueries({ queryKey: ['admin-tenant-users'] })
    },
  })
}
