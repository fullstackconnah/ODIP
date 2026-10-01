import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useStaffOverview, useSettings } from '@/api/hooks'
import { Tabs } from '@/components/Tabs'
import { Card } from '@/components/Card'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/Button'
import { BackButton } from '@/components/BackButton'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { staffCredentials, type StaffCredential } from '@/lib/credentials'
import { DEADLINE_TONE, deadlineLabel } from '@/lib/deadline'
import { formatShiftTimeRange, formatVarianceMinutes } from '@/pages/rostering/lib/roster'
import AvailabilityList from '@/pages/schedule/AvailabilityList'
import {
  Pencil, CalendarOff, CalendarClock, ShieldCheck, ClipboardList, AlertTriangle, ClipboardCheck,
} from 'lucide-react'
import type { StaffOverviewUpcomingShiftDto, StaffOverviewTripAssignmentDto } from '@/api/types/staff'
import type { IncidentListDto } from '@/api/types/incidents'
import type { CompletionQueueItemDto } from '@/api/types/rostering'

type Tab = 'availability' | 'credentials' | 'upcoming' | 'incidents' | 'completions'

const TAB_KEYS: Tab[] = ['availability', 'credentials', 'upcoming', 'incidents', 'completions']

/** A table-cell link is the row's tap target: no height change on a mouse (--tap-min is 0 there), a
 * 44px floor under a coarse pointer (fits the 48px coarse row). */
const ROW_LINK = 'inline-flex min-h-[var(--tap-min)] items-center font-medium hover:text-[var(--color-primary)]'

// Which credentials apply and what state each is in is lib/credentials.ts (one rule for this tab, the Qualifications list and the Dashboard
// count); the day threshold is the same settings.qualificationWarningDays.
function credentialBadge(row: StaffCredential) {
  return <StatusBadge tone={DEADLINE_TONE[row.state.status]} label={deadlineLabel(row.state, 'long')} />
}

