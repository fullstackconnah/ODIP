import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarCheck2, Car, Moon, ShieldCheck, CalendarOff } from 'lucide-react'
import { useMyShifts, usePendingWitnessRequests } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { weekStartOf, shiftWeek, daysOfWeek, formatWeekRange, formatDayAccessibleName, isToday, formatShiftTimeRange, formatEffectiveRange } from '@/pages/rostering/lib/roster'
import { addDays, format, subDays } from 'date-fns'
import { RATIO_LABELS, hasEnded, pickCurrentShift, portalStatusLabel } from './lib/portal'
import { useNow } from './shift/useNow'
import { CurrentShiftCard } from './components/CurrentShiftCard'
import type { PortalShiftSummaryDto } from '@/api/types'

/** Groups a flat, already-date-ordered shift list into per-day buckets, preserving day order. */
function groupByDay(shifts: PortalShiftSummaryDto[]): Map<string, PortalShiftSummaryDto[]> {
  const byDay = new Map<string, PortalShiftSummaryDto[]>()
  for (const shift of shifts) {
    const bucket = byDay.get(shift.serviceDate)
    if (bucket) bucket.push(shift)
    else byDay.set(shift.serviceDate, [shift])
  }
  return byDay
}

/**
 * Skeleton for the loading state — mirrors the real day-group/shift-card chrome so there's
 * no layout jump once data arrives. The "Loading" announcement lives outside the aria-hidden
 * decorative wrapper so screen readers still hear it (nesting it inside an aria-hidden
 * ancestor, as some other loading states in this app do, would silence it).
 */
