// Which staff credentials count, and what state each is in: ONE rule for the Qualifications list, a staff member's Credentials tab and the
// Dashboard's "Qualification Issues" figure, so the three can never disagree. Pure and JSX-free.
//
// The rule: a credential with a qualification flag (First Aid, Driver Licence, Manual Handling, Medication Competency) applies when the
// flag is set, with or without a date (no date is an issue). Worker Screening has no flag, so it applies only once an expiry date has
// been entered; a screening number alone does not make it apply (there is nothing to expire yet).
import { deadlineState, isDeadlineIssue, type DeadlineState } from './deadline'

export const CREDENTIALS = [
  { key: 'firstAid', label: 'First Aid', flag: 'isFirstAidQualified', field: 'firstAidExpiryDate' },
  { key: 'driver', label: 'Driver Licence', flag: 'isDriverEligible', field: 'driverLicenceExpiryDate' },
  { key: 'manualHandling', label: 'Manual Handling', flag: 'isManualHandlingCompetent', field: 'manualHandlingExpiryDate' },
  { key: 'medication', label: 'Medication Competency', flag: 'isMedicationCompetent', field: 'medicationCompetencyExpiryDate' },
  { key: 'workerScreening', label: 'Worker Screening', flag: null, field: 'workerScreeningExpiryDate' },
] as const

type Credential = (typeof CREDENTIALS)[number]

/** The staff fields the rule reads (StaffListDto and StaffDetailDto both carry them). */
export interface CredentialSource {
  isFirstAidQualified?: boolean
  firstAidExpiryDate?: string | null
  isDriverEligible?: boolean
  driverLicenceExpiryDate?: string | null
  isManualHandlingCompetent?: boolean
  manualHandlingExpiryDate?: string | null
  isMedicationCompetent?: boolean
  medicationCompetencyExpiryDate?: string | null
  workerScreeningExpiryDate?: string | null
}

export interface StaffCredential {
  key: Credential['key']
  label: Credential['label']
  /** The staff field holding the expiry date (what an edit writes back). */
  field: Credential['field']
  expiryDate: string | null
  state: DeadlineState
}

export interface CredentialOptions {
  warnDays: number
  /** See deadlineState: a Date or "YYYY-MM-DD"; defaults to now. */
  today?: Date | string
}

/** The credentials that apply to one staff member, each with its deadline state. */
export function staffCredentials(staff: CredentialSource, { warnDays, today = new Date() }: CredentialOptions): StaffCredential[] {
  const out: StaffCredential[] = []
  for (const c of CREDENTIALS) {
    const expiryDate = staff[c.field] || null
    if (!(c.flag === null ? expiryDate !== null : staff[c.flag])) continue
    out.push({ key: c.key, label: c.label, field: c.field, expiryDate, state: deadlineState(expiryDate, { warnDays, today }) })
  }
  return out
}

/** How many of a staff member's credentials need action: no date, expired, due today or due soon. */
export function credentialIssueCount(credentials: readonly StaffCredential[]): number {
  return credentials.filter(c => isDeadlineIssue(c.state)).length
}
