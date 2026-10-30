import { Check } from 'lucide-react'
import { StatusBadge } from '@/components/StatusBadge'
import { formatDateAu } from '@/lib/utils'
import { plural } from '@/lib/format'
import { TONE } from '@/lib/tone'
import type { AgeBand, BatchDto, HubLineDto } from '@/api/types'

// What the hub's panels share: a line's age, its delivery span and quantity, and a file's step.

export const ROWS_PER_PAGE = 50
export const MAX_FILE_LINES = 5000

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

/** "12 Aug 2026", or "12–14 Aug 2026" for a span. */
export function deliveredText(from: string, to: string): string {
  if (from === to) return formatDateAu(from)
  const [a, b] = [formatDateAu(from), formatDateAu(to)]
  const [ad, am, ay] = a.split(' ')
  const [bd, bm, by] = b.split(' ')
  if (ay === by && am === bm) return `${ad}–${bd} ${bm} ${by}`
  return `${a} – ${b}`
}

/** The file's own "H:MM" form, or "1 each" for a quantity line. */
export function quantityText(line: Pick<HubLineDto, 'hours' | 'quantity'>): string {
  if (line.quantity != null && !line.hours) return `${line.quantity} each`
  const minutes = Math.round(line.hours * 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

export function PassMark({ warning }: { warning?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[var(--color-muted-foreground)]">
      <Check className="size-3.5" aria-hidden="true" />Ready
      {warning && <span className={TONE.warning.ink}> · {warning}</span>}
    </span>
  )
}

export type FileStep = 'Built' | 'Uploaded' | 'Results in' | 'Paid' | 'Discarded'

/** A file's step: Paid is derived (every successful line paid), the rest is its status (SHAPE §4). */
export function stepOf(b: BatchDto): FileStep {
  if (b.status === 'Discarded') return 'Discarded'
  if (b.status === 'Built') return 'Built'
  if (b.status === 'Uploaded') return 'Uploaded'
  return b.successful > 0 && b.paid >= b.successful ? 'Paid' : 'Results in'
}

export const isUnfinished = (b: BatchDto) => !['Paid', 'Discarded'].includes(stepOf(b))

export const NEXT_TEXT: Record<FileStep, string> = {
  Built: 'Upload it in the portal',
  Uploaded: 'Import the results',
  'Results in': 'Mark paid when the money arrives',
  Paid: 'Done',
  Discarded: '—',
}

export const STEP_NUMBER: Record<FileStep, number> = { Built: 1, Uploaded: 2, 'Results in': 3, Paid: 4, Discarded: 0 }

/** The step's one next action, the same in the strip, the Files row and the panel. */
export const NEXT_ACTION: Partial<Record<FileStep, { label: string; primary: boolean }>> = {
  Built: { label: "I've uploaded it", primary: true },
  Uploaded: { label: 'Import results', primary: true },
  'Results in': { label: 'Mark paid', primary: false },
}

export function StepBadge({ batch }: { batch: BatchDto }) {
  const step = stepOf(batch)
  return <StatusBadge status={step} tone={step === 'Paid' ? 'success' : step === 'Discarded' ? 'neutral' : 'info'} />
}
