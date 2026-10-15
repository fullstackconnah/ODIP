import type { DraftBlock, ServiceAgreementDraftLineDto } from '@/api/types'

/** One side of a review row: what the agreement charges for the line. */
export interface RenewalSide {
  unitPrice: number
  total: number
  catalogueVersion: string
}

/** One line of the renewal review (agreement PR 2, D10): the old revision's against the renewal's. `old` is null for a line only the renewal has, `renewal` for an old one it has not got (a withdrawn item, or days outside its dates). */
export interface RenewalRow {
  key: string
  blockId: string | null
  itemCode: string
  band: string | null
  unit: string
  serviceType: string
  old: RenewalSide | null
  renewal: RenewalSide | null
}

/** Marks an old line's block the renewal no longer has, so it pairs with nothing. */
const GONE = 'gone:'
const keyOf = (line: ServiceAgreementDraftLineDto) => `${line.blockId ?? ''}|${line.itemCode}|${line.band ?? ''}|${line.unit}`
const toCents = (amount: number) => Math.round(amount * 100) / 100

function grouped(lines: readonly ServiceAgreementDraftLineDto[]) {
  const groups = new Map<string, ServiceAgreementDraftLineDto[]>()
  for (const line of lines) groups.set(keyOf(line), [...(groups.get(keyOf(line)) ?? []), line])
  return groups
}

/** A key's lines as one: a price that changed inside the period makes several rows, shown at the newest row's price and version, with the whole total. */
function side(lines: ServiceAgreementDraftLineDto[] | undefined): RenewalSide | null {
  if (!lines) return null
  const newest = lines.reduce((a, b) => (b.catalogueEffectiveFrom > a.catalogueEffectiveFrom ? b : a))
  return { unitPrice: newest.unitPrice, total: toCents(lines.reduce((sum, line) => sum + line.total, 0)), catalogueVersion: newest.catalogueVersion }
}

const supportOf = ({ block }: DraftBlock) => `${block.supportType}|${[...block.days].sort().join(',')}|${block.start}|${block.end}`

/**
 * Which renewal block each old block is (fix round 1, deep S2): the agreement builder renumbers block ids on every save, so blocks are paired by what they are, the support, days and times. Two
 * blocks the same on all of those would overlap, which the engine refuses, so a pair is never in doubt. A block the renewal no longer has is left out.
 */
export function matchBlocks(oldBlocks: readonly DraftBlock[], newBlocks: readonly DraftBlock[]): Map<string, string> {
  const byKey = new Map(newBlocks.map(entry => [supportOf(entry), entry.block.id]))
  return new Map(oldBlocks.flatMap(entry => {
    const id = byKey.get(supportOf(entry))
    return id ? [[entry.block.id, id] as const] : []
  }))
}

/**
 * The review's rows: the renewal's lines in its order, each beside the old line it matches, then the old lines the renewal has not got, last. With `oldToNew` (matchBlocks), an old line is keyed by
 * the renewal block it became, and a line of a block the renewal no longer has pairs with nothing (its row's blockId is null).
 */
export function renewalComparison(oldLines: readonly ServiceAgreementDraftLineDto[], newLines: readonly ServiceAgreementDraftLineDto[], oldToNew?: ReadonlyMap<string, string>): RenewalRow[] {
  const before = grouped(oldToNew ? oldLines.map(line => ({ ...line, blockId: oldToNew.get(line.blockId ?? '') ?? `${GONE}${line.blockId ?? ''}` })) : oldLines)
  const after = grouped(newLines)
  const keys = [...after.keys(), ...[...before.keys()].filter(key => !after.has(key))]
  return keys.map(key => {
    const sample = (after.get(key) ?? before.get(key)!)[0]
    return {
      key, blockId: sample.blockId?.startsWith(GONE) ? null : sample.blockId ?? null, itemCode: sample.itemCode, band: sample.band ?? null, unit: sample.unit, serviceType: sample.serviceType,
      old: side(before.get(key)), renewal: side(after.get(key)),
    }
  })
}

/** What each side adds up to, to the cent. */
export function renewalTotals(rows: readonly RenewalRow[]): { old: number; renewal: number } {
  return { old: toCents(rows.reduce((sum, row) => sum + (row.old?.total ?? 0), 0)), renewal: toCents(rows.reduce((sum, row) => sum + (row.renewal?.total ?? 0), 0)) }
}
