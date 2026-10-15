import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost } from '../client'
import type { EmploymentHeroBusinessDto, EmploymentHeroEmployeeDto, EmploymentHeroStatusDto } from '../types'

const BASE = '/integrations/employment-hero'

/** GET the Employment Hero card: configured, connected, last sync, counts and the Needs-attention items. Admin, or SuperAdmin viewing as an organisation. */
export function useEmploymentHeroStatus(enabled = true) {
  return useQuery({ queryKey: ['employment-hero'], queryFn: () => apiGet<EmploymentHeroStatusDto>(BASE), enabled })
}

/** The Link picker: EH employees nobody here is linked to, read live from EH. */
export function useEmploymentHeroEmployees(enabled: boolean) {
  return useQuery({ queryKey: ['employment-hero', 'employees'], queryFn: () => apiGet<EmploymentHeroEmployeeDto[]>(`${BASE}/employees`), enabled })
}

/** The businesses a pasted key can see. Nothing is stored until Connect. */
export function useEmploymentHeroBusinesses() {
  return useMutation({ mutationFn: (apiKey: string) => apiPost<EmploymentHeroBusinessDto[]>(`${BASE}/businesses`, { apiKey }) })
}

/** A change to the connection or its staff: the card, the connected flag (provider settings) and the staff list all refresh. */
function useEmploymentHeroChange<V, R>(mutationFn: (variables: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => { for (const key of ['employment-hero', 'provider-settings', 'staff']) qc.invalidateQueries({ queryKey: [key] }) },
  })
}

export const useConnectEmploymentHero = () =>
  useEmploymentHeroChange((body: { apiKey: string; businessId: string }) => apiPost<EmploymentHeroStatusDto>(BASE, body))
export const useDisconnectEmploymentHero = () => useEmploymentHeroChange<void, void>(() => apiDelete(BASE))
export const useSyncEmploymentHero = () => useEmploymentHeroChange<void, EmploymentHeroStatusDto>(() => apiPost<EmploymentHeroStatusDto>(`${BASE}/sync`))
export const useLinkEmploymentHeroStaff = () =>
  useEmploymentHeroChange(({ itemId, employeeId }: { itemId: string; employeeId: string }) =>
    apiPost<EmploymentHeroStatusDto>(`${BASE}/attention/${itemId}/link`, { employeeId }))
export const useDismissEmploymentHeroItem = () =>
  useEmploymentHeroChange((itemId: string) => apiPost<EmploymentHeroStatusDto>(`${BASE}/attention/${itemId}/dismiss`))
