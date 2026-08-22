import { useQueries } from '@tanstack/react-query'
import { apiGet } from '@/api/client'
import type { CompatibilityRowDto } from '@/api/types'

/**
 * `useCompatibility` (api/hooks/rostering.ts) is scoped to one participant at a time — the
 * compatibility page needs every participant's column at once to render the full staff ×
 * participant matrix, and React's rules of hooks rule out calling that hook in a loop over a
 * dynamic participant list. This fans the same request out per participant via `useQueries`
 * instead, using the identical queryKey shape (`['roster-compatibility', participantId]`) that
 * `useCompatibility`/`useUpsertCompatibility` already use — so it lands on the same cache
 * entries, and a cell edit's invalidation (inside `useUpsertCompatibility`) transparently
 * refetches just the affected column here too.
 */
export function useCompatibilityMatrix(participantIds: string[]) {
  const results = useQueries({
    queries: participantIds.map(participantId => ({
      queryKey: ['roster-compatibility', participantId],
      queryFn: () => apiGet<CompatibilityRowDto[]>('/rostering/compatibility', { participantId }),
      enabled: !!participantId,
    })),
  })

  const byKey = new Map<string, CompatibilityRowDto>()
  results.forEach(result => {
    ;(result.data ?? []).forEach(row => byKey.set(`${row.staffId}:${row.participantId}`, row))
  })

  return {
    /** Keyed by `${staffId}:${participantId}`. A missing key means Allowed — the sparse default. */
    byKey,
    isLoading: participantIds.length > 0 && results.some(r => r.isLoading),
    isError: results.some(r => r.isError),
    refetchAll: () => results.forEach(r => r.refetch()),
  }
}