function ShiftsSkeleton({ withCurrent }: { withCurrent: boolean }) {
  return (
    <div className="space-y-6">
      <span className="sr-only" role="status" aria-live="polite">Loading your shifts…</span>
      <div aria-hidden="true" className="space-y-6">
        {withCurrent && <div className="h-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />}
        {[0, 1].map(group => (
          <div key={group}>
            <div className="h-4 w-40 rounded bg-[var(--color-accent)] animate-pulse mb-2" />
            <div className="space-y-2">
              {[0, 1].map(row => (
                <div key={row} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-32 rounded bg-[var(--color-accent)] animate-pulse" />
                      <div className="h-3 w-24 rounded bg-[var(--color-accent)] animate-pulse" />
                    </div>
                    <div className="h-5 w-14 rounded-full bg-[var(--color-accent)] animate-pulse shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ShiftLink({ shift }: { shift: PortalShiftSummaryDto }) {
  return (
    <Link
      to={`/portal/shifts/${shift.id}`}
      className="block bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 hover:border-[var(--color-primary)]/40 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-[var(--color-foreground)] truncate">{shift.participantName}</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {formatShiftTimeRange(shift.startTime, shift.endTime)}
            {shift.endsNextDay && <span className="ml-1">(+1 day)</span>}
            {shift.ratio !== 'OneToOne' && <span className="ml-2">{RATIO_LABELS[shift.ratio] ?? shift.ratio}</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {/* A plain Rostered shift is the default state and says nothing, so it has no badge (SHAPE §2). */}
          {(shift.status !== 'Published' || shift.returnCount > 0) && <StatusBadge status={shift.status} label={portalStatusLabel(shift)} />}
          {shift.nightType !== 'None' && (
            <span className="inline-flex items-center gap-1 text-[13px] text-[var(--color-muted-foreground)]">
              <Moon className="w-3 h-3" /> {shift.nightType}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}

/** A titled run of day groups (Coming up, Earlier); not drawn when empty. The day headings sit under it as h3. */
function ShiftSection({ id, title, shifts }: { id: string; title: string; shifts: PortalShiftSummaryDto[] }) {
  if (shifts.length === 0) return null
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {Array.from(groupByDay(shifts).entries()).map(([day, dayShifts]) => (
        <div key={day}>
          <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">
            {formatDayAccessibleName(day)}
            {isToday(day) && <span className="ml-2 text-xs font-medium text-[var(--color-primary)]">Today</span>}
          </h3>
          <div className="space-y-2">{dayShifts.map(s => <ShiftLink key={s.id} shift={s} />)}</div>
        </div>
      ))}
    </section>
  )
}

export default function PortalShiftsPage() {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const weekEnd = useMemo(() => daysOfWeek(weekStart)[6], [weekStart])

  const { data, isLoading, isError, refetch } = useMyShifts(weekStart, weekEnd)
  const shifts = useMemo(() => data?.shifts ?? [], [data])
  const tripAssignments = data?.tripAssignments ?? []
  const { data: witnessRequests } = usePendingWitnessRequests()
  const pendingWitnessCount = witnessRequests?.length ?? 0
  const [now] = useNow(60_000)
  const isThisWeek = weekStart === weekStartOf(now)
  // The card's own query, independent of the browsed week: it catches a Sunday overnight still running on Monday morning (SHAPE §2),
  // and runs to tomorrow so a browser clock a day behind the provider's still finds a shift in progress (plan check S2).
  const { data: recent } = useMyShifts(format(subDays(now, 1), 'yyyy-MM-dd'), format(addDays(now, 1), 'yyyy-MM-dd'))
  const current = isThisWeek ? pickCurrentShift(recent?.shifts ?? [], now) : null
  const rest = shifts.filter(s => s.id !== current?.id)
  const comingUp = rest.filter(s => !hasEnded(s, now))
  const earlier = rest.filter(s => hasEnded(s, now))
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || a.startTime.localeCompare(b.startTime))   // newest day first, each day in time order

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="My shifts"
        action={
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button to="/portal/leave" variant="secondary" size="md">
              <CalendarOff className="w-4 h-4" /> My leave
            </Button>
            <Button to="/portal/witness-approvals" variant="secondary" size="md">
              <ShieldCheck className="w-4 h-4" /> Witness approvals
              {pendingWitnessCount > 0 && (
                <span
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-destructive)] text-white text-xs font-medium"
                  aria-label={`${pendingWitnessCount} pending`}
                >
                  {pendingWitnessCount > 99 ? '99+' : pendingWitnessCount}
                </span>
              )}
            </Button>
          </div>
        }
      >
        {/* One row that never wraps (a phone split it over two): the same square chevrons as the roster board's week toolbar. */}
        <div role="group" aria-label="Week" className="flex flex-nowrap items-center gap-1">
          <Button variant="secondary" size="md" onClick={() => setWeekStart(w => shiftWeek(w, -1))} aria-label="Previous week" className="w-[var(--control-h)] px-0!">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="px-1 text-sm font-medium tabular-nums whitespace-nowrap">{formatWeekRange(daysOfWeek(weekStart))}</span>
          <Button variant="secondary" size="md" onClick={() => setWeekStart(w => shiftWeek(w, 1))} aria-label="Next week" className="w-[var(--control-h)] px-0!">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="secondary" size="md" onClick={() => setWeekStart(weekStartOf(new Date()))} className="ml-1">
            This week
          </Button>
        </div>
      </PageHeader>

      {current && <CurrentShiftCard shift={current} />}

      {isLoading ? (
        <ShiftsSkeleton withCurrent={isThisWeek && !current} />
      ) : isError ? (
        <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>}>
          Couldn't load your shifts. Check your connection and try again.
        </Callout>
      ) : shifts.length === 0 && tripAssignments.length === 0 && !current ? (
        <EmptyState
          icon={CalendarCheck2}
          title="Nothing rostered this week"
          description="You have no shifts or trip assignments in this date range."
        />
      ) : (
        <div className="space-y-6">
          <ShiftSection id="coming-up" title="Coming up" shifts={comingUp} />
          <ShiftSection id="earlier" title="Earlier" shifts={earlier} />

          {tripAssignments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">Trip assignments</h2>
              <div className="space-y-2">
                {tripAssignments.map(a => (
                  <div key={a.id} className="bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--color-foreground)] truncate">{a.tripName}</p>
                        <p className="text-sm text-[var(--color-muted-foreground)]">
                          {formatEffectiveRange(a.assignmentStart, a.assignmentEnd)}
                          {a.isDriver && <span className="ml-2 inline-flex items-center gap-1"><Car className="w-3 h-3" /> Driver</span>}
                        </p>
                      </div>
                      <StatusBadge status={a.status} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
