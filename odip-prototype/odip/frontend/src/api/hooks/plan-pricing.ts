import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPut } from '../client'
import type { ApiResponse, PlanBlock, PlanPricingSettingsDto, PlanQuote, PlanQuoteRequest, UpdatePlanPricingSettingsDto } from '../types'
import { referenceWeek, type ReferenceWeek } from '@/lib/planQuote'

// The plan builder's calls to the pricing engine (POST api/v1/plan-pricing/quote, GET and PUT api/v1/plan-pricing/settings). The client sends blocks and an
// agreement period and never a price or a policy: the server reads the organisation's own settings, the catalogue valid on each date and the holidays.

const SETTINGS_KEY = ['plan-pricing-settings'] as const

/** One quote. A stale one is cancelled by the query's own signal, and the server stops working when the client does. */
export async function postQuote(request: PlanQuoteRequest, signal?: AbortSignal): Promise<PlanQuote> {
  const response = await apiClient.post<ApiResponse<PlanQuote>>('/plan-pricing/quote', request, { signal })
  return response.data.data as PlanQuote
}

export function usePlanPricingSettings(enabled = true) {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiGet<PlanPricingSettingsDto>('/plan-pricing/settings'),
    enabled,
  })
}

export function useUpdatePlanPricingSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: UpdatePlanPricingSettingsDto) => apiPut<PlanPricingSettingsDto>('/plan-pricing/settings', data),
    onSuccess: (saved) => {
      queryClient.setQueryData(SETTINGS_KEY, saved)
      // Every price on screen was worked out with the old settings.
      queryClient.invalidateQueries({ queryKey: ['plan-budget'] })
      queryClient.invalidateQueries({ queryKey: ['plan-block-quote'] })
    },
  })
}

export interface PlanBudget {
  /** The whole agreement period: totals by category, issues, notices, holiday occurrences and the questions the plan depends on. No lines. */
  period: PlanQuote
  /** The reference week (see `referenceWeek`): what the plan asks of an ordinary week. null when the agreement is shorter than a week. */
  weekly: PlanQuote | null
  week: ReferenceWeek | null
}

/**
 * The running budget of the whole plan: the agreement period without its lines (small), then one ordinary week of it, picked so that no block meets a public
 * holiday in it. The week needs the period's holiday dates, so the two requests are made one after the other.
 */
export function usePlanBudget(blocks: readonly PlanBlock[], from: string, to: string, enabled = true) {
  const ready = enabled && blocks.length > 0 && !!from && !!to && from <= to
  return useQuery({
    queryKey: ['plan-budget', JSON.stringify({ blocks, from, to })],
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }): Promise<PlanBudget> => {
      const period = await postQuote({ blocks: [...blocks], periodFrom: from, periodTo: to, includeLines: false }, signal)
      const week = referenceWeek(from, to, period.holidayOccurrences.map(occurrence => occurrence.date))
      const weekly = week ? await postQuote({ blocks: [...blocks], periodFrom: week.from, periodTo: week.to, includeLines: false }, signal) : null
      return { period, weekly, week }
    },
  })
}

/** One block priced alone over the agreement, with its lines: the Review step's table, holiday exposure and why. */
export function usePlanBlockQuote(block: PlanBlock | null, from: string, to: string, enabled = true) {
  const ready = enabled && block !== null && !!from && !!to && from <= to
  return useQuery({
    queryKey: ['plan-block-quote', JSON.stringify({ block, from, to })],
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
    queryFn: ({ signal }) => postQuote({ blocks: [block as PlanBlock], periodFrom: from, periodTo: to, includeLines: true }, signal),
  })
}
