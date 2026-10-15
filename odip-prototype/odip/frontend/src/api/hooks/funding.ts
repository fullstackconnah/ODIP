import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiGet, apiPost, apiPut } from '../client'
import { refreshBudgetFigures, refreshBudgetWarnings } from './funding-ledger'
import type {
  ApplyPlanDatesResult, BudgetSettingsDto, FundingPlanDto, FundingPlansDto, PaceCategoryDto, SaveFundingPlanDto, UpdateBudgetSettingsDto,
} from '../types'

// A participant's NDIS plan budget (budget feature, phase 1). The plan record is saved through these endpoints and never through the participant's patch groups. Every plan write
// refreshes ['participant-funding', participantId], so a saved plan updates the tab and the intake card at once.

const SETTINGS_KEY = ['budget-settings'] as const
export const fundingKey = (participantId: string | undefined) => ['participant-funding', participantId] as const

/**
 * A plan write changes what the onboarding checklist's "Funding recorded" gate says (and the worklist's count of gates), so the checklist and the worklist are refreshed with it: left alone
 * they would show the old answer for their 30 s of staleness, which reads as the save not having worked when a coordinator goes back to the checklist from the Funding tab.
 */
function refreshOnboarding(queryClient: QueryClient, participantId: string) {
  void queryClient.invalidateQueries({ queryKey: ['onboarding', participantId] })
  void queryClient.invalidateQueries({ queryKey: ['participant-onboarding-worklist'] })
}

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

export function useCreateFundingPlan(participantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveFundingPlanDto) => apiPost<FundingPlanDto>(`/participants/${participantId}/funding/plans`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fundingKey(participantId) })
      refreshOnboarding(queryClient, participantId)
      refreshBudgetWarnings(queryClient)   // a new plan is a new budget to warn about, and ends the NDIA's signal about the old one
    },
  })
}

/** Replaces a plan. The body carries the revision it was made from: a stale one is a 409 whose data is `{ currentRevision }`. */
export function useUpdateFundingPlan(participantId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, body }: { planId: string; body: SaveFundingPlanDto }) => apiPut<FundingPlanDto>(`/participants/${participantId}/funding/plans/${planId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: fundingKey(participantId) })
      refreshOnboarding(queryClient, participantId)
      refreshBudgetWarnings(queryClient)   // the limits themselves changed
    },
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
      refreshOnboarding(queryClient, participantId)
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
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved)
      // The "approaching" percentage decides every participant's status, so every ledger held (and the claim pages' budget blocks) is read again, and with them the alerts, the Budgets list and any
      // agreement check, which are worked out from the same figures (refreshBudgetFigures marks all of them).
      refreshBudgetFigures(queryClient)
    },
  })
}
