import { useIncidents, useRestoreIncident, useDeleteIncident, useOverdueQscIncidents, useFlaggedShiftNotes } from '@/api/hooks'
import type { TruncatableList } from '@/api/hooks/pagedList'
import type { IncidentListDto, FlaggedShiftNoteDto } from '@/api/types'
import { INCIDENT_STATUS_LABELS, INCIDENT_TYPE_LABELS, type IncidentStatus, type IncidentType } from '@/api/types/enums'
import { DataTable, RowMenu, ROW_LINK, CROSS_LINK, type Column, type RowMenuItem } from '@/components/DataTable'
import { PageHeader } from '@/components/PageHeader'
import { StatusBadge } from '@/components/StatusBadge'
import { EmptyState } from '@/components/EmptyState'
import { Dropdown, type DropdownItem } from '@/components/Dropdown'
import { Tabs } from '@/components/Tabs'
import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { TAP_FLOOR, TAP_TRUNCATED_LINK } from '@/components/tapArea'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useState } from 'react'
import { Filter, Plus, AlertTriangle, ShieldAlert, FileWarning, Pencil, Archive, ArchiveRestore } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { formatDateAu } from '@/lib/utils'
import { formatAge, plural } from '@/lib/format'
import { SHIFT_NOTE_FLAG_LABELS } from '@/lib/shiftNoteKeywords'
import type { ShiftNoteIncidentPrefillState } from '@/lib/incidentPrefill'
import { retryingAfterError } from '@/lib/queryPhase'

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

