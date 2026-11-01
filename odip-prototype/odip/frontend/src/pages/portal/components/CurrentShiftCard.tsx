import { usePortalShiftDetail } from '@/api/hooks'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/Button'
import { formatWithTimeZone, parseApiDate } from '@/lib/utils'
import { formatDayAccessibleName, formatElapsedSince, formatMinutesSpan, formatShiftTimeRange } from '@/pages/rostering/lib/roster'
import { loadEndDraft } from '../shift/endDraft'
import { providerLocalToUtcInstant } from '../shift/shiftTime'
import { plural } from '@/lib/format'
import { Chip } from '../shift/ui'
import { useNow } from '../shift/useNow'
import type { PortalShiftSummaryDto } from '@/api/types'

/**
 * The list's current shift (SHAPE §2): set apart by position and space, not colour. Its state line and chips come from the shift's own detail,
 * which this also warms for the tap; until that loads the card shows the summary only, so nothing jumps. One action, and Start never happens here:
 * the worker passes the handover and the must-know line on the way to Start.
 */
export function CurrentShiftCard({ shift }: { shift: PortalShiftSummaryDto }) {
  const { data: detail } = usePortalShiftDetail(shift.id)
  const [now] = useNow(30_000)
  const inProgress = shift.status === 'InProgress'
  const finishing = inProgress && loadEndDraft(shift.id)?.step != null
  const tz = detail?.timeZoneId
  const clock = (iso: string) => formatWithTimeZone(iso, tz, { hour: 'numeric', minute: '2-digit' })
  const running = detail?.breaks.find(b => b.isRunning)
  const overdue = detail ? detail.medicationsDue.filter(d => d.state === 'Overdue' && !d.outcome).length : 0
  const h = detail?.handover
  const handoverToRead = h ? h.requiresAcknowledgement && !h.isRead : false

  const when = inProgress ? 'On shift now' : 'Today'
  let state: string | null = null
  if (detail && tz) {
    if (running) state = `On a break since ${clock(running.startedAt)}`
    else if (inProgress && detail.completion) {
      state = `Started ${clock(detail.completion.actualStart)} · ${formatElapsedSince(detail.completion.actualStart, now)} on shift`
    } else if (!inProgress) {
      const start = providerLocalToUtcInstant(`${shift.serviceDate}T${shift.startTime.slice(0, 5)}`, tz)
      const until = start ? Math.ceil((parseApiDate(start).getTime() - now.getTime()) / 60_000) : 0
      if (start) state = `Starts ${clock(start)}${until > 0 ? ` · in ${formatMinutesSpan(until)}` : ''}`
    }
  }

  return (
    <section aria-labelledby="current-shift-title" className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-[var(--card-pad)] space-y-2">
      {/* No eyebrow over the name (the craft floor; a deviation from SHAPE §2): "On shift now" or "Today" leads the state line. */}
      <h2 id="current-shift-title" className="text-xl font-bold">{shift.participantName}</h2>
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {formatDayAccessibleName(shift.serviceDate)} · {formatShiftTimeRange(shift.startTime, shift.endTime)}{shift.endsNextDay && ' (+1 day)'}
      </p>
      {shift.location?.trim() && (
        <p className="text-sm text-[var(--color-muted-foreground)] flex items-center gap-1 min-w-0">
          <MapPin className="w-3 h-3 shrink-0" aria-hidden />
          <span className="truncate" title={shift.location.trim()}><span className="sr-only">Location: </span>{shift.location.trim()}</span>
        </p>
      )}
      <p className="text-sm">{state ? `${when} · ${state}` : when}</p>
      {(overdue > 0 || handoverToRead) && (
        <div className="flex flex-wrap gap-2">
          {overdue > 0 && <Chip tone="warning">{plural(overdue, 'dose')} overdue</Chip>}
          {handoverToRead && <Chip>Handover to read</Chip>}
        </div>
      )}
      <Button to={`/portal/shifts/${shift.id}`} size="lg" className="w-full">
        {finishing ? 'Continue finishing' : inProgress ? 'Continue shift' : 'Open shift'}
      </Button>
    </section>
  )
}
