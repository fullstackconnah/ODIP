import { useState } from 'react'
import type { ParticipantAlertDto } from '@/api/types'
import { ALERT_SEVERITY_STYLES } from './alertSeverityStyles'

export type ParticipantAlertsBannerProps = {
  /** Already ranked Critical-first by the backend (ParticipantAlertsService) — rendered as-is. */
  alerts: ParticipantAlertDto[]
  /** Called with the alert's deepLinkTab when a row is activated — switch ParticipantDetailPage's tab state. */
  onSelectTab?: (tab: string) => void
}

// Header stays scannable even for a participant with many alerts — show the top-ranked few and
// collapse the rest behind a "+N more" toggle rather than letting the header grow unbounded.
const VISIBLE_ALERT_LIMIT = 3

/**
 * Alert banner strip for the participant detail header (task 6c). Renders nothing when there are
 * no alerts — this sits alongside the existing status/service-stream badges rather than
 * duplicating them; it only ever shows computed risk alerts.
 */
export function ParticipantAlertsBanner({ alerts, onSelectTab }: ParticipantAlertsBannerProps) {
  const [expanded, setExpanded] = useState(false)
  if (!alerts || alerts.length === 0) return null

  const visibleAlerts = expanded ? alerts : alerts.slice(0, VISIBLE_ALERT_LIMIT)
  const hiddenCount = alerts.length - visibleAlerts.length

  return (
    <div className="space-y-1.5 mt-3" aria-label="Participant risk alerts">
      {visibleAlerts.map((a) => {
        const style = ALERT_SEVERITY_STYLES[a.severity]
        const Icon = style.icon
        // Critical rows interrupt (assertive `role="alert"`) — they need urgent attention.
        // Warning/Info rows are announced politely (`role="status"`) once the reader is idle,
        // so a participant with several non-critical alerts doesn't get talked over. The role
        // sits on this wrapper, not the <button> itself, so the row keeps its button semantics.
        const role = a.severity === 'Critical' ? 'alert' : 'status'
        return (
          <div key={`${a.type}:${a.message}`} role={role}>
            <button
              type="button"
              onClick={() => onSelectTab?.(a.deepLinkTab)}
              className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg ${style.bg} ${style.text} hover:opacity-90 transition-opacity`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{a.message}</span>
              {/* Full-strength colour, not a faded one — at 10px this is small text, and opacity
                  pushes an already-borderline severity colour below the 4.5:1 AA text threshold. */}
              <span className="text-[10px] font-bold uppercase tracking-wide shrink-0">{style.label}</span>
            </button>
          </div>
        )
      })}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          className="w-full text-left text-xs font-medium text-[var(--color-muted-foreground)] px-3 py-1.5 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
        >
          +{hiddenCount} more alert{hiddenCount === 1 ? '' : 's'}
        </button>
      )}
      {expanded && alerts.length > VISIBLE_ALERT_LIMIT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-expanded={true}
          className="w-full text-left text-xs font-medium text-[var(--color-muted-foreground)] px-3 py-1.5 rounded-lg hover:bg-[var(--color-accent)] transition-colors"
        >
          Show fewer
        </button>
      )}
    </div>
  )
}
