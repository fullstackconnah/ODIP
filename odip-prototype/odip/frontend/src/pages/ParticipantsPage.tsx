import { useParticipants, useDeleteParticipant, useRestoreParticipant, useUpdateParticipantStatus, useParticipantAlertsAggregate } from '@/api/hooks'
import { extractErrorMessage, maskNdisNumber } from '@/lib/utils'
import { MaskedValue } from '@/components/MaskedValue'
import { StatusBadge } from '@/components/StatusBadge'
import { DataTable, RowMenu, type Column, type RowMenuItem } from '@/components/DataTable'
import { SearchInput } from '@/components/SearchInput'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { Callout } from '@/components/Callout'
import { PLAN_TYPE_LABELS, SUPPORT_RATIO_LABELS } from '@/api/types/enums'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { PageState } from '@/components/PageState'
import { ServiceStreamBadges, CHIP_CLASS } from '@/components/ServiceStreamBadges'
import { TextField } from '@/components/TextField'
import { ToggleGroup } from '@/components/ToggleGroup'
import { TAP_TRUNCATED_LINK } from '@/components/tapArea'

import { ALERT_SEVERITY_STYLES } from '@/components/alertSeverityStyles'
import { parseServiceStreams } from '@/api/types/participants'
import type { ParticipantListDto } from '@/api/types'
import { useArchiveRestore } from '@/hooks/useArchiveRestore'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Users, ChevronRight, Pill, Pencil, Archive, ArchiveRestore, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { usePermissions } from '@/lib/permissions'
import { houseEndingMessage } from '@/lib/agreementEnding'
import { queryPhase } from '@/lib/queryPhase'
import { readParticipantActivatedNotice } from './profile/participantActivated'

/** The views of the register: finalised participants only (a draft is an Enquiries or an Onboarding row). The agreements ending view moved to the Agreements page. */
type View = 'active' | 'archived'
const VIEW_OPTIONS: { key: View; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
]

// A care need the phone card must not lose: the table keeps the tick a 'boolean' column draws, the card shows the need as a chip.
/** The two care needs as chips, in one cell (a function, not a component, so null reaches DataTable and the empty card cell is dropped): the same on the desktop row and the phone card, named in words (a bare emoji and a lone "High" were two unlabelled columns). */
function careNeeds(p: ParticipantListDto) {
  if (!p.mobilityAidWheelchair && !p.isHighSupport) return null
  return (
    <span className="inline-flex items-center gap-1 md:w-max">
      {p.mobilityAidWheelchair && <span className={CHIP_CLASS}>Wheelchair</span>}
      {p.isHighSupport && <span className={CHIP_CLASS}>High support</span>}
    </span>
  )
}

/**
 * What each view asks the server for. Active is the operational register (the server owns the stage rule, so a browser filter cannot
 * bypass onboarding). Archived is every finalised participant who is not active, NOT narrowed by that rule: someone archived after
 * going through onboarding has an onboarding row and would otherwise be listed nowhere they could be restored from.
 */
function listParams(view: View, search: string): Record<string, string> {
  const params: Record<string, string> = view === 'archived'
    ? { isActive: 'false', isDraft: 'false' }
    : { isActive: 'true', isDraft: 'false', operationalOnly: 'true' }
  if (search) params.search = search
  return params
}

/** The row of the participant the user has just activated: the same highlight the Onboarding table gives the participant who has just completed intake. */
const ARRIVAL_ROW = 'bg-[var(--color-primary)]/10 outline outline-2 -outline-offset-2 outline-[var(--color-primary)]/40'

/**
 * Body export — rendered by the ParticipantsHubPage tabbed container so the hub owns one PageHeader. The hub used to render only the body, which left the Active / Archived toggle and the search
 * with no screen to live on (L2-02): Archive could not be undone, and the register could not be searched.
 */
export function ParticipantsTable() {
  const screen = useParticipantsScreen()
  const [params] = useSearchParams()
  // The old Agreements ending view lives on the Agreements page now; a bookmarked link follows it.
  if (params.get('view') === 'ending') return <Navigate replace to="/agreements?show=ending" />
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">{screen.toolbar}</div>
      {screen.body}
    </>
  )
}

