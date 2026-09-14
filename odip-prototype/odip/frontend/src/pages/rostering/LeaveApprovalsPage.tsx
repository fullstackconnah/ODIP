import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  useUpdateLeave, useUpdateUnavailability, useAssignShift,
  useStaffAvailabilityRecords, useCreateStaffAvailability, useUpdateStaffAvailability, useDeleteStaffAvailability,
} from '@/api/hooks'
import { LeaveRequestFormModal } from '@/pages/portal/components/LeaveRequestFormModal'
import { UnavailabilityFormModal } from '@/pages/portal/components/UnavailabilityFormModal'
import { AvailabilityRecordFormModal } from '@/pages/rostering/components/AvailabilityRecordFormModal'
import { LEAVE_STATUS_COLORS, LEAVE_TYPE_LABELS } from '@/api/types'
import type {
  LeaveRequestDto, RecurringUnavailabilityDto, StaffAvailabilityDto, LeaveStatus, RosterFindingDto,
  CreateLeaveRequestDto, CreateRecurringUnavailabilityDto, CreateStaffAvailabilityDto, OverlapShiftDto,
} from '@/api/types'
import { formatEffectiveRange, formatShiftTimeRange } from './lib/roster'
import { extractErrorMessage, formatDateAu } from '@/lib/utils'

type LegacyRecord = StaffAvailabilityDto & { userFullName: string }

type ApprovalRow =
  | { rowKind: 'leave'; key: string; data: LeaveRequestDto }
  | { rowKind: 'unavailability'; key: string; data: RecurringUnavailabilityDto }
  | { rowKind: 'legacy'; key: string; data: LegacyRecord }

const STATUS_FILTER_ITEMS = [
  { value: '', label: 'All statuses' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Declined', label: 'Declined' },
  { value: 'Cancelled', label: 'Cancelled' },
]

// Neutral grey — StatusBadge's own STATUS_COLORS has no 'record' key, so without this override
// it would fall through to the amber DEFAULT_COLOR and read as "awaiting decision", which a
// legacy record (no status/decision workflow at all) never is.
const LEGACY_RECORD_COLOR = { record: 'bg-[var(--color-input)] text-[var(--color-muted-foreground)]' }

function rowType(row: ApprovalRow) {
  if (row.rowKind === 'leave') return `Leave — ${LEAVE_TYPE_LABELS[row.data.leaveType]}`
  if (row.rowKind === 'unavailability') return 'Regular unavailability'
  return row.data.availabilityType
}

function rowWindow(row: ApprovalRow) {
  if (row.rowKind === 'leave') return formatEffectiveRange(row.data.startDate, row.data.endDate)
  if (row.rowKind === 'unavailability') {
    return `${row.data.dayOfWeek} ${row.data.startTime.slice(0, 5)}–${row.data.endTime.slice(0, 5)}, ${formatEffectiveRange(row.data.effectiveFrom, row.data.effectiveTo)}`
  }
  return formatEffectiveRange(row.data.startDateTime.slice(0, 10), row.data.endDateTime.slice(0, 10))
}

/** Sort key for the merged table — requestedAt for leave/unavailability rows; a legacy row has no
 * requestedAt (there's no request workflow), so it falls back to createdAt if the DTO ever grows
 * one, else startDateTime. */
function rowSortKey(row: ApprovalRow): string {
  if (row.rowKind === 'legacy') {
    const data = row.data as LegacyRecord & { createdAt?: string }
    return data.createdAt ?? data.startDateTime
  }
  return row.data.requestedAt
}

type OverlapShiftsListProps = {
  shifts: OverlapShiftDto[]
  unassigningShiftId: string | null
  unassignedShiftIds: Set<string>
  unassignErrors: Record<string, string>
  onUnassign: (shiftId: string) => void
}

/**
 * Item 5: each row an approve/edit response's `overlapShifts` returned — the shift itself
 * (date, time, participant), plus a per-row "Unassign and mark open" action so the coordinator
 * can immediately open up the hole the just-approved leave creates, without leaving this dialog
 * to go find the shift on the board. Renders nothing when there are no overlap shifts — today's
 * plain findings-only rendering is unchanged in that case.
 */
function OverlapShiftsList({ shifts, unassigningShiftId, unassignedShiftIds, unassignErrors, onUnassign }: OverlapShiftsListProps) {
  if (shifts.length === 0) return null

  return (
    <ul className="space-y-2">
      {shifts.map(shift => {
        const done = unassignedShiftIds.has(shift.shiftId)
        const busy = unassigningShiftId === shift.shiftId
        const error = unassignErrors[shift.shiftId]
        return (
          <li key={shift.shiftId} className="rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--color-foreground)]">
                {formatDateAu(shift.serviceDate)} · {formatShiftTimeRange(shift.startTime, shift.endTime)}
                {shift.endsNextDay && <span className="sr-only"> (ends the next day)</span>} · {shift.participantName}
              </p>
              {done ? (
                <span className="shrink-0 text-xs font-medium text-[var(--color-primary)]">Unassigned</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onUnassign(shift.shiftId)}
                  disabled={busy}
                  className="shrink-0 min-h-[36px] px-3 text-xs rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)] disabled:opacity-50"
                >
                  {busy ? 'Unassigning…' : 'Unassign and mark open'}
                </button>
              )}
            </div>
            {error && <p role="alert" className="mt-1 text-xs text-[var(--color-destructive)]">{error}</p>}
          </li>
        )
      })}
    </ul>
  )
}

