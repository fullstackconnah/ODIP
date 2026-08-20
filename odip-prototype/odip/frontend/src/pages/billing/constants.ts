import type { FundingRouteType, BillableEventStatus } from '@/api/types'
import {
  FUNDING_ROUTE_TYPES,
  FUNDING_ROUTE_TYPE_LABELS,
  BILLABLE_EVENT_STATUSES,
  INCOME_STREAMS,
  INCOME_STREAM_LABELS,
} from '@/api/types'

// Re-export the canonical enum values/labels from the API contract so every
// billing sub-component pulls from one place.
export { FUNDING_ROUTE_TYPES, FUNDING_ROUTE_TYPE_LABELS, BILLABLE_EVENT_STATUSES, INCOME_STREAMS, INCOME_STREAM_LABELS }

// ── Presentation-only additions (not part of the API contract) ──

export const FUNDING_ROUTE_TYPE_HINTS: Record<FundingRouteType, string> = {
  AgencyManaged: 'Billed via an NDIS PRODA claim against a service booking.',
  PlanManaged: "Invoiced to the participant's plan manager.",
  SelfManaged: 'Invoiced directly to the participant or their nominee.',
  Private: 'Invoiced directly, outside NDIS funding.',
  BusinessToBusiness: 'Invoiced to another business or organisation.',
}

export const FUNDING_ROUTE_TYPE_COLORS: Record<FundingRouteType, string> = {
  AgencyManaged: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  PlanManaged: 'bg-[var(--color-secondary-container)] text-[var(--color-secondary)]',
  SelfManaged: 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]',
  Private: 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]',
  BusinessToBusiness: 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]',
}

/**
 * Once an event has been claimed, the backend rejects further edits with a 400.
 * These statuses are treated as locked in the UI so the control is disabled
 * with an explanation rather than letting the user hit the error.
 */
export const LOCKED_BILLABLE_EVENT_STATUSES: BillableEventStatus[] = [
  'Claimed',
  'Invoiced',
  'Paid',
  'Rejected',
]

export function isBillableEventLocked(status: BillableEventStatus): boolean {
  return LOCKED_BILLABLE_EVENT_STATUSES.includes(status)
}

export const BILLABLE_EVENT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
  validated: 'bg-[var(--color-secondary-container)] text-[var(--color-secondary)]',
  routed: 'bg-[var(--color-secondary-container)] text-[var(--color-secondary)]',
  claimed: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  invoiced: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  paid: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  rejected: 'bg-[var(--color-error-container)] text-[var(--color-destructive)]',
  cancelled: 'bg-[var(--color-error-container)] text-[var(--color-destructive)]',
}

// ── Claim Day Type / Claim Type / GST Code labels ───────────────
// (Types themselves live in '@/api/types/enums' — reused as-is; no label maps
// exist there yet, so these are presentation-only additions.)
export const CLAIM_DAY_TYPE_LABELS: Record<string, string> = {
  Weekday: 'Weekday',
  Saturday: 'Saturday',
  Sunday: 'Sunday',
  Weekend: 'Weekend',
  PublicHoliday: 'Public Holiday',
  ShortNotice: 'Short Notice',
  WeekdayEvening: 'Weekday Evening',
}

export const CLAIM_TYPE_LABELS: Record<string, string> = {
  Standard: 'Standard',
  Cancellation: 'Cancellation',
  Variation: 'Variation',
  Adjustment: 'Adjustment',
}

export const GST_CODE_LABELS: Record<string, string> = {
  P1: 'P1',
  P2: 'P2',
  P5: 'P5',
  GST: 'GST',
  NoGST: 'No GST',
  Exempt: 'Exempt',
}
