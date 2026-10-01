import { Link } from 'react-router-dom'
import { CalendarRange, ArrowUpRight } from 'lucide-react'
import { useParticipantRostering } from '@/api/hooks'
import { Card } from '@/components/Card'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { formatShiftTimeRange } from '@/pages/rostering/lib/roster'
import type { ParticipantRosteringShiftDto, ParticipantRosteringStaffDto } from '@/api/types/participants'
import { plural } from '@/lib/format'

/** Maps CompatibilityLevel onto StatusBadge's existing colour vocabulary rather than adding a new
 * one — Preferred reads as a positive ("active" green), Excluded as a negative ("expired" red),
 * Allowed as the neutral default. */
const COMPATIBILITY_BADGE_STATUS: Record<string, string> = {
  Preferred: 'active',
  Allowed: 'draft',
  Excluded: 'expired',
}

/**
 * Connection map item 12 — the participant hub's Rostering tab: who's rostered on for this
 * participant and what's coming up, without sending the coordinator all the way to the full
 * roster board. Read-only — "Open roster" is the escalation path for anything that needs editing.
 */
export default function RosteringTab({ participantId }: { participantId: string }) {
  const { data, isLoading } = useParticipantRostering(participantId)

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--color-muted-foreground)]">Loading...</div>
  }

  const assignedStaff = data?.assignedStaff ?? []
  const upcomingShifts = data?.upcomingShifts ?? []

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Link to="/rostering" className="flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline">
          Open roster <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <Card title="Assigned staff">
        {assignedStaff.length === 0 ? (
          <EmptyState
            icon={CalendarRange}
            title="No staff assigned"
            description="No staff member has a rostered shift for this participant yet."
          />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {assignedStaff.map((s: ParticipantRosteringStaffDto) => (
              <div key={s.staffId} className="p-3 rounded-lg border border-[var(--color-border)] flex items-center justify-between gap-2">
                <div>
                  <Link to={`/staff/${s.staffId}`} className="font-medium hover:text-[var(--color-primary)]">
                    {s.staffName}
                  </Link>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    {plural(s.shiftCount, 'shift')}
                  </p>
                </div>
                <StatusBadge status={COMPATIBILITY_BADGE_STATUS[s.compatibility] ?? 'draft'} label={s.compatibility} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Upcoming shifts">
        <DataTable
          data={upcomingShifts}
          keyField="shiftId"
          emptyMessage="No shifts in the next 28 days"
          columns={[
            { key: 'serviceDate', header: 'Date', type: 'date' },
            {
              key: 'startTime',
              header: 'Time',
              render: (s: ParticipantRosteringShiftDto) => (
                <span title={s.endsNextDay ? `${formatShiftTimeRange(s.startTime, s.endTime)} — ends the next day` : undefined}>
                  {formatShiftTimeRange(s.startTime, s.endTime)}
                </span>
              ),
            },
            {
              key: 'staffName',
              header: 'Staff',
              render: (s: ParticipantRosteringShiftDto) =>
                s.staffId && s.staffName ? (
                  <div>
                    <Link to={`/staff/${s.staffId}`} className="font-medium hover:text-[var(--color-primary)]">
                      {s.staffName}
                    </Link>
                    {/* See ShiftChip's own "On leave" mini-label — a filled shift whose assignee's
                        leave was approved after the fact is actually a hole, not a normal covered
                        shift. */}
                    {s.assigneeOnApprovedLeave && (
                      <p className="text-[13px] leading-tight font-semibold text-[var(--color-destructive)]">On leave</p>
                    )}
                  </div>
                ) : (
                  <span className="text-[var(--color-muted-foreground)] italic">Unassigned</span>
                ),
            },
            { key: 'status', header: 'Status', type: 'badge' },
          ]}
        />
      </Card>
    </div>
  )
}
