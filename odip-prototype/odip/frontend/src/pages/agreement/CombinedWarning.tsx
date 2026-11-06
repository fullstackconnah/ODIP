import { Callout } from '@/components/Callout'
import { agreementLabel } from '@/lib/agreementKind'
import { formatCurrency } from '@/lib/utils'
import type { AgreementCheck } from '@/api/types'

/** The warning's lines: one per pool the combined plan passes, then who was counted. Exported for its test. */
export function combinedLines(check: AgreementCheck, countedLead: string, self?: { label: string; version: number }) {
  const pools = check.pools
    .filter(p => p.combinedOverBy > 0)
    .map(p => `${p.poolName}: ${formatCurrency(p.combinedCost)} planned, ${formatCurrency(p.combinedOverBy)} more than the money available.`)
  const counted = [...(self ? [`${self.label} (version ${self.version})`] : []), ...check.otherAgreements.map(o => `${agreementLabel(o)} (version ${o.version})`)]
  return [...pools, `${countedLead}: ${counted.join(', ')}. Nothing is blocked.`]
}

/** The agreement and the participant's other active ones plan more than the money available together. Information only: nothing is saved or blocked. */
export function CombinedWarning({ check, title, countedLead, self }: { check: AgreementCheck; title: string; countedLead: string; self?: { label: string; version: number } }) {
  if (!check.combinedOver) return null
  return (
    <Callout tone="warning" polite title={title}>
      {combinedLines(check, countedLead, self).map(line => <p key={line} className="break-words">{line}</p>)}
    </Callout>
  )
}
