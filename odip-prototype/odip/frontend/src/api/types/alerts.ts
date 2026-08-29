import type { AlertSeverity } from './enums'

/**
 * A single computed participant risk alert (task 6c). Nothing here is persisted — the backend
 * derives these at read time (see Odip.Infrastructure.Services.ParticipantAlertsService). `type`
 * is a stable machine-readable code (e.g. "plan-expired") that can be used as a React key;
 * `deepLinkTab` is a ParticipantDetailPage tab key — link to `/participants/{id}?tab=${deepLinkTab}`.
 */
export interface ParticipantAlertDto {
  type: string
  severity: AlertSeverity
  message: string
  deepLinkTab: string
}

/** Ranked alerts (Critical first) for one participant, plus per-severity counts. */
export interface ParticipantAlertsDto {
  participantId: string
  participantName: string
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
