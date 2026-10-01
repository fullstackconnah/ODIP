import { useParticipants, useDeleteParticipant, useUpdateParticipant, useParticipantAlertsAggregate } from '@/api/hooks'
import { maskNdisNumber } from '@/lib/utils'
import { DataTable, RowActions, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { SearchInput } from '@/components/SearchInput'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { ServiceStreamBadges } from '@/components/ServiceStreamBadges'
import { Button } from '@/components/Button'
import { TAP_TRUNCATED_LINK } from '@/components/tapArea'

import { ALERT_SEVERITY_STYLES } from '@/components/alertSeverityStyles'
import type { ParticipantListDto } from '@/api/types'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Users, ChevronRight, Pill } from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePermissions } from '@/lib/permissions'
import { plural } from '@/lib/format'

const ACTIVE_STATUS_COLORS: Record<string, string> = {
  Active: 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]',
  Inactive: 'bg-[var(--color-error-container)] text-[var(--color-on-error-container)]',
}

export default function ParticipantsPage() {
  const screen = useParticipantsScreen()
  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* PageHeader's title row and filter row are siblings. Directly inside this flex column the
          section gap opens between them (32 + 16 + 8 + 32 = 88px); in a plain wrapper they stay in
          block flow: 32px title row + 8px + 32px filters = 72px, the spec §3 header budget. */}
      <div>
        <PageHeader
          title="Participants"
          subtitle={plural(screen.participantsCount, 'participant')}
          action={!screen.showArchived && screen.canWrite && (
            <Button to="/participants/new" size="md">
              <Plus className="w-4 h-4" /> New Participant
            </Button>
          )}
        >
          {screen.toggleButtons}

          <SearchInput value={screen.search} onChange={screen.setSearch} placeholder="Search participants..." />
        </PageHeader>
      </div>

      {screen.body}
    </div>
  )
}

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns
 * one PageHeader; the standalone /participants route keeps using ParticipantsPage above.
 */
export function ParticipantsTable() {
  const screen = useParticipantsScreen()
  return <>{screen.body}</>
}

