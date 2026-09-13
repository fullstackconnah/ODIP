import { AlertTriangle, AlertCircle, Info, type LucideIcon } from 'lucide-react'
import type { AlertSeverity } from '@/api/types'

/**
 * Shared icon/colour mapping for computed participant risk alerts (task 6c) — used by
 * ParticipantAlertsBanner, the participants table alerts badge, and the dashboard's
 * Critical-alerts card, so all three read the same severity consistently.
 */
export const ALERT_SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; text: string; bg: string; label: string }> = {
  Critical: { icon: AlertTriangle, text: 'text-[var(--color-destructive)]', bg: 'bg-[var(--color-error-container)]/30', label: 'Critical' },
  Warning: { icon: AlertCircle, text: 'text-[var(--color-on-warning-container)]', bg: 'bg-[var(--color-warning-container)]', label: 'Warning' },
  Info: { icon: Info, text: 'text-[var(--color-info)]', bg: 'bg-[var(--color-surface-container-low)]', label: 'Info' },
}

/**
 * Human-readable wording for a computed alert's machine-readable `type` code, for surfaces that
 * show the alert type itself (e.g. the dashboard's Critical-alerts cards) rather than just its
 * `message`. Most alert types (e.g. "plan-expired") are only ever shown via their `message`, so
 * this only needs entries for types that are shown by type — add to it as that need grows.
 */
export const ALERT_TYPE_LABELS: Record<string, string> = {
  OpenSeriousIncident: 'Open serious incident',
  QscReportOverdue: 'QSC report overdue',
}
