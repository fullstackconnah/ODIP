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
