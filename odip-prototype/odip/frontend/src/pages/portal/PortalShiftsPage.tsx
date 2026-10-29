import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarCheck2, Car, Moon, ShieldCheck, CalendarOff, WifiOff } from 'lucide-react'
import { useIntakeVisits, useMyShifts, usePendingWitnessRequests } from '@/api/hooks'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { weekStartOf, shiftWeek, daysOfWeek, formatWeekRange, formatDayAccessibleName, formatShiftTimeRange, formatEffectiveRange } from '@/pages/rostering/lib/roster'
import { addDays, format, parseISO, subDays } from 'date-fns'
import { RATIO_LABELS, hasEnded, pickCurrentShift, portalStatusLabel } from './lib/portal'
import { useNow } from './shift/useNow'
import { utcInstantToProviderLocal } from './shift/shiftTime'
import { useOnline } from './shift/useOnline'
import { SyncBar } from './sync/SyncBar'
import { savedAtFor } from '@/api/hooks/portal'
import { clockTime } from '@/lib/offline/reasons'
import { CurrentShiftCard } from './components/CurrentShiftCard'
import type { IntakeVisitDto, PortalShiftSummaryDto } from '@/api/types'
import { usePermissions } from '@/lib/permissions'
import { isPastVisit, visitsByDay, withVisits } from '@/lib/intakeBooking'
import { IntakeVisitCard } from './IntakeVisitCard'

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

const CARD = 'block bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4'

function ShiftLink({ shift }: { shift: PortalShiftSummaryDto }) {
  const online = useOnline()
  // With no signal only a shift whose detail is saved on this phone can open; the rest say why (SHAPE 3b).
  const openable = online || savedAtFor(`detail:${shift.id}`) !== null
  const inner = (
    <>
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
      {!openable && <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">Needs a connection to open</p>}
    </>
  )
  return openable
    ? <Link to={`/portal/shifts/${shift.id}`} className={`${CARD} hover:border-[var(--color-primary)]/40 transition-colors`}>{inner}</Link>
    : <div className={CARD}>{inner}</div>
}

/** A titled run of day groups (Coming up, Earlier) holding shifts and intake visits; not drawn when empty. The day headings sit under it as h3. */
function ShiftSection({ id, title, today, shifts, visits, newestFirst }: { id: string; title: string; today: string; shifts: PortalShiftSummaryDto[]; visits: IntakeVisitDto[]; newestFirst?: boolean }) {
  if (shifts.length === 0 && visits.length === 0) return null
  const byDay = groupByDay(shifts)
  const visitDays = visitsByDay(visits)
  const days = [...new Set([...byDay.keys(), ...visitDays.keys()])].sort()
  if (newestFirst) days.reverse()
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold">{title}</h2>
      {days.map(day => (
        <div key={day}>
          <h3 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">
            {formatDayAccessibleName(day)}
            {day === today && <span className="ml-2 text-xs font-medium text-[var(--color-primary)]">Today</span>}
          </h3>
          <div className="space-y-2">
            {withVisits(byDay.get(day) ?? [], visitDays.get(day) ?? []).map(entry => entry.kind === 'visit'
              ? <IntakeVisitCard key={`visit-${entry.visit.inquiryId}`} visit={entry.visit} />
              : <ShiftLink key={entry.shift.id} shift={entry.shift} />)}
          </div>
        </div>
      ))}
    </section>
  )
}

