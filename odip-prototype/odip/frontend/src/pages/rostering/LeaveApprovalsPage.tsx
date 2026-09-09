import { useMemo, useState } from 'react'
import { CalendarOff, Plus } from 'lucide-react'
import { usePermissions } from '@/lib/permissions'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/DataTable'
import { EmptyState } from '@/components/EmptyState'
import { StatusBadge } from '@/components/StatusBadge'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Dropdown } from '@/components/Dropdown'
import { SearchableSelect } from '@/components/SearchableSelect'
import { FindingsList } from '@/pages/rostering/components/FindingsList'
import {
  useLeaveRequests, useRecurringUnavailabilities, useApproveLeave, useDeclineLeave, useCancelLeave,
  useApproveUnavailability, useDeclineUnavailability, useCancelUnavailability,
  useCreateLeaveOnBehalf, useCreateUnavailabilityOnBehalf, useStaff,
} from '@/api/hooks'
import { LeaveRequestFormModal } from '@/pages/portal/components/LeaveRequestFormModal'
import { UnavailabilityFormModal } from '@/pages/portal/components/UnavailabilityFormModal'
import { LEAVE_STATUS_COLORS, LEAVE_TYPE_LABELS } from '@/api/types'
import type { LeaveRequestDto, RecurringUnavailabilityDto, LeaveStatus, RosterFindingDto, CreateLeaveRequestDto, CreateRecurringUnavailabilityDto } from '@/api/types'
import { formatEffectiveRange } from './lib/roster'

function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as { response?: { data?: { message?: string; errors?: string[] } } }
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

type ApprovalRow =
  | { rowKind: 'leave'; key: string; data: LeaveRequestDto }
  | { rowKind: 'unavailability'; key: string; data: RecurringUnavailabilityDto }

