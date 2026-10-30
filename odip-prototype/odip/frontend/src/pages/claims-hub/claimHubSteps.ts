import { formatDateAu } from '@/lib/utils'
import type { BatchDto, HubLineDto } from '@/api/types'

// What the hub's panels share that isn't a component: page sizes, a line's delivery span and quantity, and a file's step.

export const ROWS_PER_PAGE = 50
export const MAX_FILE_LINES = 5000

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

export type FileStep = 'Built' | 'Uploaded' | 'Results in' | 'Paid' | 'Discarded'

/** A file's step: Paid is derived (every successful line paid), the rest is its status (SHAPE §4). */
export function stepOf(b: BatchDto): FileStep {
  if (b.status === 'Discarded') return 'Discarded'
  if (b.status === 'Built') return 'Built'
  if (b.status === 'Uploaded') return 'Uploaded'
  return b.successful > 0 && b.paid >= b.successful ? 'Paid' : 'Results in'
}

/** Finished: discarded, or results in with every successful line paid. A file with no successful lines has nothing to pay (0 of 0), so it is finished at Results in. */
export const isUnfinished = (b: BatchDto) => b.status !== 'Discarded' && !(b.status === 'ResultsImported' && b.paid >= b.successful)

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
