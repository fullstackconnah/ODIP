// ══════════════════════════════════════════════════════════════
// NOTIFICATIONS — mirrors backend NotificationDTOs.cs + the enums in
// backend/Odip.Domain/Notifications/NotificationEntities.cs
// docs/specs/2026-09-08-notifications-design.md §1/§2
//
// eventType/channel/status are strings on the wire (the API globally installs
// JsonStringEnumConverter, Program.cs) — copied verbatim from the backend enums, append-only
// there ("never renumber, never remove"), so this list only ever grows.
// ══════════════════════════════════════════════════════════════

export const NOTIFICATION_EVENT_TYPES = [
  'LeaveRequestSubmitted',
  'LeaveRequestDecided',
  'ShiftAssigned',
  'ShiftCompletionPendingReview',
  'ShiftCompletionReturned',
  'WitnessRequested',
  'CaregiverSubmissionReceived',
  'IncidentReported',
  'ServiceAgreementSent',
  'ServiceAgreementSigned',
  'IntegrationDegraded',
] as const
export type NotificationEventType = typeof NOTIFICATION_EVENT_TYPES[number]

/** Human labels for the preference grid and the admin outbox table. */
export const NOTIFICATION_EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  LeaveRequestSubmitted: 'Leave request submitted',
  LeaveRequestDecided: 'Leave request decided',
  ShiftAssigned: 'Shift assigned',
  ShiftCompletionPendingReview: 'Shift completion pending review',
  ShiftCompletionReturned: 'Shift completion returned',
  WitnessRequested: 'Witness requested',
  CaregiverSubmissionReceived: 'Caregiver submission received',
  IncidentReported: 'Incident reported',
  ServiceAgreementSent: 'Service agreement sent',
  ServiceAgreementSigned: 'Service agreement signed',
  IntegrationDegraded: 'Integration degraded',
}

/**
 * Grouping for the preference grid (§6: "rows = event types grouped by area (Leave, Rostering,
 * Medications, Caregiver, Incidents)"). `BuildGridAsync` on the backend returns every
 * `NotificationEventType` regardless of whether its trigger point is wired yet (v1 wires 7 of
 * the 11; ShiftCompletion(PendingReview/Returned) is wired but under a sibling PR,
 * ServiceAgreement(Sent/Signed) and IntegrationDegraded are enum values reserved for later specs)
 * — so the grid still needs a place to show every
 * value. Agreements/Integrations aren't named in §6's example list; grouped here rather than
 * omitted so the grid always accounts for all 11 values the backend can return.
 */
export const NOTIFICATION_EVENT_TYPE_GROUPS: { label: string; eventTypes: NotificationEventType[] }[] = [
  { label: 'Leave', eventTypes: ['LeaveRequestSubmitted', 'LeaveRequestDecided'] },
  { label: 'Rostering', eventTypes: ['ShiftAssigned', 'ShiftCompletionPendingReview', 'ShiftCompletionReturned'] },
  { label: 'Medications', eventTypes: ['WitnessRequested'] },
  { label: 'Caregiver', eventTypes: ['CaregiverSubmissionReceived'] },
  { label: 'Incidents', eventTypes: ['IncidentReported'] },
  { label: 'Agreements', eventTypes: ['ServiceAgreementSent', 'ServiceAgreementSigned'] },
  { label: 'Integrations', eventTypes: ['IntegrationDegraded'] },
]

export const NOTIFICATION_CHANNELS = ['Email', 'Sms'] as const
export type NotificationChannel = typeof NOTIFICATION_CHANNELS[number]

/** SMS renders disabled with "Not available yet" everywhere in the UI — ruling 1: no SMS
 * provider is implemented in v1, SmsChannel always resolves NotSupported/Skipped. */
export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  Email: 'Email',
  Sms: 'SMS',
}

export const NOTIFICATION_OUTBOX_STATUSES = ['Pending', 'Sent', 'Failed', 'Skipped'] as const
export type NotificationOutboxStatus = typeof NOTIFICATION_OUTBOX_STATUSES[number]

/**
 * `StatusBadge`'s built-in `STATUS_COLORS` already has a 'pending' key (amber) that matches this
 * domain's Pending for free, but no 'sent'/'failed'/'skipped' keys — without this override those
 * would all fall through to the same amber `DEFAULT_COLOR`, making a successfully-sent row look
 * identical to a failed one. Reuses the same design-token classes `STATUS_COLORS` uses for
 * equivalent semantics elsewhere (sent → the primary "confirmed" colour, failed → the
 * error-container "rejected" colour, skipped → the neutral "archived" colour).
 */
export const NOTIFICATION_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-[#fef3c7] text-[#92400e]',
  sent: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  failed: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
  skipped: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]',
}

export interface NotificationPreferenceRowDto {
  eventType: NotificationEventType
  channel: NotificationChannel
  enabled: boolean
}

/** GET/PUT api/v1/notifications/preferences response — every event x channel, `enabled` = the
 * caller's own row if one exists, else the event's documented default (email ON for every v1
 * event). */
export interface NotificationPreferenceGridDto {
  rows: NotificationPreferenceRowDto[]
}

/** PUT api/v1/notifications/preferences request row. No `userId` field anywhere — the endpoint
 * is self-scoped by construction (§2). An unknown eventType/channel name 400s
 * "Unknown event type or channel." */
export interface UpdateNotificationPreferenceDto {
  eventType: string
  channel: string
  enabled: boolean
}

/** GET api/v1/admin/notifications row / POST retry response. Null fields are omitted from JSON
 * (Program.cs's JsonIgnoreCondition.WhenWritingNull) — typed optional rather than `| null`. */
export interface NotificationOutboxDto {
  id: string
  eventType: NotificationEventType
  entityType: string
  entityId: string
  recipientUserId: string
  recipientName?: string
  status: NotificationOutboxStatus
  attempts: number
  nextAttemptAt: string
  lastError?: string
  createdAt: string
  sentAt?: string
}

/** POST api/v1/admin/notifications/test-email request. */
export interface SendTestEmailDto {
  to: string
}

/** POST api/v1/admin/notifications/test-email response — 200 either way; a failed test is the
 * endpoint's expected outcome, not a server error. */
export interface TestEmailResultDto {
  sent: boolean
  error?: string
}
