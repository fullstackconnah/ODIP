import { AlertTriangle, AlertCircle, Info, type LucideIcon } from 'lucide-react'
import type { AlertSeverity } from '@/api/types'
import { TONE, type Tone } from '@/lib/tone'

// An Info alert sits on the quiet surface rather than the info tone's slate wash: it must not read as a coloured banner beside the
// Critical and Warning rows. (A deliberate exception to `TONE.info.soft`, kept from before the tone table.)
const QUIET_ROW = 'bg-[var(--color-surface-container-low)]'

/**
 * Shared icon/colour mapping for computed participant risk alerts (task 6c) — used by
 * ParticipantAlertsBanner, the participants table alerts badge, and the dashboard's
 * Critical-alerts card, so all three read the same severity consistently. Each severity is a tone
 * (Critical is danger, Warning is warning, Info is info): `text` is the tone's ink and `bg` its soft wash.
 */
export const ALERT_SEVERITY_STYLES: Record<AlertSeverity, { icon: LucideIcon; tone: Tone; text: string; bg: string; label: string }> = {
  Critical: { icon: AlertTriangle, tone: 'danger', text: TONE.danger.ink, bg: TONE.danger.soft, label: 'Critical' },
  Warning: { icon: AlertCircle, tone: 'warning', text: TONE.warning.ink, bg: TONE.warning.soft, label: 'Warning' },
  Info: { icon: Info, tone: 'info', text: TONE.info.ink, bg: QUIET_ROW, label: 'Info' },
}

/**
 * Human-readable wording for a computed alert's machine-readable `type` code, for surfaces that
 * show the alert type itself (e.g. the dashboard's Critical-alerts cards) rather than just its
 * `message`. Most alert types (e.g. "plan-expired") are only ever shown via their `message`, so
 * this only needs entries for types that are shown by type — add to it as that need grows.
 */
export const ALERT_TYPE_LABELS: Record<string, string> = {
  'open-serious-incident': 'Open serious incident',
  'qsc-report-overdue': 'QSC report overdue',
}
