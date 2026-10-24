import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiDelete, apiGet, apiPost, apiPut } from '../client'
import type {
  EmploymentHeroBusinessDto, EmploymentHeroEmployeeDto, EmploymentHeroStatusDto, EmploymentHeroLeaveCategoriesDto, EmploymentHeroLeaveCategoryDto, EmploymentHeroWorkTypeDto, EmploymentHeroWorkTypesDto,
  LeaveBalancesDto, PayPeriodsDto, PayrollCheckDto, PayrollRangeDto, SendMissingResultDto,
} from '../types'

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

/** A change to the connection or its staff: the card, the connected flag (provider settings), the staff list and the nav's module-visibility flag (My payslips) all refresh. */
function useEmploymentHeroChange<V, R>(mutationFn: (variables: V) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => { for (const key of ['employment-hero', 'provider-settings', 'staff', 'module-visibility']) qc.invalidateQueries({ queryKey: [key] }) },
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

/** The work types ODIP may send hours under, read live from EH for the card's pickers. */
export function useEmploymentHeroWorkTypes(enabled: boolean) {
  return useQuery({ queryKey: ['employment-hero', 'work-types'], queryFn: () => apiGet<EmploymentHeroWorkTypeDto[]>(`${BASE}/work-types`), enabled })
}
export const useSaveEmploymentHeroWorkTypes = () =>
  useEmploymentHeroChange((body: EmploymentHeroWorkTypesDto) => apiPut<EmploymentHeroStatusDto>(`${BASE}/work-types`, body))

/** The leave categories ODIP may send leave under, read live from EH for the card's pickers. */
export function useEmploymentHeroLeaveCategories(enabled: boolean) {
  return useQuery({ queryKey: ['employment-hero', 'leave-categories'], queryFn: () => apiGet<EmploymentHeroLeaveCategoryDto[]>(`${BASE}/leave-categories`), enabled })
}
export const useSaveEmploymentHeroLeaveCategories = () =>
  useEmploymentHeroChange((body: EmploymentHeroLeaveCategoriesDto) => apiPut<EmploymentHeroStatusDto>(`${BASE}/leave-categories`, body))
export const useRetryEmploymentHeroLeave = () =>
  useEmploymentHeroChange((id: string) => apiPost<EmploymentHeroStatusDto>(`${BASE}/leave/${id}/retry`))

/** Live balances from EH, never stored here. Read once per visit and kept five minutes; a failure is shown, not retried behind the person's back. */
const BALANCES_STALE_MS = 5 * 60 * 1000
export function useMyLeaveBalances(enabled: boolean) {
  return useQuery({ queryKey: ['leave-balances', 'me'], queryFn: () => apiGet<LeaveBalancesDto>('/portal/leave/balances'), enabled, staleTime: BALANCES_STALE_MS, retry: false })
}
export function useStaffLeaveBalances(userId: string, enabled: boolean) {
  return useQuery({ queryKey: ['leave-balances', userId], queryFn: () => apiGet<LeaveBalancesDto>(`/staff/${userId}/leave-balances`), enabled, staleTime: BALANCES_STALE_MS, retry: false })
}

const PAYROLL = `${BASE}/payroll`

/** The pay periods EH offers (finalised runs and the next period). Not connected answers an empty list. */
export function usePayPeriods() {
  return useQuery({ queryKey: ['employment-hero', 'payroll', 'periods'], queryFn: () => apiGet<PayPeriodsDto>(`${PAYROLL}/periods`) })
}

/** The Payroll page's check: every approved shift in the range, by worker, with its word. */
export function usePayrollCheck(range: { from: string; to: string } | null) {
  return useQuery({
    queryKey: ['employment-hero', 'payroll', 'check', range?.from, range?.to],
    queryFn: () => apiGet<PayrollCheckDto>(PAYROLL, { from: range!.from, to: range!.to }),
    enabled: range !== null,
    // Rows still moving (Waiting or Failed) refresh every minute; a settled period only on focus.
    refetchInterval: (q: { state: { data?: PayrollCheckDto } }) => (q.state.data && q.state.data.waiting + q.state.data.failed > 0 ? 60_000 : false),
  })
}

/** Queue every shift the check marks Sendable (Admin only). The answer carries the re-read check. */
export function useSendMissingTimesheets() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (range: PayrollRangeDto) => apiPost<SendMissingResultDto>(`${PAYROLL}/send-missing`, range),
    onSuccess: ({ check }) => { qc.setQueryData(['employment-hero', 'payroll', 'check', check.from, check.to], check) },
  })
}
