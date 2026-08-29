import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CalendarCheck2, Car, Moon, ShieldCheck } from 'lucide-react'
import { useMyShifts, usePendingWitnessRequests } from '@/api/hooks'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { weekStartOf, shiftWeek, daysOfWeek, formatWeekRange, formatDayAccessibleName, isToday, formatShiftTimeRange } from '@/pages/rostering/lib/roster'
import { RATIO_LABELS } from './lib/portal'
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

export default function PortalShiftsPage() {
  const [weekStart, setWeekStart] = useState(() => weekStartOf(new Date()))
  const weekEnd = useMemo(() => daysOfWeek(weekStart)[6], [weekStart])

  const { data, isLoading } = useMyShifts(weekStart, weekEnd)
  const isLinked = data?.isLinked ?? true // don't flash the "not linked" empty state before the first response lands
  const shifts = useMemo(() => data?.shifts ?? [], [data])
  const tripAssignments = data?.tripAssignments ?? []
  const byDay = useMemo(() => groupByDay(shifts), [shifts])
  const { data: witnessRequests } = usePendingWitnessRequests()
  const pendingWitnessCount = witnessRequests?.length ?? 0

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="My Shifts" subtitle="Your rostered shifts and what your participants need">
        <div className="flex items-center gap-2">
          <Link
            to="/portal/witness-approvals"
            className="relative inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] text-sm transition-colors"
          >
            <ShieldCheck className="w-4 h-4" />
            Witness approvals
            {pendingWitnessCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-[var(--color-destructive)] text-white text-xs font-medium">
                {pendingWitnessCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setWeekStart(w => shiftWeek(w, -1))}
            className="p-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-medium min-w-[10rem] text-center">{formatWeekRange(daysOfWeek(weekStart))}</span>
          <button
            type="button"
            onClick={() => setWeekStart(w => shiftWeek(w, 1))}
            className="p-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
            aria-label="Next week"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(weekStartOf(new Date()))}
            className="px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] text-sm transition-colors"
          >
            This week
          </button>
        </div>
      </PageHeader>

      {!isLoading && !isLinked ? (
        <EmptyState
          icon={CalendarCheck2}
          title="Your account isn't linked to a staff record"
          description="My Shifts shows the roster for a linked staff member. Ask an admin to link your account to your staff record in Settings › Users."
        />
      ) : !isLoading && shifts.length === 0 && tripAssignments.length === 0 ? (
        <EmptyState
          icon={CalendarCheck2}
          title="Nothing rostered this week"
          description="You have no shifts or trip assignments in this date range."
        />
      ) : (
        <div className="space-y-6">
          {Array.from(byDay.entries()).map(([day, dayShifts]) => (
            <section key={day}>
              <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">
                {formatDayAccessibleName(day)}
                {isToday(day) && <span className="ml-2 text-xs font-medium text-[var(--color-primary)]">Today</span>}
              </h2>
              <div className="space-y-2">
                {dayShifts.map(shift => (
                  <Link
                    key={shift.id}
                    to={`/portal/shifts/${shift.id}`}
                    className="block bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-4 hover:border-[var(--color-primary)]/40 transition-colors"
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
                        <StatusBadge status={shift.status} />
                        {shift.nightType !== 'None' && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[var(--color-muted-foreground)]">
                            <Moon className="w-3 h-3" /> {shift.nightType}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))}

          {tripAssignments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)] mb-2">Trip assignments</h2>
              <div className="space-y-2">
                {tripAssignments.map(a => (
                  <div key={a.id} className="bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--color-foreground)] truncate">{a.tripName}</p>
                        <p className="text-sm text-[var(--color-muted-foreground)]">
                          {a.assignmentStart} – {a.assignmentEnd}
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
