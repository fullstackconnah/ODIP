import type { PlanBlockRequirements } from '@/api/types'
import { requirementLabels } from '@/lib/workerRequirements'

const CHIP_CLASS = 'inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--color-secondary-container)] text-[var(--color-foreground)]'

/**
 * What an agreement asks of a worker, as chips (Female worker, Driver, First aid, ...), on a roster pattern and on a shift. Information only: nothing on the roster checks it against a worker yet. Draws
 * nothing when nothing is asked, so a row of chips never ends in an empty strip.
 */
export function RequirementChips({ requirements, className }: { requirements: PlanBlockRequirements | null | undefined; className?: string }) {
  const labels = requirementLabels(requirements)
  if (labels.length === 0) return null

  return (
    <ul aria-label="Asks for" className={`inline-flex flex-wrap items-center gap-1 ${className ?? ''}`}>
      {labels.map(label => (
        <li key={label} className={CHIP_CLASS} title="Asked for by the agreement. Not checked against the worker yet.">{label}</li>
      ))}
    </ul>
  )
}
