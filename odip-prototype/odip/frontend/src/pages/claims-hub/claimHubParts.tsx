import { Check } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import type { AgeBand, BatchDto } from '@/api/types'
import { stepOf } from './claimHubSteps'

// The small pieces the hub's panels share: a line's age, its pass mark and a file's step badge.

/** Age since delivery, from the server's own count (SHAPE §5): plain text to 59 days, then a badge that warns at 60 and alarms at 80. */
export function AgeCell({ days, band }: { days: number; band: AgeBand }) {
  if (band === 'none') return <span className="text-[var(--color-muted-foreground)]" data-tone="none">{plural(days, 'day')}</span>
  const tone = band === 'amber' ? 'warning' : 'danger'
  return (
    <span data-tone={tone}>
      <StatusBadge status={band} tone={tone} label={band === 'over90' ? 'Over 90 days' : plural(days, 'day')} />
    </span>
  )
}

export function PassMark({ warning }: { warning?: string }) {
  return (
    <span data-pass={warning ? undefined : ''} className="inline-flex items-center gap-1 text-[var(--color-muted-foreground)]">
      <Check className="size-3.5" aria-hidden="true" />Ready
      {warning && <span className={TONE.warning.ink}> · {warning}</span>}
    </span>
  )
}

export function StepBadge({ batch }: { batch: BatchDto }) {
  const step = stepOf(batch)
  return <StatusBadge status={step} tone={step === 'Paid' ? 'success' : step === 'Discarded' ? 'neutral' : 'info'} />
}
