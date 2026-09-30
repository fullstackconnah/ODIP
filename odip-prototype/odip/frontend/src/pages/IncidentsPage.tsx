import { useIncidents, useUpdateIncident, useDeleteIncident, useOverdueQscIncidents, useFlaggedShiftNotes } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import type { IncidentListDto, FlaggedShiftNoteDto } from '@/api/types'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Tabs } from '@/components/Tabs'
import { Button } from '@/components/Button'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, Plus, AlertTriangle, ShieldAlert, FileWarning } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { SHIFT_NOTE_FLAG_LABELS } from '@/lib/shiftNoteKeywords'
import type { ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'

type IncidentsTab = 'incidents' | 'flagged-notes'

/** "3h" / "2d" since createdAt — deliberately coarse (no minutes), this is a triage-queue
 * age indicator, not a precision timestamp. */
function formatNoteAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime()
  const hours = Math.floor(ms / (60 * 60 * 1000))
  if (hours < 1) return '<1h'
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Connection map item 4: mirrors ShiftNotesSection.goToIncident's field mapping so
 * IncidentCreatePage treats a queue-filed incident identically to a portal-filed one. Uses the
 * flagged note's own shift schedule (FlaggedShiftNoteDto.startTime/endTime/endsNextDay) rather
 * than a fake full-day window, so the description skeleton's shift-range text and the
 * datetime-local default reflect the real shift; the coordinator still reviews/edits both
 * before submitting, same "skeleton, not a decision" posture as the rest of this prefill
 * mechanism. */
function buildFlaggedNotePrefill(row: FlaggedShiftNoteDto, reportedByUserId: string | null): ShiftNoteIncidentPrefillState {
  return {
    source: 'shift-note',
    shiftNoteId: row.shiftNoteId,
    shiftId: row.shiftId,
    categories: row.flaggedCategories,
    participantId: row.participantId,
    participantName: row.participantName,
    noteBody: row.excerpt,
    serviceDate: row.shiftDate,
    startTime: row.startTime,
    endTime: row.endTime,
    endsNextDay: row.endsNextDay,
    reportedByUserId,
  }
}

function FlaggedNotesTab({ flaggedNotes, isLoading }: { flaggedNotes: FlaggedShiftNoteDto[]; isLoading: boolean }) {
  const navigate = useNavigate()
  const { id: currentUserId } = usePermissions()

  const columns: Column<FlaggedShiftNoteDto>[] = [
    { key: 'age', header: 'Age', className: 'tabular-nums whitespace-nowrap', render: row => formatNoteAge(row.createdAt) },
    { key: 'shiftDate', header: 'Shift date', render: row => formatDateAu(row.shiftDate) },
    {
      key: 'participantName',
      header: 'Participant',
      render: row => (
        <Link to={`/participants/${row.participantId}`} className="text-[var(--color-primary)] hover:underline">
          {row.participantName}
        </Link>
      ),
    },
    { key: 'staffName', header: 'Staff', render: row => row.staffName ?? '—' },
    {
      key: 'flaggedCategories',
      header: 'Flags',
      render: row => (
        <div className="flex flex-wrap gap-1">
          {row.flaggedCategories.map(category => (
            <span
              key={category}
              className="inline-flex items-center rounded-full bg-[var(--color-warning-container)] px-2 py-0.5 text-xs font-medium text-[var(--color-on-warning-container)]"
            >
              {SHIFT_NOTE_FLAG_LABELS[category] ?? category}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'excerpt',
      header: 'Excerpt',
      render: row => (
        <span title={row.excerpt} className="line-clamp-1 max-w-xs text-[var(--color-muted-foreground)]">
          {row.excerpt}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: row => (
        <button
          type="button"
          onClick={() => navigate('/incidents/new', { state: buildFlaggedNotePrefill(row, currentUserId) })}
          className="min-h-[44px] px-3 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90"
        >
          File incident
        </button>
      ),
    },
  ]

  if (!isLoading && flaggedNotes.length === 0) {
    return (
      <EmptyState
        icon={FileWarning}
        title="No flagged notes are waiting on an incident."
        description="Shift notes that mention falls, medication, injury or a behaviour of concern show up here until a coordinator files an incident or the worker dismisses the flag."
      />
    )
  }

  return (
    <DataTable
      data={flaggedNotes}
      columns={columns}
      keyField="shiftNoteId"
      loading={isLoading}
      emptyMessage="No flagged notes found"
    />
  )
}

// Matches IncidentsController.GetAll's own PagingParams.DefaultPageSize (backend house
// convention: default 50, ceiling 200) — kept in sync manually since paging params cross the
// API boundary as plain query strings, not a shared type.
const INCIDENTS_PAGE_SIZE = 50

const INCIDENT_STATUS_FILTER_ITEMS: DropdownItem[] = [
  { value: 'Draft', label: 'Draft' },
  { value: 'Submitted', label: 'Submitted' },
  { value: 'UnderReview', label: 'Under Review' },
  { value: 'Escalated', label: 'Escalated' },
  { value: 'Resolved', label: 'Resolved' },
  { value: 'Closed', label: 'Closed' },
]

const INCIDENT_SEVERITY_FILTER_ITEMS: DropdownItem[] = [
  { value: 'Low', label: 'Low' },
  { value: 'Medium', label: 'Medium' },
  { value: 'High', label: 'High' },
  { value: 'Critical', label: 'Critical' },
]

function formatQscLabel(status: string): string {
  switch (status) {
    case 'ReportedWithin24h': return 'Reported (24h)'
    case 'ReportedLate': return 'Reported Late'
    case 'Required': return 'Required'
    case 'Pending': return 'Pending'
    default: return status
  }
}

export default function IncidentsPage() {
  const { canWrite, canCreateIncidents, canAccessPage } = usePermissions()
  // Same gate as /rostering (coordinators, admins, super admins) — a support worker's own
  // notes are already visible to them on the portal shift page; this queue spans every
  // participant's notes, which a support worker should not see.
  const canViewFlaggedNotes = canAccessPage('rostering')
  const [searchParams, setSearchParams] = useSearchParams()
  // Addressable via ?view=flagged-notes (e.g. a link in from the dashboard/tasks obligation
  // queue) — read once on mount, same as qscOverdueOnly below. Default (no param) is unchanged:
  // the Incidents tab. Only sets the initial tab — switching tabs afterwards via Tabs doesn't
  // write the param back, matching how qscOverdueOnly is a one-way filter, not a synced tab state.
  const [tab, setTab] = useState<IncidentsTab>(searchParams.get('view') === 'flagged-notes' ? 'flagged-notes' : 'incidents')
  const { data: flaggedNotes = [], isLoading: flaggedNotesLoading } = useFlaggedShiftNotes(
    { withoutIncident: true },
    { enabled: canViewFlaggedNotes },
  )
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [page, setPage] = useState(1)
  const qscOverdueOnly = searchParams.get('qsc') === 'overdue'
  const clearQscParam = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('qsc')
      return next
    })
  }
  const updateIncident = useUpdateIncident()
  const deleteIncident = useDeleteIncident()
  const { data: overdueQsc = [] } = useOverdueQscIncidents()

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteIncident,
    restoreMutation: updateIncident,
    entityName: (i) => i.title,
    entityId: (i) => i.id,
    archiveVia: 'status',
    archiveStatus: 'Closed',
    restoreData: (i) => ({ ...i, status: 'Draft', isActive: true }),
    editPath: (i) => `/incidents/${i.id}/edit`,
  })

  const queryParams: Record<string, string> = { ...params, page: String(page), pageSize: String(INCIDENTS_PAGE_SIZE) }
  if (!showArchived && !qscOverdueOnly) {
    if (statusFilter) queryParams.status = statusFilter
    if (severityFilter) queryParams.severity = severityFilter
  }
  // Moved server-side (IncidentsController.GetAll's isOverdueQsc param) — filtering client-side
  // would only ever see the current page's rows once the endpoint is truly paginated, silently
  // under-reporting overdue incidents. Applied regardless of showArchived, matching the old
  // client-side `.filter(i => i.isOverdue24h)`, which ran unconditionally too.
  if (qscOverdueOnly) queryParams.isOverdueQsc = 'true'

  const { data: incidents = [], isLoading } = useIncidents(queryParams)
  // `incidents` is normally a TruncatableList (see pagedList.ts), but the `= []` default used
  // while loading is a plain array without that extra field — read it as optional, same pattern
  // as ParticipantPicker.
  const { totalCount = incidents.length } = incidents as Partial<TruncatableList<IncidentListDto>>

  // A filter/tab change can leave `page` pointing past the end of the new, smaller result set —
  // reset to page 1 whenever the query's own filters change. Adjusted during render (React's
  // documented pattern for "resetting state when a dependency changes",
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  // rather than in a useEffect, which would call setState synchronously in an effect body.
  const filterResetKey = `${statusFilter}|${severityFilter}|${qscOverdueOnly}|${showArchived}`
  const [prevFilterResetKey, setPrevFilterResetKey] = useState(filterResetKey)
  if (filterResetKey !== prevFilterResetKey) {
    setPrevFilterResetKey(filterResetKey)
    setPage(1)
  }

  const incidentColumns: Column<any>[] = [
    { key: 'title', header: 'Title', sortable: true, className: 'font-medium' },
    { key: 'incidentType', header: 'Type', sortable: true },
    {
      key: 'tripName',
      header: 'Trip',
      sortable: true,
      render: (i) => i.tripInstanceId && i.tripName ? (
        <Link to={`/trips/${i.tripInstanceId}`} className="text-[var(--color-primary)] hover:underline">
          {i.tripName}
        </Link>
      ) : (i.tripName ?? '—'),
    },
    {
      key: 'involvedParticipantName',
      header: 'Participant',
      render: (i) => i.involvedParticipantId && i.involvedParticipantName ? (
        <Link to={`/participants/${i.involvedParticipantId}`} className="text-[var(--color-primary)] hover:underline">
          {i.involvedParticipantName}
        </Link>
      ) : (i.involvedParticipantName ?? '—'),
    },
    { key: 'severity', header: 'Severity', sortable: true, render: (i) => <StatusBadge status={i.severity} /> },
    { key: 'status', header: 'Status', sortable: true, render: (i) => <StatusBadge status={i.status} /> },
    { key: 'reportedByName', header: 'Reported By' },
    { key: 'incidentDateTime', header: 'Date', type: 'date', sortable: true },
    {
      key: 'qscReportingStatus',
      header: 'QSC',
      render: (i) => i.qscReportingStatus === 'NotRequired' ? (
        <span className="text-[var(--color-muted-foreground)]">{'\u2014'}</span>
      ) : (
        <StatusBadge
          status={i.qscReportingStatus}
          label={i.isOverdue24h ? 'OVERDUE' : formatQscLabel(i.qscReportingStatus)}
          pulse={i.isOverdue24h}
        />
      ),
    },
    { key: 'actions', header: '', render: (i) => canWrite ? actionButtons(i) : null },
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {canViewFlaggedNotes && (
        <Tabs
          tabs={[
            { id: 'incidents', label: 'Incidents' },
            { id: 'flagged-notes', label: `Flagged notes (${flaggedNotes.length})` },
          ]}
          active={tab}
          onChange={key => setTab(key as IncidentsTab)}
          ariaLabel="Incidents sections"
        />
      )}

      {tab === 'flagged-notes' && canViewFlaggedNotes ? (
        <FlaggedNotesTab flaggedNotes={flaggedNotes} isLoading={flaggedNotesLoading} />
      ) : (
      <>
      <PageHeader
        title="Incident Reports"
        subtitle={`${totalCount} incident${totalCount !== 1 ? 's' : ''}`}
        action={!showArchived && canCreateIncidents && (
          <Button to="/incidents/new" size="md">
            <Plus className="w-4 h-4" /> Report Incident
          </Button>
        )}
      >
        {toggleButtons}
        {!showArchived && (
          <>
            <div className="flex items-center gap-1.5">
              <Filter aria-hidden="true" className="w-4 h-4 text-[var(--color-muted-foreground)]" />
              <Dropdown
                variant="pill"
                value={statusFilter}
                onChange={setStatusFilter}
                label="All Statuses"
                items={INCIDENT_STATUS_FILTER_ITEMS}
                colorClass="bg-[var(--color-input)] border border-[var(--color-border)]"
              />
            </div>
            <div>
              <Dropdown
                variant="pill"
                value={severityFilter}
                onChange={setSeverityFilter}
                label="All Severities"
                items={INCIDENT_SEVERITY_FILTER_ITEMS}
                colorClass="bg-[var(--color-input)] border border-[var(--color-border)]"
              />
            </div>
          </>
        )}
      </PageHeader>

      {/* QSC Overdue Alert Banner */}
      {!showArchived && overdueQsc.length > 0 && (
        <div
          role="alert"
          className="flex items-center gap-3 p-[var(--card-pad)] rounded-[var(--radius-md)] bg-error-container border border-destructive/40 text-on-error-container"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold text-sm">{overdueQsc.length} incident{overdueQsc.length !== 1 ? 's' : ''} require QSC reporting — 24-hour deadline exceeded</p>
            <p className="text-xs mt-0.5 opacity-80">NDIS Quality and Safeguards Commission requires reportable incidents to be escalated within 24 hours.</p>
            <Link to="/incidents?qsc=overdue" className="inline-block mt-1 text-sm font-medium underline underline-offset-2">
              View overdue incidents
            </Link>
          </div>
        </div>
      )}

      {qscOverdueOnly && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Showing only incidents past the 24-hour QSC deadline.{' '}
          <Link to="/incidents" className="font-medium underline underline-offset-2">Show all incidents</Link>
        </p>
      )}

      {!isLoading && incidents.length === 0 ? (
        qscOverdueOnly ? (
          <EmptyState
            icon={ShieldAlert}
            title="No overdue QSC reports"
            description="No incidents are currently past the 24-hour QSC deadline."
          />
        ) : !showArchived && (statusFilter || severityFilter) ? (
          <EmptyState
            icon={ShieldAlert}
            title="No incidents match your filters"
            description="Try a different status or severity filter, or clear them to see all incident reports."
            action={{ label: 'Clear filters', onClick: () => { setStatusFilter(''); setSeverityFilter(''); clearQscParam() } }}
          />
        ) : (
          <EmptyState
            icon={ShieldAlert}
            title="No incidents reported"
            description="Incident reports log injuries, behaviours of concern, and other events that happen on a trip, including any NDIS Quality and Safeguards Commission reporting. Report one to get started."
            action={!showArchived && canCreateIncidents ? { label: 'Report incident', to: '/incidents/new' } : undefined}
          />
        )
      ) : (
        <DataTable
          data={incidents}
          columns={incidentColumns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No incidents found"
          pagination={{
            page,
            pageSize: INCIDENTS_PAGE_SIZE,
            totalCount,
            onPageChange: setPage,
          }}
        />
      )}
      </>
      )}
      {confirmDialog}
    </div>
  )
}
