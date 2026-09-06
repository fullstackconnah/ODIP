import { useIncidents, useUpdateIncident, useDeleteIncident, useOverdueQscIncidents } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, Plus, AlertTriangle, ShieldAlert } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'

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
  const { canWrite, canCreateIncidents } = usePermissions()
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [searchParams] = useSearchParams()
  const qscOverdueOnly = searchParams.get('qsc') === 'overdue'
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

  const queryParams = { ...params }
  if (!showArchived) {
    if (statusFilter) queryParams.status = statusFilter
    if (severityFilter) queryParams.severity = severityFilter
  }

  const { data: incidents = [], isLoading } = useIncidents(queryParams)
  const visibleIncidents = qscOverdueOnly ? incidents.filter((i) => i.isOverdue24h) : incidents

  const incidentColumns: Column<any>[] = [
    { key: 'title', header: 'Title', sortable: true, className: 'font-medium' },
    { key: 'tripName', header: 'Trip', sortable: true },
    { key: 'incidentType', header: 'Type', sortable: true },
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
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Incident Reports"
        subtitle={`${visibleIncidents.length} incident${visibleIncidents.length !== 1 ? 's' : ''}`}
        action={!showArchived && canCreateIncidents && (
          <Link to="/incidents/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20">
            <Plus className="w-4 h-4" /> Report Incident
          </Link>
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
          className="flex items-center gap-3 p-4 rounded-xl bg-error-container border border-destructive/40 text-on-error-container"
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

      {!isLoading && visibleIncidents.length === 0 ? (
        !showArchived && (statusFilter || severityFilter) ? (
          <EmptyState
            icon={ShieldAlert}
            title="No incidents match your filters"
            description="Try a different status or severity filter, or clear them to see all incident reports."
            action={{ label: 'Clear filters', onClick: () => { setStatusFilter(''); setSeverityFilter('') } }}
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
          data={visibleIncidents}
          columns={incidentColumns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No incidents found"
        />
      )}
      {confirmDialog}
    </div>
  )
}
