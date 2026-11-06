import { rowSizes } from '@/pages/dashboard/bandLayout'

const TRACKS = 420

/** Tracks each tile spans at the band's three widths: under 36rem two to a row (an odd last tile spans both), 36rem to 56rem rows dealt as evenly as whole tiles allow (4 + 3), 56rem and wider one row. */
export function quickAddSpans(count: number): number[][] {
  const mid = rowSizes(count, 4).flatMap(size => Array<number>(size).fill(TRACKS / size))
  return Array.from({ length: count }, (_, i) => [count % 2 === 1 && i === count - 1 ? TRACKS : TRACKS / 2, mid[i], TRACKS / count])
}
