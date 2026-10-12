import type { AgreementState, PlanPriceZone } from '@/api/types'

export const STATES: AgreementState[] = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']
export const ZONES: { value: PlanPriceZone; label: string }[] = [
  { value: 'National', label: 'National (most places)' },
  { value: 'Remote', label: 'Remote' },
  { value: 'VeryRemote', label: 'Very remote' },
]

/**
 * A tab or a line break pasted into a one-line box becomes the space it stands for, and any other control character (a NUL) is dropped: the server refuses a representative that has one (it is written to a
 * Postgres text column and onto the PDF), and a name that was pasted should not come back as a refusal about a character nobody can see.
 */
export const withoutControlCharacters = (text: string) => text.replace(/[\t\r\n]+/g, ' ').replace(/\p{Cc}/gu, '')

export type Details = {
  state: AgreementState
  zone: PlanPriceZone
  agreementStartDate: string
  agreementEndDate: string
  representative: string
  /** Set only when the coordinator says the NDIS plan has other dates than the participant's recorded funding plan. */
  planOverride: { start: string; end: string } | null
}

/** The NDIS plan dates the agreement is saved under: the coordinator's own, else the participant's recorded funding plan, else the agreement's own dates. */
export function planDatesOf(details: Details, recorded: { start: string; end: string } | null): { start: string; end: string } {
  return details.planOverride ?? recorded ?? { start: details.agreementStartDate, end: details.agreementEndDate }
}

