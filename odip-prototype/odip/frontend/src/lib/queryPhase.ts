export type QueryPhase = 'loading' | 'error' | 'ready'

/**
 * What a list screen should show for its query, as three different facts instead of two. A failed request is not an empty record, and
 * neither is one that has not run: TanStack Query pauses a request while the browser reports offline (`isLoading` is false, `isError`
 * is false, `data` is undefined), and a screen that tests only `isLoading` rendered "No contacts recorded" for a participant whose
 * contacts it never asked for. "None recorded" may only appear in the `ready` phase, after a request that succeeded.
 *
 *   const phase = queryPhase(query)
 *   if (phase === 'loading') return <PageState kind="loading" noun="contacts" />
 *   if (phase === 'error') return <PageState kind="error" noun="contacts" onRetry={() => query.refetch()} />
 *
 * Data already on screen wins over a refetch that failed behind it, so a background failure never replaces a list the user is reading.
 */
export function queryPhase(query: { data?: unknown; isLoading?: boolean; isError?: boolean }): QueryPhase {
  if (query.isLoading) return 'loading'
  if (query.data !== undefined) return 'ready'
  return query.isError ? 'error' : 'loading'
}

/**
 * Whether a query is still waiting for its first answer: pending (it has no data) and not merely disabled. A request in flight is waiting, and so is one PAUSED
 * while the browser reports offline (TanStack's default network mode): that one is pending with a fetchStatus of "paused", and `isLoading` (isFetching and
 * isPending) is false for it, exactly as `isError` and `data` are, so a count or a band built on `isLoading` alone reads it as a settled zero. A disabled query
 * (`enabled: false`) is pending for good with a fetchStatus of "idle": nobody asked it, so it is not waiting. It only reads what the query says, so a test
 * double that says `{ isPending: true }` is waiting too.
 */
export function awaitsData(query: { isPending?: boolean; fetchStatus?: string }): boolean {
  return !!query.isPending && query.fetchStatus !== 'idle'
}
