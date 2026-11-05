import { format, parseISO } from 'date-fns'
import { AlertTriangle } from 'lucide-react'
import { useParticipantRoutines } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { plural } from '@/lib/format'
import { usePermissions } from '@/lib/permissions'
import { useProviderToday } from '@/hooks/useProviderToday'
import { SeeSectionLink } from './SeeSectionLink'
import { formatRoutineTime, routinesOn } from './routineFormat'

const MAX_ROWS = 5
const muted = 'text-sm text-[var(--color-muted-foreground)]'

/**
 * Overview's strip of what is on today: the active routines that run on today's weekday, critical first, then by time. The full list,
 * descriptions and editing stay on the Routines card under Daily support. Same query as the tab count, so no extra request.
 */
export function TodayRoutinesCard({ participantId }: { participantId: string }) {
  const { canWriteRoutines } = usePermissions()
  const query = useParticipantRoutines(participantId, true)
  const providerDay = useProviderToday()
  const today = routinesOn(query.data ?? [], format(parseISO(providerDay), 'EEEE'))
  const active = (query.data ?? []).filter(r => r.isActive).length

  let body
  if (query.isLoading) {
    body = <p className={muted} aria-busy="true">–</p>
  } else if (!query.data) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className={muted}>Couldn&rsquo;t load routines</p>
        <Button variant="ghost" size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
      </div>
    )
  } else if (active === 0) {
    body = <p className={muted}>No routines recorded yet.</p>
  } else if (today.length === 0) {
    body = <p className={muted}>None today. {plural(active, 'routine')} on other days.</p>
  } else {
    body = (
      <>
        <ul className="flex flex-col list-none p-0">
          {today.slice(0, MAX_ROWS).map(r => (
            <li key={r.id} className="grid grid-cols-[7.5rem_1fr] gap-x-3 py-1">
              <span className="text-[13px] tabular-nums text-[var(--color-muted-foreground)]">{formatRoutineTime(r.startTime, r.endTime)}</span>
              {/* Icon, title and pill share one inline run, so a long title wraps with the icon on its first line and the pill after its last word. */}
              <span className="text-sm min-w-0 break-words">
                {r.isCritical && <AlertTriangle className="inline w-3.5 h-3.5 mr-1.5 align-[-2px] text-[var(--color-destructive)]" aria-label="Critical" />}
                <span>{r.title}</span>
                {r.isCritical && (
                  <span className="ml-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-error-container)] text-[var(--color-on-error-container)] whitespace-nowrap">Critical</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        {today.length > MAX_ROWS && <p className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">and {today.length - MAX_ROWS} more today</p>}
      </>
    )
  }

  return (
    <section id="today-routines" aria-label="Today’s routines" className="scroll-mt-12">
      <Card title="Today’s routines" action={<SeeSectionLink tab="daily" hash="routines" section="Routines" canEdit={canWriteRoutines} />}>
        {body}
      </Card>
    </section>
  )
}
