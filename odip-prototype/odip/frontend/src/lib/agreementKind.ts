import type { AgreementKind } from '@/api/types/service-agreement-drafts'

/** Select order; `Other` last. Never "Core": that reads as the NDIS Core budget category. */
export const KIND_ORDER: AgreementKind[] = ['Core', 'NightSupport', 'ShortTermAccommodation', 'Trip', 'Other']

export const KIND_LABEL: Record<AgreementKind, string> = {
  Core: 'Everyday support',
  NightSupport: 'Night support',
  ShortTermAccommodation: 'Short-term accommodation',
  Trip: 'Trip',
  Other: 'Other',
}

interface Labelled { agreementKind: AgreementKind; agreementName?: string | null }

export const agreementLabel = (d: Labelled) => d.agreementName?.trim() || KIND_LABEL[d.agreementKind]

/** The unnamed everyday agreement every participant had before several were allowed: shown with no label. */
export const isPlainAgreement = (d: Labelled) => !d.agreementName?.trim() && d.agreementKind === 'Core'

/** The server's 400 texts about the type and the name go under their fields; everything else stays in the failure callout. */
export function splitAgreementFieldErrors(messages: string[]) {
  const kind = messages.find(m => /agreement type/i.test(m))
  const name = messages.find(m => /agreement name/i.test(m))
  return { kind, name, rest: messages.filter(m => m !== kind && m !== name) }
}