function FlaggedNotesTab({ flaggedNotes, isLoading, isError, onRetry }: { flaggedNotes: FlaggedShiftNoteDto[]; isLoading: boolean; isError: boolean; onRetry: () => void }) {
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
              <StatusBadge key={category} tone="warning" label={SHIFT_NOTE_FLAG_LABELS[category] ?? category} />
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

  if (!isLoading && !isError && flaggedNotes.length === 0) {
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
      error={isError}
      onRetry={onRetry}
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
  { value: 'UnderReview', label: 'Under review' },
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
    case 'ReportedWithin24h': return 'Reported on time'
    case 'ReportedLate': return 'Reported late'
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
  const flaggedQuery = useFlaggedShiftNotes(
    { withoutIncident: true },
    { enabled: canViewFlaggedNotes },
  )
  const { data: flaggedNotes = [], isLoading: flaggedNotesLoading, isError: flaggedNotesError, refetch: refetchFlaggedNotes } = flaggedQuery
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
  const { data: overdueQsc = [], isError: overdueQscError, refetch: refetchOverdueQsc } = useOverdueQscIncidents()

  const { showArchived, params, toggleButtons, confirmDialog, errorNotice, requestArchive, requestRestore } = useArchiveRestore<any>({
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

  const pageQuery = useIncidents(queryParams)
  const { data: incidents = [], isLoading, isError, refetch } = pageQuery
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

  // The menu a row offers, once: icon buttons on a mouse, one ⋯ on the phone card. Archive is undoable (a confirm, then Closed), so it is never red.
  const rowItems = (i: IncidentListDto): RowMenuItem[] => canWrite
    ? [
        { label: 'Edit', icon: <Pencil className="w-4 h-4" />, to: `/incidents/${i.id}/edit` },
        showArchived
          ? { label: 'Restore', icon: <ArchiveRestore className="w-4 h-4" />, onSelect: () => requestRestore(i) }
          : { label: 'Archive', icon: <Archive className="w-4 h-4" />, onSelect: () => requestArchive(i) },
      ]
    : []

  // Every row is exactly --row-h from 1280 up: cells never wrap (DataTable), except the title (two lines). From md up the box scrolls
  // sideways with the title and the actions pinned, so no column is dropped. Order is Title, NDIS Commission, Status, Severity, Date, then
  // Type, Trip and Participant: the five a coordinator triages by are on screen at 1024, and Type is too at 1280.
  const incidentColumns: Column<any>[] = [
    {
      key: 'title',
      header: 'Title',
      mobile: 'primary',
      wrap: true,
      className: 'font-medium',
      // The way into the incident for every role that sees the list; the cap sits on the link itself so its focus ring is not clipped.
      render: (i) => <Link to={`/incidents/${i.id}`} title={i.title ?? undefined} className={`line-clamp-2 break-words md:max-w-[15rem] 2xl:max-w-[18rem] ${ROW_LINK} ${TAP_TRUNCATED_LINK}`}>{i.title ?? '—'}</Link>,
    },
    {
      key: 'qscReportingStatus',
      header: 'NDIS Commission',
      // A plain dash (not a span) so the phone card leaves the cell out when there is nothing to report.
      mobile: 'meta',
      render: (i) => i.qscReportingStatus === 'NotRequired' ? '\u2014' : i.isOverdue24h ? (
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
    { key: 'status', header: 'Status', mobile: 'status', render: (i) => <StatusBadge status={i.status} label={INCIDENT_STATUS_LABELS[i.status as IncidentStatus] ?? i.status} /> },
    { key: 'severity', header: 'Severity', mobile: 'meta', render: (i) => <StatusBadge status={i.severity} /> },
    { key: 'incidentDateTime', header: 'Date', type: 'date', mobile: 'meta' },
    { key: 'incidentType', header: 'Type', maxWidth: '9rem', mobile: 'hidden', render: (i) => INCIDENT_TYPE_LABELS[i.incidentType as IncidentType] ?? i.incidentType },
    {
      key: 'tripName',
      header: 'Trip',
      mobile: 'meta',
      render: (i) => i.tripInstanceId && i.tripName ? (
        <Link
          to={`/trips/${i.tripInstanceId}`}
          title={i.tripName}
          className={`inline-block align-middle max-md:max-w-[9rem] max-md:truncate md:truncate md:max-[1792px]:max-w-[11rem] min-[1792px]:max-w-[13rem] ${CROSS_LINK} ${TAP_TRUNCATED_LINK}`}
        >
          {i.tripName}
        </Link>
      ) : (i.tripName ?? '—'),
    },
    {
      key: 'involvedParticipantName',
      header: 'Participant',
      mobile: 'meta',
      render: (i) => i.involvedParticipantId && i.involvedParticipantName ? (
        <Link
          to={`/participants/${i.involvedParticipantId}`}
          title={i.involvedParticipantName}
          className={`inline-block align-middle max-md:max-w-[9rem] max-md:truncate md:max-w-[9rem] md:truncate 2xl:max-w-[12rem] ${CROSS_LINK} ${TAP_TRUNCATED_LINK}`}
        >
          {i.involvedParticipantName}
        </Link>
      ) : (i.involvedParticipantName ?? '—'),
    },
    { key: 'reportedByName', header: 'Reported By', maxWidth: '9rem', mobile: 'hidden' },
    { key: 'actions', header: '', overlay: true, mobile: 'trail', render: (i) => <RowMenu name={i.title ?? 'incident'} items={rowItems(i)} /> },
  ]

  // Same condition the body uses to swap in the queue: a ?view=flagged-notes link from someone who
  // can't see the tab still lands on the incidents list.
  const showFlaggedNotes = tab === 'flagged-notes' && canViewFlaggedNotes
  // "1 incident requires", "2 incidents require": the verb agrees with the count.
  const qscHeadline = overdueQsc.length === 1
    ? '1 incident is past its NDIS Commission deadline'
    : `${overdueQsc.length} incidents are past their NDIS Commission deadline`
  const reportIncidentAction = !showFlaggedNotes && !showArchived && canCreateIncidents && (
    <Button to="/incidents/new" size="md">
      <Plus className="w-4 h-4" /> Report incident
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
          title="Incidents"
          subtitle={showFlaggedNotes ? undefined : plural(totalCount, 'incident')}
          action={(canViewFlaggedNotes || reportIncidentAction) && (
            <div className="flex flex-auto flex-wrap items-center gap-x-4 gap-y-1">
              {canViewFlaggedNotes && (
                <Tabs
                  tabs={[
                    { id: 'incidents', label: 'Reports' },
                    // A failed load is not a count of 0: the label drops the count until there is one.
                    { id: 'flagged-notes', label: flaggedNotesError && flaggedNotes.length === 0 ? 'Flagged notes' : `Flagged notes (${flaggedNotes.length})` },
                  ]}
                  active={tab}
                  onChange={key => setTab(key as IncidentsTab)}
                  ariaLabel="Incidents sections"
                  className="min-w-0 max-md:basis-full"
                />
              )}
              {/* On a phone the action leads the row, under the title as on the other list pages, and the tabs take the row below it. */}
              {reportIncidentAction && <div className="max-md:order-first md:ml-auto">{reportIncidentAction}</div>}
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
        <FlaggedNotesTab flaggedNotes={flaggedNotes} isLoading={flaggedNotesLoading} isError={flaggedNotesError || retryingAfterError(flaggedQuery)} onRetry={() => refetchFlaggedNotes()} />
      ) : (
      <>
      {/* QSC Overdue Alert Banner — the headline, the reason and the link all stay; the reason wraps
          onto a second line rather than being cut, so the 5-business-day sentence is always readable. */}
      {!showArchived && overdueQsc.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 px-3 py-2.5 rounded-[var(--radius-md)] bg-error-container border border-destructive/40 text-on-error-container"
        >
          <AlertTriangle className="mt-0.5 w-4 h-4 flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 flex flex-col items-start gap-1 md:flex-row md:items-center md:gap-3">
          <p className="min-w-0 text-sm md:flex-1">
            <span className="font-semibold">{qscHeadline}</span>
            <span className="ml-2 text-[13px]">{'Most reportable incidents must be reported to the NDIS Commission within 24\u00a0hours. Some uses of an unauthorised restrictive practice can be reported within 5\u00a0business days.'}</span>
          </p>
          <Link to="/incidents?qsc=overdue" className={`${TAP_FLOOR} shrink-0 whitespace-nowrap text-sm font-medium underline underline-offset-2`}>
            View overdue incidents
          </Link>
          </div>
        </div>
      )}

      {/* The overdue check is a compliance warning: a failed check says so, it never hides the banner as if nothing were overdue. */}
      {!showArchived && overdueQscError && overdueQsc.length === 0 && (
        <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetchOverdueQsc()}>Try again</Button>}>
          Couldn't check for incidents past their NDIS Commission deadline.
        </Callout>
      )}

      {qscOverdueOnly && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Showing only incidents past their NDIS Commission deadline.{' '}
          <Link to="/incidents" className="font-medium underline underline-offset-2">Show all incidents</Link>
        </p>
      )}

      {errorNotice}

      {!isLoading && !isError && incidents.length === 0 ? (
        qscOverdueOnly ? (
          <EmptyState
            icon={ShieldAlert}
            title="No overdue NDIS Commission reports"
            description="No incidents are past their NDIS Commission deadline."
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
          />
        )
      ) : (
        <DataTable
          data={incidents}
          columns={incidentColumns}
          keyField="id"
          loading={isLoading}
          error={isError || retryingAfterError(pageQuery)}
          onRetry={() => refetch()}
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
