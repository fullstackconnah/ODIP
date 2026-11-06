import { agreementLabel } from '@/lib/agreementKind'
import { formatCurrency } from '@/lib/utils'
import type { AgreementCheck } from '@/api/types'

/** The warning's lines: one per pool the combined plan passes, then who was counted. */
export function combinedLines(check: AgreementCheck, countedLead: string, self?: { label: string; version: number }) {
  const pools = check.pools
    .filter(p => p.combinedOverBy > 0)
    .map(p => `${p.poolName}: ${formatCurrency(p.combinedCost)} planned, ${formatCurrency(p.combinedOverBy)} more than the money available.`)
  const counted = [...(self ? [`${self.label} (version ${self.version})`] : []), ...check.otherAgreements.map(o => `${agreementLabel(o)} (version ${o.version})`)]
  return [...pools, `${countedLead}: ${counted.join(', ')}. Nothing is blocked.`]
}
