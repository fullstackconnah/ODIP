import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCheck, AlertTriangle } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { Callout } from '@/components/Callout'
import { PageState } from '@/components/PageState'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import {
  useCompletions, useCompletion, useApproveCompletion, useReturnCompletion, useApproveCompletionsBatch, useStaff,
} from '@/api/hooks'
import type { CompletionQueueItemDto, ShiftStatus, ShiftCompletionDto, ApproveBatchResultDto } from '@/api/types'
import { formatDateAu, formatWithTimeZone, extractErrorMessage } from '@/lib/utils'
import { formatVarianceMinutes } from './lib/roster'
import { plural } from '@/lib/format'
import { Button } from '@/components/Button'
import { TONE } from '@/lib/tone'

const PAGE_SIZE = 50

const STATUS_FILTER_ITEMS: { value: ShiftStatus; label: string }[] = [
  { value: 'PendingReview', label: 'Pending review' },
  { value: 'InProgress', label: 'In progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Published', label: 'Returned / not submitted' },
]

function varianceBadgeClass(isOutlier: boolean): string {
  return isOutlier
    ? 'bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
    : 'bg-[var(--color-primary-fixed)] text-[var(--color-on-primary-fixed)]'
}

function rosteredVsActual(row: CompletionQueueItemDto) {
  const timeFmt = { timeStyle: 'short' as const }
  return (
    <div className="text-xs space-y-0.5 whitespace-nowrap">
      <div>
        <span className="text-[var(--color-muted-foreground)]">Rostered:</span>{' '}
        {formatWithTimeZone(row.rosteredStart, row.timeZoneId, timeFmt)}–{formatWithTimeZone(row.rosteredEnd, row.timeZoneId, timeFmt)}
      </div>
      <div>
        <span className="text-[var(--color-muted-foreground)]">Actual:</span>{' '}
        {formatWithTimeZone(row.actualStart, row.timeZoneId, timeFmt)}–{row.actualEnd ? formatWithTimeZone(row.actualEnd, row.timeZoneId, timeFmt) : '—'}
      </div>
    </div>
  )
}

/**
 * Reads the incidents count out of the shared ['rostering-completion', shiftId] query cache
 * without triggering a fetch of its own — the queue must not N+1 a detail call per row (design
 * spec §4), so this only lights up once the coordinator has already opened the Approve/Return
 * dialog for that row at least once in this session (which fetches and caches the detail).
 */
function useCachedIncidentCount(shiftId: string): number {
  const qc = useQueryClient()
  const cached = qc.getQueryData<ShiftCompletionDto>(['rostering-completion', shiftId])
  return cached?.incidents.length ?? 0
}

function IncidentIndicator({ shiftId }: { shiftId: string }) {
  const count = useCachedIncidentCount(shiftId)
  if (count === 0) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-on-error-container)]">
      <AlertTriangle className="w-3.5 h-3.5" /> {plural(count, 'incident')}
    </span>
  )
}

