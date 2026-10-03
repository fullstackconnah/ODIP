import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut } from '../client'
import type {
  ApplyPlanDatesResult, BillingSourcesHintDto, BudgetSettingsDto, FundingPlanDto, FundingPlansDto, PaceCategoryDto, SaveFundingPlanDto, UpdateBudgetSettingsDto,
} from '../types'

// A participant's NDIS plan budget (budget feature, phase 1). The plan record is saved through these endpoints and never through the participant's patch groups. Every plan write
// refreshes ['participant-funding', participantId], which is also the prefix of the Billing hint, so a saved plan updates the tab, the intake card and the hint at once.

const SETTINGS_KEY = ['budget-settings'] as const
export const fundingKey = (participantId: string | undefined) => ['participant-funding', participantId] as const

/** The NDIS support categories (01 to 21). Reference data that does not change under a session, so it is fetched once. */
export function usePaceCategories(enabled = true) {
  return useQuery({
    queryKey: ['pace-categories'],
    queryFn: () => apiGet<PaceCategoryDto[]>('/funding/pace-categories'),
    enabled,
    staleTime: Infinity,
  })
}

/** Every plan of the participant, newest first, with the plan dates the profile carries. SuperAdmin, Admin and Coordinator only: pass `enabled` false for any other role. */
export function useFundingPlans(participantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...fundingKey(participantId), 'plans'],
    queryFn: () => apiGet<FundingPlansDto>(`/participants/${participantId}/funding/plans`),
    enabled: !!participantId && enabled,
  })
}

/** What the Billing funding sources say, to start a Core (flexible) pool from. Asked for once, when the editor opens. */
export function useBillingSourcesHint(participantId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...fundingKey(participantId), 'billing-hint'],
    queryFn: () => apiGet<BillingSourcesHintDto>(`/participants/${participantId}/funding/billing-sources-hint`),
    enabled: !!participantId && enabled,
    staleTime: 60_000,
  })
}

export function useCreateFundingPlan(participantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveFundingPlanDto) => apiPost<FundingPlanDto>(`/participants/${participantId}/funding/plans`, body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: fundingKey(participantId) }) },
  })
}

/** Replaces a plan. The body carries the revision it was made from: a stale one is a 409 whose data is `{ currentRevision }`. */
export function useUpdateFundingPlan(participantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: SaveFundingPlanDto }) => apiPut<FundingPlanDto>(`/participants/${participantId}/funding/plans/${planId}`, body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: fundingKey(participantId) }) },
  })
}

/** Sets the participant's profile plan dates to a recorded plan's. Explicit: nothing does it on its own. Refreshes the participant too, which carries those dates. */
export function useApplyPlanDatesToProfile(participantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (planId: string) => apiPost<ApplyPlanDatesResult>(`/participants/${participantId}/funding/plans/${planId}/apply-dates-to-profile`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fundingKey(participantId) })
      void queryClient.invalidateQueries({ queryKey: ['participant', participantId] })
    },
  })
}

export function useBudgetSettings(enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiGet<BudgetSettingsDto>('/funding/settings'),
    enabled,
  })
}

export function useUpdateBudgetSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdateBudgetSettingsDto) => apiPut<BudgetSettingsDto>('/funding/settings', data),
    onSuccess: (saved) => { queryClient.setQueryData(SETTINGS_KEY, saved) },
  })
}
