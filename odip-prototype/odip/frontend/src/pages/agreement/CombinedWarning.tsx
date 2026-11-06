import { Callout } from '@/components/Callout'
import type { AgreementCheck } from '@/api/types'
import { combinedLines } from './combinedLines'

/** The agreement and the participant's other active ones plan more than the money available together. Information only: nothing is saved or blocked. */
export function CombinedWarning({ check, title, countedLead, self }: { check: AgreementCheck; title: string; countedLead: string; self?: { label: string; version: number } }) {
  if (!check.combinedOver) return null
  return (
    <Callout tone="warning" polite title={title}>
      {combinedLines(check, countedLead, self).map(line => <p key={line} className="break-words">{line}</p>)}
    </Callout>
  )
}