function useParticipantsScreen() {
  const { canWrite, canViewAlerts, canImportData } = usePermissions()
  const navigate = useNavigate()
  const location = useLocation()
  // A one-off confirmation from the Profile wizard ("{name} is now an active participant."), carried by navigation state when completing a participant's
  // profile in onboarding activated them. Held in state so it survives the history-state clear below, and cleared from history so a reload or coming
  // back to this URL later does not replay it.
  const [arrival] = useState(() => readParticipantActivatedNotice(location.state))
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('active')
  const [statusNotice, setStatusNotice] = useState<{ message: string; warnings: string[] } | null>(null)
  useEffect(() => {
    if (!arrival) return
    // The confirmation is mounted one tick after the page, not with it: a status region that is already in the DOM on first paint is often not
    // announced by a screen reader, while one that appears afterwards is. The highlighted row needs no announcing, so it is there from the start.
    const timer = window.setTimeout(() => {
      setStatusNotice({ message: `${arrival.name} is now an active participant.`, warnings: [] })
      // Only now is the arrival taken out of history. If this screen unmounts before the tick the timer is cleared with it, and the state must still be
      // there for the remount to read: clearing it up front lost the confirmation for good.
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }, 0)
    return () => window.clearTimeout(timer)
    // Only the arrival matters: run once for the notice this screen mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deleteParticipant = useDeleteParticipant()
  const restoreParticipant = useRestoreParticipant()
  const updateStatus = useUpdateParticipantStatus()
  const { data: alertsAggregate, isLoading: alertsLoading } = useParticipantAlertsAggregate(canViewAlerts)
  const alertsByParticipant = useMemo(
    () => new Map((alertsAggregate ?? []).map((a) => [a.participantId, a])),
    [alertsAggregate],
  )

  const { showArchived, setShowArchived, confirmDialog, errorNotice, requestArchive, requestRestore } = useArchiveRestore<ParticipantListDto>({
    deleteMutation: deleteParticipant,
    restoreMutation: restoreParticipant,
    // Restore reactivates and changes nothing else, so the endpoint takes an empty body: no list row can be sent back.
    restoreData: () => ({}),
    entityName: (p) => p.fullName,
    entityId: (p) => p.id,
    editPath: (p) => `/participants/${p.id}/edit`,
  })

  // The hook owns the archive / restore confirmation and its failure banner; it only needs to know which of its two views this is.
  const changeView = (next: View) => {
    setView(next)
    setShowArchived(next === 'archived')
    // A status notice belongs to the list it was made on, like the archive and restore failure banner.
    setStatusNotice(null)
  }

  // Asked once typing pauses, not on every keystroke (each one sent a request and flashed the table to loading).
  const term = useDebouncedValue(search.trim(), 300)
  const participantsQuery = useParticipants(listParams(view, term))
  const { data: participants = [], refetch } = participantsQuery
  // Three different facts: loading, failed, and loaded. A failed load is not an empty register, and neither is a request that has not run
  // (TanStack Query pauses it while the browser reports offline: isLoading false, isError false, data undefined), so "No participants yet"
  // follows only a request that succeeded. Data already on screen wins over a refetch that failed behind it.
  const phase = queryPhase(participantsQuery)
  const isLoading = phase === 'loading'
  const loadFailed = phase === 'error'

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

  // The dialog stays open until the server has answered: a refusal shows its message inside it (so the coordinator can retry
  // or cancel), and only a saved change closes it and leaves a notice, with the server's warnings, above the table.
  const [statusReason, setStatusReason] = useState('')
  const [statusError, setStatusError] = useState<string | null>(null)

  const openStatusDialog = (p: ParticipantListDto) => {
    setStatusReason('')
    setStatusError(null)
    setPendingStatusChange({ id: p.id, nextIsActive: !p.isActive })
  }
  const closeStatusDialog = () => {
    setPendingStatusChange(null)
    setStatusReason('')
    setStatusError(null)
  }
  const confirmStatusChange = () => {
    if (!pendingStatusChange) return
    if (!pendingParticipant) return
    const { fullName } = pendingParticipant
    const { nextIsActive } = pendingStatusChange
    const reason = statusReason.trim()
    setStatusError(null)
    setStatusNotice(null)
    // The status endpoint takes the flag and an optional reason, never the participant: PUT /participants/{id} is a full replace.
    updateStatus.mutate(
      { id: pendingParticipant.id, isActive: nextIsActive, ...(reason ? { reason } : {}) },
      {
        onSuccess: response => {
          const result = response.data
          const now = (result?.isActive ?? nextIsActive) ? 'Active' : 'Inactive'
          closeStatusDialog()
          setStatusNotice({
            message: result?.changed === false ? `${fullName} was already ${now}. Nothing was changed.` : `${fullName} is now ${now}.`,
            warnings: result?.warnings ?? [],
          })
        },
        onError: err => setStatusError(extractErrorMessage(err, "Could not change this participant's status. Please try again.")),
      },
    )
  }

  const toolbar = (
    <>
      <ToggleGroup options={VIEW_OPTIONS} value={view} onChange={key => changeView(key as View)} ariaLabel="Participant list view" />
      <SearchInput value={search} onChange={setSearch} placeholder="Search participants..." />
    </>
  )

  // The row's actions, once: icon buttons on a mouse (revealed on hover), one ⋯ menu on the phone card. Archive is undoable (a confirm, then the Archived view), so it is never red.
  const rowItems = (p: ParticipantListDto): RowMenuItem[] => [
    ...(p.hasActiveMedications ? [{ label: 'View medications', icon: <Pill className="w-4 h-4" />, onSelect: () => navigate(`/participants/${p.id}?tab=medications`) }] : []),
    ...(canWrite ? [
      { label: 'Change status', icon: <ArrowLeftRight className="w-4 h-4" />, onSelect: () => openStatusDialog(p) },
      { label: 'Edit', icon: <Pencil className="w-4 h-4" />, to: `/participants/${p.id}/edit` },
      showArchived
        ? { label: 'Restore', icon: <ArchiveRestore className="w-4 h-4" />, onSelect: () => requestRestore(p) }
        : { label: 'Archive', icon: <Archive className="w-4 h-4" />, onSelect: () => requestArchive(p) },
    ] : []),
  ]

  // One line per row at any desktop width: DataTable's cells never wrap, so a narrower window costs columns, not row height. The order is
  // identity, status, alerts, care needs, then the rest, so what a coordinator triages by is on screen before the box scrolls (the edge fade
  // marks the rest). Streams is left out while nobody has one. The 40px chevron cell stays: it is the row's constant "opens the record" cue,
  // and the row actions overlay the cells before it on hover. On the phone card the whole card opens the record (onRowClick), the chevron goes,
  // and the menu ends the card: Alerts (when any), Care needs, Region, Plan Type, Support Ratio.
  const participantColumns: Column<ParticipantListDto>[] = [
    {
      key: 'fullName',
      header: 'Name',
      sortable: true,
      mobile: 'primary',
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
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      mobile: 'status',
      render: (p) => {
        const current = p.isActive ? 'Active' : 'Inactive'
        return (
          <span aria-label={`Status: ${current}`}>
            <StatusBadge status={current} />
          </span>
        )
      },
    },
    ...(canViewAlerts ? [{
      key: 'alerts',
      header: 'Alerts',
      align: 'center' as const,
      mobile: 'meta' as const,
      className: 'text-[var(--color-muted-foreground)]',
      render: (p: ParticipantListDto) => {
        if (alertsLoading) {
          return <span className="inline-block h-4 w-9 rounded-full bg-[var(--color-muted)] animate-pulse" />
        }
        const entry = alertsByParticipant.get(p.id)
        const total = entry ? entry.criticalCount + entry.warningCount + entry.infoCount : 0
        // A plain dash, not a span: the phone card leaves a plain dash off.
        if (total === 0) return '—'
        return (
          <span className="inline-flex items-center gap-1" title={entry!.alerts.map((a) => (a.type === 'agreement-ended' ? houseEndingMessage(a.message) : a.message)).join('; ')}>
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
    { key: 'careNeeds', header: 'Care needs', mobile: 'meta', render: careNeeds },
    { key: 'ndisNumber', header: 'NDIS Number', mobile: 'hidden', render: (p) => <span className="font-mono text-[13px] text-[var(--color-muted-foreground)]"><MaskedValue value={maskNdisNumber(p.maskedNdisNumber ?? p.ndisNumber)} /></span> },
    { key: 'region', header: 'Region', sortable: true, maxWidth: '11rem', mobile: 'meta' },
    { key: 'supportRatio', header: 'Support Ratio', maxWidth: '10rem', mobile: 'meta', className: 'max-md:order-1!', render: (p) => SUPPORT_RATIO_LABELS[p.supportRatio] ?? p.supportRatio },
    { key: 'planType', header: 'Plan Type', maxWidth: '10rem', mobile: 'meta', className: 'max-md:order-0!', render: (p) => PLAN_TYPE_LABELS[p.planType] ?? p.planType },
    { key: 'isRepeatClient', header: 'Repeat', type: 'boolean', align: 'center', mobile: 'hidden' },
    {
      key: 'serviceStreams',
      header: 'Streams',
      mobile: 'hidden',
      // Not hideWhenEmpty: the wire value for no streams is the string "None", which that rule does not read as empty.
      hidden: participants.length > 0 && participants.every(p => parseServiceStreams(p.serviceStreams).length === 0),
      // Chips never wrap onto a second line (w-max), the group is clipped at 10rem instead.
      render: (p) => (
        <div className="md:max-w-[10rem] md:overflow-hidden">
          <ServiceStreamBadges value={p.serviceStreams} className="md:w-max" />
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      mobile: 'trail',
      // The relative cell anchors the overlay in RowMenu; the column itself is only the chevron.
      className: 'relative',
      render: (p) => (
        <div className="flex items-center justify-end gap-1.5">
          <RowMenu name={p.fullName} items={rowItems(p)} />
          <ChevronRight className="w-4 h-4 text-[var(--color-muted-foreground)] group-hover/row:text-[var(--color-foreground)] transition-colors shrink-0 max-md:hidden" aria-hidden="true" />
        </div>
      ),
    },
  ]

  const emptyState = search ? (
    <EmptyState
      icon={Users}
      title="No participants match your filters"
      description="Try a different search term, or clear your search to see all participants."
      action={{ label: 'Clear search', onClick: () => setSearch('') }}
    />
  ) : view === 'archived' ? (
    <EmptyState
      icon={Users}
      title="No archived participants"
      description="Participants you archive are listed here, and can be restored."
    />
  ) : (
    <EmptyState
      icon={Users}
      title="No participants yet"
      description="Participants are the NDIS clients you support. Import your participant list from a spreadsheet, or add them one at a time."
      action={canImportData ? { label: 'Import participants', to: '/settings/import/participants' } : canWrite ? { label: 'Add participant', to: '/participants/new' } : undefined}
      secondaryAction={canImportData && canWrite ? { label: 'Add participant', to: '/participants/new' } : undefined}
    />
  )

  const body = (
    <>
      {statusNotice && (
        <Callout
          tone="success"
          actions={<button type="button" className="font-medium underline shrink-0" onClick={() => setStatusNotice(null)}>Dismiss</button>}
        >
          <p>{statusNotice.message}</p>
          {statusNotice.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {statusNotice.warnings.map(warning => <li key={warning}>{warning}</li>)}
            </ul>
          )}
        </Callout>
      )}
      {errorNotice}
      {loadFailed ? (
        <PageState kind="error" noun="participant list" onRetry={() => refetch()} />
      ) : !isLoading && participants.length === 0 ? (
        emptyState
      ) : (
        <DataTable
          data={participants}
          columns={participantColumns}
          keyField="id"
          sortable
          loading={isLoading}
          emptyMessage="No participants found"
          onRowClick={p => navigate(`/participants/${p.id}`)}
          rowClassName={p => (arrival && p.id === arrival.participantId ? ARRIVAL_ROW : '')}
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
          loading={updateStatus.isPending}
          message={
            <div className="space-y-3">
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
              <TextField
                id="status-change-reason"
                label="Reason (optional)"
                maxLength={500}
                value={statusReason}
                onChange={e => setStatusReason(e.target.value)}
                hint="Recorded with the change in the audit trail."
              />
              {statusError && <Callout tone="error">{statusError}</Callout>}
            </div>
          }
        />
      )}
    </>
  )

  return { toolbar, body }
}
