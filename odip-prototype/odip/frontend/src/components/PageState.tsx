import { Button } from './Button'
import { BackButton } from './BackButton'
import { Callout } from './Callout'

type Common = {
  /** What the page is about, lower case and singular: "trip", "staff member". It fills the sentences ("Loading trip…", "Trip not found"). */
  noun: string
}

export type PageStateProps =
  | (Common & { kind: 'loading' })
  | (Common & {
      kind: 'error'
      /** Shows a "Try again" button that calls this (normally the query's `refetch`). Without it the banner has no action. */
      onRetry?: () => void
    })
  | (Common & {
      kind: 'not-found'
      /** A whole page also offers the way out: a Back button to this route, named by `backLabel`. A tab inside a page that is still on screen omits both. */
      backTo?: string
      backLabel?: string
    })

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * What a page shows in place of itself while its record is loading, when the load failed, and when there is no such record. They are three
 * different facts, so they are three different states:
 *
 *   if (isLoading) return <PageState kind="loading" noun="trip" />
 *   if (!trip) {
 *     return isError && !isNotFoundError(error)
 *       ? <PageState kind="error" noun="trip" onRetry={() => refetch()} />
 *       : <PageState kind="not-found" noun="trip" backTo="/trips" backLabel="trips" />
 *   }
 *
 * A 404 from the API is an answer ("no such record"), not a failure, so `isNotFoundError` routes it to not-found; and the failed branch sits
 * under `!trip` so a background refetch that fails over data already on screen never replaces the page.
 *
 * There is no heading in any of them: a screen's one `h1` comes from `PageHeader` (DESIGN.md, The One Heading Rule).
 */
export function PageState(props: PageStateProps) {
  const noun = props.noun
  if (props.kind === 'loading') {
    return (
      <div role="status" className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">
        Loading {noun}…
      </div>
    )
  }
  if (props.kind === 'error') {
    return (
      <Callout
        tone="danger"
        actions={
          props.onRetry ? (
            <Button variant="secondary" size="sm" onClick={props.onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      >
        Couldn't load this {noun}. Check your connection and try again.
      </Callout>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-[var(--color-muted-foreground)]">{upperFirst(noun)} not found</p>
      {props.backTo && <BackButton to={props.backTo} label={props.backLabel ?? 'the previous page'} />}
    </div>
  )
}
