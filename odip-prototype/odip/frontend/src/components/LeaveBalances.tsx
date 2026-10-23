import type { ReactNode } from 'react'
import type { LeaveBalancesDto } from '@/api/types'
import { formatBalance } from '@/lib/leaveBalances'
import { retryingAfterError } from '@/lib/queryPhase'
import { Button } from './Button'
import { FactList } from './FactList'

const MUTED = 'text-sm text-[var(--color-muted-foreground)]'
/** The one line shown for every failure; EH's own words never reach staff. */
const BALANCES_UNAVAILABLE = "Balances aren't available right now."

type BalancesQuery = {
  data?: LeaveBalancesDto
  isLoading: boolean
  isError: boolean
  isFetching?: boolean
  errorUpdateCount?: number
  refetch: () => unknown
}

/**
 * A person's leave balances, read live from Employment Hero (never stored). One slot, one row tall, for every state so a late answer never moves what is
 * above it. Renders nothing when the server says the organisation isn't connected. A refetch in the background keeps the list on screen.
 */
export function LeaveBalances({ query, noneMessage, notLinked, footer = 'From Employment Hero, as at today.', loadingMessage = 'Reading your balances from Employment Hero…', headingLevel = 2 }: {
  query: BalancesQuery
  noneMessage: string
  /** Words (and an optional action) for a person who isn't linked to Employment Hero. */
  notLinked: ReactNode
  footer?: string
  loadingMessage?: string
  /** 3 inside a Card whose neighbours use the Card title (an h3). */
  headingLevel?: 2 | 3
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3'
  const retrying = retryingAfterError(query)
  const failed = query.isError || retrying
  const data = failed ? undefined : query.data
  if (data?.status === 'NotConnected') return null
  return (
    <section aria-labelledby="leave-balances-heading" className="flex flex-col gap-2">
      <Heading id="leave-balances-heading" className="text-sm font-semibold">Leave balances</Heading>
      <div className="min-h-6">
        {failed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className={MUTED} role="status">{BALANCES_UNAVAILABLE}</p>
            <Button variant="secondary" size="sm" className="min-h-[var(--tap-min)]" disabled={retrying} onClick={() => query.refetch()}>{retrying ? 'Trying…' : 'Try again'}</Button>
          </div>
        ) : !data ? (
          <p className={MUTED} role="status">{loadingMessage}</p>
        ) : data.status === 'NotLinked' ? (
          <div className={`${MUTED} flex flex-wrap items-center gap-3`}>{notLinked}</div>
        ) : data.balances.length === 0 ? (
          <p className={MUTED}>{noneMessage}</p>
        ) : (
          <>
            <FactList items={data.balances.map(b => ({ label: b.category, value: <span className="tabular-nums [overflow-wrap:anywhere]">{formatBalance(b)}</span> }))} />
            <p className={`${MUTED} mt-2`}>{footer}</p>
          </>
        )}
      </div>
    </section>
  )
}
