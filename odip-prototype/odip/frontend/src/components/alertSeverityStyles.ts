import { AlertTriangle, AlertCircle, Info, type LucideIcon } from 'lucide-react'
import type { AlertSeverity } from '@/api/types'

/**
 * Shared icon/colour mapping for computed participant risk alerts (task 6c) — used by
 * ParticipantAlertsBanner, the participants table alerts badge, and the dashboard's
 * Critical-alerts card, so all three read the same severity consistently.
 */
export const ALERT_SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; text: string; bg: string; label: string }> = {
  Critical: { icon: AlertTriangle, text: 'text-[var(--color-destructive)]', bg: 'bg-[var(--color-error-container)]/30', label: 'Critical' },
  Warning: { icon: AlertCircle, text: 'text-amber-700', bg: 'bg-amber-50', label: 'Warning' },
  Info: { icon: Info, text: 'text-[var(--color-info)]', bg: 'bg-[var(--color-surface-container-low)]', label: 'Info' },
}
