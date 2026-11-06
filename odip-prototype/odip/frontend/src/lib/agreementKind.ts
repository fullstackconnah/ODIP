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
