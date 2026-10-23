import { useEffect, useRef, useState } from 'react'
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
      /** Shows "Try again". Return the retry Promise (normally `refetch`) to hold the action until it settles; synchronous callbacks remain supported. */
      onRetry?: () => unknown
      /** The server's own words for the failure: one muted line under the title. Omit it and the title stands alone. */
      detail?: string
    })
  | (Common & {
      kind: 'not-found'
      /** A whole page also offers the way out: a Back button to this route, named by `backLabel`. A tab inside a page that is still on screen omits both. */
      backTo?: string
      backLabel?: string
    })

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const isFailedResult = (result: unknown) => !!result && typeof result === 'object' && ((result as { isError?: unknown }).isError === true || (result as { status?: unknown }).status === 'error')

function RetryError({ noun, onRetry, detail }: Common & { onRetry?: () => unknown; detail?: string }) {
  const [state, setState] = useState<'idle' | 'pending' | 'failed'>('idle')
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  function retry() {
    if (pending.current || !onRetry) return
    pending.current = true
    const finish = (failed: boolean) => {
      pending.current = false
      if (mounted.current) setState(failed ? 'failed' : 'idle')
    }
    try {
      const request = onRetry()
      if (request && typeof request === 'object' && 'then' in request && typeof request.then === 'function') {
        setState('pending')
        // refetch() RESOLVES with { isError: true } when the request fails (no throwOnError), so a resolved failure counts, as does a rejection.
        void request.then((result: unknown) => finish(isFailedResult(result)), () => finish(true))
      } else finish(false)
    } catch {
      finish(true)
    }
  }

  // The visible line sits beside the button, inside the actions row, so the banner never changes height; the polite status node is what assistive tech hears.
  const status = state === 'pending' ? 'Trying again…' : state === 'failed' ? "Couldn't load it again." : ''
  return (
    <div>
      <Callout
        tone="danger"
        actions={onRetry ? (
          <>
            <Button variant="secondary" size="sm" onClick={retry} aria-disabled={state === 'pending'} aria-busy={state === 'pending' || undefined} className="min-h-[var(--tap-min)] aria-disabled:opacity-50 aria-disabled:cursor-not-allowed">
              Try again
            </Button>
            {/* A fixed width, so the right-aligned button holds one x position in idle, pending and failed (the failed copy measures about 136px). */}
            <span aria-hidden="true" className="min-w-[8.75rem] text-[var(--color-muted-foreground)]">{status}</span>
          </>
        ) : undefined}
      >
        Couldn't load this {noun}. Check your connection and try again.
        {detail && <span className="mt-1 block text-sm [overflow-wrap:anywhere]">{detail}</span>}
      </Callout>
      <div role={state === 'idle' ? undefined : 'status'} aria-live="polite" aria-atomic="true" className="sr-only">{status}</div>
    </div>
  )
}

/**
 * What a page shows in place of itself while its record is loading, when the load failed, and when there is no such record. They are three
 * different facts, so they are three different states:
 *
 *   if (isLoading && !retryingAfterError(query)) return <PageState kind="loading" noun="trip" />
 *   if (!trip) {
 *     return (isError || retryingAfterError(query)) && !isNotFoundError(error)
 *       ? <PageState kind="error" noun="trip" onRetry={() => refetch()} />
 *       : <PageState kind="not-found" noun="trip" backTo="/trips" backLabel="trips" />
 *   }
 *
 * `retryingAfterError` (lib/queryPhase) keeps the banner on screen through a retry, when TanStack resets the failed query to loading.
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
    return <RetryError noun={noun} onRetry={props.onRetry} detail={props.detail} />
  }
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <p className="text-[var(--color-muted-foreground)]">{upperFirst(noun)} not found</p>
      {props.backTo && <BackButton to={props.backTo} label={props.backLabel ?? 'the previous page'} />}
    </div>
  )
}
