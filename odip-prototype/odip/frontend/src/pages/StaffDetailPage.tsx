import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useStaffOverview, useSettings } from '@/api/hooks'
import { TabNav } from '@/components/TabNav'
import { Card } from '@/components/Card'
import { DataTable } from '@/components/DataTable'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { formatShiftTimeRange, formatVarianceMinutes } from '@/pages/rostering/lib/roster'
import AvailabilityList from '@/pages/schedule/AvailabilityList'
import {
  ArrowLeft, Pencil, CalendarOff, CalendarClock, ShieldCheck, ClipboardList, AlertTriangle, ClipboardCheck,
} from 'lucide-react'
import type { StaffOverviewUpcomingShiftDto, StaffOverviewTripAssignmentDto } from '@/api/types/staff'
import type { IncidentListDto } from '@/api/types/incidents'
import type { CompletionQueueItemDto } from '@/api/types/rostering'

type Tab = 'availability' | 'credentials' | 'upcoming' | 'incidents' | 'completions'

const TAB_KEYS: Tab[] = ['availability', 'credentials', 'upcoming', 'incidents', 'completions']

type CredentialStatus = 'expired' | 'expiring' | 'ok' | 'no-date'

interface CredentialRow {
  key: string
  label: string
  expiryDate: string | null
  status: CredentialStatus
  daysUntilExpiry: number | null
}

/** Mirrors QualificationsPage's buildGroups row logic (same day-threshold source,
 * settings.qualificationWarningDays), narrowed to a single staff member. */
function buildCredentialRows(staff: {
  isFirstAidQualified: boolean; firstAidExpiryDate: string | null
  isDriverEligible: boolean; driverLicenceExpiryDate: string | null
  isManualHandlingCompetent: boolean; manualHandlingExpiryDate: string | null
  isMedicationCompetent: boolean; medicationCompetencyExpiryDate: string | null
  workerScreeningNumber: string | null; workerScreeningExpiryDate: string | null
}, warningDays: number): CredentialRow[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const candidates: { key: string; label: string; applies: boolean; expiryDate: string | null }[] = [
    { key: 'firstAid', label: 'First Aid', applies: staff.isFirstAidQualified, expiryDate: staff.firstAidExpiryDate },
    { key: 'driver', label: 'Driver Licence', applies: staff.isDriverEligible, expiryDate: staff.driverLicenceExpiryDate },
    { key: 'manualHandling', label: 'Manual Handling', applies: staff.isManualHandlingCompetent, expiryDate: staff.manualHandlingExpiryDate },
    { key: 'medication', label: 'Medication Competency', applies: staff.isMedicationCompetent, expiryDate: staff.medicationCompetencyExpiryDate },
    // Worker screening has no boolean qualification flag — it only "applies" once a number or
    // expiry date has actually been entered, same as QualificationsPage's own worker-screening row.
    { key: 'workerScreening', label: 'Worker Screening', applies: !!staff.workerScreeningNumber || !!staff.workerScreeningExpiryDate, expiryDate: staff.workerScreeningExpiryDate },
  ]

  return candidates
    .filter((c) => c.applies)
    .map((c) => {
      if (!c.expiryDate) {
        return { key: c.key, label: c.label, expiryDate: null, status: 'no-date' as const, daysUntilExpiry: null }
      }
      const expiry = new Date(c.expiryDate + 'T00:00:00')
      expiry.setHours(0, 0, 0, 0)
      const diff = Math.floor((expiry.getTime() - today.getTime()) / 86400000)
      const status: CredentialStatus = diff < 0 ? 'expired' : diff <= warningDays ? 'expiring' : 'ok'
      return { key: c.key, label: c.label, expiryDate: c.expiryDate, status, daysUntilExpiry: diff }
    })
}

function credentialBadge(row: CredentialRow) {
  if (row.status === 'expired') return <StatusBadge status="expired" label="Expired" />
  if (row.status === 'no-date') return <StatusBadge status="draft" label="No date set" />
  if (row.status === 'ok') return <StatusBadge status="active" label="Current" />
  const days = row.daysUntilExpiry!
  return <StatusBadge status="pending" label={days === 0 ? 'Expires today' : `Expires in ${days} day${days === 1 ? '' : 's'}`} />
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
    () => (overview ? buildCredentialRows(overview.staff, warningDays) : []),
    [overview, warningDays]
  )

  if (isLoading) return <div className="flex items-center justify-center h-64 text-[var(--color-muted-foreground)]">Loading...</div>
  if (!overview) return <div className="text-center py-12">Staff member not found</div>

  const { staff } = overview

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-4">
        <Link to="/staff" className="mt-1 p-2 rounded-lg hover:bg-[var(--color-accent)] transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">{staff.fullName}</h1>
            <StatusBadge status={staff.isActive ? 'Active' : 'Inactive'} />
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">{staff.position} · {staff.region || 'No region'}</p>
        </div>
        <div className="flex items-center gap-2">
          {canAccessLeaveApprovals && (
            <Link
              to={`/rostering/leave?userId=${id}`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-all"
            >
              <CalendarOff className="w-4 h-4" /> Leave & availability
            </Link>
          )}
          {canWrite && (
            <Link to={`/staff/${id}/edit`} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
              <Pencil className="w-4 h-4" /> Edit
            </Link>
          )}
        </div>
      </div>

      <TabNav
        tabs={[
          { key: 'availability', label: 'Availability', icon: CalendarClock },
          { key: 'credentials', label: 'Credentials', icon: ShieldCheck },
          { key: 'upcoming', label: 'Upcoming', icon: ClipboardList },
          { key: 'incidents', label: 'Incidents', icon: AlertTriangle },
          { key: 'completions', label: 'Completions', icon: ClipboardCheck },
        ]}
        active={tab}
        onChange={(key) => setTab(key as Tab)}
      />

      {tab === 'availability' && (
        <Card>
          <AvailabilityList staffId={id!} availability={overview.availability} />
        </Card>
      )}

      {tab === 'credentials' && (
        <Card>
          {credentialRows.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="No credentials on file" description="This staff member has no qualification flags or expiry dates set." />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {credentialRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium">{row.label}</p>
                    {row.expiryDate && (
                      <p className="text-xs text-[var(--color-muted-foreground)]">Expires {formatDateAu(row.expiryDate)}</p>
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
        <div className="space-y-6">
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
                    <Link to={`/participants/${s.participantId}`} className="font-medium hover:text-[var(--color-primary)]">
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
                    <Link to={`/trips/${a.tripInstanceId}`} className="font-medium hover:text-[var(--color-primary)]">
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
                    <Link to={`/incidents/${i.id}`} className="font-medium hover:text-[var(--color-primary)]">
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
            <Link to="/rostering/completions" className="text-xs text-[var(--color-primary)] hover:underline">
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