function IncidentsList({ incidents }: { incidents: ShiftCompletionDto['incidents'] }) {
  if (incidents.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-[var(--color-foreground)]">Incidents during this shift</p>
      <ul className="space-y-1">
        {incidents.map(incident => (
          <li key={incident.id} className="rounded-sm border border-[var(--color-error-container)] bg-[var(--color-error-container)]/30 px-2 py-1.5 text-xs">
            <span className="font-medium">{incident.title}</span> — {incident.severity}, {incident.status}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** What the worker confirmed at Finish (My shifts redesign): moved times with the stamps they replaced, the reason, kilometres, the report answer. */
function WorkerAnswers({ c }: { c: ShiftCompletionDto }) {
  const t = (iso: string) => formatWithTimeZone(iso, c.timeZoneId, { hour: 'numeric', minute: '2-digit' })
  const lines = [
    c.originalActualStart && `Start ${t(c.originalActualStart)}, changed to ${t(c.actualStart)}.`,
    c.originalActualEnd && c.actualEnd && `Finish ${t(c.originalActualEnd)}, changed to ${t(c.actualEnd)}.`,
    c.timeAdjustmentReason && `Reason: ${c.timeAdjustmentReason}`,
    c.kilometres != null && `${c.kilometres} km driven with the participant`,
    c.anythingToReport && 'The worker said there was something to report.',
    c.shiftReturnCount > 0 && `Returned to the worker ${plural(c.shiftReturnCount, 'time')} before.`,
  ].filter((line): line is string => typeof line === 'string')
  if (lines.length === 0 && !c.sentFromOffline) return null
  return (
    <div className="space-y-1">
      {c.sentFromOffline && (
        <div>
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.neutral.solid}`}>Sent from offline</span>
          {c.submittedAt && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">Reached Bunya Support {t(c.submittedAt)}</span>}
        </div>
      )}
      {lines.length > 0 && <ul className="space-y-0.5 text-xs">{lines.map(line => <li key={line}>{line}</li>)}</ul>}
    </div>
  )
}

export default function CompletionReviewPage() {
  const { canReviewCompletions } = usePermissions()
  const [statusFilter, setStatusFilter] = useState<ShiftStatus>('PendingReview')
  const [staffFilter, setStaffFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')
  const [page, setPage] = useState(1)

  const filters = useMemo(() => ({
    status: statusFilter,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  }), [statusFilter, fromFilter, toFilter])

  const { data, isLoading, isError, refetch } = useCompletions(filters, page, PAGE_SIZE)
  const { data: staff = [] } = useStaff()
  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const staffNameById = useMemo(() => new Map(staff.map(s => [s.id, s.fullName])), [staff])

  // GET /rostering/completions has no staffId query param (see RosteringController.GetCompletions)
  // — applied client-side over the fetched page, same "doesn't filter server-side" caveat
  // useLeaveRequests documents for its own from/to.
  const rows = useMemo(() => {
    const items = data?.items ?? []
    if (!staffFilter) return items
    const name = staffNameById.get(staffFilter)
    return name ? items.filter(r => r.staffName === name) : items
  }, [data, staffFilter, staffNameById])

  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [approveTarget, setApproveTarget] = useState<CompletionQueueItemDto | null>(null)
  const [returnTarget, setReturnTarget] = useState<CompletionQueueItemDto | null>(null)
  const [returnReason, setReturnReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [batchResults, setBatchResults] = useState<ApproveBatchResultDto[] | null>(null)

  const detailShiftId = approveTarget?.shiftId ?? returnTarget?.shiftId
  const { data: detail } = useCompletion(detailShiftId)

  const approveCompletion = useApproveCompletion()
  const returnCompletion = useReturnCompletion()
  const approveBatch = useApproveCompletionsBatch()

  function closeApprove() {
    setApproveTarget(null)
    setActionError(null)
  }

  function closeReturn() {
    setReturnTarget(null)
    setReturnReason('')
    setActionError(null)
  }

  async function handleApproveConfirm() {
    if (!approveTarget) return
    setActionError(null)
    try {
      await approveCompletion.mutateAsync(approveTarget.shiftId)
      closeApprove()
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not approve this shift. Please try again.'))
    }
  }

  async function handleReturnConfirm() {
    if (!returnTarget) return
    const reason = returnReason.trim()
    if (!reason) {
      setActionError('A return reason is required.')
      return
    }
    setActionError(null)
    try {
      await returnCompletion.mutateAsync({ shiftId: returnTarget.shiftId, data: { reason } })
      closeReturn()
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not return this shift. Please try again.'))
    }
  }

  async function handleBatchApproveConfirm() {
    setActionError(null)
    try {
      const results = await approveBatch.mutateAsync(Array.from(selectedRows))
      setBatchResults(results)
      setSelectedRows(new Set())
      setBatchConfirmOpen(false)
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Could not approve the selected shifts. Please try again.'))
    }
  }

  const columns: Column<CompletionQueueItemDto>[] = [
    { key: 'participantName', header: 'Participant', render: row => row.participantName },
    { key: 'staffName', header: 'Staff', render: row => row.staffName },
    { key: 'serviceDate', header: 'Date', render: row => formatDateAu(row.serviceDate) },
    { key: 'times', header: 'Rostered vs actual', render: rosteredVsActual },
    {
      key: 'variance', header: 'Variance', render: row => (
        <div className="flex flex-wrap items-center gap-1">   {/* the badges wrap in a narrow column instead of running under the buttons */}
          <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${varianceBadgeClass(row.isOutlierVariance)}`}>
            {formatVarianceMinutes(row.varianceMinutesStart)} / {formatVarianceMinutes(row.varianceMinutesEnd)}
          </span>
          {row.timesAdjusted && (
            // An adjustment is not a compliance warning, so it takes the info tone (SHAPE §7).
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.info.solid}`}>Times adjusted by the worker</span>
          )}
          {row.returnCount > 0 && (
            <span className={`inline-block text-xs px-2 py-0.5 rounded-full ${TONE.neutral.solid}`}>Returned {plural(row.returnCount, 'time')}</span>
          )}
          <IncidentIndicator shiftId={row.shiftId} />
        </div>
      ),
    },
    ...(canReviewCompletions ? [{
      key: 'actions', header: '', align: 'right' as const, render: (row: CompletionQueueItemDto) => (
        // Always visible (not a hover-revealed RowActions): reviewing is this queue's whole purpose. sm keeps the row at --row-h.
        row.status === 'PendingReview' ? (
          <div className="flex justify-end gap-1.5 pointer-coarse:gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReturnTarget(row)} aria-label={`Return ${row.staffName} with ${row.participantName} on ${formatDateAu(row.serviceDate)}`}>
              Return
            </Button>
            <Button size="sm" onClick={() => setApproveTarget(row)} aria-label={`Approve ${row.staffName} with ${row.participantName} on ${formatDateAu(row.serviceDate)}`}>
              Approve
            </Button>
          </div>
        ) : null
      ),
    }] : []),
  ]

  return (
    <div className="flex flex-col gap-[var(--section-gap)] animate-fade-in">
      <PageHeader title="Completions">
        {canReviewCompletions && selectedRows.size > 0 && (
          <Button onClick={() => setBatchConfirmOpen(true)}>
            Approve selected ({selectedRows.size})
          </Button>
        )}
      </PageHeader>

      {!canReviewCompletions && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          You have read-only access here — approving, returning and batch-approving completions are unavailable.
        </p>
      )}

      {batchResults && (
        <div role="status" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-accent)]/40 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p>
              {batchResults.filter(r => r.approved).length} approved
              {batchResults.some(r => !r.approved) && `, ${batchResults.filter(r => !r.approved).length} failed`}.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setBatchResults(null)}>Dismiss</Button>
          </div>
          {batchResults.filter(r => !r.approved).map(r => (
            <p key={r.shiftId} className="text-xs text-[var(--color-destructive)]">{r.shiftId}: {r.message ?? r.code ?? 'Could not approve.'}</p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Dropdown
            variant="form"
            value={statusFilter}
            onChange={v => { setStatusFilter(v as ShiftStatus); setPage(1) }}
            items={STATUS_FILTER_ITEMS}
            label="Status"
          />
        </div>
        <div className="w-56">
          <SearchableSelect
            value={staffFilter}
            onChange={setStaffFilter}
            items={[{ value: '', label: 'All staff' }, ...staffOptions]}
            placeholder="All staff"
            aria-label="Filter by staff"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="completions-from-date" className="text-xs text-[var(--color-muted-foreground)]">From</label>
          <input id="completions-from-date" type="date" value={fromFilter} onChange={e => { setFromFilter(e.target.value); setPage(1) }} />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="completions-to-date" className="text-xs text-[var(--color-muted-foreground)]">To</label>
          <input id="completions-to-date" type="date" value={toFilter} onChange={e => { setToFilter(e.target.value); setPage(1) }} />
        </div>
      </div>

      {isLoading ? (
        <PageState kind="loading" noun="shift completions" />
      ) : isError ? (
        <Callout tone="danger" actions={<Button variant="secondary" size="sm" onClick={() => refetch()}>Try again</Button>}>
          Couldn't load shift completions. Check your connection and try again.
        </Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No completions match these filters" description="Try a different status, staff member or date range." />
      ) : (
        <>
          <DataTable
            data={rows}
            columns={columns}
            keyField="shiftId"
            emptyMessage="No completions found"
            selectable={canReviewCompletions}
            selectedRows={selectedRows}
            onSelectionChange={setSelectedRows}
            pagination={{ page, pageSize: PAGE_SIZE, totalCount: data?.totalCount ?? rows.length, onPageChange: setPage }}
          />
        </>
      )}

      <ConfirmDialog
        open={approveTarget !== null}
        onCancel={closeApprove}
        onConfirm={handleApproveConfirm}
        title="Approve completion"
        confirmLabel="Approve"
        loading={approveCompletion.isPending}
        message={
          <div className="space-y-3">
            <p>{approveTarget ? `Approve ${approveTarget.participantName}'s shift on ${formatDateAu(approveTarget.serviceDate)} for ${approveTarget.staffName}?` : ''}</p>
            {detail && <WorkerAnswers c={detail} />}
            {detail && <IncidentsList incidents={detail.incidents} />}
            {actionError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{actionError}</p>}
          </div>
        }
      />

      <ConfirmDialog
        open={returnTarget !== null}
        onCancel={closeReturn}
        onConfirm={handleReturnConfirm}
        title="Return completion"
        variant="danger"
        confirmLabel="Return"
        loading={returnCompletion.isPending}
        message={
          <div className="space-y-3">
            <p>{returnTarget ? `Return ${returnTarget.participantName}'s shift on ${formatDateAu(returnTarget.serviceDate)} to ${returnTarget.staffName} for correction?` : ''}</p>
            {detail && <WorkerAnswers c={detail} />}
            {detail && <IncidentsList incidents={detail.incidents} />}
            <label className="block text-sm text-[var(--color-foreground)]">
              Reason (required)
              <textarea
                value={returnReason}
                onChange={e => setReturnReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-sm"
                aria-required="true"
              />
            </label>
            {actionError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{actionError}</p>}
          </div>
        }
      />

      <ConfirmDialog
        open={batchConfirmOpen}
        onCancel={() => { setBatchConfirmOpen(false); setActionError(null) }}
        onConfirm={handleBatchApproveConfirm}
        title="Approve selected shifts"
        confirmLabel="Approve all"
        loading={approveBatch.isPending}
        message={
          <div className="space-y-2">
            <p>{`Approve ${plural(selectedRows.size, 'selected shift')}?`}</p>
            {actionError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{actionError}</p>}
          </div>
        }
      />
    </div>
  )
}
