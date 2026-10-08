import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import type { BudgetWarningDto } from '@/api/types'

export type BudgetWarningsProps = {
  /** The server's warnings, one for each pool and funding period an action takes past its funding. None: nothing is drawn. */
  warnings: readonly BudgetWarningDto[] | null | undefined
  /** The line that closes the warning, in the words of the place it is shown: what happened anyway ("The shifts were made."). A budget warning never blocks, in any mode. */
  note: string
  /** Whether the callout announces itself. On by default; off where it sits inside content that is read in order (a confirm dialog's body). */
  announce?: boolean
  /** When given, a "Dismiss" button closes the warning: for one that stays on a page after the action that raised it (a booking confirmed from a list). */
  onDismiss?: () => void
  className?: string
}

/**
 * What an action did to a participant's budget, as a warning (budget phase 3): the shifts a pattern just made, the shifts an approval would make, a trip booking just confirmed. It prints the
 * SERVER'S sentence for each pool and period and does no sum of its own, and it says the thing that matters most about it: nothing was blocked. Draws nothing when there is nothing to say.
 */
export function BudgetWarnings({ warnings, note, announce = true, onDismiss, className }: BudgetWarningsProps) {
  if (!warnings || warnings.length === 0) return null
  return (
    <Callout
      tone="warning"
      title="Past the budget"
      announce={announce}
      className={className}
      actions={onDismiss ? <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button> : undefined}
    >
      <ul className="list-disc pl-5">
        {warnings.map(warning => <li key={`${warning.poolName}|${warning.periodStart}`}>{warning.message}</li>)}
      </ul>
      <p className="mt-1.5 text-xs">{note}</p>
    </Callout>
  )
}
