import type { ParticipantAlertDto } from '@/api/types'
import { ALERT_SEVERITY_STYLES } from './alertSeverityStyles'

export type ParticipantAlertsBannerProps = {
  /** Already ranked Critical-first by the backend (ParticipantAlertsService) — rendered as-is. */
  alerts: ParticipantAlertDto[]
  /** Called with the alert's deepLinkTab when a row is activated — switch ParticipantDetailPage's tab state. */
  onSelectTab?: (tab: string) => void
}

/**
 * Alert banner strip for the participant detail header (task 6c). Renders nothing when there are
 * no alerts — this sits alongside the existing status/service-stream badges rather than
 * duplicating them; it only ever shows computed risk alerts.
 */
export function ParticipantAlertsBanner({ alerts, onSelectTab }: ParticipantAlertsBannerProps) {
  if (!alerts || alerts.length === 0) return null

  return (
    <div className="space-y-1.5 mt-3" role="alert" aria-label="Participant risk alerts">
      {alerts.map((a) => {
        const style = ALERT_SEVERITY_STYLES[a.severity]
        const Icon = style.icon
        return (
          <button
            key={`${a.type}:${a.message}`}
            type="button"
            onClick={() => onSelectTab?.(a.deepLinkTab)}
            className={`w-full flex items-center gap-2 text-left text-sm px-3 py-2 rounded-lg ${style.bg} ${style.text} hover:opacity-90 transition-opacity`}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{a.message}</span>
            <span className="text-[10px] font-bold uppercase tracking-wide opacity-70 shrink-0">{style.label}</span>
          </button>
        )
      })}
    </div>
  )
}
