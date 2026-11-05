/** The kinds of compliance date, in the order the form lists them. The server stores the name. */
export const COMPLIANCE_KINDS = ['Registration', 'Audit', 'MidTermAudit', 'Insurance', 'KeyPersonnel'] as const
export type ComplianceKind = typeof COMPLIANCE_KINDS[number]

export const COMPLIANCE_KIND_LABELS: Record<ComplianceKind, string> = {
  Registration: 'Registration',
  Audit: 'Audit',
  MidTermAudit: 'Mid-term audit',
  Insurance: 'Insurance',
  KeyPersonnel: 'Key personnel',
}

/** One date (GET /compliance-items), soonest first. */
export interface ComplianceItemDto {
  id: string
  kind: ComplianceKind
  label: string
  /** A calendar day, yyyy-mm-dd: the last day it is valid, or for an audit the day it is due. */
  expiresOn: string
  reference: string | null
  notes: string | null
  /** Whole days from the provider's today to `expiresOn`; negative once it has passed. */
  daysLeft: number
}

/** The body of POST and PUT /compliance-items: the whole date. */
export interface SaveComplianceItemDto {
  kind: ComplianceKind
  label: string
  expiresOn: string
  reference: string | null
  notes: string | null
}
