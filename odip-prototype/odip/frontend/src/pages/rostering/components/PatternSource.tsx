import type { ShiftPatternDto } from '@/api/types'
import { StatusBadge } from '@/components/StatusBadge'
import { RequirementChips } from '@/components/RequirementChips'

/**
 * The words for where an agreement pattern came from: the version when the server knows it, and, for the two patterns a 2:1 support makes (the same day, time and range, told apart only by the
 * worker they are for), which worker of the two this one is.
 */
function patternSourceLabel(pattern: Pick<ShiftPatternDto, 'sourceDraftId' | 'sourceDraftVersion' | 'ratio' | 'workerSlot'>): string | null {
  if (!pattern.sourceDraftId) return null
  const from = pattern.sourceDraftVersion !== undefined ? `From agreement v${pattern.sourceDraftVersion}` : 'From an agreement'
  return pattern.ratio === 'TwoToOne' && pattern.workerSlot ? `${from} · worker ${pattern.workerSlot} of 2` : from
}

/**
 * What the Patterns list says about where a pattern came from (plan builder, phase D): a badge with the version of the agreement whose approval made it, and, under it, what that agreement asks of
 * a worker as chips. A pattern a person made (or the demo pack did) has neither and draws a dash. Both are information: the pattern stays as editable as any other.
 */
export function PatternSource({ pattern }: { pattern: Pick<ShiftPatternDto, 'sourceDraftId' | 'sourceDraftVersion' | 'requirements' | 'ratio' | 'workerSlot'> }) {
  const label = patternSourceLabel(pattern)
  if (!label) return <span className="text-[var(--color-muted-foreground)]">—</span>
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone="info" label={label} />
      <RequirementChips requirements={pattern.requirements} />
    </span>
  )
}
