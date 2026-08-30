import { useParticipants, useDeleteParticipant, useUpdateParticipant, useParticipantAlertsAggregate } from '@/api/hooks'
import { maskNdisNumber } from '@/lib/utils'
import { DataTable, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { Dropdown } from '@/components/Dropdown'
import { EmptyState } from '@/components/EmptyState'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { ALERT_SEVERITY_STYLES } from '@/components/alertSeverityStyles'
import type { ParticipantListDto } from '@/api/types'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Users, ChevronRight, Pill } from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePermissions } from '@/lib/permissions'

const ACTIVE_STATUS_ITEMS = [
  { value: 'Active', label: 'Active' },
  { value: 'Inactive', label: 'Inactive' },
]

const ACTIVE_STATUS_COLORS: Record<string, string> = {
  Active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  Inactive: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

export default function ParticipantsPage() {
  const { canWrite, canViewAlerts } = usePermissions()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const deleteParticipant = useDeleteParticipant()
  const updateParticipant = useUpdateParticipant()
  const { data: alertsAggregate, isLoading: alertsLoading } = useParticipantAlertsAggregate(canViewAlerts)
  const alertsByParticipant = useMemo(
    () => new Map((alertsAggregate ?? []).map((a) => [a.participantId, a])),
    [alertsAggregate],
  )

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteParticipant,
    restoreMutation: updateParticipant,
    entityName: (p) => p.fullName,
    entityId: (p) => p.id,
    editPath: (p) => `/participants/${p.id}/edit`,
  })

  const queryParams = { ...params }
  if (search) queryParams.search = search

  const { data: participants = [], isLoading } = useParticipants(queryParams)

  const participantColumns: Column<any>[] = [
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      render: (p) => (
        <span className="font-medium text-[var(--color-foreground)] group-hover:text-[var(--color-primary)] transition-colors">
          {p.fullName}
        </span>
      ),
    },
    { key: 'ndisNumber', header: 'NDIS Number', render: (p) => <span className="font-mono text-xs text-[var(--color-muted-foreground)]">{maskNdisNumber(p.maskedNdisNumber || p.ndisNumber)}</span> },
    { key: 'planType', header: 'Plan Type' },
    { key: 'region', header: 'Region', sortable: true },
    { key: 'serviceStreams', header: 'Streams', className: 'max-w-[220px]', render: (p) => <ServiceStreamBadges value={p.serviceStreams} /> },
    {
      key: 'mobilityAidWheelchair',
      // The emoji alone has no accessible name for a screen reader — sr-only text gives the
      // column a real header while keeping the compact glyph for sighted users.
      header: (
        <span title="Wheelchair">
          <span aria-hidden="true">{'\u{1F9BD}'}</span>
          <span className="sr-only">Wheelchair</span>
        </span>
      ),
      type: 'boolean',
      align: 'center',
    },
    { key: 'isHighSupport', header: 'High', type: 'boolean', align: 'center' },
    { key: 'supportRatio', header: 'Support Ratio' },
    { key: 'isRepeatClient', header: 'Repeat', type: 'boolean', align: 'center' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (p) => {
        const current = p.isActive ? 'Active' : 'Inactive'
        return (
          <span onClick={e => e.stopPropagation()}>
            <Dropdown
              variant="pill"
              value={current}
              onChange={val => updateParticipant.mutate({ id: p.id, data: { ...p, isActive: val === 'Active' } })}
              colorClass={ACTIVE_STATUS_COLORS[current]}
              items={ACTIVE_STATUS_ITEMS}
              disabled={!canWrite}
            />
          </span>
        )
      },
    },
    ...(canViewAlerts ? [{
      key: 'alerts',
      header: 'Alerts',
      align: 'center' as const,
      render: (p: ParticipantListDto) => {
        if (alertsLoading) {
          return <span className="inline-block h-4 w-9 rounded-full bg-[var(--color-muted)] animate-pulse" />
        }
        const entry = alertsByParticipant.get(p.id)
        const total = entry ? entry.criticalCount + entry.warningCount + entry.infoCount : 0
        if (total === 0) return <span className="text-[var(--color-muted-foreground)]">—</span>
        return (
          <span className="inline-flex items-center gap-1" title={entry!.alerts.map((a) => a.message).join('; ')}>
            {entry!.criticalCount > 0 && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${ALERT_SEVERITY_STYLES.Critical.bg} ${ALERT_SEVERITY_STYLES.Critical.text}`}>
                <ALERT_SEVERITY_STYLES.Critical.icon className="w-3 h-3" /> {entry!.criticalCount}
              </span>
            )}
            {entry!.warningCount > 0 && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${ALERT_SEVERITY_STYLES.Warning.bg} ${ALERT_SEVERITY_STYLES.Warning.text}`}>
                <ALERT_SEVERITY_STYLES.Warning.icon className="w-3 h-3" /> {entry!.warningCount}
              </span>
            )}
            {/* Previously missing: an Info-only entry (critical/warning both 0) fell through to
                an empty span here — the cell looked identical to "no alerts" even though `total`
                was non-zero, silently hiding Info-severity alerts from the at-a-glance column. */}
            {entry!.infoCount > 0 && (
              <span className={`inline-flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${ALERT_SEVERITY_STYLES.Info.bg} ${ALERT_SEVERITY_STYLES.Info.text}`}>
                <ALERT_SEVERITY_STYLES.Info.icon className="w-3 h-3" /> {entry!.infoCount}
              </span>
            )}
          </span>
        )
      },
    }] : []),
    {
      key: 'actions',
      header: '',
      render: (p) => (
        <span className="flex items-center justify-end gap-2">
          {p.hasActiveMedications && (
            <button
              type="button"
              title="View medications"
              aria-label={`View medications for ${p.fullName}`}
              onClick={(e) => { e.stopPropagation(); navigate(`/participants/${p.id}?tab=medications`) }}
              className="p-1.5 rounded-lg text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] hover:bg-[var(--color-accent)] transition-colors"
            >
              <Pill className="w-4 h-4" />
            </button>
          )}
          {canWrite && actionButtons(p)}
          <ChevronRight className="w-4 h-4 text-[var(--color-muted-foreground)] group-hover:text-[var(--color-foreground)] transition-colors shrink-0" aria-hidden="true" />
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Participants"
        subtitle={`${participants.length} participant${participants.length !== 1 ? 's' : ''}`}
        action={!showArchived && canWrite && (
          <Link to="/participants/new" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:bg-[var(--color-primary)]/90 shadow-md shadow-[var(--color-primary)]/20 transition-all">
            <Plus className="w-4 h-4" /> New Participant
          </Link>
        )}
      >
        {toggleButtons}
        <SearchInput value={search} onChange={setSearch} placeholder="Search participants..." />
      </PageHeader>

      {!isLoading && participants.length === 0 ? (
        search ? (
          <EmptyState
            icon={Users}
            title="No participants match your filters"
            description="Try a different search term, or clear your search to see all participants."
            action={{ label: 'Clear search', onClick: () => setSearch('') }}
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No participants yet"
            description="Participants are the NDIS clients you plan trips and supports for. Add one to start booking them onto trips."
            action={!showArchived && canWrite ? { label: 'Add participant', to: '/participants/new' } : undefined}
          />
        )
      ) : (
        <DataTable
          data={participants}
          columns={participantColumns}
          keyField="id"
          sortable
          onRowClick={(p: any) => navigate(`/participants/${p.id}`)}
          loading={isLoading}
          emptyMessage="No participants found"
        />
      )}
      {confirmDialog}
    </div>
  )
}
