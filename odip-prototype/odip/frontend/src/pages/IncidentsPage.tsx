import { useIncidents, useRestoreIncident, useDeleteIncident, useOverdueQscIncidents, useFlaggedShiftNotes } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import type { IncidentListDto, FlaggedShiftNoteDto } from '@/api/types'
import { INCIDENT_STATUS_LABELS, type IncidentStatus } from '@/api/types/enums'
import { CellText, DataTable, RowActions, type Column } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Tabs } from '@/components/Tabs'
import { Button } from '@/components/Button'
import { TAP_FLOOR, TAP_TRUNCATED_LINK } from '@/components/tapArea'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, Plus, AlertTriangle, ShieldAlert, FileWarning } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { formatAge, plural } from '@/lib/format'
import { SHIFT_NOTE_FLAG_LABELS } from '@/lib/shiftNoteKeywords'
import type { ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'

type IncidentsTab = 'incidents' | 'flagged-notes'

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
    { key: 'age', header: 'Age', className: 'tabular-nums', render: row => formatAge(row.createdAt) },
    { key: 'shiftDate', header: 'Shift date', render: row => formatDateAu(row.shiftDate) },
    {
      key: 'participantName',
      header: 'Participant',
      render: row => (
        <Link
          to={`/participants/${row.participantId}`}
          title={row.participantName}
          className={`inline-block align-middle text-[var(--color-primary)] hover:underline md:max-w-[12rem] md:truncate ${TAP_TRUNCATED_LINK}`}
        >
          {row.participantName}
        </Link>
      ),
    },
    { key: 'staffName', header: 'Staff', maxWidth: '10rem', render: row => row.staffName ?? '—' },
    {
      key: 'flaggedCategories',
      header: 'Flags',
      // One line at md+ like every other cell: the chips stay on a single row (w-max) and the group
      // is clipped at 16rem, instead of wrapping and pushing the row past --row-h.
      render: row => (
        <div className="md:max-w-[16rem] md:overflow-hidden">
          <div className="flex flex-wrap gap-1 md:w-max md:flex-nowrap">
            {row.flaggedCategories.map(category => (
              <span
                key={category}
                className="inline-flex items-center rounded-full bg-[var(--color-warning-container)] px-2 py-0.5 text-xs font-medium text-[var(--color-on-warning-container)]"
              >
                {SHIFT_NOTE_FLAG_LABELS[category] ?? category}
              </span>
            ))}
          </div>
        </div>
      ),
    },
    {
      key: 'excerpt',
      header: 'Excerpt',
      render: row => (
        <span title={row.excerpt} className="block max-w-xs truncate text-[var(--color-muted-foreground)]">
          {row.excerpt}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: row => (
        // Always visible (not a hover-revealed RowActions): filing an incident is this queue's
        // whole purpose, so hiding its only action behind a hover would hide the queue's point.
        <Button
          size="sm"
          onClick={() => navigate('/incidents/new', { state: buildFlaggedNotePrefill(row, currentUserId) })}
        >
          File incident
        </Button>
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
  const restoreIncident = useRestoreIncident()
  const deleteIncident = useDeleteIncident()
  const { data: overdueQsc = [] } = useOverdueQscIncidents()

  const { showArchived, params, toggleButtons, confirmDialog, actionButtons } = useArchiveRestore<any>({
    deleteMutation: deleteIncident,
    restoreMutation: restoreIncident,
    entityName: (i) => i.title,
    entityId: (i) => i.id,
    archiveVia: 'status',
    archiveStatus: 'Closed',
    restoreData: () => ({ status: 'Draft' }),   // the hook builds the rest of the body from the stored incident
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

  // Every row is exactly --row-h from 1280 up: cells never wrap (DataTable), so a narrower window
  // drops columns instead of growing rows. The primary columns (title, severity, status, date, QSC,
  // actions) are always there; participant needs 1280, type 1536, trip and reported-by 1792.
  // Budget, widest seeded rows, each column padded 2×12 (Manrope measured, see the density verdict
  // report). 1280 (content 1280 − 232 − 2×20 = 1008, 1006 inside the border): title 264 (capped) +
  // participant 165.1 + severity 88.2 + status 113.2 + date 104.3 + QSC 124.8 + actions 76 = 935.6,
  // spare 70. 1536 adds type: 1125.3 of 1262. 1792 adds trip and reported-by: 1467.5 of 1518. The
  // old layout always needed 1467.5, so its rows wrapped at every viewport under 1742px.
  const incidentColumns: Column<any>[] = [
    {
      key: 'title',
      header: 'Title',
      className: 'font-medium',
      render: (i) => <CellText className="md:max-w-[15rem] 2xl:max-w-[18rem]">{i.title ?? '—'}</CellText>,
    },
    { key: 'incidentType', header: 'Type', maxWidth: '9rem' },
    {
      key: 'tripName',
      header: 'Trip',
      render: (i) => i.tripInstanceId && i.tripName ? (
        <Link
          to={`/trips/${i.tripInstanceId}`}
          title={i.tripName}
          className={`inline-block align-middle text-[var(--color-primary)] hover:underline md:truncate md:max-[1792px]:max-w-[11rem] min-[1792px]:max-w-[13rem] ${TAP_TRUNCATED_LINK}`}
        >
          {i.tripName}
        </Link>
      ) : (i.tripName ?? '—'),
    },
    {
      key: 'involvedParticipantName',
      header: 'Participant',
      render: (i) => i.involvedParticipantId && i.involvedParticipantName ? (
        <Link
          to={`/participants/${i.involvedParticipantId}`}
          title={i.involvedParticipantName}
          className={`inline-block align-middle text-[var(--color-primary)] hover:underline md:max-w-[9rem] md:truncate 2xl:max-w-[12rem] ${TAP_TRUNCATED_LINK}`}
        >
          {i.involvedParticipantName}
        </Link>
      ) : (i.involvedParticipantName ?? '—'),
    },
    { key: 'severity', header: 'Severity', render: (i) => <StatusBadge status={i.severity} /> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} label={INCIDENT_STATUS_LABELS[i.status as IncidentStatus] ?? i.status} /> },
    { key: 'reportedByName', header: 'Reported By', maxWidth: '9rem' },
    { key: 'incidentDateTime', header: 'Date', type: 'date' },
    {
      key: 'qscReportingStatus',
      header: 'QSC',
      render: (i) => i.qscReportingStatus === 'NotRequired' ? (
        <span className="text-[var(--color-muted-foreground)]">{'\u2014'}</span>
      ) : i.isOverdue24h ? (
        // Overdue is the one QSC state that must never be missed, so it always takes the solid
        // error pair (--color-on-error-container on --color-error-container = 7.24:1) whatever the
        // underlying status maps to (Pending/Late are amber, 6.37:1). It no longer pulses:
        // animate-pulse halves the pill's opacity at its trough, which takes every token pair
        // down to 2.3-2.7:1 — below the 4.5:1 floor for text.
        <StatusBadge status="overdue" label="OVERDUE" className="font-semibold" />
      ) : (
        <StatusBadge status={i.qscReportingStatus} label={formatQscLabel(i.qscReportingStatus)} />
      ),
    },
    { key: 'actions', header: '', render: (i) => canWrite ? <RowActions>{actionButtons(i)}</RowActions> : null },
  ]

  // Same condition the body uses to swap in the queue: a ?view=flagged-notes link from someone who
  // can't see the tab still lands on the incidents list.
  const showFlaggedNotes = tab === 'flagged-notes' && canViewFlaggedNotes
  // "1 incident requires", "2 incidents require": the verb agrees with the count.
  const qscHeadline = overdueQsc.length === 1
    ? '1 incident requires QSC reporting — 24-hour deadline exceeded'
    : `${overdueQsc.length} incidents require QSC reporting — 24-hour deadline exceeded`
  const reportIncidentAction = !showFlaggedNotes && !showArchived && canCreateIncidents && (
    <Button to="/incidents/new" size="md">
      <Plus className="w-4 h-4" /> Report Incident
    </Button>
  )

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      {/* The tabs share the H1 row (spec §3), and the H1 now renders on both tabs. PageHeader's title
          row is `flex justify-between` without wrap, so this wrapper lets it wrap: on a phone the
          tabs and button drop under the title instead of squeezing it. A plain wrapper also keeps
          the title and filter rows in block flow, without the flex column's section gap between them. */}
      <div className="[&>div:first-child]:flex-wrap [&>div:first-child]:gap-y-1">
        <PageHeader
          title="Incident Reports"
          subtitle={showFlaggedNotes ? undefined : plural(totalCount, 'incident')}
          action={(canViewFlaggedNotes || reportIncidentAction) && (
            <div className="flex flex-auto flex-wrap items-center gap-x-4 gap-y-1">
              {canViewFlaggedNotes && (
                <Tabs
                  tabs={[
                    { id: 'incidents', label: 'Incidents' },
                    { id: 'flagged-notes', label: `Flagged notes (${flaggedNotes.length})` },
                  ]}
                  active={tab}
                  onChange={key => setTab(key as IncidentsTab)}
                  ariaLabel="Incidents sections"
                  className="min-w-0"
                />
              )}
              {reportIncidentAction && <div className="ml-auto">{reportIncidentAction}</div>}
            </div>
          )}
        >
          {!showFlaggedNotes && (
            <>
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
            </>
          )}
        </PageHeader>
      </div>

      {showFlaggedNotes ? (
        <FlaggedNotesTab flaggedNotes={flaggedNotes} isLoading={flaggedNotesLoading} />
      ) : (
      <>
      {/* QSC Overdue Alert Banner — one 40px line: the headline, the reason and the link all stay,
          the reason truncates (md+) before the link ever does. */}
      {!showArchived && overdueQsc.length > 0 && (
        <div
          role="alert"
          className="flex min-h-10 items-center gap-3 px-3 py-1.5 rounded-[var(--radius-md)] bg-error-container border border-destructive/40 text-on-error-container"
        >
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm md:truncate">
            <span className="font-semibold">{qscHeadline}</span>
            <span className="ml-2 text-[13px]">NDIS Quality and Safeguards Commission requires reportable incidents to be escalated within 24 hours.</span>
          </p>
          <Link to="/incidents?qsc=overdue" className={`${TAP_FLOOR} shrink-0 whitespace-nowrap text-sm font-medium underline underline-offset-2`}>
            View overdue incidents
          </Link>
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