export default function StaffDetailPage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { canWrite, canAccessPage } = usePermissions()
  const canAccessLeaveApprovals = canAccessPage('leave-approvals')

  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    initialTab && (TAB_KEYS as string[]).includes(initialTab) ? (initialTab as Tab) : 'availability'
  )

  const { data: overview, isLoading } = useStaffOverview(id)
  const { data: settings } = useSettings()
  const warningDays = settings?.qualificationWarningDays ?? 30

  const credentialRows = useMemo(
    () => (overview ? staffCredentials(overview.staff, { warnDays: warningDays }) : []),
    [overview, warningDays]
  )

  if (isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!overview) return <div className="text-center py-12">Staff member not found</div>

  const { staff } = overview
  // Join only the parts that exist: an empty position used to leave the row starting with a
  // stray " · " separator.
  const positionAndRegion = [staff.position, staff.region || 'No region'].filter(Boolean).join(' · ')

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader
        title={staff.fullName}
        subtitle={
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={staff.isActive ? 'Active' : 'Inactive'} />
            <span>{positionAndRegion}</span>
          </div>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <BackButton to="/staff" label="staff" history={false} />
            {canAccessLeaveApprovals && (
              <Button to={`/rostering/leave?userId=${id}`} variant="secondary" size="md">
                <CalendarOff className="w-4 h-4" /> Leave & availability
              </Button>
            )}
            {canWrite && (
              <Button to={`/staff/${id}/edit`} variant="primary" size="md">
                <Pencil className="w-4 h-4" /> Edit
              </Button>
            )}
          </div>
        }
      />

      <Tabs
        tabs={[
          { id: 'availability', label: 'Availability', icon: CalendarClock },
          { id: 'credentials', label: 'Credentials', icon: ShieldCheck },
          { id: 'upcoming', label: 'Upcoming', icon: ClipboardList },
          { id: 'incidents', label: 'Incidents', icon: AlertTriangle },
          { id: 'completions', label: 'Completions', icon: ClipboardCheck },
        ]}
        active={tab}
        onChange={(key) => setTab(key as Tab)}
        ariaLabel="Staff detail sections"
      />

      {tab === 'availability' && (
        <Card>
          {/* AvailabilityList's root carries `pl-8 py-2` — an indent for the Schedule page's
              accordion rows. Inside this Card it read as a blank ~30px icon slot left of the
              "Availability" label (no icon was ever meant to fill it), so flush it to the Card's
              own padding from out here. */}
          <div className="[&>div]:p-0">
            <AvailabilityList staffId={id!} availability={overview.availability} />
          </div>
        </Card>
      )}

      {tab === 'credentials' && (
        <Card>
          {credentialRows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No credentials on file" description="This staff member has no qualification flags or expiry dates set." />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {credentialRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    {row.expiryDate && (
                      <p className="text-xs tabular-nums text-[var(--color-muted-foreground)]">Expires {formatDateAu(row.expiryDate)}</p>
                    )}
                  </div>
                  {credentialBadge(row)}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'upcoming' && (
        <div className="flex flex-col gap-[var(--section-gap)]">
          <Card title="Upcoming shifts">
            <DataTable
              data={overview.upcomingShifts}
              keyField="shiftId"
              emptyMessage="No shifts in the next 14 days"
              columns={[
                { key: 'serviceDate', header: 'Date', type: 'date' },
                {
                  key: 'startTime',
                  header: 'Time',
                  render: (s: StaffOverviewUpcomingShiftDto) => (
                    <span title={s.endsNextDay ? `${formatShiftTimeRange(s.startTime, s.endTime)} — ends the next day` : undefined}>
                      {formatShiftTimeRange(s.startTime, s.endTime)}
                    </span>
                  ),
                },
                {
                  key: 'participantName',
                  header: 'Participant',
                  render: (s: StaffOverviewUpcomingShiftDto) => (
                    <Link to={`/participants/${s.participantId}`} className={ROW_LINK}>
                      {s.participantName}
                    </Link>
                  ),
                },
                { key: 'status', header: 'Status', type: 'badge' },
              ]}
            />
          </Card>
          <Card title="Upcoming trip assignments">
            <DataTable
              data={overview.upcomingTripAssignments}
              keyField="assignmentId"
              emptyMessage="No upcoming trip assignments"
              columns={[
                {
                  key: 'tripName',
                  header: 'Trip',
                  render: (a: StaffOverviewTripAssignmentDto) => (
                    <Link to={`/trips/${a.tripInstanceId}`} className={ROW_LINK}>
                      {a.tripName}
                    </Link>
                  ),
                },
                { key: 'startDate', header: 'Start', type: 'date' },
                { key: 'endDate', header: 'End', type: 'date' },
              ]}
            />
          </Card>
        </div>
      )}

      {tab === 'incidents' && (
        <Card>
          {overview.recentIncidents.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="No recent incidents" description="No incidents involve this staff member yet." />
          ) : (
            <DataTable
              data={overview.recentIncidents}
              keyField="id"
              columns={[
                {
                  key: 'title',
                  header: 'Title',
                  render: (i: IncidentListDto) => (
                    <Link to={`/incidents/${i.id}`} className={ROW_LINK}>
                      {i.title}
                    </Link>
                  ),
                },
                { key: 'incidentDateTime', header: 'Date', type: 'date' },
                { key: 'severity', header: 'Severity', type: 'badge' },
                { key: 'status', header: 'Status', type: 'badge' },
              ]}
            />
          )}
        </Card>
      )}

      {tab === 'completions' && (
        <Card
          title="Recent completions"
          action={
            <Link to="/rostering/completions" className="inline-flex min-h-[var(--tap-min)] items-center text-xs text-[var(--color-primary)] hover:underline">
              Open completions review →
            </Link>
          }
        >
          {overview.recentCompletions.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No recent completions" description="This staff member hasn't submitted a shift completion yet." />
          ) : (
            <DataTable
              data={overview.recentCompletions}
              keyField="completionId"
              columns={[
                { key: 'participantName', header: 'Participant' },
                { key: 'serviceDate', header: 'Date', type: 'date' },
                {
                  key: 'varianceMinutesStart',
                  header: 'Variance',
                  render: (c: CompletionQueueItemDto) => (
                    <span className={c.isOutlierVariance ? 'text-[var(--color-destructive)] font-medium' : undefined}>
                      {formatVarianceMinutes(c.varianceMinutesStart)}
                    </span>
                  ),
                },
                { key: 'status', header: 'Status', type: 'badge' },
              ]}
            />
          )}
        </Card>
      )}
    </div>
  )
}