const STATUS_FILTER_ITEMS = [
  { value: '', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Declined', label: 'Declined' },
  { value: 'Cancelled', label: 'Cancelled' },
]

function rowType(row: ApprovalRow) {
  return row.rowKind === 'leave' ? `Leave — ${LEAVE_TYPE_LABELS[row.data.leaveType]}` : 'Regular unavailability'
}

function rowWindow(row: ApprovalRow) {
  return row.rowKind === 'leave'
    ? formatEffectiveRange(row.data.startDate, row.data.endDate)
    : `${row.data.dayOfWeek} ${row.data.startTime.slice(0, 5)}–${row.data.endTime.slice(0, 5)}, ${formatEffectiveRange(row.data.effectiveFrom, row.data.effectiveTo)}`
}

export default function LeaveApprovalsPage() {
  const { canApproveLeave } = usePermissions()
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('Pending')
  const [staffFilter, setStaffFilter] = useState('')
  const [fromFilter, setFromFilter] = useState('')
  const [toFilter, setToFilter] = useState('')

  const filters = useMemo(() => ({
    status: statusFilter || undefined,
    userId: staffFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  }), [statusFilter, staffFilter, fromFilter, toFilter])

  // GET /leave/unavailability only binds status/userId server-side — from/to are silently
  // dropped, so they're applied client-side below instead of being sent (I-1).
  const unavailabilityFilters = useMemo(() => ({
    status: statusFilter || undefined,
    userId: staffFilter || undefined,
  }), [statusFilter, staffFilter])

  const { data: leaveRequests = [], isLoading: leaveLoading, isError: leaveError, refetch: refetchLeave } = useLeaveRequests(filters)
  const { data: unavailabilities = [], isLoading: unavailabilityLoading, isError: unavailabilityError, refetch: refetchUnavailability } = useRecurringUnavailabilities(unavailabilityFilters)
  const { data: staff = [] } = useStaff()

  // Effective range [effectiveFrom, effectiveTo ?? ∞) overlaps the [fromFilter, toFilter] window
  // the coordinator picked, so the one table stays coherent with what its own filter shows.
  const visibleUnavailabilities = useMemo(
    () => unavailabilities.filter(r =>
      (!fromFilter || (r.effectiveTo ?? '9999-12-31') >= fromFilter) &&
      (!toFilter || r.effectiveFrom <= toFilter)),
    [unavailabilities, fromFilter, toFilter],
  )

  const approveLeave = useApproveLeave()
  const declineLeave = useDeclineLeave()
  const cancelLeave = useCancelLeave()
  const approveUnavailability = useApproveUnavailability()
  const declineUnavailability = useDeclineUnavailability()
  const cancelUnavailability = useCancelUnavailability()
  const createLeaveOnBehalf = useCreateLeaveOnBehalf()
  const createUnavailabilityOnBehalf = useCreateUnavailabilityOnBehalf()

  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const staffNameById = useMemo(() => new Map(staff.map(s => [s.id, s.fullName])), [staff])

  const [onBehalfMode, setOnBehalfMode] = useState<'leave' | 'unavailability' | null>(null)
  const [onBehalfError, setOnBehalfError] = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<ApprovalRow | null>(null)
  const [approveOverlaps, setApproveOverlaps] = useState<RosterFindingDto[] | null>(null)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [declineTarget, setDeclineTarget] = useState<ApprovalRow | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ApprovalRow | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const rows: ApprovalRow[] = useMemo(() => [
    ...leaveRequests.map(r => ({ rowKind: 'leave' as const, key: `leave-${r.id}`, data: r })),
    ...visibleUnavailabilities.map(r => ({ rowKind: 'unavailability' as const, key: `unavailability-${r.id}`, data: r })),
  ].sort((a, b) => b.data.requestedAt.localeCompare(a.data.requestedAt)), [leaveRequests, visibleUnavailabilities])

  const isLoading = leaveLoading || unavailabilityLoading
  const isError = leaveError || unavailabilityError

  async function handleApproveConfirm() {
    if (!approveTarget) return
    setApproveError(null)
    try {
      if (approveTarget.rowKind === 'leave') {
        const result = await approveLeave.mutateAsync(approveTarget.data.id)
        setApproveOverlaps(result.overlaps)
      } else {
        const result = await approveUnavailability.mutateAsync(approveTarget.data.id)
        setApproveOverlaps(result.overlaps)
      }
    } catch (err) {
      setApproveError(extractErrorMessage(err, 'Could not approve this request. Please try again.'))
    }
  }

  function closeApproveFlow() {
    setApproveTarget(null)
    setApproveOverlaps(null)
    setApproveError(null)
  }

  async function handleDeclineConfirm() {
    if (!declineTarget) return
    setDeclineError(null)
    try {
      if (declineTarget.rowKind === 'leave') await declineLeave.mutateAsync({ id: declineTarget.data.id, data: { decisionNote: declineNote.trim() } })
      else await declineUnavailability.mutateAsync({ id: declineTarget.data.id, data: { decisionNote: declineNote.trim() } })
      setDeclineTarget(null)
      setDeclineNote('')
    } catch (err) {
      setDeclineError(extractErrorMessage(err, 'Could not decline this request. Please try again.'))
    }
  }

  async function handleCancelConfirm() {
    if (!cancelTarget) return
    setCancelError(null)
    try {
      if (cancelTarget.rowKind === 'leave') await cancelLeave.mutateAsync(cancelTarget.data.id)
      else await cancelUnavailability.mutateAsync(cancelTarget.data.id)
      setCancelTarget(null)
    } catch (err) {
      setCancelError(extractErrorMessage(err, 'Could not cancel this request. Please try again.'))
    }
  }

  async function handleOnBehalfLeave(payload: CreateLeaveRequestDto) {
    setOnBehalfError(null)
    try {
      await createLeaveOnBehalf.mutateAsync(payload)
      setOnBehalfMode(null)
    } catch (err) {
      setOnBehalfError(extractErrorMessage(err, 'Could not save this leave record. Please try again.'))
    }
  }

  async function handleOnBehalfUnavailability(payload: CreateRecurringUnavailabilityDto) {
    setOnBehalfError(null)
    try {
      await createUnavailabilityOnBehalf.mutateAsync(payload)
      setOnBehalfMode(null)
    } catch (err) {
      setOnBehalfError(extractErrorMessage(err, 'Could not save this unavailability record. Please try again.'))
    }
  }

  function rowRequestedBy(row: ApprovalRow) {
    const { requestedByUserId, userId, requestedAt } = row.data
    const who = requestedByUserId === userId ? 'Self' : (staffNameById.get(requestedByUserId) ?? 'Coordinator')
    return `${who} · ${requestedAt.slice(0, 10)}`
  }

  const columns: Column<ApprovalRow>[] = [
    { key: 'staff', header: 'Staff', render: row => row.data.userFullName },
    { key: 'type', header: 'Type', render: rowType },
    { key: 'window', header: 'Dates', render: rowWindow },
    { key: 'requestedAt', header: 'Requested', render: rowRequestedBy },
    { key: 'status', header: 'Status', render: row => (
      <div>
        <StatusBadge status={row.data.status} colorMap={LEAVE_STATUS_COLORS} />
        {row.data.status === 'Declined' && row.data.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{row.data.decisionNote}</p>
        )}
      </div>
    ) },
    ...(canApproveLeave ? [{
      key: 'actions', header: '', align: 'right' as const, render: (row: ApprovalRow) => row.data.status === 'Pending' ? (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDeclineTarget(row)} className="min-h-[44px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
            Decline
          </button>
          <button type="button" onClick={() => setApproveTarget(row)} className="min-h-[44px] px-3 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90">
            Approve
          </button>
        </div>
      ) : row.data.status === 'Approved' ? (
        <button type="button" onClick={() => setCancelTarget(row)} className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline">
          {row.rowKind === 'leave' ? 'Cancel leave' : 'Cancel rule'}
        </button>
      ) : null,
    }] : []),
  ]

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Leave approvals" subtitle="Review and decide staff leave and regular-unavailability requests.">
        {canApproveLeave && (
          <Dropdown
            variant="menu"
            label="Enter on behalf"
            icon={<Plus className="w-4 h-4" />}
            items={[{ value: 'leave', label: 'Leave' }, { value: 'unavailability', label: 'Regular unavailability' }]}
            onSelect={value => { setOnBehalfError(null); setOnBehalfMode(value as 'leave' | 'unavailability') }}
          />
        )}
      </PageHeader>

      {!canApproveLeave && (
        <p className="text-sm text-[var(--color-muted-foreground)]">
          You have read-only access here — approving, declining, cancelling and entering requests on behalf of staff are unavailable.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Dropdown variant="form" value={statusFilter} onChange={v => setStatusFilter(v as LeaveStatus | '')} items={STATUS_FILTER_ITEMS} label="Status" />
        </div>
        <div className="w-56">
          <SearchableSelect
            value={staffFilter}
            onChange={setStaffFilter}
            items={[{ value: '', label: 'All staff' }, ...staffOptions]}
            placeholder="All staff"
          />
        </div>
        <input type="date" value={fromFilter} onChange={e => setFromFilter(e.target.value)} aria-label="From date" />
        <input type="date" value={toFilter} onChange={e => setToFilter(e.target.value)} aria-label="To date" />
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : isError ? (
        <EmptyState
          icon={CalendarOff}
          title="Couldn't load leave requests."
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: () => { refetchLeave(); refetchUnavailability() } }}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No requests match these filters" description="Try a different status, staff member or date range." />
      ) : (
        <DataTable data={rows} columns={columns} keyField="key" emptyMessage="No requests found" />
      )}

      {onBehalfMode === 'leave' && (
        <LeaveRequestFormModal
          open
          onClose={() => setOnBehalfMode(null)}
          onSubmit={handleOnBehalfLeave}
          submitting={createLeaveOnBehalf.isPending}
          errorMessage={onBehalfError}
          staffOptions={staffOptions}
        />
      )}
      {onBehalfMode === 'unavailability' && (
        <UnavailabilityFormModal
          open
          onClose={() => setOnBehalfMode(null)}
          onSubmit={handleOnBehalfUnavailability}
          submitting={createUnavailabilityOnBehalf.isPending}
          errorMessage={onBehalfError}
          staffOptions={staffOptions}
        />
      )}

      <ConfirmDialog
        open={approveTarget !== null && approveOverlaps === null}
        onConfirm={handleApproveConfirm}
        onCancel={() => { setApproveTarget(null); setApproveError(null) }}
        title="Approve request"
        message={
          <div className="space-y-2">
            <p>{approveTarget ? `Approve ${rowType(approveTarget).toLowerCase()} for ${approveTarget.data.userFullName}?` : ''}</p>
            {approveError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{approveError}</p>}
          </div>
        }
        confirmLabel="Approve"
        loading={approveLeave.isPending || approveUnavailability.isPending}
      />

      <ConfirmDialog
        open={approveOverlaps !== null}
        onCancel={closeApproveFlow}
        onConfirm={closeApproveFlow}
        title="Approved"
        confirmLabel="Done"
        message={
          approveOverlaps && approveOverlaps.length > 0 ? (
            <div className="space-y-2">
              <p>{`Approved — this overlaps ${approveOverlaps.length} rostered shift/trip${approveOverlaps.length === 1 ? '' : 's'}.`}</p>
              <FindingsList findings={approveOverlaps} />
            </div>
          ) : (
            'Approved — no rostered shifts or trips overlap this window.'
          )
        }
      />

      <ConfirmDialog
        open={declineTarget !== null}
        onCancel={() => { setDeclineTarget(null); setDeclineNote(''); setDeclineError(null) }}
        onConfirm={handleDeclineConfirm}
        title="Decline request"
        variant="danger"
        confirmLabel="Decline"
        loading={declineLeave.isPending || declineUnavailability.isPending}
        message={
          <div className="space-y-2">
            <p>{declineTarget ? `Decline ${rowType(declineTarget).toLowerCase()} for ${declineTarget.data.userFullName}?` : ''}</p>
            <label className="block text-sm text-[var(--color-foreground)]">
              Reason (optional)
              <textarea value={declineNote} onChange={e => setDeclineNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-[var(--color-border)] p-2 text-sm" />
            </label>
            {declineError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{declineError}</p>}
          </div>
        }
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onCancel={() => { setCancelTarget(null); setCancelError(null) }}
        onConfirm={handleCancelConfirm}
        title="Cancel approved request"
        variant="danger"
        confirmLabel="Yes, cancel it"
        cancelLabel="Keep"
        loading={cancelLeave.isPending || cancelUnavailability.isPending}
        message={
          <div className="space-y-2">
            <p>{cancelTarget ? `Cancel the approved ${rowType(cancelTarget).toLowerCase()} for ${cancelTarget.data.userFullName}?` : ''}</p>
            {cancelError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{cancelError}</p>}
          </div>
        }
      />
    </div>
  )
}
