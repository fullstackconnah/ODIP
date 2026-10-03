import type { ShiftPatternDto } from '@/api/types'
import { StatusBadge } from '@/components/StatusBadge'
import { RequirementChips } from '@/components/RequirementChips'

/** The words for where an agreement pattern came from: the version when the server knows it. */
function patternSourceLabel(pattern: Pick<ShiftPatternDto, 'sourceDraftId' | 'sourceDraftVersion'>): string | null {
  if (!pattern.sourceDraftId) return null
  return pattern.sourceDraftVersion !== undefined ? `From agreement v${pattern.sourceDraftVersion}` : 'From an agreement'
}

/**
 * What the Patterns list says about where a pattern came from (plan builder, phase D): a badge with the version of the agreement whose approval made it, and, beside it, what that agreement asks of
 * a worker as chips. A pattern a person made (or the demo pack did) has neither and draws a dash. Both are information: the pattern stays as editable as any other.
 */
export function PatternSource({ pattern }: { pattern: Pick<ShiftPatternDto, 'sourceDraftId' | 'sourceDraftVersion' | 'requirements'> }) {
  const label = patternSourceLabel(pattern)
  if (!label) return <span className="text-[var(--color-muted-foreground)]">—</span>
  return (
    <span className="flex flex-wrap items-center gap-1">
      <StatusBadge tone="info" label={label} />
      <RequirementChips requirements={pattern.requirements} />
    </span>
  )
}
