import type { AlertSeverity } from './enums'

/**
 * A single computed participant risk alert (task 6c). Nothing here is persisted — the backend
 * derives these at read time (see Odip.Infrastructure.Services.ParticipantAlertsService). `type`
 * is a stable machine-readable code (e.g. "plan-expired") that can be used as a React key;
 * `deepLinkTab` is a ParticipantDetailPage tab key — link to `/participants/{id}?tab=${deepLinkTab}`.
 * `linkTo` is an app route path (e.g. `/incidents/<id>`) for an alert whose target is not a
 * participant-page tab — when set, consumers should link there instead of using `deepLinkTab`.
 * Existing alert types keep `linkTo: null` and continue to use `deepLinkTab`.
 */
export interface ParticipantAlertDto {
  type: string
  severity: AlertSeverity
  message: string
  deepLinkTab: string
  linkTo: string | null
}

/** Ranked alerts (Critical first) for one participant, plus per-severity counts. */
export interface ParticipantAlertsDto {
  participantId: string
  participantName: string
  /**
   * Fix round 1 (review finding): the aggregate endpoint (`GET /participants/alerts`) excludes
   * inactive/archived participants server-side by default, but consumers of the aggregate should
   * still filter on this defensively rather than trusting it unconditionally — see DashboardPage,
   * which filters on `isActive` before deriving its Critical-alerts card. The single-participant
   * endpoint (`GET /participants/{id}/alerts`) intentionally returns alerts for an inactive
   * participant too (this field will be `false` there), so it must not be filtered out.
   */
  isActive: boolean
  alerts: ParticipantAlertDto[]
  criticalCount: number
  warningCount: number
  infoCount: number
}

export const ALERT_SEVERITY_ORDER: Record<AlertSeverity, number> = {
  Critical: 0,
  Warning: 1,
  Info: 2,
}
