import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient, apiGet, apiPut } from '../client'
import type { ApiResponse, PlanBlock, PlanPricingSettingsDto, PlanQuote, PlanQuoteRequest, UpdatePlanPricingSettingsDto } from '../types'
import { periodProblem, referenceWeek, type ReferenceWeek } from '@/lib/planQuote'
import { apiErrorStatus } from '@/lib/shiftPackageErrors'

// The plan builder's calls to the pricing engine (POST api/v1/plan-pricing/quote, GET and PUT api/v1/plan-pricing/settings). The client sends blocks and an
// agreement period and never a price or a policy: the server reads the organisation's own settings, the catalogue valid on each date and the holidays.

const SETTINGS_KEY = ['plan-pricing-settings'] as const

/** One quote. A stale one is cancelled by the query's own signal, and the server stops working when the client does. */
export async function postQuote(request: PlanQuoteRequest, signal?: AbortSignal): Promise<PlanQuote> {
  const response = await apiClient.post<ApiResponse<PlanQuote>>('/plan-pricing/quote', request, { signal })
  return response.data.data as PlanQuote
}

/** How many more times a quote is asked for when the service is busy (429): the first try and three more. */
export const MAX_BUSY_RETRIES = 3

/**
 * Only a busy service is worth asking again. The cap is two quotes in flight for an organisation, and the screen's own pattern (a budget in two steps beside one block's quote) can use all
 * of it, so a 429 is ordinary and passes; a refusal, a server error and a lost connection do not (the screen offers Try again for those).
 */
export function retryWhenBusy(failureCount: number, error: unknown): boolean {
  return apiErrorStatus(error) === 429 && failureCount < MAX_BUSY_RETRIES
}

/** The pause before asking again: what the server named in Retry-After (seconds, a second when it said nothing), never less than a moment nor more than a few seconds, a little longer each time. */
export function busyDelay(failureCount: number, error: unknown): number {
  const headers = (error as { response?: { headers?: unknown } } | null | undefined)?.response?.headers as { get?: (name: string) => unknown } & Record<string, unknown> | undefined
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after']
  const seconds = raw === undefined || raw === null || raw === '' ? Number.NaN : Number(raw)
  const named = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000
  return Math.min(Math.min(Math.max(named, 250), 5000) * (failureCount + 1), 8000)
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
  const ready = enabled && blocks.length > 0 && periodProblem(from, to) === null
  return useQuery({
    queryKey: ['plan-budget', JSON.stringify({ blocks, from, to })],
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryWhenBusy,
    retryDelay: busyDelay,
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
  const ready = enabled && block !== null && periodProblem(from, to) === null
  return useQuery({
    queryKey: ['plan-block-quote', JSON.stringify({ block, from, to })],
    enabled: ready,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: retryWhenBusy,
    retryDelay: busyDelay,
    queryFn: ({ signal }) => postQuote({ blocks: [block as PlanBlock], periodFrom: from, periodTo: to, includeLines: true }, signal),
  })
}