export default function LeaveApprovalsPage() {
  const { canApproveLeave } = usePermissions()
  const [searchParams] = useSearchParams()
  // A ?userId= link (e.g. from a staff profile) means "show me this person's history" — the
  // default Pending-only view would otherwise hide everything but their live requests.
  const linkedUserId = searchParams.get('userId') ?? ''
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>(linkedUserId ? '' : 'Pending')
  const [staffFilter, setStaffFilter] = useState(linkedUserId)
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

  const legacyFilters = useMemo(() => ({
    userId: staffFilter || undefined,
    from: fromFilter || undefined,
    to: toFilter || undefined,
  }), [staffFilter, fromFilter, toFilter])

  const { data: leaveRequests = [], isLoading: leaveLoading, isError: leaveError, refetch: refetchLeave } = useLeaveRequests(filters)
  const { data: unavailabilities = [], isLoading: unavailabilityLoading, isError: unavailabilityError, refetch: refetchUnavailability } = useRecurringUnavailabilities(unavailabilityFilters)
  const { data: legacyRecords = [], isLoading: legacyLoading, isError: legacyError, refetch: refetchLegacy } = useStaffAvailabilityRecords(legacyFilters)
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
  const updateLeave = useUpdateLeave()
  const updateUnavailability = useUpdateUnavailability()
  const createStaffAvailability = useCreateStaffAvailability()
  const updateStaffAvailability = useUpdateStaffAvailability()
  const deleteStaffAvailability = useDeleteStaffAvailability()
  const assignShift = useAssignShift()

  const staffOptions = useMemo(() => staff.map(s => ({ value: s.id, label: s.fullName })), [staff])
  const staffNameById = useMemo(() => new Map(staff.map(s => [s.id, s.fullName])), [staff])

  // A legacy record has no status of its own — it's shown as a settled "Record" whenever the
  // filter isn't scoped to a workflow status that couldn't apply to it (Pending/Declined/
  // Cancelled are all leave/unavailability-only states).
  const visibleLegacyRecords: LegacyRecord[] = useMemo(
    () => (statusFilter === '' || statusFilter === 'Approved')
      ? legacyRecords.map(r => ({ ...r, userFullName: staffNameById.get(r.staffId) ?? 'Unknown staff' }))
      : [],
    [legacyRecords, statusFilter, staffNameById],
  )

  const [onBehalfMode, setOnBehalfMode] = useState<'leave' | 'unavailability' | 'availability' | null>(null)
  const [onBehalfError, setOnBehalfError] = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<ApprovalRow | null>(null)
  const [approveOverlaps, setApproveOverlaps] = useState<RosterFindingDto[] | null>(null)
  const [approveOverlapShifts, setApproveOverlapShifts] = useState<OverlapShiftDto[]>([])
  const [approveError, setApproveError] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<ApprovalRow | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [editOverlaps, setEditOverlaps] = useState<RosterFindingDto[] | null>(null)
  const [editOverlapShifts, setEditOverlapShifts] = useState<OverlapShiftDto[]>([])
  // Per-shift unassign progress/outcome for the overlap-shifts lists above — shared between the
  // approve and edit overlaps dialogs since only one is ever open at a time, and reset whenever
  // either dialog closes (see closeApproveFlow/closeEditOverlapsFlow).
  const [unassigningShiftId, setUnassigningShiftId] = useState<string | null>(null)
  const [unassignedShiftIds, setUnassignedShiftIds] = useState<Set<string>>(new Set())
  const [unassignErrors, setUnassignErrors] = useState<Record<string, string>>({})
  const [deleteLegacyTarget, setDeleteLegacyTarget] = useState<{ rowKind: 'legacy'; key: string; data: LegacyRecord } | null>(null)
  const [deleteLegacyError, setDeleteLegacyError] = useState<string | null>(null)
  const [declineTarget, setDeclineTarget] = useState<ApprovalRow | null>(null)
  const [declineNote, setDeclineNote] = useState('')
  const [declineError, setDeclineError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ApprovalRow | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const rows: ApprovalRow[] = useMemo(() => [
    ...leaveRequests.map(r => ({ rowKind: 'leave' as const, key: `leave-${r.id}`, data: r })),
    ...visibleUnavailabilities.map(r => ({ rowKind: 'unavailability' as const, key: `unavailability-${r.id}`, data: r })),
    ...visibleLegacyRecords.map(r => ({ rowKind: 'legacy' as const, key: `legacy-${r.id}`, data: r })),
  ].sort((a, b) => rowSortKey(b).localeCompare(rowSortKey(a))), [leaveRequests, visibleUnavailabilities, visibleLegacyRecords])

  const isLoading = leaveLoading || unavailabilityLoading || legacyLoading
  const isError = leaveError || unavailabilityError || legacyError

  function refetchAll() {
    refetchLeave()
    refetchUnavailability()
    refetchLegacy()
  }

  async function handleApproveConfirm() {
    if (!approveTarget) return
    setApproveError(null)
    try {
      if (approveTarget.rowKind === 'leave') {
        const result = await approveLeave.mutateAsync(approveTarget.data.id)
        setApproveOverlaps(result.overlaps)
        setApproveOverlapShifts(result.overlapShifts ?? [])
      } else {
        const result = await approveUnavailability.mutateAsync(approveTarget.data.id)
        setApproveOverlaps(result.overlaps)
        setApproveOverlapShifts(result.overlapShifts ?? [])
      }
    } catch (err) {
      setApproveError(extractErrorMessage(err, 'Could not approve this request. Please try again.'))
    }
  }

  function resetUnassignState() {
    setUnassigningShiftId(null)
    setUnassignedShiftIds(new Set())
    setUnassignErrors({})
  }

  function closeApproveFlow() {
    setApproveTarget(null)
    setApproveOverlaps(null)
    setApproveOverlapShifts([])
    setApproveError(null)
    resetUnassignState()
  }

  function closeEditOverlapsFlow() {
    setEditOverlaps(null)
    setEditOverlapShifts([])
    resetUnassignState()
  }

  /** Item 5: unassign a shift straight from the overlaps dialog — same endpoint/body as the
   * roster board's own Unassign action (POST .../assign with a null staffId), just triggered
   * from here instead of the board's chip menu. */
  async function handleUnassignOverlapShift(shiftId: string) {
    setUnassignErrors(prev => {
      if (!(shiftId in prev)) return prev
      const next = { ...prev }
      delete next[shiftId]
      return next
    })
    setUnassigningShiftId(shiftId)
    try {
      await assignShift.mutateAsync({ id: shiftId, data: { staffId: null, overrideReason: null, acknowledgedFindingCodes: [] } })
      setUnassignedShiftIds(prev => new Set(prev).add(shiftId))
    } catch (err) {
      setUnassignErrors(prev => ({ ...prev, [shiftId]: extractErrorMessage(err, 'Could not unassign this shift. Please try again.') }))
    } finally {
      setUnassigningShiftId(null)
    }
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

  async function handleOnBehalfAvailability(payload: CreateStaffAvailabilityDto) {
    setOnBehalfError(null)
    try {
      await createStaffAvailability.mutateAsync(payload)
      setOnBehalfMode(null)
    } catch (err) {
      setOnBehalfError(extractErrorMessage(err, 'Could not save this availability record. Please try again.'))
    }
  }

  function openEdit(row: ApprovalRow) {
    setEditError(null)
    setEditTarget(row)
  }

  function closeEditFlow() {
    setEditTarget(null)
    setEditError(null)
  }

  async function handleEditLeaveSubmit(payload: CreateLeaveRequestDto) {
    if (!editTarget || editTarget.rowKind !== 'leave') return
    setEditError(null)
    try {
      const result = await updateLeave.mutateAsync({
        id: editTarget.data.id,
        data: { leaveType: payload.leaveType, startDate: payload.startDate, endDate: payload.endDate, reason: payload.reason },
      })
      closeEditFlow()
      if (result.overlaps.length > 0) {
        setEditOverlaps(result.overlaps)
        setEditOverlapShifts(result.overlapShifts ?? [])
      }
    } catch (err) {
      setEditError(extractErrorMessage(err, 'Could not save this leave request. Please try again.'))
    }
  }

  async function handleEditUnavailabilitySubmit(payload: CreateRecurringUnavailabilityDto) {
    if (!editTarget || editTarget.rowKind !== 'unavailability') return
    setEditError(null)
    try {
      const result = await updateUnavailability.mutateAsync({
        id: editTarget.data.id,
        data: {
          dayOfWeek: payload.dayOfWeek, startTime: payload.startTime, endTime: payload.endTime,
          effectiveFrom: payload.effectiveFrom, effectiveTo: payload.effectiveTo, notes: payload.notes,
        },
      })
      closeEditFlow()
      if (result.overlaps.length > 0) {
        setEditOverlaps(result.overlaps)
        setEditOverlapShifts(result.overlapShifts ?? [])
      }
    } catch (err) {
      setEditError(extractErrorMessage(err, 'Could not save this unavailability rule. Please try again.'))
    }
  }

  async function handleEditLegacySubmit(payload: CreateStaffAvailabilityDto) {
    if (!editTarget || editTarget.rowKind !== 'legacy') return
    setEditError(null)
    try {
      await updateStaffAvailability.mutateAsync({ id: editTarget.data.id, data: payload })
      closeEditFlow()
    } catch (err) {
      setEditError(extractErrorMessage(err, 'Could not save this availability record. Please try again.'))
    }
  }

  async function handleDeleteLegacyConfirm() {
    if (!deleteLegacyTarget) return
    setDeleteLegacyError(null)
    try {
      await deleteStaffAvailability.mutateAsync(deleteLegacyTarget.data.id)
      setDeleteLegacyTarget(null)
    } catch (err) {
      setDeleteLegacyError(extractErrorMessage(err, 'Could not delete this record. Please try again.'))
    }
  }

  // Keyed on editTarget (state, so referentially stable across re-renders caused by unrelated
  // state changes — e.g. setEditError after a rejected PUT, or a background refetch), not
  // recomputed as a fresh object literal on every render. The three edit modals below reset their
  // form whenever this identity changes, so an inline literal here would re-arm that reset on
  // every parent re-render and wipe the coordinator's in-progress edits (see the modals'
  // resetValues/useEffect wiring).
  const leaveEditInitialValues = useMemo(() => (
    editTarget?.rowKind === 'leave' ? {
      leaveType: editTarget.data.leaveType,
      startDate: editTarget.data.startDate,
      endDate: editTarget.data.endDate,
      reason: editTarget.data.reason ?? '',
    } : undefined
  ), [editTarget])

  const unavailabilityEditInitialValues = useMemo(() => (
    editTarget?.rowKind === 'unavailability' ? {
      dayOfWeek: editTarget.data.dayOfWeek,
      startTime: editTarget.data.startTime.slice(0, 5),
      endTime: editTarget.data.endTime.slice(0, 5),
      effectiveFrom: editTarget.data.effectiveFrom,
      effectiveTo: editTarget.data.effectiveTo ?? '',
      notes: editTarget.data.notes ?? '',
    } : undefined
  ), [editTarget])

  const legacyEditInitialValues = useMemo(() => (
    editTarget?.rowKind === 'legacy' ? {
      staffId: editTarget.data.staffId,
      availabilityType: editTarget.data.availabilityType as 'Available' | 'Unavailable' | 'Training' | 'Preferred' | 'Tentative',
      startDate: editTarget.data.startDateTime.slice(0, 10),
      endDate: editTarget.data.endDateTime.slice(0, 10),
      notes: editTarget.data.notes ?? '',
    } : undefined
  ), [editTarget])

  function rowRequestedBy(row: ApprovalRow) {
    if (row.rowKind === 'legacy') return '—'
    const { requestedByUserId, userId, requestedAt } = row.data
    const who = requestedByUserId === userId ? 'Self' : (staffNameById.get(requestedByUserId) ?? 'Coordinator')
    return `${who} · ${requestedAt.slice(0, 10)}`
  }

  const columns: Column<ApprovalRow>[] = [
    { key: 'staff', header: 'Staff', render: row => row.data.userFullName },
    { key: 'type', header: 'Type', render: rowType },
    { key: 'window', header: 'Dates', render: rowWindow },
    { key: 'requestedAt', header: 'Requested', render: rowRequestedBy },
    { key: 'status', header: 'Status', render: row => row.rowKind === 'legacy' ? (
      <StatusBadge status="Record" colorMap={LEGACY_RECORD_COLOR} />
    ) : (
      <div>
        <StatusBadge status={row.data.status} colorMap={LEAVE_STATUS_COLORS} />
        {row.data.status === 'Declined' && row.data.decisionNote && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{row.data.decisionNote}</p>
        )}
      </div>
    ) },
    ...(canApproveLeave ? [{
      key: 'actions', header: '', align: 'right' as const, render: (row: ApprovalRow) => {
        if (row.rowKind === 'legacy') {
          return (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => openEdit(row)} className="min-h-[44px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                Edit
              </button>
              <button type="button" onClick={() => setDeleteLegacyTarget(row)} className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline">
                Delete
              </button>
            </div>
          )
        }
        if (row.data.status === 'Pending') {
          return (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => openEdit(row)} className="min-h-[44px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                Edit
              </button>
              <button type="button" onClick={() => setDeclineTarget(row)} className="min-h-[44px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                Decline
              </button>
              <button type="button" onClick={() => setApproveTarget(row)} className="min-h-[44px] px-3 text-sm rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90">
                Approve
              </button>
            </div>
          )
        }
        if (row.data.status === 'Approved') {
          return (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => openEdit(row)} className="min-h-[44px] px-3 text-sm rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-accent)]">
                Edit
              </button>
              <button type="button" onClick={() => setCancelTarget(row)} className="min-h-[44px] px-3 text-sm text-[var(--color-destructive)] hover:underline">
                {row.rowKind === 'leave' ? 'Cancel leave' : 'Cancel rule'}
              </button>
            </div>
          )
        }
        return null
      },
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
            items={[
              { value: 'leave', label: 'Leave' },
              { value: 'unavailability', label: 'Regular unavailability' },
              { value: 'availability', label: 'Availability record' },
            ]}
            onSelect={value => { setOnBehalfError(null); setOnBehalfMode(value as 'leave' | 'unavailability' | 'availability') }}
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
        <div className="flex items-center gap-1.5">
          <label htmlFor="leave-approvals-from-date" className="text-xs text-[var(--color-muted-foreground)]">From</label>
          <input id="leave-approvals-from-date" type="date" value={fromFilter} onChange={e => setFromFilter(e.target.value)} />
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="leave-approvals-to-date" className="text-xs text-[var(--color-muted-foreground)]">To</label>
          <input id="leave-approvals-to-date" type="date" value={toFilter} onChange={e => setToFilter(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-[var(--color-muted-foreground)]">Loading…</p>
      ) : isError ? (
        <EmptyState
          icon={CalendarOff}
          title="Couldn't load leave requests."
          description="Check your connection and try again."
          action={{ label: 'Try again', onClick: refetchAll }}
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
      {onBehalfMode === 'availability' && (
        <AvailabilityRecordFormModal
          open
          onClose={() => setOnBehalfMode(null)}
          onSubmit={handleOnBehalfAvailability}
          submitting={createStaffAvailability.isPending}
          errorMessage={onBehalfError}
          staffOptions={staffOptions}
        />
      )}

      {editTarget?.rowKind === 'leave' && (
        <LeaveRequestFormModal
          open
          mode="edit"
          onClose={closeEditFlow}
          onSubmit={handleEditLeaveSubmit}
          submitting={updateLeave.isPending}
          errorMessage={editError}
          initialValues={leaveEditInitialValues}
        />
      )}
      {editTarget?.rowKind === 'unavailability' && (
        <UnavailabilityFormModal
          open
          mode="edit"
          onClose={closeEditFlow}
          onSubmit={handleEditUnavailabilitySubmit}
          submitting={updateUnavailability.isPending}
          errorMessage={editError}
          initialValues={unavailabilityEditInitialValues}
        />
      )}
      {editTarget?.rowKind === 'legacy' && (
        <AvailabilityRecordFormModal
          open
          mode="edit"
          onClose={closeEditFlow}
          onSubmit={handleEditLegacySubmit}
          submitting={updateStaffAvailability.isPending}
          errorMessage={editError}
          initialValues={legacyEditInitialValues}
        />
      )}

      <ConfirmDialog
        open={editOverlaps !== null}
        onCancel={closeEditOverlapsFlow}
        onConfirm={closeEditOverlapsFlow}
        title="Saved"
        confirmLabel="Done"
        message={
          editOverlaps && editOverlaps.length > 0 ? (
            <div className="space-y-2">
              <p>{`Saved — this overlaps ${editOverlaps.length} rostered shift/trip${editOverlaps.length === 1 ? '' : 's'}.`}</p>
              <FindingsList findings={editOverlaps} />
              <OverlapShiftsList
                shifts={editOverlapShifts}
                unassigningShiftId={unassigningShiftId}
                unassignedShiftIds={unassignedShiftIds}
                unassignErrors={unassignErrors}
                onUnassign={handleUnassignOverlapShift}
              />
            </div>
          ) : null
        }
      />

      <ConfirmDialog
        open={deleteLegacyTarget !== null}
        onCancel={() => { setDeleteLegacyTarget(null); setDeleteLegacyError(null) }}
        onConfirm={handleDeleteLegacyConfirm}
        title="Delete record"
        variant="danger"
        confirmLabel="Yes, delete it"
        cancelLabel="Keep"
        loading={deleteStaffAvailability.isPending}
        message={
          <div className="space-y-2">
            <p>{deleteLegacyTarget ? `Delete the availability record for ${deleteLegacyTarget.data.userFullName}?` : ''}</p>
            {deleteLegacyError && <p role="alert" className="text-xs text-[var(--color-destructive)]">{deleteLegacyError}</p>}
          </div>
        }
      />

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
              <OverlapShiftsList
                shifts={approveOverlapShifts}
                unassigningShiftId={unassigningShiftId}
                unassignedShiftIds={unassignedShiftIds}
                unassignErrors={unassignErrors}
                onUnassign={handleUnassignOverlapShift}
              />
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
