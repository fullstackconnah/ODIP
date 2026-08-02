import { useIncidents, useUpdateIncident, useDeleteIncident, useOverdueQscIncidents } from '@/api/hooks'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Filter, Plus, AlertTriangle } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'

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
        subtitle={`${incidents.length} incident${incidents.length !== 1 ? 's' : ''}`}
        action={!showArchived && canCreateIncidents && (
          <Link to="/incidents/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-blue-500/20">
            <Plus className="w-4 h-4" /> Report Incident
          </Link>
        )}
      >
        {toggleButtons}
        {!showArchived && (
          <>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-muted-foreground)]" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="pl-10 pr-8 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]">
                <option value="">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Submitted">Submitted</option>
                <option value="UnderReview">Under Review</option>
                <option value="Escalated">Escalated</option>
                <option value="Resolved">Resolved</option>
                <option value="Closed">Closed</option>
              </select>
            </div>
            <div className="relative">
              <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
                className="px-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)]">
                <option value="">All Severities</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Critical">Critical</option>
              </select>
            </div>
          </>
        )}
      </PageHeader>

      {/* QSC Overdue Alert Banner */}
      {!showArchived && overdueQsc.length > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">{overdueQsc.length} incident{overdueQsc.length !== 1 ? 's' : ''} require QSC reporting — 24-hour deadline exceeded</p>
            <p className="text-xs mt-0.5 opacity-80">NDIS Quality and Safeguards Commission requires reportable incidents to be escalated within 24 hours.</p>
          </div>
        </div>
      )}

      <DataTable
        data={incidents}
        columns={incidentColumns}
        keyField="id"
        sortable
        loading={isLoading}
        emptyMessage="No incidents found"
      />
      {confirmDialog}
    </div>
  )
}
