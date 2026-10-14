import type { IntakeVisitDto } from '@/api/types/inquiries'
import { StatusBadge } from '@/components/StatusBadge'
import { isPastVisit, visitStage, visitTimes } from '@/lib/intakeBooking'
import { StartIntakeButton } from '@/pages/inquiries/StartIntakeButton'

/**
 * An intake visit on My shifts (SHAPE.md section 3): a static card beside the shift cards, on their own surface. It is never the current-shift
 * card and never a link. The "Intake visit" pill, the button and the location keep it from being read as a shift.
 */
export function IntakeVisitCard({ visit }: { visit: IntakeVisitDto }) {
  const stage = visitStage(visit)
  const reply = stage === 'complete'
    ? <StatusBadge tone="success" label="Intake complete" />
    : isPastVisit(visit.startsAt, visit.durationMinutes) ? null
    : visit.confirmedAt ? <StatusBadge tone="success" label="Confirmed" /> : <StatusBadge tone="warning" label="Not confirmed" />
  return (
    <div className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge tone="info" label="Intake visit" />
        {reply}
      </div>
      <p className="mt-2 font-medium text-[var(--color-foreground)] truncate">{visit.firstName} {visit.lastName}</p>
      <p className="text-sm text-[var(--color-muted-foreground)] truncate" title={visit.location}>
        {`${visitTimes(visit.startsAt, visit.durationMinutes, visit.timeZoneId)} · ${visit.location}`}
      </p>
      <div className="mt-3">
        <StartIntakeButton visit={visit} />
      </div>
    </div>
  )
}