export default function PortalShiftsPage() {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const weekEnd = useMemo(() => daysOfWeek(weekStart)[6], [weekStart])

  const [now] = useNow(60_000)
  // One request feeds both the list and the current-shift card: a week that touches yesterday..tomorrow also reaches them (a Sunday overnight still
  // running on Monday morning; tomorrow so a phone clock a day behind the provider's still finds a shift in progress, plan check S2).
  const yesterday = format(subDays(now, 1), 'yyyy-MM-dd')
  const tomorrow = format(addDays(now, 1), 'yyyy-MM-dd')
  const touchesNow = weekStart <= tomorrow && weekEnd >= yesterday
  const from = touchesNow && yesterday < weekStart ? yesterday : weekStart
  const to = touchesNow && tomorrow > weekEnd ? tomorrow : weekEnd
  const { data, isLoading, isError, refetch } = useMyShifts(from, to)
  const inWeek = (day: string) => day >= weekStart && day <= weekEnd
  const shifts = useMemo(() => (data?.shifts ?? []).filter(s => inWeek(s.serviceDate.slice(0, 10))), [data, weekStart, weekEnd])   // eslint-disable-line react-hooks/exhaustive-deps
  const tripAssignments = (data?.tripAssignments ?? []).filter(a => a.assignmentStart.slice(0, 10) <= weekEnd && a.assignmentEnd.slice(0, 10) >= weekStart)
  // Intake visits you are going to, in the browsed week: their own query beside the shifts (a non-shift entry, not billable work).
  const { id: myId } = usePermissions()
  const visitsQuery = useIntakeVisits({ from: weekStart, to: weekEnd, staffUserId: myId ?? undefined }, !!myId)
  const visits = useMemo(() => visitsQuery.data ?? [], [visitsQuery.data])
  const { data: witnessRequests } = usePendingWitnessRequests()
  const pendingWitnessCount = witnessRequests?.length ?? 0
  const online = useOnline()
  const tz = data?.timeZoneId   // undefined reads the device zone; '' would throw a RangeError
  // Today and this week are the provider's, not the phone's (the shifts' dates are wall clock there).
  const today = utcInstantToProviderLocal(now.toISOString(), tz || undefined).slice(0, 10)
  const thisWeek = weekStartOf(parseISO(today))
  const weekSavedAt = online ? null : savedAtFor(`shifts:${from}:${to}`)
  const isThisWeek = weekStart === thisWeek
  const current = isThisWeek && data ? pickCurrentShift(data.shifts, now, data.timeZoneId) : null
  const rest = shifts.filter(s => s.id !== current?.id)
  const comingUp = rest.filter(s => !hasEnded(s, now, tz))
  const earlier = rest.filter(s => hasEnded(s, now, tz))
    .sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || a.startTime.localeCompare(b.startTime))   // newest day first, each day in time order
  const visitsEarlier = visits.filter(v => isPastVisit(v.startsAt, v.durationMinutes, now))
  const visitsComingUp = visits.filter(v => !isPastVisit(v.startsAt, v.durationMinutes, now))

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
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] text-xs font-medium"
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
          <Button variant="secondary" size="md" onClick={() => setWeekStart(thisWeek)} className="ml-1">
            This week
          </Button>
        </div>
      </PageHeader>

      {current && <CurrentShiftCard shift={current} />}

      {!online && weekSavedAt !== null && (
        <Callout tone="info" icon={WifiOff} polite title="You're offline">
          These are your shifts as saved at {clockTime(new Date(weekSavedAt).toISOString())}. Only today&rsquo;s shifts can be opened until you&rsquo;re back online.
        </Callout>
      )}
      {isLoading || visitsQuery.isLoading ? (
        <ShiftsSkeleton withCurrent={isThisWeek && !current} />
      ) : isError && !online && !data ? (
        <EmptyState icon={WifiOff} title="This week isn't saved on this phone." action={{ label: 'Back to this week', onClick: () => setWeekStart(thisWeek) }} />
      ) : isError ? (
        <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>}>
          Couldn't load your shifts. Check your connection and try again.
        </Callout>
      ) : shifts.length === 0 && tripAssignments.length === 0 && visits.length === 0 && !current && !visitsQuery.isError ? (
        <EmptyState
          icon={CalendarCheck2}
          title="Nothing rostered this week"
          description="You have no shifts or trip assignments in this date range."
        />
      ) : (
        <div className="space-y-6">
          {visitsQuery.isError && (
            <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => visitsQuery.refetch()}>Try again</Button>}>
              Couldn't load your intake visits.
            </Callout>
          )}
          <ShiftSection id="coming-up" title="Coming up" today={today} shifts={comingUp} visits={visitsComingUp} />
          <ShiftSection id="earlier" title="Earlier" today={today} shifts={earlier} visits={visitsEarlier} newestFirst />

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
      <SyncBar />
    </div>
  )
}