function useParticipantsScreen() {
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

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<ParticipantListDto>({
    deleteMutation: deleteParticipant,
    restoreMutation: updateParticipant,
    entityName: (p) => p.fullName,
    entityId: (p) => p.id,
    editPath: (p) => `/participants/${p.id}/edit`,
  })

  const queryParams = { ...params }
  if (search) queryParams.search = search
  // This is the operational participant register. The server owns the stage predicate so a
  // non-draft payload cannot bypass onboarding merely by altering a browser filter.
  queryParams.isDraft = 'false'
  queryParams.operationalOnly = 'true'

  const { data: participants = [], isLoading } = useParticipants(queryParams)

  // The status pill on each row is read-only; status changes go through an explicit
  // confirmation flow so a coordinator can never flip a participant's active flag
  // (or archive them) by mistake.
  const [pendingStatusChange, setPendingStatusChange] = useState<{
    id: string
    nextIsActive: boolean
  } | null>(null)
  const pendingParticipant = pendingStatusChange
    ? participants.find((p: ParticipantListDto) => p.id === pendingStatusChange.id) ?? null
    : null
  const currentIsActive = pendingParticipant ? pendingParticipant.isActive : false
  const pendingNextLabel = pendingStatusChange?.nextIsActive ? 'Active' : 'Inactive'
  const pendingCurrentLabel = currentIsActive ? 'Active' : 'Inactive'

  const closeStatusDialog = () => setPendingStatusChange(null)
  const confirmStatusChange = () => {
    if (!pendingStatusChange) return
    if (!pendingParticipant) return
    // Send ONLY isActive: the endpoint is a partial patch, and a full list DTO would
    // omit required CreateParticipantDto fields.
    updateParticipant.mutate({
      id: pendingParticipant.id,
      data: { isActive: pendingStatusChange.nextIsActive },
    })
    setPendingStatusChange(null)
  }

  // One line per row at any desktop width: DataTable's cells never wrap, so a narrower window
  // costs columns, not row height. Budget at 1280 (content 1280 − 232 sidebar − 2×20 gutter = 1008,
  // 1006 inside the table border), each column padded 2×12, Manrope measured (see the density
  // verdict report). The seeded data has no service streams and no alerts, so the Streams and Alerts
  // columns are costed at what real data brings: streams at their 10rem cap (184) and two alert
  // badges (94). Always shown: Name 167.5 + NDIS 98.2 + Streams 184 + wheelchair 40 + High 49.8 +
  // Status 89.8 + Alerts 94 + chevron 40 = 763.3. 1280 adds Region 178.6: 941.9, spare 64.
  // 1536 adds Support Ratio 102.4 and Repeat 64.4: 1108.7 of 1262. 1792 adds Plan Type 132.7:
  // 1241.4 of 1518. The actions used to cost 213px of column; they overlay now (the 40px chevron).
  const participantColumns: Column<ParticipantListDto>[] = [
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      render: (p) => (
        // The link itself truncates (inline-block + truncate), not a wrapper around it: a wrapper's
        // overflow would clip the link's focus ring.
        <Link
          to={`/participants/${p.id}`}
          aria-label={`Open ${p.fullName} profile`}
          title={p.fullName}
          className={`inline-block align-middle font-medium text-[var(--color-foreground)] group-hover/row:text-[var(--color-primary)] transition-colors hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm md:max-w-[16rem] md:truncate ${TAP_TRUNCATED_LINK}`}
        >
          {p.fullName}
        </Link>
      ),
    },
    { key: 'ndisNumber', header: 'NDIS Number', render: (p) => <span className="font-mono text-[13px] text-[var(--color-muted-foreground)]">{maskNdisNumber(p.maskedNdisNumber ?? p.ndisNumber)}</span> },
    { key: 'planType', header: 'Plan Type', priority: 'lowest', maxWidth: '10rem' },
    { key: 'region', header: 'Region', sortable: true, priority: 'medium', maxWidth: '11rem' },
    {
      key: 'serviceStreams',
      header: 'Streams',
      // Chips never wrap onto a second line (w-max), the group is clipped at 10rem instead.
      render: (p) => (
        <div className="md:max-w-[10rem] md:overflow-hidden">
          <ServiceStreamBadges value={p.serviceStreams} className="md:w-max" />
        </div>
      ),
    },
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
    { key: 'supportRatio', header: 'Support Ratio', priority: 'low', maxWidth: '10rem' },
    { key: 'isRepeatClient', header: 'Repeat', type: 'boolean', align: 'center', priority: 'low' },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (p) => {
        const current = p.isActive ? 'Active' : 'Inactive'
        return (
          <span
            aria-label={`Status: ${current}`}
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${ACTIVE_STATUS_COLORS[current]}`}
          >
            {current}
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
      // `relative` anchors the overlay below; the column itself is only the chevron.
      className: 'relative',
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          {/* Row actions (24px) appear on row hover / focus and are always shown on touch; the
              chevron is the row's constant "opens the record" cue, so it stays outside. On a mouse
              the cluster overlays the row's last cells instead of reserving ~200px of column, so
              "Change status" can never spill out of (or squeeze) its cell. */}
          <RowActions overlay>
            {p.hasActiveMedications && (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                title="View medications"
                aria-label={`View medications for ${p.fullName}`}
                onClick={(e) => { e.stopPropagation(); navigate(`/participants/${p.id}?tab=medications`) }}
              >
                <Pill className="w-4 h-4" />
              </Button>
            )}
            {canWrite && (
              <Button
                variant="secondary"
                size="sm"
                className="whitespace-nowrap"
                aria-label={`Change status for ${p.fullName}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setPendingStatusChange({ id: p.id, nextIsActive: !p.isActive })
                }}
              >
                Change status
              </Button>
            )}
            {canWrite && actionButtons(p)}
          </RowActions>
          <ChevronRight className="w-4 h-4 text-[var(--color-muted-foreground)] group-hover/row:text-[var(--color-foreground)] transition-colors shrink-0" aria-hidden="true" />
        </div>
      ),
    },
  ]

  const body = (
    <>
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
          loading={isLoading}
          emptyMessage="No participants found"
        />
      )}
      {confirmDialog}
      {pendingStatusChange && pendingParticipant && (
        <ConfirmDialog
          open
          onConfirm={confirmStatusChange}
          onCancel={closeStatusDialog}
          title={`Set ${pendingParticipant.fullName} as ${pendingNextLabel}`}
          confirmLabel={`Set as ${pendingNextLabel}`}
          confirmAriaLabel={`Set ${pendingParticipant.fullName} as ${pendingNextLabel}`}
          cancelLabel="Cancel"
          variant={pendingStatusChange.nextIsActive ? 'default' : 'danger'}
          loading={updateParticipant.isPending}
          message={
            <div className="space-y-2">
              <p>
                Change <span className="font-semibold text-[var(--color-foreground)]">{pendingParticipant.fullName}</span>'s status
                from <span className="font-semibold">{pendingCurrentLabel}</span> to{' '}
                <span className="font-semibold">{pendingNextLabel}</span>?
              </p>
              {pendingStatusChange.nextIsActive === false && (
                <p className="text-[var(--color-destructive)]">
                  Inactive participants are hidden from rostering, scheduling and the default register.
                </p>
              )}
            </div>
          }
        />
      )}
    </>
  )

  return {
    canWrite,
    showArchived,
    toggleButtons,
    participantsCount: participants.length,
    search,
    setSearch,
    body,
  }
}
